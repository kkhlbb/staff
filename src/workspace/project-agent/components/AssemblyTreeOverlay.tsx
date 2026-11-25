import { useRef, type KeyboardEvent, type RefObject } from 'react'
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
  readonly onSelectFeature: (feature: M2ModelFeatureItem) => void
  /** Reserved for M1B 3D assembly controls (hidden in M0 by default). */
  readonly showAssemblyControls?: boolean
  readonly explosionFactor?: number
  readonly onChangeExplosionFactor?: (factor: number) => void
  readonly xrayMode?: boolean
  readonly onToggleXrayMode?: () => void
}

/**
 * Top-left collapsible part / assembly structure overlay with full keyboard
 * navigation (ArrowUp/ArrowDown/Home/End/Escape). Pre-wired as an independent
 * container for M1B multi-part assembly tree, explosion slider, and X-Ray toggle.
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
  explosionFactor = 0,
  onChangeExplosionFactor,
  xrayMode = false,
  onToggleXrayMode,
}: AssemblyTreeOverlayProps) {
  const objectItemRefs = useRef<Array<HTMLButtonElement | null>>([])

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
        零件结构 ({features.length}) <span aria-hidden="true">{structureOpen ? '▴' : '▾'}</span>
      </button>

      {structureOpen ? (
        <section
          id="pa-structure-popover"
          ref={objectListRegionRef}
          tabIndex={-1}
          className="pa-structure-popover pa-focus-region"
          aria-label="对象列表"
          onKeyDown={handleObjectListKeyDown}
        >
          <div className="pa-header">
            <span className="pa-card-label">零件结构（↑/↓ 切换）</span>
            <button
              type="button"
              className="pa-icon-btn"
              aria-label="收起零件结构"
              onClick={onCloseStructure}
            >
              ×
            </button>
          </div>
          {features.length === 0 ? (
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
                <span>爆炸度 {Math.round(explosionFactor * 100)}%</span>
                <input
                  type="range"
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
                  checked={xrayMode}
                  onChange={() => onToggleXrayMode?.()}
                />
                X-Ray 透视
              </label>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
