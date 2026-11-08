/**
 * 本地 PDF 来源的不可变版本存储（V2.1 第一组）。
 *
 * 契约：
 * - 每次导入新建 SourceRevision 与 SourceBlob，文件名从不作为唯一标识；
 *   同名替换只有在调用者显式传入 documentId 时才写入同一文档，且只新增
 *   revision、更新 latestRevisionId，绝不覆盖旧 revision / Blob。
 * - 文档、版本、Blob、最新指针在同一 IndexedDB 事务提交；任一步失败整体回滚。
 * - 解析、SHA-256、容量检查在写事务之前完成，事务结束才报告成功。
 * - 密码保护、损坏、超限、容量不足都返回明确错误，不伪装成功。
 */
import {
  EVENT_STORE_NAME,
  PROJECT_STORE_NAME,
  SOURCE_BLOB_STORE_NAME,
  SOURCE_DOCUMENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
  errorName,
  requestResult,
  transactionDone,
  withDatabase,
} from '../storage/db'
import { addChangeEvent, changeEventId } from '../history/events'
import { sha256Hex } from './hash'
import {
  DEFAULT_SOURCE_LIMITS,
  exceedsFileLimit,
  exceedsPageLimit,
  exceedsProjectLimit,
  formatMiB,
  type SourceLimits,
} from './limits'
import {
  inspectPdfBytes,
  PdfInspectError,
  type PdfInspectResult,
} from './pdfInspect'
import type {
  SourceBlobRecord,
  SourceDocument,
  SourceImportValue,
  SourceRevision,
  StorageCapacity,
} from './types'

export type SourceErrorCode =
  | 'invalid_input'
  | 'file_too_large'
  | 'too_many_pages'
  | 'password_protected'
  | 'invalid_pdf'
  | 'pdf_inspect_failed'
  | 'hash_failed'
  | 'insufficient_storage'
  | 'project_not_found'
  | 'document_not_found'
  | 'project_quota_exceeded'
  | 'storage_failure'

export interface SourceError {
  code: SourceErrorCode
  message: string
  detail?: string
}

export type SourceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SourceError }

export interface ImportSourceRevisionInput {
  projectId: string
  /** 显式选定“替换到哪个文档”；不传即新建文档。 */
  documentId?: string
  /** 新文档标题；默认使用首次导入的文件名。 */
  title?: string
  fileName: string
  bytes: Uint8Array
}

export interface SourceImportContext {
  inspectPdf?: (bytes: Uint8Array) => Promise<PdfInspectResult>
  hashBytes?: (bytes: Uint8Array) => Promise<string>
  estimateCapacity?: () => Promise<StorageCapacity>
  now?: () => string
  newId?: () => string
  limits?: SourceLimits
}

function failure(
  code: SourceErrorCode,
  message: string,
  detail?: string,
): { ok: false; error: SourceError } {
  return { ok: false, error: { code, message, ...(detail ? { detail } : {}) } }
}

function storageFailure(error: unknown, message: string) {
  return failure(
    'storage_failure',
    message,
    error instanceof Error ? error.message : String(error),
  )
}

function randomId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/** 事务可能已经完成/中止；此时 abort() 会抛 InvalidStateError，不能掩盖原始错误。 */
function abortQuietly(transaction: IDBTransaction): void {
  try {
    transaction.abort()
  } catch {
    // 事务已结束：保持原错误，不再中止。
  }
}

/**
 * 估算当前源可用空间。浏览器不支持时明确返回 supported=false；导入流程会继续
 * 尝试写入，但提示无法保证空间足够，并在写入失败时返回 storage_failure。
 */
export async function estimateStorageCapacity(): Promise<StorageCapacity> {
  if (typeof navigator === 'undefined' || navigator.storage === undefined) {
    return {
      supported: false,
      usageBytes: null,
      quotaBytes: null,
      availableBytes: null,
      note: '浏览器不支持存储容量估算，无法保证空间足够；导入仍会尝试写入，失败时明确报错。',
    }
  }
  const storage = navigator.storage
  if (typeof storage.estimate !== 'function') {
    return {
      supported: false,
      usageBytes: null,
      quotaBytes: null,
      availableBytes: null,
      note: '浏览器不支持存储容量估算，无法保证空间足够；导入仍会尝试写入，失败时明确报错。',
    }
  }

  try {
    const estimate = await storage.estimate()
    const usage = typeof estimate.usage === 'number' ? estimate.usage : 0
    const quota = typeof estimate.quota === 'number' ? estimate.quota : null
    return {
      supported: quota !== null,
      usageBytes: usage,
      quotaBytes: quota,
      availableBytes: quota === null ? null : Math.max(0, quota - usage),
      note: '导入前估算，实际可用空间可能变化，不代表写入一定成功。',
    }
  } catch (error) {
    return {
      supported: false,
      usageBytes: null,
      quotaBytes: null,
      availableBytes: null,
      note: `存储容量估算失败：${
        error instanceof Error ? error.message : String(error)
      }；无法保证空间足够。`,
    }
  }
}

function toSourceError(error: unknown): SourceError {
  if (error instanceof PdfInspectError) {
    return { code: error.code, message: error.message }
  }
  return {
    code: 'pdf_inspect_failed',
    message: `PDF 解析失败：${error instanceof Error ? error.message : String(error)}`,
  }
}

/** 项目中已保留 revision 的字节数合计（包含旧版本）。 */
export function sumRevisionBytes(revisions: SourceRevision[]): number {
  return revisions.reduce((total, revision) => total + revision.byteSize, 0)
}

/**
 * 导入一个不可变 revision。
 *
 * 解析、哈希和容量检查都不在写事务内；写事务只做最终一致性检查与写入。
 * 若事务失败，document.latestRevisionId 保持原值，旧 revision / Blob 不受影响。
 *
 * 调用方传入的 `bytes` 可变：进入第一个 await 之前先复制成私有快照，之后的
 * 解析、哈希、限额判断和落库 Blob 全部基于同一份快照，因此 sha256 一定对应
 * 实际写入的 Blob 内容，不会出现“哈希是旧内容、Blob 是新内容”。
 */
export async function importSourceRevision(
  input: ImportSourceRevisionInput,
  context: SourceImportContext = {},
): Promise<SourceResult<SourceImportValue>> {
  const limits = context.limits ?? DEFAULT_SOURCE_LIMITS
  // 只用 trim 判断空值；项目 ID 本身必须原样保留（JSON 允许带首尾空格，
  // trim 后既查不到原项目，还可能命中另一个项目）。
  const projectId = input.projectId
  const fileName = input.fileName.trim()
  // 其余输入也在第一个 await 之前固定，避免异步期间被调用方改动。
  const requestedDocumentId = input.documentId
  const requestedTitle = input.title

  if (projectId.trim() === '') {
    return failure('invalid_input', '缺少项目 ID，无法保存来源文件')
  }
  if (fileName === '') {
    return failure('invalid_input', '文件名不能为空')
  }
  if (input.bytes.byteLength === 0) {
    return failure('invalid_pdf', '文件为空，不是可解析的 PDF')
  }
  if (exceedsFileLimit(input.bytes.byteLength, limits)) {
    return failure(
      'file_too_large',
      `单个 PDF 不能超过 ${formatMiB(limits.maxFileBytes)}；当前文件为 ${formatMiB(
        input.bytes.byteLength,
      )}`,
    )
  }

  // 上面的长度检查全部同步完成，调用方无法在这期间改动缓冲区；复制之后就与
  // 调用方彻底解耦。
  const bytesSnapshot = new Uint8Array(input.bytes)

  const inspect =
    context.inspectPdf ??
    ((bytes: Uint8Array) =>
      inspectPdfBytes(bytes, undefined, { maxPages: limits.maxPages }))
  let inspection: PdfInspectResult
  try {
    inspection = await inspect(bytesSnapshot)
  } catch (error) {
    const mapped = toSourceError(error)
    return failure(mapped.code, mapped.message)
  }

  if (!Number.isInteger(inspection.pageCount) || inspection.pageCount < 1) {
    return failure('invalid_pdf', 'PDF 没有可读取的页面')
  }
  if (exceedsPageLimit(inspection.pageCount, limits)) {
    return failure(
      'too_many_pages',
      `单个文档不能超过 ${limits.maxPages} 页；当前文件为 ${inspection.pageCount} 页`,
    )
  }

  const hash = context.hashBytes ?? sha256Hex
  let sha256: string
  try {
    sha256 = await hash(bytesSnapshot)
  } catch (error) {
    return failure(
      'hash_failed',
      `文件哈希计算失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const estimateCapacity = context.estimateCapacity ?? estimateStorageCapacity
  let storageCapacity: StorageCapacity
  try {
    storageCapacity = await estimateCapacity()
  } catch (error) {
    storageCapacity = {
      supported: false,
      usageBytes: null,
      quotaBytes: null,
      availableBytes: null,
      note: `存储容量估算失败：${
        error instanceof Error ? error.message : String(error)
      }；无法保证空间足够。`,
    }
  }
  if (
    storageCapacity.supported &&
    storageCapacity.availableBytes !== null &&
    storageCapacity.availableBytes < bytesSnapshot.byteLength
  ) {
    return failure(
      'insufficient_storage',
      `可用空间不足：需要 ${formatMiB(
        bytesSnapshot.byteLength,
      )}，估算可用 ${formatMiB(storageCapacity.availableBytes)}`,
    )
  }

  const now = context.now ?? nowIso
  const newId = context.newId ?? randomId
  const revisionId = newId()
  const documentId = requestedDocumentId ?? newId()
  const blobKey = newId()
  const createdAt = now()
  const byteSize = bytesSnapshot.byteLength

  const revision: SourceRevision = {
    id: revisionId,
    projectId,
    documentId,
    fileName,
    sha256,
    byteSize,
    pageCount: inspection.pageCount,
    createdAt,
    blobKey,
  }

  const blobBytes = bytesSnapshot
  const blobRecord: SourceBlobRecord = {
    blobKey,
    projectId,
    sha256,
    byteSize,
    blob: new Blob([blobBytes]),
  }

  try {
    return await withDatabase(async (db) => {
      const transaction = db.transaction(
        [
          PROJECT_STORE_NAME,
          SOURCE_DOCUMENT_STORE_NAME,
          SOURCE_REVISION_STORE_NAME,
          SOURCE_BLOB_STORE_NAME,
          EVENT_STORE_NAME,
        ],
        'readwrite',
      )
      const done = transactionDone(transaction)
      try {
        const project = await requestResult(
          transaction.objectStore(PROJECT_STORE_NAME).get(projectId),
        )
        if (project === undefined) {
          abortQuietly(transaction)
          await done.catch(() => undefined)
          return failure('project_not_found', '项目不存在，未保存来源文件')
        }

        const documentStore = transaction.objectStore(SOURCE_DOCUMENT_STORE_NAME)
        let document: SourceDocument
        let isNewDocument = false

        if (requestedDocumentId === undefined) {
          document = {
            id: documentId,
            projectId,
            title: requestedTitle?.trim() || fileName,
            latestRevisionId: revisionId,
          }
          isNewDocument = true
        } else {
          const existing = (await requestResult(
            documentStore.get(requestedDocumentId),
          )) as SourceDocument | undefined
          if (existing === undefined || existing.projectId !== projectId) {
            abortQuietly(transaction)
            await done.catch(() => undefined)
            return failure(
              'document_not_found',
              '指定的来源文档不存在，未保存新版本',
            )
          }
          document = { ...existing, latestRevisionId: revisionId }
        }

        const revisionStore = transaction.objectStore(SOURCE_REVISION_STORE_NAME)
        // 额度按实际占用的 Blob 字节统计，而不是 revision.byteSize：从 JSON
        // 恢复的来源元数据没有附件，不能因为“文件里写着 2 MB”就占满新项目额度。
        const retainedBlobs = (await requestResult(
          transaction
            .objectStore(SOURCE_BLOB_STORE_NAME)
            .index('projectId')
            .getAll(projectId),
        )) as { byteSize: number }[]
        const usedBytes = retainedBlobs.reduce((total, blob) => total + blob.byteSize, 0)
        if (exceedsProjectLimit(usedBytes, byteSize, limits)) {
          abortQuietly(transaction)
          await done.catch(() => undefined)
          return failure(
            'project_quota_exceeded',
            `项目来源附件总量不能超过 ${formatMiB(
              limits.maxProjectBytes,
            )}；已占用 ${formatMiB(usedBytes)}，本次 ${formatMiB(byteSize)}`,
          )
        }

        await requestResult(revisionStore.add(revision))
        await requestResult(
          transaction
            .objectStore(SOURCE_BLOB_STORE_NAME)
            .add(blobRecord),
        )
        if (isNewDocument) {
          await requestResult(documentStore.add(document))
        } else {
          await requestResult(documentStore.put(document))
        }

        // 事件与 revision / Blob / 最新指针同事务：任一步失败一起回滚。
        await requestResult(
          addChangeEvent(transaction, {
            id: changeEventId('source_import', revisionId),
            projectId,
            type: 'source_import',
            createdAt,
            documentId,
            revisionId,
            message: `导入 ${fileName}（${inspection.pageCount} 页）`,
          }),
        )

        await done
        return {
          ok: true as const,
          value: { document, revision, storageCapacity },
        }
      } catch (error) {
        abortQuietly(transaction)
        await done.catch(() => undefined)
        throw error
      }
    })
  } catch (error) {
    if (errorName(error) === 'ConstraintError') {
      return failure('storage_failure', '来源 ID 冲突，未保存任何数据')
    }
    return storageFailure(error, '保存来源文件失败，现有版本与绑定未改变')
  }
}

/* -------------------------------------------------------------------------- */
/* 读取                                                                       */
/* -------------------------------------------------------------------------- */

export async function getSourceDocument(
  id: string,
): Promise<SourceResult<SourceDocument | null>> {
  try {
    const document = await withDatabase(async (db) => {
      const transaction = db.transaction(SOURCE_DOCUMENT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction.objectStore(SOURCE_DOCUMENT_STORE_NAME).get(id),
      )
      await done
      return value as SourceDocument | undefined
    })
    return { ok: true, value: document ?? null }
  } catch (error) {
    return storageFailure(error, '读取来源文档失败')
  }
}

export async function listSourceDocuments(
  projectId: string,
): Promise<SourceResult<SourceDocument[]>> {
  try {
    const documents = await withDatabase(async (db) => {
      const transaction = db.transaction(SOURCE_DOCUMENT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction
          .objectStore(SOURCE_DOCUMENT_STORE_NAME)
          .index('projectId')
          .getAll(projectId),
      )
      await done
      return value as SourceDocument[]
    })
    return { ok: true, value: documents }
  } catch (error) {
    return storageFailure(error, '读取来源文档列表失败')
  }
}

/**
 * 列出项目实际持有 Blob 字节的 blobKey。
 *
 * 只用于来源核对状态：从 JSON 恢复的 revision 只有元数据、没有 Blob，
 * 不能因为它“引用了某个 blobKey”就当成附件可用。
 */
export async function listSourceBlobKeys(
  projectId: string,
): Promise<SourceResult<string[]>> {
  try {
    const keys = await withDatabase(async (db) => {
      const transaction = db.transaction(SOURCE_BLOB_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction
          .objectStore(SOURCE_BLOB_STORE_NAME)
          .index('projectId')
          .getAllKeys(projectId),
      )
      await done
      return value
    })
    return { ok: true, value: keys.map((key) => String(key)) }
  } catch (error) {
    return storageFailure(error, '读取来源附件索引失败')
  }
}

export async function getSourceRevision(
  id: string,
): Promise<SourceResult<SourceRevision | null>> {
  try {
    const revision = await withDatabase(async (db) => {
      const transaction = db.transaction(SOURCE_REVISION_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction.objectStore(SOURCE_REVISION_STORE_NAME).get(id),
      )
      await done
      return value as SourceRevision | undefined
    })
    return { ok: true, value: revision ?? null }
  } catch (error) {
    return storageFailure(error, '读取来源版本失败')
  }
}

export async function listSourceRevisions(
  projectId: string,
): Promise<SourceResult<SourceRevision[]>> {
  try {
    const revisions = await withDatabase(async (db) => {
      const transaction = db.transaction(SOURCE_REVISION_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction
          .objectStore(SOURCE_REVISION_STORE_NAME)
          .index('projectId')
          .getAll(projectId),
      )
      await done
      return value as SourceRevision[]
    })
    return { ok: true, value: revisions }
  } catch (error) {
    return storageFailure(error, '读取来源版本列表失败')
  }
}

export async function getSourceBlob(
  blobKey: string,
): Promise<SourceResult<SourceBlobRecord | null>> {
  try {
    const record = await withDatabase(async (db) => {
      const transaction = db.transaction(SOURCE_BLOB_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction.objectStore(SOURCE_BLOB_STORE_NAME).get(blobKey),
      )
      await done
      return value as SourceBlobRecord | undefined
    })
    return { ok: true, value: record ?? null }
  } catch (error) {
    return storageFailure(error, '读取来源文件失败')
  }
}

/** 读取 Blob 字节，供哈希一致性检查与后续渲染使用。 */
export async function readSourceBlobBytes(
  blobKey: string,
): Promise<SourceResult<Uint8Array | null>> {
  const record = await getSourceBlob(blobKey)
  if (!record.ok) {
    return record
  }
  if (record.value === null) {
    return { ok: true, value: null }
  }
  try {
    const buffer = await record.value.blob.arrayBuffer()
    return { ok: true, value: new Uint8Array(buffer) }
  } catch (error) {
    return storageFailure(error, '读取来源文件字节失败')
  }
}
