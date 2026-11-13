import { describe, expect, it } from 'vitest'
import { calculateChain } from './calculate'
import type { ChainDefinition, DimensionTerm } from './types'
import { parseMm } from './units'
import {
  ASSUMPTION_NOTE,
  CROSS_CHECK_TOLERANCE,
  DEFAULT_MC_SEED,
  crossCheck,
  monteCarloOf,
  rssOf,
  statisticalSummaryOf,
} from './statistics'

function term(
  id: string,
  sign: 1 | -1,
  nominal: string,
  lower: string,
  upper: string,
): DimensionTerm {
  return {
    id,
    symbol: id,
    name: id,
    nominalQ: parseMm(nominal),
    lowerDeviationQ: parseMm(lower),
    upperDeviationQ: parseMm(upper),
    sign,
    sourceNote: '',
    termRevision: 1,
  }
}

/**
 * 判据四组（12.00 / 12.04 / 12.05 / 12.10）用的同一条链：
 * C = H − B1 − S − B2，target 0.1000..0.3000。
 * 各环公差：H 400q，B1/S/B2 各 200q。
 */
function chainOf(lengthMm: string): ChainDefinition {
  return {
    terms: [
      term('H', 1, '52.2000', '-0.0200', '0.0200'),
      term('B1', -1, '20.0000', '-0.0100', '0.0100'),
      term('S', -1, lengthMm, '-0.0100', '0.0100'),
      term('B2', -1, '20.0000', '-0.0100', '0.0100'),
    ],
    target: { minQ: parseMm('0.1000'), maxQ: parseMm('0.3000') },
    assumptions: '统计参考用例',
  }
}

const RSS_HALF_WIDTH = 3 * Math.sqrt((400 / 6) ** 2 + 3 * (200 / 6) ** 2)

describe('RSS（σ = T/6，σ_C = √Σσᵢ²）', () => {
  it('S=12.05：C₀=1500q，σ_C≈88.19q，区间 = C₀ ± 3σ_C', () => {
    const chain = chainOf('12.0500')
    const result = calculateChain(chain)
    expect(result.nominalQ).toBe(1500)

    const rss = rssOf(chain, result.nominalQ)
    expect(rss.terms.map((item) => item.termId)).toEqual(['H', 'B1', 'S', 'B2'])
    expect(rss.terms.map((item) => item.toleranceQ)).toEqual([400, 200, 200, 200])
    // σᵢ = Tᵢ/6
    expect(rss.terms[0]!.sigmaQ).toBeCloseTo(400 / 6, 12)
    expect(rss.terms[1]!.sigmaQ).toBeCloseTo(200 / 6, 12)
    expect(rss.combinedSigmaQ).toBeCloseTo(
      Math.sqrt((400 / 6) ** 2 + 3 * (200 / 6) ** 2),
      12,
    )
    expect(rss.halfWidthQ).toBeCloseTo(RSS_HALF_WIDTH, 12)
    expect(rss.intervalMinQ).toBeCloseTo(1500 - RSS_HALF_WIDTH, 12)
    expect(rss.intervalMaxQ).toBeCloseTo(1500 + RSS_HALF_WIDTH, 12)
    // 统计区间必须比极值区间窄：这不是“更好”，只是概率假设。
    expect(rss.halfWidthQ).toBeLessThan(result.toleranceQ / 2)
  })

  it('公差全为零时 σ_C=0，区间退化为 C₀，不产生 NaN', () => {
    const chain: ChainDefinition = {
      terms: [term('X', 1, '10.0000', '0.0000', '0.0000')],
      target: null,
      assumptions: '',
    }
    const rss = rssOf(chain, parseMm('10.0000'))
    expect(rss.combinedSigmaQ).toBe(0)
    expect(rss.intervalMinQ).toBe(rss.intervalMaxQ)
    expect(Number.isNaN(rss.intervalMinQ)).toBe(false)
  })
})

describe('蒙特卡洛：同种子逐位可复现', () => {
  const chain = chainOf('12.0500')
  const nominalQ = calculateChain(chain).nominalQ

  it('同种子跑三次，统计量与样本指纹逐位相同', () => {
    const options = { seed: 424242, samples: 20_000, distribution: 'normal' as const }
    const runs = [0, 1, 2].map(() => monteCarloOf(chain, nominalQ, options))
    const digests = runs.map((run) => run.sampleDigest)
    expect(new Set(digests).size).toBe(1)
    for (const run of runs) {
      expect(run.meanQ).toBe(runs[0]!.meanQ)
      expect(run.sigmaQ).toBe(runs[0]!.sigmaQ)
      expect(run.p0135Q).toBe(runs[0]!.p0135Q)
      expect(run.p99865Q).toBe(runs[0]!.p99865Q)
    }
    expect(digests[0]).toContain('seed=424242')
    expect(digests[0]).toContain('n=20000')
  })

  it('换种子结果不同（不是忽略种子的固定样本）', () => {
    const first = monteCarloOf(chain, nominalQ, {
      seed: 1,
      samples: 20_000,
      distribution: 'normal',
    })
    const second = monteCarloOf(chain, nominalQ, {
      seed: 2,
      samples: 20_000,
      distribution: 'normal',
    })
    expect(first.sampleDigest).not.toBe(second.sampleDigest)
  })

  it('非法种子/样本数明确报错，不静默回退', () => {
    expect(() =>
      monteCarloOf(chain, nominalQ, { seed: -1, samples: 10, distribution: 'normal' }),
    ).toThrow(RangeError)
    expect(() =>
      monteCarloOf(chain, nominalQ, { seed: 1.5, samples: 10, distribution: 'normal' }),
    ).toThrow(RangeError)
    expect(() =>
      monteCarloOf(chain, nominalQ, { seed: 1, samples: 0, distribution: 'normal' }),
    ).toThrow(RangeError)
  })
})

describe('交叉验证：MC 的 ±3σ 与 RSS 的 ±3σ_C 相对偏差 ≤2%', () => {
  const chain = chainOf('12.0500')
  const nominalQ = calculateChain(chain).nominalQ

  it('正态分布、200k 样本：偏差在容差内', () => {
    const rss = rssOf(chain, nominalQ)
    const mc = monteCarloOf(chain, nominalQ, {
      seed: DEFAULT_MC_SEED,
      samples: 200_000,
      distribution: 'normal',
    })
    const check = crossCheck(rss, mc)
    expect(check.relativeDeviation).not.toBeNull()
    expect(check.relativeDeviation!).toBeLessThanOrEqual(CROSS_CHECK_TOLERANCE)
    expect(check.withinTolerance).toBe(true)
    // 均值应接近 C₀（±0.5% 内），标准差应接近 σ_C（±2% 内）。
    expect(Math.abs(mc.meanQ - nominalQ) / nominalQ).toBeLessThan(0.005)
    expect(Math.abs(mc.sigmaQ - rss.combinedSigmaQ) / rss.combinedSigmaQ).toBeLessThan(0.02)
  })

  it('均匀分布：σ 应接近 T/√12 的闭式解（分布假设不同，不拿 RSS 凑）', () => {
    const mc = monteCarloOf(chain, nominalQ, {
      seed: DEFAULT_MC_SEED,
      samples: 200_000,
      distribution: 'uniform',
    })
    const expectedSigma = Math.sqrt(
      (400 / Math.sqrt(12)) ** 2 + 3 * (200 / Math.sqrt(12)) ** 2,
    )
    expect(Math.abs(mc.sigmaQ - expectedSigma) / expectedSigma).toBeLessThan(0.02)

    // 与正态假设的 RSS 相比，偏差必然超过 2%：这是假设差异，如实暴露。
    const rss = rssOf(chain, nominalQ)
    const check = crossCheck(rss, mc)
    expect(check.withinTolerance).toBe(false)
    expect(check.relativeDeviation!).toBeGreaterThan(CROSS_CHECK_TOLERANCE)
  })
})

describe('统计绝不替代条款判定', () => {
  it('统计区间落在允许区间内、极值区间超出时，status 仍是 outside', () => {
    // S=12.10 → C₀=1000q，极值 [500,1500]；±3σ_C≈264.6 → 统计 [735.4,1264.6]。
    // 把允许区间设为 700..3000：极值下限 500 < 700 → outside；统计区间完全在内。
    const chain: ChainDefinition = {
      ...chainOf('12.1000'),
      target: { minQ: 700, maxQ: 3000 },
    }
    const result = calculateChain(chain)
    expect(result.status).toBe('outside')
    expect(result.minQ).toBe(500)

    const summary = statisticalSummaryOf(chain, result)
    expect(summary.rss.intervalMinQ).toBeGreaterThan(700)
    expect(summary.rss.intervalMaxQ).toBeLessThan(3000)
    // 判定字段来自极值结果本身，汇总不改写它。
    expect(summary.extreme.minQ).toBe(result.minQ)
    expect(summary.extreme.maxQ).toBe(result.maxQ)
    expect(summary.extreme.judgementBasis).toBe(true)
    expect(summary.assumptionNote).toBe(ASSUMPTION_NOTE)
    expect(summary.assumptionNote).toContain('仍是条款判定的唯一依据')
    expect(summary.assumptionNote).toContain('不代表装配更容易合格')
  })
})
