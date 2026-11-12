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
 * - **不做算术求值**：形态 1 中间那段只做“字符是否越界”的校验（不含单位、不含汉字、
 *   不能是孤立符号），原文字符串原样交给调用方；**绝不计算**，也绝不与结果值比对。
 *   中间式允许出现字母/乘除/括号（`B1=B1+B1under=135+250/2=260 mm`、
 *   `Δ0=Δ1+Δ2=[0.05+(−0.05)]/2=0mm`），被采用的永远是末尾那枚显式结果值。
 * - **中间夹着第二处赋值的行不算**：`EI0=…=−0.07mm.It can be seen B1=260±0.07mm` 里
 *   末尾的 `260±0.07mm` 属于另一处赋值；中间块出现单位/汉字即返回 null，交回既有阻塞。
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

/** 符号位：拉丁字母或希腊字母开头（`Δ0`、`δL` 与 `B1` 是同一类符号位，不猜其含义）。 */
const SYMBOL_SOURCE = '[A-Za-z\\u0391-\\u03a9\\u03b1-\\u03c9][A-Za-z0-9\\u0391-\\u03a9\\u03b1-\\u03c9]*'
const SYMBOL_TAIL = new RegExp(`(${SYMBOL_SOURCE})\\s*$`, 'u')
const BARE_SYMBOL = new RegExp(`^${SYMBOL_SOURCE}$`, 'u')

/**
 * 中间式里出现这些字符就说明“这不只是一个式子”：显式单位、汉字。
 * 为什么必须禁：`EI0=…−0.07mm.It can be seen B1=260±0.07mm` 这种行里，末尾的
 * `260±0.07mm` 属于**另一处赋值**，不能挂到 `EI0` 头上。单位串在这里判定更严
 * （拉丁字母单位必须自成词），避免 `Ring` 里的 `in` 被误当英制单位。
 */
const MIDDLE_FORBIDDEN = /(?:英寸|inch|毫米|mm|(?<![A-Za-z])in(?![A-Za-z])|[″”"]|[\u4e00-\u9fff])/iu

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

/** 一个十进制数值文本（`inconsistent` 只做十进制字符串归一比较，不经浮点）。 */
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
  const symbolMatch = SYMBOL_TAIL.exec(left)
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
    // 中间式按 `=` 再切（允许 3 个及以上等号），每一块都必须非空、不含单位/汉字，
    // 且不能是孤立符号：`A = B = 10 = 12 mm` 那种是符号链，交回既有解析（硬约束 3）。
    // 仍不做算术求值：这些块只做“字符是否越界”的校验，原文原样留在 evidence。
    const expressionChunks = expressionRaw.split('=').map((chunk) => chunk.trim())
    if (expressionChunks.some((chunk) => chunk === '')) return null
    if (expressionChunks.some((chunk) => BARE_SYMBOL.test(chunk))) return null
    if (expressionChunks.some((chunk) => MIDDLE_FORBIDDEN.test(chunk))) return null
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

/**
 * 这一整行是不是「赋值行」（而不是公式行）：只要有一个逗号片段命中三种形态之一即可。
 *
 * 供 parse 的公式分支让位用：`Zmax=5.2+0.1-4.9=0.4mm)`、`a1=759.48±0.1mm` 这类行
 * 原文里已经写出了带单位的结果值，属于赋值；旧顺序里它们先被 `parseFormulaLine`
 * 当成“无法解析的公式”拦下（`FORMULA_UNSUPPORTED`），P1 的三种形态永远看不到它们。
 * 本函数只做形态判定，不看数值、不做任何求值，也不改 `FORMULA_UNSUPPORTED` 的判定条件。
 */
export function lineMatchesAssignmentForm(text: string): boolean {
  let offset = 0
  for (const segment of text.split(',')) {
    const start = offset
    offset += segment.length + 1
    if (matchExpressionAssignment(text, start, start + segment.length) !== null) return true
  }
  return false
}
