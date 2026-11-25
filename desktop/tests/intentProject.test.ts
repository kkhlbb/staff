// @vitest-environment node
/**
 * ADR-001 第 3 步：无任务书入口（意图建件）主进程全链路。
 *
 * 覆盖：
 * - 空白项目 → createProject 就地转换（projectId 不变，sourceKind=user-intent）；
 * - setChain / setRequirement / setBinding 只写意图草稿 + 断言账本；
 * - 模型代填条款 → REQUIREMENT_MUST_BE_USER_GIVEN（M25 目标）；
 * - 跨会话伪造 attestation → 拒绝（M24 覆盖新工具）；
 * - 用户逐条确认 → applyIntentDraft（planApplication）→ 预览 → 勾选 → 提交；
 * - 提交后：条款版本冻结（用户断言来源）、图纸标题栏/导出物带依据标记。
 */
import { promises as fs } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { createNewProjectSnapshot } from '../main/newProject'
import { AgentToolService } from '../main/agentToolService'
import { ApprovalStore } from '../main/approvalStore'
import { ExtractionService } from '../main/extractionService'
import { intentDraftOf } from '../main/intentProject'
import { intentDraftId } from '../../src/intent/draft'
import { createHarness, type Harness } from './helpers/a04'
import { rebuildDrawingFromProject } from '../../src/drawing/rebuildDrawing'
import { buildDxfDocument } from '../../src/drawing/dxfExport'
import { renderDrawingSvg } from '../../src/drawing/renderDrawingSvg'
import { USER_INPUT_BASIS } from '../../src/drawing/types'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import type { SessionController } from '../main/sessionController'

const cleanup: { dispose: () => Promise<void> }[] = []
afterEach(async () => {
  for (const item of cleanup.splice(0)) await item.dispose()
})

const USER_TEXT =
  '我要给 φ20 的轴配个隔套，外径 32，长 12.05；总长 52.25 偏差 0.02；两个轴承各 20 偏差 0.01；隔套 12.05 偏差 0.01；间隙 0.15 到 0.25'

const RINGS = [
  { symbol: 'H', nominalMm: '52.25', upperDeviationMm: '0.02', lowerDeviationMm: '-0.02' },
  { symbol: 'B1', nominalMm: '20', upperDeviationMm: '0.01', lowerDeviationMm: '-0.01' },
  { symbol: 'S', nominalMm: '12.05', upperDeviationMm: '0.01', lowerDeviationMm: '-0.01' },
  { symbol: 'B2', nominalMm: '20', upperDeviationMm: '0.01', lowerDeviationMm: '-0.01' },
]

interface Setup {
  h: Harness
  controller: SessionController
  service: AgentToolService
  approvals: ApprovalStore
  extraction: ExtractionService
  sessionId: string
}

async function createSetup(): Promise<Setup> {
  const h = await createHarness({ debounceMs: 60_000 })
  cleanup.push(h)
  const blank = createNewProjectSnapshot({
    name: '空白项目',
    template: 'empty',
    appVersion: 'test',
    electronVersion: 'test',
  })
  const opened = await h.openSample(blank)
  const approvals = new ApprovalStore({ rootDir: h.workspace })
  const service = new AgentToolService({
    controller: h.controller,
    projectService: h.projectService,
    recovery: h.recovery,
    rootDir: h.workspace,
    approvals,
    appVersion: 'test',
    electronVersion: 'test',
  })
  const extraction = new ExtractionService({
    controller: h.controller,
    projectService: h.projectService,
    recovery: h.recovery,
  })
  return { h, controller: h.controller, service, approvals, extraction, sessionId: opened.sessionId }
}

function projectOf(setup: Setup): ProjectFileSnapshot['project'] {
  return setup.controller.sessionFor(1)!.snapshot.project
}

async function runCreate(setup: Setup) {
  return setup.service.run(
    1,
    'createProject',
    { name: 'φ20 轴隔套', partType: 'spacer' },
    {
      userText: USER_TEXT,
      turnId: 'turn-1',
      intentIdentity: { actorId: '老王', sessionLabel: '2026-11-12 复检' },
    },
  )
}

async function runChain(setup: Setup, statement = USER_TEXT, turnId = 'turn-1') {
  return setup.service.run(
    1,
    'setChain',
    { statement, rings: RINGS, formula: 'H - B1 - S - B2' },
    { userText: USER_TEXT, turnId },
  )
}

async function runRequirement(
  setup: Setup,
  values: { lowerMm: string; upperMm: string; statement?: string } = { lowerMm: '0.15', upperMm: '0.25' },
) {
  return setup.service.run(
    1,
    'setRequirement',
    {
      statement: values.statement ?? USER_TEXT,
      lowerMm: values.lowerMm,
      upperMm: values.upperMm,
      lowerInclusive: true,
      upperInclusive: true,
    },
    { userText: USER_TEXT, turnId: 'turn-2' },
  )
}

async function runBinding(setup: Setup) {
  return setup.service.run(
    1,
    'setBinding',
    {
      statement: USER_TEXT,
      parameters: [
        { parameter: 'innerDiameter', mm: '20' },
        { parameter: 'outerDiameter', mm: '32' },
        { parameter: 'length', mm: '12.05', symbol: 'S' },
      ],
    },
    { userText: USER_TEXT, turnId: 'turn-2' },
  )
}

async function confirmAll(setup: Setup) {
  const session = setup.controller.sessionFor(1)!
  const draft = intentDraftOf(session.snapshot.project)
  if (draft === null) throw new Error('意图草稿不存在')
  for (const candidate of draft.candidates) {
    const result = await setup.extraction.decide({
      sessionId: setup.sessionId,
      baseEditSeq: session.acceptedSeq,
      draftId: draft.draftId,
      candidateId: candidate.candidateId,
      editRevision: candidate.editRevision,
      action: 'confirm',
      confirmed: true,
    })
    if (!result.ok) throw new Error(`确认失败：${result.error.code} ${result.error.message}`)
  }
}

async function commitFlow(setup: Setup) {
  const applied = await setup.service.applyIntentDraft(1)
  expect(applied.ok, JSON.stringify(applied)).toBe(true)
  const preview = await setup.service.previewLatestDraft(1)
  expect(preview.ok, JSON.stringify(preview)).toBe(true)
  const summary = setup.service.previewSummary(1)
  expect(summary.ok).toBe(true)
  if (!summary.ok || summary.data === null) throw new Error('缺少预览摘要')
  const signed = await setup.service.issueApproval(1, summary.data.previewId, {
    userAttestationAcknowledged: true,
  })
  expect(signed.ok, JSON.stringify(signed)).toBe(true)
  if (!signed.ok) throw new Error('授权失败')
  const committed = await setup.service.commitApprovedDraft(1, {
    approvalId: signed.data.approvalId,
    draftId: summary.data.draftId,
    previewFingerprint: summary.data.previewFingerprint,
  })
  expect(committed.ok, JSON.stringify(committed)).toBe(true)
  return { summary: summary.data, committed }
}

describe('无任务书入口：建项 → 对话写草稿 → 确认 → 预览 → 勾选 → 提交', () => {
  it('空白项目就地转成无任务书项目：projectId 不变、来源种类与责任人写入项目', async () => {
    const setup = await createSetup()
    const before = projectOf(setup)
    const created = await runCreate(setup)
    expect(created.ok, JSON.stringify(created)).toBe(true)
    const after = projectOf(setup)
    expect(after.id).toBe(before.id)
    expect(after.sourceKind).toBe('user-intent')
    expect(after.actorId).toBe('老王')
    expect(after.sessionSeq).toBe(1)
    expect(after.sessionLabel).toBe('2026-11-12 复检')
    expect(after.attestations).toEqual([])
    expect(intentDraftOf(after)?.draftId).toBe(intentDraftId(after.id))
    if (created.ok) expect((created.data as { actorId: string }).actorId).toBe('老王')
  })

  it('三个写工具只产草稿：候选 pending、断言账本逐条留原话，不改链/参数/条款', async () => {
    const setup = await createSetup()
    await runCreate(setup)
    expect((await runChain(setup)).ok).toBe(true)
    expect((await runRequirement(setup)).ok).toBe(true)
    expect((await runBinding(setup)).ok).toBe(true)
    const project = projectOf(setup)
    const draft = intentDraftOf(project)!
    expect(draft.candidates.every((candidate) => candidate.status === 'pending')).toBe(true)
    expect(draft.candidates.filter((candidate) => candidate.kind === 'ring')).toHaveLength(4)
    expect(draft.candidates.some((candidate) => candidate.kind === 'interval')).toBe(true)
    expect(draft.candidates.some((candidate) => candidate.kind === 'part-dimension')).toBe(true)
    // 项目本身没有被写：链仍是占位链、没有参数/条款/图纸。
    expect(project.dimensionChain.terms.map((term) => term.symbol)).toEqual(['A', 'B'])
    expect(project.parameters).toEqual([])
    expect(project.requirementRevisions).toEqual([])
    expect(project.drawings).toEqual([])
    // 断言账本：每条原话逐字、第 1/2 次输入分开记。
    expect(project.attestations.length).toBeGreaterThanOrEqual(3)
    expect(project.attestations.every((item) => item.statement === USER_TEXT)).toBe(true)
    expect(new Set(project.attestations.map((item) => item.sessionSeq))).toEqual(new Set([1, 2]))
    expect(project.sessionSeq).toBe(2)
  })

  it('M25 目标：模型代填条款（数值不在用户原话里）→ REQUIREMENT_MUST_BE_USER_GIVEN', async () => {
    const setup = await createSetup()
    await runCreate(setup)
    await runChain(setup)
    const rejected = await runRequirement(setup, { lowerMm: '0.12', upperMm: '0.28' })
    expect(rejected).toMatchObject({ ok: false, code: 'REQUIREMENT_MUST_BE_USER_GIVEN' })
    // 用别的话当原话也不行（不是本轮逐字）。
    const rejectedStatement = await runRequirement(setup, {
      lowerMm: '0.15',
      upperMm: '0.25',
      statement: '间隙按 GB/T 5847 查表取 0.15 到 0.25',
    })
    expect(rejectedStatement).toMatchObject({ ok: false, code: 'REQUIREMENT_MUST_BE_USER_GIVEN' })
  })

  it('M24 覆盖新工具：跨会话伪造 attestation → 拒绝生成工程草稿', async () => {
    const setup = await createSetup()
    await runCreate(setup)
    await runChain(setup)
    await runRequirement(setup)
    await runBinding(setup)
    await confirmAll(setup)
    const session = setup.controller.sessionFor(1)!
    const project = session.snapshot.project
    const forged: ProjectFileSnapshot['project'] = {
      ...project,
      extractionDrafts: project.extractionDrafts.map((draft) => ({
        ...draft,
        candidates: draft.candidates.map((candidate) =>
          candidate.kind === 'ring'
            ? {
                ...candidate,
                provenance: (candidate.provenance ?? []).map((ref) =>
                  ref.kind === 'user-attestation' ? { ...ref, actorId: 'mallory' } : ref,
                ),
                data: {
                  ...candidate.data,
                  nominal:
                    candidate.data.nominal === null
                      ? null
                      : {
                          ...candidate.data.nominal,
                          provenance: (candidate.data.nominal.provenance ?? []).map((ref) =>
                            ref.kind === 'user-attestation' ? { ...ref, actorId: 'mallory' } : ref,
                          ),
                        },
                },
              }
            : candidate,
        ),
      })),
    }
    session.snapshot = { ...session.snapshot, project: forged }
    const applied = await setup.service.applyIntentDraft(1)
    expect(applied).toMatchObject({ ok: false, code: 'CONSTRAINT_VIOLATED' })
  })

  it('未勾选“这些尺寸由我提供”→ 不签发授权；勾选后提交成功并冻结条款/依据', async () => {
    const setup = await createSetup()
    await runCreate(setup)
    await runChain(setup)
    await runRequirement(setup)
    await runBinding(setup)
    await confirmAll(setup)
    const applied = await setup.service.applyIntentDraft(1)
    expect(applied.ok, JSON.stringify(applied)).toBe(true)
    const preview = await setup.service.previewLatestDraft(1)
    expect(preview.ok, JSON.stringify(preview)).toBe(true)
    const summary = setup.service.previewSummary(1)
    if (!summary.ok || summary.data === null) throw new Error('缺少预览摘要')
    expect(summary.data.requirement?.status).toBe('satisfied')
    const refused = await setup.service.issueApproval(1, summary.data.previewId)
    expect(refused).toMatchObject({ ok: false, code: 'NOT_CONFIRMED' })

    const signed = await setup.service.issueApproval(1, summary.data.previewId, {
      userAttestationAcknowledged: true,
    })
    expect(signed.ok, JSON.stringify(signed)).toBe(true)
    if (!signed.ok) return
    const committed = await setup.service.commitApprovedDraft(1, {
      approvalId: signed.data.approvalId,
      draftId: summary.data.draftId,
      previewFingerprint: summary.data.previewFingerprint,
    })
    expect(committed.ok, JSON.stringify(committed)).toBe(true)

    const project = projectOf(setup)
    expect(project.dimensionChain.terms.map((term) => term.symbol)).toEqual(['H', 'B1', 'S', 'B2'])
    expect(project.dimensionChain.terms.find((term) => term.symbol === 'H')?.nominalQ).toBe(522500)
    expect(project.parameters.map((parameter) => parameter.key).sort()).toEqual([
      'innerDiameter',
      'length',
      'outerDiameter',
    ])
    expect(project.requirementRevisions).toHaveLength(1)
    const requirement = project.requirementRevisions[0]!
    expect(requirement.source.kind).toBe('user-attestation')
    if (requirement.source.kind === 'user-attestation') {
      expect(requirement.source.attestation.statement).toBe(USER_TEXT)
      expect(requirement.source.attestation.actorId).toBe('老王')
    }
    expect(requirement.lowerQ).toBe(1500)
    expect(requirement.upperQ).toBe(2500)
    expect(project.attestations.length).toBeGreaterThanOrEqual(3)
    // 提交后：图纸依据栏与文件头标记齐全。
    const record = project.drawings[0]!
    expect(record.frameFields.basis).toBe(USER_INPUT_BASIS)
    // 版本栏：可读的「草稿 · 第 N 版」（N = 提交后的版本序号），不印内部 revision UUID。
    const revisionCount = setup.controller.sessionFor(1)!.snapshot.fileRevisions.length
    expect(record.frameFields.version).toBe(`草稿 · 第 ${revisionCount} 版`)
    expect(record.frameFields.version).toContain('第 2 版')
    const rebuilt = rebuildDrawingFromProject(project)
    expect(rebuilt.ok, JSON.stringify(rebuilt)).toBe(true)
    if (!rebuilt.ok) return
    const svg = renderDrawingSvg(rebuilt.data)
    expect(svg).toContain(`<!-- ${USER_INPUT_BASIS} -->`)
    expect(svg).toContain('依据')
    expect(svg).toContain('用户输入，无外部原文件')
    // 图上不许出现 ≥32 位连续十六进制串（内部 UUID/指纹只留在文件与机器元数据里）。
    const visible = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gu)].map((match) => match[1] ?? '').join('\n')
    expect(visible).toContain(record.frameFields.version)
    expect(visible).not.toContain(record.revisionId)
    expect(visible).not.toMatch(/[0-9a-f]{32,}/iu)
    const dxf = buildDxfDocument(rebuilt.data, 'r12')
    expect(dxf.text).toContain('999')
    expect(dxf.text).toContain(USER_INPUT_BASIS)
    expect(dxf.text).toContain('依据')
    // 提交后的项目仍是 schema 11 且保留来源种类。
    expect(project.schemaVersion).toBe(11)
    expect(project.sourceKind).toBe('user-intent')
  })

  it('落盘文件可重新读入：来源种类、断言账本与条款来源逐字段保留', async () => {
    const setup = await createSetup()
    await runCreate(setup)
    await runChain(setup)
    await runRequirement(setup)
    await runBinding(setup)
    await confirmAll(setup)
    const { committed } = await commitFlow(setup)
    expect(committed.ok).toBe(true)
    if (!committed.ok) return
    const bytes = await fs.readFile(committed.data.path)
    const { decodeProjectFile } = await import('../../src/project-file/codec')
    const decoded = await decodeProjectFile(new Uint8Array(bytes))
    expect(decoded.ok, JSON.stringify(decoded)).toBe(true)
    if (!decoded.ok) return
    const project = decoded.value.snapshot.project
    expect(project.schemaVersion).toBe(11)
    expect(project.sourceKind).toBe('user-intent')
    expect(project.actorId).toBe('老王')
    expect(project.sessionSeq).toBe(2)
    expect(project.attestations.length).toBeGreaterThanOrEqual(3)
    expect(project.requirementRevisions[0]?.source.kind).toBe('user-attestation')
  })
})
