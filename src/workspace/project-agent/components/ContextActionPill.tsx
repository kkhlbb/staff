import { useMemo, useState } from 'react'
import { formatHumanReadableFeatureLabel, resolveContextPillActions } from '../assembly3dMath'
import type {
  AssemblyFeatureSelectionItem,
  AssemblyPhysicsSpec,
  CompliantModelSpec,
  ContextPillActionId,
  DatumDefinition,
  GdtFeatureControl,
  GdtMaterialModifier,
  MaterialSpec,
  MicMatrixPayloadV1,
  PickedFeatureGeometryKind,
} from '../assembly3dTypes'
import { PhysicsConfigPopover } from './PhysicsConfigPopover'
import {
  DATUM_LETTER_OPTIONS,
  GDT_KIND_META,
  GDT_MODIFIER_LABELS,
  getRecommendedGdtKindsForFeature,
  isRunoutGdtKind,
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
  /** M4F1 lightweight compliant physics popover callbacks. */
  readonly currentPhysics?: AssemblyPhysicsSpec
  readonly onSavePhysics?: (params: {
    readonly partId: string
    readonly partName: string
    readonly material: MaterialSpec
    readonly models: readonly CompliantModelSpec[]
  }) => void
  readonly onImportMicMatrix?: (params: {
    readonly fileName: string
    readonly payload: MicMatrixPayloadV1
  }) => Promise<void> | void
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
  currentPhysics,
  onSavePhysics,
  onImportMicMatrix,
}: ContextActionPillProps) {
  const [openPopover, setOpenPopover] = useState<'none' | 'datum' | 'gdt' | 'physics' | 'clamp'>('none')
  const [gdtKind, setGdtKind] = useState<GdtFeatureControl['kind']>('position')
  const [toleranceMmInput, setToleranceMmInput] = useState('0.12')
  const [modifier, setModifier] = useState<GdtMaterialModifier>('RFS')
  const [selectedDatumIds, setSelectedDatumIds] = useState<readonly string[]>([])
  const [datumModifiers, setDatumModifiers] = useState<Readonly<Record<string, GdtMaterialModifier>>>({})
  const [sizeLowerMm, setSizeLowerMm] = useState('-0.05')
  const [sizeUpperMm, setSizeUpperMm] = useState('0.05')
  const [unequalOuterFractionInput, setUnequalOuterFractionInput] = useState('0.5')
  const [lowerToleranceMmInput, setLowerToleranceMmInput] = useState('0.06')
  const [lowerModifier, setLowerModifier] = useState<GdtMaterialModifier>('RFS')
  const [lowerDatumIds, setLowerDatumIds] = useState<readonly string[]>([])

  const primarySelected = selectedAssemblyItems[0] ?? null
  const recommendedGdtKinds = useMemo(
    () => getRecommendedGdtKindsForFeature(primarySelected?.geometryKind),
    [primarySelected?.geometryKind],
  )
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
    const lowerTolMm = Number(lowerToleranceMmInput)
    const outerFrac = Number(unequalOuterFractionInput)
    const isCyl = primarySelected.geometryKind === 'cylindrical-hole-axis'
    const zoneShape: GdtFeatureControl['zoneShape'] =
      gdtKind === 'coaxiality' ||
      gdtKind === 'composite-position' ||
      (gdtKind === 'position' && isCyl)
        ? 'cylindrical'
        : 'planar'
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
      ...(gdtKind === 'profile-surface' && Number.isFinite(outerFrac) && Math.abs(outerFrac - 0.5) > 1e-6
        ? { unequalProfileOuterFraction: outerFrac }
        : {}),
      ...(gdtKind === 'composite-position'
        ? {
            lowerSegment: {
              toleranceQ: Number.isFinite(lowerTolMm) ? mmToToleranceQ(lowerTolMm) : 0,
              modifier: lowerModifier,
              datumIds: [...lowerDatumIds],
            },
          }
        : {}),
      ...(modifier === 'MMC' || modifier === 'LMC'
        ? {
            featureSizeToleranceQ: {
              lowerQ: Number.isFinite(lowerMm) ? Math.round(lowerMm * 10000) : -500,
              upperQ: Number.isFinite(upperMm) ? Math.round(upperMm * 10000) : 500,
            },
          }
        : {}),
    }
  }, [
    primarySelected,
    gdtKind,
    toleranceMmInput,
    modifier,
    selectedDatumIds,
    datumModifiers,
    sizeLowerMm,
    sizeUpperMm,
    unequalOuterFractionInput,
    lowerToleranceMmInput,
    lowerModifier,
    lowerDatumIds,
  ])

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
        <div className="pa-sel-bar-wrap">
          <div className="pa-sel-bar pa-sel-bar-feedback">
            <span className="pa-context-toast" role="status" data-testid="context-action-feedback">
              {contextActionFeedback}
            </span>
          </div>
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
      if (actionId === 'configure-physics' && onSavePhysics) {
        setOpenPopover((prev) => (prev === 'physics' ? 'none' : 'physics'))
        return
      }
      if (actionId === 'set-clamp-warpage' && onSavePhysics) {
        setOpenPopover((prev) => (prev === 'clamp' ? 'none' : 'clamp'))
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
      <div className="pa-sel-bar-wrap">
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

            {/* Smart-filtered GD&T Symbol Selector (up to 10 kinds) */}
            <div className="pa-gdt-field-group">
              <span className="pa-gdt-field-label">几何公差类型（按特征智能推荐）</span>
              <div className="pa-gdt-symbol-grid" role="group" aria-label="选择 GD&T 符号">
                {recommendedGdtKinds.map((kind) => {
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
                        if (kind === 'flatness' || kind === 'cylindricity') {
                          setModifier('RFS')
                          setSelectedDatumIds([])
                        } else if (isRunoutGdtKind(kind)) {
                          setModifier('RFS')
                          if (selectedDatumIds.length === 0) {
                            const axisDatum = datums.find(
                              (d) => effectiveFeatureKindMap.get(d.featureId) === 'cylindrical-hole-axis',
                            )
                            if (axisDatum) {
                              setSelectedDatumIds([axisDatum.id])
                            }
                          }
                        } else if (kind === 'composite-position') {
                          const upperVal = Number(toleranceMmInput)
                          const halfVal = Number.isFinite(upperVal) && upperVal > 0.02 ? upperVal / 2 : 0.05
                          setLowerToleranceMmInput(halfVal.toFixed(2))
                          setLowerModifier(modifier)
                          const initialUpper =
                            selectedDatumIds.length > 0
                              ? selectedDatumIds
                              : datums.slice(0, 2).map((d) => d.id)
                          if (selectedDatumIds.length === 0 && initialUpper.length > 0) {
                            setSelectedDatumIds(initialUpper)
                          }
                          setLowerDatumIds(initialUpper.slice(0, 1))
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

            {/* Profile-surface unequal UZ outer fraction */}
            {gdtKind === 'profile-surface' ? (
              <div className="pa-gdt-config-row" data-testid="gdt-profile-uz-row">
                <label className="pa-gdt-field-inline">
                  <span>外侧比例 UZ（0.5 = 对称）</span>
                  <input
                    type="number"
                    data-testid="gdt-config-uz-input"
                    aria-label="面轮廓度不等距外侧比例"
                    className="pa-gdt-inline-num"
                    min={0}
                    max={1}
                    step={0.05}
                    value={unequalOuterFractionInput}
                    onChange={(event) => setUnequalOuterFractionInput(event.target.value)}
                  />
                </label>
              </div>
            ) : null}

            {/* Composite-position lower segment (FRTZF) */}
            {gdtKind === 'composite-position' ? (
              <div className="pa-gdt-field-group pa-gdt-lower-segment-box" data-testid="gdt-composite-lower-box">
                <span className="pa-gdt-field-label">下格 FRTZF（公差须 ≤ 上格，基准为上格前缀）</span>
                <div className="pa-gdt-config-row">
                  <label className="pa-gdt-field-inline">
                    <span>下格公差 (mm)</span>
                    <input
                      type="number"
                      data-testid="gdt-config-lower-tolerance-input"
                      aria-label="复合位置度下格公差 (mm)"
                      className="pa-gdt-inline-num"
                      min={0.01}
                      max={2}
                      step={0.01}
                      value={lowerToleranceMmInput}
                      onChange={(event) => setLowerToleranceMmInput(event.target.value)}
                    />
                  </label>
                  <div className="pa-gdt-inline-mods" role="group" aria-label="下格实体条件">
                    {MODIFIER_OPTIONS.map((mod) => (
                      <button
                        key={`lower-${mod}`}
                        type="button"
                        data-testid={`gdt-config-lower-mod-${mod}`}
                        aria-pressed={lowerModifier === mod}
                        className={
                          lowerModifier === mod
                            ? 'pa-btn pa-btn-primary pa-btn-sm'
                            : 'pa-btn pa-btn-ghost pa-btn-sm'
                        }
                        onClick={() => setLowerModifier(mod)}
                      >
                        {GDT_MODIFIER_LABELS[mod]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="pa-gdt-datum-ref-list" role="group" aria-label="下格基准前缀选择">
                  {datums.map((datum) => {
                    const checked = lowerDatumIds.includes(datum.id)
                    return (
                      <button
                        key={`lower-datum-${datum.id}`}
                        type="button"
                        data-testid={`gdt-config-lower-datum-${datum.label}`}
                        aria-pressed={checked}
                        className={
                          checked ? 'pa-btn pa-btn-active pa-btn-sm' : 'pa-btn pa-btn-ghost pa-btn-sm'
                        }
                        onClick={() => {
                          setLowerDatumIds((prev) =>
                            prev.includes(datum.id)
                              ? prev.filter((id) => id !== datum.id)
                              : prev.length < 2
                                ? [...prev, datum.id]
                                : prev,
                          )
                        }}
                      >
                        {checked ? '✓ ' : ''}下格基准 {datum.label}
                      </button>
                    )
                  })}
                </div>
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

        {/* Lightweight Compliant Physics Config Popover (M4F1) */}
        {(openPopover === 'physics' || openPopover === 'clamp') && onSavePhysics ? (
          <PhysicsConfigPopover
            selectedItems={selectedAssemblyItems}
            initialClampMode={openPopover === 'clamp'}
            currentPhysics={currentPhysics}
            onSavePhysics={onSavePhysics}
            onImportMicMatrix={onImportMicMatrix}
            onClose={() => setOpenPopover('none')}
          />
        ) : null}

        <section
          className="pa-sel-bar pa-context-pill-assembly"
          aria-label="特征选择操作条"
          data-testid="assembly-context-pill"
          data-selection-active="true"
          data-selection-count={String(selectedAssemblyItems.length)}
        >
          <div className="pa-sel-left">
            <span className="pa-sel-count pa-mono" data-testid="selection-count-badge">
              {countLabel}
            </span>
            <span className="pa-sel-prefix">已选：</span>
            <div className="pa-context-labels pa-mono" data-testid="selection-breadcrumb">
              {selectedAssemblyItems.map((item, idx) => (
                <span key={item.featureId} className="pa-context-feature-label">
                  {idx > 0 ? <span className="pa-muted"> + </span> : null}
                  <span>{formatHumanReadableFeatureLabel(item)}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="pa-sel-acts">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                data-testid={`ctx-action-${action.id}`}
                aria-pressed={action.active ? true : undefined}
                className={
                  action.primary
                    ? 'pa-text-act pa-text-act-accent'
                    : action.active
                      ? 'pa-text-act pa-text-act-active'
                      : 'pa-text-act'
                }
                onClick={() => handleActionClick(action.id)}
              >
                {action.label}
              </button>
            ))}
            <button
              type="button"
              className="pa-text-act"
              aria-label="取消选择"
              title="取消选择"
              onClick={() => {
                setOpenPopover('none')
                onClearSelection()
              }}
            >
              取消
            </button>
          </div>
        </section>
        {contextActionFeedback ? (
          <div className="pa-sel-bar-toast-row">
            <span className="pa-context-toast" role="status" data-testid="context-action-feedback">
              {contextActionFeedback}
            </span>
          </div>
        ) : null}
      </div>
    )
  }

  const extraCount =
    selectedFeatures && selectedFeatures.length > 1 ? selectedFeatures.length - 1 : 0

  if (!selectedFeature) {
    if (!contextActionFeedback) return null
    return (
      <div className="pa-sel-bar-wrap">
        <div className="pa-sel-bar pa-sel-bar-feedback">
          <span className="pa-context-toast" role="status">
            {contextActionFeedback}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="pa-sel-bar-wrap">
      <section
        className="pa-sel-bar"
        aria-label="对象引用上下文区"
        data-selection-active="true"
      >
        <div className="pa-sel-left">
          <span className="pa-sel-prefix">已选：</span>
          <span className="pa-mono" data-testid="selection-breadcrumb">
            {selectedFeature.breadcrumb}
          </span>
          {extraCount > 0 ? (
            <span className="pa-mono pa-muted" aria-label="多选特征数量">
              +{extraCount}
            </span>
          ) : null}
          <span className="pa-mono pa-muted pa-context-ref">{selectedFeature.featureRef}</span>
        </div>

        <div className="pa-sel-acts">
          {sidebarMode === 'builtin' ? (
            <>
              <button
                type="button"
                className="pa-text-act pa-text-act-accent"
                onClick={onBringIntoNextPrompt}
              >
                带入下一句话
              </button>
              <button
                type="button"
                className="pa-text-act"
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
                className="pa-text-act pa-text-act-accent"
                onClick={onCopyToExternalSession}
              >
                复制到外部会话
              </button>
              <button
                type="button"
                className="pa-text-act"
                title="带入内置对话的下一句话"
                onClick={onBringIntoNextPrompt}
              >
                带入下一句话
              </button>
            </>
          )}
          <button
            type="button"
            className="pa-text-act"
            aria-label="取消选择"
            title="取消选择"
            onClick={onClearSelection}
          >
            取消
          </button>
        </div>
      </section>
      {contextActionFeedback ? (
        <div className="pa-sel-bar-toast-row">
          <span className="pa-context-toast" role="status">
            {contextActionFeedback}
          </span>
        </div>
      ) : null}
    </div>
  )
}
