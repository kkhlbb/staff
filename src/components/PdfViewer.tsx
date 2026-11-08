/**
 * 本地 PDF 查看器：加载不可变 revision 对应的 Blob，渲染指定页，叠加已保存的
 * 来源区域，并允许在当前页框选新区域。
 *
 * 坐标约定：框选时用 getBoundingClientRect() 把鼠标位置按比例映射为 viewport
 * CSS 坐标，再用 convertToPdfPoint 存 PDF 点；显示时用 convertToViewportPoint
 * 还原。缩放与旋转只会重建 viewport，不改动已存矩形。
 */
import { useEffect, useRef, useState } from 'react'
import type { SourceBinding } from '../sources/bindings'
import {
  normalizePdfPageBox,
  validatePdfRect,
  type PdfPageBox,
  type PdfRect,
} from '../sources/pdfCoordinates'
import { PdfInspectError } from '../sources/pdfInspect'
import {
  openPdfForRendering,
  renderPageToCanvas,
  type OpenedPdf,
  type PdfRenderTaskLike,
  type RenderViewport,
} from '../sources/render'
import { readSourceBlobBytes } from '../sources/revisions'
import type { SourceRevision } from '../sources/types'
import { PdfPageSurface, type PdfPageHighlight } from './PdfPageSurface'

export type LoadRevisionBytes = (
  revision: SourceRevision,
) => Promise<Uint8Array | null>

export interface SaveBindingInput {
  page: number
  rectPdf: PdfRect
  pageBoxPdf: PdfPageBox
  note: string
}

export interface SaveBindingOutcome {
  ok: boolean
  message?: string
}

export interface PdfViewerProps {
  revision: SourceRevision
  bindings: readonly SourceBinding[]
  selectedTermId: string | null
  page: number
  zoom: number
  rotation: number
  onPageChange: (page: number) => void
  onZoomChange: (zoom: number) => void
  onRotationChange: (rotation: number) => void
  onSaveBinding: (input: SaveBindingInput) => Promise<SaveBindingOutcome>
  /** 测试或特殊环境注入字节读取；默认从 IndexedDB sourceBlobs 读取。 */
  loadBytes?: LoadRevisionBytes
  /** 测试注入：打开 PDF；默认使用项目内 pdfjs-dist。 */
  openPdf?: (bytes: Uint8Array) => Promise<OpenedPdf>
}

async function defaultLoadBytes(
  revision: SourceRevision,
): Promise<Uint8Array | null> {
  const result = await readSourceBlobBytes(revision.blobKey)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.value
}

function errorMessage(error: unknown): string {
  if (error instanceof PdfInspectError) {
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

function isRenderingCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'RenderingCancelledException'
  )
}

const ZOOM_OPTIONS = [1, 2] as const
const ROTATION_OPTIONS = [0, 90, 180, 270] as const

export function PdfViewer({
  revision,
  bindings,
  selectedTermId,
  page,
  zoom,
  rotation,
  onPageChange,
  onZoomChange,
  onRotationChange,
  onSaveBinding,
  loadBytes,
  openPdf,
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [opened, setOpened] = useState<OpenedPdf | null>(null)
  const [documentPageCount, setDocumentPageCount] = useState(revision.pageCount)
  const [viewport, setViewport] = useState<RenderViewport | null>(null)
  const [pageBoxPdf, setPageBoxPdf] = useState<PdfPageBox | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [draftRect, setDraftRect] = useState<PdfRect | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  // 打开附件时需要在“ready”首帧就拿到 viewport，否则 canvas 尚未挂载，
  // 渲染任务会找不到画布。这里用 ref 读取当前页码/缩放/旋转，不把打开
  // 附件与每次缩放绑定到同一个 effect。
  const viewParamsRef = useRef({ page, zoom, rotation })
  useEffect(() => {
    viewParamsRef.current = { page, zoom, rotation }
  }, [page, zoom, rotation])

  // 测试注入的 openPdf 可能是内联函数；用 ref 保存，避免每次渲染重开附件。
  const openPdfRef = useRef(openPdf)
  useEffect(() => {
    openPdfRef.current = openPdf
  }, [openPdf])

  // 切换附件 / 页码时清掉未保存的框选，避免把上一页区域误存到新页。
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) {
        return
      }
      setDraftRect(null)
      setNote('')
      setSaveError(null)
      setSaveMessage(null)
    })
    return () => {
      cancelled = true
    }
  }, [revision.id, page])

  useEffect(() => {
    let cancelled = false

    const open = async (): Promise<void> => {
      await Promise.resolve()
      if (cancelled) {
        return
      }
      setStatus('loading')
      setLoadError(null)
      setOpened(null)
      setViewport(null)

      const loader = loadBytes ?? defaultLoadBytes
      let bytes: Uint8Array | null
      try {
        bytes = await loader(revision)
      } catch (error) {
        if (!cancelled) {
          setStatus('error')
          setLoadError(`读取本地附件失败：${errorMessage(error)}`)
        }
        return
      }
      if (cancelled) {
        return
      }
      if (bytes === null || bytes.byteLength === 0) {
        setStatus('error')
        setLoadError('本地附件不可用：IndexedDB 中没有这个版本的 PDF 字节。')
        return
      }

      try {
        const result = await (openPdfRef.current ?? openPdfForRendering)(bytes)
        if (cancelled) {
          await result.destroy()
          return
        }
        const params = viewParamsRef.current
        const firstPage = await result.document.getPage(params.page)
        if (cancelled) {
          await result.destroy()
          return
        }
        const firstViewport = firstPage.getViewport({
          scale: params.zoom,
          rotation: params.rotation,
        })
        const pageBox = normalizePdfPageBox(firstPage.view)
        if (pageBox === null) {
          await result.destroy()
          throw new PdfInspectError('invalid_pdf', '页面边界框无效，无法框选来源区域')
        }
        setViewport(firstViewport)
        setPageBoxPdf(pageBox)
        setDocumentPageCount(result.document.numPages)
        setOpened(result)
        setStatus('ready')
      } catch (error) {
        if (!cancelled) {
          setStatus('error')
          setLoadError(`PDF 无法渲染：${errorMessage(error)}`)
        }
      }
    }

    void open()
    return () => {
      cancelled = true
    }
  }, [revision, loadBytes])

  // opened 变化后释放加载任务与 worker 资源。
  useEffect(() => {
    if (opened === null) {
      return
    }
    return () => {
      void opened.destroy()
    }
  }, [opened])

  useEffect(() => {
    if (opened === null) {
      return
    }
    let cancelled = false
    let task: PdfRenderTaskLike | null = null

    const render = async (): Promise<void> => {
      try {
        const pdfPage = await opened.document.getPage(page)
        if (cancelled) {
          return
        }
        const nextViewport = pdfPage.getViewport({ scale: zoom, rotation })
        const pageBox = normalizePdfPageBox(pdfPage.view)
        if (pageBox === null) {
          setRenderError('页面边界框无效，无法框选来源区域')
          return
        }
        setViewport(nextViewport)
        setPageBoxPdf(pageBox)
        setRenderError(null)

        const canvas = canvasRef.current
        if (canvas === null) {
          return
        }
        const outputScale =
          typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
        task = renderPageToCanvas(pdfPage, canvas, nextViewport, outputScale)
        await task.promise
      } catch (error) {
        if (!cancelled && !isRenderingCancelled(error)) {
          setRenderError(`PDF 页面渲染失败：${errorMessage(error)}`)
        }
      }
    }

    void render()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [opened, page, zoom, rotation])

  const pageCount = Math.min(documentPageCount, revision.pageCount)
  const clampedPage = Math.min(Math.max(page, 1), Math.max(pageCount, 1))

  const highlights: PdfPageHighlight[] = bindings
    .filter(
      (binding) =>
        binding.revisionId === revision.id && binding.page === clampedPage,
    )
    .map((binding) => ({
      id: binding.id,
      rectPdf: binding.rectPdf,
      label: binding.note.trim() === '' ? '来源区域' : binding.note,
      active: binding.termId === selectedTermId,
    }))

  const handleSave = async (): Promise<void> => {
    setSaveError(null)
    setSaveMessage(null)
    if (selectedTermId === null) {
      setSaveError('先在组成环表中选中一行，再保存来源绑定。')
      return
    }
    if (draftRect === null) {
      setSaveError('请先在页面上框选一块区域。')
      return
    }
    if (pageBoxPdf === null) {
      setSaveError('页面边界尚未加载完成，暂时不能保存。')
      return
    }
    // 越界/空区域在这里再次拒绝，不依赖存储层兜底。
    const regionError = validatePdfRect(draftRect, pageBoxPdf)
    if (regionError !== null) {
      setSaveError(`不能保存：${regionError}`)
      return
    }

    setSaving(true)
    const outcome = await onSaveBinding({
      page: clampedPage,
      rectPdf: draftRect,
      pageBoxPdf,
      note,
    })
    setSaving(false)
    if (!outcome.ok) {
      setSaveError(outcome.message ?? '保存来源绑定失败')
      return
    }
    setDraftRect(null)
    setNote('')
    setSaveMessage('已保存来源绑定；数值仍以组成环输入为准，绑定不会自动提取数值。')
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer__toolbar">
        <button
          type="button"
          aria-label="上一页"
          disabled={clampedPage <= 1}
          onClick={() => onPageChange(clampedPage - 1)}
        >
          上一页
        </button>
        <label className="pdf-viewer__page-field">
          页码跳转
          <input
            type="number"
            aria-label="页码跳转"
            min={1}
            max={pageCount}
            value={clampedPage}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isInteger(next) && next >= 1 && next <= pageCount) {
                onPageChange(next)
              }
            }}
          />
        </label>
        <span className="pdf-viewer__page-count">共 {pageCount} 页</span>
        <button
          type="button"
          aria-label="下一页"
          disabled={clampedPage >= pageCount}
          onClick={() => onPageChange(clampedPage + 1)}
        >
          下一页
        </button>

        <label className="pdf-viewer__select">
          缩放
          <select
            aria-label="缩放"
            value={zoom}
            onChange={(event) => onZoomChange(Number(event.target.value))}
          >
            {ZOOM_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option * 100}%
              </option>
            ))}
          </select>
        </label>
        <label className="pdf-viewer__select">
          旋转
          <select
            aria-label="旋转"
            value={rotation}
            onChange={(event) => onRotationChange(Number(event.target.value))}
          >
            {ROTATION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}°
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="pdf-viewer__file">
        {revision.fileName} · v{revision.id.slice(0, 8)} · SHA-256{' '}
        {revision.sha256.slice(0, 12)}… · 打开的是这个确切版本，不跟随同名最新版
      </p>

      {status === 'loading' ? (
        <p className="pdf-viewer__status" role="status">
          正在读取本地附件并渲染…
        </p>
      ) : null}
      {loadError !== null ? (
        <p className="pdf-viewer__error" role="alert">
          {loadError}
        </p>
      ) : null}
      {renderError !== null ? (
        <p className="pdf-viewer__error" role="alert">
          {renderError}
        </p>
      ) : null}

      {status === 'ready' && viewport !== null ? (
        <div className="pdf-viewer__stage">
          <PdfPageSurface
            viewport={viewport}
            canvasRef={canvasRef}
            highlights={highlights}
            draftRectPdf={draftRect}
            onDraftChange={(rect) => setDraftRect(rect)}
            ariaLabel={`${revision.fileName} 第 ${clampedPage} 页`}
            disabled={selectedTermId === null}
          />
          <p className="pdf-viewer__hint">
            在页面上按住鼠标拖动框选区域。高亮使用 PDF 坐标保存，缩放或旋转后仍指向同一块内容。
          </p>
          <div className="pdf-viewer__binding-form">
            <label className="pdf-viewer__note">
              来源备注
              <input
                type="text"
                aria-label="来源备注"
                value={note}
                placeholder="例如：第 2 页孔公差框"
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={
                saving || selectedTermId === null || draftRect === null
              }
            >
              {saving ? '保存中…' : '保存来源绑定'}
            </button>
          </div>
          {selectedTermId === null ? (
            <p className="pdf-viewer__hint">
              先在组成环表中选中一行，才能把框选区域绑定到该环。
            </p>
          ) : null}
          {saveError !== null ? (
            <p className="pdf-viewer__error" role="alert">
              {saveError}
            </p>
          ) : null}
          {saveMessage !== null ? (
            <p className="pdf-viewer__message" role="status">
              {saveMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
