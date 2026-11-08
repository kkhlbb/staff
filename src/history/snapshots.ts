/**
 * 不可变分析快照（V2.2 C 组，规格 §7 / §8）。
 *
 * 契约：
 * - 快照在创建时冻结一致输入：当前草稿、关系确认凭据、基线、来源文档/版本/
 *   绑定/附件可用性、计算结果与统一审查结果；创建后不重算、不覆盖。
 * - 数据库层只提供 add() 写入（重复 ID 直接失败），不提供更新函数；内存对象
 *   递归冻结，调用方无法原地修改后继续使用。
 * - 报告只从 snapshotId 读取快照，不再读取工作台实时数据；工作数据变化后旧
 *   快照由列表派生为“历史”，但快照内容与规则版本保持原样。
 * - 快照审查结果必须来自 review/rules.ts 的 evaluateReviewChecklist；工作台、
 *   快照与报告共用同一套规则，不在本模块另写判定。
 */
import { calculateChain, ENGINE_VERSION } from '../domain/calculate'
import { compareChains, type Diff } from '../domain/compare'
import type { ChainDefinition, ChainResult, Project } from '../domain/types'
import { addChangeEvent, changeEventId } from '../history/events'
import {
  REVIEW_RULE_IDS,
  REVIEW_RULES_VERSION,
  evaluateReviewChecklist,
  type ReviewFinding,
  type ReviewStatus,
  type ReviewSummary,
} from '../review/rules'
import { sha256Hex } from '../sources/hash'
import type { HistoricalAcceptance, SourceBinding } from '../sources/bindings'
import type { PdfPageBox, PdfRect } from '../sources/pdfCoordinates'
import type { SourceDocument, SourceRevision } from '../sources/types'
import {
  BINDING_STORE_NAME,
  DRAFT_STORE_NAME,
  EVENT_STORE_NAME,
  PROJECT_STORE_NAME,
  SNAPSHOT_STORE_NAME,
  SOURCE_BLOB_STORE_NAME,
  SOURCE_DOCUMENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
  errorName,
  requestResult,
  transactionDone,
  withDatabase,
} from '../storage/db'
import {
  chainToDraft,
  draftToChain,
  type WorkspaceDraft,
} from '../workspace/draft'
import {
  isRelationConfirmed,
  isRelationReviewStale,
  type RelationState,
} from '../workspace/relation'

export const SNAPSHOT_ID_PREFIX = 'snapshot-'

/** 快照创建时的审查结论；之后不随工作台变化。 */
export type SnapshotReviewState = 'complete' | 'pending'

export interface SnapshotBindingStatus {
  available: ReviewStatus
  current: ReviewStatus
  valueReviewed: ReviewStatus
}

/** 来源清单中的一条绑定：版本、页码、区域与冻结的规则状态。 */
export interface SnapshotBindingEntry {
  bindingId: string
  termId: string
  /** 创建快照时的代号/名称；组成环已被删除时为 null。 */
  termLabel: string | null
  termRevision: number | null
  documentId: string
  documentTitle: string | null
  revisionId: string
  fileName: string | null
  revisionSha256: string | null
  revisionByteSize: number | null
  revisionPageCount: number | null
  page: number
  rectPdf: PdfRect
  pageBoxPdf: PdfPageBox
  note: string
  reviewedTermRevision: number | null
  reviewedAt: string | null
  historicalAcceptance: HistoricalAcceptance | null
  /** 创建快照时本地是否真的持有该版本附件。 */
  blobAvailable: boolean
  status: SnapshotBindingStatus
}

export interface SnapshotSourceManifest {
  documents: SourceDocument[]
  revisions: SourceRevision[]
  bindings: SnapshotBindingEntry[]
  /** 没有任何来源绑定的组成环；报告必须显示“来源未检查”。 */
  unboundTermIds: string[]
  /** 全部引用附件都可用才为 complete；没有绑定时为 complete，但 unbound 非空。 */
  availability: 'complete' | 'partial'
}

/**
 * 创建快照时冻结的基线对比结果。
 *
 * 不可变契约要求报告只展示、不计算：基线侧结果与 compareChains 的完整 Diff
 * 都在创建时冻结，报告不再调用 compareChains。这样引擎升级后，旧报告的主结果
 * 与基线对比仍然来自同一版引擎，页面上的 engineVersion 不会说谎。
 */
export interface SnapshotComparison {
  /** 基线定义在创建时由同一版引擎计算出的结果。 */
  baselineResult: ChainResult
  /** 基线 → 工作方案的完整差异（含前后值、变化量与判定）。 */
  diff: Diff
}

export interface AnalysisSnapshot {
  id: string
  projectId: string
  projectName: string
  /** ISO 8601。 */
  createdAt: string
  engineVersion: string
  reviewRulesVersion: string
  /**
   * 输入指纹：名称、基线、草稿、关系凭据与来源元数据的稳定摘要。
   * 只用于列表派生“当前/历史”，不参与计算，不是签名或工程批准。
   */
  inputFingerprint: string
  definition: ChainDefinition
  draft: WorkspaceDraft
  result: ChainResult
  review: ReviewSummary
  sourceManifest: SnapshotSourceManifest
  baseline: Project['baseline']
  /** 基线对比的冻结结果；没有基线时为 null。旧版快照可能没有该字段。 */
  comparison?: SnapshotComparison | null
  /** 创建时冻结的审查状态；pending 表示报告带待办，不能标为已完成复核。 */
  status: SnapshotReviewState
  pendingCount: number
}

export interface SnapshotListItem {
  snapshot: AnalysisSnapshot
  historical: boolean
  historicalReason: string | null
}

export interface SnapshotError {
  code:
    | 'project_not_found'
    | 'invalid_draft'
    | 'snapshot_exists'
    | 'not_found'
    | 'storage_failure'
  message: string
  detail?: string
}

export type SnapshotResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SnapshotError }

export interface SnapshotSourceState {
  documents: SourceDocument[]
  revisions: SourceRevision[]
  bindings: SourceBinding[]
  availableBlobKeys: ReadonlySet<string>
}

export interface CreateSnapshotInput {
  /** 工作台当前项目元数据（id/name/engine/baseline 的兜底值）。 */
  project: Project
  /** 内存中的当前草稿；不等自动保存，避免快照落后于界面。 */
  draft: WorkspaceDraft
  /** 当前关系修订号与确认凭据（来自 usePersistedWorkspace 的派生状态）。 */
  relationState: RelationState
  /** 当前基线；未传时使用 project.baseline。 */
  baseline?: Project['baseline']
  /** 仅测试注入。 */
  now?: string
  id?: string
  /**
   * 仅测试注入：在最终写事务开始前调用，用于复现“检查项目存在之后、
   * 写入快照之前项目被删除”的竞态。生产调用不传。
   */
  beforeFinalWrite?: () => Promise<void>
}

function failure(
  code: SnapshotError['code'],
  message: string,
  detail?: string,
): { ok: false; error: SnapshotError } {
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
    return `${SNAPSHOT_ID_PREFIX}${cryptoApi.randomUUID()}`
  }
  return `${SNAPSHOT_ID_PREFIX}${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/** 递归冻结快照；共享引用只处理一次，避免 pending/groups 重复递归。 */
export function deepFreezeSnapshot<T>(value: T): T {
  const seen = new WeakSet<object>()
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') {
      return
    }
    if (seen.has(node)) {
      return
    }
    seen.add(node)
    for (const key of Object.keys(node)) {
      walk((node as Record<string, unknown>)[key])
    }
    Object.freeze(node)
  }
  walk(value)
  return value
}

function termLabel(term: WorkspaceDraft['terms'][number]): string {
  const symbol = term.symbol.trim()
  if (symbol !== '') {
    return symbol
  }
  const name = term.name.trim()
  return name !== '' ? name : term.id
}

function findingFor(
  review: ReviewSummary,
  ruleId: (typeof REVIEW_RULE_IDS)[number],
  bindingId: string,
): ReviewFinding | undefined {
  return review.findings.find(
    (finding) =>
      finding.ruleId === ruleId &&
      finding.subject.kind === 'binding' &&
      finding.subject.bindingId === bindingId,
  )
}

function statusOf(finding: ReviewFinding | undefined): ReviewStatus {
  return finding?.status ?? 'not-applicable'
}

function buildSourceManifest(
  draft: WorkspaceDraft,
  review: ReviewSummary,
  sources: SnapshotSourceState,
): SnapshotSourceManifest {
  const documents = [...sources.documents].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
  const revisions = [...sources.revisions].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
  const documentById = new Map(documents.map((document) => [document.id, document]))
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]))
  const termById = new Map(draft.terms.map((term) => [term.id, term]))
  const bindings = [...sources.bindings].sort((left, right) =>
    left.id.localeCompare(right.id),
  )

  const toEntry = (binding: SourceBinding): SnapshotBindingEntry => {
    const revision = revisionById.get(binding.revisionId) ?? null
    const document = documentById.get(binding.documentId) ?? null
    const term = termById.get(binding.termId) ?? null
    return {
      bindingId: binding.id,
      termId: binding.termId,
      termLabel: term === null ? null : termLabel(term),
      termRevision: term?.termRevision ?? null,
      documentId: binding.documentId,
      documentTitle: document?.title ?? null,
      revisionId: binding.revisionId,
      fileName: revision?.fileName ?? null,
      revisionSha256: revision?.sha256 ?? null,
      revisionByteSize: revision?.byteSize ?? null,
      revisionPageCount: revision?.pageCount ?? null,
      page: binding.page,
      rectPdf: [...binding.rectPdf] as PdfRect,
      pageBoxPdf: [...binding.pageBoxPdf] as PdfPageBox,
      note: binding.note,
      reviewedTermRevision: binding.reviewedTermRevision,
      reviewedAt: binding.reviewedAt,
      historicalAcceptance: binding.historicalAcceptance
        ? { ...binding.historicalAcceptance }
        : null,
      blobAvailable:
        revision !== null && sources.availableBlobKeys.has(revision.blobKey),
      status: {
        available: statusOf(findingFor(review, 'SOURCE_AVAILABLE', binding.id)),
        current: statusOf(findingFor(review, 'SOURCE_CURRENT', binding.id)),
        valueReviewed: statusOf(
          findingFor(review, 'SOURCE_VALUE_REVIEWED', binding.id),
        ),
      },
    }
  }

  // 报告按组成环顺序排列；找不到组成环的绑定放在最后，避免静默丢弃。
  const ordered: SnapshotBindingEntry[] = []
  for (const term of draft.terms) {
    for (const binding of bindings.filter((item) => item.termId === term.id)) {
      ordered.push(toEntry(binding))
    }
  }
  const knownTermIds = new Set(draft.terms.map((term) => term.id))
  for (const binding of bindings) {
    if (!knownTermIds.has(binding.termId)) {
      ordered.push(toEntry(binding))
    }
  }

  const unboundTermIds = draft.terms
    .filter(
      (term) =>
        !bindings.some((binding) => binding.termId === term.id),
    )
    .map((term) => term.id)

  const availability =
    ordered.length > 0 && ordered.some((entry) => !entry.blobAvailable)
      ? 'partial'
      : 'complete'

  return deepFreezeSnapshot({
    documents,
    revisions,
    bindings: ordered,
    unboundTermIds,
    availability,
  })
}

function canonicalFingerprintInput(input: {
  projectName: string
  baseline: Project['baseline']
  draft: WorkspaceDraft
  relationRevision: number
  relationReview: RelationState['relationReview']
  sources: SnapshotSourceState
}): string {
  const sortById = <T extends { id: string }>(items: readonly T[]): T[] =>
    [...items].sort((left, right) => left.id.localeCompare(right.id))
  return JSON.stringify({
    projectName: input.projectName,
    baseline: input.baseline,
    draft: input.draft,
    relationRevision: input.relationRevision,
    relationReview: input.relationReview,
    documents: sortById(input.sources.documents),
    revisions: sortById(input.sources.revisions),
    bindings: sortById(input.sources.bindings),
    blobKeys: [...input.sources.availableBlobKeys].sort(),
  })
}

async function fingerprint(input: Parameters<typeof canonicalFingerprintInput>[0]) {
  const canonical = canonicalFingerprintInput(input)
  return sha256Hex(new TextEncoder().encode(canonical))
}

interface ReadSnapshotState {
  project: Project
  draft: WorkspaceDraft
  sources: SnapshotSourceState
}

/**
 * 在一个只读事务里读取项目、草稿、来源文档/版本/绑定与附件键，得到一致视图。
 * 不读 Blob 字节，避免把大文件读进事务。
 */
async function readSnapshotState(
  db: IDBDatabase,
  projectId: string,
): Promise<ReadSnapshotState | null> {
  const transaction = db.transaction(
    [
      PROJECT_STORE_NAME,
      DRAFT_STORE_NAME,
      SOURCE_DOCUMENT_STORE_NAME,
      SOURCE_REVISION_STORE_NAME,
      SOURCE_BLOB_STORE_NAME,
      BINDING_STORE_NAME,
    ],
    'readonly',
  )
  const done = transactionDone(transaction)
  try {
    const project = (await requestResult(
      transaction.objectStore(PROJECT_STORE_NAME).get(projectId),
    )) as Project | undefined
    if (project === undefined) {
      await done
      return null
    }
    const draftRecord = (await requestResult(
      transaction.objectStore(DRAFT_STORE_NAME).get(projectId),
    )) as { draft: WorkspaceDraft } | undefined
    const documents = (await requestResult(
      transaction
        .objectStore(SOURCE_DOCUMENT_STORE_NAME)
        .index('projectId')
        .getAll(projectId),
    )) as SourceDocument[]
    const revisions = (await requestResult(
      transaction
        .objectStore(SOURCE_REVISION_STORE_NAME)
        .index('projectId')
        .getAll(projectId),
    )) as SourceRevision[]
    const bindings = (await requestResult(
      transaction.objectStore(BINDING_STORE_NAME).index('projectId').getAll(projectId),
    )) as SourceBinding[]
    const blobKeys = (await requestResult(
      transaction
        .objectStore(SOURCE_BLOB_STORE_NAME)
        .index('projectId')
        .getAllKeys(projectId),
    )) as IDBValidKey[]
    await done
    return {
      project,
      draft: draftRecord?.draft ?? chainToDraft(project.working),
      sources: {
        documents,
        revisions,
        bindings,
        availableBlobKeys: new Set(blobKeys.map((key) => String(key))),
      },
    }
  } catch (error) {
    await done.catch(() => undefined)
    throw error
  }
}

/**
 * 用工作台当前状态创建不可变快照。
 *
 * 计算链与审查结果都在这里由共享模块重新推导，调用方不能塞入自定义结果；
 * 来源元数据在一个只读事务中读取，保证快照内部一致。
 */
export async function createAnalysisSnapshot(
  input: CreateSnapshotInput,
): Promise<SnapshotResult<AnalysisSnapshot>> {
  const conversion = draftToChain(input.draft)
  if (!conversion.ok) {
    return failure(
      'invalid_draft',
      '当前输入未通过校验，不能创建分析快照；请先修正输入。',
    )
  }
  const chain = conversion.chain
  const result = calculateChain(chain)

  try {
    return await withDatabase(async (db) => {
      const state = await readSnapshotState(db, input.project.id)
      if (state === null) {
        return failure('project_not_found', '项目不存在，无法创建分析快照。')
      }

      const relationRevision = Math.max(
        input.relationState.relationRevision,
        input.draft.relationRevision,
      )
      const relationConfirmed = isRelationConfirmed(chain, {
        relationRevision,
        relationReview: input.relationState.relationReview,
      })
      const relationReviewStale = isRelationReviewStale(chain, {
        relationRevision,
        relationReview: input.relationState.relationReview,
      })
      const review = evaluateReviewChecklist({
        chain,
        result,
        relationConfirmed,
        relationReviewStale,
        relationRevision,
        terms: input.draft.terms.map((term) => ({
          id: term.id,
          symbol: term.symbol,
          name: term.name,
          termRevision: term.termRevision,
        })),
        bindings: state.sources.bindings,
        documents: state.sources.documents,
        revisions: state.sources.revisions,
        availableBlobKeys: state.sources.availableBlobKeys,
      })

      const baseline =
        input.baseline !== undefined ? input.baseline : state.project.baseline
      const inputFingerprint = await fingerprint({
        projectName: input.project.name,
        baseline,
        draft: input.draft,
        relationRevision,
        relationReview: input.relationState.relationReview,
        sources: state.sources,
      })

      // 基线对比与基线侧结果都在这里冻结，报告只读不重算。compareChains 与
      // calculateChain 同属当前引擎版本；快照里的 engineVersion 因此对两侧都成立。
      const comparison: SnapshotComparison | null =
        baseline === null
          ? null
          : {
              baselineResult: calculateChain(baseline.definition),
              diff: compareChains(baseline.definition, chain),
            }

      // 仅测试注入：给竞态用例一个确定的“删除发生在检查之后、写入之前”窗口。
      if (input.beforeFinalWrite !== undefined) {
        await input.beforeFinalWrite()
      }

      const snapshot: AnalysisSnapshot = deepFreezeSnapshot({
        id: input.id ?? randomId(),
        projectId: input.project.id,
        projectName: input.project.name,
        createdAt: input.now ?? nowIso(),
        engineVersion: ENGINE_VERSION,
        reviewRulesVersion: REVIEW_RULES_VERSION,
        inputFingerprint,
        definition: chain,
        draft: input.draft,
        result,
        review,
        sourceManifest: buildSourceManifest(input.draft, review, state.sources),
        baseline,
        comparison,
        status: review.reviewComplete ? 'complete' : 'pending',
        pendingCount: review.pending.length,
      })

      const transaction = db.transaction(
        [SNAPSHOT_STORE_NAME, EVENT_STORE_NAME, PROJECT_STORE_NAME],
        'readwrite',
      )
      const done = transactionDone(transaction)
      let addRequest: IDBRequest<IDBValidKey> | null = null
      try {
        // 最终事务纳入 projects store 并在事务内复查：若项目在读取状态之后被
        // 删除，这里必须失败，不能留下孤儿快照和创建事件。IndexedDB 会让包含
        // 同一 store 的读写事务串行化，因此该复查与 deleteProject 不会交错。
        const projectNow = (await requestResult(
          transaction.objectStore(PROJECT_STORE_NAME).get(input.project.id),
        )) as Project | undefined
        if (projectNow === undefined) {
          await done
          return failure(
            'project_not_found',
            '项目已被删除，未创建分析快照，也没有写入创建事件。',
          )
        }
        const snapshotStore = transaction.objectStore(SNAPSHOT_STORE_NAME)
        // 先查再 add：add 的 ConstraintError 会让事务 abort 并丢失具体错误名，
        // 这里显式返回“不可覆盖”，add 本身仍作为并发下的最后防线。
        const existing = await requestResult(snapshotStore.get(snapshot.id))
        if (existing !== undefined) {
          await done
          return failure(
            'snapshot_exists',
            '快照 ID 已存在；快照不可覆盖，请重新创建。',
          )
        }
        // add() 而不是 put()：同一 ID 只能成功一次，存储层也不允许覆盖历史。
        addRequest = snapshotStore.add(snapshot)
        addChangeEvent(transaction, {
          id: changeEventId('analysis_snapshot_created', snapshot.id),
          projectId: snapshot.projectId,
          type: 'analysis_snapshot_created',
          createdAt: snapshot.createdAt,
          message: `已创建分析快照 ${snapshot.id}；审查状态：${
            snapshot.status === 'complete' ? '完成' : `未完成（${snapshot.pendingCount} 项待办）`
          }。`,
        })
        await done
        return { ok: true as const, value: snapshot }
      } catch (error) {
        try {
          transaction.abort()
        } catch {
          // 事务可能已结束。
        }
        await done.catch(() => undefined)
        const name = errorName(error) ?? errorName(addRequest?.error)
        if (name === 'ConstraintError') {
          return failure(
            'snapshot_exists',
            '快照 ID 已存在；快照不可覆盖，请重新创建。',
          )
        }
        throw error
      }
    })
  } catch (error) {
    return storageFailure(error, '创建分析快照失败，未写入任何快照。')
  }
}

export async function getAnalysisSnapshot(
  snapshotId: string,
): Promise<SnapshotResult<AnalysisSnapshot | null>> {
  try {
    const snapshot = await withDatabase(async (db) => {
      const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction.objectStore(SNAPSHOT_STORE_NAME).get(snapshotId),
      )
      await done
      return value as AnalysisSnapshot | undefined
    })
    return {
      ok: true,
      value: snapshot === undefined ? null : deepFreezeSnapshot(snapshot),
    }
  } catch (error) {
    return storageFailure(error, '读取分析快照失败。')
  }
}

/**
 * 列出项目快照，并派生“当前/历史”。
 *
 * 只有内容指纹仍等于当前工作数据、且是最新匹配快照时才标为当前；其余标为
 * 历史。这里只比较指纹，不重算快照结果，也不改写任何快照记录。
 */
export async function listAnalysisSnapshots(
  projectId: string,
): Promise<SnapshotResult<SnapshotListItem[]>> {
  try {
    return await withDatabase(async (db) => {
      const state = await readSnapshotState(db, projectId)
      if (state === null) {
        return failure('project_not_found', '项目不存在，无法读取分析快照。')
      }
      const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const stored = (await requestResult(
        transaction
          .objectStore(SNAPSHOT_STORE_NAME)
          .index('projectId')
          .getAll(projectId),
      )) as AnalysisSnapshot[]
      await done

      const currentFingerprint = await fingerprint({
        projectName: state.project.name,
        baseline: state.project.baseline,
        draft: state.draft,
        relationRevision: Math.max(
          state.project.relationRevision,
          state.draft.relationRevision,
        ),
        relationReview: state.project.relationReview,
        sources: state.sources,
      })

      const snapshots = [...stored].sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.id.localeCompare(left.id),
      )
      const currentId =
        snapshots.find(
          (snapshot) => snapshot.inputFingerprint === currentFingerprint,
        )?.id ?? null

      return {
        ok: true as const,
        value: snapshots.map((snapshot) => {
          const historical = snapshot.id !== currentId
          return {
            snapshot: deepFreezeSnapshot(snapshot),
            historical,
            historicalReason: historical
              ? currentId === null
                ? '工作数据在快照创建后已变化；本快照只保留创建时内容。'
                : '已有更新的、与当前工作数据一致的快照；本快照保留为历史。'
              : null,
          }
        }),
      }
    })
  } catch (error) {
    return storageFailure(error, '读取分析快照列表失败。')
  }
}
