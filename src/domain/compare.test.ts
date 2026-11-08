import { fc, test as propTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { calculateChain } from './calculate'
import { compareChains, type Diff } from './compare'
import type { ChainDefinition, DimensionTerm } from './types'
import { parseMm } from './units'

const mm = parseMm

const deltaFields = ['minQ', 'maxQ', 'toleranceQ', 'lowerMarginQ', 'upperMarginQ'] as const

function makeTerm(
  id: string,
  sign: 1 | -1,
  nominal: string,
  lowerDeviation: string,
  upperDeviation: string,
): DimensionTerm {
  return {
    id,
    symbol: id,
    name: id,
    nominalQ: mm(nominal),
    lowerDeviationQ: mm(lowerDeviation),
    upperDeviationQ: mm(upperDeviation),
    sign,
    sourceNote: '',
    termRevision: 1,
  }
}

function makeTarget(min: string, max: string): { minQ: number; maxQ: number } {
  return { minQ: mm(min), maxQ: mm(max) }
}

function makeChain(
  terms: DimensionTerm[],
  target: ChainDefinition['target'] = null,
): ChainDefinition {
  return { terms, target, assumptions: '' }
}

function caseA(): ChainDefinition {
  return makeChain(
    [
      makeTerm('H', 1, '100.0000', '0.0000', '0.1000'),
      makeTerm('B1', -1, '20.0000', '-0.0200', '0.0000'),
      makeTerm('S', -1, '59.8000', '-0.0500', '0.0500'),
      makeTerm('B2', -1, '20.0000', '-0.0200', '0.0000'),
    ],
    makeTarget('0.1000', '0.3000'),
  )
}

function caseB(): ChainDefinition {
  return makeChain(
    [
      makeTerm('H', 1, '100.0000', '0.0000', '0.0300'),
      makeTerm('B1', -1, '20.0000', '-0.0200', '0.0000'),
      makeTerm('S', -1, '59.8000', '-0.0200', '0.0200'),
      makeTerm('B2', -1, '20.0000', '-0.0200', '0.0000'),
    ],
    makeTarget('0.1000', '0.3000'),
  )
}

/** 独立调用 calculateChain，验证 compare 的数值确实来自同一计算入口。 */
function expectDeltasMatchCalculate(
  diff: Diff,
  before: ChainDefinition,
  after: ChainDefinition,
): void {
  const beforeResult = calculateChain(before)
  const afterResult = calculateChain(after)

  for (const field of deltaFields) {
    const beforeValue = beforeResult[field]
    const afterValue = afterResult[field]
    expect(diff[field]).toEqual({
      before: beforeValue,
      after: afterValue,
      delta: beforeValue === null || afterValue === null ? null : afterValue - beforeValue,
    })
  }

  expect(diff.statusBefore).toBe(beforeResult.status)
  expect(diff.statusAfter).toBe(afterResult.status)
}

function expectAllDeltasZero(diff: Diff): void {
  for (const field of deltaFields) {
    expect(diff[field].before).toBe(diff[field].after)
    expect(diff[field].delta).toBe(0)
  }
}

describe('相同链', () => {
  it('Diff 为空且所有 delta 为 0', () => {
    const diff = compareChains(caseA(), caseA())

    expect(diff.addedTermIds).toEqual([])
    expect(diff.removedTermIds).toEqual([])
    expect(diff.orderChanged).toBe(false)
    expect(diff.termChanges).toEqual([])
    expect(diff.targetChanged).toBe(false)
    expectAllDeltasZero(diff)
    expect(diff.statusBefore).toBe('outside')
    expect(diff.statusAfter).toBe('outside')
  })

  it('无目标时相同链的裕量为 null，delta 也为 null', () => {
    const diff = compareChains(makeChain(caseA().terms), makeChain(caseA().terms))

    expect(diff.targetChanged).toBe(false)
    expect(diff.lowerMarginQ).toEqual({ before: null, after: null, delta: null })
    expect(diff.upperMarginQ).toEqual({ before: null, after: null, delta: null })
    expect(diff.minQ.delta).toBe(0)
    expect(diff.maxQ.delta).toBe(0)
    expect(diff.toleranceQ.delta).toBe(0)
  })
})

describe('文档第 8 节案例与单字段修改', () => {
  it('案例 A 只改 H 上偏差：delta 等于两次 calculateChain 结果相减', () => {
    const before = caseA()
    const after: ChainDefinition = {
      ...caseA(),
      terms: caseA().terms.map((term) =>
        term.id === 'H' ? { ...term, upperDeviationQ: mm('0.0300') } : term,
      ),
    }
    const diff = compareChains(before, after)

    expectDeltasMatchCalculate(diff, before, after)
    expect(diff.termChanges).toEqual([
      { termId: 'H', field: 'upperDeviationQ', before: mm('0.1000'), after: mm('0.0300') },
    ])
    expect(diff.minQ.delta).toBe(0)
    expect(diff.maxQ.delta).toBe(mm('-0.0700'))
    expect(diff.toleranceQ.delta).toBe(mm('-0.0700'))
  })

  it('案例 A → B：Cmin +0.0300mm、Cmax −0.1000mm、Tc −0.1300mm', () => {
    const before = caseA()
    const after = caseB()
    const diff = compareChains(before, after)

    // 文档第 8 节案例 B 给出的三项变化，原样验证、不改数值。
    expect(diff.minQ).toEqual({
      before: mm('0.1500'),
      after: mm('0.1800'),
      delta: mm('0.0300'),
    })
    expect(diff.maxQ).toEqual({
      before: mm('0.3900'),
      after: mm('0.2900'),
      delta: mm('-0.1000'),
    })
    expect(diff.toleranceQ).toEqual({
      before: mm('0.2400'),
      after: mm('0.1100'),
      delta: mm('-0.1300'),
    })

    expect(diff.lowerMarginQ).toEqual({
      before: mm('0.0500'),
      after: mm('0.0800'),
      delta: mm('0.0300'),
    })
    expect(diff.upperMarginQ).toEqual({
      before: mm('-0.0900'),
      after: mm('0.0100'),
      delta: mm('0.1000'),
    })
    expect(diff.statusBefore).toBe('outside')
    expect(diff.statusAfter).toBe('within')

    expect(diff.addedTermIds).toEqual([])
    expect(diff.removedTermIds).toEqual([])
    expect(diff.orderChanged).toBe(false)
    expect(diff.targetChanged).toBe(false)
    expect(diff.termChanges).toEqual([
      { termId: 'H', field: 'upperDeviationQ', before: mm('0.1000'), after: mm('0.0300') },
      { termId: 'S', field: 'lowerDeviationQ', before: mm('-0.0500'), after: mm('-0.0200') },
      { termId: 'S', field: 'upperDeviationQ', before: mm('0.0500'), after: mm('0.0200') },
    ])

    expectDeltasMatchCalculate(diff, before, after)
  })

  it('termChanges 覆盖 symbol、name、nominalQ、三个偏差、sign、sourceNote', () => {
    const before = caseA()
    const originalH = before.terms.find((term) => term.id === 'H')
    if (originalH === undefined) {
      throw new Error('测试数据缺少 H')
    }
    const changedH: DimensionTerm = {
      ...originalH,
      symbol: 'H2',
      name: '机架（改）',
      nominalQ: mm('101.0000'),
      lowerDeviationQ: mm('0.0100'),
      upperDeviationQ: mm('0.1200'),
      sign: -1,
      sourceNote: '图纸 A-02',
      termRevision: 1,
    }
    const after = makeChain(
      before.terms.map((term) => (term.id === 'H' ? changedH : term)),
      before.target,
    )
    const diff = compareChains(before, after)

    expect(diff.termChanges.map(({ field }) => field)).toEqual([
      'symbol',
      'name',
      'nominalQ',
      'lowerDeviationQ',
      'upperDeviationQ',
      'sign',
      'sourceNote',
    ])
    expect(diff.termChanges).toEqual([
      { termId: 'H', field: 'symbol', before: 'H', after: 'H2' },
      { termId: 'H', field: 'name', before: 'H', after: '机架（改）' },
      { termId: 'H', field: 'nominalQ', before: mm('100.0000'), after: mm('101.0000') },
      {
        termId: 'H',
        field: 'lowerDeviationQ',
        before: mm('0.0000'),
        after: mm('0.0100'),
      },
      {
        termId: 'H',
        field: 'upperDeviationQ',
        before: mm('0.1000'),
        after: mm('0.1200'),
      },
      { termId: 'H', field: 'sign', before: 1, after: -1 },
      { termId: 'H', field: 'sourceNote', before: '', after: '图纸 A-02' },
    ])
    expectDeltasMatchCalculate(diff, before, after)
  })
})

describe('增环、删环与重排', () => {
  it('增环：只记录 addedTermIds，共有环相对顺序不变，不产生 termChanges', () => {
    const before = caseA()
    const extra = makeTerm('X', -1, '1.0000', '0.0000', '0.0100')
    const after = makeChain(
      [...before.terms.slice(0, 2), extra, ...before.terms.slice(2)],
      before.target,
    )
    const diff = compareChains(before, after)

    expect(diff.addedTermIds).toEqual(['X'])
    expect(diff.removedTermIds).toEqual([])
    expect(diff.orderChanged).toBe(false)
    expect(diff.termChanges).toEqual([])
    expect(diff.targetChanged).toBe(false)
    expectDeltasMatchCalculate(diff, before, after)
  })

  it('删环：只记录 removedTermIds，共有环相对顺序不变，不产生 termChanges', () => {
    const before = caseA()
    const after = makeChain(
      before.terms.filter((term) => term.id !== 'B1'),
      before.target,
    )
    const diff = compareChains(before, after)

    expect(diff.addedTermIds).toEqual([])
    expect(diff.removedTermIds).toEqual(['B1'])
    expect(diff.orderChanged).toBe(false)
    expect(diff.termChanges).toEqual([])
    expect(diff.targetChanged).toBe(false)
    expectDeltasMatchCalculate(diff, before, after)
  })

  it('只换顺序：orderChanged 为 true，字段与数值差异均为空', () => {
    const before = caseA()
    const after = makeChain([...before.terms].reverse(), before.target)
    const diff = compareChains(before, after)

    expect(diff.addedTermIds).toEqual([])
    expect(diff.removedTermIds).toEqual([])
    expect(diff.orderChanged).toBe(true)
    expect(diff.termChanges).toEqual([])
    expect(diff.targetChanged).toBe(false)
    expectAllDeltasZero(diff)
  })
})

describe('目标区间切换', () => {
  it('有目标 ↔ 无目标：裕量两侧值保留，delta 为 null，状态正确切换', () => {
    const withTarget = caseA()
    const withoutTarget: ChainDefinition = { ...caseA(), target: null }

    const removed = compareChains(withTarget, withoutTarget)
    expect(removed.targetChanged).toBe(true)
    expect(removed.lowerMarginQ).toEqual({
      before: mm('0.0500'),
      after: null,
      delta: null,
    })
    expect(removed.upperMarginQ).toEqual({
      before: mm('-0.0900'),
      after: null,
      delta: null,
    })
    expect(removed.minQ.delta).toBe(0)
    expect(removed.maxQ.delta).toBe(0)
    expect(removed.toleranceQ.delta).toBe(0)
    expect(removed.statusBefore).toBe('outside')
    expect(removed.statusAfter).toBe('no-target')

    const added = compareChains(withoutTarget, withTarget)
    expect(added.targetChanged).toBe(true)
    expect(added.lowerMarginQ).toEqual({
      before: null,
      after: mm('0.0500'),
      delta: null,
    })
    expect(added.upperMarginQ).toEqual({
      before: null,
      after: mm('-0.0900'),
      delta: null,
    })
    expect(added.minQ.delta).toBe(0)
    expect(added.maxQ.delta).toBe(0)
    expect(added.toleranceQ.delta).toBe(0)
    expect(added.statusBefore).toBe('no-target')
    expect(added.statusAfter).toBe('outside')
  })
})

interface GeneratedTermValues {
  sign: 1 | -1
  nominalQ: number
  lowerDeviationQ: number
  upperDeviationQ: number
}

function toTerms(values: readonly GeneratedTermValues[]): DimensionTerm[] {
  return values.map((value, index) => {
    const id = `T${index + 1}`
    return { id, symbol: id, name: id, ...value, sourceNote: '', termRevision: 1 }
  })
}

// 生成文档 4.1 约束下的合法链：N>0、EI≤ES、N+EI≥0，允许 EI/ES 同为正或同为负。
const termValuesArb = fc.integer({ min: 1, max: 100_000 }).chain((nominalQ) =>
  fc
    .tuple(
      fc.constantFrom<1 | -1>(1, -1),
      fc.integer({ min: -nominalQ, max: 100_000 }),
      fc.integer({ min: 0, max: 100_000 }),
    )
    .map(([sign, lowerDeviationQ, width]) => ({
      sign,
      nominalQ,
      lowerDeviationQ,
      upperDeviationQ: lowerDeviationQ + width,
    })),
)

const termsArb = fc
  .array(termValuesArb, { minLength: 2, maxLength: 20 })
  .map((values) => toTerms(values))

const targetArb = fc.option(
  fc
    .tuple(
      fc.integer({ min: -1_000_000, max: 1_000_000 }),
      fc.integer({ min: -1_000_000, max: 1_000_000 }),
    )
    .map(([a, b]) => ({ minQ: Math.min(a, b), maxQ: Math.max(a, b) })),
  { nil: null },
)

const chainArb: fc.Arbitrary<ChainDefinition> = fc.record({
  terms: termsArb,
  target: targetArb,
  assumptions: fc.string(),
  relationConfirmed: fc.boolean(),
})

describe('性质', () => {
  propTest.prop([chainArb])('compare(x, x) 无变化', (chain) => {
    const diff = compareChains(chain, chain)

    expect(diff.addedTermIds).toEqual([])
    expect(diff.removedTermIds).toEqual([])
    expect(diff.orderChanged).toBe(false)
    expect(diff.termChanges).toEqual([])
    expect(diff.targetChanged).toBe(false)
    expect(diff.statusBefore).toBe(diff.statusAfter)

    for (const field of deltaFields) {
      expect(diff[field].before).toBe(diff[field].after)
      expect(diff[field].delta).toBe(diff[field].before === null ? null : 0)
    }
  })
})
