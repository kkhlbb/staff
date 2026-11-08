// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TermDraft } from '../workspace/draft'
import { ChainExpression } from './ChainExpression'

function term(overrides: Partial<TermDraft> = {}): TermDraft {
  return {
    id: 'H',
    symbol: 'H',
    name: '机架',
    nominal: '100.0000',
    lower: '0.0000',
    upper: '0.1000',
    sign: 1,
    sourceNote: '',
    termRevision: 1,
    ...overrides,
  }
}

function caseATerms(): TermDraft[] {
  return [
    term(),
    term({ id: 'B1', symbol: 'B1', sign: -1 }),
    term({ id: 'S', symbol: 'S', sign: -1 }),
    term({ id: 'B2', symbol: 'B2', sign: -1 }),
  ]
}

describe('ChainExpression', () => {
  it('按当前顺序和方向生成表达式', () => {
    render(<ChainExpression terms={caseATerms()} />)

    expect(screen.getByTestId('chain-expression')).toHaveTextContent(
      'C = +H - B1 - S - B2',
    )
  })

  it('第一项为负方向时保留正负号和空格格式', () => {
    render(
      <ChainExpression
        terms={[
          term({ id: 'A', symbol: 'A', sign: -1 }),
          term({ id: 'B', symbol: 'B', sign: 1 }),
        ]}
      />,
    )

    expect(screen.getByTestId('chain-expression')).toHaveTextContent(
      'C = -A + B',
    )
  })

  it('空链给出可见的占位提示', () => {
    render(<ChainExpression draft={{ terms: [] }} />)

    expect(screen.getByText('尺寸链表达式')).toBeInTheDocument()
    expect(screen.getByTestId('chain-expression')).toHaveTextContent(
      'C = （空链，请添加组成环）',
    )
  })

  it('接收 draft 时随顺序变化重新渲染', () => {
    const { rerender } = render(
      <ChainExpression draft={{ terms: caseATerms() }} />,
    )
    expect(screen.getByTestId('chain-expression')).toHaveTextContent(
      'C = +H - B1 - S - B2',
    )

    const reordered = [caseATerms()[0], caseATerms()[2], caseATerms()[1], caseATerms()[3]]
    rerender(<ChainExpression draft={{ terms: reordered }} />)

    expect(screen.getByTestId('chain-expression')).toHaveTextContent(
      'C = +H - S - B1 - B2',
    )
  })
})
