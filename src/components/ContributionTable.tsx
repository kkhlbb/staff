import { useId } from 'react'
import { contributionRatios } from '../domain/calculate'
import type { ChainResult, Q } from '../domain/types'
import { formatMm } from '../domain/units'

/** 只用于把 result.contributions 中的 termId 映射到用户填写的代号。 */
export interface ContributionTermLabel {
  id: string
  symbol: string
}

export interface ContributionTableProps {
  /** 必须来自 calculateChain；无结果时传 null。 */
  result: ChainResult | null
  /**
   * 与 result 同一次有效计算的组成环代号。
   * stale 时应传入上次有效链的 terms，缺失时退回显示 termId。
   */
  terms?: readonly ContributionTermLabel[]
}

interface ContributionRow {
  termId: string
  symbol: string
  toleranceQ: Q
  ratio: number | null
  originalIndex: number
}

const percentFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/** 只做显示格式化：null（ΣTᵢ=0）显示“—”，不产生 NaN。 */
function formatRatio(ratio: number | null): string {
  return ratio === null ? '—' : percentFormatter.format(ratio)
}

/**
 * 按 Tᵢ 从大到小列出各组成环的公差贡献。
 *
 * 排序只比较 result.contributions 里的 toleranceQ；相等时用原始下标稳定兜底。
 * Tᵢ 与 pᵢ 全部来自 calculateChain / contributionRatios，组件不做任何尺寸运算。
 */
function buildRows(
  result: ChainResult,
  terms: readonly ContributionTermLabel[] | undefined,
): ContributionRow[] {
  const symbolById = new Map(terms?.map((term) => [term.id, term.symbol]) ?? [])
  const ratioByTermId = new Map(
    contributionRatios(result).map((item) => [item.termId, item.ratio]),
  )

  const rows = result.contributions.map((contribution, originalIndex) => ({
    ...contribution,
    symbol: symbolById.get(contribution.termId) ?? contribution.termId,
    ratio: ratioByTermId.get(contribution.termId) ?? null,
    originalIndex,
  }))

  rows.sort((a, b) => {
    if (a.toleranceQ > b.toleranceQ) {
      return -1
    }
    if (a.toleranceQ < b.toleranceQ) {
      return 1
    }
    // 显式保持原顺序；ES2019 起 Array.prototype.sort 本身也是稳定排序。
    if (a.originalIndex < b.originalIndex) {
      return -1
    }
    if (a.originalIndex > b.originalIndex) {
      return 1
    }
    return 0
  })

  return rows
}

export function ContributionTable({
  result,
  terms,
}: ContributionTableProps) {
  const headingId = `${useId()}-contribution-heading`
  const rows = result === null ? [] : buildRows(result, terms)

  return (
    <section className="contribution-table" aria-labelledby={headingId}>
      <h3 id={headingId} className="contribution-table__title">
        公差贡献
      </h3>

      {result === null || rows.length === 0 ? (
        <p className="contribution-table__empty">暂无可显示的贡献数据</p>
      ) : (
        <>
          {result.toleranceQ === 0 && (
            <p className="contribution-table__zero" role="status">
              所有输入公差为零
            </p>
          )}

          <table className="contribution-table__table" aria-label="公差贡献表">
            <thead>
              <tr>
                <th scope="col">组成环代号</th>
                <th scope="col">Tᵢ (mm)</th>
                <th scope="col">比例 pᵢ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.termId}
                  data-testid="contribution-row"
                  data-term-id={row.termId}
                >
                  <th scope="row">{row.symbol}</th>
                  <td>{formatMm(row.toleranceQ)}</td>
                  <td>{formatRatio(row.ratio)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="contribution-table__note">
            比例用于说明各项对极限区间宽度的贡献，不能解释成失效概率、缺陷原因或成本最优建议。
          </p>
        </>
      )}
    </section>
  )
}
