// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseMm } from '../domain/units'
import type { ChainDefinition, DimensionTerm } from '../domain/types'
import { ScenarioCompare } from './ScenarioCompare'

const mm = parseMm

function makeTerm(
  id: string,
  sign: 1 | -1,
  nominal: string,
  lower: string,
  upper: string,
): DimensionTerm {
  return {
    id,
    symbol: id,
    name: id,
    nominalQ: mm(nominal),
    lowerDeviationQ: mm(lower),
    upperDeviationQ: mm(upper),
    sign,
    sourceNote: '',
    termRevision: 1,
  }
}

function makeTarget(min: string, max: string): { minQ: number; maxQ: number } {
  return { minQ: mm(min), maxQ: mm(max) }
}

function caseA(): ChainDefinition {
  return {
    terms: [
      makeTerm('H', 1, '100.0000', '0.0000', '0.1000'),
      makeTerm('B1', -1, '20.0000', '-0.0200', '0.0000'),
      makeTerm('S', -1, '59.8000', '-0.0500', '0.0500'),
      makeTerm('B2', -1, '20.0000', '-0.0200', '0.0000'),
    ],
    target: makeTarget('0.1000', '0.3000'),
    assumptions: '',
  }
}

function caseB(): ChainDefinition {
  const a = caseA()
  return {
    ...a,
    terms: a.terms.map((term) => {
      if (term.id === 'H') {
        return { ...term, upperDeviationQ: mm('0.0300') }
      }
      if (term.id === 'S') {
        return {
          ...term,
          lowerDeviationQ: mm('-0.0200'),
          upperDeviationQ: mm('0.0200'),
        }
      }
      return term
    }),
  }
}

describe('ScenarioCompare：文档第 8 节案例 A → B', () => {
  it('展示字段前后值，以及 Cmin、Cmax、Tc、裕量和判定的变化', () => {
    render(<ScenarioCompare baseline={caseA()} working={caseB()} />)

    const resultTable = screen.getByRole('table', { name: '结果变化对比' })

    expect(within(resultTable).getByTestId('compare-min')).toHaveTextContent(
      '0.1500',
    )
    expect(within(resultTable).getByTestId('compare-min')).toHaveTextContent(
      '0.1800',
    )
    expect(
      within(resultTable).getByTestId('compare-min-delta'),
    ).toHaveTextContent('+0.0300')
    expect(
      within(resultTable).getByTestId('compare-max-delta'),
    ).toHaveTextContent('-0.1000')
    expect(
      within(resultTable).getByTestId('compare-tolerance-delta'),
    ).toHaveTextContent('-0.1300')
    expect(
      within(resultTable).getByTestId('compare-lower-margin-delta'),
    ).toHaveTextContent('+0.0300')
    expect(
      within(resultTable).getByTestId('compare-upper-margin-delta'),
    ).toHaveTextContent('+0.1000')

    expect(
      within(resultTable).getByTestId('compare-status-before'),
    ).toHaveTextContent('不满足')
    expect(
      within(resultTable).getByTestId('compare-status-after'),
    ).toHaveTextContent('满足')

    const fieldTable = screen.getByRole('table', { name: '字段变化对比' })
    const hUpperRow = within(fieldTable).getByTestId(
      'compare-change-H-upperDeviationQ',
    )
    expect(hUpperRow).toHaveTextContent('上偏差')
    expect(hUpperRow).toHaveTextContent('0.1000')
    expect(hUpperRow).toHaveTextContent('0.0300')

    const sLowerRow = within(fieldTable).getByTestId(
      'compare-change-S-lowerDeviationQ',
    )
    expect(sLowerRow).toHaveTextContent('-0.0500')
    expect(sLowerRow).toHaveTextContent('-0.0200')

    const sUpperRow = within(fieldTable).getByTestId(
      'compare-change-S-upperDeviationQ',
    )
    expect(sUpperRow).toHaveTextContent('0.0500')
    expect(sUpperRow).toHaveTextContent('0.0200')
  })

  it('无变化时不渲染差异表', () => {
    render(<ScenarioCompare baseline={caseA()} working={caseA()} />)

    expect(screen.getByText(/未发现差异/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('字段变化表第一列显示代号而不是内部 termId，代号缺失时回退 termId', () => {
    const baseline = caseA()
    baseline.terms = baseline.terms.map((term) =>
      term.symbol === 'H'
        ? { ...term, id: 'internal-h', symbol: 'H' }
        : term.symbol === 'S'
          ? { ...term, id: 'internal-s', symbol: 'S' }
          : term.symbol === 'B2'
            ? { ...term, id: 'internal-b2', symbol: '' }
            : term,
    )
    const working: ChainDefinition = {
      ...baseline,
      terms: baseline.terms.map((term) => {
        if (term.id === 'internal-h') {
          return { ...term, upperDeviationQ: mm('0.0300') }
        }
        if (term.id === 'internal-s') {
          return { ...term, upperDeviationQ: mm('0.0200') }
        }
        if (term.id === 'internal-b2') {
          return { ...term, upperDeviationQ: mm('-0.0100') }
        }
        return term
      }),
    }

    render(<ScenarioCompare baseline={baseline} working={working} />)

    const fieldTable = screen.getByRole('table', { name: '字段变化对比' })
    const hRow = within(fieldTable).getByTestId(
      'compare-change-internal-h-upperDeviationQ',
    )
    expect(within(hRow).getByRole('rowheader')).toHaveTextContent('H')
    expect(within(hRow).getByRole('rowheader')).not.toHaveTextContent(
      'internal-h',
    )

    const sRow = within(fieldTable).getByTestId(
      'compare-change-internal-s-upperDeviationQ',
    )
    expect(within(sRow).getByRole('rowheader')).toHaveTextContent('S')

    const fallbackRow = within(fieldTable).getByTestId(
      'compare-change-internal-b2-upperDeviationQ',
    )
    expect(within(fallbackRow).getByRole('rowheader')).toHaveTextContent(
      'internal-b2',
    )
  })

  it('没有目标区间时，裕量变化显示为 —', () => {
    const withoutTarget: ChainDefinition = { ...caseA(), target: null }
    render(
      <ScenarioCompare baseline={withoutTarget} working={caseA()} />,
    )

    const resultTable = screen.getByRole('table', {
      name: '结果变化对比',
    })
    expect(
      within(resultTable).getByTestId('compare-lower-margin-delta'),
    ).toHaveTextContent('—')
    expect(
      within(resultTable).getByTestId('compare-upper-margin-delta'),
    ).toHaveTextContent('—')
    expect(
      within(resultTable).getByTestId('compare-status-before'),
    ).toHaveTextContent('未设置目标')
    expect(
      within(resultTable).getByTestId('compare-status-after'),
    ).toHaveTextContent('不满足')
  })
})
