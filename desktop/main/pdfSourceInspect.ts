/**
 * V3.5：main 侧 PDF 页数与页面几何解析。
 *
 * 与 V3-C 的 `pdfCheck.ts` 不同：这里不要求 A4 横向单页，而是接受多页任务书，
 * 只提取“页数 + 每页未旋转 page.view + 旋转角”，供导入记录与框选页身份校验。
 * 不渲染页面、不执行 PDF 脚本、不请求密码；加密/损坏一律拒绝。
 *
 * 本模块只被 main 调用，不进入 renderer；renderer 仍通过 `readAttachment`
 * 读取确切版本字节并用 pdfjs 渲染。
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { SourcePdfPageInfo } from '../shared/contracts'
import { normalizePdfPageBox } from '../../src/sources/pdfCoordinates'

export interface SourcePdfInspection {
  pageCount: number
  pages: SourcePdfPageInfo[]
}

export type SourcePdfInspectErrorCode =
  | 'SOURCE_UNREADABLE'
  | 'SOURCE_PAGE_LIMIT'

export class SourcePdfInspectError extends Error {
  readonly code: SourcePdfInspectErrorCode

  constructor(code: SourcePdfInspectErrorCode, message: string) {
    super(message)
    this.name = 'SourcePdfInspectError'
    this.code = code
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 解析 PDF 页数与页面几何。超过 maxPages 直接拒绝（不逐页读取），避免畸形
 * 文件把主进程拖死。每页都实际 `getPage()`，能发现页树里取不到的坏页。
 */
export async function inspectSourcePdf(
  bytes: Uint8Array,
  options: { maxPages?: number } = {},
): Promise<SourcePdfInspection> {
  if (bytes.byteLength === 0) {
    throw new SourcePdfInspectError('SOURCE_UNREADABLE', 'PDF 为空（0 字节）')
  }
  const maxPages = options.maxPages ?? 100
  let task: ReturnType<typeof getDocument> | null = null
  try {
    task = getDocument({
      data: new Uint8Array(bytes),
      useWorkerFetch: false,
      verbosity: 0,
    })
    const document = await task.promise
    const pageCount = document.numPages
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
      throw new SourcePdfInspectError('SOURCE_UNREADABLE', 'PDF 没有可读取的页面')
    }
    if (pageCount > maxPages) {
      throw new SourcePdfInspectError(
        'SOURCE_PAGE_LIMIT',
        `PDF 页数 ${pageCount} 超过上限 ${maxPages} 页`,
      )
    }
    const pages: SourcePdfPageInfo[] = []
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const box = normalizePdfPageBox(page.view)
      if (box === null) {
        throw new SourcePdfInspectError(
          'SOURCE_UNREADABLE',
          `第 ${pageNumber} 页边界框无效，无法导入`,
        )
      }
      const rotate = Number.isFinite(page.rotate) ? page.rotate : 0
      pages.push({
        page: pageNumber,
        pageBoxPdf: box,
        widthPt: box[2] - box[0],
        heightPt: box[3] - box[1],
        rotate,
      })
      page.cleanup?.()
    }
    return { pageCount, pages }
  } catch (error) {
    if (error instanceof SourcePdfInspectError) throw error
    const name =
      typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name?: unknown }).name)
        : ''
    if (name === 'PasswordException' || /password/i.test(messageOf(error))) {
      throw new SourcePdfInspectError(
        'SOURCE_UNREADABLE',
        'PDF 受密码保护；本版本拒绝导入加密文件',
      )
    }
    throw new SourcePdfInspectError(
      'SOURCE_UNREADABLE',
      `PDF 无法解析：${messageOf(error)}`,
    )
  } finally {
    if (task !== null) {
      try {
        await task.destroy()
      } catch {
        // 释放失败不影响已经解析出的结果；不把清理错误冒充导入失败。
      }
    }
  }
}
