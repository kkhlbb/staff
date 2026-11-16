/**
 * 统计公差参考（GB/T 5847-2004 概率法）：RSS 与蒙特卡洛。
 *
 * 红线（任务卡 A2）：
 * - 本模块**只产出参考区间**，不产出判定。条款判定仍只由 `calculateChain`
 *   的极值法给出；调用方不得把统计结论写回 `ChainResult.status`。
 * - 三种方法的假设差异必须一起展示：极值法 = 所有环同时取极限（无需分布假设，
 *   永远是判定依据）；RSS = 各环独立、服从正态分布且取 σᵢ = Tᵢ/6；
 *   蒙特卡洛 = 按同一分布假设数值抽样，只用于印证 RSS 的闭式解。
 * - 统计区间更窄来自概率假设（±3σ 约 99.73% 覆盖），不代表装配更容易合格。
 *
 * 数值约定：输入 q（1q = 0.0001mm，整数）；统计结果是浮点 q，仅用于显示与
 * 交叉验证，不写回模型、不参与判定。
 */
import type { ChainDefinition, Q } from './types'

/** 统计方法标识；极值法不在此列，它是判定依据而不是参考。 */
export type StatisticalMethod = 'rss' | 'monte-carlo'

/** 抽样分布：正态（与 RSS 的 σᵢ=Tᵢ/6 同一假设）或均匀（区间内等概率）。 */
export type SamplingDistribution = 'normal' | 'uniform'

/** 蒙特卡洛默认参数：固定种子，界面上可复现。 */
export const DEFAULT_MC_SEED = 20261113
export const DEFAULT_MC_SAMPLES = 200_000
/** UI 侧用较小样本以保证交互流畅；证据脚本用 200k。 */
export const UI_MC_SAMPLES = 100_000
/** 交叉验证容差（任务卡 A3）：±3σ 区间半径的相对偏差上限。 */
export const CROSS_CHECK_TOLERANCE = 0.02
export const STATISTICS_GENERATOR_VERSION = 'statistics-v2-midpoint'

/** 正态假设下 σᵢ = Tᵢ/6，即 ±3σ 覆盖公差带。 */
export const SIGMA_PER_TOLERANCE = 1 / 6

export interface RssTermSigma {
  termId: string
  toleranceQ: Q
  sigmaQ: number
}

export interface RssResult {
  method: 'rss'
  /** 各环 σᵢ = Tᵢ/6。 */
  terms: RssTermSigma[]
  /** σ_C = √(Σσᵢ²)。 */
  combinedSigmaQ: number
  /** 3σ_C，区间半径。 */
  halfWidthQ: number
  /** (C₀ + Σsᵢ(EIᵢ+ESᵢ)/2) ± 3σ_C；中心偏移仅作统计参考。 */
  intervalMinQ: number
  intervalMaxQ: number
  distributionAssumption: 'normal'
}

export interface MonteCarloResult {
  method: 'monte-carlo'
  distribution: SamplingDistribution
  seed: number
  samples: number
  /** 封闭环样本均值。 */
  meanQ: number
  /** 样本标准差（n−1）。 */
  sigmaQ: number
  /** 3σ（样本），用于与 RSS 对照。 */
  halfWidthQ: number
  /** 样本 P0.135 / P99.865（线性插值分位）。 */
  p0135Q: number
  p99865Q: number
  /** 区间端点取 P0.135 / P99.865。 */
  intervalMinQ: number
  intervalMaxQ: number
  /** 样本值指纹：同种子同输入必须逐位相同。 */
  sampleDigest: string
}

export interface CrossCheck {
  rssHalfWidthQ: number
  mcLowerHalfWidthQ: number
  mcUpperHalfWidthQ: number
  /** max(|MC 下侧 − RSS|, |MC 上侧 − RSS|) / RSS 半径；RSS 半径为 0 时为 null。 */
  relativeDeviation: number | null
  withinTolerance: boolean
  tolerance: number
}

/** 三法并列中的极值法一行：数值全部来自 calculateChain，不重算。 */
export interface ExtremeRow {
  method: 'extreme'
  minQ: Q
  maxQ: Q
  toleranceQ: Q
  /** 判定只取这一行（调用方必须展示原 status）。 */
  judgementBasis: true
}

export interface StatisticalSummary {
  generatorVersion: string
  extreme: ExtremeRow
  rss: RssResult
  monteCarlo: MonteCarloResult
  crossCheck: CrossCheck
  /** 固定文案：三法假设差异与“统计不替代判定”。 */
  assumptionNote: string
}

export const ASSUMPTION_NOTE =
  '三种方法并列：极值法假设所有组成环同时取极限，不需要分布假设，仍是条款判定的唯一依据；' +
  'RSS 假设各环独立且服从以公差带中点为中心的正态分布（σ=T/6，±3σ 约覆盖 99.73%）；中心相对名义值的 midpoint shift = Σsᵢ(EIᵢ+ESᵢ)/2，仅为参考期望偏移，不改名义尺寸或极值判据；' +
  '蒙特卡洛沿用同一分布假设做数值抽样，用来印证 RSS，不参与判定。' +
  '统计区间较窄来自概率假设，不代表装配更容易合格，也不会改变判定结论。'

function assertFinite(value: number, context: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`统计参数必须是有限数值：${context}`)
  }
  return value
}

function toleranceOf(term: ChainDefinition['terms'][number]): Q {
  return term.upperDeviationQ - term.lowerDeviationQ
}

/** RSS：σᵢ = Tᵢ/6，σ_C = √(Σσᵢ²)，区间 (C₀ + midpoint shift) ± 3σ_C。 */
export function rssOf(chain: ChainDefinition, nominalQ: Q): RssResult {
  assertFinite(nominalQ, 'nominalQ')
  const terms: RssTermSigma[] = []
  let sumSquares = 0
  // Same midpoint-centred distribution as MC; this shift is a reference
  // expectation, not a change to nominal dimensions or the extreme judgement.
  let midpointShiftQ = 0
  for (const term of chain.terms) {
    const toleranceQ = toleranceOf(term)
    if (toleranceQ < 0) {
      throw new RangeError(`组成环 ${term.id} 的公差为负`)
    }
    const sigmaQ = toleranceQ * SIGMA_PER_TOLERANCE
    midpointShiftQ += term.sign * (term.lowerDeviationQ + toleranceQ / 2)
    sumSquares += sigmaQ * sigmaQ
    terms.push({ termId: term.id, toleranceQ, sigmaQ })
  }
  const combinedSigmaQ = Math.sqrt(sumSquares)
  const halfWidthQ = 3 * combinedSigmaQ
  return {
    method: 'rss',
    terms,
    combinedSigmaQ,
    halfWidthQ,
    intervalMinQ: nominalQ + midpointShiftQ - halfWidthQ,
    intervalMaxQ: nominalQ + midpointShiftQ + halfWidthQ,
    distributionAssumption: 'normal',
  }
}

/* ------------------------------------------------------------------ */
/* 确定性伪随机：mulberry32（32 位整数运算，同种子逐位可复现）          */
/* ------------------------------------------------------------------ */

/** 单次抽样状态；只用整数与 Math.imul，避免平台差异。 */
export interface Rng {
  next: () => number
}

export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`随机种子必须是 0..2^32−1 的整数：${String(seed)}`)
  }
  let state = seed >>> 0
  return {
    next: () => {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

/** Box-Muller：返回标准正态样本；第二项缓存在下一次调用使用。 */
function createNormalSource(rng: Rng): () => number {
  let spare: number | null = null
  return () => {
    if (spare !== null) {
      const value = spare
      spare = null
      return value
    }
    // u1 ∈ (0,1]，避免 log(0)。
    const u1 = 1 - rng.next()
    const u2 = rng.next()
    const radius = Math.sqrt(-2 * Math.log(u1))
    const theta = 2 * Math.PI * u2
    spare = radius * Math.sin(theta)
    return radius * Math.cos(theta)
  }
}

/** 样本值指纹：把区间统计量拼成稳定字符串（不复制整份样本）。 */
function digestOf(
  seed: number,
  samples: number,
  distribution: SamplingDistribution,
  meanQ: number,
  sigmaQ: number,
  p0135Q: number,
  p99865Q: number,
  checksum: number,
): string {
  return [
    STATISTICS_GENERATOR_VERSION,
    distribution,
    `seed=${seed}`,
    `n=${samples}`,
    `mean=${meanQ.toFixed(6)}`,
    `sigma=${sigmaQ.toFixed(6)}`,
    `p0135=${p0135Q.toFixed(6)}`,
    `p99865=${p99865Q.toFixed(6)}`,
    `sum=${checksum.toFixed(6)}`,
  ].join('|')
}

function quantile(sorted: Float64Array, p: number): number {
  if (sorted.length === 0) throw new RangeError('样本为空')
  if (p <= 0) return sorted[0] as number
  if (p >= 1) return sorted[sorted.length - 1] as number
  const position = (sorted.length - 1) * p
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const weight = position - lower
  const low = sorted[lower] as number
  const high = sorted[upper] as number
  return low + (high - low) * weight
}

export interface MonteCarloOptions {
  seed: number
  samples: number
  distribution: SamplingDistribution
}

/**
 * 蒙特卡洛：按各环公差带抽样，求封闭环 C = Σ sᵢxᵢ 的均值/标准差/P0.135/P99.865。
 *
 * - 正态：xᵢ ~ N(midᵢ, (Tᵢ/6)²)，与 RSS 的 σ 假设完全一致（不截断）；
 * - 均匀：xᵢ ~ U(EIᵢ, ESᵢ)，此时 σᵢ = Tᵢ/√12 ≈ Tᵢ/3.464，与 RSS 的 Tᵢ/6
 *   不是同一假设，交叉验证会如实给出更大偏差，不调参凑数。
 *
 * 同种子 + 同输入 ⇒ 逐位相同的样本序列与统计量（mulberry32 + Box-Muller）。
 */
export function monteCarloOf(
  chain: ChainDefinition,
  nominalQ: Q,
  options: MonteCarloOptions = {
    seed: DEFAULT_MC_SEED,
    samples: DEFAULT_MC_SAMPLES,
    distribution: 'normal',
  },
): MonteCarloResult {
  assertFinite(nominalQ, 'nominalQ')
  const { seed, samples, distribution } = options
  if (!Number.isInteger(samples) || samples < 1) {
    throw new RangeError(`样本数必须是正整数：${String(samples)}`)
  }
  if (distribution !== 'normal' && distribution !== 'uniform') {
    throw new RangeError(`未知抽样分布：${String(distribution)}`)
  }
  const rng = createRng(seed)
  const normal = distribution === 'normal' ? createNormalSource(rng) : null

  // 预计算每环的抽样参数，避免在样本循环里重复读取。
  const rings = chain.terms.map((term) => {
    const toleranceQ = toleranceOf(term)
    if (toleranceQ < 0) {
      throw new RangeError(`组成环 ${term.id} 的公差为负`)
    }
    const lowerQ = term.lowerDeviationQ
    const midQ = lowerQ + toleranceQ / 2
    return {
      sign: term.sign,
      toleranceQ,
      lowerQ,
      midQ,
      sigmaQ: toleranceQ * SIGMA_PER_TOLERANCE,
    }
  })

  const values = new Float64Array(samples)
  let sum = 0
  for (let index = 0; index < samples; index += 1) {
    let closed = 0
    for (const ring of rings) {
      let sampleQ: number
      if (normal !== null) {
        sampleQ = ring.midQ + ring.sigmaQ * normal()
      } else {
        sampleQ = ring.lowerQ + ring.toleranceQ * rng.next()
      }
      closed += ring.sign * sampleQ
    }
    // 封闭环基准：C₀ 由 calculateChain 给出的名义值，这里加偏移后的环值
    // 与各环名义无关（抽样只影响偏差部分），直接累加 sign·(偏差) 再加 C₀。
    values[index] = closed
    sum += closed
  }

  // 环值 = 名义 + 偏差；Σ sign·名义 = C₀，所以 C = C₀ + Σ sign·偏差。
  // rings 里用的是偏差坐标（lower/mid 均为偏差），上面累加的正是偏差和。
  const meanQ = sum / samples + nominalQ
  let variance = 0
  for (let index = 0; index < samples; index += 1) {
    const delta = (values[index] as number) + nominalQ - meanQ
    variance += delta * delta
  }
  const sigmaQ = samples > 1 ? Math.sqrt(variance / (samples - 1)) : 0

  const shifted = new Float64Array(samples)
  for (let index = 0; index < samples; index += 1) {
    shifted[index] = (values[index] as number) + nominalQ
  }
  shifted.sort()
  const p0135Q = quantile(shifted, 0.00135)
  const p99865Q = quantile(shifted, 0.99865)
  const halfWidthQ = 3 * sigmaQ
  const checksum = values.reduce((acc, value) => acc + value, 0)

  return {
    method: 'monte-carlo',
    distribution,
    seed,
    samples,
    meanQ,
    sigmaQ,
    halfWidthQ,
    p0135Q,
    p99865Q,
    intervalMinQ: p0135Q,
    intervalMaxQ: p99865Q,
    sampleDigest: digestOf(seed, samples, distribution, meanQ, sigmaQ, p0135Q, p99865Q, checksum),
  }
}

/** 交叉验证：MC 的 ±3σ 与 RSS 的 ±3σ_C 的相对偏差（半径口径）。 */
export function crossCheck(rss: RssResult, monteCarlo: MonteCarloResult): CrossCheck {
  const mcLowerHalfWidthQ = monteCarlo.meanQ - monteCarlo.intervalMinQ
  const mcUpperHalfWidthQ = monteCarlo.intervalMaxQ - monteCarlo.meanQ
  if (rss.halfWidthQ === 0) {
    return {
      rssHalfWidthQ: 0,
      mcLowerHalfWidthQ,
      mcUpperHalfWidthQ,
      relativeDeviation: null,
      withinTolerance: false,
      tolerance: CROSS_CHECK_TOLERANCE,
    }
  }
  const relativeDeviation =
    Math.max(
      Math.abs(mcLowerHalfWidthQ - rss.halfWidthQ),
      Math.abs(mcUpperHalfWidthQ - rss.halfWidthQ),
    ) / rss.halfWidthQ
  return {
    rssHalfWidthQ: rss.halfWidthQ,
    mcLowerHalfWidthQ,
    mcUpperHalfWidthQ,
    relativeDeviation,
    withinTolerance: relativeDeviation <= CROSS_CHECK_TOLERANCE,
    tolerance: CROSS_CHECK_TOLERANCE,
  }
}

/** 三法汇总；极值行由调用方传入 calculateChain 的结果，不在这里重算。 */
export function statisticalSummaryOf(
  chain: ChainDefinition,
  extreme: { nominalQ: Q; minQ: Q; maxQ: Q; toleranceQ: Q },
  options?: MonteCarloOptions,
): StatisticalSummary {
  const rss = rssOf(chain, extreme.nominalQ)
  const monteCarlo = monteCarloOf(chain, extreme.nominalQ, options)
  return {
    generatorVersion: STATISTICS_GENERATOR_VERSION,
    extreme: {
      method: 'extreme',
      minQ: extreme.minQ,
      maxQ: extreme.maxQ,
      toleranceQ: extreme.toleranceQ,
      judgementBasis: true,
    },
    rss,
    monteCarlo,
    crossCheck: crossCheck(rss, monteCarlo),
    assumptionNote: ASSUMPTION_NOTE,
  }
}
