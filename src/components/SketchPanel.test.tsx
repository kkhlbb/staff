// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SketchPanel, type SketchPanelProps } from './SketchPanel'
import { syntheticPng } from '../sketch/__fixtures__/syntheticImage'
import type { SketchIngestValue, SnapshotDto, SourceReadValue } from '../../desktop/shared/contracts'

type SubmitResult = Awaited<ReturnType<SketchPanelProps['onSubmit']>>
type ReadResult = Awaited<ReturnType<SketchPanelProps['readAttachment']>>

const pngBytes = syntheticPng(1200, 800)

function snapshotWithImage(): SnapshotDto {
  return {
    project: { id: 'p1', updatedAt: '2026-11-13T00:00:00.000Z' },
    revisions: [{
      id: 'sr-img', projectId: 'p1', documentId: 'doc-img', fileName: 'sketch-synthetic.png',
      sha256: 'c'.repeat(64), byteSize: pngBytes.byteLength, pageCount: 1,
      createdAt: '2026-11-13T00:00:00.000Z', blobKey: 'blob-img',
    }],
    documents: [{ id: 'doc-img', projectId: 'p1', title: 'sketch-synthetic.png', latestRevisionId: 'sr-img' }],
  } as unknown as SnapshotDto
}

/** 读回 PNG 字节（通道层已保证真实哈希；这里只模拟 renderer 侧读附件）。 */
function readOk(): ReturnType<typeof vi.fn<SketchPanelProps['readAttachment']>> {
  return vi.fn<SketchPanelProps['readAttachment']>(async (): Promise<ReadResult> => ({
    ok: true,
    value: { bytes: pngBytes, sha256: 'c'.repeat(64), fileName: 'sketch-synthetic.png' } as SourceReadValue,
  }))
}

function submitOk(candidates: unknown[] = []): ReturnType<typeof vi.fn<SketchPanelProps['onSubmit']>> {
  return vi.fn<SketchPanelProps['onSubmit']>(async (): Promise<SubmitResult> => ({
    ok: true,
    value: {
      acceptedSeq: 2, draftId: 'd1', recovery: 'written',
      snapshot: snapshotWithImage(), candidates,
    } as unknown as SketchIngestValue,
  }))
}

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1200, height: 800, close: () => {} })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('草图读数面板（界面红线与提交载荷）', () => {
  it('固定写明图上不测量，且提示不支持 HEIC/超限', () => {
    render(<SketchPanel snapshot={snapshotWithImage()} disabled={false}
      onImport={vi.fn()} onSubmit={submitOk()} readAttachment={readOk()} />)
    expect(screen.getByText(/图上不测量，尺寸由你输入；框选只用来记住位置/)).toBeTruthy()
    expect(screen.getByText(/不做 OCR、不做图像识别/)).toBeTruthy()
    expect(screen.getByText(/HEIC 会提示转换命令/)).toBeTruthy()
  })

  it('没有图片时给出导入提示，导入按钮调用 main 通道', async () => {
    const onImport = vi.fn(async () => null)
    render(<SketchPanel snapshot={{ project: { id: 'p1' }, revisions: [], documents: [] } as unknown as SnapshotDto}
      disabled={false} onImport={onImport} onSubmit={submitOk()} readAttachment={readOk()} />)
    expect(screen.getByText(/还没有图片/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '导入草图图片' }))
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
  })

  it('读回图片后按原图像素显示；不框选直接填读数并存“未框选，无位置”', async () => {
    const onSubmit = submitOk([{
      provenance: [{ kind: 'agent-read', source: { kind: 'image', imageId: 'sr-img',
        sha256: 'c'.repeat(64), region: { index: 1, rect: null } } }],
      data: { symbol: 'L1' },
    }])
    render(<SketchPanel snapshot={snapshotWithImage()} disabled={false}
      onImport={vi.fn()} onSubmit={onSubmit} readAttachment={readOk()} />)
    await waitFor(() => expect(screen.getByText(/已载入 1200×800/)).toBeTruthy())
    fireEvent.change(screen.getByLabelText('符号'), { target: { value: 'L1' } })
    fireEvent.change(screen.getByLabelText('基本尺寸'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('上偏差'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('下偏差'), { target: { value: '-0.2' } })
    fireEvent.click(screen.getByRole('button', { name: '不框选，直接填读数' }))
    expect(screen.getByTestId('sketch-box-L1').textContent).toContain('未框选，无位置')
    fireEvent.click(screen.getByRole('button', { name: '提交读数（未核对）' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const payload = onSubmit.mock.calls[0]![0]
    expect(payload.source).toEqual({ kind: 'image', imageId: 'sr-img', sha256: 'c'.repeat(64) })
    expect(payload.readings[0]).toMatchObject({ symbol: 'L1', nominalQ: 300_000, lowerDeviationQ: -2000 })
    expect(payload.boxes).toEqual([{ symbol: 'L1', rect: null }])
    await waitFor(() => expect(screen.getByText(/读数未核对（来源：图片，未框选，无位置）/)).toBeTruthy())
  })

  it('在图上拖框：提交的 rect 是原图像素，不是屏幕坐标', async () => {
    const onSubmit = submitOk()
    render(<SketchPanel snapshot={snapshotWithImage()} disabled={false}
      onImport={vi.fn()} onSubmit={onSubmit} readAttachment={readOk()} />)
    await waitFor(() => expect(screen.getByText(/已载入 1200×800/)).toBeTruthy())
    const stage = screen.getByLabelText('草图框选画布')
    fireEvent.pointerDown(stage, { button: 0, clientX: 100, clientY: 60, pointerId: 1 })
    fireEvent.pointerMove(stage, { clientX: 340, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(stage, { button: 0, clientX: 340, clientY: 200, pointerId: 1 })
    fireEvent.change(screen.getByLabelText('符号'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('基本尺寸'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('上偏差'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('下偏差'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: '保存这条框选' }))
    expect(screen.getByText(/原图像素 \[100, 60, 240, 140\]/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '提交读数（未核对）' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]![0].boxes[0]!.rect).toEqual([100, 60, 240, 140])
  })

  it('提交被拒时显示 main 的原始拒绝原因，不假装成功', async () => {
    const onSubmit = vi.fn<SketchPanelProps['onSubmit']>(async (): Promise<SubmitResult> => ({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: '第 1 个框选超出图片范围（原图 1200×800 像素）' },
    }))
    render(<SketchPanel snapshot={snapshotWithImage()} disabled={false}
      onImport={vi.fn()} onSubmit={onSubmit} readAttachment={readOk()} />)
    await waitFor(() => expect(screen.getByText(/已载入 1200×800/)).toBeTruthy())
    fireEvent.change(screen.getByLabelText('符号'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('基本尺寸'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: '不框选，直接填读数' }))
    fireEvent.click(screen.getByRole('button', { name: '提交读数（未核对）' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('超出图片范围'))
  })
})
