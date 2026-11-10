/**
 * D 派生状态选择器（唯一结论来源）。
 *
 * 本模块不读、也不写任何“已确认”布尔：
 * - 参数绑定是否有效 = 最新完整确认事件与当前 parameterRevision / termRevision /
 *   drawingFingerprint / 来源基准 / nominal 值全部匹配；
 * - 关系待核 = 既有 isRelationConfirmed / isRelationReviewStale；
 * - 来源、计算、材料分别独立派生，互不掩盖。
 *
 * 存储字段与派生状态的对照见 docs/evidence/V3-D/derived-status.md。
 */
import { calculateChain } from '../domain/calculate'
import type { ChainDefinition, ChainResult } from '../domain/types'
import type { ChangeEvent } from '../history/events'
import { SPACER_PARAMETER_LABELS } from '../drawing/types'
import type {
  ProjectFileParameterBindingLink,
  ProjectFileProject,
  ProjectFileSpacerParameter,
} from '../project-file/types'
import {
  REVIEW_RULES_VERSION,
  evaluateReviewChecklist,
  type ReviewFinding,
  type ReviewSummary,
} from '../review/rules'
import { isRelationConfirmed, isRelationReviewStale } from '../workspace/relation'
import type { ChangeComputation } from './types'

export type ParameterBindingState = 'valid' | 'pending' | 'unlinked'

export interface ParameterBindingStatusRow {
  bindingId: string
  termId: string
  termSymbol: string
  parameterId: string
  parameterLabel: string
  parameterValueQ: number
  parameterRevision: number
  termNominalQ: number
  termRevision: number
  drawingFingerprint: string | null
  state: ParameterBindingState
  /** 仅在 pending 时有值；逐项说明缺什么凭据，不用笼统“有问题”。 */
  reasons: string[]
}

export interface SourceReviewRow {
  ruleId: string
  reason: string
  termId: string | null
  documentId: string | null
  revisionId: string | null
  page: number | null
}

export interface MaterialMissingRow {
  field: string
  label: string
}

export interface ReviewGroups {
  unlinked: boolean
  affectedTerms: {
    termId: string
    termSymbol: string
    beforeNominalQ: number
    afterNominalQ: number
    changed: boolean
  }[]
  sourceReview: SourceReviewRow[]
  relation: {
    confirmed: boolean
    stale: boolean
    label: string
    detail: string
  }
  materialMissing: MaterialMissingRow[]
  calculation: {
    status: ChainResult['status'] | 'invalid'
    label: string
    /** outside 时的缺口（负=下限不足，正=上限超出）；其它情况 null。 */
    shortfallQ: number | null
    result: ChainResult | null
  }
  drawing: {
    status: 'pending-review-draft' | 'none'
    label: string
  }
}

const SOURCE_RULES = new Set([
  'SOURCE_PRESENT',
  'SOURCE_AVAILABLE',
  'SOURCE_CURRENT',
  'SOURCE_VALUE_REVIEWED',
])

const MATERIAL_LABELS: Record<string, string> = {
  material: '材料',
  drawingNumber: '图号',
  version: '版本',
  tolerance: '公差',
  surface: '表面处理',
  drafter: '制图',
  date: '日期',
}

function bindingEvents(events: readonly ChangeEvent[]): ChangeEvent[] {
  return events.filter(
    (event) => event.type === 'parameter_binding_confirmed' && event.bindingId !== undefined,
  )
}

function latestConfirmation(
  events: readonly ChangeEvent[],
  bindingId: string,
  parameterId: string,
): ChangeEvent | null {
  let latest: ChangeEvent | null = null
  for (const event of bindingEvents(events)) {
    if (event.bindingId !== bindingId || event.parameterId !== parameterId) continue
    if (latest === null || event.createdAt >= latest.createdAt) {
      latest = event
    }
  }
  return latest
}

export function hasParameterBindings(project: ProjectFileProject): boolean {
  return project.dimensionLinks.some((link) => link.kind === 'parameter-binding')
}

/**
 * 逐绑定派生状态。任何一项凭据缺失都保持 pending 并列出具体原因；
 * 数值相等**不能**替代完整确认凭据。
 */
export function parameterBindingStatusRows(
  project: ProjectFileProject,
  events: readonly ChangeEvent[],
): ParameterBindingStatusRow[] {
  const chain = project.dimensionChain
  const drawing = project.drawings[0] ?? null
  const rows: ParameterBindingStatusRow[] = []
  for (const link of project.dimensionLinks) {
    if (link.kind !== 'parameter-binding') continue
    const term = chain.terms.find((item) => item.id === link.termId) ?? null
    const parameter = project.parameters.find((item) => item.parameterId === link.parameterId) ?? null
    const reasons: string[] = []
    if (term === null) reasons.push(`组成环 ${link.termId} 不存在（悬空引用）`)
    if (parameter === null) reasons.push(`参数 ${link.parameterId} 不存在（悬空引用）`)
    if (parameter !== null && parameter.partId !== link.partId) {
      reasons.push('绑定部件与参数部件不一致（悬空引用）')
    }
    if (term !== null && parameter !== null && term.nominalQ !== parameter.valueQ) {
      reasons.push(
        `环 nominal ${term.nominalQ}q 与参数 ${parameter.valueQ}q 未同步`,
      )
    }
    const confirmation =
      parameter === null ? null : latestConfirmation(events, link.bindingId, link.parameterId)
    if (confirmation === null) {
      reasons.push('没有绑定确认事件（旧数据/未确认）')
    } else {
      if (parameter !== null && confirmation.parameterRevision !== parameter.parameterRevision) {
        reasons.push(
          `参数修订 ${parameter.parameterRevision} ≠ 确认时 ${String(confirmation.parameterRevision)}`,
        )
      }
      if (term !== null && confirmation.termRevision !== term.termRevision) {
        reasons.push(
          `环修订 ${term.termRevision} ≠ 确认时 ${String(confirmation.termRevision)}`,
        )
      }
      if (confirmation.drawingId !== (drawing?.drawingId ?? null)) {
        reasons.push('图纸 ID 与确认时不一致')
      }
      if (
        drawing === null ||
        confirmation.drawingFingerprint !== drawing.dataFingerprint
      ) {
        reasons.push('图纸指纹与确认时不一致')
      }
    }
    rows.push({
      bindingId: link.bindingId,
      termId: link.termId,
      termSymbol: term?.symbol ?? link.termId,
      parameterId: link.parameterId,
      parameterLabel: parameter === null ? link.parameterId : SPACER_PARAMETER_LABELS[parameter.key],
      parameterValueQ: parameter?.valueQ ?? 0,
      parameterRevision: parameter?.parameterRevision ?? 0,
      termNominalQ: term?.nominalQ ?? 0,
      termRevision: term?.termRevision ?? 0,
      drawingFingerprint: drawing?.dataFingerprint ?? null,
      state: reasons.length === 0 ? 'valid' : 'pending',
      reasons,
    })
  }
  return rows
}

/**
 * 带快照的版本：来源基准需要完整来源清单（文档/版本/绑定/附件可用性）。
 * renderer 与 main 都调用这一版；上面那个仅用于没有来源数据的纯项目单元测试。
 */
export function parameterBindingStatusRowsWithSnapshot(
  project: ProjectFileProject,
  events: readonly ChangeEvent[],
  sourceBasisFor: (parameterId: string) => string,
): ParameterBindingStatusRow[] {
  const base = parameterBindingStatusRows(project, events)
  const chain = project.dimensionChain
  return base.map((row) => {
    const parameter = project.parameters.find((item) => item.parameterId === row.parameterId)
    const term = chain.terms.find((item) => item.id === row.termId)
    const confirmation = latestConfirmation(events, row.bindingId, row.parameterId)
    if (
      parameter === null ||
      parameter === undefined ||
      term === undefined ||
      confirmation === null
    ) {
      return row
    }
    if (confirmation.sourceBasis !== sourceBasisFor(row.parameterId)) {
      const reasons = [...row.reasons, '来源基准与确认时不一致']
      return { ...row, reasons, state: 'pending' }
    }
    return row
  })
}

export type ParameterBindingRowStage = 'confirmed' | 'draft'

export interface ParameterBindingWorkbenchRow extends ParameterBindingStatusRow {
  /**
   * confirmed：该绑定已在正式快照里，状态仍由确认凭据派生；
   * draft：只存在于 `change.draft.bindings`，尚未确认提交，禁止显示成有效。
   */
  stage: ParameterBindingRowStage
}

export interface DraftBindingInput {
  bindings: readonly ProjectFileParameterBindingLink[]
  parameters: readonly ProjectFileSpacerParameter[]
}

/**
 * 工作台行列表：已确认快照 + 草稿绑定合并。
 *
 * 草稿保存的是“确认后应有的完整绑定集合”，所以有草稿时以它的 bindings 为准：
 * - 与正式快照同一 bindingId、同一 term/part/parameter，且该参数在草稿里
 *   数值与修订号都没变 → 沿用正式派生态（valid / pending + 凭据原因）；
 * - 其余一律 draft + pending，并写明“草稿态：尚未确认提交”，不冒充有效；
 * - 草稿里没有的绑定（例如解绑后）不出现，因此 `rows.length === 0` 就是
 *   “未关联尺寸链”的判据。
 *
 * 本函数只读 project/events 与草稿，不把草稿写回 project，也不改快照语义。
 */
export function parameterBindingWorkbenchRows(
  project: ProjectFileProject,
  events: readonly ChangeEvent[],
  sourceBasisFor: (parameterId: string) => string,
  draft: DraftBindingInput | null,
): ParameterBindingWorkbenchRow[] {
  const confirmedRows = parameterBindingStatusRowsWithSnapshot(project, events, sourceBasisFor)
  if (draft === null) {
    return confirmedRows.map((row) => ({ ...row, stage: 'confirmed' as const }))
  }
  const confirmedLinks = new Map(
    project.dimensionLinks
      .filter((link): link is ProjectFileParameterBindingLink => link.kind === 'parameter-binding')
      .map((link) => [link.bindingId, link]),
  )
  const confirmedRowsById = new Map(confirmedRows.map((row) => [row.bindingId, row]))
  const snapshotParameters = new Map(
    project.parameters.map((parameter) => [parameter.parameterId, parameter]),
  )
  const draftParameters = new Map(
    draft.parameters.map((parameter) => [parameter.parameterId, parameter]),
  )

  return draft.bindings.map((binding): ParameterBindingWorkbenchRow => {
    const confirmedLink = confirmedLinks.get(binding.bindingId)
    const confirmedRow = confirmedRowsById.get(binding.bindingId)
    const draftParameter = draftParameters.get(binding.parameterId)
    const snapshotParameter = snapshotParameters.get(binding.parameterId)
    const bindingUnchanged =
      confirmedLink !== undefined &&
      confirmedLink.termId === binding.termId &&
      confirmedLink.partId === binding.partId &&
      confirmedLink.parameterId === binding.parameterId
    const parameterUnchanged =
      draftParameter !== undefined &&
      snapshotParameter !== undefined &&
      draftParameter.valueQ === snapshotParameter.valueQ &&
      draftParameter.parameterRevision === snapshotParameter.parameterRevision &&
      // 只改来源备注不升修订号，但确认凭据里的来源基准已变 → 必须重新确认。
      (draftParameter.sourceNote ?? '') === (snapshotParameter.sourceNote ?? '')
    if (confirmedRow !== undefined && bindingUnchanged && parameterUnchanged) {
      return { ...confirmedRow, stage: 'confirmed' }
    }

    const term = project.dimensionChain.terms.find((item) => item.id === binding.termId) ?? null
    const parameter = draftParameter ?? snapshotParameter ?? null
    const reasons = ['草稿态：尚未确认提交']
    if (term === null) reasons.push(`组成环 ${binding.termId} 不存在（悬空引用）`)
    if (parameter === null) reasons.push(`参数 ${binding.parameterId} 不存在（悬空引用）`)
    return {
      bindingId: binding.bindingId,
      termId: binding.termId,
      termSymbol: term?.symbol ?? binding.termId,
      parameterId: binding.parameterId,
      parameterLabel: parameter === null ? binding.parameterId : SPACER_PARAMETER_LABELS[parameter.key],
      parameterValueQ: parameter?.valueQ ?? 0,
      parameterRevision: parameter?.parameterRevision ?? 0,
      termNominalQ: term?.nominalQ ?? 0,
      termRevision: term?.termRevision ?? 0,
      drawingFingerprint: project.drawings[0]?.dataFingerprint ?? null,
      state: 'pending',
      stage: 'draft',
      reasons,
    }
  })
}

function relationStateOf(project: ProjectFileProject, chain: ChainDefinition, relationRevision: number) {
  const state = {
    relationRevision,
    relationReview: project.relationReview,
  }
  const confirmed = isRelationConfirmed(chain, state)
  const stale = isRelationReviewStale(chain, state)
  return { confirmed, stale }
}

function sourceRows(summary: ReviewSummary): SourceReviewRow[] {
  return summary.findings
    .filter((finding) => SOURCE_RULES.has(finding.ruleId) && finding.status !== 'passed')
    .map((finding) => ({
      ruleId: finding.ruleId,
      reason: finding.basis,
      termId: finding.subject.termId ?? null,
      documentId: finding.subject.documentId ?? null,
      revisionId: finding.subject.revisionId ?? null,
      page: finding.subject.page ?? null,
    }))
}

function materialRows(project: ProjectFileProject): MaterialMissingRow[] {
  const drawing = project.drawings[0]
  if (drawing === undefined) return []
  const rows: MaterialMissingRow[] = []
  for (const [field, label] of Object.entries(MATERIAL_LABELS)) {
    const value = (drawing.frameFields as Record<string, string>)[field] ?? ''
    if (value.trim() === '') {
      rows.push({ field, label })
    }
  }
  return rows
}

/**
 * 五类坏消息各自独立：受影响环不是错误；来源/关系/材料/计算分别有结论。
 * `computation` 存在时用它的“旧→新”结果；否则用当前正式链。
 */
export function deriveReviewGroups(
  project: ProjectFileProject,
  input: {
    computation: ChangeComputation | null
    availableBlobKeys: ReadonlySet<string>
    documents: readonly import('../sources/types').SourceDocument[]
    revisions: readonly import('../sources/types').SourceRevision[]
    sourceBindings: readonly import('../sources/bindings').SourceBinding[]
  },
): ReviewGroups {
  const chain = input.computation?.chain ?? project.dimensionChain
  const result = input.computation?.result ?? calculateChain(chain)
  const relationRevision =
    input.computation !== null && input.computation.changedTermIds.length > 0
      ? project.relationRevision + 1
      : project.relationRevision
  const relation = relationStateOf(project, chain, relationRevision)
  const summary = evaluateReviewChecklist({
    chain,
    result,
    relationConfirmed: relation.confirmed,
    relationReviewStale: relation.stale,
    relationRevision,
    terms: chain.terms.map((term) => ({
      id: term.id,
      symbol: term.symbol,
      name: term.name,
      termRevision: term.termRevision,
    })),
    bindings: input.sourceBindings,
    documents: input.documents,
    revisions: input.revisions,
    availableBlobKeys: input.availableBlobKeys,
    engineVersion: project.engineVersion,
  })

  const affected = input.computation?.termDiffs.map((row) => ({
    termId: row.termId,
    termSymbol: row.termSymbol,
    beforeNominalQ: row.beforeNominalQ,
    afterNominalQ: row.afterNominalQ,
    changed: row.changed,
  })) ?? []

  const status = result.status
  const shortfallQ =
    status === 'outside'
      ? result.lowerMarginQ !== null && result.lowerMarginQ < 0
        ? result.lowerMarginQ
        : result.upperMarginQ
      : null
  const label =
    status === 'within'
      ? '满足目标（非审查结论）'
      : status === 'outside'
        ? '超出目标'
        : '未设目标'

  return {
    unlinked: !hasParameterBindings(project),
    affectedTerms: affected,
    sourceReview: sourceRows(summary),
    relation: {
      confirmed: relation.confirmed,
      stale: relation.stale,
      label: relation.confirmed
        ? '尺寸关系已确认'
        : relation.stale
          ? '关系待核（确认凭据已失效）'
          : '关系待核（从未确认）',
      detail: relation.confirmed
        ? `relationRevision ${project.relationRevision} 与当前环指纹一致。`
        : '参数同步确认不是关系确认；nominal 变化会使旧关系凭据失效。',
    },
    materialMissing: materialRows(project),
    calculation: {
      status: result.status,
      label,
      shortfallQ,
      result,
    },
    drawing: {
      status: project.drawings.length > 0 ? 'pending-review-draft' : 'none',
      label:
        project.drawings.length > 0
          ? '图纸：待复核草稿（未批准）'
          : '图纸：未生成',
    },
  }
}

export const DERIVED_STATUS_RULES_VERSION = REVIEW_RULES_VERSION

/** 供界面/测试使用：找出仍需要动作的来源相关 finding。 */
export function pendingSourceFindings(summary: ReviewSummary): ReviewFinding[] {
  return summary.findings.filter(
    (finding) => SOURCE_RULES.has(finding.ruleId) && finding.needsAction,
  )
}
