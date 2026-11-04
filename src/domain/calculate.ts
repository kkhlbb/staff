import type { ChainDefinition, ChainResult, DimensionTerm, Q } from './types'

/** 计算引擎版本，写入项目和报告。 */
export const ENGINE_VERSION = '0.1.0'

type Contribution = { termId: string; toleranceQ: number }
type Ratio = { termId: string; ratio: number | null }

function assertSafeInteger(value: number, context: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`计算中间结果超出安全整数范围：${context}`)
  }
  return value
}

/** 每次加法后都检查安全整数，避免超出 2^53-1 后静默丢精度。 */
function safeAdd(a: number, b: number, context: string): number {
  return assertSafeInteger(a + b, context)
}

/** 每次减法后都检查安全整数，避免超出 2^53-1 后静默丢精度。 */
function safeSub(a: number, b: number, context: string): number {
  return assertSafeInteger(a - b, context)
}

/** sᵢNᵢ 的乘法同样检查，保证后续累计使用的是安全整数。 */
function safeMul(a: number, b: number, context: string): number {
  return assertSafeInteger(a * b, context)
}

/**
 * 单个组成环的极限尺寸：Lᵢ = Nᵢ + EIᵢ，Uᵢ = Nᵢ + ESᵢ。
 *
 * 纯函数，UI 与 calculateChain 共用这一份实现，避免在组件里另写加减公式。
 */
export function termLimits(term: DimensionTerm): { lowerQ: Q; upperQ: Q } {
  return {
    lowerQ: safeAdd(term.nominalQ, term.lowerDeviationQ, `L(${term.id})`),
    upperQ: safeAdd(term.nominalQ, term.upperDeviationQ, `U(${term.id})`),
  }
}

/**
 * 按文档 4.1–4.3 计算线性尺寸链的极值与目标判定。
 *
 * 纯函数：不修改输入，不依赖 UI、存储或校验模块；输入默认已经通过 validateChain。
 * status 只反映数值区间与目标区间的关系，不读取 relationConfirmed：
 * 关系确认属于 UI 的正式判定门槛，计算内核始终给出可预览的数值结论。
 */
export function calculateChain(chain: ChainDefinition): ChainResult {
  let nominalQ = 0
  let minQ = 0
  let maxQ = 0
  let toleranceSumQ = 0
  const contributions: Contribution[] = []

  for (const term of chain.terms) {
    const {
      id,
      nominalQ: termNominalQ,
      lowerDeviationQ: termLowerDeviationQ,
      upperDeviationQ: termUpperDeviationQ,
      sign,
    } = term

    // Lᵢ、Uᵢ 由 termLimits 统一计算；Tᵢ = ESᵢ − EIᵢ 仍只依赖偏差。
    const { lowerQ: lowerLimitQ, upperQ: upperLimitQ } = termLimits(term)
    const termToleranceQ = safeSub(termUpperDeviationQ, termLowerDeviationQ, `T(${id})`)

    // 基本尺寸：nominalQ = Σ sᵢNᵢ
    nominalQ = safeAdd(nominalQ, safeMul(sign, termNominalQ, `sN(${id})`), `nominalQ + sN(${id})`)

    // 最小值：sᵢ=+1 取 Lᵢ，sᵢ=−1 取 −Uᵢ
    const minPartQ = sign === 1 ? lowerLimitQ : safeSub(0, upperLimitQ, `-U(${id})`)
    minQ = safeAdd(minQ, minPartQ, `minQ + ${sign === 1 ? 'L' : '-U'}(${id})`)

    // 最大值：sᵢ=+1 取 Uᵢ，sᵢ=−1 取 −Lᵢ
    const maxPartQ = sign === 1 ? upperLimitQ : safeSub(0, lowerLimitQ, `-L(${id})`)
    maxQ = safeAdd(maxQ, maxPartQ, `maxQ + ${sign === 1 ? 'U' : '-L'}(${id})`)

    toleranceSumQ = safeAdd(toleranceSumQ, termToleranceQ, `ΣT(${id})`)
    // 贡献保持 terms 的原始顺序，重排只影响数组顺序，不影响各项数值。
    contributions.push({ termId: id, toleranceQ: termToleranceQ })
  }

  const lowerDeviationQ = safeSub(minQ, nominalQ, 'lowerDeviationQ')
  const upperDeviationQ = safeSub(maxQ, nominalQ, 'upperDeviationQ')
  const toleranceQ = safeSub(maxQ, minQ, 'toleranceQ')

  // 文档要求 Tc = Cmax − Cmin = ΣTᵢ；整数运算下若不等，说明输入或实现异常。
  if (toleranceQ !== toleranceSumQ) {
    throw new Error(`封闭环公差 ${toleranceQ} 不等于 ΣTᵢ ${toleranceSumQ}`)
  }

  let status: ChainResult['status']
  let lowerMarginQ: number | null
  let upperMarginQ: number | null

  if (chain.target === null) {
    status = 'no-target'
    lowerMarginQ = null
    upperMarginQ = null
  } else {
    lowerMarginQ = safeSub(minQ, chain.target.minQ, 'lowerMarginQ')
    upperMarginQ = safeSub(chain.target.maxQ, maxQ, 'upperMarginQ')
    // 边界相等算 within；只部分重叠仍算 outside。
    status =
      minQ >= chain.target.minQ && maxQ <= chain.target.maxQ ? 'within' : 'outside'
  }

  return {
    nominalQ,
    minQ,
    maxQ,
    lowerDeviationQ,
    upperDeviationQ,
    toleranceQ,
    status,
    lowerMarginQ,
    upperMarginQ,
    contributions,
  }
}

/**
 * 公差贡献比例 pᵢ = Tᵢ / ΣTᵢ，仅用于显示，不参与工程判定。
 * ΣTᵢ = 0 时所有比例返回 null（UI 显示“—”），避免出现 NaN。
 */
export function contributionRatios(result: ChainResult): Ratio[] {
  const totalToleranceQ = result.toleranceQ
  return result.contributions.map(({ termId, toleranceQ }) => ({
    termId,
    ratio: totalToleranceQ === 0 ? null : toleranceQ / totalToleranceQ,
  }))
}
