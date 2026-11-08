// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { ENGINE_VERSION } from '../domain/calculate'
import type { ChainDefinition, DimensionTerm, Project } from '../domain/types'
import { parseMm } from '../domain/units'
import {
  createAnalysisSnapshot,
  type AnalysisSnapshot,
} from '../history/snapshots'
import { REVIEW_RULES_VERSION } from '../review/rules'
import {
  createSourceBinding,
  reviewSourceBinding,
} from '../sources/bindings'
import { importSourceRevision } from '../sources/revisions'
import { createRelationReview } from '../workspace/relation'
import { updateProject } from '../storage/projects'
import { createProject } from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import { chainToDraft } from '../workspace/draft'
import {
  SNAPSHOT_STORE_NAME,
  requestResult,
  transactionDone,
  withDatabase,
} from '../storage/db'
import { PrintReport } from './PrintReport'
import { snapshotShortId } from '../history/snapshotId'

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
    termRevision: 1,
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

function makeCaseA(): ChainDefinition {
  return {
    terms: CASE_A_TERMS.map(makeTerm),
    target: { minQ: parseMm('0.1000'), maxQ: parseMm('0.3000') },
    assumptions: '假设各组成环独立，作用方向如表达式中标注。',
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
  }
}

async function createCaseAProject(
  relationConfirmed = true,
  baseline: Project['baseline'] = null,
): Promise<Project> {
  const working = makeCaseA()
  const relationRevision = 1
  const created = await createProject({
    name: '案例 A 打印报告',
    working,
    baseline,
    relationRevision,
    relationReview: relationConfirmed
      ? createRelationReview(
          working,
          relationRevision,
          '2026-01-01T00:00:00.000Z',
        )
      : null,
  })
  if (!created.ok) {
    throw new Error(`创建测试项目失败：${created.error.message}`)
  }
  return created.value
}

async function snapshotProject(
  project: Project,
  options: { baseline?: Project['baseline'] } = {},
): Promise<AnalysisSnapshot> {
  const created = await createAnalysisSnapshot({
    project,
    draft: chainToDraft(project.working),
    relationState: {
      relationRevision: project.relationRevision,
      relationReview: project.relationReview,
    },
    baseline: options.baseline ?? project.baseline,
    now: '2026-11-08T10:00:00.000Z',
  })
  if (!created.ok) {
    throw new Error(`创建快照失败：${created.error.message}`)
  }
  return created.value
}

/** 给每个组成环建立同一 PDF 版本的绑定并记录核对，使审查真正完成。 */
async function bindAndReviewAllTerms(project: Project): Promise<void> {
  const pdf = buildSyntheticPdf({ pageCount: 2 })
  const imported = await importSourceRevision({
    projectId: project.id,
    fileName: 'case-a.pdf',
    bytes: pdf,
  })
  if (!imported.ok) {
    throw new Error(imported.error.message)
  }
  for (const term of project.working.terms) {
    const binding = await createSourceBinding({
      projectId: project.id,
      termId: term.id,
      revisionId: imported.value.revision.id,
      page: 1,
      rectPdf: [20, 20, 200, 60],
      pageBoxPdf: [0, 0, 600, 800],
      note: `${term.symbol} 来源区域`,
    })
    if (!binding.ok) {
      throw new Error(binding.error.message)
    }
    const reviewed = await reviewSourceBinding(binding.value.id, {
      termRevision: term.termRevision,
    })
    if (!reviewed.ok) {
      throw new Error(reviewed.error.message)
    }
  }
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

describe('PrintReport：由不可变快照生成的案例 A 报告', () => {
  it('逐项显示快照、输入、公式、结果、贡献、来源清单、审查待办与基线对比', async () => {
    const printSpy = vi
      .spyOn(window, 'print')
      .mockImplementation(() => undefined)
    const project = await createCaseAProject(true, {
      savedAt: '2026-11-04T08:00:00.000Z',
      definition: makeCaseB(),
    })
    const snapshot = await snapshotProject(project)
    const user = userEvent.setup()

    render(
      <PrintReport projectId={project.id} snapshotId={snapshot.id} />,
    )

    const report = await screen.findByTestId('print-report')

    // 1. 项目、快照 ID/时间、计算引擎与规则版本。
    expect(
      within(report).getByRole('heading', {
        level: 1,
        name: '案例 A 打印报告',
      }),
    ).toBeInTheDocument()
    expect(within(report).getByText(project.id)).toBeInTheDocument()
    expect(within(report).getByText(ENGINE_VERSION)).toBeInTheDocument()
    expect(within(report).getByText(REVIEW_RULES_VERSION)).toBeInTheDocument()
    expect(
      within(report).getByTestId('report-snapshot-id'),
    ).toHaveTextContent(snapshot.id)
    expect(within(report).getByText('快照创建时间')).toBeInTheDocument()

    // 2. 分析方法、单位、适用范围与关系确认状态。
    expect(within(report).getByText('一维极值法（线性尺寸链）')).toBeInTheDocument()
    expect(within(report).getByText(/1 q = 0.0001 mm/)).toBeInTheDocument()
    expect(within(report).getByText(/不验证真实装配拓扑/)).toBeInTheDocument()
    expect(
      within(report).getByTestId('report-relation-state'),
    ).toHaveTextContent('已确认（用户自述核对尺寸关系与作用方向）')

    // 3. 全部输入字段、目标区间、假设与来源备注来自冻结定义。
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
    // 没有来源绑定：计算结论仍是“不满足”，但审查未完成要单独标明。
    expect(resultText('report-result-status')).toBe(
      '计算不满足（审查未完成，见待办）',
    )
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

    // 7. 负间隙说明、来源清单与审查待办。
    expect(within(report).getByTestId('report-negative-clearance')).toHaveTextContent(
      '封闭环允许为负值，负间隙的物理意义由用户定义',
    )
    expect(within(report).getByTestId('report-no-bindings')).toHaveTextContent(
      '未建立任何来源绑定',
    )
    expect(
      within(report).getByTestId('report-incomplete-banner'),
    ).toHaveTextContent('审查未完成：本报告是带待办报告')
    expect(within(report).getByTestId('report-review-state')).toHaveTextContent(
      '审查未完成',
    )
    expect(
      within(report).getAllByTestId(/^pending-/).length,
    ).toBeGreaterThan(0)

    // 8. 有基线时的对比项来自冻结快照。
    expect(
      within(report).getByRole('heading', { name: '基线对比（快照冻结）' }),
    ).toBeInTheDocument()
    expect(within(report).getByTestId('compare-min')).toHaveTextContent('0.1800')
    expect(within(report).getByTestId('compare-min')).toHaveTextContent('0.1500')
    expect(within(report).getByTestId('compare-max')).toHaveTextContent('0.2900')
    expect(within(report).getByTestId('compare-max')).toHaveTextContent('0.3900')

    // 每页页脚：页码 / 总页数 + 快照短 ID。@page 规则由打印分页生成。
    const pageRule = screen.getByTestId('report-page-rule')
    expect(pageRule).toHaveTextContent('counter(page)')
    expect(pageRule).toHaveTextContent('counter(pages)')
    expect(pageRule).toHaveTextContent('第 ')
    expect(pageRule).toHaveTextContent('页 / 共 ')
    expect(pageRule).toHaveTextContent(`快照 ${snapshotShortId(snapshot.id)}`)

    // 独立打印视图用浏览器打印。
    await user.click(screen.getByRole('button', { name: '打印报告' }))
    expect(printSpy).toHaveBeenCalledTimes(1)
  })

  it('快照创建后修改工作数据，报告仍只显示冻结内容', async () => {
    const project = await createCaseAProject(true)
    const snapshot = await snapshotProject(project)

    const changed = await updateProject(project.id, {
      name: '已改名的工作项目',
      working: makeCaseB(),
    })
    expect(changed.ok).toBe(true)

    render(
      <PrintReport projectId={project.id} snapshotId={snapshot.id} />,
    )
    const report = await screen.findByTestId('print-report')

    // 快照里的项目名与数值不变；实时项目已改名、数值已收紧。
    expect(
      within(report).getByRole('heading', { level: 1, name: '案例 A 打印报告' }),
    ).toBeInTheDocument()
    expect(resultText('report-result-min')).toBe('0.1500')
    expect(resultText('report-result-max')).toBe('0.3900')
    expect(within(report).queryByText('已改名的工作项目')).toBeNull()
    expect(
      within(report).getByTestId('report-snapshot-id'),
    ).toHaveTextContent(snapshot.id)
  })

  it('基线对比只读取快照冻结的 Diff，不按当前引擎重算', async () => {
    const project = await createCaseAProject(true, {
      savedAt: '2026-11-04T08:00:00.000Z',
      definition: makeCaseB(),
    })
    const snapshot = await snapshotProject(project)

    // 直接改写快照里的冻结对比值，模拟“记录被篡改/来自旧引擎”的情况。
    // 如果报告仍调用 compareChains，页面上会重新出现 0.1800，而不是这个哨兵值。
    await withDatabase(async (db) => {
      const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readwrite')
      const done = transactionDone(transaction)
      const store = transaction.objectStore(SNAPSHOT_STORE_NAME)
      const record = (await requestResult(store.get(snapshot.id))) as {
        comparison: { diff: { minQ: { before: number } } }
      }
      record.comparison.diff.minQ.before = 999999
      store.put(record)
      await done
    })

    render(
      <PrintReport projectId={project.id} snapshotId={snapshot.id} />,
    )
    const report = await screen.findByTestId('print-report')
    const minRow = within(report).getByTestId('compare-min')
    expect(minRow).toHaveTextContent('99.9999')
    expect(minRow).not.toHaveTextContent('0.1800')
  })

  it('旧版快照没有冻结对比结果时不补算，只显示不可用说明', async () => {
    const project = await createCaseAProject(true, {
      savedAt: '2026-11-04T08:00:00.000Z',
      definition: makeCaseB(),
    })
    const snapshot = await snapshotProject(project)

    await withDatabase(async (db) => {
      const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readwrite')
      const done = transactionDone(transaction)
      const store = transaction.objectStore(SNAPSHOT_STORE_NAME)
      const record = (await requestResult(store.get(snapshot.id))) as Record<
        string,
        unknown
      >
      delete record.comparison
      store.put(record)
      await done
    })

    render(
      <PrintReport projectId={project.id} snapshotId={snapshot.id} />,
    )
    const report = await screen.findByTestId('print-report')
    expect(
      within(report).getByTestId('report-comparison-missing'),
    ).toHaveTextContent('不补算')
    expect(within(report).queryByTestId('scenario-compare')).toBeNull()
    expect(within(report).queryByTestId('compare-min')).toBeNull()
  })
})

describe('PrintReport：审查完成与错误状态', () => {
  it('全部来源已绑定并核对后，报告标为审查完成，不显示带待办横幅', async () => {
    const project = await createCaseAProject(true)
    await bindAndReviewAllTerms(project)
    const snapshot = await snapshotProject(project)
    expect(snapshot.status).toBe('complete')

    render(
      <PrintReport projectId={project.id} snapshotId={snapshot.id} />,
    )
    const report = await screen.findByTestId('print-report')

    expect(within(report).getByTestId('report-review-state')).toHaveTextContent(
      '审查完成',
    )
    expect(within(report).queryByTestId('report-incomplete-banner')).toBeNull()
    expect(resultText('report-result-status')).toBe('计算不满足')

    // 来源清单冻结每个绑定的版本、页、区域与三项状态。
    const sourceTable = within(report).getByRole('table', { name: '来源清单' })
    const sourceRows = within(sourceTable).getAllByRole('row').slice(1)
    expect(sourceRows).toHaveLength(4)
    expect(sourceRows[0]).toHaveTextContent('H')
    expect(sourceRows[0]).toHaveTextContent('case-a.pdf')
    expect(sourceRows[0]).toHaveTextContent('第 1 页')
    expect(sourceRows[0]).toHaveTextContent('[20, 20] – [200, 60]')
    expect(sourceRows[0]).toHaveTextContent('通过')
  })

  it('快照不存在时说明原因并可返回快照列表', async () => {
    const project = await createCaseAProject(true)
    const onBackToSnapshots = vi.fn()
    const user = userEvent.setup()

    render(
      <PrintReport
        projectId={project.id}
        snapshotId="snapshot-missing"
        onBackToSnapshots={onBackToSnapshots}
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('分析快照不存在：snapshot-missing')
    expect(alert).toHaveTextContent('可能已被删除')

    await user.click(
      within(alert).getByRole('button', { name: '返回快照列表' }),
    )
    expect(onBackToSnapshots).toHaveBeenCalledWith(project.id)
  })

  it('快照不属于该项目时拒绝渲染', async () => {
    const project = await createCaseAProject(true)
    const snapshot = await snapshotProject(project)

    render(
      <PrintReport projectId="another-project" snapshotId={snapshot.id} />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('该分析快照不属于此项目')
    expect(screen.queryByTestId('print-report')).toBeNull()
  })
})

describe('PrintReport：路由', () => {
  it('通过 #/projects/<id>/reports/<snapshotId> 独立打开快照报告', async () => {
    const project = await createCaseAProject(true)
    const snapshot = await snapshotProject(project)
    window.location.hash = `#/projects/${encodeURIComponent(project.id)}/reports/${encodeURIComponent(snapshot.id)}`

    render(<App />)

    expect(await screen.findByTestId('print-report')).toBeInTheDocument()
    expect(
      screen.getByTestId('report-snapshot-id'),
    ).toHaveTextContent(snapshot.id)
    expect(
      screen.getByRole('button', { name: '返回工作台' }),
    ).toBeInTheDocument()
  })

  it('旧 #/project/<id>/report 链接转到快照列表并明确说明行为变更', async () => {
    const project = await createCaseAProject(true)
    window.location.hash = `#/project/${encodeURIComponent(project.id)}/report`

    render(<App />)

    expect(
      await screen.findByRole('heading', { name: '分析快照' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/报告入口已改为“分析快照”/),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('print-report')).toBeNull()
  })
})
