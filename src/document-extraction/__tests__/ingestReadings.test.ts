import { describe, expect, it } from 'vitest'
import { createIntentDraft } from '../../intent/draft'
import { ingestReadings, type IngestReadingsInput } from '../ingestReadings'
import { confirmCandidate, planApplication } from '../draft'
import { confirmCandidateBatch } from '../batch'
import { candidateNumericFields, valueProvenance, isProvenanceCompleteness, provenanceValidity, provenanceKey } from '../types'
const input: IngestReadingsInput = {
  source: { kind: 'pdf-page', revisionId: 'scan', sha256: 'a'.repeat(64), page: 3 },
  statement: '人报数：L1 30，0/-0.2 mm', actorId: '验收转录', at: '2026-11-13T12:00:00.000Z',
  sessionSeq: 1, turnId: 'turn-1', modelId: null,
  readings: [{ kind: 'dimension', symbol: 'L1', nominalQ: 300000, upperDeviationQ: 0, lowerDeviationQ: -2000, unit: 'mm' }],
}
const empty = () => createIntentDraft({ projectId: 'p', session: { actorId: input.actorId, sessionSeq: 1, sessionLabel: null },
  turn: { userText: input.statement, turnId: input.turnId, at: input.at } })
const pending = () => {
  const result = ingestReadings(empty(), input)
  if (!result.ok) throw new Error(result.message)
  return result.value
}
const confirmed = () => {
  const draft = pending(), candidate = draft.candidates[0]!
  const result = confirmCandidate(draft, { candidateId: candidate.candidateId, editRevision: candidate.editRevision,
    confirmed: true, actor: input.actorId, decidedAt: input.at })
  if (!result.ok) throw new Error(result.message)
  return result.value
}
const request = (draft = pending()) => ({ source: draft.sourceIdentity,
  candidateIds: draft.candidates.map((c) => c.candidateId), revisions: [{ revisionId: 'scan', sha256: 'a'.repeat(64) }],
  session: { actorId: input.actorId, sessionSeq: 1 } })

describe('ingest_readings 核心防线 / M46 M47 M48', () => {
  it('M47: 第五支出处逐字保留，PDF evidence 始终空，数值出处不是 pdf-text', () => {
    const draft = pending(), candidate = draft.candidates[0]!
    expect(candidate).toMatchObject({ status: 'pending', requiresVerification: true, batchConfirmable: false, evidence: [] })
    expect(candidate.provenance).toEqual([{ kind: 'agent-read', actorId: input.actorId, at: input.at,
      sessionSeq: 1, turnId: input.turnId, modelId: null, source: input.source, statement: input.statement }])
    for (const { value } of candidateNumericFields(candidate)) {
      expect(value.evidence).toEqual([])
      expect(valueProvenance(value)).toEqual(candidate.provenance)
    }
    expect(JSON.stringify(candidate)).not.toContain('pdf-text')
    expect(JSON.stringify(candidate)).not.toContain('pdf-ocr')
  })
  it('M46: 即使只选一条也不得走批量，整批零写入', () => {
    const draft = pending(), before = JSON.stringify(draft)
    expect(confirmCandidateBatch(draft, { candidateIds: [draft.candidates[0]!.candidateId], actor: input.actorId,
      decidedAt: input.at })).toMatchObject({ ok: false, code: 'BATCH_NOT_ELIGIBLE' })
    expect(JSON.stringify(draft)).toBe(before)
  })
  it('未确认、伪造confirmed无决定、批量决定均不能应用', () => {
    const draft = pending()
    expect(planApplication(draft, request(draft))).toMatchObject({ ok: false, code: 'NOT_CONFIRMED' })
    expect(planApplication({ ...draft, candidates: draft.candidates.map((c) => ({ ...c, status: 'confirmed' })) }, request(draft)).ok).toBe(false)
    const valid = confirmed()
    expect(planApplication({ ...valid, decisions: valid.decisions.map((d) => ({ ...d, confirmationMode: 'batch' })) }, request(valid)))
      .toMatchObject({ ok: false, code: 'NOT_CONFIRMED' })
  })
  it('逐条决定允许计划，出处完整保留', () => {
    const draft = confirmed()
    expect(draft.decisions[0]).toMatchObject({ confirmationMode: 'individual' })
    const plan = planApplication(draft, request(draft))
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.value.items[0]!.provenance[0]).toMatchObject({ kind: 'agent-read' })
  })
  it('M48: 入口必须写 requiresVerification，标记删除/改假后提交必拒', () => {
    const draft = confirmed()
    expect(pending().candidates[0]!.requiresVerification).toBe(true)
    for (const flag of [undefined, false]) {
      expect(planApplication({ ...draft, candidates: draft.candidates.map((c) => ({ ...c, requiresVerification: flag })) }, request(draft)))
        .toMatchObject({ ok: false, code: 'NOT_CONFIRMED' })
    }
  })
  it('去掉batchConfirmable不放行；改会话、来源SHA不放行', () => {
    const draft = confirmed()
    expect(planApplication({ ...draft, candidates: draft.candidates.map((c) => ({ ...c, batchConfirmable: true })) }, request(draft)).ok).toBe(false)
    expect(planApplication(draft, { ...request(draft), session: { actorId: '别人', sessionSeq: 1 } })).toMatchObject({ ok: false, code: 'ATTESTATION_SESSION_MISMATCH' })
    expect(planApplication(draft, { ...request(draft), revisions: [] })).toMatchObject({ ok: false, code: 'SOURCE_STALE' })
  })
  it('更正读数保留candidateId、推进编辑代数，原确认失效', () => {
    const draft = confirmed(), changed = ingestReadings(draft, { ...input, turnId: 'turn-2', readings: [{ ...input.readings[0]!, nominalQ: 3000000 }] })
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    expect(changed.value.candidates[0]!.candidateId).toBe(draft.candidates[0]!.candidateId)
    expect(changed.value.candidates[0]).toMatchObject({ status: 'pending', editRevision: 2 })
    expect(changed.value.decisions[0]!.invalidatedByEditRevision).not.toBeNull()
    expect(planApplication(changed.value, request(changed.value)).ok).toBe(false)
  })
  it.each(['actorId', 'turnId', 'statement', 'at'] as const)('缺 %s 不产候选', (field) => {
    expect(ingestReadings(empty(), { ...input, [field]: '' }).ok).toBe(false)
  })
  it.each([NaN, 1.5, Number.MAX_SAFE_INTEGER, -1])('拒绝非法基本尺寸q %s', (nominalQ) => {
    expect(ingestReadings(empty(), { ...input, readings: [{ ...input.readings[0]!, nominalQ }] }).ok).toBe(false)
  })
  it('图片/未来模型出处完整性与失效身份先就位，不能假装为PDF文本', () => {
    const result = ingestReadings(empty(), { ...input, modelId: 'future-vision', source: { kind: 'image', imageId: 'image-1', sha256: 'b'.repeat(64) } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ref = result.value.candidates[0]!.provenance![0]!
    expect(isProvenanceCompleteness(ref)).toBe(true)
    expect(provenanceKey(ref)).toContain('agent-read')
    expect(provenanceValidity(ref, { revisions: [], images: [{ imageId: 'image-1', sha256: 'b'.repeat(64) }] })).toBe('valid')
    expect(provenanceValidity(ref, { revisions: [], images: [] })).toBe('stale')
  })
})
