import { useId, useMemo, useState } from 'react'
import { Q_PER_MM, type ChainDefinition, type ChainResult } from '../domain/types'
import {
  ASSUMPTION_NOTE,
  DEFAULT_MC_SEED,
  UI_MC_SAMPLES,
  statisticalSummaryOf,
  type SamplingDistribution,
  type StatisticalSummary,
} from '../domain/statistics'

export interface StatisticalReferenceProps {
  /** 与 result 同一次有效计算的链；null 时不显示统计（不猜数据）。 */
  chain: ChainDefinition | null
  result: ChainResult | null
}

const percentFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** 统计值是浮点 q，只在显示时换算成 mm；不写回模型。 */
function formatStatMm(valueQ: number): string {
  return `${(valueQ / Q_PER_MM).toFixed(4)} mm`
}

const DISTRIBUTION_LABEL: Record<SamplingDistribution, string> = {
  normal: '正态',
  uniform: '均匀',
}

/**
 * 统计公差参考面板：极值法在前（判定依据），RSS 与蒙特卡洛并列其后。
 *
 * 只展示参考结果与假设差异；不改 `result.status`、不提供任何“按统计法判定”
 * 的入口。采样参数固定（种子 + 样本数）并在界面写明，保证同种子可复现。
 */
export function StatisticalReference({ chain, result }: StatisticalReferenceProps) {
  const baseId = useId()
  const [distribution, setDistribution] = useState<SamplingDistribution>('normal')
  const distributionId = `${baseId}-distribution`

  const summary = useMemo<StatisticalSummary | null>(() => {
    if (chain === null || result === null) return null
    return statisticalSummaryOf(chain, result, {
      seed: DEFAULT_MC_SEED,
      samples: UI_MC_SAMPLES,
      distribution,
    })
  }, [chain, result, distribution])

  if (chain === null || result === null || summary === null) {
    return (
      <section className="stat-reference" data-testid="statistical-reference">
        <h3 className="stat-reference__title">统计参考（并列展示，不参与判定）</h3>
        <p className="stat-reference__empty">暂无可用的统计参考数据</p>
      </section>
    )
  }

  const { extreme, rss, monteCarlo, crossCheck } = summary

  return (
    <section className="stat-reference" data-testid="statistical-reference">
      <h3 className="stat-reference__title">统计参考（并列展示，不参与判定）</h3>

      <div className="stat-reference__method" data-testid="stat-extreme">
        <h4>
          极值法 <span className="stat-reference__badge">判定依据</span>
        </h4>
        <dl>
          <div>
            <dt>结果区间</dt>
            <dd>
              {formatStatMm(extreme.minQ)} ~ {formatStatMm(extreme.maxQ)}
            </dd>
          </div>
          <div>
            <dt>Tc</dt>
            <dd>{formatStatMm(extreme.toleranceQ)}</dd>
          </div>
        </dl>
      </div>

      <div className="stat-reference__method" data-testid="stat-rss">
        <h4>RSS（σ = T/6，正态假设）</h4>
        <dl>
          <div>
            <dt>C₀ ± 3σ_C</dt>
            <dd>
              {formatStatMm(rss.intervalMinQ)} ~ {formatStatMm(rss.intervalMaxQ)}
            </dd>
          </div>
          <div>
            <dt>σ_C</dt>
            <dd>{formatStatMm(rss.combinedSigmaQ)}</dd>
          </div>
        </dl>
      </div>

      <div className="stat-reference__method" data-testid="stat-monte-carlo">
        <h4>
          蒙特卡洛（{DISTRIBUTION_LABEL[monteCarlo.distribution]}，种子 {monteCarlo.seed}，
          {monteCarlo.samples.toLocaleString('zh-CN')} 样本）
        </h4>
        <dl>
          <div>
            <dt>均值 / σ</dt>
            <dd>
              {formatStatMm(monteCarlo.meanQ)} / {formatStatMm(monteCarlo.sigmaQ)}
            </dd>
          </div>
          <div>
            <dt>P0.135 ~ P99.865</dt>
            <dd>
              {formatStatMm(monteCarlo.p0135Q)} ~ {formatStatMm(monteCarlo.p99865Q)}
            </dd>
          </div>
        </dl>
      </div>

      <p className="stat-reference__cross-check" data-testid="stat-cross-check">
        交叉验证：MC 的 ±3σ 与 RSS 的 ±3σ_C 相对偏差{' '}
        {crossCheck.relativeDeviation === null
          ? '—（RSS 半径为 0）'
          : percentFormatter.format(crossCheck.relativeDeviation)}
        （容差 {percentFormatter.format(crossCheck.tolerance)}；{' '}
        {crossCheck.withinTolerance ? '在容差内' : '超出容差，如实显示，不调参凑数'}）
      </p>

      <label className="stat-reference__distribution" htmlFor={distributionId}>
        蒙特卡洛分布
        <select
          id={distributionId}
          value={distribution}
          onChange={(event) => setDistribution(event.target.value as SamplingDistribution)}
        >
          <option value="normal">正态（与 RSS 同假设）</option>
          <option value="uniform">均匀（区间内等概率）</option>
        </select>
      </label>

      <p className="stat-reference__note" data-testid="stat-assumption">
        {ASSUMPTION_NOTE}
      </p>
    </section>
  )
}
