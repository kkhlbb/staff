// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { ENGINE_VERSION } from '../domain/calculate'
import type { ChainDefinition, DimensionTerm, Project } from '../domain/types'
import { parseMm } from '../domain/units'
import { createProject, saveDraft } from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import { chainToDraft } from '../workspace/draft'
import { PrintReport } from './PrintReport'

beforeEach(async () => {
  window.location.hash = ''
  await deleteProjectDatabase()
})

afterEach(async () => {
  vi.restoreAllMocks()
  window.location.hash = ''
  await deleteProjectDatabase()
})

interface TermInput {
  id: string
  symbol: string
  name: string
  nominal: string
  lower: string
  upper: string
  sign: 1 | -1
  sourceNote?: string
}

function makeTerm(input: TermInput): DimensionTerm {
  return {
    id: input.id,
    symbol: input.symbol,
    name: input.name,
    nominalQ: parseMm(input.nominal),
    lowerDeviationQ: parseMm(input.lower),
    upperDeviationQ: parseMm(input.upper),
    sign: input.sign,
    sourceNote: input.sourceNote ?? '',
  }
}

const CASE_A_TERMS: TermInput[] = [
  {
    id: 'term-h',
    symbol: 'H',
    name: '机架',
    nominal: '100.0000',
    lower: '0.0000',
    upper: '0.1000',
    sign: 1,
    sourceNote: '图纸 A-01，H 尺寸',
  },
  {
    id: 'term-b1',
    symbol: 'B1',
    name: '轴承 1',
    nominal: '20.0000',
    lower: '-0.0200',
    upper: '0.0000',
    sign: -1,
    sourceNote: '轴承样本 B1',
  },
  {
    id: 'term-s',
    symbol: 'S',
    name: '隔套',
    nominal: '59.8000',
    lower: '-0.0500',
    upper: '0.0500',
    sign: -1,
    sourceNote: '图纸 A-02，隔套',
  },
  {
    id: 'term-b2',
    symbol: 'B2',
    name: '轴承 2',
    nominal: '20.0000',
    lower: '-0.0200',
    upper: '0.0000',
    sign: -1,
    sourceNote: '',
  },
]

function makeCaseA(relationConfirmed: boolean): ChainDefinition {
  return {
    terms: CASE_A_TERMS.map(makeTerm),
    target: { minQ: parseMm('0.1000'), maxQ: parseMm('0.3000') },
    assumptions: '假设各组成环独立，作用方向如表达式中标注。',
    relationConfirmed,
  }
}

function makeCaseB(): ChainDefinition {
  const terms = CASE_A_TERMS.map((term) => {
    if (term.symbol === 'H') {
      return makeTerm({ ...term, upper: '0.0300' })
    }
    if (term.symbol === 'S') {
      return makeTerm({ ...term, lower: '-0.0200', upper: '0.0200' })
    }
    return makeTerm(term)
  })
  return {
    terms,
    target: { minQ: parseMm('0.1000'), maxQ: parseMm('0.3000') },
    assumptions: '基线方案：收紧 H 与 S 的偏差。',
    relationConfirmed: true,
  }
}

async function createCaseAProject(
  relationConfirmed = true,
  baseline: Project['baseline'] = null,
): Promise<Project> {
  const created = await createProject({
    name: '案例 A 打印报告',
    working: makeCaseA(relationConfirmed),
    baseline,
  })
  if (!created.ok) {
    throw new Error(`创建测试项目失败：${created.error.message}`)
  }
  return created.value
}

function resultText(testId: string): string {
  const row = screen.getByTestId(testId)
  const cell = row.querySelector('dd')
  if (cell === null) {
    throw new Error(`结果行 ${testId} 缺少 dd`)
  }
  return cell.textContent ?? ''
}

function rowCells(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll('th, td')).map(
    (cell) => cell.textContent ?? '',
  )
}

describe('PrintReport：已确认且有效的案例 A 报告', () => {
  it('逐项显示项目、全部输入、表达式、计算结果、贡献、负间隙说明与基线对比', async () => {
    const printSpy = vi
      .spyOn(window, 'print')
      .mockImplementation(() => undefined)
    const project = await createCaseAProject(true, {
      savedAt: '2026-11-04T08:00:00.000Z',
      definition: makeCaseB(),
    })
    const user = userEvent.setup()

    render(<PrintReport projectId={project.id} />)

    const report = await screen.findByTestId('print-report')

    // 1. 项目名称、报告时间、项目 ID、计算引擎版本。
    expect(
      within(report).getByRole('heading', {
        level: 1,
        name: '案例 A 打印报告',
      }),
    ).toBeInTheDocument()
    expect(within(report).getByText('报告时间')).toBeInTheDocument()
    expect(within(report).getByText(project.id)).toBeInTheDocument()
    expect(within(report).getByText(ENGINE_VERSION)).toBeInTheDocument()

    // 2. 分析方法、单位、适用范围与关系确认状态。
    expect(within(report).getByText('一维极值法（线性尺寸链）')).toBeInTheDocument()
    expect(within(report).getByText(/1 q = 0.0001 mm/)).toBeInTheDocument()
    expect(within(report).getByText(/不验证真实装配拓扑/)).toBeInTheDocument()
    expect(within(report).getByText(/关系确认状态/)).toBeInTheDocument()
    expect(
      within(report).getByText('已确认（用户已核对尺寸关系与作用方向）'),
    ).toBeInTheDocument()

    // 3. 全部输入字段、目标区间、假设与来源备注。
    const inputTable = within(report).getByRole('table', {
      name: '报告输入表',
    })
    const hRow = within(inputTable)
      .getByRole('rowheader', { name: 'H' })
      .closest('tr')
    const b1Row = within(inputTable)
      .getByRole('rowheader', { name: 'B1' })
      .closest('tr')
    if (hRow === null || b1Row === null) {
      throw new Error('输入表缺少 H 或 B1 行')
    }
    expect(rowCells(hRow)).toEqual([
      'H',
      '机架',
      '100.0000',
      '0.0000',
      '0.1000',
      '+1（增加封闭环）',
      '图纸 A-01，H 尺寸',
    ])
    expect(rowCells(b1Row)).toEqual([
      'B1',
      '轴承 1',
      '20.0000',
      '-0.0200',
      '0.0000',
      '-1（减小封闭环）',
      '轴承样本 B1',
    ])
    expect(within(inputTable).getByRole('rowheader', { name: 'S' })).toBeInTheDocument()
    expect(within(inputTable).getByRole('rowheader', { name: 'B2' })).toBeInTheDocument()
    expect(
      within(report).getAllByText('0.1000 ~ 0.3000').length,
    ).toBeGreaterThan(0)
    expect(
      within(report).getAllByText('假设各组成环独立，作用方向如表达式中标注。')
        .length,
    ).toBeGreaterThan(0)

    // 4. 表达式、公式与名义值代入结果。
    expect(within(report).getByTestId('chain-expression')).toHaveTextContent(
      'C = +H - B1 - S - B2',
    )
    expect(within(report).getByText(/极值法公式/)).toBeInTheDocument()
    expect(within(report).getByTestId('report-substitution')).toHaveTextContent(
      'C = +100.0000 - 20.0000 - 59.8000 - 20.0000 = 0.2000',
    )

    // 5. 目标区间、计算区间、两侧裕量与判定。
    expect(resultText('report-result-nominal')).toBe('0.2000')
    expect(resultText('report-result-min')).toBe('0.1500')
    expect(resultText('report-result-max')).toBe('0.3900')
    expect(resultText('report-result-lower-deviation')).toBe('-0.0500')
    expect(resultText('report-result-upper-deviation')).toBe('+0.1900')
    expect(resultText('report-result-tolerance')).toBe('0.2400')
    expect(resultText('report-result-target')).toBe('0.1000 ~ 0.3000')
    expect(resultText('report-result-status')).toBe('不满足')
    expect(resultText('report-result-lower-margin')).toBe('+0.0500')
    expect(resultText('report-result-upper-margin')).toBe('-0.0900')

    // 6. 公差贡献表与比例。
    const contributionTable = within(report).getByRole('table', {
      name: '公差贡献表',
    })
    const contributionRows = within(contributionTable)
      .getAllByRole('row')
      .slice(1)
    expect(contributionRows.map(rowCells)).toEqual([
      ['H', '0.1000', '41.7%'],
      ['S', '0.1000', '41.7%'],
      ['B1', '0.0200', '8.3%'],
      ['B2', '0.0200', '8.3%'],
    ])

    // 7. 负间隙说明按文档第 91 行由用户定义物理意义。
    expect(within(report).getByTestId('report-negative-clearance')).toHaveTextContent(
      '封闭环允许为负值，负间隙的物理意义由用户定义',
    )

    // 8. 有基线时的对比项。
    expect(
      within(report).getByRole('heading', { name: '基线对比' }),
    ).toBeInTheDocument()
    expect(within(report).getByTestId('compare-min')).toHaveTextContent('0.1800')
    expect(within(report).getByTestId('compare-min')).toHaveTextContent('0.1500')
    expect(within(report).getByTestId('compare-max')).toHaveTextContent('0.2900')
    expect(within(report).getByTestId('compare-max')).toHaveTextContent('0.3900')

    // 独立打印视图用浏览器打印。
    await user.click(screen.getByRole('button', { name: '打印报告' }))
    expect(printSpy).toHaveBeenCalledTimes(1)
  })
})

describe('PrintReport：报告门槛', () => {
  it('关系未确认时显示原因，不渲染报告内容和打印按钮', async () => {
    const project = await createCaseAProject(false)

    render(<PrintReport projectId={project.id} />)

    const blocked = await screen.findByTestId('report-blocked')
    expect(blocked).toHaveTextContent('尺寸关系与作用方向尚未确认')
    expect(blocked).toHaveTextContent('不能打印报告')
    expect(screen.queryByTestId('print-report')).toBeNull()
    expect(
      screen.queryByRole('button', { name: '打印报告' }),
    ).toBeNull()
    expect(screen.queryByText('C₀ 封闭环基本尺寸')).toBeNull()
  })

  it('草稿无效时即使项目里保留已确认的有效方案，也不能出报告', async () => {
    const project = await createCaseAProject(true)
    const invalidDraft = chainToDraft(makeCaseA(true))
    invalidDraft.terms[0] = {
      ...invalidDraft.terms[0],
      upper: '-0.0100',
    }
    const saved = await saveDraft(project.id, invalidDraft)
    expect(saved.ok).toBe(true)
    if (saved.ok) {
      expect(saved.value.modelUpdated).toBe(false)
    }

    render(<PrintReport projectId={project.id} />)

    const blocked = await screen.findByTestId('report-blocked')
    expect(blocked).toHaveTextContent('当前输入未通过校验')
    expect(screen.queryByTestId('print-report')).toBeNull()
    expect(
      screen.queryByRole('button', { name: '打印报告' }),
    ).toBeNull()
  })
})

describe('PrintReport：路由', () => {
  it('通过 #/project/<id>/report 独立打开打印视图', async () => {
    const project = await createCaseAProject(true)
    window.location.hash = `#/project/${encodeURIComponent(project.id)}/report`

    render(<App />)

    expect(await screen.findByTestId('print-report')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '返回工作台' }),
    ).toBeInTheDocument()
  })
})
