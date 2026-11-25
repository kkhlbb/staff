import { useEffect, useRef } from 'react'
import {
  formatRevisionDisplay,
  getCheckStatusMeta,
  type M2ArtifactSlotState,
  type M2CheckItem,
} from './m2WorkbenchBridge'
import type { M3BoundConfirmation, M3CompletionReadiness } from './m3WorkbenchBridge'
import { focusRecoveryElement } from './focusRecovery'

export interface M3CompletionViewProps {
  readonly partName: string
  readonly projectName: string
  readonly baseRevision: string | null
  readonly draftRevision: string | null
  readonly model: M2ArtifactSlotState
  readonly drawing: M2ArtifactSlotState
  readonly checkSetFingerprint: string
  readonly readiness: M3CompletionReadiness
  readonly pendingConfirmation: M3BoundConfirmation | null
  readonly invalidatedConfirmationNotice: string | null
  readonly commitPending: boolean
  readonly commitFeedback: { readonly ok: boolean; readonly message: string } | null
  readonly canUndoBlockedDraft?: boolean
  readonly undoPending: boolean
  readonly undoFeedback: string | null
  readonly onClose: () => void
  readonly onKeepDraft: () => void
  readonly onUndoBlockedDraft: () => void
  readonly onLocateCheckSource: (check: M2CheckItem) => void
  readonly onStartOneTimeConfirm: () => void
  readonly onCancelOneTimeConfirm: () => void
  readonly onConfirmCommitFormal: () => void
}

function formatSlotStatus(slot: M2ArtifactSlotState, label: string): {
  readonly text: string
  readonly tone: string
} {
  if (slot.status === 'ready') {
    return {
      text: slot.isDraft
        ? `✓ ${label}就绪 · ✎ 草稿（${formatRevisionDisplay(slot.revision)}）`
        : `✓ ${label}就绪（${formatRevisionDisplay(slot.revision)}）`,
      tone: 'pa-tone-pass',
    }
  }
  if (slot.status === 'building') {
    return {
      text: `◌ ${label}生成中（${formatRevisionDisplay(slot.revision)}）`,
      tone: 'pa-tone-action',
    }
  }
  if (slot.status === 'failed') {
    return {
      text: `✕ ${label}失败`,
      tone: 'pa-tone-danger',
    }
  }
  return {
    text: `○ ${label}未生成`,
    tone: 'pa-tone-muted',
  }
}

export function M3CompletionView({
  partName,
  projectName,
  baseRevision,
  draftRevision,
  model,
  drawing,
  checkSetFingerprint,
  readiness,
  pendingConfirmation,
  invalidatedConfirmationNotice,
  commitPending,
  commitFeedback,
  canUndoBlockedDraft = true,
  undoPending,
  undoFeedback,
  onClose,
  onKeepDraft,
  onUndoBlockedDraft,
  onLocateCheckSource,
  onStartOneTimeConfirm,
  onCancelOneTimeConfirm,
  onConfirmCommitFormal,
}: M3CompletionViewProps) {
  const modelStatus = formatSlotStatus(model, '模型')
  const drawingStatus = formatSlotStatus(drawing, '图纸')
  const { counts } = readiness
  const undoButtonRef = useRef<HTMLButtonElement | null>(null)
  const firstLocateButtonRef = useRef<HTMLButtonElement | null>(null)
  const prevBlockingSignatureRef = useRef<string>('')

  const blockingSignature =
    readiness.blockingChecks.length > 0
      ? `${readiness.blockingChecks.map((b) => b.check.checkId).join(',')}|undo:${canUndoBlockedDraft ? '1' : '0'}`
      : ''

  useEffect(() => {
    if (!blockingSignature || undoPending) {
      if (!blockingSignature) {
        prevBlockingSignatureRef.current = ''
      }
      return
    }
    if (prevBlockingSignatureRef.current === blockingSignature) {
      return
    }
    prevBlockingSignatureRef.current = blockingSignature
    if (canUndoBlockedDraft && undoButtonRef.current && !undoButtonRef.current.disabled) {
      focusRecoveryElement(undoButtonRef.current)
    } else if (firstLocateButtonRef.current) {
      focusRecoveryElement(firstLocateButtonRef.current)
    }
  }, [blockingSignature, canUndoBlockedDraft, undoPending])

  return (
    <section
      className="pa-panel pa-completion-view"
      aria-label="完成视图与正式版本复核"
      data-testid="completion-view"
    >
      <div className="pa-header">
        <div className="pa-row">
          <h2 className="pa-title">完成视图 · 正式版本复核</h2>
          <span className="pa-pill pa-tone-action" data-testid="completion-part-name">
            零件：{partName}
          </span>
          <span className="pa-pill pa-tone-muted pa-mono">
            项目 {projectName} · 基线正式版 {baseRevision ?? '无'} · 当前草稿{' '}
            {draftRevision ?? '无'}
          </span>
        </div>
        <button type="button" className="pa-btn" onClick={onClose}>
          关闭完成视图
        </button>
      </div>

      {/* Real-time generation progress banner (A11) */}
      {readiness.isGenerating ? (
        <div className="pa-notice" role="status" aria-label="完成视图生成实时进度">
          <div className="pa-row">
            <strong>◌ 产物或检查仍在生成中，同修订就绪后将自动呈现完整复核结果</strong>
          </div>
          <div className="pa-row">
            <span className={`pa-pill ${modelStatus.tone}`}>{modelStatus.text}</span>
            <span className={`pa-pill ${drawingStatus.tone}`}>{drawingStatus.text}</span>
            <span
              className={`pa-pill ${readiness.artifactsAligned ? 'pa-tone-pass' : 'pa-tone-pending'}`}
            >
              {readiness.artifactsAligned ? '✓ 模型与图纸同修订指纹一致' : '◌ 等待同修订指纹一致'}
            </span>
            <span
              className={`pa-pill ${readiness.checksInProgress ? 'pa-tone-action' : 'pa-tone-pass'}`}
            >
              {readiness.checksInProgress ? '◌ 条款检查中' : '✓ 检查已完成'}
            </span>
          </div>
        </div>
      ) : null}

      {/* Readiness & Revision Summary */}
      <div className="pa-grid" aria-label="完成视图产物与检查概览">
        <div className="pa-card">
          <span className="pa-card-label">模型与图纸就绪状态</span>
          <div className="pa-row">
            <span className={`pa-pill ${modelStatus.tone}`}>{modelStatus.text}</span>
            <span className={`pa-pill ${drawingStatus.tone}`}>{drawingStatus.text}</span>
            <span
              className={`pa-pill ${readiness.artifactsAligned ? 'pa-tone-pass' : 'pa-tone-pending'}`}
            >
              {readiness.artifactsAligned ? '✓ 同修订对齐' : '○ 未同修订对齐'}
            </span>
          </div>
          <span className="pa-muted pa-mono">
            模型指纹：{model.fingerprint ?? '无'} · 图纸指纹：{drawing.fingerprint ?? '无'}
          </span>
          <span className="pa-muted pa-mono" data-testid="completion-check-fingerprint">
            检查集指纹：{checkSetFingerprint}
          </span>
        </div>

        <div className="pa-card" aria-label="完成视图检查计数">
          <span className="pa-card-label">条款检查计数（共 {counts.total} 项）</span>
          <div className="pa-row">
            <span className="pa-pill pa-tone-pass">✓ 通过 {counts.pass}</span>
            <span className="pa-pill pa-tone-danger">✕ 失败 {counts.fail}</span>
            <span className="pa-pill pa-tone-pending">? 待澄清 {counts.needsClarification}</span>
            <span className="pa-pill pa-tone-muted">○ 未覆盖 {counts.uncovered}</span>
            <span className="pa-pill pa-tone-danger">! 执行失败 {counts.executionFailed}</span>
            <span className="pa-pill pa-tone-action">◌ 检查中 {counts.checking}</span>
          </div>
        </div>
      </div>

      {/* Blocking Required Checks Guard (A04) */}
      {readiness.blockingChecks.length > 0 ? (
        <div className="pa-danger-box" role="alert" aria-label="正式提交阻塞提示">
          <strong>
            已阻止正式保存：存在 {readiness.blockingChecks.length} 项未通过的必需条款，仅允许保留草稿或撤销修改
          </strong>
          <ul className="pa-list" aria-label="阻塞条款与关联特征列表">
            {readiness.blockingChecks.map(({ check, linkedFeatures }, index) => {
              const meta = getCheckStatusMeta(check.status)
              return (
                <li key={check.checkId} className="pa-card">
                  <div className="pa-header">
                    <div className="pa-row">
                      <strong>{check.title}</strong>
                      <span className={`pa-pill ${meta.toneClass}`}>
                        {meta.symbol} {meta.label}
                      </span>
                      <span className="pa-pill pa-tone-danger">必需条款</span>
                    </div>
                    <button
                      ref={index === 0 ? firstLocateButtonRef : undefined}
                      type="button"
                      className="pa-btn pa-btn-sm"
                      onClick={() => onLocateCheckSource(check)}
                    >
                      定位来源与特征
                    </button>
                  </div>
                  <p className="pa-muted">{check.summary}</p>
                  {linkedFeatures.length > 0 ? (
                    <div className="pa-row">
                      <span className="pa-muted">关联特征：</span>
                      {linkedFeatures.map((feat) => (
                        <span key={feat.objectId} className="pa-pill pa-tone-action">
                          {feat.breadcrumb}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
          <div className="pa-controls">
            <button type="button" className="pa-btn" onClick={onKeepDraft}>
              保留草稿
            </button>
            <button
              ref={undoButtonRef}
              type="button"
              className="pa-btn pa-btn-active"
              disabled={undoPending || !canUndoBlockedDraft}
              onClick={onUndoBlockedDraft}
            >
              {undoPending ? '正在撤销…' : '撤销本次被阻塞修改'}
            </button>
          </div>
          {undoFeedback ? (
            <p className="pa-muted" role="status">
              {undoFeedback}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Blocking Required Requirements Guard (E3) */}
      {readiness.blockingRequirements.length > 0 ? (
        <div className="pa-danger-box" role="alert" aria-label="正式提交阻塞要求提示">
          <strong>
            已阻止正式保存：存在 {readiness.blockingRequirements.length} 项未满足或待澄清的必需要求
          </strong>
          <ul className="pa-list" aria-label="阻塞必需要求列表">
            {readiness.blockingRequirements.map(({ requirement, reasonText }) => (
              <li key={requirement.requirementId} className="pa-card">
                <div className="pa-row">
                  <strong>{requirement.title}</strong>
                  <span className="pa-pill pa-tone-danger">必需要求</span>
                </div>
                <p className="pa-muted">{reasonText}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Failed or Unchecked Clauses List with Source Localization */}
      {readiness.failedOrUncheckedChecks.length > 0 ? (
        <section className="pa-card" aria-label="失败或未检查条款列表">
          <span className="pa-card-label">
            失败或未检查的具体条款（{readiness.failedOrUncheckedChecks.length} 项）
          </span>
          <ul className="pa-list">
            {readiness.failedOrUncheckedChecks.map((item) => {
              const meta = getCheckStatusMeta(item.status)
              return (
                <li key={`review-${item.checkId}`} className="pa-check">
                  <div>
                    <div className="pa-row">
                      <strong>{item.title}</strong>
                      <span className={`pa-pill ${meta.toneClass}`}>
                        {meta.symbol} {meta.label}
                      </span>
                    </div>
                    <p className="pa-muted">
                      {item.summary}
                      {item.anchor
                        ? ` · 来源：${item.anchor.documentName} 第 ${item.anchor.page} 页`
                        : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="pa-btn pa-btn-sm"
                    onClick={() => onLocateCheckSource(item)}
                  >
                    来源定位
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : readiness.canSaveFormal ? (
        <div className="pa-pass-box" role="status">
          <strong>✓ 当前所有条款均已通过，模型与图纸状态可核对</strong>
        </div>
      ) : (
        <div className="pa-notice" role="alert" aria-label="正式提交前置守卫提示">
          <strong>尚未满足正式提交条件：</strong>
          <ul className="pa-list">
            {readiness.blockReasons.map((reason, index) => (
              <li key={`block-reason-${index}`}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Stale Confirmation Invalidation Warning */}
      {invalidatedConfirmationNotice ? (
        <div className="pa-notice" role="alert" aria-label="旧确认失效提示">
          {invalidatedConfirmationNotice}
        </div>
      ) : null}

      {/* One-Time Bound Confirmation Step */}
      {pendingConfirmation ? (
        <section className="pa-card pa-confirm-box" aria-label="一次性人工确认提交步骤">
          <div className="pa-header">
            <strong>一次性人工确认（已绑定当前草稿与检查集指纹）</strong>
            <span className="pa-pill pa-tone-action pa-mono">
              令牌 {pendingConfirmation.confirmationToken}
            </span>
          </div>
          <div className="pa-row pa-mono">
            <span>基线正式版：{pendingConfirmation.baseRevision ?? '无'}</span>
            <span>· 草稿修订：{pendingConfirmation.draftRevision}</span>
            <span>· 检查集指纹：{pendingConfirmation.checkSetFingerprint}</span>
          </div>
          <p className="pa-muted">
            若在点击确认前草稿修订或检查结果发生变化，本次绑定确认将自动失效。
          </p>
          <div className="pa-controls">
            <button
              type="button"
              className="pa-btn pa-btn-active"
              disabled={commitPending || !readiness.canSaveFormal}
              onClick={onConfirmCommitFormal}
            >
              {commitPending ? '正在提交正式版本…' : '确认提交正式版本'}
            </button>
            <button
              type="button"
              className="pa-btn"
              disabled={commitPending}
              onClick={onCancelOneTimeConfirm}
            >
              取消确认
            </button>
          </div>
        </section>
      ) : null}

      {commitFeedback ? (
        <div className={commitFeedback.ok ? 'pa-pass-box' : 'pa-danger-box'} role="status">
          <span>{commitFeedback.message}</span>
        </div>
      ) : null}

      {/* Primary Action Bar */}
      <div className="pa-header">
        <div className="pa-row">
          {readiness.blockReasons.length > 0 ? (
            <span className="pa-muted">{readiness.blockReasons[0]}</span>
          ) : (
            <span className="pa-muted">
              全部必需条款已通过且模型/图纸同修订就绪，可进入一次性人工确认提交正式版本。
            </span>
          )}
        </div>
        <div className="pa-controls">
          <button type="button" className="pa-btn" onClick={onKeepDraft}>
            仅保留草稿
          </button>
          <button
            type="button"
            className="pa-btn pa-btn-active"
            disabled={!readiness.canSaveFormal || Boolean(pendingConfirmation) || commitPending}
            onClick={onStartOneTimeConfirm}
          >
            保存正式版本
          </button>
        </div>
      </div>
    </section>
  )
}
