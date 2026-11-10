/**
 * 纸面占用与容纳检查（V3-C-02）。
 *
 * 不能只检查零件轮廓 bbox：箭头、线宽、文字实测包围盒、引出线、投影说明都要算。
 * 字体未就绪时这里用保守字宽估计（CJK 1.0em、其它 0.62em、⌀ 1.0em），并留出
 * 箭头长度/线宽的安全余量；打印页就绪后仍会再做一次字体与布局检查。
 */
import type {
  DrawingAnnotation,
  DrawingPrimitive,
  LineGeometry,
  Point,
} from './types'

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface TextBox {
  text: string
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  fontSizeMm: number
}

/** 保守字宽：CJK/全角 1.0em，⌀ 1.0em，其余 0.62em。 */
export function estimateTextWidthMm(text: string, fontSizeMm: number): number {
  let width = 0
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    const wide =
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      code === 0x2300 ||
      code === 0x00b1
    width += wide ? fontSizeMm : fontSizeMm * 0.62
  }
  return width
}

/** 基线在 y 上，向上约 0.78em、向下约 0.24em（避开浏览器默认基线差异）。 */
export function textBox(text: TextBox): Bounds {
  const width = estimateTextWidthMm(text.text, text.fontSizeMm)
  const left =
    text.anchor === 'start'
      ? text.x
      : text.anchor === 'middle'
        ? text.x - width / 2
        : text.x - width
  return {
    minX: left,
    minY: text.y - text.fontSizeMm * 0.78,
    maxX: left + width,
    maxY: text.y + text.fontSizeMm * 0.24,
  }
}

export function unionBounds(items: readonly Bounds[]): Bounds | null {
  if (items.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const item of items) {
    minX = Math.min(minX, item.minX)
    minY = Math.min(minY, item.minY)
    maxX = Math.max(maxX, item.maxX)
    maxY = Math.max(maxY, item.maxY)
  }
  return { minX, minY, maxX, maxY }
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
}

export function boundsInside(inner: Bounds, outer: Bounds): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.minY >= outer.minY &&
    inner.maxX <= outer.maxX &&
    inner.maxY <= outer.maxY
  )
}

function lineBounds(line: LineGeometry): Bounds {
  return {
    minX: Math.min(line.x1, line.x2),
    minY: Math.min(line.y1, line.y2),
    maxX: Math.max(line.x1, line.x2),
    maxY: Math.max(line.y1, line.y2),
  }
}

/** 线宽与箭头都占纸面：统一外扩 1.5mm（0.5 线宽 + 2.5 箭头的一半余量）。 */
function expand(bounds: Bounds, margin: number): Bounds {
  return {
    minX: bounds.minX - margin,
    minY: bounds.minY - margin,
    maxX: bounds.maxX + margin,
    maxY: bounds.maxY + margin,
  }
}

export function primitiveBounds(
  primitive: DrawingPrimitive,
  fontSizeMm: number,
): Bounds {
  const geometry = primitive.geometryMm
  if (primitive.kind === 'line') {
    return lineBounds(geometry as LineGeometry)
  }
  if (primitive.kind === 'circle') {
    const circle = geometry as { cx: number; cy: number; r: number }
    return {
      minX: circle.cx - circle.r,
      minY: circle.cy - circle.r,
      maxX: circle.cx + circle.r,
      maxY: circle.cy + circle.r,
    }
  }
  if (primitive.kind === 'polyline') {
    const points = (geometry as { points: Point[] }).points
    return unionBounds(points.map((point) => ({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }))) ?? {
      minX: 0, minY: 0, maxX: 0, maxY: 0,
    }
  }
  const text = geometry as { x: number; y: number; text: string; anchor: 'start' | 'middle' | 'end' }
  return textBox({ text: text.text, x: text.x, y: text.y, anchor: text.anchor, fontSizeMm })
}

export interface LayoutInput {
  primitives: readonly DrawingPrimitive[]
  annotations: readonly DrawingAnnotation[]
  /** annotationId → 已经由 parameterId 解析出的最终文字（含 ⌀）。 */
  annotationTexts: Readonly<Record<string, string>>
  drawableRect: LineGeometry
  fontSizeMm: number
}

export interface LayoutResult {
  drawableRectMm: LineGeometry
  occupiedBoundsMm: Bounds
  fits: boolean
  conflicts: string[]
}

/**
 * 只看绘图区（area='drawing'）的图元与标注；图框/标题栏是 sheet，不参与。
 * 冲突包括：超出可用区、文字与文字重叠。
 */
export function computeLayout(input: LayoutInput): LayoutResult {
  const drawable: Bounds = {
    minX: input.drawableRect.x1,
    minY: input.drawableRect.y1,
    maxX: input.drawableRect.x2,
    maxY: input.drawableRect.y2,
  }
  const conflicts: string[] = []
  const boxes: Bounds[] = []
  const textBoxes: { id: string; box: Bounds }[] = []

  for (const primitive of input.primitives) {
    if (primitive.area !== 'drawing') continue
    const box = expand(primitiveBounds(primitive, input.fontSizeMm), 0.6)
    boxes.push(box)
    if (primitive.kind === 'text') {
      textBoxes.push({ id: primitive.primitiveId, box })
    }
    if (!boundsInside(box, drawable)) {
      conflicts.push(`图元超出可用区：${primitive.primitiveId}`)
    }
  }

  for (const annotation of input.annotations) {
    for (const line of annotation.dimensionGeometryMm.lines) {
      const box = expand(lineBounds(line), 1.5)
      boxes.push(box)
      if (!boundsInside(box, drawable)) {
        conflicts.push(`尺寸线超出可用区：${annotation.annotationId}`)
      }
    }
    const text = input.annotationTexts[annotation.annotationId]
    if (text === undefined) {
      conflicts.push(`标注文字未解析：${annotation.annotationId}`)
      continue
    }
    const box = textBox({
      text,
      x: annotation.textPositionMm.x,
      y: annotation.textPositionMm.y,
      anchor: annotation.textAnchor,
      fontSizeMm: input.fontSizeMm,
    })
    boxes.push(box)
    textBoxes.push({ id: annotation.annotationId, box })
    if (!boundsInside(box, drawable)) {
      conflicts.push(`标注文字超出可用区：${annotation.annotationId}`)
    }
  }

  for (let i = 0; i < textBoxes.length; i += 1) {
    for (let j = i + 1; j < textBoxes.length; j += 1) {
      if (boundsIntersect(textBoxes[i].box, textBoxes[j].box)) {
        conflicts.push(`文字重叠：${textBoxes[i].id} / ${textBoxes[j].id}`)
      }
    }
  }

  const occupied = unionBounds(boxes) ?? {
    minX: drawable.minX,
    minY: drawable.minY,
    maxX: drawable.minX,
    maxY: drawable.minY,
  }
  return {
    drawableRectMm: input.drawableRect,
    occupiedBoundsMm: occupied,
    fits: conflicts.length === 0,
    conflicts,
  }
}
