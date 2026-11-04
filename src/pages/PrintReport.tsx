import { useEffect, useId, useState } from 'react'
import { ChainExpression } from '../components/ChainExpression'
import { ContributionTable } from '../components/ContributionTable'
import { ScenarioCompare } from '../components/ScenarioCompare'
import { calculateChain } from '../domain/calculate'
import type {
  ChainDefinition,
  ChainResult,
  DimensionTerm,
  Project,
  Q,
} from '../domain/types'
import { formatMm } from '../domain/units'
import { validateChain } from '../domain/validation'
import { getDraft, getProject } from '../storage/projects'
import { chainToDraft, draftToChain } from '../workspace/draft'
import {
  resolveReportEligibility,
  type ReportEligibility,
} from '../workspace/status'
import './PrintReport.css'

export interface PrintReportProps {
  projectId: string
  /** 返回工作台；未提供时回退到 location.hash 路由。 */
  onBackToWorkspace?: (projectId: string) => void
}

interface ReportLoaded {
  status: 'loaded'
  project: Project
  chain: ChainDefinition | null
  result: ChainResult | null
  eligibility: ReportEligibility
  baseline: ChainDefinition | null
  reportTime: string
}

type ReportState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | ReportLoaded

const NEGATIVE_CLEARANCE_NOTE =
  '封闭环允许为负值，负间隙的物理意义由用户定义；系统不推断其代表过盈、预紧或其他装配状态。'

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

/**
 * 名义值代入只按组成环顺序和方向拼接已经由 formatMm 格式化的输入值；
 * 等式右端直接使用 calculateChain 的 nominalQ，不在这里另写求和公式。
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

async function loadReport(projectId: string): Promise<ReportState> {
  const [loadedProject, loadedDraft] = await Promise.all([
    getProject(projectId),
    getDraft(projectId),
  ])

  if (!loadedProject.ok) {
    return {
      status: 'error',
      message: `无法读取项目：${loadedProject.error.message}`,
    }
  }
  if (loadedProject.value === null) {
    return { status: 'error', message: `项目不存在：${projectId}` }
  }
  if (!loadedDraft.ok) {
    return {
      status: 'error',
      message: `无法读取输入草稿：${loadedDraft.error.message}`,
    }
  }

  const project = loadedProject.value
  const draft = loadedDraft.value?.draft ?? null
  const effectiveDraft = draft ?? chainToDraft(project.working)
  const conversion = draftToChain(effectiveDraft)
  const reportTime = new Date().toLocaleString('zh-CN')

  // 无效草稿优先按“当前输入无效”拒绝，不能退回项目里最后一次有效方案出报告。
  if (!conversion.ok) {
    return {
      status: 'loaded',
      project,
      chain: null,
      result: null,
      eligibility: resolveReportEligibility({
        result: null,
        relationConfirmed: effectiveDraft.relationConfirmed,
        stale: true,
      }),
      baseline: null,
      reportTime,
    }
  }

  const chain = conversion.chain
  const result = calculateChain(chain)
  const eligibility = resolveReportEligibility({
    result,
    relationConfirmed: chain.relationConfirmed,
    stale: false,
  })

  // 基线由存储层保证经过校验；这里再校验一次，避免损坏的内存快照进入报告。
  const baseline =
    project.baseline !== null && validateChain(project.baseline.definition).ok
      ? project.baseline.definition
      : null

  return {
    status: 'loaded',
    project,
    chain,
    result,
    eligibility,
    baseline,
    reportTime,
  }
}

interface ReportDocumentProps {
  project: Project
  chain: ChainDefinition
  result: ChainResult
  statusLabel: string
  baseline: ChainDefinition | null
  reportTime: string
}

/**
 * 已通过“有效 + 已确认”门槛后的报告正文。
 *
 * 所有工程数值只来自 calculateChain 的 result、ContributionTable 内的
 * contributionRatios 以及 ScenarioCompare 内的 compareChains；本组件只负责
 * 选择标签、拼接用户输入和调用 formatMm。负间隙说明按文档第 91 行原样给出。
 */
function ReportDocument({
  project,
  chain,
  result,
  statusLabel,
  baseline,
  reportTime,
}: ReportDocumentProps) {
  const baseId = useId()
  const titleId = `${baseId}-title`
  const methodId = `${baseId}-method`
  const inputId = `${baseId}-input`
  const expressionId = `${baseId}-expression`
  const resultId = `${baseId}-result`
  const baselineId = `${baseId}-baseline`
  const notesId = `${baseId}-notes`

  return (
    <article
      className="print-report__document"
      data-testid="print-report"
      aria-labelledby={titleId}
    >
      <header className="print-report__header">
        <p className="print-report__eyebrow">轴系轴向公差链分析报告</p>
        <h1 id={titleId} className="print-report__title">
          {project.name}
        </h1>
        <dl className="print-report__meta">
          <div>
            <dt>项目名称</dt>
            <dd>{project.name}</dd>
          </div>
          <div>
            <dt>项目 ID</dt>
            <dd className="print-report__mono">{project.id}</dd>
          </div>
          <div>
            <dt>报告时间</dt>
            <dd>{reportTime}</dd>
          </div>
          <div>
            <dt>计算引擎版本</dt>
            <dd className="print-report__mono">{project.engineVersion}</dd>
          </div>
        </dl>
      </header>

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
            <dd>已确认（用户已核对尺寸关系与作用方向）</dd>
          </div>
        </dl>
      </section>

      <section className="print-report__section" aria-labelledby={inputId}>
        <h2 id={inputId}>完整输入</h2>
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
            <dt>判定</dt>
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
      </section>

      <section className="print-report__section" aria-label="公差贡献">
        <ContributionTable result={result} terms={chain.terms} />
      </section>

      {baseline !== null && project.baseline !== null ? (
        <section className="print-report__section" aria-labelledby={baselineId}>
          <h2 id={baselineId}>基线对比</h2>
          <p className="print-report__baseline-note">
            基线保存于 {formatSavedAt(project.baseline.savedAt)}
            。以下前后值、变化量和判定均来自 compareChains。
          </p>
          <ScenarioCompare baseline={baseline} working={chain} />
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
            <dt>关系确认</dt>
            <dd>
              用户已勾选“已核对尺寸关系与作用方向”。本报告只反映该确认状态，
              不代替真实装配核对。
            </dd>
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
        轴系轴向公差链分析与修改追踪工具 · 报告由用户已确认的本地数据生成
      </footer>
    </article>
  )
}

/**
 * 独立打印报告页：从 IndexedDB 读取项目与当前草稿，用共享的 status.ts
 * 判定是否已确认且有效，只有满足门槛才渲染正文和打印按钮。
 */
export function PrintReport({
  projectId,
  onBackToWorkspace,
}: PrintReportProps) {
  const [state, setState] = useState<ReportState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    loadReport(projectId)
      .then((loaded) => {
        if (!cancelled) {
          setState(loaded)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: `无法加载打印报告：${
              error instanceof Error ? error.message : String(error)
            }`,
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectId])

  const backToWorkspace = (): void => {
    if (onBackToWorkspace !== undefined) {
      onBackToWorkspace(projectId)
      return
    }
    window.location.hash = `#/projects/${encodeURIComponent(projectId)}`
  }

  if (state.status === 'loading') {
    return (
      <main className="print-report">
        <p className="print-report__loading" role="status">
          正在加载打印报告…
        </p>
      </main>
    )
  }

  if (state.status === 'error') {
    return (
      <main className="print-report">
        <section className="print-report__blocked" role="alert">
          <h1>无法打开打印报告</h1>
          <p>{state.message}</p>
          <button type="button" onClick={backToWorkspace}>
            返回工作台
          </button>
        </section>
      </main>
    )
  }

  const { project, chain, result, baseline, reportTime, eligibility } = state
  const reportable =
    eligibility.eligible && chain !== null && result !== null

  if (!reportable) {
    return (
      <main className="print-report">
        <div className="print-report__toolbar">
          <button type="button" onClick={backToWorkspace}>
            返回工作台
          </button>
        </div>
        <section
          className="print-report__blocked"
          role="alert"
          data-testid="report-blocked"
        >
          <h1>无法生成打印报告</h1>
          <p>
            {eligibility.message ??
              '当前方案不满足“已确认且有效”的出报告条件。'}
          </p>
          <p className="print-report__blocked-project">项目：{project.name}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="print-report">
      <div className="print-report__toolbar">
        <button
          type="button"
          className="print-report__back"
          onClick={backToWorkspace}
        >
          返回工作台
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
          使用浏览器“打印 / 另存为 PDF”输出 A4 报告。
        </span>
      </div>

      <ReportDocument
        project={project}
        chain={chain}
        result={result}
        statusLabel={eligibility.status.label}
        baseline={baseline}
        reportTime={reportTime}
      />
    </main>
  )
}
