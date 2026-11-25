import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { inspectSourcePdf } from '../main/pdfSourceInspect'
import { extractPdfTextPages } from '../main/pdfTextExtract'
import manifest from './fixtures/agent-refactor/mounting-plate-taskbook.manifest.json'

const fixture = new URL('./fixtures/agent-refactor/mounting-plate-taskbook.pdf', import.meta.url)
const expectedSha256 = 'd455a7fa1d91741ec94b14ff6b4a63036b6d09f5e75a6c506875dd8d063b9c42'

it('pins the archived mounting plate PDF bytes and manifest', async () => {
  const bytes = await readFile(fixture)
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedSha256)
  expect(manifest).toMatchObject({
    file: 'mounting-plate-taskbook.pdf',
    byteLength: bytes.byteLength,
    sha256: expectedSha256,
  })
})

it('extracts requirement clauses and dimensions on their numbered pages', async () => {
  const bytes = await readFile(fixture)
  const { pageCount } = await inspectSourcePdf(bytes)
  expect(pageCount).toBe(2)
  expect(manifest.pageCount).toBe(pageCount)

  const pages = await extractPdfTextPages(bytes, { from: 1, to: pageCount })
  const extracted = pages.map(({ page, items }) => ({
    page,
    text: items.map(item => item.str).join(' ').replace(/\s+/g, ' '),
  }))
  expect(extracted.map(({ page, text }) => ({
    page,
    clauseIds: text.match(/\bMP-\d{2}\b/g),
  }))).toEqual(manifest.pages)
  const [plate, cover] = extracted.map(({ text }) => text)
  expect(plate).toMatch(/MP-01 .*80 × 50 × 8 mm.*lower-left bottom corner.*along X, width along Y, and thickness along Z/)
  expect(plate).toMatch(/MP-02 .*Two Ø10 mm through holes run along Z.*\(20, 25\) mm.*\(60, 25\) mm/)
  expect(plate).toMatch(/MP-03 .*X tolerance: ±0\.2 mm.*Y tolerance: ±0\.2 mm.*independent.*diameter tolerance: ±0\.1 mm.*other in-plane dimensions are fixed.*every allowed variation.*right end face shall be at least 13 mm/)
  expect(cover).toMatch(/MP-04 .*parallel to the mounting plate top face.*XY projection covers the entire mounting plate.*Z = 10 ± 0\.1 mm.*thickness: 8 ± 0\.2 mm/)
  expect(cover).toMatch(/MP-05 .*every allowed variation.*clearance.*shall be at least 1\.5 mm/)
  expect(plate).toMatch(/Page 1 of 2$/)
  expect(cover).toMatch(/Page 2 of 2$/)
})
