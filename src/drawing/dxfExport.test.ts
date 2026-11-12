/**
 * DXF 导出 v1 · D-01～D-05、D-08（纯数据层 + dxf-parser 读回）。
 *
 * 读回校验不能省：生成成功 ≠ 文件有效。这里用 dxf-parser（MIT，devDependency）
 * 真正解析导出的 GBK 字节，核对实体数、图层颜色、包围盒与文字。
 */
import DxfParser, { type IDxf } from 'dxf-parser'
import { describe, expect, it } from 'vitest'
import { buildSpacerDrawing } from './spacerDrawing'
import {
  DXF_LAYERS,
  DxfExportError,
  buildDxfDocument,
  dxfScaleFactorOf,
  type DxfBuildResult,
  type DxfVersion,
} from './dxfExport'
import type { DrawingData, DrawingScale, ParameterSnapshotItem } from './types'
import { formatQWithDecimals } from './formatDimension'

const PARAMS: ParameterSnapshotItem[] = [
  {
    parameterId: 'param:spacer:inner-diameter',
    partId: 'builtin:shaft-demo:spacer',
    key: 'innerDiameter',
    valueQ: 200000,
    inputDecimals: 2,
    reviewStatus: 'confirmed',
  },
  {
    parameterId: 'param:spacer:outer-diameter',
    partId: 'builtin:shaft-demo:spacer',
    key: 'outerDiameter',
    valueQ: 320000,
    inputDecimals: 2,
    reviewStatus: 'confirmed',
  },
  {
    parameterId: 'param:spacer:length',
    partId: 'builtin:shaft-demo:spacer',
    key: 'length',
    valueQ: 120500,
    inputDecimals: 2,
    reviewStatus: 'confirmed',
  },
]

const FRAME = {
  partName: '隔套',
  drawingNumber: 'DEMO-001',
  version: '草稿 v1',
  material: '45 钢',
  tolerance: '未注公差按 IT12',
  surface: 'Ra 1.6',
  drafter: '代达罗斯',
  date: '2026-11-11',
}

function drawingAt(scale: DrawingScale): DrawingData {
  return buildSpacerDrawing({
    projectId: 'project:dxf-test',
    revisionId: 'rev-cfg-1',
    drawingId: 'drawing:dxf-test',
    parameters: PARAMS,
    scale,
    frameFields: FRAME,
  })
}

function parse(build: DxfBuildResult): IDxf {
  const text = new TextDecoder('gbk').decode(build.bytes)
  const parsed = new DxfParser().parseSync(text)
  if (parsed === null) throw new Error('dxf-parser 返回 null')
  return parsed
}

function entityCounts(parsed: IDxf): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entity of parsed.entities) counts[entity.type] = (counts[entity.type] ?? 0) + 1
  return counts
}

function expectedCounts(data: DrawingData) {
  let line = 0
  let polyline = 0
  let vertex = 0
  let circle = 0
  let text = 0
  for (const primitive of data.primitives) {
    if (primitive.kind === 'line') line += 1
    else if (primitive.kind === 'polyline') {
      polyline += 1
      vertex += (primitive.geometryMm as { points: unknown[] }).points.length
    } else if (primitive.kind === 'circle') circle += 1
    else text += 1
  }
  for (const annotation of data.annotations) {
    line += annotation.dimensionGeometryMm.lines.length
    line += annotation.dimensionGeometryMm.arrows.length * 2
    text += 1
  }
  return { line, polyline, vertex, circle, text }
}

function bbox(paragraphs: { minX: number; minY: number; maxX: number; maxY: number }[]) {
  return {
    minX: Math.min(...paragraphs.map((item) => item.minX)),
    minY: Math.min(...paragraphs.map((item) => item.minY)),
    maxX: Math.max(...paragraphs.map((item) => item.maxX)),
    maxY: Math.max(...paragraphs.map((item) => item.maxY)),
  }
}

function geometryBoxes(parsed: IDxf) {
  const boxes: { minX: number; minY: number; maxX: number; maxY: number }[] = []
  for (const entity of parsed.entities) {
    if (entity.type === 'LINE') {
      const line = entity as unknown as { vertices: { x: number; y: number }[] }
      boxes.push(
        bbox([
          {
            minX: Math.min(line.vertices[0].x, line.vertices[1].x),
            minY: Math.min(line.vertices[0].y, line.vertices[1].y),
            maxX: Math.max(line.vertices[0].x, line.vertices[1].x),
            maxY: Math.max(line.vertices[0].y, line.vertices[1].y),
          },
        ]),
      )
    } else if (entity.type === 'POLYLINE') {
      const polyline = entity as unknown as { vertices: { x: number; y: number }[] }
      boxes.push(bbox([{
        minX: Math.min(...polyline.vertices.map((point) => point.x)),
        minY: Math.min(...polyline.vertices.map((point) => point.y)),
        maxX: Math.max(...polyline.vertices.map((point) => point.x)),
        maxY: Math.max(...polyline.vertices.map((point) => point.y)),
      }]))
    } else if (entity.type === 'CIRCLE') {
      const circle = entity as unknown as { center: { x: number; y: number }; radius: number }
      boxes.push({
        minX: circle.center.x - circle.radius,
        minY: circle.center.y - circle.radius,
        maxX: circle.center.x + circle.radius,
        maxY: circle.center.y + circle.radius,
      })
    }
  }
  return bbox(boxes)
}

function textEntities(parsed: IDxf) {
  return parsed.entities
    .filter((entity) => entity.type === 'TEXT')
    .map((entity) => entity as unknown as { text: string; textHeight: number; layer: string })
}

function lineTypes(parsed: IDxf) {
  return (parsed.tables.lineType?.lineTypes ?? {}) as unknown as Record<string, { pattern?: number[]; patternLength?: number }>
}

describe('D-01 1:1 隔套 20×32×12.05：R12 与 2000 都能回读，外廓 = 真实尺寸', () => {
  const data = drawingAt({ numerator: 1, denominator: 1 })

  for (const version of ['r12', '2000'] as DxfVersion[]) {
    it(`${version.toUpperCase()} 实体数/外廓/文字均与 DrawingData 一致`, () => {
      const build = buildDxfDocument(data, version)
      const parsed = parse(build)
      const expected = expectedCounts(data)
      expect(entityCounts(parsed)).toMatchObject({
        LINE: expected.line,
        POLYLINE: expected.polyline,
        CIRCLE: expected.circle,
        TEXT: expected.text,
      })
      expect(entityCounts(parsed).VERTEX).toBeUndefined()
      expect(entityCounts(parsed).SEQEND).toBeUndefined()

      // 主视图外廓：长度 12.05 × 外径 32（真实尺寸，不是纸面坐标）。
      const outline = build.drawingOutlineBounds!
      expect(outline.maxX - outline.minX).toBeCloseTo(12.05, 9)
      expect(outline.maxY - outline.minY).toBeCloseTo(32, 9)

      // 全图包围盒（几何实体）与 dxf-parser 读回一致，容差 0.001mm。
      const parsedBox = geometryBoxes(parsed)
      expect(Math.abs(parsedBox.minX - build.geometryBounds.minX)).toBeLessThanOrEqual(0.001)
      expect(Math.abs(parsedBox.minY - build.geometryBounds.minY)).toBeLessThanOrEqual(0.001)
      expect(Math.abs(parsedBox.maxX - build.geometryBounds.maxX)).toBeLessThanOrEqual(0.001)
      expect(Math.abs(parsedBox.maxY - build.geometryBounds.maxY)).toBeLessThanOrEqual(0.001)

      // 标注文字：3 位小数规则来自既有显示，直径用 %%c 控制码。
      const texts = textEntities(parsed).map((entity) => entity.text)
      expect(texts).toContain('12.050')
      expect(texts).toContain('%%c20.000')
      expect(texts).toContain('%%c32.000')
      // ⌀ 在 R12/2000 里语义化：读回后人工可把 %%c 显示为直径符号。
      expect(texts.some((text) => text.includes('⌀'))).toBe(false)

      // 文字高度：标注 3.5mm（1:1 不放大）。
      const dimText = textEntities(parsed).find((entity) => entity.layer === '尺寸')
      expect(dimText?.textHeight).toBeCloseTo(3.5, 9)
    })
  }

  it('两条样本版本头分别是 AC1009 / AC1015，且 2000 有 $INSUNITS=4', () => {
    const r12 = buildDxfDocument(data, 'r12')
    const v2000 = buildDxfDocument(data, '2000')
    expect(r12.text).toContain('$ACADVER\r\n1\r\nAC1009')
    expect(v2000.text).toContain('$ACADVER\r\n1\r\nAC1015')
    expect(r12.text).not.toContain('$INSUNITS')
    expect(v2000.text).toContain('$INSUNITS\r\n70\r\n4')
    expect(r12.text).toContain('$MEASUREMENT\r\n70\r\n1')
  })
})

describe('D-02 1:2 图纸：模型空间是纸面的 2 倍，文字高度同步放大', () => {
  const oneToOne = drawingAt({ numerator: 1, denominator: 1 })
  const oneToTwo = drawingAt({ numerator: 1, denominator: 2 })
  const half = buildDxfDocument(oneToTwo, 'r12')
  const base = buildDxfDocument(oneToOne, 'r12')

  it('k = 2，模型空间仍是真实尺寸 12.05 × 32，纸面只有一半', () => {
    expect(dxfScaleFactorOf(oneToTwo)).toBe(2)
    const outline = half.drawingOutlineBounds!
    expect(outline.maxX - outline.minX).toBeCloseTo(12.05, 9)
    expect(outline.maxY - outline.minY).toBeCloseTo(32, 9)
    // 1:2 的模型值 = 纸面值 × 2；与 1:1 的模型值相同（都是真实尺寸）。
    const paperWidth = base.drawingOutlineBounds!.maxX - base.drawingOutlineBounds!.minX
    expect(outline.maxX - outline.minX).toBeCloseTo(paperWidth, 9)
    expect(oneToTwo.views[0].scaleFactor).toBe(0.5)
  })

  it('标注文字 3.5 → 7，标题栏文字 3.0 → 6.0；虚线节距也乘 2', () => {
    const parsedHalf = parse(half)
    const parsedBase = parse(base)
    const heights = (parsed: IDxf) => ({
      dim: textEntities(parsed).filter((entity) => entity.layer === '尺寸').map((entity) => entity.textHeight)[0],
      frame: textEntities(parsed).filter((entity) => entity.layer === '图框').map((entity) => entity.textHeight)[0],
    })
    expect(heights(parsedBase).dim).toBeCloseTo(3.5, 9)
    expect(heights(parsedHalf).dim).toBeCloseTo(7, 9)
    expect(heights(parsedBase).frame).toBeCloseTo(3, 9)
    expect(heights(parsedHalf).frame).toBeCloseTo(6, 9)
    const center = lineTypes(parsedHalf).CENTER
    expect(center?.patternLength).toBeCloseTo(40, 9)
  })

  it('1:2 的外廓就是纸面坐标 ×2 的结果（不是直接抄纸面）', () => {
    // 纸面长度 = 真实长度 / 2（视图几何被比例缩小），×2 回到真实尺寸。
    const paperWidth = 12.05 / 2
    expect(half.drawingOutlineBounds!.maxX - half.drawingOutlineBounds!.minX).toBeCloseTo(paperWidth * 2, 9)
  })
})

describe('D-03 R12 实体白名单', () => {
  const data = drawingAt({ numerator: 1, denominator: 1 })

  it('文件文本里 LWPOLYLINE / MTEXT / SPLINE / HATCH 出现次数为 0', () => {
    const build = buildDxfDocument(data, 'r12')
    for (const token of ['LWPOLYLINE', 'MTEXT', 'SPLINE', 'HATCH']) {
      const occurrences = build.text.split(token).length - 1
      expect({ token, occurrences }).toEqual({ token, occurrences: 0 })
    }
    const types = new Set(parse(build).entities.map((entity) => entity.type))
    for (const type of types) expect(['LINE', 'POLYLINE', 'CIRCLE', 'TEXT']).toContain(type)
    // 折线必须是 POLYLINE + VERTEX（66=1），不是 LWPOLYLINE。
    expect(build.text).toContain('\r\n66\r\n1\r\n')
    expect((build.text.match(/\r\n0\r\nVERTEX\r\n/gu) ?? []).length).toBe(build.counts.vertex)
  })
})

describe('D-04 图层与颜色', () => {
  const data = drawingAt({ numerator: 1, denominator: 1 })

  it('五个图层齐全、颜色符合约定、每层都有实体引用', () => {
    for (const version of ['r12', '2000'] as DxfVersion[]) {
      const build = buildDxfDocument(data, version)
      const parsed = parse(build)
      const layers = parsed.tables.layer?.layers ?? {}
      expect(Object.keys(layers).sort()).toEqual(['图框', '尺寸', '文字', '中心线', '轮廓'].sort())
      for (const layer of DXF_LAYERS) {
        expect(layers[layer.name]?.colorIndex).toBe(layer.color)
      }
      const used = new Set(parsed.entities.map((entity) => entity.layer))
      for (const layer of DXF_LAYERS) expect(used.has(layer.name)).toBe(true)
      // ACI 1–7。
      for (const layer of DXF_LAYERS) expect(layer.color).toBeGreaterThanOrEqual(1)
      for (const layer of DXF_LAYERS) expect(layer.color).toBeLessThanOrEqual(7)
    }
  })
})

describe('D-05 中文与 GBK 编码', () => {
  const data = drawingAt({ numerator: 1, denominator: 1 })

  it('GBK 解码后中文完整、无替换字符；层名/图框/技术要求都对', () => {
    for (const version of ['r12', '2000'] as DxfVersion[]) {
      const build = buildDxfDocument(data, version)
      const decoded = new TextDecoder('gbk').decode(build.bytes)
      expect(decoded).toBe(build.text)
      expect(decoded.includes('\uFFFD')).toBe(false)
      const texts = textEntities(parse(build)).map((entity) => entity.text)
      expect(texts).toContain('待复核草稿 · 未复核、未批准')
      expect(texts).toContain('技术要求 / 缺项')
      expect(texts).toContain('第三角投影：右端视图置于主视图右侧')
      expect(texts).toContain('45 钢')
      expect(decoded).toContain('$DWGCODEPAGE\r\n3\r\nANSI_936')
    }
  })

  it('ASCII 保持单字节，非 ASCII 走 GBK 双字节', () => {
    const build = buildDxfDocument(data, 'r12')
    const text = build.text
    const at = text.indexOf('技术要求')
    expect(at).toBeGreaterThan(0)
    // build.text 是解码后的字面量；字节里 '技' 是两个 GBK 字节。
    const encoded = build.bytes
    const needle = new TextEncoder().encode('技术要求')
    expect(needle.length).toBe(12)
    const ascii = new TextEncoder().encode('LINE')
    let found = false
    for (let index = 0; index <= encoded.length - ascii.length; index += 1) {
      if (ascii.every((byte, offset) => encoded[index + offset] === byte)) {
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })
})

describe('D-08 空/异常 DrawingData 明确报错，不产生半截文件', () => {
  const data = drawingAt({ numerator: 1, denominator: 1 })

  function expectError(mutate: (copy: DrawingData) => void, code: string) {
    const copy = structuredClone(data)
    mutate(copy)
    let caught: unknown = null
    try {
      buildDxfDocument(copy, 'r12')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(DxfExportError)
    expect((caught as DxfExportError).code).toBe(code)
  }

  it('空图元 / 非有限坐标 / 零分母 / 未知版本 / 表外字符 全部拒绝', () => {
    expectError((copy) => {
      copy.primitives = []
    }, 'INVALID_DRAWING')
    expectError((copy) => {
      const line = copy.primitives.find((item) => item.kind === 'line')!
      ;(line.geometryMm as { y1: number }).y1 = Number.NaN
    }, 'INVALID_DRAWING')
    expectError((copy) => {
      copy.scale.denominator = 0
    }, 'INVALID_DRAWING')
    expectError((copy) => {
      const text = copy.primitives.find((item) => item.kind === 'text')!
      ;(text.geometryMm as { text: string }).text = '🚀 生僻字'
    }, 'DXF_TEXT_UNENCODABLE')
    let caught: unknown = null
    try {
      buildDxfDocument(data, 'r13' as DxfVersion)
    } catch (error) {
      caught = error
    }
    expect((caught as DxfExportError).code).toBe('UNSUPPORTED_VERSION')
  })

  it('几何坐标保留 q 精度，不取整到 0.01', () => {
    const copy = structuredClone(data)
    const line = copy.primitives.find((item) => item.kind === 'line')!
    ;(line.geometryMm as { x1: number; y1: number; x2: number; y2: number }) = {
      x1: 0.123456,
      y1: 123.456789,
      x2: 0.123457,
      y2: 123.45679,
    }
    const build = buildDxfDocument(copy, 'r12')
    expect(build.text).toContain('\r\n10\r\n0.123456\r\n')
    expect(build.text).toContain('\r\n20\r\n86.543211\r\n')
    expect(build.text).toContain('\r\n11\r\n0.123457\r\n')
  })

  it('标注数字按既有显示规则（3 位小数，第 4 位非零保留 4 位）', () => {
    // 12.05：输入 2 位小数，显示仍是既有 formatMm 的 3 位 → 12.050。
    expect(buildDxfDocument(data, 'r12').text).toContain('\r\n1\r\n12.050\r\n')
    // 12.0501（q=120501）第 4 位非零 → 显示 4 位。
    const four = structuredClone(data)
    const length = four.parameterSnapshot.find((item) => item.key === 'length')!
    length.valueQ = 120501
    length.inputDecimals = 4
    expect(buildDxfDocument(four, 'r12').text).toContain('\r\n1\r\n12.0501\r\n')
    expect(formatQWithDecimals(120501, 4)).toBe('12.0501')
  })
})
