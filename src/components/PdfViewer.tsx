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
  type PdfRenderPageLike,
  type PdfRenderTaskLike,
  type RenderViewport,
} from '../sources/render'
import { readSourceBlobBytes } from '../sources/revisions'
import type { SourceRevision } from '../sources/types'
import { useDatabaseStaleVersion } from '../storage/databaseStale'
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

/**
 * 一页“已经画完”的身份与几何。只有它和当前 revision/page/zoom/rotation
 * 完全一致时，页面才允许框选，保存也只使用这里的 pageBoxPdf。
 */
interface RenderedSurface {
  /** `${revisionId}::${page}::${zoom}::${rotation}`；与当前请求不一致即不可交互。 */
  key: string
  revisionId: string
  page: number
  zoom: number
  rotation: number
  viewport: RenderViewport
  pageBoxPdf: PdfPageBox
}

/** 测试注入：把 PDF 页绘制到 canvas；默认使用项目内 pdfjs-dist。 */
export type RenderPdfPage = (
  page: PdfRenderPageLike,
  canvas: HTMLCanvasElement,
  viewport: RenderViewport,
  outputScale?: number,
) => PdfRenderTaskLike

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
  /** 编辑已有绑定时的按钮文案；默认“保存来源绑定”。 */
  saveButtonLabel?: string
  /** 编辑已有绑定时的成功提示；默认说明数值仍以组成环输入为准。 */
  saveSuccessMessage?: string
  /** 测试或特殊环境注入字节读取；默认从 IndexedDB sourceBlobs 读取。 */
  loadBytes?: LoadRevisionBytes
  /** 测试注入：打开 PDF；默认使用项目内 pdfjs-dist。 */
  openPdf?: (bytes: Uint8Array) => Promise<OpenedPdf>
  /** 测试注入：绘制页面；默认使用项目内 pdfjs-dist。 */
  renderPage?: RenderPdfPage
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
  saveButtonLabel,
  saveSuccessMessage,
  loadBytes,
  openPdf,
  renderPage,
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [opened, setOpened] = useState<OpenedPdf | null>(null)
  const [documentPageCount, setDocumentPageCount] = useState(revision.pageCount)
  /**
   * 最近一次真正画完的页面。只有 key 与当前 requestKey 完全一致时才会交给
   * 页面层、用于框选与保存；切页/缩放/旋转后旧 surface 立即失配且不可达。
   */
  const [surface, setSurface] = useState<RenderedSurface | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<{
    key: string
    message: string
  } | null>(null)
  const [draftRect, setDraftRect] = useState<PdfRect | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const editingDisabled = useDatabaseStaleVersion() !== null
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  // 测试注入的 openPdf 可能是内联函数；用 ref 保存，避免每次渲染重开附件。
  const openPdfRef = useRef(openPdf)
  useEffect(() => {
    openPdfRef.current = openPdf
  }, [openPdf])

  // 测试注入的 renderPage 同理；默认用项目内 pdfjs-dist 绘制。
  const renderPageRef = useRef(renderPage)
  useEffect(() => {
    renderPageRef.current = renderPage
  }, [renderPage])

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
      setSurface(null)
      setRenderError(null)

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
        // 不预先 setSurface：当前页由下面的渲染 effect 负责。只有 getPage、
        // viewport/page.view 与 canvas 绘制都成功后，才发布可交互的 surface。
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

  const pageCount = Math.min(documentPageCount, revision.pageCount)
  const clampedPage = Math.min(Math.max(page, 1), Math.max(pageCount, 1))
  const requestKey = `${revision.id}::${clampedPage}::${zoom}::${rotation}`

  // 页面渲染 effect：只有这一页真正画完，才发布与 requestKey 绑定的 surface。
  // 切页/缩放/旋转开始后，旧 surface 的 key 与当前 requestKey 不一致，因此旧
  // viewport 不会传给页面、旧 pageBoxPdf 也不会用于校验或保存。
  useEffect(() => {
    if (opened === null) {
      return
    }
    let cancelled = false
    let task: PdfRenderTaskLike | null = null

    const render = async (): Promise<void> => {
      try {
        const pdfPage = await opened.document.getPage(clampedPage)
        if (cancelled) {
          return
        }
        const nextViewport = pdfPage.getViewport({ scale: zoom, rotation })
        const pageBox = normalizePdfPageBox(pdfPage.view)
        if (pageBox === null) {
          if (!cancelled) {
            setSurface(null)
            setRenderError({
              key: requestKey,
              message: '页面边界框无效，无法框选来源区域',
            })
          }
          return
        }

        const canvas = canvasRef.current
        if (canvas === null) {
          if (!cancelled) {
            setSurface(null)
            setRenderError({
              key: requestKey,
              message: '页面画布尚未挂载，暂时不能框选。',
            })
          }
          return
        }
        const outputScale =
          typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
        const draw = renderPageRef.current ?? renderPageToCanvas
        task = draw(pdfPage, canvas, nextViewport, outputScale)
        await task.promise
        if (cancelled) {
          return
        }
        // 像素绘制完成，才发布与本次 page/zoom/rotation 完全绑定的 surface。
        setSurface({
          key: requestKey,
          revisionId: revision.id,
          page: clampedPage,
          zoom,
          rotation,
          viewport: nextViewport,
          pageBoxPdf: pageBox,
        })
        setRenderError(null)
      } catch (error) {
        if (!cancelled && !isRenderingCancelled(error)) {
          setSurface(null)
          setRenderError({
            key: requestKey,
            message: `PDF 页面渲染失败：${errorMessage(error)}`,
          })
        }
      }
    }

    void render()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [opened, clampedPage, requestKey, zoom, rotation, revision.id])

  // 身份 + 绘制状态必须同时匹配；key 不一致时旧 viewport/pageBoxPdf 不可达。
  const surfaceReady =
    surface !== null &&
    surface.key === requestKey &&
    surface.revisionId === revision.id &&
    surface.page === clampedPage &&
    surface.zoom === zoom &&
    surface.rotation === rotation
  const activeRenderError =
    renderError !== null && renderError.key === requestKey
      ? renderError.message
      : null

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
    if (!surfaceReady || surface === null) {
      setSaveError('页面正在切换或尚未绘制完成，恢复前不能保存来源绑定。')
      return
    }
    if (selectedTermId === null) {
      setSaveError('先在组成环表中选中一行，再保存来源绑定。')
      return
    }
    if (draftRect === null) {
      setSaveError('请先在页面上框选一块区域。')
      return
    }
    // 越界/空区域在这里再次拒绝，不依赖存储层兜底。边界只能取自已经画完、
    // 且与当前页身份一致的 surface，不能用切页前的旧 pageBoxPdf。
    const regionError = validatePdfRect(draftRect, surface.pageBoxPdf)
    if (regionError !== null) {
      setSaveError(`不能保存：${regionError}`)
      return
    }

    setSaving(true)
    const outcome = await onSaveBinding({
      page: surface.page,
      rectPdf: draftRect,
      pageBoxPdf: surface.pageBoxPdf,
      note,
    })
    setSaving(false)
    if (!outcome.ok) {
      setSaveError(outcome.message ?? '保存来源绑定失败')
      return
    }
    setDraftRect(null)
    setNote('')
    setSaveMessage(
      saveSuccessMessage ??
        '已保存来源绑定；数值仍以组成环输入为准，绑定不会自动提取数值。',
    )
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
      {activeRenderError !== null ? (
        <p className="pdf-viewer__error" role="alert">
          {activeRenderError}
        </p>
      ) : null}

      {status === 'ready' && opened !== null ? (
        <div className="pdf-viewer__stage">
          <PdfPageSurface
            viewport={surfaceReady && surface !== null ? surface.viewport : null}
            canvasRef={canvasRef}
            highlights={surfaceReady ? highlights : []}
            draftRectPdf={surfaceReady ? draftRect : null}
            onDraftChange={(rect) => setDraftRect(rect)}
            ariaLabel={`${revision.fileName} 第 ${clampedPage} 页`}
            disabled={
              !surfaceReady || selectedTermId === null || editingDisabled
            }
          />
          {!surfaceReady && activeRenderError === null ? (
            <p
              className="pdf-viewer__status"
              role="status"
              data-testid="pdf-switching"
            >
              正在渲染第 {clampedPage} 页；完成前不能框选或保存。
            </p>
          ) : null}
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
                disabled={editingDisabled}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={
                saving ||
                editingDisabled ||
                !surfaceReady ||
                selectedTermId === null ||
                draftRect === null
              }
            >
              {saving ? '保存中…' : (saveButtonLabel ?? '保存来源绑定')}
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
