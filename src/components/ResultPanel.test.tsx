// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ChainDefinition } from '../domain/types'
import {
  hasTargetInputError,
  type TermDraft,
  type WorkspaceDraft,
} from '../workspace/draft'
import { useWorkspace } from '../workspace/useWorkspace'
import { ResultPanel } from './ResultPanel'

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
    ...overrides,
  }
}

function caseATerms(): TermDraft[] {
  return [
    term(),
    term({
      id: 'B1',
      symbol: 'B1',
      name: '轴承 1',
      nominal: '20.0000',
      lower: '-0.0200',
      upper: '0.0000',
      sign: -1,
    }),
    term({
      id: 'S',
      symbol: 'S',
      name: '隔套',
      nominal: '59.8000',
      lower: '-0.0500',
      upper: '0.0500',
      sign: -1,
    }),
    term({
      id: 'B2',
      symbol: 'B2',
      name: '轴承 2',
      nominal: '20.0000',
      lower: '-0.0200',
      upper: '0.0000',
      sign: -1,
    }),
  ]
}

function caseADraft(overrides: Partial<WorkspaceDraft> = {}): WorkspaceDraft {
  return {
    terms: caseATerms(),
    targetMin: '0.1000',
    targetMax: '0.3000',
    assumptions: '案例 A：不满足目标的轴向间隙',
    relationConfirmed: true,
    ...overrides,
  }
}

function caseBTerms(): TermDraft[] {
  return [
    term({ upper: '0.0300' }),
    term({
      id: 'B1',
      symbol: 'B1',
      name: '轴承 1',
      nominal: '20.0000',
      lower: '-0.0200',
      upper: '0.0000',
      sign: -1,
    }),
    term({
      id: 'S',
      symbol: 'S',
      name: '隔套',
      nominal: '59.8000',
      lower: '-0.0200',
      upper: '0.0200',
      sign: -1,
    }),
    term({
      id: 'B2',
      symbol: 'B2',
      name: '轴承 2',
      nominal: '20.0000',
      lower: '-0.0200',
      upper: '0.0000',
      sign: -1,
    }),
  ]
}

function caseBDraft(): WorkspaceDraft {
  return caseADraft({
    terms: caseBTerms(),
    assumptions: '案例 B：修改后的满足方案',
  })
}

function caseCDraft(): WorkspaceDraft {
  return {
    terms: [
      term({
        id: 'P',
        symbol: 'P',
        name: '零件 P',
        nominal: '10.0000',
        lower: '-0.1000',
        upper: '0.0000',
        sign: 1,
      }),
      term({
        id: 'Q',
        symbol: 'Q',
        name: '零件 Q',
        nominal: '10.0500',
        lower: '0.0000',
        upper: '0.0500',
        sign: -1,
      }),
    ],
    targetMin: '-0.2000',
    targetMax: '-0.0500',
    assumptions: '案例 C：负间隙和边界',
    relationConfirmed: true,
  }
}

function zeroToleranceDraft(): WorkspaceDraft {
  return {
    terms: [
      term({
        id: 'A',
        symbol: 'A',
        name: '零件 A',
        nominal: '10.0000',
        lower: '0.0000',
        upper: '0.0000',
        sign: 1,
      }),
      term({
        id: 'B',
        symbol: 'B',
        name: '零件 B',
        nominal: '5.0000',
        lower: '0.0000',
        upper: '0.0000',
        sign: -1,
      }),
    ],
    targetMin: '5.0000',
    targetMax: '5.0000',
    assumptions: '全零公差',
    relationConfirmed: true,
  }
}

function ResultPanelHarness({ initial }: { initial: WorkspaceDraft }) {
  const { draft, dispatch, result, chain, cellErrors, stale } =
    useWorkspace(initial)

  // 目标区间与代号只从 calculateChain 的输入链取得；草稿无效时沿用上次有效链。
  const [lastValidChain, setLastValidChain] = useState<ChainDefinition | null>(
    chain,
  )
  if (chain !== null && chain !== lastValidChain) {
    setLastValidChain(chain)
  }
  const displayChain = chain ?? lastValidChain
  const target = hasTargetInputError(cellErrors)
    ? null
    : displayChain?.target ?? null

  return (
    <ResultPanel
      draft={draft}
      dispatch={dispatch}
      result={result}
      target={target}
      terms={displayChain?.terms}
      cellErrors={cellErrors}
      stale={stale}
    />
  )
}

function renderPanel(initial: WorkspaceDraft) {
  return render(<ResultPanelHarness initial={initial} />)
}

function displayed(testId: string): string {
  const cell = screen.getByTestId(testId).querySelector('dd')
  if (cell === null) {
    throw new Error(`结果行 ${testId} 缺少 dd`)
  }
  return cell.textContent ?? ''
}

describe('ResultPanel：标准案例数值', () => {
  it('案例 A 显示不满足目标时的全部数值', () => {
    renderPanel(caseADraft())

    expect(displayed('result-nominal')).toBe('0.2000')
    expect(displayed('result-min')).toBe('0.1500')
    expect(displayed('result-max')).toBe('0.3900')
    expect(displayed('result-lower-deviation')).toBe('-0.0500')
    expect(displayed('result-upper-deviation')).toBe('+0.1900')
    expect(displayed('result-tolerance')).toBe('0.2400')
    expect(displayed('result-target')).toBe('0.1000 ~ 0.3000')
    expect(displayed('result-status')).toBe('不满足')
    expect(displayed('result-lower-margin')).toBe('+0.0500')
    expect(displayed('result-upper-margin')).toBe('-0.0900')
  })

  it('案例 B 显示修改后满足目标的全部数值', () => {
    renderPanel(caseBDraft())

    expect(displayed('result-nominal')).toBe('0.2000')
    expect(displayed('result-min')).toBe('0.1800')
    expect(displayed('result-max')).toBe('0.2900')
    expect(displayed('result-lower-deviation')).toBe('-0.0200')
    expect(displayed('result-upper-deviation')).toBe('+0.0900')
    expect(displayed('result-tolerance')).toBe('0.1100')
    expect(displayed('result-target')).toBe('0.1000 ~ 0.3000')
    expect(displayed('result-status')).toBe('满足')
    expect(displayed('result-lower-margin')).toBe('+0.0800')
    expect(displayed('result-upper-margin')).toBe('+0.0100')
  })

  it('案例 C 显示负间隙和零裕量边界', () => {
    renderPanel(caseCDraft())

    expect(displayed('result-nominal')).toBe('-0.0500')
    expect(displayed('result-min')).toBe('-0.2000')
    expect(displayed('result-max')).toBe('-0.0500')
    expect(displayed('result-lower-deviation')).toBe('-0.1500')
    expect(displayed('result-upper-deviation')).toBe('+0.0000')
    expect(displayed('result-tolerance')).toBe('0.1500')
    expect(displayed('result-target')).toBe('-0.2000 ~ -0.0500')
    expect(displayed('result-status')).toBe('满足')
    expect(displayed('result-lower-margin')).toBe('+0.0000')
    expect(displayed('result-upper-margin')).toBe('+0.0000')
  })
})

describe('ResultPanel：确认状态', () => {
  it('未确认时只显示待确认预览，勾选后显示正式判定', () => {
    renderPanel(caseADraft({ relationConfirmed: false }))

    expect(displayed('result-status')).toBe('待确认（预览）')
    expect(screen.queryByText('输入有误，显示的是上次有效结果')).toBeNull()

    const checkbox = screen.getByRole('checkbox', {
      name: '已核对尺寸关系与作用方向',
    })
    expect(checkbox).not.toBeChecked()

    fireEvent.click(checkbox)

    expect(checkbox).toBeChecked()
    expect(displayed('result-status')).toBe('不满足')
  })

  it('已确认时显示正式判定', () => {
    renderPanel(caseBDraft())

    expect(displayed('result-status')).toBe('满足')
    expect(screen.getByRole('checkbox')).toBeChecked()
  })
})

describe('ResultPanel：目标区间状态', () => {
  it('无目标时显示未设置目标，允许区间和两侧裕量为占位符', () => {
    renderPanel(
      caseADraft({
        targetMin: '',
        targetMax: '',
        relationConfirmed: true,
      }),
    )

    expect(displayed('result-status')).toBe('未设置目标')
    expect(displayed('result-target')).toBe('—')
    expect(displayed('result-lower-margin')).toBe('—')
    expect(displayed('result-upper-margin')).toBe('—')
    expect(screen.getByLabelText('目标下限')).toHaveValue('')
    expect(screen.getByLabelText('目标上限')).toHaveValue('')
    expect(screen.queryByTestId('target-range')).toBeNull()
    expect(screen.queryByTestId('target-zero-marker')).toBeNull()
  })

  it('输入有效目标时通过 dispatch 更新允许区间和裕量', () => {
    renderPanel(caseADraft())

    const minInput = screen.getByLabelText('目标下限')
    fireEvent.change(minInput, { target: { value: '0.2000' } })

    expect(minInput).toHaveValue('0.2000')
    expect(displayed('result-target')).toBe('0.2000 ~ 0.3000')
    expect(displayed('result-lower-margin')).toBe('-0.0500')
    expect(displayed('result-upper-margin')).toBe('-0.0900')

    fireEvent.change(screen.getByLabelText('目标上限'), {
      target: { value: '' },
    })
    fireEvent.change(minInput, { target: { value: '' } })

    expect(displayed('result-status')).toBe('未设置目标')
  })
})

describe('ResultPanel：无效输入与 stale', () => {
  it('目标上下限颠倒时不套用上次有效目标，允许区间、裕量与目标图显示「—」', () => {
    renderPanel(caseADraft())

    fireEvent.change(screen.getByLabelText('目标下限'), {
      target: { value: '0.5000' },
    })

    expect(screen.getByText('输入有误，显示的是上次有效结果')).toBeInTheDocument()
    // 链数值仍来自上次有效结果。
    expect(displayed('result-nominal')).toBe('0.2000')
    expect(displayed('result-min')).toBe('0.1500')
    expect(displayed('result-max')).toBe('0.3900')
    expect(screen.getByTestId('result-range')).toBeInTheDocument()
    // 当前无效目标不能混用上次有效链的允许区间和裕量。
    expect(displayed('result-target')).toBe('—')
    expect(displayed('result-lower-margin')).toBe('—')
    expect(displayed('result-upper-margin')).toBe('—')
    expect(screen.queryByTestId('target-range')).toBeNull()
    expect(screen.queryByTestId('target-zero-marker')).toBeNull()
    expect(screen.getByTestId('chart-target-invalid')).toHaveTextContent('—')
    expect(displayed('result-status')).toBe('待确认（预览）')

    const maxInput = screen.getByLabelText('目标上限')
    expect(maxInput).toHaveAttribute('aria-invalid', 'true')
    const describedBy = maxInput.getAttribute('aria-describedby')
    if (describedBy === null) {
      throw new Error('目标上限缺失 aria-describedby')
    }
    expect(document.getElementById(describedBy)).toHaveTextContent(
      '目标上限不能小于目标下限',
    )
  })

  it('目标下限格式错误也定位到对应输入，并隐藏旧目标区间与裕量', () => {
    renderPanel(caseADraft())

    const minInput = screen.getByLabelText('目标下限')
    fireEvent.change(minInput, { target: { value: 'abc' } })

    expect(minInput).toHaveAttribute('aria-invalid', 'true')
    const describedBy = minInput.getAttribute('aria-describedby')
    if (describedBy === null) {
      throw new Error('目标下限缺失 aria-describedby')
    }
    expect(document.getElementById(describedBy)).toHaveTextContent('格式不正确')
    expect(displayed('result-min')).toBe('0.1500')
    expect(displayed('result-target')).toBe('—')
    expect(displayed('result-lower-margin')).toBe('—')
    expect(displayed('result-upper-margin')).toBe('—')
    expect(screen.queryByTestId('target-range')).toBeNull()
    expect(screen.getByTestId('chart-target-invalid')).toHaveTextContent('—')
  })

  it('目标只填一侧时也视为无效，不显示旧允许区间与裕量', () => {
    renderPanel(caseADraft())

    fireEvent.change(screen.getByLabelText('目标上限'), {
      target: { value: '' },
    })

    expect(
      screen.getByText('输入有误，显示的是上次有效结果'),
    ).toBeInTheDocument()
    expect(displayed('result-target')).toBe('—')
    expect(displayed('result-lower-margin')).toBe('—')
    expect(displayed('result-upper-margin')).toBe('—')
    expect(screen.queryByTestId('target-range')).toBeNull()
    expect(screen.getByTestId('chart-target-invalid')).toHaveTextContent('—')
  })
})

describe('ResultPanel：零宽区间', () => {
  it('结果区间和允许区间零宽时都渲染 circle 标记点', () => {
    renderPanel(zeroToleranceDraft())

    expect(displayed('result-min')).toBe('5.0000')
    expect(displayed('result-max')).toBe('5.0000')
    expect(displayed('result-tolerance')).toBe('0.0000')
    expect(displayed('result-status')).toBe('满足')
    expect(screen.getByText('所有输入公差为零')).toBeInTheDocument()
    expect(screen.queryByText(/NaN/)).toBeNull()

    const resultMarker = screen.getByTestId('result-zero-marker')
    const targetMarker = screen.getByTestId('target-zero-marker')
    expect(resultMarker.tagName.toLowerCase()).toBe('circle')
    expect(targetMarker.tagName.toLowerCase()).toBe('circle')
    expect(resultMarker).toHaveAttribute('r', '5.5')
    expect(targetMarker).toHaveAttribute('r', '5.5')
    expect(screen.queryByTestId('result-range')).toBeNull()
    expect(screen.queryByTestId('target-range')).toBeNull()
  })
})
