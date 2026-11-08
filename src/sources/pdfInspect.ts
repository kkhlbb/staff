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

export interface PdfPageLike {
  /**
   * 解析页面内容流并生成操作符列表。只取页数无法发现“页对象存在但内容损坏”
   * 的文件，因此逐页校验时至少走到这一层。
   */
  getOperatorList: () => Promise<unknown>
  cleanup?: () => void
}

export interface PdfDocumentLike {
  numPages: number
  getPage: (pageNumber: number) => Promise<PdfPageLike>
}

export interface PdfLoadingTaskLike {
  promise: Promise<PdfDocumentLike>
  destroy: () => Promise<void>
}

export interface PdfModuleLike {
  getDocument: (params: { data: Uint8Array }) => PdfLoadingTaskLike
}

export interface PdfInspectOptions {
  /**
   * 页数上限。超过时不逐页校验，直接返回页数交给调用方拒绝：避免一个声称
   * 上百万页的畸形文件让导入卡在逐页解析上。
   */
  maxPages?: number
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
 * 读取并校验 PDF。
 *
 * “可解析”的检查边界（本版本明确定义）：
 * 1. 文档能打开，numPages 是 ≥1 的整数；
 * 2. 每一页都能被 getPage() 解析出页面对象（能发现 /Pages 树里 Kids 指向
 *    错误类型对象这类损坏：numPages 仍可能返回 2，但第 2 页取不到）；
 * 3. 每一页的 getOperatorList() 能成功生成操作符列表（页内容流可解析）。
 *
 * 超过 maxPages 时跳过后两条，只返回页数，由调用方按页数上限拒绝。
 * 加密 PDF 若在 getDocument 阶段不报错、直到取页时才要求密码，仍会映射为
 * password_protected；其余取页/内容错误一律按 invalid_pdf 拒绝（宁可拒绝，
 * 不把无法完整解析的文件当作成功导入）。
 *
 * module/options 仅用于测试错误注入；生产路径使用项目内的 pdfjs-dist 6.5.438。
 */
export async function inspectPdfBytes(
  bytes: Uint8Array,
  module: PdfModuleLike = defaultPdfModule,
  options: PdfInspectOptions = {},
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

    const pageCount = document.numPages
    if (options.maxPages !== undefined && pageCount > options.maxPages) {
      return { pageCount }
    }

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      let page: PdfPageLike
      try {
        page = await document.getPage(pageNumber)
      } catch (error) {
        throw pageError(error, pageNumber)
      }
      try {
        await page.getOperatorList()
      } catch (error) {
        throw pageError(error, pageNumber, '内容无法解析')
      } finally {
        try {
          page.cleanup?.()
        } catch {
          // 清理失败不影响已得出的校验结论。
        }
      }
    }

    return { pageCount }
  } catch (error) {
    throw toPdfInspectError(error)
  } finally {
    await task.destroy().catch(() => undefined)
  }
}

/** 取页/内容错误：加密错误保持可识别的密码原因，其余统一按损坏拒绝。 */
function pageError(
  error: unknown,
  pageNumber: number,
  what = '对象无法解析',
): PdfInspectError {
  if (error instanceof PdfInspectError) {
    return error
  }
  if (errorName(error) === 'PasswordException' || /password/i.test(errorMessage(error))) {
    return toPdfInspectError(error)
  }
  return new PdfInspectError(
    'invalid_pdf',
    `PDF 第 ${pageNumber} 页${what}：${errorMessage(error)}`,
  )
}
