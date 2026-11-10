// @vitest-environment node
/**
 * V3.6 体验补丁：入口角标的计数与文案（只读 project.extractionDrafts）。
 *
 * 证明：
 * - 计数来自提取草稿状态（pending/blocked 为未决），不是会话内存或 UI 状态；
 * - 已确认/已拒绝全部处理完 → 无角标（不显示 0，也不显示空徽标）；
 * - 多份草稿（不同页范围）逐份累加；
 * - 走真实领域路径确认/拒绝，不手写候选状态。
 */
import { describe, expect, it } from 'vitest'
import {
  countPendingExtractionCandidates,
  pendingExtractionBadgeLabel,
  pendingExtractionBadgeTitle,
} from './pending'
import {
  buildSyntheticExtractionDraft,
  SYNTHETIC_DRAFT_SOURCE,
} from './__fixtures__/draftFixture'
import { confirmCandidate, rejectCandidate } from './draft'
import type { ExtractionCandidate, ExtractionDraft } from './types'

const ACTOR = 'local-operator'
const AT = '2026-11-10T10:00:00.000Z'

function fixtureDraft(): ExtractionDraft {
  return buildSyntheticExtractionDraft({
    projectId: 'project-a',
    baseToken: 'base-project-a',
    source: SYNTHETIC_DRAFT_SOURCE,
  })
}

function statuses(draft: ExtractionDraft): string[] {
  return draft.candidates.map((candidate) => candidate.status)
}

function candidatesOf(draft: ExtractionDraft, status: ExtractionCandidate['status']): ExtractionCandidate[] {
  return draft.candidates.filter((candidate) => candidate.status === status)
}

/** 全部处理：待确认的确认，阻塞的拒绝（阻塞不能确认）。 */
function decideAll(draft: ExtractionDraft): ExtractionDraft {
  let current = draft
  for (const candidate of candidatesOf(draft, 'pending')) {
    const result = confirmCandidate(current, {
      candidateId: candidate.candidateId,
      editRevision: candidate.editRevision,
      confirmed: true,
      actor: ACTOR,
      decidedAt: AT,
    })
    if (!result.ok) throw new Error(`确认失败：${result.code}`)
    current = result.value
  }
  for (const candidate of candidatesOf(draft, 'blocked')) {
    const result = rejectCandidate(current, {
      candidateId: candidate.candidateId,
      editRevision: candidate.editRevision,
      actor: ACTOR,
      decidedAt: AT,
      reason: '不支持运算符，改人工录入',
    })
    if (!result.ok) throw new Error(`拒绝失败：${result.code}`)
    current = result.value
  }
  return current
}

describe('V3.6 提取入口角标：计数与文案', () => {
  it('合成夹具走真实解析路径：4 条待确认 + 1 条阻塞', () => {
    const draft = fixtureDraft()
    expect(draft.candidates).toHaveLength(5)
    expect(statuses(draft).filter((status) => status === 'pending')).toHaveLength(4)
    expect(statuses(draft).filter((status) => status === 'blocked')).toHaveLength(1)
  })

  it('有未决项：角标文本与一句话说明都由草稿状态导出', () => {
    const counts = countPendingExtractionCandidates([fixtureDraft()])
    expect(counts).toEqual({ pending: 4, blocked: 1, total: 5 })
    expect(pendingExtractionBadgeLabel(counts)).toBe('待确认 4 · 阻塞 1')
    expect(pendingExtractionBadgeTitle(counts)).toBe('有 5 项提取候选待处理（4 待确认、1 阻塞）')
  })

  it('只有待确认：角标不显示阻塞 0', () => {
    const counts = countPendingExtractionCandidates([{ ...fixtureDraft(), candidates: candidatesOf(fixtureDraft(), 'pending') }])
    expect(counts).toEqual({ pending: 4, blocked: 0, total: 4 })
    expect(pendingExtractionBadgeLabel(counts)).toBe('待确认 4')
    expect(pendingExtractionBadgeTitle(counts)).toBe('有 4 项提取候选待处理（4 待确认）')
  })

  it('全部确认/拒绝后：无角标（null，不是 0 或空字符串）', () => {
    const decided = decideAll(fixtureDraft())
    expect(statuses(decided).sort()).toEqual(['confirmed', 'confirmed', 'confirmed', 'confirmed', 'rejected'])
    const counts = countPendingExtractionCandidates([decided])
    expect(counts).toEqual({ pending: 0, blocked: 0, total: 0 })
    expect(pendingExtractionBadgeLabel(counts)).toBeNull()
    expect(pendingExtractionBadgeTitle(counts)).toBeNull()
  })

  it('多份草稿（不同页范围）逐份累加；已失效不计入未决', () => {
    const second = { ...fixtureDraft(), draftId: 'draft-2', idempotencyKey: 'other-range' }
    const withStale: ExtractionDraft = {
      ...fixtureDraft(),
      draftId: 'draft-3',
      candidates: fixtureDraft().candidates.map((candidate) => ({ ...candidate, status: 'stale' as const })),
    }
    const counts = countPendingExtractionCandidates([fixtureDraft(), second, withStale])
    expect(counts).toEqual({ pending: 8, blocked: 2, total: 10 })
    expect(pendingExtractionBadgeLabel(counts)).toBe('待确认 8 · 阻塞 2')
  })
})
