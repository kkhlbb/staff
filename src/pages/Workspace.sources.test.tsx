// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChainDefinition } from '../domain/types'
import { calculateChain } from '../domain/calculate'
import { formatMm, parseMm } from '../domain/units'
import { exportProject, createProject, getDraft, getProject } from '../storage/projects'
import { createRelationReview } from '../workspace/relation'
import { createSourceBinding, reviewSourceBinding } from '../sources/bindings'
import { importSourceRevision } from '../sources/revisions'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import { deleteProjectDatabase } from '../test/projectDb'
import { Workspace } from './Workspace'

const chain: ChainDefinition = {
  terms: [
    {
      id: 't-h',
      symbol: 'H',
      name: '孔',
      nominalQ: parseMm('100'),
      lowerDeviationQ: parseMm('0'),
      upperDeviationQ: parseMm('0.1'),
      sign: 1,
      sourceNote: '',
      termRevision: 1,
    },
    {
      id: 't-b',
      symbol: 'B',
      name: '轴',
      nominalQ: parseMm('99.9'),
      lowerDeviationQ: parseMm('-0.05'),
      upperDeviationQ: parseMm('0'),
      sign: -1,
      sourceNote: '',
      termRevision: 1,
    },
  ],
  target: { minQ: parseMm('0.05'), maxQ: parseMm('0.2') },
  assumptions: '',
}

function resultValue(testId: string): string {
  const row = screen.getByTestId(testId)
  const value = row.querySelector('dd')
  if (value === null) {
    throw new Error(`结果行 ${testId} 缺少 dd`)
  }
  return value.textContent ?? ''
}

beforeEach(async () => {
  await deleteProjectDatabase()
})

describe('Workspace：没有 PDF 来源的项目', () => {
  it('仍可计算、导出，每行标注“无来源绑定”，且不显示来源审查通过', async () => {
    const created = await createProject({
      name: '无来源项目',
      working: chain,
      relationRevision: 1,
      relationReview: createRelationReview(chain, 1, '2026-01-01T00:00:00.000Z'),
    })
    expect(created.ok).toBe(true)
    if (!created.ok) {
      throw new Error(created.error.message)
    }
    const projectId = created.value.id

    const { container } = render(<Workspace projectId={projectId} />)
    await screen.findByRole('button', { name: '增加行' })
    await screen.findByText(/还没有导入 PDF/)

    // 计算仍然发生：结果来自 calculateChain，与来源无关。
    const expected = calculateChain(chain)
    expect(resultValue('result-nominal')).toBe(formatMm(expected.nominalQ))
    expect(resultValue('result-min')).toBe(formatMm(expected.minQ))
    expect(resultValue('result-max')).toBe(formatMm(expected.maxQ))
    expect(resultValue('result-tolerance')).toBe(formatMm(expected.toleranceQ))
    expect(resultValue('result-status')).toBe('不满足')

    // 每行都有来源标记；当前未选中组成环时只有表格里的两处。
    const badges = screen.getAllByTestId(/^source-badge-/)
    expect(badges).toHaveLength(2)
    for (const badge of badges) {
      expect(badge).toHaveTextContent('无来源绑定')
    }

    // 没有 PDF 时不能出现任何“来源审查通过”的措辞。
    expect(container.textContent).not.toContain('来源审查通过')

    // 导出 JSON 仍然可用，内容只包含工程输入。
    const exported = await exportProject(projectId)
    expect(exported.ok).toBe(true)
    if (!exported.ok) {
      throw new Error(exported.error.message)
    }
    const parsed = JSON.parse(exported.value) as {
      working: ChainDefinition
      schemaVersion: number
      sources: { attachmentsIncluded: boolean; revisions: unknown[] }
    }
    // v2 契约：包含来源元数据声明，但明确不含附件。
    expect(parsed.schemaVersion).toBe(2)
    expect(parsed.working.terms.map((term) => term.symbol)).toEqual(['H', 'B'])
    expect(parsed.sources.attachmentsIncluded).toBe(false)
    expect(parsed.sources.revisions).toEqual([])
    expect(exported.value).toContain('数据备份不含来源附件')

    // 导出按钮在界面上也可点击，不因没有来源而被禁用。
    const exportButton = screen.getByRole('button', { name: '导出 JSON' })
    expect(exportButton).toBeEnabled()
    fireEvent.click(exportButton)
  })

  it('选中一行后来源栏显示“无来源绑定”，不冒充已审查', async () => {
    const created = await createProject({ name: '无来源项目 2', working: chain })
    expect(created.ok).toBe(true)
    if (!created.ok) {
      throw new Error(created.error.message)
    }

    const { container } = render(<Workspace projectId={created.value.id} />)
    await screen.findByRole('button', { name: '增加行' })
    const table = screen.getByRole('table', { name: '组成环表' })
    fireEvent.click(within(table).getByRole('button', { name: '选择 H' }))

    expect(await screen.findByTestId('term-binding-empty')).toHaveTextContent(
      '无来源绑定',
    )
    expect(container.textContent).not.toContain('来源审查通过')
  })
})

describe('Workspace 真实贯通：来源核对随数值修订失效', () => {
  it('改值→核对失效；改回原值/非法中间态都不恢复；防抖落库且刷新后仍失效', async () => {
    const created = await createProject({
      name: '来源贯通项目',
      working: chain,
      relationRevision: 1,
      relationReview: createRelationReview(chain, 1, '2026-01-01T00:00:00.000Z'),
    })
    expect(created.ok).toBe(true)
    if (!created.ok) {
      throw new Error(created.error.message)
    }
    const projectId = created.value.id

    const imported = await importSourceRevision(
      { projectId, fileName: '贯通图.pdf', bytes: buildSyntheticPdf({ pageCount: 2, variant: 'A' }) },
      {
        estimateCapacity: async () => ({
          supported: false,
          usageBytes: null,
          quotaBytes: null,
          availableBytes: null,
          note: '',
        }),
      },
    )
    expect(imported.ok, imported.ok ? '' : imported.error.message).toBe(true)
    if (!imported.ok) {
      return
    }
    const binding = await createSourceBinding(
      {
        projectId,
        termId: 't-h',
        revisionId: imported.value.revision.id,
        page: 1,
        rectPdf: [10, 20, 110, 120],
        pageBoxPdf: [0, 0, 600, 800],
        note: 'H 尺寸',
      },
      { newId: () => 'bind-workspace' },
    )
    expect(binding.ok).toBe(true)
    const reviewed = await reviewSourceBinding('bind-workspace', { termRevision: 1 })
    expect(reviewed.ok).toBe(true)

    const first = render(<Workspace projectId={projectId} />)
    await screen.findByRole('button', { name: '增加行' })
    // 初始：已绑定且已核对，没有待复核。
    await waitFor(() =>
      expect(screen.getByTestId('source-badge-t-h')).toHaveTextContent(
        '已绑定 1 处来源',
      ),
    )
    expect(screen.getByTestId('source-badge-t-h')).not.toHaveTextContent('待复核')

    // 改数值：只递增该环 termRevision，来源核对立即失效（不等防抖）。
    const upper = screen.getByRole('textbox', { name: 'H 上偏差' })
    fireEvent.change(upper, { target: { value: '0.0300' } })
    await waitFor(() =>
      expect(screen.getByTestId('source-badge-t-h')).toHaveTextContent('1 处待复核'),
    )

    // 改回原值：指纹恢复但修订号单调，核对不恢复。
    fireEvent.change(upper, { target: { value: '0.1000' } })
    expect(screen.getByTestId('source-badge-t-h')).toHaveTextContent('1 处待复核')

    // 非法中间态：空尺寸 → 待修正；再改回，仍待复核。
    const nominal = screen.getByRole('textbox', { name: 'H 基本尺寸' })
    fireEvent.change(nominal, { target: { value: '' } })
    expect(screen.getByText('输入有误，显示的是上次有效结果')).toBeInTheDocument()
    expect(screen.getByTestId('source-badge-t-h')).toHaveTextContent('1 处待复核')
    fireEvent.change(nominal, { target: { value: '100.0000' } })
    expect(screen.queryByText('输入有误，显示的是上次有效结果')).toBeNull()
    expect(screen.getByTestId('source-badge-t-h')).toHaveTextContent('1 处待复核')

    // 等防抖真正落库（保存中 → 已保存），再直接检查持久化状态。
    await screen.findByText('保存中')
    await screen.findByText('已保存', undefined, { timeout: 3000 })
    const savedProject = await getProject(projectId)
    expect(savedProject.ok).toBe(true)
    if (savedProject.ok && savedProject.value !== null) {
      const term = savedProject.value.working.terms.find((item) => item.id === 't-h')
      // 每次数值/空值编辑都会递增修订号；关键是不可回到初始的 1。
      expect(term?.termRevision).toBeGreaterThan(1)
      expect(term?.upperDeviationQ).toBe(parseMm('0.1'))
      // 旧凭据可以留在记录里，但修订号已前移，判定必须为“未确认”，改回不恢复。
      expect(savedProject.value.relationReview?.relationRevision ?? 0).toBeLessThan(
        savedProject.value.relationRevision,
      )
    }
    const savedDraft = await getDraft(projectId)
    expect(savedDraft.ok).toBe(true)
    if (savedDraft.ok && savedDraft.value !== null) {
      expect(
        savedDraft.value.draft.terms.find((item) => item.id === 't-h')?.upper,
      ).toBe('0.1000')
    }

    // 刷新（卸载重挂）：输入恢复，待复核仍是 1 处，不因数值回到原值而恢复。
    first.unmount()
    render(<Workspace projectId={projectId} />)
    await screen.findByRole('button', { name: '增加行' })
    expect(screen.getByRole('textbox', { name: 'H 上偏差' })).toHaveValue('0.100')
    await waitFor(() =>
      expect(screen.getByTestId('source-badge-t-h')).toHaveTextContent('1 处待复核'),
    )
  })
})
