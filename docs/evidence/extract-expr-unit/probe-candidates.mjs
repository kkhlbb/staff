#!/usr/bin/env node
/**
 * 逐候选对照探针（证据用，不参与 npm test）：
 *
 *   REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs \
 *     node docs/evidence/extract-expr-unit/probe-candidates.mjs [r1,r5,r6]
 *
 * 打印每份文档的全部候选（kind / 状态 / 符号 / 数值 / 原因码 / 原文前 100 字），
 * 用于逐条对照改前改后到底哪几条动了、为什么动。只调用产品同一套 API。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
const { loadExtraction, loadPdfTextExtract } = await import(
  path.join(repoRoot, 'scripts/real-docs/tsImport.mjs')
)
const extraction = await loadExtraction()
const { extractPdfTextPages } = await loadPdfTextExtract()
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')

const corpusDir =
  process.env.REAL_DOC_CORPUS ?? path.join(process.env.HOME, 'DSH/tmp/cunlian-v36/real-docs')
const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, 'docs/evidence/real-doc-baseline/corpus-manifest.json'), 'utf8'),
)
const wanted = process.argv[2] ? new Set(process.argv[2].split(',')) : null

for (const doc of manifest.documents) {
  if (wanted && !wanted.has(doc.id)) continue
  const bytes = new Uint8Array(readFileSync(path.join(corpusDir, doc.file)))
  const task = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, verbosity: 0 })
  const pdf = await task.promise
  const pageCount = pdf.numPages
  await task.destroy()
  const rawPages = await extractPdfTextPages(
    bytes,
    { from: 1, to: pageCount },
    { maxTextItems: 200000, timeoutMs: 300000 },
  )
  const layer = extraction.buildPdfTextLayer(rawPages)
  const source = {
    documentId: `real-doc-${doc.id}`,
    revisionId: `real-doc-${doc.id}-probe`,
    sha256: doc.sha256,
    blobKey: `corpus:${doc.file}`,
    pageCount,
  }
  const draft = extraction.buildExtractionDraft({
    projectId: 'probe',
    baseToken: 'probe',
    source,
    pageRange: { from: 1, to: pageCount },
    layer,
  })
  console.log(
    `\n=== ${doc.id} ${doc.file}：候选 ${draft.candidates.length}｜` +
      `pending ${draft.candidates.filter((c) => c.status === 'pending').length}｜` +
      `blocked ${draft.candidates.filter((c) => c.status === 'blocked').length}`,
  )
  for (const candidate of draft.candidates) {
    const data = candidate.data
    const nominal = 'nominal' in data ? data.nominal : null
    console.log(
      `  [${candidate.status}] ${candidate.kind} p${candidate.page} symbol=${data.symbol ?? data.outputSymbol ?? '-'} ` +
        `text=${JSON.stringify(nominal?.text ?? null)} unit=${JSON.stringify(nominal?.unitText ?? null)} ` +
        `q=${nominal?.valueQ ?? null} reasons=${JSON.stringify(candidate.reasonCodes)}`,
    )
    console.log(`     raw=${JSON.stringify(candidate.rawText.slice(0, 100))}`)
  }
  console.log(
    `  问题码：${draft.issues.map((item) => `${item.code}(${item.severity})`).join(', ') || '无'}`,
  )
}
