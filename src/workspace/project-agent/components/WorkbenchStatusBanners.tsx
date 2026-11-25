import type { RefObject } from 'react'
import type {
  M1ConnectionSource,
  M1ProjectAuthorizationState,
} from '../m1WorkbenchBridge'
import {
  formatRevisionDisplay,
  type M2ArtifactSlotState,
  type M2CheckItem,
} from '../m2WorkbenchBridge'
import { M3CompletionView } from '../M3CompletionView'
import { M3MigrationBanner } from '../M3MigrationBanner'
import type {
  M3BoundConfirmation,
  M3CompletionReadiness,
  M3ExternalProjectEvent,
  M3MigrationReport,
} from '../m3WorkbenchBridge'

export interface WorkbenchStatusBannersProps {
  // External project notifications
  readonly externalNotifications: readonly M3ExternalProjectEvent[]
  readonly externalOpenPendingId: string | null
  readonly externalOpenFeedback: string | null
  readonly onOpenExternalProjectResult: (item: M3ExternalProjectEvent) => void
  readonly onDismissExternalNotification: (eventId: string) => void

  // Legacy migration banner
  readonly migrationReport: M3MigrationReport | null
  readonly migrationDrawerOpen: boolean
  readonly onToggleMigrationDrawer: () => void

  // Completion view
  readonly showCompletionView: boolean
  readonly partName: string
  readonly projectName: string
  readonly baseRevision: string | null
  readonly draftRevision: string | null
  readonly modelSlot: M2ArtifactSlotState
  readonly drawingSlot: M2ArtifactSlotState
  readonly checkSetFingerprint: string
  readonly completionReadiness: M3CompletionReadiness
  readonly activePendingConfirmation: M3BoundConfirmation | null
  readonly effectiveInvalidatedConfirmationNotice: string | null
  readonly commitPending: boolean
  readonly commitFeedback: { readonly ok: boolean; readonly message: string } | null
  readonly canUndoInCompletionView: boolean
  readonly undoPending: boolean
  readonly undoFeedback: string | null
  readonly onCloseCompletionView: () => void
  readonly onKeepDraft: () => void
  readonly onUndoBlockedDraft: () => void
  readonly onLocateCheckSource: (check: M2CheckItem) => void
  readonly onStartOneTimeConfirm: () => void
  readonly onCancelOneTimeConfirm: () => void
  readonly onConfirmCommitFormal: () => void

  // Disconnect & takeover banner
  readonly showDisconnectBanner: boolean
  readonly scopeEpoch: number
  readonly writerEpoch: number
  readonly reconnectButtonRef: RefObject<HTMLButtonElement | null>
  readonly takeoverPending: boolean
  readonly authorizationState: M1ProjectAuthorizationState
  readonly readonlyAuthPending: boolean
  readonly connectionSource: M1ConnectionSource
  readonly selectedTakeoverTarget: 'local-agent' | 'model-api' | ''
  readonly onReconnect: () => void
  readonly onRequestReadonlyAuthorization: () => void
  readonly onChangeSelectedTakeoverTarget: (value: 'local-agent' | 'model-api' | '') => void
  readonly onTakeoverDraft: () => void
  readonly onOpenOnboarding: () => void

  // Inline status strips
  readonly readonlyAuthNotice: string | null
  readonly readonlyAuthError: string | null
  readonly takeoverNotice: string | null
  readonly takeoverError: string | null
  readonly discardedStaleCount: number
}

/**
 * Contextual banners & modals rendered between the top bar and the main body:
 * - External project modification notifications
 * - Legacy `.cunlian` migration banner
 * - M3 Completion view & bound one-time commit dialog
 * - Disconnect & takeover banner
 * - Inline auth / takeover / stale-discard status strips
 */
export function WorkbenchStatusBanners({
  externalNotifications,
  externalOpenPendingId,
  externalOpenFeedback,
  onOpenExternalProjectResult,
  onDismissExternalNotification,
  migrationReport,
  migrationDrawerOpen,
  onToggleMigrationDrawer,
  showCompletionView,
  partName,
  projectName,
  baseRevision,
  draftRevision,
  modelSlot,
  drawingSlot,
  checkSetFingerprint,
  completionReadiness,
  activePendingConfirmation,
  effectiveInvalidatedConfirmationNotice,
  commitPending,
  commitFeedback,
  canUndoInCompletionView,
  undoPending,
  undoFeedback,
  onCloseCompletionView,
  onKeepDraft,
  onUndoBlockedDraft,
  onLocateCheckSource,
  onStartOneTimeConfirm,
  onCancelOneTimeConfirm,
  onConfirmCommitFormal,
  showDisconnectBanner,
  scopeEpoch,
  writerEpoch,
  reconnectButtonRef,
  takeoverPending,
  authorizationState,
  readonlyAuthPending,
  connectionSource,
  selectedTakeoverTarget,
  onReconnect,
  onRequestReadonlyAuthorization,
  onChangeSelectedTakeoverTarget,
  onTakeoverDraft,
  onOpenOnboarding,
  readonlyAuthNotice,
  readonlyAuthError,
  takeoverNotice,
  takeoverError,
  discardedStaleCount,
}: WorkbenchStatusBannersProps) {
  return (
    <>
      {/* Non-disruptive External Project Modification Notifications */}
      {externalNotifications.length > 0 ? (
        <section
          className="pa-external-notification"
          role="status"
          aria-label="外部项目修改结果通知"
        >
          {externalNotifications.map((item) => (
            <div key={item.eventId} className="pa-header">
              <div className="pa-row">
                <span className="pa-pill pa-tone-action">外部 Agent 修改完成</span>
                <strong>{item.projectName}</strong>
                <span className="pa-pill pa-tone-muted pa-mono">
                  {formatRevisionDisplay(item.draftRevision)}（{item.draftRevision}）
                </span>
                <span className="pa-muted">{item.summary}</span>
              </div>
              <div className="pa-controls">
                <button
                  type="button"
                  className="pa-btn pa-btn-active pa-btn-sm"
                  disabled={externalOpenPendingId === item.eventId}
                  onClick={() => onOpenExternalProjectResult(item)}
                >
                  {externalOpenPendingId === item.eventId ? '正在打开…' : '打开查看'}
                </button>
                <button
                  type="button"
                  className="pa-btn pa-btn-sm"
                  onClick={() => onDismissExternalNotification(item.eventId)}
                >
                  稍后查看
                </button>
              </div>
            </div>
          ))}
          {externalOpenFeedback ? (
            <p className="pa-muted" role="alert">
              {externalOpenFeedback}
            </p>
          ) : null}
        </section>
      ) : externalOpenFeedback ? (
        <div className="pa-notice" role="alert">
          {externalOpenFeedback}
        </div>
      ) : null}

      {/* Legacy .cunlian Migration Diff Banner / Drawer (A10) */}
      {migrationReport ? (
        <M3MigrationBanner
          report={migrationReport}
          drawerOpen={migrationDrawerOpen}
          onToggleDrawer={onToggleMigrationDrawer}
        />
      ) : null}

      {/* Completion View & Bound One-Time Formal Commit (A11 / A04) */}
      {showCompletionView ? (
        <div className="pa-completion-shell">
          <M3CompletionView
            partName={partName}
            projectName={projectName}
            baseRevision={baseRevision}
            draftRevision={draftRevision}
            model={modelSlot}
            drawing={drawingSlot}
            checkSetFingerprint={checkSetFingerprint}
            readiness={completionReadiness}
            pendingConfirmation={activePendingConfirmation}
            invalidatedConfirmationNotice={effectiveInvalidatedConfirmationNotice}
            commitPending={commitPending}
            commitFeedback={commitFeedback}
            canUndoBlockedDraft={canUndoInCompletionView}
            undoPending={undoPending}
            undoFeedback={undoFeedback}
            onClose={onCloseCompletionView}
            onKeepDraft={onKeepDraft}
            onUndoBlockedDraft={onUndoBlockedDraft}
            onLocateCheckSource={onLocateCheckSource}
            onStartOneTimeConfirm={onStartOneTimeConfirm}
            onCancelOneTimeConfirm={onCancelOneTimeConfirm}
            onConfirmCommitFormal={onConfirmCommitFormal}
          />
        </div>
      ) : null}

      {/* Contextual Disconnect & Takeover Banner: appears ONLY when disconnected */}
      {showDisconnectBanner ? (
        <section
          className="pa-notice pa-disconnect-banner"
          role="alert"
          aria-label="断线与接管状态"
        >
          <div className="pa-header">
            <div className="pa-row">
              <strong>连接已断开</strong>
              <span>
                · 保留草稿 <span className="pa-mono">{draftRevision ?? '无'}</span>（正式版{' '}
                <span className="pa-mono">{baseRevision ?? '无'}</span> · 代际{' '}
                <span className="pa-mono">
                  #{scopeEpoch}/{writerEpoch}
                </span>
                ）
              </span>
            </div>
            <div className="pa-controls">
              <button
                ref={reconnectButtonRef}
                type="button"
                className="pa-btn pa-btn-primary pa-btn-sm"
                disabled={takeoverPending}
                onClick={onReconnect}
              >
                重连
              </button>
              {authorizationState === 'unauthorized' ? (
                <button
                  type="button"
                  className="pa-btn pa-btn-sm"
                  disabled={readonlyAuthPending}
                  onClick={onRequestReadonlyAuthorization}
                >
                  {readonlyAuthPending ? '申请只读授权中…' : '申请原生只读授权'}
                </button>
              ) : (
                <>
                  {connectionSource === 'none' ? (
                    <select
                      aria-label="接管目标入口"
                      className="pa-select"
                      value={selectedTakeoverTarget}
                      onChange={(event) =>
                        onChangeSelectedTakeoverTarget(
                          event.target.value as 'local-agent' | 'model-api' | '',
                        )
                      }
                    >
                      <option value="">请选择接管目标入口</option>
                      <option value="local-agent">本地 Agent</option>
                      <option value="model-api">模型 API</option>
                    </select>
                  ) : null}
                  <button
                    type="button"
                    className="pa-btn pa-btn-sm"
                    disabled={
                      takeoverPending ||
                      (connectionSource === 'none' && !selectedTakeoverTarget)
                    }
                    title={
                      connectionSource === 'none' && !selectedTakeoverTarget
                        ? '请先选择接管目标入口（本地 Agent 或模型 API）'
                        : undefined
                    }
                    onClick={onTakeoverDraft}
                  >
                    接管当前草稿
                  </button>
                </>
              )}
              <button
                type="button"
                className="pa-btn pa-btn-ghost pa-btn-sm"
                onClick={onOpenOnboarding}
              >
                切换连接
              </button>
            </div>
          </div>
          {authorizationState === 'unauthorized' ? (
            <p className="pa-muted" role="note">
              已保留当前项目结果与上下文；须先完成原生只读授权，再申请写入或接管。
            </p>
          ) : connectionSource === 'none' ? (
            <p className="pa-muted" role="note">
              已保留当前项目结果与上下文；请先明确选择接管目标入口（本地 Agent 或模型 API）。
            </p>
          ) : null}
        </section>
      ) : null}

      {readonlyAuthNotice ? (
        <div className="pa-pass-box pa-inline-status-strip" role="status">
          <span>{readonlyAuthNotice}</span>
        </div>
      ) : null}

      {readonlyAuthError ? (
        <div className="pa-danger-box pa-inline-status-strip" role="alert">
          <span>{readonlyAuthError}</span>
        </div>
      ) : null}

      {takeoverNotice ? (
        <div className="pa-pass-box pa-inline-status-strip" role="status">
          <span>{takeoverNotice}</span>
        </div>
      ) : null}

      {takeoverError ? (
        <div className="pa-danger-box pa-inline-status-strip" role="alert">
          <span>{takeoverError}</span>
        </div>
      ) : null}

      {discardedStaleCount > 0 ? (
        <div className="pa-notice pa-inline-status-strip" role="status">
          已丢弃来自旧代际/先前客户端的迟到响应或事件（共{' '}
          <span className="pa-mono">{discardedStaleCount}</span> 条）。
        </div>
      ) : null}
    </>
  )
}
