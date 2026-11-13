/**
 * L2 确认效率：分组 / 批量补单位 / 批量确认 / 撤销（纯函数）。
 *
 * 这些用例是 M32、M33 的靶子：
 * - M32：让 confirmCandidateBatch 跳过“同符号多处”互斥 → 本文件（含“整批拒绝”断言）必须红；
 * - M33：让 attestCandidateUnits 把不合格条目也一起改 → “整批 0 写入”断言必须红。
 */
import { describe, expect, it } from 'vitest'
import type { ExtractionCandidate, ExtractionDraft, ExtractionEvidence } from '..'
import {
  attestCandidateUnits,
  confirmCandidate,
  confirmCandidateBatch,
  groupConfirmCandidates,
  isUnitOnlyCandidate,
  planApplication,
  revokeUnitAttestations,
  activeUnitBatches,
} from '..'

const evidence: ExtractionEvidence = {
  documentId: 'doc-1',
  revisionId: 'sr-1',
  sha256: 'a'.repeat(64),
  blobKey: 'blob-1',
  page: 1,
  rectPdf: [100, 600, 140, 615],
  pageBoxPdf: [0, 0, 612, 792],
  textSnippet: '52.20',
  normalizedSnippet: '52.20',
  textItemIndexes: [3],
}

function ring(
  id: string,
  options: {
    symbol?: string
    page?: number
    status?: ExtractionCandidate['status']
    reasonCodes?: ExtractionCandidate['reasonCodes']
    unitText?: string | null
    unit?: 'mm' | null
    text?: string
    occurrence?: { index: number; total: number } | null
    evidence?: ExtractionEvidence[]
    keepUnitOnDeviation?: boolean
  } = {},
): ExtractionCandidate {
  const text = options.text ?? '52.20'
  const unit = options.unit === undefined ? 'mm' : options.unit
  const quantity = {
    text,
    decimals: 2,
    valueQ: unit === null ? null : 522000,
    unitText: options.unitText === undefined ? (unit === null ? null : 'mm') : options.unitText,
    unit,
    evidence: options.evidence ?? [{ ...evidence, textSnippet: text }],
  }
  return {
    candidateId: id,
    kind: 'ring',
    groupId: `ring:${options.symbol ?? id}`,
    rawText: `${options.symbol ?? 'H'} 总长 ${text}`,
    page: options.page ?? 1,
    status: options.status ?? 'pending',
    confidence: 'medium',
    confidenceBasis: ['RULE_TABLE_ROW'],
    reasonCodes: options.reasonCodes ?? [],
    evidence: options.evidence ?? [{ ...evidence, textSnippet: text }],
    editRevision: 0,
    occurrence: options.occurrence ?? null,
    data: {
      symbol: options.symbol ?? null,
      name: '总长',
      nominal: quantity,
      upperDeviation: null,
      lowerDeviation: null,
    },
  }
}

function draft(candidates: ExtractionCandidate[]): ExtractionDraft {
  return {
    draftId: 'draft-l2',
    draftRevision: 1,
    status: 'draft',
    projectId: 'project-a',
    baseToken: 'base-project-a',
    sourceIdentity: {
      documentId: 'doc-1',
      revisionId: 'sr-1',
      sha256: 'a'.repeat(64),
      blobKey: 'blob-1',
      pageCount: 2,
    },
    pageRange: { from: 1, to: 2 },
    extractorVersion: 'document-extractor-6',
    idempotencyKey: 'k',
    candidates,
    issues: [],
    decisions: [],
  }
}

const ACTOR = 'local-operator'
const AT = '2026-11-12T10:00:00.000Z'

describe('分组：按原因码与批量能力', () => {
  it('可确认 / 仅差单位 / 三类阻塞各自成组，组内保持草稿顺序、两次一致', () => {
    const candidates = [
      ring('c-pending-1', { symbol: 'A' }),
      ring('c-unit-1', {
        symbol: 'B',
        status: 'blocked',
        reasonCodes: ['UNKNOWN_UNIT'],
        unit: null,
        unitText: null,
      }),
      ring('c-formula-1', { symbol: 'C', status: 'blocked', reasonCodes: ['FORMULA_UNSUPPORTED'] }),
      ring('c-number-1', { symbol: 'D', status: 'blocked', reasonCodes: ['NUMBER_UNSUPPORTED'] }),
      ring('c-unsupported-1', {
        symbol: 'E',
        status: 'blocked',
        reasonCodes: ['UNSUPPORTED_UNIT'],
      }),
    ]
    const first = groupConfirmCandidates(candidates)
    const second = groupConfirmCandidates(candidates)
    expect(second.groups.map((group) => group.key)).toEqual(first.groups.map((group) => group.key))
    expect(first.groups.map((group) => group.key)).toEqual([
      'confirmable:single',
      'blocked-unit:single',
      'blocked:FORMULA_UNSUPPORTED',
      'blocked:NUMBER_UNSUPPORTED',
      'blocked:UNSUPPORTED_UNIT',
    ])
    expect(first.counts.pending).toBe(1)
    expect(first.counts.blocked).toBe(4)
    expect(first.counts.unitOnlySingle).toBe(1)
    expect(first.groups[0]?.capability).toBe('confirm')
    expect(first.groups[1]?.capability).toBe('attest-unit')
    for (const group of first.groups.slice(2)) {
      expect(group.capability).toBe('none')
      expect(group.hint).toContain('只能补原文或放弃')
    }
    // 组内顺序 = 输入顺序（草稿顺序），不重排。
    expect(first.groups[0]?.candidates.map((candidate) => candidate.candidateId)).toEqual([
      'c-pending-1',
    ])
  })

  it('同符号多处赋值单独成组且不提供批量确认', () => {
    const candidates = [
      ring('m-1', { symbol: 'T', occurrence: { index: 1, total: 3 } }),
      ring('m-2', { symbol: 'T', occurrence: { index: 2, total: 3 } }),
      ring('m-3', { symbol: 'T', occurrence: { index: 3, total: 3 } }),
      ring('s-1', { symbol: 'S' }),
    ]
    const grouping = groupConfirmCandidates(candidates)
    expect(grouping.counts.confirmableMulti).toBe(3)
    expect(grouping.counts.confirmableSingle).toBe(1)
    expect(grouping.pendingIndividualDecisions).toBe(1)
    const multi = grouping.groups.find((group) => group.key === 'confirmable:multi')
    expect(multi?.capability).toBe('none')
    expect(multi?.hint).toContain('只能确认一处')
  })

  it('原因码多于一类的阻塞候选按固定优先级归组（不重复计数）', () => {
    const candidates = [
      ring('x', {
        symbol: 'X',
        status: 'blocked',
        reasonCodes: ['UNKNOWN_UNIT', 'FORMULA_UNSUPPORTED'],
        unit: null,
        unitText: null,
      }),
    ]
    const grouping = groupConfirmCandidates(candidates)
    expect(grouping.counts.blocked).toBe(1)
    expect(grouping.groups.map((group) => group.key)).toEqual(['blocked:FORMULA_UNSUPPORTED'])
    expect(grouping.counts.blockedByCode).toEqual([{ code: 'FORMULA_UNSUPPORTED', count: 1 }])
  })

  it('“仅差单位”判据：唯一 UNKNOWN_UNIT + 缺单位 + 原文可精确解析', () => {
    const good = ring('g', {
      status: 'blocked',
      reasonCodes: ['UNKNOWN_UNIT'],
      unit: null,
      unitText: null,
    })
    expect(isUnitOnlyCandidate(good)).toBe(true)
    expect(isUnitOnlyCandidate({ ...good, status: 'pending', reasonCodes: [] })).toBe(false)
    expect(isUnitOnlyCandidate({ ...good, reasonCodes: ['UNKNOWN_UNIT', 'NUMBER_UNSUPPORTED'] })).toBe(
      false,
    )
    expect(
      isUnitOnlyCandidate(
        ring('bad', {
          status: 'blocked',
          reasonCodes: ['UNKNOWN_UNIT'],
          unit: null,
          unitText: null,
          text: '52.2x',
        }),
      ),
    ).toBe(false)
    expect(
      isUnitOnlyCandidate(ring('has-unit', { status: 'blocked', reasonCodes: ['UNKNOWN_UNIT'] })),
    ).toBe(false)
  })
})

describe('批量补单位', () => {
  it('逐条记 user-attestation、statement 逐字保存、补完变待确认', () => {
    const source = draft([
      ring('u-1', {
        symbol: 'A',
        status: 'blocked',
        reasonCodes: ['UNKNOWN_UNIT'],
        unit: null,
        unitText: null,
        text: '52.20',
      }),
      ring('u-2', {
        symbol: 'B',
        status: 'blocked',
        reasonCodes: ['UNKNOWN_UNIT'],
        unit: null,
        unitText: null,
        text: '20.00',
      }),
    ])
    const statement = '本表单位 mm（2026-11-12 复核）'
    const result = attestCandidateUnits(source, {
      candidateIds: ['u-1', 'u-2'],
      statement,
      actor: ACTOR,
      decidedAt: AT,
      sessionSeq: 3,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const next = result.value.draft
    expect(result.value.unitText).toBe('mm')
    expect(next.candidates.map((candidate) => candidate.status)).toEqual(['pending', 'pending'])
    expect(next.candidates[0]?.reasonCodes).toEqual([])
    const first = next.candidates[0]
    expect(first?.kind).toBe('ring')
    if (first?.kind !== 'ring') return
    expect(first.data.nominal?.unit).toBe('mm')
    expect(first.data.nominal?.unitText).toBe('mm')
    expect(first.data.nominal?.valueQ).toBe(522000)
    const attestation = first.data.nominal?.provenance?.find(
      (ref) => ref.kind === 'user-attestation',
    )
    expect(attestation).toMatchObject({
      kind: 'user-attestation',
      statement,
      actorId: ACTOR,
      sessionSeq: 3,
    })
    // 逐条决定，不合并：2 条候选 → 2 条决定，共享 batchId。
    const decisions = next.decisions.filter((decision) => decision.action === 'attest-unit')
    expect(decisions).toHaveLength(2)
    expect(new Set(decisions.map((decision) => decision.batchId))).toEqual(
      new Set([result.value.batchId]),
    )
    expect(new Set(decisions.map((decision) => decision.decisionId)).size).toBe(2)
    expect(decisions.map((decision) => decision.reason)).toEqual([statement, statement])
    expect(activeUnitBatches(next)).toEqual([
      {
        batchId: result.value.batchId,
        statement,
        decidedAt: AT,
        candidateIds: ['u-1', 'u-2'],
      },
    ])
  })

  it('任一条不是“仅差单位” → 整批拒绝、指出是哪几条、0 写入（M33 靶子）', () => {
    const source = draft([
      ring('ok', {
        symbol: 'A',
        status: 'blocked',
        reasonCodes: ['UNKNOWN_UNIT'],
        unit: null,
        unitText: null,
      }),
      ring('bad-formula', {
        symbol: 'B',
        status: 'blocked',
        reasonCodes: ['FORMULA_UNSUPPORTED'],
      }),
    ])
    const before = JSON.stringify(source)
    const result = attestCandidateUnits(source, {
      candidateIds: ['ok', 'bad-formula'],
      statement: '本表单位 mm',
      actor: ACTOR,
      decidedAt: AT,
      sessionSeq: 1,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('BATCH_NOT_ELIGIBLE')
    expect(result.message).toContain('bad-formula')
    expect(result.message).toContain('整批未执行')
    // 0 写入：调用方拿到的原草稿逐字节不变（函数本身不修改入参）。
    expect(JSON.stringify(source)).toBe(before)
  })

  it('声明里没有单位 / 不是 mm / 互相矛盾 → 拒绝', () => {
    const source = draft([
      ring('u-1', {
        symbol: 'A',
        status: 'blocked',
        reasonCodes: ['UNKNOWN_UNIT'],
        unit: null,
        unitText: null,
      }),
    ])
    const run = (statement: string) =>
      attestCandidateUnits(source, {
        candidateIds: ['u-1'],
        statement,
        actor: ACTOR,
        decidedAt: AT,
        sessionSeq: 1,
      })
    for (const statement of ['表里都是毫米', '本表单位 inch', '本表单位 mm，局部单位 in']) {
      const result = run(statement)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.code).toBe('UNIT_STATEMENT_INVALID')
    }
  })

  it('补单位不改数值文本，也不把别的阻塞一起清掉', () => {
    const source = draft([
      ring('u-1', {
        symbol: 'A',
        status: 'blocked',
        reasonCodes: ['UNKNOWN_UNIT'],
        unit: null,
        unitText: null,
        text: '52.20',
      }),
    ])
    const result = attestCandidateUnits(source, {
      candidateIds: ['u-1'],
      statement: '本表单位 mm',
      actor: ACTOR,
      decidedAt: AT,
      sessionSeq: 1,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const candidate = result.value.draft.candidates[0]
    expect(candidate?.kind).toBe('ring')
    if (candidate?.kind !== 'ring') return
    expect(candidate.data.nominal?.text).toBe('52.20')
    expect(candidate.rawText).toBe(source.candidates[0]?.rawText)
  })
})

describe('批量确认', () => {
  it('单值组整组确认：每条各写一条确认决定', () => {
    const source = draft([ring('p-1', { symbol: 'A' }), ring('p-2', { symbol: 'B' })])
    const result = confirmCandidateBatch(source, {
      candidateIds: ['p-1', 'p-2'],
      actor: ACTOR,
      decidedAt: AT,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.draft.candidates.map((candidate) => candidate.status)).toEqual([
      'confirmed',
      'confirmed',
    ])
    const confirms = result.value.draft.decisions.filter((decision) => decision.action === 'confirm')
    expect(confirms).toHaveLength(2)
    expect(new Set(confirms.map((decision) => decision.decisionId)).size).toBe(2)
    expect(result.value.decisionIds).toHaveLength(2)
  })

  it('同符号多处赋值组 → 整批拒绝（0 写入），指出哪一组（M32 靶子）', () => {
    const source = draft([
      ring('m-1', { symbol: 'T', occurrence: { index: 1, total: 2 } }),
      ring('m-2', { symbol: 'T', occurrence: { index: 2, total: 2 } }),
      ring('s-1', { symbol: 'S' }),
    ])
    const result = confirmCandidateBatch(source, {
      candidateIds: ['m-1', 'm-2', 's-1'],
      actor: ACTOR,
      decidedAt: AT,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('GROUP_ALREADY_CONFIRMED')
    expect(result.message).toContain('同一符号多处赋值只能确认一处')
    expect(result.message).toContain('m-1')
    const confirms = source.decisions.filter((decision) => decision.action === 'confirm')
    expect(confirms).toHaveLength(0)
  })

  it('组里已确认一处时，批量确认另一处也被拒绝', () => {
    const base = draft([
      ring('m-1', { symbol: 'T', occurrence: { index: 1, total: 2 } }),
      ring('m-2', { symbol: 'T', occurrence: { index: 2, total: 2 } }),
    ])
    // 单条确认（逐条动作）可以选其中一处；批量动作一律拒绝该组。
    const single = confirmCandidate(base, {
      candidateId: 'm-1',
      editRevision: 0,
      confirmed: true,
      actor: ACTOR,
      decidedAt: AT,
    })
    expect(single.ok).toBe(true)
    if (!single.ok) return
    const result = confirmCandidateBatch(single.value, {
      candidateIds: ['m-2'],
      actor: ACTOR,
      decidedAt: AT,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('GROUP_ALREADY_CONFIRMED')
  })

  it('阻塞候选混入 → 整批拒绝并指出（不是“批量放行”）', () => {
    const source = draft([
      ring('p-1', { symbol: 'A' }),
      ring('b-1', {
        symbol: 'B',
        status: 'blocked',
        reasonCodes: ['UNKNOWN_UNIT'],
        unit: null,
        unitText: null,
      }),
    ])
    const result = confirmCandidateBatch(source, {
      candidateIds: ['p-1', 'b-1'],
      actor: ACTOR,
      decidedAt: AT,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('BATCH_NOT_ELIGIBLE')
    expect(result.message).toContain('b-1')
  })
})

describe('补单位后的出处与撤销', () => {
  function attested() {
    const source = draft([
      ring('u-1', {
        symbol: 'A',
        status: 'blocked',
        reasonCodes: ['UNKNOWN_UNIT'],
        unit: null,
        unitText: null,
      }),
      ring('u-2', {
        symbol: 'B',
        status: 'blocked',
        reasonCodes: ['UNKNOWN_UNIT'],
        unit: null,
        unitText: null,
      }),
    ])
    const result = attestCandidateUnits(source, {
      candidateIds: ['u-1', 'u-2'],
      statement: '本表单位 mm',
      actor: ACTOR,
      decidedAt: AT,
      sessionSeq: 2,
    })
    if (!result.ok) throw new Error(result.message)
    return result.value
  }

  it('补单位后仍走 planApplication：出处集合完整，会话不符仍然拒绝', () => {
    const value = attested()
    const confirmed = confirmCandidateBatch(value.draft, {
      candidateIds: ['u-1'],
      actor: ACTOR,
      decidedAt: AT,
    })
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    const ok = planApplication(confirmed.value.draft, {
      candidateIds: ['u-1'],
      source: { revisionId: 'sr-1', sha256: 'a'.repeat(64) },
      session: { actorId: ACTOR, sessionSeq: 1, sessionSeqs: [1, 2] },
    })
    expect(ok.ok).toBe(true)
    const noSession = planApplication(confirmed.value.draft, {
      candidateIds: ['u-1'],
      source: { revisionId: 'sr-1', sha256: 'a'.repeat(64) },
    })
    expect(noSession.ok).toBe(false)
    if (noSession.ok) return
    expect(noSession.code).toBe('ATTESTATION_SESSION_MISMATCH')
    // 补单位本身不是确认：未确认的另一条直接送计划仍被拦。
    const unconfirmed = planApplication(value.draft, {
      candidateIds: ['u-2'],
      source: { revisionId: 'sr-1', sha256: 'a'.repeat(64) },
      session: { actorId: ACTOR, sessionSeq: 2 },
    })
    expect(unconfirmed.ok).toBe(false)
    if (unconfirmed.ok) return
    expect(unconfirmed.code).toBe('NOT_CONFIRMED')
  })

  it('整批撤销：单位回到未定、候选回到阻塞，出处只标撤销不删除', () => {
    const value = attested()
    const result = revokeUnitAttestations(value.draft, {
      batchId: value.batchId,
      actor: ACTOR,
      decidedAt: '2026-11-12T11:00:00.000Z',
      reason: '单位声明填错了',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const next = result.value.draft
    expect(next.candidates.map((candidate) => candidate.status)).toEqual(['blocked', 'blocked'])
    for (const candidate of next.candidates) {
      expect(candidate.reasonCodes).toEqual(['UNKNOWN_UNIT'])
      if (candidate.kind !== 'ring') continue
      expect(candidate.data.nominal?.unit).toBeNull()
      expect(candidate.data.nominal?.valueQ).toBeNull()
      const refs = candidate.data.nominal?.provenance ?? []
      const attestation = refs.find((ref) => ref.kind === 'user-attestation')
      expect(attestation).toMatchObject({ kind: 'user-attestation', statement: '本表单位 mm' })
      expect((attestation as { revokedAt?: string | null }).revokedAt).toBe('2026-11-12T11:00:00.000Z')
    }
    expect(activeUnitBatches(next)).toEqual([])
    const revoked = next.decisions.filter(
      (decision) => decision.action === 'revoke' && decision.batchId === value.batchId,
    )
    expect(revoked).toHaveLength(2)
  })

  it('逐条撤销只影响一个候选', () => {
    const value = attested()
    const result = revokeUnitAttestations(value.draft, {
      candidateId: 'u-1',
      actor: ACTOR,
      decidedAt: '2026-11-12T11:00:00.000Z',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const statuses = result.value.draft.candidates.map((candidate) => candidate.status)
    expect(statuses).toEqual(['blocked', 'pending'])
    expect(activeUnitBatches(result.value.draft)[0]?.candidateIds).toEqual(['u-2'])
  })

  it('已确认的候选不能借撤销补单位绕过确认', () => {
    const value = attested()
    const confirmed = confirmCandidateBatch(value.draft, {
      candidateIds: ['u-1'],
      actor: ACTOR,
      decidedAt: AT,
    })
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    const result = revokeUnitAttestations(confirmed.value.draft, {
      batchId: value.batchId,
      actor: ACTOR,
      decidedAt: '2026-11-12T11:00:00.000Z',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('ATTESTATION_CONFIRMED')
    expect(result.message).toContain('u-1')
  })
})
