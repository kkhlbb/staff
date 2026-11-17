// @vitest-environment node
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRequirementProject } from '../../src/requirements/__fixtures__/requirementFixture'
import { createSavedVersionExport } from '../main/savedVersionExport'
import type { AgentExportPorts } from '../main/agentToolService'
import { DrawingExportStore } from '../main/drawingExportStore'
import { nodeFileOps } from '../main/fileStore'
import { createHarness, type Harness } from './helpers/a04'

const harnesses: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.dispose()
  for (const dir of dirs.splice(0)) await fsp.rm(dir, { recursive: true, force: true })
})
async function setup() {
  const h = await createHarness({ debounceMs: 60_000 })
  harnesses.push(h)
  const project = await createRequirementProject()
  const opened = await h.openSample(project.snapshot)
  const session = h.projectService.getSession(opened.sessionId)!
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'saved-export-'))
  dirs.push(dir)
  let picks = 0
  const target = path.join(dir, 'drawing.svg')
  const ports: AgentExportPorts = { pickTarget: async () => { picks++; return target } }
  const deps = { controller: h.controller, projectService: h.projectService, exportPorts: ports }
  const stage = async () => {
    expect((await h.projectService.stage(session.sessionId, session.acceptedSeq + 1, { ...session.snapshot, project: { ...session.snapshot.project, name: '未保存新编辑' } })).ok).toBe(true)
  }
  return { h, session, target, dir, ports, stage, picks: () => picks, task: (format: 'svg' | 'pdf' = 'svg') => createSavedVersionExport(deps, 1, format) }
}

describe('S05 独立已保存版本导出服务（生产入口接线单独由 agentExport 覆盖）', () => {
  it('已入队尚未发布的编辑也算 dirty，不会因另一事务占用队列而漏过导出门禁', async () => {
    const s = await setup()
    let entered!: () => void
    let release!: () => void
    const ready = new Promise<void>(r => { entered = r })
    const resume = new Promise<void>(r => { release = r })
    const blocker = s.h.projectService.transaction(s.session.sessionId, async () => { entered(); await resume })
    await ready
    const task = s.task()
    const staging = s.stage()
    try {
      expect(await task()).toMatchObject({ ok: false, code: 'CANCELLED' })
      expect(await s.task()()).toMatchObject({ ok: false, code: 'SAVE_FAILED' })
      expect(s.picks()).toBe(0)
      expect(await fsp.readdir(s.dir)).toEqual([])
    } finally { release(); await blocker; await staging }
  })
  it('dirty main 拒绝，不打开保存框、不自动保存、不产生文件', async () => {
    const s = await setup()
    const before = await fsp.readFile(s.session.path!)
    await s.stage()
    expect(await s.task()()).toMatchObject({ ok: false, code: 'SAVE_FAILED', message: expect.stringContaining('先保存') })
    expect(s.picks()).toBe(0)
    expect(await fsp.readFile(s.session.path!)).toEqual(before)
    expect(await fsp.readdir(s.dir)).toEqual([])
    expect(s.session.acceptedSeq).toBeGreaterThan(s.session.savedSeq)
  })
  it('干净状态 SVG 真实落盘', async () => {
    const s = await setup()
    const result = await s.task()()
    expect(result).toMatchObject({ ok: true, data: { status: 'EXPORTED', fileName: 'drawing.svg' } })
    expect(await fsp.readFile(s.target, 'utf8')).toContain('<svg')
  })
  it('保存后恢复导出，不替用户自动保存', async () => {
    const s = await setup()
    await s.stage()
    const save = await s.h.projectService.save(s.session.sessionId, { editSeq: s.session.acceptedSeq, expectedFingerprint: s.session.fingerprint })
    expect(save.ok).toBe(true)
    expect(await s.task()()).toMatchObject({ ok: true })
  })
  it('入队后但执行前编辑也取消（不能仅在 task 开始时捕获）', async () => {
    const s = await setup()
    const task = s.task()
    await s.stage()
    expect(await task()).toMatchObject({ ok: false, code: 'CANCELLED' })
    expect(s.picks()).toBe(0)
    expect(await fsp.readdir(s.dir)).toEqual([])
  })
  it('保存框 await 期间编辑：取消且不覆盖已有目标', async () => {
    const s = await setup()
    await fsp.writeFile(s.target, '用户原文件')
    s.ports.pickTarget = async () => { await Promise.resolve(); await s.stage(); return s.target }
    expect(await s.task()()).toMatchObject({ ok: false, code: 'CANCELLED', message: expect.stringContaining('先保存') })
    expect(await fsp.readFile(s.target, 'utf8')).toBe('用户原文件')
    expect(await fsp.readdir(s.dir)).toEqual(['drawing.svg'])
  })
  it('PDF 生成 await 期间编辑：不再打开保存框、不产生文件', async () => {
    const s = await setup()
    s.ports.renderPdf = async () => { await Promise.resolve(); await s.stage(); return new TextEncoder().encode('%PDF-1.7\n') }
    expect(await s.task('pdf')()).toMatchObject({ ok: false, code: 'CANCELLED' })
    expect(s.picks()).toBe(0)
    expect(await fsp.readdir(s.dir)).toEqual([])
  })
  it('临时文件写入 await 期间编辑：rename 前取消并清理临时文件', async () => {
    const s = await setup()
    let staging: Promise<void> | undefined
    await fsp.writeFile(s.target, '用户原文件')
    s.ports.store = new DrawingExportStore({ ops: {
      ...nodeFileOps,
      writeExclusive: async (file, bytes) => { await nodeFileOps.writeExclusive(file, bytes); staging = s.stage() },
    } })
    expect(await s.task()()).toMatchObject({ ok: false, code: 'CANCELLED' })
    await staging
    expect(await fsp.readFile(s.target, 'utf8')).toBe('用户原文件')
    expect(await fsp.readdir(s.dir)).toEqual(['drawing.svg'])
  })
  it('目标指纹 await 期间编辑：不启动临时文件写入', async () => {
    const s = await setup()
    class EditingStore extends DrawingExportStore {
      override async fingerprint(target: string) { const value = await super.fingerprint(target); await s.stage(); return value }
    }
    s.ports.store = new EditingStore()
    expect(await s.task()()).toMatchObject({ ok: false, code: 'CANCELLED' })
    expect(await fsp.readdir(s.dir)).toEqual([])
  })
  it('最终 rename 期间到达的编辑排在导出事务之后，不提前成功回执，也不自动保存项目', async () => {
    const s = await setup()
    const projectBefore = await fsp.readFile(s.session.path!)
    let staging: Promise<void> | undefined
    let stageSettled = false
    s.ports.store = new DrawingExportStore({ ops: { ...nodeFileOps,
      rename: async (from, to) => {
        staging = s.stage().then(() => { stageSettled = true })
        await Promise.resolve()
        expect(stageSettled).toBe(false)
        expect(s.session.acceptedSeq).toBe(s.session.savedSeq)
        await nodeFileOps.rename(from, to)
      },
    } })
    expect(await s.task()()).toMatchObject({ ok: true, data: { status: 'EXPORTED' } })
    await staging
    expect(s.session.acceptedSeq).toBeGreaterThan(s.session.savedSeq)
    expect(await fsp.readFile(s.session.path!)).toEqual(projectBefore)
    expect(await fsp.readFile(s.target, 'utf8')).toContain('<svg')
  })
})
