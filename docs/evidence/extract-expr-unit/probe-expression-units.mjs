#!/usr/bin/env node
/**
 * 诊断探针（证据用，不参与 npm test / 产品接线）：P1 表达式末尾单位。
 *
 *   REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs \
 *     node docs/evidence/extract-expr-unit/probe-expression-units.mjs
 *
 * 只做两件事：
 * 1. 把每份真实文档里 `UNKNOWN_UNIT` 阻塞候选的**整行原文**打印出来（含 pdf 文本项分块），
 *    用于人工核对“单位在末尾”的形态到底长什么样；
 * 2. 用产品同一套 API（buildExtractionDraft）对比候选/原因码计数。
 * 不另写解析、不改任何规则。
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

/** 行内是否出现单位串（归类用，不参与判定）。 */
const UNIT_ANYWHERE = /(?:mm|毫米|㎜|inch|\bin\b|英寸|″|”)/i

const totals = { unknownBlocked: 0, inLineUnit: 0, noUnitAtAll: 0 }

for (const doc of manifest.documents) {
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
  const unknown = draft.candidates.filter(
    (candidate) =>
      candidate.status === 'blocked' && candidate.reasonCodes.includes('UNKNOWN_UNIT'),
  )
  const inLine = unknown.filter((candidate) => UNIT_ANYWHERE.test(candidate.rawText))
  const noUnit = unknown.filter((candidate) => !UNIT_ANYWHERE.test(candidate.rawText))
  totals.unknownBlocked += unknown.length
  totals.inLineUnit += inLine.length
  totals.noUnitAtAll += noUnit.length

  console.log(
    `\n=== ${doc.id} ${doc.file}：页 ${pageCount}｜候选 ${draft.candidates.length}｜` +
      `UNKNOWN_UNIT 阻塞 ${unknown.length}（行内有单位串 ${inLine.length}｜行内无单位串 ${noUnit.length}）`,
  )
  for (const candidate of inLine) {
    const line = layer.pages
      .find((page) => page.page === candidate.page)
      ?.lines.find((item) => item.rawText === candidate.rawText)
    console.log(`  [有单位串] p${candidate.page} 符号=${candidate.data.symbol} 值=${JSON.stringify(candidate.data.nominal?.text)}`)
    console.log(`    原文=${JSON.stringify(candidate.rawText)}`)
    if (line) {
      console.log(`    文本项=${JSON.stringify(line.items.map((item) => item.text))}`)
    }
  }
  for (const candidate of noUnit) {
    console.log(
      `  [无单位串] p${candidate.page} 符号=${candidate.data.symbol} 值=${JSON.stringify(candidate.data.nominal?.text)}` +
        ` 原文=${JSON.stringify(candidate.rawText.slice(0, 110))}`,
    )
  }
}

console.log(
  `\n汇总：UNKNOWN_UNIT 阻塞 ${totals.unknownBlocked} 条（行内有单位串 ${totals.inLineUnit}｜行内无单位串 ${totals.noUnitAtAll}）`,
)
