/**
 * DXF 导出 v1 · D-06 / D-07（系统对话框取消/成功回执）与通道级 D-08。
 *
 * 走真实 drawing:export-dxf-r12 / drawing:export-dxf-2000 通道与真实
 * DrawingExportStore（临时目录），用 dxf-parser 读回磁盘文件。
 */
import { promises as fsp } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import DxfParser from 'dxf-parser'
import { afterEach, describe, expect, it } from 'vitest'
import { IPC_CHANNELS, type DrawingExportValue, type DrawingUpdateValue } from '../shared/contracts'
import { createHarness, type Harness } from './helpers/a04'
import { registerDrawingChannels } from '../main/drawingChannels'
import { DrawingExportStore } from '../main/drawingExportStore'

const BASE_INPUTS = { innerDiameter: '20.00', outerDiameter: '32.00', length: '12.05' }
const FRAME = {
  partName: '隔套',
  drawingNumber: 'DEMO-001',
  version: '',
  material: '',
  tolerance: '',
  surface: '',
  drafter: '',
  date: '',
}

let harness: Harness | null = null
let exportDir: string | null = null

afterEach(async () => {
  if (harness !== null) await harness.dispose()
  if (exportDir !== null) await fsp.rm(exportDir, { recursive: true, force: true })
  harness = null
  exportDir = null
})

interface DxfHarness {
  harness: Harness
  opened: Awaited<ReturnType<Harness['openSample']>>
  pickQueue: (string | null)[]
  picked: string[]
}

async function createDxfHarness(): Promise<DxfHarness> {
  const base = await createHarness()
  const pickQueue: (string | null)[] = []
  const picked: string[] = []
  registerDrawingChannels(base.ipc, {
    guard: base.guard,
    controller: base.controller,
    projectService: base.projectService,
    recovery: base.recovery,
    exportStore: new DrawingExportStore(),
    pickExportPath: async (_windowId, _kind, suggestedName) => {
      picked.push(suggestedName)
      return pickQueue.shift() ?? null
    },
    confirmOverwrite: async () => true,
    printPdf: async () => {
      throw new Error('DXF 用例不应调用 PDF 打印')
    },
  })
  const opened = await base.openSample()
  harness = base
  exportDir = await fsp.mkdtemp(path.join(base.directory, 'dxf-exports-'))
  return { harness: base, opened, pickQueue, picked }
}

function updateRequest(sessionId: string, baseEditSeq: number) {
  return {
    sessionId,
    baseEditSeq,
    partId: 'builtin:shaft-demo:spacer',
    inputs: BASE_INPUTS,
    scale: { numerator: 1, denominator: 1 },
    frameFields: FRAME,
  }
}

async function update(context: DxfHarness): Promise<DrawingUpdateValue> {
  const updated = await context.harness.invoke<DrawingUpdateValue>(
    IPC_CHANNELS.drawingUpdateSpacer,
    updateRequest(context.opened.sessionId, 0),
  )
  if (!updated.ok) throw new Error(`update failed: ${updated.error.code} ${updated.error.message}`)
  return updated.value
}

function request(context: DxfHarness, value: DrawingUpdateValue) {
  return {
    sessionId: context.opened.sessionId,
    baseEditSeq: 1,
    drawingId: value.drawingId,
    drawingFingerprint: value.drawingFingerprint,
  }
}

describe('D-07 保存成功：回执文件名/字节数/SHA-256 与磁盘一致', () => {
  for (const [channel, label, acadVersion] of [
    [IPC_CHANNELS.drawingExportDxfR12, 'r12', 'AC1009'],
    [IPC_CHANNELS.drawingExportDxf2000, '2000', 'AC1015'],
  ] as const) {
    it(`${label}：写盘后用 dxf-parser 读回，实体/图层/外廓/文字都对`, async () => {
      const context = await createDxfHarness()
      const value = await update(context)
      const target = path.join(exportDir!, `隔套-DXF-${label}.dxf`)
      context.pickQueue.push(target)

      const exported = await context.harness.invoke<DrawingExportValue>(channel, request(context, value))
      expect(exported.ok).toBe(true)
      if (!exported.ok) return

      const disk = new Uint8Array(await fsp.readFile(target))
      const diskHash = createHash('sha256').update(disk).digest('hex')
      expect(exported.value.fileName).toBe(path.basename(target))
      expect(exported.value.byteSize).toBe(disk.byteLength)
      expect(exported.value.sha256).toBe(diskHash)
      expect(exported.value.drawingFingerprint).toBe(value.drawingFingerprint)
      // 建议文件名带版本后缀，默认在“文稿”目录。
      expect(context.picked.at(-1)).toMatch(new RegExp(`-DXF-${label === 'r12' ? 'R12' : '2000'}\\.dxf$`, 'u'))

      // 读回（GBK 解码）：版本头、图层、实体、文字。
      const parsed = new DxfParser().parseSync(new TextDecoder('gbk').decode(disk))
      expect(parsed).not.toBeNull()
      const acad = (parsed!.header as Record<string, unknown>).$ACADVER
      expect(acad).toBeDefined()
      const text = new TextDecoder('gbk').decode(disk)
      expect(text).toContain(`$ACADVER\r\n1\r\n${acadVersion}`)
      expect(Object.keys(parsed!.tables.layer.layers).sort()).toEqual(
        ['图框', '尺寸', '文字', '中心线', '轮廓'].sort(),
      )
      // 2000 的标注文字在匿名标注块里（真 DIMENSION 引用的几何块），读回要连块内容一起看。
      const blockEntities = Object.values(parsed!.blocks ?? {}).flatMap((block) => block.entities ?? [])
      const texts = [...parsed!.entities, ...blockEntities]
        .filter((entity) => entity.type === 'TEXT')
        .map((entity) => (entity as unknown as { text: string }).text)
      expect(texts).toContain('12.050')
      expect(texts).toContain('%%c20.000')
      expect(texts.some((item) => item.includes('待复核草稿'))).toBe(true)
      // 落盘文件不是空的、也不是半截：以 EOF 结尾。
      expect(text.trimEnd().endsWith('EOF')).toBe(true)
    })
  }
})

describe('D-06 取消保存：返回 CANCELLED 且没有文件', () => {
  it('对话框返回 null → CANCELLED，目录里没有任何 .dxf/.tmp', async () => {
    const context = await createDxfHarness()
    const value = await update(context)
    context.pickQueue.push(null)
    const exported = await context.harness.invoke(IPC_CHANNELS.drawingExportDxfR12, request(context, value))
    expect(exported.ok).toBe(false)
    if (!exported.ok) {
      expect(exported.error.code).toBe('CANCELLED')
    }
    const files = await fsp.readdir(exportDir!)
    expect(files).toEqual([])
  })

  it('已有目标时原子替换：回执哈希与磁盘一致，不残留临时文件', async () => {
    const context = await createDxfHarness()
    const value = await update(context)
    const target = path.join(exportDir!, 'existing.dxf')
    await fsp.writeFile(target, 'ORIGINAL-DXF')
    context.pickQueue.push(target)
    const exported = await context.harness.invoke<DrawingExportValue>(
      IPC_CHANNELS.drawingExportDxf2000,
      request(context, value),
    )
    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    const disk = await fsp.readFile(target)
    expect(createHash('sha256').update(disk).digest('hex')).toBe(exported.value.sha256)
    expect(disk.toString('utf8')).not.toBe('ORIGINAL-DXF')
    expect((await fsp.readdir(exportDir!)).filter((name) => name.includes('.tmp'))).toEqual([])
  })
})

describe('D-08 通道级：没有图纸时明确报错，不弹对话框、不产生文件', () => {
  it('项目没有图纸草稿 → DRAWING_NOT_FOUND，pickExportPath 0 次调用', async () => {
    const context = await createDxfHarness()
    const exported = await context.harness.invoke(IPC_CHANNELS.drawingExportDxfR12, {
      sessionId: context.opened.sessionId,
      baseEditSeq: 0,
      drawingId: 'drawing:project-a:spacer',
      drawingFingerprint: 'a'.repeat(64),
    })
    expect(exported.ok).toBe(false)
    if (!exported.ok) expect(exported.error.code).toBe('DRAWING_NOT_FOUND')
    expect(context.picked).toEqual([])
    expect(await fsp.readdir(exportDir!)).toEqual([])
  })

  it('过期指纹 / 过期序号拒绝导出，且不产生文件', async () => {
    const context = await createDxfHarness()
    const value = await update(context)

    const staleFingerprint = await context.harness.invoke(IPC_CHANNELS.drawingExportDxfR12, {
      ...request(context, value),
      drawingFingerprint: 'f'.repeat(64),
    })
    expect(staleFingerprint.ok).toBe(false)
    if (!staleFingerprint.ok) expect(staleFingerprint.error.code).toBe('STALE_DRAWING')

    const staleSeq = await context.harness.invoke(IPC_CHANNELS.drawingExportDxf2000, {
      ...request(context, value),
      baseEditSeq: 0,
    })
    expect(staleSeq.ok).toBe(false)
    if (!staleSeq.ok) expect(staleSeq.error.code).toBe('STALE_EDIT')

    expect(context.picked).toEqual([])
    expect(await fsp.readdir(exportDir!)).toEqual([])
  })
})
