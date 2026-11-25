import { useState } from 'react'
import {
  formatRevisionDisplay,
  getCheckStatusMeta,
  type M2CheckItem,
  type M2EvidenceResult,
  type M2HistoryEntry,
  type M2RequirementItem,
} from './m2WorkbenchBridge'
import type {
  M3FormalVersionItem,
  M3MigrationReport,
  M3ReopenRestoreStatus,
  M3UncommittedDraftItem,
} from './m3WorkbenchBridge'

export interface M2SidebarPanelsProps {
  readonly section: 'requirements' | 'checks' | 'history'
  readonly requirements: readonly M2RequirementItem[]
  readonly checks: readonly M2CheckItem[]
  readonly checksInProgress: boolean
  readonly history: readonly M2HistoryEntry[]
  readonly formalVersions?: readonly M3FormalVersionItem[]
  readonly uncommittedDrafts?: readonly M3UncommittedDraftItem[]
  readonly restoreStatus?: M3ReopenRestoreStatus | null
  readonly migrationReport?: M3MigrationReport | null
  readonly migrationLoading?: boolean
  readonly migrationNotice?: string | null
  readonly canUndoBlockedDraft?: boolean
  readonly undoPending?: boolean
  readonly undoFeedback?: string | null
  readonly activeCheckId: string | null
  readonly activeEvidence: M2EvidenceResult | null
  readonly evidenceLoading: boolean
  readonly evidenceNotice: string | null
  readonly clarificationFeedback: Record<string, { readonly ok: boolean; readonly message: string }>
  readonly clarificationPendingId: string | null
  readonly onSelectCheck: (check: M2CheckItem) => void
  readonly onSelectRequirement: (req: M2RequirementItem) => void
  readonly onSubmitClarification: (params: {
    readonly targetId: string
    readonly mode: 'answer' | 'correct_interpretation'
    readonly content: string
  }) => void
  readonly onUndoBlockedDraft?: () => void
  readonly onLoadMigrationReport?: () => void
  readonly onOpenMigrationDrawer?: () => void
}

function formatClarificationReason(reason?: 'missing' | 'conflict' | 'ambiguousReference'): string {
  switch (reason) {
    case 'missing':
      return '信息缺失'
    case 'conflict':
      return '来源冲突'
    case 'ambiguousReference':
      return '引用歧义'
    default:
      return '待澄清'
  }
}

export function M2SidebarPanels({
  section,
  requirements,
  checks,
  checksInProgress,
  history,
  formalVersions = [],
  uncommittedDrafts = [],
  restoreStatus = null,
  migrationReport = null,
  migrationLoading = false,
  migrationNotice = null,
  canUndoBlockedDraft = false,
  undoPending = false,
  undoFeedback = null,
  activeCheckId,
  activeEvidence,
  evidenceLoading,
  evidenceNotice,
  clarificationFeedback,
  clarificationPendingId,
  onSelectCheck,
  onSelectRequirement,
  onSubmitClarification,
  onUndoBlockedDraft,
  onLoadMigrationReport,
  onOpenMigrationDrawer,
}: M2SidebarPanelsProps) {
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({})

  const updateDraftAnswer = (targetId: string, value: string) => {
    setDraftAnswers((prev) => ({ ...prev, [targetId]: value }))
  }

  const submitAnswer = (targetId: string, mode: 'answer' | 'correct_interpretation') => {
    const text = (draftAnswers[targetId] ?? '').trim()
    if (!text) return
    onSubmitClarification({ targetId, mode, content: text })
  }

  if (section === 'requirements') {
    const pendingClarificationCount = requirements.filter(
      (r) => r.status === 'needsClarification' || r.status === 'conflict',
    ).length

    return (
      <section className="pa-list" aria-label="要求列表面板">
        <div className="pa-header">
          <h3 className="pa-title">任务书要求（{requirements.length}）</h3>
          {pendingClarificationCount > 0 ? (
            <span className="pa-pill pa-tone-pending">
              ? 待回答/待澄清 {pendingClarificationCount} 项
            </span>
          ) : (
            <span className="pa-pill pa-tone-pass">✓ 全部已明确</span>
          )}
        </div>

        {requirements.length === 0 ? (
          <p className="pa-muted">暂无已提取的任务书要求。</p>
        ) : (
          <ul className="pa-list">
            {requirements.map((req) => {
              const needsClarify =
                req.status === 'needsClarification' || req.status === 'conflict'
              const feedback = clarificationFeedback[req.requirementId]
              const answerValue = draftAnswers[req.requirementId] ?? ''
              return (
                <li key={req.requirementId} className="pa-card">
                  <div className="pa-header">
                    <strong>{req.title}</strong>
                    <span
                      className={`pa-pill ${
                        needsClarify
                          ? 'pa-tone-pending'
                          : req.status === 'uncovered'
                            ? 'pa-tone-muted'
                            : 'pa-tone-pass'
                      }`}
                    >
                      {needsClarify
                        ? `? 待回答/待澄清（${formatClarificationReason(req.clarificationReason)}）`
                        : req.status === 'uncovered'
                          ? '○ 未覆盖'
                          : '✓ 已确认'}
                    </span>
                  </div>
                  <p className="pa-muted">解释：{req.interpretation}</p>
                  <p className="pa-muted pa-mono">
                    原文：{req.anchor.documentName} · 第 {req.anchor.page} 页 — {req.anchor.excerpt}
                  </p>
                  <div className="pa-controls">
                    <button
                      type="button"
                      className="pa-btn pa-btn-sm"
                      onClick={() => onSelectRequirement(req)}
                    >
                      定位关联特征与原文
                    </button>
                  </div>

                  {needsClarify ? (
                    <div className="pa-notice" aria-label={`待澄清项 ${req.title}`}>
                      {req.clarificationPrompt ? <p>{req.clarificationPrompt}</p> : null}
                      <label className="pa-field">
                        逐条回答或纠正解释
                        <input
                          type="text"
                          className="pa-input"
                          aria-label={`回答或纠正 ${req.title}`}
                          placeholder="例如：以第 1 页厚度 8 mm 为准，中心距 40 mm"
                          value={answerValue}
                          onChange={(e) => updateDraftAnswer(req.requirementId, e.target.value)}
                        />
                      </label>
                      <div className="pa-controls">
                        <button
                          type="button"
                          className="pa-btn pa-btn-active pa-btn-sm"
                          disabled={
                            clarificationPendingId === req.requirementId ||
                            answerValue.trim().length === 0
                          }
                          onClick={() => submitAnswer(req.requirementId, 'answer')}
                        >
                          提交回答
                        </button>
                        <button
                          type="button"
                          className="pa-btn pa-btn-sm"
                          disabled={
                            clarificationPendingId === req.requirementId ||
                            answerValue.trim().length === 0
                          }
                          onClick={() =>
                            submitAnswer(req.requirementId, 'correct_interpretation')
                          }
                        >
                          纠正解释
                        </button>
                      </div>
                      {feedback ? (
                        <p className="pa-muted" role="status">
                          {feedback.message}
                        </p>
                      ) : null}
                    </div>
                  ) : feedback ? (
                    <p className="pa-muted" role="status">
                      {feedback.message}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    )
  }

  if (section === 'checks') {
    const passCount = checks.filter((c) => c.status === 'pass').length
    const failCount = checks.filter((c) => c.status === 'fail').length
    const clarifyCount = checks.filter((c) => c.status === 'needsClarification').length
    const uncoveredCount = checks.filter((c) => c.status === 'uncovered').length
    const execFailCount = checks.filter((c) => c.status === 'executionFailed').length
    const checkingCount = checks.filter((c) => c.status === 'checking').length

    return (
      <section className="pa-list" aria-label="检查结果面板">
        <div className="pa-header">
          <div className="pa-row">
            <h3 className="pa-title">条款检查（{checks.length}）</h3>
            {checksInProgress ? (
              <span className="pa-pill pa-tone-action">◌ 检查中</span>
            ) : null}
          </div>
        </div>

        {/* 6-Status Engineering Check Summary Grid (Graphic + Text) */}
        <div className="pa-status-summary-grid" aria-label="六类检查状态统计">
          <div className="pa-status-summary-cell">
            <span className="pa-pill pa-tone-pass">✓ 通过</span>
            <strong className="pa-mono">{passCount}</strong>
          </div>
          <div className="pa-status-summary-cell">
            <span className="pa-pill pa-tone-danger">✕ 失败</span>
            <strong className="pa-mono">{failCount}</strong>
          </div>
          <div className="pa-status-summary-cell">
            <span className="pa-pill pa-tone-pending">? 待澄清</span>
            <strong className="pa-mono">{clarifyCount}</strong>
          </div>
          <div className="pa-status-summary-cell">
            <span className="pa-pill pa-tone-muted">○ 未覆盖</span>
            <strong className="pa-mono">{uncoveredCount}</strong>
          </div>
          <div className="pa-status-summary-cell">
            <span className="pa-pill pa-tone-execfail">! 执行失败</span>
            <strong className="pa-mono">{execFailCount}</strong>
          </div>
          <div className="pa-status-summary-cell">
            <span className="pa-pill pa-tone-action">◌ 检查中</span>
            <strong className="pa-mono">{checkingCount}</strong>
          </div>
        </div>

        {checks.length === 0 ? (
          <p className="pa-muted">暂无条款检查记录。</p>
        ) : (
          <ul className="pa-list" aria-label="检查条款列表">
            {checks.map((item) => {
              const meta = getCheckStatusMeta(item.status)
              const isSelected = activeCheckId === item.checkId
              const isClarify = item.status === 'needsClarification'
              const feedback = clarificationFeedback[item.checkId]
              const answerValue = draftAnswers[item.checkId] ?? ''

              return (
                <li
                  key={item.checkId}
                  className={`pa-card ${isSelected ? 'pa-card-selected' : ''}`}
                  data-check-status={item.status}
                >
                  <button
                    type="button"
                    className="pa-check-trigger"
                    aria-pressed={isSelected}
                    onClick={() => onSelectCheck(item)}
                  >
                    <div className="pa-header">
                      <strong>{item.title}</strong>
                      <span
                        className={`pa-pill ${meta.toneClass}`}
                        aria-label={`检查状态：${meta.label}`}
                      >
                        <span aria-hidden="true">{meta.symbol}</span> {meta.label}
                      </span>
                    </div>
                    <p className="pa-muted">{item.summary}</p>
                  </button>

                  {isClarify ? (
                    <div className="pa-notice" aria-label={`检查项待澄清 ${item.title}`}>
                      <span className="pa-pill pa-tone-pending">
                        ? 待回答/待澄清 · {formatClarificationReason(item.clarificationReason)}
                      </span>
                      {item.clarificationPrompt ? <p>{item.clarificationPrompt}</p> : null}
                      <label className="pa-field">
                        回答或纠正解释
                        <input
                          type="text"
                          className="pa-input"
                          aria-label={`澄清输入 ${item.title}`}
                          placeholder="输入澄清回答或纠正后的要求解释"
                          value={answerValue}
                          onChange={(e) => updateDraftAnswer(item.checkId, e.target.value)}
                        />
                      </label>
                      <div className="pa-controls">
                        <button
                          type="button"
                          className="pa-btn pa-btn-active pa-btn-sm"
                          disabled={
                            clarificationPendingId === item.checkId ||
                            answerValue.trim().length === 0
                          }
                          onClick={() => submitAnswer(item.checkId, 'answer')}
                        >
                          提交回答
                        </button>
                        <button
                          type="button"
                          className="pa-btn pa-btn-sm"
                          disabled={
                            clarificationPendingId === item.checkId ||
                            answerValue.trim().length === 0
                          }
                          onClick={() => submitAnswer(item.checkId, 'correct_interpretation')}
                        >
                          纠正解释
                        </button>
                      </div>
                      {feedback ? (
                        <p className="pa-muted" role="status">
                          {feedback.message}
                        </p>
                      ) : null}
                    </div>
                  ) : feedback ? (
                    <p className="pa-muted" role="status">
                      {feedback.message}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        {/* Evidence / Source Localization Card (Inline in Sidebar, Never Overlays Canvas) */}
        <section className="pa-card pa-evidence-card" aria-label="来源定位证据">
          <div className="pa-header">
            <span className="pa-card-label">来源定位与原文依据</span>
            {evidenceLoading ? (
              <span className="pa-pill pa-tone-action">定位中…</span>
            ) : null}
          </div>

          {evidenceNotice ? (
            <div className="pa-notice" role="status">
              {evidenceNotice}
            </div>
          ) : null}

          {activeEvidence ? (
            <div className="pa-list">
              {activeEvidence.anchors.map((anc, idx) => (
                <div key={`${anc.documentRef}-${anc.page}-${idx}`} className="pa-pdf-excerpt-box">
                  <div className="pa-row">
                    <strong className="pa-mono">
                      {anc.documentName} · 第 {anc.page} 页
                    </strong>
                    {anc.region ? (
                      <span className="pa-pill pa-tone-muted pa-mono">
                        选区 ({anc.region.x}, {anc.region.y}, {anc.region.width}×
                        {anc.region.height})
                      </span>
                    ) : null}
                  </div>
                  <p>{anc.excerpt}</p>
                </div>
              ))}
              {activeEvidence.thresholdText ? (
                <p className="pa-muted pa-mono">阈值要求：{activeEvidence.thresholdText}</p>
              ) : null}
              {activeEvidence.inputs && activeEvidence.inputs.length > 0 ? (
                <div className="pa-row">
                  {activeEvidence.inputs.map((inp) => (
                    <span key={inp.name} className="pa-pill pa-tone-muted pa-mono">
                      {inp.name}: {inp.valueText}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : !evidenceNotice ? (
            <p className="pa-muted">
              点击上方任意检查项，即可同步高亮模型特征、图纸标注并定位任务书原文页与选区片段。
            </p>
          ) : null}
        </section>
      </section>
    )
  }

  // History panel (M2 event history + M3 formal versions, uncommitted drafts, undo, reopen restore & migration)
  const formatDraftStatus = (status: M3UncommittedDraftItem['status']) => {
    if (status === 'passed') return { label: '✓ 可提交', tone: 'pa-tone-pass' }
    if (status === 'blocked') return { label: '✕ 已阻塞', tone: 'pa-tone-danger' }
    return { label: '◌ 生成/检查中', tone: 'pa-tone-action' }
  }

  return (
    <section className="pa-list" aria-label="修订与事件历史面板">
      {/* Reopen Restore Status (A09 / A10) */}
      {restoreStatus ? (
        <section className="pa-card" aria-label="重开项目恢复状态">
          <div className="pa-header">
            <span className="pa-card-label">重开项目恢复状态</span>
            <span
              className={`pa-pill ${
                restoreStatus.viewsConsistentWithSnapshot ? 'pa-tone-pass' : 'pa-tone-pending'
              }`}
            >
              {restoreStatus.viewsConsistentWithSnapshot
                ? '✓ 视图与提交快照一致'
                : '○ 待同步最新快照'}
            </span>
          </div>
          <div className="pa-row pa-mono">
            <span>正式版：{restoreStatus.baseRevision ?? '无'}</span>
            <span>· 草稿：{restoreStatus.draftRevision ?? '无'}</span>
            <span>· 已恢复来源证据：{restoreStatus.restoredSourceCount} 条</span>
          </div>
          <p className="pa-muted">{restoreStatus.summary}</p>
        </section>
      ) : null}

      {/* Formal Versions List */}
      <section className="pa-card" aria-label="正式版本列表">
        <div className="pa-header">
          <h3 className="pa-title">正式版本（{formalVersions.length}）</h3>
        </div>
        {formalVersions.length === 0 ? (
          <p className="pa-muted">暂无已提交的正式版本。</p>
        ) : (
          <ul className="pa-list">
            {formalVersions.map((ver) => (
              <li key={ver.revision} className="pa-check">
                <div>
                  <div className="pa-row">
                    <strong className="pa-mono">{formatRevisionDisplay(ver.revision)}</strong>
                    <span className="pa-muted pa-mono">{ver.revision}</span>
                    {ver.isCurrent ? (
                      <span className="pa-pill pa-tone-pass">当前正式版</span>
                    ) : null}
                  </div>
                  <p className="pa-muted">
                    {ver.summary}
                    {ver.checkSummary ? ` · ${ver.checkSummary}` : ''}
                  </p>
                </div>
                <span className="pa-muted pa-mono">{ver.committedAtLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Independent Uncommitted Drafts List & Undo Blocked Change (A04 / A10) */}
      <section className="pa-card" aria-label="独立未提交草稿列表">
        <div className="pa-header">
          <h3 className="pa-title">独立未提交草稿（{uncommittedDrafts.length}）</h3>
          {onUndoBlockedDraft ? (
            <button
              type="button"
              className="pa-btn pa-btn-sm"
              disabled={!canUndoBlockedDraft || undoPending}
              onClick={onUndoBlockedDraft}
            >
              {undoPending ? '正在撤销…' : '撤销最近一次被阻塞草稿修改'}
            </button>
          ) : null}
        </div>
        {undoFeedback ? (
          <p className="pa-muted" role="status">
            {undoFeedback}
          </p>
        ) : null}
        {uncommittedDrafts.length === 0 ? (
          <p className="pa-muted">暂无独立未提交草稿。</p>
        ) : (
          <ul className="pa-list">
            {uncommittedDrafts.map((draft) => {
              const badge = formatDraftStatus(draft.status)
              return (
                <li key={draft.draftRevision} className="pa-check">
                  <div>
                    <div className="pa-row">
                      <strong className="pa-mono">
                        {formatRevisionDisplay(draft.draftRevision)}
                      </strong>
                      <span className={`pa-pill ${badge.tone}`}>{badge.label}</span>
                      <span className="pa-muted pa-mono">
                        基线：{draft.baseRevision ?? '无'}
                      </span>
                    </div>
                    <p className="pa-muted">{draft.summary}</p>
                  </div>
                  <span className="pa-muted pa-mono">{draft.updatedAtLabel}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Legacy Migration Report Entry (A10) */}
      <section className="pa-card" aria-label="旧项目迁移报告入口">
        <div className="pa-header">
          <span className="pa-card-label">旧项目迁移差异与兼容报告</span>
          <div className="pa-controls">
            {migrationReport && onOpenMigrationDrawer ? (
              <button
                type="button"
                className="pa-btn pa-btn-sm pa-btn-active"
                onClick={onOpenMigrationDrawer}
              >
                展开迁移差异抽屉
              </button>
            ) : null}
            {onLoadMigrationReport ? (
              <button
                type="button"
                className="pa-btn pa-btn-sm"
                disabled={migrationLoading}
                onClick={onLoadMigrationReport}
              >
                {migrationLoading ? '读取中…' : '读取迁移差异报告'}
              </button>
            ) : null}
          </div>
        </div>
        {migrationReport ? (
          <p className="pa-muted">
            格式：{migrationReport.sourceFormat} · 未解释旧字段{' '}
            {migrationReport.unexplainedLegacyFields.length} 项 · 受限操作{' '}
            {migrationReport.restrictedOperations.length} 项
          </p>
        ) : (
          <p className="pa-muted">
            可检查旧 `.cunlian` 隔套项目迁移差异、保留字段与一维尺寸链兼容结论。
          </p>
        )}
        {migrationNotice ? (
          <p className="pa-muted" role="status">
            {migrationNotice}
          </p>
        ) : null}
      </section>

      {/* Existing M2 Event History */}
      <div className="pa-header">
        <h3 className="pa-title">修订与产物历史（{history.length}）</h3>
      </div>
      {history.length === 0 ? (
        <p className="pa-muted">暂无历史修订或迟到事件记录。</p>
      ) : (
        <ul className="pa-list" aria-label="历史事件列表">
          {history.map((entry) => (
            <li key={entry.id} className="pa-card">
              <div className="pa-header">
                <strong>{entry.title}</strong>
                {entry.isLateStale ? (
                  <span className="pa-pill pa-tone-pending">旧修订迟到（未覆盖当前）</span>
                ) : entry.status === 'failed' ? (
                  <span className="pa-pill pa-tone-danger">失败</span>
                ) : (
                  <span className="pa-pill pa-tone-muted pa-mono">
                    {formatRevisionDisplay(entry.revision)} · #{entry.sequence}
                  </span>
                )}
              </div>
              <p className="pa-muted">{entry.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
