/** V4 stage 1: model-free, draft-only trusted engineering tools. */
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { planApplication, isDraftSuperseded, type ExtractionDraft } from '../../src/document-extraction'
import { mapConfirmed, MappingError } from '../../src/agent-tools/mapConfirmed'
import { stableFingerprint } from '../../src/revisions/canonical'
import { calculateChain } from '../../src/domain/calculate'
import { ChangeError, computeChange } from '../../src/revisions/compute'
import { commitRecomputedChange } from '../../src/requirements/commit'
import { computeCandidateRequirementCheck } from '../../src/requirements/check'
import { resolveRequirementRevisionSource } from '../../src/requirements/history'
import type { RequirementCheck } from '../../src/requirements/types'
import type { ChangeComputation } from '../../src/revisions/types'
import { tryParseMm } from '../../src/domain/units'
import { SPACER_PARAMETER_KEYS } from '../../src/drawing/types'
import { rebuildDrawingFromProject } from '../../src/drawing/rebuildDrawing'
import { decodeProjectFile } from '../../src/project-file/codec'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import type {
  AgentContextValue,
  AgentDraftValue,
  AgentParameterChangeRequest,
  AgentPreviewRequest,
  AgentPreviewSummary,
  ApplyConfirmedInputsRequest,
  CommitApprovedDraftRequest,
  CommitApprovedDraftValue,
  LocateEvidenceRequest,
  LocateEvidenceValue,
  ToolErrorCode,
  ToolResult,
} from '../shared/contracts'
import type { ApprovalStore } from './approvalStore'
import type { ProjectService, ProjectSession } from './projectService'
import type { RecoveryStore } from './recovery'
import type { SessionController } from './sessionController'
import { nodeWorkspaceOps, type WorkspaceOps } from './workspaceJson'

interface PlanCredential {
  windowId: number; sessionId: string; draftId: string; draftDigest: string; baseDigest: string; expires: number
}
interface DraftFile {
  schemaVersion: 1
  projectId: string
  planKey: string
  requestKey: string
  applications: Record<string, { requestKey: string; value: AgentDraftValue }>
  sourceDraftId: string
  sourceDigest: string
  baseDigest: string
  recovery: { basePath: string | null; baseFingerprint: string | null }
  draft: AgentDraftValue
}

/** 主进程内的预览记录；确认授权与提交都必须以它为准，而不是渲染进程回传的摘要。 */
interface AgentPreviewRecord {
  previewId: string
  previewFingerprint: string
  windowId: number
  sessionId: string
  projectId: string
  draftId: string
  draftRevision: number
  baseRevisionId: string
  requirementRevisionId: string | null
  computation: ChangeComputation
  check: RequirementCheck
  requirementProposalPending: boolean
  createdAt: string
  expiresAt: string
}

const PREVIEW_TTL_MS = 10 * 60 * 1000

export interface AgentToolDeps {
  controller: SessionController
  projectService: ProjectService
  recovery: RecoveryStore
  rootDir: string
  ops?: WorkspaceOps
  /** 阶段 3 才有；阶段 1/2 的只读工具路径不依赖它。 */
  approvals?: ApprovalStore
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const engineeringBasis = (snapshot: ProjectFileSnapshot) => {
  const p = snapshot.project
  return stableFingerprint({ revisionId: p.currentRevisionId, chain: p.dimensionChain, parameters: p.parameters, links: p.dimensionLinks, parts: p.parts, drawings: p.drawings, requirements: p.requirementRevisions, activeRequirement: p.activeRequirementRevisionId })
}
const stamp = (snapshot: ProjectFileSnapshot) => stableFingerprint({ ...snapshot, attachments: snapshot.attachments.map(a => ({ blobKey: a.blobKey, digest: createHash('sha256').update(a.bytes).digest('hex') })) })

/**
 * 预览指纹：覆盖提交所需的全部身份与数值，不含每次生成都会变的 previewId/时间。
 * 提交时从磁盘草稿重算得到同一函数输出，与授权记录里的指纹逐字比较。
 */
function previewFingerprintOf(input: {
  projectId: string
  draftId: string
  draftRevision: number
  baseRevisionId: string
  computation: ChangeComputation
  check: RequirementCheck
}): string {
  return stableFingerprint({
    projectId: input.projectId,
    draftId: input.draftId,
    draftRevision: input.draftRevision,
    baseRevisionId: input.baseRevisionId,
    parameters: input.computation.parameters.map(parameter => ({
      parameterId: parameter.parameterId,
      key: parameter.key,
      valueQ: parameter.valueQ,
      inputDecimals: parameter.inputDecimals,
      parameterRevision: parameter.parameterRevision,
      sourceNote: parameter.sourceNote ?? '',
    })),
    terms: input.computation.chain.terms.map(term => ({
      id: term.id,
      nominalQ: term.nominalQ,
      lowerDeviationQ: term.lowerDeviationQ,
      upperDeviationQ: term.upperDeviationQ,
      sign: term.sign,
      termRevision: term.termRevision,
    })),
    result: {
      nominalQ: input.computation.result.nominalQ,
      minQ: input.computation.result.minQ,
      maxQ: input.computation.result.maxQ,
      status: input.computation.result.status,
    },
    // 不包含 drawingFingerprint：图纸 record 带每次提交都会变的 revisionId；
    // 数值内容已由参数/环/结果覆盖。
    requirementRevisionId: input.check.requirementRevisionId,
    requirementStatus: input.check.status,
    requirementInputFingerprint: input.check.inputFingerprint,
  })
}

function errorOf(error: unknown): { code: ToolErrorCode; message: string; causeCode?: string } {
  if (error instanceof MappingError) return { code: error.code, message: error.message }
  if (error instanceof ChangeError) return { code: 'CONSTRAINT_VIOLATED', message: error.message, causeCode: error.code }
  return { code: 'TOOL_FAILED', message: '工程工具执行失败' }
}

export class AgentToolService {
  private readonly credentials = new Map<string, PlanCredential>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly previews = new Map<string, AgentPreviewRecord>()
  private readonly latestPreviewBySession = new Map<string, string>()
  private readonly ops: WorkspaceOps
  private readonly deps: AgentToolDeps
  constructor(deps: AgentToolDeps) { this.deps = deps; this.ops = deps.ops ?? nodeWorkspaceOps }

  /** Called ONLY after the existing UI extraction:decide handler, never an Agent command. */
  async issueAfterDecision(windowId: number, draftId: string): Promise<string | null> {
    const session = this.deps.controller.sessionFor(windowId)
    if (session === null) return null
    const flushed = await this.deps.recovery.flush(session.sessionId)
    if (flushed.state === 'failed') return null
    const saved = await this.readDecisions(session)
    if (!saved.ok) return null
    const draft = saved.value.project.extractionDrafts.find(d => d.draftId === draftId)
    const current = session.snapshot.project.extractionDrafts.find(d => d.draftId === draftId)
    if (!draft || !current || stableFingerprint(draft) !== stableFingerprint(current)) return null
    const token = randomUUID()
    // Bound the lifetime and retained credentials; a UI reconfirmation can issue another token.
    for (const [key, value] of this.credentials) if (value.expires < Date.now()) this.credentials.delete(key)
    if (this.credentials.size >= 200) this.credentials.delete(this.credentials.keys().next().value!)
    this.credentials.set(token, { windowId, sessionId: session.sessionId, draftId, draftDigest: stableFingerprint(draft), baseDigest: engineeringBasis(session.snapshot), expires: Date.now() + 600_000 })
    return token
  }

  private async readDecisions(session: ProjectSession) {
    const recovery = await this.deps.recovery.readPersisted(session.sessionId)
    if (recovery.ok) return recovery
    // A normal Save discards the recovery copy. Then re-read the actual project file,
    // but never fall back to an older saved decision while unsaved edits exist.
    if (session.path === null || session.savedSeq !== session.acceptedSeq) return recovery
    const disk = await this.deps.projectService.readProjectBytes(session.path)
    if (!disk.ok) return disk
    if (disk.value.fingerprint !== session.fingerprint) return { ok: false as const, error: { code: 'EXTERNAL_MODIFIED' as const, message: '项目文件在外部已变化' } }
    const decoded = await decodeProjectFile(disk.value.bytes)
    return decoded.ok ? { ok: true as const, value: decoded.value.snapshot } : decoded
  }

  filePath(projectId: string): string { return path.join(this.deps.rootDir, 'agent-inputs', `${hash(projectId)}.json`) }

  /**
   * 阶段 3 侧栏演示：在当前项目上准备一份“与正式参数相同”的 Agent 草稿。
   * 只写应用工作区的草稿文件，不改项目；不伪造任何数值（参数直接取自正式版本）。
   */
  async prepareDemoDraft(windowId: number): Promise<ToolResult<{ draftId: string; baseRevisionId: string }>> {
    const requestId = randomUUID()
    const session = this.deps.controller.sessionFor(windowId)
    if (session === null) {
      return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' }
    }
    const objectVersion = session.snapshot.project.currentRevisionId
    const task = async (): Promise<ToolResult<{ draftId: string; baseRevisionId: string }>> => {
      try {
        if (this.deps.controller.sessionFor(windowId) !== session) throw new MappingError('STALE_BASE', '活动项目已切换')
        const revisionId = session.snapshot.project.currentRevisionId
        const stored = await this.read(session)
        if (stored !== null && stored.draft.baseRevisionId === revisionId && stored.baseDigest === engineeringBasis(session.snapshot)) {
          return { ok: true, data: { draftId: stored.draft.draftId, baseRevisionId: revisionId }, requestId, objectVersion }
        }
        const project = session.snapshot.project
        const parameters = structuredClone(project.parameters)
        const expectedKeys = [...SPACER_PARAMETER_KEYS].sort().join(',')
        if (parameters.length !== SPACER_PARAMETER_KEYS.length || parameters.map(item => item.key).sort().join(',') !== expectedKeys) {
          throw new MappingError('INVALID_INPUT', '离线演示需要含隔套三参数（内径/外径/长度）的项目')
        }
        const bindings = project.dimensionLinks
          .filter((link): link is Extract<typeof link, { kind: 'parameter-binding' }> => link.kind === 'parameter-binding')
          .map(link => ({ ...link }))
        const before = stamp(session.snapshot)
        const draftId = `agent-draft-${randomUUID()}`
        const computation = computeChange(session.snapshot, { parameters, bindings }, { revisionId: draftId, now: new Date().toISOString() })
        computation.previousChain = structuredClone(project.dimensionChain)
        computation.previousResult = calculateChain(project.dimensionChain)
        const value = this.value({ chain: computation.chain, parameters: computation.parameters, bindings: computation.bindings, requirementEdit: null, missing: [], computation }, draftId, revisionId)
        await this.write(session, {
          schemaVersion: 1,
          projectId: project.id,
          planKey: 'demo',
          requestKey: 'demo',
          applications: {},
          sourceDraftId: 'demo',
          sourceDigest: 'demo',
          baseDigest: engineeringBasis(session.snapshot),
          recovery: { basePath: session.path, baseFingerprint: session.fingerprint },
          draft: value,
        }, () => this.deps.controller.sessionFor(windowId) === session && stamp(session.snapshot) === before)
        return { ok: true, data: { draftId, baseRevisionId: revisionId }, requestId, objectVersion }
      } catch (error) {
        const mapped = errorOf(error)
        return { ok: false, code: mapped.code, message: mapped.message, requestId, objectVersion, details: mapped.causeCode === undefined ? undefined : { causeCode: mapped.causeCode } }
      }
    }
    return this.enqueue(session.sessionId, task)
  }

  /** 最近一次预览摘要；只返回主进程记录，不接受渲染进程回传的摘要。 */
  previewSummary(windowId: number): ToolResult<AgentPreviewSummary | null> {
    const requestId = randomUUID()
    const session = this.deps.controller.sessionFor(windowId)
    if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' }
    const previewId = this.latestPreviewBySession.get(session.sessionId)
    const record = previewId === undefined ? undefined : this.previews.get(previewId)
    if (record === undefined) return { ok: true, data: null, requestId, objectVersion: session.snapshot.project.currentRevisionId }
    if (Date.parse(record.expiresAt) <= Date.now()) {
      this.previews.delete(record.previewId)
      this.latestPreviewBySession.delete(session.sessionId)
      return { ok: true, data: null, requestId, objectVersion: session.snapshot.project.currentRevisionId }
    }
    return { ok: true, data: this.summaryOf(record), requestId, objectVersion: session.snapshot.project.currentRevisionId }
  }

  private summaryOf(record: AgentPreviewRecord): AgentPreviewSummary {
    const check = record.check
    return {
      previewId: record.previewId,
      previewFingerprint: record.previewFingerprint,
      draftId: record.draftId,
      draftRevision: record.draftRevision,
      baseRevisionId: record.baseRevisionId,
      requirementRevisionId: record.requirementRevisionId,
      parameters: record.computation.parameters.map(parameter => ({ key: parameter.key, valueQ: parameter.valueQ, inputDecimals: parameter.inputDecimals })),
      result: { minQ: record.computation.result.minQ, maxQ: record.computation.result.maxQ, status: record.computation.result.status },
      requirement: record.requirementRevisionId === null ? null : {
        status: check.status,
        reasonCodes: [...check.reasonCodes],
        resultInterval: check.resultInterval === null ? null : { ...check.resultInterval },
        margins: check.margins === null ? null : { ...check.margins },
      },
      requirementProposalPending: record.requirementProposalPending,
      expiresAt: record.expiresAt,
    }
  }

  /** 界面确认动作签发授权；只返回 approvalId，不下发模型。 */
  async issueApproval(windowId: number, previewId: string): Promise<ToolResult<{ approvalId: string; expiresAt: string }>> {
    const requestId = randomUUID()
    const session = this.deps.controller.sessionFor(windowId)
    const objectVersion = session?.snapshot.project.currentRevisionId ?? 'unavailable'
    if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion }
    const record = this.previews.get(previewId)
    if (record === undefined || record.sessionId !== session.sessionId || record.windowId !== windowId || Date.parse(record.expiresAt) <= Date.now()) {
      return { ok: false, code: 'NOT_CONFIRMED', message: '预览不存在、已过期或不属于当前窗口，请重新预览', requestId, objectVersion }
    }
    const approvals = this.deps.approvals
    if (approvals === undefined) {
      return { ok: false, code: 'INVALID_INPUT', message: '授权服务未装配', requestId, objectVersion }
    }
    const issued = await approvals.issue({
      windowId,
      projectId: record.projectId,
      draftId: record.draftId,
      draftRevision: record.draftRevision,
      requirementRevisionId: record.requirementRevisionId,
      previewFingerprint: record.previewFingerprint,
      baseRevisionId: record.baseRevisionId,
    })
    if (!issued.ok) {
      return { ok: false, code: issued.code, message: issued.message, requestId, objectVersion, details: issued.causeCode === undefined ? undefined : { causeCode: issued.causeCode } }
    }
    return { ok: true, data: { approvalId: issued.record.approvalId, expiresAt: issued.record.expiresAt }, requestId, objectVersion }
  }

  /**
   * 可信提交：授权身份 → 基准 → **从磁盘草稿重算** → 预览指纹比对 → 条款门禁 → 原子提交。
   * 任何一步失败都不写正式项目；授权消费策略见 README（重算通过后、提交前消费）。
   */
  async commitApprovedDraft(windowId: number, request: CommitApprovedDraftRequest): Promise<ToolResult<CommitApprovedDraftValue>> {
    const requestId = randomUUID()
    const session = this.deps.controller.sessionFor(windowId)
    const objectVersion = session?.snapshot.project.currentRevisionId ?? 'unavailable'
    if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion }
    const approvals = this.deps.approvals
    if (approvals === undefined) return { ok: false, code: 'INVALID_INPUT', message: '授权服务未装配', requestId, objectVersion }

    const task = async (): Promise<ToolResult<CommitApprovedDraftValue>> => {
      const fail = (code: ToolErrorCode, message: string, causeCode?: string): ToolResult<never> =>
        ({ ok: false, code, message, requestId, objectVersion: session.snapshot.project.currentRevisionId, details: causeCode === undefined ? undefined : { causeCode } })
      const reserved = await approvals.reserve(request.approvalId, windowId)
      if (!reserved.ok) return fail(reserved.code, reserved.message, reserved.causeCode)
      const approval = reserved.record
      let consumed = false
      try {
        if (this.deps.controller.sessionFor(windowId) !== session) return fail('STALE_BASE', '活动项目已切换', 'SESSION_CHANGED')
        if (approval.projectId !== session.snapshot.project.id) return fail('NOT_CONFIRMED', '授权属于其他项目', 'PROJECT_MISMATCH')
        if (approval.draftId !== request.draftId) return fail('NOT_CONFIRMED', '授权对应的草稿身份不符', 'DRAFT_MISMATCH')
        if (approval.previewFingerprint !== request.previewFingerprint) return fail('NOT_CONFIRMED', '请求的预览指纹与授权记录不符', 'PREVIEW_MISMATCH')
        const revisionId = session.snapshot.project.currentRevisionId
        if (approval.baseRevisionId !== revisionId) return fail('STALE_BASE', '授权签发的正式基准已变化，请重新预览', 'BASE_CHANGED')

        const stored = await this.read(session)
        if (stored === null || stored.draft.draftId !== approval.draftId) return fail('NOT_CONFIRMED', '工程草稿不存在或身份不符', 'DRAFT_MISSING')
        if (stored.baseDigest !== engineeringBasis(session.snapshot)) return fail('STALE_BASE', '工程草稿基准已被独立编辑', 'ENGINEERING_BASE_CHANGED')
        const extraction = session.snapshot.project.extractionDrafts.find(item => item.draftId === stored.sourceDraftId)
        if (extraction !== undefined) {
          if (stableFingerprint(extraction) !== stored.sourceDigest) return fail('NOT_CONFIRMED', '来源决定已变化', 'STALE_DECISION')
          await this.checkedSource(session, extraction)
        }

        // 关键：从磁盘草稿重新计算，绝不复用预览结果。
        const now = new Date().toISOString()
        const commitRevisionId = `rev-a-${randomUUID()}`
        const candidateSnapshot: ProjectFileSnapshot = { ...session.snapshot, project: { ...session.snapshot.project, dimensionChain: stored.draft.chain } }
        const computation = computeChange(candidateSnapshot, { parameters: stored.draft.parameters, bindings: stored.draft.bindings }, { revisionId: commitRevisionId, now })
        computation.previousChain = structuredClone(session.snapshot.project.dimensionChain)
        computation.previousResult = calculateChain(session.snapshot.project.dimensionChain)
        const checkResult = await computeCandidateRequirementCheck({
          snapshot: candidateSnapshot,
          requirementRevisions: session.snapshot.project.requirementRevisions,
          activeRequirementRevisionId: session.snapshot.project.activeRequirementRevisionId,
          // Agent 草稿里的条款提案不是已确认条款；正式门禁只看活动条款版本。
          pendingEdit: null,
          draft: { draftId: stored.draft.draftId, draftRevision: stored.draft.draftRevision, parameters: stored.draft.parameters, bindings: stored.draft.bindings },
          baseRevisionId: revisionId,
          baseGeneration: 0,
          acceptedSeq: session.acceptedSeq,
          checkedAt: now,
          checkId: `check-a-${randomUUID()}`,
          inputIssue: null,
        })
        if (!checkResult.ok) {
          const code: ToolErrorCode = checkResult.error.code === 'CALCULATION_FAILED' ? 'TOOL_FAILED' : 'CONSTRAINT_VIOLATED'
          return fail(code, checkResult.error.message, checkResult.error.code)
        }
        const recomputedFingerprint = previewFingerprintOf({
          projectId: session.snapshot.project.id,
          draftId: stored.draft.draftId,
          draftRevision: stored.draft.draftRevision,
          baseRevisionId: revisionId,
          computation,
          check: checkResult.value.check,
        })
        // M14：授权绑定的预览指纹是唯一权威比对；删除它会让 S3-05 红。
        if (recomputedFingerprint !== approval.previewFingerprint) {
          return fail('STALE_PREVIEW', '提交重算结果与授权预览不一致，请重新预览并确认', 'PREVIEW_STALE')
        }
        // 防御性身份校验（排在指纹之后，错误码区分“不是同一版草稿”）。
        if (approval.draftRevision !== stored.draft.draftRevision) return fail('NOT_CONFIRMED', '草稿版本与授权不符', 'DRAFT_REVISION_MISMATCH')
        if (approval.requirementRevisionId !== checkResult.value.check.requirementRevisionId) return fail('NOT_CONFIRMED', '条款版本与授权不符', 'REQUIREMENT_REVISION_MISMATCH')

        const commit = await commitRecomputedChange({
          snapshot: candidateSnapshot,
          draft: { draftId: stored.draft.draftId, draftRevision: stored.draft.draftRevision, parameters: stored.draft.parameters, bindings: stored.draft.bindings },
          requirementRevisions: session.snapshot.project.requirementRevisions,
          activeRequirementRevisionId: session.snapshot.project.activeRequirementRevisionId,
          pendingEdit: null,
          previewCheck: checkResult.value.check,
          baseRevisionId: revisionId,
          baseGeneration: 0,
          acceptedSeq: session.acceptedSeq,
          checkedAt: now,
          checkId: `check-a-${randomUUID()}`,
          revisionId: commitRevisionId,
          analysisSnapshotId: `snapshot-a-${randomUUID()}`,
          reason: 'Agent 授权提交',
          restoredFromRevisionId: null,
        })
        if (!commit.ok) {
          const cause = commit.error.code
          if (cause === 'STALE_PREVIEW' || cause === 'STALE_DRAFT' || cause === 'STALE_REQUIREMENT') return fail('STALE_PREVIEW', commit.error.message, cause)
          if (cause === 'REQUIREMENT_PENDING_CONFIRMATION' || cause === 'REQUIREMENT_UNCHECKED') return fail('NOT_CONFIRMED', commit.error.message, cause)
          if (cause === 'CALCULATION_FAILED') return fail('TOOL_FAILED', commit.error.message, cause)
          return fail('CONSTRAINT_VIOLATED', commit.error.message, cause)
        }

        // 令牌策略：校验与重算通过后、写盘之前消费。写盘失败也不能重放同一授权。
        const eaten = await approvals.consume(approval.approvalId)
        if (!eaten.ok) return fail(eaten.code, eaten.message, eaten.causeCode)
        consumed = true

        const expectedAccepted = session.acceptedSeq
        const expectedStamp = stamp(session.snapshot)
        const expectedDraftRevision = stored.draft.draftRevision
        const committed = await this.deps.projectService.commitCandidate(session.sessionId, {
          baseEditSeq: expectedAccepted,
          candidate: commit.value.candidate.snapshot,
          guard: () => {
            if (this.deps.controller.sessionFor(windowId) !== session) return '活动项目已切换'
            if (session.acceptedSeq !== expectedAccepted) return `会话编辑序号变化（acceptedSeq=${session.acceptedSeq}）`
            if (stamp(session.snapshot) !== expectedStamp) return '正式聚合在提交期间发生变化'
            const current = this.previews.get(approval.approvalId)
            void current
            return stored.draft.draftRevision === expectedDraftRevision ? null : '草稿在提交期间发生变化'
          },
        })
        if (!committed.ok) {
          return fail('SAVE_FAILED', `${committed.error.message}；授权已消费，请重新预览确认`, committed.error.code)
        }
        for (const [key, preview] of this.previews) {
          if (preview.previewFingerprint === approval.previewFingerprint) this.previews.delete(key)
        }
        const latest = this.latestPreviewBySession.get(session.sessionId)
        if (latest !== undefined && this.previews.get(latest) === undefined) this.latestPreviewBySession.delete(session.sessionId)
        return {
          ok: true,
          data: {
            revisionId: commitRevisionId,
            acceptedSeq: committed.value.acceptedSeq,
            path: committed.value.path,
            fingerprint: committed.value.fingerprint,
            analysisSnapshotId: commit.value.candidate.analysisSnapshot.id,
            requirementStatus: session.snapshot.project.currentRequirementCheck?.status ?? null,
            warnings: committed.value.warnings,
          },
          requestId,
          objectVersion: commitRevisionId,
        }
      } catch (error) {
        const mapped = errorOf(error)
        return fail(mapped.code, mapped.message, mapped.causeCode)
      } finally {
        if (!consumed) approvals.release(approval.approvalId)
      }
    }
    return this.enqueue(session.sessionId, task)
  }

  /** §6 locateEvidence：只读定位；无证据时 INVALID_INPUT，不假装成功。 */
  locateEvidence(windowId: number, request: LocateEvidenceRequest): ToolResult<LocateEvidenceValue> {
    const requestId = randomUUID()
    const session = this.deps.controller.sessionFor(windowId)
    if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion: 'unavailable' }
    const objectVersion = session.snapshot.project.currentRevisionId
    const given = [request.requirementRevisionId, request.checkId, request.parameterId].filter(value => value !== undefined)
    if (given.length !== 1) return { ok: false, code: 'INVALID_INPUT', message: '必须且只能提供 requirementRevisionId / checkId / parameterId 之一', requestId, objectVersion }
    if (request.parameterId !== undefined) {
      const parameter = session.snapshot.project.parameters.find(item => item.parameterId === request.parameterId)
      if (parameter === undefined) return { ok: false, code: 'INVALID_INPUT', message: '参数不存在，无法定位', requestId, objectVersion }
      const termIds = session.snapshot.project.dimensionLinks.filter(link => link.kind === 'parameter-binding' && link.parameterId === parameter.parameterId).map(link => link.termId)
      const annotationIds: string[] = []
      let drawingId: string | null = null
      const rebuilt = rebuildDrawingFromProject(session.snapshot.project)
      for (const drawing of session.snapshot.project.drawings) {
        if (!drawing.parameterIds.includes(parameter.parameterId)) continue
        drawingId ??= drawing.drawingId
      }
      if (rebuilt.ok) {
        for (const annotation of rebuilt.data.annotations) {
          if (annotation.parameterId === parameter.parameterId) annotationIds.push(annotation.annotationId)
        }
      }
      return { ok: true, data: { kind: 'parameter', parameterId: parameter.parameterId, key: parameter.key, valueQ: parameter.valueQ, termIds, annotationIds, drawingId }, requestId, objectVersion }
    }

    let revisionId: string
    let checkId: string | null = null
    if (request.requirementRevisionId !== undefined) {
      revisionId = request.requirementRevisionId
    } else {
      const wanted = request.checkId!
      const current = session.snapshot.project.currentRequirementCheck
      if (current !== null && current.checkId === wanted) {
        if (current.requirementRevisionId === null) return { ok: false, code: 'INVALID_INPUT', message: '该检查没有条款来源可定位', requestId, objectVersion }
        revisionId = current.requirementRevisionId
        checkId = current.checkId
      } else {
        const revision = session.snapshot.fileRevisions.find(item => item.evidence?.checkId === wanted)
        if (revision === undefined || revision.evidence?.requirementRevisionId == null) {
          return { ok: false, code: 'INVALID_INPUT', message: '检查记录不存在，或没有可定位的条款来源', requestId, objectVersion }
        }
        revisionId = revision.evidence.requirementRevisionId
        checkId = wanted
      }
    }
    const resolved = resolveRequirementRevisionSource(session.snapshot, revisionId)
    if (resolved.location === null) {
      return { ok: false, code: 'INVALID_INPUT', message: resolved.issue?.message ?? '条款版本不存在，无法定位', requestId, objectVersion }
    }
    if (resolved.location.issue !== null) {
      return { ok: false, code: 'INVALID_INPUT', message: resolved.location.issue.message, requestId, objectVersion }
    }
    return {
      ok: true,
      data: {
        kind: 'requirement-source',
        requirementRevisionId: revisionId,
        checkId,
        revisionId: resolved.location.revisionId,
        page: resolved.location.page,
        rectPdf: resolved.location.rectPdf,
        pageBoxPdf: resolved.location.pageBoxPdf,
        label: resolved.location.label,
        sourceFileName: resolved.location.sourceFileName,
      },
      requestId,
      objectVersion,
    }
  }

  /** 与 run 相同的串行队列；新写路径不能绕过它。 */
  private enqueue<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.queues.set(sessionId, next)
    return next
  }

  private async read(session: ProjectSession): Promise<DraftFile | null> {
    const target = this.filePath(session.snapshot.project.id)
    const kind = await this.ops.statKind(target)
    if (kind === 'missing') return null
    if (kind !== 'file') throw new MappingError('TOOL_FAILED', '草稿不是常规文件')
    const bytes = await this.ops.readFile(target)
    if (bytes.length > 4 * 1024 * 1024) throw new MappingError('TOOL_FAILED', '草稿超过预算')
    const stored = JSON.parse(new TextDecoder().decode(bytes)) as { payload: DraftFile; digest: string }
    if (!stored.payload || stored.digest !== hash(JSON.stringify(stored.payload)) || stored.payload.schemaVersion !== 1 || stored.payload.projectId !== session.snapshot.project.id) {
      throw new MappingError('TOOL_FAILED', '恢复草稿身份或指纹不符')
    }
    return stored.payload
  }

  /** One rename is the commit point for BOTH draft and recovery metadata. No secondary index. */
  private async write(session: ProjectSession, payload: DraftFile, guard: () => boolean): Promise<void> {
    const target = this.filePath(session.snapshot.project.id)
    await this.ops.ensureDirectory(path.dirname(target))
    const previous = await this.ops.statKind(target) === 'missing' ? null : hash(Buffer.from(await this.ops.readFile(target)).toString('base64'))
    const bytes = new TextEncoder().encode(JSON.stringify({ payload, digest: hash(JSON.stringify(payload)) }))
    if (bytes.length > 4 * 1024 * 1024) throw new MappingError('SAVE_FAILED', '工程草稿超过4MiB预算，原草稿未改变')
    const temp = `${target}.${randomUUID()}.tmp`
    try {
      await this.ops.writeExclusive(temp, bytes)
      const back = await this.ops.readFile(temp)
      if (!Buffer.from(bytes).equals(Buffer.from(back))) throw new Error('草稿回读不一致')
      const current = await this.ops.statKind(target) === 'missing' ? null : hash(Buffer.from(await this.ops.readFile(target)).toString('base64'))
      if (!guard() || current !== previous) throw new MappingError('STALE_BASE', '写入前项目或草稿已变化')
      await this.ops.rename(temp, target)
    } catch (error) {
      if (error instanceof MappingError) throw error
      throw new MappingError('SAVE_FAILED', '工程草稿未保存，原项目与草稿未改变', { causeCode: (error as NodeJS.ErrnoException).code ?? 'WRITE_FAILED' })
    } finally {
      try { await this.ops.remove(temp) } catch { /* Only our own temporary file. */ }
    }
    try { await this.ops.syncDirectory(path.dirname(target)) } catch { /* rename already committed */ }
  }

  private value(mapped: AgentDraftValue | ReturnType<typeof mapConfirmed>, draftId: string, revision: string, generation = 1): AgentDraftValue {
    const q = (key: string) => mapped.parameters.find(p => p.key === key)!.valueQ
    const edit = mapped.requirementEdit
    const lower = edit === null ? null : tryParseMm(edit.lowerText)
    const upper = edit === null ? null : tryParseMm(edit.upperText)
    const requirementResult = lower?.ok && upper?.ok ? calculateChain({ ...mapped.chain, target: { minQ: lower.value, maxQ: upper.value } }) : null
    return { ...mapped, draftId, draftRevision: generation, baseRevisionId: revision,
      requirementPreview: { status: edit === null ? 'unchecked' : 'pending-confirmation', reasonCodes: [edit === null ? 'NO_REQUIREMENT' : 'REQUIREMENT_EDIT_UNCONFIRMED'], result: requirementResult },
      stale: false, evidenceRefs: 'evidenceRefs' in mapped ? mapped.evidenceRefs : [],
      checkStatus: 'pending-confirmation', issues: mapped.missing.length ? [{ code: 'NEEDS_CLARIFICATION', missing: mapped.missing }] : [],
      geometry: { innerDiameterQ: q('innerDiameter'), outerDiameterQ: q('outerDiameter'), lengthQ: q('length') },
      diff: { before: mapped.computation.previousChain, after: mapped.chain, parameters: mapped.computation.parameterDiffs } }
  }

  /** All calls, including reads, are serialized per project session. */
  async run(windowId: number, command: 'context' | 'confirmed' | 'apply' | 'stage' | 'preview', input: unknown): Promise<ToolResult<unknown>> {
    const requestId = randomUUID()
    const session = this.deps.controller.sessionFor(windowId)
    const objectVersion = session?.snapshot.project.currentRevisionId ?? 'unavailable'
    if (session === null) return { ok: false, code: 'STALE_BASE', message: '没有活动项目', requestId, objectVersion }
    const task = async (): Promise<ToolResult<unknown>> => {
      try {
        if (this.deps.controller.sessionFor(windowId) !== session) throw new MappingError('STALE_BASE', '活动项目已切换')
        const data = await this.execute(windowId, session, command, input)
        return { ok: true, data, requestId, objectVersion: session.snapshot.project.currentRevisionId }
      } catch (caught) {
        const error = caught instanceof ChangeError ? new MappingError('CONSTRAINT_VIOLATED', caught.message, { causeCode: caught.code }) : caught
        const known = error instanceof MappingError
        return { ok: false, code: known ? error.code : 'TOOL_FAILED', message: known ? error.message : '工程工具执行失败', details: known ? error.details : undefined, requestId, objectVersion: session.snapshot.project.currentRevisionId }
      }
    }
    const previous = this.queues.get(session.sessionId) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.queues.set(session.sessionId, next)
    return next
  }

  private async checkedSource(session: ProjectSession, draft: ExtractionDraft): Promise<void> {
    const doc = session.snapshot.documents.find(d => d.id === draft.sourceIdentity.documentId)
    const revision = session.snapshot.revisions.find(r => r.id === doc?.latestRevisionId)
    const bytes = session.snapshot.attachments.find(a => a.blobKey === revision?.blobKey)?.bytes
    if (!revision || revision.id !== draft.sourceIdentity.revisionId || revision.sha256 !== draft.sourceIdentity.sha256 || !bytes || createHash('sha256').update(bytes).digest('hex') !== revision.sha256) {
      throw new MappingError('SOURCE_CHANGED', '来源版本或字节已变化', { causeCode: 'SOURCE_STALE' })
    }
  }

  private async execute(windowId: number, session: ProjectSession, command: string, input: unknown): Promise<unknown> {
    const revisionId = session.snapshot.project.currentRevisionId
    if (command === 'confirmed') {
      const draft = session.snapshot.project.extractionDrafts.find(d => d.draftId === (input as { draftId: string }).draftId)
      if (!draft) throw new MappingError('INVALID_INPUT', '提取草稿不存在')
      return structuredClone(draft)
    }
    const stored = await this.read(session)
    if (command === 'context') {
      const p = session.snapshot.project
      let visibleDraft = stored?.draft ?? null
      if (stored && visibleDraft) {
        const extraction = session.snapshot.project.extractionDrafts.find(d => d.draftId === stored.sourceDraftId)
        const demo = stored.sourceDraftId === 'demo' && stored.sourceDigest === 'demo'
        let stale = stored.baseDigest !== engineeringBasis(session.snapshot) || (!demo && (!extraction || stableFingerprint(extraction) !== stored.sourceDigest))
        if (extraction) { try { await this.checkedSource(session, extraction) } catch { stale = true } }
        visibleDraft = { ...visibleDraft, stale }
      }
      const context: AgentContextValue = { projectId: p.id, revisionId, draft: visibleDraft, parameters: p.parameters, bindings: p.dimensionLinks, requirements: p.requirementRevisions, check: p.currentRequirementCheck }
      return structuredClone(context)
    }
    const before = stamp(session.snapshot)
    const guard = () => this.deps.controller.sessionFor(windowId) === session && stamp(session.snapshot) === before
    if (command === 'apply') {
      const req = input as ApplyConfirmedInputsRequest
      const credential = this.credentials.get(req.planToken)
      if (!credential || credential.windowId !== windowId || credential.sessionId !== session.sessionId || credential.expires < Date.now()) throw new MappingError('NOT_CONFIRMED', '计划凭据不存在、过期或不属于本窗口')
      const saved = await this.readDecisions(session)
      if (!saved.ok) throw new MappingError('NOT_CONFIRMED', '无法重读已保存的候选决定', { causeCode: saved.error.code })
      const draft = saved.value.project.extractionDrafts.find(d => d.draftId === credential.draftId)
      const current = session.snapshot.project.extractionDrafts.find(d => d.draftId === credential.draftId)
      if (!draft || !current) throw new MappingError('NOT_CONFIRMED', '已保存的提取草稿不存在')
      await this.checkedSource(session, draft)
      if (isDraftSuperseded(current, session.snapshot.project.extractionDrafts)) throw new MappingError('NOT_CONFIRMED', '提取规则版本已过期', { causeCode: 'EXTRACTOR_VERSION_MISMATCH' })
      if (stableFingerprint(draft) !== stableFingerprint(current) || stableFingerprint(draft) !== credential.draftDigest) throw new MappingError('NOT_CONFIRMED', '候选决定代数已变化', { causeCode: 'STALE_DECISION' })
      // M08: this MUST be the authoritative gate; no parallel confirmation implementation.
      const plan = planApplication(draft, { source: draft.sourceIdentity, candidateIds: req.candidateIds })
      if (!plan.ok) throw new MappingError(plan.code === 'GROUP_ALREADY_CONFIRMED' ? 'CONSTRAINT_VIOLATED' : plan.code === 'SOURCE_STALE' ? 'SOURCE_CHANGED' : 'NOT_CONFIRMED', plan.message, { causeCode: plan.code })
      // M09: formal basis validation cannot be replaced by a cached plan token.
      if (req.baseRevisionId !== revisionId) throw new MappingError('STALE_BASE', '计划正式基准已过期')
      if (credential.baseDigest !== engineeringBasis(session.snapshot)) throw new MappingError('STALE_BASE', '计划工程基准已被独立编辑')
      const planKey = hash(JSON.stringify([req.planToken, req.baseRevisionId]))
      const requestKey = stableFingerprint({ candidateIds: [...new Set(req.candidateIds)].sort(), mapping: req.mapping })
      const applications = stored?.draft.baseRevisionId === revisionId ? stored.applications : {}
      const replay = applications[planKey]
      if (replay) {
        if (replay.requestKey !== requestKey) throw new MappingError('INVALID_INPUT', '同一计划凭据不能重放不同的映射意图')
        return replay.value
      }
      if (Object.keys(applications).length >= 32) throw new MappingError('TOOL_FAILED', '当前基准应用计划达到32次预算，请先处理已有草稿')
      const draftId = `agent-draft-${randomUUID()}`
      const mapped = mapConfirmed(session.snapshot, draft, plan.value, req.mapping, { draftId, now: new Date().toISOString() })
      const value = this.value(mapped, draftId, revisionId)
      value.evidenceRefs = plan.value.items.flatMap(item => [...item.evidence])
      const payload: DraftFile = { schemaVersion: 1, projectId: session.snapshot.project.id, planKey, requestKey, applications: { ...applications, [planKey]: { requestKey, value } }, sourceDraftId: draft.draftId, sourceDigest: stableFingerprint(draft), baseDigest: engineeringBasis(session.snapshot), recovery: { basePath: session.path, baseFingerprint: session.fingerprint }, draft: value }
      await this.write(session, payload, guard)
      return value
    }
    const req = input as AgentParameterChangeRequest | AgentPreviewRequest
    if (req.baseRevisionId !== revisionId) throw new MappingError('STALE_BASE', '工程草稿正式基准已过期')
    if (!stored || stored.draft.draftId !== req.draftId || stored.draft.baseRevisionId !== revisionId) throw new MappingError('STALE_PREVIEW', '工程草稿不存在或已过期')
    if (stored.baseDigest !== engineeringBasis(session.snapshot)) throw new MappingError('STALE_BASE', '工程草稿基准已被独立编辑')
    const extraction = session.snapshot.project.extractionDrafts.find(d => d.draftId === stored.sourceDraftId)
    const demoDraft = stored.sourceDraftId === 'demo' && stored.sourceDigest === 'demo'
    if (!demoDraft) {
      if (!extraction || stableFingerprint(extraction) !== stored.sourceDigest) throw new MappingError('NOT_CONFIRMED', '来源决定已变化', { causeCode: 'STALE_DECISION' })
      await this.checkedSource(session, extraction)
    }
    if (command === 'preview') {
      const nowIso = new Date().toISOString()
      const candidateSnapshot: ProjectFileSnapshot = { ...session.snapshot, project: { ...session.snapshot.project, dimensionChain: stored.draft.chain } }
      const computation = computeChange(candidateSnapshot,
        { parameters: stored.draft.parameters, bindings: stored.draft.bindings }, { revisionId: stored.draft.draftId, now: nowIso })
      computation.previousChain = session.snapshot.project.dimensionChain
      computation.previousResult = calculateChain(computation.previousChain)
      const checkResult = await computeCandidateRequirementCheck({
        snapshot: candidateSnapshot,
        requirementRevisions: session.snapshot.project.requirementRevisions,
        activeRequirementRevisionId: session.snapshot.project.activeRequirementRevisionId,
        pendingEdit: null,
        draft: { draftId: stored.draft.draftId, draftRevision: stored.draft.draftRevision, parameters: stored.draft.parameters, bindings: stored.draft.bindings },
        baseRevisionId: revisionId,
        baseGeneration: 0,
        acceptedSeq: session.acceptedSeq,
        checkedAt: nowIso,
        checkId: `check-p-${randomUUID()}`,
        inputIssue: null,
      })
      if (!checkResult.ok) {
        throw new MappingError(checkResult.error.code === 'CALCULATION_FAILED' ? 'TOOL_FAILED' : 'CONSTRAINT_VIOLATED', checkResult.error.message)
      }
      const previewId = `preview-${randomUUID()}`
      const previewFingerprint = previewFingerprintOf({
        projectId: session.snapshot.project.id,
        draftId: stored.draft.draftId,
        draftRevision: stored.draft.draftRevision,
        baseRevisionId: revisionId,
        computation,
        check: checkResult.value.check,
      })
      const nowMs = Date.now()
      for (const [key, record] of this.previews) if (Date.parse(record.expiresAt) <= nowMs) this.previews.delete(key)
      this.previews.set(previewId, {
        previewId,
        previewFingerprint,
        windowId,
        sessionId: session.sessionId,
        projectId: session.snapshot.project.id,
        draftId: stored.draft.draftId,
        draftRevision: stored.draft.draftRevision,
        baseRevisionId: revisionId,
        requirementRevisionId: checkResult.value.check.requirementRevisionId,
        computation,
        check: checkResult.value.check,
        requirementProposalPending: stored.draft.requirementEdit !== null,
        createdAt: nowIso,
        expiresAt: new Date(nowMs + PREVIEW_TTL_MS).toISOString(),
      })
      this.latestPreviewBySession.set(session.sessionId, previewId)
      return { ...this.value({ ...stored.draft, computation }, stored.draft.draftId, revisionId, stored.draft.draftRevision), previewId, previewFingerprint }
    }
    const change = req as AgentParameterChangeRequest
    if (change.lockedKeys.includes(change.parameter)) throw new MappingError('CONSTRAINT_VIOLATED', '不能修改锁定参数')
    const valueText = change.valueMm ?? change.deltaMm!
    const parsed = tryParseMm(valueText)
    if (!parsed.ok) throw new MappingError('INVALID_INPUT', parsed.message)
    const parameters = structuredClone(stored.draft.parameters)
    const parameter = parameters.find(p => p.key === change.parameter)!
    // All additions are integer q; no mm floating arithmetic in the Agent layer.
    parameter.valueQ = change.valueMm !== undefined ? parsed.value : parameter.valueQ + parsed.value
    if (!Number.isSafeInteger(parameter.valueQ)) throw new MappingError('INVALID_INPUT', '参数超出 q 范围')
    parameter.inputDecimals = Math.max(parameter.inputDecimals, (valueText.split('.')[1] ?? '').length)
    parameter.parameterRevision += 1
    const candidate = { ...session.snapshot, project: { ...session.snapshot.project, dimensionChain: stored.draft.chain } }
    const computation = computeChange(candidate, { parameters, bindings: stored.draft.bindings }, { revisionId: stored.draft.draftId, now: new Date().toISOString() })
    computation.previousChain = session.snapshot.project.dimensionChain
    computation.previousResult = calculateChain(computation.previousChain)
    const next = this.value({ ...stored.draft, chain: computation.chain, parameters: computation.parameters, computation }, stored.draft.draftId, revisionId, stored.draft.draftRevision + 1)
    await this.write(session, { ...stored, draft: next }, guard)
    return next
  }
}
export const AGENT_PARAMETER_KEYS = SPACER_PARAMETER_KEYS
