#!/usr/bin/env node
/**
 * 夹具/规则逐页核对探针（证据用，不参与 npm test）：
 *   node docs/evidence/extract-expr-unit/probe-fixture.mjs
 *
 * 对 `expression-unit-sample.pdf` 的每一页单独取页范围，打印文本层行原文与产出的候选，
 * 便于人工核对 E-01～E-07 的真实结果（不是测试断言的替代品）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
const { loadExtraction, loadPdfTextExtract } = await import(
  path.join(repoRoot, 'scripts/real-docs/tsImport.mjs')
)
const extraction = await loadExtraction()
const { extractPdfTextPages } = await loadPdfTextExtract()

const fixture = path.join(repoRoot, 'src/document-extraction/__fixtures__/expression-unit-sample.pdf')
const bytes = new Uint8Array(readFileSync(fixture))
const rawPages = await extractPdfTextPages(bytes, { from: 1, to: 7 }, { maxTextItems: 20000, timeoutMs: 20000 })
const layer = extraction.buildPdfTextLayer(rawPages)
const source = {
  documentId: 'fixture-expression-unit',
  revisionId: 'fixture-expression-unit-rev',
  sha256: 'b'.repeat(64),
  blobKey: 'fixture:expression-unit-sample.pdf',
  pageCount: layer.pages.length,
}

for (const page of layer.pages) {
  const draft = extraction.buildExtractionDraft({
    projectId: 'probe',
    baseToken: 'probe',
    source,
    pageRange: { from: page.page, to: page.page },
    layer,
  })
  console.log(`\n=== 第 ${page.page} 页`)
  for (const line of page.lines) {
    if (line.rawText.trim() === '') continue
    console.log(`  行 ${JSON.stringify(line.rawText)} 文本项=${JSON.stringify(line.items.map((i) => i.text))}`)
  }
  if (draft.candidates.length === 0) console.log('  候选：无')
  for (const candidate of draft.candidates) {
    const data = candidate.data
    const nominal = data.nominal
    console.log(
      `  候选 kind=${candidate.kind} symbol=${data.symbol} status=${candidate.status} ` +
        `reasons=${JSON.stringify(candidate.reasonCodes)} basis=${JSON.stringify(candidate.confidenceBasis)}`,
    )
    console.log(
      `    nominal=${JSON.stringify(nominal?.text)} unit=${JSON.stringify(nominal?.unitText)} valueQ=${nominal?.valueQ} ` +
        `upper=${JSON.stringify(data.upperDeviation?.text)}(${data.upperDeviation?.valueQ}) ` +
        `lower=${JSON.stringify(data.lowerDeviation?.text)}(${data.lowerDeviation?.valueQ})`,
    )
    console.log(
      `    出处=${JSON.stringify(candidate.evidence.map((item) => item.textSnippet))}`,
    )
    console.log(
      `    归一出处=${JSON.stringify(candidate.evidence.map((item) => item.normalizedSnippet))}`,
    )
    console.log(`    rawText=${JSON.stringify(candidate.rawText)}`)
  }
  for (const issue of draft.issues) {
    console.log(`  issue ${issue.code} ${issue.severity} p${issue.page} ${JSON.stringify(issue.message)}`)
  }
}
