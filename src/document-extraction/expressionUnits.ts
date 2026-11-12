/**
 * P1：表达式末尾单位 —— 纯匹配层（不读文件、不碰 pdfjs、不做算术求值）。
 *
 * 只回答一个问题：这一小段（逗号分隔的赋值片段）是不是任务卡允许的**三种明确形态**之一，
 * 是的话每个数字/单位在原字符串里的区间在哪：
 *
 * 1. `符号 = 表达式 = 数值 单位`（末尾等号后是结果值）       → form 'redundant'
 * 2. `符号 = 数值 ± 偏差 单位`                              → form 'deviation'
 * 3. `符号 = 数值 单位`                                     → form 'single'
 *
 * 三条硬边界：
 * - **不做算术求值**：形态 1 中间那段只校验“是不是由数字和 +/- 组成的式子”（纯字符串判定），
 *   原文字符串原样交给调用方；绝不计算，也绝不与结果值比对。
 * - **多个等号但末段不是数值** → 返回 null，交回原有解析路径（保持既有阻塞）。
 * - **多个等号结果不一致**（`A = 10 = 12 mm`）→ 标 `inconsistent`，调用方必须阻塞整条，
 *   不允许挑其中一个值；一致性比较只做十进制字符串归一，不经浮点。
 *
 * 单位串沿用 `unitScope.ts` 的 `UNIT_TEXT_SOURCE`：能识别不等于能接受，mm 与否仍由
 * `parseUnitToken` / `buildQuantity` 判定（英制照旧 UNSUPPORTED_UNIT，未知照旧 UNKNOWN_UNIT）。
 */
import { UNIT_TEXT_SOURCE } from './unitScope'

export interface ExpressionSpan {
  readonly text: string
  readonly start: number
  readonly end: number
}

export type ExpressionForm = 'redundant' | 'deviation' | 'single'

export interface ExpressionFormMatch {
  readonly form: ExpressionForm
  /** 等号左侧紧邻的连续字母数字串（`A0max`、`T0`、`B1upper`）；原文区间。 */
  readonly symbol: ExpressionSpan
  /** 被采用的数值（形态 1 是最后一个等号后的结果值）。 */
  readonly nominal: ExpressionSpan
  readonly unit: ExpressionSpan
  /** 形态 2 的 `±偏差` 原文区间（含 ± 符号本身），其余形态为 null。 */
  readonly deviation: ExpressionSpan | null
  /** 形态 1 中间那段原表达式（原样字符串，未计算），其余形态为 null。 */
  readonly expression: ExpressionSpan | null
  /** 形态 1 且多个等号的结果值互不一致。 */
  readonly inconsistent: boolean
  /** 不一致时列出的各结果值原文（按出现顺序，最后一枚是末尾结果值）。 */
  readonly redundantValues: readonly ExpressionSpan[]
}

/** 一个数字项：普通数字，或括号包起来的负数 `(−0.3)`。 */
const EXPR_TERM = '(?:\\d+(?:\\.\\d+)?|\\(\\s*[+-]?\\d+(?:\\.\\d+)?\\s*\\))'
/** 纯加减式子：数字项之间只能出现 + / -。 */
const NUMERIC_EXPRESSION = new RegExp(`^\\s*[+-]?${EXPR_TERM}(?:\\s*[+-]\\s*${EXPR_TERM})*\\s*$`)
const BARE_DECIMAL = /^[+-]?\d+(?:\.\d+)?$/
/** 单位后面必须是词边界：不能再接字母数字，也不能是 `mm.5` 这种小数续写。 */
const UNIT_TAIL = '(?![A-Za-z0-9])(?!\\.\\d)'
const VALUE_UNIT = new RegExp(
  `^\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*(${UNIT_TEXT_SOURCE})${UNIT_TAIL}`,
  'id',
)
const VALUE_PM_UNIT = new RegExp(
  `^\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*(±)\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_TEXT_SOURCE})${UNIT_TAIL}`,
  'id',
)

type GroupRange = readonly [number, number]

function groupRange(match: RegExpExecArray, index: number): GroupRange | null {
  const indices = match.indices?.[index]
  return indices ? [indices[0], indices[1]] : null
}

/** 十进制字符串归一，仅用于“多个等号结果值是否一致”，不做数值运算。 */
function decimalKey(text: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text.trim())
  if (!match) return text.trim()
  const sign = match[1] === '-' ? '-' : ''
  const intPart = match[2].replace(/^0+(?=\d)/, '')
  const fracPart = (match[3] ?? '').replace(/0+$/, '')
  if (intPart === '0' && fracPart === '') return '0'
  return `${sign}${intPart}${fracPart === '' ? '' : `.${fracPart}`}`
}

function spanOf(text: string, base: number, range: GroupRange): ExpressionSpan {
  const start = base + range[0]
  const end = base + range[1]
  return { text: text.slice(start, end), start, end }
}

/**
 * 在一个逗号分隔片段 `[segmentStart, segmentEnd)` 里识别三种形态；识别不了返回 null
 * （调用方必须原样回落到既有解析，不得自行猜值）。
 */
export function matchExpressionAssignment(
  text: string,
  segmentStart: number,
  segmentEnd: number,
): ExpressionFormMatch | null {
  const segment = text.slice(segmentStart, segmentEnd)
  const equals = segment.indexOf('=')
  if (equals < 0) return null
  const left = segment.slice(0, equals)
  const symbolMatch = /([A-Za-z][A-Za-z0-9]*)\s*$/.exec(left)
  if (!symbolMatch) return null
  const symbolText = symbolMatch[1]
  const symbolEnd = left.trimEnd().length
  const symbol = spanOf(text, segmentStart, [symbolEnd - symbolText.length, symbolEnd])
  const rightStart = segmentStart + equals + 1
  const right = segment.slice(rightStart - segmentStart)

  const lastEquals = right.lastIndexOf('=')
  if (lastEquals >= 0) {
    // 形态 1：符号 = 表达式 = 数值 单位
    const expressionRaw = right.slice(0, lastEquals)
    // 等号多于两个 → 不解析，交回既有阻塞路径（硬约束 3）。
    if (expressionRaw.includes('=')) return null
    if (!NUMERIC_EXPRESSION.test(expressionRaw)) return null
    const tail = right.slice(lastEquals + 1)
    const tailMatch = VALUE_UNIT.exec(tail)
    const nominalRange = tailMatch ? groupRange(tailMatch, 1) : null
    const unitRange = tailMatch ? groupRange(tailMatch, 2) : null
    if (!tailMatch || !nominalRange || !unitRange) return null
    const tailStart = rightStart + lastEquals + 1
    const nominal = spanOf(text, tailStart, nominalRange)
    const unit = spanOf(text, tailStart, unitRange)
    const expressionTrim = expressionRaw.trim()
    const expressionStart = rightStart + expressionRaw.indexOf(expressionTrim)
    const expression = spanOf(text, expressionStart, [0, expressionTrim.length])
    const inconsistent =
      BARE_DECIMAL.test(expressionTrim) &&
      decimalKey(expressionTrim) !== decimalKey(nominal.text)
    return {
      form: 'redundant',
      symbol,
      nominal,
      unit,
      deviation: null,
      expression,
      inconsistent,
      redundantValues: inconsistent ? [expression, nominal] : [],
    }
  }

  // 形态 2：符号 = 数值 ± 偏差 单位
  const deviationMatch = VALUE_PM_UNIT.exec(right)
  if (deviationMatch) {
    const nominalRange = groupRange(deviationMatch, 1)
    const pmRange = groupRange(deviationMatch, 2)
    const deviationRange = groupRange(deviationMatch, 3)
    const unitRange = groupRange(deviationMatch, 4)
    if (nominalRange && pmRange && deviationRange && unitRange) {
      return {
        form: 'deviation',
        symbol,
        nominal: spanOf(text, rightStart, nominalRange),
        unit: spanOf(text, rightStart, unitRange),
        // 偏差出处覆盖 `±0.3` 整枚记号（± 与数字是同一段显式文字）。
        deviation: spanOf(text, rightStart, [pmRange[0], deviationRange[1]]),
        expression: null,
        inconsistent: false,
        redundantValues: [],
      }
    }
  }

  // 形态 3：符号 = 数值 单位
  const singleMatch = VALUE_UNIT.exec(right)
  if (singleMatch) {
    const nominalRange = groupRange(singleMatch, 1)
    const unitRange = groupRange(singleMatch, 2)
    if (nominalRange && unitRange) {
      return {
        form: 'single',
        symbol,
        nominal: spanOf(text, rightStart, nominalRange),
        unit: spanOf(text, rightStart, unitRange),
        deviation: null,
        expression: null,
        inconsistent: false,
        redundantValues: [],
      }
    }
  }

  return null
}
