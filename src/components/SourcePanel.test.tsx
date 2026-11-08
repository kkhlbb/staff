// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { createHash } from 'node:crypto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChainDefinition } from '../domain/types'
import { parseMm } from '../domain/units'
import {
  createSourceBinding,
  listSourceBindings,
  reviewSourceBinding,
} from '../sources/bindings'
import {
  importSourceRevision,
  listSourceDocuments,
  listSourceRevisions,
} from '../sources/revisions'
import { createProject, getProject } from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import type { TermDraft } from '../workspace/draft'
import type { RenderPdfPage } from './PdfViewer'
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
    termRevision: 1,
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
    termRevision: 1,
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
  target: null,
  assumptions: '',
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

/**
 * jsdom 没有 canvas 2D 上下文；这里只补齐 PdfViewer 的绘制 seam，让“绘制完成”
 * 这一状态可达。像素内容不是本文件要验证的对象，几何/坐标另有专门用例。
 */
const renderPageForTest: RenderPdfPage = (_page, canvas, viewport) => {
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`
  return { promise: Promise.resolve(), cancel: () => undefined }
}

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
        renderPage={renderPageForTest}
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
        renderPage={renderPageForTest}
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

describe('SourcePanel：来源核对凭据状态', () => {
  it('新建绑定显示未核对；显式核对后显示已核对，改代号保留、改数值失效', async () => {
    const projectId = await createTestProject()
    const imported = await importSourceRevision(
      { projectId, fileName: '图纸.pdf', bytes: bytesA },
      { estimateCapacity: async () => ({ supported: false, usageBytes: null, quotaBytes: null, availableBytes: null, note: '' }) },
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
      { newId: () => 'bind-review' },
    )
    expect(binding.ok, binding.ok ? '' : binding.error.message).toBe(true)

    const { rerender } = render(
      <SourcePanel
        projectId={projectId}
        terms={terms}
        selectedTermId="t-h"
        loadBytes={loadBytes}
        renderPage={renderPageForTest}
      />,
    )

    const badge = await screen.findByTestId('binding-review-bind-review')
    expect(badge).toHaveTextContent('未核对')

    fireEvent.click(screen.getByRole('button', { name: '标记已核对' }))
    await waitFor(() => {
      expect(screen.getByTestId('binding-review-bind-review')).toHaveTextContent('已核对')
    })

    // 改代号不清来源数值核对（termRevision 不变）。
    rerender(
      <SourcePanel
        projectId={projectId}
        terms={[{ ...terms[0], symbol: 'H2' }, terms[1]]}
        selectedTermId="t-h"
        loadBytes={loadBytes}
        renderPage={renderPageForTest}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('binding-review-bind-review')).toHaveTextContent('已核对')
    })

    // 数值变化提升 termRevision → 该绑定失效，其他环不受影响。
    rerender(
      <SourcePanel
        projectId={projectId}
        terms={[{ ...terms[0], symbol: 'H2', termRevision: 2 }, terms[1]]}
        selectedTermId="t-h"
        loadBytes={loadBytes}
        renderPage={renderPageForTest}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('binding-review-bind-review')).toHaveTextContent(
        '数值已变，待重新核对',
      )
    })
  })

  it('同文档导入新版 PDF 后，旧绑定显示待版本复核，不自动迁移区域', async () => {
    const projectId = await createTestProject()
    const first = await importSourceRevision(
      { projectId, fileName: '图纸.pdf', bytes: bytesA },
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
    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }
    const binding = await createSourceBinding(
      {
        projectId,
        termId: 't-h',
        revisionId: first.value.revision.id,
        page: 1,
        rectPdf: [10, 20, 110, 120],
        pageBoxPdf: [0, 0, 600, 800],
        note: '旧版框选',
      },
      { newId: () => 'bind-version' },
    )
    expect(binding.ok).toBe(true)
    await reviewSourceBinding('bind-version', { termRevision: 1 })

    const second = await importSourceRevision(
      {
        projectId,
        documentId: first.value.document.id,
        fileName: '图纸.pdf',
        bytes: bytesB,
      },
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
    expect(second.ok, second.ok ? '' : second.error.message).toBe(true)

    render(
      <SourcePanel
        projectId={projectId}
        terms={terms}
        selectedTermId="t-h"
        loadBytes={loadBytes}
        renderPage={renderPageForTest}
      />,
    )
    const badge = await screen.findByTestId('binding-review-bind-version')
    expect(badge).toHaveTextContent('待版本复核')

    // 旧绑定仍指向原 revision、页码和区域，没有被自动迁移。
    const stored = await listSourceBindings(projectId)
    expect(stored.ok).toBe(true)
    if (stored.ok) {
      expect(stored.value[0].revisionId).toBe(first.value.revision.id)
      expect(stored.value[0].page).toBe(1)
      expect(stored.value[0].rectPdf).toEqual([10, 20, 110, 120])
    }
  })
})

describe('SourcePanel：接通“重框”与“换关联来源”界面入口', () => {
  const surfaceBox = {
    left: 0,
    top: 0,
    width: 600,
    height: 800,
    right: 600,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect

  function drawRect(
    surface: HTMLElement,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): void {
    surface.getBoundingClientRect = () => surfaceBox
    fireEvent.mouseDown(surface, { button: 0, clientX: from.x, clientY: from.y })
    fireEvent.mouseUp(window, { clientX: to.x, clientY: to.y })
  }

  async function setupTwoReviewedBindings(): Promise<{
    projectId: string
    revisionA: { id: string }
    revisionB: { id: string }
    beforeProject: unknown
  }> {
    const projectId = await createTestProject()
    const importedA = await importSourceRevision(
      { projectId, fileName: '装配图.pdf', bytes: bytesA },
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
    expect(importedA.ok).toBe(true)
    if (!importedA.ok) {
      throw new Error(importedA.error.message)
    }
    const revisionA = importedA.value.revision
    const importedB = await importSourceRevision(
      {
        projectId,
        fileName: '装配图-新版.pdf',
        bytes: bytesB,
      },
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
    expect(importedB.ok).toBe(true)
    if (!importedB.ok) {
      throw new Error(importedB.error.message)
    }

    const first = await createSourceBinding(
      {
        projectId,
        termId: 't-h',
        revisionId: revisionA.id,
        page: 1,
        rectPdf: [10, 20, 110, 120],
        pageBoxPdf: [0, 0, 600, 800],
        note: 'H 尺寸框一',
      },
      { newId: () => 'bind-one' },
    )
    const second = await createSourceBinding(
      {
        projectId,
        termId: 't-h',
        revisionId: revisionA.id,
        page: 1,
        rectPdf: [200, 200, 300, 300],
        pageBoxPdf: [0, 0, 600, 800],
        note: 'H 尺寸框二',
      },
      { newId: () => 'bind-two' },
    )
    expect(first.ok && second.ok).toBe(true)
    for (const id of ['bind-one', 'bind-two']) {
      const reviewed = await reviewSourceBinding(id, { termRevision: 1 })
      expect(reviewed.ok).toBe(true)
    }
    const project = await getProject(projectId)
    expect(project.ok).toBe(true)
    return {
      projectId,
      revisionA,
      revisionB: importedB.value.revision,
      beforeProject: project.ok ? project.value?.working : null,
    }
  }

  it('重框只清该绑定的核对与区域，数值和其他绑定不变；等待成功提示出现后才断言', async () => {
    const { projectId, beforeProject } = await setupTwoReviewedBindings()
    render(
      <SourcePanel
        projectId={projectId}
        terms={terms}
        selectedTermId="t-h"
        loadBytes={loadBytes}
        renderPage={renderPageForTest}
      />,
    )

    await waitFor(() =>
      expect(screen.getAllByText('已核对').length).toBe(2),
    )

    fireEvent.click(screen.getByTestId('binding-reframe-bind-one'))
    const editBar = await screen.findByTestId('binding-edit-mode')
    expect(editBar).toHaveTextContent('正在重框一条已有绑定')
    expect(editBar).toHaveTextContent('不改组成环数值，也不影响其他绑定')

    const surface = await screen.findByTestId('pdf-surface')
    drawRect(surface, { x: 40, y: 60 }, { x: 260, y: 380 })
    fireEvent.change(screen.getByLabelText('来源备注'), {
      target: { value: 'H 重框后' },
    })
    const save = await screen.findByRole('button', { name: '保存重框区域' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)

    // 先等存储层完成、提示实际出现，再断言数据。
    await screen.findByText(/已重框；只清空该绑定的来源核对/)
    await waitFor(() => expect(screen.queryByTestId('binding-edit-mode')).toBeNull())

    const bindings = await listSourceBindings(projectId)
    expect(bindings.ok).toBe(true)
    if (!bindings.ok) {
      throw new Error(bindings.error.message)
    }
    const one = bindings.value.find((binding) => binding.id === 'bind-one')
    const two = bindings.value.find((binding) => binding.id === 'bind-two')
    expect(one?.note).toBe('H 重框后')
    expect(one?.reviewedTermRevision).toBeNull()
    expect(one?.reviewedAt).toBeNull()
    expect(one?.rectPdf).not.toEqual([10, 20, 110, 120])
    expect((one?.rectPdf[2] ?? 0) - (one?.rectPdf[0] ?? 0)).toBeGreaterThan(200)
    expect(two?.reviewedTermRevision).toBe(1)
    expect(two?.note).toBe('H 尺寸框二')

    const project = await getProject(projectId)
    expect(project.ok).toBe(true)
    if (project.ok) {
      // 组成环数值与方向没有被绑定编辑改动。
      expect(project.value?.working).toEqual(beforeProject)
    }
  })

  it('换关联来源更新 revisionId 并只清该绑定核对；数值不变', async () => {
    const { projectId, revisionB, beforeProject } = await setupTwoReviewedBindings()
    render(
      <SourcePanel
        projectId={projectId}
        terms={terms}
        selectedTermId="t-h"
        loadBytes={loadBytes}
        renderPage={renderPageForTest}
      />,
    )
    await waitFor(() => expect(screen.getAllByText('已核对').length).toBe(2))

    fireEvent.click(screen.getByTestId('binding-rebind-bind-two'))
    const editBar = await screen.findByTestId('binding-edit-mode')
    expect(editBar).toHaveTextContent('正在更换关联来源')

    // 在左侧选择目标版本（第二个文档的版本 = 最后一项）。
    const revisionButtons = Array.from(
      document.querySelectorAll<HTMLElement>('.source-panel__revision'),
    )
    expect(revisionButtons.length).toBe(2)
    const targetRevisionButton = revisionButtons.find((button) =>
      button.textContent?.includes('装配图-新版.pdf'),
    )
    expect(targetRevisionButton).toBeDefined()
    fireEvent.click(targetRevisionButton as HTMLElement)
    const surface = await screen.findByTestId('pdf-surface')
    drawRect(surface, { x: 30, y: 30 }, { x: 230, y: 330 })
    const save = await screen.findByRole('button', { name: '保存更换来源' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)

    await screen.findByText(/已更换关联来源；只清空该绑定的来源核对/)
    await waitFor(() => expect(screen.queryByTestId('binding-edit-mode')).toBeNull())

    const bindings = await listSourceBindings(projectId)
    expect(bindings.ok).toBe(true)
    if (!bindings.ok) {
      throw new Error(bindings.error.message)
    }
    const one = bindings.value.find((binding) => binding.id === 'bind-one')
    const two = bindings.value.find((binding) => binding.id === 'bind-two')
    expect(two?.revisionId).toBe(revisionB.id)
    expect(two?.reviewedTermRevision).toBeNull()
    expect(one?.revisionId).not.toBe(revisionB.id)
    expect(one?.reviewedTermRevision).toBe(1)

    const project = await getProject(projectId)
    expect(project.ok).toBe(true)
    if (project.ok) {
      expect(project.value?.working).toEqual(beforeProject)
    }
  })
})
