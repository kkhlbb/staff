import { describe, expect, it } from 'vitest'
import type { SourceBinding } from './bindings'
import { countBindingsNeedingReview, resolveBindingReview } from './review'

function binding(overrides: Partial<SourceBinding> = {}): SourceBinding {
  return {
    id: 'bind-1',
    projectId: 'p-1',
    termId: 'H',
    revisionId: 'rev-1',
    documentId: 'doc-1',
    page: 1,
    rectPdf: [0, 0, 100, 100],
    pageBoxPdf: [0, 0, 600, 800],
    note: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    reviewedTermRevision: 1,
    reviewedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolveBindingReview：来源核对失效矩阵', () => {
  it('凭据与当前环版本一致且附件可用 → 已核对', () => {
    const review = resolveBindingReview({
      binding: binding(),
      termRevision: 1,
      latestRevisionId: 'rev-1',
      attachmentAvailable: true,
    })
    expect(review).toEqual({ kind: 'reviewed', label: '已核对', needsReview: false })
  })

  it('组成环数值/方向变化（termRevision 递增）→ 该绑定待重新核对', () => {
    const review = resolveBindingReview({
      binding: binding(),
      termRevision: 2,
      latestRevisionId: 'rev-1',
      attachmentAvailable: true,
    })
    expect(review.kind).toBe('stale-term')
    expect(review.needsReview).toBe(true)
  })

  it('改后改回原值：环修订号仍高于凭据，不自动恢复', () => {
    const review = resolveBindingReview({
      binding: binding({ reviewedTermRevision: 1 }),
      termRevision: 3,
      latestRevisionId: 'rev-1',
      attachmentAvailable: true,
    })
    expect(review.kind).toBe('stale-term')
  })

  it('从未核对 → 未核对', () => {
    const review = resolveBindingReview({
      binding: binding({ reviewedTermRevision: null, reviewedAt: null }),
      termRevision: 1,
      latestRevisionId: 'rev-1',
      attachmentAvailable: true,
    })
    expect(review.kind).toBe('unreviewed')
  })

  it('文档已有更新版本 → 待版本复核（优先于数值状态）', () => {
    const review = resolveBindingReview({
      binding: binding(),
      termRevision: 1,
      latestRevisionId: 'rev-2',
      attachmentAvailable: true,
    })
    expect(review.kind).toBe('stale-version')
    expect(review.label).toBe('待版本复核')
  })

  it('附件不在本机 → 来源附件不可用', () => {
    const review = resolveBindingReview({
      binding: binding(),
      termRevision: 1,
      latestRevisionId: 'rev-1',
      attachmentAvailable: false,
    })
    expect(review.kind).toBe('attachment-missing')
  })

  it('组成环已删除 → 组成环已不存在', () => {
    const review = resolveBindingReview({
      binding: binding(),
      termRevision: undefined,
      latestRevisionId: 'rev-1',
      attachmentAvailable: true,
    })
    expect(review.kind).toBe('term-missing')
  })

  it('其他环保留：同一组绑定各自独立判定', () => {
    const reviews = [
      resolveBindingReview({
        binding: binding({ id: 'b-h', termId: 'H' }),
        termRevision: 2,
        latestRevisionId: 'rev-1',
        attachmentAvailable: true,
      }),
      resolveBindingReview({
        binding: binding({ id: 'b-b', termId: 'B', reviewedTermRevision: 4 }),
        termRevision: 4,
        latestRevisionId: 'rev-1',
        attachmentAvailable: true,
      }),
    ]
    expect(reviews[0].kind).toBe('stale-term')
    expect(reviews[1].kind).toBe('reviewed')
    expect(countBindingsNeedingReview(reviews)).toBe(1)
  })
})
