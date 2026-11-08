import { useCallback, useEffect, useId, useState } from 'react'
import { ChainExpression } from '../components/ChainExpression'
import { ContributionTable } from '../components/ContributionTable'
import { ScenarioCompare } from '../components/ScenarioCompare'
import type { ChainDefinition, DimensionTerm, Q } from '../domain/types'
import { formatMm } from '../domain/units'
import {
  getAnalysisSnapshot,
  type AnalysisSnapshot,
  type SnapshotBindingEntry,
} from '../history/snapshots'
import {
  REVIEW_RULE_LABEL,
  REVIEW_SEVERITY_LABEL,
  REVIEW_STATUS_LABEL,
  type ReviewFinding,
  type ReviewStatus,
} from '../review/rules'
import { snapshotShortId } from '../history/snapshotId'
import './PrintReport.css'

export interface PrintReportProps {
  projectId: string
  snapshotId: string
  /** 返回工作台；未提供时回退到 location.hash 路由。 */
  onBackToWorkspace?: (projectId: string) => void
  /** 返回快照列表；未提供时回退到 location.hash 路由。 */
  onBackToSnapshots?: (projectId: string) => void
  /** 返回项目列表；未提供时回退到 location.hash 路由。 */
  onBackToList?: () => void
}

type ReportState =
  | { status: 'loading' }
  | { status: 'error'; kind: 'not_found' | 'storage'; message: string }
  | { status: 'loaded'; snapshot: AnalysisSnapshot }

const NEGATIVE_CLEARANCE_NOTE =
  '封闭环允许为负值，负间隙的物理意义由用户定义；系统不推断其代表过盈、预紧或其他装配状态。'

const SNAPSHOT_ONLY_NOTE =
  '本报告只读取创建时冻结的分析快照，不读取工作台实时数据；快照创建后的输入、来源或确认变化不会改变本报告。'

function formatNullableMm(value: Q | null, signed = false): string {
  return value === null ? '—' : formatMm(value, { signed })
}

function formatTarget(target: ChainDefinition['target']): string {
  return target === null
    ? '未设置目标'
    : `${formatMm(target.minQ)} ~ ${formatMm(target.maxQ)}`
}

function formatOptionalText(value: string): string {
  return value.trim() === '' ? '（未填写）' : value
}

function formatDirection(sign: 1 | -1): string {
  return sign === 1 ? '+1（增加封闭环）' : '-1（减小封闭环）'
}

function formatSavedAt(savedAt: string): string {
  const date = new Date(savedAt)
  return Number.isNaN(date.getTime()) ? savedAt : date.toLocaleString('zh-CN')
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function formatCoordinate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function formatRect(entry: SnapshotBindingEntry): string {
  const [minX, minY, maxX, maxY] = entry.rectPdf
  return `[${formatCoordinate(minX)}, ${formatCoordinate(minY)}] – [${formatCoordinate(maxX)}, ${formatCoordinate(maxY)}]`
}

function formatPageBox(entry: SnapshotBindingEntry): string {
  const [x0, y0, x1, y1] = entry.pageBoxPdf
  return `[${formatCoordinate(x0)}, ${formatCoordinate(y0)}, ${formatCoordinate(x1)}, ${formatCoordinate(y1)}]`
}

/**
 * 名义值代入只按组成环顺序和方向拼接已经由 formatMm 格式化的输入值；
 * 等式右端直接使用冻结的 result.nominalQ，不在这里另写求和公式。
 */
function formatNominalSubstitution(
  terms: readonly DimensionTerm[],
  nominalQ: Q,
): string {
  const body = terms
    .map((term, index) => {
      const sign = term.sign === 1 ? '+' : '-'
      const value = formatMm(term.nominalQ)
      return index === 0 ? `${sign}${value}` : `${sign} ${value}`
    })
    .join(' ')

  return `C = ${body} = ${formatMm(nominalQ)}`
}

function relationFinding(snapshot: AnalysisSnapshot): ReviewFinding | undefined {
  return snapshot.review.findings.find(
    (finding) => finding.ruleId === 'RELATION_CONFIRMED',
  )
}

function relationLabel(finding: ReviewFinding | undefined): string {
  if (finding === undefined) {
    return '未记录'
  }
  if (finding.status === 'passed') {
    return '已确认（用户自述核对尺寸关系与作用方向）'
  }
  return REVIEW_STATUS_LABEL[finding.status]
}

function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  return (
    <span className={`print-report__status print-report__status--${status}`}>
      {REVIEW_STATUS_LABEL[status]}
    </span>
  )
}

interface PendingListProps {
  findings: readonly ReviewFinding[]
}

function PendingList({ findings }: PendingListProps) {
  if (findings.length === 0) {
    return <p>没有待办项。</p>
  }
  return (
    <table className="print-report__table print-report__review-table">
      <thead>
        <tr>
          <th scope="col">规则</th>
          <th scope="col">对象</th>
          <th scope="col">状态</th>
          <th scope="col">严重程度</th>
          <th scope="col">依据</th>
          <th scope="col">处理动作</th>
        </tr>
      </thead>
      <tbody>
        {findings.map((finding) => (
          <tr
            key={`${finding.ruleId}:${finding.subject.kind}:${finding.subject.id}`}
            data-testid={`pending-${finding.ruleId}-${finding.subject.id}`}
          >
            <th scope="row">
              {REVIEW_RULE_LABEL[finding.ruleId]}
              <span className="print-report__rule-id">{finding.ruleId}</span>
            </th>
            <td>{finding.subject.label}</td>
            <td>
              <ReviewStatusBadge status={finding.status} />
            </td>
            <td>{REVIEW_SEVERITY_LABEL[finding.severity]}</td>
            <td>{finding.basis}</td>
            <td>{finding.action ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface ReportDocumentProps {
  snapshot: AnalysisSnapshot
}

/**
 * 报告正文：所有工程数值只来自快照内冻结的 definition / result /
 * review / sourceManifest；ContributionTable 与 ScenarioCompare 只做展示，
 * 不重新读取工作台，也不另写公式。
 */
function ReportDocument({ snapshot }: ReportDocumentProps) {
  const baseId = useId()
  const titleId = `${baseId}-title`
  const methodId = `${baseId}-method`
  const inputId = `${baseId}-input`
  const expressionId = `${baseId}-expression`
  const resultId = `${baseId}-result`
  const sourceId = `${baseId}-source`
  const reviewId = `${baseId}-review`
  const baselineId = `${baseId}-baseline`
  const notesId = `${baseId}-notes`

  const { definition: chain, result, review } = snapshot
  const relation = relationFinding(snapshot)
  const reviewIncomplete = review.pending.length > 0
  const statusLabel = reviewIncomplete
    ? `${review.calculation.label}（审查未完成，见待办）`
    : review.calculation.label
  const shortId = snapshotShortId(snapshot.id)
  // 每页页脚：页码 / 总页数 + 快照短 ID。@page 页边距盒由浏览器分页时生成，
  // 因此不能用普通 DOM 元素代替；短 ID 已过滤为字母数字，避免 CSS 注入。
  const pageRule = `@page { @bottom-center { content: "第 " counter(page) " 页 / 共 " counter(pages) " 页 · 快照 ${shortId}"; font-size: 8pt; color: #555; } }`

  return (
    <>
      <style data-testid="report-page-rule">{pageRule}</style>
      <article
      className="print-report__document"
      data-testid="print-report"
      aria-labelledby={titleId}
    >
      <header className="print-report__header">
        <p className="print-report__eyebrow">轴系轴向公差链分析报告</p>
        <h1 id={titleId} className="print-report__title">
          {snapshot.projectName}
        </h1>
        <dl className="print-report__meta">
          <div>
            <dt>项目名称</dt>
            <dd>{snapshot.projectName}</dd>
          </div>
          <div>
            <dt>项目 ID</dt>
            <dd className="print-report__mono">{snapshot.projectId}</dd>
          </div>
          <div>
            <dt>分析快照 ID</dt>
            <dd className="print-report__mono" data-testid="report-snapshot-id">
              {snapshot.id}
            </dd>
          </div>
          <div>
            <dt>快照创建时间</dt>
            <dd>{formatTime(snapshot.createdAt)}</dd>
          </div>
          <div>
            <dt>计算引擎版本</dt>
            <dd className="print-report__mono">{snapshot.engineVersion}</dd>
          </div>
          <div>
            <dt>审查规则版本</dt>
            <dd className="print-report__mono">{snapshot.reviewRulesVersion}</dd>
          </div>
          <div>
            <dt>审查状态（创建时冻结）</dt>
            <dd data-testid="report-review-state">
              {reviewIncomplete
                ? `审查未完成（${review.pending.length} 项待办）`
                : '审查完成'}
            </dd>
          </div>
          <div>
            <dt>计算状态（创建时冻结）</dt>
            <dd data-testid="report-calculation-state">
              {review.calculation.label}
            </dd>
          </div>
        </dl>
      </header>

      {reviewIncomplete ? (
        <section
          className="print-report__incomplete"
          role="note"
          data-testid="report-incomplete-banner"
        >
          <h2>审查未完成：本报告是带待办报告</h2>
          <p>
            创建快照时仍有 {review.pending.length} 项待办，详见“审查结果与未完成项”。
            本报告不能被标为“已完成复核报告”，也不能作为证据完整性结论。
          </p>
        </section>
      ) : null}

      <section className="print-report__section" aria-labelledby={methodId}>
        <h2 id={methodId}>分析方法与适用范围</h2>
        <dl className="print-report__meta print-report__meta--two">
          <div>
            <dt>分析方法</dt>
            <dd>一维极值法（线性尺寸链）</dd>
          </div>
          <div>
            <dt>单位</dt>
            <dd>mm（内部计算单位 q，1 q = 0.0001 mm）</dd>
          </div>
          <div>
            <dt>适用范围</dt>
            <dd>
              用户定义的一维线性尺寸链及输入边界；不验证真实装配拓扑、接触面、
              定位关系或作用方向，也不预测合格率。
            </dd>
          </div>
          <div>
            <dt>关系确认状态</dt>
            <dd data-testid="report-relation-state">{relationLabel(relation)}</dd>
          </div>
        </dl>
        {relation !== undefined ? (
          <p className="print-report__basis">依据：{relation.basis}</p>
        ) : null}
      </section>

      <section className="print-report__section" aria-labelledby={inputId}>
        <h2 id={inputId}>完整输入（快照冻结）</h2>
        <table className="print-report__table" aria-label="报告输入表">
          <thead>
            <tr>
              <th scope="col">代号</th>
              <th scope="col">名称</th>
              <th scope="col">基本尺寸 (mm)</th>
              <th scope="col">下偏差 (mm)</th>
              <th scope="col">上偏差 (mm)</th>
              <th scope="col">方向</th>
              <th scope="col">来源备注</th>
            </tr>
          </thead>
          <tbody>
            {chain.terms.map((term) => (
              <tr key={term.id} data-testid={`report-term-${term.id}`}>
                <th scope="row">{term.symbol}</th>
                <td>{term.name}</td>
                <td className="print-report__number">{formatMm(term.nominalQ)}</td>
                <td className="print-report__number">
                  {formatMm(term.lowerDeviationQ)}
                </td>
                <td className="print-report__number">
                  {formatMm(term.upperDeviationQ)}
                </td>
                <td>{formatDirection(term.sign)}</td>
                <td>{formatOptionalText(term.sourceNote)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="print-report__meta print-report__meta--two print-report__input-meta">
          <div>
            <dt>目标区间</dt>
            <dd className="print-report__number">{formatTarget(chain.target)}</dd>
          </div>
          <div>
            <dt>假设 / 来源说明</dt>
            <dd>{formatOptionalText(chain.assumptions)}</dd>
          </div>
        </dl>
      </section>

      <section className="print-report__section" aria-labelledby={expressionId}>
        <h2 id={expressionId}>尺寸链表达式与计算公式</h2>
        <ChainExpression terms={chain.terms} />
        <div className="print-report__formula">
          <p>
            <strong>极值法公式：</strong>
            C₀ = Σ(sᵢNᵢ)；Cmin = Σ(sᵢ=+1 时 Lᵢ，sᵢ=-1 时 −Uᵢ)；
            Cmax = Σ(sᵢ=+1 时 Uᵢ，sᵢ=-1 时 −Lᵢ)。
          </p>
          <p>
            EIc = Cmin − C₀；ESc = Cmax − C₀；Tc = Cmax − Cmin = ΣTᵢ；
            Mlow = Cmin − Rmin；Mhigh = Rmax − Cmax。
          </p>
          <p className="print-report__substitution" data-testid="report-substitution">
            <strong>名义值代入：</strong>
            {formatNominalSubstitution(chain.terms, result.nominalQ)}
          </p>
        </div>
      </section>

      <section className="print-report__section" aria-labelledby={resultId}>
        <h2 id={resultId}>计算结果与判定</h2>
        <dl className="print-report__values">
          <div data-testid="report-result-nominal">
            <dt>C₀ 封闭环基本尺寸</dt>
            <dd>{formatMm(result.nominalQ)}</dd>
          </div>
          <div data-testid="report-result-min">
            <dt>Cmin 封闭环最小值</dt>
            <dd>{formatMm(result.minQ)}</dd>
          </div>
          <div data-testid="report-result-max">
            <dt>Cmax 封闭环最大值</dt>
            <dd>{formatMm(result.maxQ)}</dd>
          </div>
          <div data-testid="report-result-lower-deviation">
            <dt>EIc 封闭环下偏差</dt>
            <dd>{formatMm(result.lowerDeviationQ, { signed: true })}</dd>
          </div>
          <div data-testid="report-result-upper-deviation">
            <dt>ESc 封闭环上偏差</dt>
            <dd>{formatMm(result.upperDeviationQ, { signed: true })}</dd>
          </div>
          <div data-testid="report-result-tolerance">
            <dt>Tc 封闭环公差</dt>
            <dd>{formatMm(result.toleranceQ)}</dd>
          </div>
          <div data-testid="report-result-target">
            <dt>目标区间 [Rmin, Rmax]</dt>
            <dd>{formatTarget(chain.target)}</dd>
          </div>
          <div data-testid="report-result-status">
            <dt>判定（计算结论）</dt>
            <dd>{statusLabel}</dd>
          </div>
          <div data-testid="report-result-lower-margin">
            <dt>下限裕量 Mlow</dt>
            <dd>{formatNullableMm(result.lowerMarginQ, true)}</dd>
          </div>
          <div data-testid="report-result-upper-margin">
            <dt>上限裕量 Mhigh</dt>
            <dd>{formatNullableMm(result.upperMarginQ, true)}</dd>
          </div>
        </dl>
        <p className="print-report__basis">
          判定来自冻结的计算结果；审查完成度单独显示，两者不互相替代。
        </p>
      </section>

      <section className="print-report__section" aria-label="公差贡献">
        <ContributionTable result={result} terms={chain.terms} />
      </section>

      <section className="print-report__section" aria-labelledby={sourceId}>
        <h2 id={sourceId}>来源清单（快照冻结）</h2>
        {snapshot.sourceManifest.bindings.length === 0 ? (
          <p className="print-report__basis" data-testid="report-no-bindings">
            未建立任何来源绑定：来源审查为“未检查”，证据不完整；这不会改变计算结果。
          </p>
        ) : (
          <>
            {snapshot.sourceManifest.unboundTermIds.length > 0 ? (
              <p className="print-report__basis">
                以下组成环没有来源绑定，来源审查为未检查：
                {snapshot.sourceManifest.unboundTermIds.join('、')}。
              </p>
            ) : null}
            <table className="print-report__table" aria-label="来源清单">
              <thead>
                <tr>
                  <th scope="col">组成环</th>
                  <th scope="col">文档 / 文件</th>
                  <th scope="col">版本 ID</th>
                  <th scope="col">页</th>
                  <th scope="col">区域（PDF 坐标）</th>
                  <th scope="col">可读</th>
                  <th scope="col">版本状态</th>
                  <th scope="col">数值核对</th>
                  <th scope="col">历史来源理由</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.sourceManifest.bindings.map((entry) => (
                  <tr
                    key={entry.bindingId}
                    data-testid={`report-source-${entry.bindingId}`}
                  >
                    <th scope="row">
                      {entry.termLabel ?? entry.termId}
                      <span className="print-report__rule-id">
                        环修订 {entry.termRevision ?? '—'}
                      </span>
                    </th>
                    <td>
                      {entry.documentTitle ?? entry.documentId}
                      <span className="print-report__rule-id">
                        {entry.fileName ?? '文件记录缺失'}
                      </span>
                    </td>
                    <td className="print-report__mono print-report__small">
                      {entry.revisionId}
                      {entry.revisionSha256 !== null ? (
                        <>
                          <br />
                          SHA-256 {entry.revisionSha256.slice(0, 16)}…
                        </>
                      ) : null}
                    </td>
                    <td>第 {entry.page} 页</td>
                    <td>
                      {formatRect(entry)}
                      <span className="print-report__rule-id">
                        页面 {formatPageBox(entry)}
                      </span>
                    </td>
                    <td>
                      <ReviewStatusBadge status={entry.status.available} />
                    </td>
                    <td>
                      <ReviewStatusBadge status={entry.status.current} />
                    </td>
                    <td>
                      <ReviewStatusBadge status={entry.status.valueReviewed} />
                    </td>
                    <td>
                      {entry.historicalAcceptance === null ? (
                        '—'
                      ) : (
                        <>
                          理由：{entry.historicalAcceptance.reason}
                          <br />
                          范围：{entry.historicalAcceptance.scope}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="print-report__section" aria-labelledby={reviewId}>
        <h2 id={reviewId}>审查结果与未完成项（快照冻结）</h2>
        <dl className="print-report__review-summary">
          {(
            ['passed', 'failed', 'unchecked', 'needs-human', 'not-applicable'] as const
          ).map((status) => (
            <div key={status}>
              <dt>{REVIEW_STATUS_LABEL[status]}</dt>
              <dd>{review.byStatus[status]}</dd>
            </div>
          ))}
        </dl>
        <p className="print-report__basis">
          审查完成：{reviewIncomplete ? `否，共 ${review.pending.length} 项待办` : '是'}。
          规则版本 {snapshot.reviewRulesVersion}；所有规则结果均来自统一审查模块。
        </p>
        <h3>未完成项</h3>
        <PendingList findings={review.pending} />
      </section>

      {snapshot.baseline !== null ? (
        <section className="print-report__section" aria-labelledby={baselineId}>
          <h2 id={baselineId}>基线对比（快照冻结）</h2>
          <p className="print-report__baseline-note">
            基线保存于 {formatSavedAt(snapshot.baseline.savedAt)}
            。以下前后值、变化量和判定均来自创建快照时冻结的对比结果。
          </p>
          {snapshot.comparison === null || snapshot.comparison === undefined ? (
            <p className="print-report__basis" data-testid="report-comparison-missing">
              该快照创建时未冻结基线对比结果（旧版快照）。按不可变契约，本报告
              不补算、不调用当前引擎重算基线；请以冻结的输入与主结果为准。
            </p>
          ) : (
            <ScenarioCompare
              baseline={snapshot.baseline.definition}
              working={chain}
              diff={snapshot.comparison.diff}
            />
          )}
        </section>
      ) : null}

      <section className="print-report__section" aria-labelledby={notesId}>
        <h2 id={notesId}>假设与待确认事项</h2>
        <dl className="print-report__notes">
          <div>
            <dt>负间隙说明</dt>
            <dd data-testid="report-negative-clearance">{NEGATIVE_CLEARANCE_NOTE}</dd>
          </div>
          <div>
            <dt>假设 / 来源说明</dt>
            <dd>{formatOptionalText(chain.assumptions)}</dd>
          </div>
          <div>
            <dt>快照边界</dt>
            <dd>{SNAPSHOT_ONLY_NOTE}</dd>
          </div>
          <div>
            <dt>待确认事项</dt>
            <dd>
              实际装配的接触面、定位关系、作用方向及来源备注仍需用户复核；
              本报告不构成制造可行性、加工成本或合格率建议。
            </dd>
          </div>
          <div>
            <dt>计算依据</dt>
            <dd>
              所有数值由本地计算内核按整数单位 q 计算并用 formatMm 显示，
              不包含 AI 解释或外部标准推断。
            </dd>
          </div>
        </dl>
      </section>

      <footer className="print-report__footer">
        轴系轴向公差链分析与修改追踪工具 · 报告由不可变分析快照生成（快照 ID：
        <span className="print-report__mono">{snapshot.id}</span>）
      </footer>
      </article>
    </>
  )
}

/**
 * 独立打印报告页：只按 snapshotId 读取不可变分析快照，不读取项目实时数据、
 * 草稿或来源状态。报告门槛从“有效且关系已确认”改为“快照存在”；
 * 审查是否完成由快照内冻结的状态显示，不再阻止打印。
 */
export function PrintReport({
  projectId,
  snapshotId,
  onBackToWorkspace,
  onBackToSnapshots,
  onBackToList,
}: PrintReportProps) {
  const [state, setState] = useState<ReportState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    getAnalysisSnapshot(snapshotId)
      .then((loaded) => {
        if (cancelled) {
          return
        }
        if (!loaded.ok) {
          setState({
            status: 'error',
            kind: 'storage',
            message: loaded.error.message,
          })
          return
        }
        if (loaded.value === null) {
          setState({
            status: 'error',
            kind: 'not_found',
            message: `分析快照不存在：${snapshotId}`,
          })
          return
        }
        if (loaded.value.projectId !== projectId) {
          setState({
            status: 'error',
            kind: 'not_found',
            message: '该分析快照不属于此项目。',
          })
          return
        }
        setState({ status: 'loaded', snapshot: loaded.value })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            kind: 'storage',
            message: `无法加载分析快照：${
              error instanceof Error ? error.message : String(error)
            }`,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId, snapshotId, reloadToken])

  const retry = useCallback((): void => {
    setState({ status: 'loading' })
    setReloadToken((token) => token + 1)
  }, [])

  const backToWorkspace = (): void => {
    if (onBackToWorkspace !== undefined) {
      onBackToWorkspace(projectId)
      return
    }
    window.location.hash = `#/projects/${encodeURIComponent(projectId)}`
  }

  const backToSnapshots = (): void => {
    if (onBackToSnapshots !== undefined) {
      onBackToSnapshots(projectId)
      return
    }
    window.location.hash = `#/projects/${encodeURIComponent(projectId)}/snapshots`
  }

  const backToList = (): void => {
    if (onBackToList !== undefined) {
      onBackToList()
      return
    }
    window.location.hash = '#/projects'
  }

  if (state.status === 'loading') {
    return (
      <main className="print-report">
        <p className="print-report__loading" role="status">
          正在加载分析快照…
        </p>
      </main>
    )
  }

  if (state.status === 'error') {
    const notFound = state.kind === 'not_found'
    return (
      <main className="print-report">
        <section className="print-report__blocked" role="alert">
          <h1>{notFound ? '分析快照不存在' : '本地存储不可用'}</h1>
          <p>
            发生了什么：{state.message}
            {notFound
              ? '。快照可能已被删除（删除项目会同时删除其快照），或报告链接不正确。'
              : '。浏览器无法打开本地数据库，报告数据可能没有读取成功。'}
          </p>
          <p>
            接下来：
            {notFound
              ? '返回快照列表重新选择，或回到工作台创建新的分析快照。'
              : '先点“重试”重新读取；如果仍然失败，请返回项目列表。'}
          </p>
          <div className="print-report__error-actions">
            {notFound ? null : (
              <button type="button" onClick={retry}>
                重试
              </button>
            )}
            <button type="button" onClick={backToList}>
              返回项目列表
            </button>
            <button type="button" onClick={backToSnapshots}>
              返回快照列表
            </button>
            {notFound ? null : (
              <button type="button" onClick={backToWorkspace}>
                返回工作台
              </button>
            )}
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="print-report">
      <div className="print-report__toolbar">
        <button type="button" className="print-report__back" onClick={backToWorkspace}>
          返回工作台
        </button>
        <button type="button" className="print-report__back" onClick={backToSnapshots}>
          返回快照列表
        </button>
        <button
          type="button"
          className="print-report__print"
          onClick={() => {
            window.print()
          }}
        >
          打印报告
        </button>
        <span className="print-report__toolbar-hint">
          使用浏览器“打印 / 另存为 PDF”输出 A4 报告；内容来自不可变快照。
        </span>
      </div>

      <ReportDocument snapshot={state.snapshot} />
    </main>
  )
}
