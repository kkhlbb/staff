// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { calculateChain } from '../domain/calculate'
import type { ChainDefinition, DimensionTerm } from '../domain/types'
import { parseMm } from '../domain/units'
import { ContributionTable } from './ContributionTable'

function makeTerm(
  id: string,
  nominal: string,
  lowerDeviation: string,
  upperDeviation: string,
  sign: 1 | -1 = 1,
): DimensionTerm {
  return {
    id,
    symbol: id,
    name: id,
    nominalQ: parseMm(nominal),
    lowerDeviationQ: parseMm(lowerDeviation),
    upperDeviationQ: parseMm(upperDeviation),
    sign,
    sourceNote: '',
    termRevision: 1,
  }
}

function makeChain(terms: DimensionTerm[]): ChainDefinition {
  return { terms, target: null, assumptions: '' }
}

function caseAChain(): ChainDefinition {
  return makeChain([
    makeTerm('H', '100.0000', '0.0000', '0.1000', 1),
    makeTerm('B1', '20.0000', '-0.0200', '0.0000', -1),
    makeTerm('S', '59.8000', '-0.0500', '0.0500', -1),
    makeTerm('B2', '20.0000', '-0.0200', '0.0000', -1),
  ])
}

function zeroToleranceChain(): ChainDefinition {
  return makeChain([
    makeTerm('A', '10.0000', '0.0000', '0.0000', 1),
    makeTerm('B', '5.0000', '0.0000', '0.0000', -1),
  ])
}

function bodyRows(): HTMLElement[] {
  const table = screen.getByRole('table', { name: '公差贡献表' })
  return within(table).getAllByRole('row').slice(1)
}

function rowCells(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll('th, td')).map(
    (cell) => cell.textContent ?? '',
  )
}

describe('ContributionTable：排序与数值', () => {
  it('案例 A 按 Tᵢ 从大到小稳定排序，并显示贡献比例', () => {
    const chain = caseAChain()
    render(
      <ContributionTable result={calculateChain(chain)} terms={chain.terms} />,
    )

    // H 与 S 同为 0.1000，B1 与 B2 同为 0.0200；相等项保持 contributions 原顺序。
    expect(bodyRows().map(rowCells)).toEqual([
      ['H', '0.1000', '41.7%'],
      ['S', '0.1000', '41.7%'],
      ['B1', '0.0200', '8.3%'],
      ['B2', '0.0200', '8.3%'],
    ])
  })

  it('Tᵢ 不同时仍按从大到小排序', () => {
    const chain = makeChain([
      makeTerm('H', '100.0000', '0.0000', '0.0300'),
      makeTerm('B1', '20.0000', '-0.0200', '0.0000', -1),
      makeTerm('S', '59.8000', '-0.0200', '0.0200', -1),
      makeTerm('B2', '20.0000', '-0.0200', '0.0000', -1),
    ])
    render(
      <ContributionTable result={calculateChain(chain)} terms={chain.terms} />,
    )

    expect(bodyRows().map((row) => rowCells(row)[0])).toEqual([
      'S',
      'H',
      'B1',
      'B2',
    ])
  })

  it('表下注明比例只说明区间宽度贡献，不代表失效概率或成本建议', () => {
    const chain = caseAChain()
    render(
      <ContributionTable result={calculateChain(chain)} terms={chain.terms} />,
    )

    expect(
      screen.getByText(
        '比例用于说明各项对极限区间宽度的贡献，不能解释成失效概率、缺陷原因或成本最优建议。',
      ),
    ).toBeInTheDocument()
  })
})

describe('ContributionTable：全零公差', () => {
  it('显示“所有输入公差为零”，比例为“—”且不出现 NaN', () => {
    const chain = zeroToleranceChain()
    render(
      <ContributionTable
        result={calculateChain(chain)}
        terms={chain.terms}
      />,
    )

    expect(screen.getByText('所有输入公差为零')).toBeInTheDocument()

    const rows = bodyRows().map(rowCells)
    expect(rows).toEqual([
      ['A', '0.0000', '—'],
      ['B', '0.0000', '—'],
    ])
    expect(screen.queryByText(/NaN/)).toBeNull()
  })
})

describe('ContributionTable：无结果', () => {
  it('没有计算结果时显示中性占位提示', () => {
    render(<ContributionTable result={null} />)

    expect(screen.getByText('暂无可显示的贡献数据')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
