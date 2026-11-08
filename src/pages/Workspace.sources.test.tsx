// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChainDefinition } from '../domain/types'
import { calculateChain } from '../domain/calculate'
import { formatMm, parseMm } from '../domain/units'
import { exportProject, createProject } from '../storage/projects'
import { createRelationReview } from '../workspace/relation'
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
