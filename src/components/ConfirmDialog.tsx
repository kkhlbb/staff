import { useId, type ReactNode } from 'react'
import './ConfirmDialog.css'

export interface ConfirmDialogProps {
  title: string
  message: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 可测试的确认对话框。
 *
 * 覆盖基线和恢复基线都必须先经过这里，不使用 window.confirm。组件只负责
 * 呈现确认信息和回传用户选择；真正的写入仍由调用方交给 storage 层。
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = '取消',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = `${useId()}-confirm-title`
  const descriptionId = `${useId()}-confirm-description`

  return (
    <div className="confirm-dialog__backdrop">
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h2 id={titleId} className="confirm-dialog__title">
          {title}
        </h2>
        <div id={descriptionId} className="confirm-dialog__message">
          {message}
        </div>
        <div className="confirm-dialog__actions">
          <button type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="confirm-dialog__confirm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
