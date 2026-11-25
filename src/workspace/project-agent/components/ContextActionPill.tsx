import { formatHumanReadableFeatureLabel, resolveContextPillActions } from '../assembly3dMath'
import type { AssemblyFeatureSelectionItem, ContextPillActionId } from '../assembly3dTypes'
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
}

/**
 * Floating bottom-center smart contextual action pill.
 * Strictly 100% hidden when nothing is selected (GUI-V2-UX-01 invariant).
 * - In M0/M1 single-part mode (`assemblyMode = false`): preserves existing behavior.
 * - In M1B 3D assembly mode (`assemblyMode = true`): shows selection count badge,
 *   human-readable feature labels (zero raw internal IDs), and 2–4 dynamic atomic
 *   actions tailored to 1-feature or 2-feature geometry types.
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
}: ContextActionPillProps) {
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

    return (
      <div className="pa-context-float-bottom">
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
                onClick={() => onExecuteAssemblyAction?.(action.id)}
              >
                {action.label}
              </button>
            ))}
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
