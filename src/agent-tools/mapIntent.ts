/**
 * 无任务书项目的映射：从已确认的计划项直接建立尺寸链与隔套参数。
 *
 * 与 PDF 路径的区别只在“链从哪来”：PDF 路径要求项目里已有登记链、映射只改数值；
 * 无任务书项目本来就没有链，因此组成环由用户给出的 ring 候选建立。门禁不放宽：
 * - 输入仍是 `planApplication` 的计划项（已确认、决定未失效、出处完整）；
 * - 仍然 `computeChange` 重算，仍然返回 missing/约束错误；
 * - 仍然不写项目，只产出候选草稿。
 */
import { calculateChain } from '../domain/calculate'
import type { ChainDefinition, DimensionTerm } from '../domain/types'
import { stableId } from '../document-extraction/ids'
import type { ApplicationPlan, ApplicationPlanItem } from '../document-extraction/draft'
import type { ExtractionCandidate, ExtractionDraft } from '../document-extraction/types'
import { SPACER_PARAMETER_IDS, SPACER_PARAMETER_KEYS, SPACER_PART_ID } from '../drawing/types'
import { decimalsOfInput, validateSpacerParameterSnapshot } from '../parts/spacerParameters'
import type {
  ProjectFileParameterBindingLink,
  ProjectFileSnapshot,
  ProjectFileSpacerParameter,
} from '../project-file/types'
import { ChangeError, computeChange } from '../revisions/compute'
import { MappingError, type MappedInputs, type MappingIntent } from './mapConfirmed'

function quantity(item: ApplicationPlanItem, field: string): number | null {
  const fields = item.fields.filter((value) => value.field === field)
  if (fields.length > 1) {
    throw new MappingError('CONSTRAINT_VIOLATED', `字段重复：${field}`, { candidateId: item.candidateId })
  }
  const value = fields[0]
  if (value === undefined || value.valueQ === null || value.unit !== 'mm') return null
  return value.valueQ
}

/** 计划项 → ring 候选（只读；用于符号与公式方向）。 */
function ringOf(
  plan: ApplicationPlan,
  candidates: Map<string, ExtractionCandidate>,
): { item: ApplicationPlanItem; symbol: string }[] {
  return plan.items.flatMap((item) => {
    const candidate = candidates.get(item.candidateId)
    if (candidate?.kind !== 'ring' || candidate.data.symbol === null) return []
    return [{ item, symbol: candidate.data.symbol }]
  })
}

export function mapIntentChain(
  snapshot: ProjectFileSnapshot,
  draft: ExtractionDraft,
  plan: ApplicationPlan,
  mapping: MappingIntent,
  { draftId, now }: { draftId: string; now: string },
): MappedInputs {
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

  const rings = ringOf(plan, candidates)
  if (rings.length < 2) {
    throw new MappingError('NEEDS_CLARIFICATION', '无任务书项目至少要两个组成环', {
      missing: [{ field: 'chain.terms', purpose: '至少给出两个组成环（符号、基本尺寸、上下偏差、方向）' }],
    })
  }
  const formulas = plan.items.filter((item) => item.kind === 'formula')
  if (formulas.length !== 1) {
    throw new MappingError('NEEDS_CLARIFICATION', '无任务书项目需要用户给出装配式（增减环方向）', {
      missing: [{ field: 'chain.formula', purpose: '确认组成环的装配关系与作用方向' }],
    })
  }
  const formulaCandidate = candidates.get(formulas[0]!.candidateId)
  if (formulaCandidate?.kind !== 'formula') {
    throw new MappingError('INVALID_INPUT', '装配式候选不存在')
  }
  if (formulaCandidate.data.unsupported || formulaCandidate.data.conflict) {
    throw new MappingError('UNSUPPORTED_SCOPE', '装配式只支持线性加减，且不能有冲突')
  }
  const symbols = rings.map((ring) => ring.symbol)
  const operands = formulaCandidate.data.operands
  if (operands.length !== symbols.length ||
      new Set(operands.map((operand) => operand.symbol)).size !== operands.length ||
      symbols.some((symbol) => !operands.some((operand) => operand.symbol === symbol))) {
    throw new MappingError('UNSUPPORTED_SCOPE', '装配式必须与全部组成环符号及方向一致')
  }

  const previousChain: ChainDefinition = structuredClone(snapshot.project.dimensionChain)
  const terms: DimensionTerm[] = []
  const ringsBySymbol = new Map(rings.map((ring) => [ring.symbol, ring]))
  // 按装配式顺序建环，保证界面/图纸上的组成环顺序与用户说的一致。
  for (const operand of operands) {
    const ring = ringsBySymbol.get(operand.symbol)
    if (ring === undefined) continue
    const { item, symbol } = ring
    const nominalQ = quantity(item, 'nominal')
    const lowerDeviationQ = quantity(item, 'lowerDeviation')
    const upperDeviationQ = quantity(item, 'upperDeviation')
    const sign = operand.sign
    if (nominalQ === null) lack(`rings.${symbol}.nominal`, `${symbol} 的基本尺寸`)
    if (lowerDeviationQ === null) lack(`rings.${symbol}.lowerDeviation`, `${symbol} 的下偏差`)
    if (upperDeviationQ === null) lack(`rings.${symbol}.upperDeviation`, `${symbol} 的上偏差`)
    if (nominalQ === null || lowerDeviationQ === null || upperDeviationQ === null) continue
    if (nominalQ < 0 || lowerDeviationQ > upperDeviationQ) {
      throw new MappingError('CONSTRAINT_VIOLATED', `${symbol} 的基本尺寸或偏差范围不合法`)
    }
    terms.push({
      ...(item.provenance.some((ref) => ref.kind === 'agent-read') ? { provenance: item.provenance } : {}),
      id: stableId('intent-term', [draft.draftId, symbol]),
      symbol,
      name: symbol,
      nominalQ,
      lowerDeviationQ,
      upperDeviationQ,
      sign,
      sourceNote: '',
      termRevision: 1,
    })
  }
  if (missing.length > 0) {
    throw new MappingError('NEEDS_CLARIFICATION', '组成环还缺数值或方向', { missing })
  }
  const chain: ChainDefinition = {
    terms,
    target: null,
    assumptions: '无任务书项目：组成环与条款由用户在对话中给出',
  }

  const parts = plan.items.filter((item) => item.kind === 'part-dimension')
  if (parts.length !== 1) {
    throw new MappingError('NEEDS_CLARIFICATION', '无任务书项目需要隔套的内径/外径/长度', {
      missing: [{ field: 'parameters', purpose: '隔套的内径、外径与长度' }],
    })
  }
  const parameters: ProjectFileSpacerParameter[] = []
  for (const key of SPACER_PARAMETER_KEYS) {
    const q = quantity(parts[0]!, key)
    if (q === null) {
      lack(`parameters.${key}`, `生成隔套图纸与三维几何所需的 ${key}`)
      continue
    }
    const field = parts[0]!.fields.find((value) => value.field === key)!
    const decimals = decimalsOfInput(field.text)
    if (decimals === null) throw new MappingError('INVALID_INPUT', `无法确定 ${key} 的显示精度`)
    const old = snapshot.project.parameters.find((parameter) => parameter.key === key)
    parameters.push({
      ...(parts[0]!.provenance.some((ref) => ref.kind === 'agent-read') ? { provenance: parts[0]!.provenance } : {}),
      parameterId: SPACER_PARAMETER_IDS[key],
      partId: SPACER_PART_ID,
      key,
      valueQ: q,
      inputDecimals: decimals,
      reviewStatus: 'draft',
      parameterRevision: old === undefined ? 1 : old.parameterRevision + (old.valueQ === q ? 0 : 1),
      sourceNote: parts[0]!.evidence.map((evidence) => evidence.textSnippet).join('\n'),
    })
  }
  if (missing.length > 0) {
    throw new MappingError('NEEDS_CLARIFICATION', '缺少隔套几何参数', { missing })
  }
  const validated = validateSpacerParameterSnapshot(parameters)
  if (!validated.ok) throw new MappingError('CONSTRAINT_VIOLATED', validated.message)

  // 参数 ↔ 环的绑定意图：这里只做一致性校验，不创建 D 层的 parameter-binding。
  // 原因（如实记录）：D 层绑定是否“已核”由绑定确认事件派生，而无任务书项目
  // 没有单独的绑定核对动作；伪造确认事件会让既有判据失真。绑定意图保存在
  // 意图草稿与用户断言里，随版本一起冻结；自动“改参数同步改环”留作后续能力。
  const bindings: ProjectFileParameterBindingLink[] = []
  const intentBindings = mapping.intentBindings ?? draft.intentBindings ?? []
  for (const binding of intentBindings) {
    const term = chain.terms.find((entry) => entry.symbol === binding.symbol)
    const parameter = parameters.find((entry) => entry.key === binding.parameter)
    if (term === undefined || parameter === undefined) {
      throw new MappingError('UNSUPPORTED_SCOPE', `绑定 ${binding.parameter} ↔ ${binding.symbol} 指向不存在的环或参数`)
    }
    if (term.nominalQ !== parameter.valueQ) {
      throw new MappingError('CONSTRAINT_VIOLATED', '参数绑定与组成环基本尺寸不相等', {
        binding: `${binding.parameter}↔${binding.symbol}`,
      })
    }
  }

  try {
    const candidateSnapshot: ProjectFileSnapshot = {
      ...snapshot,
      project: { ...snapshot.project, dimensionChain: chain },
    }
    const computation = computeChange(candidateSnapshot, { parameters, bindings }, { revisionId: draftId, now })
    computation.previousChain = previousChain
    computation.previousResult = calculateChain(previousChain)
    return { chain: computation.chain, parameters: computation.parameters, bindings: computation.bindings,
      requirementEdit: null, missing, computation }
  } catch (error) {
    if (error instanceof ChangeError) {
      throw new MappingError('CONSTRAINT_VIOLATED', error.message, { causeCode: error.code, detail: error.detail })
    }
    if (error instanceof RangeError) throw new MappingError('CONSTRAINT_VIOLATED', error.message)
    throw error
  }
}
