/**
 * 任务书文本层 → 候选（确定性规则，不调用计算、不写项目）。
 *
 * 规则只做“看得见的抄写”：
 * - 组成环只从带表头的组成环表格行（位号 / 名称 / 基本尺寸 / 上偏差 / 下偏差）读取；
 * - 部件内外径 / 长度只从“内径 / 外径 / 长度”标注行读取，不当轴向环；
 * - 区间只读“X 应为 a～b mm（含两端）”这类显式区间句；
 * - 公式只读线性的 `C = H - B1 - S - B2`，不 eval、不改引擎公式。
 * - 单位只读显式文字：同一表格表头 / 同一页「单位：」句或图注 / 页范围第一页的文档级声明
 *   （见 unitScope.ts）。三者都没有就照旧阻塞，跨页只认文档级声明，绝不按相邻页猜。
 *
 * 宁可空着：单位不明且没有显式声明、精度不支持、同符号多值、公式矛盾、无文本层时一律
 * blocked 或只留 issue，绝不默认 mm、默认 0、默认闭区间、按相邻关系补值。
 */
import { tryParseMm } from '../domain/units'
import type { PdfPageBox, PdfRect } from '../sources/pdfCoordinates'
import { matchExpressionAssignment, type ExpressionFormMatch } from './expressionUnits'
import { stableId } from './ids'
import {
  itemRectPdf,
  itemsForSpan,
  unionRectPdf,
  type PdfTextLayer,
  type PdfTextLine,
  type PdfTextPage,
} from './textLayer'
import {
  declarationLabel,
  detectUnitDeclarations,
  inheritedUnitBasis,
  parseUnitToken,
  resolveUnit,
  UNIT_TEXT_SOURCE,
  unitReason,
  type UnitDeclaration,
  type UnitResolution,
} from './unitScope'
import {
  EXTRACTOR_VERSION,
  MAX_EXTRACTION_CANDIDATES,
  MAX_EXTRACTION_ISSUES,
  MAX_EXTRACTION_PAGES,
  evidenceKey,
  isEvidenceComplete,
  uniqueEvidence,
  type CandidateStatus,
  type ConfidenceLevel,
  type ExtractionCandidate,
  type ExtractionDraft,
  type ExtractionEvidence,
  type ExtractionIssue,
  type ExtractionOccurrence,
  type ExtractionPageRange,
  type ExtractionReasonCode,
  type ExtractionSourceIdentity,
  type FormulaCandidateData,
  type FormulaOperand,
  type IntervalCandidateData,
  type PartDimensionData,
  type QuantityValue,
  type RingCandidateData,
} from './types'

export interface ExtractionRequest {
  readonly projectId: string
  readonly baseToken: string
  readonly source: ExtractionSourceIdentity
  readonly pageRange: ExtractionPageRange
  readonly layer: PdfTextLayer
  /** 缺省用 EXTRACTOR_VERSION；规则升级时必须变化。 */
  readonly extractorVersion?: string
}

/** 破折号/减号变体：匹配时统一成 ASCII '-'，不修改原文。 */
const MINUS_VARIANTS = /[\u2212\u2013\u2014]/g

/**
 * 归一化后的匹配文本：NFKC（在 textLayer 完成）+ 减号变体统一。
 * 每个替换都是 1 字符 → 1 字符，因此正则命中偏移可直接映射回 item 区间。
 */
export function matchTextOf(line: PdfTextLine): string {
  return line.normalizedText.replace(MINUS_VARIANTS, '-')
}

function intersectRect(rect: PdfRect, box: PdfPageBox): PdfRect | null {
  const x0 = Math.max(rect[0], box[0])
  const y0 = Math.max(rect[1], box[1])
  const x1 = Math.min(rect[2], box[2])
  const y1 = Math.min(rect[3], box[3])
  if (!(x1 > x0) || !(y1 > y0)) return null
  return [x0, y0, x1, y1]
}

/**
 * 从行内 [start, end) 归一化区间生成出处；缺版本、页、页框、选区、原文任一项返回 null。
 * 这是 M02（“必须有原文出处 → 可空”）的唯一闸门：parse 与确认/应用都走 isEvidenceComplete。
 */
export function evidenceFromSpan(
  line: PdfTextLine,
  page: PdfTextPage,
  source: ExtractionSourceIdentity,
  start: number,
  end: number,
): ExtractionEvidence | null {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) return null
  const covered = itemsForSpan(line, start, end)
  if (covered.length === 0) return null
  const box = page.pageBoxPdf
  if (!box) return null
  const rects: PdfRect[] = []
  for (const item of covered) {
    if (!item.hasGeometry) continue
    const rect = itemRectPdf(item)
    if (rect) rects.push(rect)
  }
  const union = unionRectPdf(rects)
  if (!union) return null
  const rect = intersectRect(union, box)
  if (!rect) return null
  const evidence: ExtractionEvidence = {
    documentId: source.documentId,
    revisionId: source.revisionId,
    sha256: source.sha256,
    blobKey: source.blobKey,
    page: line.page,
    rectPdf: rect,
    pageBoxPdf: box,
    // 片段包含覆盖到的空格，保持原文可读；选区只由有字形的 item 合成。
    textSnippet: covered.map((item) => item.text).join(''),
    normalizedSnippet: covered.map((item) => item.normalizedText).join(''),
    textItemIndexes: [...new Set(covered.map((item) => item.itemIndex))].sort(
      (left, right) => left - right,
    ),
  }
  return isEvidenceComplete(evidence) ? evidence : null
}

function decimalCount(text: string): number {
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
}

interface QuantityOutcome {
  readonly value: QuantityValue | null
  readonly reason: ExtractionReasonCode | null
  /** 单位来自继承时的依据标记（写进候选 confidenceBasis）；显式单位或缺失时为 null。 */
  readonly unitBasis: string | null
}

/**
 * 数值字段构造：先要求出处齐全，再做十进制字符串 → q 的精确校验。
 * 单位不是 mm 时保留原文与 valueQ=null，绝不换算。
 *
 * 单位来源优先级（P0 单位继承的硬约束 3）：
 * 1. **显式单位**（同一格/同一句里写了的 unitText）—— 永远优先，继承值不得覆盖它；
 * 2. 继承值（表头 / 同一页 / 文档级声明）—— 只在显式单位缺席时使用，且必须带声明出处；
 * 3. 都没有 —— 照旧 `UNKNOWN_UNIT` 阻塞，不默认 mm。
 * 作用域里出现互相矛盾的单位时（`UNIT_CONFLICT`），这里只阻塞、不挑一个。
 */
function buildQuantity(input: {
  readonly text: string
  readonly unitToken: string | null
  readonly evidence: ExtractionEvidence | null
  readonly extraEvidence?: readonly ExtractionEvidence[]
  readonly inheritance?: UnitResolution | null
}): QuantityOutcome {
  const evidence = input.evidence
  if (!evidence || !isEvidenceComplete(evidence)) {
    // M02：缺出处 → 数值不进候选，只留 issue。
    return { value: null, reason: 'SOURCE_UNRESOLVED', unitBasis: null }
  }
  const text = input.text
  const parsed = tryParseMm(text)
  const explicit = parseUnitToken(input.unitToken)
  const inheritance = explicit.kind === 'missing' ? (input.inheritance ?? null) : null

  let unit = explicit
  let unitBasis: string | null = null
  const inheritedEvidence: ExtractionEvidence[] = []
  if (inheritance?.status === 'inherited' && inheritance.unit) {
    unit = inheritance.unit
    unitBasis = inheritedUnitBasis(inheritance)
    for (const declaration of inheritance.declarations) {
      if (isEvidenceComplete(declaration.evidence)) inheritedEvidence.push(declaration.evidence)
    }
  }
  const conflict = inheritance?.status === 'conflict'
  if (conflict) {
    for (const declaration of inheritance?.declarations ?? []) {
      if (isEvidenceComplete(declaration.evidence)) inheritedEvidence.push(declaration.evidence)
    }
  }

  const evidenceList = uniqueEvidence([
    evidence,
    ...(input.extraEvidence ?? []).filter((item) => isEvidenceComplete(item)),
    ...inheritedEvidence,
  ])
  const base = {
    text,
    decimals: decimalCount(text),
    // 单位串：显式写的就用原文；继承来的写声明里的那个单位串（出处里带声明选区，可核对）。
    unitText: unit.text,
    evidence: evidenceList,
  }
  if (!parsed.ok) {
    return {
      value: { ...base, valueQ: null, unit: null },
      reason: parsed.code === 'precision' ? 'PRECISION_UNSUPPORTED' : 'NUMBER_UNSUPPORTED',
      unitBasis: null,
    }
  }
  if (conflict) {
    return { value: { ...base, valueQ: null, unit: null }, reason: 'UNIT_CONFLICT', unitBasis: null }
  }
  if (unit.kind !== 'mm') {
    return { value: { ...base, valueQ: null, unit: null }, reason: unitReason(unit), unitBasis }
  }
  return { value: { ...base, valueQ: parsed.value, unit: 'mm' }, reason: null, unitBasis }
}

function mergeQuantity(values: readonly QuantityValue[]): QuantityValue | null {
  if (values.length === 0) return null
  const first = values[0]
  const same = values.every(
    (value) =>
      value.valueQ === first.valueQ &&
      value.text === first.text &&
      (value.unitText ?? '') === (first.unitText ?? ''),
  )
  if (!same) return null
  return {
    ...first,
    evidence: uniqueEvidence(values.flatMap((value) => value.evidence)),
  }
}

interface RingEntry {
  readonly symbol: string
  readonly symbolEvidence: ExtractionEvidence | null
  readonly name: string | null
  readonly nameEvidence: ExtractionEvidence | null
  readonly nominal: QuantityValue | null
  readonly upperDeviation: QuantityValue | null
  readonly lowerDeviation: QuantityValue | null
  readonly reasons: readonly ExtractionReasonCode[]
  readonly page: number
  readonly rawText: string
  /** 单位来自继承时的依据标记（confidenceBasis 用）；显式或缺失为 null。 */
  readonly unitBasis: string | null
  /** 形态识别带来的规则标记（confidenceBasis 用）；其它路径不设。 */
  readonly basis?: string | null
  /** 多个等号结果不一致时列出的各结果值（只用于阻塞 issue 文案）。 */
  readonly expressionConflict?: { readonly values: readonly string[] } | null
}

// ---------------------------------------------------------------- 单位作用域

/**
 * 单位声明的作用域收集结果。
 *
 * 三种允许的作用域（任务卡硬约束 4）：
 * - `table`：同一张组成环表的表头，只对它自己的数据行有效；
 * - `page` / `caption`：同一页的「单位：mm」句或图注「（mm）」，只对本页数值有效；
 * - `document`：**页范围第一页**上的「单位：」声明，对本范围内所有页有效。
 * 跨页继承只允许最后这一种，且必须是真的写了「单位：」——表头不跨页（同一表格之外一律不认）。
 */
interface UnitContext {
  readonly document: readonly UnitDeclaration[]
  readonly byPage: ReadonlyMap<number, readonly UnitDeclaration[]>
  /** 冲突事件（按 页 + 声明出处 去重），最后统一转成 UNIT_CONFLICT issue。 */
  readonly conflicts: Map<string, { page: number; declarations: readonly UnitDeclaration[] }>
  readonly pageCache: Map<number, UnitResolution>
}

function collectUnitContext(
  pages: readonly PdfTextPage[],
  firstPage: number,
  source: ExtractionSourceIdentity,
): UnitContext {
  const byPage = new Map<number, readonly UnitDeclaration[]>()
  for (const page of pages) {
    const declarations: UnitDeclaration[] = []
    for (const line of page.lines) {
      declarations.push(
        ...detectUnitDeclarations({
          line,
          page: page.page,
          scope: 'page',
          evidence: (start, end) => locate(line, page, source, [start, end]),
        }),
      )
    }
    if (declarations.length > 0) byPage.set(page.page, declarations)
  }
  // 文档级 = 页范围第一页上的「单位：」句；图注只对本页有效，不抬成文档级。
  const document = (byPage.get(firstPage) ?? [])
    .filter((declaration) => declaration.scope === 'page')
    .map((declaration) => ({ ...declaration, scope: 'document' as const }))
  return { document, byPage, conflicts: new Map(), pageCache: new Map() }
}

function noteUnitConflict(
  context: UnitContext,
  page: number,
  resolution: UnitResolution,
): void {
  if (resolution.status !== 'conflict') return
  const key = [page, ...resolution.declarations.map((item) => item.evidence.textSnippet)].join('|')
  if (!context.conflicts.has(key)) {
    context.conflicts.set(key, { page, declarations: resolution.declarations })
  }
}

/** 只用于本页数值（行内赋值 / 区间 / 部件尺寸）：文档级 + 本页声明。 */
function resolvePageUnits(context: UnitContext, page: number): UnitResolution {
  const cached = context.pageCache.get(page)
  if (cached) return cached
  const resolution = resolveUnit([...context.document, ...(context.byPage.get(page) ?? [])])
  context.pageCache.set(page, resolution)
  noteUnitConflict(context, page, resolution)
  return resolution
}

/** 表格数据行：文档级 + 本页声明 + 本表表头。 */
function resolveTableUnits(
  context: UnitContext,
  page: number,
  table: readonly UnitDeclaration[],
): UnitResolution {
  const resolution = resolveUnit([
    ...context.document,
    ...(context.byPage.get(page) ?? []),
    ...table,
  ])
  noteUnitConflict(context, page, resolution)
  return resolution
}

// ---------------------------------------------------------------- 组成环表格

const TABLE_HEADER_TOKENS = ['位号', '名称', '基本尺寸', '上偏差', '下偏差'] as const
/**
 * 表头的显式单位：`基本尺寸(mm)`、`基本尺寸 (mm)`、`基本尺寸/mm`。
 * 只把括号内或斜杠后的**显式单位串**当声明；表头没有单位就返回 null（照旧 UNKNOWN_UNIT）。
 */
const HEADER_UNIT_PATTERN = new RegExp(
  `基本尺寸\\s*(?:[(（]([^)）]*)[)）]|[/／]\\s*(${UNIT_TEXT_SOURCE}))`,
  'di',
)
/**
 * 数据行：`位号 名称 基本尺寸 上偏差 下偏差`，每个数值格允许自带显式单位。
 * 分组：1 位号 / 2 名称 / 3 基本尺寸 / 4 基本尺寸单位 / 5 上偏差 / 6 上偏差单位 /
 *       7 下偏差 / 8 下偏差单位。
 * 自带单位时按显式单位走（硬约束 3：继承值不得覆盖它）。
 */
const ROW_PATTERN = new RegExp(
  '^([A-Za-z][A-Za-z0-9]{0,3})\\s+([^\\s\\d+-]\\S*)\\s+' +
    `(\\d+(?:\\.\\d+)?)(?:\\s*(${UNIT_TEXT_SOURCE}))?` +
    `(?:\\s+([+-]?\\d+(?:\\.\\d+)?)(?:\\s*(${UNIT_TEXT_SOURCE}))?)?` +
    `(?:\\s+([+-]?\\d+(?:\\.\\d+)?)(?:\\s*(${UNIT_TEXT_SOURCE}))?)?` +
    '\\s*$',
  'di',
)

function locate(
  line: PdfTextLine,
  page: PdfTextPage,
  source: ExtractionSourceIdentity,
  range: readonly [number, number],
): ExtractionEvidence | null {
  return evidenceFromSpan(line, page, source, range[0], range[1])
}

function groupRange(match: RegExpExecArray, index: number): [number, number] | null {
  const indices = match.indices?.[index]
  if (!indices) return null
  return [indices[0], indices[1]]
}

function cellUnit(match: RegExpExecArray, index: number): string | null {
  const range = groupRange(match, index)
  if (!range) return null
  return match.input.slice(range[0], range[1])
}

function deviationValue(
  line: PdfTextLine,
  page: PdfTextPage,
  source: ExtractionSourceIdentity,
  match: RegExpExecArray,
  valueIndex: number,
  unitIndex: number,
  inheritance: UnitResolution,
): { value: QuantityValue | null; reason: ExtractionReasonCode | null; unitBasis: string | null } {
  const range = groupRange(match, valueIndex)
  if (!range) return { value: null, reason: null, unitBasis: null }
  const text = matchTextOf(line).slice(range[0], range[1])
  if (!/^[+-]/.test(text)) {
    // 上下偏差未写符号 → 不当 0，也不当偏差。
    return { value: null, reason: 'DEVIATION_SIGN_MISSING', unitBasis: null }
  }
  const unitRange = groupRange(match, unitIndex)
  const unitEvidence = unitRange ? locate(line, page, source, unitRange) : null
  const outcome = buildQuantity({
    text,
    unitToken: cellUnit(match, unitIndex),
    evidence: locate(line, page, source, range),
    extraEvidence: unitEvidence ? [unitEvidence] : [],
    inheritance,
  })
  return { value: outcome.value, reason: outcome.reason, unitBasis: outcome.unitBasis }
}

function ringEntryFromRow(
  line: PdfTextLine,
  page: PdfTextPage,
  source: ExtractionSourceIdentity,
  match: RegExpExecArray,
  inheritance: UnitResolution,
): RingEntry {
  const text = matchTextOf(line)
  const symbol = text.slice(...(groupRange(match, 1) ?? [0, 0]))
  const nameRange = groupRange(match, 2)
  const name = nameRange ? text.slice(nameRange[0], nameRange[1]) : null
  const nominalRange = groupRange(match, 3)
  const nominalOutcome = nominalRange
    ? buildQuantity({
        text: text.slice(nominalRange[0], nominalRange[1]),
        unitToken: cellUnit(match, 4),
        evidence: locate(line, page, source, nominalRange),
        inheritance,
      })
    : { value: null, reason: null, unitBasis: null }

  const upper = deviationValue(line, page, source, match, 5, 6, inheritance)
  const lower = deviationValue(line, page, source, match, 7, 8, inheritance)
  const reasons: ExtractionReasonCode[] = []
  for (const reason of [nominalOutcome.reason, upper.reason, lower.reason]) {
    if (reason) reasons.push(reason)
  }
  return {
    symbol,
    symbolEvidence: locate(line, page, source, groupRange(match, 1) ?? [0, 0]),
    name,
    nameEvidence: nameRange ? locate(line, page, source, nameRange) : null,
    nominal: nominalOutcome.value,
    upperDeviation: upper.value,
    lowerDeviation: lower.value,
    reasons,
    page: line.page,
    rawText: line.rawText,
    unitBasis: nominalOutcome.unitBasis ?? upper.unitBasis ?? lower.unitBasis ?? null,
  }
}

function parseTable(
  lines: readonly PdfTextLine[],
  start: number,
  page: PdfTextPage,
  source: ExtractionSourceIdentity,
  context: UnitContext,
  issues: ExtractionIssue[],
): { entries: RingEntry[]; next: number } {
  const header = lines[start]
  // 先确认表里真有数据行：没有数据行的表不产生任何单位事件，也不留假声明。
  const rows: { line: PdfTextLine; match: RegExpExecArray }[] = []
  let index = start + 1
  while (index < lines.length) {
    const line = lines[index]
    const rowMatch = ROW_PATTERN.exec(matchTextOf(line))
    if (!rowMatch) break
    rows.push({ line, match: rowMatch })
    index += 1
  }
  if (rows.length === 0) {
    issues.push({
      issueId: stableId('issue', ['NO_TABLE_ROWS', page.page, header.rawText]),
      code: 'NO_TABLE_HEADER',
      severity: 'blocked',
      message: `第 ${page.page} 页有表头但未读到可解析的组成环数据行`,
      page: page.page,
      candidateIds: [],
      evidence: header.rectPdf ? [] : [],
    })
    return { entries: [], next: index }
  }

  // 表头显式单位：出处覆盖整段「基本尺寸(mm)」/「基本尺寸/mm」，人工一眼能核对。
  const headerMatch = HEADER_UNIT_PATTERN.exec(matchTextOf(header))
  const headerToken = headerMatch?.[1] ?? headerMatch?.[2] ?? null
  const headerRange = headerMatch?.indices?.[0] ?? null
  const headerEvidence = headerRange ? locate(header, page, source, headerRange) : null
  const tableDeclarations: UnitDeclaration[] =
    headerToken !== null && headerToken.trim() !== '' && headerEvidence
      ? [
          {
            scope: 'table',
            page: page.page,
            unit: parseUnitToken(headerToken),
            evidence: headerEvidence,
          },
        ]
      : []
  const inheritance = resolveTableUnits(context, page.page, tableDeclarations)
  const entries = rows.map((row) =>
    ringEntryFromRow(row.line, page, source, row.match, inheritance),
  )
  return { entries, next: index }
}

/** 表格列顺序必须是 位号 → 名称 → 基本尺寸 → 上偏差 → 下偏差；其它版式不猜。 */
function tableLayoutSupported(line: PdfTextLine): boolean {
  const text = matchTextOf(line)
  let last = -1
  for (const token of TABLE_HEADER_TOKENS) {
    const at = text.indexOf(token)
    if (at < 0 || at <= last) return false
    last = at
  }
  return true
}

// ---------------------------------------------------------------- 行内赋值

const ASSIGNMENT_PATTERN =
  /([A-Za-z][A-Za-z0-9]{0,3})((?:\s*=\s*[A-Za-z][A-Za-z0-9]{0,3})*)\s*=\s*([+-]?\d+(?:\.\d+)?)\s*([A-Za-z英寸"″]+)?/gd

/**
 * 下标/计数片段（论文里的 `i = 0`、`i = 1`）：单字母小写符号 + 值恰为 0 或 1，整行除此以外
 * 没有别的内容 → 不是尺寸赋值，不建候选（任务卡 E-07：现有 2 条这类误报）。
 * 只认这一种最窄形态：`a = 5`、`A = 0`、`i = 12` 一律照旧走赋值解析。
 */
const INDEX_FRAGMENT_PATTERN = /^[a-z]\s*=\s*[01]$/

/** 形态识别出的赋值 → 组成环条目。数值/单位仍交给 buildQuantity 判定，不在本函数里放宽。 */
function entryFromExpressionForm(
  form: ExpressionFormMatch,
  line: PdfTextLine,
  page: PdfTextPage,
  source: ExtractionSourceIdentity,
): RingEntry {
  const symbolEvidence = locate(line, page, source, [form.symbol.start, form.symbol.end])
  const nominalEvidence = locate(line, page, source, [form.nominal.start, form.nominal.end])
  // 硬约束 4：单位归属必须写进 evidence —— 末尾那段单位文本自己的页 / 选区 / 原文片段。
  const unitEvidence = locate(line, page, source, [form.unit.start, form.unit.end])
  const expressionEvidence = form.expression
    ? locate(line, page, source, [form.expression.start, form.expression.end])
    : null
  const extraEvidence = [unitEvidence, expressionEvidence].filter(
    (item): item is ExtractionEvidence => item !== null,
  )

  const reasons: ExtractionReasonCode[] = []
  let nominal: QuantityValue | null
  if (form.inconsistent) {
    // 多个等号结果不一致：不挑一个，值留原文但 valueQ=null（不可用于确认）。
    nominal = {
      text: form.nominal.text,
      decimals: decimalCount(form.nominal.text),
      unitText: form.unit.text,
      unit: null,
      valueQ: null,
      evidence: uniqueEvidence(
        [nominalEvidence, unitEvidence].filter(
          (item): item is ExtractionEvidence => item !== null,
        ),
      ),
    }
    reasons.push('INCONSISTENT_REDUNDANT_VALUE')
  } else {
    const outcome = buildQuantity({
      text: form.nominal.text,
      unitToken: form.unit.text,
      evidence: nominalEvidence,
      extraEvidence,
    })
    nominal = outcome.value
    if (outcome.reason) reasons.push(outcome.reason)
  }

  let upperDeviation: QuantityValue | null = null
  let lowerDeviation: QuantityValue | null = null
  if (form.deviation) {
    // `±0.3` 是同一枚显式文字：上下偏差都由它派生，出处都指向这枚记号。
    const deviationEvidence = locate(line, page, source, [form.deviation.start, form.deviation.end])
    const magnitude = form.deviation.text.replace(/^±\s*/u, '')
    const upper = buildQuantity({
      text: `+${magnitude}`,
      unitToken: form.unit.text,
      evidence: deviationEvidence,
    })
    const lower = buildQuantity({
      text: `-${magnitude}`,
      unitToken: form.unit.text,
      evidence: deviationEvidence,
    })
    upperDeviation = upper.value
    lowerDeviation = lower.value
    if (upper.reason) reasons.push(upper.reason)
    if (lower.reason) reasons.push(lower.reason)
  }

  return {
    symbol: form.symbol.text,
    symbolEvidence,
    name: null,
    nameEvidence: null,
    nominal,
    upperDeviation,
    lowerDeviation,
    reasons,
    page: line.page,
    rawText: line.rawText,
    unitBasis: null,
    basis:
      form.form === 'deviation' ? 'RULE_ASSIGNMENT_PM_DEVIATION' : 'RULE_UNIT_EXPRESSION_TAIL',
    expressionConflict: form.inconsistent
      ? { values: form.redundantValues.map((item) => item.text) }
      : null,
  }
}

function parseAssignmentLine(
  line: PdfTextLine,
  page: PdfTextPage,
  source: ExtractionSourceIdentity,
  context: UnitContext,
): RingEntry[] {
  const text = matchTextOf(line)
  // 任务卡 E-07：`i = 0` / `i = 1` 这类下标片段不当尺寸候选。
  if (INDEX_FRAGMENT_PATTERN.test(text.trim())) return []
  const entries: RingEntry[] = []
  let offset = 0
  for (const segment of text.split(',')) {
    const start = offset
    offset += segment.length + 1
    // P1：先认三种明确形态（末尾单位），认不出来再走原有赋值解析，绝不放宽。
    const form = matchExpressionAssignment(text, start, start + segment.length)
    if (form) {
      entries.push(entryFromExpressionForm(form, line, page, source))
      continue
    }
    ASSIGNMENT_PATTERN.lastIndex = 0
    const match = ASSIGNMENT_PATTERN.exec(segment)
    if (!match) continue
    const symbols: string[] = []
    const firstSymbol = match[1]
    symbols.push(firstSymbol)
    const chain = match[2] ?? ''
    for (const part of chain.split('=')) {
      const symbol = part.trim()
      if (symbol !== '') symbols.push(symbol)
    }
    const valueGroup = groupRange(match, 3)
    const unitGroup = groupRange(match, 4)
    if (!valueGroup) continue
    const shift = (range: readonly [number, number]): [number, number] => [
      range[0] + start,
      range[1] + start,
    ]
    const unitToken = unitGroup ? segment.slice(unitGroup[0], unitGroup[1]) : null
    const valueEvidence = locate(line, page, source, shift(valueGroup))
    const unitEvidence = unitGroup ? locate(line, page, source, shift(unitGroup)) : null
    const outcome = buildQuantity({
      text: segment.slice(valueGroup[0], valueGroup[1]),
      unitToken,
      evidence: valueEvidence,
      extraEvidence: unitEvidence ? [unitEvidence] : [],
      // 只有这一处自己没写单位时才查继承来源（显式单位优先，硬约束 3）。
      inheritance: unitToken === null ? resolvePageUnits(context, line.page) : null,
    })
    for (const symbol of symbols) {
      const symbolAt = text.indexOf(symbol, start + match.index)
      entries.push({
        symbol,
        symbolEvidence:
          symbolAt >= 0
            ? locate(line, page, source, [symbolAt, symbolAt + symbol.length])
            : null,
        name: null,
        nameEvidence: null,
        nominal: outcome.value,
        upperDeviation: null,
        lowerDeviation: null,
        reasons: outcome.reason ? [outcome.reason] : [],
        page: line.page,
        rawText: line.rawText,
        unitBasis: outcome.unitBasis,
      })
    }
  }
  return entries
}

// ---------------------------------------------------------------- 组成环汇总

const KIND_ORDER: Record<ExtractionCandidate['kind'], number> = {
  interval: 0,
  formula: 1,
  ring: 2,
  'part-dimension': 3,
}

function quantityKey(value: QuantityValue): string {
  return `${value.valueQ ?? 'null'}|${value.unitText ?? ''}|${value.text}`
}

function ringCandidateStatus(reasons: readonly ExtractionReasonCode[]): CandidateStatus {
  return reasons.length > 0 ? 'blocked' : 'pending'
}

function ringConfidence(entryLike: {
  name: string | null
  nominal: QuantityValue | null
  upper: QuantityValue | null
  lower: QuantityValue | null
  reasons: readonly ExtractionReasonCode[]
}): ConfidenceLevel {
  if (entryLike.reasons.length > 0) return 'low'
  if (entryLike.nominal && entryLike.nominal.unit === 'mm' && entryLike.upper && entryLike.lower) {
    return entryLike.name ? 'high' : 'medium'
  }
  return 'medium'
}

interface RingCandidateBuild {
  readonly candidates: ExtractionCandidate[]
  readonly issues: ExtractionIssue[]
}

/**
 * 名义值是否可用于候选：必须 mm 且能精确转 q。
 * valueQ=null 表示单位缺失/不支持/精度超限；这种“解析不了”的一处按任务卡要求
 * 单独给 issue，不能把同一符号其它能解析的处一起毙掉（也不能把它当候选值）。
 */
function nominalUsable(entry: RingEntry): boolean {
  return entry.nominal !== null && entry.nominal.unit === 'mm' && entry.nominal.valueQ !== null
}

/** 该处数值解析失败的原因码：优先单位/数值类，避免笼统成 SOURCE_UNRESOLVED。 */
function unusableReason(entry: RingEntry): ExtractionReasonCode {
  const preferred: readonly ExtractionReasonCode[] = [
    'UNSUPPORTED_UNIT',
    'UNKNOWN_UNIT',
    'PRECISION_UNSUPPORTED',
    'NUMBER_UNSUPPORTED',
    'SOURCE_UNRESOLVED',
  ]
  const found = entry.reasons.find((reason) => preferred.includes(reason))
  return found ?? entry.reasons[0] ?? 'SOURCE_UNRESOLVED'
}

/**
 * 多个等号结果不一致（`A = 10 = 12 mm`）的阻塞 issue：把各结果值原文并列出来，
 * 明确“未挑其中一个”，不计算、不替换。
 */
function inconsistentValueIssue(
  entry: RingEntry,
  symbol: string,
  candidateIds: readonly string[],
): ExtractionIssue {
  const values = entry.expressionConflict?.values ?? []
  return {
    issueId: stableId('issue', ['INCONSISTENT_REDUNDANT_VALUE', symbol, entry.page, ...values]),
    code: 'INCONSISTENT_REDUNDANT_VALUE',
    severity: 'blocked',
    message:
      `符号 ${symbol} 的赋值含多个等号，结果值互不一致（${values.join(' / ')}）；` +
      '该条已阻塞，未挑其中一个值',
    page: entry.page,
    candidateIds,
    evidence: uniqueEvidence(
      [entry.symbolEvidence, ...(entry.nominal?.evidence ?? [])].filter(
        (item): item is ExtractionEvidence => item !== null,
      ),
    ),
  }
}

function resolveRings(
  entries: readonly RingEntry[],
  source: ExtractionSourceIdentity,
): RingCandidateBuild {
  const bySymbol = new Map<string, RingEntry[]>()
  for (const entry of entries) {
    const list = bySymbol.get(entry.symbol) ?? []
    list.push(entry)
    bySymbol.set(entry.symbol, list)
  }

  const candidates: ExtractionCandidate[] = []
  const issues: ExtractionIssue[] = []

  for (const [symbol, group] of [...bySymbol.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]),
  )) {
    const usable = group.filter(nominalUsable)
    const unusable = group.filter((entry) => !nominalUsable(entry))

    // 整组都解析不了：保持旧行为——有 nominal 对象（如 inch）按数值分组出 blocked 候选，
    // 完全没有 nominal 只留一条 issue，不造“有值无出处”的候选。
    const bucketSource = usable.length > 0 ? usable : group.filter((entry) => entry.nominal !== null)
    if (bucketSource.length === 0) {
      const reason = group.find((entry) => entry.reasons.length > 0)?.reasons[0]
      if (reason) {
        issues.push({
          issueId: stableId('issue', [reason, symbol, group[0].page]),
          code: reason,
          severity: 'blocked',
          message: `符号 ${symbol} 的数值缺少完整出处或单位/精度不合法（${reason}），未进入候选`,
          page: group[0].page,
          candidateIds: [],
          evidence: [],
        })
      }
      continue
    }

    // 兜底：同组里有的处能解析、有的解析不了 → 坏的那处单独给 issue，
    // 好的照常出行，绝不因一处坏掉整组毙掉。
    if (usable.length > 0) {
      for (const entry of unusable) {
        // 多等号结果不一致有自己的阻塞 issue（下面单独发），不走通用文案。
        if (entry.expressionConflict) {
          issues.push(inconsistentValueIssue(entry, symbol, []))
          continue
        }
        const reason = unusableReason(entry)
        const evidence = uniqueEvidence(
          [
            entry.symbolEvidence,
            ...(entry.nominal?.evidence ?? []),
          ].filter((item): item is ExtractionEvidence => item !== null),
        )
        issues.push({
          issueId: stableId('issue', ['RING_OCCURRENCE_UNRESOLVED', reason, symbol, entry.page, entry.rawText]),
          code: reason,
          severity: 'blocked',
          message: `符号 ${symbol} 的第 ${group.indexOf(entry) + 1} 处赋值无法解析（${reason}）；该处未进入候选，同符号其它可解析处照常列出`,
          page: entry.page,
          candidateIds: [],
          evidence,
        })
      }
    }

    const buckets = new Map<string, RingEntry[]>()
    for (const entry of bucketSource) {
      const key = quantityKey(entry.nominal as QuantityValue)
      const list = buckets.get(key) ?? []
      list.push(entry)
      buckets.set(key, list)
    }
    const total = buckets.size
    const ambiguous = total > 1
    const built: ExtractionCandidate[] = []
    let bucketIndex = 0

    for (const bucket of buckets.values()) {
      bucketIndex += 1
      const first = bucket[0]
      const nominal = mergeQuantity(
        bucket.map((entry) => entry.nominal).filter((value): value is QuantityValue => value !== null),
      )
      if (!nominal) continue
      const nameEntry = bucket.find((entry) => entry.name !== null) ?? first
      const name = nameEntry.name

      const uppers = bucket
        .map((entry) => entry.upperDeviation)
        .filter((value): value is QuantityValue => value !== null)
      const lowers = bucket
        .map((entry) => entry.lowerDeviation)
        .filter((value): value is QuantityValue => value !== null)
      const upper = mergeQuantity(uppers)
      const lower = mergeQuantity(lowers)
      const reasons = new Set<ExtractionReasonCode>()
      for (const entry of bucket) {
        for (const reason of entry.reasons) reasons.add(reason)
      }
      if (uppers.length > 0 && !upper) reasons.add('AMBIGUOUS_DEVIATION')
      if (lowers.length > 0 && !lower) reasons.add('AMBIGUOUS_DEVIATION')

      const reasonCodes = [...reasons]
      const unitBasis = bucket.find((entry) => entry.unitBasis !== null)?.unitBasis ?? null
      const ruleBasis = bucket.find((entry) => entry.basis != null)?.basis ?? null
      const data: RingCandidateData = {
        symbol,
        name,
        nominal,
        upperDeviation: upper,
        lowerDeviation: lower,
      }
      const evidence = uniqueEvidence([
        ...bucket.flatMap((entry) =>
          [entry.symbolEvidence, entry.nameEvidence].filter(
            (item): item is ExtractionEvidence => item !== null,
          ),
        ),
        ...nominal.evidence,
        ...(upper?.evidence ?? []),
        ...(lower?.evidence ?? []),
      ])
      const occurrence: ExtractionOccurrence | null = ambiguous
        ? { index: bucketIndex, total }
        : null
      const candidate: ExtractionCandidate = {
        candidateId: stableId('ring', [
          source.revisionId,
          symbol,
          nominal.text,
          nominal.unitText ?? '',
          first.page,
          evidence[0]?.rectPdf.join(',') ?? '',
        ]),
        kind: 'ring',
        groupId: `ring:${symbol}`,
        rawText: first.rawText,
        page: first.page,
        status: ringCandidateStatus(reasonCodes),
        confidence: ringConfidence({
          name,
          nominal,
          upper,
          lower,
          reasons: reasonCodes,
        }),
        confidenceBasis: [
          'RULE_TABLE_OR_ASSIGNMENT',
          unitTextBasis(nominal),
          ...(unitBasis === null ? [] : [unitBasis]),
          ...(ruleBasis === null ? [] : [ruleBasis]),
          ambiguous
            ? 'RULE_MULTIPLE_VALUES'
            : group.length > 1
              ? 'RULE_MULTIPLE_SAME_VALUE'
              : 'RULE_SINGLE_VALUE',
        ],
        reasonCodes,
        evidence,
        editRevision: 0,
        occurrence,
        data,
      }
      built.push(candidate)
      candidates.push(candidate)
      // 多个等号结果不一致：候选已阻塞（valueQ=null），另发一条阻塞 issue 并列各结果值。
      for (const entry of bucket) {
        if (entry.expressionConflict) {
          issues.push(inconsistentValueIssue(entry, symbol, [candidate.candidateId]))
        }
      }
    }

    if (ambiguous && built.length > 1) {
      const evidence = uniqueEvidence(built.flatMap((candidate) => candidate.evidence))
      issues.push({
        issueId: stableId('issue', ['AMBIGUOUS_ASSIGNMENT', symbol]),
        code: 'AMBIGUOUS_ASSIGNMENT',
        severity: 'warning',
        message: `符号 ${symbol} 在页范围里出现 ${built.length} 处不同取值，已逐处列出候选（第 1–${built.length} 处）；同一符号只能确认一处，确认一处后其余处不可再确认，需先撤销`,
        page: built[0].page,
        candidateIds: built.map((candidate) => candidate.candidateId),
        evidence,
      })
    }
    const deviationConflict = built.filter((candidate) =>
      candidate.reasonCodes.includes('AMBIGUOUS_DEVIATION'),
    )
    if (deviationConflict.length > 0) {
      issues.push({
        issueId: stableId('issue', ['AMBIGUOUS_DEVIATION', symbol]),
        code: 'AMBIGUOUS_DEVIATION',
        severity: 'blocked',
        message: `符号 ${symbol} 的上下偏差出现互相矛盾的值，偏差留空，未择优`,
        page: deviationConflict[0].page,
        candidateIds: deviationConflict.map((candidate) => candidate.candidateId),
        evidence: uniqueEvidence(deviationConflict.flatMap((candidate) => candidate.evidence)),
      })
    }
  }

  return { candidates, issues }
}

function unitTextBasis(value: QuantityValue): string {
  if (value.unit === 'mm') return 'RULE_UNIT_MM'
  return value.unitText ? 'RULE_UNIT_UNSUPPORTED' : 'RULE_UNIT_MISSING'
}

// ---------------------------------------------------------------- 部件尺寸

const PART_FIELD_PATTERN = /(内径|外径|长度)\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)\s*([A-Za-z英寸"″]+)?/gd

function parsePartLine(
  line: PdfTextLine,
  page: PdfTextPage,
  source: ExtractionSourceIdentity,
  context: UnitContext,
): ExtractionCandidate | null {
  const text = matchTextOf(line)
  PART_FIELD_PATTERN.lastIndex = 0
  const matches = [...text.matchAll(PART_FIELD_PATTERN)]
  if (matches.length === 0) return null
  const kinds = matches.map((match) => match[1])
  if (!kinds.includes('内径') && !kinds.includes('外径')) return null

  const prefix = text.slice(0, matches[0].index ?? 0).replace(/[:：,，。\s]+$/u, '')
  const partName = prefix !== '' && !/\d/.test(prefix) && prefix.length <= 20 ? prefix : null

  let innerDiameter: QuantityValue | null = null
  let outerDiameter: QuantityValue | null = null
  let length: QuantityValue | null = null
  const reasons = new Set<ExtractionReasonCode>()
  const evidenceList: ExtractionEvidence[] = []
  let unitBasis: string | null = null

  for (const match of matches) {
    const valueRange = match.indices?.[2]
    const unitRange = match.indices?.[3]
    if (!valueRange) continue
    const unitToken = unitRange ? text.slice(unitRange[0], unitRange[1]) : null
    // 证据覆盖“数值 + 单位”两个 token，单位本身也有出处。
    const spanEnd = unitRange ? unitRange[1] : valueRange[1]
    const outcome = buildQuantity({
      text: text.slice(valueRange[0], valueRange[1]),
      unitToken,
      evidence: locate(line, page, source, [valueRange[0], spanEnd]),
      inheritance: unitToken === null ? resolvePageUnits(context, line.page) : null,
    })
    if (outcome.reason) reasons.add(outcome.reason)
    unitBasis = unitBasis ?? outcome.unitBasis
    const value = outcome.value
    if (value?.evidence) evidenceList.push(...value.evidence)
    if (match[1] === '内径') innerDiameter = value
    else if (match[1] === '外径') outerDiameter = value
    else length = value
  }

  const data: PartDimensionData = { partName, innerDiameter, outerDiameter, length }
  const reasonCodes = [...reasons]
  return {
    candidateId: stableId('part-dimension', [
      source.revisionId,
      partName ?? '',
      line.page,
      text.slice(matches[0].index ?? 0, matches[0].index ?? 0 + 24),
    ]),
    kind: 'part-dimension',
    groupId: partName ? `part:${partName}` : null,
    rawText: line.rawText,
    page: line.page,
    status: reasonCodes.length > 0 ? 'blocked' : 'pending',
    confidence: reasonCodes.length > 0 ? 'low' : partName ? 'medium' : 'low',
    confidenceBasis: [
      'RULE_PART_LABEL_LINE',
      ...(unitBasis === null ? [] : [unitBasis]),
    ],
    reasonCodes,
    evidence: uniqueEvidence(evidenceList),
    editRevision: 0,
    data,
  }
}

// ---------------------------------------------------------------- 区间

const INTERVAL_PATTERN =
  /([A-Za-z][A-Za-z0-9]{0,3})\s*应为\s*([+-]?\d+(?:\.\d+)?)\s*[~～〜]\s*([+-]?\d+(?:\.\d+)?)\s*([A-Za-z英寸"″]*)\s*[,，]?\s*(不含两端|含两端)?/d

function parseIntervalLine(
  line: PdfTextLine,
  page: PdfTextPage,
  source: ExtractionSourceIdentity,
  context: UnitContext,
): ExtractionCandidate | null {
  const text = matchTextOf(line)
  const match = INTERVAL_PATTERN.exec(text)
  if (!match) return null
  const lowerRange = match.indices?.[2]
  const upperRange = match.indices?.[3]
  if (!lowerRange || !upperRange) return null
  const unitToken = match[4] === '' ? null : match[4]
  const inheritance = unitToken === null ? resolvePageUnits(context, line.page) : null
  const lower = buildQuantity({
    text: text.slice(lowerRange[0], lowerRange[1]),
    unitToken,
    evidence: locate(line, page, source, lowerRange),
    inheritance,
  })
  const upper = buildQuantity({
    text: text.slice(upperRange[0], upperRange[1]),
    unitToken,
    evidence: locate(line, page, source, upperRange),
    inheritance,
  })
  const reasons = new Set<ExtractionReasonCode>()
  for (const reason of [lower.reason, upper.reason]) if (reason) reasons.add(reason)

  const endpointToken = match[5] ?? null
  const endpointRange = match.indices?.[5] ?? null
  const endpointEvidence =
    endpointRange && endpointToken ? locate(line, page, source, endpointRange) : null
  let lowerInclusive: boolean | null = null
  let upperInclusive: boolean | null = null
  if (endpointToken === '含两端') {
    lowerInclusive = true
    upperInclusive = true
  } else if (endpointToken === '不含两端') {
    lowerInclusive = false
    upperInclusive = false
  } else {
    reasons.add('ENDPOINT_SEMANTICS_MISSING')
  }

  if (
    lower.value?.valueQ != null &&
    upper.value?.valueQ != null &&
    lower.value.valueQ > upper.value.valueQ
  ) {
    reasons.add('RANGE_CONFLICT')
  }

  const data: IntervalCandidateData = {
    outputSymbol: match[1],
    lower: lower.value,
    upper: upper.value,
    lowerInclusive,
    upperInclusive,
    endpointEvidence: endpointEvidence ? [endpointEvidence] : [],
  }
  const evidence = uniqueEvidence([
    ...(lower.value?.evidence ?? []),
    ...(upper.value?.evidence ?? []),
    ...(endpointEvidence ? [endpointEvidence] : []),
  ])
  const reasonCodes = [...reasons]
  return {
    candidateId: stableId('interval', [
      source.revisionId,
      match[1],
      lower.value?.text ?? '',
      upper.value?.text ?? '',
      line.page,
      evidence[0]?.rectPdf.join(',') ?? '',
    ]),
    kind: 'interval',
    groupId: `interval:${match[1]}`,
    rawText: line.rawText,
    page: line.page,
    status: reasonCodes.length > 0 ? 'blocked' : 'pending',
    confidence: reasonCodes.length > 0 ? 'low' : 'high',
    confidenceBasis: [
      'RULE_INTERVAL_SENTENCE',
      ...(lower.unitBasis ?? upper.unitBasis
        ? [lower.unitBasis ?? upper.unitBasis!]
        : []),
    ],
    reasonCodes,
    evidence,
    editRevision: 0,
    data,
  }
}

// ---------------------------------------------------------------- 公式

const FORMULA_PATTERN =
  /^([A-Za-z][A-Za-z0-9]{0,3})\s*=\s*([A-Za-z][A-Za-z0-9]{0,3})((?:\s*[-+]\s*[A-Za-z][A-Za-z0-9]{0,3})+)\s*$/
const FORMULA_UNSUPPORTED_PATTERN = /[×÷*/()^]/
/** 独立数字 token（不是 B1 这类符号内部的数字）。 */
const STANDALONE_NUMBER = /(?:^|[\s,;:()])\d+(?:\.\d+)?(?:[\s,;:()]|$)/

function parseFormulaLine(
  line: PdfTextLine,
  page: PdfTextPage,
  source: ExtractionSourceIdentity,
): ExtractionCandidate | null {
  const raw = matchTextOf(line).trim().replace(/[。.;；]+$/u, '')
  if (!raw.includes('=')) return null
  // 带独立数值的是赋值句，不是公式（B1/B2 里的数字不算）。
  if (STANDALONE_NUMBER.test(raw)) return null
  if (!/[A-Za-z]/.test(raw)) return null

  const span = evidenceFromSpan(line, page, source, 0, line.normalizedText.length)
  const match = FORMULA_PATTERN.exec(raw)
  if (!match) {
    if (!FORMULA_UNSUPPORTED_PATTERN.test(raw)) return null
    const data: FormulaCandidateData = {
      outputSymbol: null,
      rawExpression: line.rawText,
      expression: raw,
      operands: [],
      unsupported: true,
      conflict: false,
    }
    return {
      candidateId: stableId('formula', [source.revisionId, raw, line.page]),
      kind: 'formula',
      groupId: null,
      rawText: line.rawText,
      page: line.page,
      status: 'blocked',
      confidence: 'low',
      confidenceBasis: ['RULE_FORMULA_UNSUPPORTED'],
      reasonCodes: ['FORMULA_UNSUPPORTED'],
      evidence: span ? [span] : [],
      editRevision: 0,
      data,
    }
  }

  const operands: FormulaOperand[] = [{ symbol: match[2], sign: 1 }]
  const tail = match[3]
  const operandPattern = /([-+])\s*([A-Za-z][A-Za-z0-9]{0,3})/g
  for (const operand of tail.matchAll(operandPattern)) {
    operands.push({ symbol: operand[2], sign: operand[1] === '-' ? -1 : 1 })
  }
  const data: FormulaCandidateData = {
    outputSymbol: match[1],
    rawExpression: line.rawText,
    expression: raw,
    operands,
    unsupported: false,
    conflict: false,
  }
  return {
    candidateId: stableId('formula', [source.revisionId, match[1], raw, line.page]),
    kind: 'formula',
    groupId: `formula:${match[1]}`,
    rawText: line.rawText,
    page: line.page,
    status: 'pending',
    confidence: 'high',
    confidenceBasis: ['RULE_LINEAR_FORMULA'],
    reasonCodes: [],
    evidence: span ? [span] : [],
    editRevision: 0,
    data,
  }
}

// ---------------------------------------------------------------- 冲突检查

interface ConflictResult {
  readonly overrides: Map<string, { status: CandidateStatus; reasons: ExtractionReasonCode[] }>
  readonly issues: ExtractionIssue[]
}

function formulaSignature(data: FormulaCandidateData): string {
  return data.operands.map((operand) => `${operand.sign}${operand.symbol}`).join('')
}

function ringQuantity(
  candidates: readonly ExtractionCandidate[],
  symbol: string,
): QuantityValue | null {
  const matches = candidates.filter(
    (candidate): candidate is ExtractionCandidate & { kind: 'ring' } =>
      candidate.kind === 'ring' && candidate.data.symbol === symbol,
  )
  if (matches.length !== 1) return null
  const nominal = matches[0].data.nominal
  if (!nominal || nominal.valueQ == null || nominal.unit !== 'mm') return null
  return nominal
}

/** 公式操作数无法按 mm 解析时，优先给出单位原因，而不是笼统的“未解析”。 */
function operandUnitReason(
  candidates: readonly ExtractionCandidate[],
  operands: readonly FormulaOperand[],
): ExtractionReasonCode | null {
  for (const operand of operands) {
    const matches = candidates.filter(
      (candidate): candidate is ExtractionCandidate & { kind: 'ring' } =>
        candidate.kind === 'ring' && candidate.data.symbol === operand.symbol,
    )
    for (const candidate of matches) {
      const nominal = candidate.data.nominal
      if (!nominal || nominal.unit === 'mm') continue
      if (nominal.unitText !== null && nominal.unitText !== '') return 'UNSUPPORTED_UNIT'
      return 'UNKNOWN_UNIT'
    }
  }
  return null
}

function addBlockedOverride(
  overrides: Map<string, { status: CandidateStatus; reasons: ExtractionReasonCode[] }>,
  candidate: ExtractionCandidate,
  reasons: readonly ExtractionReasonCode[],
): void {
  const current = overrides.get(candidate.candidateId)
  const merged = [...new Set([...(current?.reasons ?? candidate.reasonCodes), ...reasons])]
  overrides.set(candidate.candidateId, { status: 'blocked', reasons: merged })
}

function checkConflicts(candidates: readonly ExtractionCandidate[]): ConflictResult {
  const overrides = new Map<
    string,
    { status: CandidateStatus; reasons: ExtractionReasonCode[] }
  >()
  const issues: ExtractionIssue[] = []
  const formulas = candidates.filter(
    (candidate): candidate is ExtractionCandidate & { kind: 'formula' } =>
      candidate.kind === 'formula',
  )
  const intervals = candidates.filter(
    (candidate): candidate is ExtractionCandidate & { kind: 'interval' } =>
      candidate.kind === 'interval',
  )

  // 同一输出符号的多条公式：结构不一致即冲突，不择优；关联区间同组阻塞。
  const byOutput = new Map<string, (ExtractionCandidate & { kind: 'formula' })[]>()
  for (const formula of formulas) {
    const output = formula.data.outputSymbol
    if (!output || formula.data.unsupported) continue
    const list = byOutput.get(output) ?? []
    list.push(formula)
    byOutput.set(output, list)
  }
  for (const [output, group] of byOutput) {
    const signatures = new Set(group.map((formula) => formulaSignature(formula.data)))
    if (signatures.size <= 1) continue
    for (const formula of group) addBlockedOverride(overrides, formula, ['FORMULA_CONFLICT'])
    const relatedIntervals = intervals.filter(
      (interval) => interval.data.outputSymbol === output,
    )
    for (const interval of relatedIntervals) {
      addBlockedOverride(overrides, interval, ['CONFLICT_GROUP_MEMBER'])
    }
    issues.push({
      issueId: stableId('issue', ['FORMULA_CONFLICT', output]),
      code: 'FORMULA_CONFLICT',
      severity: 'blocked',
      message: `符号 ${output} 的同页公式结构互相矛盾（${signatures.size} 组），公式与关联区间已阻塞，未择优修正`,
      page: group[0].page,
      candidateIds: [
        ...group.map((formula) => formula.candidateId),
        ...relatedIntervals.map((interval) => interval.candidateId),
      ],
      evidence: uniqueEvidence([
        ...group.flatMap((formula) => formula.evidence),
        ...relatedIntervals.flatMap((interval) => interval.evidence),
      ]),
    })
  }

  // 公式与区间/环数值矛盾：结构化求值（整数 q），不改任何数值。
  for (const formula of formulas) {
    const output = formula.data.outputSymbol
    if (!output || formula.data.unsupported) continue
    if (formula.data.operands.length === 0) continue
    const values: { operand: FormulaOperand; value: QuantityValue }[] = []
    let resolved = true
    for (const operand of formula.data.operands) {
      const value = ringQuantity(candidates, operand.symbol)
      if (!value) {
        resolved = false
        break
      }
      values.push({ operand, value })
    }
    if (!resolved) {
      addBlockedOverride(overrides, formula, [
        operandUnitReason(candidates, formula.data.operands) ?? 'FORMULA_UNRESOLVED_OPERAND',
      ])
      continue
    }
    const computed = values.reduce(
      (total, { operand, value }) => total + operand.sign * (value.valueQ ?? 0),
      0,
    )
    const interval = intervals.find((candidate) => candidate.data.outputSymbol === output)
    if (!interval) continue
    const lowerQ = interval.data.lower?.valueQ ?? null
    const upperQ = interval.data.upper?.valueQ ?? null
    if (lowerQ == null || upperQ == null) continue
    if (computed < lowerQ || computed > upperQ) {
      addBlockedOverride(overrides, formula, ['FORMULA_VALUE_CONFLICT'])
      addBlockedOverride(overrides, interval, ['FORMULA_VALUE_CONFLICT'])
      issues.push({
        issueId: stableId('issue', ['FORMULA_VALUE_CONFLICT', output]),
        code: 'FORMULA_VALUE_CONFLICT',
        severity: 'blocked',
        message: `公式 ${formula.data.expression} 按原文数值计算得 ${computed} q，落在区间 [${lowerQ}, ${upperQ}] q 之外；两组证据并列阻塞，未修改任何数值或公式`,
        page: formula.page,
        candidateIds: [formula.candidateId, interval.candidateId],
        evidence: uniqueEvidence([...formula.evidence, ...interval.evidence]),
      })
    }
  }

  return { overrides, issues }
}

function applyOverrides(
  candidates: readonly ExtractionCandidate[],
  overrides: ConflictResult['overrides'],
): ExtractionCandidate[] {
  return candidates.map((candidate) => {
    const override = overrides.get(candidate.candidateId)
    if (!override) return candidate
    const reasonCodes = [...new Set([...candidate.reasonCodes, ...override.reasons])]
    return { ...candidate, status: override.status, reasonCodes }
  })
}

function candidateTop(candidate: ExtractionCandidate): number {
  const rect = candidate.evidence[0]?.rectPdf
  return rect ? rect[3] : 0
}

function sortCandidates(candidates: readonly ExtractionCandidate[]): ExtractionCandidate[] {
  return [...candidates].sort((left, right) => {
    if (left.page !== right.page) return left.page - right.page
    const top = candidateTop(right) - candidateTop(left)
    if (top !== 0) return top
    if (KIND_ORDER[left.kind] !== KIND_ORDER[right.kind]) {
      return KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    }
    return left.candidateId.localeCompare(right.candidateId)
  })
}

function sortIssues(issues: readonly ExtractionIssue[]): ExtractionIssue[] {
  return [...issues].sort((left, right) => {
    const page = (left.page ?? 0) - (right.page ?? 0)
    if (page !== 0) return page
    const code = left.code.localeCompare(right.code)
    if (code !== 0) return code
    return left.issueId.localeCompare(right.issueId)
  })
}

function issue(
  code: ExtractionIssue['code'],
  severity: 'blocked' | 'warning',
  message: string,
  page: number | null,
  extra: { candidateIds?: readonly string[]; evidence?: readonly ExtractionEvidence[] } = {},
): ExtractionIssue {
  return {
    issueId: stableId('issue', [code, page ?? 0, message]),
    code,
    severity,
    message,
    page,
    candidateIds: extra.candidateIds ?? [],
    evidence: extra.evidence ?? [],
  }
}

export function buildExtractionDraft(request: ExtractionRequest): ExtractionDraft {
  const extractorVersion = request.extractorVersion ?? EXTRACTOR_VERSION
  const idempotencyKey = [
    request.projectId,
    request.source.documentId,
    request.source.revisionId,
    request.source.sha256,
    request.pageRange.from,
    request.pageRange.to,
    extractorVersion,
  ].join('|')
  const baseDraft: Omit<ExtractionDraft, 'candidates' | 'issues'> = {
    draftId: stableId('draft', [idempotencyKey]),
    draftRevision: 1,
    status: 'draft',
    projectId: request.projectId,
    baseToken: request.baseToken,
    sourceIdentity: request.source,
    pageRange: request.pageRange,
    extractorVersion,
    idempotencyKey,
    decisions: [],
  }

  const issues: ExtractionIssue[] = []
  const range = request.pageRange
  if (
    !Number.isSafeInteger(range.from) ||
    !Number.isSafeInteger(range.to) ||
    range.from < 1 ||
    range.to < range.from
  ) {
    return {
      ...baseDraft,
      candidates: [],
      issues: [
        issue('PAGE_RANGE_INVALID', 'blocked', `页范围无效：${range.from}..${range.to}`, null),
      ],
    }
  }
  if (range.to > request.source.pageCount) {
    return {
      ...baseDraft,
      candidates: [],
      issues: [
        issue(
          'SOURCE_PAGE_OUT_OF_RANGE',
          'blocked',
          `页范围 ${range.from}..${range.to} 超出 PDF 页数 ${request.source.pageCount}`,
          null,
        ),
      ],
    }
  }
  if (range.to - range.from + 1 > MAX_EXTRACTION_PAGES) {
    return {
      ...baseDraft,
      candidates: [],
      issues: [
        issue(
          'PAGE_LIMIT',
          'blocked',
          `页跨度超过上限 ${MAX_EXTRACTION_PAGES} 页`,
          null,
        ),
      ],
    }
  }

  const pages = request.layer.pages.filter(
    (page) => page.page >= range.from && page.page <= range.to,
  )
  /**
   * 单位作用域：文档级（页范围第一页的「单位：」句）+ 每页的页级/图注声明。
   * 只收集显式文字，不做任何跨页推断；表头声明在 parseTable 里逐表构造。
   */
  const unitContext = collectUnitContext(pages, range.from, request.source)
  const ringEntries: RingEntry[] = []
  const partCandidates: ExtractionCandidate[] = []
  const intervalCandidates: ExtractionCandidate[] = []
  const formulaCandidates: ExtractionCandidate[] = []

  for (const page of pages) {
    const textItems = page.items.filter((item) => item.text.trim() !== '')
    if (textItems.length === 0) {
      issues.push(
        issue(
          'NO_TEXT_LAYER',
          'blocked',
          `第 ${page.page} 页没有可读文本层（扫描件/图片页）；本版本不做 OCR，拒绝数值提取`,
          page.page,
        ),
      )
      continue
    }
    let index = 0
    while (index < page.lines.length) {
      const line = page.lines[index]
      if (TABLE_HEADER_TOKENS.every((token) => matchTextOf(line).includes(token))) {
        if (!tableLayoutSupported(line)) {
          issues.push(
            issue(
              'UNSUPPORTED_TABLE_LAYOUT',
              'blocked',
              `第 ${page.page} 页组成环表头列顺序不是 位号/名称/基本尺寸/上偏差/下偏差，不猜列`,
              page.page,
            ),
          )
          index += 1
          continue
        }
        const table = parseTable(page.lines, index, page, request.source, unitContext, issues)
        ringEntries.push(...table.entries)
        index = table.next
        continue
      }
      const formula = parseFormulaLine(line, page, request.source)
      if (formula) {
        formulaCandidates.push(formula)
        index += 1
        continue
      }
      const interval = parseIntervalLine(line, page, request.source, unitContext)
      if (interval) {
        intervalCandidates.push(interval)
        index += 1
        continue
      }
      const part = parsePartLine(line, page, request.source, unitContext)
      if (part) {
        partCandidates.push(part)
        index += 1
        continue
      }
      if (matchTextOf(line).includes('=')) {
        ringEntries.push(...parseAssignmentLine(line, page, request.source, unitContext))
      }
      index += 1
    }
  }

  const ringBuild = resolveRings(ringEntries, request.source)
  issues.push(...ringBuild.issues)
  const candidates = [
    ...ringBuild.candidates,
    ...partCandidates,
    ...intervalCandidates,
    ...formulaCandidates,
  ]
  const conflicts = checkConflicts(candidates)
  issues.push(...conflicts.issues)

  // 单位冲突：同一作用域出现两个不同单位 → 该批候选阻塞，不择优（硬约束 2）。
  for (const event of unitContext.conflicts.values()) {
    issues.push({
      issueId: stableId('issue', [
        'UNIT_CONFLICT',
        event.page,
        ...event.declarations.map((declaration) => declaration.evidence.textSnippet),
      ]),
      code: 'UNIT_CONFLICT',
      severity: 'blocked',
      message:
        `第 ${event.page} 页出现互相矛盾的单位声明（${event.declarations
          .map(declarationLabel)
          .join(' / ')}）；` +
        '本页未自带单位的数值一律阻塞，未择优采用其中一个',
      page: event.page,
      candidateIds: [],
      evidence: uniqueEvidence(event.declarations.map((declaration) => declaration.evidence)),
    })
  }

  const finalCandidates = sortCandidates(applyOverrides(candidates, conflicts.overrides)).slice(
    0,
    MAX_EXTRACTION_CANDIDATES,
  )
  // 单位冲突 issue 补上真正被它阻塞的候选（按出处 + 原因码精确关联，不按页猜）。
  const linkedIssues = issues.map((item) => {
    if (item.code !== 'UNIT_CONFLICT' || item.evidence.length === 0) return item
    const keys = new Set(item.evidence.map((evidence) => evidenceKey(evidence)))
    const candidateIds = finalCandidates
      .filter(
        (candidate) =>
          candidate.reasonCodes.includes('UNIT_CONFLICT') &&
          candidate.evidence.some((evidence) => keys.has(evidenceKey(evidence))),
      )
      .map((candidate) => candidate.candidateId)
    return { ...item, candidateIds }
  })
  if (finalCandidates.length === 0) {
    issues.push(
      issue(
        'EXTRACTION_EMPTY',
        'warning',
        '页范围内没有生成任何候选；不填默认值，等待人工补充或换文本层样例',
        null,
      ),
    )
  }

  return {
    ...baseDraft,
    candidates: finalCandidates,
    issues: sortIssues(linkedIssues).slice(0, MAX_EXTRACTION_ISSUES),
  }
}
