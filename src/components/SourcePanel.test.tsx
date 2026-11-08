// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { createHash } from 'node:crypto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChainDefinition } from '../domain/types'
import { parseMm } from '../domain/units'
import { listSourceBindings } from '../sources/bindings'
import { listSourceDocuments, listSourceRevisions } from '../sources/revisions'
import { createProject } from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import type { TermDraft } from '../workspace/draft'
import { SourcePanel } from './SourcePanel'

const terms: TermDraft[] = [
  {
    id: 't-h',
    symbol: 'H',
    name: '孔',
    nominal: '100',
    lower: '0',
    upper: '0.1',
    sign: 1,
    sourceNote: '',
  },
  {
    id: 't-b',
    symbol: 'B',
    name: '轴',
    nominal: '99.9',
    lower: '-0.05',
    upper: '0',
    sign: -1,
    sourceNote: '',
  },
]

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
    },
  ],
  target: null,
  assumptions: '',
  relationConfirmed: false,
}

const bytesA = buildSyntheticPdf({ pageCount: 2, variant: 'A' })
const bytesB = buildSyntheticPdf({ pageCount: 2, variant: 'B' })
const hashA = createHash('sha256').update(bytesA).digest('hex')
const hashB = createHash('sha256').update(bytesB).digest('hex')

const bytesByHash = new Map<string, Uint8Array>([
  [hashA, bytesA],
  [hashB, bytesB],
])

/** 测试里按 revision 记录的 SHA-256 返回字节，模拟 sourceBlobs 的读取结果。 */
const loadBytes = async (revision: { sha256: string }) =>
  bytesByHash.get(revision.sha256) ?? null

async function createTestProject(): Promise<string> {
  const created = await createProject({ name: '来源面板测试', working: chain })
  expect(created.ok).toBe(true)
  if (!created.ok) {
    throw new Error(created.error.message)
  }
  return created.value.id
}

beforeEach(async () => {
  await deleteProjectDatabase()
})

describe('SourcePanel：无来源项目', () => {
  it('没有 PDF 时明确显示无来源绑定，且不出现“来源审查通过”', async () => {
    const projectId = await createTestProject()
    const { container } = render(
      <SourcePanel projectId={projectId} terms={terms} selectedTermId="t-h" />,
    )

    expect(
      await screen.findByText(/还没有导入 PDF/),
    ).toBeInTheDocument()
    expect(screen.getByTestId('term-binding-empty')).toHaveTextContent('无来源绑定')
    expect(container.textContent).not.toContain('来源审查通过')
    expect(container.textContent).not.toContain('审查通过')
  })
})

describe('SourcePanel：导入、框选、刷新后打开确切 revision', () => {
  it('同名文件作为新版本导入后，刷新仍打开绑定所在的旧 revision、页码与备注', async () => {
    const projectId = await createTestProject()

    const first = render(
      <SourcePanel
        projectId={projectId}
        terms={terms}
        selectedTermId="t-h"
        loadBytes={loadBytes}
      />,
    )
    await screen.findByText(/还没有导入 PDF/)

    // 1) 导入第一份 PDF。
    const fileInput = screen.getByLabelText('选择 PDF 文件')
    fireEvent.change(fileInput, {
      target: { files: [new File([bytesA as unknown as BlobPart], '装配图.pdf', { type: 'application/pdf' })] },
    })
    await screen.findByText(/已导入 装配图\.pdf/)

    const revisionsAfterA = await listSourceRevisions(projectId)
    expect(revisionsAfterA.ok).toBe(true)
    if (!revisionsAfterA.ok) {
      throw new Error(revisionsAfterA.error.message)
    }
    expect(revisionsAfterA.value).toHaveLength(1)
    const revisionA = revisionsAfterA.value[0]
    expect(revisionA.sha256).toBe(hashA)

    // 2) 跳到第 2 页，框选并保存绑定（组件级真实鼠标事件 + 坐标映射）。
    fireEvent.click(await screen.findByLabelText('下一页'))
    const surface = await screen.findByTestId('pdf-surface')
    surface.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: Number.parseFloat(surface.style.width),
        height: Number.parseFloat(surface.style.height),
        right: Number.parseFloat(surface.style.width),
        bottom: Number.parseFloat(surface.style.height),
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect

    fireEvent.mouseDown(surface, { button: 0, clientX: 50, clientY: 60 })
    fireEvent.mouseUp(window, { clientX: 250, clientY: 460 })
    fireEvent.change(screen.getByLabelText('来源备注'), {
      target: { value: '第 2 页孔公差框' },
    })
    const saveButton = screen.getByRole('button', { name: '保存来源绑定' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)
    await screen.findByText(/已保存来源绑定/)

    const bindingsAfterSave = await listSourceBindings(projectId)
    expect(bindingsAfterSave.ok).toBe(true)
    if (!bindingsAfterSave.ok) {
      throw new Error(bindingsAfterSave.error.message)
    }
    expect(bindingsAfterSave.value).toHaveLength(1)
    const binding = bindingsAfterSave.value[0]
    expect(binding.revisionId).toBe(revisionA.id)
    expect(binding.page).toBe(2)
    expect(binding.note).toBe('第 2 页孔公差框')
    // 绑定的矩形在页面内且不是空区域。
    expect(binding.rectPdf[2]).toBeGreaterThan(binding.rectPdf[0])
    expect(binding.rectPdf[3]).toBeGreaterThan(binding.rectPdf[1])

    // 3) 同名文件作为新版本导入到同一文档：latestRevisionId 前移。
    const documentsAfterA = await listSourceDocuments(projectId)
    expect(documentsAfterA.ok).toBe(true)
    if (!documentsAfterA.ok) {
      throw new Error(documentsAfterA.error.message)
    }
    const documentId = documentsAfterA.value[0].id
    fireEvent.change(screen.getByLabelText('导入方式'), {
      target: { value: documentId },
    })
    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: { files: [new File([bytesB as unknown as BlobPart], '装配图.pdf', { type: 'application/pdf' })] },
    })
    await screen.findByText(/已导入 装配图\.pdf，2 页/)

    const revisionsAfterB = await listSourceRevisions(projectId)
    expect(revisionsAfterB.ok).toBe(true)
    if (!revisionsAfterB.ok) {
      throw new Error(revisionsAfterB.error.message)
    }
    expect(revisionsAfterB.value).toHaveLength(2)
    const revisionB = revisionsAfterB.value.find(
      (candidate) => candidate.id !== revisionA.id,
    )
    expect(revisionB).toBeDefined()
    if (revisionB === undefined) {
      throw new Error('没有找到第二版本')
    }
    expect(revisionB.sha256).not.toBe(revisionA.sha256)
    // 绑定仍指向旧 revision，不跟随 latest。
    expect(binding.revisionId).not.toBe(revisionB.id)

    // 4) 模拟刷新：卸载后重新挂载，只从 IndexedDB 恢复。
    first.unmount()
    render(
      <SourcePanel
        projectId={projectId}
        terms={terms}
        selectedTermId="t-h"
        loadBytes={loadBytes}
      />,
    )

    const fileLine = await waitFor(() => {
      const element = document.querySelector('.pdf-viewer__file')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    expect(fileLine.textContent).toContain(revisionA.id.slice(0, 8))
    expect(fileLine.textContent).not.toContain(revisionB.id.slice(0, 8))
    expect(screen.getByLabelText('页码跳转')).toHaveValue(2)
    expect(screen.getAllByText(/第 2 页孔公差框/).length).toBeGreaterThan(0)
    const highlight = await waitFor(() => {
      const element = document.querySelector(
        `[data-binding-id="${binding.id}"]`,
      )
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    expect(Number.parseFloat(highlight.style.width)).toBeGreaterThan(0)
    expect(Number.parseFloat(highlight.style.height)).toBeGreaterThan(0)
  })

  it('导入失败时显示错误且不新增 revision、不改现有指针', async () => {
    const projectId = await createTestProject()
    render(
      <SourcePanel
        projectId={projectId}
        terms={terms}
        selectedTermId="t-h"
        loadBytes={async () => new Uint8Array([1, 2, 3])}
      />,
    )
    await screen.findByText(/还没有导入 PDF/)

    fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
      target: {
        files: [new File([new Uint8Array([1, 2, 3, 4])], '损坏.pdf', { type: 'application/pdf' })],
      },
    })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('导入失败')
    expect(alert.textContent).toContain('现有版本指针和绑定未改变')

    const revisions = await listSourceRevisions(projectId)
    expect(revisions.ok && revisions.value).toEqual([])
    const documents = await listSourceDocuments(projectId)
    expect(documents.ok && documents.value).toEqual([])
  })
})
