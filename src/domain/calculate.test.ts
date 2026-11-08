import { fc, test as propTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { calculateChain, contributionRatios, ENGINE_VERSION } from './calculate'
import type { ChainDefinition, ChainResult, DimensionTerm } from './types'
import { parseMm } from './units'

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
    nominalQ: parseMm(nominal),
    lowerDeviationQ: parseMm(lowerDeviation),
    upperDeviationQ: parseMm(upperDeviation),
    sign,
    sourceNote: '',
    termRevision: 1,
  }
}

function makeTarget(min: string, max: string): { minQ: number; maxQ: number } {
  return { minQ: parseMm(min), maxQ: parseMm(max) }
}

function makeChain(
  terms: DimensionTerm[],
  target: { minQ: number; maxQ: number } | null = null,
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

function caseCTerms(): DimensionTerm[] {
  return [
    makeTerm('P', 1, '10.0000', '-0.1000', '0.0000'),
    makeTerm('Q', -1, '10.0500', '0.0000', '0.0500'),
  ]
}

describe('ENGINE_VERSION', () => {
  it('当前引擎版本为 0.1.0', () => {
    expect(ENGINE_VERSION).toBe('0.1.0')
  })
})

describe('文档第 8 节验收案例', () => {
  it('案例 A：不满足目标，上下裕量分别为 +0.0500 / −0.0900', () => {
    const result = calculateChain(caseA())

    expect(result.nominalQ).toBe(parseMm('0.2000'))
    expect(result.minQ).toBe(parseMm('0.1500'))
    expect(result.maxQ).toBe(parseMm('0.3900'))
    expect(result.lowerDeviationQ).toBe(parseMm('-0.0500'))
    expect(result.upperDeviationQ).toBe(parseMm('+0.1900'))
    expect(result.toleranceQ).toBe(parseMm('0.2400'))
    expect(result.status).toBe('outside')
    expect(result.lowerMarginQ).toBe(parseMm('+0.0500'))
    expect(result.upperMarginQ).toBe(parseMm('-0.0900'))
    expect(result.contributions).toEqual([
      { termId: 'H', toleranceQ: parseMm('0.1000') },
      { termId: 'B1', toleranceQ: parseMm('0.0200') },
      { termId: 'S', toleranceQ: parseMm('0.1000') },
      { termId: 'B2', toleranceQ: parseMm('0.0200') },
    ])
  })

  it('案例 B：修改后满足目标，上下裕量分别为 +0.0800 / +0.0100', () => {
    const result = calculateChain(caseB())

    expect(result.nominalQ).toBe(parseMm('0.2000'))
    expect(result.minQ).toBe(parseMm('0.1800'))
    expect(result.maxQ).toBe(parseMm('0.2900'))
    expect(result.lowerDeviationQ).toBe(parseMm('-0.0200'))
    expect(result.upperDeviationQ).toBe(parseMm('+0.0900'))
    expect(result.toleranceQ).toBe(parseMm('0.1100'))
    expect(result.status).toBe('within')
    expect(result.lowerMarginQ).toBe(parseMm('+0.0800'))
    expect(result.upperMarginQ).toBe(parseMm('+0.0100'))
    expect(result.contributions).toEqual([
      { termId: 'H', toleranceQ: parseMm('0.0300') },
      { termId: 'B1', toleranceQ: parseMm('0.0200') },
      { termId: 'S', toleranceQ: parseMm('0.0400') },
      { termId: 'B2', toleranceQ: parseMm('0.0200') },
    ])
  })

  it('案例 C：负间隙，目标边界相等算 within', () => {
    const result = calculateChain(makeChain(caseCTerms(), makeTarget('-0.2000', '-0.0500')))

    expect(result.nominalQ).toBe(parseMm('-0.0500'))
    expect(result.minQ).toBe(parseMm('-0.2000'))
    expect(result.maxQ).toBe(parseMm('-0.0500'))
    expect(result.lowerDeviationQ).toBe(parseMm('-0.1500'))
    expect(result.upperDeviationQ).toBe(parseMm('0.0000'))
    expect(result.toleranceQ).toBe(parseMm('0.1500'))
    expect(result.status).toBe('within')
    expect(result.lowerMarginQ).toBe(parseMm('0.0000'))
    expect(result.upperMarginQ).toBe(parseMm('0.0000'))
    expect(result.contributions).toEqual([
      { termId: 'P', toleranceQ: parseMm('0.1000') },
      { termId: 'Q', toleranceQ: parseMm('0.0500') },
    ])
  })

  it('案例 C：target 为 null 时 no-target 且两侧裕量为 null', () => {
    const result = calculateChain(makeChain(caseCTerms()))

    expect(result.status).toBe('no-target')
    expect(result.lowerMarginQ).toBeNull()
    expect(result.upperMarginQ).toBeNull()
    expect(result.minQ).toBe(parseMm('-0.2000'))
    expect(result.maxQ).toBe(parseMm('-0.0500'))
  })
})

describe('特殊输入', () => {
  it('全零公差：minQ === maxQ，贡献比例为 null，不出现 NaN', () => {
    const result = calculateChain(
      makeChain([
        makeTerm('A', 1, '10.0000', '0.0000', '0.0000'),
        makeTerm('B', -1, '5.0000', '0.0000', '0.0000'),
      ]),
    )

    expect(result.minQ).toBe(parseMm('5.0000'))
    expect(result.maxQ).toBe(parseMm('5.0000'))
    expect(result.toleranceQ).toBe(0)
    expect(result.toleranceQ).toBe(result.maxQ - result.minQ)

    const ratios = contributionRatios(result)
    expect(ratios).toEqual([
      { termId: 'A', ratio: null },
      { termId: 'B', ratio: null },
    ])
    for (const { ratio } of ratios) {
      expect(ratio).toBeNull()
      expect(Number.isNaN(ratio)).toBe(false)
    }
  })

  it('EI、ES 同为正或同为负：合法并按公式计算', () => {
    // A：+1，N=10.0000，EI=+0.0100，ES=+0.0300 → L=10.0100，U=10.0300，T=0.0200
    // B：−1，N=20.0000，EI=−0.0200，ES=−0.0100 → L=19.9800，U=19.9900，T=0.0100
    // C₀ = 10.0000 − 20.0000 = −10.0000
    // Cmin = L_A − U_B = 10.0100 − 19.9900 = −9.9800
    // Cmax = U_A − L_B = 10.0300 − 19.9800 = −9.9500
    // EIc = +0.0200，ESc = +0.0500，Tc = 0.0300
    const result = calculateChain(
      makeChain([
        makeTerm('A', 1, '10.0000', '0.0100', '0.0300'),
        makeTerm('B', -1, '20.0000', '-0.0200', '-0.0100'),
      ]),
    )

    expect(result.nominalQ).toBe(parseMm('-10.0000'))
    expect(result.minQ).toBe(parseMm('-9.9800'))
    expect(result.maxQ).toBe(parseMm('-9.9500'))
    expect(result.lowerDeviationQ).toBe(parseMm('+0.0200'))
    expect(result.upperDeviationQ).toBe(parseMm('+0.0500'))
    expect(result.toleranceQ).toBe(parseMm('0.0300'))
    expect(result.status).toBe('no-target')
    expect(result.contributions).toEqual([
      { termId: 'A', toleranceQ: parseMm('0.0200') },
      { termId: 'B', toleranceQ: parseMm('0.0100') },
    ])

    const ratios = contributionRatios(result)
    expect(ratios.map(({ termId }) => termId)).toEqual(['A', 'B'])
    expect(ratios[0].ratio).toBeCloseTo(2 / 3, 12)
    expect(ratios[1].ratio).toBeCloseTo(1 / 3, 12)
  })

  it('status 只由数值与目标决定，不读取确认凭据', () => {
    expect(calculateChain({ ...caseA(), assumptions: '任意说明' }).status).toBe('outside')
    expect(calculateChain({ ...caseB(), assumptions: '' }).status).toBe('within')
  })

  it('不修改输入', () => {
    const definition = caseA()
    const snapshot = structuredClone(definition)

    calculateChain(definition)

    expect(definition).toEqual(snapshot)
  })

  it('中间结果超出安全整数范围时抛 RangeError', () => {
    const huge = Number.MAX_SAFE_INTEGER
    const rawTerm = (overrides: Partial<DimensionTerm>): DimensionTerm => ({
      id: 'X',
      symbol: 'X',
      name: 'X',
      nominalQ: 1,
      lowerDeviationQ: 0,
      upperDeviationQ: 0,
      sign: 1,
      sourceNote: '',
      termRevision: 1,
      ...overrides,
    })

    // L = N + EI 溢出
    const overflowLowerLimit = makeChain([
      rawTerm({ nominalQ: huge, lowerDeviationQ: 1 }),
    ])
    // Σ sᵢNᵢ 在累加时溢出
    const overflowNominalSum = makeChain([
      rawTerm({ id: 'A', nominalQ: huge }),
      rawTerm({ id: 'B', nominalQ: 1 }),
    ])
    // 下限裕量 minQ − target.minQ 溢出
    const overflowMargin = makeChain([rawTerm({ nominalQ: huge })], {
      minQ: -1,
      maxQ: huge,
    })

    for (const definition of [overflowLowerLimit, overflowNominalSum, overflowMargin]) {
      expect(() => calculateChain(definition)).toThrow(RangeError)
    }
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

// 生成文档 4.1 约束下的合法链：N>0、EI≤ES、N+EI≥0，并允许 EI/ES 同为正或同为负。
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

function resultCore(result: ChainResult) {
  return {
    nominalQ: result.nominalQ,
    minQ: result.minQ,
    maxQ: result.maxQ,
    lowerDeviationQ: result.lowerDeviationQ,
    upperDeviationQ: result.upperDeviationQ,
    toleranceQ: result.toleranceQ,
    status: result.status,
    lowerMarginQ: result.lowerMarginQ,
    upperMarginQ: result.upperMarginQ,
  }
}

function sortedContributions(result: ChainResult): ChainResult['contributions'] {
  return [...result.contributions].sort((a, b) => a.termId.localeCompare(b.termId))
}

describe('性质', () => {
  propTest.prop([termsArb, targetArb])(
    '组成环重排不改变结果，contributions 按 termId 比较一致',
    (terms, target) => {
      const forward = calculateChain(makeChain(terms, target))
      const reversed = calculateChain(makeChain([...terms].reverse(), target))

      expect(resultCore(reversed)).toEqual(resultCore(forward))
      expect(sortedContributions(reversed)).toEqual(sortedContributions(forward))
    },
  )

  propTest.prop([termsArb])('maxQ ≥ minQ', (terms) => {
    const result = calculateChain(makeChain(terms))

    expect(result.maxQ).toBeGreaterThanOrEqual(result.minQ)
  })

  propTest.prop([termsArb])('toleranceQ = ΣTᵢ，且 upperDeviationQ − lowerDeviationQ = toleranceQ', (terms) => {
    const result = calculateChain(makeChain(terms))
    const expectedToleranceQ = terms.reduce(
      (total, term) => total + term.upperDeviationQ - term.lowerDeviationQ,
      0,
    )

    expect(result.toleranceQ).toBe(expectedToleranceQ)
    expect(result.upperDeviationQ - result.lowerDeviationQ).toBe(result.toleranceQ)
  })

  propTest.prop([
    termsArb.chain((terms) => fc.tuple(fc.constant(terms), fc.nat({ max: terms.length - 1 }))),
    fc.integer({ min: 1, max: 100_000 }),
  ])('基本尺寸局部变化：正项三项均增加 δ，负项三项均减少 δ', ([terms, index], delta) => {
    const before = calculateChain(makeChain(terms))
    const changedTerms = terms.map((term, termIndex) =>
      termIndex === index ? { ...term, nominalQ: term.nominalQ + delta } : term,
    )
    const after = calculateChain(makeChain(changedTerms))
    const direction = terms[index].sign

    expect(after.nominalQ).toBe(before.nominalQ + direction * delta)
    expect(after.minQ).toBe(before.minQ + direction * delta)
    expect(after.maxQ).toBe(before.maxQ + direction * delta)
  })

  propTest.prop([termsArb])('ΣTᵢ > 0 时 contributionRatios 之和约等于 1', (terms) => {
    const result = calculateChain(makeChain(terms))
    const ratios = contributionRatios(result)

    if (result.toleranceQ === 0) {
      expect(ratios.every(({ ratio }) => ratio === null)).toBe(true)
      return
    }

    expect(result.toleranceQ).toBeGreaterThan(0)
    const totalRatio = ratios.reduce((sum, { ratio }) => sum + (ratio ?? 0), 0)
    expect(totalRatio).toBeCloseTo(1, 12)
  })
})
