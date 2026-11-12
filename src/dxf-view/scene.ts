/**
 * DXF 场景：把解析结果变换成 SVG 显示坐标（y 向下）。
 *
 * 图纸空间的模型内容由 VIEWPORT 的 `12/22`（视口中心）→ `10/20`（纸面位置）、
 * `41/45`（纸面视口高 / 模型视高）决定比例；裁剪用视口矩形。
 */
import { boundsOfShapes } from './parse'
import type {
  DxfDocument,
  DxfBounds,
  DxfEntity,
  DxfLayer,
  DxfPoint,
  DxfScene,
  DxfViewportInfo,
  ParsedShape,
  SceneEntityView,
  SceneShape,
  SceneViewport,
} from './types'

/** ACI 1..7 按任务卡映射；其它索引给中性灰，不假装知道确切色号。 */
export function aciColor(index: number): string {
  switch (index) {
    case 1:
      return '#E01B1B'
    case 2:
      return '#C9A200'
    case 3:
      return '#1B8A3A'
    case 4:
      return '#0E7C9E'
    case 5:
      return '#1F4FD8'
    case 6:
      return '#B01BB0'
    case 7:
      return '#1B2430'
    case 8:
      return '#6B7280'
    case 9:
      return '#9CA3AF'
    default:
      return '#4B5563'
  }
}

export function layerColorOf(doc: DxfDocument, layerName: string): string {
  const layer: DxfLayer | undefined = doc.layers.find((item) => item.name === layerName)
  return aciColor(layer === undefined ? 7 : layer.color)
}

export function defaultHiddenLayers(doc: DxfDocument): string[] {
  return doc.layers.filter((layer) => layer.off || layer.frozen).map((layer) => layer.name)
}

function displayPointFromDxf(point: DxfPoint): DxfPoint {
  return { x: point.x, y: -point.y }
}

export function displayShape(shape: ParsedShape): SceneShape {
  switch (shape.kind) {
    case 'line':
      return { kind: 'line', x1: shape.x1, y1: -shape.y1, x2: shape.x2, y2: -shape.y2 }
    case 'polyline':
      return {
        kind: 'polyline',
        points: shape.points.map(displayPointFromDxf),
        closed: shape.closed,
      }
    case 'circle':
      return { kind: 'circle', cx: shape.cx, cy: -shape.cy, r: shape.r }
    case 'arc':
      // 保持 DXF 角度（逆时针 0..360），渲染时按 y 翻转取端点、sweep=0。
      return { kind: 'arc', cx: shape.cx, cy: -shape.cy, r: shape.r, startDeg: shape.startDeg, endDeg: shape.endDeg }
    case 'text':
      return {
        kind: 'text',
        x: shape.x,
        y: -shape.y,
        text: shape.text,
        height: shape.height,
        rotationDeg: -shape.rotationDeg,
        anchor: shape.anchor,
        baseline: shape.baseline,
      }
  }
}

function transformThroughViewport(
  shape: SceneShape,
  viewport: DxfViewportInfo,
): SceneShape {
  const toPaper = (displayX: number, displayY: number): DxfPoint => {
    const paperX = viewport.center.x + (displayX - viewport.viewCenter.x) * viewport.scale
    const paperY = viewport.center.y + (-displayY - viewport.viewCenter.y) * viewport.scale
    return { x: paperX, y: -paperY }
  }
  switch (shape.kind) {
    case 'line': {
      const start = toPaper(shape.x1, shape.y1)
      const end = toPaper(shape.x2, shape.y2)
      return { kind: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y }
    }
    case 'polyline':
      return { kind: 'polyline', points: shape.points.map((point) => toPaper(point.x, point.y)), closed: shape.closed }
    case 'circle': {
      const center = toPaper(shape.cx, shape.cy)
      return { kind: 'circle', cx: center.x, cy: center.y, r: shape.r * viewport.scale }
    }
    case 'arc': {
      const center = toPaper(shape.cx, shape.cy)
      return {
        kind: 'arc',
        cx: center.x,
        cy: center.y,
        r: shape.r * viewport.scale,
        startDeg: shape.startDeg,
        endDeg: shape.endDeg,
      }
    }
    case 'text': {
      const position = toPaper(shape.x, shape.y)
      return {
        kind: 'text',
        x: position.x,
        y: position.y,
        text: shape.text,
        height: shape.height * viewport.scale,
        rotationDeg: shape.rotationDeg,
        anchor: shape.anchor,
        baseline: shape.baseline,
      }
    }
  }
}

function sceneBounds(shapes: SceneShape[]): DxfBounds | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const include = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const shape of shapes) {
    if (shape.kind === 'line') {
      include(shape.x1, shape.y1)
      include(shape.x2, shape.y2)
    } else if (shape.kind === 'polyline') {
      for (const point of shape.points) include(point.x, point.y)
    } else if (shape.kind === 'circle') {
      include(shape.cx - shape.r, shape.cy - shape.r)
      include(shape.cx + shape.r, shape.cy + shape.r)
    } else if (shape.kind === 'arc') {
      include(shape.cx - shape.r, shape.cy - shape.r)
      include(shape.cx + shape.r, shape.cy + shape.r)
    } else {
      const width = textWidthApprox(shape.text, shape.height)
      const left =
        shape.anchor === 'middle' ? shape.x - width / 2 : shape.anchor === 'end' ? shape.x - width : shape.x
      include(left, shape.y - shape.height)
      include(left + width, shape.y + shape.height * 0.25)
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { minX, minY, maxX, maxY }
}

function textWidthApprox(text: string, height: number): number {
  let units = 0
  for (const character of text) {
    units += /[\u2e80-\uffef]/.test(character) ? 1 : 0.55
  }
  return units * height
}

function viewBoxFromBounds(bounds: DxfBounds, marginRatio = 0.04): DxfScene['box'] {
  const width = Math.max(bounds.maxX - bounds.minX, 1e-6)
  const height = Math.max(bounds.maxY - bounds.minY, 1e-6)
  const margin = Math.max(width, height) * marginRatio
  return {
    x: bounds.minX - margin,
    y: bounds.minY - margin,
    width: width + margin * 2,
    height: height + margin * 2,
  }
}

function visibleEntities(doc: DxfDocument, space: 'model' | 'paper', hidden: Set<string>): DxfEntity[] {
  return doc.entities.filter(
    (entity) => entity.space === space && !hidden.has(entity.layer),
  )
}

function toSceneEntity(doc: DxfDocument, entity: DxfEntity): SceneEntityView {
  return {
    entityId: entity.id,
    type: entity.type,
    layer: entity.layer,
    color: layerColorOf(doc, entity.layer),
    shapes: entity.shapes.map(displayShape),
  }
}

export function buildModelScene(doc: DxfDocument, hiddenLayers: Set<string>): DxfScene {
  const entities = visibleEntities(doc, 'model', hiddenLayers).map((entity) => toSceneEntity(doc, entity))
  const bounds =
    sceneBounds(entities.flatMap((entity) => entity.shapes)) ??
    (doc.modelBounds === null
      ? null
      : { ...doc.modelBounds, minY: -doc.modelBounds.maxY, maxY: -doc.modelBounds.minY })
  return {
    space: 'model',
    box: bounds === null ? { x: 0, y: 0, width: 100, height: 100 } : viewBoxFromBounds(bounds),
    entities,
    viewports: [],
  }
}

export function buildPaperScene(doc: DxfDocument, hiddenLayers: Set<string>): DxfScene | null {
  if (!doc.hasPaperSpace) return null
  const paperEntities = visibleEntities(doc, 'paper', hiddenLayers).map((entity) => toSceneEntity(doc, entity))
  const modelEntities = visibleEntities(doc, 'model', hiddenLayers)

  const viewports: SceneViewport[] = doc.viewports
    .filter((viewport) => !hiddenLayers.has(viewport.layer))
    .map((viewport) => ({
      id: viewport.id,
      rect: {
        x: viewport.center.x - viewport.width / 2,
        y: -(viewport.center.y + viewport.height / 2),
        width: viewport.width,
        height: viewport.height,
      },
      entities: modelEntities.map((entity) => {
        const scene = toSceneEntity(doc, entity)
        return {
          ...scene,
          shapes: scene.shapes.map((shape) => transformThroughViewport(shape, viewport)),
          viaViewport: viewport.id,
        }
      }),
    }))

  const paperWidth = doc.paperSize?.width ?? 0
  const paperHeight = doc.paperSize?.height ?? 0
  const paperMin = doc.header.paperMin ?? { x: 0, y: 0 }
  const box =
    paperWidth > 0 && paperHeight > 0
      ? { x: paperMin.x, y: -(paperMin.y + paperHeight), width: paperWidth, height: paperHeight }
      : viewBoxFromBounds(
          sceneBounds([
            ...paperEntities.flatMap((entity) => entity.shapes),
            ...viewports.flatMap((viewport) =>
              viewport.entities.flatMap((entity) => entity.shapes),
            ),
          ]) ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        )

  return { space: 'paper', box, entities: paperEntities, viewports }
}

/** 全部可见几何的显示包围盒，供「适应窗口」。 */
export function sceneContentBounds(scene: DxfScene): DxfBounds {
  const shapes = [
    ...scene.entities.flatMap((entity) => entity.shapes),
    ...scene.viewports.flatMap((viewport) => viewport.entities.flatMap((entity) => entity.shapes)),
  ]
  return sceneBounds(shapes) ?? { minX: scene.box.x, minY: scene.box.y, maxX: scene.box.x + scene.box.width, maxY: scene.box.y + scene.box.height }
}

export interface ViewBox {
  x: number
  y: number
  width: number
  height: number
}

/** 与 SVG `preserveAspectRatio="xMidYMid meet"` 一致的屏幕坐标 → 场景坐标。 */
export function clientToScene(
  rect: { left: number; top: number; width: number; height: number },
  box: ViewBox,
  clientX: number,
  clientY: number,
): DxfPoint {
  const scale = fitScaleOf(rect, box)
  const offsetX = (rect.width - box.width * scale) / 2
  const offsetY = (rect.height - box.height * scale) / 2
  return {
    x: box.x + (clientX - rect.left - offsetX) / scale,
    y: box.y + (clientY - rect.top - offsetY) / scale,
  }
}

/** clientToScene 的逆变换；测试与坐标换算共用。 */
export function sceneToClient(
  rect: { left: number; top: number; width: number; height: number },
  box: ViewBox,
  x: number,
  y: number,
): { clientX: number; clientY: number } {
  const scale = fitScaleOf(rect, box)
  const offsetX = (rect.width - box.width * scale) / 2
  const offsetY = (rect.height - box.height * scale) / 2
  return {
    clientX: rect.left + offsetX + (x - box.x) * scale,
    clientY: rect.top + offsetY + (y - box.y) * scale,
  }
}

function fitScaleOf(
  rect: { width: number; height: number },
  box: ViewBox,
): number {
  const scale = Math.min(rect.width / (box.width || 1), rect.height / (box.height || 1))
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}


export function fitViewBox(bounds: DxfBounds, marginRatio = 0.04): ViewBox {
  return viewBoxFromBounds(bounds, marginRatio)
}

/** 以场景点 (anchorX, anchorY) 为不动点缩放；factor > 1 放大。 */
export function zoomViewBox(box: ViewBox, factor: number, anchorX: number, anchorY: number): ViewBox {
  const width = box.width / factor
  const height = box.height / factor
  const ratioX = box.width === 0 ? 0.5 : (anchorX - box.x) / box.width
  const ratioY = box.height === 0 ? 0.5 : (anchorY - box.y) / box.height
  return {
    x: anchorX - width * ratioX,
    y: anchorY - height * ratioY,
    width,
    height,
  }
}

export function panViewBox(box: ViewBox, deltaX: number, deltaY: number): ViewBox {
  return { ...box, x: box.x + deltaX, y: box.y + deltaY }
}

/** 显示坐标 → DXF 坐标（量距文案用）。 */
export function dxfPointOfDisplay(point: DxfPoint): DxfPoint {
  return { x: point.x, y: -point.y }
}

/** 图纸空间里模型内容来自哪个视口；供属性面板说明。 */
export function viewportOfPoint(scene: DxfScene, x: number, y: number): SceneViewport | null {
  for (const viewport of scene.viewports) {
    const rect = viewport.rect
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
      return viewport
    }
  }
  return null
}

/** 由实体自身包围盒（DXF 坐标）判断；用于属性面板。 */
export function entityBounds(entity: DxfEntity): DxfBounds | null {
  return boundsOfShapes(entity.shapes)
}
