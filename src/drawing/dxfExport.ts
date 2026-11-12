/**
 * DXF 导出 v1：DrawingData → DXF R12（AC1009，默认）/ DXF 2000（AC1015）。
 *
 * 纯 TS 写文本 DXF：不引 CAD 库、不联网、不加原生模块。
 *
 * 坐标（任务卡 §1.1，最容易做歪的一条）：
 *   DrawingData 是**纸面毫米、左上原点、y 向下**；DXF 模型空间是**真实尺寸 1:1、y 向上**。
 *   缩放 k = 分母 / 分子（1:2 图纸上 100mm 代表 200mm 实体）
 *   x_model = k · x_paper
 *   y_model = k · (纸面高 − y_paper)
 *   文字高度、箭头、虚线节距同样乘以 k。几何值保留到 1e-9mm，
 *   **不取整到 0.01**；只有标注数字（TEXT 内容）走既有 3/4 位小数显示规则。
 *
 * 实体：只用 R12 认识的 LINE / POLYLINE+VERTEX / CIRCLE / TEXT。
 * 尺寸标注 v1 是「几何 + TEXT」：尺寸线/界线是 LINE，箭头是两条短线，数字是 TEXT。
 * **没有 DIMENSION 实体，也没有 CAD 关联性**——改图不会自动改数。
 *
 * 编码：$DWGCODEPAGE = ANSI_936，文本按 GBK 写出（见 dxfGbk.ts）；直径符号 ⌀ 写成
 * R12 控制码 %%c，避免依赖 Unicode。
 */
import { dimensionText, resolveDimension } from './formatDimension'
import { DxfEncodingError, encodeDxfText } from './dxfGbk'
import type {
  CircleGeometry,
  DrawingAnnotation,
  DrawingData,
  DrawingPrimitive,
  LineGeometry,
  Point,
  PolylineGeometry,
  TextGeometry,
} from './types'

export const DXF_VERSIONS = ['r12', '2000'] as const
export type DxfVersion = (typeof DXF_VERSIONS)[number]

export const DXF_ACAD_VERSION: Record<DxfVersion, string> = {
  r12: 'AC1009',
  '2000': 'AC1015',
}

/** 图层：任务卡 §1.3 的五个图层，ACI 1–7。 */
export const DXF_LAYERS = [
  { name: '轮廓', color: 7, linetype: 'CONTINUOUS' },
  { name: '中心线', color: 1, linetype: 'CENTER' },
  { name: '尺寸', color: 3, linetype: 'CONTINUOUS' },
  { name: '文字', color: 2, linetype: 'CONTINUOUS' },
  { name: '图框', color: 4, linetype: 'CONTINUOUS' },
] as const

export type DxfLayerName = (typeof DXF_LAYERS)[number]['name']

/**
 * 标题栏/说明文字高度（纸面 mm，导出时乘 k）。与 renderDrawingSvg 的
 * .t-frame / .t-frame-strong / .t-status / .t-note 字号一致；标注数字用
 * DrawingData.styles.fontSizeMm。
 */
const SHEET_TEXT_HEIGHT_MM: Record<string, number> = {
  'frame-text': 3,
  'frame-text-strong': 3.2,
  'sheet-status': 4,
  'drawing-note': 3.5,
}

const LINE_LAYER: Record<string, DxfLayerName> = {
  frame: '图框',
  'frame-thin': '图框',
  outline: '轮廓',
  hidden: '轮廓',
  center: '中心线',
  dim: '尺寸',
}

const TEXT_LAYER: Record<string, DxfLayerName> = {
  'frame-text': '图框',
  'frame-text-strong': '图框',
  'sheet-status': '图框',
  'drawing-note': '文字',
  dim: '尺寸',
}

/** 隐藏线在轮廓层上用虚线线型覆盖；R12 实体级 linetype 覆盖是合法的。 */
const STYLE_LINETYPE: Record<string, string | undefined> = {
  hidden: 'DASHED',
}

export type DxfExportErrorCode = 'INVALID_DRAWING' | 'UNSUPPORTED_VERSION' | 'DXF_TEXT_UNENCODABLE'

export class DxfExportError extends Error {
  readonly code: DxfExportErrorCode
  readonly detail?: string

  constructor(code: DxfExportErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'DxfExportError'
    this.code = code
    this.detail = detail
  }
}

export interface DxfBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface DxfEntityCounts {
  line: number
  polyline: number
  vertex: number
  circle: number
  text: number
}

export interface DxfBuildResult {
  version: DxfVersion
  acadVersion: string
  /** 解码后的 DXF 文本（DXF 文件本身是 GBK 字节）。 */
  text: string
  bytes: Uint8Array
  counts: DxfEntityCounts
  layers: { name: string; color: number; linetype: string }[]
  /** 只含 LINE/POLYLINE/CIRCLE 的外廓；文字插入点不算。 */
  geometryBounds: DxfBounds
  /** 含 TEXT 插入点的总范围。 */
  entityBounds: DxfBounds
  /** 主视图（axial.outline）的外廓；用于核对真实尺寸。 */
  drawingOutlineBounds: DxfBounds | null
}

type Source = 'sheet' | 'drawing' | 'annotation'

interface EmitLine {
  kind: 'line'
  layer: DxfLayerName
  linetype?: string
  source: Source
  x1: number
  y1: number
  x2: number
  y2: number
}

interface EmitPolyline {
  kind: 'polyline'
  layer: DxfLayerName
  linetype?: string
  source: Source
  points: { x: number; y: number }[]
}

interface EmitCircle {
  kind: 'circle'
  layer: DxfLayerName
  linetype?: string
  source: Source
  cx: number
  cy: number
  r: number
}

interface EmitText {
  kind: 'text'
  layer: DxfLayerName
  source: Source
  x: number
  y: number
  height: number
  text: string
  anchor: 'start' | 'middle' | 'end'
}

type EmitEntity = EmitLine | EmitPolyline | EmitCircle | EmitText

function fail(code: DxfExportErrorCode, message: string, detail?: string): never {
  throw new DxfExportError(code, message, detail)
}

function finite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('INVALID_DRAWING', `图纸字段 ${field} 不是有限数值`, String(value))
  }
  return value
}

/** 1:2 图纸 → 2；1:1 → 1；2:1 → 0.5。 */
export function dxfScaleFactorOf(data: DrawingData): number {
  const numerator = finite(data.scale?.numerator, 'scale.numerator')
  const denominator = finite(data.scale?.denominator, 'scale.denominator')
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || numerator <= 0 || denominator <= 0) {
    fail('INVALID_DRAWING', '图纸比例必须是正整数', `${String(data.scale?.numerator)}:${String(data.scale?.denominator)}`)
  }
  return denominator / numerator
}

/** 纸面点（左上原点，y 向下）→ 模型点（1:1，y 向上）。 */
export function dxfPaperToModel(data: DrawingData, point: Point): Point {
  const k = dxfScaleFactorOf(data)
  const height = finite(data.paper?.heightMm, 'paper.heightMm')
  if (height <= 0) fail('INVALID_DRAWING', '纸张高度必须为正', String(height))
  return {
    x: finite(point.x, 'point.x') * k,
    y: (height - finite(point.y, 'point.y')) * k,
  }
}

function number(value: number): string {
  if (!Number.isFinite(value)) fail('INVALID_DRAWING', 'DXF 坐标必须有限', String(value))
  // 1e-9mm 远小于任何加工/检具分辨率，也远小于 0.001mm 验收容差；
  // 这里只去掉浮点噪声，不做 0.01mm 级取整。
  const rounded = Math.round(value * 1e9) / 1e9
  const text = rounded.toFixed(9).replace(/0+$/u, '').replace(/\.$/u, '')
  return text === '-0' ? '0' : text
}

function escapeText(value: string): string {
  if (value.includes('\n') || value.includes('\r')) {
    fail('INVALID_DRAWING', 'DXF TEXT 不支持换行', value.slice(0, 40))
  }
  return value
}

function assertDrawing(data: DrawingData): void {
  if (data === null || typeof data !== 'object') fail('INVALID_DRAWING', 'DrawingData 为空')
  if (!Array.isArray(data.primitives) || !Array.isArray(data.annotations)) {
    fail('INVALID_DRAWING', 'DrawingData 缺少图元/标注数组')
  }
  if (data.primitives.length === 0) fail('INVALID_DRAWING', '图纸没有任何图元，拒绝导出空 DXF')
  if (data.paper === undefined || data.paper.format !== 'A4' || data.paper.orientation !== 'landscape') {
    fail('INVALID_DRAWING', 'DXF 导出只支持 A4 横向图纸')
  }
  if (data.styles === undefined || !Number.isFinite(data.styles.fontSizeMm) || data.styles.fontSizeMm <= 0) {
    fail('INVALID_DRAWING', '图纸缺少有效字号')
  }
  dxfScaleFactorOf(data)
}

function layerOfLine(styleId: string): DxfLayerName {
  const layer = LINE_LAYER[styleId]
  if (layer === undefined) fail('INVALID_DRAWING', `未知线型样式：${styleId}`)
  return layer
}

function layerOfText(styleId: string): DxfLayerName {
  const layer = TEXT_LAYER[styleId]
  if (layer === undefined) fail('INVALID_DRAWING', `未知文字样式：${styleId}`)
  return layer
}

function textHeightOf(data: DrawingData, styleId: string): number {
  if (styleId === 'dim' || styleId === 'drawing-note') return data.styles.fontSizeMm
  const fixed = SHEET_TEXT_HEIGHT_MM[styleId]
  if (fixed === undefined) fail('INVALID_DRAWING', `未知文字样式：${styleId}`)
  return fixed
}

function paperLine(
  data: DrawingData,
  geometry: LineGeometry,
  layer: DxfLayerName,
  source: Source,
  linetype?: string,
): EmitLine {
  const from = dxfPaperToModel(data, { x: geometry.x1, y: geometry.y1 })
  const to = dxfPaperToModel(data, { x: geometry.x2, y: geometry.y2 })
  return { kind: 'line', layer, linetype, source, x1: from.x, y1: from.y, x2: to.x, y2: to.y }
}

function emitPrimitive(data: DrawingData, primitive: DrawingPrimitive): EmitEntity {
  const source: Source = primitive.area === 'sheet' ? 'sheet' : 'drawing'
  if (primitive.kind === 'line') {
    const geometry = primitive.geometryMm as LineGeometry
    return paperLine(data, geometry, layerOfLine(primitive.styleId), source, STYLE_LINETYPE[primitive.styleId])
  }
  if (primitive.kind === 'polyline') {
    const geometry = primitive.geometryMm as PolylineGeometry
    if (!Array.isArray(geometry.points) || geometry.points.length < 2) {
      fail('INVALID_DRAWING', `折线 ${primitive.primitiveId} 顶点不足`)
    }
    return {
      kind: 'polyline',
      layer: layerOfLine(primitive.styleId),
      source,
      points: geometry.points.map((point) => dxfPaperToModel(data, point)),
    }
  }
  if (primitive.kind === 'circle') {
    const geometry = primitive.geometryMm as CircleGeometry
    const center = dxfPaperToModel(data, { x: geometry.cx, y: geometry.cy })
    const radius = finite(geometry.r, `${primitive.primitiveId}.r`) * dxfScaleFactorOf(data)
    if (radius <= 0) fail('INVALID_DRAWING', `圆 ${primitive.primitiveId} 半径非正`)
    return { kind: 'circle', layer: layerOfLine(primitive.styleId), source, cx: center.x, cy: center.y, r: radius }
  }
  if (primitive.kind === 'text') {
    const geometry = primitive.geometryMm as TextGeometry
    const at = dxfPaperToModel(data, { x: geometry.x, y: geometry.y })
    return {
      kind: 'text',
      layer: layerOfText(primitive.styleId),
      source,
      x: at.x,
      y: at.y,
      height: textHeightOf(data, primitive.styleId) * dxfScaleFactorOf(data),
      text: escapeText(geometry.text),
      anchor: geometry.anchor,
    }
  }
  fail('INVALID_DRAWING', `未知图元类型：${String((primitive as { kind?: unknown }).kind)}`)
}

/** 箭头：两条短线（R12 白名单里没有 SOLID）。角度沿用纸面约定（y 向下、顺时针为正）。 */
function arrowLines(data: DrawingData, at: Point, angleDeg: number): EmitLine[] {
  const k = dxfScaleFactorOf(data)
  const length = finite(data.styles.arrow?.lengthMm, 'styles.arrow.lengthMm') * k
  const halfWidth = (finite(data.styles.arrow?.widthMm, 'styles.arrow.widthMm') * k) / 2
  const radians = (angleDeg * Math.PI) / 180
  const dir = { x: Math.cos(radians), y: Math.sin(radians) }
  const perp = { x: -dir.y, y: dir.x }
  const base = { x: at.x - dir.x * length, y: at.y - dir.y * length }
  const left = { x: base.x + perp.x * halfWidth, y: base.y + perp.y * halfWidth }
  const right = { x: base.x - perp.x * halfWidth, y: base.y - perp.y * halfWidth }
  const paper = [
    { x1: at.x, y1: at.y, x2: left.x, y2: left.y },
    { x1: at.x, y1: at.y, x2: right.x, y2: right.y },
  ]
  return paper.map((segment) => paperLine(data, segment, '尺寸', 'annotation'))
}

function emitAnnotation(data: DrawingData, annotation: DrawingAnnotation): EmitEntity[] {
  const resolved = resolveDimension(annotation.parameterId, data.parameterSnapshot)
  if (!resolved.ok) fail('INVALID_DRAWING', `标注数字无法解析：${resolved.message}`, annotation.annotationId)
  const entities: EmitEntity[] = []
  for (const line of annotation.dimensionGeometryMm.lines) {
    entities.push(paperLine(data, line, '尺寸', 'annotation'))
  }
  for (const arrow of annotation.dimensionGeometryMm.arrows) {
    entities.push(...arrowLines(data, arrow.at, arrow.angleDeg))
  }
  const at = dxfPaperToModel(data, annotation.textPositionMm)
  // ⌀ 在 R12/2000 里用 ASCII 控制码 %%c（AutoCAD 直径符号），不依赖 Unicode 字形。
  const text = dimensionText(resolved.value, annotation.kind).replace(/⌀/gu, '%%c')
  entities.push({
    kind: 'text',
    layer: '尺寸',
    source: 'annotation',
    x: at.x,
    y: at.y,
    height: data.styles.fontSizeMm * dxfScaleFactorOf(data),
    text: escapeText(text),
    anchor: annotation.textAnchor,
  })
  return entities
}

function pointsOf(entity: EmitEntity): { x: number; y: number }[] {
  if (entity.kind === 'line') {
    return [
      { x: entity.x1, y: entity.y1 },
      { x: entity.x2, y: entity.y2 },
    ]
  }
  if (entity.kind === 'polyline') return entity.points
  if (entity.kind === 'circle') {
    return [
      { x: entity.cx - entity.r, y: entity.cy - entity.r },
      { x: entity.cx + entity.r, y: entity.cy + entity.r },
    ]
  }
  return [{ x: entity.x, y: entity.y }]
}

function boundsOf(points: { x: number; y: number }[]): DxfBounds | null {
  if (points.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return { minX, minY, maxX, maxY }
}

function unionBounds(a: DxfBounds | null, b: DxfBounds | null): DxfBounds | null {
  if (a === null) return b
  if (b === null) return a
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

interface Serializer {
  version: DxfVersion
  lines: string[]
  handle: number
}

function nextHandle(state: Serializer): string | null {
  if (state.version !== '2000') return null
  const value = (0x100 + state.handle).toString(16).toUpperCase()
  state.handle += 1
  return value
}

function pair(state: Serializer, code: number, value: string | number): void {
  state.lines.push(String(code), String(value))
}

function serializeEntity(state: Serializer, entity: EmitEntity): void {
  if (entity.kind === 'line') {
    pair(state, 0, 'LINE')
    const handle = nextHandle(state)
    if (handle !== null) pair(state, 5, handle)
    pair(state, 8, entity.layer)
    if (entity.linetype !== undefined) pair(state, 6, entity.linetype)
    pair(state, 10, number(entity.x1))
    pair(state, 20, number(entity.y1))
    pair(state, 30, '0')
    pair(state, 11, number(entity.x2))
    pair(state, 21, number(entity.y2))
    pair(state, 31, '0')
    return
  }
  if (entity.kind === 'polyline') {
    pair(state, 0, 'POLYLINE')
    const handle = nextHandle(state)
    if (handle !== null) pair(state, 5, handle)
    pair(state, 8, entity.layer)
    if (entity.linetype !== undefined) pair(state, 6, entity.linetype)
    pair(state, 66, 1)
    pair(state, 70, 0)
    pair(state, 10, '0')
    pair(state, 20, '0')
    pair(state, 30, '0')
    for (const point of entity.points) {
      pair(state, 0, 'VERTEX')
      const vertexHandle = nextHandle(state)
      if (vertexHandle !== null) pair(state, 5, vertexHandle)
      pair(state, 8, entity.layer)
      pair(state, 10, number(point.x))
      pair(state, 20, number(point.y))
      pair(state, 30, '0')
      pair(state, 70, 0)
    }
    pair(state, 0, 'SEQEND')
    const endHandle = nextHandle(state)
    if (endHandle !== null) pair(state, 5, endHandle)
    pair(state, 8, entity.layer)
    return
  }
  if (entity.kind === 'circle') {
    pair(state, 0, 'CIRCLE')
    const handle = nextHandle(state)
    if (handle !== null) pair(state, 5, handle)
    pair(state, 8, entity.layer)
    if (entity.linetype !== undefined) pair(state, 6, entity.linetype)
    pair(state, 10, number(entity.cx))
    pair(state, 20, number(entity.cy))
    pair(state, 30, '0')
    pair(state, 40, number(entity.r))
    return
  }
  pair(state, 0, 'TEXT')
  const handle = nextHandle(state)
  if (handle !== null) pair(state, 5, handle)
  pair(state, 8, entity.layer)
  pair(state, 10, number(entity.x))
  pair(state, 20, number(entity.y))
  pair(state, 30, '0')
  pair(state, 40, number(entity.height))
  pair(state, 1, entity.text)
  pair(state, 50, '0')
  pair(state, 7, '标准')
  pair(state, 72, entity.anchor === 'start' ? 0 : entity.anchor === 'middle' ? 1 : 2)
  pair(state, 11, number(entity.x))
  pair(state, 21, number(entity.y))
  pair(state, 31, '0')
  pair(state, 73, 0)
}

function dashPattern(data: DrawingData): { center: number[]; dashed: number[] } {
  const k = dxfScaleFactorOf(data)
  const center = data.styles.dashPatternsMm?.center ?? [12, 3, 2, 3]
  const hidden = data.styles.dashPatternsMm?.hidden ?? [3, 2]
  return {
    center: center.map((value) => value * k),
    dashed: hidden.map((value) => value * k),
  }
}

function ltypePattern(name: string, description: string, pattern: number[]): [number, string | number][] {
  const total = pattern.reduce((sum, value) => sum + Math.abs(value), 0)
  return [
    [0, 'LTYPE'],
    [2, name],
    [70, 0],
    [3, description],
    [72, 65],
    [73, pattern.length],
    [40, number(total)],
    ...pattern.map((value, index): [number, string] => [49, number(index % 2 === 0 ? value : -Math.abs(value))]),
  ]
}

/** 构建完整 DXF（文本 + GBK 字节）。任何非法输入抛 DxfExportError，不产生半截文件。 */
export function buildDxfDocument(data: DrawingData, version: DxfVersion): DxfBuildResult {
  if (!DXF_VERSIONS.includes(version)) {
    fail('UNSUPPORTED_VERSION', `不支持的 DXF 版本：${String(version)}`)
  }
  assertDrawing(data)

  const entities: EmitEntity[] = []
  let outlinePoints: { x: number; y: number }[] = []
  for (const primitive of data.primitives) {
    const emitted = emitPrimitive(data, primitive)
    entities.push(emitted)
    if (
      primitive.primitiveId === 'axial.outline' &&
      primitive.area === 'drawing' &&
      primitive.styleId === 'outline' &&
      emitted.kind === 'polyline'
    ) {
      outlinePoints = emitted.points
    }
  }
  for (const annotation of data.annotations) {
    entities.push(...emitAnnotation(data, annotation))
  }

  const counts: DxfEntityCounts = { line: 0, polyline: 0, vertex: 0, circle: 0, text: 0 }
  let geometry: DxfBounds | null = null
  let all: DxfBounds | null = null
  for (const entity of entities) {
    if (entity.kind === 'line') counts.line += 1
    else if (entity.kind === 'polyline') {
      counts.polyline += 1
      counts.vertex += entity.points.length
    } else if (entity.kind === 'circle') counts.circle += 1
    else counts.text += 1
    if (entity.kind !== 'text') geometry = unionBounds(geometry, boundsOf(pointsOf(entity)))
    all = unionBounds(all, boundsOf(pointsOf(entity)))
  }
  if (geometry === null) fail('INVALID_DRAWING', '图纸没有可导出的几何')
  if (outlinePoints.length === 0) fail('INVALID_DRAWING', '图纸缺少主视图轮廓（axial.outline）')
  const drawingOutlineBounds = boundsOf(outlinePoints)
  if (drawingOutlineBounds === null) fail('INVALID_DRAWING', '主视图轮廓没有顶点')

  const acadVersion = DXF_ACAD_VERSION[version]
  const scale = dxfScaleFactorOf(data)
  const paperWidth = data.paper.widthMm * scale
  const paperHeight = data.paper.heightMm * scale
  const pattern = dashPattern(data)
  const state: Serializer = { version, lines: [], handle: 0 }

  // 无任务书项目：文件头第一行写依据（999 = DXF 注释，R12/2000 均允许）。
  const basis = typeof data.frame.fields.basis === 'string' ? data.frame.fields.basis : ''
  if (basis !== '') pair(state, 999, basis)

  // HEADER
  pair(state, 0, 'SECTION')
  pair(state, 2, 'HEADER')
  pair(state, 9, '$ACADVER')
  pair(state, 1, acadVersion)
  pair(state, 9, '$DWGCODEPAGE')
  pair(state, 3, 'ANSI_936')
  pair(state, 9, '$INSBASE')
  pair(state, 10, '0')
  pair(state, 20, '0')
  pair(state, 30, '0')
  pair(state, 9, '$EXTMIN')
  pair(state, 10, number(geometry.minX))
  pair(state, 20, number(geometry.minY))
  pair(state, 30, '0')
  pair(state, 9, '$EXTMAX')
  pair(state, 10, number(geometry.maxX))
  pair(state, 20, number(geometry.maxY))
  pair(state, 30, '0')
  pair(state, 9, '$LIMMIN')
  pair(state, 10, '0')
  pair(state, 20, '0')
  pair(state, 9, '$LIMMAX')
  pair(state, 10, number(paperWidth))
  pair(state, 20, number(paperHeight))
  pair(state, 9, '$LTSCALE')
  pair(state, 40, '1')
  pair(state, 9, '$TEXTSTYLE')
  pair(state, 7, '标准')
  pair(state, 9, '$MEASUREMENT')
  pair(state, 70, 1)
  if (version === '2000') {
    pair(state, 9, '$INSUNITS')
    pair(state, 70, 4)
    // 本版句柄空间远小于 0xFFFF，够用且不需要先数实体。
    pair(state, 9, '$HANDSEED')
    pair(state, 5, 'FFFF')
  }
  pair(state, 0, 'ENDSEC')

  // TABLES（LTYPE / LAYER / STYLE / APPID）
  pair(state, 0, 'SECTION')
  pair(state, 2, 'TABLES')

  pair(state, 0, 'TABLE')
  pair(state, 2, 'LTYPE')
  const ltypeTableHandle = nextHandle(state)
  if (ltypeTableHandle !== null) pair(state, 5, ltypeTableHandle)
  pair(state, 70, 3)
  pair(state, 0, 'LTYPE')
  const continuousHandle = nextHandle(state)
  if (continuousHandle !== null) pair(state, 5, continuousHandle)
  for (const [code, value] of ltypePattern('CONTINUOUS', 'Solid line', [])) {
    if (code === 0) continue
    pair(state, code, value)
  }
  pair(state, 0, 'LTYPE')
  const centerHandle = nextHandle(state)
  if (centerHandle !== null) pair(state, 5, centerHandle)
  for (const [code, value] of ltypePattern('CENTER', 'Center ____ _ ____', pattern.center)) {
    if (code === 0) continue
    pair(state, code, value)
  }
  pair(state, 0, 'LTYPE')
  const dashedHandle = nextHandle(state)
  if (dashedHandle !== null) pair(state, 5, dashedHandle)
  for (const [code, value] of ltypePattern('DASHED', 'Dashed __ __', pattern.dashed)) {
    if (code === 0) continue
    pair(state, code, value)
  }
  pair(state, 0, 'ENDTAB')

  pair(state, 0, 'TABLE')
  pair(state, 2, 'LAYER')
  const layerTableHandle = nextHandle(state)
  if (layerTableHandle !== null) pair(state, 5, layerTableHandle)
  pair(state, 70, DXF_LAYERS.length)
  for (const layer of DXF_LAYERS) {
    pair(state, 0, 'LAYER')
    const layerHandle = nextHandle(state)
    if (layerHandle !== null) pair(state, 5, layerHandle)
    pair(state, 2, layer.name)
    pair(state, 70, 0)
    pair(state, 62, layer.color)
    pair(state, 6, layer.linetype)
  }
  pair(state, 0, 'ENDTAB')

  pair(state, 0, 'TABLE')
  pair(state, 2, 'STYLE')
  const styleTableHandle = nextHandle(state)
  if (styleTableHandle !== null) pair(state, 5, styleTableHandle)
  pair(state, 70, 1)
  pair(state, 0, 'STYLE')
  const styleHandle = nextHandle(state)
  if (styleHandle !== null) pair(state, 5, styleHandle)
  pair(state, 2, '标准')
  pair(state, 70, 0)
  pair(state, 40, 0)
  pair(state, 41, 1)
  pair(state, 50, 0)
  pair(state, 71, 0)
  pair(state, 42, 2.5)
  pair(state, 3, 'txt.shx')
  pair(state, 4, 'hztxt.shx')
  pair(state, 0, 'ENDTAB')

  pair(state, 0, 'TABLE')
  pair(state, 2, 'APPID')
  const appidTableHandle = nextHandle(state)
  if (appidTableHandle !== null) pair(state, 5, appidTableHandle)
  pair(state, 70, 1)
  pair(state, 0, 'APPID')
  const appidHandle = nextHandle(state)
  if (appidHandle !== null) pair(state, 5, appidHandle)
  pair(state, 2, 'ACAD')
  pair(state, 70, 0)
  pair(state, 0, 'ENDTAB')

  pair(state, 0, 'ENDSEC')

  // BLOCKS：空表（本版不写块定义，所有图元直接进 ENTITIES）。
  pair(state, 0, 'SECTION')
  pair(state, 2, 'BLOCKS')
  pair(state, 0, 'ENDSEC')

  pair(state, 0, 'SECTION')
  pair(state, 2, 'ENTITIES')
  for (const entity of entities) serializeEntity(state, entity)
  pair(state, 0, 'ENDSEC')
  pair(state, 0, 'EOF')

  const text = `${state.lines.join('\r\n')}\r\n`
  let bytes: Uint8Array
  try {
    bytes = encodeDxfText(text)
  } catch (error) {
    if (error instanceof DxfEncodingError) {
      fail('DXF_TEXT_UNENCODABLE', error.message, `${error.character}@${error.index}`)
    }
    throw error
  }
  return {
    version,
    acadVersion,
    text,
    bytes,
    counts,
    layers: DXF_LAYERS.map((layer) => ({ name: layer.name, color: layer.color, linetype: layer.linetype })),
    geometryBounds: geometry,
    entityBounds: all as DxfBounds,
    drawingOutlineBounds,
  }
}

export interface DxfValidation {
  ok: boolean
  errors: string[]
}

export const FORBIDDEN_R12_TOKENS = ['LWPOLYLINE', 'MTEXT', 'SPLINE', 'HATCH'] as const

/**
 * 导出前的纯 TS 结构校验（产品通道用；dxf-parser 读回在测试/证据里做）。
 * 行为：重新构建一遍期望值，逐字节比较，再检查头/表/白名单。
 */
export function validateDxfBytes(
  bytes: Uint8Array,
  data: DrawingData,
  version: DxfVersion,
): DxfValidation {
  const errors: string[] = []
  let expected: DxfBuildResult
  try {
    expected = buildDxfDocument(data, version)
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] }
  }
  if (bytes.byteLength !== expected.bytes.byteLength) {
    errors.push(`字节数与预期不一致：${bytes.byteLength} ≠ ${expected.bytes.byteLength}`)
  } else {
    for (let index = 0; index < bytes.byteLength; index += 1) {
      if (bytes[index] !== expected.bytes[index]) {
        errors.push(`第 ${index} 字节与预期不一致`)
        break
      }
    }
  }
  const text = expected.text
  if (!text.includes('$ACADVER') || !text.includes(DXF_ACAD_VERSION[version])) {
    errors.push('缺少 $ACADVER 或版本号不符')
  }
  if (!text.includes('$DWGCODEPAGE') || !text.includes('ANSI_936')) {
    errors.push('缺少 $DWGCODEPAGE=ANSI_936')
  }
  if (!/\r\n9\r\n\$MEASUREMENT\r\n70\r\n1\r\n/u.test(text)) {
    errors.push('缺少公制标记 $MEASUREMENT=1')
  }
  if (version === '2000' && !text.includes('$INSUNITS')) {
    errors.push('2000 版缺少 $INSUNITS')
  }
  for (const layer of DXF_LAYERS) {
    if (!text.includes(`\r\n2\r\n${layer.name}\r\n70\r\n`)) errors.push(`缺少图层：${layer.name}`)
    if (!text.includes(`\r\n62\r\n${layer.color}\r\n6\r\n`)) errors.push(`图层颜色不符：${layer.name}`)
  }
  if (version === 'r12') {
    for (const token of FORBIDDEN_R12_TOKENS) {
      if (text.includes(token)) errors.push(`R12 文件出现不支持的实体：${token}`)
    }
  }
  if (!text.trimEnd().endsWith('EOF')) errors.push('文件没有以 EOF 结束')
  return { ok: errors.length === 0, errors }
}
