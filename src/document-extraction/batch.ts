/**
 * L2 确认效率：批量动作的领域实现（纯函数，无 IO）。
 *
 * 三个批量动作，共同边界：
 * 1. **原子**：先校验整批，任一条不合格 → 返回失败，调用方拿到的草稿一字不变
 *    （“整批拒绝并指出哪几条”）；全部合格才一次替换。
 * 2. **逐条落盘**：批量确认/补单位都按候选各写一条决定（各自的 decisionId、
 *    编辑代数、出处、快照），不合并成一条，也不写“批量通过”这种汇总决定。
 * 3. **不放宽判据**：确认仍走 `confirmCandidate`（出处完整性、同符号互斥、编辑代数
 *    全部照旧）；补单位只改单位字段与出处，不改数值文本、不改阻塞判据。
 *
 * 批量动作**不是**一键忽略：它只覆盖
 * - 可确认组里的单值候选（confirm），
 * - 阻塞里“仅差单位”的候选（attest-unit，补完仍需确认）。
 * 公式/数值/单位不支持与同符号多处赋值组，本模块拒绝批量（见 confirmGroups.ts）。
 */
import { tryParseMm } from '../domain/units'
import { parseUnitStatement } from './unitScope'
import { stableId } from './ids'
import {
  candidateNumericFields,
  candidateProvenance,
  candidateValueSnapshot,
  extractionFailure,
  extractionSuccess,
  isProvenanceCompleteness,
  provenanceKey,
  revokeAttestation,
  uniqueProvenance,
  valueProvenance,
  type EvidenceRef,
  type ExtractionCandidate,
  type ExtractionDecision,
  type ExtractionDraft,
  type ExtractionEvidence,
  type ExtractionResult,
  type QuantityValue,
  type UserAttestation,
} from './types'
import { confirmCandidate, findCandidate } from './draft'
import { isUnitOnlyCandidate, multiAssignmentMembers } from './confirmGroups'

const UNIT_ATTESTATION_BASIS = 'RULE_UNIT_ATTESTED_BY_USER'

function requireCommon(request: { actor: string; decidedAt: string }): ExtractionResult<true> {
  if (typeof request.actor !== 'string' || request.actor.trim() === '') {
    return extractionFailure('ACTOR_REQUIRED', '缺少本地操作身份，不能记录批量动作')
  }
  if (typeof request.decidedAt !== 'string' || request.decidedAt.trim() === '') {
    return extractionFailure('DECIDED_AT_REQUIRED', '缺少决定时间')
  }
  return extractionSuccess(true)
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}

function label(candidate: ExtractionCandidate): string {
  const symbol =
    candidate.kind === 'ring'
      ? candidate.data.symbol
      : candidate.kind === 'interval'
        ? candidate.data.outputSymbol
        : candidate.kind === 'formula'
          ? candidate.data.outputSymbol
          : candidate.data.partName
  const occurrence = candidate.occurrence
  const where = occurrence === null || occurrence === undefined
    ? ''
    : `（第 ${occurrence.index}/${occurrence.total} 处）`
  return `${candidate.candidateId}${symbol === null ? '' : ` ${symbol}`}${where}`
}

/** 候选当前全部数值字段的出处是否齐全（逐条过唯一判据）。 */
function provenanceMissing(candidate: ExtractionCandidate): string | null {
  for (const { field, value } of candidateNumericFields(candidate)) {
    const refs = valueProvenance(value)
    if (refs.length === 0) return field
    for (const ref of refs) {
      if (!isProvenanceCompleteness(ref)) return field
    }
  }
  if (candidate.kind === 'formula') {
    const refs = candidateProvenance(candidate)
    if (refs.length === 0) return 'expression'
    for (const ref of refs) {
      if (!isProvenanceCompleteness(ref)) return 'expression'
    }
  }
  return null
}

function pdfEvidenceOf(candidate: ExtractionCandidate): ExtractionEvidence[] {
  const seen = new Set<string>()
  const out: ExtractionEvidence[] = []
  for (const item of [
    ...candidate.evidence,
    ...candidateNumericFields(candidate).flatMap(({ value }) => value.evidence),
  ]) {
    const key = `${item.revisionId}#${item.page}#${item.rectPdf.join(',')}#${item.textSnippet}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function allRefs(candidate: ExtractionCandidate): EvidenceRef[] {
  return [
    ...candidateNumericFields(candidate).flatMap(({ value }) => [...valueProvenance(value)]),
    ...candidateProvenance(candidate),
  ]
}

// ---------------------------------------------------------------- 批量确认

export interface ConfirmBatchRequest {
  readonly candidateIds: readonly string[]
  readonly actor: string
  readonly decidedAt: string
  readonly reason?: string
}

export interface ConfirmBatchValue {
  readonly draft: ExtractionDraft
  readonly candidateIds: readonly string[]
  readonly decisionIds: readonly string[]
}

/**
 * 批量确认（同组可全确认）。
 *
 * **同符号多处赋值组整批拒绝**：只要选中任一条属于“同一符号多处赋值”的候选，
 * 整批不执行并列出该符号的所有候选——不会替用户挑一条、也不会确认两条。
 * 单值候选逐条走 `confirmCandidate`（出处/互斥/编辑代数判据与单条确认完全一致）。
 */
export function confirmCandidateBatch(
  draft: ExtractionDraft,
  request: ConfirmBatchRequest,
): ExtractionResult<ConfirmBatchValue> {
  const common = requireCommon(request)
  if (!common.ok) return common
  const ids = uniqueIds(request.candidateIds)
  if (ids.length === 0) {
    return extractionFailure('NOT_CONFIRMED', '未选择任何候选，不能批量确认')
  }

  const invalid: string[] = []
  const multiGroups = new Map<string, ExtractionCandidate[]>()
  for (const candidateId of ids) {
    const candidate = findCandidate(draft, candidateId)
    if (candidate === null) {
      invalid.push(`${candidateId}（不存在）`)
      continue
    }
    if (candidate.status !== 'pending') {
      invalid.push(`${label(candidate)}（状态 ${candidate.status}，批量确认只对“可确认”组开放）`)
      continue
    }
    const missing = provenanceMissing(candidate)
    if (missing !== null) {
      invalid.push(`${label(candidate)}（字段 ${missing} 出处不完整）`)
      continue
    }
    const members = multiAssignmentMembers(candidate, draft.candidates)
    if (members.length > 1 && candidate.groupId !== null) {
      const list = multiGroups.get(candidate.groupId) ?? []
      list.push(candidate)
      multiGroups.set(candidate.groupId, list)
    }
  }
  if (invalid.length > 0) {
    return extractionFailure(
      'BATCH_NOT_ELIGIBLE',
      `以下候选不能批量确认，整批未执行（0 条写入）：${invalid.join('、')}`,
    )
  }
  if (multiGroups.size > 0) {
    const lines = [...multiGroups.entries()]
      .map(([groupId, list]) => {
        const symbol = groupId.replace(/^ring:/u, '')
        return `${symbol}（${list.map((candidate) => label(candidate)).join('、')}）`
      })
      .join('；')
    return extractionFailure(
      'GROUP_ALREADY_CONFIRMED',
      `同一符号多处赋值只能确认一处，批量确认不适用于这些组，整批未执行（0 条写入）：${lines}`,
    )
  }

  let current = draft
  const decisionIds: string[] = []
  for (const candidateId of ids) {
    const candidate = findCandidate(current, candidateId)
    if (candidate === null) {
      return extractionFailure('CANDIDATE_NOT_FOUND', `找不到候选 ${candidateId}`)
    }
    const confirmed = confirmCandidate(current, {
      candidateId,
      editRevision: candidate.editRevision,
      confirmed: true,
      actor: request.actor,
      decidedAt: request.decidedAt,
      ...(request.reason === undefined ? {} : { reason: request.reason }),
    })
    if (!confirmed.ok) return confirmed
    current = confirmed.value
    const decision = current.decisions
      .filter((item) => item.candidateId === candidateId && item.action === 'confirm')
      .at(-1)
    if (decision !== undefined) decisionIds.push(decision.decisionId)
  }
  return extractionSuccess({ draft: current, candidateIds: ids, decisionIds })
}

// ---------------------------------------------------------------- 批量补单位

export interface AttestUnitsRequest {
  readonly candidateIds: readonly string[]
  /** 用户给出的单位声明，逐字保存进 user-attestation.statement。 */
  readonly statement: string
  readonly actor: string
  readonly decidedAt: string
  readonly sessionSeq: number
  readonly sessionLabel?: string | null
  /**
   * 哪一轮输入说的（由 main 生成，renderer/模型不能提供）。
   * 提取面板的一次提交就是一轮输入；旧断言没有该字段按 null 读，新断言必须带上。
   */
  readonly turnId: string
}

export interface AttestUnitsValue {
  readonly draft: ExtractionDraft
  readonly batchId: string
  readonly candidateIds: readonly string[]
  readonly decisionIds: readonly string[]
  /** 批量补单位覆盖的单位原文（来自声明，逐字）。 */
  readonly unitText: string
  /** 本批写入的 user-attestation（与草稿内的引用内容相同，供项目账本留档）。 */
  readonly attestations: readonly UserAttestation[]
}

function fieldPathOf(candidateId: string): string {
  return `candidate:${candidateId}:unit`
}

function assertMmStatement(
  statement: string,
): ExtractionResult<{ unitText: string }> {
  if (typeof statement !== 'string' || statement.trim() === '') {
    return extractionFailure('UNIT_STATEMENT_INVALID', '批量补单位必须填写一句单位声明（例：本表单位 mm）')
  }
  const parsed = parseUnitStatement(statement)
  if (parsed.status === 'none') {
    return extractionFailure(
      'UNIT_STATEMENT_INVALID',
      `单位声明里没有可识别的单位写法（只认「单位：mm」「Units: mm」这类显式写法）：${statement}`,
    )
  }
  if (parsed.status === 'conflict') {
    return extractionFailure(
      'UNIT_STATEMENT_INVALID',
      `单位声明里出现互相矛盾的单位（${parsed.tokens.join(' / ')}），不能整批采用：${statement}`,
    )
  }
  if (parsed.unit === null || parsed.unit.kind !== 'mm') {
    return extractionFailure(
      'UNIT_STATEMENT_INVALID',
      `单位声明不是 mm（当前只支持毫米，不做换算）：${statement}`,
    )
  }
  return extractionSuccess({ unitText: parsed.unit.text ?? 'mm' })
}

/**
 * 批量补单位（只对“仅差单位”开放）。
 *
 * - 任一条不是“仅差单位”（状态/原因码/数值可解析/原出处完整任一不满足）→ 整批拒绝，
 *   message 逐条指出不合格的候选，草稿不改；
 * - 合格时给每个数值字段追加一条 user-attestation（statement 逐字保存），
 *   单位改成 mm、valueQ 按原文十进制精确计算（不换算、不改数值文本）；
 * - 每条候选各写一条 `attest-unit` 决定（共享 batchId），**不是确认**：
 *   补完还会停在待确认，仍要逐条/逐组确认。
 */
export function attestCandidateUnits(
  draft: ExtractionDraft,
  request: AttestUnitsRequest,
): ExtractionResult<AttestUnitsValue> {
  const common = requireCommon(request)
  if (!common.ok) return common
  if (!Number.isSafeInteger(request.sessionSeq) || request.sessionSeq < 1) {
    return extractionFailure('ATTESTATION_SESSION_MISMATCH', '批量补单位必须带当前输入会话序号（第几次输入）')
  }
  if (typeof request.turnId !== 'string' || request.turnId.trim() === '') {
    return extractionFailure('ATTESTATION_TURN_REQUIRED', '批量补单位必须绑定当前输入轮次（turnId），不能为空')
  }
  const statement = request.statement
  if (typeof statement !== 'string' || statement.trim() === '') {
    return extractionFailure('UNIT_STATEMENT_INVALID', '批量补单位必须填写一句单位声明（例：本表单位 mm）')
  }
  const unit = assertMmStatement(statement)
  if (!unit.ok) return unit
  const ids = uniqueIds(request.candidateIds)
  if (ids.length === 0) {
    return extractionFailure('NOT_CONFIRMED', '未选择任何候选，不能批量补单位')
  }

  const ineligible: string[] = []
  for (const candidateId of ids) {
    const candidate = findCandidate(draft, candidateId)
    if (candidate === null) {
      ineligible.push(`${candidateId}（不存在）`)
      continue
    }
    if (!isUnitOnlyCandidate(candidate)) {
      ineligible.push(
        `${label(candidate)}（状态 ${candidate.status}，原因码 ${candidate.reasonCodes.join('+') || '无'}，不是“仅差单位”）`,
      )
      continue
    }
    const missing = provenanceMissing(candidate)
    if (missing !== null) {
      ineligible.push(`${label(candidate)}（字段 ${missing} 原出处不完整）`)
    }
  }
  if (ineligible.length > 0) {
    return extractionFailure(
      'BATCH_NOT_ELIGIBLE',
      `以下候选不是“仅差单位”，整批未执行（0 条写入）：${ineligible.join('、')}`,
    )
  }

  const batchId = stableId('unit-batch', [
    draft.draftId,
    statement,
    request.actor,
    request.decidedAt,
    ...ids,
  ])
  let current = draft
  const decisionIds: string[] = []
  const attestations: UserAttestation[] = []

  for (const candidateId of ids) {
    const candidate = findCandidate(current, candidateId)
    if (candidate === null) {
      return extractionFailure('CANDIDATE_NOT_FOUND', `找不到候选 ${candidateId}`)
    }
    const attestation: UserAttestation = {
      kind: 'user-attestation',
      actorId: request.actor,
      at: request.decidedAt,
      sessionSeq: request.sessionSeq,
      sessionLabel: request.sessionLabel ?? null,
      turnId: request.turnId,
      statement,
      fieldPath: fieldPathOf(candidateId),
    }
    if (!isProvenanceCompleteness(attestation)) {
      return extractionFailure('EVIDENCE_REQUIRED', '用户单位声明本身不完整，不能作为出处')
    }

    const nextRevision = candidate.editRevision + 1
    const withUnit = (value: QuantityValue): QuantityValue => {
      if (value.unit !== null) return value
      const parsed = tryParseMm(value.text)
      if (!parsed.ok) {
        // 资格校验已排除；这里只做防御，绝不写半截值。
        throw new Error(`数值 ${value.text} 不能按 mm 解析：${parsed.message}`)
      }
      return {
        ...value,
        unit: 'mm',
        unitText: unit.value.unitText,
        valueQ: parsed.value,
        provenance: uniqueProvenance([...valueProvenance(value), attestation]),
      }
    }

    let nextCandidate: ExtractionCandidate
    try {
      if (candidate.kind === 'ring') {
        const data = {
          ...candidate.data,
          nominal: candidate.data.nominal === null ? null : withUnit(candidate.data.nominal),
          upperDeviation:
            candidate.data.upperDeviation === null ? null : withUnit(candidate.data.upperDeviation),
          lowerDeviation:
            candidate.data.lowerDeviation === null ? null : withUnit(candidate.data.lowerDeviation),
        }
        nextCandidate = { ...candidate, data }
      } else if (candidate.kind === 'interval') {
        const data = {
          ...candidate.data,
          lower: candidate.data.lower === null ? null : withUnit(candidate.data.lower),
          upper: candidate.data.upper === null ? null : withUnit(candidate.data.upper),
        }
        nextCandidate = { ...candidate, data }
      } else if (candidate.kind === 'part-dimension') {
        const data = {
          ...candidate.data,
          innerDiameter:
            candidate.data.innerDiameter === null ? null : withUnit(candidate.data.innerDiameter),
          outerDiameter:
            candidate.data.outerDiameter === null ? null : withUnit(candidate.data.outerDiameter),
          length: candidate.data.length === null ? null : withUnit(candidate.data.length),
        }
        nextCandidate = { ...candidate, data }
      } else {
        throw new Error('公式候选没有数值字段，不能补单位')
      }
    } catch (error) {
      return extractionFailure(
        'BATCH_NOT_ELIGIBLE',
        `候选 ${candidateId} 补单位失败，整批未执行：${error instanceof Error ? error.message : String(error)}`,
      )
    }

    // 补单位后出处必须齐全：新 user-attestation 真的挂在每个缺单位数值上，
    // 才能把候选从 blocked 转 pending。缺一项就整批拒绝，绝不“先转状态再补证据”。
    const stillMissing = provenanceMissing(nextCandidate)
    if (stillMissing !== null) {
      return extractionFailure(
        'EVIDENCE_REQUIRED',
        `候选 ${candidateId} 补单位后出处仍不完整（字段 ${stillMissing}），整批未执行（0 条写入）`,
      )
    }

    const reasonCodes = nextCandidate.reasonCodes.filter((code) => code !== 'UNKNOWN_UNIT')
    nextCandidate = {
      ...nextCandidate,
      editRevision: nextRevision,
      status: reasonCodes.length > 0 ? 'blocked' : 'pending',
      reasonCodes,
      confidence: 'medium',
      confidenceBasis: [...nextCandidate.confidenceBasis, UNIT_ATTESTATION_BASIS],
    }

    const decision: ExtractionDecision = {
      decisionId: stableId('decision', [
        current.draftId,
        candidateId,
        nextRevision,
        'attest-unit',
        request.actor,
        request.decidedAt,
        batchId,
      ]),
      candidateId,
      action: 'attest-unit',
      candidateEditRevision: nextRevision,
      decidedAt: request.decidedAt,
      actor: request.actor,
      reason: statement,
      valueSnapshot: candidateValueSnapshot(nextCandidate),
      evidence: pdfEvidenceOf(nextCandidate),
      provenance: uniqueProvenance([...allRefs(nextCandidate), attestation]),
      batchId,
      invalidatedByEditRevision: null,
    }

    current = {
      ...current,
      draftRevision: current.draftRevision + 1,
      candidates: current.candidates.map((item) =>
        item.candidateId === candidateId ? nextCandidate : item,
      ),
      decisions: [...current.decisions, decision],
    }
    decisionIds.push(decision.decisionId)
    attestations.push(attestation)
  }

  return extractionSuccess({
    draft: current,
    batchId,
    candidateIds: ids,
    decisionIds,
    unitText: unit.value.unitText,
    attestations,
  })
}

// ---------------------------------------------------------------- 撤销补单位

export interface RevokeUnitsRequest {
  /** 按批次撤销（整批）。与 candidateId 二选一。 */
  readonly batchId?: string | null
  /** 按候选逐条撤销。与 batchId 二选一。 */
  readonly candidateId?: string | null
  readonly actor: string
  readonly decidedAt: string
  readonly reason?: string
}

export interface RevokeUnitsValue {
  readonly draft: ExtractionDraft
  readonly candidateIds: readonly string[]
  readonly decisionIds: readonly string[]
}

/** 某个候选仍有效的“补单位”决定（按批次或单条定位）。 */
export function activeUnitAttestation(
  draft: ExtractionDraft,
  selector: { candidateId?: string | null; batchId?: string | null },
): ExtractionDecision | null {
  const wanted = draft.decisions.filter(
    (decision) =>
      decision.action === 'attest-unit' &&
      decision.invalidatedByEditRevision === null &&
      (selector.candidateId === undefined || selector.candidateId === null
        ? true
        : decision.candidateId === selector.candidateId) &&
      (selector.batchId === undefined || selector.batchId === null
        ? true
        : decision.batchId === selector.batchId),
  )
  return wanted.at(-1) ?? null
}

export interface UnitBatchSummary {
  readonly batchId: string
  readonly statement: string
  readonly decidedAt: string
  readonly candidateIds: readonly string[]
}

/** 仍有效的补单位批次（供界面“整批撤销”）。按写入顺序返回。 */
export function activeUnitBatches(draft: ExtractionDraft): UnitBatchSummary[] {
  const map = new Map<string, UnitBatchSummary>()
  for (const decision of draft.decisions) {
    if (decision.action !== 'attest-unit') continue
    if (decision.invalidatedByEditRevision !== null) continue
    const batchId = decision.batchId ?? null
    if (batchId === null) continue
    const existing = map.get(batchId)
    if (existing === undefined) {
      map.set(batchId, {
        batchId,
        statement: decision.reason ?? '',
        decidedAt: decision.decidedAt,
        candidateIds: [decision.candidateId],
      })
    } else {
      map.set(batchId, { ...existing, candidateIds: [...existing.candidateIds, decision.candidateId] })
    }
  }
  return [...map.values()]
}

function attestationMatches(candidateId: string, ref: EvidenceRef): boolean {
  if (ref.kind !== 'user-attestation') return false
  return ref.fieldPath === fieldPathOf(candidateId) && (ref.revokedAt ?? null) === null
}

/**
 * 撤销补单位：整批（batchId）或逐条（candidateId）。
 *
 * - 只撤销**仍有效**的补单位决定；撤销后单位回到未定、候选回到 blocked(UNKNOWN_UNIT)；
 * - 出处不删除：把 user-attestation 标记为显式撤销（revokedAt/revokedBy），原文保留；
 * - 目标候选若已有有效确认 → 整批拒绝（先撤销确认），不做半撤销；
 * - 每条被撤销候选追加一条 `revoke` 决定留痕，旧 attest-unit 决定置失效。
 */
export function revokeUnitAttestations(
  draft: ExtractionDraft,
  request: RevokeUnitsRequest,
): ExtractionResult<RevokeUnitsValue> {
  const common = requireCommon(request)
  if (!common.ok) return common
  const hasBatch = typeof request.batchId === 'string' && request.batchId.trim() !== ''
  const hasCandidate = typeof request.candidateId === 'string' && request.candidateId.trim() !== ''
  if (hasBatch === hasCandidate) {
    return extractionFailure('ATTESTATION_NOT_FOUND', '撤销补单位必须且只能给出 batchId 或 candidateId 之一')
  }
  const targets = draft.decisions.filter(
    (decision) =>
      decision.action === 'attest-unit' &&
      decision.invalidatedByEditRevision === null &&
      (hasBatch ? decision.batchId === request.batchId : decision.candidateId === request.candidateId),
  )
  if (targets.length === 0) {
    return extractionFailure(
      'ATTESTATION_NOT_FOUND',
      hasBatch ? `找不到仍有效的补单位批次 ${request.batchId}` : `候选 ${request.candidateId} 没有仍有效的补单位决定`,
    )
  }
  const confirmed = targets
    .map((decision) => findCandidate(draft, decision.candidateId))
    .filter((candidate): candidate is ExtractionCandidate => candidate !== null)
    .filter(
      (candidate) =>
        candidate.status === 'confirmed' &&
        draft.decisions.some(
          (decision) =>
            decision.candidateId === candidate.candidateId &&
            decision.action === 'confirm' &&
            decision.invalidatedByEditRevision === null,
        ),
    )
  if (confirmed.length > 0) {
    return extractionFailure(
      'ATTESTATION_CONFIRMED',
      `以下候选已确认，撤销单位会破坏确认依据；请先撤销确认，整批未执行：${confirmed.map((candidate) => label(candidate)).join('、')}`,
    )
  }

  let current = draft
  const decisionIds: string[] = []
  for (const target of targets) {
    const candidate = findCandidate(current, target.candidateId)
    if (candidate === null) continue
    const batchId = target.batchId ?? null
    const reason = `撤销单位声明：${target.reason ?? ''}`
    const nextRevision = candidate.editRevision + 1
    const revokeInfo = {
      by: request.actor,
      at: request.decidedAt,
      statement: request.reason ?? '撤销批量补单位',
    }
    const revert = (value: QuantityValue): QuantityValue => {
      const refs = valueProvenance(value)
      if (!refs.some((ref) => attestationMatches(candidate.candidateId, ref))) return value
      return {
        ...value,
        unit: null,
        unitText: null,
        valueQ: null,
        provenance: refs.map((ref) =>
          attestationMatches(candidate.candidateId, ref)
            ? revokeAttestation(ref as UserAttestation, revokeInfo)
            : ref,
        ),
      }
    }

    let nextCandidate: ExtractionCandidate
    if (candidate.kind === 'ring') {
      nextCandidate = {
        ...candidate,
        data: {
          ...candidate.data,
          nominal: candidate.data.nominal === null ? null : revert(candidate.data.nominal),
          upperDeviation:
            candidate.data.upperDeviation === null ? null : revert(candidate.data.upperDeviation),
          lowerDeviation:
            candidate.data.lowerDeviation === null ? null : revert(candidate.data.lowerDeviation),
        },
      }
    } else if (candidate.kind === 'interval') {
      nextCandidate = {
        ...candidate,
        data: {
          ...candidate.data,
          lower: candidate.data.lower === null ? null : revert(candidate.data.lower),
          upper: candidate.data.upper === null ? null : revert(candidate.data.upper),
        },
      }
    } else if (candidate.kind === 'part-dimension') {
      nextCandidate = {
        ...candidate,
        data: {
          ...candidate.data,
          innerDiameter:
            candidate.data.innerDiameter === null ? null : revert(candidate.data.innerDiameter),
          outerDiameter:
            candidate.data.outerDiameter === null ? null : revert(candidate.data.outerDiameter),
          length: candidate.data.length === null ? null : revert(candidate.data.length),
        },
      }
    } else {
      continue
    }

    nextCandidate = {
      ...nextCandidate,
      editRevision: nextRevision,
      status: 'blocked',
      reasonCodes: [...new Set([...nextCandidate.reasonCodes, 'UNKNOWN_UNIT' as const])],
      confidenceBasis: [...nextCandidate.confidenceBasis, 'RULE_UNIT_ATTESTATION_REVOKED'],
    }

    const decision: ExtractionDecision = {
      decisionId: stableId('decision', [
        current.draftId,
        candidate.candidateId,
        nextRevision,
        'revoke',
        request.actor,
        request.decidedAt,
        batchId ?? 'single',
      ]),
      candidateId: candidate.candidateId,
      action: 'revoke',
      candidateEditRevision: nextRevision,
      decidedAt: request.decidedAt,
      actor: request.actor,
      reason,
      valueSnapshot: candidateValueSnapshot(nextCandidate),
      evidence: pdfEvidenceOf(nextCandidate),
      provenance: uniqueProvenance(allRefs(nextCandidate)),
      batchId,
      invalidatedByEditRevision: null,
    }

    current = {
      ...current,
      draftRevision: current.draftRevision + 1,
      candidates: current.candidates.map((item) =>
        item.candidateId === candidate.candidateId ? nextCandidate : item,
      ),
      decisions: current.decisions.map((item) =>
        item.decisionId === target.decisionId
          ? { ...item, invalidatedByEditRevision: nextRevision }
          : item,
      ).concat(decision),
    }
    decisionIds.push(decision.decisionId)
  }

  return extractionSuccess({
    draft: current,
    candidateIds: targets.map((decision) => decision.candidateId),
    decisionIds,
  })
}

/** 供测试断言：出处里是否还有有效（未撤销）的补单位断言。 */
export function hasActiveUnitAttestation(candidate: ExtractionCandidate): boolean {
  return unitAttestationOf(candidate) !== null
}

/**
 * 取候选身上仍有效（未撤销）的补单位断言，供界面显示「单位来源：用户声明」+ 原话。
 * 只读，不改判据；没有就返回 null（不伪装成从原文读到的单位）。
 */
export function unitAttestationOf(candidate: ExtractionCandidate): UserAttestation | null {
  for (const { value } of candidateNumericFields(candidate)) {
    for (const ref of valueProvenance(value)) {
      if (
        ref.kind === 'user-attestation' &&
        ref.fieldPath === fieldPathOf(candidate.candidateId) &&
        (ref.revokedAt ?? null) === null
      ) {
        return ref
      }
    }
  }
  return null
}

/** 供界面显示：一批补单位决定里语句/时间的身份键（不参与校验）。 */
export function unitBatchKey(batchId: string): string {
  return `unit-batch:${batchId}`
}

/** provenanceKey 的唯一性检查（测试用；保证同一批断言不会因键相同被去重掉）。 */
export function attestationKey(ref: EvidenceRef): string {
  return provenanceKey(ref)
}
