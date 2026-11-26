import { useMemo, useState } from 'react'
import { formatHumanReadableFeatureLabel, resolveContextPillActions } from '../assembly3dMath'
import type {
  AssemblyFeatureSelectionItem,
  ContextPillActionId,
  DatumDefinition,
  GdtFeatureControl,
  GdtMaterialModifier,
  PickedFeatureGeometryKind,
} from '../assembly3dTypes'
import {
  DATUM_LETTER_OPTIONS,
  GDT_KIND_META,
  GDT_KIND_ORDER,
  GDT_MODIFIER_LABELS,
  mmToToleranceQ,
  validateGdtControlDraft,
  type DatumLetter,
} from '../gdt3dMath'
import type { M2ModelFeatureItem } from '../m2WorkbenchBridge'

export interface ContextActionPillProps {
  readonly selectedFeature: M2ModelFeatureItem | null
  readonly selectedFeatures?: readonly M2ModelFeatureItem[]
  readonly sidebarMode: 'external' | 'builtin'
  readonly contextActionFeedback: string | null
  readonly onBringIntoNextPrompt: () => void
  readonly onCopyToExternalSession: () => void
  readonly onClearSelection: () => void
  /** M1B 3D assembly smart context pill mode. */
  readonly assemblyMode?: boolean
  readonly selectedAssemblyItems?: readonly AssemblyFeatureSelectionItem[]
  readonly additivePickMode?: boolean
  readonly onExecuteAssemblyAction?: (actionId: ContextPillActionId) => void
  /** M3G GD&T & Datum creation callbacks. */
  readonly datums?: readonly DatumDefinition[]
  readonly featureKindById?: ReadonlyMap<string, PickedFeatureGeometryKind>
  readonly onAssignDatum?: (featureId: string, letter: DatumLetter) => void
  readonly onCreateGdtControl?: (control: GdtFeatureControl) => void
}

const MODIFIER_OPTIONS: readonly GdtMaterialModifier[] = ['RFS', 'MMC', 'LMC']

/**
 * Floating bottom-center smart contextual action pill.
 * Strictly 100% hidden when nothing is selected (GUI-V2-UX-01 invariant).
 * - In M0/M1 single-part mode (`assemblyMode = false`): preserves existing behavior.
 * - In M1B/M3G 3D assembly mode (`assemblyMode = true`): shows selection count badge,
 *   human-readable feature labels (zero raw internal IDs), dynamic atomic actions,
 *   1-2 click Datum A/B/C assignment, and lightweight GD&T config popover with live validation.
 */
export function ContextActionPill({
  selectedFeature,
  selectedFeatures,
  sidebarMode,
  contextActionFeedback,
  onBringIntoNextPrompt,
  onCopyToExternalSession,
  onClearSelection,
  assemblyMode = false,
  selectedAssemblyItems = [],
  additivePickMode = false,
  onExecuteAssemblyAction,
  datums = [],
  featureKindById,
  onAssignDatum,
  onCreateGdtControl,
}: ContextActionPillProps) {
  const [openPopover, setOpenPopover] = useState<'none' | 'datum' | 'gdt'>('none')
  const [gdtKind, setGdtKind] = useState<GdtFeatureControl['kind']>('position')
  const [toleranceMmInput, setToleranceMmInput] = useState('0.12')
  const [modifier, setModifier] = useState<GdtMaterialModifier>('RFS')
  const [selectedDatumIds, setSelectedDatumIds] = useState<readonly string[]>([])
  const [datumModifiers, setDatumModifiers] = useState<Readonly<Record<string, GdtMaterialModifier>>>({})
  const [sizeLowerMm, setSizeLowerMm] = useState('-0.05')
  const [sizeUpperMm, setSizeUpperMm] = useState('0.05')

  const primarySelected = selectedAssemblyItems[0] ?? null
  const effectiveFeatureKindMap = useMemo(() => {
    const map = new Map<string, PickedFeatureGeometryKind>(featureKindById ?? [])
    for (const item of selectedAssemblyItems) {
      map.set(item.featureId, item.geometryKind)
    }
    return map
  }, [featureKindById, selectedAssemblyItems])

  const draftGdtControl = useMemo<GdtFeatureControl | null>(() => {
    if (!primarySelected) return null
    const tolMm = Number(toleranceMmInput)
    const lowerMm = Number(sizeLowerMm)
    const upperMm = Number(sizeUpperMm)
    const isCyl = primarySelected.geometryKind === 'cylindrical-hole-axis'
    const zoneShape: GdtFeatureControl['zoneShape'] =
      gdtKind === 'coaxiality' || (gdtKind === 'position' && isCyl) ? 'cylindrical' : 'planar'
    return {
      id: `gdt-draft-preview-${primarySelected.featureId}`,
      featureId: primarySelected.featureId,
      kind: gdtKind,
      toleranceQ: Number.isFinite(tolMm) ? mmToToleranceQ(tolMm) : 0,
      modifier,
      datumIds: [...selectedDatumIds],
      datumModifiers:
        selectedDatumIds.length > 0
          ? selectedDatumIds.map((id) => datumModifiers[id] ?? 'RFS')
          : undefined,
      zoneShape,
      ...(modifier === 'MMC' || modifier === 'LMC'
        ? {
            featureSizeToleranceQ: {
              lowerQ: Number.isFinite(lowerMm) ? Math.round(lowerMm * 10000) : -500,
              upperQ: Number.isFinite(upperMm) ? Math.round(upperMm * 10000) : 500,
            },
          }
        : {}),
    }
  }, [primarySelected, gdtKind, toleranceMmInput, modifier, selectedDatumIds, datumModifiers, sizeLowerMm, sizeUpperMm])

  const validation = useMemo(() => {
    if (!draftGdtControl) {
      return { valid: false, errors: [] as readonly string[], warnings: [] }
    }
    return validateGdtControlDraft(draftGdtControl, {
      featureKindById: effectiveFeatureKindMap,
      datums,
    })
  }, [draftGdtControl, effectiveFeatureKindMap, datums])

  if (assemblyMode) {
    if (selectedAssemblyItems.length === 0) {
      if (!contextActionFeedback) return null
      return (
        <div className="pa-context-float-bottom">
          <span className="pa-context-toast" role="status">
            {contextActionFeedback}
          </span>
        </div>
      )
    }

    const actions = resolveContextPillActions(selectedAssemblyItems, additivePickMode)
    const countLabel = `已选 ${selectedAssemblyItems.length} 项`
    const isSingle = selectedAssemblyItems.length === 1 && primarySelected !== null

    const handleActionClick = (actionId: ContextPillActionId) => {
      if (actionId === 'set-datum' && isSingle && onAssignDatum) {
        setOpenPopover((prev) => (prev === 'datum' ? 'none' : 'datum'))
        return
      }
      if (actionId === 'attach-gdt' && isSingle && onCreateGdtControl) {
        const isCyl = primarySelected.geometryKind === 'cylindrical-hole-axis'
        const defaultKind: GdtFeatureControl['kind'] = isCyl ? 'position' : 'flatness'
        setGdtKind(defaultKind)
        setModifier(isCyl ? 'MMC' : 'RFS')
        setToleranceMmInput(isCyl ? '0.12' : '0.08')
        setSelectedDatumIds(
          defaultKind === 'flatness' ? [] : datums[0] ? [datums[0].id] : [],
        )
        setOpenPopover((prev) => (prev === 'gdt' ? 'none' : 'gdt'))
        return
      }
      setOpenPopover('none')
      onExecuteAssemblyAction?.(actionId)
    }

    const toggleDatumRef = (datumId: string) => {
      setSelectedDatumIds((prev) => {
        if (prev.includes(datumId)) {
          return prev.filter((id) => id !== datumId)
        }
        if (prev.length >= 3) return prev
        return [...prev, datumId]
      })
    }

    return (
      <div className="pa-context-float-bottom">
        {/* Lightweight Datum A/B/C Picker Popover */}
        {isSingle && openPopover === 'datum' && onAssignDatum ? (
          <div
            className="pa-gdt-config-popover pa-datum-picker-popover"
            role="dialog"
            aria-label="指派装配基准 A/B/C"
            data-testid="datum-picker-popover"
          >
            <div className="pa-header">
              <strong>设为基准：{formatHumanReadableFeatureLabel(primarySelected)}</strong>
              <button
                type="button"
                className="pa-icon-btn"
                aria-label="关闭基准选择"
                onClick={() => setOpenPopover('none')}
              >
                ×
              </button>
            </div>
            <div className="pa-datum-picker-row">
              {DATUM_LETTER_OPTIONS.map((letter) => {
                const existing = datums.find((d) => d.label === letter)
                const isSameFeature = existing?.featureId === primarySelected.featureId
                return (
                  <button
                    key={letter}
                    type="button"
                    data-testid={`assign-datum-${letter}`}
                    aria-pressed={isSameFeature}
                    className={
                      isSameFeature
                        ? 'pa-btn pa-btn-primary pa-btn-sm'
                        : 'pa-btn pa-btn-sm'
                    }
                    onClick={() => {
                      onAssignDatum(primarySelected.featureId, letter)
                      setOpenPopover('none')
                    }}
                  >
                    ▼ 基准 {letter}
                    {existing && !isSameFeature ? '（替换）' : ''}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        {/* Lightweight GD&T Feature Control Frame Config Popover */}
        {isSingle && openPopover === 'gdt' && onCreateGdtControl ? (
          <div
            className="pa-gdt-config-popover"
            role="dialog"
            aria-label="贴 GD&T 框格配置气泡"
            data-testid="gdt-config-popover"
          >
            <div className="pa-header">
              <strong>贴 GD&amp;T 框格 · {formatHumanReadableFeatureLabel(primarySelected)}</strong>
              <button
                type="button"
                className="pa-icon-btn"
                aria-label="关闭 GD&T 配置气泡"
                onClick={() => setOpenPopover('none')}
              >
                ×
              </button>
            </div>

            {/* 5 GD&T Symbol Selector */}
            <div className="pa-gdt-field-group">
              <span className="pa-gdt-field-label">几何公差类型</span>
              <div className="pa-gdt-symbol-grid" role="group" aria-label="选择 GD&T 符号">
                {GDT_KIND_ORDER.map((kind) => {
                  const meta = GDT_KIND_META[kind]
                  const active = gdtKind === kind
                  return (
                    <button
                      key={kind}
                      type="button"
                      data-testid={`gdt-kind-${kind}`}
                      aria-pressed={active}
                      className={
                        active ? 'pa-btn pa-btn-primary pa-btn-sm' : 'pa-btn pa-btn-ghost pa-btn-sm'
                      }
                      onClick={() => {
                        setGdtKind(kind)
                        if (kind === 'flatness') {
                          setModifier('RFS')
                        }
                      }}
                    >
                      {meta.symbol} {meta.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Tolerance Value & Material Condition */}
            <div className="pa-gdt-config-row">
              <label className="pa-gdt-field-inline">
                <span>公差值 (mm)</span>
                <input
                  type="number"
                  data-testid="gdt-config-tolerance-input"
                  aria-label="GD&T 公差值 (mm)"
                  className="pa-gdt-inline-num"
                  min={0.01}
                  max={2}
                  step={0.01}
                  value={toleranceMmInput}
                  onChange={(event) => setToleranceMmInput(event.target.value)}
                />
              </label>

              <div className="pa-gdt-inline-mods" role="group" aria-label="被测特征实体条件">
                {MODIFIER_OPTIONS.map((mod) => (
                  <button
                    key={mod}
                    type="button"
                    data-testid={`gdt-config-mod-${mod}`}
                    aria-pressed={modifier === mod}
                    className={
                      modifier === mod
                        ? 'pa-btn pa-btn-primary pa-btn-sm'
                        : 'pa-btn pa-btn-ghost pa-btn-sm'
                    }
                    onClick={() => setModifier(mod)}
                  >
                    {GDT_MODIFIER_LABELS[mod]}
                  </button>
                ))}
              </div>
            </div>

            {/* Optional feature size deviation when MMC/LMC selected */}
            {modifier === 'MMC' || modifier === 'LMC' ? (
              <div className="pa-gdt-config-row" data-testid="gdt-size-tolerance-row">
                <label className="pa-gdt-field-inline">
                  <span>尺寸下偏差</span>
                  <input
                    type="number"
                    aria-label="尺寸下偏差 (mm)"
                    className="pa-gdt-inline-num"
                    step={0.01}
                    value={sizeLowerMm}
                    onChange={(event) => setSizeLowerMm(event.target.value)}
                  />
                </label>
                <label className="pa-gdt-field-inline">
                  <span>尺寸上偏差</span>
                  <input
                    type="number"
                    aria-label="尺寸上偏差 (mm)"
                    className="pa-gdt-inline-num"
                    step={0.01}
                    value={sizeUpperMm}
                    onChange={(event) => setSizeUpperMm(event.target.value)}
                  />
                </label>
              </div>
            ) : null}

            {/* Datum Reference Selection + Datum Modifiers */}
            <div className="pa-gdt-field-group">
              <span className="pa-gdt-field-label">基准引用（最多 3 级）</span>
              {datums.length === 0 ? (
                <span className="pa-muted">暂无已定义基准，可先点选特征「设为基准 A/B/C」。</span>
              ) : (
                <div className="pa-gdt-datum-ref-list">
                  {datums.map((datum) => {
                    const checked = selectedDatumIds.includes(datum.id)
                    const dMod = datumModifiers[datum.id] ?? 'RFS'
                    return (
                      <div key={datum.id} className="pa-gdt-datum-ref-chip">
                        <button
                          type="button"
                          data-testid={`gdt-config-datum-${datum.label}`}
                          aria-pressed={checked}
                          className={
                            checked
                              ? 'pa-btn pa-btn-active pa-btn-sm'
                              : 'pa-btn pa-btn-ghost pa-btn-sm'
                          }
                          onClick={() => toggleDatumRef(datum.id)}
                        >
                          {checked ? '✓ ' : ''}基准 {datum.label}
                        </button>
                        {checked ? (
                          <button
                            type="button"
                            data-testid={`gdt-config-datum-mod-${datum.label}`}
                            className="pa-btn pa-btn-ghost pa-btn-sm pa-mono"
                            title="切换该基准的实体修正符"
                            onClick={() => {
                              const nextMod: GdtMaterialModifier =
                                dMod === 'RFS' ? 'MMC' : dMod === 'MMC' ? 'LMC' : 'RFS'
                              setDatumModifiers((prev) => ({ ...prev, [datum.id]: nextMod }))
                            }}
                          >
                            {dMod}
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Real-time Validation Warnings */}
            {!validation.valid ? (
              <div
                className="pa-danger-box pa-gdt-validation-box"
                role="alert"
                data-testid="gdt-validation-warnings"
              >
                {validation.warnings.length > 0
                  ? validation.warnings.map((w, idx) => (
                      <div key={`${w.code}-${idx}`} data-warning-code={w.code}>
                        <strong>[{w.code}]</strong> {w.message}
                      </div>
                    ))
                  : validation.errors.map((err, idx) => <div key={idx}>{err}</div>)}
              </div>
            ) : null}

            <div className="pa-gdt-inline-footer">
              <button
                type="button"
                className="pa-btn pa-btn-ghost pa-btn-sm"
                onClick={() => setOpenPopover('none')}
              >
                取消
              </button>
              <button
                type="button"
                data-testid="gdt-config-submit"
                className="pa-btn pa-btn-primary pa-btn-sm"
                disabled={!validation.valid || !draftGdtControl}
                onClick={() => {
                  if (!validation.valid || !draftGdtControl) return
                  onCreateGdtControl({
                    ...draftGdtControl,
                    id: `gdt-${primarySelected.featureId}-${gdtKind}-${Date.now().toString(36)}`,
                  })
                  setOpenPopover('none')
                }}
              >
                确认贴标
              </button>
            </div>
          </div>
        ) : null}

        <section
          className="pa-context-pill pa-context-pill-assembly"
          aria-label="智能上下文胶囊"
          data-testid="assembly-context-pill"
          data-selection-active="true"
          data-selection-count={String(selectedAssemblyItems.length)}
        >
          <span className="pa-selection-dot" aria-hidden="true" />
          <span className="pa-pill pa-tone-action" data-testid="selection-count-badge">
            {countLabel}
          </span>
          <div className="pa-context-labels" data-testid="selection-breadcrumb">
            {selectedAssemblyItems.map((item, idx) => (
              <span key={item.featureId} className="pa-context-feature-label">
                {idx > 0 ? <span className="pa-muted"> + </span> : null}
                <strong>{formatHumanReadableFeatureLabel(item)}</strong>
              </span>
            ))}
          </div>

          <div className="pa-context-actions">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                data-testid={`ctx-action-${action.id}`}
                aria-pressed={action.active ? true : undefined}
                className={
                  action.primary
                    ? 'pa-btn pa-btn-primary pa-btn-sm'
                    : action.active
                      ? 'pa-btn pa-btn-active pa-btn-sm'
                      : 'pa-btn pa-btn-ghost pa-btn-sm'
                }
                onClick={() => handleActionClick(action.id)}
              >
                {action.label}
              </button>
            ))}
            <button
              type="button"
              className="pa-icon-btn"
              aria-label="取消选择"
              title="取消选择"
              onClick={() => {
                setOpenPopover('none')
                onClearSelection()
              }}
            >
              ×
            </button>
          </div>
        </section>
        {contextActionFeedback ? (
          <span className="pa-context-toast" role="status" data-testid="context-action-feedback">
            {contextActionFeedback}
          </span>
        ) : null}
      </div>
    )
  }

  const extraCount =
    selectedFeatures && selectedFeatures.length > 1 ? selectedFeatures.length - 1 : 0

  if (!selectedFeature) {
    if (!contextActionFeedback) return null
    return (
      <div className="pa-context-float-bottom">
        <span className="pa-context-toast" role="status">
          {contextActionFeedback}
        </span>
      </div>
    )
  }

  return (
    <div className="pa-context-float-bottom">
      <section
        className="pa-context-pill"
        aria-label="对象引用上下文区"
        data-selection-active="true"
      >
        <span className="pa-selection-dot" aria-hidden="true" />
        <strong data-testid="selection-breadcrumb">{selectedFeature.breadcrumb}</strong>
        {extraCount > 0 ? (
          <span className="pa-pill pa-tone-action" aria-label="多选特征数量">
            +{extraCount}
          </span>
        ) : null}
        <span className="pa-mono pa-muted pa-context-ref">{selectedFeature.featureRef}</span>

        <div className="pa-context-actions">
          {sidebarMode === 'builtin' ? (
            <>
              <button
                type="button"
                className="pa-btn pa-btn-primary pa-btn-sm"
                onClick={onBringIntoNextPrompt}
              >
                带入下一句话
              </button>
              <button
                type="button"
                className="pa-btn pa-btn-ghost pa-btn-sm"
                title="复制对象引用到外部会话"
                onClick={onCopyToExternalSession}
              >
                复制到外部会话
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="pa-btn pa-btn-primary pa-btn-sm"
                onClick={onCopyToExternalSession}
              >
                复制到外部会话
              </button>
              <button
                type="button"
                className="pa-btn pa-btn-ghost pa-btn-sm"
                title="带入内置对话的下一句话"
                onClick={onBringIntoNextPrompt}
              >
                带入下一句话
              </button>
            </>
          )}
          <button
            type="button"
            className="pa-icon-btn"
            aria-label="取消选择"
            title="取消选择"
            onClick={onClearSelection}
          >
            ×
          </button>
        </div>
      </section>
      {contextActionFeedback ? (
        <span className="pa-context-toast" role="status">
          {contextActionFeedback}
        </span>
      ) : null}
    </div>
  )
}
