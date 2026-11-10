/**
 * V3.6 阶段 1：任务书文本层 → 候选（确定性规则，不调用计算、不写项目）。
 *
 * 规则只做“看得见的抄写”：
 * - 组成环只从带表头的组成环表格行（位号 / 名称 / 基本尺寸 / 上偏差 / 下偏差）读取；
 * - 部件内外径 / 长度只从“内径 / 外径 / 长度”标注行读取，不当轴向环；
 * - 区间只读“X 应为 a～b mm（含两端）”这类显式区间句；
 * - 公式只读线性的 `C = H - B1 - S - B2`，不 eval、不改引擎公式。
 *
 * 宁可空着：单位不明、精度不支持、同符号多值、公式矛盾、无文本层时一律 blocked 或
 * 只留 issue，绝不默认 mm、默认 0、默认闭区间、按相邻关系补值。
 */
import { tryParseMm } from '../domain/units'
import type { PdfPageBox, PdfRect } from '../sources/pdfCoordinates'
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
  EXTRACTOR_VERSION,
  MAX_EXTRACTION_CANDIDATES,
  MAX_EXTRACTION_ISSUES,
  MAX_EXTRACTION_PAGES,
  isEvidenceComplete,
  uniqueEvidence,
  type CandidateStatus,
  type ConfidenceLevel,
  type ExtractionCandidate,
  type ExtractionDraft,
  type ExtractionEvidence,
  type ExtractionIssue,
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

type ParsedUnitKind = 'mm' | 'unsupported' | 'unknown' | 'missing'

interface ParsedUnit {
  readonly kind: ParsedUnitKind
  readonly text: string | null
}

function parseUnitToken(token: string | null | undefined): ParsedUnit {
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

function unitReason(unit: ParsedUnit): ExtractionReasonCode {
  return unit.kind === 'unsupported' ? 'UNSUPPORTED_UNIT' : 'UNKNOWN_UNIT'
}

function decimalCount(text: string): number {
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
}

interface QuantityOutcome {
  readonly value: QuantityValue | null
  readonly reason: ExtractionReasonCode | null
}

/**
 * 数值字段构造：先要求出处齐全，再做十进制字符串 → q 的精确校验。
 * 单位不是 mm 时保留原文与 valueQ=null，绝不换算。
 */
function buildQuantity(input: {
  readonly text: string
  readonly unitToken: string | null
  readonly evidence: ExtractionEvidence | null
  readonly extraEvidence?: readonly ExtractionEvidence[]
}): QuantityOutcome {
  const evidence = input.evidence
  if (!evidence || !isEvidenceComplete(evidence)) {
    // M02：缺出处 → 数值不进候选，只留 issue。
    return { value: null, reason: 'SOURCE_UNRESOLVED' }
  }
  const text = input.text
  const parsed = tryParseMm(text)
  const unit = parseUnitToken(input.unitToken)
  const evidenceList = uniqueEvidence([
    evidence,
    ...(input.extraEvidence ?? []).filter((item) => isEvidenceComplete(item)),
  ])
  const base = {
    text,
    decimals: decimalCount(text),
    unitText: unit.text,
    evidence: evidenceList,
  }
  if (!parsed.ok) {
    return {
      value: { ...base, valueQ: null, unit: null },
      reason: parsed.code === 'precision' ? 'PRECISION_UNSUPPORTED' : 'NUMBER_UNSUPPORTED',
    }
  }
  if (unit.kind !== 'mm') {
    return { value: { ...base, valueQ: null, unit: null }, reason: unitReason(unit) }
  }
  return { value: { ...base, valueQ: parsed.value, unit: 'mm' }, reason: null }
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
}

// ---------------------------------------------------------------- 组成环表格

const TABLE_HEADER_TOKENS = ['位号', '名称', '基本尺寸', '上偏差', '下偏差'] as const
const HEADER_UNIT_PATTERN = /基本尺寸\s*[(（]([^)）]*)[)）]/d
const ROW_PATTERN =
  /^([A-Za-z][A-Za-z0-9]{0,3})\s+([^\s\d+-]\S*)\s+(\d+(?:\.\d+)?)(?:\s+([+-]?\d+(?:\.\d+)?))?(?:\s+([+-]?\d+(?:\.\d+)?))?\s*$/d

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

function deviationValue(
  line: PdfTextLine,
  page: PdfTextPage,
  source: ExtractionSourceIdentity,
  match: RegExpExecArray,
  index: number,
  unitToken: string | null,
  unitEvidence: ExtractionEvidence | null,
): { value: QuantityValue | null; reason: ExtractionReasonCode | null } {
  const range = groupRange(match, index)
  if (!range) return { value: null, reason: null }
  const text = matchTextOf(line).slice(range[0], range[1])
  if (!/^[+-]/.test(text)) {
    // 上下偏差未写符号 → 不当 0，也不当偏差。
    return { value: null, reason: 'DEVIATION_SIGN_MISSING' }
  }
  const outcome = buildQuantity({
    text,
    unitToken,
    evidence: locate(line, page, source, range),
    extraEvidence: unitEvidence ? [unitEvidence] : [],
  })
  return { value: outcome.value, reason: outcome.reason }
}

function ringEntryFromRow(
  line: PdfTextLine,
  page: PdfTextPage,
  source: ExtractionSourceIdentity,
  match: RegExpExecArray,
  unit: ParsedUnit,
  unitEvidence: ExtractionEvidence | null,
): RingEntry {
  const text = matchTextOf(line)
  const symbol = text.slice(...(groupRange(match, 1) ?? [0, 0]))
  const nameRange = groupRange(match, 2)
  const name = nameRange ? text.slice(nameRange[0], nameRange[1]) : null
  const nominalRange = groupRange(match, 3)
  const nominalOutcome = nominalRange
    ? buildQuantity({
        text: text.slice(nominalRange[0], nominalRange[1]),
        unitToken: unit.text,
        evidence: locate(line, page, source, nominalRange),
        extraEvidence: unitEvidence ? [unitEvidence] : [],
      })
    : { value: null, reason: null }

  const upper = deviationValue(line, page, source, match, 4, unit.text, unitEvidence)
  const lower = deviationValue(line, page, source, match, 5, unit.text, unitEvidence)
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
  }
}

function parseTable(
  lines: readonly PdfTextLine[],
  start: number,
  page: PdfTextPage,
  source: ExtractionSourceIdentity,
  issues: ExtractionIssue[],
): { entries: RingEntry[]; next: number } {
  const header = lines[start]
  const match = HEADER_UNIT_PATTERN.exec(matchTextOf(header))
  const unitToken = match?.[1] ?? null
  const unit = parseUnitToken(unitToken)
  const unitRange = match?.indices?.[1] ?? null
  const unitEvidence = unitRange ? locate(header, page, source, unitRange) : null
  const entries: RingEntry[] = []
  let index = start + 1
  while (index < lines.length) {
    const line = lines[index]
    const rowMatch = ROW_PATTERN.exec(matchTextOf(line))
    if (!rowMatch) break
    // 名称必须不是纯符号/数字，避免把下一段正文误当数据行。
    entries.push(ringEntryFromRow(line, page, source, rowMatch, unit, unitEvidence))
    index += 1
  }
  if (entries.length === 0) {
    issues.push({
      issueId: stableId('issue', ['NO_TABLE_ROWS', page.page, header.rawText]),
      code: 'NO_TABLE_HEADER',
      severity: 'blocked',
      message: `第 ${page.page} 页有表头但未读到可解析的组成环数据行`,
      page: page.page,
      candidateIds: [],
      evidence: header.rectPdf ? [] : [],
    })
  }
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

function parseAssignmentLine(
  line: PdfTextLine,
  page: PdfTextPage,
  source: ExtractionSourceIdentity,
): RingEntry[] {
  const text = matchTextOf(line)
  const entries: RingEntry[] = []
  for (const segment of text.split(',')) {
    const offset = text.indexOf(segment)
    if (offset < 0) continue
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
      range[0] + offset,
      range[1] + offset,
    ]
    const unitToken = unitGroup ? segment.slice(unitGroup[0], unitGroup[1]) : null
    const valueEvidence = locate(line, page, source, shift(valueGroup))
    const unitEvidence = unitGroup ? locate(line, page, source, shift(unitGroup)) : null
    const outcome = buildQuantity({
      text: segment.slice(valueGroup[0], valueGroup[1]),
      unitToken,
      evidence: valueEvidence,
      extraEvidence: unitEvidence ? [unitEvidence] : [],
    })
    for (const symbol of symbols) {
      const symbolAt = text.indexOf(symbol, offset + match.index)
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
    const withNominal = group.filter((entry) => entry.nominal !== null)
    if (withNominal.length === 0) {
      // 有符号但数值拿不到完整出处：只留 issue，不造“有值无出处”的候选。
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

    const buckets = new Map<string, RingEntry[]>()
    for (const entry of withNominal) {
      const key = quantityKey(entry.nominal as QuantityValue)
      const list = buckets.get(key) ?? []
      list.push(entry)
      buckets.set(key, list)
    }
    const ambiguous = buckets.size > 1
    const built: ExtractionCandidate[] = []

    for (const bucket of buckets.values()) {
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
      if (ambiguous) reasons.add('AMBIGUOUS_ASSIGNMENT')

      const reasonCodes = [...reasons]
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
          ambiguous ? 'RULE_MULTIPLE_VALUES' : 'RULE_SINGLE_VALUE',
        ],
        reasonCodes,
        evidence,
        editRevision: 0,
        data,
      }
      built.push(candidate)
      candidates.push(candidate)
    }

    if (ambiguous && built.length > 1) {
      const evidence = uniqueEvidence(built.flatMap((candidate) => candidate.evidence))
      issues.push({
        issueId: stableId('issue', ['AMBIGUOUS_ASSIGNMENT', symbol]),
        code: 'AMBIGUOUS_ASSIGNMENT',
        severity: 'blocked',
        message: `符号 ${symbol} 在页范围里出现 ${built.length} 组不同数值，需人工择一；未自动选取`,
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
    })
    if (outcome.reason) reasons.add(outcome.reason)
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
    confidenceBasis: ['RULE_PART_LABEL_LINE'],
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
): ExtractionCandidate | null {
  const text = matchTextOf(line)
  const match = INTERVAL_PATTERN.exec(text)
  if (!match) return null
  const lowerRange = match.indices?.[2]
  const upperRange = match.indices?.[3]
  if (!lowerRange || !upperRange) return null
  const unitToken = match[4] === '' ? null : match[4]
  const lower = buildQuantity({
    text: text.slice(lowerRange[0], lowerRange[1]),
    unitToken,
    evidence: locate(line, page, source, lowerRange),
  })
  const upper = buildQuantity({
    text: text.slice(upperRange[0], upperRange[1]),
    unitToken,
    evidence: locate(line, page, source, upperRange),
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
    confidenceBasis: ['RULE_INTERVAL_SENTENCE'],
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
        const table = parseTable(page.lines, index, page, request.source, issues)
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
      const interval = parseIntervalLine(line, page, request.source)
      if (interval) {
        intervalCandidates.push(interval)
        index += 1
        continue
      }
      const part = parsePartLine(line, page, request.source)
      if (part) {
        partCandidates.push(part)
        index += 1
        continue
      }
      if (matchTextOf(line).includes('=')) {
        ringEntries.push(...parseAssignmentLine(line, page, request.source))
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

  const finalCandidates = sortCandidates(applyOverrides(candidates, conflicts.overrides)).slice(
    0,
    MAX_EXTRACTION_CANDIDATES,
  )
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
    issues: sortIssues(issues).slice(0, MAX_EXTRACTION_ISSUES),
  }
}
