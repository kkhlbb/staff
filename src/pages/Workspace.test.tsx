// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Workspace } from './Workspace'

interface TermInput {
  symbol: string
  name: string
  nominal: string
  lower: string
  upper: string
  sign: 1 | -1
}

const CASE_A_TERMS: TermInput[] = [
  {
    symbol: 'H',
    name: '机架',
    nominal: '100.0000',
    lower: '0.0000',
    upper: '0.1000',
    sign: 1,
  },
  {
    symbol: 'B1',
    name: '轴承 1',
    nominal: '20.0000',
    lower: '-0.0200',
    upper: '0.0000',
    sign: -1,
  },
  {
    symbol: 'S',
    name: '隔套',
    nominal: '59.8000',
    lower: '-0.0500',
    upper: '0.0500',
    sign: -1,
  },
  {
    symbol: 'B2',
    name: '轴承 2',
    nominal: '20.0000',
    lower: '-0.0200',
    upper: '0.0000',
    sign: -1,
  },
]

function resultValue(testId: string): string {
  const cell = screen.getByTestId(testId).querySelector('dd')
  if (cell === null) {
    throw new Error(`结果行 ${testId} 缺少 dd`)
  }
  return cell.textContent ?? ''
}

/** 从空工作台逐格输入一个组成环。 */
async function addTerm(
  user: UserEvent,
  rowNumber: number,
  term: TermInput,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: '增加行' }))

  const emptyRowLabel = `第 ${rowNumber} 行`
  await user.type(
    screen.getByRole('textbox', { name: `${emptyRowLabel} 代号` }),
    term.symbol,
  )
  await user.type(
    screen.getByRole('textbox', { name: `${term.symbol} 名称` }),
    term.name,
  )

  const nominal = screen.getByRole('textbox', {
    name: `${term.symbol} 基本尺寸`,
  })
  await user.clear(nominal)
  await user.type(nominal, term.nominal)

  const lower = screen.getByRole('textbox', { name: `${term.symbol} 下偏差` })
  await user.clear(lower)
  await user.type(lower, term.lower)

  const upper = screen.getByRole('textbox', { name: `${term.symbol} 上偏差` })
  await user.clear(upper)
  await user.type(upper, term.upper)

  if (term.sign === -1) {
    await user.selectOptions(
      screen.getByRole('combobox', { name: `${term.symbol} 方向` }),
      '-1',
    )
  }
}

async function buildCaseA(user: UserEvent): Promise<void> {
  for (const [index, term] of CASE_A_TERMS.entries()) {
    await addTerm(user, index + 1, term)
  }
  await user.type(screen.getByLabelText('目标下限'), '0.1000')
  await user.type(screen.getByLabelText('目标上限'), '0.3000')
}

function confirmationCheckbox(): HTMLElement {
  return screen.getByRole('checkbox', {
    name: '已核对尺寸关系与作用方向',
  })
}

describe('Workspace：从空项目建立案例 A，再修改为案例 B', () => {
  it('逐格输入案例 A 后确认判定为不满足，改到 B 时确认被清除、重新确认后判定为满足', async () => {
    const user = userEvent.setup()
    render(<Workspace />)

    expect(screen.getByRole('status')).toHaveTextContent('暂无组成环')
    expect(screen.getByText('请先添加组成环')).toBeInTheDocument()
    expect(
      screen.queryByText('输入有误，显示的是上次有效结果'),
    ).toBeNull()
    expect(screen.getByTestId('chain-expression')).toHaveTextContent(
      'C = （空链，请添加组成环）',
    )
    expect(resultValue('result-status')).toBe('暂无结果')

    await buildCaseA(user)

    // 表达式、示意图与表格都反映 A 的四个组成环。
    expect(screen.getByTestId('chain-expression')).toHaveTextContent(
      'C = +H - B1 - S - B2',
    )
    expect(
      within(screen.getByRole('table', { name: '组成环表' })).getAllByRole(
        'rowheader',
      ),
    ).toHaveLength(4)
    expect(screen.getAllByRole('button', { name: /^选择 / })).toHaveLength(4)

    // 未勾选时只显示预览，即使数值已可计算。
    const checkbox = confirmationCheckbox()
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(checkbox).not.toBeChecked()
    expect(resultValue('result-status')).toBe('待确认（预览）')
    expect(resultValue('result-min')).toBe('0.1500')
    expect(resultValue('result-max')).toBe('0.3900')

    await user.click(checkbox)

    expect(checkbox).toBeChecked()
    expect(resultValue('result-status')).toBe('不满足')
    expect(screen.getByRole('table', { name: '公差贡献表' })).toBeInTheDocument()
    expect(resultValue('result-nominal')).toBe('0.2000')
    expect(resultValue('result-min')).toBe('0.1500')
    expect(resultValue('result-max')).toBe('0.3900')
    expect(resultValue('result-lower-deviation')).toBe('-0.0500')
    expect(resultValue('result-upper-deviation')).toBe('+0.1900')
    expect(resultValue('result-tolerance')).toBe('0.2400')
    expect(resultValue('result-target')).toBe('0.1000 ~ 0.3000')
    expect(resultValue('result-lower-margin')).toBe('+0.0500')
    expect(resultValue('result-upper-margin')).toBe('-0.0900')

    // 示意图与表格选中行双向联动。
    const selectS = screen.getByRole('button', { name: '选择 S' })
    await user.click(screen.getByRole('button', { name: /^S，基本尺寸/ }))
    expect(selectS).toHaveAttribute('aria-pressed', 'true')
    expect(selectS.closest('tr')).toHaveAttribute('data-selected', 'true')

    const selectB1 = screen.getByRole('button', { name: '选择 B1' })
    await user.click(selectB1)
    expect(selectB1).toHaveAttribute('aria-pressed', 'true')
    expect(selectS).toHaveAttribute('aria-pressed', 'false')

    // 改成案例 B：H 上偏差 +0.0300，S 下偏差 -0.0200、上偏差 +0.0200。
    const hUpper = screen.getByRole('textbox', { name: 'H 上偏差' })
    await user.clear(hUpper)
    await user.type(hUpper, '0.0300')
    expect(confirmationCheckbox()).not.toBeChecked()
    expect(resultValue('result-status')).toBe('待确认（预览）')

    const sLower = screen.getByRole('textbox', { name: 'S 下偏差' })
    await user.clear(sLower)
    await user.type(sLower, '-0.0200')

    const sUpper = screen.getByRole('textbox', { name: 'S 上偏差' })
    await user.clear(sUpper)
    await user.type(sUpper, '0.0200')

    expect(confirmationCheckbox()).not.toBeChecked()
    expect(resultValue('result-status')).toBe('待确认（预览）')
    expect(resultValue('result-nominal')).toBe('0.2000')
    expect(resultValue('result-min')).toBe('0.1800')
    expect(resultValue('result-max')).toBe('0.2900')
    expect(resultValue('result-lower-deviation')).toBe('-0.0200')
    expect(resultValue('result-upper-deviation')).toBe('+0.0900')
    expect(resultValue('result-tolerance')).toBe('0.1100')
    expect(resultValue('result-lower-margin')).toBe('+0.0800')
    expect(resultValue('result-upper-margin')).toBe('+0.0100')

    await user.click(confirmationCheckbox())

    expect(confirmationCheckbox()).toBeChecked()
    expect(resultValue('result-status')).toBe('满足')
    expect(resultValue('result-target')).toBe('0.1000 ~ 0.3000')
  })

  it('输入无效时结果卡沿用上次有效链的目标区间，并标注待确认预览', async () => {
    const user = userEvent.setup()
    render(<Workspace />)

    await buildCaseA(user)
    await user.click(confirmationCheckbox())
    expect(resultValue('result-status')).toBe('不满足')
    expect(resultValue('result-target')).toBe('0.1000 ~ 0.3000')

    // 目标下限大于上限：当前草稿无效，chain 为 null，结果卡应沿用上次有效链的 target。
    // 用一次完整的 change 模拟“把 0.1000 改成 0.5000”，避免逐字符输入时
    // 中间值 0.0000 也短暂成为有效链。
    const targetMin = screen.getByLabelText('目标下限')
    fireEvent.change(targetMin, { target: { value: '0.5000' } })

    expect(
      screen.getByText('输入有误，显示的是上次有效结果'),
    ).toBeInTheDocument()
    expect(resultValue('result-target')).toBe('0.1000 ~ 0.3000')
    expect(resultValue('result-min')).toBe('0.1500')
    expect(resultValue('result-max')).toBe('0.3900')
    expect(resultValue('result-status')).toBe('待确认（预览）')
    expect(resultValue('result-lower-margin')).toBe('+0.0500')
    expect(resultValue('result-upper-margin')).toBe('-0.0900')

    // 贡献表也沿用上次有效结果，而不是当前无效草稿。
    const contributionTable = screen.getByRole('table', {
      name: '公差贡献表',
    })
    expect(within(contributionTable).getAllByRole('row')).toHaveLength(5)
    expect(contributionTable).toHaveTextContent('H')
    expect(contributionTable).toHaveTextContent('0.1000')
  })

  it('编辑清除确认状态时显示重新核对提示，重新勾选后提示消失', async () => {
    const user = userEvent.setup()
    render(<Workspace />)

    await buildCaseA(user)
    await user.click(confirmationCheckbox())
    expect(confirmationCheckbox()).toBeChecked()
    expect(
      screen.queryByText('输入已变更，请重新核对'),
    ).toBeNull()

    // 单次完整 change：上偏差从 0.1000 改为 0.0300，reducer 会清除确认状态。
    fireEvent.change(screen.getByRole('textbox', { name: 'H 上偏差' }), {
      target: { value: '0.0300' },
    })

    expect(confirmationCheckbox()).not.toBeChecked()
    expect(
      screen.getByText('输入已变更，请重新核对'),
    ).toBeInTheDocument()

    await user.click(confirmationCheckbox())

    expect(confirmationCheckbox()).toBeChecked()
    expect(
      screen.queryByText('输入已变更，请重新核对'),
    ).toBeNull()

    // 用户手动取消勾选是主动操作，不应误报“编辑清除了确认”。
    await user.click(confirmationCheckbox())
    expect(confirmationCheckbox()).not.toBeChecked()
    expect(
      screen.queryByText('输入已变更，请重新核对'),
    ).toBeNull()
  })
})
