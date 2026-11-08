// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { calculateChain } from '../domain/calculate'
import type { ChainDefinition, RelationReview } from '../domain/types'
import {
  draftToChain,
  emptyDraft,
  type TermDraft,
  type WorkspaceDraft,
} from '../workspace/draft'
import { createRelationReview } from '../workspace/relation'
import { useWorkspace } from '../workspace/useWorkspace'
import { DimensionTable } from './DimensionTable'

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
    term({
      id: 'B1',
      symbol: 'B1',
      name: '轴承 1',
      nominal: '20.0000',
      lower: '-0.0200',
      upper: '0.0000',
      sign: -1,
      sourceNote: '图纸 A-01',
      termRevision: 1,
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

function caseADraft(): WorkspaceDraft {
  return {
    terms: caseATerms(),
    targetMin: '0.1000',
    targetMax: '0.3000',
    relationRevision: 0,
    assumptions: '案例 A：不满足目标的轴向间隙',
  }
}

function chainOf(draft: WorkspaceDraft): ChainDefinition {
  const conversion = draftToChain(draft)
  if (!conversion.ok) {
    throw new Error(`预期草稿有效，实际错误：${JSON.stringify(conversion.cellErrors)}`)
  }
  return conversion.chain
}

function resultValues(chain: ChainDefinition): string {
  const result = calculateChain(chain)
  return [
    result.nominalQ,
    result.minQ,
    result.maxQ,
    result.toleranceQ,
    result.status,
  ].join('|')
}

/**
 * 只用真实 useWorkspace 驱动 DimensionTable；组件本身保持受控、无状态。
 * 额外的 output 便于断言派生出的关系确认状态和计算结果。
 */
function Harness({ initial }: { initial?: WorkspaceDraft }) {
  const base = initial ?? emptyDraft
  const initialConversion = draftToChain(base)
  const [relationReview] = useState<RelationReview | null>(() =>
    initialConversion.ok
      ? createRelationReview(
          initialConversion.chain,
          base.relationRevision,
          '2026-01-01T00:00:00.000Z',
        )
      : null,
  )
  const workspace = useWorkspace(base, undefined, {
    relationRevision: base.relationRevision,
    relationReview,
  })
  const values =
    workspace.result === null
      ? ''
      : [
          workspace.result.nominalQ,
          workspace.result.minQ,
          workspace.result.maxQ,
          workspace.result.toleranceQ,
          workspace.result.status,
        ].join('|')

  return (
    <>
      <DimensionTable
        draft={workspace.draft}
        dispatch={workspace.dispatch}
        chain={workspace.chain}
        cellErrors={workspace.cellErrors}
        stale={workspace.stale}
      />
      <output data-testid="relation-confirmed">
        {String(workspace.relationConfirmed)}
      </output>
      <output data-testid="stale">{String(workspace.stale)}</output>
      <output data-testid="result-values">{values}</output>
    </>
  )
}

function symbolValues(): string[] {
  return screen
    .getAllByRole('textbox', { name: / 代号$/ })
    .map((input) => (input as HTMLInputElement).value)
}

function SelectionHarness({ initial }: { initial: WorkspaceDraft }) {
  const workspace = useWorkspace(initial)
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null)

  return (
    <>
      <DimensionTable
        draft={workspace.draft}
        dispatch={workspace.dispatch}
        chain={workspace.chain}
        cellErrors={workspace.cellErrors}
        stale={workspace.stale}
        selectedTermId={selectedTermId}
        onSelect={setSelectedTermId}
      />
      <output data-testid="selected-term">{selectedTermId ?? ''}</output>
    </>
  )
}

describe('DimensionTable：字段与只读极限尺寸', () => {
  it('显示全部可编辑字段、方向选项和按 chain 计算的上下极限尺寸', () => {
    render(<Harness initial={caseADraft()} />)

    const table = screen.getByRole('table', { name: '组成环表' })
    expect(table).not.toHaveAttribute('role')
    expect(table).not.toHaveAttribute('aria-rowcount')
    expect(table).not.toHaveAttribute('aria-colcount')
    expect(screen.getAllByRole('columnheader')).toHaveLength(11)
    expect(screen.getAllByRole('rowheader')).toHaveLength(4)

    expect(screen.getByRole('textbox', { name: 'H 代号' })).toHaveValue('H')
    expect(screen.getByRole('textbox', { name: 'H 名称' })).toHaveValue('机架')
    expect(screen.getByRole('textbox', { name: 'H 基本尺寸' })).toHaveValue(
      '100.0000',
    )
    expect(screen.getByRole('textbox', { name: 'H 下偏差' })).toHaveValue(
      '0.0000',
    )
    expect(screen.getByRole('textbox', { name: 'H 上偏差' })).toHaveValue(
      '0.1000',
    )
    expect(screen.getByRole('textbox', { name: 'B1 来源备注' })).toHaveValue(
      '图纸 A-01',
    )

    const direction = screen.getByRole('combobox', { name: 'H 方向' })
    expect(direction).toHaveValue('1')
    expect(
      within(direction).getByRole('option', { name: '增加封闭环 (+)' }),
    ).toBeInTheDocument()
    expect(
      within(direction).getByRole('option', { name: '减小封闭环 (−)' }),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('cell', { name: 'H 下极限尺寸' }),
    ).toHaveTextContent('100.0000')
    expect(
      screen.getByRole('cell', { name: 'H 上极限尺寸' }),
    ).toHaveTextContent('100.1000')
    expect(
      screen.getByRole('cell', { name: 'B1 下极限尺寸' }),
    ).toHaveTextContent('19.9800')
    expect(
      screen.getByRole('cell', { name: 'B1 上极限尺寸' }),
    ).toHaveTextContent('20.0000')
    expect(
      screen.getByRole('cell', { name: 'S 下极限尺寸' }),
    ).toHaveTextContent('59.7500')
    expect(
      screen.getByRole('cell', { name: 'S 上极限尺寸' }),
    ).toHaveTextContent('59.8500')

    expect(screen.getByTestId('relation-confirmed')).toHaveTextContent('true')
  })

  it('删除行后按新执行顺序计算，并清除关系确认', () => {
    render(<Harness initial={caseADraft()} />)

    fireEvent.click(screen.getByRole('button', { name: '删除 B1' }))

    expect(symbolValues()).toEqual(['H', 'S', 'B2'])
    expect(screen.getByTestId('relation-confirmed')).toHaveTextContent('false')
    expect(screen.getByTestId('stale')).toHaveTextContent('false')

    const remainingDraft: WorkspaceDraft = {
      ...caseADraft(),
      terms: caseATerms().filter((item) => item.id !== 'B1'),
    }
    expect(screen.getByTestId('result-values').textContent).toBe(
      resultValues(chainOf(remainingDraft)),
    )
  })
})

describe('DimensionTable：逐格错误', () => {
  it('无效数值加 aria-invalid，并通过 aria-describedby 关联错误文案', () => {
    render(<Harness initial={caseADraft()} />)

    const nominal = screen.getByRole('textbox', { name: 'H 基本尺寸' })
    fireEvent.change(nominal, { target: { value: '' } })

    expect(nominal).toBeInvalid()
    expect(nominal).toHaveAccessibleErrorMessage('请输入数值')

    const describedBy = nominal.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent(
      '请输入数值',
    )
    expect(nominal).toHaveAttribute('aria-errormessage', describedBy ?? '')

    // 草稿整体无效时，stale 行不能继续显示上一次有效结果的极限尺寸。
    expect(screen.getByTestId('stale')).toHaveTextContent('true')
    expect(
      screen.getByRole('cell', { name: 'H 下极限尺寸' }),
    ).toHaveTextContent('—')
    expect(
      screen.getByRole('cell', { name: 'H 上极限尺寸' }),
    ).toHaveTextContent('—')
    expect(
      screen.getByRole('cell', { name: 'S 下极限尺寸' }),
    ).toHaveTextContent('—')
  })

  it('把偏差顺序错误定位到对应组成环的上偏差单元格', () => {
    render(<Harness initial={caseADraft()} />)

    const upper = screen.getByRole('textbox', { name: 'S 上偏差' })
    fireEvent.change(upper, { target: { value: '-0.1000' } })

    expect(upper).toBeInvalid()
    expect(upper).toHaveAccessibleErrorMessage(/上偏差不能小于下偏差/)
    expect(screen.getByTestId('stale')).toHaveTextContent('true')
  })
})

describe('DimensionTable：方向、重排与确认状态', () => {
  it('修改方向会清除关系确认并按新方向重算', () => {
    render(<Harness initial={caseADraft()} />)

    const direction = screen.getByRole('combobox', { name: 'H 方向' })
    fireEvent.change(direction, { target: { value: '-1' } })

    expect(direction).toHaveValue('-1')
    expect(screen.getByTestId('relation-confirmed')).toHaveTextContent('false')
    expect(screen.getByTestId('stale')).toHaveTextContent('false')

    const changedDraft: WorkspaceDraft = {
      ...caseADraft(),
      terms: caseATerms().map((item, index) =>
        index === 0 ? { ...item, sign: -1 } : item,
      ),
    }
    expect(screen.getByTestId('result-values').textContent).toBe(
      resultValues(chainOf(changedDraft)),
    )
  })

  it('重排后 calculateChain 的数值结果不变', () => {
    render(<Harness initial={caseADraft()} />)

    const expected = resultValues(chainOf(caseADraft()))
    expect(screen.getByTestId('result-values').textContent).toBe(expected)

    fireEvent.click(screen.getByRole('button', { name: '上移 B1' }))

    expect(symbolValues()).toEqual(['B1', 'H', 'S', 'B2'])
    expect(screen.getByTestId('result-values').textContent).toBe(expected)
    expect(screen.getByTestId('stale')).toHaveTextContent('false')

    // 重排只改变 terms 顺序，不改变数值结论；relationConfirmed 也不被 moveTerm 清除。
    const reorderedDraft: WorkspaceDraft = {
      ...caseADraft(),
      terms: [
        caseATerms()[1],
        caseATerms()[0],
        caseATerms()[2],
        caseATerms()[3],
      ],
    }
    expect(resultValues(chainOf(reorderedDraft))).toBe(expected)
    expect(screen.getByTestId('relation-confirmed')).toHaveTextContent('true')
  })

  it('增加行会清除关系确认，并为新行提供空的可编辑字段', () => {
    render(<Harness initial={caseADraft()} />)

    expect(screen.getByTestId('relation-confirmed')).toHaveTextContent('true')
    fireEvent.click(screen.getByRole('button', { name: '增加行' }))

    expect(symbolValues()).toHaveLength(5)
    expect(
      screen.getByRole('textbox', { name: '第 5 行 代号' }),
    ).toHaveValue('')
    expect(
      screen.getByRole('textbox', { name: '第 5 行 基本尺寸' }),
    ).toHaveValue('')
    expect(screen.getByTestId('relation-confirmed')).toHaveTextContent('false')
    expect(screen.getByTestId('stale')).toHaveTextContent('true')
  })

  it('修改基本尺寸等数值会清除关系确认', () => {
    render(<Harness initial={caseADraft()} />)

    const upper = screen.getByRole('textbox', { name: 'H 上偏差' })
    fireEvent.change(upper, { target: { value: '0.0300' } })

    expect(upper).toHaveValue('0.0300')
    expect(screen.getByTestId('relation-confirmed')).toHaveTextContent('false')
    expect(screen.getByTestId('stale')).toHaveTextContent('false')

    const changedDraft: WorkspaceDraft = {
      ...caseADraft(),
      terms: caseATerms().map((item, index) =>
        index === 0 ? { ...item, upper: '0.0300' } : item,
      ),
    }
    expect(screen.getByTestId('result-values').textContent).toBe(
      resultValues(chainOf(changedDraft)),
    )
  })
})

describe('DimensionTable：可选行选中联动', () => {
  it('点击行首选择按钮或行内非按钮区域都会回传并标记选中行', () => {
    render(<SelectionHarness initial={caseADraft()} />)

    const selectB1 = screen.getByRole('button', { name: '选择 B1' })
    expect(selectB1).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(selectB1)

    expect(screen.getByTestId('selected-term')).toHaveTextContent('B1')
    expect(selectB1).toHaveAttribute('aria-pressed', 'true')
    expect(selectB1.closest('tr')).toHaveAttribute('data-selected', 'true')

    fireEvent.click(screen.getByRole('cell', { name: 'H 上极限尺寸' }))

    expect(screen.getByTestId('selected-term')).toHaveTextContent('H')
    expect(selectB1).toHaveAttribute('aria-pressed', 'false')
    expect(selectB1.closest('tr')).not.toHaveAttribute('data-selected')
  })

  it('不传 selectedTermId/onSelect 时不显示选择控件，保持原有行为和布局', () => {
    render(<Harness initial={caseADraft()} />)

    expect(screen.queryByRole('button', { name: /^选择 / })).toBeNull()
    expect(screen.getAllByRole('rowheader')).toHaveLength(4)
    expect(screen.getByRole('rowheader', { name: '1' })).toBeInTheDocument()
  })
})

describe('DimensionTable：受控边界', () => {
  it('无 chain 时显示占位符，且不调用工作台 hook 也能渲染', () => {
    const draft = caseADraft()
    const conversion = draftToChain(draft)
    expect(conversion.ok).toBe(true)
    if (!conversion.ok) {
      return
    }

    render(
      <DimensionTable
        draft={draft}
        dispatch={() => undefined}
        chain={null}
        cellErrors={{}}
        stale={false}
      />,
    )

    expect(
      screen.getByRole('cell', { name: 'H 下极限尺寸' }),
    ).toHaveTextContent('—')
    expect(screen.getByRole('textbox', { name: 'H 基本尺寸' })).toHaveValue(
      '100.0000',
    )
  })

  it('空草稿显示空状态和增加行入口', () => {
    render(
      <DimensionTable
        draft={{
          terms: [],
          targetMin: '',
          targetMax: '',
          relationRevision: 0,
          assumptions: '',
        }}
        dispatch={() => undefined}
        chain={null}
        stale
      />,
    )

    expect(screen.getByRole('button', { name: '增加行' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('暂无组成环')
    expect(screen.queryAllByRole('row')).toHaveLength(1)
  })

  it('表格位于可聚焦且带 aria-label 的横向滚动 region 中', () => {
    render(<Harness initial={caseADraft()} />)

    const region = screen.getByRole('region', {
      name: '组成环表横向滚动区域',
    })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(
      within(region).getByRole('table', { name: '组成环表' }),
    ).toBeInTheDocument()
  })
})
