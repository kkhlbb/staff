/**
 * 点选与量距：全部在**显示坐标**里算（与 SVG viewBox 同一坐标系），
 * 命中容差由调用方按当前缩放换算成图纸单位，避免「放大后点不中/缩小后点一大片」。
 */
import type { DxfEntity, DxfPoint, DxfScene, SceneShape } from './types'

export function displayArcPoint(
  shape: Extract<SceneShape, { kind: 'arc' }>,
  angleDeg: number,
): DxfPoint {
  const radians = (angleDeg * Math.PI) / 180
  return { x: shape.cx + shape.r * Math.cos(radians), y: shape.cy - shape.r * Math.sin(radians) }
}

export function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360
}

function isAngleInSweep(angleDeg: number, startDeg: number, endDeg: number): boolean {
  const sweep = normalizeDegrees(endDeg - startDeg)
  const relative = normalizeDegrees(angleDeg - startDeg)
  return relative <= sweep
}

function distanceToSegment(point: DxfPoint, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - x1, point.y - y1)
  const t = Math.max(0, Math.min(1, ((point.x - x1) * dx + (point.y - y1) * dy) / lengthSquared))
  return Math.hypot(point.x - (x1 + t * dx), point.y - (y1 + t * dy))
}

function textBox(shape: Extract<SceneShape, { kind: 'text' }>): {
  left: number
  right: number
  top: number
  bottom: number
} {
  let units = 0
  for (const character of shape.text) {
    units += /[\u2e80-\uffef]/.test(character) ? 1 : 0.55
  }
  const width = units * shape.height
  const left =
    shape.anchor === 'middle' ? shape.x - width / 2 : shape.anchor === 'end' ? shape.x - width : shape.x
  return { left, right: left + width, top: shape.y - shape.height, bottom: shape.y + shape.height * 0.25 }
}

export function distanceToShape(point: DxfPoint, shape: SceneShape): number {
  switch (shape.kind) {
    case 'line':
      return distanceToSegment(point, shape.x1, shape.y1, shape.x2, shape.y2)
    case 'polyline': {
      const points = shape.closed && shape.points.length > 1
        ? [...shape.points, shape.points[0]]
        : shape.points
      let best = Number.POSITIVE_INFINITY
      for (let index = 0; index + 1 < points.length; index += 1) {
        const start = points[index]
        const end = points[index + 1]
        best = Math.min(best, distanceToSegment(point, start.x, start.y, end.x, end.y))
      }
      if (points.length === 1) best = Math.hypot(point.x - points[0].x, point.y - points[0].y)
      return best
    }
    case 'circle':
      return Math.abs(Math.hypot(point.x - shape.cx, point.y - shape.cy) - shape.r)
    case 'arc': {
      const distance = Math.hypot(point.x - shape.cx, point.y - shape.cy)
      const angle = normalizeDegrees((Math.atan2(-(point.y - shape.cy), point.x - shape.cx) * 180) / Math.PI)
      if (isAngleInSweep(angle, shape.startDeg, shape.endDeg)) {
        return Math.abs(distance - shape.r)
      }
      const start = displayArcPoint(shape, shape.startDeg)
      const end = displayArcPoint(shape, shape.endDeg)
      return Math.min(Math.hypot(point.x - start.x, point.y - start.y), Math.hypot(point.x - end.x, point.y - end.y))
    }
    case 'text': {
      const box = textBox(shape)
      const dx = point.x < box.left ? box.left - point.x : point.x > box.right ? point.x - box.right : 0
      const dy = point.y < box.top ? box.top - point.y : point.y > box.bottom ? point.y - box.bottom : 0
      return Math.hypot(dx, dy)
    }
  }
}

export interface PickedEntity {
  entityId: string
  type: string
  layer: string
  color: string
  distance: number
  viaViewport?: string
}

/** 命中最靠近的可见实体；`tolerance` 是显示坐标单位。 */
export function pickEntity(scene: DxfScene, point: DxfPoint, tolerance: number): PickedEntity | null {
  let best: PickedEntity | null = null
  const consider = (
    entityId: string,
    type: string,
    layer: string,
    color: string,
    shapes: SceneShape[],
    viaViewport?: string,
  ): void => {
    for (const shape of shapes) {
      const distance = distanceToShape(point, shape)
      if (distance > tolerance) continue
      if (best === null || distance < best.distance) {
        best = { entityId, type, layer, color, distance, viaViewport }
      }
    }
  }
  for (const entity of scene.entities) {
    consider(entity.entityId, entity.type, entity.layer, entity.color, entity.shapes, entity.viaViewport)
  }
  for (const viewport of scene.viewports) {
    for (const entity of viewport.entities) {
      consider(entity.entityId, entity.type, entity.layer, entity.color, entity.shapes, viewport.id)
    }
  }
  return best
}

/** 咬合候选：线段端点/中点、多段线顶点、圆心/象限、弧端点、文字插入点。 */
export function snapCandidates(scene: DxfScene): DxfPoint[] {
  const points: DxfPoint[] = []
  const addShape = (shape: SceneShape): void => {
    switch (shape.kind) {
      case 'line':
        points.push({ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 })
        points.push({ x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2 })
        break
      case 'polyline':
        for (const point of shape.points) points.push(point)
        break
      case 'circle':
        points.push(
          { x: shape.cx, y: shape.cy },
          { x: shape.cx + shape.r, y: shape.cy },
          { x: shape.cx - shape.r, y: shape.cy },
          { x: shape.cx, y: shape.cy + shape.r },
          { x: shape.cx, y: shape.cy - shape.r },
        )
        break
      case 'arc':
        points.push(
          displayArcPoint(shape, shape.startDeg),
          displayArcPoint(shape, shape.endDeg),
          { x: shape.cx, y: shape.cy },
        )
        break
      case 'text':
        points.push({ x: shape.x, y: shape.y })
        break
    }
  }
  for (const entity of scene.entities) for (const shape of entity.shapes) addShape(shape)
  for (const viewport of scene.viewports) {
    for (const entity of viewport.entities) for (const shape of entity.shapes) addShape(shape)
  }
  return points
}

/** 最近咬合点；没有候选在容差内时返回原始点（自由量距）。 */
export function snapPoint(scene: DxfScene, point: DxfPoint, tolerance: number): DxfPoint {
  let best = point
  let bestDistance = tolerance
  for (const candidate of snapCandidates(scene)) {
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/** 量距显示：$INSUNITS=4 才是 mm；其它单位如实写「图纸单位」，不假装是 mm。 */
export function formatMeasuredDistance(displayDistance: number, insUnits: number | null): string {
  const value = Math.round(displayDistance * 1000) / 1000
  return insUnits === 4 ? `${value.toFixed(2)} mm` : `${value.toFixed(2)} 图纸单位`
}

/** 属性面板用的关键点（DXF 坐标）。 */
export function entityKeyPoints(entity: DxfEntity): { label: string; point: DxfPoint }[] {
  const result: { label: string; point: DxfPoint }[] = []
  for (const shape of entity.shapes) {
    if (shape.kind === 'line') {
      result.push({ label: '起点', point: { x: shape.x1, y: shape.y1 } })
      result.push({ label: '终点', point: { x: shape.x2, y: shape.y2 } })
    } else if (shape.kind === 'circle' || shape.kind === 'arc') {
      result.push({ label: '圆心', point: { x: shape.cx, y: shape.cy } })
    } else if (shape.kind === 'text') {
      result.push({ label: '插入点', point: { x: shape.x, y: shape.y } })
    } else if (shape.kind === 'polyline' && result.length === 0 && shape.points.length > 0) {
      result.push({ label: '首点', point: shape.points[0] })
    }
    if (result.length >= 4) break
  }
  return result
}

export function entityRadius(entity: DxfEntity): number | null {
  for (const shape of entity.shapes) {
    if (shape.kind === 'circle' || shape.kind === 'arc') return shape.r
  }
  return null
}
