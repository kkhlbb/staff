/**
 * PDF.js 渲染适配层（V2.1 第二组）。
 *
 * - worker 从项目内的 pdfjs-dist 6.5.438 打包，由 ?url 导入后交给
 *   GlobalWorkerOptions.workerSrc；不访问 CDN，避免 API 与 worker 版本不一致。
 *   本模块被应用 UI 引用，因此 worker 会进入常规 `npm run build` 产物。
 * - 只读取 Blob 字节并渲染到 canvas；不执行 PDF 内嵌脚本、不提交表单、
 *   不自动打开链接，也不把文件上传到任何服务器。
 * - 加密/损坏/无法创建 canvas 都抛出明确错误；调用方必须把错误显示给用户。
 */
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PageViewportLike } from './pdfCoordinates'
import { PdfInspectError, toPdfInspectError } from './pdfInspect'

// Vitest 的 jsdom/Node 环境没有可用 Worker，交给 PDF.js fake worker；
// 浏览器构建始终使用同一份项目内 worker。
if (import.meta.env.MODE !== 'test') {
  GlobalWorkerOptions.workerSrc = workerUrl
}

export interface RenderViewport extends PageViewportLike {
  width: number
  height: number
}

export interface PdfRenderTaskLike {
  promise: Promise<void>
  cancel: () => void
}

export interface PdfRenderPageLike {
  /** 未旋转页面边界框 page.view，通常是 [x0, y0, x1, y1]，原点可非零。 */
  view: readonly number[]
  getViewport: (params: { scale: number; rotation: number }) => RenderViewport
  render: (params: {
    canvasContext: CanvasRenderingContext2D
    viewport: RenderViewport
    transform?: number[]
  }) => PdfRenderTaskLike
}

export interface PdfRenderDocumentLike {
  numPages: number
  getPage: (pageNumber: number) => Promise<PdfRenderPageLike>
}

export interface PdfLoadingTaskLike {
  promise: Promise<PdfRenderDocumentLike>
  destroy: () => Promise<void>
}

export interface PdfRenderModuleLike {
  getDocument: (params: { data: Uint8Array }) => PdfLoadingTaskLike
}

export interface OpenedPdf {
  document: PdfRenderDocumentLike
  /** 取消加载并释放 worker 资源；页面卸载必须调用。 */
  destroy: () => Promise<void>
}

const defaultPdfModule: PdfRenderModuleLike = {
  // pdfjs-dist 的 PDFDocumentProxy/PDFPageProxy 在结构上与这里的窄接口一致；
  // 类型包声明依赖 DOM 与内部类，这里做一次边界转换，运行期行为不变。
  getDocument: (params) => getDocument(params) as unknown as PdfLoadingTaskLike,
}

/**
 * 打开 PDF 供渲染。字节会复制一份交给 PDF.js，因为加载过程可能把
 * ArrayBuffer transfer 给 worker，调用方之后仍需要用原字节校验哈希。
 */
export async function openPdfForRendering(
  bytes: Uint8Array,
  module: PdfRenderModuleLike = defaultPdfModule,
): Promise<OpenedPdf> {
  if (bytes.byteLength === 0) {
    throw new PdfInspectError('invalid_pdf', '文件为空，无法渲染')
  }

  let task: PdfLoadingTaskLike
  try {
    task = module.getDocument({ data: new Uint8Array(bytes) })
  } catch (error) {
    throw toPdfInspectError(error)
  }

  try {
    const document = await task.promise
    if (!Number.isInteger(document.numPages) || document.numPages < 1) {
      throw new PdfInspectError('invalid_pdf', 'PDF 没有可读取的页面')
    }
    return {
      document,
      destroy: async () => {
        await task.destroy().catch(() => undefined)
      },
    }
  } catch (error) {
    await task.destroy().catch(() => undefined)
    throw toPdfInspectError(error)
  }
}

/**
 * 把一页 PDF 画到 canvas。
 *
 * canvas 的内部像素尺寸乘以 outputScale（通常为 devicePixelRatio），
 * CSS 尺寸保持 viewport 的 CSS 像素；因此指针坐标必须用
 * getBoundingClientRect() 比例映射，不能拿 canvas.width / event.offsetX 当坐标。
 */
export function renderPageToCanvas(
  page: PdfRenderPageLike,
  canvas: HTMLCanvasElement,
  viewport: RenderViewport,
  outputScale = 1,
): PdfRenderTaskLike {
  const context = canvas.getContext('2d')
  if (context === null) {
    throw new PdfInspectError(
      'pdf_inspect_failed',
      '浏览器无法创建 canvas 2D 上下文，PDF 无法渲染',
    )
  }
  if (!Number.isFinite(outputScale) || outputScale <= 0) {
    throw new Error('outputScale 必须是正数')
  }

  const pixelWidth = Math.max(1, Math.floor(viewport.width * outputScale))
  const pixelHeight = Math.max(1, Math.floor(viewport.height * outputScale))
  canvas.width = pixelWidth
  canvas.height = pixelHeight
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`

  const transform =
    outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]

  return page.render({
    canvasContext: context,
    viewport,
    ...(transform === undefined ? {} : { transform }),
  })
}
