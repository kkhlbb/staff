import type { M2ModelFeatureItem } from '../m2WorkbenchBridge'

export interface ContextActionPillProps {
  readonly selectedFeature: M2ModelFeatureItem | null
  readonly selectedFeatures?: readonly M2ModelFeatureItem[]
  readonly sidebarMode: 'external' | 'builtin'
  readonly contextActionFeedback: string | null
  readonly onBringIntoNextPrompt: () => void
  readonly onCopyToExternalSession: () => void
  readonly onClearSelection: () => void
}

/**
 * Floating bottom-center object reference context pill.
 * Strictly 100% hidden when nothing is selected (GUI-V2-UX-01 invariant).
 * Pre-wired as an independent container for M1B 3D assembly context actions.
 */
export function ContextActionPill({
  selectedFeature,
  selectedFeatures,
  sidebarMode,
  contextActionFeedback,
  onBringIntoNextPrompt,
  onCopyToExternalSession,
  onClearSelection,
}: ContextActionPillProps) {
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
