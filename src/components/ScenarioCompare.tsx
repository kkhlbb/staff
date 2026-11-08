import { useMemo } from 'react'
import {
  compareChains,
  type Delta,
  type Diff,
  type TermFieldChange,
} from '../domain/compare'
import type { ChainDefinition, ChainResult, Q } from '../domain/types'
import { formatMm } from '../domain/units'
import './ScenarioCompare.css'

export interface ScenarioCompareProps {
  /** 不可变基线定义；报告与工作台都传入，用于显示代号。 */
  baseline: ChainDefinition
  /** 当前通过校验的工作方案。 */
  working: ChainDefinition
  /**
   * 已冻结的对比结果。报告必须传入，组件因此不再调用 compareChains；
   * 工作台实时对比不传，仍按当前输入即时计算。
   */
  diff?: Diff
}

const TERM_FIELD_LABEL: Record<TermFieldChange['field'], string> = {
  symbol: '代号',
  name: '名称',
  nominalQ: '基本尺寸',
  lowerDeviationQ: '下偏差',
  upperDeviationQ: '上偏差',
  sign: '方向',
  sourceNote: '来源备注',
}

const STATUS_LABEL: Record<ChainResult['status'], string> = {
  within: '满足',
  outside: '不满足',
  'no-target': '未设置目标',
}

function formatNullableMm(value: Q | null): string {
  return value === null ? '—' : formatMm(value)
}

/** 变化量直接使用 compareChains 的 delta，不在组件里做减法。 */
function formatDelta(delta: Delta): string {
  return delta.delta === null ? '—' : formatMm(delta.delta, { signed: true })
}

function formatFieldValue(
  change: TermFieldChange,
  side: 'before' | 'after',
): string {
  switch (change.field) {
    case 'symbol':
    case 'name':
    case 'sourceNote': {
      const value = change[side]
      return value.trim() === '' ? '（空）' : value
    }
    case 'sign':
      return change[side] === 1 ? '+1（增加封闭环）' : '-1（减小封闭环）'
    default:
      return formatMm(change[side])
  }
}

function hasNonZeroDelta(delta: Delta): boolean {
  return delta.delta !== null && delta.delta !== 0
}

function hasAnyChange(diff: Diff): boolean {
  return (
    diff.termChanges.length > 0 ||
    diff.addedTermIds.length > 0 ||
    diff.removedTermIds.length > 0 ||
    diff.orderChanged ||
    diff.targetChanged ||
    hasNonZeroDelta(diff.minQ) ||
    hasNonZeroDelta(diff.maxQ) ||
    hasNonZeroDelta(diff.toleranceQ) ||
    hasNonZeroDelta(diff.lowerMarginQ) ||
    hasNonZeroDelta(diff.upperMarginQ) ||
    diff.statusBefore !== diff.statusAfter
  )
}

interface DeltaRowProps {
  label: string
  testId: string
  delta: Delta
}

function DeltaRow({ label, testId, delta }: DeltaRowProps) {
  return (
    <tr data-testid={testId}>
      <th scope="row">{label}</th>
      <td>{formatNullableMm(delta.before)}</td>
      <td>{formatNullableMm(delta.after)}</td>
      <td data-testid={`${testId}-delta`}>{formatDelta(delta)}</td>
    </tr>
  )
}

/**
 * 基线与工作方案对比。
 *
 * 所有差异、前后值和变化量都只读取 compareChains 的 Diff；组件只负责
 * 选择标签和调用 formatMm 等格式化函数，不重新计算任何尺寸或差值。
 */
export function ScenarioCompare({ baseline, working, diff: frozenDiff }: ScenarioCompareProps) {
  const diff = useMemo(
    // 有冻结结果时只读冻结值，绝不重算；没有时用于工作台实时对比。
    () => frozenDiff ?? compareChains(baseline, working),
    [frozenDiff, baseline, working],
  )

  // 字段变化行以用户熟悉的代号展示；termId 只是内部标识。
  // 当前工作方案优先，找不到时回退基线，再找不到才显示 termId。
  const symbolByTermId = useMemo(() => {
    const symbols = new Map<string, string>()
    for (const term of baseline.terms) {
      const symbol = term.symbol.trim()
      if (symbol !== '') {
        symbols.set(term.id, symbol)
      }
    }
    for (const term of working.terms) {
      const symbol = term.symbol.trim()
      if (symbol !== '') {
        symbols.set(term.id, symbol)
      }
    }
    return symbols
  }, [baseline, working])

  if (!hasAnyChange(diff)) {
    return (
      <div className="scenario-compare" data-testid="scenario-compare">
        <p className="scenario-compare__empty">当前工作方案与基线一致，未发现差异。</p>
      </div>
    )
  }

  return (
    <div className="scenario-compare" data-testid="scenario-compare">
      <div className="scenario-compare__block">
        <h3 className="scenario-compare__title">字段变化</h3>
        {diff.termChanges.length === 0 ? (
          <p className="scenario-compare__empty">共有组成环的字段没有变化。</p>
        ) : (
          <div className="scenario-compare__scroll">
            <table
              className="scenario-compare__table"
              aria-label="字段变化对比"
            >
              <thead>
                <tr>
                  <th scope="col">代号</th>
                  <th scope="col">字段</th>
                  <th scope="col">基线值</th>
                  <th scope="col">当前值</th>
                </tr>
              </thead>
              <tbody>
                {diff.termChanges.map((change) => (
                  <tr
                    key={`${change.termId}-${change.field}`}
                    data-testid={`compare-change-${change.termId}-${change.field}`}
                  >
                    <th scope="row">
                      {symbolByTermId.get(change.termId) ?? change.termId}
                    </th>
                    <td>{TERM_FIELD_LABEL[change.field]}</td>
                    <td>{formatFieldValue(change, 'before')}</td>
                    <td>{formatFieldValue(change, 'after')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {diff.addedTermIds.length > 0 ||
      diff.removedTermIds.length > 0 ||
      diff.orderChanged ||
      diff.targetChanged ? (
        <div className="scenario-compare__block">
          <h3 className="scenario-compare__title">结构变化</h3>
          <ul className="scenario-compare__list">
            {diff.addedTermIds.length > 0 ? (
              <li data-testid="compare-added">
                新增组成环：{diff.addedTermIds.join('、')}
              </li>
            ) : null}
            {diff.removedTermIds.length > 0 ? (
              <li data-testid="compare-removed">
                移除组成环：{diff.removedTermIds.join('、')}
              </li>
            ) : null}
            {diff.orderChanged ? (
              <li data-testid="compare-order">共有组成环顺序已调整</li>
            ) : null}
            {diff.targetChanged ? (
              <li data-testid="compare-target">目标区间已修改</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="scenario-compare__block">
        <h3 className="scenario-compare__title">结果变化</h3>
        <div className="scenario-compare__scroll">
          <table
            className="scenario-compare__table"
            aria-label="结果变化对比"
          >
            <thead>
              <tr>
                <th scope="col">指标</th>
                <th scope="col">基线</th>
                <th scope="col">当前工作方案</th>
                <th scope="col">变化</th>
              </tr>
            </thead>
            <tbody>
              <DeltaRow label="Cmin" testId="compare-min" delta={diff.minQ} />
              <DeltaRow label="Cmax" testId="compare-max" delta={diff.maxQ} />
              <DeltaRow label="Tc" testId="compare-tolerance" delta={diff.toleranceQ} />
              <DeltaRow
                label="下限裕量"
                testId="compare-lower-margin"
                delta={diff.lowerMarginQ}
              />
              <DeltaRow
                label="上限裕量"
                testId="compare-upper-margin"
                delta={diff.upperMarginQ}
              />
              <tr data-testid="compare-status">
                <th scope="row">判定</th>
                <td data-testid="compare-status-before">
                  {STATUS_LABEL[diff.statusBefore]}
                </td>
                <td data-testid="compare-status-after">
                  {STATUS_LABEL[diff.statusAfter]}
                </td>
                <td>
                  {diff.statusBefore === diff.statusAfter ? '不变' : '变化'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="scenario-compare__note">
        以上为数值方案对比，不构成制造可行性或加工成本建议。判定使用已通过校验的数值，
        正式结论仍需用户核对尺寸关系与作用方向。
      </p>
    </div>
  )
}
