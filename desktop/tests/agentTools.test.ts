// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness, makeEvent } from './helpers/a04'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import { AgentToolService } from '../main/agentToolService'
import { registerAgentToolChannels, agentChangeRouter } from '../main/agentToolChannels'
import { ExtractionService } from '../main/extractionService'
import { registerExtractionChannels } from '../main/extractionChannels'
import { ChangeService } from '../main/changeService'
import { registerChangeChannels } from '../main/changeChannels'
import { nodeWorkspaceOps } from '../main/workspaceJson'
import { IPC_CHANNELS, type AgentDraftValue, type ApplyConfirmedInputsRequest, type ExtractionDecideValue, type ExtractionRunValue, type ToolResult } from '../shared/contracts'
import { candidateValueSnapshot, type ExtractionCandidate, type ExtractionDraft } from '../../src/document-extraction'
import { encodeProjectFile, decodeProjectFile } from '../../src/project-file/codec'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import { serializeEvidence } from '../../scripts/evidence-json'

const cleanup: Harness[] = []
afterEach(async () => { for (const h of cleanup.splice(0)) await h.dispose() })
const evidenceDir = 'docs/evidence/v40-stage1'

async function setup(confirm = true, differentBaseline = false) {
  const h = await createHarness({ debounceMs: 60_000 }); cleanup.push(h)
  const snapshot = await createSampleSnapshot()
  if (differentBaseline) snapshot.project = { ...snapshot.project, dimensionChain: { ...snapshot.project.dimensionChain, target: { minQ: 2000, maxQ: 4000 }, terms: snapshot.project.dimensionChain.terms.map(t => ({ ...t, nominalQ: t.symbol === 'H' ? 530000 : t.nominalQ })) } }
  const bytes = new Uint8Array(await fs.readFile('src/document-extraction/__fixtures__/taskbook-TB-2026-1110.pdf'))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  snapshot.revisions[0] = { ...snapshot.revisions[0], sha256, byteSize: bytes.length, fileName: 'taskbook-TB-2026-1110.pdf' }
  snapshot.blobs[0] = { ...snapshot.blobs[0], sha256, byteSize: bytes.length }
  snapshot.attachments[0] = { ...snapshot.attachments[0], bytes }
  const opened = await h.openSample(snapshot)
  const session = h.projectService.getSession(opened.sessionId)!
  let failWrite = false
  const service = new AgentToolService({ controller: h.controller, projectService: h.projectService, recovery: h.recovery, rootDir: h.workspace,
    ops: { ...nodeWorkspaceOps, async writeExclusive(target, data) {
      if (failWrite) throw Object.assign(new Error('injected ENOSPC'), { code: 'ENOSPC' })
      return nodeWorkspaceOps.writeExclusive(target, data)
    } } })
  registerAgentToolChannels(h.ipc, { guard: h.guard, service })
  registerChangeChannels(agentChangeRouter(h.ipc, { guard: h.guard, service }), { guard: h.guard, controller: h.controller,
    changeService: new ChangeService({ controller: h.controller, projectService: h.projectService, recovery: h.recovery }) })
  registerExtractionChannels(h.ipc, { guard: h.guard, controller: h.controller,
    service: new ExtractionService({ controller: h.controller, projectService: h.projectService, recovery: h.recovery }),
    issuePlanToken: (windowId, draftId) => service.issueAfterDecision(windowId, draftId) })
  const trace: unknown[] = []
  async function invoke<T>(channel: string, input: unknown): Promise<T> {
    const start = performance.now()
    const result = await h.ipc.invoke(channel, input) as unknown as T
    trace.push({ channel, input, output: result, elapsedMs: performance.now() - start })
    return result
  }
  const run = await invoke<{ ok: boolean; value: ExtractionRunValue }>(IPC_CHANNELS.extractionRun, { sessionId: session.sessionId, baseEditSeq: session.acceptedSeq, revisionId: 'sr-1', pageFrom: 1, pageTo: 2, requestId: 'a40-extraction' })
  expect(run.ok).toBe(true)
  const extractionId = run.value.draftId
  const draft = () => session.snapshot.project.extractionDrafts.find(d => d.draftId === extractionId)!
  const selected = draft().candidates
  let planToken = ''
  for (const candidate of confirm ? selected : selected.slice(0, 1)) {
    const result = await invoke<{ ok: boolean; value: ExtractionDecideValue }>(IPC_CHANNELS.extractionDecide,
      { sessionId: session.sessionId, baseEditSeq: session.acceptedSeq, draftId: extractionId, candidateId: candidate.candidateId, editRevision: candidate.editRevision, action: 'confirm', confirmed: true })
    expect(result.ok).toBe(true)
    expect(result.value.planToken).toBeTypeOf('string')
    planToken = result.value.planToken!
  }
  const request: ApplyConfirmedInputsRequest = { planToken, baseRevisionId: session.snapshot.project.currentRevisionId,
    candidateIds: selected.map(c => c.candidateId), mapping: { spacerPart: 'builtin:shaft-demo:spacer', ringSymbols: ['H', 'B1', 'S', 'B2'], formulaId: selected.find(c => c.kind === 'formula')!.candidateId, requirement: true, linkLengthToSymbol: 'S' } }
  const apply = (req: unknown = request) => invoke<ToolResult<AgentDraftValue>>(IPC_CHANNELS.agentApplyConfirmed, req)
  const disk = async () => ({ project: await fs.readFile(session.path!), snapshot: structuredClone(session.snapshot),
    files: await tree(h.workspace) })
  return { h, session, service, request, apply, invoke, draft, trace, disk, fail: () => { failWrite = true } }
}
async function tree(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name)
    if (entry.isDirectory()) for (const [key, value] of Object.entries(await tree(name))) result[`${entry.name}/${key}`] = value
    else result[entry.name] = (await fs.readFile(name)).toString('base64')
  }
  return result
}
function data(result: ToolResult<AgentDraftValue>) {
  expect(result.ok, JSON.stringify(result)).toBe(true)
  if (!result.ok) throw new Error(result.code)
  return result.data
}
async function persist(s: Awaited<ReturnType<typeof setup>>, draft: ExtractionDraft) {
  s.session.snapshot = { ...s.session.snapshot, project: { ...s.session.snapshot.project, extractionDrafts: [draft] } }
  s.session.acceptedSeq += 1
  await s.h.recovery.stage(s.session.sessionId, s.session.snapshot, s.session.acceptedSeq, s.h.controller.recoveryMeta(s.session, s.session.snapshot))
  const outcome = await s.h.recovery.flush(s.session.sessionId)
  expect(outcome.state, JSON.stringify(outcome)).toBe('written')
  s.request.planToken = (await s.service.issueAfterDecision(1, draft.draftId))!
}

describe('V4.0 阶段1：状态级九项验收', () => {
  it('01 A40-01：真实 PDF → 逐条界面决定 → 草稿，参数/环/公式/绑定/条款/图纸/3D 同源', async () => {
    const s = await setup()
    const before = await s.disk()
    if (process.env.V40_SEED_OUT) {
      const opened = await decodeProjectFile(before.project)
      if (!opened.ok) throw new Error('seed decode failed')
      const initial = opened.value.snapshot
      const seed = JSON.parse(JSON.stringify({ ...initial, attachments: [] }), (_key, value) => value === initial.project.id ? 'v40-stage1-seed' : value) as ProjectFileSnapshot
      seed.attachments = initial.attachments
      const encoded = await encodeProjectFile(seed)
      if (!encoded.ok) throw new Error(`seed encode failed: ${encoded.error.message}`)
      await fs.writeFile(process.env.V40_SEED_OUT, encoded.value.bytes)
      console.log(`A40 seed written: ${process.env.V40_SEED_OUT}`)
    }
    const value = data(await s.apply())
    expect(value.parameters.map(p => [p.key, p.valueQ, p.inputDecimals, p.reviewStatus])).toEqual([
      ['innerDiameter', 200000, 2, 'draft'], ['outerDiameter', 320000, 2, 'draft'], ['length', 120000, 2, 'draft'],
    ])
    expect(value.chain.terms.map(t => [t.symbol, t.nominalQ, t.lowerDeviationQ, t.upperDeviationQ, t.sign, t.termRevision])).toEqual([
      ['H', 522000, -200, 200, 1, 2], ['B1', 200000, -100, 100, -1, 2], ['S', 120000, -100, 100, -1, 2], ['B2', 200000, -100, 100, -1, 2],
    ])
    expect(value.bindings).toMatchObject([{ termId: 't-s', parameterId: 'param:spacer:length' }])
    expect(value.requirementEdit).toMatchObject({ lowerText: '0.1000', upperText: '0.3000', editRevision: 1, source: { revisionId: 'sr-1' } })
    expect(value.computation.result).toMatchObject({ minQ: 1500, maxQ: 2500 })
    expect(value.computation.drawing.data.parameterSnapshot.map(p => p.valueQ)).toEqual([200000, 320000, 120000])
    expect(value.geometry).toEqual({ innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120000 })
    expect(value.checkStatus).toBe('pending-confirmation')
    expect(value.missing).toEqual([])
    expect(s.session.snapshot).toEqual(before.snapshot)
    expect(await fs.readFile(s.session.path!)).toEqual(before.project)
    const restored = new AgentToolService({ controller: s.h.controller, projectService: s.h.projectService, recovery: s.h.recovery, rootDir: s.h.workspace })
    const context = await restored.run(1, 'context', {})
    expect(context).toMatchObject({ ok: true, data: { draft: { draftId: value.draftId, geometry: value.geometry } } })
    if (process.env.V40_RECORD === '1') {
      await fs.mkdir(evidenceDir, { recursive: true })
      await fs.writeFile(`${evidenceDir}/a40-01-state-trace.json`, serializeEvidence({ fixtureSha256: s.draft().sourceIdentity.sha256, trace: s.trace, assertions: 'real-PDF, decisions, draft and byte invariants asserted in test 01' }))
    }
  }, 30_000)

  it('02 伪造 confirmed/user/approvedBy：未确认候选不得入草稿（M08）', async () => {
    const s = await setup(false); const before = await s.disk()
    const result = await s.apply({ ...s.request, confirmed: true, user: 'forged', approvedBy: 'model' })
    expect(result).toMatchObject({ ok: false, code: 'NOT_CONFIRMED', details: { causeCode: 'NOT_CONFIRMED' } })
    expect(await s.disk()).toEqual(before)
  })
  it('03 基准过期：STALE_BASE，磁盘/项目/来源不变（M09）', async () => {
    const s = await setup(); const before = await s.disk()
    expect(await s.apply({ ...s.request, baseRevisionId: 'old-revision' })).toMatchObject({ ok: false, code: 'STALE_BASE' })
    expect(await s.disk()).toEqual(before)
  })
  it('04 来源换版：SOURCE_CHANGED，既有工程草稿与来源字节不变', async () => {
    const s = await setup(); data(await s.apply())
    s.session.snapshot.documents[0] = { ...s.session.snapshot.documents[0], latestRevisionId: 'sr-new' }
    s.session.snapshot.revisions.push({ ...s.session.snapshot.revisions[0], id: 'sr-new' })
    const before = await s.disk()
    expect(await s.apply()).toMatchObject({ ok: false, code: 'SOURCE_CHANGED', details: { causeCode: 'SOURCE_STALE' } })
    expect(await s.disk()).toEqual(before)
  })
  it('05 幂等：同 token 同基准并发重复只建一个草稿，两次 ID 与字节相同', async () => {
    const s = await setup()
    const [one, two] = await Promise.all([s.apply(), s.apply()])
    expect(data(one).draftId).toBe(data(two).draftId)
    const before = await s.disk(); expect(data(await s.apply())).toEqual(data(one)); expect(await s.disk()).toEqual(before)
    expect(Object.keys(before.files).filter(k => k.startsWith('agent-inputs/') && k.endsWith('.json'))).toHaveLength(1)
  })
  it('06 注入 ENOSPC：项目/已有草稿/恢复记录/附件字节深比较不变', async () => {
    const s = await setup(); data(await s.apply())
    s.request.planToken = (await s.service.issueAfterDecision(1, s.draft().draftId))!
    const before = await s.disk(); s.fail()
    expect(await s.apply()).toMatchObject({ ok: false, code: 'SAVE_FAILED', details: { causeCode: 'ENOSPC' } })
    expect(await s.disk()).toEqual(before)
  })
  it('07 缺长度：NEEDS_CLARIFICATION，missing 包含具体长度用途且零写入', async () => {
    const s = await setup()
    const changed = { ...s.draft(), candidates: s.draft().candidates.map(c => c.kind !== 'part-dimension' ? c : { ...c, data: { ...c.data, length: null } }) }
    // Persist a coherent decision for the reduced geometry, not a fabricated numeric result.
    const draft = { ...changed, decisions: changed.decisions.map(d => ({ ...d, valueSnapshot: candidateValueSnapshot(changed.candidates.find(c => c.candidateId === d.candidateId)!) })) }
    await persist(s, draft)
    const before = await s.disk(); const result = await s.apply()
    expect(result).toMatchObject({ ok: false, code: 'NEEDS_CLARIFICATION', details: { missing: [{ field: 'parameters.length', purpose: expect.stringContaining('length') }] } })
    expect(await s.disk()).toEqual(before)
  })
  it('08 冲突组：磁盘已有同符号两条确认 → CONSTRAINT_VIOLATED，零写入', async () => {
    const s = await setup(); const d = s.draft()
    const ring = d.candidates.find(c => c.kind === 'ring')!
    const groupId = ring.groupId ?? 'conflict-H'
    const duplicate = { ...ring, candidateId: `${ring.candidateId}-other`, groupId } as ExtractionCandidate
    const draft: ExtractionDraft = { ...d, candidates: [...d.candidates.map(c => c === ring ? { ...c, groupId } : c), duplicate],
      decisions: [...d.decisions, { ...d.decisions.find(v => v.candidateId === ring.candidateId)!, decisionId: 'conflict-confirmation', candidateId: duplicate.candidateId }] }
    await persist(s, draft); s.request.candidateIds.push(duplicate.candidateId)
    const before = await s.disk()
    expect(await s.apply()).toMatchObject({ ok: false, code: 'CONSTRAINT_VIOLATED', details: { causeCode: 'GROUP_ALREADY_CONFIRMED' } })
    expect(await s.disk()).toEqual(before)
  })
  it('09 五工具统一信封：成功/参数错/窗口错/业务错都有 requestId、objectVersion', async () => {
    const s = await setup(); const draft = data(await s.apply())
    const calls: [string, unknown][] = [[IPC_CHANNELS.agentContext, {}], [IPC_CHANNELS.agentConfirmedInputs, { draftId: s.draft().draftId }],
      [IPC_CHANNELS.agentApplyConfirmed, s.request], [IPC_CHANNELS.changeStage, { toolMode: 'agent', draftId: draft.draftId, baseRevisionId: draft.baseRevisionId, parameter: 'length', deltaMm: '0.04', lockedKeys: ['innerDiameter', 'outerDiameter'] }],
      [IPC_CHANNELS.changePreview, { toolMode: 'agent', draftId: draft.draftId, baseRevisionId: draft.baseRevisionId }]]
    for (const [channel, input] of calls) {
      const success = await s.invoke<ToolResult<unknown>>(channel, input)
      expect(success).toMatchObject({ ok: true, requestId: expect.any(String), objectVersion: draft.baseRevisionId })
      const bad = await s.invoke<ToolResult<unknown>>(channel, { ...(input as object), unexpected: true })
      expect(bad).toMatchObject({ ok: false, code: 'INVALID_INPUT', requestId: expect.any(String), objectVersion: expect.any(String) })
      const foreign = await s.h.ipc.invoke(channel, input, makeEvent({ webContentsId: 2 }))
      expect(foreign).toMatchObject({ ok: false, requestId: expect.any(String), objectVersion: expect.any(String) })
    }
    const preview = await s.invoke<ToolResult<AgentDraftValue>>(IPC_CHANNELS.changePreview, calls[4][1])
    expect(data(preview).computation.result).toMatchObject({ minQ: 1100, maxQ: 2100 })
    expect(data(preview).geometry.lengthQ).toBe(120400)
    expect(data(preview).requirementPreview.result).toMatchObject({ minQ: 1100, maxQ: 2100, lowerMarginQ: 100, upperMarginQ: 900 })
  })
  it('10 同版本独立编辑也使旧计划与预览过期；context 标记 stale', async () => {
    const s = await setup(); const draft = data(await s.apply())
    s.session.snapshot.project.dimensionChain.terms[0].nominalQ += 1
    const before = await s.disk()
    expect(await s.apply()).toMatchObject({ ok: false, code: 'STALE_BASE' })
    expect(await s.invoke(IPC_CHANNELS.changePreview, { toolMode: 'agent', draftId: draft.draftId, baseRevisionId: draft.baseRevisionId })).toMatchObject({ ok: false, code: 'STALE_BASE' })
    expect(await s.invoke(IPC_CHANNELS.agentContext, {})).toMatchObject({ ok: true, data: { draft: { stale: true } } })
    expect(await s.disk()).toEqual(before)
  })
  it('11 几何完整但无装配关系：仅几何草稿并列出具体缺项，不冒充完整任务', async () => {
    const s = await setup(); const before = await s.disk()
    const ids = s.draft().candidates.filter(c => c.kind === 'part-dimension').map(c => c.candidateId)
    const draft = data(await s.apply({ ...s.request, candidateIds: ids, mapping: { spacerPart: 'builtin:shaft-demo:spacer', ringSymbols: [] } }))
    expect(draft.geometry.lengthQ).toBe(120000)
    expect(draft.issues).toMatchObject([{ code: 'NEEDS_CLARIFICATION' }])
    expect(draft.missing.map(m => m.field)).toEqual(expect.arrayContaining(['formula', 'bindings.length', 'rings.H.mapping', 'requirement.mapping']))
    expect(s.session.snapshot).toEqual(before.snapshot)
  })
  it('12 token不可伪造；界面撤销确认后旧计划凭据失效', async () => {
    const s = await setup(); const before = await s.disk()
    expect(await s.apply({ ...s.request, planToken: 'forged', confirmed: true })).toMatchObject({ ok: false, code: 'NOT_CONFIRMED' })
    expect(await s.disk()).toEqual(before)
    const candidate = s.draft().candidates[0]
    expect(await s.invoke(IPC_CHANNELS.extractionDecide, { sessionId: s.session.sessionId, baseEditSeq: s.session.acceptedSeq, draftId: s.draft().draftId, candidateId: candidate.candidateId, editRevision: candidate.editRevision, action: 'revoke' })).toMatchObject({ ok: true })
    expect((await s.h.recovery.flush(s.session.sessionId)).state).toBe('written')
    const saved = await s.disk()
    expect(await s.apply()).toMatchObject({ ok: false, code: 'NOT_CONFIRMED', details: { causeCode: 'STALE_DECISION' } })
    expect(await s.disk()).toEqual(saved)
  })
  it('13 已确认公式不属于登记链 → UNSUPPORTED_SCOPE，失败零写入', async () => {
    const s = await setup()
    const draft = { ...s.draft(), candidates: s.draft().candidates.map(c => c.kind === 'formula' ? { ...c, data: { ...c.data, operands: c.data.operands.map(o => ({ ...o, sign: 1 as const })) } } : c) }
    await persist(s, draft); const before = await s.disk()
    expect(await s.apply()).toMatchObject({ ok: false, code: 'UNSUPPORTED_SCOPE' })
    expect(await s.disk()).toEqual(before)
  })
  it('14 幂等跨其它计划仍返回原ID；同凭据换映射拒绝；锁定及非法几何零写入', async () => {
    const s = await setup(); const original = { ...s.request }; const one = data(await s.apply())
    s.request.planToken = (await s.service.issueAfterDecision(1, s.draft().draftId))!
    const two = data(await s.apply()); expect(two.draftId).not.toBe(one.draftId)
    expect(data(await s.apply(original)).draftId).toBe(one.draftId)
    const before = await s.disk()
    expect(await s.apply({ ...s.request, mapping: { ...s.request.mapping, requirement: false } })).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    const stage = { toolMode: 'agent', draftId: two.draftId, baseRevisionId: two.baseRevisionId, parameter: 'length', deltaMm: '0.01', lockedKeys: ['length'] }
    expect(await s.invoke(IPC_CHANNELS.changeStage, stage)).toMatchObject({ ok: false, code: 'CONSTRAINT_VIOLATED' })
    expect(await s.invoke(IPC_CHANNELS.changeStage, { ...stage, lockedKeys: [], deltaMm: '-13.00' })).toMatchObject({ ok: false, code: 'CONSTRAINT_VIOLATED' })
    expect(await s.disk()).toEqual(before)
  })
  it('15 正常保存清理恢复副本后，从正式项目文件重读已有决定仍可建草稿', async () => {
    const s = await setup()
    const saved = await s.h.projectService.save(s.session.sessionId, { editSeq: s.session.acceptedSeq, expectedFingerprint: s.session.fingerprint })
    expect(saved.ok).toBe(true)
    await s.h.recovery.discard(s.session.sessionId)
    expect((await s.h.recovery.readPersisted(s.session.sessionId)).ok).toBe(false)
    const candidate = s.draft().candidates[0]
    const decided = await s.invoke<{ ok: boolean; value: ExtractionDecideValue }>(IPC_CHANNELS.extractionDecide, { sessionId: s.session.sessionId, baseEditSeq: s.session.acceptedSeq, draftId: s.draft().draftId, candidateId: candidate.candidateId, editRevision: candidate.editRevision, action: 'confirm', confirmed: true })
    expect(decided.ok).toBe(true)
    expect(decided.value.planToken).toBeTypeOf('string')
    s.request.planToken = decided.value.planToken!
    const before = await s.disk()
    expect(data(await s.apply()).computation.result).toMatchObject({ minQ: 1500, maxQ: 2500 })
    expect(await fs.readFile(s.session.path!)).toEqual(before.project)
    expect(s.session.snapshot).toEqual(before.snapshot)
  })
  it('16 非样例基线也按确认值映射，原target不被条款区间覆盖', async () => {
    const s = await setup(true, true); const before = await s.disk()
    const draft = data(await s.apply())
    expect(draft.chain.terms[0].nominalQ).toBe(522000)
    expect(draft.diff.before.terms[0].nominalQ).toBe(530000)
    expect(draft.diff.after.terms[0].nominalQ).toBe(522000)
    expect(draft.chain.target).toEqual({ minQ: 2000, maxQ: 4000 })
    expect(draft.requirementPreview.result).toMatchObject({ minQ: 1500, maxQ: 2500, lowerMarginQ: 500, upperMarginQ: 500 })
    expect(s.session.snapshot).toEqual(before.snapshot)
    expect(await fs.readFile(s.session.path!)).toEqual(before.project)
  })
})
