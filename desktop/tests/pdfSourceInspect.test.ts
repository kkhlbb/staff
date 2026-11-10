import { describe, expect, it } from 'vitest'
import { inspectSourcePdf, SourcePdfInspectError } from '../main/pdfSourceInspect'
import { createTwoPageTaskbookPdf } from './helpers/taskbookPdf'

describe('V3.5 main PDF 解析：页数与页面几何', () => {
  it('两页任务书：页数 2，第 2 页保留非零原点 pageBoxPdf', async () => {
    const result = await inspectSourcePdf(createTwoPageTaskbookPdf())
    expect(result.pageCount).toBe(2)
    expect(result.pages).toHaveLength(2)
    expect(result.pages[0]).toMatchObject({
      page: 1,
      pageBoxPdf: [0, 0, 595, 842],
      widthPt: 595,
      heightPt: 842,
      rotate: 0,
    })
    expect(result.pages[1]).toMatchObject({
      page: 2,
      pageBoxPdf: [100, 200, 795, 1042],
      widthPt: 695,
      heightPt: 842,
      rotate: 0,
    })
  })

  it('空字节 → SOURCE_UNREADABLE，不是伪造 0 页', async () => {
    await expect(inspectSourcePdf(new Uint8Array())).rejects.toMatchObject({
      code: 'SOURCE_UNREADABLE',
    })
  })

  it('损坏字节 → SOURCE_UNREADABLE', async () => {
    const error = await inspectSourcePdf(new TextEncoder().encode('not a pdf')).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(SourcePdfInspectError)
    expect((error as SourcePdfInspectError).code).toBe('SOURCE_UNREADABLE')
  })

  it('页数超过上限 → SOURCE_PAGE_LIMIT', async () => {
    const error = await inspectSourcePdf(createTwoPageTaskbookPdf(), { maxPages: 1 }).catch(
      (caught: unknown) => caught,
    )
    expect((error as SourcePdfInspectError).code).toBe('SOURCE_PAGE_LIMIT')
  })
})
