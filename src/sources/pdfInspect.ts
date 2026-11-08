/**
 * PDF.js 本地解析适配层。
 *
 * 版本固定为 pdfjs-dist 6.5.438（精确版本，见 package.json）。worker 从项目内
 * 依赖打包，不使用 CDN，避免 API 与 worker 版本不一致。此版本没有
 * convertToViewportRectangle，坐标转换见 pdfCoordinates.ts。
 *
 * 解析只读取页数；文件字节、哈希与容量检查都在写事务之前完成。
 */
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Vitest 的 Node 环境没有可用的 Worker，pdfjs 会自动使用 fake worker；
// 此时把 workerSrc 设成 Vite 的开发 URL 反而会让 fake worker 解析失败。
// 浏览器构建（dev / production）始终使用项目内打包的同版本 worker。
if (import.meta.env.MODE !== 'test') {
  GlobalWorkerOptions.workerSrc = workerUrl
}

export type PdfFailureCode =
  | 'password_protected'
  | 'invalid_pdf'
  | 'pdf_inspect_failed'

export class PdfInspectError extends Error {
  readonly code: PdfFailureCode

  constructor(code: PdfFailureCode, message: string) {
    super(message)
    this.name = 'PdfInspectError'
    this.code = code
  }
}

export interface PdfInspectResult {
  pageCount: number
}

export interface PdfDocumentLike {
  numPages: number
}

export interface PdfLoadingTaskLike {
  promise: Promise<PdfDocumentLike>
  destroy: () => Promise<void>
}

export interface PdfModuleLike {
  getDocument: (params: { data: Uint8Array }) => PdfLoadingTaskLike
}

const defaultPdfModule: PdfModuleLike = {
  getDocument: (params) => getDocument(params),
}

function errorName(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name
    return typeof name === 'string' ? name : undefined
  }
  return undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 把 PDF.js 的加载错误映射为对用户明确的拒绝原因。
 * 不向用户请求密码，也不把加密文件当作解析成功。
 */
export function toPdfInspectError(error: unknown): PdfInspectError {
  if (error instanceof PdfInspectError) {
    return error
  }
  const name = errorName(error)
  if (name === 'PasswordException' || /password/i.test(errorMessage(error))) {
    return new PdfInspectError(
      'password_protected',
      'PDF 受密码保护；本版本拒绝导入已加密文件，也不会请求密码',
    )
  }
  if (name === 'InvalidPDFException') {
    return new PdfInspectError('invalid_pdf', '文件不是可解析的 PDF')
  }
  return new PdfInspectError(
    'pdf_inspect_failed',
    `PDF 解析失败：${errorMessage(error)}`,
  )
}

/**
 * 读取 PDF 页数。传入 module 仅用于测试错误注入；生产路径使用项目内的
 * pdfjs-dist 6.5.438。
 */
export async function inspectPdfBytes(
  bytes: Uint8Array,
  module: PdfModuleLike = defaultPdfModule,
): Promise<PdfInspectResult> {
  if (bytes.byteLength === 0) {
    throw new PdfInspectError('invalid_pdf', '文件为空，不是可解析的 PDF')
  }

  let task: PdfLoadingTaskLike
  try {
    // PDF.js 可能把 data 的 ArrayBuffer transfer 给 worker；必须传副本，
    // 否则调用方之后无法再对原字节做哈希或写入 Blob。
    task = module.getDocument({ data: new Uint8Array(bytes) })
  } catch (error) {
    throw toPdfInspectError(error)
  }

  try {
    const document = await task.promise
    if (!Number.isInteger(document.numPages) || document.numPages < 1) {
      throw new PdfInspectError('invalid_pdf', 'PDF 没有可读取的页面')
    }
    return { pageCount: document.numPages }
  } catch (error) {
    throw toPdfInspectError(error)
  } finally {
    await task.destroy().catch(() => undefined)
  }
}
