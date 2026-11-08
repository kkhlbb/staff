import { describe, expect, it } from 'vitest'
import type { ChainDefinition } from '../domain/types'
import { parseMm } from '../domain/units'
import type { SourceBinding } from '../sources/bindings'
import type { SourceDocument, SourceRevision } from '../sources/types'
import {
  evaluateReviewChecklist,
  findingsForRule,
  REVIEW_RULES_VERSION,
  type ReviewInput,
} from './rules'

const CHAIN: ChainDefinition = {
  terms: [
    {
      id: 't-h',
      symbol: 'H',
      name: '孔',
      nominalQ: parseMm('100'),
      lowerDeviationQ: parseMm('0'),
      upperDeviationQ: parseMm('0.1'),
      sign: 1,
      sourceNote: '',
      termRevision: 1,
    },
    {
      id: 't-b',
      symbol: 'B',
      name: '轴',
      nominalQ: parseMm('99.9'),
      lowerDeviationQ: parseMm('-0.05'),
      upperDeviationQ: parseMm('0'),
      sign: -1,
      sourceNote: '',
      termRevision: 1,
    },
  ],
  target: { minQ: parseMm('0.01'), maxQ: parseMm('0.2') },
  assumptions: '',
}

const DOCUMENT: SourceDocument = {
  id: 'doc-1',
  projectId: 'p-1',
  title: '装配图',
  latestRevisionId: 'rev-2',
}

const REVISION_1: SourceRevision = {
  id: 'rev-1',
  projectId: 'p-1',
  documentId: 'doc-1',
  fileName: '装配图-v1.pdf',
  sha256: 'a'.repeat(64),
  byteSize: 1000,
  pageCount: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  blobKey: 'blob-1',
}

const REVISION_2: SourceRevision = {
  ...REVISION_1,
  id: 'rev-2',
  fileName: '装配图-v2.pdf',
  sha256: 'b'.repeat(64),
  createdAt: '2026-01-02T00:00:00.000Z',
  blobKey: 'blob-2',
}

function binding(overrides: Partial<SourceBinding> = {}): SourceBinding {
  return {
    id: 'bind-h',
    projectId: 'p-1',
    termId: 't-h',
    revisionId: 'rev-2',
    documentId: 'doc-1',
    page: 1,
    rectPdf: [10, 10, 100, 100],
    pageBoxPdf: [0, 0, 600, 800],
    note: '',
    createdAt: '2026-01-03T00:00:00.000Z',
    reviewedTermRevision: 1,
    reviewedAt: '2026-01-03T00:00:00.000Z',
    historicalAcceptance: null,
    ...overrides,
  }
}

function input(overrides: Partial<ReviewInput> = {}): ReviewInput {
  const base: ReviewInput = {
    chain: CHAIN,
    cellErrors: {},
    result: {
      nominalQ: parseMm('0.1'),
      minQ: parseMm('0.05'),
      maxQ: parseMm('0.15'),
      lowerDeviationQ: parseMm('-0.05'),
      upperDeviationQ: parseMm('0.05'),
      toleranceQ: parseMm('0.1'),
      status: 'within',
      lowerMarginQ: parseMm('0.04'),
      upperMarginQ: parseMm('0.05'),
      contributions: [
        { termId: 't-h', toleranceQ: parseMm('0.1') },
        { termId: 't-b', toleranceQ: parseMm('0.05') },
      ],
    },
    relationConfirmed: true,
    relationReviewStale: false,
    relationRevision: 3,
    terms: [
      { id: 't-h', symbol: 'H', name: '孔', termRevision: 1 },
      { id: 't-b', symbol: 'B', name: '轴', termRevision: 1 },
    ],
    bindings: [binding(), binding({ id: 'bind-b', termId: 't-b' })],
    documents: [DOCUMENT],
    revisions: [REVISION_1, REVISION_2],
    availableBlobKeys: new Set(['blob-1', 'blob-2']),
  }
  return { ...base, ...overrides }
}

describe('八规则五状态决策表', () => {
  it('全部满足时：计算满足且审查完成，每条结果带规则版本', () => {
    const summary = evaluateReviewChecklist(input())
    expect(summary.calculation).toMatchObject({
      status: 'within',
      satisfied: true,
    })
    expect(summary.reviewComplete).toBe(true)
    expect(summary.pending).toEqual([])
    expect(summary.hasAnyBinding).toBe(true)
    expect(summary.byStatus.passed).toBe(summary.findings.length)
    for (const finding of summary.findings) {
      expect(finding.ruleVersion).toBe(REVIEW_RULES_VERSION)
      expect(['passed', 'failed', 'unchecked', 'needs-human', 'not-applicable']).toContain(
        finding.status,
      )
    }
    expect(findingsForRule(summary, 'SOURCE_PRESENT')).toHaveLength(2)
    expect(findingsForRule(summary, 'SOURCE_AVAILABLE')).toHaveLength(2)
    expect(findingsForRule(summary, 'SOURCE_CURRENT')).toHaveLength(2)
    expect(findingsForRule(summary, 'SOURCE_VALUE_REVIEWED')).toHaveLength(2)
  })

  it('没有绑定：逐环来源为未检查，绝不因空数组 every() 宣称完成', () => {
    const summary = evaluateReviewChecklist(input({ bindings: [] }))
    expect(summary.hasAnyBinding).toBe(false)
    expect(summary.reviewComplete).toBe(false)
    for (const finding of findingsForRule(summary, 'SOURCE_PRESENT')) {
      expect(finding.status).toBe('unchecked')
      expect(finding.needsAction).toBe(true)
    }
    // 没有绑定就没有逐绑定项，不能凭空生成“通过”。
    expect(findingsForRule(summary, 'SOURCE_AVAILABLE')).toHaveLength(0)
    expect(summary.pending.length).toBe(2)
  })

  it('未设置目标：TARGET_WITHIN 为未检查，不是自动通过', () => {
    const chain: ChainDefinition = { ...CHAIN, target: null }
    const summary = evaluateReviewChecklist(
      input({
        chain,
        result: { ...input().result!, status: 'no-target', lowerMarginQ: null, upperMarginQ: null },
      }),
    )
    expect(
      findingsForRule(summary, 'TARGET_WITHIN').map((finding) => finding.status),
    ).toEqual(['unchecked'])
    expect(summary.calculation).toMatchObject({ status: 'no-target', satisfied: null })
    expect(summary.reviewComplete).toBe(false)
  })

  it('目标不满足是已完成的工程结论：审查可完成但计算不满足', () => {
    const summary = evaluateReviewChecklist(
      input({
        result: { ...input().result!, status: 'outside', lowerMarginQ: -1000, upperMarginQ: -2000 },
      }),
    )
    expect(summary.calculation).toMatchObject({ status: 'outside', satisfied: false })
    expect(summary.reviewComplete).toBe(true)
  })

  it('输入非法：INPUT_VALID 未通过，下游明确不适用（不是通过）', () => {
    const summary = evaluateReviewChecklist(
      input({
        chain: null,
        result: null,
        relationConfirmed: false,
        cellErrors: { 't-h.nominal': '请输入数值' },
      }),
    )
    expect(findingsForRule(summary, 'INPUT_VALID')[0].status).toBe('failed')
    for (const rule of ['CALC_VALID', 'RELATION_CONFIRMED', 'TARGET_WITHIN'] as const) {
      expect(findingsForRule(summary, rule)[0].status).toBe('not-applicable')
    }
    expect(summary.reviewComplete).toBe(false)
    expect(summary.canCreateReport).toBe(false)
    expect(findingsForRule(summary, 'INPUT_VALID')[0].target).toEqual({
      kind: 'term',
      termId: 't-h',
    })
  })

  it('曾经确认但凭据失效：RELATION_CONFIRMED 未通过，改回原值也不恢复', () => {
    const summary = evaluateReviewChecklist(
      input({ relationConfirmed: false, relationReviewStale: true }),
    )
    const relation = findingsForRule(summary, 'RELATION_CONFIRMED')[0]
    expect(relation.status).toBe('failed')
    expect(relation.basis).toContain('不会自动恢复')
    expect(summary.reviewComplete).toBe(false)
  })

  it('从未确认：RELATION_CONFIRMED 待人工确认', () => {
    const summary = evaluateReviewChecklist(
      input({ relationConfirmed: false, relationReviewStale: false }),
    )
    expect(findingsForRule(summary, 'RELATION_CONFIRMED')[0].status).toBe('needs-human')
  })

  it('附件缺失与版本待处置并存时两条规则都出现，不被展示优先级遮住', () => {
    const summary = evaluateReviewChecklist(
      input({
        bindings: [binding({ revisionId: 'rev-1' })],
        availableBlobKeys: new Set(),
      }),
    )
    const available = findingsForRule(summary, 'SOURCE_AVAILABLE')[0]
    const current = findingsForRule(summary, 'SOURCE_CURRENT')[0]
    expect(available.status).toBe('failed')
    expect(current.status).toBe('needs-human')
    expect(available.basis).toContain('附件不在本机')
    expect(current.basis).toContain('已导入更新版本')
  })

  it('历史来源接受：SOURCE_CURRENT 通过并显示理由/范围，但不代替数值核对', () => {
    const summary = evaluateReviewChecklist(
      input({
        bindings: [
          binding({
            revisionId: 'rev-1',
            reviewedTermRevision: null,
            reviewedAt: null,
            historicalAcceptance: {
              reason: '新版只是补充签署页',
              scope: '仅用于本轮尺寸校核',
              acceptedAt: '2026-02-01T00:00:00.000Z',
              latestRevisionId: 'rev-2',
            },
          }),
        ],
      }),
    )
    const current = findingsForRule(summary, 'SOURCE_CURRENT')[0]
    expect(current.status).toBe('passed')
    expect(current.basis).toContain('使用历史来源（已说明）')
    expect(current.basis).toContain('新版只是补充签署页')
    expect(current.basis).toContain('仅用于本轮尺寸校核')
    expect(findingsForRule(summary, 'SOURCE_VALUE_REVIEWED')[0].status).toBe(
      'needs-human',
    )
    expect(summary.reviewComplete).toBe(false)
  })

  it('历史接受之后又导入新版：必须重新处置', () => {
    const summary = evaluateReviewChecklist(
      input({
        bindings: [
          binding({
            revisionId: 'rev-1',
            historicalAcceptance: {
              reason: '旧理由',
              scope: '旧范围',
              acceptedAt: '2026-02-01T00:00:00.000Z',
              latestRevisionId: 'rev-2',
            },
          }),
        ],
        documents: [{ ...DOCUMENT, latestRevisionId: 'rev-3' }],
        revisions: [REVISION_1, REVISION_2, { ...REVISION_2, id: 'rev-3' }],
        availableBlobKeys: new Set(['blob-1', 'blob-2']),
      }),
    )
    const current = findingsForRule(summary, 'SOURCE_CURRENT')[0]
    expect(current.status).toBe('needs-human')
    expect(current.basis).toContain('之后又导入了更新版本')
  })

  it('多绑定局部失效：只影响对应绑定，其他绑定仍通过', () => {
    const summary = evaluateReviewChecklist(
      input({
        terms: [
          { id: 't-h', symbol: 'H', name: '孔', termRevision: 2 },
          { id: 't-b', symbol: 'B', name: '轴', termRevision: 1 },
        ],
        bindings: [binding(), binding({ id: 'bind-b', termId: 't-b' })],
      }),
    )
    const valueReviews = findingsForRule(summary, 'SOURCE_VALUE_REVIEWED')
    expect(
      valueReviews.find((finding) => finding.subject.bindingId === 'bind-h')?.status,
    ).toBe('needs-human')
    expect(
      valueReviews.find((finding) => finding.subject.bindingId === 'bind-b')?.status,
    ).toBe('passed')
  })

  it('侧栏待办按严重程度与对象排序，可通过 target 定位', () => {
    const summary = evaluateReviewChecklist(
      input({
        bindings: [],
        relationConfirmed: false,
        relationReviewStale: true,
      }),
    )
    expect(summary.groups[0].severity).toBe('blocking')
    for (const finding of summary.pending) {
      expect(finding.needsAction).toBe(true)
      expect(finding.action).not.toBeNull()
    }
    const termPending = summary.pending.filter((finding) => finding.scope === 'term')
    expect(termPending.map((finding) => finding.target.kind)).toEqual(['term', 'term'])
  })
})
