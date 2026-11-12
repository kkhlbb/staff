/**
 * 出图加深 · 样本与指标生成（可复算）。
 *
 * 走产品同一函数：buildSpacerDrawing → buildDxfDocument → GBK 字节 → 落盘，
 * 再对**磁盘字节**做 dxf-parser 读回，逐项记录 1:1 / 1:2 × R12 / 2000 的
 * 图幅、视口比例、真 DIMENSION、标题栏与版本栏。
 *
 * 用法：`npx vitest run --config vitest.dxf-depth.config.ts`
 *
 * 输出：
 *   docs/evidence/dxf-depth/samples/*.dxf
 *   docs/evidence/dxf-depth/samples/index.json
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import DxfParser, { type IDxf } from 'dxf-parser'
import { describe, expect, it } from 'vitest'
import { buildSpacerDrawing } from '../src/drawing/spacerDrawing'
import {
  DXF_ACAD_VERSION,
  DXF_DIM_STYLE_NAME,
  DXF_SHEET_A3,
  buildDxfDocument,
  type DxfBuildResult,
  type DxfVersion,
} from '../src/drawing/dxfExport'
import { USER_INPUT_BASIS, type DrawingData, type DrawingScale, type ParameterSnapshotItem } from '../src/drawing/types'
import { serializeEvidence } from './evidence-json'

const EVIDENCE = path.join(process.cwd(), 'docs', 'evidence', 'dxf-depth')
const SAMPLES = path.join(EVIDENCE, 'samples')

const PARAMS: ParameterSnapshotItem[] = [
  { parameterId: 'param:spacer:inner-diameter', partId: 'builtin:shaft-demo:spacer', key: 'innerDiameter', valueQ: 200000, inputDecimals: 2, reviewStatus: 'confirmed' },
  { parameterId: 'param:spacer:outer-diameter', partId: 'builtin:shaft-demo:spacer', key: 'outerDiameter', valueQ: 320000, inputDecimals: 2, reviewStatus: 'confirmed' },
  { parameterId: 'param:spacer:length', partId: 'builtin:shaft-demo:spacer', key: 'length', valueQ: 120500, inputDecimals: 2, reviewStatus: 'confirmed' },
]

const FRAME = {
  partName: '隔套',
  drawingNumber: 'DXF-DEPTH-001',
  version: '草稿 · 第 3 版',
  material: '45 钢',
  tolerance: '未注公差按 IT12',
  surface: 'Ra 1.6',
  drafter: '代达罗斯',
  date: '2026-11-12',
}

function drawingAt(scale: DrawingScale, basis?: string): DrawingData {
  return buildSpacerDrawing({
    projectId: 'project:dxf-depth',
    revisionId: 'rev-dxf-depth-1',
    drawingId: 'drawing:dxf-depth',
    parameters: PARAMS,
    scale,
    frameFields: basis === undefined ? FRAME : { ...FRAME, basis },
  })
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseBytes(bytes: Uint8Array): IDxf {
  const decoded = new TextDecoder('gbk').decode(bytes)
  const parsed = new DxfParser().parseSync(decoded)
  if (parsed === null) throw new Error('dxf-parser 返回 null')
  return parsed
}

interface DimensionRead {
  block: string | null
  dimensionType: number
  text: string | null
  actualMeasurement: number | null
  layer: string
}

function dimensionReads(parsed: IDxf): DimensionRead[] {
  return parsed.entities
    .filter((entity) => entity.type === 'DIMENSION')
    .map((entity) => {
      const dim = entity as unknown as {
        block?: string
        dimensionType?: number
        text?: string
        actualMeasurement?: number
        layer: string
      }
      return {
        block: dim.block ?? null,
        dimensionType: dim.dimensionType ?? -1,
        text: dim.text ?? null,
        actualMeasurement: dim.actualMeasurement ?? null,
        layer: dim.layer,
      }
    })
}

function textOf(parsed: IDxf) {
  return parsed.entities
    .filter((entity) => entity.type === 'TEXT')
    .map((entity) => entity as unknown as { text: string; layer: string; textHeight: number })
}

/** 从磁盘文本里抓 VIEWPORT 实体的组码（dxf-parser 不解析 VIEWPORT 实体）。 */
function viewportTags(text: string): Record<string, string> | null {
  const lines = text.split('\r\n')
  const pairs: [string, string][] = []
  for (let index = 0; index + 1 < lines.length; index += 2) pairs.push([lines[index].trim(), lines[index + 1]])
  const start = pairs.findIndex(([code, value]) => code === '0' && value.trim() === 'VIEWPORT')
  if (start < 0) return null
  const tags: Record<string, string> = {}
  for (let index = start + 1; index < pairs.length; index += 1) {
    const [code, value] = pairs[index]
    if (code === '0') break
    if (!(code in tags)) tags[code] = value.trim()
  }
  return tags
}

/** 从磁盘文本里抓 LAYOUT 对象的纸张尺寸（44/45）。 */
function layoutTags(text: string): Record<string, string>[] {
  const lines = text.split('\r\n')
  const pairs: [string, string][] = []
  for (let index = 0; index + 1 < lines.length; index += 2) pairs.push([lines[index].trim(), lines[index + 1]])
  const out: Record<string, string>[] = []
  pairs.forEach(([code, value], index) => {
    if (!(code === '0' && value.trim() === 'LAYOUT')) return
    const tags: Record<string, string> = {}
    for (let cursor = index + 1; cursor < pairs.length; cursor += 1) {
      const [innerCode, innerValue] = pairs[cursor]
      if (innerCode === '0') break
      // AcDbPlotSettings 与 AcDbLayout 都可能有同号组码；后面的（AcDbLayout）覆盖前面的。
      tags[innerCode] = innerValue.trim()
    }
    out.push(tags)
  })
  return out
}

function paperTexts(parsed: IDxf) {
  return textOf(parsed).filter((entity) => (entity as unknown as { inPaperSpace?: boolean }).inPaperSpace === true)
}

describe('出图加深 · 样本与指标', () => {
  it('1:1 与 1:2 × R12/2000 四份样本 + 无来源样本，指标全部落 json', async () => {
    await fsp.mkdir(SAMPLES, { recursive: true })
    const index: Record<string, unknown>[] = []

    const cases: { key: string; scale: DrawingScale; version: DxfVersion; basis?: string }[] = [
      { key: 'r12-1x1', scale: { numerator: 1, denominator: 1 }, version: 'r12' },
      { key: 'r12-1x2', scale: { numerator: 1, denominator: 2 }, version: 'r12' },
      { key: '2000-1x1', scale: { numerator: 1, denominator: 1 }, version: '2000' },
      { key: '2000-1x2', scale: { numerator: 1, denominator: 2 }, version: '2000' },
      { key: '2000-1x2-userinput', scale: { numerator: 1, denominator: 2 }, version: '2000', basis: USER_INPUT_BASIS },
    ]

    for (const entry of cases) {
      const data = drawingAt(entry.scale, entry.basis)
      const build: DxfBuildResult = buildDxfDocument(data, entry.version)
      const suffix = entry.basis === undefined ? '' : '-userinput'
      const fileName = `spacer-20x32x12.05-dxf-${entry.key.replace('-userinput', '')}${suffix}.dxf`
      const target = path.join(SAMPLES, fileName)
      await fsp.writeFile(target, build.bytes)
      const disk = new Uint8Array(await fsp.readFile(target))
      expect(sha256(disk)).toBe(sha256(build.bytes))

      const decoded = new TextDecoder('gbk').decode(disk)
      expect(decoded).toBe(build.text)
      const parsed = parseBytes(disk)
      const dimensions = dimensionReads(parsed)
      const vp = viewportTags(decoded)
      const layouts = layoutTags(decoded)
      const texts = textOf(parsed)
      const allTexts = [...texts.map((entity) => entity.text)]
      // 图上不许出现 ≥32 位连续十六进制串（UUID/指纹泄漏）。
      const hex32 = allTexts.filter((text) => /[0-9a-fA-F]{32,}/u.test(text))

      const record = {
        case: entry.key,
        file: path.join('docs', 'evidence', 'dxf-depth', 'samples', fileName),
        version: entry.version,
        acadVersion: DXF_ACAD_VERSION[entry.version],
        scale: `${entry.scale.numerator}:${entry.scale.denominator}`,
        byteSize: disk.byteLength,
        sha256: sha256(disk),
        sheet: build.sheet,
        counts: build.counts,
        dimensions: dimensions.length === 0 ? null : dimensions,
        dimStyleName: DXF_DIM_STYLE_NAME,
        viewport: vp === null ? null : {
          centerMm: { x: Number(vp['10']), y: Number(vp['20']) },
          widthMm: Number(vp['40']),
          heightMm: Number(vp['41']),
          viewHeightMm: Number(vp['45']),
          viewCenter: { x: Number(vp['12']), y: Number(vp['22']) },
          paperPerModel: Number(vp['41']) / Number(vp['45']),
        },
        layouts: layouts.map((tags) => ({
          name: tags['1'],
          tabOrder: Number(tags['71']),
          paperWidthMm: Number(tags['44']),
          paperHeightMm: Number(tags['45']),
          viewportCount: Number(tags['76']),
        })),
        paperSpaceTexts: paperTexts(parsed).length,
        titleBlockTexts: allTexts.filter((text) => /草稿 · 第 3 版|45 钢|1:[12]|依据：|A3 横向/u.test(text)),
        drawingOutline: build.drawingOutlineBounds,
        hex32Leaks: hex32,
      }

      // —— 断言：失败即证据不生成 ——
      expect(hex32).toEqual([])
      if (entry.version === 'r12') {
        expect(vp).toBeNull()
        expect(layouts).toEqual([])
        expect(dimensions).toEqual([])
        expect(build.counts.dimension).toBe(0)
        expect(build.counts.viewport).toBe(0)
      } else {
        expect(dimensions).toHaveLength(3)
        expect(dimensions.every((dim) => dim.dimensionType >= 32)).toBe(true)
        expect(dimensions.map((dim) => dim.actualMeasurement).sort((a, b) => (a ?? 0) - (b ?? 0)))
          .toEqual([12.05, 20, 32])
        expect(vp).not.toBeNull()
        expect(Number(vp!['41'])).toBeCloseTo(208, 9)
        expect(Number(vp!['40'])).toBeCloseTo(360, 9)
        const k = entry.scale.denominator / entry.scale.numerator
        expect(Number(vp!['45'])).toBeCloseTo(208 * k, 9)
        // 视口确实能装下整个模型内容：视口在模型里覆盖的窗口 ⊇ 图形包围盒。
        const halfHeight = Number(vp!['45']) / 2
        const halfWidth = halfHeight * (Number(vp!['41']) === 0 ? 1 : Number(vp!['40']) / Number(vp!['41']))
        const cx = Number(vp!['12'])
        const cy = Number(vp!['22'])
        const box = build.geometryBounds
        expect(box.minX).toBeGreaterThanOrEqual(cx - halfWidth - 1e-6)
        expect(box.maxX).toBeLessThanOrEqual(cx + halfWidth + 1e-6)
        expect(box.minY).toBeGreaterThanOrEqual(cy - halfHeight - 1e-6)
        expect(box.maxY).toBeLessThanOrEqual(cy + halfHeight + 1e-6)
        expect(layouts.map((tags) => [tags['1'], Number(tags['44']), Number(tags['45'])])).toEqual([
          ['Model', 420, 297],
          ['Layout1', 420, 297],
        ])
        expect(build.sheet).toEqual({ widthMm: DXF_SHEET_A3.widthMm, heightMm: DXF_SHEET_A3.heightMm, space: 'layout' })
        // 标题栏：版本栏「草稿 · 第 N 版」、材料、比例、纸张、来源标记。
        expect(allTexts).toContain('草稿 · 第 3 版')
        expect(allTexts).toContain('45 钢')
        expect(allTexts).toContain(`${entry.scale.numerator}:${entry.scale.denominator} · mm`)
        expect(allTexts).toContain('A3 横向 · 第三角')
        if (entry.basis !== undefined) {
          expect(allTexts.some((text) => text.includes('用户输入，无外部原文件'))).toBe(true)
          expect(fileName.endsWith('-userinput.dxf')).toBe(true)
        }
      }

      index.push(record)
      console.log('SAMPLE', JSON.stringify({ case: entry.key, file: fileName, sha256: record.sha256, bytes: record.byteSize }))
    }

    await fsp.writeFile(
      path.join(SAMPLES, 'index.json'),
      serializeEvidence({
        schema: 'dxf-depth-samples-v1',
        baseline: 'main 791483c（意图建件已合入）',
        branch: 'agent/dxf-depth',
        drawing: '隔套 20×32×12.05（q=200000/320000/120500）',
        sheet: 'A3 横向 420×297（2000）/ A4 横向单张（R12，保持现状）',
        samples: index,
      }),
    )
  }, 120_000)
})
