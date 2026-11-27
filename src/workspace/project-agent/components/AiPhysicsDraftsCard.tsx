import { formatEvidenceRefLabel, getEvidenceRefExcerpt } from '../assembly3dMath'
import type { AiPhysicsDraftItem } from '../assembly3dTypes'

export interface AiPhysicsDraftsCardProps {
  readonly drafts: readonly AiPhysicsDraftItem[]
  readonly appliedCount: number
  readonly feedbackMessage: string | null
  readonly activePartId?: string | null
  readonly onToggleDraft: (draftId: string) => void
  readonly onApplySelected: () => void
  readonly onHoverDraft?: (draft: AiPhysicsDraftItem | null) => void
  readonly onFocusDraft?: (draft: AiPhysicsDraftItem) => void
}

/**
 * AI-suggested compliant physics drafts card (materials, models, loads, temperature)
 * with EvidenceRef provenance, 3D part hover preview, per-item checkbox, and
 * one-click confirmation through `transport.stagePhysics`.
 */
export function AiPhysicsDraftsCard({
  drafts,
  appliedCount,
  feedbackMessage,
  activePartId = null,
  onToggleDraft,
  onApplySelected,
  onHoverDraft,
  onFocusDraft,
}: AiPhysicsDraftsCardProps) {
  if (drafts.length === 0) {
    return null
  }

  const selectedCount = drafts.filter((item) => item.selected && !item.applied).length

  return (
    <section
      className="pa-approval pa-ai-physics-drafts-card"
      aria-label="AI 建议柔性形变草案"
      data-testid="ai-physics-drafts-card"
    >
      <div className="pa-approval-head">
        <span>建议柔性形变配置</span>
        {appliedCount > 0 ? (
          <span className="pa-mono pa-d-add" data-testid="ai-physics-applied-count">
            已应用 {appliedCount} 项
          </span>
        ) : (
          <span className="pa-mono pa-muted">{drafts.length} 项待核对</span>
        )}
      </div>

      <ul className="pa-approval-diff pa-mate-draft-list" aria-label="AI 建议柔性草案列表">
        {drafts.map((draft) => {
          const isHighlighted = activePartId === draft.partId
          return (
            <li
              key={draft.id}
              className={`pa-mate-draft-item ${draft.applied ? 'pa-mate-draft-applied' : ''} ${isHighlighted ? 'pa-fourway-highlighted' : ''}`}
              data-testid={`ai-physics-draft-${draft.id}`}
              data-part-id={draft.partId}
              data-fourway-highlighted={isHighlighted ? 'true' : 'false'}
              onMouseEnter={() => onHoverDraft?.(draft)}
              onMouseLeave={() => onHoverDraft?.(null)}
            >
              <div className="pa-mate-draft-top">
                <label className="pa-mate-draft-check">
                  <input
                    type="checkbox"
                    checked={draft.selected}
                    disabled={Boolean(draft.applied)}
                    aria-label={`选择柔性草案：${draft.title}`}
                    onChange={() => onToggleDraft(draft.id)}
                  />
                  <span className="pa-d-add pa-mono">+ 柔性</span>
                  <span className="pa-mate-draft-title">{draft.partName}</span>
                </label>
                <div className="pa-mate-draft-badges">
                  {draft.materialName ? (
                    <span className="pa-mono pa-muted">{draft.materialName}</span>
                  ) : null}
                  <span
                    className="pa-mono pa-muted"
                    aria-label={`置信度 ${draft.confidencePercent}%`}
                  >
                    {draft.confidencePercent}%
                  </span>
                  {draft.applied ? <span className="pa-mono pa-d-add">已确认</span> : null}
                </div>
              </div>

              <div className="pa-mono pa-muted pa-sim-fcf-line">{draft.modelSummary}</div>
              <p className="pa-mate-draft-rationale">{draft.rationale}</p>

              <div className="pa-mate-draft-footer">
                <div className="pa-mate-evidence-list" aria-label="柔性草案依据来源">
                  {draft.evidenceRefs.map((ref, idx) => {
                    const excerpt = getEvidenceRefExcerpt(ref)
                    return (
                      <span
                        key={`${draft.id}-ev-${idx}`}
                        className={`pa-evidence-chip ${isHighlighted ? 'pa-evidence-chip-active' : ''}`}
                        data-testid={`physics-evidence-${draft.id}-${idx}`}
                      >
                        依据：{formatEvidenceRefLabel(ref)}
                        {excerpt ? `「${excerpt}」` : ''}
                      </span>
                    )
                  })}
                </div>
                {onFocusDraft ? (
                  <button
                    type="button"
                    className="pa-link-subtle"
                    onClick={() => onFocusDraft(draft)}
                  >
                    定位零件
                  </button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>

      <div className="pa-approval-foot">
        <button
          type="button"
          data-testid="apply-physics-drafts-btn"
          className="pa-ap-allow"
          disabled={selectedCount === 0}
          onClick={onApplySelected}
        >
          一键确认应用 ({selectedCount})
        </button>
      </div>

      {feedbackMessage ? (
        <div className="pa-pass-box pa-mate-feedback" role="status" data-testid="ai-physics-feedback">
          {feedbackMessage}
        </div>
      ) : null}
    </section>
  )
}
