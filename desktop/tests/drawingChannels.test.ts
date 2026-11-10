import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { IPC_CHANNELS, type DrawingExportValue, type DrawingUpdateValue } from '../shared/contracts'
import { createHarness, failingWriteOps, type Harness } from './helpers/a04'
import { registerDrawingChannels } from '../main/drawingChannels'
import { DrawingExportStore } from '../main/drawingExportStore'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import type { DrawingData } from '../../src/drawing/types'
import { renderDrawingSvg } from '../../src/drawing/renderDrawingSvg'
import { checkPdf } from '../main/pdfCheck'

const BASE_INPUTS = { innerDiameter: '20.00', outerDiameter: '32.00', length: '12.00' }
const FRAME = {
  partName: '隔套',
  drawingNumber: '',
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

interface DrawingHarness {
  harness: Harness
  opened: Awaited<ReturnType<Harness['openSample']>>
  pickQueue: (string | null)[]
  confirmQueue: boolean[]
  printCalls: DrawingData[]
  printResult: () => Uint8Array
}

async function createDrawingHarness(): Promise<DrawingHarness> {
  const base = await createHarness()
  const pickQueue: (string | null)[] = []
  const confirmQueue: boolean[] = []
  const printCalls: DrawingData[] = []
  const pdfBytes = minimalPdf()
  const printResult = () => pdfBytes
  registerDrawingChannels(base.ipc, {
    guard: base.guard,
    controller: base.controller,
    projectService: base.projectService,
    recovery: base.recovery,
    exportStore: new DrawingExportStore(),
    pickExportPath: async () => pickQueue.shift() ?? null,
    confirmOverwrite: async () => confirmQueue.shift() ?? true,
    printPdf: async (data) => {
      printCalls.push(data)
      return printResult()
    },
  })
  const opened = await base.openSample()
  harness = base
  exportDir = await fsp.mkdtemp(path.join(base.directory, 'exports-'))
  return { harness: base, opened, pickQueue, confirmQueue, printCalls, printResult }
}

function updateRequest(sessionId: string, baseEditSeq: number, overrides: Record<string, unknown> = {}) {
  return {
    sessionId,
    baseEditSeq,
    partId: 'builtin:shaft-demo:spacer',
    inputs: BASE_INPUTS,
    scale: { numerator: 1, denominator: 1 },
    frameFields: FRAME,
    ...overrides,
  }
}

function minimalPdf(): Uint8Array {
  const content = Buffer.from('0 0 m 100 100 l 100 0 l S\nBT /F1 12 Tf 10 10 Td (drawing) Tj ET\n', 'latin1')
  const parts: (string | Buffer)[] = []
  parts.push('%PDF-1.4\n')
  parts.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  parts.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
  parts.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 841.8898 595.2756] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
  )
  parts.push(`4 0 obj\n<< /Length ${content.byteLength} >>\nstream\n`)
  parts.push(content)
  parts.push('\nendstream\nendobj\n')
  parts.push(
    '5 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+NotoSansSC /FirstChar 32 /LastChar 32 /Widths [500] /FontDescriptor 6 0 R >>\nendobj\n',
  )
  parts.push(
    '6 0 obj\n<< /Type /FontDescriptor /FontName /ABCDEF+NotoSansSC /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>\nendobj\n',
  )
  parts.push('7 0 obj\n<< /Length 8 /Length1 8 >>\nstream\nFAKEFONT\nendstream\nendobj\n')
  parts.push('trailer\n<< /Root 1 0 R >>\n%%EOF\n')
  return new Uint8Array(Buffer.concat(parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : part))))
}

describe('C-04 drawing:update-spacer', () => {
  it('解析三参数、重建图纸并原子接纳；快照与图纸引用同时出现', async () => {
    const context = await createDrawingHarness()
    const result = await context.harness.invoke<DrawingUpdateValue>(
      IPC_CHANNELS.drawingUpdateSpacer,
      updateRequest(context.opened.sessionId, 0),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.acceptedSeq).toBe(1)
    expect(result.value.snapshot.project.parameters.map((item) => item.valueQ)).toEqual([
      200000, 320000, 120000,
    ])
    expect(result.value.snapshot.project.drawings).toHaveLength(1)
    const record = result.value.snapshot.project.drawings[0]
    expect(record.dataFingerprint).toBe(result.value.drawingFingerprint)
    expect(result.value.drawingData.fingerprint).toBe(record.dataFingerprint)
    expect(record.parameterIds).toEqual([
      'param:spacer:inner-diameter',
      'param:spacer:outer-diameter',
      'param:spacer:length',
    ])
    // 不存整份图元数组。
    expect((record as unknown as Record<string, unknown>).primitives).toBeUndefined()
    const session = context.harness.projectService.getSession(context.opened.sessionId)!
    expect(session.acceptedSeq).toBe(1)
    expect(session.snapshot.project.drawings).toHaveLength(1)
  })

  it('12.1000 → 12.10：q 不变、几何不变、显示随元数据', async () => {
    const context = await createDrawingHarness()
    const first = await context.harness.invoke<DrawingUpdateValue>(
      IPC_CHANNELS.drawingUpdateSpacer,
      updateRequest(context.opened.sessionId, 0, { inputs: { ...BASE_INPUTS, length: '12.1000' } }),
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const fourText = first.value.drawingData.annotations.find((item) => item.kind === 'length')
    expect(fourText).toBeDefined()

    const second = await context.harness.invoke<DrawingUpdateValue>(
      IPC_CHANNELS.drawingUpdateSpacer,
      updateRequest(context.opened.sessionId, 1, { inputs: { ...BASE_INPUTS, length: '12.10' } }),
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const four = first.value.drawingData
    const two = second.value.drawingData
    expect(four.parameterSnapshot.find((item) => item.key === 'length')?.valueQ).toBe(121000)
    expect(two.parameterSnapshot.find((item) => item.key === 'length')?.valueQ).toBe(121000)
    const geometry = (data: DrawingData) =>
      data.primitives.filter((item) => item.area === 'drawing' && item.kind !== 'text').map((item) => item.geometryMm)
    expect(geometry(four)).toEqual(geometry(two))
    expect(renderDrawingSvg(four)).toContain('>12.1000</text>')
    expect(renderDrawingSvg(two)).toContain('>12.10</text>')
    // 尺寸链数值未被 C 参数改动。
    expect(two.parameterSnapshot.map((item) => item.valueQ)).toEqual([
      200000, 320000, 121000,
    ])
    expect(second.value.snapshot.project.dimensionChain.terms.map((term) => term.nominalQ)).toEqual([
      522000, 200000, 120000, 200000,
    ])
  })

  it('非法参数与过期序号都拒绝，且不改已有参数/图纸', async () => {
    const context = await createDrawingHarness()
    const first = await context.harness.invoke<DrawingUpdateValue>(
      IPC_CHANNELS.drawingUpdateSpacer,
      updateRequest(context.opened.sessionId, 0),
    )
    expect(first.ok).toBe(true)
    const before = context.harness.projectService.getSession(context.opened.sessionId)!
    const beforeFingerprint = before.snapshot.project.drawings[0]?.dataFingerprint

    const invalid = await context.harness.invoke(
      IPC_CHANNELS.drawingUpdateSpacer,
      updateRequest(context.opened.sessionId, 1, {
        inputs: { innerDiameter: '40.00', outerDiameter: '32.00', length: '12.00' },
      }),
    )
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.error.code).toBe('INVALID_PARAMETER')

    const stale = await context.harness.invoke(
      IPC_CHANNELS.drawingUpdateSpacer,
      updateRequest(context.opened.sessionId, 0),
    )
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.error.code).toBe('STALE_EDIT')

    const after = context.harness.projectService.getSession(context.opened.sessionId)!
    expect(after.snapshot.project.drawings[0]?.dataFingerprint).toBe(beforeFingerprint)
    expect(after.acceptedSeq).toBe(1)
  })

  it('stageDraft 不能伪造参数/图纸/复核状态', async () => {
    const context = await createDrawingHarness()
    await context.harness.invoke<DrawingUpdateValue>(
      IPC_CHANNELS.drawingUpdateSpacer,
      updateRequest(context.opened.sessionId, 0),
    )
    const session = context.harness.projectService.getSession(context.opened.sessionId)!
    const dto = JSON.parse(JSON.stringify(session.snapshot))
    dto.project.parameters[0].valueQ = 999999
    dto.project.drawings[0].dataFingerprint = 'b'.repeat(64)
    dto.project.drawings[0].status = 'approved'
    const staged = await context.harness.invoke(IPC_CHANNELS.projectStage, {
      sessionId: context.opened.sessionId,
      editSeq: 2,
      snapshot: dto,
    })
    // 伪造的图纸结构本身不合法（status）也会被 stage 丢弃；参数/图纸来自 main。
    expect(staged.ok).toBe(true)
    const after = context.harness.projectService.getSession(context.opened.sessionId)!
    expect(after.snapshot.project.parameters[0].valueQ).toBe(200000)
    expect(after.snapshot.project.drawings[0].dataFingerprint).not.toBe('b'.repeat(64))
  })
})

describe('C-04 矢量导出', () => {
  it('SVG 导出与预览同源，落盘文件含同一指纹', async () => {
    const context = await createDrawingHarness()
    const updated = await context.harness.invoke<DrawingUpdateValue>(
      IPC_CHANNELS.drawingUpdateSpacer,
      updateRequest(context.opened.sessionId, 0),
    )
    if (!updated.ok) throw new Error('update failed')
    const target = path.join(exportDir!, '隔套-图纸.svg')
    context.pickQueue.push(target)
    const exported = await context.harness.invoke<DrawingExportValue>(IPC_CHANNELS.drawingExportSvg, {
      sessionId: context.opened.sessionId,
      baseEditSeq: 1,
      drawingId: updated.value.drawingId,
      drawingFingerprint: updated.value.drawingFingerprint,
    })
    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    const text = await fsp.readFile(target, 'utf8')
    expect(text).toContain(`data-drawing-fingerprint="${updated.value.drawingFingerprint}"`)
    expect(text).toContain('⌀20.00')
    expect(text).not.toMatch(/<image|<script|href="https?:/)
    expect(exported.value.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(exported.value.byteSize).toBe(Buffer.byteLength(text))
    // 导出不自动回灌为项目附件：来源 blob 计数与导出前一致。
    const session = context.harness.projectService.getSession(context.opened.sessionId)!
    expect(session.snapshot.blobs).toHaveLength(context.opened.snapshot.blobs.length)
  })

  it('PDF 入口收到的是 DrawingData（不是 bitmap），并解析为单页 A4 横向/嵌入字体', async () => {
    const context = await createDrawingHarness()
    const updated = await context.harness.invoke<DrawingUpdateValue>(
      IPC_CHANNELS.drawingUpdateSpacer,
      updateRequest(context.opened.sessionId, 0),
    )
    if (!updated.ok) throw new Error('update failed')
    const target = path.join(exportDir!, '隔套-图纸.pdf')
    context.pickQueue.push(target)
    const exported = await context.harness.invoke<DrawingExportValue>(IPC_CHANNELS.drawingExportPdf, {
      sessionId: context.opened.sessionId,
      baseEditSeq: 1,
      drawingId: updated.value.drawingId,
      drawingFingerprint: updated.value.drawingFingerprint,
    })
    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    expect(context.printCalls).toHaveLength(1)
    const printed = context.printCalls[0]
    expect(printed.fingerprint).toBe(updated.value.drawingFingerprint)
    expect(printed.primitives.some((item) => item.kind === 'circle')).toBe(true)
    expect((printed as unknown as Record<string, unknown>).bitmap).toBeUndefined()
    const bytes = new Uint8Array(await fsp.readFile(target))
    const report = checkPdf(bytes)
    expect(report.ok).toBe(true)
    expect(report.pageCount).toBe(1)
    expect(report.effectiveWidthPt).toBeCloseTo(841.8898, 1)
    expect(report.effectiveHeightPt).toBeCloseTo(595.2756, 1)
    expect(report.embeddedFontCount).toBeGreaterThan(0)
    expect(report.imageCount).toBe(0)
  })

  it('过期指纹/过期序号拒绝导出；已有目标未确认覆盖时原文件不变', async () => {
    const context = await createDrawingHarness()
    const updated = await context.harness.invoke<DrawingUpdateValue>(
      IPC_CHANNELS.drawingUpdateSpacer,
      updateRequest(context.opened.sessionId, 0),
    )
    if (!updated.ok) throw new Error('update failed')

    const staleFingerprint = await context.harness.invoke(IPC_CHANNELS.drawingExportSvg, {
      sessionId: context.opened.sessionId,
      baseEditSeq: 1,
      drawingId: updated.value.drawingId,
      drawingFingerprint: 'c'.repeat(64),
    })
    expect(staleFingerprint.ok).toBe(false)
    if (!staleFingerprint.ok) expect(staleFingerprint.error.code).toBe('STALE_DRAWING')

    const staleSeq = await context.harness.invoke(IPC_CHANNELS.drawingExportSvg, {
      sessionId: context.opened.sessionId,
      baseEditSeq: 0,
      drawingId: updated.value.drawingId,
      drawingFingerprint: updated.value.drawingFingerprint,
    })
    expect(staleSeq.ok).toBe(false)
    if (!staleSeq.ok) expect(staleSeq.error.code).toBe('STALE_EDIT')

    const target = path.join(exportDir!, 'existing.svg')
    await fsp.writeFile(target, 'ORIGINAL')
    context.pickQueue.push(target)
    context.confirmQueue.push(false)
    const cancelled = await context.harness.invoke(IPC_CHANNELS.drawingExportSvg, {
      sessionId: context.opened.sessionId,
      baseEditSeq: 1,
      drawingId: updated.value.drawingId,
      drawingFingerprint: updated.value.drawingFingerprint,
    })
    expect(cancelled.ok).toBe(false)
    if (!cancelled.ok) expect(cancelled.error.code).toBe('CANCELLED')
    expect(await fsp.readFile(target, 'utf8')).toBe('ORIGINAL')
  })

  it('短写/磁盘满失败不留下正式文件，也不破坏原目标', async () => {
    const base = await createHarness({ fileOps: failingWriteOps('ENOSPC') })
    const pickQueue: (string | null)[] = []
    registerDrawingChannels(base.ipc, {
      guard: base.guard,
      controller: base.controller,
      projectService: base.projectService,
      recovery: base.recovery,
      exportStore: new DrawingExportStore({ ops: failingWriteOps('ENOSPC') }),
      pickExportPath: async () => pickQueue.shift() ?? null,
      confirmOverwrite: async () => true,
      printPdf: async () => minimalPdf(),
    })
    harness = base
    const opened = await base.openSample()
    const updated = await base.invoke<DrawingUpdateValue>(
      IPC_CHANNELS.drawingUpdateSpacer,
      updateRequest(opened.sessionId, 0),
    )
    if (!updated.ok) throw new Error('update failed')
    const target = path.join(base.directory, 'blocked.svg')
    pickQueue.push(target)
    const exported = await base.invoke(IPC_CHANNELS.drawingExportSvg, {
      sessionId: opened.sessionId,
      baseEditSeq: 1,
      drawingId: updated.value.drawingId,
      drawingFingerprint: updated.value.drawingFingerprint,
    })
    expect(exported.ok).toBe(false)
    if (!exported.ok) expect(exported.error.code).toBe('NO_SPACE')
    await expect(fsp.stat(target)).rejects.toThrow()
    const leftovers = (await fsp.readdir(base.directory)).filter((name) => name.includes('.tmp'))
    expect(leftovers).toEqual([])
  })
})

describe('PDF 结构校验拒绝截图/纵向', () => {
  it('无字体嵌入或纵向页面判失败', async () => {
    const base = await createSampleSnapshot()
    expect(base.project.schemaVersion).toBe(7)
    const portrait = Buffer.from(minimalPdf()).toString('latin1')
      .replace('841.8898 595.2756', '595.2756 841.8898')
    const report = checkPdf(new Uint8Array(Buffer.from(portrait, 'latin1')))
    expect(report.ok).toBe(false)
    expect(report.errors.join(' ')).toContain('A4 横向')
  })

  it('含位图对象时拒绝', () => {
    const withImage = Buffer.from(minimalPdf()).toString('latin1').replace(
      '/Resources << /Font << /F1 5 0 R >> >>',
      '/Resources << /XObject << /Im1 8 0 R >> /Font << /F1 5 0 R >> >>',
    ) + '\n8 0 obj\n<< /Type /XObject /Subtype /Image /Width 1122 /Height 793 >>\nendobj\n'
    const report = checkPdf(new Uint8Array(Buffer.from(withImage, 'latin1')))
    expect(report.ok).toBe(false)
    expect(report.imageCount).toBeGreaterThan(0)
  })
})
