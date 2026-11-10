/**
 * 隔套工程图数据结构（V3-C-01/C-02）。
 *
 * 这里是唯一图纸数据形状：纯可序列化数据，不含 DOM、React、Electron、three
 * 对象或任何可执行字符串。预览、SVG 导出、PDF 打印页都只消费 DrawingData，
 * 不各自再画一套线。
 *
 * 坐标约定：纸面毫米，左上原点，x 向右、y 向下（任务卡 §5.1）。
 * 模型真值始终是整数 q；mm 只在下游几何/显示时换算，不写回参数。
 */
import type { Q } from '../domain/types'

export const DRAWING_DATA_VERSION = 1

export const SPACER_TEMPLATE_ID = 'spacer-a4-landscape' as const
export const SPACER_TEMPLATE_VERSION = 1
export const SPACER_PART_ID = 'builtin:shaft-demo:spacer' as const

export const SPACER_PARAMETER_KEYS = ['innerDiameter', 'outerDiameter', 'length'] as const
export type SpacerParameterKey = (typeof SPACER_PARAMETER_KEYS)[number]

/** 参数 ID 是注册常量，不由数组下标或本地化名称派生。 */
export const SPACER_PARAMETER_IDS: Record<SpacerParameterKey, string> = {
  innerDiameter: 'param:spacer:inner-diameter',
  outerDiameter: 'param:spacer:outer-diameter',
  length: 'param:spacer:length',
}

export const SPACER_PARAMETER_LABELS: Record<SpacerParameterKey, string> = {
  innerDiameter: '内径',
  outerDiameter: '外径',
  length: '长度',
}

export type ParameterReviewStatus = 'draft' | 'pending' | 'confirmed'

/** 生成时的模型参数冻结副本；不是可独立编辑的第二份真源。 */
export interface ParameterSnapshotItem {
  parameterId: string
  partId: string
  key: SpacerParameterKey
  valueQ: Q
  /** 输入小数位数（含尾零），0..4。所有视图共用。 */
  inputDecimals: number
  reviewStatus: ParameterReviewStatus
  /** 来源备注，可选；空字符串不持久化。 */
  sourceNote?: string
}

export interface DrawingScale {
  numerator: number
  denominator: number
}

/** C 首版只允许这五个比例；默认 1:1。 */
export const DRAWING_SCALES: readonly DrawingScale[] = [
  { numerator: 2, denominator: 1 },
  { numerator: 1, denominator: 1 },
  { numerator: 1, denominator: 2 },
  { numerator: 1, denominator: 5 },
  { numerator: 1, denominator: 10 },
]

export const DEFAULT_DRAWING_SCALE: DrawingScale = { numerator: 1, denominator: 1 }

export function scaleKey(scale: DrawingScale): string {
  return `${scale.numerator}:${scale.denominator}`
}

export function isAllowedScale(scale: DrawingScale): boolean {
  return DRAWING_SCALES.some(
    (item) => item.numerator === scale.numerator && item.denominator === scale.denominator,
  )
}

export function parseScaleKey(key: string): DrawingScale | null {
  const found = DRAWING_SCALES.find((item) => scaleKey(item) === key)
  return found === undefined ? null : { ...found }
}

export interface PaperSize {
  format: 'A4'
  orientation: 'landscape'
  widthMm: 297
  heightMm: 210
}

export const A4_LANDSCAPE: PaperSize = {
  format: 'A4',
  orientation: 'landscape',
  widthMm: 297,
  heightMm: 210,
}

export interface ProjectionConvention {
  convention: 'third-angle'
  label: '第三角投影：右端视图置于主视图右侧'
}

export const THIRD_ANGLE_PROJECTION: ProjectionConvention = {
  convention: 'third-angle',
  label: '第三角投影：右端视图置于主视图右侧',
}

export type Point = { x: number; y: number }

export interface LineGeometry {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface CircleGeometry {
  cx: number
  cy: number
  r: number
}

export interface PolylineGeometry {
  points: Point[]
}

export interface TextGeometry {
  x: number
  y: number
  text: string
  anchor: 'start' | 'middle' | 'end'
  /** 明确基线，不依赖浏览器默认值。 */
  baseline: 'alphabetic'
}

export type PrimitiveKind = 'line' | 'circle' | 'polyline' | 'text'

export interface DrawingPrimitive {
  primitiveId: string
  viewId?: string
  kind: PrimitiveKind
  geometryMm: LineGeometry | CircleGeometry | PolylineGeometry | TextGeometry
  styleId: string
  /** sheet=图框/标题栏，drawing=视图可用区；容纳检查只看 drawing。 */
  area: 'sheet' | 'drawing'
}

export type AnnotationKind = 'diameter' | 'length'

export interface DimensionArrow {
  at: Point
  /** 箭头指向角度（度，纸面坐标，0=+x，顺时针为正）。 */
  angleDeg: number
}

export interface DimensionGeometry {
  /** 尺寸线、界线、引出线；按顺序绘制，线宽取 dim 样式。 */
  lines: LineGeometry[]
  /** 每条尺寸线/引出线的箭头端点；渲染为固定纸面大小箭头。 */
  arrows: DimensionArrow[]
}

export interface DrawingAnnotation {
  annotationId: string
  parameterId: string
  viewId: string
  kind: AnnotationKind
  /** 尺寸几何只描述线/箭头位置；数字永远由 parameterId + 快照解析。 */
  dimensionGeometryMm: DimensionGeometry
  textPositionMm: Point
  textAnchor: 'start' | 'middle' | 'end'
  styleId: string
}

export interface DrawingView {
  viewId: string
  kind: 'axial' | 'right-end'
  anchorMm: Point
  /** 模型 mm → 纸面 mm 的缩放系数（仅视图几何）。 */
  scaleFactor: number
  primitiveIds: string[]
}

export interface DrawingStyles {
  fontId: 'noto-sans-sc-cunlian'
  fontSizeMm: 3.5
  lineWidthsMm: {
    frame: 0.5
    outline: 0.5
    center: 0.25
    hidden: 0.25
    dim: 0.25
  }
  dashPatternsMm: {
    center: number[]
    hidden: number[]
  }
  arrow: {
    lengthMm: 2.5
    widthMm: 0.8
  }
}

export const DRAWING_STYLES: DrawingStyles = {
  fontId: 'noto-sans-sc-cunlian',
  fontSizeMm: 3.5,
  lineWidthsMm: { frame: 0.5, outline: 0.5, center: 0.25, hidden: 0.25, dim: 0.25 },
  dashPatternsMm: { center: [12, 3, 2, 3], hidden: [3, 2] },
  arrow: { lengthMm: 2.5, widthMm: 0.8 },
}

/** 标题栏/技术要求区的技术字段；空值统一按“待补充”，不伪造。 */
export interface DrawingFrameFields {
  partName: string
  drawingNumber: string
  version: string
  material: string
  tolerance: string
  surface: string
  drafter: string
  date: string
}

export interface DrawingFrame {
  borderMm: LineGeometry
  cells: DrawingPrimitive[]
  fields: Record<string, string>
  missingFields: string[]
  status: 'pending-review-draft'
}

export interface DrawingLayout {
  drawableRectMm: LineGeometry
  occupiedBoundsMm: { minX: number; minY: number; maxX: number; maxY: number }
  fits: boolean
  conflicts: string[]
}

export interface DrawingModelRef {
  kind: 'parametric-spacer'
  modelRevisionId: string
  /** 参数快照的稳定哈希；用于证明图纸与参数同源。 */
  parameterFingerprint: string
}

export interface DrawingData {
  drawingDataVersion: typeof DRAWING_DATA_VERSION
  drawingId: string
  projectId: string
  revisionId: string
  partId: string
  templateId: typeof SPACER_TEMPLATE_ID
  templateVersion: number
  parameterSnapshot: ParameterSnapshotItem[]
  modelRef: DrawingModelRef
  paper: PaperSize
  scale: DrawingScale
  projection: ProjectionConvention
  views: DrawingView[]
  primitives: DrawingPrimitive[]
  annotations: DrawingAnnotation[]
  frame: DrawingFrame
  styles: DrawingStyles
  layout: DrawingLayout
  /** 稳定序列化内容哈希（不含自身）。 */
  fingerprint: string
}

/** 绘图区固定约定（任务卡 §5.1）。 */
export const SHEET_LAYOUT = {
  border: { x1: 10, y1: 10, x2: 287, y2: 200 },
  titleBlock: { x1: 170, y1: 160, x2: 287, y2: 200 },
  techBlock: { x1: 10, y1: 160, x2: 170, y2: 200 },
  drawable: { x1: 20, y1: 20, x2: 277, y2: 150 },
  axialCenter: { x: 80, y: 80 },
  endCenter: { x: 180, y: 80 },
} as const

export const DRAFT_STATUS_TEXT = '待复核草稿' as const
export const MISSING_TEXT = '待补充' as const
