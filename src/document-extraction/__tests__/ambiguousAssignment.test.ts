// @vitest-environment node
/**
 * V3.6 体验修订：同一符号多处赋值 → 逐处出候选（不再整批阻塞）。
 *
 * 样例 PDF（scripts/make-ambiguous-sample.cjs 生成，文本层）：
 * - A0 三处不同取值：0.100 / 0.200 / 0.150 mm → 3 条待确认候选，第 1/3、2/3、3/3 处；
 * - B0 三处相同取值：0.500 mm ×3 → 合并成 1 条候选；
 * - C0 三处，其中一处缺单位（0.350 无单位）→ 2 条候选 + 1 条 UNKNOWN_UNIT issue。
 *
 * 互斥：同一 group 确认一条后，其余处不能确认（GROUP_ALREADY_CONFIRMED）；
 * 撤销后恢复可选；绝不允许同一 group 两条已确认。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { buildExtractionDraft } from '../parse'
import { buildPdfTextLayer } from '../textLayer'
import {
  confirmCandidate,
  findCandidate,
  planApplication,
  revokeConfirmation,
} from '../draft'
import {
  candidateNumericFields,
  isEvidenceComplete,
  type ExtractionCandidate,
  type ExtractionDraft,
  type ExtractionSourceIdentity,
} from '../types'
import { fixtureSha256, readPdfTextPages } from './helpers/pdfFixture'

const FIXTURE = 'ambiguous-assignment.pdf'
const ACTOR = 'test-operator'

let draft: ExtractionDraft
let source: ExtractionSourceIdentity

beforeAll(async () => {
  const { pageCount, pages } = await readPdfTextPages(FIXTURE)
  source = {
    documentId: 'doc-amb',
    revisionId: 'rev-amb',
    sha256: fixtureSha256(FIXTURE),
    blobKey: 'blob-amb',
    pageCount,
  }
  draft = buildExtractionDraft({
    projectId: 'project-amb',
    baseToken: 'base-1',
    source,
    pageRange: { from: 1, to: pageCount },
    layer: buildPdfTextLayer(pages),
  })
})

function ringCandidates(current: ExtractionDraft, symbol: string) {
  return current.candidates.filter(
    (candidate): candidate is ExtractionCandidate & { kind: 'ring' } =>
      candidate.kind === 'ring' && candidate.data.symbol === symbol,
  )
}

function confirm(current: ExtractionDraft, candidateId: string, at: string) {
  const candidate = findCandidate(current, candidateId)
  if (!candidate) throw new Error(`缺少候选 ${candidateId}`)
  return confirmCandidate(current, {
    candidateId,
    editRevision: candidate.editRevision,
    confirmed: true,
    actor: ACTOR,
    decidedAt: at,
  })
}

describe('同一符号多处赋值：逐处候选', () => {
  it('A0 三处不同取值 → 3 条候选，全部待确认，第 1/3～3/3 处，不按先后择优', () => {
    const a0 = ringCandidates(draft, 'A0')
    expect(a0).toHaveLength(3)
    expect(a0.every((candidate) => candidate.status === 'pending')).toBe(true)
    expect(a0.every((candidate) => candidate.reasonCodes.length === 0)).toBe(true)
    expect(a0.map((candidate) => candidate.occurrence)).toEqual([
      { index: 1, total: 3 },
      { index: 2, total: 3 },
      { index: 3, total: 3 },
    ])
    expect(a0.map((candidate) => candidate.data.nominal?.text)).toEqual(['0.100', '0.200', '0.150'])
    expect(a0.every((candidate) => candidate.data.nominal?.unit === 'mm')).toBe(true)
    expect(new Set(a0.map((candidate) => candidate.candidateId)).size).toBe(3)
  })

  it('每条候选只带自己那一处的出处（页/选区/片段/item 索引），不混入其它处', () => {
    const a0 = ringCandidates(draft, 'A0')
    const rects = a0.map((candidate) => candidate.evidence[0]?.rectPdf.join(','))
    expect(new Set(rects).size).toBe(3)
    for (const candidate of a0) {
      expect(candidate.page).toBe(1)
      const evidence = [
        ...candidate.evidence,
        ...candidateNumericFields(candidate).flatMap((item) => item.value.evidence),
      ]
      expect(evidence.length).toBeGreaterThan(0)
      expect(evidence.every((item) => isEvidenceComplete(item))).toBe(true)
      expect(evidence.every((item) => item.textItemIndexes.length > 0)).toBe(true)
      // 出处片段只含本处的数值文本。
      const nominalText = candidate.kind === 'ring' ? candidate.data.nominal?.text : undefined
      const snippets = evidence.map((item) => item.textSnippet).join('|')
      expect(snippets).toContain(nominalText ?? '')
      const otherTexts = ['0.100', '0.200', '0.150'].filter((text) => text !== nominalText)
      for (const other of otherTexts) expect(snippets).not.toContain(other)
    }
  })

  it('AMBIGUOUS_ASSIGNMENT 变成 warning 提示（列出 3 条候选），不再把候选标成阻塞', () => {
    const issue = draft.issues.find((item) => item.code === 'AMBIGUOUS_ASSIGNMENT')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('warning')
    expect(issue?.message).toContain('同一符号只能确认一处')
    expect(issue?.candidateIds).toHaveLength(3)
    expect(draft.candidates.some((candidate) => candidate.status === 'blocked')).toBe(false)
  })

  it('B0 三处取值相同 → 合并成 1 条候选（不刷重复），出处保留 3 处', () => {
    const b0 = ringCandidates(draft, 'B0')
    expect(b0).toHaveLength(1)
    expect(b0[0]?.occurrence ?? null).toBeNull()
    expect(b0[0]?.status).toBe('pending')
    expect(b0[0]?.data.nominal?.text).toBe('0.500')
    expect(b0[0]?.data.nominal?.evidence).toHaveLength(3)
    const rects = new Set(b0[0]?.data.nominal?.evidence.map((item) => item.rectPdf.join(',')))
    expect(rects.size).toBe(3)
  })

  it('C0 一处缺单位 → 2 条候选 + 1 条 issue，不因一处坏掉整组毙掉', () => {
    const c0 = ringCandidates(draft, 'C0')
    expect(c0).toHaveLength(2)
    expect(c0.every((candidate) => candidate.status === 'pending')).toBe(true)
    expect(c0.map((candidate) => candidate.occurrence)).toEqual([
      { index: 1, total: 2 },
      { index: 2, total: 2 },
    ])
    expect(c0.map((candidate) => candidate.data.nominal?.text).sort()).toEqual(['0.300', '0.400'])
    const unresolved = draft.issues.find(
      (item) => item.code === 'UNKNOWN_UNIT' && item.message.includes('C0'),
    )
    expect(unresolved).toBeDefined()
    expect(unresolved?.page).toBe(2)
    expect(unresolved?.message).toContain('该处未进入候选')
    expect(unresolved?.candidateIds).toEqual([])
  })
})

describe('同一符号互斥：只能确认一处，撤销后恢复', () => {
  it('确认第 1 条后第 2、3 条不能确认；撤销后恢复可选', () => {
    const a0 = ringCandidates(draft, 'A0')
    const [first, second, third] = a0
    if (!first || !second || !third) throw new Error('A0 候选不足')

    const confirmed = confirm(draft, first.candidateId, '2026-11-10T10:00:00.000Z')
    if (!confirmed.ok) throw new Error(confirmed.message)
    const afterFirst = confirmed.value
    expect(findCandidate(afterFirst, first.candidateId)?.status).toBe('confirmed')

    const secondTry = confirm(afterFirst, second.candidateId, '2026-11-10T10:01:00.000Z')
    expect(secondTry.ok).toBe(false)
    if (!secondTry.ok) {
      expect(secondTry.code).toBe('GROUP_ALREADY_CONFIRMED')
      expect(secondTry.message).toContain('同一符号只能确认一处')
      expect(secondTry.message).toContain('请先撤销')
    }
    const thirdTry = confirm(afterFirst, third.candidateId, '2026-11-10T10:02:00.000Z')
    expect(thirdTry.ok).toBe(false)

    // 同一 group 里只能有 1 条已确认。
    expect(
      ringCandidates(afterFirst, 'A0').filter((candidate) => candidate.status === 'confirmed'),
    ).toHaveLength(1)
    // 其它符号不受影响。
    const b0 = ringCandidates(afterFirst, 'B0')[0]
    if (!b0) throw new Error('缺少 B0')
    const b0Confirmed = confirm(afterFirst, b0.candidateId, '2026-11-10T10:03:00.000Z')
    expect(b0Confirmed.ok).toBe(true)

    // 撤销后第 2 处恢复可选，且撤销决定留痕、原确认失效。
    const revoked = revokeConfirmation(afterFirst, {
      candidateId: first.candidateId,
      editRevision: findCandidate(afterFirst, first.candidateId)?.editRevision ?? 0,
      actor: ACTOR,
      decidedAt: '2026-11-10T10:04:00.000Z',
    })
    if (!revoked.ok) throw new Error(revoked.message)
    const afterRevoke = revoked.value
    expect(findCandidate(afterRevoke, first.candidateId)?.status).toBe('pending')
    expect(afterRevoke.decisions.some((item) => item.action === 'revoke')).toBe(true)

    const secondRetry = confirm(afterRevoke, second.candidateId, '2026-11-10T10:05:00.000Z')
    expect(secondRetry.ok).toBe(true)
    if (secondRetry.ok) {
      expect(
        ringCandidates(secondRetry.value, 'A0').filter((candidate) => candidate.status === 'confirmed'),
      ).toHaveLength(1)
    }
  })

  it('应用计划只接受唯一一条已确认：两条同符号已确认（手工构造）被拒绝', () => {
    const a0 = ringCandidates(draft, 'A0')
    const [first, second] = a0
    if (!first || !second) throw new Error('A0 候选不足')
    const confirmed = confirm(draft, first.candidateId, '2026-11-10T11:00:00.000Z')
    if (!confirmed.ok) throw new Error(confirmed.message)

    const planOne = planApplication(confirmed.value, {
      candidateIds: [first.candidateId],
      source: { revisionId: source.revisionId, sha256: source.sha256 },
    })
    expect(planOne.ok).toBe(true)

    // 模拟被手工改成 confirmed 的第二条：计划必须拒绝同组两条。
    const tampered: ExtractionDraft = {
      ...confirmed.value,
      candidates: confirmed.value.candidates.map((candidate) =>
        candidate.candidateId === second.candidateId
          ? { ...candidate, status: 'confirmed' as const }
          : candidate,
      ),
    }
    const planTwo = planApplication(tampered, {
      candidateIds: [first.candidateId, second.candidateId],
      source: { revisionId: source.revisionId, sha256: source.sha256 },
    })
    expect(planTwo.ok).toBe(false)
    if (!planTwo.ok) expect(planTwo.code).toBe('GROUP_ALREADY_CONFIRMED')
  })

  it('撤销未确认候选被拒绝；确认后撤销再确认同一候选可行', () => {
    const a0 = ringCandidates(draft, 'A0')[0]
    if (!a0) throw new Error('缺少 A0')
    const early = revokeConfirmation(draft, {
      candidateId: a0.candidateId,
      editRevision: a0.editRevision,
      actor: ACTOR,
      decidedAt: '2026-11-10T12:00:00.000Z',
    })
    expect(early.ok).toBe(false)
    if (!early.ok) expect(early.code).toBe('NOT_CONFIRMED')

    const confirmed = confirm(draft, a0.candidateId, '2026-11-10T12:01:00.000Z')
    if (!confirmed.ok) throw new Error(confirmed.message)
    const revoked = revokeConfirmation(confirmed.value, {
      candidateId: a0.candidateId,
      editRevision: a0.editRevision,
      actor: ACTOR,
      decidedAt: '2026-11-10T12:02:00.000Z',
    })
    if (!revoked.ok) throw new Error(revoked.message)
    const again = confirm(revoked.value, a0.candidateId, '2026-11-10T12:03:00.000Z')
    expect(again.ok).toBe(true)
    // 重复确认同一候选幂等：不新增决定。
    if (again.ok) {
      const repeat = confirm(again.value, a0.candidateId, '2026-11-10T12:04:00.000Z')
      expect(repeat.ok).toBe(true)
      if (repeat.ok) {
        expect(repeat.value.decisions.filter((item) => item.action === 'confirm')).toHaveLength(2)
      }
    }
  })
})
