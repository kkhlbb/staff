#!/usr/bin/env node
/**
 * 诊断探针（证据用，不参与 npm test / 产品接线）：
 * 1. 数一遍 6 份真实语料里到底有没有 P0 认可的“显式单位声明”；
 * 2. 把每条 UNKNOWN_UNIT 阻塞候选归类，说明为什么继承救不回它。
 *
 *   REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs \
 *     node docs/evidence/extract-unit-inherit/probe-unit-declarations.mjs
 *
 * 只调用产品同一套函数（detectUnitDeclarations / buildExtractionDraft），不另写解析。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
const { loadExtraction, loadPdfTextExtract } = await import(
  path.join(repoRoot, 'scripts/real-docs/tsImport.mjs')
)
const extraction = await loadExtraction()
const { extractPdfTextPages } = await loadPdfTextExtract()
const unitScope = await import(path.join(repoRoot, 'src/document-extraction/unitScope.ts'))
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')

const corpusDir =
  process.env.REAL_DOC_CORPUS ?? path.join(process.env.HOME, 'DSH/tmp/cunlian-v36/real-docs')
const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, 'docs/evidence/real-doc-baseline/corpus-manifest.json'), 'utf8'),
)

const stubEvidence = (line, start, end) => ({
  documentId: 'probe',
  revisionId: 'probe',
  sha256: 'a'.repeat(64),
  blobKey: 'probe',
  page: line.page,
  rectPdf: [0, 0, 1, 1],
  pageBoxPdf: [0, 0, 595, 842],
  textSnippet: line.normalizedText.slice(start, end),
  normalizedSnippet: line.normalizedText.slice(start, end),
  textItemIndexes: [0],
})

/** 行内是否出现了单位串（任何位置）。只用于归类，不参与抽取判定。 */
const UNIT_ANYWHERE = /(?:mm|毫米|㎜|inch|\bin\b|英寸|″|”)/i
/** 单纯的单字母/短符号赋值片段（论文下标噪声），例如 i=0、n=1、k=2。 */
const INDEX_FRAGMENT = /^([A-Za-z])\s*=\s*[+-]?\d{1,3}$/

const totals = {
  declarations: 0,
  unknownBlocked: 0,
  rescued: 0,
  inLineUnit: 0,
  noUnitAtAll: 0,
  indexFragment: 0,
}

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
  const declared = []
  for (const page of layer.pages) {
    for (const line of page.lines) {
      const found = unitScope.detectUnitDeclarations({
        line,
        page: page.page,
        scope: 'page',
        evidence: (start, end) => stubEvidence(line, start, end),
      })
      for (const item of found) {
        declared.push(`${item.scope}@p${page.page}:「${item.evidence.textSnippet.trim()}」`)
      }
    }
  }
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
  const unitConflict = draft.candidates.filter((candidate) =>
    candidate.reasonCodes.includes('UNIT_CONFLICT'),
  )
  const inherited = draft.candidates.filter((candidate) =>
    candidate.confidenceBasis.some((basis) => basis.startsWith('RULE_UNIT_INHERITED_')),
  )
  const classes = { inLineUnit: [], noUnitAtAll: [], indexFragment: [] }
  for (const candidate of unknown) {
    if (UNIT_ANYWHERE.test(candidate.rawText)) classes.inLineUnit.push(candidate)
    else if (INDEX_FRAGMENT.test(candidate.rawText.trim())) classes.indexFragment.push(candidate)
    else classes.noUnitAtAll.push(candidate)
  }
  totals.declarations += declared.length
  totals.unknownBlocked += unknown.length
  totals.rescued += inherited.length
  totals.inLineUnit += classes.inLineUnit.length
  totals.noUnitAtAll += classes.noUnitAtAll.length
  totals.indexFragment += classes.indexFragment.length

  console.log(
    `\n${doc.id} ${doc.file}：页 ${pageCount}｜显式单位声明 ${declared.length}｜` +
      `UNKNOWN_UNIT 阻塞候选 ${unknown.length}｜UNIT_CONFLICT 候选 ${unitConflict.length}｜` +
      `继承到单位的候选 ${inherited.length}`,
  )
  for (const line of declared.slice(0, 8)) console.log(`  声明 ${line}`)
  if (declared.length > 8) console.log(`  …其余 ${declared.length - 8} 条省略`)
  const sample = (label, list) => {
    if (list.length === 0) return
    console.log(`  ${label} ${list.length} 条，例：`)
    for (const candidate of list.slice(0, 3)) {
      console.log(`    p${candidate.page} ${JSON.stringify(candidate.rawText.slice(0, 96))}`)
    }
  }
  sample('A 行内有单位串但不在数值 token 上', classes.inLineUnit)
  sample('B 行内完全没有单位串', classes.noUnitAtAll)
  sample('C 下标/计数片段（i=0 之类）', classes.indexFragment)
}
console.log(
  `\n汇总：显式单位声明 ${totals.declarations} 条；UNKNOWN_UNIT 阻塞候选 ${totals.unknownBlocked} 条` +
    `（A 行内有单位串 ${totals.inLineUnit}｜B 无单位串 ${totals.noUnitAtAll}｜C 下标片段 ${totals.indexFragment}）；` +
    `因继承拿到单位的候选 ${totals.rescued} 条`,
)
