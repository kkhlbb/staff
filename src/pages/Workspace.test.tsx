// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChainDefinition, Project } from '../domain/types'
import type {
  SaveDraftResult,
  StorageResult,
} from '../storage/projects'
import {
  createEmptyProject,
  saveDraft as persistDraft,
} from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import type { WorkspaceDraft } from '../workspace/draft'
import { Workspace } from './Workspace'

beforeEach(async () => {
  await deleteProjectDatabase()
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await deleteProjectDatabase()
})

/** 等待 IndexedDB 完成首次加载（没有项目时先创建空白项目）。 */
async function renderWorkspace(): Promise<void> {
  render(<Workspace />)
  await screen.findByRole('button', { name: '增加行' })
}

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

    // 加载完成前只显示加载状态，不能先渲染空项目。
    expect(screen.getByRole('status')).toHaveTextContent('正在加载本地项目')
    expect(screen.queryByRole('table', { name: '组成环表' })).toBeNull()
    await screen.findByRole('button', { name: '增加行' })

    expect(screen.getByText(/暂无组成环/)).toBeInTheDocument()
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

  it('F-01 目标下限大于上限时允许区间、裕量和目标图不套用上次有效目标', async () => {
    const user = userEvent.setup()
    await renderWorkspace()

    await buildCaseA(user)
    await user.click(confirmationCheckbox())
    expect(resultValue('result-status')).toBe('不满足')
    expect(resultValue('result-target')).toBe('0.1000 ~ 0.3000')
    expect(
      screen.getByRole('button', { name: '打印报告' }),
    ).not.toBeDisabled()

    // 目标下限大于上限：当前草稿无效，chain 为 null。
    // 用一次完整的 change 模拟“把 0.1000 改成 0.5000”，避免逐字符输入时
    // 中间值 0.0000 也短暂成为有效链。
    fireEvent.change(screen.getByLabelText('目标下限'), {
      target: { value: '0.5000' },
    })

    expect(
      screen.getByText('输入有误，显示的是上次有效结果'),
    ).toBeInTheDocument()
    // C₀/Cmin/Cmax 仍可显示上次有效结果。
    expect(resultValue('result-min')).toBe('0.1500')
    expect(resultValue('result-max')).toBe('0.3900')
    // 允许区间、两侧裕量和目标图不能混入旧的 target。
    expect(resultValue('result-target')).toBe('—')
    expect(resultValue('result-lower-margin')).toBe('—')
    expect(resultValue('result-upper-margin')).toBe('—')
    expect(screen.queryByTestId('target-range')).toBeNull()
    expect(screen.queryByTestId('target-zero-marker')).toBeNull()
    expect(screen.getByTestId('chart-target-invalid')).toHaveTextContent('—')
    // 不给出“满足/不满足”的正式判定，打印入口禁用。
    expect(resultValue('result-status')).toBe('待确认（预览）')
    expect(screen.getByRole('button', { name: '打印报告' })).toBeDisabled()

    // 贡献表也沿用上次有效结果，而不是当前无效草稿。
    const contributionTable = screen.getByRole('table', {
      name: '公差贡献表',
    })
    expect(within(contributionTable).getAllByRole('row')).toHaveLength(5)
    expect(contributionTable).toHaveTextContent('H')
    expect(contributionTable).toHaveTextContent('0.1000')
  })

  it('F-02 改回合法目标后允许区间、裕量与判定恢复，打印入口重新可用', async () => {
    const user = userEvent.setup()
    await renderWorkspace()

    await buildCaseA(user)
    await user.click(confirmationCheckbox())
    expect(confirmationCheckbox()).toBeChecked()

    const targetMin = screen.getByLabelText('目标下限')
    fireEvent.change(targetMin, { target: { value: '0.5000' } })
    expect(resultValue('result-target')).toBe('—')
    expect(resultValue('result-lower-margin')).toBe('—')

    fireEvent.change(targetMin, { target: { value: '0.1000' } })

    expect(
      screen.queryByText('输入有误，显示的是上次有效结果'),
    ).toBeNull()
    expect(resultValue('result-target')).toBe('0.1000 ~ 0.3000')
    expect(resultValue('result-lower-margin')).toBe('+0.0500')
    expect(resultValue('result-upper-margin')).toBe('-0.0900')
    expect(resultValue('result-status')).toBe('不满足')
    expect(screen.getByTestId('target-range')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '打印报告' }),
    ).not.toBeDisabled()
  })

  it('编辑清除确认状态时显示重新核对提示，重新勾选后提示消失', async () => {
    const user = userEvent.setup()
    await renderWorkspace()

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

/** 等本轮防抖真正写入完成：先确认进入“保存中”，再等“已保存”。 */
async function waitForAutoSave(): Promise<void> {
  await screen.findByText('保存中')
  await screen.findByText('已保存', undefined, { timeout: 3000 })
}

describe('Workspace：按 projectId 打开与返回列表', () => {
  it('指定 projectId 时打开该项目，并可点击返回项目列表', async () => {
    const first = await createEmptyProject('项目一')
    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }
    const second = await createEmptyProject('项目二')
    expect(second.ok).toBe(true)
    if (!second.ok) {
      return
    }

    const onBackToList = vi.fn()
    const user = userEvent.setup()
    render(
      <Workspace
        projectId={first.value.id}
        onBackToList={onBackToList}
      />,
    )

    await screen.findByRole('button', { name: '增加行' })
    expect(screen.getByText(/项目：项目一/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '导出 JSON' }),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: '返回项目列表' }),
    )
    expect(onBackToList).toHaveBeenCalledTimes(1)
  })

  it('指定不存在的 projectId 时显示错误和返回项目列表，而不是打开其它项目', async () => {
    await createEmptyProject('项目一')
    const onBackToList = vi.fn()
    const user = userEvent.setup()
    render(
      <Workspace projectId="missing-project" onBackToList={onBackToList} />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('项目不存在：missing-project')
    expect(alert).toHaveTextContent('它可能已被删除')
    expect(
      screen.queryByRole('button', { name: '增加行' }),
    ).toBeNull()

    await user.click(
      within(alert).getByRole('button', { name: '返回项目列表' }),
    )
    expect(onBackToList).toHaveBeenCalledTimes(1)
  })

  it('IndexedDB 打开失败时说明草稿可能没保存，重试会重新打开数据库', async () => {
    const originalOpen = indexedDB.open.bind(indexedDB)
    let openCount = 0
    vi.spyOn(IDBFactory.prototype, 'open').mockImplementation(
      (name, version) => {
        openCount += 1
        if (openCount === 1) {
          throw new Error('模拟 IndexedDB 打开失败')
        }
        return originalOpen(name, version)
      },
    )

    const user = userEvent.setup()
    render(<Workspace onBackToList={() => undefined} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('本地存储不可用')
    expect(alert).toHaveTextContent('草稿可能没有保存')
    expect(alert).toHaveTextContent('无法打开')
    expect(
      within(alert).getByRole('button', { name: '导出 JSON 备份' }),
    ).toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: '重试' }))

    await screen.findByRole('button', { name: '增加行' })
    expect(openCount).toBeGreaterThan(1)
  })
})

describe('Workspace：自动保存与刷新恢复', () => {
  it('建立案例 A 后卸载并重新挂载，输入、确认状态和结果一致', async () => {
    const user = userEvent.setup()
    const first = render(<Workspace />)
    await screen.findByRole('button', { name: '增加行' })

    await buildCaseA(user)
    await user.click(confirmationCheckbox())
    await waitForAutoSave()

    expect(resultValue('result-status')).toBe('不满足')
    expect(resultValue('result-min')).toBe('0.1500')
    expect(resultValue('result-max')).toBe('0.3900')

    first.unmount()

    render(<Workspace />)
    await screen.findByRole('button', { name: '增加行' })

    expect(screen.getByRole('textbox', { name: 'H 基本尺寸' })).toHaveValue(
      '100.0000',
    )
    expect(screen.getByRole('textbox', { name: 'S 下偏差' })).toHaveValue(
      '-0.0500',
    )
    expect(screen.getByLabelText('目标下限')).toHaveValue('0.1000')
    expect(screen.getByLabelText('目标上限')).toHaveValue('0.3000')
    expect(confirmationCheckbox()).toBeChecked()
    expect(resultValue('result-status')).toBe('不满足')
    expect(resultValue('result-min')).toBe('0.1500')
    expect(resultValue('result-max')).toBe('0.3900')
  })

  it('无效草稿刷新后仍然保留，并显示上一次有效结果和待修正状态', async () => {
    const user = userEvent.setup()
    const first = render(<Workspace />)
    await screen.findByRole('button', { name: '增加行' })

    await buildCaseA(user)
    await user.click(confirmationCheckbox())
    await waitForAutoSave()

    fireEvent.change(screen.getByRole('textbox', { name: 'H 基本尺寸' }), {
      target: { value: '' },
    })
    expect(
      screen.getByText('输入有误，显示的是上次有效结果'),
    ).toBeInTheDocument()
    expect(screen.getByText('待修正')).toBeInTheDocument()
    await waitForAutoSave()

    first.unmount()

    render(<Workspace />)
    await screen.findByRole('button', { name: '增加行' })

    // 草稿中的无效输入原样恢复，提示待修正。
    expect(screen.getByRole('textbox', { name: 'H 基本尺寸' })).toHaveValue('')
    expect(
      screen.getByText('输入有误，显示的是上次有效结果'),
    ).toBeInTheDocument()
    expect(screen.getByText('待修正')).toBeInTheDocument()
    expect(confirmationCheckbox()).not.toBeChecked()

    // 结果卡显示的是项目里上一次有效模型（案例 A），而不是空结果。
    expect(resultValue('result-status')).toBe('待确认（预览）')
    expect(resultValue('result-target')).toBe('0.1000 ~ 0.3000')
    expect(resultValue('result-min')).toBe('0.1500')
    expect(resultValue('result-max')).toBe('0.3900')
  })

  it('保存失败时显示“保存失败”并提示导出 JSON，不显示“已保存”', async () => {
    const failingSave = async (): Promise<StorageResult<SaveDraftResult>> => {
      throw new Error('模拟 IndexedDB 写入失败')
    }

    render(<Workspace saveDraft={failingSave} />)
    await screen.findByRole('button', { name: '增加行' })

    fireEvent.change(screen.getByLabelText('目标下限'), {
      target: { value: '0.1000' },
    })

    await screen.findByText('保存失败', undefined, { timeout: 3000 })
    expect(screen.queryByText('已保存')).toBeNull()
    expect(screen.getByText(/本地存储不可用，草稿可能没有保存/)).toBeInTheDocument()
    expect(screen.getByText(/请立即导出 JSON 备份/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '导出 JSON 备份' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(screen.getByText(/模拟 IndexedDB 写入失败/)).toBeInTheDocument()
  })

  it('点“重试”会立即重新保存当前草稿，成功后恢复“已保存”并移除错误', async () => {
    const savedAt = '2025-01-01T00:00:00.000Z'
    const fakeProject: Project = {
      schemaVersion: 1,
      engineVersion: 'test',
      id: 'retry-project',
      name: '重试保存',
      createdAt: savedAt,
      updatedAt: savedAt,
      working: {
        terms: [],
        target: null,
        assumptions: '',
        relationConfirmed: false,
      },
      baseline: null,
    }
    const saveMock = vi.fn(
      async (
        projectId: string,
        draft: WorkspaceDraft,
      ): Promise<StorageResult<SaveDraftResult>> => ({
        ok: true,
        value: {
          project: fakeProject,
          draft: { projectId, draft, savedAt },
          modelUpdated: false,
          cellErrors: {},
        },
      }),
    )
    saveMock.mockRejectedValueOnce(new Error('模拟第一次写入失败'))

    const user = userEvent.setup()
    render(<Workspace saveDraft={saveMock} />)
    await screen.findByRole('button', { name: '增加行' })

    fireEvent.change(screen.getByLabelText('目标下限'), {
      target: { value: '0.1000' },
    })

    await screen.findByText('保存失败', undefined, { timeout: 3000 })
    expect(saveMock).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('已保存', undefined, { timeout: 3000 }))
      .toBeInTheDocument()
    expect(saveMock).toHaveBeenCalledTimes(2)
    expect(
      screen.queryByText(/本地存储不可用，草稿可能没有保存/),
    ).toBeNull()
  })

  it('500 ms 内多次编辑只触发一次防抖写入', async () => {
    const savedAt = '2025-01-01T00:00:00.000Z'
    const fakeProject: Project = {
      schemaVersion: 1,
      engineVersion: 'test',
      id: 'debounce-project',
      name: '防抖测试',
      createdAt: savedAt,
      updatedAt: savedAt,
      working: {
        terms: [],
        target: null,
        assumptions: '',
        relationConfirmed: false,
      },
      baseline: null,
    }
    const saveMock = vi.fn(
      async (
        projectId: string,
        draft: WorkspaceDraft,
      ): Promise<StorageResult<SaveDraftResult>> => ({
        ok: true,
        value: {
          project: fakeProject,
          draft: { projectId, draft, savedAt },
          modelUpdated: false,
          cellErrors: {},
        },
      }),
    )

    render(<Workspace saveDraft={saveMock} />)
    await screen.findByRole('button', { name: '增加行' })

    vi.useFakeTimers()
    const targetMin = screen.getByLabelText('目标下限')
    fireEvent.change(targetMin, { target: { value: '0.1000' } })
    fireEvent.change(targetMin, { target: { value: '0.2000' } })
    fireEvent.change(targetMin, { target: { value: '0.3000' } })

    expect(saveMock).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(saveMock).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(saveMock).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
    await waitFor(() => {
      expect(screen.getByText('已保存')).toBeInTheDocument()
    })
    expect(saveMock).toHaveBeenCalledTimes(1)
  })
})

describe('Workspace：基线、方案对比与恢复', () => {
  it('保存案例 A 为基线，改到 B 后显示 Cmin/Cmax/Tc 与判定变化，恢复后回到 A 且清除确认', async () => {
    const user = userEvent.setup()
    const first = render(<Workspace />)
    await screen.findByRole('button', { name: '增加行' })

    await buildCaseA(user)
    await user.click(confirmationCheckbox())
    await waitForAutoSave()

    const saveBaselineButton = screen.getByRole('button', { name: '保存为基线' })
    expect(saveBaselineButton).not.toBeDisabled()
    await user.click(saveBaselineButton)

    expect(await screen.findByText('已保存为基线')).toBeInTheDocument()
    expect(screen.getByText(/已有基线/)).toBeInTheDocument()
    expect(screen.getByText(/未发现差异/)).toBeInTheDocument()

    // 改成案例 B：H 上偏差 +0.0300，S 下偏差 -0.0200、上偏差 +0.0200。
    fireEvent.change(screen.getByRole('textbox', { name: 'H 上偏差' }), {
      target: { value: '0.0300' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'S 下偏差' }), {
      target: { value: '-0.0200' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'S 上偏差' }), {
      target: { value: '0.0200' },
    })

    expect(confirmationCheckbox()).not.toBeChecked()

    const resultCompare = screen.getByRole('table', {
      name: '结果变化对比',
    })
    expect(
      within(resultCompare).getByTestId('compare-min-delta'),
    ).toHaveTextContent('+0.0300')
    expect(
      within(resultCompare).getByTestId('compare-max-delta'),
    ).toHaveTextContent('-0.1000')
    expect(
      within(resultCompare).getByTestId('compare-tolerance-delta'),
    ).toHaveTextContent('-0.1300')
    expect(
      within(resultCompare).getByTestId('compare-status-before'),
    ).toHaveTextContent('不满足')
    expect(
      within(resultCompare).getByTestId('compare-status-after'),
    ).toHaveTextContent('满足')

    const fieldCompare = screen.getByRole('table', { name: '字段变化对比' })
    const hUpperRow = within(fieldCompare).getByText('0.1000').closest('tr')
    expect(hUpperRow).not.toBeNull()
    expect(hUpperRow).toHaveTextContent('上偏差')
    expect(hUpperRow).toHaveTextContent('0.0300')

    // 已有基线时再次保存必须先经过确认；取消后基线不变。
    await user.click(screen.getByRole('button', { name: '保存为基线' }))
    const overwriteDialog = await screen.findByRole('alertdialog', {
      name: '覆盖基线？',
    })
    expect(overwriteDialog).toHaveTextContent('原基线不能恢复')
    await user.click(
      within(overwriteDialog).getByRole('button', { name: '取消' }),
    )
    expect(
      screen.queryByRole('alertdialog', { name: '覆盖基线？' }),
    ).toBeNull()

    // 恢复基线也要确认；确认后回到 A，并清除关系确认。
    await user.click(screen.getByRole('button', { name: '恢复基线' }))
    const restoreDialog = await screen.findByRole('alertdialog', {
      name: '恢复基线？',
    })
    expect(restoreDialog).toHaveTextContent('关系确认会被清除')
    await user.click(
      within(restoreDialog).getByRole('button', { name: '确认恢复' }),
    )

    expect(
      await screen.findByText('已恢复基线，关系确认已清除'),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'H 上偏差' })).toHaveValue(
      '0.1000',
    )
    expect(screen.getByRole('textbox', { name: 'S 下偏差' })).toHaveValue(
      '-0.0500',
    )
    expect(screen.getByRole('textbox', { name: 'S 上偏差' })).toHaveValue(
      '0.0500',
    )
    expect(confirmationCheckbox()).not.toBeChecked()
    expect(screen.getByText(/未发现差异/)).toBeInTheDocument()

    // 重新挂载后基线和恢复后的工作方案都还在。
    first.unmount()
    render(<Workspace />)
    await screen.findByRole('button', { name: '增加行' })

    expect(await screen.findByText(/已有基线/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '恢复基线' })).not.toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'H 上偏差' })).toHaveValue(
      '0.1000',
    )
    expect(confirmationCheckbox()).not.toBeChecked()
    expect(screen.getByText(/未发现差异/)).toBeInTheDocument()
  })

  it('当前草稿无效时“保存为基线”不可点击', async () => {
    const user = userEvent.setup()
    await renderWorkspace()

    await buildCaseA(user)
    const saveBaselineButton = screen.getByRole('button', {
      name: '保存为基线',
    })
    expect(saveBaselineButton).not.toBeDisabled()

    fireEvent.change(screen.getByRole('textbox', { name: 'H 基本尺寸' }), {
      target: { value: '' },
    })

    expect(saveBaselineButton).toBeDisabled()
    expect(
      screen.getByText(/当前草稿未通过校验，修正后才能保存基线/),
    ).toBeInTheDocument()
  })

  it('确认覆盖后基线更新为当前方案', async () => {
    const user = userEvent.setup()
    await renderWorkspace()

    await buildCaseA(user)
    await user.click(confirmationCheckbox())
    await waitForAutoSave()
    await user.click(screen.getByRole('button', { name: '保存为基线' }))
    await screen.findByText('已保存为基线')

    fireEvent.change(screen.getByRole('textbox', { name: 'H 上偏差' }), {
      target: { value: '0.0300' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'S 下偏差' }), {
      target: { value: '-0.0200' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'S 上偏差' }), {
      target: { value: '0.0200' },
    })

    await user.click(screen.getByRole('button', { name: '保存为基线' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: '覆盖基线？',
    })
    await user.click(within(dialog).getByRole('button', { name: '覆盖基线' }))

    expect(await screen.findByText('已覆盖基线')).toBeInTheDocument()
    expect(screen.getByText(/未发现差异/)).toBeInTheDocument()
  })
})

/** 从 Blob 读出 JSON 文本；jsdom 的 Blob 通过 FileReader 读取。 */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '')
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('读取备份 Blob 失败'))
    }
    reader.readAsText(blob)
  })
}

interface BackupDownloadMock {
  blobs: Blob[]
  restore: () => void
}

function installBackupDownloadMock(): BackupDownloadMock {
  const blobs: Blob[] = []
  const createObjectURL = vi.fn((value: Blob | MediaSource) => {
    blobs.push(value as Blob)
    return 'blob:backup'
  })
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: createObjectURL,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

  const restore = (): void => {
    if (typeof originalCreateObjectURL === 'function') {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: originalCreateObjectURL,
      })
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL')
    }
    if (typeof originalRevokeObjectURL === 'function') {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: originalRevokeObjectURL,
      })
    } else {
      Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
  }

  return { blobs, restore }
}

describe('Workspace：保存失败时的备份导出', () => {
  it('草稿有效时导出当前有效链，草稿无效时导出最后一次有效链，并提示不含未通过校验的修改', async () => {
    const user = userEvent.setup()
    const backupMock = installBackupDownloadMock()
    const saveMock = vi.fn(
      async (
        projectId: string,
        draft: WorkspaceDraft,
      ): Promise<StorageResult<SaveDraftResult>> =>
        persistDraft(projectId, draft),
    )

    try {
      render(<Workspace saveDraft={saveMock} />)
      await screen.findByRole('button', { name: '增加行' })

      await buildCaseA(user)
      await waitForAutoSave()
      expect(saveMock).toHaveBeenCalled()

      // 此后的保存全部失败，但此前案例 A 已成功保存。
      saveMock.mockImplementation(async () => {
        throw new Error('模拟磁盘写入失败')
      })
      fireEvent.change(screen.getByRole('textbox', { name: 'H 上偏差' }), {
        target: { value: '0.0300' },
      })
      await screen.findByText('保存失败', undefined, { timeout: 3000 })

      expect(
        screen.getByText(/备份不含未通过校验的修改/),
      ).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: '导出 JSON 备份' }))
      expect(backupMock.blobs).toHaveLength(1)
      const validBackup = JSON.parse(
        await readBlobText(backupMock.blobs[0]),
      ) as { working: ChainDefinition }
      const validH = validBackup.working.terms.find(
        (term) => term.symbol === 'H',
      )
      expect(validH?.upperDeviationQ).toBe(300)

      // 草稿无效时导出内存中最后一次有效链（保存失败后改过的 H 上偏差 0.0300），
      // 而不是更早成功保存的案例 A。
      fireEvent.change(screen.getByRole('textbox', { name: 'H 基本尺寸' }), {
        target: { value: '' },
      })
      await screen.findByText('保存失败', undefined, { timeout: 3000 })
      await user.click(screen.getByRole('button', { name: '导出 JSON 备份' }))
      expect(backupMock.blobs).toHaveLength(2)
      const fallbackBackup = JSON.parse(
        await readBlobText(backupMock.blobs[1]),
      ) as { working: ChainDefinition }
      const fallbackH = fallbackBackup.working.terms.find(
        (term) => term.symbol === 'H',
      )
      expect(fallbackH?.nominalQ).toBe(1_000_000)
      expect(fallbackH?.upperDeviationQ).toBe(300)
    } finally {
      backupMock.restore()
    }
  })
})

describe('Workspace：document hidden 立即保存', () => {
  it('切到 hidden 时立即写入待保存草稿，不再等待 500 ms 防抖', async () => {
    const savedAt = '2025-01-01T00:00:00.000Z'
    const fakeProject: Project = {
      schemaVersion: 1,
      engineVersion: 'test',
      id: 'visibility-project',
      name: '可见性测试',
      createdAt: savedAt,
      updatedAt: savedAt,
      working: {
        terms: [],
        target: null,
        assumptions: '',
        relationConfirmed: false,
      },
      baseline: null,
    }
    const saveMock = vi.fn(
      async (
        projectId: string,
        draft: WorkspaceDraft,
      ): Promise<StorageResult<SaveDraftResult>> => ({
        ok: true,
        value: {
          project: fakeProject,
          draft: { projectId, draft, savedAt },
          modelUpdated: false,
          cellErrors: {},
        },
      }),
    )

    render(<Workspace saveDraft={saveMock} />)
    await screen.findByRole('button', { name: '增加行' })

    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('目标下限'), {
      target: { value: '0.1000' },
    })
    expect(saveMock).not.toHaveBeenCalled()

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    fireEvent(document, new Event('visibilitychange'))

    expect(saveMock).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(saveMock).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
    await waitFor(() => {
      expect(screen.getByText('已保存')).toBeInTheDocument()
    })
  })
})
