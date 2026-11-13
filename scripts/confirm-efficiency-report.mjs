#!/usr/bin/env node
/**
 * L2 确认效率：真实语料分组度量（一条命令出逐份表 + 汇总 JSON）。
 *
 *   REAL_DOC_CORPUS=~/DSH/tmp/cunlian-v36/real-docs \
 *     node scripts/confirm-efficiency-report.mjs
 *
 * 只读度量：真实 PDF → 真实提取器 → 同一分组纯函数（UI 用的就是它）。
 * 不改抽取规则、不改阈值、不写项目文件。输出：
 * - stdout：逐份分组表（可贴进证据）；
 * - docs/evidence/confirm-efficiency/confirm-efficiency-metrics.json（serializeEvidence）。
 */
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  MANIFEST_RELATIVE_PATH,
  READ_BUDGET,
  defaultCorpusDir,
  loadManifest,
  verifyCorpus,
} from './real-docs/metrics.mjs'
import { loadEvidenceJson, loadExtraction, loadPdfTextExtract } from './real-docs/tsImport.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(repoRoot, 'docs', 'evidence', 'confirm-efficiency')
const OUT_JSON = path.join(OUT_DIR, 'confirm-efficiency-metrics.json')
const corpusDir = process.env.REAL_DOC_CORPUS ?? defaultCorpusDir()
const manifest = loadManifest(path.join(repoRoot, MANIFEST_RELATIVE_PATH))
const verified = verifyCorpus(manifest, corpusDir)
const ext = await loadExtraction()
const { extractPdfTextPages } = await loadPdfTextExtract()
const { serializeEvidence } = await loadEvidenceJson()

const totals = {
  candidates: 0,
  pending: 0,
  blocked: 0,
  unitOnly: 0,
  confirmableSingle: 0,
  confirmableMulti: 0,
  unitOnlySingle: 0,
  unitOnlyMulti: 0,
  formula: 0,
  number: 0,
  unsupported: 0,
  pendingIndividualDecisions: 0,
  afterUnitAttestationIndividualDecisions: 0,
}
const documents = []

for (const entry of verified) {
  const pages = entry.doc.pages
  const rawPages = await extractPdfTextPages(entry.bytes, { from: 1, to: pages }, { ...READ_BUDGET })
  const layer = ext.buildPdfTextLayer(rawPages)
  const draft = ext.buildExtractionDraft({
    projectId: 'confirm-efficiency',
    baseToken: 'confirm-efficiency-1',
    source: {
      documentId: `real-doc-${entry.doc.id}`,
      revisionId: `real-doc-${entry.doc.id}-${entry.sha256.slice(0, 12)}`,
      sha256: entry.sha256,
      blobKey: `corpus:${entry.doc.file}`,
      pageCount: pages,
    },
    pageRange: { from: 1, to: pages },
    layer,
  })
  const grouping = ext.groupConfirmCandidates(draft.candidates)
  const counts = grouping.counts
  // 阻塞原因码按候选逐个统计（与 metrics 基线同一口径；不含“仅差单位”被分走的部分）。
  const blockedCodes = new Map()
  for (const candidate of draft.candidates) {
    if (candidate.status !== 'blocked') continue
    for (const code of candidate.reasonCodes) {
      blockedCodes.set(code, (blockedCodes.get(code) ?? 0) + 1)
    }
  }
  const blockedByCode = Object.fromEntries(blockedCodes)
  const row = {
    id: entry.doc.id,
    file: entry.doc.file,
    pages,
    candidates: counts.total,
    pending: counts.pending,
    blocked: counts.blocked,
    confirmableSingle: counts.confirmableSingle,
    confirmableMulti: counts.confirmableMulti,
    unitOnly: counts.unitOnlySingle + counts.unitOnlyMulti,
    unitOnlySingle: counts.unitOnlySingle,
    unitOnlyMulti: counts.unitOnlyMulti,
    blockedByCode,
    pendingIndividualDecisions: grouping.pendingIndividualDecisions,
    afterUnitAttestationIndividualDecisions: grouping.afterUnitAttestationIndividualDecisions,
    groups: grouping.groups.map((group) => ({
      key: group.key,
      capability: group.capability,
      count: group.candidates.length,
    })),
  }
  documents.push(row)
  totals.candidates += counts.total
  totals.pending += counts.pending
  totals.blocked += counts.blocked
  totals.confirmableSingle += counts.confirmableSingle
  totals.confirmableMulti += counts.confirmableMulti
  totals.unitOnly += counts.unitOnlySingle + counts.unitOnlyMulti
  totals.unitOnlySingle += counts.unitOnlySingle
  totals.unitOnlyMulti += counts.unitOnlyMulti
  totals.formula += blockedByCode.FORMULA_UNSUPPORTED ?? 0
  totals.number += blockedByCode.NUMBER_UNSUPPORTED ?? 0
  totals.unsupported += blockedByCode.UNSUPPORTED_UNIT ?? 0
  totals.pendingIndividualDecisions += grouping.pendingIndividualDecisions
  totals.afterUnitAttestationIndividualDecisions +=
    grouping.afterUnitAttestationIndividualDecisions
  console.log(
    `${row.id} ${row.file}: 候选 ${row.candidates}（pending ${row.pending}｜blocked ${row.blocked}）` +
      ` 仅差单位 ${row.unitOnly}（单值 ${row.unitOnlySingle}/多处 ${row.unitOnlyMulti}）` +
      ` 单值可批量 ${row.confirmableSingle}｜多处 ${row.confirmableMulti} 条 / ${grouping.pendingIndividualDecisions} 组` +
      ` 必须单独决策 ${grouping.pendingIndividualDecisions}`,
  )
}

const operations = {
  before: {
    /** 改前：58 条待确认逐条点击确认（同一符号多处的其余处也要先看过才知道能不能点）。 */
    individualConfirmClicks: totals.pending,
    unitOnlyBatchClicks: 0,
  },
  after: {
    /** 改后：1 次「本组全部确认」+ 每个互斥组 1 次逐组选择。 */
    batchConfirmClicks: 1,
    individualPicks: totals.pendingIndividualDecisions,
    confirmClicks: 1 + totals.pendingIndividualDecisions,
    /** 额外处理 45 条“仅差单位”：开表单 1 + 输入声明 1 + 确认补单位 1。 */
    unitClicks: 2,
    unitInputs: 1,
    total: 1 + totals.pendingIndividualDecisions + 2 + 1,
  },
}

const payload = {
  schemaVersion: 1,
  task: 'L2 确认效率（按原因码分组 / 批量补单位 / 批量确认）',
  corpus: {
    manifest: MANIFEST_RELATIVE_PATH,
    documents: verified.length,
    readBudget: READ_BUDGET,
    extractorVersion: ext.EXTRACTOR_VERSION,
  },
  documents,
  totals,
  operations,
}
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_JSON, serializeEvidence(payload))

console.log('')
console.log(
  `汇总：候选 ${totals.candidates}（pending ${totals.pending}｜blocked ${totals.blocked}）` +
    `｜仅差单位 ${totals.unitOnly}（单值 ${totals.unitOnlySingle}/多处 ${totals.unitOnlyMulti}）` +
    `｜公式 ${totals.formula}｜数值 ${totals.number}｜单位不支持 ${totals.unsupported}`,
)
console.log(
  `必须人工单独决策：${totals.pending} → ${totals.pendingIndividualDecisions}（上限 25）` +
    `；若先补单位，互斥组额外 ${totals.afterUnitAttestationIndividualDecisions} 组选择`,
)
console.log(
  `操作数：改前 ${operations.before.individualConfirmClicks} 次点击 → 改后 58 条确认 ${operations.after.confirmClicks} 次点击` +
    `（1 批量 + ${operations.after.individualPicks} 逐组），加补单位 3 次（2 点击 + 1 输入），共 ${operations.after.total} 次`,
)
console.log(`已写 ${path.relative(repoRoot, OUT_JSON)}`)
