/**
 * DXF 导出 v2：DrawingData → DXF R12（AC1009，默认）/ DXF 2000（AC1015）。
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
 * 两个版本的能力不同（出图加深，见 docs/evidence/dxf-depth/research.md）：
 *
 *   R12（AC1009）—— 保持 v1 现状：单张纸、模型空间、实体只用
 *   LINE / POLYLINE+VERTEX / CIRCLE / TEXT；尺寸是「几何 + TEXT」，
 *   **没有 DIMENSION 实体、没有 LAYOUT/VIEWPORT**（R12 没这些结构）。
 *
 *   2000（AC1015）—— 真图纸结构：
 *     · 模型空间：1:1 真实尺寸零件 + 真 DIMENSION 实体（长度 / 直径两类），
 *       每个标注指向自己的匿名几何块（*D1/*D2/…），块里是尺寸线/界线/箭头/文字；
 *     · 图纸空间：A3 横向 420×297 图框 + 标题栏 + 技术要求区，坐标就是纸面 mm；
 *     · 一个 VIEWPORT：40=视口宽、41=视口高（纸面 mm）、45=模型视高 = 视口高 × k；
 *     · OBJECTS 段的 LAYOUT 对象（A3、420×297）把两者绑成一个布局。
 *
 * 编码：$DWGCODEPAGE = ANSI_936，文本按 GBK 写出（见 dxfGbk.ts）；直径符号 ⌀ 写成
 * R12 控制码 %%c，避免依赖 Unicode。
 */
import { dimensionText, resolveDimension } from './formatDimension'
import { DxfEncodingError, encodeDxfText } from './dxfGbk'
import {
  DRAFT_STATUS_TEXT,
  MISSING_TEXT,
  THIRD_ANGLE_PROJECTION,
  type CircleGeometry,
  type DrawingAnnotation,
  type DrawingData,
  type DrawingPrimitive,
  type LineGeometry,
  type Point,
  type PolylineGeometry,
  type TextGeometry,
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

/** 标注样式名（DIMSTYLE 表条目）；2000 的 DIMENSION 实体用组码 3 引用它。 */
export const DXF_DIM_STYLE_NAME = '寸链尺寸'
export const DXF_TEXT_STYLE_NAME = '标准'

/** A3 横向图幅（图纸空间单位 = 纸面 mm）。 */
export const DXF_SHEET_A3 = { widthMm: 420, heightMm: 297 } as const

/**
 * A3 图纸空间版面（y 向上、原点在纸左下角，单位 mm）。
 * 图框 10mm 边距；标题栏在右下，技术要求区在左下，两者上方留给视口。
 */
export const A3_LAYOUT = {
  frame: { x1: 10, y1: 10, x2: 410, y2: 287 },
  title: { x1: 250, y1: 10, x2: 410, y2: 62 },
  tech: { x1: 10, y1: 10, x2: 250, y2: 62 },
  viewport: { cx: 210, cy: 176, widthMm: 360, heightMm: 208 },
} as const

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
  /** 2000 才有：真 DIMENSION 实体数（R12 恒为 0）。 */
  dimension: number
  /** 2000 才有：图纸空间 VIEWPORT 数（R12 恒为 0）。 */
  viewport: number
}

/** 一个真标注的落地摘要，供测试与证据核对（不是第二份真源，只是导出结果清单）。 */
export interface DxfDimensionSummary {
  annotationId: string
  /** 1=线性/长度，3=直径。低 4 位见 DXF 组码 70。 */
  dimensionType: number
  blockName: string
  dimStyle: string
  /** 组码 42：实测值（模型 mm，来自 q 换算，不写死）。 */
  actualMeasurementMm: number
  /** 组码 1：文字覆盖值。 */
  text: string
  /** 组码 10/11/13/14/15（模型坐标）。 */
  defPoint: Point
  textMidPoint: Point
  firstPoint: Point
  secondPoint: Point
  /** 该类标注用到的子类标记。 */
  subclass: 'AcDbAlignedDimension' | 'AcDbDiametricDimension'
}

export interface DxfViewportSummary {
  /** 视口在图上的位置与尺寸（纸面 mm）。 */
  centerMm: Point
  widthMm: number
  heightMm: number
  /** 组码 45：模型视高（模型 mm）。 */
  viewHeightMm: number
  /** 组码 12/22：模型视图中心。 */
  viewCenter: Point
  /** 纸面高 / 模型视高 = 1/k：1:1 → 1，1:2 → 0.5。 */
  paperPerModel: number
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
  /** 图纸空间图幅；R12 是单张 A4 纸（现状），2000 是 A3。 */
  sheet: { widthMm: number; heightMm: number; space: 'model' | 'layout' }
  /** 2000 的真标注清单；R12 为空数组。 */
  dimensions: DxfDimensionSummary[]
  /** 2000 的视口；R12 为 null。 */
  viewport: DxfViewportSummary | null
}

type Space = 'model' | 'paper'

interface EmitLine {
  kind: 'line'
  layer: DxfLayerName
  linetype?: string
  source: 'sheet' | 'drawing' | 'annotation'
  space: Space
  x1: number
  y1: number
  x2: number
  y2: number
}

interface EmitPolyline {
  kind: 'polyline'
  layer: DxfLayerName
  linetype?: string
  source: 'sheet' | 'drawing' | 'annotation'
  space: Space
  points: { x: number; y: number }[]
}

interface EmitCircle {
  kind: 'circle'
  layer: DxfLayerName
  linetype?: string
  source: 'sheet' | 'drawing' | 'annotation'
  space: Space
  cx: number
  cy: number
  r: number
}

interface EmitText {
  kind: 'text'
  layer: DxfLayerName
  source: 'sheet' | 'drawing' | 'annotation'
  space: Space
  x: number
  y: number
  height: number
  text: string
  anchor: 'start' | 'middle' | 'end'
}

/** 真标注：图形在匿名块里，实体自己只有引用与测量值。 */
interface EmitDimension {
  kind: 'dimension'
  layer: DxfLayerName
  source: 'annotation'
  space: 'model'
  annotationId: string
  dimensionType: number
  blockName: string
  dimStyle: string
  defPoint: Point
  textMidPoint: Point
  firstPoint: Point
  secondPoint: Point
  /** 直径标注用的对侧点（组码 15）；线性标注为 null。 */
  oppositePoint: Point | null
  angleDeg: number
  text: string
  actualMeasurementMm: number
  subclass: 'AcDbAlignedDimension' | 'AcDbDiametricDimension'
}

/** 图纸空间视口。 */
interface EmitViewport {
  kind: 'viewport'
  layer: DxfLayerName
  source: 'sheet'
  space: 'paper'
  cx: number
  cy: number
  widthMm: number
  heightMm: number
  viewCx: number
  viewCy: number
  viewHeightMm: number
  id: number
  status: number
}

type EmitEntity = EmitLine | EmitPolyline | EmitCircle | EmitText | EmitDimension | EmitViewport

/** 一个块定义（模型空间/图纸空间/匿名标注块）。 */
interface EmitBlock {
  name: string
  /** 匿名标注块用 1，普通块用 0（组码 70）。 */
  flag: 0 | 1
  entities: EmitEntity[]
}

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
  source: 'sheet' | 'drawing' | 'annotation',
  linetype?: string,
): EmitLine {
  const from = dxfPaperToModel(data, { x: geometry.x1, y: geometry.y1 })
  const to = dxfPaperToModel(data, { x: geometry.x2, y: geometry.y2 })
  return { kind: 'line', layer, linetype, source, space: 'model', x1: from.x, y1: from.y, x2: to.x, y2: to.y }
}

function emitPrimitive(data: DrawingData, primitive: DrawingPrimitive): EmitEntity {
  const source: 'sheet' | 'drawing' = primitive.area === 'sheet' ? 'sheet' : 'drawing'
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
      space: 'model',
      points: geometry.points.map((point) => dxfPaperToModel(data, point)),
    }
  }
  if (primitive.kind === 'circle') {
    const geometry = primitive.geometryMm as CircleGeometry
    const center = dxfPaperToModel(data, { x: geometry.cx, y: geometry.cy })
    const radius = finite(geometry.r, `${primitive.primitiveId}.r`) * dxfScaleFactorOf(data)
    if (radius <= 0) fail('INVALID_DRAWING', `圆 ${primitive.primitiveId} 半径非正`)
    return { kind: 'circle', layer: layerOfLine(primitive.styleId), source, space: 'model', cx: center.x, cy: center.y, r: radius }
  }
  if (primitive.kind === 'text') {
    const geometry = primitive.geometryMm as TextGeometry
    const at = dxfPaperToModel(data, { x: geometry.x, y: geometry.y })
    return {
      kind: 'text',
      layer: layerOfText(primitive.styleId),
      source,
      space: 'model',
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

/** 标注的「可见图形」：尺寸线/界线/箭头/文字。2000 里这些进匿名块，R12 里直接进模型空间。 */
function annotationGraphics(data: DrawingData, annotation: DrawingAnnotation): EmitEntity[] {
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
    space: 'model',
    x: at.x,
    y: at.y,
    height: data.styles.fontSizeMm * dxfScaleFactorOf(data),
    text: escapeText(text),
    anchor: annotation.textAnchor,
  })
  return entities
}

/** R12 的标注：几何 + TEXT 平铺进模型空间（v1 现状，不许改）。 */
function emitAnnotation(data: DrawingData, annotation: DrawingAnnotation): EmitEntity[] {
  return annotationGraphics(data, annotation)
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
  if (entity.kind === 'dimension') {
    const points = [entity.defPoint, entity.textMidPoint, entity.firstPoint, entity.secondPoint]
    if (entity.oppositePoint !== null) points.push(entity.oppositePoint)
    return points
  }
  if (entity.kind === 'viewport') {
    return [
      { x: entity.cx - entity.widthMm / 2, y: entity.cy - entity.heightMm / 2 },
      { x: entity.cx + entity.widthMm / 2, y: entity.cy + entity.heightMm / 2 },
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

function normalize(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y)
  if (!(length > 0)) fail('INVALID_DRAWING', '标注引出线长度为 0，无法定位圆心')
  return { x: vector.x / length, y: vector.y / length }
}

/**
 * 把一个 DrawingAnnotation 变成真 DIMENSION 实体的字段。
 *
 * 所有数值都来自：
 *   · 数值文字/实测值 ← resolveDimension(parameterId, 快照)（模型真值，不写死）
 *   · 定义点 ← 既有 dimensionGeometryMm 换算到模型坐标
 */
function dimensionOf(
  data: DrawingData,
  annotation: DrawingAnnotation,
  blockName: string,
): EmitDimension {
  const resolved = resolveDimension(annotation.parameterId, data.parameterSnapshot)
  if (!resolved.ok) fail('INVALID_DRAWING', `标注数字无法解析：${resolved.message}`, annotation.annotationId)
  const geometry = annotation.dimensionGeometryMm
  if (geometry.lines.length === 0) fail('INVALID_DRAWING', `标注 ${annotation.annotationId} 没有几何`, annotation.annotationId)
  const textMidPoint = dxfPaperToModel(data, annotation.textPositionMm)
  const text = escapeText(dimensionText(resolved.value, annotation.kind).replace(/⌀/gu, '%%c'))
  const actualMeasurementMm = resolved.value.valueQ / 10000

  if (annotation.kind === 'diameter') {
    // 引出线第一段：从圆周点 p0 向外到肘点；圆心 = p0 − r·单位方向。
    const leader = geometry.lines[0]
    const p0: Point = { x: leader.x1, y: leader.y1 }
    const elbow: Point = { x: leader.x2, y: leader.y2 }
    const outward = normalize({ x: elbow.x - p0.x, y: elbow.y - p0.y })
    const radiusPaperMm = resolved.value.valueQ / 10000 / 2
    if (!(radiusPaperMm > 0)) fail('INVALID_DRAWING', `标注 ${annotation.annotationId} 半径非正`)
    const centerPaper: Point = { x: p0.x - outward.x * radiusPaperMm, y: p0.y - outward.y * radiusPaperMm }
    const oppositePaper: Point = { x: centerPaper.x - outward.x * radiusPaperMm, y: centerPaper.y - outward.y * radiusPaperMm }
    const firstPoint = dxfPaperToModel(data, p0)
    return {
      kind: 'dimension',
      layer: '尺寸',
      source: 'annotation',
      space: 'model',
      annotationId: annotation.annotationId,
      dimensionType: 3,
      blockName,
      dimStyle: DXF_DIM_STYLE_NAME,
      defPoint: firstPoint,
      textMidPoint,
      firstPoint,
      secondPoint: dxfPaperToModel(data, oppositePaper),
      oppositePoint: dxfPaperToModel(data, oppositePaper),
      // 直径标注的 50 是引出线角度；用引出线方向换算（纸面 y 向下 → 模型 y 向上取反）。
      angleDeg: (Math.atan2(-(elbow.y - p0.y), elbow.x - p0.x) * 180) / Math.PI,
      text,
      actualMeasurementMm,
      subclass: 'AcDbDiametricDimension',
    }
  }

  // 长度标注：lines[0]/lines[1] 是界线，lines[2] 是尺寸线。
  const dimensionLine = geometry.lines.find((line) => Math.abs(line.y1 - line.y2) < 1e-9) ?? geometry.lines[geometry.lines.length - 1]
  const defPointPaper: Point = {
    x: (dimensionLine.x1 + dimensionLine.x2) / 2,
    y: (dimensionLine.y1 + dimensionLine.y2) / 2,
  }
  const firstExtension = geometry.lines[0]
  const secondExtension = geometry.lines[1] ?? geometry.lines[0]
  const firstPoint = dxfPaperToModel(data, { x: firstExtension.x1, y: firstExtension.y1 })
  const secondPoint = dxfPaperToModel(data, { x: secondExtension.x1, y: secondExtension.y1 })
  return {
    kind: 'dimension',
    layer: '尺寸',
    source: 'annotation',
    space: 'model',
    annotationId: annotation.annotationId,
    dimensionType: 0,
    blockName,
    dimStyle: DXF_DIM_STYLE_NAME,
    defPoint: dxfPaperToModel(data, defPointPaper),
    textMidPoint,
    firstPoint,
    secondPoint,
    oppositePoint: null,
    angleDeg: 0,
    text,
    actualMeasurementMm,
    subclass: 'AcDbAlignedDimension',
  }
}

/** 图纸空间用的纸面→图纸空间点：图纸空间就是纸面 mm、y 向上、原点在纸左下角。 */
function paperSpacePoint(x: number, y: number): Point {
  return { x, y }
}

function sheetText(
  x: number,
  y: number,
  text: string,
  styleId: 'frame-text' | 'frame-text-strong' | 'sheet-status',
  layer: DxfLayerName,
  anchor: 'start' | 'middle' | 'end' = 'start',
): EmitText {
  const height = SHEET_TEXT_HEIGHT_MM[styleId]
  if (height === undefined) fail('INVALID_DRAWING', `未知文字样式：${styleId}`)
  return {
    kind: 'text',
    layer,
    source: 'sheet',
    space: 'paper',
    ...paperSpacePoint(x, y),
    height,
    text: escapeText(text),
    anchor,
  }
}

function sheetLine(x1: number, y1: number, x2: number, y2: number, layer: DxfLayerName = '图框'): EmitLine {
  return { kind: 'line', layer, source: 'sheet', space: 'paper', x1, y1, x2, y2 }
}

function sheetRect(
  rect: { x1: number; y1: number; x2: number; y2: number },
  layer: DxfLayerName = '图框',
): EmitPolyline {
  return {
    kind: 'polyline',
    layer,
    source: 'sheet',
    space: 'paper',
    points: [
      { x: rect.x1, y: rect.y1 },
      { x: rect.x2, y: rect.y1 },
      { x: rect.x2, y: rect.y2 },
      { x: rect.x1, y: rect.y2 },
      { x: rect.x1, y: rect.y1 },
    ],
  }
}

/** 标题栏「依据」栏：有 basis 就照抄（含文档名+页），没有就明确写不带外部原件。 */
export function sourceMarkerOf(data: DrawingData): string {
  const raw = typeof data.frame?.fields?.basis === 'string' ? data.frame.fields.basis.trim() : ''
  if (raw !== '') return raw.startsWith('依据：') ? raw : `依据：${raw}`
  // DrawingData 里没有来源字段（生成逻辑冻结），有来源项目到此只能写这句，不编文件名。
  return '依据：本图档未记录来源文档名/页'
}

/**
 * A3 图纸空间的图框 + 标题栏 + 技术要求区。
 * 全部是纸面 mm（图纸空间单位），**不乘 k**——比例由视口负责。
 */
function a3SheetEntities(data: DrawingData): EmitEntity[] {
  const fields = data.frame.fields
  const entities: EmitEntity[] = []

  // 图框：外框 + 标题栏 + 技术要求区。
  entities.push(sheetRect(A3_LAYOUT.frame))
  entities.push(sheetRect(A3_LAYOUT.title))
  entities.push(sheetRect(A3_LAYOUT.tech))

  const value = (key: string, fallback: string = MISSING_TEXT): string => {
    const text = typeof fields[key] === 'string' ? String(fields[key]).trim() : ''
    return text === '' ? fallback : text
  }
  const basisText = sourceMarkerOf(data).replace(/^依据：/u, '')

  const scaleText = `${data.scale.numerator}:${data.scale.denominator}`
  const rows: [string, string][] = [
    ['零件名', value('partName')],
    ['图号', value('drawingNumber')],
    ['版本', value('version')],
    ['材料', value('material')],
    ['公差/配合', value('tolerance')],
    ['表面要求', value('surface')],
    ['制图人/日期', `${value('drafter')} / ${value('date')}`],
    ['比例/单位', `${scaleText} · mm`],
    ['纸张/投影', `A3 横向 · ${value('projection', '第三角')}`],
    ['依据', basisText],
  ]

  const titleHeader = A3_LAYOUT.title.y2 - 6
  entities.push(sheetLine(A3_LAYOUT.title.x1, titleHeader, A3_LAYOUT.title.x2, titleHeader, '图框'))
  entities.push(sheetText(A3_LAYOUT.title.x1 + 2, titleHeader + 1.8, `寸链 · ${DRAFT_STATUS_TEXT}`, 'frame-text-strong', '图框'))
  const rowHeight = (titleHeader - A3_LAYOUT.title.y1) / rows.length
  rows.forEach(([label, text], index) => {
    const top = titleHeader - rowHeight * (index + 1)
    if (index > 0) entities.push(sheetLine(A3_LAYOUT.title.x1, top + rowHeight, A3_LAYOUT.title.x2, top + rowHeight, '图框'))
    const baseline = top + rowHeight * 0.72
    entities.push(sheetText(A3_LAYOUT.title.x1 + 2, baseline, label, 'frame-text', '图框'))
    entities.push(sheetText(A3_LAYOUT.title.x1 + 26, baseline, text, 'frame-text', '图框'))
  })

  // 技术要求区（文字层）。
  const techLines = [
    `技术要求 / 缺项`,
    '1. 本图为待复核草稿：未复核、未批准。',
    '2. 未注公差、配合与表面要求以标题栏为准，缺项写“待补充”。',
    '3. 不声明符合 GB/ISO 等制图标准。',
    '4. 单位 mm；比例作用于视口，模型空间是 1:1 真实尺寸。',
    `5. ${THIRD_ANGLE_PROJECTION.label}。`,
    `6. ${sourceMarkerOf(data)}。`,
  ]
  techLines.forEach((text, index) => {
    entities.push(
      sheetText(
        A3_LAYOUT.tech.x1 + 3,
        A3_LAYOUT.tech.y2 - 5 - index * 4.6,
        text,
        index === 0 ? 'frame-text-strong' : 'frame-text',
        '文字',
      ),
    )
  })

  // 状态条：图框下沿、两个块之间。
  entities.push(
    sheetText(210, 66, `${DRAFT_STATUS_TEXT} · 未复核、未批准`, 'sheet-status', '图框', 'middle'),
  )
  return entities
}

function viewportOf(data: DrawingData, viewCenterModel: Point): EmitViewport {
  const k = dxfScaleFactorOf(data)
  const { cx, cy, widthMm, heightMm } = A3_LAYOUT.viewport
  return {
    kind: 'viewport',
    layer: '图框',
    source: 'sheet',
    space: 'paper',
    cx,
    cy,
    widthMm,
    heightMm,
    viewCx: viewCenterModel.x,
    viewCy: viewCenterModel.y,
    // 45 = 模型视高 = 纸面视口高 × k；k=1 → 1:1，k=2 → 1:2。
    viewHeightMm: heightMm * k,
    id: 2,
    status: 2,
  }
}

interface Serializer {
  version: DxfVersion
  lines: string[]
  handle: number
  /** R12 不写句柄；2000 记模型/图纸空间的属主句柄。 */
  owners: { model: string; paper: string } | null
  /** 已写出的 VIEWPORT 实体句柄（LAYOUT 的 331 必须指向真实对象）。 */
  viewportHandles: string[]
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

function serializeDimension(state: Serializer, entity: EmitDimension): void {
  pair(state, 0, 'DIMENSION')
  const handle = nextHandle(state)
  if (handle !== null) pair(state, 5, handle)
  if (state.owners !== null) pair(state, 330, state.owners.model)
  pair(state, 100, 'AcDbEntity')
  pair(state, 8, entity.layer)
  pair(state, 100, 'AcDbDimension')
  pair(state, 2, entity.blockName)
  pair(state, 3, entity.dimStyle)
  pair(state, 10, number(entity.defPoint.x))
  pair(state, 20, number(entity.defPoint.y))
  pair(state, 30, '0')
  pair(state, 11, number(entity.textMidPoint.x))
  pair(state, 21, number(entity.textMidPoint.y))
  pair(state, 31, '0')
  // 70 低 4 位是标注类型，位 32 表示「几何块被本尺寸引用」→ 与 AutoCAD 写出的值一致。
  pair(state, 70, entity.dimensionType + 32)
  pair(state, 71, 5)
  pair(state, 1, entity.text)
  pair(state, 42, number(entity.actualMeasurementMm))
  pair(state, 100, entity.subclass)
  if (entity.oppositePoint !== null) {
    // 直径标注：10 是圆周上一点，15 是对侧点（与 ezdxf 参考样本一致，不写 13/14）。
    pair(state, 15, number(entity.oppositePoint.x))
    pair(state, 25, number(entity.oppositePoint.y))
    pair(state, 35, '0')
  } else {
    pair(state, 13, number(entity.firstPoint.x))
    pair(state, 23, number(entity.firstPoint.y))
    pair(state, 33, '0')
    pair(state, 14, number(entity.secondPoint.x))
    pair(state, 24, number(entity.secondPoint.y))
    pair(state, 34, '0')
    pair(state, 50, number(entity.angleDeg))
    pair(state, 100, 'AcDbRotatedDimension')
  }
}

function serializeViewport(state: Serializer, entity: EmitViewport): void {
  pair(state, 0, 'VIEWPORT')
  const handle = nextHandle(state)
  if (handle !== null) {
    pair(state, 5, handle)
    state.viewportHandles.push(handle)
  }
  if (state.owners !== null) pair(state, 330, state.owners.paper)
  pair(state, 100, 'AcDbEntity')
  pair(state, 67, 1)
  pair(state, 8, entity.layer)
  pair(state, 100, 'AcDbViewport')
  pair(state, 10, number(entity.cx))
  pair(state, 20, number(entity.cy))
  pair(state, 30, '0')
  // 40 = 视口宽（纸面 mm），41 = 视口高（纸面 mm）——见 research.md §3.2 的不对称视口实测。
  pair(state, 40, number(entity.widthMm))
  pair(state, 41, number(entity.heightMm))
  pair(state, 68, entity.status)
  pair(state, 69, entity.id)
  pair(state, 12, number(entity.viewCx))
  pair(state, 22, number(entity.viewCy))
  pair(state, 13, '0')
  pair(state, 23, '0')
  pair(state, 14, '10')
  pair(state, 24, '10')
  pair(state, 15, '10')
  pair(state, 25, '10')
  pair(state, 16, '0')
  pair(state, 26, '0')
  pair(state, 36, '1')
  pair(state, 17, '0')
  pair(state, 27, '0')
  pair(state, 37, '0')
  pair(state, 42, '50')
  pair(state, 43, '0')
  pair(state, 44, '0')
  // 45 = 模型视高；41/45 = 1/k。
  pair(state, 45, number(entity.viewHeightMm))
  pair(state, 50, '0')
  pair(state, 51, '0')
  pair(state, 72, '100')
  pair(state, 90, '0')
  pair(state, 1, '')
  pair(state, 281, '0')
  pair(state, 71, '0')
  pair(state, 74, '0')
  pair(state, 110, '0')
  pair(state, 120, '0')
  pair(state, 130, '0')
  pair(state, 111, '1')
  pair(state, 121, '0')
  pair(state, 131, '0')
  pair(state, 112, '0')
  pair(state, 122, '1')
  pair(state, 132, '0')
  pair(state, 79, '0')
  pair(state, 146, '0')
}

/**
 * R2000 的实体必须带子类标记（100），否则 ODA 系导入器（QCAD/AutoCAD 同源读取器）
 * 直接报 `Null object Id` 拒收整份文件——这是本次最容易踩的坑。
 * R12 不写 100（state.owners === null），保证 R12 字节不变。
 */
function subclass(state: Serializer, marker: string): void {
  if (state.owners !== null) pair(state, 100, marker)
}

function serializeEntity(state: Serializer, entity: EmitEntity): void {
  if (entity.kind === 'dimension') {
    serializeDimension(state, entity)
    return
  }
  if (entity.kind === 'viewport') {
    serializeViewport(state, entity)
    return
  }
  if (entity.kind === 'line') {
    pair(state, 0, 'LINE')
    const handle = nextHandle(state)
    if (handle !== null) pair(state, 5, handle)
    if (state.owners !== null) pair(state, 330, state.owners[entity.space === 'paper' ? 'paper' : 'model'])
    subclass(state, 'AcDbEntity')
    pair(state, 8, entity.layer)
    if (entity.space === 'paper') pair(state, 67, 1)
    if (entity.linetype !== undefined) pair(state, 6, entity.linetype)
    subclass(state, 'AcDbLine')
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
    if (state.owners !== null) pair(state, 330, state.owners[entity.space === 'paper' ? 'paper' : 'model'])
    subclass(state, 'AcDbEntity')
    pair(state, 8, entity.layer)
    if (entity.space === 'paper') pair(state, 67, 1)
    if (entity.linetype !== undefined) pair(state, 6, entity.linetype)
    subclass(state, 'AcDb2dPolyline')
    pair(state, 66, 1)
    pair(state, 70, 0)
    pair(state, 10, '0')
    pair(state, 20, '0')
    pair(state, 30, '0')
    for (const point of entity.points) {
      pair(state, 0, 'VERTEX')
      const vertexHandle = nextHandle(state)
      if (vertexHandle !== null) pair(state, 5, vertexHandle)
      // VERTEX/SEQEND 的属主是**这条 POLYLINE**，不是块记录。
      if (handle !== null) pair(state, 330, handle)
      subclass(state, 'AcDbEntity')
      // 图纸空间的折线，顶点也必须在图纸空间（67=1），否则会被归到模型空间。
      if (entity.space === 'paper') pair(state, 67, 1)
      pair(state, 8, entity.layer)
      subclass(state, 'AcDbVertex')
      subclass(state, 'AcDb2dVertex')
      pair(state, 10, number(point.x))
      pair(state, 20, number(point.y))
      pair(state, 30, '0')
      pair(state, 70, 0)
    }
    pair(state, 0, 'SEQEND')
    const endHandle = nextHandle(state)
    if (endHandle !== null) pair(state, 5, endHandle)
    if (handle !== null) pair(state, 330, handle)
    subclass(state, 'AcDbEntity')
    if (entity.space === 'paper') pair(state, 67, 1)
    pair(state, 8, entity.layer)
    return
  }
  if (entity.kind === 'circle') {
    pair(state, 0, 'CIRCLE')
    const handle = nextHandle(state)
    if (handle !== null) pair(state, 5, handle)
    if (state.owners !== null) pair(state, 330, state.owners[entity.space === 'paper' ? 'paper' : 'model'])
    subclass(state, 'AcDbEntity')
    pair(state, 8, entity.layer)
    if (entity.space === 'paper') pair(state, 67, 1)
    if (entity.linetype !== undefined) pair(state, 6, entity.linetype)
    subclass(state, 'AcDbCircle')
    pair(state, 10, number(entity.cx))
    pair(state, 20, number(entity.cy))
    pair(state, 30, '0')
    pair(state, 40, number(entity.r))
    return
  }
  pair(state, 0, 'TEXT')
  const handle = nextHandle(state)
  if (handle !== null) pair(state, 5, handle)
  if (state.owners !== null) pair(state, 330, state.owners[entity.space === 'paper' ? 'paper' : 'model'])
  subclass(state, 'AcDbEntity')
  pair(state, 8, entity.layer)
  if (entity.space === 'paper') pair(state, 67, 1)
  subclass(state, 'AcDbText')
  pair(state, 10, number(entity.x))
  pair(state, 20, number(entity.y))
  pair(state, 30, '0')
  pair(state, 40, number(entity.height))
  pair(state, 1, entity.text)
  pair(state, 50, '0')
  pair(state, 7, DXF_TEXT_STYLE_NAME)
  pair(state, 72, entity.anchor === 'start' ? 0 : entity.anchor === 'middle' ? 1 : 2)
  pair(state, 11, number(entity.x))
  pair(state, 21, number(entity.y))
  pair(state, 31, '0')
  // AutoCAD 在 73 之前再写一次 AcDbText 子类标记。
  subclass(state, 'AcDbText')
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

/**
 * 布局/图纸空间锚点：2000 才有。
 * name 是块记录名（*Model_Space/*Paper_Space/*D1…），handle 由调用方回填。
 */
interface BlockRecordPlan {
  name: string
  /** 匿名标注块用 1。 */
  flag: 0 | 1
  handle: string
}

/** 构建完整 DXF（文本 + GBK 字节）。任何非法输入抛 DxfExportError，不产生半截文件。 */
export function buildDxfDocument(data: DrawingData, version: DxfVersion): DxfBuildResult {
  if (!DXF_VERSIONS.includes(version)) {
    fail('UNSUPPORTED_VERSION', `不支持的 DXF 版本：${String(version)}`)
  }
  assertDrawing(data)
  const layoutV2 = version === '2000'

  // 模型空间实体：R12 = 全部图元 + 标注「几何+TEXT」；2000 = 只有绘图区图元 + 真 DIMENSION。
  const entities: EmitEntity[] = []
  let outlinePoints: { x: number; y: number }[] = []
  for (const primitive of data.primitives) {
    // 2000 的图框/标题栏进图纸空间（A3 版式），不再按 A4 纸面放进模型空间。
    if (layoutV2 && primitive.area === 'sheet') continue
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

  const blocks: EmitBlock[] = []
  if (layoutV2) {
    data.annotations.forEach((annotation, index) => {
      const blockName = `*D${index + 1}`
      blocks.push({ name: blockName, flag: 1, entities: annotationGraphics(data, annotation) })
      entities.push(dimensionOf(data, annotation, blockName))
    })
  } else {
    for (const annotation of data.annotations) {
      entities.push(...emitAnnotation(data, annotation))
    }
  }

  const counts: DxfEntityCounts = { line: 0, polyline: 0, vertex: 0, circle: 0, text: 0, dimension: 0, viewport: 0 }
  let geometry: DxfBounds | null = null
  let all: DxfBounds | null = null
  for (const entity of entities) {
    if (entity.kind === 'line') counts.line += 1
    else if (entity.kind === 'polyline') {
      counts.polyline += 1
      counts.vertex += entity.points.length
    } else if (entity.kind === 'circle') counts.circle += 1
    else if (entity.kind === 'dimension') counts.dimension += 1
    else if (entity.kind === 'viewport') counts.viewport += 1
    else counts.text += 1
    if (entity.kind !== 'text' && entity.kind !== 'viewport' && entity.kind !== 'dimension') {
      geometry = unionBounds(geometry, boundsOf(pointsOf(entity)))
    }
    all = unionBounds(all, boundsOf(pointsOf(entity)))
  }
  if (geometry === null) fail('INVALID_DRAWING', '图纸没有可导出的几何')
  if (outlinePoints.length === 0) fail('INVALID_DRAWING', '图纸缺少主视图轮廓（axial.outline）')
  const drawingOutlineBounds = boundsOf(outlinePoints)
  if (drawingOutlineBounds === null) fail('INVALID_DRAWING', '主视图轮廓没有顶点')

  // 2000：图纸空间实体（A3 图框/标题栏/技术要求/视口）。
  let paperEntities: EmitEntity[] = []
  let viewportSummary: DxfViewportSummary | null = null
  if (layoutV2) {
    const viewCenterModel: Point = {
      x: (drawingOutlineBounds.minX + drawingOutlineBounds.maxX) / 2,
      y: (drawingOutlineBounds.minY + drawingOutlineBounds.maxY) / 2,
    }
    const viewport = viewportOf(data, viewCenterModel)
    paperEntities = [...a3SheetEntities(data), viewport]
    viewportSummary = {
      centerMm: { x: viewport.cx, y: viewport.cy },
      widthMm: viewport.widthMm,
      heightMm: viewport.heightMm,
      viewHeightMm: viewport.viewHeightMm,
      viewCenter: viewCenterModel,
      paperPerModel: viewport.heightMm / viewport.viewHeightMm,
    }
  }

  const acadVersion = DXF_ACAD_VERSION[version]
  const scale = dxfScaleFactorOf(data)
  const paperWidth = data.paper.widthMm * scale
  const paperHeight = data.paper.heightMm * scale
  const pattern = dashPattern(data)
  const state: Serializer = { version, lines: [], handle: 0, owners: null, viewportHandles: [] }

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
  // 2000 的标注图形在匿名块里，几何包围盒只算画出来的图元；图纸范围用含标注点的 entityBounds，
  // 否则 ZOOM EXTENTS 会把标注切掉。R12 维持原样（几何包围盒），保证字节不变。
  const extent = layoutV2 ? (all as DxfBounds) : geometry
  pair(state, 9, '$EXTMIN')
  pair(state, 10, number(extent.minX))
  pair(state, 20, number(extent.minY))
  pair(state, 30, '0')
  pair(state, 9, '$EXTMAX')
  pair(state, 10, number(extent.maxX))
  pair(state, 20, number(extent.maxY))
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
  pair(state, 7, DXF_TEXT_STYLE_NAME)
  pair(state, 9, '$MEASUREMENT')
  pair(state, 70, 1)
  if (version === '2000') {
    pair(state, 9, '$INSUNITS')
    pair(state, 70, 4)
    // 打开图纸空间（0=只在图纸空间？不，TILEMODE 0 表示图纸空间布局可见）。
    pair(state, 9, '$TILEMODE')
    pair(state, 70, 0)
    pair(state, 9, '$DIMSTYLE')
    pair(state, 2, DXF_DIM_STYLE_NAME)
    pair(state, 9, '$PLIMMIN')
    pair(state, 10, '0')
    pair(state, 20, '0')
    pair(state, 9, '$PLIMMAX')
    pair(state, 10, number(DXF_SHEET_A3.widthMm))
    pair(state, 20, number(DXF_SHEET_A3.heightMm))
    pair(state, 9, '$PEXTMIN')
    pair(state, 10, number(A3_LAYOUT.frame.x1))
    pair(state, 20, number(A3_LAYOUT.frame.y1))
    pair(state, 30, '0')
    pair(state, 9, '$PEXTMAX')
    pair(state, 10, number(A3_LAYOUT.frame.x2))
    pair(state, 20, number(A3_LAYOUT.frame.y2))
    pair(state, 30, '0')
    // 本版句柄空间远小于 0xFFFF，够用且不需要先数实体。
    pair(state, 9, '$HANDSEED')
    pair(state, 5, 'FFFF')
  }
  pair(state, 0, 'ENDSEC')

  // TABLES（VPORT(2000) / LTYPE / LAYER / STYLE / VIEW+UCS(2000) / APPID / DIMSTYLE(2000) / BLOCK_RECORD(2000)）
  pair(state, 0, 'SECTION')
  pair(state, 2, 'TABLES')

  // VPORT（2000）：R2000 文件必须有活动视口记录 *Active，否则 ODA 系导入器报 Null object Id。
  if (layoutV2) {
    pair(state, 0, 'TABLE')
    pair(state, 2, 'VPORT')
    const vportTableHandle = nextHandle(state)
    if (vportTableHandle !== null) pair(state, 5, vportTableHandle)
    pair(state, 330, '0')
    pair(state, 100, 'AcDbSymbolTable')
    pair(state, 70, 1)
    pair(state, 0, 'VPORT')
    const vportHandle = nextHandle(state)
    if (vportHandle !== null) pair(state, 5, vportHandle)
    if (vportTableHandle !== null) pair(state, 330, vportTableHandle)
    pair(state, 100, 'AcDbSymbolTableRecord')
    pair(state, 100, 'AcDbViewportTableRecord')
    pair(state, 2, '*Active')
    pair(state, 70, 0)
    pair(state, 10, '0')
    pair(state, 20, '0')
    pair(state, 11, '1')
    pair(state, 21, '1')
    pair(state, 12, '0')
    pair(state, 22, '0')
    pair(state, 13, '0')
    pair(state, 23, '0')
    pair(state, 14, '0.5')
    pair(state, 24, '0.5')
    pair(state, 15, '0.5')
    pair(state, 25, '0.5')
    pair(state, 16, '0')
    pair(state, 26, '0')
    pair(state, 36, '1')
    pair(state, 17, '0')
    pair(state, 27, '0')
    pair(state, 37, '0')
    // VPORT 的 40=视高、41=宽高比（注意与图纸空间 VIEWPORT 实体的 40/41 语义不同）。
    pair(state, 40, number(DXF_SHEET_A3.heightMm))
    pair(state, 41, number(DXF_SHEET_A3.widthMm / DXF_SHEET_A3.heightMm))
    pair(state, 42, '50')
    pair(state, 43, '0')
    pair(state, 44, '0')
    pair(state, 50, '0')
    pair(state, 51, '0')
    pair(state, 71, 0)
    pair(state, 72, 1000)
    pair(state, 73, 1)
    pair(state, 74, 3)
    pair(state, 75, 0)
    pair(state, 76, 0)
    pair(state, 77, 0)
    pair(state, 78, 0)
    pair(state, 0, 'ENDTAB')
  }

  pair(state, 0, 'TABLE')
  pair(state, 2, 'LTYPE')
  const ltypeTableHandle = nextHandle(state)
  if (ltypeTableHandle !== null) pair(state, 5, ltypeTableHandle)
  if (state.version === '2000') {
    pair(state, 330, '0')
    pair(state, 100, 'AcDbSymbolTable')
  }
  pair(state, 70, 3)
  pair(state, 0, 'LTYPE')
  const continuousHandle = nextHandle(state)
  if (continuousHandle !== null) pair(state, 5, continuousHandle)
  if (state.version === '2000' && ltypeTableHandle !== null) {
    pair(state, 330, ltypeTableHandle)
    pair(state, 100, 'AcDbSymbolTableRecord')
    pair(state, 100, 'AcDbLinetypeTableRecord')
  }
  for (const [code, value] of ltypePattern('CONTINUOUS', 'Solid line', [])) {
    if (code === 0) continue
    pair(state, code, value)
  }
  pair(state, 0, 'LTYPE')
  const centerHandle = nextHandle(state)
  if (centerHandle !== null) pair(state, 5, centerHandle)
  if (state.version === '2000' && ltypeTableHandle !== null) {
    pair(state, 330, ltypeTableHandle)
    pair(state, 100, 'AcDbSymbolTableRecord')
    pair(state, 100, 'AcDbLinetypeTableRecord')
  }
  for (const [code, value] of ltypePattern('CENTER', 'Center ____ _ ____', pattern.center)) {
    if (code === 0) continue
    pair(state, code, value)
  }
  pair(state, 0, 'LTYPE')
  const dashedHandle = nextHandle(state)
  if (dashedHandle !== null) pair(state, 5, dashedHandle)
  if (state.version === '2000' && ltypeTableHandle !== null) {
    pair(state, 330, ltypeTableHandle)
    pair(state, 100, 'AcDbSymbolTableRecord')
    pair(state, 100, 'AcDbLinetypeTableRecord')
  }
  for (const [code, value] of ltypePattern('DASHED', 'Dashed __ __', pattern.dashed)) {
    if (code === 0) continue
    pair(state, code, value)
  }
  pair(state, 0, 'ENDTAB')

  pair(state, 0, 'TABLE')
  pair(state, 2, 'LAYER')
  const layerTableHandle = nextHandle(state)
  if (layerTableHandle !== null) pair(state, 5, layerTableHandle)
  if (state.version === '2000') {
    pair(state, 330, '0')
    pair(state, 100, 'AcDbSymbolTable')
  }
  pair(state, 70, DXF_LAYERS.length)
  for (const layer of DXF_LAYERS) {
    pair(state, 0, 'LAYER')
    const layerHandle = nextHandle(state)
    if (layerHandle !== null) pair(state, 5, layerHandle)
    if (state.version === '2000' && layerTableHandle !== null) {
      pair(state, 330, layerTableHandle)
      pair(state, 100, 'AcDbSymbolTableRecord')
      pair(state, 100, 'AcDbLayerTableRecord')
    }
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
  if (state.version === '2000') {
    pair(state, 330, '0')
    pair(state, 100, 'AcDbSymbolTable')
  }
  pair(state, 70, 1)
  pair(state, 0, 'STYLE')
  const styleHandle = nextHandle(state)
  if (styleHandle !== null) pair(state, 5, styleHandle)
  if (state.version === '2000' && styleTableHandle !== null) {
    pair(state, 330, styleTableHandle)
    pair(state, 100, 'AcDbSymbolTableRecord')
    pair(state, 100, 'AcDbTextStyleTableRecord')
  }
  pair(state, 2, DXF_TEXT_STYLE_NAME)
  pair(state, 70, 0)
  pair(state, 40, 0)
  pair(state, 41, 1)
  pair(state, 50, 0)
  pair(state, 71, 0)
  pair(state, 42, 2.5)
  pair(state, 3, 'txt.shx')
  pair(state, 4, 'hztxt.shx')
  pair(state, 0, 'ENDTAB')

  // DIMSTYLE（2000）：DIMENSION 实体用组码 3 引用；不写这表 AutoCAD 会回退 Standard。
  if (layoutV2) {
    const k = dxfScaleFactorOf(data)
    pair(state, 0, 'TABLE')
    pair(state, 2, 'DIMSTYLE')
    const dimStyleTableHandle = nextHandle(state)
    if (dimStyleTableHandle !== null) pair(state, 5, dimStyleTableHandle)
    if (state.version === '2000') {
      pair(state, 330, '0')
      pair(state, 100, 'AcDbSymbolTable')
    }
    pair(state, 70, 1)
    pair(state, 0, 'DIMSTYLE')
    // DIMSTYLE 的句柄组码是 105（不是 5）——DXF 的历史坑，见 research.md §1.4。
    const dimStyleHandle = nextHandle(state)
    if (dimStyleHandle !== null) pair(state, 105, dimStyleHandle)
    if (dimStyleTableHandle !== null) {
      pair(state, 330, dimStyleTableHandle)
      pair(state, 100, 'AcDbSymbolTableRecord')
      pair(state, 100, 'AcDbDimStyleTableRecord')
    }
    pair(state, 2, DXF_DIM_STYLE_NAME)
    pair(state, 70, 0)
    pair(state, 3, '')
    pair(state, 4, '')
    // 40=DIMSCALE（标注整体缩放，随图纸比例），41=DIMASZ 箭头，42=DIMEXO，44=DIMEXE，140=DIMTXT。
    pair(state, 40, number(k))
    pair(state, 41, number(data.styles.arrow.lengthMm))
    pair(state, 42, '0.625')
    pair(state, 44, number(data.styles.arrow.lengthMm / 2))
    pair(state, 140, number(data.styles.fontSizeMm))
    pair(state, 147, '0.625')
    pair(state, 77, 1)
    pair(state, 78, 8)
    pair(state, 271, 3)
    pair(state, 278, 44)
    pair(state, 340, styleHandle ?? '0')
    pair(state, 0, 'ENDTAB')
  }

  // BLOCK_RECORD（2000）：*Model_Space / *Paper_Space / 匿名标注块。
  const blockRecords: BlockRecordPlan[] = []
  if (layoutV2) {
    pair(state, 0, 'TABLE')
    pair(state, 2, 'BLOCK_RECORD')
    const blockRecordTableHandle = nextHandle(state)
    if (blockRecordTableHandle !== null) pair(state, 5, blockRecordTableHandle)
    pair(state, 330, '0')
    pair(state, 100, 'AcDbSymbolTable')
    pair(state, 70, 2 + blocks.length)
    for (const name of ['*Model_Space', '*Paper_Space']) blockRecords.push({ name, flag: 0, handle: '' })
    for (const block of blocks) blockRecords.push({ name: block.name, flag: 1, handle: '' })
    for (const record of blockRecords) {
      record.handle = nextHandle(state) as string
      pair(state, 0, 'BLOCK_RECORD')
      pair(state, 5, record.handle)
      if (blockRecordTableHandle !== null) pair(state, 330, blockRecordTableHandle)
      pair(state, 100, 'AcDbSymbolTableRecord')
      pair(state, 100, 'AcDbBlockTableRecord')
      pair(state, 2, record.name)
    }
    pair(state, 0, 'ENDTAB')
  }

  pair(state, 0, 'TABLE')
  pair(state, 2, 'APPID')
  const appidTableHandle = nextHandle(state)
  if (appidTableHandle !== null) pair(state, 5, appidTableHandle)
  if (state.version === '2000') {
    pair(state, 330, '0')
    pair(state, 100, 'AcDbSymbolTable')
  }
  pair(state, 70, 1)
  pair(state, 0, 'APPID')
  const appidHandle = nextHandle(state)
  if (appidHandle !== null) pair(state, 5, appidHandle)
  if (state.version === '2000' && appidTableHandle !== null) {
    pair(state, 330, appidTableHandle)
    pair(state, 100, 'AcDbSymbolTableRecord')
    pair(state, 100, 'AcDbRegAppTableRecord')
  }
  pair(state, 2, 'ACAD')
  pair(state, 70, 0)
  pair(state, 0, 'ENDTAB')

  pair(state, 0, 'ENDSEC')

  // 2000：模型/图纸空间的属主句柄（实体 330 用）。
  let modelRecord = '0'
  let paperRecord = '0'
  if (layoutV2) {
    modelRecord = blockRecords.find((record) => record.name === '*Model_Space')?.handle ?? '0'
    paperRecord = blockRecords.find((record) => record.name === '*Paper_Space')?.handle ?? '0'
    state.owners = { model: modelRecord, paper: paperRecord }
  }

  // BLOCKS：R12 = 空表（现状）；2000 = *Model_Space / *Paper_Space / 匿名标注块。
  pair(state, 0, 'SECTION')
  pair(state, 2, 'BLOCKS')
  if (layoutV2) {
    const emitBlock = (record: BlockRecordPlan, body: EmitEntity[]): void => {
      pair(state, 0, 'BLOCK')
      const blockHandle = nextHandle(state)
      if (blockHandle !== null) pair(state, 5, blockHandle)
      pair(state, 330, record.handle)
      pair(state, 100, 'AcDbEntity')
      pair(state, 8, '0')
      pair(state, 100, 'AcDbBlockBegin')
      pair(state, 2, record.name)
      pair(state, 70, record.flag)
      pair(state, 10, '0')
      pair(state, 20, '0')
      pair(state, 30, '0')
      pair(state, 3, record.name)
      pair(state, 1, '')
      // 块内实体的属主必须是**这个块的 BLOCK_RECORD**，不是模型空间；
      // 写错会让导入器报 Null object Id / Invalid index（实测 QCAD 3.33.1 直接拒收）。
      const savedOwners = state.owners
      state.owners = { model: record.handle, paper: record.handle }
      for (const entity of body) serializeEntity(state, entity)
      state.owners = savedOwners
      pair(state, 0, 'ENDBLK')
      const endHandle = nextHandle(state)
      if (endHandle !== null) pair(state, 5, endHandle)
      pair(state, 330, record.handle)
      pair(state, 100, 'AcDbEntity')
      pair(state, 8, '0')
      pair(state, 100, 'AcDbBlockEnd')
    }
    emitBlock(blockRecords[0], [])
    emitBlock(blockRecords[1], [])
    blocks.forEach((block, index) => {
      emitBlock(blockRecords[2 + index], block.entities)
    })
  }
  pair(state, 0, 'ENDSEC')

  pair(state, 0, 'SECTION')
  pair(state, 2, 'ENTITIES')
  for (const entity of entities) serializeEntity(state, entity)
  for (const entity of paperEntities) serializeEntity(state, entity)
  pair(state, 0, 'ENDSEC')

  // OBJECTS（2000）：根字典 + ACAD_LAYOUT + LAYOUT 对象（A3 420×297、视口）。
  if (layoutV2) {
    pair(state, 0, 'SECTION')
    pair(state, 2, 'OBJECTS')
    const rootHandle = nextHandle(state) as string
    const layoutDictHandle = nextHandle(state) as string
    const modelLayoutHandle = nextHandle(state) as string
    const paperLayoutHandle = nextHandle(state) as string
    // 331 必须指向真实的 VIEWPORT 实体：用写出时记下的句柄，不能另分配一个。
    const viewportHandles = [...state.viewportHandles]

    // 根字典
    pair(state, 0, 'DICTIONARY')
    pair(state, 5, rootHandle)
    pair(state, 330, '0')
    pair(state, 100, 'AcDbDictionary')
    pair(state, 281, 1)
    pair(state, 3, 'ACAD_LAYOUT')
    pair(state, 350, layoutDictHandle)
    // ACAD_LAYOUT 字典
    pair(state, 0, 'DICTIONARY')
    pair(state, 5, layoutDictHandle)
    pair(state, 330, rootHandle)
    pair(state, 100, 'AcDbDictionary')
    pair(state, 281, 1)
    pair(state, 3, 'Model')
    pair(state, 350, modelLayoutHandle)
    pair(state, 3, 'Layout1')
    pair(state, 350, paperLayoutHandle)

    const layoutObject = (
      handle: string,
      name: string,
      tabOrder: number,
      blockRecordHandle: string,
      viewportHandles: string[],
    ): void => {
      pair(state, 0, 'LAYOUT')
      pair(state, 5, handle)
      pair(state, 330, layoutDictHandle)
      pair(state, 100, 'AcDbPlotSettings')
      pair(state, 1, '')
      pair(state, 4, 'A3')
      pair(state, 6, '')
      pair(state, 40, '0')
      pair(state, 41, '0')
      pair(state, 42, '0')
      pair(state, 43, '0')
      // 44/45 = 纸张宽/高（mm）。
      pair(state, 44, number(DXF_SHEET_A3.widthMm))
      pair(state, 45, number(DXF_SHEET_A3.heightMm))
      pair(state, 46, '0')
      pair(state, 47, '0')
      pair(state, 48, '0')
      pair(state, 49, '0')
      pair(state, 140, '0')
      pair(state, 141, '0')
      pair(state, 142, '1')
      pair(state, 143, '1')
      pair(state, 70, 688)
      pair(state, 72, '1')
      pair(state, 73, '0')
      pair(state, 74, '5')
      pair(state, 7, '')
      pair(state, 75, '16')
      pair(state, 76, '0')
      pair(state, 77, '2')
      pair(state, 78, '300')
      pair(state, 147, '1')
      pair(state, 148, '0')
      pair(state, 149, '0')
      pair(state, 100, 'AcDbLayout')
      pair(state, 1, name)
      pair(state, 70, 1)
      pair(state, 71, tabOrder)
      pair(state, 10, '0')
      pair(state, 20, '0')
      pair(state, 11, number(DXF_SHEET_A3.widthMm))
      pair(state, 21, number(DXF_SHEET_A3.heightMm))
      pair(state, 12, '0')
      pair(state, 22, '0')
      pair(state, 32, '0')
      pair(state, 14, '1e+20')
      pair(state, 24, '1e+20')
      pair(state, 34, '1e+20')
      pair(state, 15, '-1e+20')
      pair(state, 25, '-1e+20')
      pair(state, 35, '-1e+20')
      pair(state, 146, '0')
      pair(state, 13, '0')
      pair(state, 23, '0')
      pair(state, 33, '0')
      pair(state, 16, '1')
      pair(state, 26, '0')
      pair(state, 36, '0')
      pair(state, 17, '0')
      pair(state, 27, '1')
      pair(state, 37, '0')
      pair(state, 76, viewportHandles.length)
      pair(state, 330, blockRecordHandle)
      for (const handle of viewportHandles) pair(state, 331, handle)
    }

    layoutObject(modelLayoutHandle, 'Model', 0, modelRecord, [])
    layoutObject(paperLayoutHandle, 'Layout1', 1, paperRecord, viewportHandles)

    pair(state, 0, 'ENDSEC')
  }

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

  const dimensions: DxfDimensionSummary[] = entities
    .filter((entity): entity is EmitDimension => entity.kind === 'dimension')
    .map((entity) => ({
      annotationId: entity.annotationId,
      dimensionType: entity.dimensionType,
      blockName: entity.blockName,
      dimStyle: entity.dimStyle,
      actualMeasurementMm: entity.actualMeasurementMm,
      text: entity.text,
      defPoint: entity.defPoint,
      textMidPoint: entity.textMidPoint,
      firstPoint: entity.firstPoint,
      secondPoint: entity.secondPoint,
      subclass: entity.subclass,
    }))

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
    sheet: layoutV2
      ? { widthMm: DXF_SHEET_A3.widthMm, heightMm: DXF_SHEET_A3.heightMm, space: 'layout' }
      : { widthMm: data.paper.widthMm, heightMm: data.paper.heightMm, space: 'model' },
    dimensions,
    viewport: viewportSummary,
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
    // R12 没有 DIMENSION / LAYOUT / VIEWPORT 结构，出现即回归。
    for (const token of ['DIMENSION', 'LAYOUT', 'VIEWPORT', 'BLOCK_RECORD']) {
      if (text.includes(token)) errors.push(`R12 文件出现 2000 专属结构：${token}`)
    }
  } else {
    for (const token of ['DIMSTYLE', 'BLOCK_RECORD', 'LAYOUT', 'VIEWPORT', 'DIMENSION']) {
      if (!text.includes(token)) errors.push(`2000 版缺少结构：${token}`)
    }
  }
  if (!text.trimEnd().endsWith('EOF')) errors.push('文件没有以 EOF 结束')
  return { ok: errors.length === 0, errors }
}
