#!/usr/bin/env node
/**
 * 生成 docs/evidence/evidence-ref/evidence-ref.json（证据摘要，走 serializeEvidence）。
 *
 *   node scripts/evidence-ref-record.mjs
 *
 * 只在证据刷新时人工运行；不随测试变化。摘要里的数字全部来自已生成的产物：
 * - real-docs-candidates-{before,after}.json（探针实测的候选身份）
 * - docs/evidence/real-doc-baseline/baseline.json（真实语料基线）
 * 不手写结论，也不复制一份“新的度量”。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEvidenceJson } from './real-docs/tsImport.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidenceDir = path.join(repoRoot, 'docs/evidence/evidence-ref')

function read(relative) {
  return JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'))
}

const before = read('docs/evidence/evidence-ref/real-docs-candidates-before.json')
const after = read('docs/evidence/evidence-ref/real-docs-candidates-after.json')
const baseline = read('docs/evidence/real-doc-baseline/baseline.json')

const beforeByDoc = new Map(before.documents.map((doc) => [doc.id, doc]))
const afterByDoc = new Map(after.documents.map((doc) => [doc.id, doc]))

const documents = baseline.documents.map((row) => {
  const beforeDoc = beforeByDoc.get(row.id)
  const afterDoc = afterByDoc.get(row.id)
  if (beforeDoc === undefined || afterDoc === undefined) {
    throw new Error(`缺少候选身份快照：${row.id}`)
  }
  return {
    id: row.id,
    file: row.file,
    pages: row.pages,
    candidates: row.candidates.total,
    pending: row.candidates.pending,
    blocked: row.candidates.blocked,
    idempotencyKey: { before: beforeDoc.idempotencyKey, after: afterDoc.idempotencyKey },
    draftId: { before: beforeDoc.draftId, after: afterDoc.draftId },
    candidateArraySha256: {
      before: beforeDoc.candidateArraySha256,
      after: afterDoc.candidateArraySha256,
    },
    identical: beforeDoc.candidateArraySha256 === afterDoc.candidateArraySha256,
    candidateIds: afterDoc.candidates.map((candidate) => candidate.candidateId),
  }
})

const payload = {
  adr: 'ADR-001 第 2 步：EvidenceRef 泛化（PDF 路径零变化）',
  branch: 'agent/evidence-ref',
  baselineCommit: '8fa7531',
  rules: after.rules,
  totals: {
    documents: documents.length,
    candidatesBefore: before.totals.candidates,
    candidatesAfter: after.totals.candidates,
    pending: baseline.summary.candidates.pending,
    blocked: baseline.summary.candidates.blocked,
  },
  documents,
  pageRangeProbe: baseline.summary.pageRangeProbe,
  invariants: {
    I1: 'isProvenanceCompleteness 是唯一闸门；pdf-text 分支与改前逐条等价；M02 仍红',
    I2: '出处空数组 = 非法（domain 用例与项目文件校验各一条）',
    I3: 'pdf 看 revision sha、image 看图片 sha、attestation 只认显式撤销',
    I5: '候选数/ID/evidenceKey/幂等键逐份逐项一致（本文件 candidateArraySha256 全等）',
  },
}

const evidenceJson = await loadEvidenceJson()
const text = evidenceJson.serializeEvidence(payload)
const violations = evidenceJson.evidenceViolations(text)
if (violations.length > 0) {
  throw new Error(`证据 JSON 自检失败：${violations.join('; ')}`)
}
writeFileSync(path.join(evidenceDir, 'evidence-ref.json'), text)
console.log(
  `已写 docs/evidence/evidence-ref/evidence-ref.json：${documents.length} 份，` +
    `候选 ${payload.totals.candidatesBefore} → ${payload.totals.candidatesAfter}，` +
    `全部候选数组哈希一致 = ${documents.every((doc) => doc.identical)}`,
)
