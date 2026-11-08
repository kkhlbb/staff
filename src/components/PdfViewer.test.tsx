// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PdfInspectError } from '../sources/pdfInspect'
import type { SourceRevision } from '../sources/types'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import { PdfViewer, type SaveBindingOutcome } from './PdfViewer'

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
    expect(screen.getByText(/rev-exac/)).toBeInTheDocument()
  })
})
