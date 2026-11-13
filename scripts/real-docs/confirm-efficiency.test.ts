/**
 * L2 确认效率：真实语料分组回归（专用配置 vitest.realdocs.config.ts）。
 *
 * 用真实 6 份 PDF 跑真实提取器，再用 UI 同一个分组纯函数统计：
 * - 候选/待确认/阻塞必须仍是 138 / 58 / 80（一行都不许变）；
 * - 仅差单位 45（单值 13 / 同符号多处 32），三类“只能补原文”32 / 2 / 1；
 * - 必须人工单独决策（同符号多处组每组算一条）58 → 11，且 ≤ 25。
 *
 * 不依赖网络；语料缺失/被替换会由 verifyCorpus 直接失败，不静默跳过。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MANIFEST_RELATIVE_PATH,
  READ_BUDGET,
  defaultCorpusDir,
  loadManifest,
  verifyCorpus,
} from '../real-docs/metrics.mjs'
import { loadExtraction, loadPdfTextExtract } from '../real-docs/tsImport.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const corpusDir = process.env.REAL_DOC_CORPUS ?? defaultCorpusDir()

async function measureGroups() {
  const manifest = loadManifest(path.join(repoRoot, MANIFEST_RELATIVE_PATH))
  const verified = verifyCorpus(manifest, corpusDir)
  const ext = await loadExtraction()
  const { extractPdfTextPages } = await loadPdfTextExtract()
  const rows = []
  for (const entry of verified) {
    const pages = entry.doc.pages
    const rawPages = await extractPdfTextPages(entry.bytes, { from: 1, to: pages }, { ...READ_BUDGET })
    const layer = ext.buildPdfTextLayer(rawPages)
    const draft = ext.buildExtractionDraft({
      projectId: 'confirm-efficiency-test',
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
    const groupingAgain = ext.groupConfirmCandidates(draft.candidates)
    const blockedCodes = new Map()
    for (const candidate of draft.candidates) {
      if (candidate.status !== 'blocked') continue
      for (const code of candidate.reasonCodes) {
        blockedCodes.set(code, (blockedCodes.get(code) ?? 0) + 1)
      }
    }
    rows.push({
      id: entry.doc.id,
      file: entry.doc.file,
      candidates: grouping.counts.total,
      pending: grouping.counts.pending,
      blocked: grouping.counts.blocked,
      confirmableSingle: grouping.counts.confirmableSingle,
      confirmableMulti: grouping.counts.confirmableMulti,
      unitOnlySingle: grouping.counts.unitOnlySingle,
      unitOnlyMulti: grouping.counts.unitOnlyMulti,
      blockedByCode: [...blockedCodes].map(([code, count]) => ({ code, count })),
      pendingIndividualDecisions: grouping.pendingIndividualDecisions,
      groupKeys: grouping.groups.map((group) => group.key),
      // 同一份草稿连续分组两次，组序与组内成员顺序必须完全一致。
      stableKeys: JSON.stringify(grouping.groups.map((group) => [group.key, group.candidates.map((c) => c.candidateId)])) ===
        JSON.stringify(groupingAgain.groups.map((group) => [group.key, group.candidates.map((c) => c.candidateId)])),
    })
  }
  return rows
}

describe('L2 真实语料：分组不改变候选/状态数字', () => {
  it('138 / 58 / 80；仅差单位 45；必须单独决策 58 → 11（≤25）', { timeout: 300_000 }, async () => {
    const rows = await measureGroups()
    const sum = (pick: (row: (typeof rows)[number]) => number) =>
      rows.reduce((total, row) => total + pick(row), 0)
    const table = rows
      .map(
        (row) =>
          `${row.id}: 候选 ${row.candidates}（pending ${row.pending}｜blocked ${row.blocked}）` +
          `｜可批量单值 ${row.confirmableSingle}｜多处 ${row.confirmableMulti} 条` +
          `｜仅差单位 ${row.unitOnlySingle}+${row.unitOnlyMulti}｜单独决策 ${row.pendingIndividualDecisions}`,
      )
      .join('\n')
    // 打印逐份表：证据日志直接引用（npm run test:real-docs 的 stdout）。
    console.log(table)

    expect(rows).toHaveLength(6)
    expect(sum((row) => row.candidates)).toBe(138)
    expect(sum((row) => row.pending)).toBe(58)
    expect(sum((row) => row.blocked)).toBe(80)

    const blockedByCode = new Map<string, number>()
    for (const row of rows) {
      for (const item of row.blockedByCode) {
        blockedByCode.set(item.code, (blockedByCode.get(item.code) ?? 0) + item.count)
      }
    }
    expect(Object.fromEntries(blockedByCode)).toEqual({
      UNKNOWN_UNIT: 45,
      FORMULA_UNSUPPORTED: 32,
      NUMBER_UNSUPPORTED: 2,
      UNSUPPORTED_UNIT: 1,
    })

    const unitOnly = sum((row) => row.unitOnlySingle + row.unitOnlyMulti)
    expect(unitOnly).toBe(45)
    expect(sum((row) => row.unitOnlySingle)).toBe(13)
    expect(sum((row) => row.unitOnlyMulti)).toBe(32)

    // 改前：58 条逐条确认；改后：只剩互斥组（每组一条）需要人工单独决策。
    const individual = sum((row) => row.pendingIndividualDecisions)
    expect(individual).toBe(11)
    expect(individual).toBeLessThanOrEqual(25)
    expect(sum((row) => row.confirmableSingle)).toBe(28)

    // 分组键的顺序固定（同一份草稿两次调用完全一致，与 UI 两次打开一致）。
    expect(rows.every((row) => row.stableKeys)).toBe(true)
    expect(rows.map((row) => row.groupKeys)).toHaveLength(6)
  })
})
