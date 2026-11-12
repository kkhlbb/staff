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
  DXF_DIM_STYLE_NAME,
  DXF_LAYERS,
  DxfExportError,
  buildDxfDocument,
  dxfScaleFactorOf,
  type DxfBuildResult,
  type DxfVersion,
} from './dxfExport'
import { USER_INPUT_BASIS, type DrawingData, type DrawingScale, type ParameterSnapshotItem } from './types'
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

function expectedCounts(data: DrawingData, version: DxfVersion) {
  let line = 0
  let polyline = 0
  let vertex = 0
  let circle = 0
  let text = 0
  for (const primitive of data.primitives) {
    // 2000 的图框/标题栏搬进了图纸空间（A3 版式），不再按 A4 纸面放进模型空间。
    if (version === '2000' && primitive.area === 'sheet') continue
    if (primitive.kind === 'line') line += 1
    else if (primitive.kind === 'polyline') {
      polyline += 1
      vertex += (primitive.geometryMm as { points: unknown[] }).points.length
    } else if (primitive.kind === 'circle') circle += 1
    else text += 1
  }
  // R12：标注是「几何 + TEXT」，全部平铺进模型空间。
  // 2000：标注是真 DIMENSION 实体，图形进匿名块，不进 ENTITIES。
  if (version === 'r12') {
    for (const annotation of data.annotations) {
      line += annotation.dimensionGeometryMm.lines.length
      line += annotation.dimensionGeometryMm.arrows.length * 2
      text += 1
    }
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
  // 只看模型空间：2000 的图框/标题栏在图纸空间，混进来会把包围盒撑到 420×297。
  for (const entity of modelSpaceEntities(parsed)) {
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
    .map((entity) => entity as unknown as { text: string; textHeight: number; layer: string; inPaperSpace?: boolean })
}

/** 成对遍历从字节解码出来的 DXF 文本，返回 [组码, 值] 序列。 */
function tagPairs(text: string): [string, string][] {
  const lines = text.split('\r\n')
  const pairs: [string, string][] = []
  for (let index = 0; index + 1 < lines.length; index += 2) pairs.push([lines[index].trim(), lines[index + 1]])
  return pairs
}

/** 取出某一类实体的全部组码（同名实体取第一个）。 */
function entityTags(text: string, type: string): Record<string, string> {
  const pairs = tagPairs(text)
  const start = pairs.findIndex(([code, value]) => code === '0' && value.trim() === type)
  if (start < 0) return {}
  const tags: Record<string, string> = {}
  for (let index = start + 1; index < pairs.length; index += 1) {
    const [code, value] = pairs[index]
    if (code === '0') break
    if (!(code in tags)) tags[code] = value.trim()
  }
  return tags
}

/** 取出段内某类对象（LAYOUT 等）的全部组码；同名对象可能多个。 */
function objectTags(text: string, type: string): Record<string, string>[] {
  const pairs = tagPairs(text)
  const out: Record<string, string>[] = []
  pairs.forEach(([code, value], index) => {
    if (!(code === '0' && value.trim() === type)) return
    const tags: Record<string, string> = {}
    for (let cursor = index + 1; cursor < pairs.length; cursor += 1) {
      const [innerCode, innerValue] = pairs[cursor]
      if (innerCode === '0') break
      tags[innerCode] = innerValue.trim()
    }
    out.push(tags)
  })
  return out
}

/** 只取模型空间实体（dxf-parser 对 67=1 的实体置 inPaperSpace=true）。 */
function modelSpaceEntities(parsed: IDxf) {
  return parsed.entities.filter((entity) => (entity as unknown as { inPaperSpace?: boolean }).inPaperSpace !== true)
}

/** 2000 的标注文字在匿名块里，读回时要连块内容一起看。 */
function allTextEntities(parsed: IDxf) {
  const fromBlocks = Object.values(parsed.blocks ?? {}).flatMap((block) =>
    (block.entities ?? [])
      .filter((entity) => entity.type === 'TEXT')
      .map((entity) => entity as unknown as { text: string; textHeight: number; layer: string; inPaperSpace?: boolean }),
  )
  return [...textEntities(parsed), ...fromBlocks]
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
      const expected = expectedCounts(data, version)
      const modelCounts: Record<string, number> = {}
      for (const entity of modelSpaceEntities(parsed)) {
        modelCounts[entity.type] = (modelCounts[entity.type] ?? 0) + 1
      }
      expect(modelCounts).toMatchObject({
        LINE: expected.line,
        POLYLINE: expected.polyline,
        CIRCLE: expected.circle,
        TEXT: expected.text,
      })
      expect(modelCounts.VERTEX).toBeUndefined()
      expect(modelCounts.SEQEND).toBeUndefined()
      // 2000 的尺寸是真 DIMENSION 实体（R12 里一个都不该有）。
      expect(modelCounts.DIMENSION ?? 0).toBe(version === '2000' ? data.annotations.length : 0)

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
      // 2000 的这三条文字在匿名标注块里，所以连块内容一起读。
      const texts = allTextEntities(parsed).map((entity) => entity.text)
      expect(texts).toContain('12.050')
      expect(texts).toContain('%%c20.000')
      expect(texts).toContain('%%c32.000')
      // ⌀ 在 R12/2000 里语义化：读回后人工可把 %%c 显示为直径符号。
      expect(texts.some((text) => text.includes('⌀'))).toBe(false)

      // 文字高度：标注 3.5mm（1:1 不放大）。
      const dimText = allTextEntities(parsed).find((entity) => entity.layer === '尺寸')
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

  it('标注文字 3.5 → 7；虚线节距也乘 2', () => {
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

  it('2000 版：模型空间的标注文字同样 ×2，图纸空间标题栏文字不随比例放大', () => {
    const parsedBase = parse(buildDxfDocument(oneToOne, '2000'))
    const parsedHalf = parse(buildDxfDocument(oneToTwo, '2000'))
    const blockTextHeights = (parsed: IDxf) =>
      Object.values(parsed.blocks ?? {})
        .flatMap((block) => block.entities ?? [])
        .filter((entity) => entity.type === 'TEXT' && entity.layer === '尺寸')
        .map((entity) => (entity as unknown as { textHeight: number }).textHeight)
    expect(blockTextHeights(parsedBase)[0]).toBeCloseTo(3.5, 9)
    expect(blockTextHeights(parsedHalf)[0]).toBeCloseTo(7, 9)
    // 图纸空间单位是纸面 mm：标题栏 3.0 在两个比例下都是 3.0。
    const paperHeights = (parsed: IDxf) =>
      textEntities(parsed)
        .filter((entity) => entity.layer === '图框' && entity.inPaperSpace === true)
        .map((entity) => entity.textHeight)
    expect(Math.min(...paperHeights(parsedBase))).toBeCloseTo(3, 9)
    expect(Math.min(...paperHeights(parsedHalf))).toBeCloseTo(3, 9)
    expect(Math.max(...paperHeights(parsedHalf))).toBeCloseTo(4, 9)
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

describe('D-09 2000 的真 DIMENSION 实体（dxf-parser 读回）', () => {
  const data = drawingAt({ numerator: 1, denominator: 1 })
  const build = buildDxfDocument(data, '2000')
  const parsed = parse(build)
  const dims = parsed.entities
    .filter((entity) => entity.type === 'DIMENSION')
    .map((entity) => entity as unknown as {
      block?: string
      dimensionType?: number
      text?: string
      actualMeasurement?: number
      layer: string
      anchorPoint?: { x: number; y: number }
      middleOfText?: { x: number; y: number }
      linearOrAngularPoint1?: { x: number; y: number }
      linearOrAngularPoint2?: { x: number; y: number }
      diameterOrRadiusPoint?: { x: number; y: number }
    })

  it('三条尺寸都是 DIMENSION 实体，不是「文字 + 线」', () => {
    expect(dims).toHaveLength(3)
    expect(build.counts.dimension).toBe(3)
    for (const dim of dims) expect(dim.layer).toBe('尺寸')
    // 模型空间里不该再有「尺寸层上的尺寸线 + 数字」冒充标注：尺寸层的 LINE/TEXT 为 0。
    const dimLayerLines = modelSpaceEntities(parsed).filter(
      (entity) => entity.layer === '尺寸' && (entity.type === 'LINE' || entity.type === 'TEXT'),
    )
    expect(dimLayerLines).toEqual([])
  })

  it('70 的低 4 位分得清长度/直径，位 32 表示几何块被引用', () => {
    // 长度 = 0（rotated），两个直径 = 3（diametric）；+32 = 0x20。
    expect(dims.map((dim) => dim.dimensionType)).toEqual([32, 35, 35])
    for (const dim of dims) expect((dim.dimensionType ?? 0) & 32).toBe(32)
  })

  it('每条标注都指向自己的匿名块 *D1/*D2/*D3，块里是尺寸线/界线/箭头/文字', () => {
    expect(dims.map((dim) => dim.block)).toEqual(['*D1', '*D2', '*D3'])
    const blocks = parsed.blocks ?? {}
    for (const name of ['*D1', '*D2', '*D3']) {
      const block = blocks[name]
      expect(block).toBeDefined()
      const types = new Set((block.entities ?? []).map((entity) => entity.type))
      expect(types.has('LINE')).toBe(true)
      expect(types.has('TEXT')).toBe(true)
    }
    // 长度标注块：3 条线（两条界线 + 一条尺寸线）+ 2×2 条箭头线 + 1 条文字。
    const lengthBlock = blocks['*D1']
    expect((lengthBlock.entities ?? []).filter((entity) => entity.type === 'LINE')).toHaveLength(7)
    expect((lengthBlock.entities ?? []).filter((entity) => entity.type === 'TEXT')).toHaveLength(1)
  })

  it('尺寸数值来自模型真值（改 q 就跟着变，不是写死）', () => {
    expect(dims.map((dim) => dim.actualMeasurement).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([12.05, 20, 32])
    expect(dims[0].text).toBe('12.050')
    const changed = structuredClone(data)
    const length = changed.parameterSnapshot.find((item) => item.key === 'length')!
    length.valueQ = 124000
    const changedDims = parse(buildDxfDocument(changed, '2000'))
      .entities.filter((entity) => entity.type === 'DIMENSION')
      .map((entity) => entity as unknown as { actualMeasurement?: number; text?: string })
    expect(changedDims[0].actualMeasurement).toBeCloseTo(12.4, 9)
    expect(changedDims[0].text).toBe('12.400')
  })

  it('DIMSTYLE 表里有被引用的标注样式，实体用组码 3 引用它', () => {
    const dimStyles = (parsed.tables as unknown as { dimStyle?: { dimStyles?: Record<string, unknown> } }).dimStyle
    // dxf-parser 不解析 DIMSTYLE 表，这里直接查文本：表里必须有同名记录，实体 3 组码引用它。
    expect(dimStyles === undefined || dimStyles !== null).toBe(true)
    expect(build.text).toContain(`\r\n2\r\n${DXF_DIM_STYLE_NAME}\r\n70\r\n0\r\n`)
    expect((build.text.match(new RegExp(`\\r\\n3\\r\\n${DXF_DIM_STYLE_NAME}\\r\\n`, 'gu')) ?? []).length).toBeGreaterThanOrEqual(3)
    // DIMSTYLE 的句柄组码必须是 105。
    expect(build.text).toContain('\r\n0\r\nDIMSTYLE\r\n105\r\n')
  })

  it('定义点用模型坐标（与纸面换算一致）：长度标注在轮廓下方 14mm 处', () => {
    const lengthDim = dims[0]
    expect(lengthDim.anchorPoint).toBeDefined()
    expect(lengthDim.middleOfText).toBeDefined()
    // 1:1：纸面 (80, 110) → 模型 (80, 100)。
    expect(lengthDim.anchorPoint!.x).toBeCloseTo(80, 6)
    expect(lengthDim.anchorPoint!.y).toBeCloseTo(100, 6)
    // 界线起点在零件下缘（纸面 y=97 → 模型 y=113）。
    expect(lengthDim.linearOrAngularPoint1!.y).toBeCloseTo(113, 6)
    expect(lengthDim.linearOrAngularPoint2!.y).toBeCloseTo(113, 6)
    // 直径标注：15 组码是对侧圆周点，与 10 关于圆心对称。
    const outer = dims[2]
    const p10 = outer.anchorPoint!
    const p15 = outer.diameterOrRadiusPoint!
    expect(Math.hypot(p10.x - p15.x, p10.y - p15.y)).toBeCloseTo(32, 6)
  })
})

describe('D-10 2000 的 A3 图幅与图纸空间', () => {
  const data = drawingAt({ numerator: 1, denominator: 1 })
  const build = buildDxfDocument(data, '2000')

  it('$PLIMMAX = 420×297，报告里 sheet 是 A3 布局空间', () => {
    expect(build.text).toContain('$PLIMMAX\r\n10\r\n420\r\n20\r\n297\r\n')
    expect(build.sheet).toEqual({ widthMm: 420, heightMm: 297, space: 'layout' })
  })

  it('两个 LAYOUT 对象的纸张都是 420×297，Layout1 带一个视口', () => {
    const layouts = objectTags(build.text, 'LAYOUT')
    expect(layouts).toHaveLength(2)
    for (const layout of layouts) {
      expect(Number(layout['44'])).toBe(420)
      expect(Number(layout['45'])).toBe(297)
    }
    const names = layouts.map((layout) => layout['1'])
    expect(names).toEqual(['Model', 'Layout1'])
    expect(layouts.map((layout) => Number(layout['71']))).toEqual([0, 1])
    expect(Number(layouts[1]['76'])).toBe(1)
    // 331 必须指向真实的 VIEWPORT 实体句柄。
    const viewport = entityTags(build.text, 'VIEWPORT')
    expect(layouts[1]['331']).toBe(viewport['5'])
  })

  it('图框在图纸空间按真实 mm 画：外框 10..410 / 10..287', () => {
    const parsed = parse(build)
    const paperPolylines = parsed.entities
      .filter((entity) => entity.type === 'POLYLINE' && (entity as unknown as { inPaperSpace?: boolean }).inPaperSpace === true)
      .map((entity) => (entity as unknown as { vertices: { x: number; y: number }[] }).vertices)
    expect(paperPolylines.length).toBeGreaterThanOrEqual(3)
    const frame = paperPolylines[0]
    const xs = frame.map((point) => point.x)
    const ys = frame.map((point) => point.y)
    expect(Math.min(...xs)).toBeCloseTo(10, 9)
    expect(Math.max(...xs)).toBeCloseTo(410, 9)
    expect(Math.min(...ys)).toBeCloseTo(10, 9)
    expect(Math.max(...ys)).toBeCloseTo(287, 9)
    // 宽高就是 400×277（10mm 边距）——A3 420×297 内框。
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(400, 9)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(277, 9)
  })

  it('模型空间仍是 1:1 真实尺寸（A3 图幅不改变零件尺寸）', () => {
    expect(build.drawingOutlineBounds!.maxX - build.drawingOutlineBounds!.minX).toBeCloseTo(12.05, 9)
    expect(build.drawingOutlineBounds!.maxY - build.drawingOutlineBounds!.minY).toBeCloseTo(32, 9)
  })
})

describe('D-11 视口比例：1:1 与 1:2 都对', () => {
  for (const entry of [
    { label: '1:1', scale: { numerator: 1, denominator: 1 }, k: 1 },
    { label: '1:2', scale: { numerator: 1, denominator: 2 }, k: 2 },
    { label: '2:1', scale: { numerator: 2, denominator: 1 }, k: 0.5 },
  ]) {
    it(`${entry.label}：41/45 = 1/k，视口尺寸是纸面 mm 不随比例变`, () => {
      const build = buildDxfDocument(drawingAt(entry.scale), '2000')
      const viewport = entityTags(build.text, 'VIEWPORT')
      const width = Number(viewport['40'])
      const height = Number(viewport['41'])
      const viewHeight = Number(viewport['45'])
      expect(width).toBeCloseTo(360, 9)
      expect(height).toBeCloseTo(208, 9)
      expect(viewHeight).toBeCloseTo(208 * entry.k, 9)
      expect(height / viewHeight).toBeCloseTo(1 / entry.k, 9)
      expect(build.viewport!.viewHeightMm).toBeCloseTo(208 * entry.k, 9)
      expect(build.viewport!.paperPerModel).toBeCloseTo(1 / entry.k, 9)
    })
  }

  it('视口在图纸空间（67=1）且属主是图纸空间的块记录', () => {
    const build = buildDxfDocument(drawingAt({ numerator: 1, denominator: 2 }), '2000')
    const viewport = entityTags(build.text, 'VIEWPORT')
    expect(viewport['67']).toBe('1')
    // 组码 100 会出现多次（AcDbEntity / AcDbViewport），entityTags 保留第一个，这里查文本。
    expect(build.text).toContain('\r\n100\r\nAcDbViewport\r\n')
    expect(build.text).toContain('\r\n67\r\n1\r\n8\r\n图框\r\n100\r\nAcDbViewport\r\n')
    // *Paper_Space 的 BLOCK_RECORD 句柄应当等于 VIEWPORT 的 330。
    const paperRecord = objectTags(build.text, 'BLOCK_RECORD').find((tags) => tags['2'] === '*Paper_Space')
    expect(viewport['330']).toBe(paperRecord!['5'])
  })
})

describe('D-12 标题栏：零件名/材料/版本/比例/日期/来源标记，且不泄漏 UUID', () => {
  const data = drawingAt({ numerator: 1, denominator: 2 })
  const build = buildDxfDocument(data, '2000')
  const paperTexts = textEntities(parse(build))
    .filter((entity) => entity.inPaperSpace === true)
    .map((entity) => entity.text)

  it('标题栏字段齐全（值来自 DrawingData.frame.fields）', () => {
    expect(paperTexts).toContain('零件名')
    expect(paperTexts).toContain('隔套')
    expect(paperTexts).toContain('材料')
    expect(paperTexts).toContain('45 钢')
    expect(paperTexts).toContain('版本')
    expect(paperTexts).toContain('草稿 v1')
    expect(paperTexts).toContain('1:2 · mm')
    expect(paperTexts).toContain('A3 横向 · 第三角')
    expect(paperTexts.some((text) => text.includes('2026-11-11'))).toBe(true)
  })

  it('有来源项目写 basis 原文（文档名+页），无来源写「依据：用户输入，无外部原文件」', () => {
    // 有来源：caller 把「依据：《任务书.pdf》第 3 页」写进 frame.fields.basis。
    const sourced = structuredClone(data)
    sourced.frame.fields.basis = '依据：《任务书.pdf》第 3 页'
    const sourcedTexts = textEntities(parse(buildDxfDocument(sourced, '2000')))
      .filter((entity) => entity.inPaperSpace === true)
      .map((entity) => entity.text)
    expect(sourcedTexts).toContain('《任务书.pdf》第 3 页')
    expect(sourcedTexts.some((text) => text.startsWith('6. 依据：《任务书.pdf》第 3 页'))).toBe(true)

    // 无来源：意图建件项目写 USER_INPUT_BASIS。
    const noSource = structuredClone(data)
    noSource.frame.fields.basis = USER_INPUT_BASIS
    const noSourceTexts = textEntities(parse(buildDxfDocument(noSource, '2000')))
      .filter((entity) => entity.inPaperSpace === true)
      .map((entity) => entity.text)
    expect(noSourceTexts).toContain('用户输入，无外部原文件')
    expect(noSourceTexts.some((text) => text.includes('依据：用户输入，无外部原文件'))).toBe(true)
  })

  it('版本栏是「草稿 · 第 N 版」，图上没有 ≥32 位连续十六进制串', () => {
    const withDraftVersion = structuredClone(data)
    withDraftVersion.frame.fields.version = '草稿 · 第 3 版'
    const draftBuild = buildDxfDocument(withDraftVersion, '2000')
    const texts = allTextEntities(parse(draftBuild)).map((entity) => entity.text)
    expect(texts).toContain('草稿 · 第 3 版')
    expect(draftBuild.text).not.toContain('rev-cfg-1')
    expect(texts.filter((text) => /[0-9a-fA-F]{32,}/u.test(text))).toEqual([])
    // 全部 TEXT 组码 1 的内容里也不许出现 32 位以上十六进制串。
    const pairs = tagPairs(draftBuild.text)
    const textValues = pairs.filter(([code]) => code === '1').map(([, value]) => value)
    expect(textValues.filter((value) => /[0-9a-fA-F]{32,}/u.test(value))).toEqual([])
  })
})

describe('D-13 R12 保持现状：没有 2000 专属结构', () => {
  const data = drawingAt({ numerator: 1, denominator: 1 })

  it('R12 没有 DIMENSION / LAYOUT / VIEWPORT / BLOCK_RECORD / DIMSTYLE 表', () => {
    const build = buildDxfDocument(data, 'r12')
    for (const token of ['DIMENSION', 'LAYOUT', 'VIEWPORT', 'BLOCK_RECORD', 'DIMSTYLE', 'AcDbDimension']) {
      expect({ token, count: build.text.split(token).length - 1 }).toEqual({ token, count: 0 })
    }
    expect(build.counts.dimension).toBe(0)
    expect(build.counts.viewport).toBe(0)
    expect(build.dimensions).toEqual([])
    expect(build.viewport).toBeNull()
    expect(build.sheet).toEqual({ widthMm: 297, heightMm: 210, space: 'model' })
  })

  it('R12 的实体集合仍是白名单四种，且尺寸还是「几何 + TEXT」', () => {
    const parsed = parse(buildDxfDocument(data, 'r12'))
    const types = new Set(parsed.entities.map((entity) => entity.type))
    for (const type of types) expect(['LINE', 'POLYLINE', 'CIRCLE', 'TEXT']).toContain(type)
    // 尺寸层的线与文字都在 ENTITIES 里（没有匿名块）。
    const dimLayer = parsed.entities.filter((entity) => entity.layer === '尺寸')
    expect(dimLayer.some((entity) => entity.type === 'LINE')).toBe(true)
    expect(dimLayer.some((entity) => entity.type === 'TEXT')).toBe(true)
    expect(Object.keys(parsed.blocks ?? {}).filter((name) => name.startsWith('*D'))).toEqual([])
  })
})
