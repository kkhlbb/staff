/**
 * 一次参数变更的纯计算：只同步 nominal，调用 V2 calculateChain，不另写公式。
 *
 * 这里同时被预览与确认使用；确认路径必须**重新调用**本函数，而不是复用预览
 * 结果（MUT-D1）。返回的只是候选值，正式文件/会话由调用方在原子提交点写入。
 */
import { calculateChain } from '../domain/calculate'
import type { ChainDefinition } from '../domain/types'
import { agentReadSources, readingSourceLabel } from '../sources/agentReadDisplay'
import { buildSpacerDrawing, draftVersionText, DrawingBuildError } from '../drawing/spacerDrawing'
import {
  SPACER_PARAMETER_IDS,
  SPACER_PARAMETER_KEYS,
  SPACER_PARAMETER_LABELS,
  SPACER_PART_ID,
  SPACER_TEMPLATE_VERSION,
  USER_INPUT_BASIS,
  type ParameterSnapshotItem,
} from '../drawing/types'
import { parseSpacerParameters, validateSpacerParameterSnapshot } from '../parts/spacerParameters'
import type {
  ProjectFileDrawingRecord,
  ProjectFileParameterBindingLink,
  ProjectFileSnapshot,
} from '../project-file/types'
import { rebuildFromGenerationInput } from './rebuild'
import { sourceBasisOf } from './digest'
import type {
  BindingDiffRow,
  ChangeComputation,
  DrawingGenerationInput,
  ParameterDiffRow,
} from './types'

export class ChangeError extends Error {
  readonly code:
    | 'MISSING_REFERENCE'
    | 'INVALID_PARAMETER'
    | 'INVALID_BINDING'
    | 'DRAWING_FAILED'
  readonly detail?: string

  constructor(
    code: ChangeError['code'],
    message: string,
    detail?: string,
  ) {
    super(message)
    this.name = 'ChangeError'
    this.code = code
    this.detail = detail
  }
}

export const DEFAULT_FRAME_FIELDS: ProjectFileDrawingRecord['frameFields'] = {
  partName: '隔套',
  drawingNumber: '',
  version: '',
  material: '',
  tolerance: '',
  surface: '',
  drafter: '',
  date: '',
  basis: '',
}

export interface ComputeChangeOptions {
  /** 确认/预览分配的正式 revisionId；图纸指纹用它重建。 */
  revisionId: string
  /** 新增绑定的创建时间。 */
  now: string
}

function cloningParameters(
  base: ProjectFileSnapshot['project']['parameters'],
): ProjectFileSnapshot['project']['parameters'] {
  return base.map((parameter) => ({ ...parameter }))
}

function applyBindings(
  chain: ChainDefinition,
  bindings: readonly ProjectFileParameterBindingLink[],
  parameters: ProjectFileSnapshot['project']['parameters'],
  previous: ChainDefinition,
): { chain: ChainDefinition; termDiffs: BindingDiffRow[]; changedTermIds: string[] } {
  const terms = chain.terms.map((term) => ({ ...term }))
  const byId = new Map(terms.map((term) => [term.id, term]))
  const beforeById = new Map(previous.terms.map((term) => [term.id, term]))
  const parameterById = new Map(parameters.map((parameter) => [parameter.parameterId, parameter]))
  const rows: BindingDiffRow[] = []
  const changed = new Set<string>()
  const seenTerms = new Set<string>()

  for (const binding of bindings) {
    if (seenTerms.has(binding.termId)) {
      throw new ChangeError(
        'INVALID_BINDING',
        `组成环 ${binding.termId} 存在第二个参数绑定`,
        binding.bindingId,
      )
    }
    seenTerms.add(binding.termId)
    const term = byId.get(binding.termId)
    if (term === undefined) {
      throw new ChangeError(
        'MISSING_REFERENCE',
        `参数绑定 ${binding.bindingId} 引用了不存在的组成环`,
        binding.termId,
      )
    }
    const parameter = parameterById.get(binding.parameterId)
    if (parameter === undefined) {
      throw new ChangeError(
        'MISSING_REFERENCE',
        `参数绑定 ${binding.bindingId} 引用了不存在的参数`,
        binding.parameterId,
      )
    }
    if (parameter.partId !== binding.partId) {
      throw new ChangeError(
        'MISSING_REFERENCE',
        `参数绑定 ${binding.bindingId} 的部件与参数不一致`,
        `${binding.partId} != ${parameter.partId}`,
      )
    }
    if (parameter.partId !== SPACER_PART_ID) {
      throw new ChangeError('INVALID_BINDING', `参数绑定 ${binding.bindingId} 指向不支持的部件`)
    }
    const beforeQ = beforeById.get(binding.termId)?.nominalQ ?? term.nominalQ
    const changedValue = term.nominalQ !== parameter.valueQ
    term.nominalQ = parameter.valueQ
    if (changedValue) {
      term.termRevision += 1
      changed.add(term.id)
    }
    rows.push({
      bindingId: binding.bindingId,
      termId: term.id,
      termSymbol: term.symbol,
      parameterId: parameter.parameterId,
      parameterLabel: SPACER_PARAMETER_LABELS[parameter.key],
      beforeNominalQ: beforeQ,
      afterNominalQ: term.nominalQ,
      changed: beforeQ !== term.nominalQ,
    })
  }

  return {
    chain: { terms, target: chain.target, assumptions: chain.assumptions },
    termDiffs: rows,
    changedTermIds: [...changed],
  }
}

function drawingInputOf(
  projectId: string,
  parameters: ProjectFileSnapshot['project']['parameters'],
  record: ProjectFileDrawingRecord,
): DrawingGenerationInput {
  return {
    drawingId: record.drawingId,
    partId: record.partId,
    templateId: record.templateId,
    templateVersion: record.templateVersion,
    drawingDataVersion: record.drawingDataVersion,
    projectId,
    revisionId: record.revisionId,
    parameters: parameters.map((parameter) => ({
      ...(parameter.provenance === undefined ? {} : { provenance: parameter.provenance }),
      parameterId: parameter.parameterId,
      partId: parameter.partId,
      key: parameter.key,
      valueQ: parameter.valueQ,
      inputDecimals: parameter.inputDecimals,
      reviewStatus: parameter.reviewStatus,
      ...(parameter.sourceNote === undefined ? {} : { sourceNote: parameter.sourceNote }),
    })),
    scale: record.scale,
    frameFields: record.frameFields,
  }
}

/**
 * 计算候选：参数（含 prospective parameterRevision 由草稿提供）、绑定、链、
 * 图纸、前后结果与 diff。任何引用错误直接抛出，不返回半成品。
 */
export function computeChange(
  snapshot: ProjectFileSnapshot,
  draft: {
    parameters: ProjectFileSnapshot['project']['parameters']
    bindings: ProjectFileParameterBindingLink[]
  },
  options: ComputeChangeOptions,
): ChangeComputation {
  const baseChain = snapshot.project.dimensionChain
  const previousChain: ChainDefinition = {
    terms: baseChain.terms.map((term) => ({ ...term })),
    target: baseChain.target === null ? null : { ...baseChain.target },
    assumptions: baseChain.assumptions,
  }
  const previousResult = calculateChain(previousChain)

  const parameters = cloningParameters(draft.parameters)
  const validated = validateSpacerParameterSnapshot(parameters)
  if (!validated.ok) {
    throw new ChangeError('INVALID_PARAMETER', `隔套参数不合法：${validated.message}`)
  }

  const applied = applyBindings(
    { terms: baseChain.terms.map((term) => ({ ...term })), target: baseChain.target, assumptions: baseChain.assumptions },
    draft.bindings,
    parameters,
    previousChain,
  )
  const chain: ChainDefinition = { ...applied.chain }
  const result = calculateChain(chain)

  const parameterDiffs: ParameterDiffRow[] = SPACER_PARAMETER_KEYS.map((key) => {
    const parameterId = SPACER_PARAMETER_IDS[key]
    const before = snapshot.project.parameters.find((item) => item.key === key) ?? null
    const after = parameters.find((item) => item.key === key)
    if (after === undefined) {
      throw new ChangeError('INVALID_PARAMETER', `缺少参数：${key}`)
    }
    return {
      parameterId,
      key,
      beforeQ: before?.valueQ ?? null,
      afterQ: after.valueQ,
      beforeDecimals: before?.inputDecimals ?? null,
      afterDecimals: after.inputDecimals,
      beforeSourceNote: before?.sourceNote ?? '',
      afterSourceNote: after.sourceNote ?? '',
      valueChanged: before === null ? true : before.valueQ !== after.valueQ,
      displayChanged:
        before === null ||
        before.inputDecimals !== after.inputDecimals ||
        before.valueQ !== after.valueQ,
      sourceNoteChanged: (before?.sourceNote ?? '') !== (after.sourceNote ?? ''),
    }
  })

  const baseRecord = snapshot.project.drawings[0] ?? null
  const frameFields = { ...(baseRecord?.frameFields ?? DEFAULT_FRAME_FIELDS) }
  // 无任务书项目：标题栏与技术要求的依据栏是强制标记，不由用户备注决定。
  if (snapshot.project.sourceKind === 'user-intent') frameFields.basis = USER_INPUT_BASIS
  const readBasis = [...new Set(agentReadSources(snapshot.project.dimensionChain.terms.flatMap((term) => term.provenance ?? [])).map(readingSourceLabel))].join('；')
  if (readBasis !== '') frameFields.basis = `读数来源：${readBasis}`
  // 版本栏：写可读的「草稿 · 第 N 版」，N = 本次提交后的版本序号（现存版本数 + 1）。
  // 字符串随图纸记录持久化，重建时直接读它，绝不把内部 revision UUID 印在图上。
  if (frameFields.version.trim() === '') {
    frameFields.version = draftVersionText(snapshot.fileRevisions.length + 1)
  }
  const scale = baseRecord?.scale ?? { numerator: 1, denominator: 1 }
  const drawingId = baseRecord?.drawingId ?? `drawing:${snapshot.project.id}:spacer`

  const drawingParameters: ParameterSnapshotItem[] = parameters.map((parameter) => ({
    ...(parameter.provenance === undefined ? {} : { provenance: parameter.provenance }),
    parameterId: parameter.parameterId,
    partId: parameter.partId,
    key: parameter.key,
    valueQ: parameter.valueQ,
    inputDecimals: parameter.inputDecimals,
    reviewStatus: parameter.reviewStatus,
    ...(parameter.sourceNote === undefined || parameter.sourceNote === ''
      ? {}
      : { sourceNote: parameter.sourceNote }),
  }))

  let data
  try {
    data = buildSpacerDrawing({
      projectId: snapshot.project.id,
      revisionId: options.revisionId,
      drawingId,
      parameters: drawingParameters,
      scale,
      frameFields,
    })
  } catch (error) {
    if (error instanceof DrawingBuildError) {
      throw new ChangeError('DRAWING_FAILED', error.message, error.detail)
    }
    throw error
  }
  const record: ProjectFileDrawingRecord = {
    drawingId,
    drawingDataVersion: 1,
    templateId: data.templateId,
    templateVersion: data.templateVersion,
    partId: data.partId,
    revisionId: options.revisionId,
    parameterIds: data.parameterSnapshot.map((item) => item.parameterId),
    paper: data.paper,
    scale: data.scale,
    frameFields,
    status: 'pending-review-draft',
    dataFingerprint: data.fingerprint,
  }

  let previousData = null
  let previousProblem: string | null = null
  let previousInput: DrawingGenerationInput | null = null
  if (baseRecord === null) {
    previousProblem = '当前项目尚无已保存图纸，不能重建旧图'
  } else {
    previousInput = drawingInputOf(snapshot.project.id, snapshot.project.parameters, baseRecord)
    const rebuilt = rebuildFromGenerationInput(previousInput, baseRecord.dataFingerprint)
    if (rebuilt.ok) {
      previousData = rebuilt.data
    } else {
      previousProblem = rebuilt.reason
    }
  }

  const bindingTerms = new Set(draft.bindings.map((binding) => binding.termId))
  const baseBindingTerms = new Set(
    snapshot.project.dimensionLinks
      .filter((link): link is ProjectFileParameterBindingLink => link.kind === 'parameter-binding')
      .map((link) => link.termId),
  )
  const affected = new Set<string>(applied.termDiffs.filter((row) => row.changed).map((row) => row.termId))
  for (const termId of bindingTerms) {
    if (!baseBindingTerms.has(termId)) {
      affected.add(termId)
    }
  }
  for (const termId of baseBindingTerms) {
    if (!bindingTerms.has(termId)) {
      affected.add(termId)
    }
  }
  const unboundTermIds = chain.terms
    .filter((term) => !bindingTerms.has(term.id))
    .map((term) => term.id)

  const credentials = draft.bindings.map((binding) => {
    const parameter = parameters.find((item) => item.parameterId === binding.parameterId)
    const term = chain.terms.find((item) => item.id === binding.termId)
    if (parameter === undefined || term === undefined) {
      throw new ChangeError('MISSING_REFERENCE', `绑定 ${binding.bindingId} 的引用不完整`)
    }
    return {
      bindingId: binding.bindingId,
      parameterId: parameter.parameterId,
      termId: term.id,
      parameterRevision: parameter.parameterRevision,
      termRevision: term.termRevision,
      drawingId: record.drawingId,
      drawingFingerprint: record.dataFingerprint,
      sourceBasis: sourceBasisOf(snapshot, parameter.sourceNote),
    }
  })

  return {
    parameters,
    bindings: draft.bindings.map((binding) => ({ ...binding })),
    chain: {
      terms: chain.terms,
      target: chain.target,
      assumptions: chain.assumptions,
    },
    previousChain,
    previousResult,
    result,
    termDiffs: applied.termDiffs,
    parameterDiffs,
    changedTermIds: applied.changedTermIds,
    affectedTermIds: [...affected],
    unboundTermIds,
    drawing: {
      record,
      data,
      previous: previousInput,
      previousData,
      previousProblem,
    },
    credentials,
  }
}

/** 从十进制输入构造草稿参数（保留已有 parameterRevision 语义由调用方处理）。 */
export function parseDraftParameters(
  texts: { innerDiameter: string; outerDiameter: string; length: string },
  sourceNotes: Partial<Record<'innerDiameter' | 'outerDiameter' | 'length', string>> = {},
): { ok: true; parameters: ParameterSnapshotItem[] } | { ok: false; message: string; field: string } {
  const parsed = parseSpacerParameters(texts, sourceNotes)
  if (!parsed.ok) {
    return { ok: false, message: parsed.message, field: parsed.field }
  }
  return { ok: true, parameters: parsed.parameters }
}

/** 关系修订号是否因本次候选前进（nominal 同步会使旧关系凭据自然失效）。 */
export function nextRelationRevision(snapshot: ProjectFileSnapshot, computation: ChangeComputation): number {
  return computation.changedTermIds.length > 0
    ? snapshot.project.relationRevision + 1
    : snapshot.project.relationRevision
}

export { SPACER_TEMPLATE_VERSION }
