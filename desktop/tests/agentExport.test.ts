// @vitest-environment node
/**
 * V4.0 阶段 4：exportApprovedVersion（§6 最后一个工具）。
 *
 * 判据：
 * - 导出的文件名/大小/哈希来自实际落盘文件，不是拼出来的；
 * - 用户取消系统对话框 → CANCELLED，且没有产生文件；
 * - SVG 走真实渲染与结构校验；PDF 走注入的渲染端口（真实 printToPDF 在打包应用中走查）。
 */
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRequirementProject } from '../../src/requirements/__fixtures__/requirementFixture'
import { renderDrawingSvg } from '../../src/drawing/renderDrawingSvg'
import { rebuildDrawingFromProject } from '../../src/drawing/rebuildDrawing'
import { AgentToolService } from '../main/agentToolService'
import { ApprovalStore } from '../main/approvalStore'
import { createHarness, type Harness } from './helpers/a04'

const cleanup: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const h of cleanup.splice(0)) await h.dispose()
  for (const dir of dirs.splice(0)) await fsp.rm(dir, { recursive: true, force: true })
})

async function setup(options: {
  pick?: 'target' | null
  fileName?: string
  renderPdf?: (svg: string) => Uint8Array
} = {}) {
  const h = await createHarness({ debounceMs: 60_000 })
  cleanup.push(h)
  const project = await createRequirementProject()
  const opened = await h.openSample(project.snapshot)
  const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cunlian-export-'))
  dirs.push(outDir)
  const target = path.join(outDir, options.fileName ?? 'drawing.svg')
  const picks: string[] = []
  const service = new AgentToolService({
    controller: h.controller,
    projectService: h.projectService,
    recovery: h.recovery,
    rootDir: h.workspace,
    approvals: new ApprovalStore({ rootDir: h.workspace }),
    exportPorts: {
      pickTarget: async () => {
        if (options.pick === null) return null
        picks.push(target)
        return target
      },
      ...(options.renderPdf === undefined ? {} : { renderPdf: async (_windowId: number, svg: string) => options.renderPdf!(svg) }),
    },
  })
  return { h, sessionId: opened.sessionId, service, target, outDir, picks }
}

describe('V4.0 阶段4：exportApprovedVersion', () => {
  it('S05 dirty in-memory drawing is not exported as the saved revision', async () => {
    const s = await setup()
    const session = s.h.projectService.getSession(s.sessionId)!
    const saved = session.snapshot
    expect((await s.h.projectService.stage(s.sessionId, 1, { ...saved, project: { ...saved.project, currentRevisionId: 'unsaved-only', drawings: [] } })).ok).toBe(true)
    const result = await s.service.exportApprovedVersion(1, 'svg')
    expect(result).toMatchObject({ ok: false, code: 'SAVE_FAILED' })
    if (!result.ok) expect(result.message).toContain('先保存')
    expect(s.picks).toHaveLength(0)
    await expect(fsp.stat(s.target)).rejects.toThrow()
    expect(session.snapshot.project.currentRevisionId).toBe('unsaved-only')
    expect(session.acceptedSeq).toBeGreaterThan(session.savedSeq)
  })
  it('SVG 导出返回真实文件名/大小/哈希，文件内容与哈希一致', async () => {
    const s = await setup()
    const result = await s.service.exportApprovedVersion(1, 'svg')
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) return
    const value = result.data
    expect(value.status).toBe('EXPORTED')
    expect(value.fileName).toBe('drawing.svg')
    expect(value.sha256).toMatch(/^[0-9a-f]{64}$/)

    const bytes = await fsp.readFile(s.target)
    expect(value.byteSize).toBe(bytes.byteLength)
    expect(value.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    const text = bytes.toString('utf8')
    expect(text).toContain('<svg')
    // 与同一项目快照的确定性渲染逐字一致（导出的是已保存版本，不是临时草稿）。
    const session = s.h.projectService.getSession(s.sessionId)!
    const rebuilt = rebuildDrawingFromProject(session.snapshot.project)
    if (!rebuilt.ok) throw new Error('图纸重建失败')
    expect(text).toBe(renderDrawingSvg(rebuilt.data))
    expect(value.revisionId).toBe(session.snapshot.project.currentRevisionId)
  })

  it('S05 an externally changed saved file is rejected before selecting an export path', async () => {
    const s = await setup()
    const session = s.h.projectService.getSession(s.sessionId)!
    const memory = session.snapshot
    await fsp.writeFile(session.path!, 'external change')
    const result = await s.service.exportApprovedVersion(1, 'svg')
    expect(result).toMatchObject({ ok: false, code: 'STALE_BASE' })
    expect(s.picks).toHaveLength(0)
    expect(session.snapshot).toBe(memory)
    expect(await fsp.readFile(session.path!, 'utf8')).toBe('external change')
    await expect(fsp.stat(s.target)).rejects.toThrow()
  })
  it('用户在系统对话框取消 → CANCELLED，且没有产生文件', async () => {
    const s = await setup({ pick: null })
    const result = await s.service.exportApprovedVersion(1, 'svg')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('CANCELLED')
    expect(result.message).toContain('没有产生文件')
    await expect(fsp.stat(s.target)).rejects.toThrow()
    expect(s.picks).toHaveLength(0)
  })

  it('PDF 经渲染端口导出，落盘前校验 %PDF 头', async () => {
    const s = await setup({
      fileName: 'drawing.pdf',
      renderPdf: () => new TextEncoder().encode('%PDF-1.7\n% 合成测试内容\n'),
    })
    const result = await s.service.exportApprovedVersion(1, 'pdf')
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) return
    expect(result.data.fileName).toBe('drawing.pdf')
    const bytes = await fsp.readFile(s.target)
    expect(result.data.byteSize).toBe(bytes.byteLength)
    expect(result.data.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(bytes.toString('utf8').startsWith('%PDF-')).toBe(true)
  })

  it('未装配 PDF 端口时如实返回 UNSUPPORTED_SCOPE，不产生文件', async () => {
    const s = await setup({ fileName: 'drawing.pdf' })
    const result = await s.service.exportApprovedVersion(1, 'pdf')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('UNSUPPORTED_SCOPE')
    expect(s.picks).toHaveLength(0)
  })

  it('模型侧 export 工具参数非法时被 schema 拒绝（不进入导出）', async () => {
    const s = await setup()
    const result = await s.service.run(1, 'export', { format: 'dwg' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_INPUT')
    expect(s.picks).toHaveLength(0)
  })
})
