// @vitest-environment node
/**
 * V3.6 阶段 1 人工确认契约：默认不确认、逐条确认、编辑失效、拒绝不复活、
 * 未经确认不得进入应用计划；并覆盖 M01/M02 变异所针对的两道闸门。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  confirmCandidate,
  editCandidateField,
  mergeExtractionDraft,
  planApplication,
  rejectCandidate,
  type ConfirmRequest,
} from '../draft'
import { buildExtractionDraft } from '../parse'
import { buildPdfTextLayer } from '../textLayer'
import {
  candidateValueSnapshot,
  type ExtractionCandidate,
  type ExtractionDecision,
  type ExtractionDraft,
  type ExtractionSourceIdentity,
} from '../types'
import { fixtureSha256, readPdfTextPages } from './helpers/pdfFixture'

const FIXTURE = 'taskbook-TB-2026-1110.pdf'
const ACTOR = 'local-operator'
const AT = '2026-11-10T10:00:00.000Z'

let draft: ExtractionDraft
let source: ExtractionSourceIdentity

beforeAll(async () => {
  const { pageCount, pages } = await readPdfTextPages(FIXTURE)
  const layer = buildPdfTextLayer(pages)
  source = {
    documentId: 'doc-confirm',
    revisionId: 'rev-confirm',
    sha256: fixtureSha256(FIXTURE),
    blobKey: 'blob-confirm',
    pageCount,
  }
  draft = buildExtractionDraft({
    projectId: 'project-confirm',
    baseToken: 'base-1',
    source,
    pageRange: { from: 1, to: 2 },
    layer,
  })
})

function ring(symbol: string) {
  const found = draft.candidates.find(
    (candidate): candidate is ExtractionCandidate & { kind: 'ring' } =>
      candidate.kind === 'ring' && candidate.data.symbol === symbol,
  )
  if (!found) throw new Error(`缺少组成环 ${symbol}`)
  return found
}

function confirmRequest(candidate: ExtractionCandidate, editRevision = candidate.editRevision): ConfirmRequest {
  return {
    candidateId: candidate.candidateId,
    editRevision,
    confirmed: true,
    actor: ACTOR,
    decidedAt: AT,
  }
}

function replaceCandidate(
  input: ExtractionDraft,
  candidateId: string,
  update: (candidate: ExtractionCandidate) => ExtractionCandidate,
): ExtractionDraft {
  return {
    ...input,
    candidates: input.candidates.map((candidate) =>
      candidate.candidateId === candidateId ? update(candidate) : candidate,
    ),
  }
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const entry of Object.values(value as Record<string, unknown>)) freezeDeep(entry)
  }
  return value
}

describe('V3.6 人工确认：逐条、显式、可失效', () => {
  it('默认草稿没有任何决定；确认一项只确认该项', () => {
    expect(draft.decisions).toEqual([])
    expect(draft.candidates.every((candidate) => candidate.status === 'pending')).toBe(true)
    const h = ring('H')
    const result = confirmCandidate(draft, confirmRequest(h))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const confirmed = result.value
    expect(confirmed.decisions).toHaveLength(1)
    expect(confirmed.draftRevision).toBe(draft.draftRevision + 1)
    const updatedH = confirmed.candidates.find((candidate) => candidate.candidateId === h.candidateId)
    expect(updatedH?.status).toBe('confirmed')
    const others = confirmed.candidates.filter((candidate) => candidate.candidateId !== h.candidateId)
    expect(others.every((candidate) => candidate.status === 'pending')).toBe(true)
    expect(draft.candidates.find((candidate) => candidate.candidateId === h.candidateId)?.status).toBe(
      'pending',
    )
    expect(confirmed.decisions[0]).toMatchObject({
      candidateId: h.candidateId,
      action: 'confirm',
      candidateEditRevision: 0,
      actor: ACTOR,
      decidedAt: AT,
    })
    expect(confirmed.decisions[0].evidence.length).toBeGreaterThan(0)
  })

  it('没有显式 confirmed=true → EXPLICIT_CONFIRMATION_REQUIRED', () => {
    const h = ring('H')
    const request = { ...confirmRequest(h), confirmed: false as unknown as true }
    const result = confirmCandidate(draft, request)
    expect(result).toMatchObject({ ok: false, code: 'EXPLICIT_CONFIRMATION_REQUIRED' })
  })

  it('缺本地操作身份/时间 → 拒绝记录决定', () => {
    const h = ring('H')
    expect(confirmCandidate(draft, { ...confirmRequest(h), actor: '  ' })).toMatchObject({
      ok: false,
      code: 'ACTOR_REQUIRED',
    })
    expect(confirmCandidate(draft, { ...confirmRequest(h), decidedAt: '' })).toMatchObject({
      ok: false,
      code: 'DECIDED_AT_REQUIRED',
    })
  })

  it('编辑代数不匹配 → STALE_EDIT_REVISION，防止拿旧界面确认新值', () => {
    const h = ring('H')
    expect(confirmCandidate(draft, confirmRequest(h, 1))).toMatchObject({
      ok: false,
      code: 'STALE_EDIT_REVISION',
    })
  })

  it('重复确认同一项是幂等的：不重复记录决定', () => {
    const h = ring('H')
    const first = confirmCandidate(draft, confirmRequest(h))
    if (!first.ok) throw new Error(first.message)
    const second = confirmCandidate(first.value, confirmRequest(h))
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.decisions).toHaveLength(1)
    expect(second.value.draftRevision).toBe(first.value.draftRevision)
  })

  it('blocked 候选不能确认', async () => {
    const inchPdf = await readPdfTextPages('bad-inch-unit.pdf')
    const inchDraft = buildExtractionDraft({
      projectId: 'project-inch',
      baseToken: 'base-1',
      source: { ...source, revisionId: 'rev-inch', documentId: 'doc-inch', pageCount: 1 },
      pageRange: { from: 1, to: 1 },
      layer: buildPdfTextLayer(inchPdf.pages),
    })
    const blocked = inchDraft.candidates.find((candidate) => candidate.status === 'blocked')
    if (!blocked) throw new Error('缺少 blocked 候选')
    expect(confirmCandidate(inchDraft, confirmRequest(blocked))).toMatchObject({
      ok: false,
      code: 'CANDIDATE_BLOCKED',
    })
  })
})

describe('V3.6 拒绝与编辑', () => {
  it('拒绝必须写理由；拒绝后不能直接确认复活', () => {
    const part = draft.candidates.find((candidate) => candidate.kind === 'part-dimension')
    if (!part) throw new Error('缺少部件候选')
    expect(
      rejectCandidate(draft, {
        candidateId: part.candidateId,
        editRevision: 0,
        actor: ACTOR,
        decidedAt: AT,
        reason: '',
      }),
    ).toMatchObject({ ok: false, code: 'REASON_REQUIRED' })

    const rejected = rejectCandidate(draft, {
      candidateId: part.candidateId,
      editRevision: 0,
      actor: ACTOR,
      decidedAt: AT,
      reason: '与图纸不符，需人工核对',
    })
    expect(rejected.ok).toBe(true)
    if (!rejected.ok) return
    const updated = rejected.value.candidates.find(
      (candidate) => candidate.candidateId === part.candidateId,
    )
    expect(updated?.status).toBe('rejected')
    expect(rejected.value.decisions[0]).toMatchObject({
      action: 'reject',
      reason: '与图纸不符，需人工核对',
    })
    expect(confirmCandidate(rejected.value, confirmRequest(part))).toMatchObject({
      ok: false,
      code: 'CANDIDATE_REJECTED',
    })
    const again = rejectCandidate(rejected.value, {
      candidateId: part.candidateId,
      editRevision: 0,
      actor: ACTOR,
      decidedAt: AT,
      reason: '重复拒绝',
    })
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.value.decisions).toHaveLength(1)
  })

  it('编辑已确认项：回到待确认，旧决定标记失效，旧代数确认被拒', () => {
    const h = ring('H')
    const confirmed = confirmCandidate(draft, confirmRequest(h))
    if (!confirmed.ok) throw new Error(confirmed.message)
    const nominal = h.kind === 'ring' ? h.data.nominal : null
    if (!nominal) throw new Error('缺少 nominal')
    const edited = editCandidateField(confirmed.value, {
      candidateId: h.candidateId,
      editRevision: 0,
      field: 'nominal',
      text: '52.30',
      unit: 'mm',
      evidence: nominal.evidence,
      actor: ACTOR,
      decidedAt: AT,
      reason: '原文小数点核对',
    })
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    const updated = edited.value.candidates.find((candidate) => candidate.candidateId === h.candidateId)
    expect(updated?.status).toBe('pending')
    expect(updated?.editRevision).toBe(1)
    const oldDecision = edited.value.decisions.find((decision) => decision.action === 'confirm')
    expect(oldDecision?.invalidatedByEditRevision).toBe(1)
    const editDecision = edited.value.decisions.find((decision) => decision.action === 'edit')
    expect(editDecision?.candidateEditRevision).toBe(1)

    expect(confirmCandidate(edited.value, confirmRequest(h, 0))).toMatchObject({
      ok: false,
      code: 'STALE_EDIT_REVISION',
    })
    expect(confirmCandidate(edited.value, confirmRequest(h, 1)).ok).toBe(true)
  })

  it('编辑必须带完整 PDF 证据；精度/字段/拒绝状态都被拦', () => {
    const h = ring('H')
    const nominal = h.kind === 'ring' ? h.data.nominal : null
    if (!nominal) throw new Error('缺少 nominal')
    expect(
      editCandidateField(draft, {
        candidateId: h.candidateId,
        editRevision: 0,
        field: 'nominal',
        text: '52.30',
        unit: 'mm',
        evidence: [],
        actor: ACTOR,
        decidedAt: AT,
        reason: '补值',
      }),
    ).toMatchObject({ ok: false, code: 'EVIDENCE_REQUIRED' })

    expect(
      editCandidateField(draft, {
        candidateId: h.candidateId,
        editRevision: 0,
        field: 'nominal',
        text: '52.30001',
        unit: 'mm',
        evidence: nominal.evidence,
        actor: ACTOR,
        decidedAt: AT,
        reason: '超精度',
      }),
    ).toMatchObject({ ok: false, code: 'VALUE_UNSUPPORTED' })

    const interval = draft.candidates.find((candidate) => candidate.kind === 'interval')
    if (!interval) throw new Error('缺少区间候选')
    expect(
      editCandidateField(draft, {
        candidateId: interval.candidateId,
        editRevision: 0,
        field: 'nominal',
        text: '0.2000',
        unit: 'mm',
        evidence: nominal.evidence,
        actor: ACTOR,
        decidedAt: AT,
        reason: '字段不支持',
      }),
    ).toMatchObject({ ok: false, code: 'FIELD_UNSUPPORTED' })
  })
})

describe('V3.6 应用计划门禁（M01/M02 目标）', () => {
  it('未确认候选不能进入应用计划', () => {
    const h = ring('H')
    expect(
      planApplication(draft, {
        candidateIds: [h.candidateId],
        source: { revisionId: source.revisionId, sha256: source.sha256 },
      }),
    ).toMatchObject({ ok: false, code: 'NOT_CONFIRMED' })
  })

  it('逐条确认后生成只读计划：applied=false，不写项目', () => {
    let working = draft
    for (const candidate of draft.candidates) {
      const result = confirmCandidate(working, confirmRequest(candidate))
      if (!result.ok) throw new Error(result.message)
      working = result.value
    }
    expect(working.candidates.every((candidate) => candidate.status === 'confirmed')).toBe(true)
    const plan = planApplication(working, {
      candidateIds: working.candidates.map((candidate) => candidate.candidateId),
      source: { revisionId: source.revisionId, sha256: source.sha256 },
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.value.applied).toBe(false)
    expect(plan.value.items).toHaveLength(draft.candidates.length)
    const hItem = plan.value.items.find((item) => item.kind === 'ring')
    expect(hItem?.fields.length).toBeGreaterThan(0)
    expect(hItem?.evidence.length).toBeGreaterThan(0)
  })

  it('来源版本/哈希变化 → SOURCE_STALE，旧确认失效', () => {
    const h = ring('H')
    const confirmed = confirmCandidate(draft, confirmRequest(h))
    if (!confirmed.ok) throw new Error(confirmed.message)
    expect(
      planApplication(confirmed.value, {
        candidateIds: [h.candidateId],
        source: { revisionId: 'rev-other', sha256: source.sha256 },
      }),
    ).toMatchObject({ ok: false, code: 'SOURCE_STALE' })
  })

  it('确认后数值被改动 → STALE_DECISION（不只看状态布尔）', () => {
    const h = ring('H')
    const confirmed = confirmCandidate(draft, confirmRequest(h))
    if (!confirmed.ok) throw new Error(confirmed.message)
    const forged = replaceCandidate(confirmed.value, h.candidateId, (candidate) => {
      if (candidate.kind !== 'ring' || !candidate.data.nominal) return candidate
      return {
        ...candidate,
        data: {
          ...candidate.data,
          nominal: { ...candidate.data.nominal, text: '52.21', valueQ: 522100 },
        },
      }
    })
    expect(
      planApplication(forged, {
        candidateIds: [h.candidateId],
        source: { revisionId: source.revisionId, sha256: source.sha256 },
      }),
    ).toMatchObject({ ok: false, code: 'STALE_DECISION' })
  })

  it('M02：有数值但出处为空 → 不能确认，也不能进入应用计划', () => {
    const h = ring('H')
    // ADR-001：provenance 是唯一权威出处集合；旧字段 evidence 保留为 pdf-text 镜像。
    // “出处为空”必须把两者同时清空（解析器写出时二者同源，真实链路不会只空一半）。
    const stripped = replaceCandidate(draft, h.candidateId, (candidate) => {
      if (candidate.kind !== 'ring' || !candidate.data.nominal) return candidate
      return {
        ...candidate,
        data: {
          ...candidate.data,
          nominal: { ...candidate.data.nominal, evidence: [], provenance: [] },
        },
      }
    })
    const strippedCandidate = stripped.candidates.find(
      (candidate) => candidate.candidateId === h.candidateId,
    )
    if (!strippedCandidate) throw new Error('缺少候选')
    expect(confirmCandidate(stripped, confirmRequest(strippedCandidate))).toMatchObject({
      ok: false,
      code: 'EVIDENCE_REQUIRED',
    })

    // 直接伪造“已确认”状态与决定，验证应用门禁本身也检查出处。
    const forgedCandidate: ExtractionCandidate = {
      ...strippedCandidate,
      status: 'confirmed',
    }
    const forgedDecision: ExtractionDecision = {
      decisionId: 'decision-manual',
      candidateId: forgedCandidate.candidateId,
      action: 'confirm',
      candidateEditRevision: forgedCandidate.editRevision,
      decidedAt: AT,
      actor: ACTOR,
      reason: null,
      valueSnapshot: candidateValueSnapshot(forgedCandidate),
      evidence: [],
      invalidatedByEditRevision: null,
    }
    const forged: ExtractionDraft = {
      ...stripped,
      candidates: stripped.candidates.map((candidate) =>
        candidate.candidateId === forgedCandidate.candidateId ? forgedCandidate : candidate,
      ),
      decisions: [forgedDecision],
    }
    expect(
      planApplication(forged, {
        candidateIds: [forgedCandidate.candidateId],
        source: { revisionId: source.revisionId, sha256: source.sha256 },
      }),
    ).toMatchObject({ ok: false, code: 'EVIDENCE_REQUIRED' })
  })

  it('输入草稿被冻结时所有决定仍可执行：纯函数、不原地修改', () => {
    const frozen = freezeDeep(structuredClone(draft))
    const before = JSON.stringify(frozen)
    const h = frozen.candidates.find(
      (candidate) => candidate.kind === 'ring' && candidate.data.symbol === 'H',
    )
    if (!h) throw new Error('缺少 H')
    const confirmed = confirmCandidate(frozen, confirmRequest(h))
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    const nominal = h.kind === 'ring' ? h.data.nominal : null
    if (!nominal) throw new Error('缺少 nominal')
    const edited = editCandidateField(confirmed.value, {
      candidateId: h.candidateId,
      editRevision: 0,
      field: 'nominal',
      text: '52.30',
      unit: 'mm',
      evidence: nominal.evidence,
      actor: ACTOR,
      decidedAt: AT,
      reason: '冻结测试',
    })
    expect(edited.ok).toBe(true)
    const rejected = rejectCandidate(frozen, {
      candidateId: h.candidateId,
      editRevision: 0,
      actor: ACTOR,
      decidedAt: AT,
      reason: '冻结测试',
    })
    expect(rejected.ok).toBe(true)
    expect(JSON.stringify(frozen)).toBe(before)
  })
})

describe('V3.6 幂等合并', () => {
  it('同版本重复提取合并：候选不重复、决定不丢', () => {
    const h = ring('H')
    const confirmed = confirmCandidate(draft, confirmRequest(h))
    if (!confirmed.ok) throw new Error(confirmed.message)
    const merged = mergeExtractionDraft(confirmed.value, draft)
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.value.candidates).toHaveLength(draft.candidates.length)
    expect(merged.value.decisions).toHaveLength(1)
  })

  it('不同 PDF revision 不混用确认', () => {
    const other: ExtractionDraft = {
      ...draft,
      sourceIdentity: { ...draft.sourceIdentity, revisionId: 'rev-other' },
    }
    expect(mergeExtractionDraft(draft, other)).toMatchObject({
      ok: false,
      code: 'SOURCE_IDENTITY_MISMATCH',
    })
  })
})
