/**
 * V3.6：任务书 PDF 提取与逐条决定（main 权威侧）。
 *
 * 边界（与任务卡第 2 阶段一致）：
 * 1. 只读“确切 PDF 版本”：revisionId 必须存在于当前会话快照，main 从版本记录
 *    解析 blobKey，自算 SHA-256 与版本记录比对；不追随 latest，不接受路径/字节。
 * 2. 页范围、词项预算与取消由 main 执行；任何失败都零写入（先构造完整草稿，
 *    校验通过后才一次性替换会话快照），不留半截候选/决定。
 * 3. 提取结果只写入 project.extractionDrafts（隔离草稿）。不改 target、不建条款
 *    版本、不改绑定、不调用计算、不自动保存项目文件。
 * 4. 逐条决定要求显式确认、候选编辑代数、完整出处；actor/decidedAt 由 main 生成。
 * 5. 同一 PDF 版本 + 同一 extractorVersion 只有一份草稿：重复提取不新增候选，
 *    扩大页范围只追加新候选；决定随草稿持久化，跨重启保留。
 */
import type {
  ExtractionAttestUnitsRequest,
  ExtractionAttestUnitsValue,
  ExtractionBatchDecision,
  ExtractionBatchValue,
  ExtractionCancelRequest,
  ExtractionCancelValue,
  ExtractionConfirmBatchRequest,
  ExtractionDecideRequest,
  ExtractionDecideValue,
  ExtractionDeleteDraftRequest,
  ExtractionDeleteDraftValue,
  ExtractionRevokeUnitsRequest,
  ExtractionRunRequest,
  ExtractionRunValue,
  IpcErrorCode,
  IpcResult,
} from '../shared/contracts'
import { encodeProjectFile, toSnapshotDto } from '../../src/project-file/codec'
import type { ProjectFileProject, ProjectFileRevision, ProjectFileSnapshot } from '../../src/project-file/types'
import type { SourceRevision } from '../../src/sources/types'
import { sha256Hex } from '../../src/sources/hash'
import {
  EXTRACTOR_VERSION,
  MAX_EXTRACTION_CANDIDATES,
  MAX_EXTRACTION_ISSUES,
  attestCandidateUnits,
  buildExtractionDraft,
  buildPdfTextLayer,
  confirmCandidate,
  confirmCandidateBatch,
  editCandidateField,
  findCandidate,
  mergeExtractionDraft,
  rejectCandidate,
  revokeAttestation,
  revokeConfirmation,
  revokeUnitAttestations,
  isDraftSuperseded,
  type EditableField,
  type ExtractionCandidate,
  type ExtractionDraft,
  type ExtractionErrorCode,
  type ExtractionEvidence,
  type QuantityValue,
  type RawPdfTextPage,
  type UserAttestation,
} from '../../src/document-extraction'
import {
  extractPdfTextPages,
  PdfTextExtractionError,
  type PdfTextExtractionOptions,
} from './pdfTextExtract'
import type { ProjectService, ProjectSession } from './projectService'
import type { RecoveryStore } from './recovery'
import type { SessionController } from './sessionController'

/** 本地操作身份：不是实名批准，也不由 renderer 提供。 */
export const EXTRACTION_ACTOR = 'local-operator'

const EXTRACTION_ERROR_CODES: Record<ExtractionErrorCode, IpcErrorCode> = {
  PAGE_RANGE_INVALID: 'PAGE_OUT_OF_RANGE',
  CANDIDATE_NOT_FOUND: 'NOT_FOUND',
  CANDIDATE_BLOCKED: 'EXTRACTION_CANDIDATE_BLOCKED',
  CANDIDATE_REJECTED: 'EXTRACTION_CANDIDATE_REJECTED',
  CANDIDATE_STALE: 'EXTRACTION_STALE_DECISION',
  GROUP_ALREADY_CONFIRMED: 'EXTRACTION_GROUP_CONFLICT',
  STALE_EDIT_REVISION: 'EXTRACTION_STALE_DECISION',
  EXPLICIT_CONFIRMATION_REQUIRED: 'EXTRACTION_CONFIRMATION_REQUIRED',
  ACTOR_REQUIRED: 'EXTRACTION_CONFIRMATION_REQUIRED',
  DECIDED_AT_REQUIRED: 'EXTRACTION_CONFIRMATION_REQUIRED',
  REASON_REQUIRED: 'EXTRACTION_REASON_REQUIRED',
  EVIDENCE_REQUIRED: 'EXTRACTION_EVIDENCE_REQUIRED',
  FIELD_UNSUPPORTED: 'INVALID_REQUEST',
  VALUE_UNSUPPORTED: 'INVALID_REQUEST',
  NOT_CONFIRMED: 'EXTRACTION_CONFIRMATION_REQUIRED',
  STALE_DECISION: 'EXTRACTION_STALE_DECISION',
  SOURCE_STALE: 'STALE_EDIT',
  SOURCE_IDENTITY_MISMATCH: 'EXTRACTION_VERSION_MISMATCH',
  EXTRACTOR_VERSION_MISMATCH: 'EXTRACTION_VERSION_MISMATCH',
  // ADR-001：user-attestation 尚未进入真实产品流程（本步只做类型/校验/用例）。
  // 未新增 IPC 错误码：它仍是“依据不合法”，映射到现有的出处缺失码，
  // 等 attestation 接线时再按需要在契约里单独开码。
  ATTESTATION_SESSION_MISMATCH: 'EXTRACTION_EVIDENCE_REQUIRED',
  PROVENANCE_REVOKED: 'EXTRACTION_EVIDENCE_REQUIRED',
  BATCH_NOT_ELIGIBLE: 'EXTRACTION_BATCH_REJECTED',
  UNIT_STATEMENT_INVALID: 'EXTRACTION_UNIT_STATEMENT_INVALID',
  ATTESTATION_NOT_FOUND: 'NOT_FOUND',
  ATTESTATION_CONFIRMED: 'EXTRACTION_ATTESTATION_CONFIRMED',
}

function failure<T>(
  code: IpcErrorCode,
  message: string,
  detail?: string,
): IpcResult<T> {
  return detail === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, detail } }
}

export type ExtractTextPages = (
  bytes: Uint8Array,
  pageRange: { from: number; to: number },
  options?: PdfTextExtractionOptions,
) => Promise<RawPdfTextPage[]>

export interface ExtractionServiceDeps {
  controller: SessionController
  projectService: ProjectService
  recovery: RecoveryStore
  /** 测试注入；生产使用真实 pdfjs legacy 文本层读取。 */
  extractText?: ExtractTextPages
  now?: () => Date
  extractorVersion?: string
  timeoutMs?: number
}

interface CancelToken {
  sessionId: string
  cancelled: boolean
}

function quantityOf(candidate: ExtractionCandidate, field: EditableField): QuantityValue | null {
  const data = candidate.data as unknown as Record<string, QuantityValue | null | undefined>
  return data[field] ?? null
}

/** 改后文本必须出现在该字段原有原文片段里，才允许沿用这段出处。 */
function textSupportedByEvidence(evidence: readonly ExtractionEvidence[], text: string): boolean {
  const needle = text.trim()
  if (needle === '') return false
  return evidence.some((item) => item.normalizedSnippet.includes(needle))
}

function pageRangeOf(request: { pageFrom: number; pageTo: number }): {
  from: number
  to: number
} | null {
  const { pageFrom, pageTo } = request
  if (!Number.isSafeInteger(pageFrom) || !Number.isSafeInteger(pageTo)) return null
  if (pageFrom < 1 || pageTo < pageFrom) return null
  return { from: pageFrom, to: pageTo }
}

export class ExtractionService {
  private readonly deps: ExtractionServiceDeps
  private readonly now: () => Date
  private readonly extractText: ExtractTextPages
  private readonly extractorVersion: string
  private readonly running = new Map<number, string>()
  private readonly tokens = new Map<string, CancelToken>()
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(deps: ExtractionServiceDeps) {
    this.deps = deps
    this.now = deps.now ?? (() => new Date())
    this.extractText = deps.extractText ?? extractPdfTextPages
    this.extractorVersion = deps.extractorVersion ?? EXTRACTOR_VERSION
  }

  /** 同会话串行：两次提取/决定并发时不会基于同一 acceptedSeq 互相覆盖。 */
  private enqueue<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(sessionId) ?? Promise.resolve()
    const task = previous.then(work, work)
    this.chains.set(
      sessionId,
      task.catch(() => undefined),
    )
    return task
  }

  cancel(windowId: number, request: ExtractionCancelRequest): IpcResult<ExtractionCancelValue> {
    const active = this.running.get(windowId)
    if (active !== request.requestId) {
      return { ok: true, value: { cancelled: false } }
    }
    const token = this.tokens.get(request.requestId)
    if (token === undefined || token.sessionId !== request.sessionId) {
      return { ok: true, value: { cancelled: false } }
    }
    token.cancelled = true
    return { ok: true, value: { cancelled: true } }
  }

  async run(
    windowId: number,
    request: ExtractionRunRequest,
  ): Promise<IpcResult<ExtractionRunValue>> {
    // 并发检查必须在入队前：同一窗口的第二次请求应立即 BUSY，而不是排在
    // 第一次后面等待（否则用户无法知道当前已有提取在跑）。
    if (this.running.has(windowId)) {
      return failure('EXTRACTION_BUSY', '当前窗口已有提取在进行中')
    }
    return this.enqueue(request.sessionId, () => this.runInner(windowId, request))
  }

  private async runInner(
    windowId: number,
    request: ExtractionRunRequest,
  ): Promise<IpcResult<ExtractionRunValue>> {
    const session = this.deps.controller.sessionFor(windowId)
    if (session === null || session.sessionId !== request.sessionId) {
      return failure('STALE_SESSION', '会话已失效，请重新打开项目')
    }
    if (request.baseEditSeq !== session.acceptedSeq) {
      return failure(
        'STALE_EDIT',
        '提取期间项目已发生其它编辑，请重试',
        `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${request.baseEditSeq}`,
      )
    }
    if (this.running.has(windowId)) {
      return failure('EXTRACTION_BUSY', '当前窗口已有提取在进行中')
    }

    const range = pageRangeOf(request)
    if (range === null) {
      return failure('PAGE_OUT_OF_RANGE', '页范围无效：必须是 1-based、上限不小于下限')
    }
    /*
     * 页跨度不再在这里整份拒绝：`document-extractor-6` 起由领域层按 MAX_EXTRACTION_PAGES
     * 顺序切块（切的是页数组，同一 revision 只读一次），单块失败只标 CHUNK_FAILED。
     * 这里只做“页范围合法 + 不超出 PDF 页数”的检查。
     */

    // 只认快照里的确切版本；不追随 latest，也不接受 renderer 传来的哈希。
    const revision = session.snapshot.revisions.find((item) => item.id === request.revisionId)
    if (revision === undefined) {
      return failure(
        'SOURCE_NOT_FOUND',
        '该 PDF 版本不存在或不属于当前项目',
        `revisionId=${request.revisionId}`,
      )
    }
    if (range.to > revision.pageCount) {
      return failure(
        'PAGE_OUT_OF_RANGE',
        `页范围 ${range.from}..${range.to} 超出 PDF 页数 ${revision.pageCount}`,
        `pageCount=${revision.pageCount}`,
      )
    }
    const attachment = session.snapshot.attachments.find(
      (item) => item.blobKey === revision.blobKey,
    )
    if (attachment === undefined || !(attachment.bytes instanceof Uint8Array)) {
      return failure(
        'ATTACHMENT_MISSING',
        '该 PDF 版本的附件字节不在当前会话中，无法提取',
        `revisionId=${revision.id}`,
      )
    }
    const bytes = new Uint8Array(attachment.bytes)
    const digest = await sha256Hex(bytes)
    if (digest !== revision.sha256) {
      return failure(
        'HASH_MISMATCH',
        '附件字节与版本记录的 SHA-256 不一致，已拒绝提取',
        `declared=${revision.sha256}, actual=${digest}`,
      )
    }

    const token: CancelToken = { sessionId: session.sessionId, cancelled: false }
    this.tokens.set(request.requestId, token)
    this.running.set(windowId, request.requestId)
    let rawPages: RawPdfTextPage[]
    try {
      rawPages = await this.extractText(bytes, range, {
        isCancelled: () => token.cancelled,
        timeoutMs: this.deps.timeoutMs,
      })
    } catch (error) {
      if (error instanceof PdfTextExtractionError) {
        if (error.code === 'EXTRACTION_CANCELLED') {
          return failure('EXTRACTION_CANCELLED', '提取已取消；未写入任何候选')
        }
        if (error.code === 'EXTRACTION_TIMEOUT') {
          return failure('EXTRACTION_TIMEOUT', '提取超时；未写入任何候选', error.message)
        }
        if (error.code === 'EXTRACTION_BUDGET') {
          return failure('EXTRACTION_BUDGET', error.message)
        }
        return failure('SOURCE_UNREADABLE', error.message)
      }
      return failure(
        'SOURCE_UNREADABLE',
        'PDF 文本层无法读取',
        error instanceof Error ? error.message : String(error),
      )
    } finally {
      this.running.delete(windowId)
      this.tokens.delete(request.requestId)
    }

    if (!Number.isSafeInteger(revision.pageCount) || revision.pageCount < 1) {
      return failure('SOURCE_UNREADABLE', 'PDF 页数记录无效')
    }
    const layer = buildPdfTextLayer(rawPages)
    const incoming = buildExtractionDraft({
      projectId: session.snapshot.project.id,
      // 草稿基准只作为来源标记；跨重启幂等由 sourceIdentity + 页范围 + 规则版本决定。
      baseToken: `base-${session.snapshot.project.id}`,
      source: {
        documentId: revision.documentId,
        revisionId: revision.id,
        sha256: revision.sha256,
        blobKey: revision.blobKey,
        pageCount: revision.pageCount,
      },
      pageRange: range,
      layer,
      extractorVersion: this.extractorVersion,
    })
    if (incoming.candidates.length > MAX_EXTRACTION_CANDIDATES) {
      return failure(
        'EXTRACTION_BUDGET',
        `候选数超过上限 ${MAX_EXTRACTION_CANDIDATES}；请缩小页范围`,
        `candidates=${incoming.candidates.length}`,
      )
    }
    if (incoming.issues.length > MAX_EXTRACTION_ISSUES) {
      return failure(
        'EXTRACTION_BUDGET',
        `问题数超过上限 ${MAX_EXTRACTION_ISSUES}；请缩小页范围`,
        `issues=${incoming.issues.length}`,
      )
    }

    const drafts = session.snapshot.project.extractionDrafts
    /*
     * 幂等范围 = 幂等键（项目 + 文档/版本/哈希 + 规范页范围 + 规则版本）。
     * 同一键重复提取合并到原草稿，不新增候选；不同页范围各是独立草稿，
     * 因为候选身份包含“首次出现页/选区”，把不同范围的解析结果塞进同一草稿
     * 会把重叠候选变成两条、或迫使旧决定迁移到重新解析的候选上。
     * 扩大页范围因此新增一份草稿，旧草稿的候选与决定原样保留（范围见
     * docs/evidence/V3.6 的未做/偏差说明）。
     */
    const existing = drafts.find(
      (draft) => draft.idempotencyKey === incoming.idempotencyKey,
    )
    let nextDraft: ExtractionDraft
    let nextDrafts: ExtractionDraft[]
    if (existing === undefined) {
      nextDraft = incoming
      nextDrafts = [...drafts, incoming]
    } else {
      if (existing.sourceIdentity.documentId !== incoming.sourceIdentity.documentId) {
        return failure('SOURCE_NOT_FOUND', '同一 PDF 版本记录的文档身份不一致，已拒绝合并')
      }
      const merged = mergeExtractionDraft(existing, incoming)
      if (!merged.ok) {
        return failure(
          EXTRACTION_ERROR_CODES[merged.code],
          merged.message,
        )
      }
      nextDraft = merged.value
      nextDrafts = drafts.map((draft) => (draft === existing ? nextDraft : draft))
    }

    const changed =
      existing === undefined || nextDraft.draftRevision !== existing.draftRevision
    const addedCandidateCount =
      existing === undefined
        ? nextDraft.candidates.length
        : nextDraft.candidates.length - existing.candidates.length

    if (!changed) {
      return {
        ok: true,
        value: {
          acceptedSeq: session.acceptedSeq,
          draftId: nextDraft.draftId,
          extractorVersion: nextDraft.extractorVersion,
          candidateCount: nextDraft.candidates.length,
          addedCandidateCount: 0,
          unchanged: true,
          snapshot: toSnapshotDto(session.snapshot),
          recovery: this.deps.recovery.stateOf(session.sessionId),
        },
      }
    }

    // 只有到这里才替换会话快照：前面任何失败都没有可见副作用。
    const nextProject: ProjectFileProject = {
      ...session.snapshot.project,
      extractionDrafts: nextDrafts,
    }
    session.snapshot = { ...session.snapshot, project: nextProject }
    session.acceptedSeq = request.baseEditSeq + 1
    const staged = await this.deps.recovery.stage(
      session.sessionId,
      session.snapshot,
      session.acceptedSeq,
      this.deps.controller.recoveryMeta(session, session.snapshot),
    )
    const value: ExtractionRunValue = {
      acceptedSeq: session.acceptedSeq,
      draftId: nextDraft.draftId,
      extractorVersion: nextDraft.extractorVersion,
      candidateCount: nextDraft.candidates.length,
      addedCandidateCount,
      unchanged: false,
      snapshot: toSnapshotDto(session.snapshot),
      recovery: staged.state,
    }
    if (staged.warning !== undefined) value.warning = staged.warning
    return { ok: true, value }
  }

  async decide(request: ExtractionDecideRequest): Promise<IpcResult<ExtractionDecideValue>> {
    return this.enqueue(request.sessionId, () => this.decideInner(request))
  }

  private async decideInner(
    request: ExtractionDecideRequest,
  ): Promise<IpcResult<ExtractionDecideValue>> {
    const found = this.deps.projectService.getSession(request.sessionId)
    if (found === null) {
      return failure('STALE_SESSION', '会话已失效，请重新打开项目')
    }
    const session: ProjectSession = found
    if (request.baseEditSeq !== session.acceptedSeq) {
      return failure(
        'STALE_EDIT',
        '候选决定期间项目已发生其它编辑，请刷新后重试',
        `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${request.baseEditSeq}`,
      )
    }
    const drafts = session.snapshot.project.extractionDrafts
    const draft = drafts.find((item) => item.draftId === request.draftId)
    if (draft === undefined) {
      return failure('NOT_FOUND', '提取草稿不存在或已被替换', `draftId=${request.draftId}`)
    }
    // 多草稿：旧规则版本的草稿只能查看/定位/删除；确认、拒绝、编辑一律拒绝，
    // 避免界面或伪造请求把旧规则结果当成现行结论确认。
    if (isDraftSuperseded(draft, drafts)) {
      return failure(
        'EXTRACTION_DRAFT_SUPERSEDED',
        '旧规则版本的草稿只读：请在最新版本草稿上复核后确认',
        `draftId=${draft.draftId}, extractorVersion=${draft.extractorVersion}`,
      )
    }
    const candidate = findCandidate(draft, request.candidateId)
    if (candidate === null) {
      return failure('NOT_FOUND', '候选不存在', `candidateId=${request.candidateId}`)
    }
    if (candidate.editRevision !== request.editRevision) {
      return failure(
        'EXTRACTION_STALE_DECISION',
        '候选已在别处修改，请重新查看原文后再决定',
        `current=${candidate.editRevision}, request=${request.editRevision}`,
      )
    }

    const decidedAt = this.now().toISOString()
    let updated: ExtractionDraft
    if (request.action === 'confirm') {
      if (request.confirmed !== true) {
        return failure('EXTRACTION_CONFIRMATION_REQUIRED', '必须显式确认该候选')
      }
      const result = confirmCandidate(draft, {
        candidateId: request.candidateId,
        editRevision: request.editRevision,
        confirmed: true,
        actor: EXTRACTION_ACTOR,
        decidedAt,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
      })
      if (!result.ok) {
        return failure(EXTRACTION_ERROR_CODES[result.code], result.message)
      }
      updated = result.value
    } else if (request.action === 'reject') {
      if (request.reason === undefined || request.reason.trim() === '') {
        return failure('EXTRACTION_REASON_REQUIRED', '拒绝候选必须填写理由')
      }
      const result = rejectCandidate(draft, {
        candidateId: request.candidateId,
        editRevision: request.editRevision,
        actor: EXTRACTION_ACTOR,
        decidedAt,
        reason: request.reason,
      })
      if (!result.ok) {
        return failure(EXTRACTION_ERROR_CODES[result.code], result.message)
      }
      updated = result.value
    } else if (request.action === 'revoke') {
      const result = revokeConfirmation(draft, {
        candidateId: request.candidateId,
        editRevision: request.editRevision,
        actor: EXTRACTION_ACTOR,
        decidedAt,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
      })
      if (!result.ok) {
        return failure(EXTRACTION_ERROR_CODES[result.code], result.message)
      }
      updated = result.value
    } else {
      const field = request.field
      const text = request.text
      if (field === undefined || text === undefined) {
        return failure('INVALID_REQUEST', '编辑必须提供字段与 mm 文本')
      }
      if (field === 'upperDeviation' && candidate.kind !== 'ring') {
        return failure('INVALID_REQUEST', '该候选没有上偏差字段')
      }
      const current = quantityOf(candidate, field)
      if (current === null) {
        return failure('INVALID_REQUEST', `候选没有可编辑字段 ${field}`)
      }
      if (!textSupportedByEvidence(current.evidence, text)) {
        return failure(
          'EXTRACTION_EVIDENCE_REQUIRED',
          '改后文本不在该字段的原文片段中，不能沿用原有出处',
          `field=${field}, text=${text}`,
        )
      }
      const result = editCandidateField(draft, {
        candidateId: request.candidateId,
        editRevision: request.editRevision,
        field,
        text,
        unit: 'mm',
        evidence: current.evidence,
        actor: EXTRACTION_ACTOR,
        decidedAt,
        reason: request.reason ?? '人工按原文修正',
      })
      if (!result.ok) {
        return failure(EXTRACTION_ERROR_CODES[result.code], result.message)
      }
      updated = result.value
    }

    const unchanged = updated === draft
    const nextProject: ProjectFileProject = unchanged
      ? session.snapshot.project
      : {
          ...session.snapshot.project,
          extractionDrafts: drafts.map((item) => (item.draftId === updated.draftId ? updated : item)),
        }
    const nextCandidate = findCandidate(updated, request.candidateId)
    const decision = updated.decisions
      .filter((item) => item.candidateId === request.candidateId)
      .at(-1)

    let acceptedSeq = session.acceptedSeq
    let recovery = this.deps.recovery.stateOf(session.sessionId)
    if (!unchanged) {
      session.snapshot = { ...session.snapshot, project: nextProject }
      session.acceptedSeq = request.baseEditSeq + 1
      acceptedSeq = session.acceptedSeq
      const staged = await this.deps.recovery.stage(
        session.sessionId,
        session.snapshot,
        session.acceptedSeq,
        this.deps.controller.recoveryMeta(session, session.snapshot),
      )
      recovery = staged.state
      const value: ExtractionDecideValue = {
        acceptedSeq,
        draftId: updated.draftId,
        candidateId: request.candidateId,
        status: nextCandidate?.status ?? candidate.status,
        decisionId: decision?.decisionId ?? null,
        snapshot: toSnapshotDto(session.snapshot),
        recovery,
      }
      if (staged.warning !== undefined) value.warning = staged.warning
      return { ok: true, value }
    }
    return {
      ok: true,
      value: {
        acceptedSeq,
        draftId: updated.draftId,
        candidateId: request.candidateId,
        status: nextCandidate?.status ?? candidate.status,
        decisionId: decision?.decisionId ?? null,
        snapshot: toSnapshotDto(session.snapshot),
        recovery,
      },
    }
  }

  /**
   * L2 批量动作的公共提交：编码自校验 → 写恢复草稿 → 才切换会话快照。
   *
   * 与 deleteDraft 同一套原子顺序：先校验聚合可完整编码，再写恢复文件；任何一步失败
   * 都返回错误且内存/磁盘都不变。批量动作的“整批拒绝”由纯函数保证，这里只负责提交。
   */
  private async stageUpdatedDraft(
    session: ProjectSession,
    updated: ExtractionDraft,
    baseEditSeq: number,
    projectPatch: Partial<ProjectFileProject> = {},
  ): Promise<
    IpcResult<{
      acceptedSeq: number
      recovery: ExtractionBatchValue['recovery']
      warning?: string
    }>
  > {
    const nextSnapshot: ProjectFileSnapshot = {
      ...session.snapshot,
      project: {
        ...session.snapshot.project,
        extractionDrafts: session.snapshot.project.extractionDrafts.map((item) =>
          item.draftId === updated.draftId ? updated : item,
        ),
        ...projectPatch,
      },
    }
    try {
      const encoded = await encodeProjectFile(nextSnapshot)
      if (!encoded.ok) {
        return failure(
          'INTERNAL',
          '批量动作后的项目无法通过格式校验，已取消（0 条写入）',
          `${encoded.error.code}: ${encoded.error.message}`,
        )
      }
    } catch (error) {
      return failure(
        'INTERNAL',
        '批量动作后的项目无法通过格式校验，已取消（0 条写入）',
        error instanceof Error ? error.message : String(error),
      )
    }
    const nextSeq = baseEditSeq + 1
    let staged: Awaited<ReturnType<RecoveryStore['stage']>>
    try {
      staged = await this.deps.recovery.stage(
        session.sessionId,
        nextSnapshot,
        nextSeq,
        this.deps.controller.recoveryMeta(session, nextSnapshot),
      )
    } catch (error) {
      return failure(
        'INTERNAL',
        '批量动作未能写入恢复文件，已取消（项目与草稿均未改变）',
        error instanceof Error ? error.message : String(error),
      )
    }
    session.snapshot = nextSnapshot
    session.acceptedSeq = nextSeq
    return {
      ok: true,
      value: {
        acceptedSeq: nextSeq,
        recovery: staged.state,
        ...(staged.warning === undefined ? {} : { warning: staged.warning }),
      },
    }
  }

  /** 批量结果的逐条回执：每条候选自己的 decisionId 与动作后状态。 */
  private batchDecisions(
    draft: ExtractionDraft,
    candidateIds: readonly string[],
    decidedAt: string,
  ): ExtractionBatchDecision[] {
    return candidateIds.map((candidateId) => {
      const candidate = findCandidate(draft, candidateId)
      const decision = draft.decisions
        .filter((item) => item.candidateId === candidateId && item.decidedAt === decidedAt)
        .at(-1)
      return {
        candidateId,
        decisionId: decision?.decisionId ?? '',
        status: candidate?.status ?? 'stale',
      }
    })
  }

  /** L2：同组批量确认（互斥组整批拒绝，逐条写决定）。 */
  async confirmBatch(
    request: ExtractionConfirmBatchRequest,
  ): Promise<IpcResult<ExtractionBatchValue>> {
    return this.enqueue(request.sessionId, () => this.confirmBatchInner(request))
  }

  private async confirmBatchInner(
    request: ExtractionConfirmBatchRequest,
  ): Promise<IpcResult<ExtractionBatchValue>> {
    const session = this.deps.projectService.getSession(request.sessionId)
    if (session === null) return failure('STALE_SESSION', '会话已失效，请重新打开项目')
    if (request.baseEditSeq !== session.acceptedSeq) {
      return failure(
        'STALE_EDIT',
        '批量确认期间项目已发生其它编辑，请刷新后重试',
        `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${request.baseEditSeq}`,
      )
    }
    const drafts = session.snapshot.project.extractionDrafts
    const draft = drafts.find((item) => item.draftId === request.draftId)
    if (draft === undefined) return failure('NOT_FOUND', '提取草稿不存在或已被替换')
    if (isDraftSuperseded(draft, drafts)) {
      return failure(
        'EXTRACTION_DRAFT_SUPERSEDED',
        '旧规则版本的草稿只读：请在最新版本草稿上复核后确认',
      )
    }
    const decidedAt = this.now().toISOString()
    const result = confirmCandidateBatch(draft, {
      candidateIds: request.candidateIds,
      actor: EXTRACTION_ACTOR,
      decidedAt,
      reason: '同组批量确认（逐条落盘）',
    })
    if (!result.ok) return failure(EXTRACTION_ERROR_CODES[result.code], result.message)
    const staged = await this.stageUpdatedDraft(session, result.value.draft, request.baseEditSeq)
    if (!staged.ok) return staged
    const value: ExtractionBatchValue = {
      acceptedSeq: staged.value.acceptedSeq,
      draftId: result.value.draft.draftId,
      candidateIds: [...result.value.candidateIds],
      decisions: this.batchDecisions(result.value.draft, result.value.candidateIds, decidedAt),
      snapshot: toSnapshotDto(session.snapshot),
      recovery: staged.value.recovery,
    }
    if (staged.value.warning !== undefined) value.warning = staged.value.warning
    return { ok: true, value }
  }

  /** L2：批量补单位（只对“仅差单位”；任一条不合格整批拒绝）。 */
  async attestUnits(
    request: ExtractionAttestUnitsRequest,
  ): Promise<IpcResult<ExtractionAttestUnitsValue>> {
    return this.enqueue(request.sessionId, () => this.attestUnitsInner(request))
  }

  private async attestUnitsInner(
    request: ExtractionAttestUnitsRequest,
  ): Promise<IpcResult<ExtractionAttestUnitsValue>> {
    const session = this.deps.projectService.getSession(request.sessionId)
    if (session === null) return failure('STALE_SESSION', '会话已失效，请重新打开项目')
    if (request.baseEditSeq !== session.acceptedSeq) {
      return failure(
        'STALE_EDIT',
        '批量补单位期间项目已发生其它编辑，请刷新后重试',
        `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${request.baseEditSeq}`,
      )
    }
    const drafts = session.snapshot.project.extractionDrafts
    const draft = drafts.find((item) => item.draftId === request.draftId)
    if (draft === undefined) return failure('NOT_FOUND', '提取草稿不存在或已被替换')
    if (isDraftSuperseded(draft, drafts)) {
      return failure(
        'EXTRACTION_DRAFT_SUPERSEDED',
        '旧规则版本的草稿只读：请在最新版本草稿上补单位',
      )
    }
    // 责任人/会话序号由 main 生成：renderer 不能替用户伪造“第几次输入”。
    const project = session.snapshot.project
    const actorId = project.actorId ?? EXTRACTION_ACTOR
    const sessionSeq = Math.max(1, project.sessionSeq + 1)
    const decidedAt = this.now().toISOString()
    const result = attestCandidateUnits(draft, {
      candidateIds: request.candidateIds,
      statement: request.statement,
      actor: actorId,
      decidedAt,
      sessionSeq,
      sessionLabel: null,
    })
    if (!result.ok) return failure(EXTRACTION_ERROR_CODES[result.code], result.message)
    const staged = await this.stageUpdatedDraft(session, result.value.draft, request.baseEditSeq, {
      sessionSeq,
      attestations: [...project.attestations, ...result.value.attestations],
    })
    if (!staged.ok) return staged
    const value: ExtractionAttestUnitsValue = {
      acceptedSeq: staged.value.acceptedSeq,
      draftId: result.value.draft.draftId,
      batchId: result.value.batchId,
      unitText: result.value.unitText,
      candidateIds: [...result.value.candidateIds],
      decisions: this.batchDecisions(result.value.draft, result.value.candidateIds, decidedAt),
      snapshot: toSnapshotDto(session.snapshot),
      recovery: staged.value.recovery,
    }
    if (staged.value.warning !== undefined) value.warning = staged.value.warning
    return { ok: true, value }
  }

  /** L2：撤销补单位（整批或逐条；出处只标撤销不删除）。 */
  async revokeUnits(
    request: ExtractionRevokeUnitsRequest,
  ): Promise<IpcResult<ExtractionBatchValue>> {
    return this.enqueue(request.sessionId, () => this.revokeUnitsInner(request))
  }

  private async revokeUnitsInner(
    request: ExtractionRevokeUnitsRequest,
  ): Promise<IpcResult<ExtractionBatchValue>> {
    const session = this.deps.projectService.getSession(request.sessionId)
    if (session === null) return failure('STALE_SESSION', '会话已失效，请重新打开项目')
    if (request.baseEditSeq !== session.acceptedSeq) {
      return failure(
        'STALE_EDIT',
        '撤销补单位期间项目已发生其它编辑，请刷新后重试',
        `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${request.baseEditSeq}`,
      )
    }
    const drafts = session.snapshot.project.extractionDrafts
    const draft = drafts.find((item) => item.draftId === request.draftId)
    if (draft === undefined) return failure('NOT_FOUND', '提取草稿不存在或已被替换')
    if (isDraftSuperseded(draft, drafts)) {
      return failure('EXTRACTION_DRAFT_SUPERSEDED', '旧规则版本的草稿只读')
    }
    const decidedAt = this.now().toISOString()
    const result = revokeUnitAttestations(draft, {
      batchId: request.batchId ?? null,
      candidateId: request.candidateId ?? null,
      actor: EXTRACTION_ACTOR,
      decidedAt,
      reason: '用户在确认面板撤销补单位',
    })
    if (!result.ok) return failure(EXTRACTION_ERROR_CODES[result.code], result.message)
    // 账本副本同步标撤销（出处不可抹：只追加撤销字段，不删除条目）。
    const targetFieldPaths = new Set(
      result.value.candidateIds.map((candidateId) => `candidate:${candidateId}:unit`),
    )
    const staleSeqs = new Set(
      session.snapshot.project.attestations
        .filter(
          (attestation) =>
            targetFieldPaths.has(attestation.fieldPath) && (attestation.revokedAt ?? null) === null,
        )
        .map((attestation) => `${attestation.fieldPath}|${attestation.statement}|${attestation.at}`),
    )
    const attestations = session.snapshot.project.attestations.map((attestation) => {
      const key = `${attestation.fieldPath}|${attestation.statement}|${attestation.at}`
      if (!staleSeqs.has(key)) return attestation
      return revokeAttestation(attestation as UserAttestation, {
        by: EXTRACTION_ACTOR,
        at: decidedAt,
        statement: '用户在确认面板撤销补单位',
      })
    })
    const staged = await this.stageUpdatedDraft(session, result.value.draft, request.baseEditSeq, {
      attestations,
    })
    if (!staged.ok) return staged
    const value: ExtractionBatchValue = {
      acceptedSeq: staged.value.acceptedSeq,
      draftId: result.value.draft.draftId,
      candidateIds: [...result.value.candidateIds],
      decisions: this.batchDecisions(result.value.draft, result.value.candidateIds, decidedAt),
      snapshot: toSnapshotDto(session.snapshot),
      recovery: staged.value.recovery,
    }
    if (staged.value.warning !== undefined) value.warning = staged.value.warning
    return { ok: true, value }
  }

  /**
   * 删除一份被取代的草稿（多草稿方案 3）。
   *
   * 原子顺序：校验（会话/编辑序号/草稿存在/确实被取代）→ 按 schema8 编码自校验
   * → 写恢复草稿 → 才切换会话快照与编辑序号。任何一步失败都返回错误，内存快照、
   * 恢复草稿与项目文件都不变；成功也只删这一份草稿条目，来源 PDF/条款/绑定/图纸
   * 与其它草稿原样保留。项目文件仍需用户显式保存才落盘。
   */
  async deleteDraft(
    request: ExtractionDeleteDraftRequest,
  ): Promise<IpcResult<ExtractionDeleteDraftValue>> {
    return this.enqueue(request.sessionId, () => this.deleteDraftInner(request))
  }

  private async deleteDraftInner(
    request: ExtractionDeleteDraftRequest,
  ): Promise<IpcResult<ExtractionDeleteDraftValue>> {
    const session = this.deps.projectService.getSession(request.sessionId)
    if (session === null) {
      return failure('STALE_SESSION', '会话已失效，请重新打开项目')
    }
    if (request.baseEditSeq !== session.acceptedSeq) {
      return failure(
        'STALE_EDIT',
        '删除期间项目已发生其它编辑，请刷新后重试',
        `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${request.baseEditSeq}`,
      )
    }
    const drafts = session.snapshot.project.extractionDrafts
    const draft = drafts.find((item) => item.draftId === request.draftId)
    if (draft === undefined) {
      return failure('NOT_FOUND', '提取草稿不存在或已被删除', `draftId=${request.draftId}`)
    }
    if (!isDraftSuperseded(draft, drafts)) {
      return failure(
        'EXTRACTION_DRAFT_LATEST',
        '最新规则版本的草稿不能删除；如需重新提取，直接在同一范围重提即可，旧结果会自动折叠保留',
        `draftId=${draft.draftId}, extractorVersion=${draft.extractorVersion}`,
      )
    }

    const nextDrafts = drafts.filter((item) => item.draftId !== draft.draftId)
    const nextSnapshot: ProjectFileSnapshot = {
      ...session.snapshot,
      project: { ...session.snapshot.project, extractionDrafts: nextDrafts },
    }
    const nextSeq = request.baseEditSeq + 1

    // 写前自校验：删除后的聚合必须仍能按 schema8 完整编码/回读，否则零写入。
    let encoded: Awaited<ReturnType<typeof encodeProjectFile>>
    try {
      encoded = await encodeProjectFile(nextSnapshot)
    } catch (error) {
      return failure(
        'INTERNAL',
        '删除后的项目无法通过格式校验，已取消删除',
        error instanceof Error ? error.message : String(error),
      )
    }
    if (!encoded.ok) {
      return failure(
        'INTERNAL',
        '删除后的项目无法通过格式校验，已取消删除',
        `${encoded.error.code}: ${encoded.error.message}`,
      )
    }

    let staged: Awaited<ReturnType<RecoveryStore['stage']>>
    try {
      staged = await this.deps.recovery.stage(
        session.sessionId,
        nextSnapshot,
        nextSeq,
        this.deps.controller.recoveryMeta(session, nextSnapshot),
      )
    } catch (error) {
      // 恢复草稿写失败：会话快照与草稿都保持原样（不先改内存再补写）。
      return failure(
        'INTERNAL',
        '草稿删除未能写入恢复文件，已取消删除（项目与草稿均未改变）',
        error instanceof Error ? error.message : String(error),
      )
    }

    session.snapshot = nextSnapshot
    session.acceptedSeq = nextSeq
    const value: ExtractionDeleteDraftValue = {
      acceptedSeq: nextSeq,
      draftId: draft.draftId,
      remainingDraftCount: nextDrafts.length,
      snapshot: toSnapshotDto(nextSnapshot),
      recovery: staged.state,
    }
    if (staged.warning !== undefined) value.warning = staged.warning
    return { ok: true, value }
  }

  /** 只读：给定快照与版本，返回该版本是否不是 latest（供 UI 醒目提示）。 */
  static isOutdatedRevision(snapshot: ProjectFileSnapshot, revision: SourceRevision): boolean {
    const document = snapshot.documents.find((item) => item.id === revision.documentId)
    return document !== undefined && document.latestRevisionId !== revision.id
  }

  /** 只读：版本是否属于项目（用于渠道层错误信息，不做授权）。 */
  static revisionOf(snapshot: ProjectFileSnapshot, revisionId: string): SourceRevision | null {
    return snapshot.revisions.find((item) => item.id === revisionId) ?? null
  }
}

export type { ProjectFileRevision }
