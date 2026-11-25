/**
 * 标注数字的唯一解析与格式化（V3-C-02，红线段 2）。
 *
 * 约束：
 * - 标注只绑定 parameterId，数字来自参数快照的 valueQ，不读几何、像素或缩放；
 * - 先验证 inputDecimals 元数据，再统一显示，不经过浮点 toFixed；
 * - valueQ 不能被 inputDecimals 无损表达时明确报错，绝不把 12.1001 显示成 12.10。
 */
import { Q_PER_MM, type Q } from '../domain/types.ts'
import type { ParameterSnapshotItem } from '../drawing/types'

export interface DimensionResolution {
  parameterId: string
  key: ParameterSnapshotItem['key']
  valueQ: Q
  inputDecimals: number
  /** 不含直径符号的数值文字，例如 "20.00"。 */
  valueText: string
}

export type ResolveDimensionResult =
  | { ok: true; value: DimensionResolution }
  | { ok: false; message: string }

/**
 * 把 q 按 decimals 位小数无损格式化。
 * decimals=0 → "12"；2 → "12.10"；4 → "12.1000"。尾零保留。
 * 无法无损表达时返回 null（例如 q=121001 要 3 位小数）。
 */
export function formatQWithDecimals(valueQ: Q, decimals: number): string | null {
  if (!Number.isSafeInteger(valueQ)) return null
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4) return null
  const abs = Math.abs(valueQ)
  const intPart = Math.floor(abs / Q_PER_MM)
  const fracQ = abs % Q_PER_MM
  const divisor = 10 ** (4 - decimals)
  if (fracQ % divisor !== 0) return null
  const fracDigits = String(fracQ / divisor).padStart(decimals, '0')
  const sign = valueQ < 0 ? '-' : ''
  return decimals === 0 ? `${sign}${intPart}` : `${sign}${intPart}.${fracDigits}`
}

/** 只返回格式化文字；调用方拿不到文字时必须按数据不一致处理。 */
export function formatParameterValue(valueQ: Q, decimals: number): string | null {
  if (formatQWithDecimals(valueQ, decimals) === null) return null
  return formatQWithDecimals(valueQ, valueQ % 10 === 0 ? 3 : 4)
}

/**
 * 标注数字解析：只查 parameterId 对应的参数快照。
 * 找不到参数、混淆重复 ID、元数据无法无损表达时返回错误。
 */
export function resolveDimension(
  parameterId: string,
  snapshot: readonly ParameterSnapshotItem[],
): ResolveDimensionResult {
  const matches = snapshot.filter((item) => item.parameterId === parameterId)
  if (matches.length === 0) {
    return { ok: false, message: `标注引用了不存在的参数：${parameterId}` }
  }
  if (matches.length > 1) {
    return { ok: false, message: `参数快照里 parameterId 重复：${parameterId}` }
  }
  const item = matches[0]
  const valueText = formatParameterValue(item.valueQ, item.inputDecimals)
  if (valueText === null) {
    return {
      ok: false,
      message: `参数 ${item.key} 的 q=${item.valueQ} 无法用 ${item.inputDecimals} 位小数无损显示`,
    }
  }
  return {
    ok: true,
    value: {
      parameterId: item.parameterId,
      key: item.key,
      valueQ: item.valueQ,
      inputDecimals: item.inputDecimals,
      valueText,
    },
  }
}

/** 标注最终文字：直径标注加 ⌀ 前缀；长度不加。 */
export function dimensionText(
  resolution: DimensionResolution,
  kind: 'diameter' | 'length',
): string {
  return kind === 'diameter' ? `⌀${resolution.valueText}` : resolution.valueText
}
