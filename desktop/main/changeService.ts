/**
 * D：参数联动 main 服务（草稿、预览、确认、绑定、对比、恢复）。
 *
 * 关键不变量：
 * 1. 草稿只存在 main；预览不写正式聚合；确认才一次原子写入。
 * 2. baseToken 覆盖正式基准 + 单调代数/acceptedSeq；改后改回也不会复活旧令牌。
 * 3. 确认不复用 preview.result：从当前草稿重新 computeChange，再与已展示预览
 *    指纹比对（MUT-D1）；不一致即拒绝。
 * 4. 磁盘失败零正式写入：内存只在 commitCandidate 成功后发布。
 */
import { randomUUID } from 'node:crypto'
import type {
  ChangeApplyValue,
  ChangeBindRequest,
  ChangeCompareRequest,
  ChangeCompareValueResponse,
  ChangeDraftValue,
  ChangePreviewValue,
  ChangeRestoreRequest,
  ChangeRestoreValue,
  ChangeStageRequest,
  ChangeUnbindRequest,
  IpcErrorCode,
  IpcResult,
} from '../shared/contracts'
import type { ProjectFileParameterBindingLink, ProjectFileRevision, ProjectFileSnapshot, ProjectFileSpacerParameter } from '../../src/project-file/types'
import { buildSpacerDrawing } from '../../src/drawing/spacerDrawing'
import {
  DEFAULT_DRAWING_SCALE,
  SPACER_PART_ID,
  type DrawingData,
} from '../../src/drawing/types'
import { parseSpacerParameters } from '../../src/parts/spacerParameters'
import { toSnapshotDto } from '../../src/project-file/codec'
import { stableFingerprint } from '../../src/revisions/canonical'
import {
  buildCommitCandidate,
} from '../../src/revisions/commit'
import {
  ChangeError,
  computeChange,
  DEFAULT_FRAME_FIELDS,
} from '../../src/revisions/compute'
import {
  computeBaseDigest,
  computeDraftToken,
  explainBaseChange,
  type BaseDigest,
} from '../../src/revisions/digest'
import { compareDrawings } from '../../src/revisions/compare'
import { rebuildFromGenerationInput } from '../../src/revisions/rebuild'
import { rebuildDrawingFromProject } from '../../src/drawing/rebuildDrawing'
import {
  computeCandidateRequirementCheck,
} from '../../src/requirements/check'
import { commitRecomputedChange } from '../../src/requirements/commit'
import type {
  RequirementCheck,
  RequirementEditDraft,
} from '../../src/requirements/types'
import {
  deriveReviewGroups,
  type ReviewGroups,
} from '../../src/revisions/status'
import type { ChangeComputation, DrawingGenerationInput } from '../../src/revisions/types'
import type { ProjectService, ProjectSession } from './projectService'
import type { RecoveryStore } from './recovery'
import type { SessionController } from './sessionController'

interface DraftRecord {
  draftId: string
  draftRevision: number
  parameters: ProjectFileSpacerParameter[]
  bindings: ProjectFileParameterBindingLink[]
  reason: string
  restoredFromRevisionId: string | null
  sourceRevisionId: string | null
  /** 草稿针对的条款版本；条款换版后旧草稿的候选检查自然过期。 */
  requirementRevisionId: string | null
}

interface Expectation {
  parameters: { parameterId: string; valueQ: number; inputDecimals: number; parameterRevision: number; sourceNote: string }[]
  terms: { termId: string; nominalQ: number; termRevision: number }[]
  result: { nominalQ: number; minQ: number; maxQ: number; status: string }
  drawingFingerprint: string
  pendingCount: number
}

interface PreviewRecord {
  previewId: string
  previewToken: string
  baseToken: string
  draftToken: string
  draftId: string
  draftRevision: number
  revisionId: string
  createdAt: string
  expectation: Expectation
  groups: ReviewGroups
  /** 预览时的条款检查（main 内部记录）；确认路径必须重算后与它比对。 */
  requirementCheck: RequirementCheck | null
  /** 仅内存缓存，供 T7 比对/测试；确认路径不得直接拿它当结果。 */
  computation: ChangeComputation
}

interface ChangeSessionState {
  generation: number
  base: BaseDigest | null
  /** token → 当时的分组摘要（有界）；用于拒绝时解释“哪一类基准变了”。 */
  knownBases: Map<string, BaseDigest>
  draft: DraftRecord | null
  /** 未确认的条款编辑表单；存在即“待确认”，不属于正式条款。 */
  requirementEdit: RequirementEditDraft | null
  previews: Map<string, PreviewRecord>
  committed: Map<string, ChangeApplyValue>
}

export interface ChangeServiceDeps {
  projectService: ProjectService
  recovery: RecoveryStore
  controller: SessionController
  now?: () => Date
  newId?: () => string
  /** 无会话路径时选择保存位置；取消返回 null。只允许 main 对话框决定。 */
  pickSaveTarget?: (suggestedName: string) => Promise<string | null>
  confirmOverwrite?: (targetPath: string) => Promise<boolean>
}

export interface ChangeFailure {
  code: IpcErrorCode
  message: string
  detail?: string
  reasonCodes?: string[]
}

export type ChangeResult<T> = IpcResult<T>

function failure(
  code: IpcErrorCode,
  message: string,
  detail?: string,
  reasonCodes?: string[],
): { ok: false; error: ChangeFailure } {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(detail === undefined ? {} : { detail }),
      ...(reasonCodes === undefined ? {} : { reasonCodes }),
    },
  }
}

/** 同步快照戳：供 rename 前 CAS 用（不哈希附件字节，只含键与长度）。 */
function snapshotStamp(snapshot: ProjectFileSnapshot): string {
  return stableFingerprint({
    project: snapshot.project,
    documents: snapshot.documents,
    revisions: snapshot.revisions,
    bindings: snapshot.bindings,
    blobs: snapshot.blobs,
    events: snapshot.events,
    analysisSnapshots: snapshot.analysisSnapshots,
    fileRevisions: snapshot.fileRevisions,
    attachments: snapshot.attachments.map((item) => ({
      blobKey: item.blobKey,
      byteLength: item.bytes.byteLength,
    })),
    missingAttachments: snapshot.missingAttachments,
  })
}

function parameterBindingOf(snapshot: ProjectFileSnapshot): ProjectFileParameterBindingLink[] {
  return snapshot.project.dimensionLinks.filter(
    (link): link is ProjectFileParameterBindingLink => link.kind === 'parameter-binding',
  )
}

function validateBindingRefs(
  snapshot: ProjectFileSnapshot,
  parameters: readonly ProjectFileSpacerParameter[],
  bindings: readonly ProjectFileParameterBindingLink[],
): string | null {
  const termIds = new Set(snapshot.project.dimensionChain.terms.map((term) => term.id))
  const parameterById = new Map(parameters.map((parameter) => [parameter.parameterId, parameter]))
  const seen = new Set<string>()
  for (const binding of bindings) {
    if (seen.has(binding.termId)) {
      return `组成环 ${binding.termId} 存在第二个参数绑定`
    }
    seen.add(binding.termId)
    if (!termIds.has(binding.termId)) {
      return `绑定 ${binding.bindingId} 引用了不存在的组成环`
    }
    const parameter = parameterById.get(binding.parameterId)
    if (parameter === undefined) {
      return `绑定 ${binding.bindingId} 引用了不存在的参数`
    }
    if (parameter.partId !== binding.partId) {
      return `绑定 ${binding.bindingId} 的部件与参数不一致`
    }
    if (parameter.partId !== SPACER_PART_ID) {
      return `绑定 ${binding.bindingId} 指向不支持的部件`
    }
  }
  return null
}

function expectationOf(computation: ChangeComputation): Expectation {
  return {
    parameters: computation.parameters.map((parameter) => ({
      parameterId: parameter.parameterId,
      valueQ: parameter.valueQ,
      inputDecimals: parameter.inputDecimals,
      parameterRevision: parameter.parameterRevision,
      sourceNote: parameter.sourceNote ?? '',
    })),
    terms: computation.chain.terms.map((term) => ({
      termId: term.id,
      nominalQ: term.nominalQ,
      termRevision: term.termRevision,
    })),
    result: {
      nominalQ: computation.result.nominalQ,
      minQ: computation.result.minQ,
      maxQ: computation.result.maxQ,
      status: computation.result.status,
    },
    drawingFingerprint: computation.drawing.record.dataFingerprint,
    pendingCount: -1,
  }
}

function expectationDiff(before: Expectation, after: Expectation): string[] {
  const diffs: string[] = []
  const beforeParam = new Map(before.parameters.map((item) => [item.parameterId, item]))
  for (const item of after.parameters) {
    const old = beforeParam.get(item.parameterId)
    if (old === undefined) {
      diffs.push(`参数 ${item.parameterId} 在预览中不存在`)
      continue
    }
    if (
      old.valueQ !== item.valueQ ||
      old.inputDecimals !== item.inputDecimals ||
      old.parameterRevision !== item.parameterRevision ||
      old.sourceNote !== item.sourceNote
    ) {
      diffs.push(`参数 ${item.parameterId} 与预览不一致`)
    }
  }
  const beforeTerms = new Map(before.terms.map((item) => [item.termId, item]))
  for (const item of after.terms) {
    const old = beforeTerms.get(item.termId)
    if (old === undefined || old.nominalQ !== item.nominalQ || old.termRevision !== item.termRevision) {
      diffs.push(`组成环 ${item.termId} 与预览不一致`)
    }
  }
  if (
    before.result.nominalQ !== after.result.nominalQ ||
    before.result.minQ !== after.result.minQ ||
    before.result.maxQ !== after.result.maxQ ||
    before.result.status !== after.result.status
  ) {
    diffs.push('计算结果与预览不一致')
  }
  if (before.drawingFingerprint !== after.drawingFingerprint) {
    diffs.push('图纸指纹与预览不一致')
  }
  return diffs
}

export class ChangeService {
  private readonly deps: ChangeServiceDeps
  private readonly states = new Map<string, ChangeSessionState>()
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(deps: ChangeServiceDeps) {
    this.deps = deps
  }

  private nowIso(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString()
  }

  private id(): string {
    return (this.deps.newId ?? (() => randomUUID()))()
  }

  private stateOf(sessionId: string): ChangeSessionState {
    let state = this.states.get(sessionId)
    if (state === undefined) {
      state = { generation: 0, base: null, knownBases: new Map(), draft: null, requirementEdit: null, previews: new Map(), committed: new Map() }
      this.states.set(sessionId, state)
    }
    return state
  }

  /** 计算当前权威基准；检测到外部变化时单调推进 generation（改回也不回退）。 */
  private async currentBase(session: ProjectSession, state: ChangeSessionState): Promise<BaseDigest> {
    const computed = await computeBaseDigest(session.snapshot, {
      sessionId: session.sessionId,
      generation: state.generation,
      acceptedSeq: session.acceptedSeq,
    })
    if (state.base !== null && computed.token !== state.base.token) {
      state.generation += 1
      const advanced = await computeBaseDigest(session.snapshot, {
        sessionId: session.sessionId,
        generation: state.generation,
        acceptedSeq: session.acceptedSeq,
      })
      state.base = advanced
      this.rememberBase(state, advanced)
      return advanced
    }
    state.base = computed
    this.rememberBase(state, computed)
    return computed
  }

  private rememberBase(state: ChangeSessionState, digest: BaseDigest): void {
    state.knownBases.set(digest.token, digest)
    if (state.knownBases.size > 8) {
      const oldest = state.knownBases.keys().next().value
      if (oldest !== undefined) state.knownBases.delete(oldest)
    }
  }

  private async draftTokenOf(draft: DraftRecord): Promise<string> {
    return computeDraftToken({
      draftId: draft.draftId,
      draftRevision: draft.draftRevision,
      parameters: draft.parameters,
      bindings: draft.bindings,
      reason: draft.reason,
    })
  }

  private requireSession(sessionId: string): { session: ProjectSession } | { error: ChangeFailure } {
    const session = this.deps.projectService.getSession(sessionId)
    if (session === null) {
      return { error: { code: 'STALE_SESSION', message: '会话已失效，请重新打开项目' } }
    }
    return { session }
  }

  private draftValue(
    draft: DraftRecord,
    base: BaseDigest,
    draftToken: string,
    confirmationCleared: boolean,
    notice?: string,
  ): ChangeDraftValue {
    return {
      draftId: draft.draftId,
      draftRevision: draft.draftRevision,
      baseToken: base.token,
      draftToken,
      parameters: draft.parameters.map((parameter) => ({ ...parameter })),
      bindings: draft.bindings.map((binding) => ({ ...binding })),
      confirmationCleared,
      ...(notice === undefined ? {} : { notice }),
    }
  }

  /** 从正式聚合建立草稿参数（绑定只带记录，不带任何“已确认”结论）。 */
  private draftParametersFromFormal(
    snapshot: ProjectFileSnapshot,
  ): ProjectFileSpacerParameter[] {
    if (snapshot.project.parameters.length === 3) {
      return snapshot.project.parameters.map((parameter) => ({ ...parameter }))
    }
    const parsed = parseSpacerParameters({
      innerDiameter: '20.00',
      outerDiameter: '32.00',
      length: '12.00',
    })
    if (!parsed.ok) throw new ChangeError('INVALID_PARAMETER', parsed.message)
    return parsed.parameters.map((parameter) => ({
      ...parameter,
      parameterRevision: 1,
      reviewStatus: 'draft',
    }))
  }

  private ensureDraft(session: ProjectSession, state: ChangeSessionState, reason: string): DraftRecord {
    if (state.draft !== null) return state.draft
    const draft: DraftRecord = {
      draftId: `draft:${this.id()}`,
      draftRevision: 1,
      parameters: this.draftParametersFromFormal(session.snapshot),
      bindings: parameterBindingOf(session.snapshot).map((binding) => ({ ...binding })),
      reason,
      restoredFromRevisionId: null,
      sourceRevisionId: null,
      requirementRevisionId: session.snapshot.project.activeRequirementRevisionId,
    }
    state.draft = draft
    return draft
  }

  async stage(sessionId: string, request: ChangeStageRequest): Promise<ChangeResult<ChangeDraftValue>> {
    const found = this.requireSession(sessionId)
    if ('error' in found) return failure(found.error.code, found.error.message, found.error.detail)
    const { session } = found
    if (request.baseEditSeq !== session.acceptedSeq) {
      return failure(
        'STALE_EDIT',
        '编辑序号已过期，请基于最新状态重试',
        `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${request.baseEditSeq}`,
      )
    }
    const state = this.stateOf(sessionId)
    const parsed = parseSpacerParameters(request.inputs, {
      innerDiameter: request.sourceNotes?.innerDiameter,
      outerDiameter: request.sourceNotes?.outerDiameter,
      length: request.sourceNotes?.length,
    })
    if (!parsed.ok) {
      return failure('INVALID_PARAMETER', `${parsed.field}：${parsed.message}`, `${parsed.field}/${parsed.reason}`)
    }
    const formalByKey = new Map(session.snapshot.project.parameters.map((item) => [item.key, item]))
    const parameters: ProjectFileSpacerParameter[] = parsed.parameters.map((item) => {
      const formal = formalByKey.get(item.key)
      const note =
        request.sourceNotes?.[item.key] !== undefined
          ? request.sourceNotes[item.key]
          : formal?.sourceNote
      const engineeringChanged = formal === undefined ? true : formal.valueQ !== item.valueQ
      return {
        parameterId: item.parameterId,
        partId: item.partId,
        key: item.key,
        valueQ: item.valueQ,
        inputDecimals: item.inputDecimals,
        // 单调：只在工程值变化时 +1；同值往返不回退。
        parameterRevision: formal === undefined
          ? 1
          : engineeringChanged
            ? formal.parameterRevision + 1
            : formal.parameterRevision,
        reviewStatus: formal?.reviewStatus ?? 'draft',
        ...(note === undefined || note.trim() === '' ? {} : { sourceNote: note.trim() }),
      }
    })

    const existing = state.draft
    let bindings: ProjectFileParameterBindingLink[]
    if (request.bindings === undefined) {
      bindings =
        existing !== null
          ? existing.bindings.map((binding) => ({ ...binding }))
          : parameterBindingOf(session.snapshot).map((binding) => ({ ...binding }))
    } else {
      const now = this.nowIso()
      bindings = request.bindings.map((input) => {
        const previous = parameterBindingOf(session.snapshot).find(
          (binding) => binding.termId === input.termId && binding.parameterId === input.parameterId,
        )
        const fromDraft = existing?.bindings.find(
          (binding) => binding.termId === input.termId && binding.parameterId === input.parameterId,
        )
        return {
          kind: 'parameter-binding' as const,
          bindingId:
            fromDraft?.bindingId ?? previous?.bindingId ?? `binding:${this.id()}`,
          termId: input.termId,
          partId: input.partId,
          parameterId: input.parameterId,
          syncField: 'nominal' as const,
          createdAt: fromDraft?.createdAt ?? previous?.createdAt ?? now,
        }
      })
    }
    const refError = validateBindingRefs(session.snapshot, parameters, bindings)
    if (refError !== null) {
      return failure('INVALID_BINDING', refError)
    }

    const base = await this.currentBase(session, state)
    const draft: DraftRecord = {
      draftId: existing?.draftId ?? `draft:${this.id()}`,
      draftRevision: (existing?.draftRevision ?? 0) + 1,
      parameters,
      bindings,
      reason: request.reason.trim() === '' ? '参数变更' : request.reason.trim(),
      restoredFromRevisionId: existing?.restoredFromRevisionId ?? null,
      sourceRevisionId: existing?.sourceRevisionId ?? null,
      requirementRevisionId: session.snapshot.project.activeRequirementRevisionId,
    }
    state.draft = draft
    const token = await this.draftTokenOf(draft)
    return {
      ok: true,
      value: this.draftValue(
        draft,
        base,
        token,
        existing?.restoredFromRevisionId !== null && existing?.restoredFromRevisionId !== undefined,
      ),
    }
  }

  private groupsFor(
    session: ProjectSession,
    computation: ChangeComputation,
  ): ReviewGroups {
    const snapshot = session.snapshot
    return deriveReviewGroups(snapshot.project, {
      computation,
      availableBlobKeys: new Set(snapshot.attachments.map((item) => item.blobKey)),
      documents: snapshot.documents,
      revisions: snapshot.revisions,
      sourceBindings: snapshot.bindings,
    })
  }

  async preview(sessionId: string, baseToken: string, draftToken: string): Promise<ChangeResult<ChangePreviewValue>> {
    const found = this.requireSession(sessionId)
    if ('error' in found) return failure(found.error.code, found.error.message, found.error.detail)
    const { session } = found
    const state = this.stateOf(sessionId)
    if (state.draft === null) {
      return failure('STALE_DRAFT', '没有活动草稿，请先编辑参数')
    }
    const base = await this.currentBase(session, state)
    if (baseToken !== base.token) {
      const before = state.knownBases.get(baseToken) ?? null
      const changes = before === null ? [] : explainBaseChange(before, base)
      return failure(
        'STALE_BASE',
        '基准已变化，预览已过期，请重新预览',
        changes.length === 0
          ? '基准代数已推进（改后改回同样失效）'
          : `变化：${changes.map((item) => item.label).join('；')}`,
      )
    }
    const draft = state.draft
    const currentDraftToken = await this.draftTokenOf(draft)
    if (draftToken !== currentDraftToken) {
      return failure('STALE_DRAFT', '草稿已变化，预览已过期，请重新预览')
    }

    const revisionId = `rev-d-${this.id()}`
    let computation: ChangeComputation
    try {
      computation = computeChange(
        session.snapshot,
        { parameters: draft.parameters, bindings: draft.bindings },
        { revisionId, now: this.nowIso() },
      )
    } catch (error) {
      if (error instanceof ChangeError) {
        return failure(
          error.code === 'DRAWING_FAILED' ? 'INVALID_DRAWING' : error.code,
          error.message,
          error.detail,
        )
      }
      return failure('CALCULATION_FAILED', error instanceof Error ? error.message : String(error))
    }

    const previewId = `preview:${this.id()}`
    const createdAt = this.nowIso()
    const requirementCheck = await computeCandidateRequirementCheck({
      snapshot: session.snapshot,
      requirementRevisions: session.snapshot.project.requirementRevisions,
      activeRequirementRevisionId: session.snapshot.project.activeRequirementRevisionId,
      pendingEdit: state.requirementEdit,
      draft: {
        draftId: draft.draftId,
        draftRevision: draft.draftRevision,
        parameters: draft.parameters,
        bindings: draft.bindings,
      },
      baseRevisionId: session.snapshot.project.currentRevisionId,
      baseGeneration: state.generation,
      acceptedSeq: session.acceptedSeq,
      checkedAt: createdAt,
      checkId: `check-d-${revisionId}`,
      inputIssue: null,
    })
    if (!requirementCheck.ok) {
      return failure(
        requirementCheck.error.code,
        requirementCheck.error.message,
        requirementCheck.error.detail,
      )
    }
    const check = requirementCheck.value.check
    const candidate = buildCommitCandidate(session.snapshot, computation, {
      revisionId,
      analysisSnapshotId: `snapshot-d-${revisionId}`,
      createdAt,
      reason: draft.reason,
      restoredFromRevisionId: draft.restoredFromRevisionId,
      reauthenticateBindings: false,
    })
    const expectation = expectationOf(computation)
    expectation.pendingCount = candidate.analysisSnapshot.pendingCount
    const groups = this.groupsFor(session, computation)
    const previewToken = stableFingerprint({
      previewId,
      baseToken,
      draftToken,
      revisionId,
      expectation,
      drawingId: computation.drawing.record.drawingId,
      requirement: {
        revisionId: check.requirementRevisionId,
        status: check.status,
        fingerprint: check.inputFingerprint,
      },
    })

    state.previews.set(previewId, {
      previewId,
      previewToken,
      baseToken,
      draftToken,
      draftId: draft.draftId,
      draftRevision: draft.draftRevision,
      revisionId,
      createdAt,
      expectation,
      groups,
      requirementCheck: check,
      computation,
    })

    const value: ChangePreviewValue = {
      previewId,
      previewToken,
      baseToken,
      draftToken,
      revisionId,
      parameters: computation.parameters.map((parameter) => ({ ...parameter })),
      previousChain: computation.previousChain,
      chain: computation.chain,
      previousResult: computation.previousResult,
      result: computation.result,
      parameterDiffs: computation.parameterDiffs,
      termDiffs: computation.termDiffs,
      affectedTermIds: computation.affectedTermIds,
      unboundTermIds: computation.unboundTermIds,
      drawing: {
        record: { ...computation.drawing.record },
        left: computation.drawing.previousData,
        right: computation.drawing.data,
        leftProblem: computation.drawing.previousProblem,
      },
      review: candidate.analysisSnapshot.review,
      groups,
      blockers: [],
    }
    return { ok: true, value }
  }

  /** 供 IPC 层做幂等/队列；真正提交序列化在 apply 内。 */
  private enqueue<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.queues.set(
      sessionId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  async apply(request: {
    sessionId: string
    baseToken: string
    draftToken: string
    previewId: string
    previewToken: string
    requestId: string
    reason: string
  }): Promise<ChangeResult<ChangeApplyValue>> {
    return this.enqueue(request.sessionId, async () => {
      const found = this.requireSession(request.sessionId)
      if ('error' in found) return failure(found.error.code, found.error.message, found.error.detail)
      const { session } = found
      const state = this.stateOf(session.sessionId)
      const committed = state.committed.get(request.requestId)
      if (committed !== undefined) {
        return { ok: true, value: committed }
      }
      if (state.draft === null) {
        return failure('STALE_DRAFT', '没有活动草稿，请重新编辑并预览')
      }
      const draft = state.draft
      const base = await this.currentBase(session, state)
      if (request.baseToken !== base.token) {
        const changes = state.knownBases.has(request.baseToken)
          ? explainBaseChange(state.knownBases.get(request.baseToken)!, base)
          : []
        return failure(
          'STALE_BASE',
          '基准已变化，旧确认请求已拒绝；草稿已保留',
          changes.length === 0
            ? '基准代数已推进（改后改回同样失效）'
            : `变化：${changes.map((item) => item.label).join('；')}`,
        )
      }
      const currentDraftToken = await this.draftTokenOf(draft)
      if (request.draftToken !== currentDraftToken) {
        return failure(
          'STALE_DRAFT',
          '草稿已变化，旧确认请求已拒绝；当前草稿已保留',
        )
      }
      const preview = state.previews.get(request.previewId)
      if (preview === undefined) {
        return failure('STALE_PREVIEW', '预览不存在或已失效，请重新预览')
      }
      if (
        preview.previewToken !== request.previewToken ||
        preview.baseToken !== request.baseToken ||
        preview.draftToken !== request.draftToken ||
        preview.draftId !== draft.draftId ||
        preview.draftRevision !== draft.draftRevision
      ) {
        return failure('STALE_PREVIEW', '预览与当前基准/草稿不匹配，请重新预览')
      }

      // 关键：从当前草稿重新计算，绝不复用 preview 里的结果。
      // commitRecomputedChange 同时重算条款检查并与预览指纹比对；旧检查不得提交。
      const createdAt = this.nowIso()
      const reason = request.reason.trim() === '' ? draft.reason : request.reason.trim()
      const recomputedCommit = await commitRecomputedChange({
        snapshot: session.snapshot,
        draft: {
          draftId: draft.draftId,
          draftRevision: draft.draftRevision,
          parameters: draft.parameters,
          bindings: draft.bindings,
        },
        requirementRevisions: session.snapshot.project.requirementRevisions,
        activeRequirementRevisionId: session.snapshot.project.activeRequirementRevisionId,
        pendingEdit: state.requirementEdit,
        previewCheck: preview.requirementCheck,
        baseRevisionId: session.snapshot.project.currentRevisionId,
        baseGeneration: state.generation,
        acceptedSeq: session.acceptedSeq,
        checkedAt: createdAt,
        checkId: `check-commit-${preview.revisionId}`,
        revisionId: preview.revisionId,
        analysisSnapshotId: `snapshot-d-${preview.revisionId}`,
        reason,
        restoredFromRevisionId: draft.restoredFromRevisionId,
      })
      if (!recomputedCommit.ok) {
        return failure(
          recomputedCommit.error.code,
          recomputedCommit.error.message,
          recomputedCommit.error.detail,
          recomputedCommit.error.reasonCodes,
        )
      }
      const computation = recomputedCommit.value.computation
      const candidate = recomputedCommit.value.candidate
      const recomputed = expectationOf(computation)
      recomputed.pendingCount = preview.expectation.pendingCount
      const mismatches = expectationDiff(preview.expectation, recomputed)
      if (mismatches.length > 0) {
        return failure(
          'STALE_PREVIEW',
          '确认重算结果与已展示预览不一致，已拒绝提交；请重新预览',
          mismatches.join('；'),
        )
      }

      let targetPath: string | null = null
      let overwriteFingerprint: string | null = null
      if (session.path === null) {
        if (this.deps.pickSaveTarget === undefined) {
          return failure('INVALID_REQUEST', '当前项目尚未保存过，需要先选择保存位置')
        }
        targetPath = await this.deps.pickSaveTarget(`${session.snapshot.project.name}.cunlian`)
        if (targetPath === null) {
          return failure('CANCELLED', '已取消选择保存位置；草稿与编辑内容仍保留')
        }
        const existing = await this.deps.projectService.fingerprint(targetPath)
        if (existing !== null) {
          const confirmed = await this.deps.confirmOverwrite?.(targetPath) ?? false
          if (!confirmed) {
            return failure('CANCELLED', '已取消覆盖已有文件；草稿与编辑内容仍保留')
          }
        }
        overwriteFingerprint = existing
      }

      // 最终 CAS：任何 await（对话框/编码/临时文件）期间基准或草稿变化都拒绝。
      const expectedStamp = snapshotStamp(session.snapshot)
      const expectedDraftRevision = draft.draftRevision
      const expectedAccepted = session.acceptedSeq
      const guard = (): string | null => {
        if (session.acceptedSeq !== expectedAccepted) {
          return `会话编辑序号变化（acceptedSeq=${session.acceptedSeq}）`
        }
        if (snapshotStamp(session.snapshot) !== expectedStamp) {
          return '正式聚合在提交期间发生变化'
        }
        const current = state.draft
        if (current === null || current.draftRevision !== expectedDraftRevision) {
          return '草稿在提交期间发生变化'
        }
        return null
      }

      const committedResult = await this.deps.projectService.commitCandidate(session.sessionId, {
        baseEditSeq: expectedAccepted,
        candidate: candidate.snapshot,
        targetPath,
        overwriteFingerprint,
        guard,
      })
      if (!committedResult.ok) {
        if (
          committedResult.error.code === 'VERIFY_FAILED' &&
          committedResult.error.detail?.startsWith('STALE_BASE:')
        ) {
          return failure(
            'STALE_BASE',
            '提交前基准已变化，已拒绝写入；草稿保留',
            committedResult.error.detail,
          )
        }
        return failure(
          committedResult.error.code,
          `${committedResult.error.message}；编辑内容仍可继续处理`,
          committedResult.error.detail,
        )
      }

      const current = this.deps.projectService.getSession(session.sessionId)
      if (current === null) {
        return failure('STALE_SESSION', '会话已失效，请重新打开项目')
      }
      // 正式版本已提交；恢复草稿清理失败只影响下次恢复入口，不能否认提交。
      await this.deps.recovery.discard(current.sessionId)
      const warnings = [...committedResult.value.warnings]
      const value: ChangeApplyValue = {
        revisionId: preview.revisionId,
        acceptedSeq: committedResult.value.acceptedSeq,
        savedSeq: committedResult.value.acceptedSeq,
        snapshot: toSnapshotDto(current.snapshot),
        path: committedResult.value.path,
        fingerprint: committedResult.value.fingerprint,
        analysisSnapshotId: candidate.analysisSnapshot.id,
        recovery: 'none',
        warnings,
      }
      state.committed.set(request.requestId, value)
      state.draft = null
      state.previews.clear()
      state.generation += 1
      state.base = null
      return { ok: true, value }
    })
  }

  async bind(sessionId: string, request: ChangeBindRequest): Promise<ChangeResult<ChangeDraftValue>> {
    const found = this.requireSession(sessionId)
    if ('error' in found) return failure(found.error.code, found.error.message, found.error.detail)
    const { session } = found
    if (request.baseEditSeq !== session.acceptedSeq) {
      return failure('STALE_EDIT', '编辑序号已过期，请基于最新状态重试')
    }
    if (request.partId !== SPACER_PART_ID) {
      return failure('INVALID_BINDING', '本版只支持隔套参数绑定')
    }
    const state = this.stateOf(sessionId)
    const draft = this.ensureDraft(session, state, request.reason.trim() || '绑定参数')
    const parameter = draft.parameters.find((item) => item.parameterId === request.parameterId)
    if (parameter === undefined) {
      return failure('INVALID_BINDING', '参数不存在', request.parameterId)
    }
    if (parameter.partId !== request.partId) {
      return failure('INVALID_BINDING', '参数不属于给定部件')
    }
    if (!session.snapshot.project.dimensionChain.terms.some((term) => term.id === request.termId)) {
      return failure('INVALID_BINDING', '组成环不存在', request.termId)
    }
    const existing = draft.bindings.find((binding) => binding.termId === request.termId)
    if (existing !== undefined) {
      if (existing.parameterId === request.parameterId && existing.partId === request.partId) {
        const base = await this.currentBase(session, state)
        return {
          ok: true,
          value: this.draftValue(draft, base, await this.draftTokenOf(draft), false),
        }
      }
      if (request.replaceBindingId !== existing.bindingId) {
        return failure(
          'INVALID_BINDING',
          '该组成环已绑定参数；替换必须显式给出旧 bindingId',
          existing.bindingId,
        )
      }
    }
    const binding: ProjectFileParameterBindingLink = {
      kind: 'parameter-binding',
      bindingId: existing?.bindingId ?? `binding:${this.id()}`,
      termId: request.termId,
      partId: request.partId,
      parameterId: request.parameterId,
      syncField: 'nominal',
      createdAt: existing?.createdAt ?? this.nowIso(),
    }
    const bindings = [
      ...draft.bindings.filter((item) => item.termId !== request.termId),
      binding,
    ]
    const refError = validateBindingRefs(session.snapshot, draft.parameters, bindings)
    if (refError !== null) return failure('INVALID_BINDING', refError)
    draft.bindings = bindings
    draft.draftRevision += 1
    draft.reason = request.reason.trim() || draft.reason
    const base = await this.currentBase(session, state)
    return { ok: true, value: this.draftValue(draft, base, await this.draftTokenOf(draft), false) }
  }

  async unbind(sessionId: string, request: ChangeUnbindRequest): Promise<ChangeResult<ChangeDraftValue>> {
    const found = this.requireSession(sessionId)
    if ('error' in found) return failure(found.error.code, found.error.message, found.error.detail)
    const { session } = found
    if (request.baseEditSeq !== session.acceptedSeq) {
      return failure('STALE_EDIT', '编辑序号已过期，请基于最新状态重试')
    }
    const state = this.stateOf(sessionId)
    const draft = this.ensureDraft(session, state, request.reason.trim() || '解除参数绑定')
    if (!draft.bindings.some((binding) => binding.bindingId === request.bindingId)) {
      return failure('INVALID_BINDING', '绑定不存在', request.bindingId)
    }
    draft.bindings = draft.bindings.filter((binding) => binding.bindingId !== request.bindingId)
    draft.draftRevision += 1
    draft.reason = request.reason.trim() || draft.reason
    const base = await this.currentBase(session, state)
    return { ok: true, value: this.draftValue(draft, base, await this.draftTokenOf(draft), false) }
  }

  async restore(sessionId: string, request: ChangeRestoreRequest): Promise<ChangeResult<ChangeRestoreValue>> {
    const found = this.requireSession(sessionId)
    if ('error' in found) return failure(found.error.code, found.error.message, found.error.detail)
    const { session } = found
    const state = this.stateOf(sessionId)
    const base = await this.currentBase(session, state)
    if (request.baseToken !== base.token) {
      const changes = state.knownBases.has(request.baseToken)
        ? explainBaseChange(state.knownBases.get(request.baseToken)!, base)
        : []
      return failure(
        'STALE_BASE',
        '基准已变化，请重新打开版本历史后再恢复',
        changes.map((item) => item.label).join('；'),
      )
    }
    const source: ProjectFileRevision | undefined = session.snapshot.fileRevisions.find(
      (revision) => revision.revisionId === request.sourceRevisionId,
    )
    if (source === undefined) {
      return failure('NOT_FOUND', '来源版本不存在', request.sourceRevisionId)
    }
    const sourceProject = source.project
    const sourceParameters =
      'parameters' in sourceProject && Array.isArray(sourceProject.parameters)
        ? (sourceProject.parameters as ProjectFileSpacerParameter[])
        : []
    if (sourceParameters.length !== 3) {
      return failure(
        'INVALID_REQUEST',
        '该版本没有隔套参数，不能恢复参数草稿（未提供“只恢复尺寸链”路径）',
        `schema=${String(sourceProject.schemaVersion)}`,
      )
    }
    const formalByKey = new Map(session.snapshot.project.parameters.map((item) => [item.key, item]))
    const parameters: ProjectFileSpacerParameter[] = sourceParameters.map((parameter) => {
      const formal = formalByKey.get(parameter.key)
      const changed = formal === undefined || formal.valueQ !== parameter.valueQ
      return {
        ...parameter,
        // 版本号只能前进：恢复不能把旧 parameterRevision 带回来让旧凭据复活。
        parameterRevision:
          formal === undefined
            ? 1
            : changed
              ? formal.parameterRevision + 1
              : formal.parameterRevision,
        reviewStatus: formal?.reviewStatus ?? 'draft',
      }
    })
    const sourceBindings = Array.isArray(sourceProject.dimensionLinks)
      ? (sourceProject.dimensionLinks as ProjectFileSnapshot['project']['dimensionLinks'])
          .filter((link): link is ProjectFileParameterBindingLink => link.kind === 'parameter-binding')
          .map((binding) => ({ ...binding }))
      : []
    const draft: DraftRecord = {
      draftId: `draft:${this.id()}`,
      draftRevision: 1,
      parameters,
      bindings: sourceBindings,
      reason: request.reason.trim() || `从版本 ${request.sourceRevisionId} 恢复`,
      restoredFromRevisionId: request.sourceRevisionId,
      sourceRevisionId: request.sourceRevisionId,
      requirementRevisionId: session.snapshot.project.activeRequirementRevisionId,
    }
    state.draft = draft
    state.previews.clear()
    const notice =
      '已按该版本生成新草稿：继承绑定记录，不继承当前确认；旧版确认只作为历史证据保留，需要重新预览并确认。'
    return {
      ok: true,
      value: {
        draftId: draft.draftId,
        draftRevision: draft.draftRevision,
        baseToken: base.token,
        draftToken: await this.draftTokenOf(draft),
        restoredFromRevisionId: request.sourceRevisionId,
        parameters: parameters.map((parameter) => ({ ...parameter })),
        bindings: sourceBindings,
        confirmationCleared: true,
        notice,
      },
    }
  }

  async compare(sessionId: string, request: ChangeCompareRequest): Promise<ChangeResult<ChangeCompareValueResponse>> {
    const found = this.requireSession(sessionId)
    if ('error' in found) return failure(found.error.code, found.error.message, found.error.detail)
    const { session } = found
    const snapshot = session.snapshot

    let right: DrawingData
    if (request.rightDraftToken !== undefined) {
      const state = this.stateOf(sessionId)
      if (state.draft === null) {
        return failure('STALE_DRAFT', '没有活动草稿')
      }
      if (request.rightDraftToken !== (await this.draftTokenOf(state.draft))) {
        return failure('STALE_DRAFT', '草稿已变化，请重新比较')
      }
      try {
        right = buildSpacerDrawing({
          projectId: snapshot.project.id,
          revisionId: `compare-draft-${state.draft.draftRevision}`,
          drawingId: snapshot.project.drawings[0]?.drawingId ?? `drawing:${snapshot.project.id}:spacer`,
          parameters: state.draft.parameters,
          scale: snapshot.project.drawings[0]?.scale ?? DEFAULT_DRAWING_SCALE,
          frameFields: snapshot.project.drawings[0]?.frameFields ?? DEFAULT_FRAME_FIELDS,
        })
      } catch (error) {
        return failure('INVALID_DRAWING', error instanceof Error ? error.message : String(error))
      }
    } else {
      const rebuilt = rebuildDrawingFromProject(snapshot.project)
      if (!rebuilt.ok) {
        return failure('NO_DRAWING', rebuilt.message, rebuilt.detail)
      }
      right = rebuilt.data
    }

    const leftRevisionId = request.leftRevisionId ?? snapshot.project.currentRevisionId
    const leftRevision = snapshot.fileRevisions.find(
      (revision) => revision.revisionId === leftRevisionId,
    )
    if (leftRevision === undefined) {
      return failure('NOT_FOUND', '左图版本不存在', leftRevisionId)
    }
    const leftProject = leftRevision.project
    const leftParameters =
      'parameters' in leftProject && Array.isArray(leftProject.parameters)
        ? (leftProject.parameters as ProjectFileSpacerParameter[])
        : []
    const leftRecord =
      'drawings' in leftProject && Array.isArray(leftProject.drawings) && leftProject.drawings.length > 0
        ? (leftProject.drawings[0] as ProjectFileSnapshot['project']['drawings'][number])
        : null
    if (leftRecord === null) {
      return {
        ok: true,
        value: compareDrawings(null, {
          label: '当前',
          revisionId: right.revisionId,
          drawingId: right.drawingId,
          templateVersion: right.templateVersion,
          scale: right.scale,
          data: right,
        }, `版本 ${leftRevisionId} 没有图纸记录`),
      }
    }
    if (leftParameters.length !== 3) {
      return {
        ok: true,
        value: compareDrawings(null, {
          label: '当前',
          revisionId: right.revisionId,
          drawingId: right.drawingId,
          templateVersion: right.templateVersion,
          scale: right.scale,
          data: right,
        }, `版本 ${leftRevisionId} 缺少隔套参数，不能重建旧图`),
      }
    }
    const input: DrawingGenerationInput = {
      drawingId: leftRecord.drawingId,
      partId: leftRecord.partId,
      templateId: leftRecord.templateId,
      templateVersion: leftRecord.templateVersion,
      drawingDataVersion: leftRecord.drawingDataVersion,
      projectId: leftProject.id,
      revisionId: leftRecord.revisionId,
      parameters: leftParameters.map((parameter) => ({
        parameterId: parameter.parameterId,
        partId: parameter.partId,
        key: parameter.key,
        valueQ: parameter.valueQ,
        inputDecimals: parameter.inputDecimals,
        reviewStatus: parameter.reviewStatus,
        ...(parameter.sourceNote === undefined ? {} : { sourceNote: parameter.sourceNote }),
      })),
      scale: leftRecord.scale,
      frameFields: leftRecord.frameFields,
    }
    const rebuiltLeft = rebuildFromGenerationInput(input, leftRecord.dataFingerprint)
    const rightSide = {
      label: '当前',
      revisionId: right.revisionId,
      drawingId: right.drawingId,
      templateVersion: right.templateVersion,
      scale: right.scale,
      data: right,
    }
    if (!rebuiltLeft.ok) {
      return {
        ok: true,
        value: compareDrawings(null, rightSide, `${rebuiltLeft.reason}（版本 ${leftRevisionId}）`),
      }
    }
    return {
      ok: true,
      value: compareDrawings(
        {
          label: `版本 ${leftRevisionId}`,
          revisionId: leftRevisionId,
          drawingId: rebuiltLeft.data.drawingId,
          templateVersion: rebuiltLeft.data.templateVersion,
          scale: rebuiltLeft.data.scale,
          data: rebuiltLeft.data,
        },
        rightSide,
        null,
      ),
    }
  }

  resetSession(sessionId: string): void {
    this.states.delete(sessionId)
    this.queues.delete(sessionId)
  }
}
