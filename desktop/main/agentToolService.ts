/** V4 stage 1: model-free, draft-only trusted engineering tools. */
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { planApplication, isDraftSuperseded, type ExtractionDraft } from '../../src/document-extraction'
import { mapConfirmed, MappingError } from '../../src/agent-tools/mapConfirmed'
import { stableFingerprint } from '../../src/revisions/canonical'
import { calculateChain } from '../../src/domain/calculate'
import { ChangeError, computeChange } from '../../src/revisions/compute'
import { tryParseMm } from '../../src/domain/units'
import { SPACER_PARAMETER_KEYS } from '../../src/drawing/types'
import { decodeProjectFile } from '../../src/project-file/codec'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import type { AgentContextValue, AgentDraftValue, AgentParameterChangeRequest, AgentPreviewRequest, ApplyConfirmedInputsRequest, ToolResult } from '../shared/contracts'
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
export interface AgentToolDeps {
  controller: SessionController
  projectService: ProjectService
  recovery: RecoveryStore
  rootDir: string
  ops?: WorkspaceOps
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const engineeringBasis = (snapshot: ProjectFileSnapshot) => {
  const p = snapshot.project
  return stableFingerprint({ revisionId: p.currentRevisionId, chain: p.dimensionChain, parameters: p.parameters, links: p.dimensionLinks, parts: p.parts, drawings: p.drawings, requirements: p.requirementRevisions, activeRequirement: p.activeRequirementRevisionId })
}
const stamp = (snapshot: ProjectFileSnapshot) => stableFingerprint({ ...snapshot, attachments: snapshot.attachments.map(a => ({ blobKey: a.blobKey, digest: createHash('sha256').update(a.bytes).digest('hex') })) })

export class AgentToolService {
  private readonly credentials = new Map<string, PlanCredential>()
  private readonly queues = new Map<string, Promise<unknown>>()
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
        let stale = stored.baseDigest !== engineeringBasis(session.snapshot) || !extraction || stableFingerprint(extraction) !== stored.sourceDigest
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
    if (!extraction || stableFingerprint(extraction) !== stored.sourceDigest) throw new MappingError('NOT_CONFIRMED', '来源决定已变化', { causeCode: 'STALE_DECISION' })
    await this.checkedSource(session, extraction)
    if (command === 'preview') {
      const computation = computeChange({ ...session.snapshot, project: { ...session.snapshot.project, dimensionChain: stored.draft.chain } },
        { parameters: stored.draft.parameters, bindings: stored.draft.bindings }, { revisionId: stored.draft.draftId, now: new Date().toISOString() })
      computation.previousChain = session.snapshot.project.dimensionChain
      computation.previousResult = calculateChain(computation.previousChain)
      return this.value({ ...stored.draft, computation }, stored.draft.draftId, revisionId, stored.draft.draftRevision)
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
