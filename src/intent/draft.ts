/**
 * ADR-001 第 3 步：把对话里的数值落成**待确认的提取草稿**（不写项目、不计算）。
 *
 * 复用既有 `ExtractionDraft` 形状，让确认 → planApplication → 草稿 → 预览 →
 * 提交仍是同一条门禁；差别只在出处：这里的每条数值都挂 `user-attestation`，
 * 没有 PDF 版本可比。
 *
 * 关键约束：
 * - 候选默认 pending，confirmed 只能由既有 confirmCandidate 的用户动作写入；
 * - 每次写入先校验“原话 + 数值都来自本轮用户输入”，模型代填一律拒绝；
 * - 更新同一符号时推进 editRevision，旧确认随之失效（不是悄悄改值）。
 */
import { tryParseMm, formatMm } from '../domain/units'
import { stableId, stableHash } from '../document-extraction/ids'
import type {
  ExtractionCandidate,
  ExtractionDraft,
  QuantityValue,
  UserAttestation,
} from '../document-extraction/types'
import {
  buildAttestation,
  intentFail,
  intentOk,
  numbersAreUserGiven,
  statementIsUserGiven,
  type IntentInputResult,
  type IntentSession,
  type IntentTurn,
} from './types'

/** 意图草稿的规则版本；语义变化必须升版本（旧草稿需重做）。 */
export const INTENT_EXTRACTOR_VERSION = 'intent-builder-1'

/** 一个项目内只有一份意图草稿（同一时间只允许一条在建链）。 */
export function intentDraftId(projectId: string): string {
  return `intent-draft-${stableHash([projectId])}`
}

/** 确定性 64 位十六进制内容身份（四段 FNV 组合，不是文件哈希，也不是安全摘要）。 */
function contentIdentity(parts: readonly (string | number)[]): string {
  return [0, 1, 2, 3]
    .map((salt) => stableHash([salt, ...parts]))
    .join('')
}

/**
 * 意图草稿的来源身份。没有 PDF 版本可引，这里给的是**内容身份**：
 * 项目 + 责任人 + 会话序号 + 草稿；`blobKey` 只是占位，不代表任何文件。
 * planApplication 的第一道 source 比对因此仍是同一段代码、同一错误码。
 */
export function intentSourceIdentity(projectId: string, session: IntentSession) {
  return {
    documentId: `intent:${projectId}`,
    revisionId: `intent:${projectId}:s${session.sessionSeq}`,
    sha256: contentIdentity([projectId, session.actorId, session.sessionSeq]),
    blobKey: 'intent:no-external-file',
    pageCount: 1,
  } as const
}

/** 新建空意图草稿：没有任何候选，等用户开口。 */
export function createIntentDraft(input: {
  projectId: string
  session: IntentSession
  turn: IntentTurn
}): ExtractionDraft {
  return {
    draftId: intentDraftId(input.projectId),
    draftRevision: 1,
    status: 'draft',
    projectId: input.projectId,
    baseToken: `intent:${input.session.actorId}:${input.session.sessionSeq}`,
    sourceIdentity: intentSourceIdentity(input.projectId, input.session),
    pageRange: { from: 1, to: 1 },
    extractorVersion: INTENT_EXTRACTOR_VERSION,
    idempotencyKey: stableId('intent', [
      input.projectId,
      input.session.actorId,
      input.session.sessionSeq,
    ]),
    candidates: [],
    issues: [],
    decisions: [],
    intentBindings: [],
  }
}

function decimalCount(text: string): number {
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
}

/** mm 数值 → QuantityValue；单位不是 mm 或精度不合法时明确失败，不换算。 */
function quantityOf(
  text: string,
  attestation: UserAttestation,
): IntentInputResult<QuantityValue> {
  const parsed = tryParseMm(text)
  if (!parsed.ok) {
    return intentFail('VALUE_UNSUPPORTED', `数值不合法或超出精度：${parsed.message}`)
  }
  return intentOk({
    text: text.trim(),
    decimals: decimalCount(text.trim()),
    valueQ: parsed.value,
    unitText: 'mm',
    unit: 'mm',
    evidence: [],
    provenance: [attestation],
  })
}

export interface IntentRingInput {
  readonly symbol: string
  readonly nominalMm: string
  readonly upperDeviationMm: string
  readonly lowerDeviationMm: string
}

export interface SetChainInput {
  readonly session: IntentSession
  readonly turn: IntentTurn
  readonly statement: string
  readonly rings: readonly IntentRingInput[]
  /** 可选装配式，例如 `H - B1 - S - B2`；符号必须在 rings 里。 */
  readonly formula?: string
}

/** 解析 `H - B1 - S - B2`；只接受加减，符号不允许重复。 */
export function parseFormula(
  formula: string,
  symbols: readonly string[],
): IntentInputResult<{ symbol: string; sign: 1 | -1 }[]> {
  const compact = formula.normalize('NFKC').replace(/\s+/gu, '').trim()
  if (compact === '') return intentFail('FORMULA_UNSUPPORTED', '装配式不能为空')
  const tokens: string[] = []
  const pattern = /([+-]?)([^+-]+)/gu
  let match: RegExpExecArray | null
  while ((match = pattern.exec(compact)) !== null) {
    tokens.push(`${match[1] ?? ''}${match[2] ?? ''}`)
  }
  if (tokens.length === 0) {
    return intentFail('FORMULA_UNSUPPORTED', `装配式只支持加减与符号：${formula}`)
  }
  const operands: { symbol: string; sign: 1 | -1 }[] = []
  for (const token of tokens) {
    const parsed = /^([+-]?)([^+-]+)$/u.exec(token)
    if (parsed === null) {
      return intentFail('FORMULA_UNSUPPORTED', `装配式只支持加减与符号：${formula}`)
    }
    const symbol = parsed[2]!
    const sign: 1 | -1 = parsed[1] === '-' ? -1 : 1
    if (!symbols.includes(symbol)) {
      return intentFail('FORMULA_UNSUPPORTED', `装配式里的 ${symbol} 不在组成环里`)
    }
    if (operands.some((operand) => operand.symbol === symbol)) {
      return intentFail('SYMBOL_DUPLICATED', `装配式里 ${symbol} 出现了不止一次`)
    }
    operands.push({ symbol, sign })
  }
  if (operands.length !== symbols.length) {
    return intentFail('FORMULA_UNSUPPORTED', '装配式必须覆盖全部组成环（每个符号一次）')
  }
  return intentOk(operands)
}

function ringCandidateId(draft: ExtractionDraft, symbol: string): string {
  return stableId('intent-ring', [draft.draftId, symbol])
}

/**
 * 写入组成环（符号 / 基本尺寸 / 上下偏差 / 增减环通过装配式给出）。
 *
 * 同一符号重复写入不是新增候选：保留 candidateId、推进 editRevision，
 * 旧确认因此失效，必须重新确认。
 */
export function setChainInDraft(
  draft: ExtractionDraft,
  input: SetChainInput,
): IntentInputResult<ExtractionDraft> {
  if (!statementIsUserGiven(input.statement, input.turn.userText)) {
    return intentFail(
      'STATEMENT_NOT_USER_GIVEN',
      '出处原话必须能在本轮用户输入里逐字找到；请让用户自己说一遍',
    )
  }
  if (input.rings.length === 0) {
    return intentFail('RING_NOT_FOUND', '至少需要一个组成环')
  }
  const symbols = input.rings.map((ring) => ring.symbol.trim())
  if (new Set(symbols).size !== symbols.length) {
    return intentFail('SYMBOL_DUPLICATED', '同一组成环符号不能重复')
  }
  if (input.formula !== undefined) {
    const parsedFormula = parseFormula(input.formula, symbols)
    if (!parsedFormula.ok) return parsedFormula
  }
  const numbers = input.rings.flatMap((ring) => [
    ring.nominalMm,
    ring.upperDeviationMm,
    ring.lowerDeviationMm,
  ])
  if (!numbersAreUserGiven(numbers, input.turn.userText)) {
    return intentFail(
      'VALUE_MUST_BE_USER_GIVEN',
      '组成环的尺寸与偏差必须来自用户原话；模型不能代填或推算',
    )
  }
  const attestation = buildAttestation({
    session: input.session,
    turn: input.turn,
    statement: input.statement,
    fieldPath: 'chain.terms',
  })
  const candidates: ExtractionCandidate[] = []
  for (const ring of input.rings) {
    const nominal = quantityOf(ring.nominalMm, attestation)
    if (!nominal.ok) return nominal
    const upper = quantityOf(ring.upperDeviationMm, attestation)
    if (!upper.ok) return upper
    const lower = quantityOf(ring.lowerDeviationMm, attestation)
    if (!lower.ok) return lower
    const symbol = ring.symbol.trim()
    const previous = draft.candidates.find(
      (candidate) => candidate.kind === 'ring' && candidate.data.symbol === symbol,
    )
    candidates.push({
      candidateId: ringCandidateId(draft, symbol),
      kind: 'ring',
      groupId: stableId('intent-ring-group', [draft.draftId, symbol]),
      rawText: input.statement,
      page: 1,
      status: 'pending',
      confidence: 'high',
      confidenceBasis: ['RULE_USER_ATTESTATION'],
      reasonCodes: [],
      evidence: [],
      provenance: [attestation],
      editRevision: previous === undefined ? 1 : previous.editRevision + 1,
      occurrence: null,
      data: {
        symbol,
        name: null,
        nominal: nominal.value,
        upperDeviation: upper.value,
        lowerDeviation: lower.value,
      },
    })
  }
  const formula =
    input.formula === undefined
      ? undefined
      : (() => {
          const parsed = parseFormula(input.formula, symbols)
          return parsed.ok ? parsed.value : []
        })()
  if (formula !== undefined) {
    const previous = draft.candidates.find((candidate) => candidate.kind === 'formula')
    candidates.push({
      candidateId: stableId('intent-formula', [draft.draftId]),
      kind: 'formula',
      groupId: null,
      rawText: input.formula ?? '',
      page: 1,
      status: 'pending',
      confidence: 'high',
      confidenceBasis: ['RULE_USER_ATTESTATION'],
      reasonCodes: [],
      evidence: [],
      provenance: [attestation],
      editRevision: previous === undefined ? 1 : previous.editRevision + 1,
      occurrence: null,
      data: {
        outputSymbol: symbols[0] ?? null,
        rawExpression: input.formula ?? '',
        expression: (input.formula ?? '').replace(/\s+/gu, ' ').trim(),
        operands: formula,
        unsupported: false,
        conflict: false,
      },
    })
  }
  const untouched = draft.candidates.filter((candidate) =>
    candidate.kind === 'ring' || candidate.kind === 'formula'
      ? false
      : true,
  )
  return intentOk({
    ...draft,
    draftRevision: draft.draftRevision + 1,
    candidates: [...untouched, ...candidates].sort((left, right) =>
      left.candidateId.localeCompare(right.candidateId),
    ),
  })
}

export interface SetRequirementInput {
  readonly session: IntentSession
  readonly turn: IntentTurn
  readonly statement: string
  readonly lowerMm: string
  readonly upperMm: string
  readonly lowerInclusive: boolean
  readonly upperInclusive: boolean
}

/**
 * 写入条款区间。**只有用户原话能给**：
 * - 原话必须逐字出现在本轮输入里；
 * - 上下限两个数必须都能在本轮原话里找到；
 * - 不接受标准等级/默认值（本函数没有任何标准库入口）。
 * 任一不满足返回 `REQUIREMENT_MUST_BE_USER_GIVEN`。
 */
export function setRequirementInDraft(
  draft: ExtractionDraft,
  input: SetRequirementInput,
): IntentInputResult<ExtractionDraft> {
  if (!statementIsUserGiven(input.statement, input.turn.userText)) {
    return intentFail(
      'REQUIREMENT_MUST_BE_USER_GIVEN',
      '条款区间必须由用户原话给出；模型不能代填、引用标准等级或推算默认值',
    )
  }
  if (!numbersAreUserGiven([input.lowerMm, input.upperMm], input.turn.userText)) {
    return intentFail(
      'REQUIREMENT_MUST_BE_USER_GIVEN',
      '条款上下限必须出现在用户原话里；模型不能代填、引用标准等级或推算默认值',
    )
  }
  const lowerQ = tryParseMm(input.lowerMm)
  if (!lowerQ.ok) return intentFail('VALUE_UNSUPPORTED', `下限不合法：${lowerQ.message}`)
  const upperQ = tryParseMm(input.upperMm)
  if (!upperQ.ok) return intentFail('VALUE_UNSUPPORTED', `上限不合法：${upperQ.message}`)
  if (lowerQ.value > upperQ.value) {
    return intentFail('VALUE_CONFLICT', '条款下限不能大于上限')
  }
  const attestation = buildAttestation({
    session: input.session,
    turn: input.turn,
    statement: input.statement,
    fieldPath: 'requirement.interval',
  })
  const lower = quantityOf(input.lowerMm, attestation)
  if (!lower.ok) return lower
  const upper = quantityOf(input.upperMm, attestation)
  if (!upper.ok) return upper
  const previous = draft.candidates.find((candidate) => candidate.kind === 'interval')
  const candidate: ExtractionCandidate = {
    candidateId: stableId('intent-interval', [draft.draftId]),
    kind: 'interval',
    groupId: null,
    rawText: input.statement,
    page: 1,
    status: 'pending',
    confidence: 'high',
    confidenceBasis: ['RULE_USER_ATTESTATION'],
    reasonCodes: [],
    evidence: [],
    provenance: [attestation],
    editRevision: previous === undefined ? 1 : previous.editRevision + 1,
    occurrence: null,
    data: {
      outputSymbol: null,
      lower: lower.value,
      upper: upper.value,
      lowerInclusive: input.lowerInclusive,
      upperInclusive: input.upperInclusive,
      endpointEvidence: [],
    },
  }
  return intentOk({
    ...draft,
    draftRevision: draft.draftRevision + 1,
    candidates: [
      ...draft.candidates.filter((item) => item.kind !== 'interval'),
      candidate,
    ].sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
  })
}

export type IntentParameterKey = 'innerDiameter' | 'outerDiameter' | 'length'

export interface SetBindingInput {
  readonly session: IntentSession
  readonly turn: IntentTurn
  readonly statement: string
  readonly parameters: readonly {
    readonly parameter: IntentParameterKey
    readonly mm: string
    /** 可选：该参数绑定到哪个组成环（基本尺寸必须相等）。 */
    readonly symbol?: string
  }[]
}

export interface IntentBinding {
  readonly parameter: IntentParameterKey
  readonly symbol: string
  readonly valueQ: number
  readonly text: string
}

/**
 * 写入隔套三参数与“参数 ↔ 组成环”绑定意图。
 *
 * 任务卡只允许四个工具，所以参数值（对话里给出的 φ20 / 外径 32 / 长 12.05）
 * 与绑定一起走这里；每个值仍必须来自用户原话。绑定要求参数值等于该环基本尺寸，
 * 不允许把两个不同的数“绑”在一起。
 */
export function setBindingInDraft(
  draft: ExtractionDraft,
  input: SetBindingInput,
): IntentInputResult<ExtractionDraft> {
  if (!statementIsUserGiven(input.statement, input.turn.userText)) {
    return intentFail('STATEMENT_NOT_USER_GIVEN', '出处原话必须能在本轮用户输入里逐字找到')
  }
  if (input.parameters.length === 0) {
    return intentFail('VALUE_UNSUPPORTED', '至少需要一个隔套参数')
  }
  const keys = input.parameters.map((item) => item.parameter)
  if (new Set(keys).size !== keys.length) {
    return intentFail('VALUE_CONFLICT', '同一参数不能在一次写入里重复')
  }
  if (!numbersAreUserGiven(input.parameters.map((item) => item.mm), input.turn.userText)) {
    return intentFail('VALUE_MUST_BE_USER_GIVEN', '隔套参数尺寸必须来自用户原话')
  }
  const attestation = buildAttestation({
    session: input.session,
    turn: input.turn,
    statement: input.statement,
    fieldPath: 'part.parameters',
  })
  const quantities: Partial<Record<IntentParameterKey, QuantityValue>> = {}
  const intentBindings: IntentBinding[] = []
  for (const item of input.parameters) {
    const quantity = quantityOf(item.mm, attestation)
    if (!quantity.ok) return quantity
    quantities[item.parameter] = quantity.value
    if (item.symbol !== undefined) {
      const ring = draft.candidates.find(
        (candidate) => candidate.kind === 'ring' && candidate.data.symbol === item.symbol,
      )
      if (ring === undefined || ring.kind !== 'ring' || ring.data.nominal === null) {
        return intentFail('RING_NOT_FOUND', `绑定目标 ${item.symbol} 还没有基本尺寸`)
      }
      const ringNominalQ = ring.data.nominal.valueQ
      if (ringNominalQ === null) {
        return intentFail('RING_NOT_FOUND', `绑定目标 ${item.symbol} 没有可用的 mm 基本尺寸`)
      }
      if (ringNominalQ !== quantity.value.valueQ) {
        return intentFail(
          'BINDING_CONFLICT',
          `${item.parameter} 的 ${item.mm} mm 与组成环 ${item.symbol} 的基本尺寸 ${formatMm(ringNominalQ)} mm 不相等，不能绑定`,
        )
      }
      intentBindings.push({
        parameter: item.parameter,
        symbol: item.symbol,
        valueQ: ringNominalQ,
        text: quantity.value.text,
      })
    }
  }
  const previous = draft.candidates.find((candidate) => candidate.kind === 'part-dimension')
  const previousData = previous?.kind === 'part-dimension' ? previous.data : null
  const merged = {
    innerDiameter: quantities.innerDiameter ?? previousData?.innerDiameter ?? null,
    outerDiameter: quantities.outerDiameter ?? previousData?.outerDiameter ?? null,
    length: quantities.length ?? previousData?.length ?? null,
  }
  const candidate: ExtractionCandidate = {
    candidateId: stableId('intent-part', [draft.draftId]),
    kind: 'part-dimension',
    groupId: null,
    rawText: input.statement,
    page: 1,
    status: 'pending',
    confidence: 'high',
    confidenceBasis: ['RULE_USER_ATTESTATION'],
    reasonCodes: [],
    evidence: [],
    provenance: [attestation],
    editRevision: previous === undefined ? 1 : previous.editRevision + 1,
    occurrence: null,
    data: { partName: null, ...merged },
  }
  const allBindings = new Map<string, IntentBinding>()
  for (const binding of [...(draft.intentBindings ?? []), ...intentBindings]) {
    allBindings.set(binding.parameter, binding)
  }
  return intentOk({
    ...draft,
    draftRevision: draft.draftRevision + 1,
    candidates: [
      ...draft.candidates.filter((item) => item.kind !== 'part-dimension'),
      candidate,
    ].sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
    intentBindings: [...allBindings.values()],
  })
}
