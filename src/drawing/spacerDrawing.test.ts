import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Bytes, sha256Text } from './fingerprint'
import {
  dimensionText,
  formatQWithDecimals,
  resolveDimension,
} from './formatDimension'
import { annotationTextsOf, buildSpacerDrawing, draftVersionText, DrawingBuildError } from './spacerDrawing'
import {
  canonicalizeSvg,
  renderDrawingSvg,
  validateDrawingSvgMarkup,
} from './renderDrawingSvg'
import {
  DRAWING_SCALES,
  DRAFT_STATUS_TEXT,
  SPACER_PARAMETER_IDS,
  type DrawingData,
} from './types'
import { parseSpacerParameters, DEFAULT_SPACER_TEXTS } from '../parts/spacerParameters'

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

function build(
  texts: Partial<typeof DEFAULT_SPACER_TEXTS> = {},
  scale = { numerator: 1, denominator: 1 },
  frame = FRAME,
  drawingId = 'drawing-test-1',
): DrawingData {
  const parsed = parseSpacerParameters({ ...DEFAULT_SPACER_TEXTS, ...texts })
  if (!parsed.ok) throw new Error(parsed.message)
  return buildSpacerDrawing({
    projectId: 'project-test',
    revisionId: 'rev-test-1',
    drawingId,
    parameters: parsed.parameters,
    scale,
    frameFields: frame,
  })
}

function primitive(data: DrawingData, id: string) {
  const found = data.primitives.find((item) => item.primitiveId === id)
  if (found === undefined) throw new Error(`missing primitive ${id}`)
  return found
}

describe('C-01 稳定哈希', () => {
  it('SHA-256 与 FIPS 向量一致', () => {
    expect(sha256Bytes(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(sha256Text('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(sha256Text('a'.repeat(1000))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    )
  })

  it('规范化 JSON 对键顺序不敏感、拒绝 undefined/循环', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(
      canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }),
    )
    expect(() => canonicalJson({ a: undefined })).toThrow(/undefined/)
    const loop: Record<string, unknown> = {}
    loop.self = loop
    expect(() => canonicalJson(loop)).toThrow(/循环/)
  })
})

describe('C-01 显示有效位', () => {
  it('12.1000 与 12.10 同为 q=121000，显示随元数据', () => {
    const four = formatQWithDecimals(121000, 4)
    const two = formatQWithDecimals(121000, 2)
    expect(four).toBe('12.1000')
    expect(two).toBe('12.10')
  })

  it('12.1001 不能裁成 12.10；3 位小数无法无损表达时拒绝', () => {
    expect(formatQWithDecimals(121001, 4)).toBe('12.1001')
    expect(formatQWithDecimals(121001, 2)).toBeNull()
    expect(formatQWithDecimals(121001, 3)).toBeNull()
  })

  it('12/12.0/12.00 分别保留输入位数', () => {
    expect(formatQWithDecimals(120000, 0)).toBe('12')
    expect(formatQWithDecimals(120000, 1)).toBe('12.0')
    expect(formatQWithDecimals(120000, 2)).toBe('12.00')
  })

  it('标注解析只认 parameterId 对应的快照值', () => {
    const data = build({ length: '12.10' })
    const lengthText = resolveDimension(SPACER_PARAMETER_IDS.length, data.parameterSnapshot)
    expect(lengthText.ok).toBe(true)
    if (!lengthText.ok) return
    expect(lengthText.value.valueQ).toBe(121000)
    expect(dimensionText(lengthText.value, 'length')).toBe('12.100')
    expect(dimensionText(lengthText.value, 'diameter')).toBe('⌀12.100')
    expect(
      resolveDimension('param:spacer:not-exist', data.parameterSnapshot).ok,
    ).toBe(false)
  })
})

describe('C-01 参数校验', () => {
  it('默认 20.00/32.00/12.00 得到 200000/320000/120000 与两位小数', () => {
    const parsed = parseSpacerParameters(DEFAULT_SPACER_TEXTS)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.parameters.map((item) => item.valueQ)).toEqual([200000, 320000, 120000])
    expect(parsed.parameters.map((item) => item.inputDecimals)).toEqual([2, 2, 2])
  })

  it('五项小数、科学计数、零/负、外径≤内径全部拒绝', () => {
    const cases: [Partial<typeof DEFAULT_SPACER_TEXTS>, string][] = [
      [{ length: '12.10000' }, 'precision'],
      [{ length: '1e2' }, 'format'],
      [{ length: '0' }, 'range'],
      [{ length: '-1' }, 'range'],
      [{ innerDiameter: '32.00' }, 'relation'],
      [{ innerDiameter: '40.00' }, 'relation'],
    ]
    for (const [texts, reason] of cases) {
      const parsed = parseSpacerParameters({ ...DEFAULT_SPACER_TEXTS, ...texts })
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toBe(reason.toUpperCase())
    }
  })
})

describe('C-02 模板几何与比例', () => {
  it('1:1 主视 12×32、端视半径 16/10，隐藏线与中心线符合模板', () => {
    const data = build()
    const outline = primitive(data, 'axial.outline') as DrawingData['primitives'][number] & {
      geometryMm: { points: { x: number; y: number }[] }
    }
    expect(outline.geometryMm.points[0]).toEqual({ x: 74, y: 64 })
    expect(outline.geometryMm.points[1]).toEqual({ x: 86, y: 64 })
    expect(outline.geometryMm.points[2]).toEqual({ x: 86, y: 96 })
    const hiddenTop = primitive(data, 'axial.hidden.top').geometryMm as {
      y1: number; y2: number; x1: number; x2: number
    }
    expect([hiddenTop.x1, hiddenTop.y1, hiddenTop.x2, hiddenTop.y2]).toEqual([74, 70, 86, 70])
    const hiddenBottom = primitive(data, 'axial.hidden.bottom').geometryMm as { y1: number }
    expect(hiddenBottom.y1).toBe(90)
    const outer = primitive(data, 'end.outer').geometryMm as { cx: number; cy: number; r: number }
    const inner = primitive(data, 'end.inner').geometryMm as { r: number }
    expect([outer.cx, outer.cy, outer.r]).toEqual([180, 80, 16])
    expect(inner.r).toBe(10)
    expect(data.views.map((view) => view.kind)).toEqual(['axial', 'right-end'])
    expect(data.projection.convention).toBe('third-angle')
    expect(data.frame.status).toBe('pending-review-draft')
    expect(data.frame.fields.status).toBe(DRAFT_STATUS_TEXT)
  })

  it('1:2 几何减半，参数 q 与标注文字不变，视图锚点不漂移', () => {
    const one = build()
    const half = build({}, { numerator: 1, denominator: 2 })
    const outline = primitive(half, 'axial.outline').geometryMm as { points: { x: number; y: number }[] }
    expect(outline.points[0]).toEqual({ x: 77, y: 72 })
    expect(outline.points[2]).toEqual({ x: 83, y: 88 })
    const endOuter = primitive(half, 'end.outer').geometryMm as { r: number }
    expect(endOuter.r).toBe(8)
    const inner = primitive(half, 'end.inner').geometryMm as { r: number }
    expect(inner.r).toBe(5)
    expect(annotationTextsOf(half)).toEqual({
      'ann.length': '12.000',
      'ann.inner-diameter': '⌀20.000',
      'ann.outer-diameter': '⌀32.000',
    })
    expect(half.parameterSnapshot).toEqual(one.parameterSnapshot)
    expect(half.views.map((view) => view.anchorMm)).toEqual(one.views.map((view) => view.anchorMm))
    expect(half.fingerprint).not.toBe(one.fingerprint)
  })

  it('五个登记比例都能生成，几何按比例缩放而标注不变', () => {
    for (const scale of DRAWING_SCALES) {
      const data = build({}, scale)
      const factor = scale.numerator / scale.denominator
      const outer = primitive(data, 'end.outer').geometryMm as { r: number }
      expect(outer.r).toBeCloseTo(16 * factor, 6)
      expect(annotationTextsOf(data)['ann.outer-diameter']).toBe('⌀32.000')
    }
  })

  it('固定输入重复生成结果稳定；drawingId 变化才改变指纹', () => {
    const a = build()
    const b = build()
    expect(a.fingerprint).toBe(b.fingerprint)
    expect(renderDrawingSvg(a)).toBe(renderDrawingSvg(b))
    const other = build({}, undefined, undefined, 'drawing-test-2')
    expect(other.fingerprint).not.toBe(a.fingerprint)
  })

  it('12.1000 与 12.10 同 q、同几何、同显示，输入元数据仍改变指纹', () => {
    const four = build({ length: '12.1000' })
    const two = build({ length: '12.10' })
    const geometry = (data: DrawingData) =>
      data.primitives
        .filter((item) => item.area === 'drawing' && item.kind !== 'text')
        .map((item) => item.geometryMm)
    expect(geometry(four)).toEqual(geometry(two))
    expect(annotationTextsOf(four)['ann.length']).toBe('12.100')
    expect(annotationTextsOf(two)['ann.length']).toBe('12.100')
    expect(four.fingerprint).not.toBe(two.fingerprint)
  })

  it('大尺寸 2:1 溢出被拒，换成 1:2 可生成', () => {
    const texts = { outerDiameter: '100.00', innerDiameter: '80.00', length: '200.00' }
    expect(() => build(texts, { numerator: 2, denominator: 1 })).toThrow(DrawingBuildError)
    try {
      build(texts, { numerator: 2, denominator: 1 })
    } catch (error) {
      expect((error as DrawingBuildError).code).toBe('DRAWING_OVERFLOW')
      expect((error as DrawingBuildError).message).toContain('更小比例')
    }
    const ok = build(texts, { numerator: 1, denominator: 2 })
    expect(ok.layout.fits).toBe(true)
  })

  it('零件名为空/声明已批准时拒绝生成', () => {
    expect(() => build({}, undefined, { ...FRAME, partName: '  ' })).toThrow(/零件名/)
    expect(() => build({}, undefined, { ...FRAME, material: '已批准 Rev A' })).toThrow(/已复核/)
  })
})

describe('标题栏版本栏：新图写「草稿 · 第 N 版」，UUID 不上图', () => {
  const UUID_REV = 'rev-a-b29cacb4-5be4-4f5a-9c1d-2f6a7b8c9d0e'
  /** 图上真正画出来的文字（<text> 的内容），不含 SVG 根节点上的机器元数据。 */
  function visibleTexts(svg: string): string {
    return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gu)]
      .map((match) => match[1] ?? '')
      .join('\n')
  }
  const params = (() => {
    const parsed = parseSpacerParameters(DEFAULT_SPACER_TEXTS)
    if (!parsed.ok) throw new Error(parsed.message)
    return parsed.parameters
  })()

  it('旧记录（版本栏为空）保持既有回退文字，不改指纹；图上仍无 ≥32 位连续十六进制串', () => {
    const data = buildSpacerDrawing({
      projectId: 'project-test',
      revisionId: UUID_REV,
      drawingId: 'drawing-test-1',
      parameters: params,
      scale: { numerator: 1, denominator: 1 },
      frameFields: FRAME,
    })
    // 兼容：已保存项目的 dataFingerprint 是用这段文字算的，换字会让旧项目打不开。
    expect(data.frame.fields.version).toBe(`草稿 ${UUID_REV}`)
    const svg = renderDrawingSvg(data)
    expect(visibleTexts(svg)).not.toMatch(/[0-9a-f]{32,}/iu)
  })

  it('新图：生成时写入「草稿 · 第 3 版」，图上不出现 revisionId 也不出现 ≥32 位十六进制串', () => {
    const data = buildSpacerDrawing({
      projectId: 'project-test',
      revisionId: UUID_REV,
      drawingId: 'drawing-test-1',
      parameters: params,
      scale: { numerator: 1, denominator: 1 },
      frameFields: { ...FRAME, version: draftVersionText(3) },
    })
    expect(data.frame.fields.version).toBe('草稿 · 第 3 版')
    const svg = renderDrawingSvg(data)
    expect(visibleTexts(svg)).toContain('草稿 · 第 3 版')
    expect(visibleTexts(svg)).not.toContain('b29cacb4')
    expect(visibleTexts(svg)).not.toMatch(/[0-9a-f]{32,}/iu)
    // 机器元数据（SVG 根属性）仍带内容指纹——它不是图纸文字，不参与“图上不许出现”。
    expect(svg).toContain('data-drawing-fingerprint="')
  })

  it('draftVersionText 只接受正整数序号；自定义版本原样保留', () => {
    expect(draftVersionText(3)).toBe('草稿 · 第 3 版')
    expect(draftVersionText()).toBe('草稿')
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(draftVersionText(bad)).toBe('草稿')
    const custom = build({}, undefined, { ...FRAME, version: 'A 方案' })
    expect(custom.frame.fields.version).toBe('A 方案')
  })
})

describe('C-02 SVG 唯一序列化器', () => {
  it('预览与导出使用同一序列化器；选择高亮不进入导出', () => {
    const data = build()
    const exported = renderDrawingSvg(data)
    const preview = renderDrawingSvg(data, { selectedAnnotationId: 'ann.length' })
    expect(canonicalizeSvg(renderDrawingSvg(data))).toBe(canonicalizeSvg(exported))
    expect(preview).toContain('is-selected')
    expect(exported).not.toContain('class="annotation is-selected"')
    // 除高亮类外，图元与文字完全一致。
    expect(canonicalizeSvg(preview).replace(/annotation is-selected/g, 'annotation')).toBe(
      canonicalizeSvg(exported),
    )
  })

  it('SVG 是 297×210mm 矢量文件，无脚本/图片/外链/外部字体', () => {
    const data = build()
    const svg = renderDrawingSvg(data)
    const report = validateDrawingSvgMarkup(svg, data)
    expect(report.errors).toEqual([])
    expect(svg).not.toMatch(/<image|<script|<foreignObject|@font-face/)
    expect(svg.match(/<circle/g)).toHaveLength(2)
    expect(svg.match(/<line/g)?.length ?? 0).toBeGreaterThan(8)
    expect(svg).toContain('⌀20.000')
    expect(svg).toContain('⌀32.000')
    expect(svg).toContain('12.000')
    expect(svg).toContain(DRAFT_STATUS_TEXT)
    expect(svg).toContain('第三角投影')
    expect(svg).toContain('待补充')
    // 箭头 marker 必须有覆盖负坐标的 viewBox，否则三角形被裁掉（实测踩过）。
    const marker = svg.match(/<marker[^>]*id="arrow-head"[^>]*>/)?.[0] ?? ''
    expect(marker).toContain('viewBox="-2.5 -0.4 2.5 0.8"')
    expect(marker).toContain('markerUnits="userSpaceOnUse"')
    expect((svg.match(/marker-end="url\(#arrow-head\)"/g) ?? []).length).toBe(
      data.annotations.reduce((total, item) => total + item.dimensionGeometryMm.arrows.length, 0),
    )
  })

  it('文本 XML 转义，不把用户字段当标记', () => {
    const data = build({}, undefined, { ...FRAME, partName: '隔套 <script>alert(1)</script>' })
    const svg = renderDrawingSvg(data)
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
    expect(validateDrawingSvgMarkup(svg, data).ok).toBe(true)
  })

  it('标注组绑定 parameterId 且数字与参数快照一致', () => {
    const data = build()
    const svg = renderDrawingSvg(data)
    for (const annotation of data.annotations) {
      expect(svg).toContain(`data-parameter-id="${annotation.parameterId}"`)
      expect(svg).toContain(`data-annotation-id="${annotation.annotationId}"`)
    }
    expect(svg).toContain('data-parameter-id="param:spacer:length"')
  })

  it('图纸生成与 SVG 渲染不依赖 three/React/Electron', () => {
    const root = process.cwd()
    const files = [
      'src/drawing/spacerDrawing.ts',
      'src/drawing/renderDrawingSvg.ts',
      'src/drawing/formatDimension.ts',
      'src/drawing/layout.ts',
    ]
    for (const file of files) {
      const source = readFileSync(path.join(root, file), 'utf8')
      expect(source).not.toMatch(/from ['"]three|from ['"]react|from ['"]electron/)
    }
  })
})
