// @vitest-environment node
/**
 * ADR-001 第 3 步：导出口径（DXF/SVG 文件名与文件头）在真实导出代码路径上验证。
 *
 * 为什么不走系统对话框：macOS 原生保存对话框需要辅助功能权限；本会话不可用。
 * 这里把 `pickExportPath` 注入为固定目录（与桌面应用同一注入端口），
 * 其余路径（图纸重建、DXF 生成、原子写盘、回执）都是生产代码。
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { IPC_CHANNELS, type DrawingExportValue } from '../shared/contracts'
import { createHarness, type Harness } from './helpers/a04'
import { DrawingExportStore } from '../main/drawingExportStore'
import { registerDrawingChannels } from '../main/drawingChannels'
import { createIntentProjectSnapshot } from '../main/intentProject'
import { AgentToolService } from '../main/agentToolService'
import { ApprovalStore } from '../main/approvalStore'
import { ExtractionService } from '../main/extractionService'
import { intentDraftOf } from '../main/intentProject'

const USER_TEXT =
  '我要给 φ20 的轴配个隔套，外径 32，长 12.05；总长 52.25 偏差 0.02；两个轴承各 20 偏差 0.01；隔套 12.05 偏差 0.01；间隙 0.15 到 0.25'

let harness: Harness | null = null
let exportDir: string | null = null
afterEach(async () => {
  if (harness !== null) await harness.dispose()
  if (exportDir !== null) await fsp.rm(exportDir, { recursive: true, force: true })
  harness = null
  exportDir = null
})

describe('无任务书项目导出：文件名后缀与文件头标记', () => {
  it('DXF/SVG 建议文件名带 -userinput，DXF 999 注释与 SVG 注释都含依据', async () => {
    const h = await createHarness({ debounceMs: 60_000 })
    harness = h
    const snapshot = createIntentProjectSnapshot({
      name: '意图建套',
      identity: { actorId: '老王', sessionLabel: null },
      appVersion: 'test',
      electronVersion: 'test',
    })
    const opened = await h.openSample(snapshot)
    const service = new AgentToolService({
      controller: h.controller,
      projectService: h.projectService,
      recovery: h.recovery,
      rootDir: h.workspace,
      approvals: new ApprovalStore({ rootDir: h.workspace }),
    })
    const extraction = new ExtractionService({
      controller: h.controller,
      projectService: h.projectService,
      recovery: h.recovery,
    })
    const turn = { userText: USER_TEXT, turnId: 'turn-1' }
    expect((await service.run(1, 'setChain', {
      statement: USER_TEXT,
      rings: [
        { symbol: 'H', nominalMm: '52.25', upperDeviationMm: '0.02', lowerDeviationMm: '-0.02' },
        { symbol: 'B1', nominalMm: '20', upperDeviationMm: '0.01', lowerDeviationMm: '-0.01' },
        { symbol: 'S', nominalMm: '12.05', upperDeviationMm: '0.01', lowerDeviationMm: '-0.01' },
        { symbol: 'B2', nominalMm: '20', upperDeviationMm: '0.01', lowerDeviationMm: '-0.01' },
      ],
      formula: 'H - B1 - S - B2',
    }, turn)).ok).toBe(true)
    expect((await service.run(1, 'setRequirement', {
      statement: USER_TEXT, lowerMm: '0.15', upperMm: '0.25', lowerInclusive: true, upperInclusive: true,
    }, { userText: USER_TEXT, turnId: 'turn-2' })).ok).toBe(true)
    expect((await service.run(1, 'setBinding', {
      statement: USER_TEXT,
      parameters: [
        { parameter: 'innerDiameter', mm: '20' },
        { parameter: 'outerDiameter', mm: '32' },
        { parameter: 'length', mm: '12.05', symbol: 'S' },
      ],
    }, { userText: USER_TEXT, turnId: 'turn-2' })).ok).toBe(true)

    const session = h.projectService.getSession(opened.sessionId)!
    const draft = intentDraftOf(session.snapshot.project)!
    for (const candidate of draft.candidates) {
      const decided = await extraction.decide({
        sessionId: opened.sessionId,
        baseEditSeq: session.acceptedSeq,
        draftId: draft.draftId,
        candidateId: candidate.candidateId,
        editRevision: candidate.editRevision,
        action: 'confirm',
        confirmed: true,
      })
      expect(decided.ok, JSON.stringify(decided)).toBe(true)
    }
    expect((await service.applyIntentDraft(1)).ok).toBe(true)
    expect((await service.previewLatestDraft(1)).ok).toBe(true)
    const summary = service.previewSummary(1)
    if (!summary.ok || summary.data === null) throw new Error('缺少预览摘要')
    const approval = await service.issueApproval(1, summary.data.previewId, { userAttestationAcknowledged: true })
    if (!approval.ok) throw new Error(JSON.stringify(approval))
    const committed = await service.commitApprovedDraft(1, {
      approvalId: approval.data.approvalId,
      draftId: summary.data.draftId,
      previewFingerprint: summary.data.previewFingerprint,
    })
    expect(committed.ok, JSON.stringify(committed)).toBe(true)

    exportDir = await fsp.mkdtemp(path.join(h.directory, 'exports-'))
    const picked: { kind: string; suggestedName: string; target: string }[] = []
    registerDrawingChannels(h.ipc, {
      guard: h.guard,
      controller: h.controller,
      projectService: h.projectService,
      recovery: h.recovery,
      exportStore: new DrawingExportStore(),
      pickExportPath: async (_windowId, kind, suggestedName) => {
        const target = path.join(exportDir!, suggestedName)
        picked.push({ kind, suggestedName, target })
        return target
      },
      confirmOverwrite: async () => true,
      printPdf: async () => {
        throw new Error('本用例不导出 PDF')
      },
    })

    const project = session.snapshot.project
    const drawing = project.drawings[0]!
    const dxf = await h.invoke<DrawingExportValue>(IPC_CHANNELS.drawingExportDxfR12, {
      sessionId: opened.sessionId,
      baseEditSeq: session.acceptedSeq,
      drawingId: drawing.drawingId,
      drawingFingerprint: drawing.dataFingerprint,
    })
    expect(dxf.ok, JSON.stringify(dxf)).toBe(true)
    if (!dxf.ok) return
    expect(picked[0]!.suggestedName.endsWith('-userinput-DXF-R12.dxf')).toBe(true)
    expect(dxf.value.fileName.endsWith('-userinput-DXF-R12.dxf')).toBe(true)
    const bytes = await fsp.readFile(picked[0]!.target)
    const text = new TextDecoder('gb18030').decode(bytes)
    expect(text).toContain('依据：用户输入，无外部原文件')
    expect(text).toContain('999')
    console.log(`DXF_FILE ${dxf.value.fileName} bytes=${dxf.value.byteSize} sha256=${dxf.value.sha256}`)

    const svgExport = await h.invoke<DrawingExportValue>(IPC_CHANNELS.drawingExportSvg, {
      sessionId: opened.sessionId,
      baseEditSeq: session.acceptedSeq,
      drawingId: drawing.drawingId,
      drawingFingerprint: drawing.dataFingerprint,
    })
    expect(svgExport.ok, JSON.stringify(svgExport)).toBe(true)
    if (!svgExport.ok) return
    expect(svgExport.value.fileName.endsWith('-userinput.svg')).toBe(true)
    const svgFile = await fsp.readFile(picked[1]!.target, 'utf8')
    expect(svgFile).toContain('<!-- 依据：用户输入，无外部原文件 -->')
    console.log(`SVG_FILE ${svgExport.value.fileName} bytes=${svgExport.value.byteSize} sha256=${svgExport.value.sha256}`)
  })
})
