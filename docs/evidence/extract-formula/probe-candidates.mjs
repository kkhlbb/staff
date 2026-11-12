#!/usr/bin/env node
/**
 * 诊断探针（证据用，不参与 npm test / 产品接线）：逐条候选清单，用于改前/改后对照。
 *
 *   REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs \
 *     node docs/evidence/extract-formula/probe-candidates.mjs
 *
 * 每行一条候选：文档 / 页 / kind / 符号 / 数值（原文 + q）/ 单位 / 上下偏差 / 状态 / 原因码 / 原文。
 * 只读产品输出，不另写解析。两次运行（不同提交）的日志直接 `diff` 就能看出每条候选的归属。
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

const show = (value) => (value == null ? '-' : `${value.text}${value.unitText ?? '(无单位)'}/${value.valueQ ?? 'null'}q`)

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
  const draft = extraction.buildExtractionDraft({
    projectId: 'probe',
    baseToken: 'probe',
    source: {
      documentId: `real-doc-${doc.id}`,
      revisionId: `real-doc-${doc.id}-probe`,
      sha256: doc.sha256,
      blobKey: `corpus:${doc.file}`,
      pageCount,
    },
    pageRange: { from: 1, to: pageCount },
    layer,
  })
  console.log(`\n=== ${doc.id} ${doc.file}：候选 ${draft.candidates.length}`)
  for (const candidate of draft.candidates) {
    const data = candidate.data
    const parts = [
      `${doc.id} p${candidate.page}`,
      candidate.kind,
      candidate.status,
      `reasons=${candidate.reasonCodes.join('+') || '无'}`,
      `id=${candidate.candidateId}`,
    ]
    if (candidate.kind === 'ring') {
      parts.push(
        `symbol=${data.symbol}`,
        `nominal=${show(data.nominal)}`,
        `upper=${show(data.upperDeviation)}`,
        `lower=${show(data.lowerDeviation)}`,
        `occ=${data.name ?? '-'}`,
      )
    } else if (candidate.kind === 'formula') {
      parts.push(
        `output=${data.outputSymbol ?? '-'}`,
        `operands=${data.operands.map((operand) => `${operand.sign > 0 ? '+' : '-'}${operand.symbol}`).join('') || '-'}`,
        `unsupported=${data.unsupported}`,
      )
    } else if (candidate.kind === 'interval') {
      parts.push(
        `output=${data.outputSymbol}`,
        `lower=${show(data.lower)}`,
        `upper=${show(data.upper)}`,
      )
    }
    parts.push(`raw=${JSON.stringify(candidate.rawText.slice(0, 90))}`)
    console.log(parts.join(' | '))
  }
}
