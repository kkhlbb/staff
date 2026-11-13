/**
 * 图上框选的坐标换算：屏幕（CSS px）↔ 原图像素。
 *
 * 唯一事实：存进项目文件与证据的 rect 一律是**原图像素坐标**（整数，左上原点，
 * 含左上不含右下）。屏幕上看到的是“旋转后的显示方向”，中间还有缩放与平移。
 *
 * 四向（EXIF 1/3/6/8）的逆变换（显示像素 → 原图像素，原图宽 W、高 H）：
 *   1： (x, y) = (dx, dy)
 *   3： (x, y) = (W - dx, H - dy)
 *   6： (x, y) = (dy, H - dx)     （显示图宽 = H，高 = W）
 *   8： (x, y) = (W - dy, dx)
 *
 * 本模块不做任何像素采样或尺寸推算：只搬坐标。
 */
import { orientedSize, type SketchOrientation } from './orientation'

export interface ImagePixelRect {
  /** 原图像素，整数。 */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface SketchView {
  /** 显示缩放，1 = 显示 1 原图像素对应 1 CSS px。 */
  readonly zoom: number
  /** 图像左上角在框选容器内的偏移（CSS px），可为负。 */
  readonly panX: number
  readonly panY: number
}

export interface ViewPoint {
  readonly x: number
  readonly y: number
}

/** 显示方向下的图像像素尺寸。 */
export function displayedPixelSize(
  orientation: SketchOrientation,
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  return orientedSize(orientation, sourceWidth, sourceHeight)
}

/** 屏幕点（容器内 CSS px）→ 显示方向下的图像像素（浮点）。 */
export function viewToDisplayed(
  view: SketchView,
  point: ViewPoint,
): ViewPoint {
  const zoom = view.zoom > 0 ? view.zoom : 1
  return { x: (point.x - view.panX) / zoom, y: (point.y - view.panY) / zoom }
}

/** 显示方向下的图像像素 → 屏幕点（容器内 CSS px）。 */
export function displayedToView(view: SketchView, point: ViewPoint): ViewPoint {
  const zoom = view.zoom > 0 ? view.zoom : 1
  return { x: point.x * zoom + view.panX, y: point.y * zoom + view.panY }
}

/** 显示方向像素 → 原图像素（浮点）。 */
export function displayedToSource(
  orientation: SketchOrientation,
  sourceWidth: number,
  sourceHeight: number,
  point: ViewPoint,
): ViewPoint {
  const { width: displayWidth, height: displayHeight } = displayedPixelSize(
    orientation,
    sourceWidth,
    sourceHeight,
  )
  switch (orientation) {
    case 1: return { x: point.x, y: point.y }
    case 3: return { x: sourceWidth - point.x, y: sourceHeight - point.y }
    case 6: return { x: point.y, y: sourceHeight - point.x }
    case 8: return { x: sourceWidth - point.y, y: point.x }
    default: {
      // 类型上不可达；显式失败，不返回“差不多”的坐标。
      void displayWidth; void displayHeight
      throw new Error(`unsupported orientation: ${String(orientation)}`)
    }
  }
}

/** 原图像素 → 显示方向像素。 */
export function sourceToDisplayed(
  orientation: SketchOrientation,
  sourceWidth: number,
  sourceHeight: number,
  point: ViewPoint,
): ViewPoint {
  switch (orientation) {
    case 1: return { x: point.x, y: point.y }
    case 3: return { x: sourceWidth - point.x, y: sourceHeight - point.y }
    case 6: return { x: sourceHeight - point.y, y: point.x }
    case 8: return { x: point.y, y: sourceWidth - point.x }
    default: throw new Error(`unsupported orientation: ${String(orientation)}`)
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 屏幕上拖出的两点 → 原图像素矩形。
 * - 先各自逆变换，再取 min/max（旋转后两个角点不再递增）；
 * - 四舍五入到整数像素并夹紧到 [0,W]×[0,H]；
 * - 结果宽或高 < 1 时返回 null（不是“一个点”的框）。
 */
export function selectionToSourceRect(input: {
  readonly orientation: SketchOrientation
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly view: SketchView
  readonly start: ViewPoint
  readonly end: ViewPoint
}): ImagePixelRect | null {
  const { orientation, sourceWidth, sourceHeight, view } = input
  if (sourceWidth <= 0 || sourceHeight <= 0) return null
  const first = displayedToSource(orientation, sourceWidth, sourceHeight, viewToDisplayed(view, input.start))
  const second = displayedToSource(orientation, sourceWidth, sourceHeight, viewToDisplayed(view, input.end))
  const left = clamp(Math.round(Math.min(first.x, second.x)), 0, sourceWidth)
  const right = clamp(Math.round(Math.max(first.x, second.x)), 0, sourceWidth)
  const top = clamp(Math.round(Math.min(first.y, second.y)), 0, sourceHeight)
  const bottom = clamp(Math.round(Math.max(first.y, second.y)), 0, sourceHeight)
  if (right - left < 1 || bottom - top < 1) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** 原图矩形 → 容器内屏幕矩形（用于把已保存的框画回去）。 */
export function sourceRectToViewRect(input: {
  readonly orientation: SketchOrientation
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly view: SketchView
  readonly rect: ImagePixelRect
}): { left: number; top: number; width: number; height: number } {
  const { orientation, sourceWidth, sourceHeight, view, rect } = input
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ].map((point) => displayedToView(view, sourceToDisplayed(orientation, sourceWidth, sourceHeight, point)))
  const left = Math.min(...corners.map((point) => point.x))
  const right = Math.max(...corners.map((point) => point.x))
  const top = Math.min(...corners.map((point) => point.y))
  const bottom = Math.max(...corners.map((point) => point.y))
  return { left, top, width: right - left, height: bottom - top }
}

/** 原图矩形是否落在原图范围内（用于提交前守卫与读回校验）。 */
export function sourceRectInBounds(
  rect: ImagePixelRect,
  sourceWidth: number,
  sourceHeight: number,
): boolean {
  return Number.isInteger(rect.x) && Number.isInteger(rect.y) &&
    Number.isInteger(rect.width) && Number.isInteger(rect.height) &&
    rect.width >= 1 && rect.height >= 1 &&
    rect.x >= 0 && rect.y >= 0 &&
    rect.x + rect.width <= sourceWidth && rect.y + rect.height <= sourceHeight
}

/** 无框选时进入候选的固定说明（任务卡 D：允许不框选，但必须标明无位置）。 */
export const UNSELECTED_PLACEHOLDER = '未框选，无位置'

/** 候选上的固定标记：来源图片 + 第 N 个框选。 */
export function sketchRegionLabel(index: number | null): string {
  return index === null ? `来源：图片，${UNSELECTED_PLACEHOLDER}` : `来源：图片，第 ${index} 个框选`
}
