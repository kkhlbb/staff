#!/usr/bin/env node
/**
 * 夹具探针（证据用）：逐页打印 `formula-form-sample.pdf` 的文本项与候选结果，
 * 用于核对 F-01～F-07 的出处与数值，不参与 npm test。
 *
 *   node docs/evidence/extract-formula/probe-fixture.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
const { loadExtraction } = await import(path.join(repoRoot, 'scripts/real-docs/tsImport.mjs'))
const extraction = await loadExtraction()
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')

const fixture = path.join(repoRoot, 'src/document-extraction/__fixtures__/formula-form-sample.pdf')
const bytes = new Uint8Array(readFileSync(fixture))
const task = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, verbosity: 0 })
const pdf = await task.promise
const pageCount = pdf.numPages
const rawPages = []
for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
  const page = await pdf.getPage(pageNumber)
  const content = await page.getTextContent()
  const items = content.items
    .filter((raw) => 'str' in raw)
    .map((raw) => ({
      str: raw.str,
      transform: [...raw.transform],
      width: raw.width,
      height: raw.height,
      hasEOL: raw.hasEOL,
    }))
  rawPages.push({ page: pageNumber, view: [...page.view], items })
}
await task.destroy()

const layer = extraction.buildPdfTextLayer(rawPages)
console.log(`页数 ${pageCount}`)
for (const page of layer.pages) {
  console.log(`\n=== p${page.page}`)
  for (const line of page.lines) {
    console.log(`  行=${JSON.stringify(line.rawText)}`)
    console.log(`  文本项=${JSON.stringify(line.items.map((item) => item.text))}`)
  }
  const draft = extraction.buildExtractionDraft({
    projectId: 'probe',
    baseToken: 'probe',
    source: {
      documentId: 'doc-formula-form',
      revisionId: 'rev-formula-form',
      sha256: 'probe',
      blobKey: 'probe',
      pageCount,
    },
    pageRange: { from: page.page, to: page.page },
    layer,
  })
  for (const candidate of draft.candidates) {
    if (candidate.kind === 'ring') {
      const { symbol, nominal, upperDeviation, lowerDeviation } = candidate.data
      console.log(
        `  候选 ring ${candidate.status} reasons=${candidate.reasonCodes.join('+') || '无'} ` +
          `symbol=${symbol} nominal=${nominal?.text ?? '-'}${nominal?.unitText ?? ''} q=${nominal?.valueQ ?? 'null'} ` +
          `upper=${upperDeviation?.text ?? '-'} lower=${lowerDeviation?.text ?? '-'} ` +
          `basis=${candidate.confidenceBasis.join('+')}`,
      )
      console.log(`    出处=${JSON.stringify(candidate.evidence.map((item) => item.normalizedSnippet))}`)
    } else if (candidate.kind === 'formula') {
      console.log(
        `  候选 formula ${candidate.status} reasons=${candidate.reasonCodes.join('+') || '无'} ` +
          `unsupported=${candidate.data.unsupported} raw=${JSON.stringify(candidate.rawText)}`,
      )
    } else {
      console.log(`  候选 ${candidate.kind} ${candidate.status} reasons=${candidate.reasonCodes.join('+') || '无'}`)
    }
  }
  if (draft.candidates.length === 0) console.log('  候选：0 条')
  for (const issue of draft.issues) console.log(`  问题 ${issue.code} ${issue.severity}：${issue.message}`)
}
