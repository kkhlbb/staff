import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { parseDxfDocument } from '../dxf-view/parse'
import {
  buildModelScene,
  buildPaperScene,
  defaultHiddenLayers,
  fitViewBox,
  panViewBox,
  sceneContentBounds,
  zoomViewBox,
  clientToScene,
  type ViewBox,
} from '../dxf-view/scene'
import {
  displayArcPoint,
  entityKeyPoints,
  entityRadius,
  formatMeasuredDistance,
  pickEntity,
  snapPoint,
} from '../dxf-view/hit'
import type { DxfDocument, DxfEntity, DxfScene, SceneShape } from '../dxf-view/types'
import './DxfViewer.css'

export interface DxfViewerProps {
  fileName: string
  bytes: Uint8Array
  onClose?: () => void
}

const SPACE_LABEL: Record<'model' | 'paper', string> = {
  model: '模型空间',
  paper: '图纸空间',
}

function shapePath(shape: Extract<SceneShape, { kind: 'arc' }>): string {
  const start = displayArcPoint(shape, shape.startDeg)
  const end = displayArcPoint(shape, shape.endDeg)
  const sweep = ((shape.endDeg - shape.startDeg) % 360 + 360) % 360
  const largeArc = sweep > 180 ? 1 : 0
  const number = (value: number): string => String(Math.round(value * 1e4) / 1e4)
  return `M ${number(start.x)} ${number(start.y)} A ${number(shape.r)} ${number(shape.r)} 0 ${largeArc} 0 ${number(end.x)} ${number(end.y)}`
}

function ShapeElement({ shape, color, index }: { shape: SceneShape; color: string; index: number }): JSX.Element {
  if (shape.kind === 'line') {
    return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} stroke={color} />
  }
  if (shape.kind === 'polyline') {
    return (
      <polyline
        points={shape.points.map((point) => `${point.x},${point.y}`).join(' ')}
        fill="none"
        stroke={color}
      />
    )
  }
  if (shape.kind === 'circle') {
    return <circle cx={shape.cx} cy={shape.cy} r={shape.r} fill="none" stroke={color} />
  }
  if (shape.kind === 'arc') {
    return <path d={shapePath(shape)} fill="none" stroke={color} />
  }
  const lines = shape.text.split('\n')
  return (
    <text
      key={index}
      x={shape.x}
      y={shape.y}
      fontSize={Math.max(shape.height, 0.01)}
      textAnchor={shape.anchor}
      dominantBaseline={shape.baseline === 'middle' ? 'middle' : undefined}
      transform={shape.rotationDeg === 0 ? undefined : `rotate(${shape.rotationDeg} ${shape.x} ${shape.y})`}
      fill={color}
      className="dxf-viewer__text"
    >
      {lines.map((line, lineIndex) => (
        <tspan key={lineIndex} x={shape.x} dy={lineIndex === 0 ? 0 : shape.height * 1.4}>
          {line === '' ? ' ' : line}
        </tspan>
      ))}
    </text>
  )
}

function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

function EntityInspector({
  entity,
  viaViewport,
}: {
  entity: DxfEntity | null
  viaViewport: string | null
}): JSX.Element {
  if (entity === null) {
    return (
      <div className="dxf-viewer__inspector-empty">
        <p>点选实体查看类型、图层、坐标与文字。</p>
        <p>只读：不会写回文件，也不修改原图。</p>
      </div>
    )
  }
  const keys = entityKeyPoints(entity)
  const radius = entityRadius(entity)
  return (
    <dl className="dxf-viewer__inspector" data-testid="dxf-inspector">
      <dt>类型</dt>
      <dd data-testid="dxf-selected-type">{entity.type}</dd>
      <dt>图层</dt>
      <dd>{entity.layer}</dd>
      <dt>空间</dt>
      <dd>
        {SPACE_LABEL[entity.space]}
        {viaViewport === null ? '' : `（经视口 ${viaViewport}）`}
      </dd>
      {entity.text !== undefined && (
        <>
          <dt>{entity.type === 'DIMENSION' ? '标注值' : '文字'}</dt>
          <dd data-testid="dxf-selected-text">{entity.text}</dd>
        </>
      )}
      {entity.dimension !== undefined && (
        <>
          <dt>实测值（组码 42）</dt>
          <dd>{formatNumber(entity.dimension.measurement)}</dd>
          <dt>标注类型</dt>
          <dd>{entity.dimension.dimensionType}</dd>
          <dt>匿名块</dt>
          <dd>{entity.dimension.blockName || '（无）'}</dd>
          {entity.dimension.textOverride !== null && (
            <>
              <dt>文件里的文字覆盖值</dt>
              <dd>{entity.dimension.textOverride || '（空）'}</dd>
            </>
          )}
        </>
      )}
      {radius !== null && (
        <>
          <dt>半径</dt>
          <dd>{formatNumber(radius)}</dd>
        </>
      )}
      {keys.length > 0 && (
        <>
          <dt>关键坐标</dt>
          <dd>
            {keys.map((item) => (
              <span key={item.label} className="dxf-viewer__coord">
                {item.label} ({formatNumber(item.point.x)}, {formatNumber(item.point.y)})
              </span>
            ))}
          </dd>
        </>
      )}
    </dl>
  )
}

function layerRows(doc: DxfDocument) {
  return doc.layers.map((layer) => ({ ...layer }))
}

export function DxfViewer({ fileName, bytes, onClose }: DxfViewerProps): JSX.Element {
  const doc = useMemo<DxfDocument>(() => parseDxfDocument({ bytes, fileName }), [bytes, fileName])
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(defaultHiddenLayers(doc)))
  const [space, setSpace] = useState<'model' | 'paper'>(doc.hasPaperSpace ? 'paper' : 'model')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viaViewport, setViaViewport] = useState<string | null>(null)
  const [measureMode, setMeasureMode] = useState(false)
  const [measurePoints, setMeasurePoints] = useState<{ x: number; y: number }[]>([])

  const scene = useMemo<DxfScene | null>(() => {
    if (space === 'paper') return buildPaperScene(doc, hidden) ?? buildModelScene(doc, hidden)
    return buildModelScene(doc, hidden)
  }, [doc, hidden, space])

  /** 适应窗口的基准：不随图层开关变化，避免一关图层画面就跳。 */
  const fitBox = useMemo<ViewBox>(() => {
    if (space === 'paper') {
      const paper = buildPaperScene(doc, new Set())
      if (paper !== null) return { ...paper.box }
    }
    return fitViewBox(sceneContentBounds(buildModelScene(doc, new Set())))
  }, [doc, space])

  const [view, setView] = useState<ViewBox>(() => fitBox)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{ clientX: number; clientY: number; view: ViewBox; moved: number } | null>(null)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- 切换模型/图纸空间是用户动作，重置视图、选择与量距点是预期行为，不是渲染副作用。 */
    setView({ ...fitBox })
    setSelectedId(null)
    setViaViewport(null)
    setMeasurePoints([])
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [fitBox])

  useEffect(() => {
    const svg = svgRef.current
    if (svg === null) return undefined
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = svg.getBoundingClientRect()
      const factor = Math.exp(-event.deltaY * 0.0015)
      setView((current) => {
        const anchor = clientToScene(rect, current, event.clientX, event.clientY)
        return zoomViewBox(current, Math.min(4, Math.max(0.25, factor)), anchor.x, anchor.y)
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const selected = useMemo(() => {
    if (selectedId === null) return null
    return doc.entities.find((entity) => entity.id === selectedId) ?? null
  }, [doc, selectedId])

  const tolerance = Math.max(view.width, view.height) / 350

  function pointFromEvent(event: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const svg = svgRef.current
    if (svg === null) return null
    return clientToScene(svg.getBoundingClientRect(), view, event.clientX, event.clientY)
  }

  function handleClick(event: React.MouseEvent<SVGSVGElement>): void {
    if (scene === null) return
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    const point = pointFromEvent(event)
    if (point === null) return
    if (measureMode) {
      const snapped = snapPoint(scene, point, tolerance * 2)
      setMeasurePoints((current) => (current.length >= 2 ? [snapped] : [...current, snapped]))
      return
    }
    const picked = pickEntity(scene, point, tolerance)
    setSelectedId(picked?.entityId ?? null)
    setViaViewport(picked?.viaViewport ?? null)
  }

  function handleMouseDown(event: React.MouseEvent<SVGSVGElement>): void {
    if (event.button !== 0) return
    dragRef.current = { clientX: event.clientX, clientY: event.clientY, view, moved: 0 }
  }

  function handleMouseMove(event: React.MouseEvent<SVGSVGElement>): void {
    const drag = dragRef.current
    if (drag === null) return
    const svg = svgRef.current
    if (svg === null) return
    const rect = svg.getBoundingClientRect()
    const scale = Math.min(rect.width / (drag.view.width || 1), rect.height / (drag.view.height || 1)) || 1
    const dx = (event.clientX - drag.clientX) / scale
    const dy = (event.clientY - drag.clientY) / scale
    drag.moved = Math.max(drag.moved, Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY))
    setView(panViewBox(drag.view, -dx, -dy))
  }

  function handleMouseUp(): void {
    const drag = dragRef.current
    dragRef.current = null
    suppressClickRef.current = drag !== null && drag.moved > 3
  }

  function toggleLayer(name: string): void {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function fit(): void {
    setView({ ...fitBox })
  }

  function zoomBy(factor: number): void {
    const center = { x: view.x + view.width / 2, y: view.y + view.height / 2 }
    setView(zoomViewBox(view, factor, center.x, center.y))
  }

  const measureDistance =
    measurePoints.length === 2
      ? Math.hypot(measurePoints[1].x - measurePoints[0].x, measurePoints[1].y - measurePoints[0].y)
      : null
  const unsupportedTotal = doc.unsupported.reduce((total, item) => total + item.count, 0)
  const layoutName = doc.layouts.find((layout) => layout.name.toLowerCase() !== 'model')?.name ?? '图纸空间'

  const fitScale = scene === null ? 1 : scene.box.width / (view.width === 0 ? 1 : view.width)
  const zoomPercent = Math.max(1, Math.round(fitScale * 100))

  return (
    <div className="dxf-viewer" aria-label="DXF 看图（只读）">
      <header className="dxf-viewer__header">
        <div>
          <h1>{fileName}</h1>
          <p className="dxf-viewer__meta">
            <span>DXF {doc.version === 'unknown' ? `未知版本 ${doc.header.acadVersion || '（无 $ACADVER）'}` : doc.version}</span>
            <span>编码 {doc.encoding.charset.toUpperCase()}（{doc.encoding.codepage || '未声明'}）</span>
            <span>{doc.header.insUnits === 4 ? '单位 mm（$INSUNITS=4）' : '单位未声明（按图纸单位）'}</span>
            <span>{doc.layers.length} 个图层</span>
            <span>{doc.entities.length} 个已渲染实体</span>
          </p>
        </div>
        {onClose !== undefined && (
          <button type="button" onClick={onClose} aria-label="关闭 DXF 看图">关闭</button>
        )}
      </header>

      {doc.encoding.warning && (
        <p role="alert" className="dxf-viewer__encoding-warning" data-testid="dxf-encoding-warning">
          本文件编码未识别，文字可能不正确。{doc.encoding.detail}
        </p>
      )}
      {doc.version === 'unknown' && (
        <p className="dxf-viewer__note" role="status">
          该文件版本（{doc.header.acadVersion || '未知'}）未专门验证，按通用 DXF 组码只读解析。
        </p>
      )}
      {doc.notes.length > 0 && (
        <ul className="dxf-viewer__notes" aria-label="解析说明">
          {doc.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <div className="dxf-viewer__body">
        <aside className="dxf-viewer__layers" aria-label="图层">
          <h2>图层</h2>
          <ul>
            {layerRows(doc).map((layer) => {
              const visible = !hidden.has(layer.name)
              return (
                <li key={layer.name}>
                  <label>
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={() => toggleLayer(layer.name)}
                      aria-label={`显示图层 ${layer.name}`}
                    />
                    <span className="dxf-viewer__swatch" style={{ background: aciSwatch(layer.color) }} />
                    <span>{layer.name}</span>
                    <span className="dxf-viewer__aci">ACI {layer.color}</span>
                  </label>
                </li>
              )
            })}
          </ul>
          <h2>未支持实体</h2>
          {unsupportedTotal === 0 ? (
            <p data-testid="dxf-unsupported-empty">全部实体均已渲染（0 个未支持）。</p>
          ) : (
            <ul className="dxf-viewer__unsupported" data-testid="dxf-unsupported">
              {doc.unsupported.map((item) => (
                <li key={item.type}>
                  未渲染 {item.count} 个 {item.type}（不支持）
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="dxf-viewer__canvas" aria-label="图纸画布">
          <div className="dxf-viewer__toolbar" role="toolbar" aria-label="查看工具">
            <div role="tablist" aria-label="空间" className="dxf-viewer__tabs">
              <button
                type="button"
                role="tab"
                aria-selected={space === 'model'}
                onClick={() => setSpace('model')}
              >
                模型
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={space === 'paper'}
                disabled={!doc.hasPaperSpace}
                title={doc.hasPaperSpace ? undefined : 'R12 文件没有图纸空间'}
                onClick={() => setSpace('paper')}
              >
                {layoutName}
              </button>
            </div>
            <button type="button" onClick={fit}>适应窗口</button>
            <button type="button" onClick={() => zoomBy(1.25)} aria-label="放大">＋</button>
            <button type="button" onClick={() => zoomBy(0.8)} aria-label="缩小">－</button>
            <span className="dxf-viewer__zoom" data-testid="dxf-zoom">{zoomPercent}%</span>
            <button
              type="button"
              aria-pressed={measureMode}
              onClick={() => {
                setMeasureMode(!measureMode)
                setMeasurePoints([])
              }}
            >
              量距
            </button>
            <span className="dxf-viewer__hint">
              {measureMode ? '点两点量距（自动咬合端点/圆心）；再次点按重新开始。' : '拖动平移，滚轮缩放；点实体查看属性。'}
            </span>
          </div>
          <svg
            ref={svgRef}
            className={`dxf-viewer__svg${measureMode ? ' is-measuring' : ''}`}
            viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`${fileName} 的 ${SPACE_LABEL[space]} 只读预览`}
            onClick={handleClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            data-testid="dxf-canvas"
            style={{ cursor: measureMode ? 'crosshair' : 'grab' }}
          >
            <rect
              x={view.x}
              y={view.y}
              width={view.width}
              height={view.height}
              fill="var(--dxf-paper, #ffffff)"
            />
            {space === 'paper' && <rect {...paperRect(doc)} fill="#ffffff" stroke="#CBD5E1" strokeWidth={0.4} />}
            <defs>
              {(scene?.viewports ?? []).map((viewport) => (
                <clipPath key={viewport.id} id={`dxf-clip-${viewport.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`}>
                  <rect
                    x={viewport.rect.x}
                    y={viewport.rect.y}
                    width={viewport.rect.width}
                    height={viewport.rect.height}
                  />
                </clipPath>
              ))}
            </defs>
            {scene?.entities.map((entity) => (
              <g
                key={entity.entityId}
                className="dxf-viewer__entity"
                data-entity-id={entity.entityId}
                data-entity-type={entity.type}
                data-layer={entity.layer}
                opacity={selectedId === entity.entityId ? 1 : undefined}
              >
                {entity.shapes.map((shape, index) => (
                  <ShapeElement key={`${entity.entityId}:${index}`} shape={shape} color={entity.color} index={index} />
                ))}
              </g>
            ))}
            {(scene?.viewports ?? []).map((viewport) => (
              <g
                key={viewport.id}
                clipPath={`url(#dxf-clip-${viewport.id.replace(/[^a-zA-Z0-9_-]/g, '_')})`}
                data-viewport={viewport.id}
              >
                {viewport.entities.map((entity) => (
                  <g
                    key={`${viewport.id}:${entity.entityId}`}
                    data-entity-id={entity.entityId}
                    data-entity-type={entity.type}
                    data-layer={entity.layer}
                    data-via-viewport={viewport.id}
                  >
                    {entity.shapes.map((shape, index) => (
                      <ShapeElement
                        key={`${viewport.id}:${entity.entityId}:${index}`}
                        shape={shape}
                        color={entity.color}
                        index={index}
                      />
                    ))}
                  </g>
                ))}
              </g>
            ))}
            {selected !== null && <SelectionHalo scene={scene} entity={selected} viaViewport={viaViewport} />}
            {measurePoints.map((point, index) => (
              <circle key={`measure-${index}`} cx={point.x} cy={point.y} r={Math.max(view.width, view.height) / 220} fill="none" stroke="#B91C1C" strokeWidth={1.5} />
            ))}
            {measurePoints.length === 2 && (
              <>
                <line
                  x1={measurePoints[0].x}
                  y1={measurePoints[0].y}
                  x2={measurePoints[1].x}
                  y2={measurePoints[1].y}
                  stroke="#B91C1C"
                  strokeDasharray="4 3"
                />
                <text
                  x={(measurePoints[0].x + measurePoints[1].x) / 2}
                  y={(measurePoints[0].y + measurePoints[1].y) / 2 - Math.max(view.width, view.height) / 90}
                  fontSize={Math.max(view.width, view.height) / 55}
                  textAnchor="middle"
                  fill="#B91C1C"
                >
                  {formatMeasuredDistance(measureDistance ?? 0, doc.header.insUnits)}
                </text>
              </>
            )}
          </svg>
        </section>

        <aside className="dxf-viewer__side" aria-label="实体属性与量距">
          <h2>属性</h2>
          <EntityInspector entity={selected} viaViewport={viaViewport} />
          <h2>量距</h2>
          <p data-testid="dxf-measure">
            {measureDistance === null
              ? measureMode
                ? `已取 ${measurePoints.length} 点，再点 1 点。`
                : '点「量距」后选两点。'
              : formatMeasuredDistance(measureDistance, doc.header.insUnits)}
          </p>
          {measurePoints.length > 0 && (
            <p className="dxf-viewer__measure-space">
              当前量的是{SPACE_LABEL[space]}的显示距离
              {doc.header.insUnits === 4 ? '（mm）' : '（图纸单位）'}。
            </p>
          )}
          <h2>只读</h2>
          <p>本看图只解析字节：不写回文件、不修改原图、不联网。</p>
          <details>
            <summary>文件头</summary>
            <ul>
              <li>$ACADVER：{doc.header.acadVersion || '（无）'}</li>
              <li>$DWGCODEPAGE：{doc.header.codepage || '（无）'}</li>
              <li>$INSUNITS：{doc.header.insUnits === null ? '（无）' : String(doc.header.insUnits)}</li>
              <li>图层表：{doc.layers.length} 项</li>
              <li>布局：{doc.layouts.map((layout) => layout.name).join('、') || '（无 LAYOUT 对象）'}</li>
            </ul>
          </details>
          <p className="dxf-viewer__sr-only">{doc.encoding.detail}</p>
        </aside>
      </div>
    </div>
  )
}

function aciSwatch(index: number): string {
  const palette: Record<number, string> = {
    1: '#E01B1B',
    2: '#C9A200',
    3: '#1B8A3A',
    4: '#0E7C9E',
    5: '#1F4FD8',
    6: '#B01BB0',
    7: '#1B2430',
  }
  return palette[index] ?? '#6B7280'
}

function paperRect(doc: DxfDocument): { x: number; y: number; width: number; height: number } {
  const size = doc.paperSize ?? { width: 420, height: 297 }
  const min = doc.header.paperMin ?? { x: 0, y: 0 }
  return { x: min.x, y: -(min.y + size.height), width: size.width, height: size.height }
}

function SelectionHalo({
  scene,
  entity,
  viaViewport,
}: {
  scene: DxfScene | null
  entity: DxfEntity
  viaViewport: string | null
}): JSX.Element | null {
  if (scene === null) return null
  let shapes: SceneShape[]
  if (viaViewport === null) {
    const view = scene.entities.find((item) => item.entityId === entity.id)
    if (view === undefined) return null
    shapes = view.shapes
  } else {
    const viewport = scene.viewports.find((item) => item.id === viaViewport)
    const view = viewport?.entities.find((item) => item.entityId === entity.id)
    if (view === undefined) return null
    shapes = view.shapes
  }
  return (
    <g className="dxf-viewer__selection" pointerEvents="none" data-testid="dxf-selection">
      {shapes.map((shape, index) => (
        <ShapeElement key={`halo:${index}`} shape={shape} color="#B91C1C" index={index} />
      ))}
    </g>
  )
}
