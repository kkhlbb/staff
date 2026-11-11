// @vitest-environment node
/**
 * V3.6 多草稿：作用域分组、默认选最新版本、旧草稿判定、可删判定、已确认计数。
 *
 * 全部走真实草稿夹具与真实确认/撤销路径，不手写候选状态；版本号只改字符串，
 * 不伪造候选内容。
 */
import { describe, expect, it } from 'vitest'
import {
  activeConfirmedDecisionCount,
  canDeleteDraft,
  compareExtractorVersions,
  extractorVersionLabel,
  extractorVersionNumber,
  groupExtractionDrafts,
  isDraftSuperseded,
  selectDefaultDraft,
} from './draftScope'
import { buildSyntheticExtractionDraft, SYNTHETIC_DRAFT_SOURCE } from './__fixtures__/draftFixture'
import { confirmCandidate, revokeConfirmation } from './draft'
import type { ExtractionDraft } from './types'

const ACTOR = 'local-operator'
const AT = '2026-11-10T10:00:00.000Z'

function draftOf(version: string, overrides: Partial<ExtractionDraft> = {}): ExtractionDraft {
  const base = buildSyntheticExtractionDraft({
    projectId: 'project-a',
    baseToken: 'base-project-a',
    source: SYNTHETIC_DRAFT_SOURCE,
  })
  return {
    ...base,
    draftId: `draft-${version}`,
    extractorVersion: version,
    idempotencyKey: `${base.idempotencyKey}|${version}`,
    ...overrides,
  }
}

describe('V3.6 规则版本比较', () => {
  it('取版本号末位整数比较（2 > 1，10 > 9），解析不出时按字符串确定性比较', () => {
    expect(extractorVersionNumber('document-extractor-2')).toBe(2)
    expect(extractorVersionNumber('document-extractor-10')).toBe(10)
    expect(extractorVersionNumber('document-extractor')).toBeNull()
    expect(compareExtractorVersions('document-extractor-2', 'document-extractor-1')).toBeGreaterThan(0)
    expect(compareExtractorVersions('document-extractor-10', 'document-extractor-9')).toBeGreaterThan(0)
    expect(compareExtractorVersions('document-extractor-1', 'document-extractor-1')).toBe(0)
    expect(compareExtractorVersions('document-extractor', 'document-extractor')).toBe(0)
    expect(extractorVersionLabel('document-extractor-2')).toBe('v2')
    expect(extractorVersionLabel('document-extractor')).toBe('document-extractor')
  })
})

describe('V3.6 多草稿：默认选最新、旧草稿折叠、可删判定', () => {
  it('默认选中最新的 extractor 版本，与数组顺序无关', () => {
    const oldFirst = [draftOf('document-extractor-1'), draftOf('document-extractor-2')]
    const newFirst = [draftOf('document-extractor-2'), draftOf('document-extractor-1')]
    expect(selectDefaultDraft(oldFirst)?.extractorVersion).toBe('document-extractor-2')
    expect(selectDefaultDraft(newFirst)?.extractorVersion).toBe('document-extractor-2')
  })

  it('同版本取数组中较后的一份；相同版本不算“旧版”（不折叠成旧规则行）', () => {
    const first = draftOf('document-extractor-2', { draftId: 'draft-same-a' })
    const second = draftOf('document-extractor-2', { draftId: 'draft-same-b' })
    const scopes = groupExtractionDrafts([first, second])
    expect(scopes).toHaveLength(1)
    expect(scopes[0]?.current.draftId).toBe('draft-same-b')
    expect(isDraftSuperseded(first, [first, second])).toBe(false)
    expect(isDraftSuperseded(second, [first, second])).toBe(false)
  })

  it('同一 PDF 版本 + 同一页范围才互相取代；不同页范围各自是独立作用域', () => {
    const v1 = draftOf('document-extractor-1')
    const v2 = draftOf('document-extractor-2')
    const otherRange = draftOf('document-extractor-1', {
      draftId: 'draft-other-range',
      pageRange: { from: 2, to: 2 },
    })
    const scopes = groupExtractionDrafts([v1, v2, otherRange])
    expect(scopes).toHaveLength(2)
    expect(scopes[0]?.superseded.map((draft) => draft.draftId)).toEqual(['draft-document-extractor-1'])
    expect(scopes[1]?.current.draftId).toBe('draft-other-range')
    expect(scopes[1]?.superseded).toEqual([])
    // 不同页范围的 v1 不会被同版本的 v2 取代。
    expect(isDraftSuperseded(otherRange, [v1, v2, otherRange])).toBe(false)
    // 旧草稿不可删最新；新草稿永远不可删。
    expect(isDraftSuperseded(v1, [v1, v2])).toBe(true)
    expect(canDeleteDraft(v1, [v1, v2])).toBe(true)
    expect(canDeleteDraft(v2, [v1, v2])).toBe(false)
  })

  it('已确认决定计数只算仍有效的确认（编辑/撤销后不计入）', () => {
    const draft = draftOf('document-extractor-1')
    const pending = draft.candidates.filter((candidate) => candidate.status === 'pending')
    const first = pending[0]!
    expect(activeConfirmedDecisionCount(draft)).toBe(0)
    const confirmed = confirmCandidate(draft, {
      candidateId: first.candidateId,
      editRevision: first.editRevision,
      confirmed: true,
      actor: ACTOR,
      decidedAt: AT,
    })
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    expect(activeConfirmedDecisionCount(confirmed.value)).toBe(1)
    const revoked = revokeConfirmation(confirmed.value, {
      candidateId: first.candidateId,
      editRevision: first.editRevision,
      actor: ACTOR,
      decidedAt: AT,
    })
    expect(revoked.ok).toBe(true)
    if (!revoked.ok) return
    expect(activeConfirmedDecisionCount(revoked.value)).toBe(0)
  })

  it('空项目没有默认草稿（不凭空造一份）', () => {
    expect(selectDefaultDraft([])).toBeNull()
    expect(groupExtractionDrafts([])).toEqual([])
  })
})
