#!/usr/bin/env node
/**
 * 证据探针：真实语料的“候选身份”快照（I5 逐字节对照用）。
 *
 * 只读：同一套 metrics 语料校验 + 同一条 pdfjs legacy 读取路径 + buildExtractionDraft。
 * 输出每份文档的 draftId / idempotencyKey / candidateId 列表 / candidate 级与字段级
 * evidenceKey 列表 / 候选数组字节哈希，用于改前改后逐份逐项比对。
 *
 *   node scripts/evidence-ref-candidates.mjs --out docs/evidence/evidence-ref/real-docs-candidates-before.json
 *
 * 语料缺失或与 manifest 不符 → 直接报错退出（不静默跳过）。
 * JSON 统一走 serializeEvidence，并做 evidenceViolations 自检。
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CorpusError,
  MANIFEST_RELATIVE_PATH,
  READ_BUDGET,
  defaultCorpusDir,
  loadManifest,
  verifyCorpus,
} from './real-docs/metrics.mjs'
import { loadEvidenceJson, loadExtraction, loadPdfTextExtract } from './real-docs/tsImport.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function parseArgs(argv) {
  const options = { out: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out') options.out = argv[(index += 1)] ?? null
    else throw new Error(`未知参数：${arg}`)
  }
  if (options.out === null) throw new Error('必须指定 --out <路径>')
  return options
}

async function countPages(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, verbosity: 0 })
  try {
    const document = await task.promise
    return document.numPages
  } finally {
    try {
      await task.destroy()
    } catch {
      /* 释放失败不影响已读到的页数 */
    }
  }
}

/** 候选的“身份面”：ID、页码、状态、原因码、逐项 evidenceKey（不改任何值）。 */
function describeCandidate(candidate, modules) {
  const fields = modules.candidateNumericFields(candidate).map(({ field, value }) => ({
    field,
    evidenceKeys: value.evidence.map((item) => modules.evidenceKey(item)),
  }))
  return {
    candidateId: candidate.candidateId,
    kind: candidate.kind,
    groupId: candidate.groupId,
    page: candidate.page,
    status: candidate.status,
    reasonCodes: [...candidate.reasonCodes],
    evidenceKeys: candidate.evidence.map((item) => modules.evidenceKey(item)),
    fields,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const corpusDir = process.env.REAL_DOC_CORPUS ?? defaultCorpusDir()
  const manifestPath = path.join(repoRoot, MANIFEST_RELATIVE_PATH)
  const manifest = loadManifest(manifestPath)
  const verified = verifyCorpus(manifest, corpusDir)
  const modules = await loadExtraction()
  const { extractPdfTextPages } = await loadPdfTextExtract()
  const evidenceJson = await loadEvidenceJson()

  const documents = []
  for (const entry of verified) {
    const pages = await countPages(entry.bytes)
    if (pages !== entry.doc.pages) {
      throw new CorpusError(
        'CORPUS_MISMATCH',
        `${entry.doc.file} 页数不符：manifest=${entry.doc.pages}，实际=${pages}`,
      )
    }
    const rawPages = await extractPdfTextPages(entry.bytes, { from: 1, to: pages }, { ...READ_BUDGET })
    const layer = modules.buildPdfTextLayer(rawPages)
    const source = {
      documentId: `real-doc-${entry.doc.id}`,
      revisionId: `real-doc-${entry.doc.id}-${entry.sha256.slice(0, 12)}`,
      sha256: entry.sha256,
      blobKey: `corpus:${entry.doc.file}`,
      pageCount: pages,
    }
    const draft = modules.buildExtractionDraft({
      projectId: 'real-doc-baseline',
      baseToken: 'real-doc-baseline-1',
      source,
      pageRange: { from: 1, to: pages },
      layer,
    })
    const candidates = draft.candidates.map((candidate) => describeCandidate(candidate, modules))
    documents.push({
      id: entry.doc.id,
      file: entry.doc.file,
      pages,
      draftId: draft.draftId,
      idempotencyKey: draft.idempotencyKey,
      extractorVersion: draft.extractorVersion,
      candidateCount: candidates.length,
      candidateArraySha256: sha256(JSON.stringify(candidates)),
      candidates,
      issues: draft.issues.map((issue) => ({
        issueId: issue.issueId,
        code: issue.code,
        severity: issue.severity,
        page: issue.page,
        candidateIds: [...issue.candidateIds],
      })),
    })
    process.stderr.write(`${entry.doc.id}: ${candidates.length} 候选\n`)
  }

  const payload = {
    probe: 'evidence-ref-candidates',
    corpusDirKind: 'REAL_DOC_CORPUS（本机路径不写入证据）',
    rules: {
      extractorVersion: modules.EXTRACTOR_VERSION,
      maxExtractionPages: modules.MAX_EXTRACTION_PAGES,
      readBudget: READ_BUDGET,
    },
    totals: {
      documents: documents.length,
      candidates: documents.reduce((sum, doc) => sum + doc.candidateCount, 0),
    },
    documents,
  }
  const text = evidenceJson.serializeEvidence(payload)
  const violations = evidenceJson.evidenceViolations(text)
  if (violations.length > 0) {
    throw new Error(`证据 JSON 自检失败：${violations.join('; ')}`)
  }
  writeFileSync(path.resolve(repoRoot, options.out), text)
  console.log(
    `已写 ${options.out}：${payload.totals.documents} 份 / ${payload.totals.candidates} 候选`,
  )
  for (const doc of documents) {
    console.log(`${doc.id} 候选=${doc.candidateCount} draft=${doc.draftId} sha=${doc.candidateArraySha256}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
