import { describe, it, expect } from 'vitest'
import { calculateChain } from './calculate'
import { rssOf, monteCarloOf, statisticalSummaryOf } from './statistics'
import type { ChainDefinition } from './types'

describe('S03 common midpoint-centred normal assumption', () => {
  it.each([
    { sign: 1 as const, lower: 0, upper: 600, shift: 300 },
    { sign: -1 as const, lower: 0, upper: 600, shift: -300 },
    { sign: 1 as const, lower: -100, upper: 500, shift: 200 },
    { sign: -1 as const, lower: -500, upper: 100, shift: 200 },
  ])('keeps the extreme judgement and centres both methods at signed midpoint $shift', ({sign,lower,upper,shift}) => {
    const chain: ChainDefinition = { terms: [{ id: 'x', symbol: 'X', name: 'X', nominalQ: 10000, lowerDeviationQ: lower, upperDeviationQ: upper, sign, sourceNote: '', termRevision: 1 }], target: { minQ: -20000, maxQ: 20000 }, assumptions: '' }
    const before = calculateChain(chain)
    const rss = rssOf(chain, before.nominalQ)
    const centre = (rss.intervalMinQ + rss.intervalMaxQ) / 2
    expect(centre).toBe(before.nominalQ + shift)
    const mc = monteCarloOf(chain, before.nominalQ, { seed: 424242, samples: 100000, distribution: 'normal' })
    expect(Math.abs(mc.meanQ - centre)).toBeLessThan(2)
    expect(rss.halfWidthQ).toBe(300)
    const summary = statisticalSummaryOf(chain, before, { seed: 424242, samples: 1000, distribution: 'normal' })
    expect(summary.extreme).toMatchObject({ minQ: before.minQ, maxQ: before.maxQ, toleranceQ: before.toleranceQ, judgementBasis: true })
    expect(calculateChain(chain)).toEqual(before)
  })
})
