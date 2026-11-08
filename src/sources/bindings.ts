/**
 * 组成环 ↔ 本地 PDF 来源区域绑定（V2.1 第二组）。
 *
 * 契约：
 * - 一条组成环可以保存多个绑定；绑定不唯一、不互相覆盖。
 * - 绑定只记录“哪个不可变 revision、第几页、哪块 PDF 坐标区域、备注”，
 *   不复制基本尺寸/偏差/方向，也不参与 calculateChain。数值仍然只来自
 *   组成环输入；绑定永远不会被当成自动提取的数值来源。
 * - 矩形保存为未旋转 PDF 空间的规范化两对角坐标 [minX, minY, maxX, maxY]，
 *   页面边界保存 page.view 的四元组 [x0, y0, x1, y1]（允许非零原点），
 *   不再假定页面是 [0,0,width,height]；CSS/canvas 像素不进入存储。
 * - 页码、矩形边界与面积在写库前校验；越界或空区域直接拒绝，不写任何记录。
 * - revision 必须真实存在且属于同一项目；绑定与 revision 的检查在同一写事务内。
 * - 绑定与变更事件同事务；解除绑定只删绑定记录，不删除 revision / Blob。
 */
import {
  BINDING_STORE_NAME,
  EVENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
  errorName,
  requestResult,
  transactionDone,
  withDatabase,
} from '../storage/db'
import { addChangeEvent, changeEventId } from '../history/events'
import {
  normalizePdfPageBox,
  normalizePdfRect,
  validatePdfRect,
  type PdfPageBox,
  type PdfRect,
} from './pdfCoordinates'
import type { SourceRevision } from './types'

export interface SourceBinding {
  id: string
  projectId: string
  termId: string
  revisionId: string
  documentId: string
  /** 1 基页码。 */
  page: number
  /** 未旋转 PDF 空间的规范化矩形 [minX, minY, maxX, maxY]。 */
  rectPdf: PdfRect
  /** 页面未旋转时的 page.view 四元组 [x0, y0, x1, y1]，用于复核区域边界。 */
  pageBoxPdf: PdfPageBox
  note: string
  createdAt: string
  /**
   * 核对时该组成环的 termRevision；null 表示尚未核对。
   * 当前环的 termRevision 与它不一致即“数值已变，待重新核对”。
   */
  reviewedTermRevision: number | null
  /** 核对时间 ISO 8601；未核对为 null。 */
  reviewedAt: string | null
}

export interface CreateSourceBindingInput {
  projectId: string
  termId: string
  revisionId: string
  page: number
  rectPdf: PdfRect
  pageBoxPdf: PdfPageBox
  note?: string
}

export type BindingErrorCode =
  | 'invalid_input'
  | 'invalid_region'
  | 'page_out_of_range'
  | 'revision_not_found'
  | 'binding_not_found'
  | 'storage_failure'

export interface BindingError {
  code: BindingErrorCode
  message: string
  detail?: string
}

export type BindingResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: BindingError }

export interface CreateSourceBindingContext {
  now?: () => string
  newId?: () => string
}

/** 与 revisions.ts 保持相同的 ID 生成策略；不引入新依赖。 */
function randomId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  return `binding-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function failure(
  code: BindingErrorCode,
  message: string,
  detail?: string,
): { ok: false; error: BindingError } {
  return { ok: false, error: { code, message, ...(detail ? { detail } : {}) } }
}

/**
 * 纯几何校验：页面边界必须是 page.view 的有效四元组（允许非零/负原点），
 * 矩形必须是有限数值、面积大于 0 且不越出真实页面区间。返回 null 表示合法。
 */
export function validateBindingRegion(
  pageBoxPdf: PdfPageBox,
  rectPdf: PdfRect,
): string | null {
  if (normalizePdfPageBox(pageBoxPdf) === null) {
    return '页面边界无效'
  }
  if (rectPdf.length !== 4) {
    return '矩形坐标必须是 4 个有限数值'
  }
  return validatePdfRect(rectPdf, pageBoxPdf)
}

/** 组成环 → 绑定数量的只读投影；表格用它显示来源标记。 */
export function countBindingsByTerm(
  bindings: readonly SourceBinding[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const binding of bindings) {
    counts[binding.termId] = (counts[binding.termId] ?? 0) + 1
  }
  return counts
}

/**
 * 保存一条来源绑定。
 *
 * 纯几何校验在打开事务之前完成：非法页码/矩形/页面边界直接拒绝，零写入，
 * 不需要为一次只读校验开事务。revision 查询与绑定/事件写入在同一个 readwrite
 * 事务内完成，revision 不存在或页码越界时显式 abort，不留半条绑定；已有绑定
 * 不受影响。
 */
export async function createSourceBinding(
  input: CreateSourceBindingInput,
  context: CreateSourceBindingContext = {},
): Promise<BindingResult<SourceBinding>> {
  const projectId = input.projectId.trim()
  const termId = input.termId.trim()
  const revisionId = input.revisionId.trim()

  if (projectId === '') {
    return failure('invalid_input', '缺少项目 ID，无法保存来源绑定')
  }
  if (termId === '') {
    return failure('invalid_input', '缺少组成环 ID，无法保存来源绑定')
  }
  if (revisionId === '') {
    return failure('invalid_input', '缺少来源版本 ID，无法保存来源绑定')
  }
  if (!Number.isInteger(input.page) || input.page < 1) {
    return failure('invalid_input', '页码必须是大于等于 1 的整数')
  }

  const regionError = validateBindingRegion(input.pageBoxPdf, input.rectPdf)
  if (regionError !== null) {
    return failure('invalid_region', regionError)
  }
  const pageBox = normalizePdfPageBox(input.pageBoxPdf)
  if (pageBox === null) {
    return failure('invalid_region', '页面边界无效')
  }

  const now = context.now ?? (() => new Date().toISOString())
  const newId = context.newId ?? randomId
  const note = input.note?.trim() ?? ''

  try {
    return await withDatabase(async (db) => {
      const transaction = db.transaction(
        [SOURCE_REVISION_STORE_NAME, BINDING_STORE_NAME, EVENT_STORE_NAME],
        'readwrite',
      )
      const done = transactionDone(transaction)
      try {
        const revision = (await requestResult(
          transaction.objectStore(SOURCE_REVISION_STORE_NAME).get(revisionId),
        )) as SourceRevision | undefined

        if (revision === undefined || revision.projectId !== projectId) {
          transaction.abort()
          await done.catch(() => undefined)
          return failure('revision_not_found', '来源版本不存在，未保存绑定')
        }
        if (input.page > revision.pageCount) {
          transaction.abort()
          await done.catch(() => undefined)
          return failure(
            'page_out_of_range',
            `页码超出范围：该版本共 ${revision.pageCount} 页`,
          )
        }

        const binding: SourceBinding = {
          id: newId(),
          projectId,
          termId,
          revisionId,
          documentId: revision.documentId,
          page: input.page,
          rectPdf: normalizePdfRect(input.rectPdf),
          pageBoxPdf: [pageBox[0], pageBox[1], pageBox[2], pageBox[3]],
          note,
          createdAt: now(),
          // 新建绑定尚未经过用户对照当前数值的显式核对。
          reviewedTermRevision: null,
          reviewedAt: null,
        }

        await requestResult(transaction.objectStore(BINDING_STORE_NAME).add(binding))
        await requestResult(
          addChangeEvent(transaction, {
            id: changeEventId('source_binding_added', binding.id),
            projectId,
            type: 'source_binding_added',
            createdAt: binding.createdAt,
            documentId: binding.documentId,
            revisionId: binding.revisionId,
            bindingId: binding.id,
            termId: binding.termId,
          }),
        )
        await done
        return { ok: true as const, value: binding }
      } catch (error) {
        try {
          transaction.abort()
        } catch {
          // 事务可能已经结束，保留原始错误。
        }
        await done.catch(() => undefined)
        throw error
      }
    })
  } catch (error) {
    if (errorName(error) === 'ConstraintError') {
      return failure('storage_failure', '绑定 ID 冲突，未保存任何数据')
    }
    return failure(
      'storage_failure',
      '保存来源绑定失败，现有绑定未改变',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export async function getSourceBinding(
  id: string,
): Promise<BindingResult<SourceBinding | null>> {
  try {
    const binding = await withDatabase(async (db) => {
      const transaction = db.transaction(BINDING_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction.objectStore(BINDING_STORE_NAME).get(id),
      )
      await done
      return value as SourceBinding | undefined
    })
    return { ok: true, value: binding ?? null }
  } catch (error) {
    return failure(
      'storage_failure',
      '读取来源绑定失败',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export async function listSourceBindings(
  projectId: string,
): Promise<BindingResult<SourceBinding[]>> {
  try {
    const bindings = await withDatabase(async (db) => {
      const transaction = db.transaction(BINDING_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction.objectStore(BINDING_STORE_NAME).index('projectId').getAll(projectId),
      )
      await done
      return value as SourceBinding[]
    })
    bindings.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    )
    return { ok: true, value: bindings }
  } catch (error) {
    return failure(
      'storage_failure',
      '读取来源绑定列表失败',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export async function listSourceBindingsForTerm(
  projectId: string,
  termId: string,
): Promise<BindingResult<SourceBinding[]>> {
  const listed = await listSourceBindings(projectId)
  if (!listed.ok) {
    return listed
  }
  return {
    ok: true,
    value: listed.value.filter((binding) => binding.termId === termId),
  }
}

/**
 * 解除一条来源绑定：只删除绑定记录并记录事件，不删除 revision、文档或 Blob。
 * Blob 字节仍可按 blobKey 读回，避免“解除绑定 = 获准删除原始资料”。
 */
export async function removeSourceBinding(
  id: string,
): Promise<BindingResult<boolean>> {
  if (id.trim() === '') {
    return failure('invalid_input', '缺少绑定 ID，无法解除绑定')
  }

  try {
    return await withDatabase(async (db) => {
      const transaction = db.transaction(
        [BINDING_STORE_NAME, EVENT_STORE_NAME],
        'readwrite',
      )
      const done = transactionDone(transaction)
      try {
        const store = transaction.objectStore(BINDING_STORE_NAME)
        const existing = (await requestResult(store.get(id))) as
          | SourceBinding
          | undefined
        if (existing === undefined) {
          await done
          return { ok: true as const, value: false }
        }

        store.delete(id)
        const removedAt = new Date().toISOString()
        await requestResult(
          addChangeEvent(transaction, {
            id: changeEventId('source_binding_removed', `${id}:${removedAt}`),
            projectId: existing.projectId,
            type: 'source_binding_removed',
            createdAt: removedAt,
            documentId: existing.documentId,
            revisionId: existing.revisionId,
            bindingId: existing.id,
            termId: existing.termId,
          }),
        )
        await done
        return { ok: true as const, value: true }
      } catch (error) {
        try {
          transaction.abort()
        } catch {
          // 事务可能已经结束，保留原始错误。
        }
        await done.catch(() => undefined)
        throw error
      }
    })
  } catch (error) {
    return failure(
      'storage_failure',
      '解除来源绑定失败，绑定记录未改变',
      error instanceof Error ? error.message : String(error),
    )
  }
}

/* -------------------------------------------------------------------------- */
/* 核对凭据与失效                                                             */
/* -------------------------------------------------------------------------- */

export interface ReviewSourceBindingInput {
  /** 用户核对时看到的该环修订号。 */
  termRevision: number
  reviewedAt?: string
}

/**
 * 记录一次显式核对：把当前组成环的 termRevision 写入绑定。
 *
 * 只写绑定记录与事件，不修改数值、区域或来源版本。之后任何数值/方向变化
 * 都会让 termRevision 递增，使这条凭据自动失效（派生判定，不写回绑定）。
 */
export async function reviewSourceBinding(
  id: string,
  input: ReviewSourceBindingInput,
  context: CreateSourceBindingContext = {},
): Promise<BindingResult<SourceBinding>> {
  if (!Number.isSafeInteger(input.termRevision) || input.termRevision < 1) {
    return failure('invalid_input', '核对修订号必须是大于等于 1 的整数')
  }
  const now = context.now ?? (() => new Date().toISOString())
  const reviewedAt = input.reviewedAt ?? now()

  try {
    return await withDatabase(async (db) => {
      const transaction = db.transaction(
        [BINDING_STORE_NAME, EVENT_STORE_NAME],
        'readwrite',
      )
      const done = transactionDone(transaction)
      try {
        const store = transaction.objectStore(BINDING_STORE_NAME)
        const existing = (await requestResult(store.get(id))) as
          | SourceBinding
          | undefined
        if (existing === undefined) {
          await done
          return failure('binding_not_found', '来源绑定不存在，未记录核对')
        }

        const updated: SourceBinding = {
          ...existing,
          reviewedTermRevision: input.termRevision,
          reviewedAt,
        }
        store.put(updated)
        await requestResult(
          addChangeEvent(transaction, {
            id: changeEventId('source_binding_reviewed', `${id}:${reviewedAt}`),
            projectId: existing.projectId,
            type: 'source_binding_reviewed',
            createdAt: reviewedAt,
            documentId: existing.documentId,
            revisionId: existing.revisionId,
            bindingId: existing.id,
            termId: existing.termId,
            message: `已核对来源区域与组成环修订 ${input.termRevision}`,
          }),
        )
        await done
        return { ok: true as const, value: updated }
      } catch (error) {
        try {
          transaction.abort()
        } catch {
          // 事务可能已结束，保留原始错误。
        }
        await done.catch(() => undefined)
        throw error
      }
    })
  } catch (error) {
    return failure(
      'storage_failure',
      '记录来源核对失败，绑定未改变',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export interface UpdateSourceBindingRegionInput {
  page?: number
  rectPdf?: PdfRect
  pageBoxPdf?: PdfPageBox
  note?: string
}

/**
 * 修改绑定的区域/页码/备注。
 *
 * 区域或页码实际变化时清除该绑定的核对凭据（不自动恢复）；只改备注时保留。
 * 数值与组成环不受影响，其他绑定也不受影响。
 */
export async function updateSourceBindingRegion(
  id: string,
  input: UpdateSourceBindingRegionInput,
  context: CreateSourceBindingContext = {},
): Promise<BindingResult<SourceBinding>> {
  const now = context.now ?? (() => new Date().toISOString())

  try {
    return await withDatabase(async (db) => {
      const transaction = db.transaction(
        [BINDING_STORE_NAME, SOURCE_REVISION_STORE_NAME, EVENT_STORE_NAME],
        'readwrite',
      )
      const done = transactionDone(transaction)
      try {
        const store = transaction.objectStore(BINDING_STORE_NAME)
        const existing = (await requestResult(store.get(id))) as
          | SourceBinding
          | undefined
        if (existing === undefined) {
          await done
          return failure('binding_not_found', '来源绑定不存在，未修改区域')
        }

        const page = input.page ?? existing.page
        if (!Number.isInteger(page) || page < 1) {
          await done.catch(() => undefined)
          return failure('invalid_input', '页码必须是大于等于 1 的整数')
        }
        const revision = (await requestResult(
          transaction.objectStore(SOURCE_REVISION_STORE_NAME).get(existing.revisionId),
        )) as SourceRevision | undefined
        if (revision === undefined || revision.projectId !== existing.projectId) {
          await done.catch(() => undefined)
          return failure('revision_not_found', '绑定引用的来源版本不存在，未修改区域')
        }
        if (page > revision.pageCount) {
          await done.catch(() => undefined)
          return failure('page_out_of_range', `页码超出范围：该版本共 ${revision.pageCount} 页`)
        }

        const rectPdf = input.rectPdf === undefined ? existing.rectPdf : normalizePdfRect(input.rectPdf)
        const pageBoxPdf =
          input.pageBoxPdf === undefined ? existing.pageBoxPdf : input.pageBoxPdf
        if (input.rectPdf !== undefined || input.pageBoxPdf !== undefined) {
          const regionError = validateBindingRegion(pageBoxPdf, rectPdf)
          if (regionError !== null) {
            await done.catch(() => undefined)
            return failure('invalid_region', regionError)
          }
        }
        const note = input.note === undefined ? existing.note : input.note.trim()

        const geometryChanged =
          page !== existing.page ||
          rectPdf.some((value, index) => value !== existing.rectPdf[index]) ||
          pageBoxPdf.some((value, index) => value !== existing.pageBoxPdf[index])

        const updated: SourceBinding = {
          ...existing,
          page,
          rectPdf,
          pageBoxPdf,
          note,
          // 改区域/页码 → 该绑定核对失效，其他绑定不受影响；改备注不清核对。
          reviewedTermRevision: geometryChanged ? null : existing.reviewedTermRevision,
          reviewedAt: geometryChanged ? null : existing.reviewedAt,
        }
        store.put(updated)
        if (geometryChanged) {
          await requestResult(
            addChangeEvent(transaction, {
              id: changeEventId('source_binding_region_changed', `${id}:${now()}`),
              projectId: existing.projectId,
              type: 'source_binding_region_changed',
              createdAt: now(),
              documentId: existing.documentId,
              revisionId: existing.revisionId,
              bindingId: existing.id,
              termId: existing.termId,
              message: '绑定区域已修改；该绑定的来源核对已失效，需要重新核对。',
            }),
          )
        }
        await done
        return { ok: true as const, value: updated }
      } catch (error) {
        try {
          transaction.abort()
        } catch {
          // 事务可能已结束，保留原始错误。
        }
        await done.catch(() => undefined)
        throw error
      }
    })
  } catch (error) {
    return failure(
      'storage_failure',
      '修改绑定区域失败，绑定未改变',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export interface RebindSourceBindingInput {
  revisionId: string
  page: number
  rectPdf: PdfRect
  pageBoxPdf: PdfPageBox
  note?: string
}

/**
 * 换关联来源：把绑定指向另一个 revision / 区域。
 *
 * 只改绑定引用与几何，不改组成环数值；该绑定的核对凭据清除，其他绑定不变。
 */
export async function rebindSourceBinding(
  id: string,
  input: RebindSourceBindingInput,
  context: CreateSourceBindingContext = {},
): Promise<BindingResult<SourceBinding>> {
  const revisionId = input.revisionId.trim()
  if (revisionId === '') {
    return failure('invalid_input', '缺少来源版本 ID，无法更换绑定')
  }
  if (!Number.isInteger(input.page) || input.page < 1) {
    return failure('invalid_input', '页码必须是大于等于 1 的整数')
  }
  const regionError = validateBindingRegion(input.pageBoxPdf, input.rectPdf)
  if (regionError !== null) {
    return failure('invalid_region', regionError)
  }
  const pageBox = normalizePdfPageBox(input.pageBoxPdf)
  if (pageBox === null) {
    return failure('invalid_region', '页面边界无效')
  }
  const now = context.now ?? (() => new Date().toISOString())

  try {
    return await withDatabase(async (db) => {
      const transaction = db.transaction(
        [BINDING_STORE_NAME, SOURCE_REVISION_STORE_NAME, EVENT_STORE_NAME],
        'readwrite',
      )
      const done = transactionDone(transaction)
      try {
        const store = transaction.objectStore(BINDING_STORE_NAME)
        const existing = (await requestResult(store.get(id))) as
          | SourceBinding
          | undefined
        if (existing === undefined) {
          await done
          return failure('binding_not_found', '来源绑定不存在，未更换来源')
        }
        const revision = (await requestResult(
          transaction.objectStore(SOURCE_REVISION_STORE_NAME).get(revisionId),
        )) as SourceRevision | undefined
        if (revision === undefined || revision.projectId !== existing.projectId) {
          await done.catch(() => undefined)
          return failure('revision_not_found', '来源版本不存在，未更换绑定')
        }
        if (input.page > revision.pageCount) {
          await done.catch(() => undefined)
          return failure(
            'page_out_of_range',
            `页码超出范围：该版本共 ${revision.pageCount} 页`,
          )
        }

        const updated: SourceBinding = {
          ...existing,
          revisionId,
          documentId: revision.documentId,
          page: input.page,
          rectPdf: normalizePdfRect(input.rectPdf),
          pageBoxPdf: [pageBox[0], pageBox[1], pageBox[2], pageBox[3]],
          note: input.note === undefined ? existing.note : input.note.trim(),
          // 换关联来源 → 该绑定核对失效。
          reviewedTermRevision: null,
          reviewedAt: null,
        }
        store.put(updated)
        await requestResult(
          addChangeEvent(transaction, {
            id: changeEventId('source_binding_rebound', `${id}:${now()}`),
            projectId: existing.projectId,
            type: 'source_binding_rebound',
            createdAt: now(),
            documentId: revision.documentId,
            revisionId,
            bindingId: existing.id,
            termId: existing.termId,
            message: '绑定已更换关联来源；该绑定的来源核对已失效，需要重新核对。',
          }),
        )
        await done
        return { ok: true as const, value: updated }
      } catch (error) {
        try {
          transaction.abort()
        } catch {
          // 事务可能已结束，保留原始错误。
        }
        await done.catch(() => undefined)
        throw error
      }
    })
  } catch (error) {
    return failure(
      'storage_failure',
      '更换绑定来源失败，绑定未改变',
      error instanceof Error ? error.message : String(error),
    )
  }
}
