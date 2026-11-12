/**
 * 只读 DXF 看图的纯数据形状。
 *
 * 与 `src/drawing/types.ts` 的 DrawingData **有意分开**：DrawingData 是「我们生成的
 * 隔套图纸」的参数化真值，DXF 文档是别人的文件，只有几何与图层，没有参数、没有
 * parameterId，也不允许写回。两者语义不同，不互相塞。
 *
 * 坐标约定：
 * - 解析结果（DxfShape/DxfEntity）是文件里的 DXF 坐标，y 向上，单位按文件；
 * - 场景（SceneEntityView/SceneShape）已翻成 SVG 显示坐标，y 向下，供 viewBox 渲染。
 */

export interface DxfPoint {
  x: number
  y: number
}

export interface DxfBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 解析期的图元几何（DXF 坐标，y 向上；文字 rotation 为逆时针度）。 */
export type ParsedShape =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'polyline'; points: DxfPoint[]; closed: boolean }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'arc'; cx: number; cy: number; r: number; startDeg: number; endDeg: number }
  | {
      kind: 'text'
      x: number
      y: number
      text: string
      height: number
      rotationDeg: number
      anchor: 'start' | 'middle' | 'end'
      baseline: 'alphabetic' | 'middle'
      /** 尺寸标注文字：渲染时用 42 实测值生成，不取匿名块里的旧文字。 */
      fromMeasurement?: boolean
    }

/** 显示期图元（SVG 坐标，y 向下；文字 rotation 为顺时针度）。 */
export type SceneShape =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'polyline'; points: DxfPoint[]; closed: boolean }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'arc'; cx: number; cy: number; r: number; startDeg: number; endDeg: number }
  | {
      kind: 'text'
      x: number
      y: number
      text: string
      height: number
      rotationDeg: number
      anchor: 'start' | 'middle' | 'end'
      baseline: 'alphabetic' | 'middle'
    }

export type DxfSpace = 'model' | 'paper'

export interface DxfDimensionInfo {
  blockName: string
  dimensionType: number
  /** 组码 42：实测值。标注值只认它。 */
  measurement: number
  /** 组码 1：文件里的文字覆盖值（可能为空 / "<>"）。只作对照，不作显示值。 */
  textOverride: string | null
  /** 由 42 生成的显示文字（直径类带 ⌀）。 */
  valueText: string
}

export interface DxfEntity {
  /** 稳定 ID：`<space>:<ENTITIES 段序号>`。 */
  id: string
  type: string
  layer: string
  space: DxfSpace
  shapes: ParsedShape[]
  /** TEXT/MTEXT 的纯文本，或 DIMENSION 的 42 显示值。 */
  text?: string
  dimension?: DxfDimensionInfo
  /** 选点后属性面板用的关键点。 */
  anchor?: DxfPoint
}

export interface DxfViewportInfo {
  id: string
  number: number
  layer: string
  center: DxfPoint
  width: number
  height: number
  /** 视口中心对应的模型点。 */
  viewCenter: DxfPoint
  /** 模型视高（组码 45）；缺省时用 height（1:1）。 */
  viewHeight: number
  /** 纸面 mm / 模型单位 = height / viewHeight。 */
  scale: number
  twistDeg: number
}

export interface DxfLayer {
  name: string
  /** ACI 1..7；其它值按 7 处理但保留原值。 */
  color: number
  /** 62 < 0 表示图层关闭。 */
  off: boolean
  frozen: boolean
}

export interface DxfHeaderInfo {
  acadVersion: string
  codepage: string
  insUnits: number | null
  extMin: DxfPoint | null
  extMax: DxfPoint | null
  paperMin: DxfPoint | null
  paperMax: DxfPoint | null
}

export interface DxfEncodingInfo {
  /** 实际用于解码的字符集。 */
  charset: 'gbk' | 'utf-8' | 'windows-1252' | 'utf-16le' | 'unknown'
  /** 文件头声明的代码页，例如 ANSI_936。 */
  codepage: string
  /** true = 解码不是确定成功的；界面必须提示「文字可能不正确」。 */
  warning: boolean
  /** 给界面看的解释，不藏技术原因。 */
  detail: string
}

export interface DxfUnsupportedCount {
  type: string
  count: number
}

export interface DxfLayoutInfo {
  name: string
  paperWidth: number
  paperHeight: number
  tabOrder: number
}

export interface DxfDocument {
  fileName: string
  version: 'R12' | '2000' | 'unknown'
  header: DxfHeaderInfo
  encoding: DxfEncodingInfo
  layers: DxfLayer[]
  entities: DxfEntity[]
  viewports: DxfViewportInfo[]
  layouts: DxfLayoutInfo[]
  unsupported: DxfUnsupportedCount[]
  /** 解析阶段发现、但不足以判失败的事实（例如视口带旋转）。 */
  notes: string[]
  /** 模型空间几何包围盒（不含未渲染实体）。 */
  modelBounds: DxfBounds | null
  /** 图纸空间纸面尺寸；R12 没有图纸空间时为 null。 */
  paperSize: { width: number; height: number } | null
  /** 文件里是否存在图纸空间内容（67=1 实体或 VIEWPORT）。 */
  hasPaperSpace: boolean
}

export interface SceneEntityView {
  entityId: string
  type: string
  layer: string
  color: string
  shapes: SceneShape[]
  /** 该组几何来自哪个视口（图纸空间里的模型内容）。 */
  viaViewport?: string
}

export interface SceneViewport {
  id: string
  rect: { x: number; y: number; width: number; height: number }
  entities: SceneEntityView[]
}

export interface DxfScene {
  space: DxfSpace
  /** SVG viewBox（y 向下）。 */
  box: { x: number; y: number; width: number; height: number }
  entities: SceneEntityView[]
  viewports: SceneViewport[]
}
