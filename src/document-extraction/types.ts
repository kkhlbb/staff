/**
 * V3.6 阶段 1：任务书 PDF 自动提取的领域契约（纯数据，不依赖 Electron/React/IndexedDB）。
 *
 * 三条不可交换的边界：
 * 1. 提取只产生“待人工确认”的隔离草稿；本模块不写项目文件、不改 target、不建条款版本、
 *    不改已有绑定、不提交，也不调用任何计算。
 * 2. 任何数值字段都必须带完整出处（确切 PDF 版本、页码、选区、原文片段、页框）；
 *    缺任何一项，该数值不进入候选，只留 issue。见 isEvidenceComplete（回退实验 M02 的目标）。
 * 3. 默认状态只能是 pending 或 blocked；confirmed 只能由显式人工确认动作写入。见 draft.ts
 *    （回退实验 M01 的目标）。
 */
import type { PdfPageBox, PdfRect } from '../sources/pdfCoordinates'

/**
 * 提取规则版本；参与幂等键与候选身份。
 * 2：同符号多处不同赋值改为逐处候选（不再整批 AMBIGUOUS_ASSIGNMENT 阻塞）；
 *    同值多处合并；坏处单独 issue。规则语义变化必须升版本，旧草稿需主动重提。
 */
export const EXTRACTOR_VERSION = 'document-extractor-2'

export const MAX_EXTRACTION_PAGES = 100
export const MAX_EXTRACTION_CANDIDATES = 200
export const MAX_EXTRACTION_ISSUES = 200

export const EXTRACTION_KINDS = ['ring', 'interval', 'formula', 'part-dimension'] as const
export type ExtractionKind = (typeof EXTRACTION_KINDS)[number]

export const CANDIDATE_STATUSES = ['pending', 'blocked', 'confirmed', 'rejected', 'stale'] as const
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number]

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'unknown'] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

/** 明确原因码；状态不允许只有文案。 */
export const EXTRACTION_REASON_CODES = [
  // 出处
  'SOURCE_UNRESOLVED',
  'SOURCE_PAGE_OUT_OF_RANGE',
  // 单位
  'UNSUPPORTED_UNIT',
  'UNKNOWN_UNIT',
  'UNIT_CONFLICT',
  // 数值
  'NUMBER_UNSUPPORTED',
  'PRECISION_UNSUPPORTED',
  'RANGE_CONFLICT',
  'AMBIGUOUS_ASSIGNMENT',
  'AMBIGUOUS_DEVIATION',
  'DEVIATION_SIGN_MISSING',
  // 文本层与版面
  'NO_TEXT_LAYER',
  'PAGE_RANGE_INVALID',
  'PAGE_LIMIT',
  'NO_TABLE_HEADER',
  'UNSUPPORTED_TABLE_LAYOUT',
  'ENDPOINT_SEMANTICS_MISSING',
  // 公式
  'FORMULA_UNSUPPORTED',
  'FORMULA_UNRESOLVED_OPERAND',
  'FORMULA_CONFLICT',
  'FORMULA_VALUE_CONFLICT',
  // 冲突组
  'CONFLICT_GROUP_MEMBER',
] as const
export type ExtractionReasonCode = (typeof EXTRACTION_REASON_CODES)[number]

export const EXTRACTION_ISSUE_CODES = [
  ...EXTRACTION_REASON_CODES,
  'EXTRACTION_EMPTY',
] as const
export type ExtractionIssueCode = (typeof EXTRACTION_ISSUE_CODES)[number]

/** 提取的 PDF 版本身份；禁止以后自动替换成 latest。 */
export interface ExtractionSourceIdentity {
  readonly documentId: string
  readonly revisionId: string
  readonly sha256: string
  readonly blobKey: string
  readonly pageCount: number
}

/**
 * 每段出处必须齐全：确切版本 + 页码 + 未旋转 PDF 点选区 + 页框 + 原文片段。
 * textSnippet 保留 PDF 文本层原样（可能含康熙部首）；normalizedSnippet 是 NFKC 后的匹配文本。
 */
export interface ExtractionEvidence {
  readonly documentId: string
  readonly revisionId: string
  readonly sha256: string
  readonly blobKey: string
  readonly page: number
  readonly rectPdf: PdfRect
  readonly pageBoxPdf: PdfPageBox
  readonly textSnippet: string
  readonly normalizedSnippet: string
  readonly textItemIndexes: readonly number[]
}

/**
 * 出处完整性判据（唯一入口，M02 变异目标）。
 * 缺任何一项就返回 false：数值不得进入候选，只留 issue。
 */
export function isEvidenceComplete(evidence: ExtractionEvidence | null | undefined): boolean {
  if (!evidence) return false
  if (
    evidence.documentId.trim() === '' ||
    evidence.revisionId.trim() === '' ||
    evidence.sha256.trim() === '' ||
    evidence.blobKey.trim() === ''
  ) {
    return false
  }
  if (!Number.isSafeInteger(evidence.page) || evidence.page < 1) return false
  if (evidence.textSnippet.trim() === '') return false
  if (!evidence.textItemIndexes.every((index) => Number.isSafeInteger(index) && index >= 0)) {
    return false
  }
  const rect = evidence.rectPdf
  const box = evidence.pageBoxPdf
  if (rect.length !== 4 || box.length !== 4) return false
  if (!rect.every((value) => Number.isFinite(value))) return false
  if (!box.every((value) => Number.isFinite(value))) return false
  const [x0, y0, x1, y1] = rect
  if (!(x1 > x0) || !(y1 > y0)) return false
  const [bx0, by0, bx1, by1] = box
  if (!(bx1 > bx0) || !(by1 > by0)) return false
  const epsilon = 1e-6
  if (x0 < bx0 - epsilon || y0 < by0 - epsilon) return false
  if (x1 > bx1 + epsilon || y1 > by1 + epsilon) return false
  return true
}

export function evidenceKey(evidence: ExtractionEvidence): string {
  const [x0, y0, x1, y1] = evidence.rectPdf
  return [
    evidence.revisionId,
    evidence.page,
    x0.toFixed(2),
    y0.toFixed(2),
    x1.toFixed(2),
    y1.toFixed(2),
    evidence.textSnippet,
  ].join('#')
}

export function uniqueEvidence(
  evidence: readonly ExtractionEvidence[],
): readonly ExtractionEvidence[] {
  const seen = new Set<string>()
  const out: ExtractionEvidence[] = []
  for (const item of evidence) {
    const key = evidenceKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** 单个数值字段：原文十进制字符串 + 原始位数 + 精确 q（只在 mm 且格式合法时有值）。 */
export interface QuantityValue {
  /** 原文数字串，保留正负号与尾零，例如 "+0.02" / "0.1000"。 */
  readonly text: string
  readonly decimals: number
  /** 整数 q（1 mm = 10000 q）；单位不是 mm 或解析失败时为 null，绝不换算。 */
  readonly valueQ: number | null
  /** 原文单位串；未写为 null。 */
  readonly unitText: string | null
  /** 只接受 'mm'；inch 等一律 null，由 reasonCodes 标明。 */
  readonly unit: 'mm' | null
  readonly evidence: readonly ExtractionEvidence[]
}

export interface RingCandidateData {
  readonly symbol: string | null
  readonly name: string | null
  readonly nominal: QuantityValue | null
  readonly upperDeviation: QuantityValue | null
  readonly lowerDeviation: QuantityValue | null
}

/**
 * 同一符号多处赋值时，该候选在 group 内的位置（1-based）。
 *
 * - 只在同一符号出现 **多个不同取值** 时写入；取值相同的多处已合并成一条候选，
 *   此时 total=1，不写 occurrence（null/缺省）。
 * - 一条候选对应一处取值，出处仍是该处自己的页/选区/原文片段/item 索引。
 * - 互斥由 draft.confirmCandidate 强制：同一 ring group 只允许一条已确认。
 */
export interface ExtractionOccurrence {
  readonly index: number
  readonly total: number
}

export interface IntervalCandidateData {
  readonly outputSymbol: string | null
  readonly lower: QuantityValue | null
  readonly upper: QuantityValue | null
  readonly lowerInclusive: boolean | null
  readonly upperInclusive: boolean | null
  /** 端点语义自身的出处（“含两端”/"闭区间"），缺失不能默认闭区间。 */
  readonly endpointEvidence: readonly ExtractionEvidence[]
}

export interface FormulaOperand {
  readonly symbol: string
  readonly sign: 1 | -1
}

export interface FormulaCandidateData {
  readonly outputSymbol: string | null
  /** 原文表达式（保留原符号与空格）。 */
  readonly rawExpression: string
  /** 归一化后的表达式，仅用于展示与比较。 */
  readonly expression: string
  readonly operands: readonly FormulaOperand[]
  /** 仅支持当前引擎可表达的线性加减；遇到乘除/括号为 true。 */
  readonly unsupported: boolean
  readonly conflict: boolean
}

export interface PartDimensionData {
  readonly partName: string | null
  readonly innerDiameter: QuantityValue | null
  readonly outerDiameter: QuantityValue | null
  readonly length: QuantityValue | null
}

interface CandidateBase {
  readonly candidateId: string
  readonly kind: ExtractionKind
  readonly groupId: string | null
  /** 候选所依据的原文片段（整行，未归一）。 */
  readonly rawText: string
  readonly page: number
  readonly status: CandidateStatus
  readonly confidence: ConfidenceLevel
  readonly confidenceBasis: readonly string[]
  readonly reasonCodes: readonly ExtractionReasonCode[]
  readonly evidence: readonly ExtractionEvidence[]
  /** 人工编辑代数；每次编辑 +1，旧确认随之失效。 */
  readonly editRevision: number
  /**
   * 同一符号多处赋值时的位置标记；单值候选与其它类型为 null/缺省。
   * 可选是为了读旧 schema8 文件（当时还没有该字段），读取方一律用 `?? null`。
   */
  readonly occurrence?: ExtractionOccurrence | null
}

export type ExtractionCandidate =
  | (CandidateBase & { readonly kind: 'ring'; readonly data: RingCandidateData })
  | (CandidateBase & { readonly kind: 'interval'; readonly data: IntervalCandidateData })
  | (CandidateBase & { readonly kind: 'formula'; readonly data: FormulaCandidateData })
  | (CandidateBase & { readonly kind: 'part-dimension'; readonly data: PartDimensionData })

export interface ExtractionIssue {
  readonly issueId: string
  readonly code: ExtractionIssueCode
  readonly severity: 'blocked' | 'warning'
  readonly message: string
  readonly page: number | null
  readonly candidateIds: readonly string[]
  readonly evidence: readonly ExtractionEvidence[]
}

export type DecisionAction = 'confirm' | 'reject' | 'edit' | 'revoke'

export interface ExtractionDecision {
  readonly decisionId: string
  readonly candidateId: string
  readonly action: DecisionAction
  /** 决定时所针对的候选编辑代数；候选再次编辑后旧决定失效。 */
  readonly candidateEditRevision: number
  readonly decidedAt: string
  /** 本地操作身份（不是实名批准）。 */
  readonly actor: string
  readonly reason: string | null
  /** 决定时的数值快照（JSON 字符串），防止事后篡改。 */
  readonly valueSnapshot: string
  readonly evidence: readonly ExtractionEvidence[]
  readonly invalidatedByEditRevision: number | null
}

export interface ExtractionPageRange {
  readonly from: number
  readonly to: number
}

export interface ExtractionDraft {
  readonly draftId: string
  readonly draftRevision: number
  readonly status: 'draft'
  readonly projectId: string
  readonly baseToken: string
  readonly sourceIdentity: ExtractionSourceIdentity
  readonly pageRange: ExtractionPageRange
  readonly extractorVersion: string
  readonly idempotencyKey: string
  readonly candidates: readonly ExtractionCandidate[]
  readonly issues: readonly ExtractionIssue[]
  readonly decisions: readonly ExtractionDecision[]
}

export type ExtractionErrorCode =
  | 'PAGE_RANGE_INVALID'
  | 'CANDIDATE_NOT_FOUND'
  | 'CANDIDATE_BLOCKED'
  | 'CANDIDATE_REJECTED'
  | 'CANDIDATE_STALE'
  | 'GROUP_ALREADY_CONFIRMED'
  | 'STALE_EDIT_REVISION'
  | 'EXPLICIT_CONFIRMATION_REQUIRED'
  | 'ACTOR_REQUIRED'
  | 'DECIDED_AT_REQUIRED'
  | 'REASON_REQUIRED'
  | 'EVIDENCE_REQUIRED'
  | 'FIELD_UNSUPPORTED'
  | 'VALUE_UNSUPPORTED'
  | 'NOT_CONFIRMED'
  | 'STALE_DECISION'
  | 'SOURCE_STALE'
  | 'SOURCE_IDENTITY_MISMATCH'
  | 'EXTRACTOR_VERSION_MISMATCH'

export type ExtractionResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly code: ExtractionErrorCode
      readonly message: string
    }

export function extractionFailure<T>(
  code: ExtractionErrorCode,
  message: string,
): ExtractionResult<T> {
  return { ok: false, code, message }
}

export function extractionSuccess<T>(value: T): ExtractionResult<T> {
  return { ok: true, value }
}

/** 遍历候选的数值字段；用于通用校验（出处完整性、确认快照、应用门禁）。 */
export function candidateNumericFields(
  candidate: ExtractionCandidate,
): { field: string; value: QuantityValue }[] {
  const out: { field: string; value: QuantityValue }[] = []
  const push = (field: string, value: QuantityValue | null): void => {
    if (value) out.push({ field, value })
  }
  if (candidate.kind === 'ring') {
    push('nominal', candidate.data.nominal)
    push('upperDeviation', candidate.data.upperDeviation)
    push('lowerDeviation', candidate.data.lowerDeviation)
  } else if (candidate.kind === 'interval') {
    push('lower', candidate.data.lower)
    push('upper', candidate.data.upper)
  } else if (candidate.kind === 'part-dimension') {
    push('innerDiameter', candidate.data.innerDiameter)
    push('outerDiameter', candidate.data.outerDiameter)
    push('length', candidate.data.length)
  }
  return out
}

/** 候选当前数值快照；决定/应用都以它比较，避免只看状态布尔。 */
export function candidateValueSnapshot(candidate: ExtractionCandidate): string {
  return JSON.stringify(
    candidateNumericFields(candidate).map(({ field, value }) => ({
      field,
      text: value.text,
      unit: value.unitText,
      valueQ: value.valueQ,
    })),
  )
}
