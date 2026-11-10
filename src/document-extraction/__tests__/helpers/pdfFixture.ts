/**
 * 测试专用：用仓库内 pdfjs 读取真实 PDF 文本层，转成纯数据 RawPdfTextPage。
 *
 * 只被 `src/document-extraction/__tests__/*.test.ts` 使用；不属于产品代码路径。
 * 生产接线（main 侧读取 blob、页范围预算、IPC）属于第 2 阶段。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { RawPdfTextItem, RawPdfTextPage } from '../../textLayer'

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../__fixtures__/${name}`, import.meta.url))
}

export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fixturePath(name)))
}

export function fixtureSha256(name: string): string {
  return createHash('sha256').update(readFileSync(fixturePath(name))).digest('hex')
}

export interface FixtureTextResult {
  readonly pageCount: number
  readonly pages: RawPdfTextPage[]
}

export async function readPdfTextPages(name: string): Promise<FixtureTextResult> {
  const bytes = fixtureBytes(name)
  const task = getDocument({ data: bytes, useWorkerFetch: false, verbosity: 0 })
  const document = await task.promise
  try {
    const pages: RawPdfTextPage[] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const items: RawPdfTextItem[] = []
      for (const raw of content.items) {
        if (!('str' in raw)) continue
        items.push({
          str: raw.str,
          transform: [...raw.transform],
          width: raw.width,
          height: raw.height,
          hasEOL: raw.hasEOL,
        })
      }
      pages.push({ page: pageNumber, view: [...page.view], items })
      page.cleanup?.()
    }
    return { pageCount: document.numPages, pages }
  } finally {
    await task.destroy()
  }
}
