/**
 * P0：单位从表头/上下文继承 —— 纯判定层（不读文件、不碰 pdfjs、不产生默认值）。
 *
 * 为什么单独成模块：单位来源的“认定”与“出处”是两件事，必须能单独审查。
 * 本模块只回答三个问题：
 * 1. 这一行有没有**显式写出**的单位声明（`单位：mm` / `Units: mm` / 图注 `（mm）`）；
 * 2. 同一处数值可用哪些作用域的声明（表格表头 / 同一页 / 文档级），是否互相矛盾；
 * 3. 矛盾时怎么表达（`conflict` → 调用方必须阻塞，不许挑一个）。
 *
 * 三条硬边界（对应任务卡第 1 节）：
 * - **只认显式文字**：每个声明都带一条 `ExtractionEvidence`（页 / 选区 / item 索引 / 原文片段），
 *   没有出处就不算声明；
 * - **冲突不择优**：同一组可用声明里出现两个不同单位 → 返回 `conflict`，调用方只能阻塞；
 * - **有界作用域**：本模块不扫别的页——文档级声明由调用方按“页范围第一页”挑出来再传进来，
 *   本模块不做任何跨页推断。
 */
import { evidenceKey, type ExtractionEvidence } from './types'
import type { PdfTextLine } from './textLayer'

export type ParsedUnitKind = 'mm' | 'unsupported' | 'unknown' | 'missing'

export interface ParsedUnit {
  readonly kind: ParsedUnitKind
  readonly text: string | null
}

/**
 * 单位串 → 分类。行为与 V3.6 完全一致：只认 mm 为可用单位，英制一律 unsupported，
 * 其它写法一律 unknown。**不做换算、不做别名推断**（例如 `cmm` 不会当成 mm）。
 */
export function parseUnitToken(token: string | null | undefined): ParsedUnit {
  if (!token) return { kind: 'missing', text: null }
  const text = token.trim()
  if (text === '') return { kind: 'missing', text: null }
  const lower = text.toLowerCase()
  if (lower === 'mm' || text === '毫米' || text === '㎜') return { kind: 'mm', text }
  if (
    lower === 'in' ||
    lower === 'inch' ||
    text === '英寸' ||
    text === '"' ||
    text === '”' ||
    text === '″'
  ) {
    return { kind: 'unsupported', text }
  }
  return { kind: 'unknown', text }
}

/** 单位不可用时的原因码：英制按既有规则是 UNSUPPORTED_UNIT，其余一律 UNKNOWN_UNIT。 */
export function unitReason(
  unit: ParsedUnit,
): 'UNSUPPORTED_UNIT' | 'UNKNOWN_UNIT' {
  return unit.kind === 'unsupported' ? 'UNSUPPORTED_UNIT' : 'UNKNOWN_UNIT'
}

/** 声明来自哪里；`table` = 同一表格的表头，`page` = 同一页的「单位：」句，`caption` = 图注，`document` = 文档级。 */
export type UnitScope = 'document' | 'page' | 'caption' | 'table'

export interface UnitDeclaration {
  readonly scope: UnitScope
  readonly page: number
  readonly unit: ParsedUnit
  /** 声明的原文出处（必须是显式文字所在的 item，不能是推断）。 */
  readonly evidence: ExtractionEvidence
}

export interface UnitResolution {
  /** absent：没有任何可用声明（照旧阻塞）；inherited：唯一单位可用；conflict：单位互相矛盾。 */
  readonly status: 'absent' | 'inherited' | 'conflict'
  readonly unit: ParsedUnit | null
  readonly declarations: readonly UnitDeclaration[]
}

/**
 * 显式单位串。只列“能明确读出是单位”的写法：
 * - 英制：`in` / `inch` / `英寸` / `"` / `”` / `″`
 * - 公制：`mm` / `毫米` / `㎜`（NFKC 后多半已变 `mm`）
 * 其余单位（cm、μm、mil…）不在名单内 → 不会被当成本次可继承的单位。
 */
export const UNIT_TEXT_SOURCE = '(?:英寸|inch|毫米|mm|in|["”″])'

/** 「单位：mm」「单位为毫米」「单位是 mm」。 */
const UNIT_DECLARATION_ZH = new RegExp(`单位\\s*(?:[:：]|为|是)\\s*(${UNIT_TEXT_SOURCE})`, 'di')
/** 英文版 「Unit: mm」「Units: inch」。 */
const UNIT_DECLARATION_EN = new RegExp(
  `(?:^|[\\s,;，；])units?\\s*[:：]\\s*(${UNIT_TEXT_SOURCE})`,
  'di',
)
/** 图注行首：图 / 图注 / Fig. / Figure + 可选编号。 */
const CAPTION_HEAD = /^\s*(?:图注|图|fig\.?|figure)\s*\d*/i
/** 图注里的单位：只要括号里那一段 `（mm）` / `(in)`。 */
const CAPTION_UNIT = new RegExp(`[（(]\\s*(${UNIT_TEXT_SOURCE})\\s*[)）]`, 'di')

export type SpanEvidence = (start: number, end: number) => ExtractionEvidence | null

export interface DetectDeclarationInput {
  readonly line: PdfTextLine
  readonly page: number
  /** 本行所在的作用域；`table` 的表头声明由 parse 侧单独构造（它要覆盖整段表头文字）。 */
  readonly scope: 'page' | 'caption'
  readonly evidence: SpanEvidence
}

/**
 * 从一行里找出**显式**单位声明。命中什么就返回什么，找不到返回空数组；
 * 本函数不猜“这一行大概在讲单位”，只认 `单位：x` / `Unit: x` / 图注 `（x）` 三种明确写法。
 */
export function detectUnitDeclarations(
  input: DetectDeclarationInput,
): readonly UnitDeclaration[] {
  const text = input.line.normalizedText
  const declarations: UnitDeclaration[] = []
  const push = (unitText: string, start: number, end: number, scope: UnitScope): void => {
    const evidence = input.evidence(start, end)
    if (!evidence) return
    declarations.push({
      scope,
      page: input.page,
      unit: parseUnitToken(unitText),
      evidence,
    })
  }

  for (const pattern of [UNIT_DECLARATION_ZH, UNIT_DECLARATION_EN]) {
    pattern.lastIndex = 0
    const match = pattern.exec(text)
    const unitRange = match?.indices?.[1]
    const wholeRange = match?.indices?.[0]
    if (!match || !unitRange || !wholeRange) continue
    // 出处覆盖整句声明（含「单位：」这个标签），便于人工核对；单位本身是 group 1。
    push(match[1], wholeRange[0], wholeRange[1], input.scope)
  }

  if (CAPTION_HEAD.test(text)) {
    CAPTION_UNIT.lastIndex = 0
    const match = CAPTION_UNIT.exec(text)
    const unitRange = match?.indices?.[1]
    const wholeRange = match?.indices?.[0]
    if (match && unitRange && wholeRange) {
      push(match[1], wholeRange[0], wholeRange[1], 'caption')
    }
  }

  return declarations
}

/**
 * 用户给的一句单位声明（L2 批量补单位）→ 可识别单位。
 *
 * 与文档抽取的区别：文档里必须出现「单位：」「Unit:」这类**显式标签**；用户声明是
 * 人的一句话，允许「本表单位 mm」这种不带冒号的写法（仍要求出现“单位/unit”这个词，
 * 且后面紧跟受支持的单位写法）。**不猜同义词、不做换算**：一句里出现两类单位
 * （mm 与 in）一律 `conflict`，由调用方整批拒绝；找不到任何写法 → `none`。
 */
export interface UnitStatementResolution {
  readonly status: 'single' | 'conflict' | 'none'
  readonly unit: ParsedUnit | null
  /** 命中的单位原文（逐字，供报错/留痕；不重写用户句子）。 */
  readonly tokens: readonly string[]
}

/** 用户声明：`单位 mm` / `单位：mm` / `单位为毫米` / `Units: mm`。 */
const USER_UNIT_ZH = new RegExp(`单位\\s*(?:[:：]|为|是)?\\s*(${UNIT_TEXT_SOURCE})`, 'dgi')
const USER_UNIT_EN = new RegExp(
  `(?:^|[\\s,;，；(（])units?\\s*(?:[:：]|为|是)?\\s*(${UNIT_TEXT_SOURCE})`,
  'dgi',
)

export function parseUnitStatement(statement: string): UnitStatementResolution {
  const text = statement.trim()
  if (text === '') return { status: 'none', unit: null, tokens: [] }
  const tokens: string[] = []
  for (const pattern of [USER_UNIT_ZH, USER_UNIT_EN]) {
    pattern.lastIndex = 0
    let match = pattern.exec(text)
    while (match !== null) {
      tokens.push(match[1])
      match = pattern.exec(text)
    }
  }
  if (tokens.length === 0) return { status: 'none', unit: null, tokens: [] }
  const kinds = new Set(tokens.map((token) => parseUnitToken(token).kind))
  if (kinds.size > 1) return { status: 'conflict', unit: null, tokens }
  return { status: 'single', unit: parseUnitToken(tokens[0]), tokens }
}

/**
 * 合并一处数值可用的全部声明。
 * - 按出处去重（同一句被页级与文档级同时看到时只算一条）；
 * - 只剩一种单位 → `inherited`；
 * - 出现两种及以上不同单位 → `conflict`（调用方只能阻塞，不能挑一个）。
 */
export function resolveUnit(
  declarations: readonly UnitDeclaration[],
): UnitResolution {
  const unique: UnitDeclaration[] = []
  const seen = new Set<string>()
  for (const declaration of declarations) {
    const key = evidenceKey(declaration.evidence)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(declaration)
  }
  if (unique.length === 0) return { status: 'absent', unit: null, declarations: [] }
  const kinds = new Set(unique.map((declaration) => declaration.unit.kind))
  if (kinds.size > 1) return { status: 'conflict', unit: null, declarations: unique }
  return { status: 'inherited', unit: unique[0].unit, declarations: unique }
}

/** 继承依据写进候选 confidenceBasis 的标记（不新增 schema 字段）。 */
export function inheritedUnitBasis(resolution: UnitResolution): string | null {
  if (resolution.status !== 'inherited' || resolution.declarations.length === 0) return null
  const scope = resolution.declarations[0].scope
  if (scope === 'table') return 'RULE_UNIT_INHERITED_TABLE'
  if (scope === 'caption') return 'RULE_UNIT_INHERITED_CAPTION'
  if (scope === 'document') return 'RULE_UNIT_INHERITED_DOCUMENT'
  return 'RULE_UNIT_INHERITED_PAGE'
}

/** 声明的人读标签，用于 issue 文案（不外传结构化数据）。 */
export function declarationLabel(declaration: UnitDeclaration): string {
  const scope =
    declaration.scope === 'table'
      ? '表头'
      : declaration.scope === 'caption'
        ? '图注'
        : declaration.scope === 'document'
          ? '文档级（页范围第一页）'
          : '页内'
  return `${scope}「${declaration.evidence.textSnippet.trim()}」→ ${declaration.unit.text ?? '?'}`
}
