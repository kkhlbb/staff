import { describe, expect, it } from 'vitest'
import type { ChainDefinition, DimensionTerm } from '../domain/types'
import {
  createRelationReview,
  isRelationAffectingTermField,
  isRelationConfirmed,
  isRelationReviewStale,
  isTermRevisionBumpingField,
  relationFingerprint,
} from './relation'

function term(overrides: Partial<DimensionTerm> = {}): DimensionTerm {
  return {
    id: 'H',
    symbol: 'H',
    name: '机架',
    nominalQ: 1_000_000,
    lowerDeviationQ: 0,
    upperDeviationQ: 1_000,
    sign: 1,
    sourceNote: '',
    termRevision: 1,
    ...overrides,
  }
}

function chain(overrides: Partial<ChainDefinition> = {}): ChainDefinition {
  return {
    terms: [term(), term({ id: 'B', symbol: 'B', sign: -1 })],
    target: { minQ: 0, maxQ: 1_000 },
    assumptions: '',
    ...overrides,
  }
}

describe('relationFingerprint：只含影响关系的字段', () => {
  it('名称、备注、目标、行顺序不改变指纹', () => {
    const base = chain()
    const renamed = chain({
      terms: [term({ name: '改名' }), term({ id: 'B', symbol: 'B', sign: -1, name: '改名' })],
      target: null,
      assumptions: '任意假设',
    })
    const reordered = chain({ terms: [chain().terms[1], chain().terms[0]] })
    expect(relationFingerprint(renamed.terms)).toBe(relationFingerprint(base.terms))
    expect(relationFingerprint(reordered.terms)).toBe(relationFingerprint(base.terms))
  })

  it('代号、基本尺寸、上下偏差、方向、环身份任一变化都改变指纹', () => {
    const base = relationFingerprint(chain().terms)
    const variants = [
      [term({ symbol: 'H2' }), term({ id: 'B', symbol: 'B', sign: -1 })],
      [term({ nominalQ: 1_000_001 }), term({ id: 'B', symbol: 'B', sign: -1 })],
      [term({ lowerDeviationQ: -1 }), term({ id: 'B', symbol: 'B', sign: -1 })],
      [term({ upperDeviationQ: 1_001 }), term({ id: 'B', symbol: 'B', sign: -1 })],
      [term({ sign: -1 }), term({ id: 'B', symbol: 'B', sign: -1 })],
      [term({ id: 'H-new' }), term({ id: 'B', symbol: 'B', sign: -1 })],
    ]
    for (const terms of variants) {
      expect(relationFingerprint(terms)).not.toBe(base)
    }
  })
})

describe('isRelationConfirmed：凭据 + 修订号 + 指纹', () => {
  it('确认后立即判定为已确认', () => {
    const working = chain()
    const review = createRelationReview(working, 3, '2026-01-01T00:00:00.000Z')
    expect(isRelationConfirmed(working, { relationRevision: 3, relationReview: review })).toBe(
      true,
    )
    expect(isRelationReviewStale(working, { relationRevision: 3, relationReview: review })).toBe(
      false,
    )
  })

  it('修订号递增后旧凭据失效，即使环数据改回原值也不恢复', () => {
    const working = chain()
    const review = createRelationReview(working, 3, '2026-01-01T00:00:00.000Z')

    const edited = chain({
      terms: [term({ upperDeviationQ: 2_000 }), working.terms[1]],
    })
    const stateAfterEdit = { relationRevision: 4, relationReview: review }
    expect(isRelationConfirmed(edited, stateAfterEdit)).toBe(false)
    expect(isRelationReviewStale(edited, stateAfterEdit)).toBe(true)

    // 改回原值：指纹回到相同值，但修订号仍是 4，不自动恢复。
    const reverted = chain()
    expect(isRelationConfirmed(reverted, stateAfterEdit)).toBe(false)
    expect(isRelationReviewStale(reverted, stateAfterEdit)).toBe(true)
  })

  it('没有凭据、没有链、或修订号低于凭据时都判为未确认', () => {
    const working = chain()
    const review = createRelationReview(working, 3, '2026-01-01T00:00:00.000Z')
    expect(isRelationConfirmed(working, { relationRevision: 3, relationReview: null })).toBe(false)
    expect(isRelationConfirmed(null, { relationRevision: 3, relationReview: review })).toBe(false)
    expect(isRelationConfirmed(working, { relationRevision: 2, relationReview: review })).toBe(false)
  })
})

describe('字段分类：与失效矩阵一致', () => {
  it('代号/数值/方向影响关系确认；名称/备注不影响', () => {
    expect(isRelationAffectingTermField('symbol')).toBe(true)
    for (const field of ['nominal', 'lower', 'upper', 'sign'] as const) {
      expect(isRelationAffectingTermField(field)).toBe(true)
    }
    expect(isRelationAffectingTermField('name')).toBe(false)
    expect(isRelationAffectingTermField('sourceNote')).toBe(false)
  })

  it('只有数值与方向提升环修订号；改代号不清来源数值核对', () => {
    expect(isTermRevisionBumpingField('symbol')).toBe(false)
    for (const field of ['nominal', 'lower', 'upper', 'sign'] as const) {
      expect(isTermRevisionBumpingField(field)).toBe(true)
    }
  })
})
