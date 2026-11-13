/**
 * V3.5 补缺：复核区的条款版本历史。
 *
 * 只读列出项目里的全部条款版本（含旧版本）。每个版本明确显示自己的来源 PDF
 * 版本、页码与选区；点击只请求打开该版本的来源，不改活动条款、不写入项目。
 */
import { formatMm } from '../domain/units'
import { uiDiagnosticText, uiSourceVersionLabel, uiVersionLabel } from './uiIdentity'
import type { RequirementRevisionHistoryEntry } from '../requirements/history'
import './RequirementRevisionHistory.css'

function formatRect(rect: readonly [number, number, number, number]): string {
  return `[${rect.map((value) => Number(value.toFixed(3))).join(', ')}]`
}

export function RequirementRevisionHistory({
  items,
  onLocate,
  locateDisabled = false,
  testIdPrefix = 'requirement-history',
  sourceRevisions = [],
}: {
  items: readonly RequirementRevisionHistoryEntry[]
  onLocate: (revisionId: string) => void
  locateDisabled?: boolean
  /** 同一组件可能出现在复核区与历史报告页，测试 id / key 前缀分开。 */
  testIdPrefix?: string
  sourceRevisions?: readonly { id: string; documentId: string; createdAt: string }[]
}) {
  if (items.length === 0) return null
  return (
    <section
      className="requirement-history"
      aria-label="条款版本历史"
      data-testid={`${testIdPrefix}-section`}
    >
      <header className="requirement-history__header">
        <h4>条款版本历史（只读）</h4>
        <span className="requirement-history__count">{items.length} 个版本</span>
      </header>
      <p className="requirement-history__note">
        每个版本保留确认当时的 PDF 版本与选区。定位只打开该版本；不修改活动条款，也不写入项目。
      </p>
      <div className="requirement-history__scroll">
        <table className="requirement-history__table">
          <thead>
            <tr>
              <th scope="col">条款版本</th>
              <th scope="col">父版本</th>
              <th scope="col">确认时间</th>
              <th scope="col">区间</th>
              <th scope="col">来源 PDF 版本</th>
              <th scope="col">页码</th>
              <th scope="col">选区（PDF 点）</th>
              <th scope="col">状态</th>
              <th scope="col">定位</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr
                key={item.revisionId}
                data-testid={`${testIdPrefix}-row-${item.revisionId}`}
                className={
                  item.isActive
                    ? 'requirement-history__row requirement-history__row--active'
                    : 'requirement-history__row'
                }
              >
                <th scope="row">
                  <span>{uiVersionLabel(index + 1)}</span>
                </th>
                <td>
                  {item.parentRevisionId === null ? (
                    <span className="requirement-history__muted">无（首版）</span>
                  ) : (
                    <span>{uiVersionLabel(items.findIndex(parent => parent.revisionId === item.parentRevisionId) + 1)}</span>
                  )}
                </td>
                <td>{item.confirmedAt}</td>
                <td>
                  {formatMm(item.lowerQ)} ～ {formatMm(item.upperQ)} mm
                </td>
                <td>
                  {item.sourceKind === 'user-attestation' ? (
                    <span className="requirement-history__file">用户输入，无外部原文件</span>
                  ) : (
                    <>
                      {item.sourceFileName === null ? null : (
                        <span className="requirement-history__file">{item.sourceFileName} · </span>
                      )}
                      <span>{uiSourceVersionLabel(sourceRevisions, item.sourceRevisionId)}</span>
                    </>
                  )}
                </td>
                <td>{item.sourcePage === null ? '无页码' : `第 ${item.sourcePage} 页`}</td>
                <td>
                  <code className="requirement-history__rect">
                    {item.sourceRectPdf === null
                      ? (item.sourceStatement ?? '—')
                      : formatRect(item.sourceRectPdf)}
                  </code>
                </td>
                <td>
                  {item.isActive ? (
                    <span className="requirement-history__badge requirement-history__badge--active">
                      当前活动
                    </span>
                  ) : (
                    <span className="requirement-history__badge">历史版本</span>
                  )}
                  {item.issue === null ? null : (
                    <p className="requirement-history__issue" role="alert">
                      来源缺失：{uiDiagnosticText(item.issue.message)}
                    </p>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    data-testid={`locate-revision-${testIdPrefix}-${item.revisionId}`}
                    aria-label={`定位${uiVersionLabel(index + 1)}的来源 PDF`}
                    disabled={locateDisabled}
                    onClick={() => onLocate(item.revisionId)}
                  >
                    定位该版本来源 PDF
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
