/**
 * V3.6 阶段 1：提取草稿的生命周期与人工确认契约（纯函数，无 IO）。
 *
 * 这里落实两条硬约束：
 * 1. 默认候选是 pending / blocked；confirmed 只能由 confirmCandidate 的显式动作写入，
 *    而且送入项目的计划（planApplication）只接受 confirmed 且决定未失效的候选（M01）。
 * 2. 所有数值字段必须有完整出处；确认、编辑、应用三处都走 isEvidenceComplete（M02）。
 *
 * 本模块没有任何写项目/写盘/计算入口：planApplication 只产出映射计划，不应用。
 */
import { tryParseMm } from '../domain/units'
import { stableId } from './ids'
import {
  candidateNumericFields,
  candidateValueSnapshot,
  extractionFailure,
  extractionSuccess,
  isEvidenceComplete,
  type CandidateStatus,
  type ExtractionCandidate,
  type ExtractionDecision,
  type ExtractionDraft,
  type ExtractionEvidence,
  type ExtractionIssue,
  type ExtractionKind,
  type ExtractionReasonCode,
  type ExtractionResult,
  type QuantityValue,
} from './types'

/** 编辑数值后仍然成立的原因码（值本身已由人工改过，值类原因随之失效）。 */
const VALUE_REASON_CODES: readonly ExtractionReasonCode[] = [
  'UNSUPPORTED_UNIT',
  'UNKNOWN_UNIT',
  'UNIT_CONFLICT',
  'NUMBER_UNSUPPORTED',
  'PRECISION_UNSUPPORTED',
  'AMBIGUOUS_ASSIGNMENT',
  'AMBIGUOUS_DEVIATION',
  'DEVIATION_SIGN_MISSING',
  'RANGE_CONFLICT',
  'ENDPOINT_SEMANTICS_MISSING',
]

export function findCandidate(
  draft: ExtractionDraft,
  candidateId: string,
): ExtractionCandidate | null {
  return draft.candidates.find((candidate) => candidate.candidateId === candidateId) ?? null
}

function replaceCandidate(
  draft: ExtractionDraft,
  candidateId: string,
  update: (candidate: ExtractionCandidate) => ExtractionCandidate,
): ExtractionDraft {
  return {
    ...draft,
    draftRevision: draft.draftRevision + 1,
    candidates: draft.candidates.map((candidate) =>
      candidate.candidateId === candidateId ? update(candidate) : candidate,
    ),
  }
}

function candidateWithStatus(
  candidate: ExtractionCandidate,
  status: CandidateStatus,
  reasonCodes: readonly ExtractionReasonCode[],
): ExtractionCandidate {
  return { ...candidate, status, reasonCodes }
}

/** 数值字段出处必须逐项齐全；缺一项就不能确认/应用。 */
function evidenceMissing(candidate: ExtractionCandidate): string | null {
  const fields = candidateNumericFields(candidate)
  for (const { field, value } of fields) {
    if (value.evidence.length === 0) return field
    for (const evidence of value.evidence) {
      if (!isEvidenceComplete(evidence)) return field
    }
  }
  if (candidate.kind === 'formula') {
    if (candidate.evidence.length === 0) return 'expression'
    for (const evidence of candidate.evidence) {
      if (!isEvidenceComplete(evidence)) return 'expression'
    }
  }
  return null
}

function requireCommon(request: {
  actor: string
  decidedAt: string
}): ExtractionResult<true> {
  if (typeof request.actor !== 'string' || request.actor.trim() === '') {
    return extractionFailure('ACTOR_REQUIRED', '缺少本地操作身份，不能记录确认动作')
  }
  if (typeof request.decidedAt !== 'string' || request.decidedAt.trim() === '') {
    return extractionFailure('DECIDED_AT_REQUIRED', '缺少决定时间')
  }
  return extractionSuccess(true)
}

function latestActiveDecision(
  draft: ExtractionDraft,
  candidateId: string,
): ExtractionDecision | null {
  const decisions = draft.decisions.filter(
    (decision) =>
      decision.candidateId === candidateId &&
      decision.action === 'confirm' &&
      decision.invalidatedByEditRevision === null,
  )
  return decisions.length > 0 ? decisions[decisions.length - 1] : null
}

export interface ConfirmRequest {
  readonly candidateId: string
  /** 候选当前编辑代数；不匹配即拒绝，防止拿旧界面确认新值。 */
  readonly editRevision: number
  /** 必须是字面量 true：不接受缺省、'true' 字符串或 renderer 布尔猜测。 */
  readonly confirmed: true
  readonly actor: string
  readonly decidedAt: string
  readonly reason?: string
}

export function confirmCandidate(
  draft: ExtractionDraft,
  request: ConfirmRequest,
): ExtractionResult<ExtractionDraft> {
  if (request.confirmed !== true) {
    return extractionFailure(
      'EXPLICIT_CONFIRMATION_REQUIRED',
      '必须由用户显式确认该候选；不存在默认勾选或全批确认',
    )
  }
  const common = requireCommon(request)
  if (!common.ok) return common
  const candidate = findCandidate(draft, request.candidateId)
  if (!candidate) {
    return extractionFailure('CANDIDATE_NOT_FOUND', `找不到候选 ${request.candidateId}`)
  }
  if (candidate.editRevision !== request.editRevision) {
    return extractionFailure(
      'STALE_EDIT_REVISION',
      `候选编辑代数已变化（当前 ${candidate.editRevision}，请求 ${request.editRevision}），请重新查看原文`,
    )
  }
  if (candidate.status === 'rejected') {
    return extractionFailure('CANDIDATE_REJECTED', '该候选已被人工拒绝，不能直接复活为确认')
  }
  if (candidate.status === 'stale') {
    return extractionFailure('CANDIDATE_STALE', '候选已因来源或规则变化失效，不能确认')
  }
  if (candidate.status === 'blocked') {
    return extractionFailure(
      'CANDIDATE_BLOCKED',
      `候选处于阻塞状态（${candidate.reasonCodes.join(', ') || '无原因码'}），不能确认`,
    )
  }
  const missing = evidenceMissing(candidate)
  if (missing) {
    return extractionFailure(
      'EVIDENCE_REQUIRED',
      `字段 ${missing} 缺少完整出处（版本/页/选区/原文），不能确认`,
    )
  }
  const existing = latestActiveDecision(draft, candidate.candidateId)
  if (candidate.status === 'confirmed' && existing) {
    // 同一确认重复提交：返回原草稿与原有决定，不重复记录。
    return extractionSuccess(draft)
  }

  const decision: ExtractionDecision = {
    decisionId: stableId('decision', [
      draft.draftId,
      candidate.candidateId,
      candidate.editRevision,
      'confirm',
      request.actor,
      request.decidedAt,
    ]),
    candidateId: candidate.candidateId,
    action: 'confirm',
    candidateEditRevision: candidate.editRevision,
    decidedAt: request.decidedAt,
    actor: request.actor,
    reason: request.reason ?? null,
    valueSnapshot: candidateValueSnapshot(candidate),
    evidence: candidateNumericFields(candidate).flatMap(({ value }) => value.evidence),
    invalidatedByEditRevision: null,
  }

  const updated = replaceCandidate(draft, candidate.candidateId, (current) =>
    candidateWithStatus(current, 'confirmed', current.reasonCodes),
  )
  return extractionSuccess({ ...updated, decisions: [...updated.decisions, decision] })
}

export interface RejectRequest {
  readonly candidateId: string
  readonly editRevision: number
  readonly actor: string
  readonly decidedAt: string
  readonly reason: string
}

export function rejectCandidate(
  draft: ExtractionDraft,
  request: RejectRequest,
): ExtractionResult<ExtractionDraft> {
  const common = requireCommon(request)
  if (!common.ok) return common
  if (typeof request.reason !== 'string' || request.reason.trim() === '') {
    return extractionFailure('REASON_REQUIRED', '拒绝候选必须填写理由')
  }
  const candidate = findCandidate(draft, request.candidateId)
  if (!candidate) {
    return extractionFailure('CANDIDATE_NOT_FOUND', `找不到候选 ${request.candidateId}`)
  }
  if (candidate.editRevision !== request.editRevision) {
    return extractionFailure('STALE_EDIT_REVISION', '候选编辑代数已变化，请重新查看原文')
  }
  if (candidate.status === 'rejected') {
    return extractionSuccess(draft)
  }

  const decision: ExtractionDecision = {
    decisionId: stableId('decision', [
      draft.draftId,
      candidate.candidateId,
      candidate.editRevision,
      'reject',
      request.actor,
      request.decidedAt,
    ]),
    candidateId: candidate.candidateId,
    action: 'reject',
    candidateEditRevision: candidate.editRevision,
    decidedAt: request.decidedAt,
    actor: request.actor,
    reason: request.reason,
    valueSnapshot: candidateValueSnapshot(candidate),
    evidence: candidateNumericFields(candidate).flatMap(({ value }) => value.evidence),
    invalidatedByEditRevision: null,
  }

  const updated = replaceCandidate(draft, candidate.candidateId, (current) =>
    candidateWithStatus(current, 'rejected', current.reasonCodes),
  )
  return extractionSuccess({ ...updated, decisions: [...updated.decisions, decision] })
}

export type EditableField =
  | 'nominal'
  | 'upperDeviation'
  | 'lowerDeviation'
  | 'lower'
  | 'upper'
  | 'innerDiameter'
  | 'outerDiameter'
  | 'length'

const RING_FIELDS: readonly EditableField[] = ['nominal', 'upperDeviation', 'lowerDeviation']
const INTERVAL_FIELDS: readonly EditableField[] = ['lower', 'upper']
const PART_FIELDS: readonly EditableField[] = ['innerDiameter', 'outerDiameter', 'length']

function fieldsFor(kind: ExtractionKind): readonly EditableField[] {
  if (kind === 'ring') return RING_FIELDS
  if (kind === 'interval') return INTERVAL_FIELDS
  if (kind === 'part-dimension') return PART_FIELDS
  return []
}

export interface EditRequest {
  readonly candidateId: string
  readonly editRevision: number
  readonly field: EditableField
  readonly text: string
  /** 只接受 mm；其它单位不允许借编辑进入 mm 路径。 */
  readonly unit: 'mm'
  /** 改后值必须有 PDF 对应证据；无依据的人工补值不属于提取候选。 */
  readonly evidence: readonly ExtractionEvidence[]
  readonly actor: string
  readonly decidedAt: string
  readonly reason: string
}

function decimalCount(text: string): number {
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
}

function buildEditedQuantity(request: EditRequest): ExtractionResult<QuantityValue> {
  if (request.unit !== 'mm') {
    return extractionFailure('VALUE_UNSUPPORTED', '编辑只接受 mm，不换算其他单位')
  }
  if (request.evidence.length === 0) {
    return extractionFailure('EVIDENCE_REQUIRED', '改后值必须带 PDF 证据，不能凭空补值')
  }
  if (!request.evidence.every((item) => isEvidenceComplete(item))) {
    return extractionFailure('EVIDENCE_REQUIRED', '改后值的出处不完整（版本/页/选区/原文）')
  }
  const parsed = tryParseMm(request.text)
  if (!parsed.ok) {
    return extractionFailure(
      'VALUE_UNSUPPORTED',
      `数值不合法或超出精度：${parsed.message}`,
    )
  }
  return extractionSuccess({
    text: request.text,
    decimals: decimalCount(request.text),
    valueQ: parsed.value,
    unitText: 'mm',
    unit: 'mm',
    evidence: request.evidence,
  })
}

function withField(
  candidate: ExtractionCandidate,
  field: EditableField,
  value: QuantityValue,
): ExtractionCandidate {
  switch (candidate.kind) {
    case 'ring': {
      if (field === 'nominal') return { ...candidate, data: { ...candidate.data, nominal: value } }
      if (field === 'upperDeviation') {
        return { ...candidate, data: { ...candidate.data, upperDeviation: value } }
      }
      return { ...candidate, data: { ...candidate.data, lowerDeviation: value } }
    }
    case 'interval': {
      if (field === 'lower') return { ...candidate, data: { ...candidate.data, lower: value } }
      return { ...candidate, data: { ...candidate.data, upper: value } }
    }
    case 'part-dimension': {
      if (field === 'innerDiameter') {
        return { ...candidate, data: { ...candidate.data, innerDiameter: value } }
      }
      if (field === 'outerDiameter') {
        return { ...candidate, data: { ...candidate.data, outerDiameter: value } }
      }
      return { ...candidate, data: { ...candidate.data, length: value } }
    }
    default:
      return candidate
  }
}

/**
 * 人工编辑一个数值字段：要求证据、要求 mm、要求可精确转 q。
 * 编辑后候选回到 pending，旧确认决定被标记失效；已拒绝候选不可借编辑复活。
 */
export function editCandidateField(
  draft: ExtractionDraft,
  request: EditRequest,
): ExtractionResult<ExtractionDraft> {
  const common = requireCommon(request)
  if (!common.ok) return common
  if (typeof request.reason !== 'string' || request.reason.trim() === '') {
    return extractionFailure('REASON_REQUIRED', '编辑候选必须填写原因')
  }
  const candidate = findCandidate(draft, request.candidateId)
  if (!candidate) {
    return extractionFailure('CANDIDATE_NOT_FOUND', `找不到候选 ${request.candidateId}`)
  }
  if (candidate.editRevision !== request.editRevision) {
    return extractionFailure('STALE_EDIT_REVISION', '候选编辑代数已变化，请重新查看原文')
  }
  if (candidate.status === 'rejected') {
    return extractionFailure('CANDIDATE_REJECTED', '已拒绝候选不能通过编辑复活')
  }
  if (!fieldsFor(candidate.kind).includes(request.field)) {
    return extractionFailure(
      'FIELD_UNSUPPORTED',
      `候选类型 ${candidate.kind} 不支持字段 ${request.field}`,
    )
  }
  const quantity = buildEditedQuantity(request)
  if (!quantity.ok) return quantity

  const edited = withField(candidate, request.field, quantity.value)
  const nextRevision = candidate.editRevision + 1
  const remaining = candidate.reasonCodes.filter(
    (code) => !VALUE_REASON_CODES.includes(code),
  )
  const nextStatus: CandidateStatus = remaining.length > 0 ? 'blocked' : 'pending'
  const nextCandidate = {
    ...edited,
    editRevision: nextRevision,
    status: nextStatus,
    reasonCodes: remaining,
    confidence: 'medium' as const,
    confidenceBasis: [...candidate.confidenceBasis, 'RULE_MANUAL_EDIT'],
    evidence: [...candidate.evidence, ...request.evidence],
  }

  const decisions = draft.decisions.map((decision) =>
    decision.candidateId === candidate.candidateId &&
    decision.action === 'confirm' &&
    decision.invalidatedByEditRevision === null
      ? { ...decision, invalidatedByEditRevision: nextRevision }
      : decision,
  )
  const editDecision: ExtractionDecision = {
    decisionId: stableId('decision', [
      draft.draftId,
      candidate.candidateId,
      nextRevision,
      'edit',
      request.field,
      request.actor,
      request.decidedAt,
    ]),
    candidateId: candidate.candidateId,
    action: 'edit',
    candidateEditRevision: nextRevision,
    decidedAt: request.decidedAt,
    actor: request.actor,
    reason: request.reason,
    valueSnapshot: candidateValueSnapshot(nextCandidate),
    evidence: request.evidence,
    invalidatedByEditRevision: null,
  }

  return extractionSuccess({
    ...draft,
    draftRevision: draft.draftRevision + 1,
    candidates: draft.candidates.map((item) =>
      item.candidateId === candidate.candidateId ? nextCandidate : item,
    ),
    decisions: [...decisions, editDecision],
  })
}

export interface ApplicationPlanItem {
  readonly candidateId: string
  readonly kind: ExtractionKind
  readonly groupId: string | null
  readonly fields: readonly {
    readonly field: string
    readonly text: string
    readonly valueQ: number | null
    readonly unit: 'mm' | null
  }[]
  readonly evidence: readonly ExtractionEvidence[]
}

export interface ApplicationPlan {
  /** 永远是 false：本模块只产出映射计划，不写项目、不计算。 */
  readonly applied: false
  readonly items: readonly ApplicationPlanItem[]
}

export interface PlanRequest {
  readonly candidateIds: readonly string[]
  /** 调用方声明的来源身份；与草稿不一致即失效。 */
  readonly source: { readonly revisionId: string; readonly sha256: string }
}

/**
 * “送入项目草稿”的计划：只接受逐条确认且决定未失效的候选。
 * M01（去掉人工确认直接写入）就在这里：删除下面的状态/决定检查，未确认候选会进入计划。
 */
export function planApplication(
  draft: ExtractionDraft,
  request: PlanRequest,
): ExtractionResult<ApplicationPlan> {
  if (
    request.source.revisionId !== draft.sourceIdentity.revisionId ||
    request.source.sha256 !== draft.sourceIdentity.sha256
  ) {
    return extractionFailure(
      'SOURCE_STALE',
      '来源 PDF 版本或哈希与草稿不一致，旧确认失效，需按新版本重新提取确认',
    )
  }
  const ids = [...new Set(request.candidateIds)]
  if (ids.length === 0) {
    return extractionFailure('NOT_CONFIRMED', '未选择任何候选，不能生成应用计划')
  }
  const items: ApplicationPlanItem[] = []
  for (const candidateId of ids) {
    const candidate = findCandidate(draft, candidateId)
    if (!candidate) {
      return extractionFailure('CANDIDATE_NOT_FOUND', `找不到候选 ${candidateId}`)
    }
    if (candidate.status !== 'confirmed') {
      return extractionFailure(
        'NOT_CONFIRMED',
        `候选 ${candidateId} 状态为 ${candidate.status}，未经逐条确认不能送入项目草稿`,
      )
    }
    const decision = latestActiveDecision(draft, candidateId)
    if (!decision || decision.candidateEditRevision !== candidate.editRevision) {
      return extractionFailure('STALE_DECISION', `候选 ${candidateId} 的确认已失效，需重新确认`)
    }
    if (decision.valueSnapshot !== candidateValueSnapshot(candidate)) {
      return extractionFailure('STALE_DECISION', `候选 ${candidateId} 的数值在确认后被改动`)
    }
    const missing = evidenceMissing(candidate)
    if (missing) {
      return extractionFailure(
        'EVIDENCE_REQUIRED',
        `候选 ${candidateId} 的字段 ${missing} 缺少完整出处`,
      )
    }
    items.push({
      candidateId: candidate.candidateId,
      kind: candidate.kind,
      groupId: candidate.groupId,
      fields: candidateNumericFields(candidate).map(({ field, value }) => ({
        field,
        text: value.text,
        valueQ: value.valueQ,
        unit: value.unit,
      })),
      evidence: candidate.evidence,
    })
  }
  return extractionSuccess({ applied: false, items })
}

/**
 * 幂等合并：同一 PDF 版本 + 同一规则重复提取不产生重复候选，已有决定不被覆盖。
 * 不同 revision 不混用确认，即使字节一致。
 */
export function mergeExtractionDraft(
  existing: ExtractionDraft,
  incoming: ExtractionDraft,
): ExtractionResult<ExtractionDraft> {
  if (
    existing.sourceIdentity.documentId !== incoming.sourceIdentity.documentId ||
    existing.sourceIdentity.revisionId !== incoming.sourceIdentity.revisionId ||
    existing.sourceIdentity.sha256 !== incoming.sourceIdentity.sha256
  ) {
    return extractionFailure(
      'SOURCE_IDENTITY_MISMATCH',
      '不同 PDF 版本/哈希的提取草稿不能合并确认',
    )
  }
  if (existing.extractorVersion !== incoming.extractorVersion) {
    return extractionFailure(
      'EXTRACTOR_VERSION_MISMATCH',
      '提取规则版本不同，需用户主动重提并展示差异',
    )
  }
  const candidateIds = new Set(existing.candidates.map((candidate) => candidate.candidateId))
  const issueIds = new Set(existing.issues.map((item) => item.issueId))
  const decisionIds = new Set(existing.decisions.map((item) => item.decisionId))
  const newCandidates = incoming.candidates.filter(
    (candidate) => !candidateIds.has(candidate.candidateId),
  )
  const newIssues = incoming.issues.filter((item) => !issueIds.has(item.issueId))
  const newDecisions = incoming.decisions.filter((item) => !decisionIds.has(item.decisionId))
  if (
    newCandidates.length === 0 &&
    newIssues.length === 0 &&
    newDecisions.length === 0
  ) {
    return extractionSuccess(existing)
  }
  const candidates = [...existing.candidates, ...newCandidates].sort((left, right) =>
    left.candidateId.localeCompare(right.candidateId),
  )
  const issues: ExtractionIssue[] = [...existing.issues, ...newIssues]
  return extractionSuccess({
    ...existing,
    draftRevision: existing.draftRevision + 1,
    candidates,
    issues,
    decisions: [...existing.decisions, ...newDecisions],
  })
}
