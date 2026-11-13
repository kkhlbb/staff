/**
 * 统计公差证据（任务卡 A）：三法并列 + 交叉验证 + 同种子可复现 + 判定不变。
 *
 * 走产品同一函数：calculateChain（极值/判定）→ rssOf（闭式解）→ monteCarloOf（数值解）。
 * 参数用现有判据四组之一 S=12.05（C=[1000,2000]、边界相等仍满足）。
 *
 * 用法：`npx vitest run --config vitest.statevidence.config.ts`
 * 输出：docs/evidence/stat-tolerance/statistics.json（serializeEvidence）
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { calculateChain } from '../src/domain/calculate'
import { sha256Text } from '../src/drawing/fingerprint'
import type { ChainDefinition, DimensionTerm } from '../src/domain/types'
import { parseMm } from '../src/domain/units'
import {
  ASSUMPTION_NOTE,
  DEFAULT_MC_SEED,
  STATISTICS_GENERATOR_VERSION,
  crossCheck,
  monteCarloOf,
  rssOf,
  statisticalSummaryOf,
} from '../src/domain/statistics'
import { serializeEvidence } from './evidence-json'

const OUT = path.join(process.cwd(), 'docs', 'evidence', 'stat-tolerance')

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

/** 判据四组共用的链：C = H − B1 − S − B2，target 0.1000..0.3000。 */
function chainOf(lengthMm: string): ChainDefinition {
  return {
    terms: [
      term('H', 1, '52.2000', '-0.0200', '0.0200'),
      term('B1', -1, '20.0000', '-0.0100', '0.0100'),
      term('S', -1, lengthMm, '-0.0100', '0.0100'),
      term('B2', -1, '20.0000', '-0.0100', '0.0100'),
    ],
    target: { minQ: parseMm('0.1000'), maxQ: parseMm('0.3000') },
    assumptions: '统计公差证据用例',
  }
}

function mm(valueQ: number): number {
  return Number((valueQ / 10000).toFixed(6))
}

describe('统计公差证据：RSS + 蒙特卡洛（参考），极值法仍是判定依据', () => {
  it('三法结果表、交叉验证偏差、同种子三次一致、判定不变', async () => {
    await fsp.mkdir(OUT, { recursive: true })
    const chain = chainOf('12.0500')
    const extreme = calculateChain(chain)
    // 极值法判定必须照旧：S=12.05 的结果区间下限恰好等于允许下限，边界相等算满足。
    expect(extreme.nominalQ).toBe(1500)
    expect(extreme.minQ).toBe(1000)
    expect(extreme.maxQ).toBe(2000)
    expect(extreme.status).toBe('within')

    const rss = rssOf(chain, extreme.nominalQ)
    const normal = monteCarloOf(chain, extreme.nominalQ, {
      seed: DEFAULT_MC_SEED,
      samples: 200_000,
      distribution: 'normal',
    })
    const uniform = monteCarloOf(chain, extreme.nominalQ, {
      seed: DEFAULT_MC_SEED,
      samples: 200_000,
      distribution: 'uniform',
    })
    const normalCheck = crossCheck(rss, normal)
    const uniformCheck = crossCheck(rss, uniform)

    // A3：正态分布下 MC ±3σ 与 RSS ±3σ_C 偏差必须 ≤2%。
    expect(normalCheck.withinTolerance).toBe(true)
    expect(normalCheck.relativeDeviation!).toBeLessThanOrEqual(0.02)
    // 均匀分布是不同假设：偏差如实超标，不调参凑数。
    expect(uniformCheck.withinTolerance).toBe(false)
    expect(uniformCheck.relativeDeviation!).toBeGreaterThan(0.02)

    // 同种子跑三次：统计量与样本指纹逐位相同，哈希也相同。
    const runs = [0, 1, 2].map(() =>
      monteCarloOf(chain, extreme.nominalQ, {
        seed: DEFAULT_MC_SEED,
        samples: 200_000,
        distribution: 'normal',
      }),
    )
    const hashes = runs.map((run) => sha256Text(run.sampleDigest))
    expect(new Set(hashes).size).toBe(1)
    for (const run of runs) {
      expect(run.meanQ).toBe(normal.meanQ)
      expect(run.sigmaQ).toBe(normal.sigmaQ)
      expect(run.p0135Q).toBe(normal.p0135Q)
      expect(run.p99865Q).toBe(normal.p99865Q)
    }
    // 不同种子必须不同（种子真的参与抽样）。
    const otherSeed = monteCarloOf(chain, extreme.nominalQ, {
      seed: DEFAULT_MC_SEED + 1,
      samples: 200_000,
      distribution: 'normal',
    })
    expect(otherSeed.sampleDigest).not.toBe(normal.sampleDigest)

    // 判定不变：S=12.10 + target 700..3000 时统计区间落在允许区间内，但极值仍 outside。
    const inconsistentChain: ChainDefinition = {
      ...chainOf('12.1000'),
      target: { minQ: 700, maxQ: 3000 },
    }
    const inconsistentExtreme = calculateChain(inconsistentChain)
    expect(inconsistentExtreme.status).toBe('outside')
    expect(inconsistentExtreme.minQ).toBe(500)
    const inconsistentSummary = statisticalSummaryOf(inconsistentChain, inconsistentExtreme, {
      seed: DEFAULT_MC_SEED,
      samples: 200_000,
      distribution: 'normal',
    })
    expect(inconsistentSummary.rss.intervalMinQ).toBeGreaterThan(700)
    expect(inconsistentSummary.rss.intervalMaxQ).toBeLessThan(3000)
    expect(inconsistentSummary.extreme.judgementBasis).toBe(true)

    const summary = statisticalSummaryOf(chain, extreme, {
      seed: DEFAULT_MC_SEED,
      samples: 200_000,
      distribution: 'normal',
    })
    expect(summary.assumptionNote).toBe(ASSUMPTION_NOTE)

    const report = {
      schema: 'stat-tolerance-v1',
      baseline: 'main 9c8ab6b（手绘草图入口已合入）',
      generator: STATISTICS_GENERATOR_VERSION,
      standard: 'GB/T 5847-2004 概率法（RSS 与数值抽样，均只作参考）',
      case: {
        name: '判据四组之一 S=12.05',
        chain: 'C = H − B1 − S − B2',
        targetQ: chain.target,
        terms: chain.terms.map((item) => ({
          symbol: item.symbol,
          sign: item.sign,
          nominalQ: item.nominalQ,
          lowerDeviationQ: item.lowerDeviationQ,
          upperDeviationQ: item.upperDeviationQ,
          toleranceQ: item.upperDeviationQ - item.lowerDeviationQ,
        })),
      },
      judgement: {
        basis: 'extreme（极值法）',
        nominalQ: extreme.nominalQ,
        minQ: extreme.minQ,
        maxQ: extreme.maxQ,
        toleranceQ: extreme.toleranceQ,
        status: extreme.status,
      },
      methods: {
        extreme: {
          intervalQ: [extreme.minQ, extreme.maxQ],
          intervalMm: [mm(extreme.minQ), mm(extreme.maxQ)],
          toleranceQ: extreme.toleranceQ,
          assumption: '所有组成环同时取极限；无分布假设；唯一判定依据',
        },
        rss: {
          sigmaQ: rss.terms.map((item) => ({ symbol: item.termId, toleranceQ: item.toleranceQ, sigmaQ: item.sigmaQ })),
          combinedSigmaQ: rss.combinedSigmaQ,
          halfWidthQ: rss.halfWidthQ,
          intervalQ: [rss.intervalMinQ, rss.intervalMaxQ],
          intervalMm: [mm(rss.intervalMinQ), mm(rss.intervalMaxQ)],
          assumption: '各环独立、正态分布、σᵢ=Tᵢ/6；区间取 C₀ ± 3σ_C（约 99.73% 覆盖）',
        },
        monteCarlo: {
          normal: {
            seed: normal.seed,
            samples: normal.samples,
            meanQ: normal.meanQ,
            sigmaQ: normal.sigmaQ,
            p0135Q: normal.p0135Q,
            p99865Q: normal.p99865Q,
            intervalMm: [mm(normal.p0135Q), mm(normal.p99865Q)],
            sampleDigest: normal.sampleDigest,
          },
          uniform: {
            seed: uniform.seed,
            samples: uniform.samples,
            meanQ: uniform.meanQ,
            sigmaQ: uniform.sigmaQ,
            p0135Q: uniform.p0135Q,
            p99865Q: uniform.p99865Q,
            intervalMm: [mm(uniform.p0135Q), mm(uniform.p99865Q)],
            sampleDigest: uniform.sampleDigest,
          },
          assumption:
            '正态：xᵢ~N(midᵢ,(Tᵢ/6)²)，与 RSS 同假设；均匀：xᵢ~U(EIᵢ,ESᵢ)，σᵢ=Tᵢ/√12，是另一种假设',
        },
      },
      crossCheck: {
        normal: {
          rssHalfWidthQ: normalCheck.rssHalfWidthQ,
          mcLowerHalfWidthQ: normalCheck.mcLowerHalfWidthQ,
          mcUpperHalfWidthQ: normalCheck.mcUpperHalfWidthQ,
          relativeDeviation: normalCheck.relativeDeviation,
          withinTolerance: normalCheck.withinTolerance,
          tolerance: normalCheck.tolerance,
        },
        uniform: {
          rssHalfWidthQ: uniformCheck.rssHalfWidthQ,
          mcLowerHalfWidthQ: uniformCheck.mcLowerHalfWidthQ,
          mcUpperHalfWidthQ: uniformCheck.mcUpperHalfWidthQ,
          relativeDeviation: uniformCheck.relativeDeviation,
          withinTolerance: uniformCheck.withinTolerance,
          tolerance: uniformCheck.tolerance,
        },
        note: '容差 2% 只适用于与 RSS 同假设的正态抽样；均匀分布偏差如实报告，不调参。',
      },
      reproducibility: {
        seed: DEFAULT_MC_SEED,
        samples: 200_000,
        runs: runs.map((run) => ({
          meanQ: run.meanQ,
          sigmaQ: run.sigmaQ,
          p0135Q: run.p0135Q,
          p99865Q: run.p99865Q,
          sampleDigest: run.sampleDigest,
          sampleDigestSha256: sha256Text(run.sampleDigest),
        })),
        identical: true,
        differentSeedDigest: otherSeed.sampleDigest,
      },
      judgementInvariant: {
        case: 'S=12.10，target 700..3000',
        extremeStatus: inconsistentExtreme.status,
        extremeIntervalQ: [inconsistentExtreme.minQ, inconsistentExtreme.maxQ],
        rssIntervalQ: [inconsistentSummary.rss.intervalMinQ, inconsistentSummary.rss.intervalMaxQ],
        statisticalIntervalInsideTarget:
          inconsistentSummary.rss.intervalMinQ > 700 &&
          inconsistentSummary.rss.intervalMaxQ < 3000,
        statusUnchanged: inconsistentExtreme.status === 'outside',
        note: '统计区间完全落在允许区间内，但判定仍取极值法 outside；界面只并列展示，不提供按统计判定的入口。',
      },
      assumptionNote: ASSUMPTION_NOTE,
    }

    const text = serializeEvidence(report)
    await fsp.writeFile(path.join(OUT, 'statistics.json'), text)
    // 再序列化一次必须逐字节相同（证据可复算）。
    expect(serializeEvidence(JSON.parse(text))).toBe(text)

    console.log(
      'STAT_TOLERANCE',
      JSON.stringify({
        extreme: [mm(extreme.minQ), mm(extreme.maxQ)],
        rss: [mm(rss.intervalMinQ), mm(rss.intervalMaxQ)],
        mc: [mm(normal.p0135Q), mm(normal.p99865Q)],
        relativeDeviationNormal: normalCheck.relativeDeviation,
        relativeDeviationUniform: uniformCheck.relativeDeviation,
        hashes,
      }),
    )
  }, 120_000)
})
