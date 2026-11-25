import { useRef, type KeyboardEvent, type RefObject } from 'react'
import type { PartMesh } from '../assembly3dTypes'
import type { M2ModelFeatureItem } from '../m2WorkbenchBridge'

export interface AssemblyTreeOverlayProps {
  readonly features: readonly M2ModelFeatureItem[]
  readonly selectedObjectId: string | null
  readonly selectedObjectIds?: readonly string[]
  readonly highlightedFeatureIds: ReadonlySet<string>
  readonly structureOpen: boolean
  readonly objectListRegionRef: RefObject<HTMLElement | null>
  readonly onToggleStructure: () => void
  readonly onCloseStructure: () => void
  readonly onSelectFeature: (
    feature: M2ModelFeatureItem,
    options?: { readonly additive?: boolean },
  ) => void
  /** M1B 3D assembly controls (hidden when FEATURE_3D_ASSEMBLY_M1 is false). */
  readonly showAssemblyControls?: boolean
  readonly partMeshes?: readonly PartMesh[]
  readonly hiddenPartIds?: ReadonlySet<string>
  readonly onTogglePartVisibility?: (partId: string) => void
  readonly onSelectPart?: (partId: string) => void
  readonly explosionFactor?: number
  readonly onChangeExplosionFactor?: (factor: number) => void
  readonly xrayMode?: boolean
  readonly onToggleXrayMode?: () => void
}

/**
 * Top-left collapsible part / assembly structure overlay with full keyboard
 * navigation (ArrowUp/ArrowDown/Home/End/Escape).
 * - In M0/M1 single-part mode (`showAssemblyControls = false`): zero range sliders,
 *   100% zero regression.
 * - In M1B 3D assembly mode (`showAssemblyControls = true`): compact `装配树 (N 零件)`
 *   pill expanding to per-part visibility toggles, key features, 0-100% explosion slider,
 *   and X-Ray transparency switch.
 */
export function AssemblyTreeOverlay({
  features,
  selectedObjectId,
  selectedObjectIds,
  highlightedFeatureIds,
  structureOpen,
  objectListRegionRef,
  onToggleStructure,
  onCloseStructure,
  onSelectFeature,
  showAssemblyControls = false,
  partMeshes = [],
  hiddenPartIds,
  onTogglePartVisibility,
  onSelectPart,
  explosionFactor = 0,
  onChangeExplosionFactor,
  xrayMode = false,
  onToggleXrayMode,
}: AssemblyTreeOverlayProps) {
  const objectItemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const isMultiPartTree = showAssemblyControls && partMeshes.length > 0

  const handleObjectListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCloseStructure()
      return
    }
    if (features.length === 0) return
    const currentIndex = objectItemRefs.current.findIndex(
      (btn) => btn !== null && btn === document.activeElement,
    )
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const nextIdx = currentIndex < 0 ? 0 : (currentIndex + 1) % features.length
      objectItemRefs.current[nextIdx]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const prevIdx =
        currentIndex <= 0 ? features.length - 1 : (currentIndex - 1) % features.length
      objectItemRefs.current[prevIdx]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      objectItemRefs.current[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      objectItemRefs.current[features.length - 1]?.focus()
    }
  }

  return (
    <div className="pa-structure-anchor">
      <button
        type="button"
        data-testid="toggle-structure-btn"
        className={`pa-float-chip ${structureOpen ? 'pa-float-chip-active' : ''}`}
        aria-expanded={structureOpen}
        aria-controls="pa-structure-popover"
        onClick={onToggleStructure}
      >
        {isMultiPartTree ? `装配树 (${partMeshes.length} 零件)` : `零件结构 (${features.length})`}{' '}
        <span aria-hidden="true">{structureOpen ? '▴' : '▾'}</span>
      </button>

      {structureOpen ? (
        <section
          id="pa-structure-popover"
          ref={objectListRegionRef}
          tabIndex={-1}
          className="pa-structure-popover pa-focus-region"
          aria-label={isMultiPartTree ? '装配树列表' : '对象列表'}
          onKeyDown={handleObjectListKeyDown}
        >
          <div className="pa-header">
            <span className="pa-card-label">
              {isMultiPartTree ? `装配树（${partMeshes.length} 零件）` : '零件结构（↑/↓ 切换）'}
            </span>
            <button
              type="button"
              className="pa-icon-btn"
              aria-label={isMultiPartTree ? '收起装配树' : '收起零件结构'}
              onClick={onCloseStructure}
            >
              ×
            </button>
          </div>

          {isMultiPartTree ? (
            <div className="pa-assembly-tree-parts" role="group" aria-label="装配体零件与特征">
              {partMeshes.map((part) => {
                const isHidden = Boolean(hiddenPartIds?.has(part.partId))
                const partFeatures = features.filter((f) => f.partName === part.displayName)
                const partSelected = partFeatures.some(
                  (f) =>
                    selectedObjectId === f.objectId ||
                    Boolean(selectedObjectIds?.includes(f.objectId)),
                )
                const partHighlighted = partFeatures.some((f) =>
                  highlightedFeatureIds.has(f.objectId),
                )
                return (
                  <div
                    key={part.partId}
                    className={`pa-assembly-part-group ${isHidden ? 'pa-assembly-part-hidden' : ''}`}
                    data-testid={`assembly-part-${part.partId}`}
                  >
                    <div
                      className={`pa-assembly-part-row ${partSelected ? 'pa-structure-item-selected' : ''} ${partHighlighted ? 'pa-structure-item-highlighted' : ''}`}
                    >
                      <button
                        type="button"
                        className="pa-assembly-part-btn"
                        aria-pressed={partSelected}
                        onClick={() => {
                          if (onSelectPart) {
                            onSelectPart(part.partId)
                          } else if (partFeatures[0]) {
                            onSelectFeature(partFeatures[0])
                          }
                        }}
                      >
                        <span
                          className="pa-part-swatch"
                          style={{ backgroundColor: part.color }}
                          aria-hidden="true"
                        />
                        <span>{part.displayName}</span>
                      </button>
                      <button
                        type="button"
                        data-testid={`toggle-part-visibility-${part.partId}`}
                        className={`pa-icon-btn pa-part-eye-btn ${isHidden ? 'pa-part-eye-hidden' : ''}`}
                        aria-label={isHidden ? `显示 ${part.displayName}` : `隐藏 ${part.displayName}`}
                        aria-pressed={isHidden}
                        title={isHidden ? '点击显示零件' : '点击隐藏零件'}
                        onClick={() => onTogglePartVisibility?.(part.partId)}
                      >
                        {isHidden ? '○' : '👁'}
                      </button>
                    </div>

                    {partFeatures.length > 0 ? (
                      <div className="pa-assembly-feature-children">
                        {partFeatures.map((feat) => {
                          const isSelected =
                            selectedObjectId === feat.objectId ||
                            Boolean(selectedObjectIds?.includes(feat.objectId))
                          const isHighlighted = highlightedFeatureIds.has(feat.objectId)
                          return (
                            <button
                              key={feat.objectId}
                              type="button"
                              data-feature-id={feat.objectId}
                              data-highlighted={isHighlighted ? 'true' : 'false'}
                              aria-pressed={isSelected}
                              className={`pa-structure-item pa-assembly-feature-btn ${isSelected ? 'pa-structure-item-selected' : ''} ${isHighlighted ? 'pa-structure-item-highlighted' : ''}`}
                              onClick={(event) =>
                                onSelectFeature(feat, { additive: event.shiftKey })
                              }
                            >
                              <span>{feat.role}</span>
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : features.length === 0 ? (
            <p className="pa-muted">当前暂无可选几何特征。</p>
          ) : (
            <div className="pa-structure-list" role="group" aria-label="可选几何特征对象">
              {features.map((obj, index) => {
                const isSelected =
                  selectedObjectId === obj.objectId ||
                  Boolean(selectedObjectIds?.includes(obj.objectId))
                const isHighlighted = highlightedFeatureIds.has(obj.objectId)
                return (
                  <button
                    key={obj.objectId}
                    ref={(el) => {
                      objectItemRefs.current[index] = el
                    }}
                    type="button"
                    data-feature-id={obj.objectId}
                    data-highlighted={isHighlighted ? 'true' : 'false'}
                    aria-pressed={isSelected}
                    className={`pa-structure-item ${isSelected ? 'pa-structure-item-selected' : ''} ${isHighlighted ? 'pa-structure-item-highlighted' : ''}`}
                    onClick={() => onSelectFeature(obj)}
                  >
                    <span>{obj.breadcrumb}</span>
                    <span className="pa-mono pa-muted">{obj.featureRef}</span>
                  </button>
                )
              })}
            </div>
          )}

          {showAssemblyControls ? (
            <div className="pa-assembly-controls" aria-label="三维装配视图控制">
              <label className="pa-field">
                <span className="pa-assembly-ctrl-row">
                  <span>爆炸视图</span>
                  <span className="pa-mono" data-testid="assembly-explosion-value">
                    {Math.round(explosionFactor * 100)}%
                  </span>
                </span>
                <input
                  type="range"
                  data-testid="assembly-explosion-slider"
                  aria-label="爆炸视图滑块"
                  min={0}
                  max={100}
                  value={Math.round(explosionFactor * 100)}
                  onChange={(event) => {
                    onChangeExplosionFactor?.(Number(event.target.value) / 100)
                  }}
                />
              </label>
              <label className="pa-toggle">
                <input
                  type="checkbox"
                  data-testid="assembly-xray-toggle"
                  checked={xrayMode}
                  onChange={() => onToggleXrayMode?.()}
                />
                X-Ray 半透明透视
              </label>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
