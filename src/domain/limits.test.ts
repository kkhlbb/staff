import { describe, expect, it } from 'vitest'
import { calculateChain, termLimits } from './calculate'
import type { ChainDefinition, DimensionTerm } from './types'
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
  }
}

function makeChain(terms: DimensionTerm[]): ChainDefinition {
  return { terms, target: null, assumptions: '', relationConfirmed: false }
}

/** 只用于一致性断言：按 sᵢ=+1 取 L/U、sᵢ=−1 取 −U/−L 汇总。 */
function expectedMinMax(terms: DimensionTerm[]): { minQ: number; maxQ: number } {
  let minQ = 0
  let maxQ = 0
  for (const term of terms) {
    const { lowerQ, upperQ } = termLimits(term)
    minQ += term.sign === 1 ? lowerQ : -upperQ
    maxQ += term.sign === 1 ? upperQ : -lowerQ
  }
  return { minQ, maxQ }
}

describe('termLimits', () => {
  it('0 偏差时上下极限都等于基本尺寸', () => {
    const limits = termLimits(makeTerm('A', 1, '100.0000', '0.0000', '0.0000'))

    expect(limits).toEqual({
      lowerQ: parseMm('100.0000'),
      upperQ: parseMm('100.0000'),
    })
  })

  it('负偏差时 Lᵢ = Nᵢ + EIᵢ、Uᵢ = Nᵢ + ESᵢ', () => {
    expect(termLimits(makeTerm('A', 1, '20.0000', '-0.0200', '0.0000'))).toEqual({
      lowerQ: parseMm('19.9800'),
      upperQ: parseMm('20.0000'),
    })
    expect(termLimits(makeTerm('B', -1, '20.0000', '-0.0200', '-0.0100'))).toEqual({
      lowerQ: parseMm('19.9800'),
      upperQ: parseMm('19.9900'),
    })
  })

  it('正偏差时同样按 Lᵢ = Nᵢ + EIᵢ、Uᵢ = Nᵢ + ESᵢ 计算', () => {
    expect(termLimits(makeTerm('A', 1, '10.0000', '0.0100', '0.0300'))).toEqual({
      lowerQ: parseMm('10.0100'),
      upperQ: parseMm('10.0300'),
    })
  })

  it('与 calculateChain 的 minQ、maxQ 一致', () => {
    const chains = [
      makeChain([
        makeTerm('H', 1, '100.0000', '0.0000', '0.1000'),
        makeTerm('B1', -1, '20.0000', '-0.0200', '0.0000'),
        makeTerm('S', -1, '59.8000', '-0.0500', '0.0500'),
        makeTerm('B2', -1, '20.0000', '-0.0200', '0.0000'),
      ]),
      makeChain([
        makeTerm('P', 1, '10.0000', '-0.1000', '0.0000'),
        makeTerm('Q', -1, '10.0500', '0.0000', '0.0500'),
      ]),
    ]

    for (const chain of chains) {
      const result = calculateChain(chain)
      expect({ minQ: result.minQ, maxQ: result.maxQ }).toEqual(
        expectedMinMax(chain.terms),
      )
    }
  })

  it('Lᵢ、Uᵢ 超出安全整数范围时抛 RangeError', () => {
    const huge = Number.MAX_SAFE_INTEGER

    expect(() =>
      termLimits({
        ...makeTerm('L', 1, '0.0000', '0.0000', '0.0000'),
        nominalQ: huge,
        lowerDeviationQ: 1,
      }),
    ).toThrow(RangeError)
    expect(() =>
      termLimits({
        ...makeTerm('U', 1, '0.0000', '0.0000', '0.0000'),
        nominalQ: huge,
        upperDeviationQ: 1,
      }),
    ).toThrow(RangeError)
  })
})
