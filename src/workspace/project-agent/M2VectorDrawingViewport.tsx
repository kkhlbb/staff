import {
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import {
  formatRevisionDisplay,
  type M2DrawingAnnotationItem,
  type M2DrawingFailureNotice,
  type M2DrawingVector,
  type M2DrawingVectorAnnotationAnchor,
  type M2DrawingVectorView,
  type M2DrawingViewId,
  type M2DrawingViewportState,
} from './m2WorkbenchBridge'

export interface M2VectorDrawingViewportProps {
  readonly drawingVector: M2DrawingVector
  readonly drawingRevision: string | null
  readonly drawingFailure: M2DrawingFailureNotice | null
  readonly annotations: readonly M2DrawingAnnotationItem[]
  readonly selectedAnnotationId: string | null
  readonly highlightedAnnotationIds: ReadonlySet<string>
  readonly drawingViewport: M2DrawingViewportState
  readonly onSelectAnnotation: (annotation: M2DrawingAnnotationItem) => void
  readonly onUpdateDrawingViewport: (
    updater: (prev: M2DrawingViewportState) => M2DrawingViewportState,
  ) => void
}

interface PositionedView {
  readonly view: M2DrawingVectorView
  readonly originX: number
  readonly originY: number
  readonly width: number
  readonly height: number
}

interface DrawingLayout {
  readonly positionedViews: ReadonlyMap<M2DrawingViewId, PositionedView>
  readonly orderedViews: readonly PositionedView[]
  readonly baseWidth: number
  readonly baseHeight: number
}

const VIEW_LABELS: Record<M2DrawingViewId, string> = {
  front: '主视图',
  top: '俯视图',
  side: '侧视图',
}

function computeDrawingLayout(drawingVector: M2DrawingVector): DrawingLayout {
  const byId = new Map<M2DrawingViewId, M2DrawingVectorView>()
  for (const view of drawingVector.views) {
    byId.set(view.id, view)
  }

  const front = byId.get('front')
  const top = byId.get('top')
  const side = byId.get('side')

  const leftColWidth = Math.max(front?.size[0] ?? 0, top?.size[0] ?? 0, 40)
  const topHeight = top?.size[1] ?? 0
  const frontHeight = front?.size[1] ?? side?.size[1] ?? 20
  const sideWidth = side?.size[0] ?? 0

  const padLeft = 26
  const padRight = 32
  const headerHeight = 22
  const gapX = 36
  const gapY = 30
  const padBottom = 26

  const positionedViews = new Map<M2DrawingViewId, PositionedView>()
  const orderedViews: PositionedView[] = []

  const topOriginY = headerHeight + 12
  if (top) {
    const item: PositionedView = {
      view: top,
      originX: padLeft,
      originY: topOriginY,
      width: Math.max(1, top.size[0]),
      height: Math.max(1, top.size[1]),
    }
    positionedViews.set('top', item)
    orderedViews.push(item)
  }

  const frontOriginY = top ? topOriginY + topHeight + gapY : topOriginY
  if (front) {
    const item: PositionedView = {
      view: front,
      originX: padLeft,
      originY: frontOriginY,
      width: Math.max(1, front.size[0]),
      height: Math.max(1, front.size[1]),
    }
    positionedViews.set('front', item)
    orderedViews.push(item)
  }

  if (side) {
    const item: PositionedView = {
      view: side,
      originX: padLeft + leftColWidth + gapX,
      originY: frontOriginY,
      width: Math.max(1, side.size[0]),
      height: Math.max(1, side.size[1]),
    }
    positionedViews.set('side', item)
    orderedViews.push(item)
  }

  const baseWidth = Math.max(
    140,
    padLeft + leftColWidth + (side ? gapX + sideWidth : 0) + padRight,
  )
  const baseHeight = Math.max(
    100,
    frontOriginY + Math.max(frontHeight, side?.size[1] ?? 0) + padBottom,
  )

  return { positionedViews, orderedViews, baseWidth, baseHeight }
}

function toSvgPoint(
  pv: PositionedView,
  x: number,
  y: number,
): readonly [number, number] {
  return [pv.originX + x, pv.originY + (pv.height - y)]
}

interface RenderableAnnotation {
  readonly item: M2DrawingAnnotationItem
  readonly viewId: M2DrawingViewId
  readonly dimX1: number
  readonly dimY1: number
  readonly dimX2: number
  readonly dimY2: number
  readonly witness1?: readonly [number, number, number, number]
  readonly witness2?: readonly [number, number, number, number]
  readonly textX: number
  readonly textY: number
}

function buildRenderableAnnotations(
  layout: DrawingLayout,
  drawingVector: M2DrawingVector,
  annotations: readonly M2DrawingAnnotationItem[],
): readonly RenderableAnnotation[] {
  const vectorById = new Map<string, M2DrawingVectorAnnotationAnchor>()
  for (const va of drawingVector.annotations ?? []) {
    vectorById.set(va.annotationId, va)
  }

  // Strictly prefer revision-isolated `annotations`; fall back to vector annotations only if none provided.
  const sourceItems: readonly M2DrawingAnnotationItem[] =
    annotations.length > 0
      ? annotations
      : (drawingVector.annotations ?? []).map((va) => ({
          annotationId: va.annotationId,
          label: va.label ?? va.annotationId,
          valueText:
            va.valueText ??
            (va.valueMm !== undefined
              ? `${va.valueMm.toFixed(drawingVector.displayDecimals ?? 1)} ${drawingVector.unit}`
              : va.annotationId),
          view: va.view,
          linkedFeatureIds:
            va.linkedFeatureIds ?? (va.reference?.featureId ? [va.reference.featureId] : []),
        }))

  const laneCounters = new Map<string, number>()
  const result: RenderableAnnotation[] = []

  for (const item of sourceItems) {
    const pv = layout.positionedViews.get(item.view) ?? layout.orderedViews[0]
    if (!pv) continue
    const va = vectorById.get(item.annotationId)
    const side = va?.side ?? 'below'
    const laneKey = `${pv.view.id}:${side}`
    const autoLane = laneCounters.get(laneKey) ?? 0
    laneCounters.set(laneKey, autoLane + 1)
    const lane = va?.lane ?? autoLane
    const offset = 8 + lane * 8

    if (va?.witnesses && va.witnesses.length === 2) {
      const [p1x, p1y] = toSvgPoint(pv, va.witnesses[0][0], va.witnesses[0][1])
      const [p2x, p2y] = toSvgPoint(pv, va.witnesses[1][0], va.witnesses[1][1])
      if (side === 'above') {
        const yDim = pv.originY - offset
        result.push({
          item,
          viewId: pv.view.id,
          dimX1: p1x,
          dimY1: yDim,
          dimX2: p2x,
          dimY2: yDim,
          witness1: [p1x, p1y, p1x, yDim],
          witness2: [p2x, p2y, p2x, yDim],
          textX: (p1x + p2x) / 2,
          textY: yDim - 2,
        })
      } else if (side === 'left') {
        const xDim = pv.originX - offset
        result.push({
          item,
          viewId: pv.view.id,
          dimX1: xDim,
          dimY1: p1y,
          dimX2: xDim,
          dimY2: p2y,
          witness1: [p1x, p1y, xDim, p1y],
          witness2: [p2x, p2y, xDim, p2y],
          textX: xDim - 2,
          textY: (p1y + p2y) / 2,
        })
      } else if (side === 'right') {
        const xDim = pv.originX + pv.width + offset
        result.push({
          item,
          viewId: pv.view.id,
          dimX1: xDim,
          dimY1: p1y,
          dimX2: xDim,
          dimY2: p2y,
          witness1: [p1x, p1y, xDim, p1y],
          witness2: [p2x, p2y, xDim, p2y],
          textX: xDim + 2,
          textY: (p1y + p2y) / 2,
        })
      } else {
        const yDim = pv.originY + pv.height + offset
        result.push({
          item,
          viewId: pv.view.id,
          dimX1: p1x,
          dimY1: yDim,
          dimX2: p2x,
          dimY2: yDim,
          witness1: [p1x, p1y, p1x, yDim],
          witness2: [p2x, p2y, p2x, yDim],
          textX: (p1x + p2x) / 2,
          textY: yDim + 5.5,
        })
      }
    } else if (va?.anchor) {
      const [ax, ay] = toSvgPoint(pv, va.anchor[0], va.anchor[1])
      result.push({
        item,
        viewId: pv.view.id,
        dimX1: ax - 6,
        dimY1: ay,
        dimX2: ax + 6,
        dimY2: ay,
        textX: ax,
        textY: ay - 2.5,
      })
    } else {
      const yDim = pv.originY + pv.height + offset
      result.push({
        item,
        viewId: pv.view.id,
        dimX1: pv.originX,
        dimY1: yDim,
        dimX2: pv.originX + pv.width,
        dimY2: yDim,
        textX: pv.originX + pv.width / 2,
        textY: yDim + 5,
      })
    }
  }

  return result
}

export function M2VectorDrawingViewport({
  drawingVector,
  drawingRevision,
  drawingFailure,
  annotations,
  selectedAnnotationId,
  highlightedAnnotationIds,
  drawingViewport,
  onSelectAnnotation,
  onUpdateDrawingViewport,
}: M2VectorDrawingViewportProps) {
  const layout = useMemo(() => computeDrawingLayout(drawingVector), [drawingVector])
  const renderableAnnotations = useMemo(
    () => buildRenderableAnnotations(layout, drawingVector, annotations),
    [layout, drawingVector, annotations],
  )

  const scale = Math.max(0.5, Math.min(3, drawingViewport.zoomPercent / 100))
  const vbWidth = layout.baseWidth / scale
  const vbHeight = layout.baseHeight / scale
  const vbX = (layout.baseWidth - vbWidth) / 2 - drawingViewport.panX
  const vbY = (layout.baseHeight - vbHeight) / 2 - drawingViewport.panY
  const viewBoxStr = `${vbX.toFixed(2)} ${vbY.toFixed(2)} ${vbWidth.toFixed(2)} ${vbHeight.toFixed(2)}`

  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const displayRev = formatRevisionDisplay(drawingRevision ?? drawingVector.revision)

  const handleMouseDown = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    dragRef.current = { x: event.clientX, y: event.clientY }
  }

  const handleMouseMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!dragRef.current) return
    const dx = event.clientX - dragRef.current.x
    const dy = event.clientY - dragRef.current.y
    dragRef.current = { x: event.clientX, y: event.clientY }
    if (dx === 0 && dy === 0) return
    onUpdateDrawingViewport((prev) => ({
      ...prev,
      panX: Math.round((prev.panX + dx * 0.5) * 10) / 10,
      panY: Math.round((prev.panY + dy * 0.5) * 10) / 10,
    }))
  }

  const handleMouseUp = () => {
    dragRef.current = null
  }

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    const delta = event.deltaY < 0 ? 25 : -25
    onUpdateDrawingViewport((prev) => ({
      ...prev,
      zoomPercent: Math.max(50, Math.min(300, prev.zoomPercent + delta)),
    }))
  }

  const handleAnnotationKeyDown = (
    event: ReactKeyboardEvent<SVGGElement>,
    item: M2DrawingAnnotationItem,
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelectAnnotation(item)
    }
  }

  return (
    <div
      className="pa-drawing-svg-stage"
      data-testid="m2-drawing-vector-stage"
      data-drawing-revision={drawingRevision ?? drawingVector.revision}
      data-old-drawing-fallback={drawingFailure ? 'true' : 'false'}
    >
      <svg
        data-testid="m2-drawing-svg"
        className="pa-drawing-svg"
        viewBox={viewBoxStr}
        role="img"
        aria-label={`二维矢量工程图（${displayRev}，单位 ${drawingVector.unit}）`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {/* Engineering Sheet Border Frame */}
        <rect
          x="2"
          y="2"
          width={Math.max(10, layout.baseWidth - 4)}
          height={Math.max(10, layout.baseHeight - 4)}
          rx="1.5"
          className="pa-svg-frame"
        />

        {/* Title / Unit / Revision Header */}
        <g data-testid="m2-drawing-header">
          <text x="6" y="10" className="pa-svg-header-text">
            工程图 · 修订：{displayRev} · 单位：{drawingVector.unit}
          </text>
          {drawingFailure ? (
            <text x="6" y="18" className="pa-svg-fallback-text" data-testid="m2-drawing-fallback-badge">
              旧图回退：保留 {displayRev} 矢量与标注（新修订图纸失败）
            </text>
          ) : null}
        </g>

        {/* Orthographic Views (front / top / side) */}
        {layout.orderedViews.map((pv) => {
          const title = pv.view.title ?? VIEW_LABELS[pv.view.id]
          return (
            <g key={pv.view.id} data-view-id={pv.view.id}>
              <text
                x={pv.originX}
                y={pv.originY - 4}
                className="pa-svg-view-title"
                data-view-title={pv.view.id}
              >
                {title} ({pv.view.id})
              </text>

              {/* Solid outline lines */}
              {pv.view.lines.map((line, idx) => {
                const [x1, y1] = toSvgPoint(pv, line.x1, line.y1)
                const [x2, y2] = toSvgPoint(pv, line.x2, line.y2)
                return (
                  <line
                    key={`line-${pv.view.id}-${idx}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    className="pa-svg-outline"
                    data-primitive="line"
                  />
                )
              })}

              {/* Circles */}
              {pv.view.circles.map((circle, idx) => {
                const [cx, cy] = toSvgPoint(pv, circle.cx, circle.cy)
                return (
                  <circle
                    key={`circle-${pv.view.id}-${idx}`}
                    cx={cx}
                    cy={cy}
                    r={circle.r}
                    className="pa-svg-circle"
                    data-primitive="circle"
                  />
                )
              })}

              {/* Hidden dashed lines */}
              {pv.view.hiddenLines.map((line, idx) => {
                const [x1, y1] = toSvgPoint(pv, line.x1, line.y1)
                const [x2, y2] = toSvgPoint(pv, line.x2, line.y2)
                return (
                  <line
                    key={`hidden-${pv.view.id}-${idx}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    strokeDasharray="3 2"
                    className="pa-svg-hidden"
                    data-primitive="hidden-line"
                  />
                )
              })}
            </g>
          )
        })}

        {/* Feature-bound Dimension Annotations */}
        <g data-testid="m2-drawing-annotations">
          {renderableAnnotations.map((entry) => {
            const isSelected = selectedAnnotationId === entry.item.annotationId
            const isHighlighted = highlightedAnnotationIds.has(entry.item.annotationId)
            return (
              <g
                key={entry.item.annotationId}
                role="button"
                tabIndex={0}
                data-svg-annotation-id={entry.item.annotationId}
                data-annotation-id={entry.item.annotationId}
                data-highlighted={isHighlighted ? 'true' : 'false'}
                data-selected={isSelected ? 'true' : 'false'}
                aria-pressed={isSelected}
                aria-label={`${entry.item.label} ${entry.item.valueText}`}
                className={
                  isSelected
                    ? 'pa-svg-annotation pa-svg-annotation-selected'
                    : isHighlighted
                      ? 'pa-svg-annotation pa-svg-annotation-highlighted'
                      : 'pa-svg-annotation'
                }
                onClick={(event) => {
                  event.stopPropagation()
                  onSelectAnnotation(entry.item)
                }}
                onKeyDown={(event) => handleAnnotationKeyDown(event, entry.item)}
              >
                {entry.witness1 ? (
                  <line
                    x1={entry.witness1[0]}
                    y1={entry.witness1[1]}
                    x2={entry.witness1[2]}
                    y2={entry.witness1[3]}
                    className="pa-svg-dim-witness"
                  />
                ) : null}
                {entry.witness2 ? (
                  <line
                    x1={entry.witness2[0]}
                    y1={entry.witness2[1]}
                    x2={entry.witness2[2]}
                    y2={entry.witness2[3]}
                    className="pa-svg-dim-witness"
                  />
                ) : null}
                <line
                  x1={entry.dimX1}
                  y1={entry.dimY1}
                  x2={entry.dimX2}
                  y2={entry.dimY2}
                  className="pa-svg-dim-line"
                />
                <text
                  x={entry.textX}
                  y={entry.textY}
                  textAnchor="middle"
                  className="pa-svg-dim-text"
                >
                  {entry.item.label} {entry.item.valueText}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
