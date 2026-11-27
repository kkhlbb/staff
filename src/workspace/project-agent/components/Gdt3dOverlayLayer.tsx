import { useMemo, useState } from 'react'
import {
  computeAntiOverlapOffsets,
  formatFcfCells,
  formatGdtToleranceMm,
  GDT_KIND_META,
  GDT_MODIFIER_LABELS,
  mmToToleranceQ,
  shouldCollapseGdtAnnotation,
  validateGdtControlDraft,
  type GdtCalloutPatch,
} from '../gdt3dMath'
import type {
  DatumDefinition,
  GdtDisplayMode,
  GdtFeatureControl,
  GdtMaterialModifier,
  PickedFeatureGeometryKind,
} from '../assembly3dTypes'

export interface ProjectedGdtAnchor {
  readonly id: string
  readonly kind: 'fcf' | 'datum'
  readonly featureId: string
  readonly partId?: string
  readonly anchorX: number
  readonly anchorY: number
  readonly isPreview?: boolean
  readonly control?: GdtFeatureControl
  readonly datum?: DatumDefinition
}

export interface Gdt3dOverlayLayerProps {
  readonly anchors: readonly ProjectedGdtAnchor[]
  readonly datums: readonly DatumDefinition[]
  readonly featureKindById: ReadonlyMap<string, PickedFeatureGeometryKind>
  readonly displayMode: GdtDisplayMode
  readonly onChangeDisplayMode?: (mode: GdtDisplayMode) => void
  readonly hideModeToggle?: boolean
  readonly focusedPartIds: ReadonlySet<string>
  readonly focusedFeatureIds: ReadonlySet<string>
  readonly focusedLoopFeatureIds: ReadonlySet<string>
  readonly goldenPulseFeatureIds: ReadonlySet<string>
  readonly goldenPulseGdtIds: ReadonlySet<string>
  readonly readOnly?: boolean
  readonly editingGdtId?: string | null
  readonly onSelectGdtCallout?: (gdtId: string | null) => void
  readonly onHoverGdtCallout?: (
    target: {
      readonly gdtId?: string
      readonly datumId?: string
      readonly featureId: string
      readonly partId?: string
    } | null,
  ) => void
  readonly onUpdateGdtCallout?: (
    gdtId: string,
    patch: GdtCalloutPatch,
  ) => void
  readonly onDeleteGdtCallout?: (gdtId: string) => void
}

const MODIFIER_OPTIONS: readonly GdtMaterialModifier[] = ['RFS', 'MMC', 'LMC']

/**
 * 3D GD&T Feature Control Frame & Datum badge overlay layer:
 * - Renders standard ISO/ASME FCF boxes (5 geometric symbols, Ø, Ⓜ/Ⓛ, datum refs) & teal Datum badges
 * - Supports "智能防遮挡" (auto-collapse to 22px numbered dot, expand in place on hover/focus)
 *   and "全部展开" (all expanded with deterministic screen-space anti-overlap offsets)
 * - Supports click-to-edit inline micro-editor popover (disabled when `readOnly = true`)
 */
export function Gdt3dOverlayLayer({
  anchors,
  datums,
  featureKindById,
  displayMode,
  onChangeDisplayMode,
  hideModeToggle = false,
  focusedPartIds,
  focusedFeatureIds,
  focusedLoopFeatureIds,
  goldenPulseFeatureIds,
  goldenPulseGdtIds,
  readOnly = false,
  editingGdtId = null,
  onSelectGdtCallout,
  onHoverGdtCallout,
  onUpdateGdtCallout,
  onDeleteGdtCallout,
}: Gdt3dOverlayLayerProps) {
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null)
  const [inlineWarning, setInlineWarning] = useState<string | null>(null)

  const layoutMap = useMemo(() => {
    const boxes = anchors.map((item) => ({
      id: item.id,
      anchorX: item.anchorX,
      anchorY: item.anchorY,
      width: item.kind === 'fcf' ? (item.control?.kind === 'composite-position' ? 164 : 136) : 78,
      height: item.kind === 'fcf' ? (item.control?.kind === 'composite-position' ? 46 : 26) : 24,
    }))
    if (displayMode === 'expand-all') {
      return computeAntiOverlapOffsets(boxes, 6)
    }
    const map = new Map<
      string,
      { readonly offsetX: number; readonly offsetY: number; readonly labelX: number; readonly labelY: number }
    >()
    anchors.forEach((item, idx) => {
      const offsetX = idx % 2 === 0 ? 18 : -18
      const offsetY = -20
      map.set(item.id, {
        offsetX,
        offsetY,
        labelX: item.anchorX + offsetX,
        labelY: item.anchorY + offsetY,
      })
    })
    return map
  }, [anchors, displayMode])

  const editingAnchor = useMemo(() => {
    if (readOnly || !editingGdtId) return null
    return anchors.find((a) => a.kind === 'fcf' && a.control?.id === editingGdtId) ?? null
  }, [readOnly, editingGdtId, anchors])

  const fcfIndexById = useMemo(() => {
    const map = new Map<string, number>()
    let idx = 0
    for (const item of anchors) {
      if (item.kind === 'fcf' && item.control) {
        idx += 1
        map.set(item.id, idx)
      }
    }
    return map
  }, [anchors])

  if (anchors.length === 0 && !onChangeDisplayMode) {
    return null
  }

  return (
    <div className="pa-gdt-overlay-root" data-testid="gdt-3d-overlay-layer" data-display-mode={displayMode}>
      {/* Top-right lightweight Smart Anti-Occlusion <-> Expand All pill (hidden when hosted in bottom bar) */}
      {onChangeDisplayMode && !hideModeToggle ? (
        <div
          className="pa-gdt-mode-pill"
          role="group"
          aria-label="GD&T 标注显示模式"
          data-testid="gdt-display-mode-toggle"
        >
          <button
            type="button"
            data-testid="gdt-mode-smart"
            aria-pressed={displayMode === 'smart'}
            className={`pa-gdt-mode-btn ${displayMode === 'smart' ? 'pa-gdt-mode-btn-active' : ''}`}
            onClick={() => onChangeDisplayMode('smart')}
          >
            智能防遮挡
          </button>
          <button
            type="button"
            data-testid="gdt-mode-expand-all"
            aria-pressed={displayMode === 'expand-all'}
            className={`pa-gdt-mode-btn ${displayMode === 'expand-all' ? 'pa-gdt-mode-btn-active' : ''}`}
            onClick={() => onChangeDisplayMode('expand-all')}
          >
            全部展开
          </button>
        </div>
      ) : null}

      {/* 3D surface anchor dots & dashed leader lines */}
      {anchors.length > 0 ? (
        <svg className="pa-gdt-leader-svg" viewBox="0 0 320 220" aria-hidden="true">
          {anchors.map((item) => {
            const layout = layoutMap.get(item.id)
            const lx = layout?.labelX ?? item.anchorX
            const ly = layout?.labelY ?? item.anchorY
            const isGolden =
              goldenPulseFeatureIds.has(item.featureId) ||
              (item.control ? goldenPulseGdtIds.has(item.control.id) : false)
            return (
              <g key={`leader-${item.id}`} data-testid={`gdt-leader-${item.id}`}>
                <line
                  x1={item.anchorX.toFixed(1)}
                  y1={item.anchorY.toFixed(1)}
                  x2={lx.toFixed(1)}
                  y2={ly.toFixed(1)}
                  strokeDasharray="3 2"
                  className={
                    item.kind === 'datum'
                      ? 'pa-gdt-leader-line pa-gdt-leader-datum'
                      : isGolden
                        ? 'pa-gdt-leader-line pa-gdt-leader-golden'
                        : 'pa-gdt-leader-line'
                  }
                />
                <circle
                  cx={item.anchorX.toFixed(1)}
                  cy={item.anchorY.toFixed(1)}
                  r={3}
                  className={
                    item.kind === 'datum'
                      ? 'pa-gdt-anchor-dot pa-gdt-anchor-dot-datum'
                      : isGolden
                        ? 'pa-gdt-anchor-dot pa-gdt-anchor-dot-golden'
                        : 'pa-gdt-anchor-dot'
                  }
                />
              </g>
            )
          })}
        </svg>
      ) : null}

      {/* FCF & Datum Badges */}
      {anchors.map((item) => {
        const layout = layoutMap.get(item.id)
        const leftPct = Math.max(4, Math.min(96, ((layout?.labelX ?? item.anchorX) / 320) * 100))
        const topPct = Math.max(8, Math.min(92, ((layout?.labelY ?? item.anchorY) / 220) * 100))

        if (item.kind === 'datum' && item.datum) {
          const datum = item.datum
          const isGolden = goldenPulseFeatureIds.has(datum.featureId)
          return (
            <div
              key={item.id}
              className={`pa-gdt-anchor-wrap ${item.isPreview ? 'pa-gdt-preview' : ''}`}
              style={{ left: `${leftPct.toFixed(1)}%`, top: `${topPct.toFixed(1)}%` }}
              data-testid={`gdt-datum-${datum.id}`}
              data-datum-label={datum.label}
              data-feature-id={datum.featureId}
              data-preview={item.isPreview ? 'true' : 'false'}
              data-golden-pulse={isGolden ? 'true' : 'false'}
              onMouseEnter={() => {
                setHoveredAnnotationId(item.id)
                onHoverGdtCallout?.({
                  datumId: datum.id,
                  featureId: datum.featureId,
                  partId: item.partId,
                })
              }}
              onMouseLeave={() => {
                setHoveredAnnotationId((prev) => (prev === item.id ? null : prev))
                onHoverGdtCallout?.(null)
              }}
            >
              <span
                className={`pa-datum-badge ${isGolden ? 'gdt-fcf-golden-pulse' : ''}`}
                aria-label={`基准 ${datum.label}`}
              >
                <span aria-hidden="true">▼</span> 基准 {datum.label}
              </span>
            </div>
          )
        }

        if (item.kind === 'fcf' && item.control) {
          const indexNum = fcfIndexById.get(item.id) ?? 1
          const control = item.control
          const featureKind = featureKindById.get(control.featureId)
          const cells = formatFcfCells(control, datums, featureKind)
          const collapsed = shouldCollapseGdtAnnotation(
            {
              id: item.id,
              featureId: control.featureId,
              partId: item.partId,
              isPreview: item.isPreview,
            },
            {
              displayMode,
              focusedPartIds,
              focusedFeatureIds,
              focusedLoopFeatureIds,
              goldenPulseFeatureIds,
              goldenPulseGdtIds,
              hoveredAnnotationId,
              editingGdtId: readOnly ? null : editingGdtId,
            },
          )
          const isGolden =
            goldenPulseGdtIds.has(control.id) || goldenPulseFeatureIds.has(control.featureId)

          return (
            <div
              key={item.id}
              className={`pa-gdt-anchor-wrap ${collapsed ? 'pa-gdt-collapsed' : 'pa-gdt-expanded'} ${item.isPreview ? 'pa-gdt-preview' : ''}`}
              style={{ left: `${leftPct.toFixed(1)}%`, top: `${topPct.toFixed(1)}%` }}
              data-testid={`gdt-fcf-${control.id}`}
              data-gdt-id={control.id}
              data-gdt-kind={control.kind}
              data-feature-id={control.featureId}
              data-collapsed={collapsed ? 'true' : 'false'}
              data-golden-pulse={isGolden ? 'true' : 'false'}
              data-preview={item.isPreview ? 'true' : 'false'}
              data-offset-x={String(layout?.offsetX ?? 0)}
              data-offset-y={String(layout?.offsetY ?? 0)}
              onMouseEnter={() => {
                setHoveredAnnotationId(item.id)
                onHoverGdtCallout?.({
                  gdtId: control.id,
                  featureId: control.featureId,
                  partId: item.partId,
                })
              }}
              onMouseLeave={() => {
                setHoveredAnnotationId((prev) => (prev === item.id ? null : prev))
                onHoverGdtCallout?.(null)
              }}
              onFocus={() => setHoveredAnnotationId(item.id)}
              onBlur={() => setHoveredAnnotationId((prev) => (prev === item.id ? null : prev))}
            >
              {collapsed ? (
                <button
                  type="button"
                  className={`pa-gdt-dot ${isGolden ? 'gdt-fcf-golden-pulse' : ''}`}
                  data-testid={`gdt-dot-${control.id}`}
                  aria-label={`展开 GD&T 框格 #${indexNum} ${cells.summaryText}`}
                  onClick={() => {
                    setInlineWarning(null)
                    onSelectGdtCallout?.(control.id)
                  }}
                >
                  <span>{cells.symbol}</span>
                  <span className="pa-gdt-dot-idx">{indexNum}</span>
                </button>
              ) : cells.isComposite && cells.lowerSegment ? (
                <button
                  type="button"
                  className={`pa-fcf-box pa-fcf-composite ${isGolden ? 'gdt-fcf-golden-pulse' : ''} ${editingGdtId === control.id && !readOnly ? 'pa-fcf-editing' : ''}`}
                  data-testid={`gdt-fcf-box-${control.id}`}
                  data-composite="true"
                  data-golden-pulse={isGolden ? 'true' : 'false'}
                  aria-label={`复合 GD&T 特征控制框 ${cells.summaryText}`}
                  onClick={() => {
                    setInlineWarning(null)
                    onSelectGdtCallout?.(control.id)
                  }}
                >
                  <span className="pa-fcf-cell pa-fcf-sym pa-fcf-sym-span">{cells.symbol}</span>
                  <span className="pa-fcf-segments">
                    <span
                      className="pa-fcf-segment pa-fcf-segment-upper"
                      data-testid={`gdt-fcf-upper-${control.id}`}
                    >
                      <span className="pa-fcf-cell pa-fcf-val">
                        {cells.diameterPrefix}
                        {cells.toleranceText}
                        {cells.modifierSymbol ? (
                          <span className="pa-fcf-mod">{cells.modifierSymbol}</span>
                        ) : null}
                      </span>
                      {cells.datumCells.map((dc) => (
                        <span key={`${control.id}-u-${dc.datumId}`} className="pa-fcf-cell pa-fcf-datum">
                          {dc.label}
                          {dc.modifierSymbol ? (
                            <span className="pa-fcf-mod">{dc.modifierSymbol}</span>
                          ) : null}
                        </span>
                      ))}
                    </span>
                    <span
                      className="pa-fcf-segment pa-fcf-segment-lower"
                      data-testid={`gdt-fcf-lower-${control.id}`}
                    >
                      <span className="pa-fcf-cell pa-fcf-val">
                        {cells.lowerSegment.diameterPrefix}
                        {cells.lowerSegment.toleranceText}
                        {cells.lowerSegment.modifierSymbol ? (
                          <span className="pa-fcf-mod">{cells.lowerSegment.modifierSymbol}</span>
                        ) : null}
                      </span>
                      {cells.lowerSegment.datumCells.map((dc) => (
                        <span key={`${control.id}-l-${dc.datumId}`} className="pa-fcf-cell pa-fcf-datum">
                          {dc.label}
                          {dc.modifierSymbol ? (
                            <span className="pa-fcf-mod">{dc.modifierSymbol}</span>
                          ) : null}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className={`pa-fcf-box ${isGolden ? 'gdt-fcf-golden-pulse' : ''} ${editingGdtId === control.id && !readOnly ? 'pa-fcf-editing' : ''}`}
                  data-testid={`gdt-fcf-box-${control.id}`}
                  data-golden-pulse={isGolden ? 'true' : 'false'}
                  aria-label={`GD&T 特征控制框 ${cells.summaryText}`}
                  onClick={() => {
                    setInlineWarning(null)
                    onSelectGdtCallout?.(control.id)
                  }}
                >
                  <span className="pa-fcf-cell pa-fcf-sym">{cells.symbol}</span>
                  <span className="pa-fcf-cell pa-fcf-val">
                    {cells.diameterPrefix}
                    {cells.toleranceText}
                    {cells.unequalUzText ? (
                      <span className="pa-fcf-uz" data-testid={`gdt-fcf-uz-${control.id}`}>
                        {cells.unequalUzText}
                      </span>
                    ) : null}
                    {cells.modifierSymbol ? (
                      <span className="pa-fcf-mod">{cells.modifierSymbol}</span>
                    ) : null}
                  </span>
                  {cells.datumCells.map((dc) => (
                    <span key={`${control.id}-${dc.datumId}`} className="pa-fcf-cell pa-fcf-datum">
                      {dc.label}
                      {dc.modifierSymbol ? (
                        <span className="pa-fcf-mod">{dc.modifierSymbol}</span>
                      ) : null}
                    </span>
                  ))}
                </button>
              )}
            </div>
          )
        }

        return null
      })}

      {/* Inline Micro-Editor Popover (only in editable workbench mode) */}
      {!readOnly && editingAnchor?.control ? (
        <div
          className="pa-gdt-inline-popover"
          role="dialog"
          aria-label="GD&T 就地微调气泡"
          data-testid="gdt-inline-editor"
          data-editing-gdt-id={editingAnchor.control.id}
        >
          <div className="pa-header">
            <strong>
              {GDT_KIND_META[editingAnchor.control.kind].symbol}{' '}
              {GDT_KIND_META[editingAnchor.control.kind].label}微调
            </strong>
            <button
              type="button"
              className="pa-icon-btn"
              aria-label="关闭微调气泡"
              onClick={() => {
                setInlineWarning(null)
                onSelectGdtCallout?.(null)
              }}
            >
              ×
            </button>
          </div>

          <label className="pa-gdt-inline-row">
            <span>{editingAnchor.control.kind === 'composite-position' ? '上格 PLTZF (mm)' : '公差值 (mm)'}</span>
            <input
              type="range"
              data-testid="gdt-inline-slider"
              aria-label="就地微调公差滑块"
              min={0.01}
              max={0.5}
              step={0.01}
              value={Number((editingAnchor.control.toleranceQ / 10000).toFixed(3))}
              onChange={(event) => {
                const nextQ = mmToToleranceQ(Number(event.target.value))
                const lower = editingAnchor.control?.lowerSegment
                if (editingAnchor.control?.kind === 'composite-position' && lower && lower.toleranceQ > nextQ) {
                  setInlineWarning('上格公差不可小于下格 FRTZF 公差，已自动同步下格上限。')
                  onUpdateGdtCallout?.(editingAnchor.control.id, {
                    toleranceQ: nextQ,
                    lowerSegment: { ...lower, toleranceQ: nextQ },
                  })
                  return
                }
                setInlineWarning(null)
                onUpdateGdtCallout?.(editingAnchor.control!.id, { toleranceQ: nextQ })
              }}
            />
            <input
              type="number"
              data-testid="gdt-inline-number"
              aria-label="就地微调公差数值"
              className="pa-gdt-inline-num"
              min={0.01}
              max={0.5}
              step={0.01}
              value={formatGdtToleranceMm(editingAnchor.control.toleranceQ)}
              onChange={(event) => {
                const parsed = Number(event.target.value)
                if (Number.isFinite(parsed) && parsed > 0) {
                  const nextQ = mmToToleranceQ(parsed)
                  const lower = editingAnchor.control?.lowerSegment
                  if (editingAnchor.control?.kind === 'composite-position' && lower && lower.toleranceQ > nextQ) {
                    setInlineWarning('上格（PLTZF）公差不可小于下格（FRTZF）公差。')
                    return
                  }
                  setInlineWarning(null)
                  onUpdateGdtCallout?.(editingAnchor.control!.id, {
                    toleranceQ: nextQ,
                  })
                }
              }}
            />
          </label>

          {editingAnchor.control.kind === 'composite-position' && editingAnchor.control.lowerSegment ? (
            <label className="pa-gdt-inline-row" data-testid="gdt-inline-lower-row">
              <span>下格 FRTZF (mm)</span>
              <input
                type="range"
                data-testid="gdt-inline-lower-slider"
                aria-label="复合位置度下格公差滑块"
                min={0.01}
                max={Number((editingAnchor.control.toleranceQ / 10000).toFixed(3))}
                step={0.01}
                value={Number((editingAnchor.control.lowerSegment.toleranceQ / 10000).toFixed(3))}
                onChange={(event) => {
                  const nextLowerQ = mmToToleranceQ(Number(event.target.value))
                  const candidate: GdtFeatureControl = {
                    ...editingAnchor.control!,
                    lowerSegment: { ...editingAnchor.control!.lowerSegment!, toleranceQ: nextLowerQ },
                  }
                  const validation = validateGdtControlDraft(candidate, { featureKindById, datums })
                  if (!validation.valid) {
                    setInlineWarning(validation.errors[0] ?? '下格公差不可大于上格公差。')
                    return
                  }
                  setInlineWarning(null)
                  onUpdateGdtCallout?.(editingAnchor.control!.id, {
                    lowerSegment: candidate.lowerSegment,
                  })
                }}
              />
              <span className="pa-mono">
                {formatGdtToleranceMm(editingAnchor.control.lowerSegment.toleranceQ)}
              </span>
            </label>
          ) : null}

          {editingAnchor.control.kind === 'profile-surface' ? (
            <label className="pa-gdt-inline-row" data-testid="gdt-inline-uz-row">
              <span>UZ 外侧比例</span>
              <input
                type="range"
                data-testid="gdt-inline-uz-slider"
                aria-label="面轮廓度 UZ 不等距外侧比例"
                min={0}
                max={1}
                step={0.05}
                value={editingAnchor.control.unequalProfileOuterFraction ?? 0.5}
                onChange={(event) => {
                  const nextFrac = Number(event.target.value)
                  setInlineWarning(null)
                  onUpdateGdtCallout?.(editingAnchor.control!.id, {
                    unequalProfileOuterFraction: nextFrac,
                  })
                }}
              />
              <span className="pa-mono">
                {Math.abs((editingAnchor.control.unequalProfileOuterFraction ?? 0.5) - 0.5) < 1e-6
                  ? '对称'
                  : `${Math.round((editingAnchor.control.unequalProfileOuterFraction ?? 0.5) * 100)}%`}
              </span>
            </label>
          ) : null}

          <div className="pa-gdt-inline-mods" role="group" aria-label="实体条件切换">
            {MODIFIER_OPTIONS.map((mod) => {
              const active = (editingAnchor.control?.modifier ?? 'RFS') === mod
              return (
                <button
                  key={mod}
                  type="button"
                  data-testid={`gdt-inline-mod-${mod}`}
                  aria-pressed={active}
                  className={active ? 'pa-btn pa-btn-primary pa-btn-sm' : 'pa-btn pa-btn-ghost pa-btn-sm'}
                  onClick={() => {
                    const candidate: GdtFeatureControl = {
                      ...editingAnchor.control!,
                      modifier: mod,
                    }
                    const validation = validateGdtControlDraft(candidate, {
                      featureKindById,
                      datums,
                    })
                    if (!validation.valid) {
                      setInlineWarning(validation.errors[0] ?? '当前特征不支持此实体修正符。')
                      return
                    }
                    setInlineWarning(null)
                    onUpdateGdtCallout?.(editingAnchor.control!.id, { modifier: mod })
                  }}
                >
                  {GDT_MODIFIER_LABELS[mod]}
                </button>
              )
            })}
          </div>

          {inlineWarning ? (
            <div className="pa-notice pa-gdt-inline-warn" role="alert" data-testid="gdt-inline-warning">
              {inlineWarning}
            </div>
          ) : null}

          <div className="pa-gdt-inline-footer">
            {onDeleteGdtCallout ? (
              <button
                type="button"
                className="pa-btn pa-btn-ghost pa-btn-sm"
                data-testid="gdt-inline-delete"
                onClick={() => {
                  const idToDelete = editingAnchor.control!.id
                  setInlineWarning(null)
                  onSelectGdtCallout?.(null)
                  onDeleteGdtCallout(idToDelete)
                }}
              >
                删除框格
              </button>
            ) : null}
            <button
              type="button"
              className="pa-btn pa-btn-sm"
              onClick={() => {
                setInlineWarning(null)
                onSelectGdtCallout?.(null)
              }}
            >
              完成
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
