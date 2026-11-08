/**
 * 完整备份 .cunlian.zip 的生成（V2.2 D 组，规格 §8）。
 *
 * 包内容：
 * - manifest.json：格式版本、计数、项目摘要、逐文件 SHA-256 与字节数，并
 *   明示“不包含全局映射模板”；
 * - projects/、drafts/、sourceDocuments/、sourceRevisions/、sourceBlobs/、
 *   sourceFiles/、bindings/、events/、snapshots/、importSnapshots/、
 *   migrationBackups/ 的 JSON 与来源附件原始字节；
 * - 不含 mappingTemplates（全局映射模板），manifest 中写明原因与数量。
 *
 * 读取时所有 store 在同一个只读事务中取一致视图；Blob 字节在事务结束后
 * 再读取，避免把大文件读取拖进事务。生成 ZIP 使用成熟库 @zip.js/zip.js。
 */
import { PROJECT_SCHEMA_VERSION, type Project } from '../domain/types'
import type { AnalysisSnapshot } from '../history/snapshots'
import type { ChangeEvent } from '../history/events'
import type { SourceBinding } from '../sources/bindings'
import type {
  SourceBlobRecord,
  SourceDocument,
  SourceRevision,
} from '../sources/types'
import {
  BINDING_STORE_NAME,
  DRAFT_STORE_NAME,
  EVENT_STORE_NAME,
  IMPORT_SNAPSHOT_STORE_NAME,
  MAPPING_TEMPLATE_STORE_NAME,
  MIGRATION_BACKUP_STORE_NAME,
  PROJECT_DB_VERSION,
  PROJECT_STORE_NAME,
  SNAPSHOT_STORE_NAME,
  SOURCE_BLOB_STORE_NAME,
  SOURCE_DOCUMENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
  requestResult,
  transactionDone,
  withDatabase,
} from '../storage/db'
import type { ImportSnapshot, StoredDraft } from '../storage/projects'
import { sha256Hex } from '../sources/hash'
import {
  MAX_BACKUP_UNCOMPRESSED_BYTES,
  writeZipEntries,
  type ZipSafetyError,
} from './zip'

export const BACKUP_FORMAT = 'cunlian-backup'
export const BACKUP_FORMAT_VERSION = 1
export const BACKUP_FILE_SUFFIX = '.cunlian.zip'
export const MANIFEST_PATH = 'manifest.json'

export const MAPPING_TEMPLATES_EXCLUDED_NOTE =
  '本备份不包含全局映射模板（mappingTemplates）。映射模板属于本机全局设置，不随项目备份；恢复到新浏览器后需要重新建立或重新导入模板。'

export const BACKUP_PATH_PREFIX = {
  projects: 'projects/',
  drafts: 'drafts/',
  documents: 'sourceDocuments/',
  revisions: 'sourceRevisions/',
  blobs: 'sourceBlobs/',
  files: 'sourceFiles/',
  bindings: 'bindings/',
  events: 'events/',
  snapshots: 'snapshots/',
  importSnapshots: 'importSnapshots/',
  migrationBackups: 'migrationBackups/',
} as const

export interface BackupEntryMeta {
  path: string
  sha256: string
  byteSize: number
}

/**
 * 合法但缺少附件字节的来源版本（例如从项目 JSON 导入后尚未重新导入 PDF）。
 *
 * 导出时不伪造附件，也不删除 revision；manifest 逐条声明缺失，恢复时原样
 * 保留 revision 元数据并让附件保持“不可用”。
 */
export interface MissingAttachment {
  revisionId: string
  documentId: string
  blobKey: string
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  formatVersion: typeof BACKUP_FORMAT_VERSION
  createdAt: string
  note: string
  app: {
    databaseVersion: number
    projectSchemaVersion: number
  }
  counts: {
    projects: number
    drafts: number
    documents: number
    revisions: number
    blobs: number
    bindings: number
    events: number
    snapshots: number
    importSnapshots: number
    migrationBackups: number
  }
  projects: { id: string; name: string; updatedAt: string }[]
  /** 声明哪些 revision 的附件不在包内；这些记录恢复后附件不可用。 */
  missingAttachments: MissingAttachment[]
  excludes: {
    mappingTemplates: {
      included: false
      count: number
      note: string
    }
  }
  entries: BackupEntryMeta[]
  totalUncompressedBytes: number
}

export interface ProjectBundle {
  bytes: Uint8Array
  fileName: string
  manifest: BackupManifest
}

export type BundleErrorCode =
  | 'too_many_entries'
  | 'too_large'
  | 'unsafe_path'
  | 'duplicate_entry'
  | 'empty_backup'
  | 'legacy_projects'
  | 'storage_failure'
  | 'zip_failure'

export interface BundleError {
  code: BundleErrorCode
  message: string
  detail?: string
}

export type BundleResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: BundleError }

interface StoreSnapshot {
  projects: Project[]
  drafts: StoredDraft[]
  documents: SourceDocument[]
  revisions: SourceRevision[]
  blobs: SourceBlobRecord[]
  bindings: SourceBinding[]
  events: ChangeEvent[]
  snapshots: AnalysisSnapshot[]
  importSnapshots: ImportSnapshot[]
  migrationBackups: { id: string; projectId: string }[]
  mappingTemplateCount: number
}

function failure(
  code: BundleErrorCode,
  message: string,
  detail?: string,
): { ok: false; error: BundleError } {
  return { ok: false, error: { code, message, ...(detail ? { detail } : {}) } }
}

function mapZipError(error: ZipSafetyError): BundleError {
  return {
    code:
      error.code === 'too_many_entries' ||
      error.code === 'too_large' ||
      error.code === 'unsafe_path' ||
      error.code === 'duplicate_entry'
        ? error.code
        : 'zip_failure',
    message: error.message,
    ...(error.detail ? { detail: error.detail } : {}),
  }
}

function encodeId(value: string): string {
  return encodeURIComponent(value)
}

export function backupPath(
  kind: keyof typeof BACKUP_PATH_PREFIX,
  id: string,
  extension = 'json',
): string {
  return `${BACKUP_PATH_PREFIX[kind]}${encodeId(id)}.${extension}`
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2))
}

function nowIso(): string {
  return new Date().toISOString()
}

function backupFileName(createdAt: string): string {
  const stamp = createdAt.slice(0, 10)
  return `寸链完整备份-${stamp}${BACKUP_FILE_SUFFIX}`
}

/** 同一只读事务读取全部业务 store；Blob 只保留记录，字节稍后读取。 */
async function readAllStores(): Promise<StoreSnapshot> {
  return withDatabase(async (db) => {
    const transaction = db.transaction(
      [
        PROJECT_STORE_NAME,
        DRAFT_STORE_NAME,
        SOURCE_DOCUMENT_STORE_NAME,
        SOURCE_REVISION_STORE_NAME,
        SOURCE_BLOB_STORE_NAME,
        BINDING_STORE_NAME,
        EVENT_STORE_NAME,
        SNAPSHOT_STORE_NAME,
        IMPORT_SNAPSHOT_STORE_NAME,
        MIGRATION_BACKUP_STORE_NAME,
        MAPPING_TEMPLATE_STORE_NAME,
      ],
      'readonly',
    )
    const done = transactionDone(transaction)
    const getAll = async <T>(storeName: string): Promise<T[]> =>
      (await requestResult(transaction.objectStore(storeName).getAll())) as T[]

    const projects = await getAll<Project>(PROJECT_STORE_NAME)
    const drafts = await getAll<StoredDraft>(DRAFT_STORE_NAME)
    const documents = await getAll<SourceDocument>(SOURCE_DOCUMENT_STORE_NAME)
    const revisions = await getAll<SourceRevision>(SOURCE_REVISION_STORE_NAME)
    const blobs = await getAll<SourceBlobRecord>(SOURCE_BLOB_STORE_NAME)
    const bindings = await getAll<SourceBinding>(BINDING_STORE_NAME)
    const events = await getAll<ChangeEvent>(EVENT_STORE_NAME)
    const snapshots = await getAll<AnalysisSnapshot>(SNAPSHOT_STORE_NAME)
    const importSnapshots = await getAll<ImportSnapshot>(
      IMPORT_SNAPSHOT_STORE_NAME,
    )
    const migrationBackups = await getAll<{ id: string; projectId: string }>(
      MIGRATION_BACKUP_STORE_NAME,
    )
    const mappingTemplateCount = await requestResult(
      transaction.objectStore(MAPPING_TEMPLATE_STORE_NAME).count(),
    )
    await done
    return {
      projects,
      drafts,
      documents,
      revisions,
      blobs,
      bindings,
      events,
      snapshots,
      importSnapshots,
      migrationBackups,
      mappingTemplateCount,
    }
  })
}

export interface CreateBundleOptions {
  /** 仅测试注入固定时间。 */
  now?: string
  /**
   * 仅测试注入的最终 ZIP 解压总量上限（默认 150 MiB）。用于验证导出与恢复
   * 使用同一口径：manifest.json 本身也计入总量。
   */
  maxUncompressedBytes?: number
}

/**
 * 生成完整备份。任何一步失败都返回错误，不产生下载文件。
 *
 * 生成前按“解压后总量”预检，避免做出一个自己无法导入/超过规格上限的包。
 */
export async function createProjectBundle(
  options: CreateBundleOptions = {},
): Promise<BundleResult<ProjectBundle>> {
  try {
    const stores = await readAllStores()
    const createdAt = options.now ?? nowIso()

    if (stores.projects.length === 0) {
      return failure('empty_backup', '当前没有项目可备份，未生成空备份文件。')
    }
    const legacy = stores.projects.find(
      (project) => project.schemaVersion !== PROJECT_SCHEMA_VERSION,
    )
    if (legacy !== undefined) {
      return failure(
        'legacy_projects',
        '存在尚未迁移的旧版项目；请先在项目列表完成迁移，再导出完整备份。',
        `未迁移项目：${legacy.id}`,
      )
    }

    const files: { path: string; bytes: Uint8Array; level?: number }[] = []
    const addJson = (path: string, value: unknown): void => {
      files.push({ path, bytes: jsonBytes(value) })
    }

    for (const project of stores.projects) {
      addJson(backupPath('projects', project.id), project)
    }
    for (const draft of stores.drafts) {
      addJson(backupPath('drafts', draft.projectId), draft)
    }
    for (const document of stores.documents) {
      addJson(backupPath('documents', document.id), document)
    }
    for (const revision of stores.revisions) {
      addJson(backupPath('revisions', revision.id), revision)
    }
    for (const blob of stores.blobs) {
      const bytes = new Uint8Array(await blob.blob.arrayBuffer())
      addJson(backupPath('blobs', blob.blobKey), {
        blobKey: blob.blobKey,
        projectId: blob.projectId,
        sha256: blob.sha256,
        byteSize: blob.byteSize,
      })
      files.push({
        path: backupPath('files', blob.blobKey, 'bin'),
        bytes,
        level: 0,
      })
    }
    for (const binding of stores.bindings) {
      addJson(backupPath('bindings', binding.id), binding)
    }
    for (const event of stores.events) {
      addJson(backupPath('events', event.id), event)
    }
    for (const snapshot of stores.snapshots) {
      addJson(backupPath('snapshots', snapshot.id), snapshot)
    }
    for (const snapshot of stores.importSnapshots) {
      addJson(backupPath('importSnapshots', snapshot.id), snapshot)
    }
    for (const backup of stores.migrationBackups) {
      addJson(backupPath('migrationBackups', backup.id), backup)
    }

    // 先排序再计算哈希，保证同内容输入生成稳定的 manifest 顺序。
    files.sort((left, right) => left.path.localeCompare(right.path))

    let totalUncompressedBytes = 0
    const entries: BackupEntryMeta[] = []
    for (const file of files) {
      totalUncompressedBytes += file.bytes.byteLength
      entries.push({
        path: file.path,
        sha256: await sha256Hex(file.bytes),
        byteSize: file.bytes.byteLength,
      })
    }

    // 合法缺附件：revision 保留，但没有对应 Blob 记录/字节。逐条写入 manifest，
    // 恢复时据此接受；绝不伪造空附件，也不删除 revision。
    const blobKeys = new Set(stores.blobs.map((blob) => blob.blobKey))
    const missingAttachments: MissingAttachment[] = stores.revisions
      .filter((revision) => !blobKeys.has(revision.blobKey))
      .map((revision) => ({
        revisionId: revision.id,
        documentId: revision.documentId,
        blobKey: revision.blobKey,
      }))
      .sort((left, right) => left.revisionId.localeCompare(right.revisionId))

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt,
      note:
        '本文件是寸链完整备份：包含项目、草稿、来源附件、版本、绑定、历史事件与分析快照；' +
        '来源文件按原始字节保存，SHA-256 仅用于一致性检查，不代表文件真实性或工程批准。' +
        '缺少附件字节的来源版本在 missingAttachments 中逐条声明，恢复后附件保持不可用。',
      app: {
        databaseVersion: PROJECT_DB_VERSION,
        projectSchemaVersion: PROJECT_SCHEMA_VERSION,
      },
      counts: {
        projects: stores.projects.length,
        drafts: stores.drafts.length,
        documents: stores.documents.length,
        revisions: stores.revisions.length,
        blobs: stores.blobs.length,
        bindings: stores.bindings.length,
        events: stores.events.length,
        snapshots: stores.snapshots.length,
        importSnapshots: stores.importSnapshots.length,
        migrationBackups: stores.migrationBackups.length,
      },
      projects: [...stores.projects]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((project) => ({
          id: project.id,
          name: project.name,
          updatedAt: project.updatedAt,
        })),
      missingAttachments,
      excludes: {
        mappingTemplates: {
          included: false,
          count: stores.mappingTemplateCount,
          note: MAPPING_TEMPLATES_EXCLUDED_NOTE,
        },
      },
      entries,
      totalUncompressedBytes,
    }

    const manifestBytes = jsonBytes(manifest)
    const zipEntries = [{ path: MANIFEST_PATH, bytes: manifestBytes }, ...files]
    // 与恢复端 zip.ts 使用同一口径：manifest.json 也是 ZIP 条目，必须计入
    // 解压总量。否则临近上限时会导出成功、恢复失败。
    const finalZipTotal = zipEntries.reduce(
      (total, entry) => total + entry.bytes.byteLength,
      0,
    )
    const maxUncompressedBytes =
      options.maxUncompressedBytes ?? MAX_BACKUP_UNCOMPRESSED_BYTES
    if (finalZipTotal > maxUncompressedBytes) {
      return failure(
        'too_large',
        `备份 ZIP 解压后总大小 ${finalZipTotal} 字节超过 ${maxUncompressedBytes} 字节上限；请先清理不用的来源版本。`,
        `含 manifest.json ${manifestBytes.byteLength} 字节`,
      )
    }

    const written = await writeZipEntries(zipEntries)
    if (!written.ok) {
      return { ok: false, error: mapZipError(written.error) }
    }

    return {
      ok: true,
      value: {
        bytes: written.value,
        fileName: backupFileName(createdAt),
        manifest,
      },
    }
  } catch (error) {
    return failure(
      'storage_failure',
      '读取本地数据生成完整备份失败，未生成文件。',
      error instanceof Error ? error.message : String(error),
    )
  }
}
