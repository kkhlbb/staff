import { formatEvidenceRefLabel, getEvidenceRefExcerpt } from '../assembly3dMath'
import type { AiGdtDraftItem, DatumDefinition } from '../assembly3dTypes'
import { formatFcfCells } from '../gdt3dMath'

export interface AiGdtDraftsCardProps {
  readonly drafts: readonly AiGdtDraftItem[]
  readonly datums: readonly DatumDefinition[]
  readonly appliedCount: number
  readonly feedbackMessage: string | null
  readonly activeFeatureId?: string | null
  readonly onToggleDraft: (draftId: string) => void
  readonly onApplySelected: () => void
  readonly onHoverDraft?: (draft: AiGdtDraftItem | null) => void
  readonly onFocusDraft?: (draft: AiGdtDraftItem) => void
}

/**
 * AI-suggested Datum (A/B/C) & GD&T Feature Control Frame drafts card:
 * - Shows symbol, tolerance value, modifier, datum refs, confidence %, and EvidenceRef provenance
 * - Hovering a draft previews the target feature & temporary FCF/Datum badge in 3D viewport
 * - Supports per-item checkbox selection and one-click confirmation to commit into assembly GD&T set
 */
export function AiGdtDraftsCard({
  drafts,
  datums,
  appliedCount,
  feedbackMessage,
  activeFeatureId = null,
  onToggleDraft,
  onApplySelected,
  onHoverDraft,
  onFocusDraft,
}: AiGdtDraftsCardProps) {
  if (drafts.length === 0) {
    return null
  }

  const selectedCount = drafts.filter((item) => item.selected && !item.applied).length

  return (
    <section
      className="pa-approval pa-ai-gdt-drafts-card"
      aria-label="AI 建议基准与 GD&T 草案"
      data-testid="ai-gdt-drafts-card"
    >
      <div className="pa-approval-head">
        <span>建议基准与 GD&amp;T 草案</span>
        {appliedCount > 0 ? (
          <span className="pa-mono pa-d-add" data-testid="ai-gdt-applied-count">
            已应用 {appliedCount} 项
          </span>
        ) : (
          <span className="pa-mono pa-muted">{drafts.length} 项待核对</span>
        )}
      </div>

      <ul className="pa-approval-diff pa-mate-draft-list" aria-label="AI 建议基准与 GD&T 列表">
        {drafts.map((draft) => {
          const isHighlighted = activeFeatureId === draft.featureId
          const previewText =
            draft.draftKind === 'datum' && draft.datum
              ? `▼ 基准 ${draft.datum.label}`
              : draft.gdt
                ? formatFcfCells(draft.gdt, datums).summaryText
                : draft.title

          return (
            <li
              key={draft.id}
              className={`pa-mate-draft-item ${draft.applied ? 'pa-mate-draft-applied' : ''} ${isHighlighted ? 'pa-fourway-highlighted' : ''}`}
              data-testid={`ai-gdt-draft-${draft.id}`}
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
                    aria-label={`选择 GD&T 草案：${draft.title}`}
                    onChange={() => onToggleDraft(draft.id)}
                  />
                  <span className="pa-d-add pa-mono">+ 公差</span>
                  <span className="pa-mate-draft-title">{draft.featureLabel}</span>
                </label>
                <div className="pa-mate-draft-badges">
                  <span className="pa-mono pa-d-add">{previewText}</span>
                  <span
                    className="pa-mono pa-muted"
                    aria-label={`置信度 ${draft.confidencePercent}%`}
                  >
                    {draft.confidencePercent}%
                  </span>
                  {draft.applied ? <span className="pa-mono pa-d-add">已确认</span> : null}
                </div>
              </div>

              <p className="pa-mate-draft-rationale">{draft.rationale}</p>

              <div className="pa-mate-draft-footer">
                <div className="pa-mate-evidence-list" aria-label="GD&T 草案依据来源">
                  {draft.evidenceRefs.map((ref, idx) => {
                    const excerpt = getEvidenceRefExcerpt(ref)
                    return (
                      <span
                        key={`${draft.id}-ev-${idx}`}
                        className={`pa-evidence-chip ${isHighlighted ? 'pa-evidence-chip-active' : ''}`}
                        data-testid={`gdt-evidence-${draft.id}-${idx}`}
                        data-fourway-highlighted={isHighlighted ? 'true' : 'false'}
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
          data-testid="apply-gdt-drafts-btn"
          className="pa-ap-allow"
          disabled={selectedCount === 0}
          onClick={onApplySelected}
        >
          一键确认应用 ({selectedCount})
        </button>
      </div>

      {feedbackMessage ? (
        <div className="pa-pass-box pa-mate-feedback" role="status" data-testid="ai-gdt-feedback">
          {feedbackMessage}
        </div>
      ) : null}
    </section>
  )
}
