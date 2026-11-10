/**
 * V3.6：main 侧 PDF 文本层读取（只取指定页范围的 TextItem，不渲染、不 OCR）。
 *
 * 与 renderer 的 src/sources/render.ts 是两条独立路径：main 使用
 * pdfjs-dist/legacy + fake worker（pdfSourceInspect 已验证的打包方式），
 * 只读取文本内容；页面几何仍由 pdfSourceInspect 提供并已在导入时冻结。
 *
 * 预算与取消在逐页循环里执行：
 * - 页数上限（调用方保证 pageRange 已校验）与词项上限；
 * - 每次取页前检查取消标记与超时；
 * - 无文本页原样返回空 items，由领域层记为覆盖缺口，绝不启动 OCR。
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { RawPdfTextItem, RawPdfTextPage } from '../../src/document-extraction/textLayer'
import { configurePdfWorker } from './pdfSourceInspect'

configurePdfWorker()

/** 单次提取允许的 TextItem 上限；超出即拒绝，不悄悄截断（截断会制造假缺口）。 */
export const MAX_EXTRACTION_TEXT_ITEMS = 20000
export const DEFAULT_EXTRACTION_TIMEOUT_MS = 20_000

export type PdfTextExtractionErrorCode =
  | 'SOURCE_UNREADABLE'
  | 'EXTRACTION_CANCELLED'
  | 'EXTRACTION_TIMEOUT'
  | 'EXTRACTION_BUDGET'

export class PdfTextExtractionError extends Error {
  readonly code: PdfTextExtractionErrorCode

  constructor(code: PdfTextExtractionErrorCode, message: string) {
    super(message)
    this.name = 'PdfTextExtractionError'
    this.code = code
  }
}

export interface PdfTextExtractionOptions {
  /** 调用方在另一条 IPC 里置为 true；每页开始前检查。 */
  isCancelled?: () => boolean
  timeoutMs?: number
  maxTextItems?: number
  now?: () => number
}

interface PdfTextItemLike {
  str?: unknown
  transform?: unknown
  width?: unknown
  height?: unknown
  hasEOL?: unknown
}

/**
 * 读取 [pageFrom, pageTo] 的原始文本项。
 *
 * 只保留 pdfjs 的 TextItem（有 str）；MarkedContent 等无字符串项跳过。
 * transform/width/height 原样带出，由领域层决定是否可生成选区：
 * 这里不修补、不猜测缺失几何。
 */
export async function extractPdfTextPages(
  bytes: Uint8Array,
  pageRange: { from: number; to: number },
  options: PdfTextExtractionOptions = {},
): Promise<RawPdfTextPage[]> {
  if (bytes.byteLength === 0) {
    throw new PdfTextExtractionError('SOURCE_UNREADABLE', 'PDF 为空（0 字节）')
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXTRACTION_TIMEOUT_MS
  const maxTextItems = options.maxTextItems ?? MAX_EXTRACTION_TEXT_ITEMS
  const now = options.now ?? (() => Date.now())
  const startedAt = now()
  const deadline = startedAt + timeoutMs
  const isCancelled = options.isCancelled ?? (() => false)

  const checkBudget = (phase: string): void => {
    if (isCancelled()) {
      throw new PdfTextExtractionError('EXTRACTION_CANCELLED', `提取已取消（${phase}）`)
    }
    if (now() > deadline) {
      throw new PdfTextExtractionError(
        'EXTRACTION_TIMEOUT',
        `提取超时（${timeoutMs} ms，${phase}）`,
      )
    }
  }

  let task: ReturnType<typeof getDocument> | null = null
  let textItems = 0
  try {
    task = getDocument({
      data: new Uint8Array(bytes),
      useWorkerFetch: false,
      verbosity: 0,
    })
    const document = await task.promise
    checkBudget('打开文档')
    if (pageRange.to > document.numPages) {
      throw new PdfTextExtractionError(
        'SOURCE_UNREADABLE',
        `页范围 ${pageRange.from}..${pageRange.to} 超出 PDF 页数 ${document.numPages}`,
      )
    }
    const pages: RawPdfTextPage[] = []
    for (let pageNumber = pageRange.from; pageNumber <= pageRange.to; pageNumber += 1) {
      checkBudget(`第 ${pageNumber} 页`)
      const page = await document.getPage(pageNumber)
      checkBudget(`第 ${pageNumber} 页取页`)
      const content = await page.getTextContent()
      checkBudget(`第 ${pageNumber} 页文本`)
      const items: RawPdfTextItem[] = []
      for (const raw of content.items as unknown[]) {
        const item = raw as PdfTextItemLike
        if (typeof item.str !== 'string') continue
        textItems += 1
        if (textItems > maxTextItems) {
          throw new PdfTextExtractionError(
            'EXTRACTION_BUDGET',
            `文本项超过上限 ${maxTextItems} 个；请缩小页范围后重试`,
          )
        }
        const transform = Array.isArray(item.transform) ? [...(item.transform as number[])] : []
        items.push({
          str: item.str,
          transform,
          width: typeof item.width === 'number' ? item.width : Number.NaN,
          height: typeof item.height === 'number' ? item.height : Number.NaN,
          hasEOL: item.hasEOL === true,
        })
      }
      pages.push({
        page: pageNumber,
        view: Array.isArray(page.view) ? [...(page.view as number[])] : [],
        items,
      })
      page.cleanup?.()
    }
    return pages
  } catch (error) {
    if (error instanceof PdfTextExtractionError) throw error
    const name =
      typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name?: unknown }).name)
        : ''
    if (name === 'PasswordException' || /password/i.test(String(error))) {
      throw new PdfTextExtractionError('SOURCE_UNREADABLE', 'PDF 受密码保护，无法提取文本')
    }
    throw new PdfTextExtractionError(
      'SOURCE_UNREADABLE',
      `PDF 文本层无法读取：${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    if (task !== null) {
      try {
        await task.destroy()
      } catch {
        // 释放失败不影响已返回结果；不把清理错误冒充提取失败。
      }
    }
  }
}
