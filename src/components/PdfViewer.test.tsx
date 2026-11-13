// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PdfInspectError } from '../sources/pdfInspect'
import type {
  OpenedPdf,
  PdfRenderPageLike,
  RenderViewport,
} from '../sources/render'
import type { SourceRevision } from '../sources/types'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import {
  PdfViewer,
  type PdfViewerProps,
  type RenderPdfPage,
  type SaveBindingInput,
  type SaveBindingOutcome,
} from './PdfViewer'

const revision: SourceRevision = {
  id: 'rev-exact-1',
  projectId: 'project-1',
  documentId: 'doc-1',
  fileName: '装配图.pdf',
  sha256: 'b'.repeat(64),
  byteSize: 1234,
  pageCount: 2,
  createdAt: '2026-11-08T04:00:00.000Z',
  blobKey: 'blob-1',
}

const noop = (): void => undefined
const saveBinding = async (): Promise<SaveBindingOutcome> => ({ ok: true })

/** 两页故意使用不同尺寸：旧页 600×800，新页 1000×400。 */
const PAGE_VIEWS: Record<number, readonly [number, number, number, number]> = {
  1: [0, 0, 600, 800],
  2: [0, 0, 1000, 400],
}

function fakeViewport(
  pageNumber: number,
  scale: number,
  rotation: number,
): RenderViewport {
  if (rotation !== 0) {
    throw new Error('本组假 viewport 只覆盖 rotation=0')
  }
  const [x0, y0, x1, y1] = PAGE_VIEWS[pageNumber]
  return {
    width: (x1 - x0) * scale,
    height: (y1 - y0) * scale,
    convertToPdfPoint: (cssX, cssY) =>
      [x0 + cssX / scale, y1 - cssY / scale] as const,
    convertToViewportPoint: (pdfX, pdfY) =>
      [(pdfX - x0) * scale, (y1 - pdfY) * scale] as const,
  }
}

function fakePage(pageNumber: number): PdfRenderPageLike {
  return {
    view: PAGE_VIEWS[pageNumber],
    getViewport: ({ scale, rotation }) =>
      fakeViewport(pageNumber, scale, rotation),
    render: () => {
      throw new Error('本测试不应调用真实 page.render')
    },
  }
}

function fakeOpened(
  getPage: (pageNumber: number) => Promise<PdfRenderPageLike>,
): OpenedPdf {
  return {
    document: { numPages: 2, getPage },
    destroy: async () => undefined,
  }
}

/** jsdom 无 canvas 2D 上下文；只补齐“绘制完成”这一 seam。 */
const recordOnlyRender: RenderPdfPage = (_page, canvas, viewport) => {
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`
  return { promise: Promise.resolve(), cancel: () => undefined }
}

const stableLoadBytes = async (): Promise<Uint8Array> =>
  new Uint8Array([1, 2, 3, 4])

function viewerProps(overrides: Partial<PdfViewerProps>): PdfViewerProps {
  return {
    revision,
    bindings: [],
    selectedTermId: 't-h',
    page: 1,
    zoom: 1,
    rotation: 0,
    onPageChange: noop,
    onZoomChange: noop,
    onRotationChange: noop,
    onSaveBinding: saveBinding,
    loadBytes: stableLoadBytes,
    renderPage: recordOnlyRender,
    ...overrides,
  }
}

function stubBounds(
  surface: HTMLElement,
  width: number,
  height: number,
): void {
  surface.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
}

function stubSurfaceBounds(surface: HTMLElement): void {
  stubBounds(
    surface,
    Number.parseFloat(surface.style.width),
    Number.parseFloat(surface.style.height),
  )
}

function dragOnSurface(
  surface: HTMLElement,
  from: readonly [number, number],
  to: readonly [number, number],
): void {
  fireEvent.mouseDown(surface, {
    button: 0,
    clientX: from[0],
    clientY: from[1],
  })
  fireEvent.mouseMove(window, { clientX: to[0], clientY: to[1] })
  fireEvent.mouseUp(window, { clientX: to[0], clientY: to[1] })
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('PdfViewer：切页期间禁止错页框选与保存', () => {
  it('两页尺寸不同且新页 getPage 延迟：旧页不可框选，新页画完才按新页边界保存', async () => {
    const pageTwo = deferred<PdfRenderPageLike>()
    const openPdf = async () =>
      fakeOpened((pageNumber) =>
        pageNumber === 2 ? pageTwo.promise : Promise.resolve(fakePage(1)),
      )
    const onSaveBinding = vi.fn<
      (input: SaveBindingInput) => Promise<SaveBindingOutcome>
    >(async () => ({ ok: true }))

    const view = render(
      <PdfViewer
        {...viewerProps({
          openPdf,
          onSaveBinding,
        })}
      />,
    )

    // 第 1 页画完才出现可交互 surface。
    const pageOneSurface = await screen.findByTestId('pdf-surface')
    expect(
      screen.getByRole('img', { name: '装配图.pdf 第 1 页' }),
    ).toBeInTheDocument()
    stubSurfaceBounds(pageOneSurface)
    dragOnSurface(pageOneSurface, [50, 60], [250, 460])
    expect(await screen.findByTestId('pdf-draft-rect')).toBeInTheDocument()

    // 切到第 2 页：getPage 未返回前，旧 surface 必须消失且不能再框选。
    view.rerender(
      <PdfViewer
        {...viewerProps({
          page: 2,
          openPdf,
          onSaveBinding,
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.queryByTestId('pdf-surface')).toBeNull()
    })
    expect(screen.getByTestId('pdf-switching')).toHaveTextContent(
      '正在渲染第 2 页',
    )
    expect(screen.queryByTestId('pdf-draft-rect')).toBeNull()

    const hiddenStage = document.querySelector('.pdf-surface')
    expect(hiddenStage).not.toBeNull()
    // 即使给旧页容器一个可测量的 600×800 边界，它在切页中也不可框选。
    stubBounds(hiddenStage as HTMLElement, 600, 800)
    dragOnSurface(hiddenStage as HTMLElement, [700, 50], [900, 150])
    expect(screen.queryByTestId('pdf-draft-rect')).toBeNull()

    const saveButton = screen.getByRole('button', { name: '保存来源绑定' })
    expect(saveButton).toBeDisabled()
    fireEvent.click(saveButton)
    expect(onSaveBinding).not.toHaveBeenCalled()

    // 第 2 页真正画完后恢复交互，并使用第 2 页自己的 page.view 校验。
    await act(async () => {
      pageTwo.resolve(fakePage(2))
      await pageTwo.promise
    })
    const pageTwoSurface = await screen.findByTestId('pdf-surface')
    expect(
      screen.getByRole('img', { name: '装配图.pdf 第 2 页' }),
    ).toBeInTheDocument()
    expect(pageTwoSurface.style.width).toBe('1000px')
    expect(pageTwoSurface.style.height).toBe('400px')
    stubSurfaceBounds(pageTwoSurface)

    // 这个框选矩形超出旧页 600×800 的 x 范围，只有新页 1000×400 才合法。
    dragOnSurface(pageTwoSurface, [700, 50], [900, 150])
    const savePageTwo = screen.getByRole('button', { name: '保存来源绑定' })
    await waitFor(() => expect(savePageTwo).toBeEnabled())
    fireEvent.click(savePageTwo)

    await waitFor(() => expect(onSaveBinding).toHaveBeenCalledTimes(1))
    const saved = onSaveBinding.mock.calls[0][0]
    expect(saved.page).toBe(2)
    expect(saved.pageBoxPdf).toEqual([0, 0, 1000, 400])
    expect(saved.rectPdf[0]).toBeCloseTo(700, 6)
    expect(saved.rectPdf[1]).toBeCloseTo(250, 6)
    expect(saved.rectPdf[2]).toBeCloseTo(900, 6)
    expect(saved.rectPdf[3]).toBeCloseTo(350, 6)
  })

  it('延迟 getPage 期间旧页已框好的区域被清掉，不会带着草稿进入新页', async () => {
    const pageTwo = deferred<PdfRenderPageLike>()
    const openPdf = async () =>
      fakeOpened((pageNumber) =>
        pageNumber === 2 ? pageTwo.promise : Promise.resolve(fakePage(1)),
      )
    const onSaveBinding = vi.fn<
      (input: SaveBindingInput) => Promise<SaveBindingOutcome>
    >(async () => ({ ok: true }))

    const view = render(
      <PdfViewer {...viewerProps({ openPdf, onSaveBinding })} />,
    )
    const pageOneSurface = await screen.findByTestId('pdf-surface')
    stubSurfaceBounds(pageOneSurface)
    dragOnSurface(pageOneSurface, [50, 60], [250, 460])
    expect(await screen.findByTestId('pdf-draft-rect')).toBeInTheDocument()

    view.rerender(
      <PdfViewer
        {...viewerProps({ page: 2, openPdf, onSaveBinding })}
      />,
    )
    await waitFor(() => {
      expect(screen.queryByTestId('pdf-surface')).toBeNull()
    })
    // 旧页草稿在新页等待期间已经不存在，保存按钮也不可用。
    expect(screen.queryByTestId('pdf-draft-rect')).toBeNull()
    expect(
      screen.getByRole('button', { name: '保存来源绑定' }),
    ).toBeDisabled()

    await act(async () => {
      pageTwo.resolve(fakePage(2))
      await pageTwo.promise
    })
    await screen.findByTestId('pdf-surface')
    expect(screen.queryByTestId('pdf-draft-rect')).toBeNull()
    expect(
      screen.getByRole('button', { name: '保存来源绑定' }),
    ).toBeDisabled()
    expect(onSaveBinding).not.toHaveBeenCalled()
  })

  it('getPage 失败时保持不可交互并显示可见错误，不退回旧页也不保存', async () => {
    const pageTwo = deferred<PdfRenderPageLike>()
    const openPdf = async () =>
      fakeOpened((pageNumber) =>
        pageNumber === 2 ? pageTwo.promise : Promise.resolve(fakePage(1)),
      )
    const onSaveBinding = vi.fn<
      (input: SaveBindingInput) => Promise<SaveBindingOutcome>
    >(async () => ({ ok: true }))

    const view = render(
      <PdfViewer {...viewerProps({ openPdf, onSaveBinding })} />,
    )
    const pageOneSurface = await screen.findByTestId('pdf-surface')
    stubSurfaceBounds(pageOneSurface)
    dragOnSurface(pageOneSurface, [50, 60], [250, 460])
    expect(await screen.findByTestId('pdf-draft-rect')).toBeInTheDocument()

    view.rerender(
      <PdfViewer
        {...viewerProps({ page: 2, openPdf, onSaveBinding })}
      />,
    )
    await waitFor(() => {
      expect(screen.queryByTestId('pdf-surface')).toBeNull()
    })

    await act(async () => {
      pageTwo.reject(new Error('模拟第 2 页读取失败'))
      await pageTwo.promise.catch(() => undefined)
    })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('PDF 页面渲染失败')
    expect(alert.textContent).toContain('模拟第 2 页读取失败')
    // 失败后不能退回第 1 页的画面。
    expect(screen.queryByTestId('pdf-surface')).toBeNull()
    expect(screen.queryByTestId('pdf-draft-rect')).toBeNull()
    expect(screen.queryByTestId('pdf-switching')).toBeNull()
    expect(
      screen.getByRole('button', { name: '保存来源绑定' }),
    ).toBeDisabled()
    expect(onSaveBinding).not.toHaveBeenCalled()
  })
})

describe('PdfViewer：可见错误与确切版本提示', () => {
  it('损坏字节渲染失败时显示可见错误，而不是空白画布', async () => {
    render(
      <PdfViewer
        revision={revision}
        bindings={[]}
        selectedTermId="t-h"
        page={1}
        zoom={1}
        rotation={0}
        onPageChange={noop}
        onZoomChange={noop}
        onRotationChange={noop}
        onSaveBinding={saveBinding}
        loadBytes={async () => new Uint8Array([1, 2, 3, 4, 5])}
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('PDF 无法渲染')
    expect(alert.textContent).toContain('不是可解析的 PDF')
  })

  it('密码保护文件显示明确提示，不请求密码', async () => {
    render(
      <PdfViewer
        revision={revision}
        bindings={[]}
        selectedTermId="t-h"
        page={1}
        zoom={1}
        rotation={0}
        onPageChange={noop}
        onZoomChange={noop}
        onRotationChange={noop}
        onSaveBinding={saveBinding}
        loadBytes={async () => buildSyntheticPdf()}
        openPdf={async () => {
          throw new PdfInspectError(
            'password_protected',
            'PDF 受密码保护；本版本拒绝导入已加密文件，也不会请求密码',
          )
        }}
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('密码')
    expect(alert.textContent).toContain('不会请求密码')
    expect(screen.queryByLabelText('PDF 密码')).toBeNull()
  })

  it('有效 PDF 但浏览器无法创建 canvas 上下文时显示渲染失败原因', async () => {
    render(
      <PdfViewer
        revision={revision}
        bindings={[]}
        selectedTermId="t-h"
        page={2}
        zoom={2}
        rotation={270}
        onPageChange={noop}
        onZoomChange={noop}
        onRotationChange={noop}
        onSaveBinding={saveBinding}
        loadBytes={async () => buildSyntheticPdf({ pageCount: 2 })}
      />,
    )

    await waitFor(() => {
      const alerts = screen.queryAllByRole('alert')
      expect(
        alerts.some((alert) => alert.textContent?.includes('canvas 2D 上下文')),
        alerts.map((alert) => alert.textContent).join(' | '),
      ).toBe(true)
    })
    // 工具栏和确切版本说明仍然可见，方便用户判断打开的是哪个版本。
    expect(screen.getByLabelText('页码跳转')).toHaveValue(2)
    expect(screen.getByText(/打开的是这个确切版本/)).toBeInTheDocument()
    expect(screen.getByText(/未命名版本/)).toBeInTheDocument()
    expect(screen.queryByText(/rev-exac/)).not.toBeInTheDocument()
  })
})
