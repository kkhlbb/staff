// @vitest-environment node
/**
 * 内置 DXF 看图 · 解析/解码/场景/点选。
 *
 * 五份样本是本仓库自己导出的真实文件（docs/evidence/dxf-depth/samples），
 * 不是为测试手搓的假数据：R12 一份 + 2000 三份 + userinput 一份。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeDxfBytes, rawHeaderVariable } from './decode'
import { parseDxfDocument } from './parse'
import { buildModelScene, buildPaperScene, fitViewBox, zoomViewBox } from './scene'
import {
  distanceToShape,
  formatMeasuredDistance,
  pickEntity,
  snapPoint,
} from './hit'
import { decodeTextSymbols, dimensionValueText, plainMtext } from './text'
import { USER_INPUT_BASIS } from '../drawing/types'

const SAMPLES = path.join(process.cwd(), 'docs', 'evidence', 'dxf-depth', 'samples')

function sample(file: string): { bytes: Uint8Array; fileName: string } {
  const bytes = new Uint8Array(readFileSync(path.join(SAMPLES, file)))
  return { bytes, fileName: file }
}

const FILES = {
  r12_1x1: 'spacer-20x32x12.05-dxf-r12-1x1.dxf',
  r12_1x2: 'spacer-20x32x12.05-dxf-r12-1x2.dxf',
  v2000_1x1: 'spacer-20x32x12.05-dxf-2000-1x1.dxf',
  v2000_1x2: 'spacer-20x32x12.05-dxf-2000-1x2.dxf',
  v2000_userinput: 'spacer-20x32x12.05-dxf-2000-1x2-userinput.dxf',
} as const

const parsed = new Map<string, ReturnType<typeof parseDxfDocument>>()
for (const [key, file] of Object.entries(FILES)) {
  parsed.set(key, parseDxfDocument(sample(file)))
}

function docOf(key: keyof typeof FILES) {
  const doc = parsed.get(key)
  if (doc === undefined) throw new Error(`缺少样本 ${key}`)
  return doc
}

function textOf(doc: ReturnType<typeof parseDxfDocument>): string[] {
  return doc.entities
    .map((entity) => entity.text)
    .filter((value): value is string => value !== undefined)
}

/** 手搓最小 DXF：只含指定实体，用于变异与不支持实体计数。 */
function buildDxf(options: {
  entities: string[]
  codepage?: string
  acadVersion?: string
  insunits?: number
  layers?: string[]
}): string {
  const header = [
    '0', 'SECTION', '2', 'HEADER',
    '9', '$ACADVER', '1', options.acadVersion ?? 'AC1015',
    ...(options.codepage === undefined ? [] : ['9', '$DWGCODEPAGE', '3', options.codepage]),
    '9', '$INSUNITS', '70', String(options.insunits ?? 4),
    '9', '$EXTMIN', '10', '0', '20', '0', '30', '0',
    '9', '$EXTMAX', '10', '100', '20', '100', '30', '0',
    '0', 'ENDSEC',
  ]
  const layerNames = options.layers ?? ['轮廓']
  const tables = [
    '0', 'SECTION', '2', 'TABLES',
    '0', 'TABLE', '2', 'LAYER', '70', String(layerNames.length),
    ...layerNames.flatMap((name) => ['0', 'LAYER', '2', name, '70', '0', '62', '7', '6', 'CONTINUOUS']),
    '0', 'ENDTAB', '0', 'ENDSEC',
  ]
  const entities = ['0', 'SECTION', '2', 'ENTITIES', ...options.entities, '0', 'ENDSEC', '0', 'EOF']
  return [...header, ...tables, ...entities].join('\n')
}

describe('五份真实样本：R12 与 2000 都能打开', () => {
  it('R12 1:1：几何 + 文字，无 DIMENSION / 无图纸空间', () => {
    const doc = docOf('r12_1x1')
    expect(doc.version).toBe('R12')
    expect(doc.header.acadVersion).toBe('AC1009')
    expect(doc.encoding.charset).toBe('gbk')
    expect(doc.encoding.warning).toBe(false)
    expect(doc.layers.map((layer) => layer.name)).toEqual(['轮廓', '中心线', '尺寸', '文字', '图框'])
    const counts = new Map<string, number>()
    for (const entity of doc.entities) counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1)
    expect(counts.get('LINE')).toBe(29)
    expect(counts.get('POLYLINE')).toBe(4)
    expect(counts.get('CIRCLE')).toBe(2)
    expect(counts.get('TEXT')).toBe(30)
    expect(counts.get('DIMENSION')).toBeUndefined()
    expect(doc.hasPaperSpace).toBe(false)
    expect(buildPaperScene(doc, new Set())).toBeNull()
    expect(doc.unsupported).toEqual([])
    const texts = textOf(doc)
    expect(texts).toContain('寸链 · 待复核草稿')
    expect(texts).toContain('1:1 · mm')
    expect(texts).toContain('第三角投影：右端视图置于主视图右侧')
  })

  it('R12 1:2：文字比例栏为 1:2 · mm，图元数与 1:1 相同', () => {
    const doc = docOf('r12_1x2')
    expect(textOf(doc)).toContain('1:2 · mm')
    expect(doc.entities.filter((entity) => entity.type === 'LINE')).toHaveLength(29)
    expect(doc.unsupported).toEqual([])
  })

  it('2000 1:1：A3 纸面、图层 5 个、三条 DIMENSION 实测值', () => {
    const doc = docOf('v2000_1x1')
    expect(doc.version).toBe('2000')
    expect(doc.header.acadVersion).toBe('AC1015')
    expect(doc.header.insUnits).toBe(4)
    expect(doc.paperSize).toEqual({ width: 420, height: 297 })
    expect(doc.hasPaperSpace).toBe(true)
    expect(doc.layers.map((layer) => layer.name)).toEqual(['轮廓', '中心线', '尺寸', '文字', '图框'])
    expect(doc.unsupported).toEqual([])

    const dimensions = doc.entities.filter((entity) => entity.type === 'DIMENSION')
    expect(dimensions).toHaveLength(3)
    expect(dimensions.map((entity) => entity.dimension?.measurement)).toEqual([12.05, 20, 32])
    expect(dimensions.map((entity) => entity.dimension?.valueText)).toEqual(['12.050', '⌀20.000', '⌀32.000'])
    expect(dimensions.map((entity) => entity.dimension?.dimensionType)).toEqual([32, 35, 35])
    expect(dimensions.map((entity) => entity.dimension?.blockName)).toEqual(['*D1', '*D2', '*D3'])
    // 标注数字来自组码 42，不是匿名块里的旧文字：块里是 "12.050" 也一样。
    expect(dimensions.every((entity) => entity.text === entity.dimension?.valueText)).toBe(true)

    expect(doc.entities.filter((entity) => entity.type === 'VIEWPORT')).toHaveLength(1)
    expect(doc.viewports).toHaveLength(1)
    expect(doc.viewports[0].scale).toBeCloseTo(1, 6)
    expect(doc.viewports[0].viewCenter).toEqual({ x: 80, y: 130 })
    expect(doc.viewports[0].width).toBe(360)
    expect(doc.viewports[0].height).toBe(208)
    expect(doc.viewports[0].viewHeight).toBe(208)
  })

  it('2000 1:2：视口比例 0.5，标题栏与技术要求中文可读', () => {
    const doc = docOf('v2000_1x2')
    expect(doc.viewports[0].scale).toBeCloseTo(0.5, 6)
    const texts = textOf(doc)
    expect(texts).toContain('A3 横向 · 第三角')
    expect(texts).toContain('1:2 · mm')
    expect(texts).toContain('技术要求 / 缺项')
    expect(texts).toContain('4. 单位 mm；比例作用于视口，模型空间是 1:1 真实尺寸。')
    expect(texts).toContain('依据')
    expect(texts).toContain('本图档未记录来源文档名/页')
    expect(texts).toContain('6. 依据：本图档未记录来源文档名/页。')
    expect(doc.entities.filter((entity) => entity.type === 'DIMENSION')).toHaveLength(3)
  })

  it('2000 userinput：标题栏/技术要求里带「依据：用户输入，无外部原文件」', () => {
    const doc = docOf('v2000_userinput')
    const texts = textOf(doc)
    expect(texts.some((text) => text.includes(USER_INPUT_BASIS))).toBe(true)
    expect(texts).toContain(`6. ${USER_INPUT_BASIS}。`)
    expect(doc.encoding.warning).toBe(false)
    expect(doc.unsupported).toEqual([])
  })

  it('2000 图纸空间把模型内容按视口比例画进纸面（1:2 已知点位移）', () => {
    const doc = docOf('v2000_1x2')
    const scene = buildPaperScene(doc, new Set())
    expect(scene).not.toBeNull()
    if (scene === null) return
    expect(scene.viewports).toHaveLength(1)
    const viewport = scene.viewports[0]
    expect(viewport.rect).toEqual({ x: 30, y: -280, width: 360, height: 208 })
    // 模型圆心 (360,260) → 纸面 (310,176) → 显示 y 取反。
    const circles = viewport.entities.flatMap((entity) =>
      entity.shapes.filter((shape) => shape.kind === 'circle'),
    )
    expect(circles).toHaveLength(2)
    expect(circles[0]).toMatchObject({ cx: 310, cy: -176, r: 8 })
    // 纸面 A3 图框：x 10..410、y 10..287。
    const frame = scene.entities.find((entity) =>
      entity.shapes.some(
        (shape) =>
          shape.kind === 'polyline' &&
          shape.points.some((point) => point.x === 10 && point.y === -10) &&
          shape.points.some((point) => point.x === 410 && point.y === -287),
      ),
    )
    expect(frame).toBeDefined()
    expect(scene.box).toEqual({ x: 0, y: -297, width: 420, height: 297 })
  })
})

describe('中文与编码', () => {
  it('GBK（ANSI_936）样本解码出完整中文，不是问号也不是乱码', () => {
    const accepted = parsed.get('v2000_1x2')!
    expect(accepted.encoding.charset).toBe('gbk')
    expect(accepted.encoding.warning).toBe(false)
    expect(textOf(accepted)).toContain('待复核草稿 · 未复核、未批准')
    // 逐字节确认：真实文件确实是 GBK（同一段文字用 UTF-8 解释会变乱码）。
    const raw = sample(FILES.v2000_1x2).bytes
    const utf8 = new TextDecoder('utf-8').decode(raw)
    expect(utf8.includes('待复核草稿')).toBe(false)
  })

  it('UTF-8 文件（声明 UTF-8）中文正确，warning=false', () => {
    const text = buildDxf({
      codepage: 'UTF-8',
      entities: ['0', 'TEXT', '8', '轮廓', '10', '10', '20', '20', '40', '3.5', '1', '中文标题栏：隔套'],
    })
    const bytes = new TextEncoder().encode(text)
    const doc = parseDxfDocument({ bytes, fileName: 'utf8.dxf' })
    expect(doc.encoding.charset).toBe('utf-8')
    expect(doc.encoding.warning).toBe(false)
    expect(doc.entities.find((entity) => entity.type === 'TEXT')?.text).toBe('中文标题栏：隔套')
  })

  it('编码解码失败必须报警，不能装没事', () => {
    const bytes = sample(FILES.v2000_1x2).bytes
    // 把 TEXT 值里的一个字节换成 GBK/UTF-8 都不合法的 0xFF。
    const broken = Uint8Array.from(bytes)
    const marker = new TextEncoder().encode('ANSI_936')
    let start = -1
    for (let index = 0; index + marker.length < broken.length; index += 1) {
      let match = true
      for (let offset = 0; offset < marker.length; offset += 1) {
        if (broken[index + offset] !== marker[offset]) match = false
      }
      if (match) {
        start = index + marker.length
        break
      }
    }
    expect(start).toBeGreaterThan(0)
    // ANSI_936 之后紧跟的换行/组码是 ASCII；在正文中间改一个高字节不安全，
    // 因此在文件末尾追加一个非法 GBK 字节也能触发 fatal 解码失败。
    const withBadByte = new Uint8Array(broken.length + 1)
    withBadByte.set(broken)
    withBadByte[broken.length] = 0xff
    const decoded = decodeDxfBytes(withBadByte)
    expect(decoded.encoding.warning).toBe(true)
    expect(decoded.encoding.detail).toMatch(/编码未识别|GBK 解码失败|无法/)
    expect(decoded.encoding.charset).not.toBe('gbk')
  })

  it('%%c → ⌀、%%d → °、%%p → ±', () => {
    expect(decodeTextSymbols('%%c20.000')).toBe('⌀20.000')
    expect(decodeTextSymbols('45%%d')).toBe('45°')
    expect(decodeTextSymbols('%%p0.05')).toBe('±0.05')
    expect(decodeTextSymbols('%%c32 %%d %%p')).toBe('⌀32 ° ±')
  })

  it('MTEXT 只取纯文本：\\P 换行、格式串与花括号去掉', () => {
    expect(plainMtext('{\\fArial|b0|i0;技术要求}\\P依据：%%c20')).toBe('技术要求\n依据：⌀20')
    expect(plainMtext('\\H2.5x;第一行\\P第二行')).toBe('第一行\n第二行')
  })

  it('标注值只认 42：块里写错的旧文字不参与显示', () => {
    expect(dimensionValueText(12.05, 32)).toBe('12.050')
    expect(dimensionValueText(20, 35)).toBe('⌀20.000')
    expect(dimensionValueText(8, 36)).toBe('R8.000')
  })
})

describe('未支持实体显式计数（绝不静默丢弃）', () => {
  it('SPLINE / HATCH / INSERT / SOLID 按类型计数，LINE 仍照常渲染', () => {
    const text = buildDxf({
      entities: [
        '0', 'LINE', '8', '轮廓', '10', '0', '20', '0', '11', '10', '21', '10',
        '0', 'SPLINE', '8', '轮廓', '10', '0', '20', '0',
        '0', 'HATCH', '8', '轮廓', '10', '0', '20', '0',
        '0', 'INSERT', '8', '轮廓', '2', 'BLOCK_A', '10', '0', '20', '0',
        '0', 'SOLID', '8', '轮廓', '10', '0', '20', '0', '11', '1', '21', '1',
      ],
    })
    const doc = parseDxfDocument({ bytes: new TextEncoder().encode(text), fileName: 'unsupported.dxf' })
    expect(doc.entities.filter((entity) => entity.type === 'LINE')).toHaveLength(1)
    expect(doc.unsupported).toEqual(
      expect.arrayContaining([
        { type: 'SPLINE', count: 1 },
        { type: 'HATCH', count: 1 },
        { type: 'INSERT', count: 1 },
        { type: 'SOLID', count: 1 },
      ]),
    )
    expect(doc.unsupported).toHaveLength(4)
    expect(doc.unsupported.reduce((total, item) => total + item.count, 0)).toBe(4)
  })

  it('二进制 DXF 明确拒绝解析，不伪装成空图', () => {
    const bytes = new TextEncoder().encode('AutoCAD Binary DXF\r\n\u001a\u0000\u0000\u0000')
    const doc = parseDxfDocument({ bytes, fileName: 'binary.dxf' })
    expect(doc.entities).toEqual([])
    expect(doc.unsupported).toEqual([{ type: '二进制 DXF', count: 1 }])
    expect(doc.notes.join('')).toContain('另存为 ASCII DXF')
    expect(doc.encoding.warning).toBe(true)
  })

  it('DIMENSION 缺 42 时按未渲染计数，不猜一个数字', () => {
    const text = buildDxf({
      entities: ['0', 'DIMENSION', '8', '尺寸', '2', '*D9', '70', '32', '10', '5', '20', '5'],
    })
    const doc = parseDxfDocument({ bytes: new TextEncoder().encode(text), fileName: 'dim42.dxf' })
    expect(doc.entities.filter((entity) => entity.type === 'DIMENSION')).toHaveLength(0)
    expect(doc.unsupported).toEqual([{ type: 'DIMENSION（缺 42 实测值）', count: 1 }])
    expect(doc.notes.join('')).toContain('缺组码 42')
  })
})

describe('平移/缩放/点选/量距（显示坐标）', () => {
  const doc = docOf('v2000_1x2')
  const paper = buildPaperScene(doc, new Set())!
  const model = buildModelScene(doc, new Set())

  it('模型场景包围盒覆盖零件与标注，图纸场景固定为 A3', () => {
    expect(model.box.width).toBeGreaterThan(100)
    expect(paper.box.width).toBe(420)
    expect(paper.box.height).toBe(297)
  })

  it('缩放以指针为不动点（真 viewBox 变换，不是 CSS scale）', () => {
    const box = fitViewBox({ minX: 0, minY: 0, maxX: 100, maxY: 100 })
    const anchor = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const zoomed = zoomViewBox(box, 2, anchor.x, anchor.y)
    expect(zoomed.width).toBeCloseTo(box.width / 2, 9)
    const anchorRatioBefore = (anchor.x - box.x) / box.width
    const anchorRatioAfter = (anchor.x - zoomed.x) / zoomed.width
    expect(anchorRatioAfter).toBeCloseTo(anchorRatioBefore, 9)
  })

  it('点选框线命中「图框」图层；空白处不命中', () => {
    const picked = pickEntity(paper, { x: 20, y: -10.2 }, 0.5)
    expect(picked?.layer).toBe('图框')
    expect(picked?.type).toBe('POLYLINE')
    expect(pickEntity(paper, { x: 200, y: -150 }, 0.5)).toBeNull()
  })

  it('量距咬合到最近端点，INSUNITS=4 显示 mm', () => {
    const line = model.entities
      .flatMap((entity) => entity.shapes)
      .find((shape): shape is Extract<typeof shape, { kind: 'line' }> => shape.kind === 'line')
    expect(line).toBeDefined()
    if (line === undefined) return
    const raw = { x: line.x1 + 0.6, y: line.y1 - 0.6 }
    const snapped = snapPoint(model, raw, 3)
    expect(snapped.x).toBeCloseTo(line.x1, 9)
    expect(snapped.y).toBeCloseTo(line.y1, 9)
    expect(formatMeasuredDistance(12.05, 4)).toBe('12.05 mm')
    expect(formatMeasuredDistance(12.05, null)).toBe('12.05 图纸单位')
  })

  it('距离函数对线/圆/弧/文字都给出几何距离', () => {
    expect(distanceToShape({ x: 5, y: 5 }, { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 })).toBeCloseTo(5, 9)
    expect(
      distanceToShape({ x: 5, y: 0 }, { kind: 'circle', cx: 0, cy: 0, r: 3 }),
    ).toBeCloseTo(2, 9)
    expect(
      distanceToShape({ x: 0, y: 0 }, { kind: 'text', x: 0, y: 0, text: 'AB', height: 2, rotationDeg: 0, anchor: 'start', baseline: 'alphabetic' }),
    ).toBe(0)
  })
})

describe('文件头读取（不依赖正文编码）', () => {
  it('能在未解码前读出 $DWGCODEPAGE 与 $ACADVER', () => {
    const bytes = sample(FILES.v2000_1x2).bytes
    expect(rawHeaderVariable(bytes, '$DWGCODEPAGE')).toBe('ANSI_936')
    expect(rawHeaderVariable(bytes, '$ACADVER')).toBe('AC1015')
  })
})
