// @vitest-environment node
/**
 * V4.0 阶段 3 状态级验收：S3-01 ～ S3-08。
 *
 * 真实临时项目 + 真实 PDF 提取 + 阶段 1 工具服务 + 主进程授权/提交/定位。
 * UI 点击类验收（S3-09 ～ S3-11）由 src/components/AgentSidebar.test.tsx 与打包走查覆盖。
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExtractionDraft } from '../../src/document-extraction'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import { createRequirementProject } from '../../src/requirements/__fixtures__/requirementFixture'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import type {
  AgentDraftValue,
  ToolResult,
} from '../shared/contracts'
import { AgentToolService } from '../main/agentToolService'
import { ApprovalStore } from '../main/approvalStore'
import { ExtractionService } from '../main/extractionService'
import { createHarness, writeHookOps, type Harness } from './helpers/a04'

const TASKBOOK = 'src/document-extraction/__fixtures__/taskbook-TB-2026-1110.pdf'
const cleanup: { dispose: () => Promise<void> }[] = []
afterEach(async () => { for (const item of cleanup.splice(0)) await item.dispose() })

interface Setup {
  h: Harness
  sessionId: string
  path: string
  service: AgentToolService
  approvals: ApprovalStore
  draft: AgentDraftValue
  clock: { value: number }
  hook: { fn: (() => Promise<void>) | null }
}

async function bytesOf(target: string): Promise<Buffer> {
  return fs.readFile(target)
}

async function setup(options: { requirement?: boolean } = {}): Promise<Setup> {
  const hook: { fn: (() => Promise<void>) | null } = { fn: null }
  const h = await createHarness({ debounceMs: 60_000, fileOps: writeHookOps(hook) })
  cleanup.push(h)
  const base = options.requirement === true ? (await createRequirementProject()).snapshot : await createSampleSnapshot()
  const snapshot: ProjectFileSnapshot = structuredClone(base)
  const bytes = new Uint8Array(await fs.readFile(TASKBOOK))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  snapshot.revisions[0] = { ...snapshot.revisions[0], sha256, byteSize: bytes.length, fileName: 'taskbook-TB-2026-1110.pdf' }
  snapshot.blobs[0] = { ...snapshot.blobs[0], sha256, byteSize: bytes.length }
  snapshot.attachments[0] = { ...snapshot.attachments[0], bytes }
  if (options.requirement === true) {
    snapshot.project = {
      ...snapshot.project,
      requirementRevisions: snapshot.project.requirementRevisions.map(revision => ({
        ...revision,
        source: { ...revision.source, sha256 },
        confirmedAgainstLatestRevisionId: 'sr-1',
      })),
    }
  }
  const opened = await h.openSample(snapshot)
  const session = h.projectService.getSession(opened.sessionId)!
  const clock = { value: Date.parse('2026-11-11T00:00:00.000Z') }
  const approvals = new ApprovalStore({ rootDir: h.workspace, now: () => clock.value })
  const service = new AgentToolService({ controller: h.controller, projectService: h.projectService, recovery: h.recovery, rootDir: h.workspace, approvals })
  const extraction = new ExtractionService({ controller: h.controller, projectService: h.projectService, recovery: h.recovery })
  const run = await extraction.run(1, { sessionId: session.sessionId, baseEditSeq: session.acceptedSeq, revisionId: 'sr-1', pageFrom: 1, pageTo: 2, requestId: 's3-extract' })
  expect(run.ok, JSON.stringify(run)).toBe(true)
  if (!run.ok) throw new Error(run.error.code)
  const draftId = run.value.draftId
  const extractionDraft: ExtractionDraft = session.snapshot.project.extractionDrafts.find(item => item.draftId === draftId)!
  for (const candidate of extractionDraft.candidates) {
    const decided = await extraction.decide({ sessionId: session.sessionId, baseEditSeq: session.acceptedSeq, draftId, candidateId: candidate.candidateId, editRevision: candidate.editRevision, action: 'confirm', confirmed: true })
    expect(decided.ok, JSON.stringify(decided)).toBe(true)
  }
  const planToken = await service.issueAfterDecision(1, draftId)
  expect(planToken).toBeTypeOf('string')
  const selected = session.snapshot.project.extractionDrafts.find(item => item.draftId === draftId)!.candidates
  const applied = await service.run(1, 'apply', {
    planToken,
    baseRevisionId: session.snapshot.project.currentRevisionId,
    candidateIds: selected.map(candidate => candidate.candidateId),
    mapping: { spacerPart: 'builtin:shaft-demo:spacer', ringSymbols: ['H', 'B1', 'S', 'B2'], formulaId: selected.find(candidate => candidate.kind === 'formula')!.candidateId, requirement: true, linkLengthToSymbol: 'S' },
  })
  expect(applied.ok, JSON.stringify(applied)).toBe(true)
  if (!applied.ok) throw new Error(applied.code)
  return { h, sessionId: session.sessionId, path: session.path!, service, approvals, draft: applied.data as AgentDraftValue, clock, hook }
}

function data<T>(result: ToolResult<T>): T {
  expect(result.ok, JSON.stringify(result)).toBe(true)
  if (!result.ok) throw new Error(result.code)
  return result.data
}

async function stage(s: Setup, patch: { valueMm?: string; deltaMm?: string; parameter?: 'length' }): Promise<AgentDraftValue> {
  const staged = await s.service.run(1, 'stage', {
    toolMode: 'agent',
    draftId: s.draft.draftId,
    baseRevisionId: s.draft.baseRevisionId,
    parameter: patch.parameter ?? 'length',
    ...(patch.valueMm === undefined ? { deltaMm: patch.deltaMm ?? '0.04' } : { valueMm: patch.valueMm }),
    lockedKeys: ['innerDiameter', 'outerDiameter'],
  })
  return data(staged) as AgentDraftValue
}

async function preview(s: Setup): Promise<{ previewId: string; previewFingerprint: string; value: AgentDraftValue }> {
  const shown = await s.service.run(1, 'preview', { toolMode: 'agent', draftId: s.draft.draftId, baseRevisionId: s.draft.baseRevisionId })
  const value = data(shown) as AgentDraftValue
  expect(value.previewId).toBeTypeOf('string')
  expect(value.previewFingerprint).toBeTypeOf('string')
  return { previewId: value.previewId!, previewFingerprint: value.previewFingerprint!, value }
}

async function approve(s: Setup, previewId: string): Promise<string> {
  return data(await s.service.issueApproval(1, previewId)).approvalId
}

async function approvalFile(s: Setup, approvalId: string): Promise<{ consumedAt: string | null; record: { approvalId: string } }> {
  const file = path.join(s.h.workspace, 'approvals', `${createHash('sha256').update(approvalId).digest('hex')}.json`)
  const payload = JSON.parse(await fs.readFile(file, 'utf8')) as { record: { approvalId: string; consumedAt: string | null } }
  return { consumedAt: payload.record.consumedAt, record: payload.record }
}

describe('V4.0 阶段3：一次性授权与重算提交', () => {
  it('S3-01 正常：预览 → 用户确认 → 提交，只新增一个正式版本并显示成功回执', async () => {
    const s = await setup()
    const beforeBytes = await bytesOf(s.path)
    const beforeRevisions = s.h.projectService.getSession(s.sessionId)!.snapshot.fileRevisions.length
    await stage(s, { deltaMm: '0.04' })
    const shown = await preview(s)
    expect(shown.value.geometry.lengthQ).toBe(120400)
    const summary = data(s.service.previewSummary(1))
    expect(summary).toMatchObject({ previewId: shown.previewId, draftId: s.draft.draftId, result: { minQ: 1100, maxQ: 2100 } })
    const approvalId = await approve(s, shown.previewId)
    const committed = data(await s.service.commitApprovedDraft(1, { approvalId, draftId: s.draft.draftId, previewFingerprint: shown.previewFingerprint }))
    expect(committed.revisionId).toMatch(/^rev-a-/)
    expect(committed.requirementStatus).toBeNull()
    expect(await bytesOf(s.path)).not.toEqual(beforeBytes)
    const session = s.h.projectService.getSession(s.sessionId)!
    expect(session.snapshot.project.currentRevisionId).toBe(committed.revisionId)
    expect(session.snapshot.fileRevisions.length).toBe(beforeRevisions + 1)
    expect(await approvalFile(s, approvalId)).toMatchObject({ consumedAt: expect.any(String), record: { approvalId } })
    expect(s.service.previewSummary(1)).toMatchObject({ ok: true, data: null })
  })

  it('S3-02 未授权直接提交：拒绝，项目字节不变', async () => {
    const s = await setup()
    await stage(s, { deltaMm: '0.04' })
    const shown = await preview(s)
    const before = await bytesOf(s.path)
    const rejected = await s.service.commitApprovedDraft(1, { approvalId: 'forged-approval-id', draftId: s.draft.draftId, previewFingerprint: shown.previewFingerprint })
    expect(rejected).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(await bytesOf(s.path)).toEqual(before)
  })

  it('S3-03 伪造 / 过期 / 跨窗口 / 跨项目 / 跨草稿令牌分别拒绝', async () => {
    const s = await setup()
    await stage(s, { deltaMm: '0.04' })
    const shown = await preview(s)
    const before = await bytesOf(s.path)

    const approvalId = await approve(s, shown.previewId)
    // 跨草稿：同 token，不同 draftId。
    expect(await s.service.commitApprovedDraft(1, { approvalId, draftId: 'agent-draft-other', previewFingerprint: shown.previewFingerprint }))
      .toMatchObject({ ok: false, code: 'NOT_CONFIRMED', details: { causeCode: 'DRAFT_MISMATCH' } })
    // 请求里的预览指纹与授权记录不符。
    expect(await s.service.commitApprovedDraft(1, { approvalId, draftId: s.draft.draftId, previewFingerprint: '0'.repeat(64) }))
      .toMatchObject({ ok: false, code: 'NOT_CONFIRMED', details: { causeCode: 'PREVIEW_MISMATCH' } })
    // 跨窗口：同一会话挂到窗口 2，授权仍绑定窗口 1。
    await s.h.controller.attach(2, s.sessionId)
    expect(await s.service.commitApprovedDraft(2, { approvalId, draftId: s.draft.draftId, previewFingerprint: shown.previewFingerprint }))
      .toMatchObject({ ok: false, code: 'NOT_CONFIRMED', details: { causeCode: 'WINDOW_MISMATCH' } })
    // 跨项目：用服务端记录签发一张属于其他项目的授权。
    const other = await s.approvals.issue({ windowId: 1, projectId: 'project-other', draftId: s.draft.draftId, draftRevision: s.draft.draftRevision, requirementRevisionId: null, previewFingerprint: shown.previewFingerprint, baseRevisionId: s.draft.baseRevisionId })
    expect(other.ok).toBe(true)
    if (!other.ok) return
    expect(await s.service.commitApprovedDraft(1, { approvalId: other.record.approvalId, draftId: s.draft.draftId, previewFingerprint: shown.previewFingerprint }))
      .toMatchObject({ ok: false, code: 'NOT_CONFIRMED', details: { causeCode: 'PROJECT_MISMATCH' } })
    // 过期：签发后推进时钟。
    const expiring = await approve(s, shown.previewId)
    s.clock.value += 11 * 60 * 1000
    expect(await s.service.commitApprovedDraft(1, { approvalId: expiring, draftId: s.draft.draftId, previewFingerprint: shown.previewFingerprint }))
      .toMatchObject({ ok: false, code: 'NOT_CONFIRMED', details: { causeCode: 'APPROVAL_EXPIRED' } })
    expect(await bytesOf(s.path)).toEqual(before)
  })

  it('S3-04 双击/重试同一令牌：只生成一个版本', async () => {
    const s = await setup()
    await stage(s, { deltaMm: '0.04' })
    const shown = await preview(s)
    const approvalId = await approve(s, shown.previewId)
    const beforeRevisions = s.h.projectService.getSession(s.sessionId)!.snapshot.fileRevisions.length
    const request = { approvalId, draftId: s.draft.draftId, previewFingerprint: shown.previewFingerprint }
    const [one, two] = await Promise.all([s.service.commitApprovedDraft(1, request), s.service.commitApprovedDraft(1, request)])
    const results = [one, two]
    expect(results.filter(item => item.ok)).toHaveLength(1)
    expect(results.filter(item => !item.ok)[0]).toMatchObject({ code: 'INVALID_INPUT' })
    expect(s.h.projectService.getSession(s.sessionId)!.snapshot.fileRevisions.length).toBe(beforeRevisions + 1)
    // 一次性语义的直接证据：已消费的 approvalId 不能再被占用（M13 锚点）。
    expect(await s.approvals.reserve(approvalId, 1)).toMatchObject({ ok: false, code: 'INVALID_INPUT', causeCode: 'APPROVAL_CONSUMED' })
    const consumedAt = (await approvalFile(s, approvalId)).consumedAt
    expect(consumedAt).not.toBeNull()
    // 顺序重试同样拒绝。
    expect(await s.service.commitApprovedDraft(1, request)).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(s.h.projectService.getSession(s.sessionId)!.snapshot.fileRevisions.length).toBe(beforeRevisions + 1)
    expect((await approvalFile(s, approvalId)).consumedAt).toBe(consumedAt)
  })

  it('S3-05 预览后改参数再提交：STALE_PREVIEW，必须重新预览确认', async () => {
    const s = await setup()
    await stage(s, { deltaMm: '0.04' })
    const shown = await preview(s)
    await stage(s, { deltaMm: '0.01' })
    const before = await bytesOf(s.path)
    const approvalId = await approve(s, shown.previewId)
    expect(await s.service.commitApprovedDraft(1, { approvalId, draftId: s.draft.draftId, previewFingerprint: shown.previewFingerprint }))
      .toMatchObject({ ok: false, code: 'STALE_PREVIEW', details: { causeCode: 'PREVIEW_STALE' } })
    expect(await bytesOf(s.path)).toEqual(before)
    // 重新预览并确认后才允许提交。
    const again = await preview(s)
    const nextApproval = await approve(s, again.previewId)
    const committed = data(await s.service.commitApprovedDraft(1, { approvalId: nextApproval, draftId: s.draft.draftId, previewFingerprint: again.previewFingerprint }))
    expect(committed.revisionId).toMatch(/^rev-a-/)
  })

  it('S3-06 提交写入注入 ENOSPC：无半提交，项目与历史字节不变；授权按策略已消费', async () => {
    const s = await setup()
    await stage(s, { deltaMm: '0.04' })
    const shown = await preview(s)
    const approvalId = await approve(s, shown.previewId)
    const before = await bytesOf(s.path)
    const beforeRevisions = s.h.projectService.getSession(s.sessionId)!.snapshot.fileRevisions.length
    s.hook.fn = async () => { throw Object.assign(new Error('injected ENOSPC'), { code: 'ENOSPC' }) }
    const failed = await s.service.commitApprovedDraft(1, { approvalId, draftId: s.draft.draftId, previewFingerprint: shown.previewFingerprint })
    s.hook.fn = null
    expect(failed).toMatchObject({ ok: false, code: 'SAVE_FAILED', details: { causeCode: 'NO_SPACE' } })
    expect(await bytesOf(s.path)).toEqual(before)
    expect(s.h.projectService.getSession(s.sessionId)!.snapshot.fileRevisions.length).toBe(beforeRevisions)
    expect((await approvalFile(s, approvalId)).consumedAt).not.toBeNull()
    expect(await s.service.commitApprovedDraft(1, { approvalId, draftId: s.draft.draftId, previewFingerprint: shown.previewFingerprint }))
      .toMatchObject({ ok: false, code: 'INVALID_INPUT', details: { causeCode: 'APPROVAL_CONSUMED' } })
    expect(await bytesOf(s.path)).toEqual(before)
  })

  it('S3-07 条款不满足时授权提交：拦截，正式版本不变', async () => {
    const s = await setup({ requirement: true })
    await stage(s, { valueMm: '12.10' })
    const shown = await preview(s)
    expect(shown.value.requirementPreview.status).toBe('pending-confirmation')
    const summary = data(s.service.previewSummary(1))
    expect(summary?.requirement).toMatchObject({ status: 'unsatisfied' })
    const approvalId = await approve(s, shown.previewId)
    const before = await bytesOf(s.path)
    const rejected = await s.service.commitApprovedDraft(1, { approvalId, draftId: s.draft.draftId, previewFingerprint: shown.previewFingerprint })
    expect(rejected).toMatchObject({ ok: false, code: 'CONSTRAINT_VIOLATED', details: { causeCode: 'REQUIREMENT_NOT_SATISFIED' } })
    expect(await bytesOf(s.path)).toEqual(before)
    expect(s.h.projectService.getSession(s.sessionId)!.snapshot.project.currentRevisionId).toBe(s.draft.baseRevisionId)
  })

  it('S3-08 locateEvidence 只读：定位成功且项目字节不变；无证据时 INVALID_INPUT', async () => {
    const s = await setup({ requirement: true })
    const before = await bytesOf(s.path)
    const requirement = data(s.service.locateEvidence(1, { requirementRevisionId: 'reqrev-1' }))
    expect(requirement).toMatchObject({ kind: 'requirement-source', revisionId: 'sr-1', page: 2 })
    expect(await bytesOf(s.path)).toEqual(before)
    const byCheck = data(s.service.locateEvidence(1, { checkId: 'check-base-1' }))
    expect(byCheck).toMatchObject({ kind: 'requirement-source', requirementRevisionId: 'reqrev-1', checkId: 'check-base-1' })
    const parameter = data(s.service.locateEvidence(1, { parameterId: 'param:spacer:length' }))
    expect(parameter).toMatchObject({ kind: 'parameter', key: 'length', termIds: ['t-s'] })
    expect(await bytesOf(s.path)).toEqual(before)
    expect(s.service.locateEvidence(1, { requirementRevisionId: 'missing-revision' }))
      .toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(s.service.locateEvidence(1, { requirementRevisionId: 'reqrev-1', parameterId: 'param:spacer:length' }))
      .toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(await bytesOf(s.path)).toEqual(before)
  })
})
