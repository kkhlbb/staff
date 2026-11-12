/** Pure application mapping. The caller, not this module, runs planApplication. */
import type { ToolErrorCode } from '../../desktop/shared/contracts'
import type { ApplicationPlan, ApplicationPlanItem } from '../document-extraction/draft'
import type { ExtractionDraft } from '../document-extraction/types'
import { calculateChain } from '../domain/calculate'
import { MAX_ABS_Q, type ChainDefinition } from '../domain/types'
import { SPACER_PARAMETER_IDS, SPACER_PARAMETER_KEYS, SPACER_PART_ID } from '../drawing/types'
import { decimalsOfInput, validateSpacerParameterSnapshot } from '../parts/spacerParameters'
import type {
  ProjectFileParameterBindingLink,
  ProjectFileSnapshot,
  ProjectFileSpacerParameter,
} from '../project-file/types'
import { validateBindingRegion } from '../project-file/validation'
import type { RequirementEditDraft } from '../requirements/types'
import { ChangeError, computeChange } from '../revisions/compute'
import type { ChangeComputation } from '../revisions/types'
import { mapIntentChain } from './mapIntent'

export interface MappingIntent {
  spacerPart?: 'builtin:shaft-demo:spacer'
  ringSymbols?: string[]
  formulaId?: string
  requirement?: boolean
  linkLengthToSymbol?: string
  /**
   * ADR-001 第 3 步：无任务书项目。组成环直接由计划里的 ring 候选建立，
   * 不走“项目里已登记链”的老路径；门禁（planApplication、computeChange）
   * 与 PDF 路径完全相同。缺省 = 老路径。
   */
  intentChain?: boolean
  /** 参数 ↔ 环绑定（无任务书项目）；参数值必须相等。 */
  intentBindings?: readonly {
    parameter: 'innerDiameter' | 'outerDiameter' | 'length'
    symbol: string
  }[]
}

export interface MappedInputs {
  chain: ChainDefinition
  parameters: ProjectFileSpacerParameter[]
  bindings: ProjectFileParameterBindingLink[]
  requirementEdit: RequirementEditDraft | null
  missing: { field: string; purpose: string }[]
  computation: ChangeComputation
}

export class MappingError extends Error {
  readonly code: ToolErrorCode
  readonly details?: unknown

  constructor(code: ToolErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'MappingError'
    this.code = code
    this.details = details
  }
}

/** Every engineering number is read from the accepted plan, never candidate.data. */
function quantity(item: ApplicationPlanItem, field: string): number | null {
  const fields = item.fields.filter((value) => value.field === field)
  if (fields.length > 1) {
    throw new MappingError('CONSTRAINT_VIOLATED', `字段重复：${field}`, { candidateId: item.candidateId })
  }
  const value = fields[0]
  if (value === undefined || value.valueQ === null || value.unit !== 'mm') return null
  if (!Number.isSafeInteger(value.valueQ) || Math.abs(value.valueQ) > MAX_ABS_Q) {
    throw new MappingError('INVALID_INPUT', `字段 ${field} 不是合法整数 q`)
  }
  return value.valueQ
}

export function mapConfirmed(
  snapshot: ProjectFileSnapshot,
  draft: ExtractionDraft,
  plan: ApplicationPlan,
  mapping: MappingIntent,
  { draftId, now }: { draftId: string; now: string },
): MappedInputs {
  // 无任务书项目：链本来就不存在，由用户给出的 ring 候选建立；其余门禁不变。
  if (mapping.intentChain === true) {
    return mapIntentChain(snapshot, draft, plan, mapping, { draftId, now })
  }
  if (mapping.spacerPart !== undefined && mapping.spacerPart !== SPACER_PART_ID) {
    throw new MappingError('UNSUPPORTED_SCOPE', '只支持内置隔套部件')
  }
  const missing: MappedInputs['missing'] = []
  const lack = (field: string, purpose: string): void => {
    if (!missing.some((entry) => entry.field === field)) missing.push({ field, purpose })
  }
  const candidates = new Map(draft.candidates.map((candidate) => [candidate.candidateId, candidate]))
  for (const item of plan.items) {
    if (candidates.get(item.candidateId)?.kind !== item.kind) {
      throw new MappingError('INVALID_INPUT', '计划引用的候选不存在或类型不符', { candidateId: item.candidateId })
    }
  }
  const previousChain: ChainDefinition = structuredClone(snapshot.project.dimensionChain)
  const chain: ChainDefinition = structuredClone(previousChain)
  const parts = plan.items.filter((item) => item.kind === 'part-dimension')
  const mapGeometry = mapping.spacerPart !== undefined || parts.length > 0
  let parameters = structuredClone(snapshot.project.parameters)
  if (mapGeometry) {
    parameters = []
    for (const key of SPACER_PARAMETER_KEYS) {
      const values = parts.map((item) => ({ item, q: quantity(item, key) })).filter((entry) => entry.q !== null)
      if (values.length === 0) {
        lack(`parameters.${key}`, `生成隔套图纸与三维几何所需的 ${key}`)
        continue
      }
      if (new Set(values.map((entry) => entry.q)).size > 1) {
        throw new MappingError('CONSTRAINT_VIOLATED', `隔套 ${key} 有多组数值`)
      }
      const { item, q } = values[0]
      const decimals = decimalsOfInput(item.fields.find((field) => field.field === key)!.text)
      if (decimals === null) throw new MappingError('INVALID_INPUT', `无法确定 ${key} 的显示精度`)
      const old = snapshot.project.parameters.find((parameter) => parameter.key === key)
      parameters.push({
        parameterId: SPACER_PARAMETER_IDS[key], partId: SPACER_PART_ID, key,
        valueQ: q!, inputDecimals: decimals, reviewStatus: 'draft',
        parameterRevision: old === undefined ? 1 : old.parameterRevision + (old.valueQ === q ? 0 : 1),
        sourceNote: item.evidence.map((evidence) => evidence.textSnippet).join('\n'),
      })
    }
    if (missing.length > 0) {
      throw new MappingError('NEEDS_CLARIFICATION', '缺少生成隔套几何所需的具体参数', { missing })
    }
  } else if (parameters.length !== SPACER_PARAMETER_KEYS.length) {
    for (const key of SPACER_PARAMETER_KEYS) {
      if (!parameters.some((parameter) => parameter.key === key)) lack(`parameters.${key}`, '生成隔套图纸与三维几何')
    }
    throw new MappingError('NEEDS_CLARIFICATION', '缺少隔套几何参数', { missing })
  }
  const validated = validateSpacerParameterSnapshot(parameters)
  if (!validated.ok) throw new MappingError('CONSTRAINT_VIOLATED', validated.message)

  const formulas = plan.items.filter((item) => item.kind === 'formula')
    .filter((item) => mapping.formulaId === undefined || item.candidateId === mapping.formulaId)
  if (formulas.length > 1) throw new MappingError('CONSTRAINT_VIOLATED', '只能映射一条已登记链的公式')
  const formulaCandidate = formulas[0] === undefined ? undefined : candidates.get(formulas[0].candidateId)
  const formula = formulaCandidate?.kind === 'formula' ? formulaCandidate.data : null
  if (formula === null) lack('formula', '确认组成环的装配关系与作用方向')
  else {
    const symbols = new Set(formula.operands.map((operand) => operand.symbol))
    if (formula.unsupported || formula.conflict || symbols.size !== formula.operands.length ||
        formula.operands.length !== chain.terms.length ||
        chain.terms.some((term) => !formula.operands.some((operand) => operand.symbol === term.symbol && operand.sign === term.sign))) {
      throw new MappingError('UNSUPPORTED_SCOPE', '公式必须与已登记链的全部符号及方向一致')
    }
  }
  if (mapping.ringSymbols === undefined) {
    for (const item of plan.items) {
      const candidate = candidates.get(item.candidateId)
      if (candidate?.kind === 'ring' && !chain.terms.some((term) => term.symbol === candidate.data.symbol)) {
        throw new MappingError('UNSUPPORTED_SCOPE', `未登记的组成环 ${String(candidate.data.symbol)}`)
      }
    }
  }
  const requested = mapping.ringSymbols ?? chain.terms.map((term) => term.symbol)
  for (const term of chain.terms) {
    if (!requested.includes(term.symbol)) lack(`rings.${term.symbol}.mapping`, `完整装配检查需要映射组成环 ${term.symbol}，不能沿用模板数值冒充确认结果`)
  }
  if (mapping.linkLengthToSymbol === undefined) lack('bindings.length', '需确认隔套长度参数与组成环的关联')
  if (mapping.requirement !== true) lack('requirement.mapping', '完整任务需要将闭区间要求生成为未确认条款草稿')
  const changed = new Set<string>()
  for (const symbol of new Set(requested)) {
    const term = chain.terms.find((entry) => entry.symbol === symbol)
    if (term === undefined) throw new MappingError('UNSUPPORTED_SCOPE', `未登记的组成环 ${symbol}`)
    const rings = plan.items.filter((item) => {
      const candidate = candidates.get(item.candidateId)
      return candidate?.kind === 'ring' && candidate.data.symbol === symbol
    })
    if (rings.length > 1) throw new MappingError('CONSTRAINT_VIOLATED', `同一符号 ${symbol} 有多条候选`, { causeCode: 'GROUP_ALREADY_CONFIRMED' })
    const ring = rings[0]
    const nominal = ring === undefined ? null : quantity(ring, 'nominal')
    const lower = ring === undefined ? null : quantity(ring, 'lowerDeviation')
    const upper = ring === undefined ? null : quantity(ring, 'upperDeviation')
    if (nominal === null) lack(`rings.${symbol}.nominal`, `${symbol} 的基本尺寸`)
    if (lower === null) lack(`rings.${symbol}.lowerDeviation`, `${symbol} 极限尺寸计算所需的下偏差`)
    if (upper === null) lack(`rings.${symbol}.upperDeviation`, `${symbol} 极限尺寸计算所需的上偏差`)
    const sign = formula?.operands.find((operand) => operand.symbol === symbol)?.sign
    if (sign === undefined) lack(`rings.${symbol}.sign`, `${symbol} 在已确认装配公式中的作用方向`)
    // Never fill an incomplete ring with baseline deviations or an assumed sign.
    if (nominal === null || lower === null || upper === null || sign === undefined) continue
    if (nominal < 0 || lower > upper) throw new MappingError('CONSTRAINT_VIOLATED', `${symbol} 的基本尺寸或偏差范围不合法`)
    Object.assign(term, { nominalQ: nominal, lowerDeviationQ: lower, upperDeviationQ: upper,
      sign, termRevision: term.termRevision + 1 })
    changed.add(term.id)
  }

  const bindings = snapshot.project.dimensionLinks
    .filter((link): link is ProjectFileParameterBindingLink => link.kind === 'parameter-binding')
    .filter((link) => {
      const term = chain.terms.find((entry) => entry.id === link.termId)
      const parameter = parameters.find((entry) => entry.parameterId === link.parameterId)
      if (mapGeometry && term !== undefined && parameter !== undefined &&
          !changed.has(term.id) && term.nominalQ !== parameter.valueQ) {
        lack(`bindings.${term.symbol}`, '几何参数已变化，需补齐装配关系后重新建立绑定')
        return false
      }
      return true
    })
    .map((link) => ({ ...link }))
  if (mapping.linkLengthToSymbol !== undefined) {
    const term = chain.terms.find((entry) => entry.symbol === mapping.linkLengthToSymbol)
    if (term === undefined) throw new MappingError('UNSUPPORTED_SCOPE', '长度绑定指向未登记的组成环')
    if (!changed.has(term.id)) lack(`bindings.${term.symbol}`, '长度绑定需要完整的已映射环数值与方向')
    else {
      const existing = bindings.find((binding) => binding.termId === term.id)
      if (existing !== undefined && existing.parameterId !== SPACER_PARAMETER_IDS.length) {
        throw new MappingError('CONSTRAINT_VIOLATED', `${term.symbol} 已绑定其它参数`)
      }
      if (existing === undefined) bindings.push({
        kind: 'parameter-binding', bindingId: `binding:${draftId}:${term.id}:length`,
        termId: term.id, partId: SPACER_PART_ID, parameterId: SPACER_PARAMETER_IDS.length,
        syncField: 'nominal', createdAt: now,
      })
    }
  }
  // computeChange synchronizes nominal; mapping must not silently overwrite plan truth.
  for (const binding of bindings) {
    const term = chain.terms.find((entry) => entry.id === binding.termId)
    const parameter = parameters.find((entry) => entry.parameterId === binding.parameterId)
    if (term === undefined || parameter === undefined || term.nominalQ !== parameter.valueQ) {
      throw new MappingError('CONSTRAINT_VIOLATED', '参数绑定与组成环基本尺寸不相等', { bindingId: binding.bindingId })
    }
  }

  let requirementEdit: RequirementEditDraft | null = null
  if (mapping.requirement === true) {
    const intervals = plan.items.filter((item) => item.kind === 'interval')
    if (intervals.length > 1) throw new MappingError('CONSTRAINT_VIOLATED', '只能映射一条目标区间')
    const interval = intervals[0]
    const candidate = interval === undefined ? undefined : candidates.get(interval.candidateId)
    const lower = interval === undefined ? null : quantity(interval, 'lower')
    const upper = interval === undefined ? null : quantity(interval, 'upper')
    if (lower === null) lack('requirement.lower', '条款区间下限')
    if (upper === null) lack('requirement.upper', '条款区间上限')
    if (candidate?.kind === 'interval') {
      if (candidate.data.lowerInclusive === null || candidate.data.upperInclusive === null) {
        lack('requirement.endpoints', '目标区间端点是否包含')
      } else if (!candidate.data.lowerInclusive || !candidate.data.upperInclusive) {
        throw new MappingError('UNSUPPORTED_SCOPE', '只支持含两端的闭区间条款')
      } else if (lower !== null && upper !== null) {
        if (lower > upper) throw new MappingError('CONSTRAINT_VIOLATED', '条款下限不能大于上限')
        if (formula !== null && candidate.data.outputSymbol !== formula.outputSymbol) {
          throw new MappingError('UNSUPPORTED_SCOPE', '条款输出符号与装配公式不一致')
        }
        const evidence = interval.evidence[0]
        if (evidence === undefined || validateBindingRegion(evidence.pageBoxPdf, evidence.rectPdf) !== null) {
          throw new MappingError('INVALID_INPUT', '条款出处选区不合法')
        }
        const active = snapshot.project.requirementRevisions.find((revision) => revision.revisionId === snapshot.project.activeRequirementRevisionId)
        requirementEdit = {
          requirementId: active?.requirementId ?? null, editRevision: 1,
          confirmedText: candidate.rawText, lowerText: interval.fields.find(field => field.field === 'lower')!.text, upperText: interval.fields.find(field => field.field === 'upper')!.text,
          source: { documentId: evidence.documentId, revisionId: evidence.revisionId, page: evidence.page,
            rectPdf: [...evidence.rectPdf], pageBoxPdf: [...evidence.pageBoxPdf] },
        }
      }
    }
  }

  try {
    const candidateSnapshot: ProjectFileSnapshot = {
      ...snapshot, project: { ...snapshot.project, dimensionChain: chain },
    }
    const computation = computeChange(candidateSnapshot, { parameters, bindings }, { revisionId: draftId, now })
    // computeChange sees the mapped chain, but comparison must use the formal baseline.
    computation.previousChain = previousChain
    computation.previousResult = calculateChain(previousChain)
    computation.changedTermIds = [...new Set([...computation.changedTermIds, ...changed])]
    computation.affectedTermIds = [...new Set([...computation.affectedTermIds, ...changed])]
    computation.termDiffs = computation.termDiffs.map((row) => {
      const before = previousChain.terms.find((term) => term.id === row.termId)!
      return { ...row, beforeNominalQ: before.nominalQ, changed: before.nominalQ !== row.afterNominalQ }
    })
    return { chain: computation.chain, parameters: computation.parameters, bindings: computation.bindings,
      requirementEdit, missing, computation }
  } catch (error) {
    if (error instanceof ChangeError) throw new MappingError('CONSTRAINT_VIOLATED', error.message, { causeCode: error.code, detail: error.detail })
    if (error instanceof RangeError) throw new MappingError('CONSTRAINT_VIOLATED', error.message)
    throw error
  }
}
