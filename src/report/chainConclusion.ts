import { calculateChain } from '../domain/calculate'
import { createRng, monteCarloOf } from '../domain/statistics'
import type { ChainDefinition } from '../domain/types'
import type { ReportConclusion } from './types'

export const REPORT_SAMPLES = 2000
const mm = (q: number) => q / 10_000

export function chainConclusion(chain: ChainDefinition, seed: number): ReportConclusion[] {
  if (!chain.target || !chain.terms.length) return []
  const { target } = chain
  const { nominalQ, minQ, maxQ } = calculateChain(chain)
  const { meanQ, sigmaQ } = monteCarloOf(chain, nominalQ, { seed, samples: REPORT_SAMPLES, distribution: 'uniform' })
  const width = (maxQ - minQ) / 24 || 1
  const histogram = Array.from({ length: 24 }, (_, i) => ({
    intervalMm: [mm(minQ + i * width), mm(minQ + (i + 1) * width)] as const, count: 0, outOfSpecCount: 0,
  }))
  const rng = createRng(seed)
  let failures = 0
  for (let i = 0; i < REPORT_SAMPLES; i++) {
    const q = chain.terms.reduce((value, term) => value + term.sign *
      (term.lowerDeviationQ + rng.next() * (term.upperDeviationQ - term.lowerDeviationQ)), nominalQ)
    const bin = histogram[Math.min(23, Math.max(0, Math.floor((q - minQ) / width)))]!
    bin.count++
    if (q < target.minQ || q > target.maxQ) {
      bin.outOfSpecCount++
      failures++
    }
  }
  const variances = chain.terms.map(term => ({ inputId: term.id, label: term.id,
    variance: (term.upperDeviationQ - term.lowerDeviationQ) ** 2 })).sort((a, b) => b.variance - a.variance)
  const total = variances.reduce((sum, term) => sum + term.variance, 0)
  let cumulative = 0
  return [{
    checkId: 'dimension-chain', label: 'Tolerance loop',
    requirementMm: [mm(target.minQ), mm(target.maxQ)], extremeIntervalMm: [mm(minQ), mm(maxQ)],
    status: minQ >= target.minQ && maxQ <= target.maxQ ? 'pass' : 'fail',
    rigid: {
      threeSigmaIntervalMm: [mm(meanQ - 3 * sigmaQ), mm(meanQ + 3 * sigmaQ)],
      cp: sigmaQ > 0 ? (target.maxQ - target.minQ) / (6 * sigmaQ) : null,
      cpk: sigmaQ > 0 ? Math.min(target.maxQ - meanQ, meanQ - target.minQ) / (3 * sigmaQ) : null,
      ppm: failures * 1_000_000 / REPORT_SAMPLES,
    },
    compliant: null, flexDeltaCpk: null, histogram,
    pareto: variances.map(({ inputId, label, variance }) => {
      const varianceSharePct = total ? variance * 100 / total : 0
      cumulative += varianceSharePct
      return { inputId, label, varianceSharePct, cumulativeSharePct: cumulative }
    }),
  }]
}
