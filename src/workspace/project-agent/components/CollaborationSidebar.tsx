import type { RefObject } from 'react'
import type {
  AiMateDraftItem,
  SimulationDiagnosticResult,
  WorkbenchSidebarSection,
} from '../assembly3dTypes'
import {
  formatChatToolCallItem,
  MAX_M1_CHAT_ATTACHMENTS,
  type M1ExternalActivityItem,
  type M1SelectedObjectRef,
  type M1TaskbookReference,
} from '../m1WorkbenchBridge'
import type {
  M2CheckItem,
  M2EvidenceResult,
  M2HistoryEntry,
  M2RequirementItem,
} from '../m2WorkbenchBridge'
import { M2SidebarPanels } from '../M2SidebarPanels'
import type {
  M3FormalVersionItem,
  M3MigrationReport,
  M3ReopenRestoreStatus,
  M3UncommittedDraftItem,
} from '../m3WorkbenchBridge'
import {
  formatActivityStatusLabel,
  formatQuestionReason,
  STARTER_PROMPTS,
  type SidebarTab,
  type WorkbenchChatMessage,
} from '../workbenchHelpers'
import { AiMateDraftsCard } from './AiMateDraftsCard'
import { SimulationWhatIfPanel } from './SimulationWhatIfPanel'

export interface CollaborationSidebarProps {
  readonly sidebarRegionRef: RefObject<HTMLElement | null>
  readonly chatInputRef: RefObject<HTMLTextAreaElement | null>
  readonly retryChatButtonRef: RefObject<HTMLButtonElement | null>

  readonly sidebarSection: WorkbenchSidebarSection
  readonly sidebarTab: SidebarTab
  readonly onSelectSidebarSection: (section: WorkbenchSidebarSection) => void
  readonly checksSummaryCounts: {
    readonly total: number
    readonly failed: number
    readonly pending: number
    readonly passed: number
  }

  /** M1B 3D assembly AI mate drafts & simulation What-If props. */
  readonly feature3dAssemblyM1?: boolean
  readonly aiMateDrafts?: readonly AiMateDraftItem[]
  readonly appliedMatesCount?: number
  readonly mateDraftsFeedback?: string | null
  readonly onToggleMateDraft?: (draftId: string) => void
  readonly onApplySelectedMateDrafts?: () => void
  readonly onFocusAssemblyFeature?: (featureId: string) => void
  readonly simulationResult?: SimulationDiagnosticResult
  readonly simulationComputing?: boolean
  readonly activeAssemblyFeatureId?: string | null
  readonly onChangeContributorTolerance?: (contributorId: string, nextTolMm: number) => void
  readonly onHoverContributor?: (
    target: { readonly featureId: string; readonly partId: string } | null,
  ) => void
  readonly onClickContributor?: (target: {
    readonly featureId: string
    readonly partId: string
  }) => void

  // M2SidebarPanels props
  readonly requirements: readonly M2RequirementItem[]
  readonly checks: readonly M2CheckItem[]
  readonly checksInProgress: boolean
  readonly history: readonly M2HistoryEntry[]
  readonly formalVersions: readonly M3FormalVersionItem[]
  readonly uncommittedDrafts: readonly M3UncommittedDraftItem[]
  readonly restoreStatus: M3ReopenRestoreStatus | null
  readonly migrationReport: M3MigrationReport | null
  readonly migrationLoading: boolean
  readonly migrationNotice: string | null
  readonly canUndoBlockedDraft: boolean
  readonly undoPending: boolean
  readonly undoFeedback: string | null
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
  readonly onUndoBlockedDraft: () => void
  readonly onLoadMigrationReport: () => void
  readonly onOpenMigrationDrawer: () => void

  // External mode props
  readonly activities: readonly M1ExternalActivityItem[]
  readonly activitiesNotice: string | null
  readonly objectRefCopyFeedback: string | null
  readonly draftRevision: string | null
  readonly onRefreshExternalActivities: () => void
  readonly onSetPreviewMessage: (message: string) => void

  // Built-in chat props
  readonly builtinUnlocked: boolean
  readonly hasBuiltinChatCapability: boolean
  readonly messages: readonly WorkbenchChatMessage[]
  readonly lastFailedTurn: unknown
  readonly chatPending: boolean
  readonly chatNotice: string | null
  readonly chatInput: string
  readonly attachedTaskbooks: readonly M1TaskbookReference[]
  readonly availableTaskbooks: readonly M1TaskbookReference[]
  readonly attachedRefIds: readonly string[]
  readonly includeSelectedInChat: boolean
  readonly selectedObject: M1SelectedObjectRef | null
  readonly attachPopoverOpen: boolean
  readonly onOpenModelApiOnboarding: () => void
  readonly onChangeChatInput: (value: string) => void
  readonly onSendChat: () => void
  readonly onStopChat: () => void
  readonly onRetryChat: () => void
  readonly onToggleAttachPopover: () => void
  readonly onCloseAttachPopover: () => void
  readonly onToggleTaskbookAttachment: (refId: string) => void
  readonly onChangeIncludeSelectedInChat: (checked: boolean) => void
}

/**
 * Right 4-tab collaboration sidebar (对话/活动, 检查, 要求, 历史) with
 * unified single composer and `+ 引用` popover.
 */
export function CollaborationSidebar({
  sidebarRegionRef,
  chatInputRef,
  retryChatButtonRef,
  sidebarSection,
  sidebarTab,
  onSelectSidebarSection,
  checksSummaryCounts,
  feature3dAssemblyM1 = false,
  aiMateDrafts = [],
  appliedMatesCount = 0,
  mateDraftsFeedback = null,
  onToggleMateDraft,
  onApplySelectedMateDrafts,
  onFocusAssemblyFeature,
  simulationResult,
  simulationComputing = false,
  activeAssemblyFeatureId = null,
  onChangeContributorTolerance,
  onHoverContributor,
  onClickContributor,
  requirements,
  checks,
  checksInProgress,
  history,
  formalVersions,
  uncommittedDrafts,
  restoreStatus,
  migrationReport,
  migrationLoading,
  migrationNotice,
  canUndoBlockedDraft,
  undoPending,
  undoFeedback,
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
  activities,
  activitiesNotice,
  objectRefCopyFeedback,
  draftRevision,
  onRefreshExternalActivities,
  onSetPreviewMessage,
  builtinUnlocked,
  hasBuiltinChatCapability,
  messages,
  lastFailedTurn,
  chatPending,
  chatNotice,
  chatInput,
  attachedTaskbooks,
  availableTaskbooks,
  attachedRefIds,
  includeSelectedInChat,
  selectedObject,
  attachPopoverOpen,
  onOpenModelApiOnboarding,
  onChangeChatInput,
  onSendChat,
  onStopChat,
  onRetryChat,
  onToggleAttachPopover,
  onCloseAttachPopover,
  onToggleTaskbookAttachment,
  onChangeIncludeSelectedInChat,
}: CollaborationSidebarProps) {
  return (
    <aside
      ref={sidebarRegionRef}
      tabIndex={-1}
      className="pa-panel pa-sidebar-column pa-focus-region"
      aria-label="主工作台侧栏"
    >
      <div className="pa-sidebar-tabs" role="tablist" aria-label="侧栏功能切换">
        <button
          type="button"
          role="tab"
          aria-selected={sidebarSection === 'conversation'}
          className={
            sidebarSection === 'conversation'
              ? 'pa-sidebar-tab pa-sidebar-tab-active'
              : 'pa-sidebar-tab'
          }
          onClick={() => onSelectSidebarSection('conversation')}
        >
          {sidebarTab === 'builtin' ? '对话' : '活动'}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sidebarSection === 'checks'}
          className={
            sidebarSection === 'checks'
              ? 'pa-sidebar-tab pa-sidebar-tab-active'
              : 'pa-sidebar-tab'
          }
          onClick={() => onSelectSidebarSection('checks')}
        >
          检查
          {checksSummaryCounts.total > 0 ? (
            <span
              className={`pa-tab-badge ${
                checksSummaryCounts.failed > 0
                  ? 'pa-tab-badge-fail'
                  : checksSummaryCounts.pending > 0
                    ? 'pa-tab-badge-warn'
                    : 'pa-tab-badge-pass'
              }`}
              aria-hidden="true"
            >
              {checksSummaryCounts.passed}/{checksSummaryCounts.total}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sidebarSection === 'requirements'}
          className={
            sidebarSection === 'requirements'
              ? 'pa-sidebar-tab pa-sidebar-tab-active'
              : 'pa-sidebar-tab'
          }
          onClick={() => onSelectSidebarSection('requirements')}
        >
          要求
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sidebarSection === 'history'}
          className={
            sidebarSection === 'history'
              ? 'pa-sidebar-tab pa-sidebar-tab-active'
              : 'pa-sidebar-tab'
          }
          onClick={() => onSelectSidebarSection('history')}
        >
          历史
        </button>
        {feature3dAssemblyM1 ? (
          <button
            type="button"
            role="tab"
            data-testid="sidebar-tab-simulation"
            aria-selected={sidebarSection === 'simulation'}
            className={
              sidebarSection === 'simulation'
                ? 'pa-sidebar-tab pa-sidebar-tab-active'
                : 'pa-sidebar-tab'
            }
            onClick={() => onSelectSidebarSection('simulation')}
          >
            仿真
          </button>
        ) : null}
      </div>

      <div className="pa-sidebar-content">
        {feature3dAssemblyM1 && sidebarSection === 'simulation' && simulationResult ? (
          <SimulationWhatIfPanel
            result={simulationResult}
            computing={simulationComputing}
            activeFeatureId={activeAssemblyFeatureId}
            onChangeContributorTolerance={(id, val) => onChangeContributorTolerance?.(id, val)}
            onHoverContributor={onHoverContributor}
            onClickContributor={onClickContributor}
          />
        ) : null}

        {sidebarSection !== 'conversation' && sidebarSection !== 'simulation' ? (
          <M2SidebarPanels
            section={sidebarSection}
            requirements={requirements}
            checks={checks}
            checksInProgress={checksInProgress}
            history={history}
            formalVersions={formalVersions}
            uncommittedDrafts={uncommittedDrafts}
            restoreStatus={restoreStatus}
            migrationReport={migrationReport}
            migrationLoading={migrationLoading}
            migrationNotice={migrationNotice}
            canUndoBlockedDraft={canUndoBlockedDraft}
            undoPending={undoPending}
            undoFeedback={undoFeedback}
            activeCheckId={activeCheckId}
            activeEvidence={activeEvidence}
            evidenceLoading={evidenceLoading}
            evidenceNotice={evidenceNotice}
            clarificationFeedback={clarificationFeedback}
            clarificationPendingId={clarificationPendingId}
            onSelectCheck={onSelectCheck}
            onSelectRequirement={onSelectRequirement}
            onSubmitClarification={onSubmitClarification}
            onUndoBlockedDraft={onUndoBlockedDraft}
            onLoadMigrationReport={onLoadMigrationReport}
            onOpenMigrationDrawer={onOpenMigrationDrawer}
          />
        ) : null}

        {/* External Mode Sidebar (Clean activity stream) */}
        {sidebarSection === 'conversation' && sidebarTab === 'external' ? (
          <section className="pa-list" aria-label="外置模式任务活动侧栏">
            {feature3dAssemblyM1 && aiMateDrafts.length > 0 ? (
              <AiMateDraftsCard
                drafts={aiMateDrafts}
                appliedCount={appliedMatesCount}
                feedbackMessage={mateDraftsFeedback}
                onToggleDraft={(id) => onToggleMateDraft?.(id)}
                onApplySelected={() => onApplySelectedMateDrafts?.()}
                onFocusFeature={onFocusAssemblyFeature}
              />
            ) : null}
            <div className="pa-header">
              <span className="pa-card-label">外部 Agent 活动</span>
              <button
                type="button"
                className="pa-btn pa-btn-ghost pa-btn-sm"
                aria-label="刷新外部活动"
                onClick={onRefreshExternalActivities}
              >
                ↻ 刷新
              </button>
            </div>

            {objectRefCopyFeedback ? (
              <p className="pa-muted" role="status">
                {objectRefCopyFeedback}
              </p>
            ) : null}

            {activitiesNotice ? (
              <div className="pa-notice" role="status">
                {activitiesNotice}
              </div>
            ) : null}

            {activities.length === 0 ? (
              <div className="pa-empty-guide">
                <p className="pa-muted">
                  暂无外部 Agent 任务活动。在本地客户端下达建模指令后，进度与结果会实时同步到这里。
                </p>
              </div>
            ) : (
              <ul className="pa-list" aria-label="外部 Agent 任务活动流">
                {activities.map((item) => {
                  const badge = formatActivityStatusLabel(item.status)
                  return (
                    <li key={item.taskId} className="pa-card">
                      <div className="pa-header">
                        <strong>{item.title}</strong>
                        <span className={`pa-pill ${badge.tone}`}>{badge.label}</span>
                      </div>
                      {item.lastStep ? <p className="pa-muted">{item.lastStep}</p> : null}
                      {item.draftRevision ? (
                        <span className="pa-muted pa-mono">关联草稿：{item.draftRevision}</span>
                      ) : null}
                      {item.question ? (
                        <div className="pa-notice" aria-label="待回答问题">
                          <span className="pa-pill pa-tone-pending">
                            {formatQuestionReason(item.question.reason)}
                          </span>{' '}
                          <span>{item.question.prompt}</span>
                          {item.question.sourceExcerpt ? (
                            <p className="pa-muted">依据：{item.question.sourceExcerpt}</p>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="pa-controls">
                        <button
                          type="button"
                          className="pa-btn pa-btn-sm"
                          onClick={() =>
                            onSetPreviewMessage(
                              `正在预览外部任务 ${item.taskId} 的产物（草稿 ${item.draftRevision ?? draftRevision ?? '无'}）${item.previewSummary ? `：${item.previewSummary}` : ''}。`,
                            )
                          }
                        >
                          预览结果
                        </button>
                        <button
                          type="button"
                          className="pa-btn pa-btn-ghost pa-btn-sm"
                          onClick={() =>
                            onSetPreviewMessage(
                              `已打开任务 ${item.taskId} 的复核确认视图（草稿 ${item.draftRevision ?? draftRevision ?? '无'}，正式保存需服务端复核确认）。`,
                            )
                          }
                        >
                          复核与确认
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ) : null}

        {/* Built-in Mode Sidebar (Cursor/Linear-grade clean chat + single composer) */}
        {sidebarSection === 'conversation' && sidebarTab === 'builtin' ? (
          <section className="pa-chat-shell" aria-label="内置模式多轮对话侧栏">
            {!builtinUnlocked ? (
              <div className="pa-notice" role="alert">
                <p>
                  内置对话尚未解锁：需先在「使用模型 API」中完成配置并通过真实工具往返测试。
                </p>
                <button
                  type="button"
                  className="pa-btn pa-btn-primary pa-btn-sm"
                  onClick={onOpenModelApiOnboarding}
                >
                  前往配置模型 API
                </button>
              </div>
            ) : null}

            {builtinUnlocked && !hasBuiltinChatCapability ? (
              <div className="pa-notice" role="alert">
                后端尚未接线/不可用（缺失方法：
                <span className="pa-mono">sendM1ChatMessage</span>）。
              </div>
            ) : null}

            {/* Chat transcript or starter prompts */}
            <div className="pa-chat-scroll">
              {feature3dAssemblyM1 && aiMateDrafts.length > 0 ? (
                <AiMateDraftsCard
                  drafts={aiMateDrafts}
                  appliedCount={appliedMatesCount}
                  feedbackMessage={mateDraftsFeedback}
                  onToggleDraft={(id) => onToggleMateDraft?.(id)}
                  onApplySelected={() => onApplySelectedMateDrafts?.()}
                  onFocusFeature={onFocusAssemblyFeature}
                />
              ) : null}
              {messages.length === 0 ? (
                <div className="pa-empty-guide" aria-label="新手引导示例">
                  <p className="pa-muted">试试直接描述你的设计或修改需求：</p>
                  <div className="pa-starter-list">
                    {STARTER_PROMPTS.map((promptText) => (
                      <button
                        key={promptText}
                        type="button"
                        className="pa-starter-chip"
                        disabled={!builtinUnlocked}
                        onClick={() => {
                          onChangeChatInput(promptText)
                          chatInputRef.current?.focus()
                        }}
                      >
                        {promptText}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <ul className="pa-chat-list" aria-label="内置对话记录">
                  {messages.map((msg) => (
                    <li
                      key={msg.id}
                      className={`pa-chat-bubble ${msg.role === 'user' ? 'pa-chat-user' : 'pa-chat-assistant'}`}
                    >
                      <div className="pa-header">
                        <strong>{msg.role === 'user' ? '设计师' : '寸链助手'}</strong>
                        {msg.draftRevision ? (
                          <span className="pa-pill pa-tone-action pa-mono">
                            草稿 {msg.draftRevision}
                          </span>
                        ) : null}
                      </div>
                      <p>{msg.content}</p>
                      {msg.attachments && msg.attachments.length > 0 ? (
                        <div className="pa-row">
                          {msg.attachments.map((att) => (
                            <span key={att.refId} className="pa-pill pa-tone-muted pa-mono">
                              引用：{att.documentName} · P{att.page}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {msg.selectedObject ? (
                        <span className="pa-pill pa-tone-action">
                          对象：{msg.selectedObject.breadcrumb}
                        </span>
                      ) : null}
                      {msg.toolCalls && msg.toolCalls.length > 0 ? (
                        <div className="pa-row">
                          {msg.toolCalls.map((tc, index) => {
                            const display = formatChatToolCallItem(tc)
                            return (
                              <span
                                key={`${msg.id}-tool-${index}`}
                                className={`pa-pill ${display.tone}`}
                              >
                                {display.label}
                              </span>
                            )
                          })}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {lastFailedTurn && !chatPending ? (
                <div className="pa-retry-row">
                  <button
                    ref={retryChatButtonRef}
                    type="button"
                    className="pa-btn pa-btn-sm"
                    onClick={onRetryChat}
                  >
                    重试
                  </button>
                </div>
              ) : null}

              {chatNotice ? (
                <div className="pa-notice" role="status">
                  {chatNotice}
                </div>
              ) : null}
            </div>

            {/* Modern Unified Composer: Selected Tags + Clean Textarea + "+ 引用" Popover + Single Send/Stop */}
            <div className="pa-composer">
              {attachedTaskbooks.length > 0 || (includeSelectedInChat && selectedObject) ? (
                <div className="pa-composer-tags">
                  {includeSelectedInChat && selectedObject ? (
                    <span className="pa-composer-tag pa-composer-tag-obj">
                      {selectedObject.breadcrumb}
                    </span>
                  ) : null}
                  {attachedTaskbooks.map((tb) => (
                    <span key={tb.refId} className="pa-composer-tag pa-mono">
                      {tb.documentName} · P{tb.page}
                      <button
                        type="button"
                        className="pa-tag-remove"
                        aria-label={`移除引用 ${tb.documentName} P${tb.page}`}
                        onClick={() => onToggleTaskbookAttachment(tb.refId)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              <textarea
                ref={chatInputRef}
                aria-label="内置对话输入框"
                className="pa-composer-input"
                placeholder="描述你想创建或修改的零件特征…"
                value={chatInput}
                disabled={!builtinUnlocked || chatPending}
                onChange={(event) => onChangeChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    if (builtinUnlocked && !chatPending && chatInput.trim().length > 0) {
                      onSendChat()
                    }
                  }
                }}
              />

              <div className="pa-composer-footer">
                <div className="pa-popover-anchor">
                  <button
                    type="button"
                    data-testid="attach-ref-btn"
                    className="pa-btn pa-btn-ghost pa-btn-sm"
                    aria-label="附加任务书引用"
                    aria-expanded={attachPopoverOpen}
                    onClick={onToggleAttachPopover}
                  >
                    + 引用
                    {attachedTaskbooks.length > 0 ? ` (${attachedTaskbooks.length})` : ''}
                  </button>

                  {attachPopoverOpen ? (
                    <div
                      className="pa-popover pa-attach-popover"
                      role="dialog"
                      aria-label="对话上下文附加"
                    >
                      <div className="pa-header">
                        <span className="pa-card-label">
                          附加任务书引用（{attachedTaskbooks.length}/{MAX_M1_CHAT_ATTACHMENTS}）
                        </span>
                        <button
                          type="button"
                          className="pa-icon-btn"
                          aria-label="关闭引用选择"
                          onClick={onCloseAttachPopover}
                        >
                          ×
                        </button>
                      </div>
                      {availableTaskbooks.length === 0 ? (
                        <p className="pa-muted">当前项目上下文暂无可附加的真实任务书引用。</p>
                      ) : (
                        <div className="pa-list">
                          {availableTaskbooks.map((tb) => {
                            const active = attachedRefIds.includes(tb.refId)
                            return (
                              <button
                                key={tb.refId}
                                type="button"
                                className={
                                  active
                                    ? 'pa-btn pa-btn-active pa-btn-sm'
                                    : 'pa-btn pa-btn-sm'
                                }
                                aria-pressed={active}
                                onClick={() => onToggleTaskbookAttachment(tb.refId)}
                              >
                                {active ? '✓ ' : '+ '}
                                {tb.documentName} · P{tb.page}
                              </button>
                            )
                          })}
                        </div>
                      )}
                      <label className="pa-toggle">
                        <input
                          type="checkbox"
                          checked={includeSelectedInChat}
                          onChange={(event) => onChangeIncludeSelectedInChat(event.target.checked)}
                        />
                        带入当前选中对象上下文
                      </label>
                    </div>
                  ) : null}
                </div>

                {chatPending ? (
                  <button type="button" className="pa-btn pa-btn-sm" onClick={onStopChat}>
                    停止
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pa-btn pa-btn-primary pa-btn-sm"
                    disabled={!builtinUnlocked || chatInput.trim().length === 0}
                    onClick={onSendChat}
                  >
                    发送
                  </button>
                )}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  )
}
