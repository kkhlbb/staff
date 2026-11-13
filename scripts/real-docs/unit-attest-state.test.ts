/**
 * 「批量补单位做成真状态变更」：真实 6 份语料回归（专用配置 vitest.realdocs.config.ts）。
 *
 * 这张卡要证明的不是“操作变少”，而是**账真的动了**：
 * - 未声明：候选/待确认/阻塞 = 138 / 58 / 80；
 * - 一句「本表单位 mm」真跑 `attestCandidateUnits` 后：138 / 103 / 35；
 * - 每条转过去的候选带 user-attestation（actorId + sessionSeq + turnId + 原话逐字），
 *   且出处完整性判据 `isProvenanceCompleteness` 为真；
 * - 三类“公式/数值/单位不支持”32 / 2 / 1 一条都不许被带上；
 * - 按 batchId 整批撤销后逐项回到 58 / 80，连跑两次一致。
 *
 * 不依赖网络；语料缺失/被替换由 verifyCorpus 直接失败，不静默跳过。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type {
  AttestUnitsValue,
  EvidenceRef,
  ExtractionCandidate,
  ExtractionDraft,
  UserAttestation,
} from '../../src/document-extraction'
import {
  MANIFEST_RELATIVE_PATH,
  READ_BUDGET,
  defaultCorpusDir,
  loadManifest,
  verifyCorpus,
} from './metrics.mjs'
import { loadExtraction, loadPdfTextExtract } from './tsImport.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const corpusDir = process.env.REAL_DOC_CORPUS ?? defaultCorpusDir()
const STATEMENT = '本表单位 mm（2026-11-12 复核）'
const ACTOR = 'local-operator'
const AT = '2026-11-12T00:00:00.000Z'
const BLOCKED_KEEP = ['FORMULA_UNSUPPORTED', 'NUMBER_UNSUPPORTED', 'UNSUPPORTED_UNIT'] as const

interface DocState {
  id: string
  file: string
  draft: ExtractionDraft
  extractorVersion: string
}

interface AttestedRun {
  doc: DocState
  attest: AttestUnitsValue
  revoked?: ExtractionDraft
}

async function buildDrafts(): Promise<DocState[]> {
  const manifest = loadManifest(path.join(repoRoot, MANIFEST_RELATIVE_PATH))
  const verified = verifyCorpus(manifest, corpusDir)
  const ext = await loadExtraction()
  const { extractPdfTextPages } = await loadPdfTextExtract()
  const out: DocState[] = []
  for (const entry of verified) {
    const pages = entry.doc.pages
    const rawPages = await extractPdfTextPages(entry.bytes, { from: 1, to: pages }, { ...READ_BUDGET })
    const layer = ext.buildPdfTextLayer(rawPages)
    const draft = ext.buildExtractionDraft({
      projectId: 'unit-attest-state-test',
      baseToken: 'unit-attest-state-1',
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
    out.push({ id: entry.doc.id, file: entry.doc.file, draft, extractorVersion: draft.extractorVersion })
  }
  return out
}

function statusCounts(candidates: readonly ExtractionCandidate[]) {
  const counts = { pending: 0, blocked: 0, confirmed: 0, rejected: 0, stale: 0 }
  for (const candidate of candidates) {
    counts[candidate.status] += 1
  }
  return counts
}

function blockedCodeCounts(candidates: readonly ExtractionCandidate[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const candidate of candidates) {
    if (candidate.status !== 'blocked') continue
    for (const code of candidate.reasonCodes) counts[code] = (counts[code] ?? 0) + 1
  }
  return counts
}

function unitAttestations(refs: readonly EvidenceRef[]): UserAttestation[] {
  return refs.filter((ref): ref is UserAttestation => ref.kind === 'user-attestation')
}

describe('批量补单位：真状态变更（真实 6 份语料）', () => {
  it(
    '138/58/80 → 138/103/35 → 撤销回 138/58/80，两次一致；三类不支持保持阻塞',
    { timeout: 300_000 },
    async () => {
      const ext = await loadExtraction()
      const docs = await buildDrafts()
      expect(docs).toHaveLength(6)
      expect(docs.every((doc) => doc.extractorVersion === 'document-extractor-6')).toBe(true)

      const sum = (pick: (state: DocState) => number) =>
        docs.reduce((total, state) => total + pick(state), 0)

      // ---------- 未声明 ----------
      const beforeCounts = statusCounts(docs.flatMap((doc) => doc.draft.candidates))
      expect(beforeCounts).toMatchObject({ pending: 58, blocked: 80, confirmed: 0 })
      expect(sum((doc) => doc.draft.candidates.length)).toBe(138)
      expect(blockedCodeCounts(docs.flatMap((doc) => doc.draft.candidates))).toEqual({
        UNKNOWN_UNIT: 45,
        FORMULA_UNSUPPORTED: 32,
        NUMBER_UNSUPPORTED: 2,
        UNSUPPORTED_UNIT: 1,
      })

      // ---------- 批量声明 mm（真跑两遍，逐项一致） ----------
      const runOnce = (label: string): AttestedRun[] => {
        const attestedDrafts: AttestedRun[] = []
        for (const [index, doc] of docs.entries()) {
          const ids = doc.draft.candidates
            .filter((candidate) => ext.isUnitOnlyCandidate(candidate))
            .map((candidate) => candidate.candidateId)
          const result = ext.attestCandidateUnits(doc.draft, {
            candidateIds: ids,
            statement: STATEMENT,
            actor: ACTOR,
            decidedAt: AT,
            sessionSeq: index + 1,
            turnId: `real-doc-attest-${index + 1}`,
            sessionLabel: null,
          })
          expect(result.ok, `${label} ${doc.id}: ${result.ok ? '' : result.message}`).toBe(true)
          if (!result.ok) continue
          expect(result.value.unitText).toBe('mm')
          expect(result.value.candidateIds).toHaveLength(ids.length)
          // 每条都有自己的一条 attest-unit 决定（逐条落盘，不合并）。
          expect(result.value.decisionIds).toHaveLength(ids.length)
          attestedDrafts.push({ doc, attest: result.value })
        }
        return attestedDrafts
      }

      const firstRun = runOnce('first')
      const afterCandidates = firstRun.flatMap((item) => item.attest.draft.candidates)
      const afterCounts = statusCounts(afterCandidates)
      expect(afterCounts).toMatchObject({ pending: 103, blocked: 35, confirmed: 0 })
      expect(afterCandidates).toHaveLength(138)
      expect(blockedCodeCounts(afterCandidates)).toEqual({
        FORMULA_UNSUPPORTED: 32,
        NUMBER_UNSUPPORTED: 2,
        UNSUPPORTED_UNIT: 1,
      })

      const table = firstRun
        .map((item) => {
          const counts = statusCounts(item.attest.draft.candidates)
          return `${item.doc.id} ${item.doc.file}: 候选 ${item.attest.draft.candidates.length}（pending ${counts.pending}｜blocked ${counts.blocked}）｜补上 ${item.attest.candidateIds.length}`
        })
        .join('\n')
      console.log(`未声明 → 声明后（每份）：\n${table}`)

      // ---------- 每条转过去的候选：真出处 + 真单位 + 不含三类不支持 ----------
      const converted = firstRun.flatMap((item) =>
        item.attest.candidateIds.map((candidateId) => ({
          doc: item.doc,
          attest: item.attest,
          candidate: item.attest.draft.candidates.find(
            (entry): entry is ExtractionCandidate => entry.candidateId === candidateId,
          ),
        })),
      )
      expect(converted).toHaveLength(45)
      for (const item of converted) {
        const candidate = item.candidate
        expect(candidate, candidate === undefined ? 'missing' : candidate.candidateId).toBeDefined()
        if (candidate === undefined) continue
        expect(candidate.status).toBe('pending')
        expect(candidate.reasonCodes).toEqual([])
        // 三类“不支持”候选绝不允许出现在转换集合里。
        for (const code of BLOCKED_KEEP) {
          expect(candidate.reasonCodes).not.toContain(code)
        }
        const fields = ext.candidateNumericFields(candidate)
        expect(fields.length).toBeGreaterThan(0)
        for (const { value } of fields) {
          if (value.text === null) continue
          expect(value.unit).toBe('mm')
          expect(value.unitText).toBe('mm')
          expect(value.valueQ).not.toBeNull()
          const attestations = unitAttestations(value.provenance ?? [])
          expect(attestations.length).toBeGreaterThan(0)
          for (const ref of attestations) {
            expect(ref).toMatchObject({
              kind: 'user-attestation',
              actorId: ACTOR,
              statement: STATEMENT,
              fieldPath: `candidate:${candidate.candidateId}:unit`,
            })
            expect(Number.isSafeInteger(ref.sessionSeq) && ref.sessionSeq >= 1).toBe(true)
            expect(typeof ref.turnId === 'string' && ref.turnId.trim() !== '').toBe(true)
            // 唯一出处完整性判据：缺单位候选真的带上断言才算齐全。
            expect(ext.isProvenanceCompleteness(ref)).toBe(true)
          }
        }
      }

      // ---------- 整批撤销：逐项回到 58 / 80 ----------
      const revokeAll = (drafts: AttestedRun[], label: string): void => {
        for (const item of drafts) {
          const result = ext.revokeUnitAttestations(item.attest.draft, {
            batchId: item.attest.batchId,
            actor: ACTOR,
            decidedAt: AT,
            reason: `${label} 整批撤销`,
          })
          expect(result.ok, `${label} ${item.doc.id}: ${result.ok ? '' : result.message}`).toBe(
            true,
          )
          if (!result.ok) continue
          item.revoked = result.value.draft
        }
      }
      revokeAll(firstRun, 'first')
      const revertedCandidates = firstRun.flatMap((item) => item.revoked?.candidates ?? [])
      expect(statusCounts(revertedCandidates)).toEqual(beforeCounts)
      expect(blockedCodeCounts(revertedCandidates)).toEqual(
        blockedCodeCounts(docs.flatMap((doc) => doc.draft.candidates)),
      )
      for (const item of firstRun) {
        const revokedDraft = item.revoked
        expect(revokedDraft).toBeDefined()
        if (revokedDraft === undefined) continue
        expect(ext.activeUnitBatches(revokedDraft)).toEqual([])
        const oldDecisions = revokedDraft.decisions.filter(
          (decision) => decision.action === 'attest-unit',
        )
        expect(oldDecisions).toHaveLength(item.attest.candidateIds.length)
        for (const decision of oldDecisions) {
          expect(decision.invalidatedByEditRevision).not.toBeNull()
        }
        for (const candidateId of item.attest.candidateIds) {
          const candidate = revokedDraft.candidates.find((entry) => entry.candidateId === candidateId)
          expect(candidate?.status).toBe('blocked')
          expect(candidate?.reasonCodes).toContain('UNKNOWN_UNIT')
          if (candidate === undefined) continue
          for (const { value } of ext.candidateNumericFields(candidate)) {
            if (value.text === null) continue
            expect(value.unit).toBeNull()
            expect(value.valueQ).toBeNull()
            const refs = unitAttestations(value.provenance ?? [])
            expect(refs.length).toBeGreaterThan(0)
            // 出处不删除，只标撤销（I4 出处不可抹）。
            for (const ref of refs) expect(ref.revokedAt).toBe(AT)
          }
        }
      }

      // ---------- 第二次：从撤销后的草稿再补一次 → 数字完全一致 ----------
      const secondRun = runOnce('second')
      const secondAfter = statusCounts(
        secondRun.flatMap((item) => item.attest.draft.candidates),
      )
      expect(secondAfter).toEqual(afterCounts)
      expect(secondRun.map((item) => item.attest.candidateIds.length)).toEqual(
        firstRun.map((item) => item.attest.candidateIds.length),
      )
      revokeAll(secondRun, 'second')
      expect(statusCounts(secondRun.flatMap((item) => item.revoked?.candidates ?? []))).toEqual(
        beforeCounts,
      )
    },
  )
})
