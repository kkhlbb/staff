/**
 * 审查侧栏（V2.2 第一组）。
 *
 * 只消费 review/rules.ts 的统一结果：不在这里重算确认状态，也不根据绑定
 * “看起来没问题”就标完成。计算满足与审查完成分开显示。
 *
 * 每条待办按严重程度与对象分组，点击后由调用方定位到确切单元格、关系入口、
 * 目标输入或绑定版本/页；定位本身不触发保存或确认。
 */
import type { ReviewFinding, ReviewSummary } from '../review/rules'
import {
  REVIEW_RULE_LABEL,
  REVIEW_SEVERITY_LABEL,
  REVIEW_STATUS_LABEL,
} from '../review/rules'
import './ReviewSidebar.css'
import { uiDiagnosticText } from './uiIdentity'

export interface ReviewSidebarProps {
  summary: ReviewSummary
  /** 草稿当前无效时提示“显示的是上次有效结果”。 */
  stale?: boolean
  /** 点击待办时的定位动作；不提供时按钮仍可键盘聚焦，但不跳转。 */
  onLocate?: (finding: ReviewFinding) => void
}

function statusClass(status: ReviewFinding['status']): string {
  return `review-sidebar__status review-sidebar__status--${status}`
}

export function ReviewSidebar({ summary, stale = false, onLocate }: ReviewSidebarProps) {
  const pendingCount = summary.pending.length
  const completionLabel = summary.reviewComplete
    ? '审查完成：所有规则均已判定'
    : `审查未完成：${pendingCount} 项待处理`
  const calculationLabel = summary.calculation.label

  return (
    <section className="review-sidebar" aria-labelledby="review-sidebar-heading">
      <div className="review-sidebar__header">
        <div>
          <h2 id="review-sidebar-heading" className="review-sidebar__title">
            审查清单
          </h2>
          <p className="review-sidebar__subtitle">
            规则版本 {summary.rulesVersion}。确认只代表本地用户自述，不是身份认证、
            电子签名或工程批准；SHA-256 不代表文件真实性。
          </p>
        </div>
      </div>

      <div className="review-sidebar__outcomes">
        <div
          className={`review-sidebar__outcome review-sidebar__outcome--calc-${summary.calculation.status}`}
          data-testid="review-calculation"
        >
          <span className="review-sidebar__outcome-label">计算满足</span>
          <strong>{calculationLabel}</strong>
        </div>
        <div
          className={
            summary.reviewComplete
              ? 'review-sidebar__outcome review-sidebar__outcome--complete'
              : 'review-sidebar__outcome review-sidebar__outcome--incomplete'
          }
          data-testid="review-completion"
        >
          <span className="review-sidebar__outcome-label">审查完成</span>
          <strong>{completionLabel}</strong>
        </div>
      </div>

      {stale ? (
        <p className="review-sidebar__stale" role="status">
          当前输入未通过校验；下方的计算满足状态来自上次有效方案，不能当作当前结论。
        </p>
      ) : null}

      {summary.reviewComplete ? (
        <p className="review-sidebar__done" role="status">
          所有应适用规则均已有结论。计算满足与审查完成是两件事，不能互相替代。
        </p>
      ) : (
        <div className="review-sidebar__groups">
          {summary.groups.map((group) => (
            <div
              key={group.severity}
              className={`review-sidebar__group review-sidebar__group--${group.severity}`}
            >
              <h3 className="review-sidebar__group-title">
                {group.label}（{group.findings.length}）
              </h3>
              <ul className="review-sidebar__list">
                {group.findings.map((finding) => (
                  <li
                    key={`${finding.ruleId}:${finding.subject.id}`}
                    className="review-sidebar__item"
                    data-testid={`review-item-${finding.ruleId}-${finding.subject.id}`}
                  >
                    <button
                      type="button"
                      className="review-sidebar__item-main"
                      onClick={() => onLocate?.(finding)}
                      aria-label={`定位：${REVIEW_RULE_LABEL[finding.ruleId]}，${uiDiagnosticText(finding.subject.label)}`}
                    >
                      <span className="review-sidebar__rule">{REVIEW_RULE_LABEL[finding.ruleId]}</span>
                      <code className="review-sidebar__rule-id">{finding.ruleId}</code>
                      <span className={statusClass(finding.status)}>
                        {REVIEW_STATUS_LABEL[finding.status]}
                      </span>
                      <span className="review-sidebar__subject">{uiDiagnosticText(finding.subject.label)}</span>
                    </button>
                    <p className="review-sidebar__basis">依据：{uiDiagnosticText(finding.basis)}</p>
                    {finding.action === null ? null : (
                      <p className="review-sidebar__action">处理：{finding.action}</p>
                    )}
                    <span className="review-sidebar__version">
                      规则版本 {finding.ruleVersion}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <details className="review-sidebar__all">
        <summary>查看全部规则结果（{summary.findings.length} 条）</summary>
        <table className="review-sidebar__table">
          <thead>
            <tr>
              <th scope="col">规则</th>
              <th scope="col">对象</th>
              <th scope="col">状态</th>
              <th scope="col">依据</th>
              <th scope="col">规则版本</th>
            </tr>
          </thead>
          <tbody>
            {summary.findings.map((finding) => (
              <tr key={`${finding.ruleId}:${finding.subject.id}:all`}>
                <td>
                  {REVIEW_RULE_LABEL[finding.ruleId]}
                  <code className="review-sidebar__rule-id">{finding.ruleId}</code>
                </td>
                <td>{uiDiagnosticText(finding.subject.label)}</td>
                <td className={statusClass(finding.status)}>
                  {REVIEW_STATUS_LABEL[finding.status]}
                </td>
                <td>{uiDiagnosticText(finding.basis)}</td>
                <td>{finding.ruleVersion}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="review-sidebar__legend">
          严重程度：{REVIEW_SEVERITY_LABEL.blocking} / {REVIEW_SEVERITY_LABEL.warning} /{' '}
          {REVIEW_SEVERITY_LABEL.info}
        </p>
      </details>
    </section>
  )
}
