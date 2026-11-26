import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import {
  buildAssemblyTree,
  resolveGroupVisibilityState,
  resolvePartDisplayColor,
  type AssemblyTreeGroupNode,
} from '../assemblyTreeModel'
import type { AssemblyGroup, PartMesh } from '../assembly3dTypes'
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
  readonly assemblyGroups?: readonly AssemblyGroup[]
  readonly partMeshes?: readonly PartMesh[]
  readonly hiddenPartIds?: ReadonlySet<string>
  readonly onTogglePartVisibility?: (partId: string) => void
  readonly onSetPartsVisibility?: (partIds: readonly string[], hidden: boolean) => void
  readonly onSelectPart?: (partId: string) => void
  readonly explosionFactor?: number
  readonly onChangeExplosionFactor?: (factor: number) => void
  readonly xrayMode?: boolean
  readonly onToggleXrayMode?: () => void
  /** M4F1 part IDs with active compliant deformation config (renders amber "柔性" badge). */
  readonly compliantPartIds?: ReadonlySet<string>
}

/**
 * Top-left collapsible part / assembly structure overlay with full keyboard
 * navigation (ArrowUp/ArrowDown/Home/End/Escape).
 * - In M0/M1 single-part mode (`showAssemblyControls = false`): zero range sliders,
 *   100% zero regression.
 * - In M1B 3D assembly mode (`showAssemblyControls = true`): compact `装配树 (N 零件)`
 *   pill expanding to per-part visibility toggles, optional multi-level XCAF assembly
 *   groups with recursive counts & group-level visibility, key features, 0-100%
 *   explosion slider, and X-Ray transparency switch.
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
  assemblyGroups,
  partMeshes = [],
  hiddenPartIds,
  onTogglePartVisibility,
  onSetPartsVisibility,
  onSelectPart,
  explosionFactor = 0,
  onChangeExplosionFactor,
  xrayMode = false,
  onToggleXrayMode,
  compliantPartIds,
}: AssemblyTreeOverlayProps) {
  const objectItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(() => new Set())

  const isMultiPartTree = showAssemblyControls && partMeshes.length > 0

  const partIndexById = useMemo(() => {
    const map = new Map<string, number>()
    partMeshes.forEach((part, index) => {
      map.set(part.partId, index)
    })
    return map
  }, [partMeshes])

  const assemblyTree = useMemo(
    () => buildAssemblyTree(partMeshes, assemblyGroups),
    [partMeshes, assemblyGroups],
  )

  const toggleGroupExpand = (groupId: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const handleToggleGroupVisibility = (group: AssemblyTreeGroupNode<PartMesh>) => {
    if (group.descendantPartIds.length === 0) return
    const visState = resolveGroupVisibilityState(group.descendantPartIds, hiddenPartIds)
    // When all parts in the group are visible, hide the entire group;
    // when partially or fully hidden, restore visibility for all parts in the group.
    const nextHidden = visState === 'visible'
    if (onSetPartsVisibility) {
      onSetPartsVisibility(group.descendantPartIds, nextHidden)
      return
    }
    if (!onTogglePartVisibility) return
    for (const partId of group.descendantPartIds) {
      const currentlyHidden = Boolean(hiddenPartIds?.has(partId))
      if (currentlyHidden !== nextHidden) {
        onTogglePartVisibility(partId)
      }
    }
  }

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

  const renderPartItem = (part: PartMesh, depth = 0) => {
    const isHidden = Boolean(hiddenPartIds?.has(part.partId))
    const partFeatures = features.filter((f) => f.partName === part.displayName)
    const partSelected = partFeatures.some(
      (f) =>
        selectedObjectId === f.objectId || Boolean(selectedObjectIds?.includes(f.objectId)),
    )
    const partHighlighted = partFeatures.some((f) => highlightedFeatureIds.has(f.objectId))
    const partIndex = partIndexById.get(part.partId) ?? 0
    const resolvedColor = resolvePartDisplayColor(part, partIndex)

    return (
      <div
        key={part.partId}
        className={`pa-assembly-part-group ${isHidden ? 'pa-assembly-part-hidden' : ''}`}
        data-testid={`assembly-part-${part.partId}`}
        data-tree-depth={depth}
      >
        <div
          className={`pa-assembly-part-row ${partSelected ? 'pa-structure-item-selected' : ''} ${partHighlighted ? 'pa-structure-item-highlighted' : ''}`}
          style={depth > 0 ? { paddingLeft: `${depth * 12 + 4}px` } : undefined}
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
              data-testid={`part-swatch-${part.partId}`}
              data-part-color={resolvedColor}
              style={{ backgroundColor: resolvedColor }}
              aria-hidden="true"
            />
            <span>{part.displayName}</span>
            {compliantPartIds?.has(part.partId) ? (
              <span
                className="pa-part-compliant-badge"
                data-compliant-badge="true"
                data-testid={`part-compliant-badge-${part.partId}`}
                title="已开启柔性形变耦合"
              >
                柔性
              </span>
            ) : null}
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
          <div
            className="pa-assembly-feature-children"
            style={depth > 0 ? { paddingLeft: `${depth * 12 + 16}px` } : undefined}
          >
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
                  onClick={(event) => onSelectFeature(feat, { additive: event.shiftKey })}
                >
                  <span>{feat.role}</span>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
    )
  }

  const renderGroupNode = (group: AssemblyTreeGroupNode<PartMesh>) => {
    const isCollapsed = collapsedGroupIds.has(group.id)
    const visState = resolveGroupVisibilityState(group.descendantPartIds, hiddenPartIds)
    const isHidden = visState === 'hidden'
    const isPartial = visState === 'partial'
    const isEmpty = visState === 'empty'
    const visLabel = isHidden
      ? `显示整组 ${group.name}`
      : isPartial
        ? `显示整组 ${group.name}（部分隐藏）`
        : `隐藏整组 ${group.name}`

    return (
      <div
        key={group.id}
        className={`pa-assembly-folder ${isHidden ? 'pa-assembly-part-hidden' : ''}`}
        data-testid={`assembly-group-${group.id}`}
        data-group-depth={group.depth}
      >
        <div
          className="pa-assembly-folder-row"
          style={group.depth > 0 ? { paddingLeft: `${group.depth * 12}px` } : undefined}
        >
          <button
            type="button"
            data-testid={`toggle-group-expand-${group.id}`}
            className="pa-assembly-folder-toggle"
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? `展开 ${group.name}` : `折叠 ${group.name}`}
            onClick={() => toggleGroupExpand(group.id)}
          >
            <span className="pa-assembly-folder-chevron" aria-hidden="true">
              {isCollapsed ? '▸' : '▾'}
            </span>
            <span className="pa-assembly-folder-name">{group.name}</span>
            <span className="pa-assembly-folder-count">({group.totalPartCount})</span>
          </button>
          <button
            type="button"
            data-testid={`toggle-group-visibility-${group.id}`}
            data-visibility-state={visState}
            className={`pa-icon-btn pa-part-eye-btn ${isHidden ? 'pa-part-eye-hidden' : ''} ${isPartial ? 'pa-part-eye-partial' : ''}`}
            aria-label={visLabel}
            aria-pressed={isHidden ? true : isPartial ? 'mixed' : false}
            title={visLabel}
            disabled={isEmpty}
            onClick={() => handleToggleGroupVisibility(group)}
          >
            {isHidden ? '○' : isPartial ? '◐' : '👁'}
          </button>
        </div>

        {!isCollapsed ? (
          <div
            className="pa-assembly-folder-children"
            data-testid={`assembly-group-children-${group.id}`}
          >
            {group.childGroups.map((child) => renderGroupNode(child))}
            {group.directParts.map((part) => renderPartItem(part, group.depth + 1))}
          </div>
        ) : null}
      </div>
    )
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
            <div
              className="pa-assembly-tree-parts"
              role="group"
              aria-label="装配体零件与特征"
              data-tree-mode={assemblyTree.isGrouped ? 'grouped' : 'flat'}
            >
              {assemblyTree.isGrouped ? (
                <>
                  {assemblyTree.rootGroups.map((group) => renderGroupNode(group))}
                  {assemblyTree.rootParts.map((part) => renderPartItem(part, 0))}
                </>
              ) : (
                partMeshes.map((part) => renderPartItem(part, 0))
              )}
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
