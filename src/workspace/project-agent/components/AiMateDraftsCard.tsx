import { formatEvidenceRefLabel, getEvidenceRefExcerpt } from '../assembly3dMath'
import type { AiMateDraftItem } from '../assembly3dTypes'

export interface AiMateDraftsCardProps {
  readonly drafts: readonly AiMateDraftItem[]
  readonly appliedCount: number
  readonly feedbackMessage: string | null
  readonly onToggleDraft: (draftId: string) => void
  readonly onApplySelected: () => void
  readonly onFocusFeature?: (featureId: string) => void
}

/**
 * AI-inferred 3D assembly mate drafts card.
 * Displays topological mate suggestions with confidence, rationale, and EvidenceRef
 * provenance, allowing per-item checkbox selection and one-click confirmation.
 */
export function AiMateDraftsCard({
  drafts,
  appliedCount,
  feedbackMessage,
  onToggleDraft,
  onApplySelected,
  onFocusFeature,
}: AiMateDraftsCardProps) {
  if (drafts.length === 0) {
    return null
  }

  const selectedCount = drafts.filter((item) => item.selected && !item.applied).length

  return (
    <section
      className="pa-approval pa-ai-mate-drafts-card"
      aria-label="AI 建议配合草案"
      data-testid="ai-mate-drafts-card"
    >
      <div className="pa-approval-head">
        <span>建议装配配合草案</span>
        {appliedCount > 0 ? (
          <span className="pa-mono pa-d-add" data-testid="ai-mates-applied-count">
            已应用 {appliedCount} 项
          </span>
        ) : (
          <span className="pa-mono pa-muted">{drafts.length} 项待核对</span>
        )}
      </div>

      <ul className="pa-approval-diff pa-mate-draft-list" aria-label="AI 建议配合列表">
        {drafts.map((draft) => {
          const isChecked = draft.selected
          return (
            <li
              key={draft.id}
              className={`pa-mate-draft-item ${draft.applied ? 'pa-mate-draft-applied' : ''}`}
              data-testid={`ai-mate-draft-${draft.id}`}
            >
              <div className="pa-mate-draft-top">
                <label className="pa-mate-draft-check">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={Boolean(draft.applied)}
                    aria-label={`选择配合草案：${draft.featureLabels[0]} 与 ${draft.featureLabels[1]}（${draft.mateTypeLabel}）`}
                    onChange={() => onToggleDraft(draft.id)}
                  />
                  <span className="pa-d-add pa-mono">+ 配合</span>
                  <span className="pa-mate-draft-title">
                    {draft.featureLabels[0]} ↔ {draft.featureLabels[1]}（{draft.mateTypeLabel}）
                  </span>
                </label>
                <div className="pa-mate-draft-badges">
                  <span
                    className="pa-mono pa-muted"
                    aria-label={`置信度 ${draft.confidencePercent}%`}
                  >
                    {draft.confidencePercent}%
                  </span>
                  {draft.applied ? (
                    <span className="pa-mono pa-d-add">已确认</span>
                  ) : null}
                </div>
              </div>

              <p className="pa-mate-draft-rationale">{draft.rationale}</p>

              <div className="pa-mate-draft-footer">
                <div className="pa-mate-evidence-list" aria-label="配合推断依据来源">
                  {draft.evidenceRefs.map((ref, idx) => {
                    const excerpt = getEvidenceRefExcerpt(ref)
                    return (
                      <span
                        key={`${draft.id}-ev-${idx}`}
                        className="pa-evidence-chip"
                        data-testid={`mate-evidence-${draft.id}-${idx}`}
                      >
                        依据：{formatEvidenceRefLabel(ref)}
                        {excerpt ? `「${excerpt}」` : ''}
                      </span>
                    )
                  })}
                </div>
                {onFocusFeature ? (
                  <button
                    type="button"
                    className="pa-link-subtle"
                    onClick={() => onFocusFeature(draft.featureIds[0])}
                  >
                    定位特征
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
          data-testid="apply-mate-drafts-btn"
          className="pa-ap-allow"
          disabled={selectedCount === 0}
          onClick={onApplySelected}
        >
          一键应用已选配合 ({selectedCount})
        </button>
      </div>

      {feedbackMessage ? (
        <div className="pa-pass-box pa-mate-feedback" role="status" data-testid="ai-mates-feedback">
          {feedbackMessage}
        </div>
      ) : null}
    </section>
  )
}
