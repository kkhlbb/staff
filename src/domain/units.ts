import { MAX_ABS_Q, Q_PER_MM, type Q } from './types'

export type UnitErrorCode = 'empty' | 'format' | 'precision' | 'range'

export type ParseMmResult =
  | { ok: true; value: Q }
  | { ok: false; code: UnitErrorCode; message: string }

export class UnitParseError extends Error {
  readonly code: UnitErrorCode
  readonly input: string

  constructor(code: UnitErrorCode, message: string, input: string) {
    super(message)
    this.name = 'UnitParseError'
    this.code = code
    this.input = input
  }
}

const DECIMAL_PATTERN = /^([+-])?(\d+)(?:\.(\d+))?$/
const DECIMALS = 4
/** 1,000,000 mm 的整数部分是 7 位；更长的数字串直接判越界，避免转 Number 时失精度。 */
const MAX_INT_DIGITS = 7
const RANGE_MESSAGE = '绝对值不能超过 1,000,000 mm'

/**
 * 把十进制 mm 字符串精确转换为整数单位 q。
 * 先校验格式和位数，再拆分整数与小数部分分别转换后拼成整数，不经过 parseFloat(x) * 10000。
 */
export function tryParseMm(input: string): ParseMmResult {
  const text = input.trim()
  if (text === '') {
    return { ok: false, code: 'empty', message: '请输入数值' }
  }

  const match = DECIMAL_PATTERN.exec(text)
  if (!match) {
    return { ok: false, code: 'format', message: '格式不正确，请输入十进制数字，例如 20 或 -0.0200' }
  }

  const [, signText, intText, fracText = ''] = match
  if (fracText.length > DECIMALS) {
    return { ok: false, code: 'precision', message: `最多 ${DECIMALS} 位小数（最小步长 0.0001 mm）` }
  }

  const intDigits = intText.replace(/^0+(?=\d)/, '')
  if (intDigits.length > MAX_INT_DIGITS) {
    return { ok: false, code: 'range', message: RANGE_MESSAGE }
  }

  const magnitude = Number(intDigits) * Q_PER_MM + Number(fracText.padEnd(DECIMALS, '0'))
  if (magnitude > MAX_ABS_Q) {
    return { ok: false, code: 'range', message: RANGE_MESSAGE }
  }

  // magnitude 为 0 时直接返回 0，避免产生 -0。
  const value = signText === '-' && magnitude !== 0 ? -magnitude : magnitude
  if (!Number.isSafeInteger(value)) {
    return { ok: false, code: 'range', message: '数值超出安全整数范围' }
  }
  return { ok: true, value }
}

export function parseMm(input: string): Q {
  const result = tryParseMm(input)
  if (!result.ok) {
    throw new UnitParseError(result.code, result.message, input)
  }
  return result.value
}

/** 用整数运算把 q 格式化为固定 4 位小数的 mm 字符串。 */
export function formatMm(value: Q, options: { signed?: boolean } = {}): string {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`formatMm 需要安全整数，收到 ${String(value)}`)
  }
  const abs = Math.abs(value)
  const intPart = Math.floor(abs / Q_PER_MM)
  const fracPart = String(abs % Q_PER_MM).padStart(DECIMALS, '0')
  const sign = value < 0 ? '-' : options.signed ? '+' : ''
  return `${sign}${intPart}.${fracPart}`
}
