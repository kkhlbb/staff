#!/usr/bin/env node
/**
 * r4（170 页）切块证据探针：跑真实 PDF 文本层 + buildExtractionDraft，打印候选/问题摘要，
 * 并把整份草稿 JSON 写到给定路径（可选）。只读语料，不改仓库、不改规则。
 *
 *   node docs/evidence/extract-chunking/probe-r4.mjs [out.json]
 *
 * 用途：
 * 1) 证明 r4 不再整份 PAGE_LIMIT、切块后能出候选（页范围/块踪迹逐条可见）；
 * 2) 与“把 MAX_EXTRACTION_PAGES 临时抬到 1000（等价于整份一次扫描）”的参照运行
 *    对比候选数组的 SHA-256 —— 证明切块合并没有改变结果。
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
const { loadExtraction, loadPdfTextExtract } = await import(
  path.join(repoRoot, 'scripts/real-docs/tsImport.mjs')
)
const extraction = await loadExtraction()
const { extractPdfTextPages } = await loadPdfTextExtract()

const corpusDir = process.env.REAL_DOC_CORPUS ?? path.join(process.env.HOME ?? '', 'DSH/tmp/cunlian-v36/real-docs')
const pdfPath = path.join(corpusDir, 'r4-mtt1097.pdf')
const bytes = new Uint8Array(readFileSync(pdfPath))
const sha256 = createHash('sha256').update(bytes).digest('hex')

// 与 scripts/real-docs/metrics.mjs 相同的读取预算（仅放大读取，不改任何规则）。
const rawPages = await extractPdfTextPages(bytes, { from: 1, to: 170 }, {
  maxTextItems: 200000,
  timeoutMs: 300000,
})
const layer = extraction.buildPdfTextLayer(rawPages)
const draft = extraction.buildExtractionDraft({
  projectId: 'real-doc-baseline',
  baseToken: 'real-doc-baseline-1',
  source: {
    documentId: 'real-doc-r4',
    revisionId: `real-doc-r4-${sha256.slice(0, 12)}`,
    sha256,
    blobKey: 'corpus:r4-mtt1097.pdf',
    pageCount: 170,
  },
  pageRange: { from: 1, to: 170 },
  layer,
})

const statuses = {}
for (const candidate of draft.candidates) {
  statuses[candidate.status] = (statuses[candidate.status] ?? 0) + 1
}
const candidatesHash = createHash('sha256').update(JSON.stringify(draft.candidates)).digest('hex')
const issuesHash = createHash('sha256')
  .update(JSON.stringify(draft.issues.filter((item) => item.code !== 'CHUNK_PROCESSED')))
  .digest('hex')

console.log(`MAX_EXTRACTION_PAGES=${extraction.MAX_EXTRACTION_PAGES}｜extractor=${draft.extractorVersion}`)
console.log(`r4 页数 ${draft.sourceIdentity.pageCount}｜文本项 ${layer.pages.reduce((sum, page) => sum + page.items.length, 0)}`)
console.log(`候选 ${draft.candidates.length}（${JSON.stringify(statuses)}）｜问题 ${draft.issues.length}`)
console.log(`候选数组 SHA-256 ${candidatesHash}`)
console.log(`非切块 issue SHA-256 ${issuesHash}`)
console.log('')
for (const candidate of draft.candidates) {
  const label =
    candidate.kind === 'ring'
      ? `${candidate.data.symbol} nominal=${candidate.data.nominal?.text ?? '-'}${candidate.data.nominal?.unitText ?? ''}`
      : candidate.kind === 'formula'
        ? candidate.data.rawExpression
        : JSON.stringify(candidate.data)
  console.log(
    `候选 p${candidate.page} ${candidate.kind} ${candidate.status} ` +
      `reasons=${candidate.reasonCodes.join('+') || '无'} occurrence=${JSON.stringify(candidate.occurrence ?? null)} ` +
      `${label}`,
  )
}
console.log('')
for (const issue of draft.issues) {
  const chunk = issue.chunk ? ` chunk=${issue.chunk.index}[${issue.chunk.from}-${issue.chunk.to}]` : ''
  console.log(`问题 ${issue.code} ${issue.severity} p${issue.page ?? '-'}${chunk}：${issue.message}`)
}

const out = process.argv[2]
if (out) {
  writeFileSync(out, `${JSON.stringify(draft, null, 2)}\n`)
  console.log(`\n已写 ${out}`)
}
