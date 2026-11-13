/**
 * L2 确认效率：把候选按“能不能批量动作”分组。
 *
 * 只做纯分组与资格判定，不改任何候选/状态/原因码；UI 与度量脚本共用同一实现，
 * 避免界面显示的组别与脚本统计的数字各说一套。
 *
 * 三条硬边界：
 * 1. **组内顺序稳定**：沿用草稿里的候选顺序（parse 已按 页 → 页面自上而下 → 类型 →
 *    candidateId 排序），这里不重新排序，两次打开必然一致。
 * 2. **分组不改判据**：`仅差单位` 只认「状态 blocked + 唯一原因码 UNKNOWN_UNIT +
 *    每个缺单位数值都能按 mm 精确解析」；任一条不满足就不是该组，绝不因为“看起来像”
 *    放进来（批量补单位据此整批拒绝）。
 * 3. **阻塞三类不批量**：FORMULA_UNSUPPORTED / NUMBER_UNSUPPORTED / UNSUPPORTED_UNIT
 *    永远 batch='none'，界面据此不渲染任何批量按钮。
 */
import { tryParseMm } from '../domain/units'
import { candidateReadSources } from '../sources/agentReadDisplay'
import {
  EXTRACTION_REASON_CODES,
  candidateNumericFields,
  type ExtractionCandidate,
  type ExtractionReasonCode,
} from './types'

/** 组键：稳定字符串，用作折叠状态/测试定位，不随界面文案变化。 */
export type ConfirmGroupKey =
  | 'agent-read'
  | 'confirmable:single'
  | 'confirmable:multi'
  | 'blocked-unit:single'
  | 'blocked-unit:multi'
  | 'confirmed'
  | 'rejected'
  | 'stale'
  | `blocked:${ExtractionReasonCode}`

/**
 * 批量能力：
 * - confirm：整组可「全部确认」（组内无同符号多处赋值）；
 * - attest-unit：整组可「批量补单位」（组内每条都“仅差单位”）；
 * - none：不提供任何批量动作（公式/数值/单位不支持，或同符号多处）。
 */
export type BatchCapability = 'confirm' | 'attest-unit' | 'none'

export interface ConfirmGroupSummary {
  readonly key: ConfirmGroupKey
  readonly title: string
  readonly hint: string
  readonly capability: BatchCapability
  readonly candidates: readonly ExtractionCandidate[]
  /** 阻塞组的原因码；可确认/仅差单位组为 null。 */
  readonly reasonCode: ExtractionReasonCode | null
}

export interface ConfirmGrouping {
  /** 固定顺序：可确认单值 → 可确认多处 → 仅差单位单值 → 仅差单位多处 → 阻塞各组。 */
  readonly groups: readonly ConfirmGroupSummary[]
  readonly counts: {
    readonly total: number
    readonly pending: number
    readonly blocked: number
    readonly confirmableSingle: number
    readonly confirmableMulti: number
    readonly unitOnlySingle: number
    readonly unitOnlyMulti: number
    readonly blockedByCode: readonly { readonly code: ExtractionReasonCode; readonly count: number }[]
  }
  /**
   * 必须人工单独决策的条目数（确认范围 = 待确认 58）：
   * 同符号多处赋值组只能人工选一处，**每组算一条**；其余待确认条目都能被批量确认覆盖。
   */
  readonly pendingIndividualDecisions: number
  /**
   * 若对全部“仅差单位”先补单位，之后额外需要的单独决策数（互斥组每组一条）。
   * 单列出来，不混进 `pendingIndividualDecisions`，避免把两段口径混成一个数字。
   */
  readonly afterUnitAttestationIndividualDecisions: number
}

/** 不在批量动作里的三类阻塞（任务卡 §4：按钮不出现，只能补原文或放弃）。 */
export const NO_BATCH_BLOCKED_CODES: readonly ExtractionReasonCode[] = [
  'FORMULA_UNSUPPORTED',
  'NUMBER_UNSUPPORTED',
  'UNSUPPORTED_UNIT',
]

/** 阻塞组的固定展示顺序：三类“只能补原文”在前，其余按原因码表顺序。 */
export function blockedGroupOrder(): readonly ExtractionReasonCode[] {
  const preferred: ExtractionReasonCode[] = [
    ...NO_BATCH_BLOCKED_CODES,
    'UNKNOWN_UNIT',
    'UNIT_CONFLICT',
    'PRECISION_UNSUPPORTED',
    'RANGE_CONFLICT',
    'AMBIGUOUS_ASSIGNMENT',
    'AMBIGUOUS_DEVIATION',
    'DEVIATION_SIGN_MISSING',
    'INCONSISTENT_REDUNDANT_VALUE',
    'FORMULA_UNRESOLVED_OPERAND',
    'FORMULA_CONFLICT',
    'FORMULA_VALUE_CONFLICT',
    'CONFLICT_GROUP_MEMBER',
    'ENDPOINT_SEMANTICS_MISSING',
    'NO_TABLE_HEADER',
    'UNSUPPORTED_TABLE_LAYOUT',
    'SOURCE_UNRESOLVED',
    'SOURCE_PAGE_OUT_OF_RANGE',
    'NO_TEXT_LAYER',
    'PAGE_RANGE_INVALID',
    'PAGE_LIMIT',
  ]
  const rest = EXTRACTION_REASON_CODES.filter((code) => !preferred.includes(code))
  return [...preferred.filter((code) => EXTRACTION_REASON_CODES.includes(code)), ...rest]
}

/** 同符号多处赋值：同 groupId 的 ring 候选多于一条。非 ring/无 groupId 一律不算。 */
export function multiAssignmentMembers(
  candidate: ExtractionCandidate,
  all: readonly ExtractionCandidate[],
): readonly ExtractionCandidate[] {
  if (candidate.kind !== 'ring' || candidate.groupId === null) return []
  const members = all.filter(
    (item) => item.kind === 'ring' && item.groupId === candidate.groupId,
  )
  return members.length > 1 ? members : []
}

/** 某个数值字段是否“只有单位未定”：unit=null 且文本可按 mm 精确解析。 */
function unitPendingField(candidate: ExtractionCandidate): boolean {
  const fields = candidateNumericFields(candidate)
  if (fields.length === 0) return false
  let sawNullUnit = false
  for (const { value } of fields) {
    if (value.unit !== null) continue
    sawNullUnit = true
    if (!tryParseMm(value.text).ok) return false
  }
  return sawNullUnit
}

/**
 * “仅差单位”：结构完整、只缺单位、补了单位就能进入待确认。
 *
 * - 状态必须是 blocked（pending 已经可确认，不属于补单位对象）；
 * - 原因码必须**恰好只有** UNKNOWN_UNIT（多一个 FORMULA_UNSUPPORTED 就不是“仅差”）；
 * - 至少有一个数值字段 unit=null，且所有缺单位字段的原文都能按 mm 精确解析。
 */
export function isUnitOnlyCandidate(candidate: ExtractionCandidate): boolean {
  if (candidate.status !== 'blocked') return false
  if (candidate.reasonCodes.length !== 1 || candidate.reasonCodes[0] !== 'UNKNOWN_UNIT') {
    return false
  }
  return unitPendingField(candidate)
}

function membersOf(candidates: readonly ExtractionCandidate[]): Map<string, ExtractionCandidate[]> {
  const map = new Map<string, ExtractionCandidate[]>()
  for (const candidate of candidates) {
    if (candidate.kind !== 'ring' || candidate.groupId === null) continue
    const list = map.get(candidate.groupId)
    if (list === undefined) map.set(candidate.groupId, [candidate])
    else list.push(candidate)
  }
  return map
}

function isMulti(candidate: ExtractionCandidate, members: Map<string, ExtractionCandidate[]>): boolean {
  if (candidate.kind !== 'ring' || candidate.groupId === null) return false
  return (members.get(candidate.groupId)?.length ?? 0) > 1
}

function blockedPrimaryCode(candidate: ExtractionCandidate): ExtractionReasonCode {
  const order = blockedGroupOrder()
  for (const code of order) {
    if (candidate.reasonCodes.includes(code)) return code
  }
  return candidate.reasonCodes[0] ?? 'SOURCE_UNRESOLVED'
}

/**
 * 分组主入口。**不改变候选顺序**：组内保持草稿原有顺序，组间用固定顺序，
 * 因此同一份草稿两次打开得到完全相同的分组与条目顺序。
 */
export function groupConfirmCandidates(
  candidates: readonly ExtractionCandidate[],
): ConfirmGrouping {
  const members = membersOf(candidates)
  const pendingSingle: ExtractionCandidate[] = []
  const readings: ExtractionCandidate[] = []
  const pendingMulti: ExtractionCandidate[] = []
  const unitSingle: ExtractionCandidate[] = []
  const unitMulti: ExtractionCandidate[] = []
  const blockedBuckets = new Map<ExtractionReasonCode, ExtractionCandidate[]>()
  const confirmed: ExtractionCandidate[] = []
  const rejected: ExtractionCandidate[] = []
  const stale: ExtractionCandidate[] = []
  let pending = 0
  let blocked = 0

  for (const candidate of candidates) {
    if (candidateReadSources(candidate).length > 0) {
      readings.push(candidate)
      if (candidate.status === 'pending') pending += 1
      if (candidate.status === 'blocked') blocked += 1
      continue
    }
    if (candidate.status === 'pending') {
      pending += 1
      if (isMulti(candidate, members)) pendingMulti.push(candidate)
      else pendingSingle.push(candidate)
      continue
    }
    if (candidate.status === 'confirmed') {
      confirmed.push(candidate)
      continue
    }
    if (candidate.status === 'rejected') {
      rejected.push(candidate)
      continue
    }
    if (candidate.status === 'stale') {
      stale.push(candidate)
      continue
    }
    blocked += 1
    if (isUnitOnlyCandidate(candidate)) {
      if (isMulti(candidate, members)) unitMulti.push(candidate)
      else unitSingle.push(candidate)
      continue
    }
    const code = blockedPrimaryCode(candidate)
    const list = blockedBuckets.get(code)
    if (list === undefined) blockedBuckets.set(code, [candidate])
    else list.push(candidate)
  }

  const groups: ConfirmGroupSummary[] = []
  if (readings.length > 0) {
    groups.push({
      key: 'agent-read',
      title: `读数未核对 · ${readings.length}`,
      hint: '外部提供的读数必须对照来源逐条核对、逐条确认；不提供批量确认。',
      capability: 'none',
      candidates: readings,
      reasonCode: null,
    })
  }
  if (pendingSingle.length > 0) {
    groups.push({
      key: 'confirmable:single',
      title: `可确认 · 单值 ${pendingSingle.length}`,
      hint: '结构完整、出处齐全、无同符号多处赋值：可整组确认（每条仍逐条落盘）。',
      capability: 'confirm',
      candidates: pendingSingle,
      reasonCode: null,
    })
  }
  if (pendingMulti.length > 0) {
    groups.push({
      key: 'confirmable:multi',
      title: `可确认 · 同符号多处 ${pendingMulti.length}`,
      hint: '同一符号多处赋值只能确认一处：不提供批量确认，请人工逐组选一处。',
      capability: 'none',
      candidates: pendingMulti,
      reasonCode: null,
    })
  }
  if (unitSingle.length > 0) {
    groups.push({
      key: 'blocked-unit:single',
      title: `仅差单位 · 单值 ${unitSingle.length}`,
      hint: '结构完整、只缺单位：给出一句单位声明后可整批补（逐条记 user-attestation）。',
      capability: 'attest-unit',
      candidates: unitSingle,
      reasonCode: 'UNKNOWN_UNIT',
    })
  }
  if (unitMulti.length > 0) {
    groups.push({
      key: 'blocked-unit:multi',
      title: `仅差单位 · 同符号多处 ${unitMulti.length}`,
      hint: '可整批补单位；补完仍要人工在每组里选一处确认（互斥不放松）。',
      capability: 'attest-unit',
      candidates: unitMulti,
      reasonCode: 'UNKNOWN_UNIT',
    })
  }
  const blockedByCode: { code: ExtractionReasonCode; count: number }[] = []
  for (const code of blockedGroupOrder()) {
    const list = blockedBuckets.get(code)
    if (list === undefined) continue
    blockedBuckets.delete(code)
    blockedByCode.push({ code, count: list.length })
    groups.push({
      key: `blocked:${code}`,
      title: `阻塞 · ${code} ${list.length}`,
      hint: NO_BATCH_BLOCKED_CODES.includes(code)
        ? '这类只能补原文或放弃：不提供任何批量动作（一键忽略不是确认）。'
        : '阻塞候选不能确认：先补原文/修正来源，再逐条复核。',
      capability: 'none',
      candidates: list,
      reasonCode: code,
    })
  }
  // 理论上 blockedGroupOrder 覆盖全部原因码；兜底防止新码漏组（仍保持确定性）。
  for (const [code, list] of blockedBuckets) {
    blockedByCode.push({ code, count: list.length })
    groups.push({
      key: `blocked:${code}`,
      title: `阻塞 · ${code} ${list.length}`,
      hint: '阻塞候选不能确认：先补原文/修正来源，再逐条复核。',
      capability: 'none',
      candidates: list,
      reasonCode: code,
    })
  }

  // 已决定/失效候选：不参与批量动作，但必须仍可见（不因分组把已确认结果藏掉）。
  for (const [key, list, title, hint] of [
    ['confirmed', confirmed, `已确认 ${confirmed.length}`, '已确认的候选可逐条撤销；批量动作不会碰它们。'],
    ['rejected', rejected, `已拒绝 ${rejected.length}`, '已拒绝的候选不会复活，也不进入项目。'],
    ['stale', stale, `已失效 ${stale.length}`, '来源或规则变化导致失效：需按新版本重新提取确认。'],
  ] as const) {
    if (list.length === 0) continue
    groups.push({
      key,
      title,
      hint,
      capability: 'none',
      candidates: list,
      reasonCode: null,
    })
  }

  const multiGroups = new Set<string>()
  for (const candidate of pendingMulti) {
    if (candidate.groupId !== null) multiGroups.add(candidate.groupId)
  }
  const unitMultiGroups = new Set<string>()
  for (const candidate of unitMulti) {
    if (candidate.groupId !== null) unitMultiGroups.add(candidate.groupId)
  }

  return {
    groups,
    counts: {
      total: candidates.length,
      pending,
      blocked,
      confirmableSingle: pendingSingle.length,
      confirmableMulti: pendingMulti.length,
      unitOnlySingle: unitSingle.length,
      unitOnlyMulti: unitMulti.length,
      blockedByCode,
    },
    pendingIndividualDecisions: multiGroups.size + readings.filter((item) => item.status === 'pending').length,
    afterUnitAttestationIndividualDecisions: unitMultiGroups.size,
  }
}

/** 组内可批量确认的 id（仅 confirm 能力组）；其它组返回空数组。 */
export function batchConfirmCandidateIds(group: ConfirmGroupSummary): readonly string[] {
  if (group.capability !== 'confirm') return []
  return group.candidates
    .filter((candidate) => candidate.status === 'pending' && candidateReadSources(candidate).length === 0)
    .map((candidate) => candidate.candidateId)
}

/** 组内可批量补单位的 id（仅 attest-unit 能力组）。 */
export function batchUnitCandidateIds(group: ConfirmGroupSummary): readonly string[] {
  if (group.capability !== 'attest-unit') return []
  return group.candidates
    .filter((candidate) => isUnitOnlyCandidate(candidate))
    .map((candidate) => candidate.candidateId)
}
