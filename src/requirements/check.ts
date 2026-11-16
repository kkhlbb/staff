/**
 * V3.5 Beta：候选条款检查（领域纯函数，可独立调用）。
 *
 * 判定契约（任务卡 §4，规格 §4）：
 * - 1q = 0.0001 mm；闭区间；边界相等算满足；部分相交不算满足；
 * - 满足 iff Cmin ≥ lowerQ 且 Cmax ≤ upperQ；
 * - 原项目 target 只用于独立结果，绝不参与条款判定；
 * - 数值“不满足”是正常检查结果，不是异常。
 *
 * 状态优先级：无条款/规则不支持/输入无效 → 未检查；有支持的规则和有效输入但
 * 可信依据待补 → 待确认；其余才给数值满足/不满足。待确认可以带候选数值，未检查
 * 必须清空当前区间与裕量。
 */
import type { ChainDefinition, ChainResult, DimensionTerm } from '../domain/types'
import { calculateChain } from '../domain/calculate'
import type { ProjectFileSnapshot } from '../project-file/types'
import {
  ChangeError,
  computeChange,
  type ComputeChangeOptions,
} from '../revisions/compute'
import { parameterBindingStatusRows } from '../revisions/status'
import { validateBindingRegion } from '../project-file/validation'
import type {
  RequirementCheck,
  RequirementCheckBasis,
  RequirementCheckStatus,
  RequirementEditDraft,
  RequirementEvaluation,
  RequirementReasonCode,
  RequirementRevision,
} from './types'
import { REQUIREMENT_RULES_VERSION, isPdfRequirementSource } from './types'
import { provenanceValidity } from '../document-extraction/types'
import {
  bindingBasisDigest,
  buildRequirementFingerprintInput,
  computeRequirementInputFingerprint,
  type RequirementDraftInput,
} from './fingerprint'

export type RequirementCheckErrorCode =
  | 'MISSING_REFERENCE'
  | 'INVALID_BINDING'
  | 'INVALID_PARAMETER'
  | 'INVALID_DRAWING'
  | 'CALCULATION_FAILED'

export interface RequirementCheckError {
  code: RequirementCheckErrorCode
  message: string
  detail?: string
}

export interface RequirementCheckValue {
  check: RequirementCheck
  evaluation: RequirementEvaluation
  /** 候选链（已同步参数 nominal）；输入无效时为 null。 */
  chain: ChainDefinition | null
  /** 原项目目标独立结果；target 未被改写。 */
  originalTargetResult: ChainResult | null
  /** 以条款区间计算的数值结果；仅数值可用时有。 */
  requirementResult: ChainResult | null
}

export type RequirementCheckResult =
  | { ok: true; value: RequirementCheckValue }
  | { ok: false; error: RequirementCheckError }

export interface RequirementCheckInput {
  snapshot: ProjectFileSnapshot
  requirementRevisions: readonly RequirementRevision[]
  activeRequirementRevisionId: string | null
  /** 未确认的条款表单；存在即“待确认”。 */
  pendingEdit: RequirementEditDraft | null
  draft: RequirementDraftInput | null
  baseRevisionId?: string
  baseGeneration?: number
  acceptedSeq?: number
  checkedAt: string
  checkId: string
  /** 上游 stage 已判定输入非法时的原因（空/格式/精度/越界）。 */
  inputIssue: {
    field: string
    code: 'empty' | 'format' | 'precision' | 'range'
    message: string
  } | null
  /** 默认草稿 basis；基线/正式检查传 project-revision。 */
  basis?: RequirementCheckBasis
  provenance?: 'candidate' | 'committed'
}

const ISSUE_REASON: Record<'empty' | 'format' | 'precision' | 'range', RequirementReasonCode> = {
  empty: 'INPUT_EMPTY',
  format: 'INPUT_FORMAT',
  precision: 'INPUT_PRECISION',
  range: 'INPUT_RANGE',
}

/** 原因码 → 中文说明；界面只显示这段说明，不直接打印原因码。 */
export const REQUIREMENT_REASON_TEXT: Record<RequirementReasonCode, string> = {
  NO_REQUIREMENT: '尚未绑定任务书条款，当前没有可执行的条款检查。',
  UNSUPPORTED_RULE: '条款规则不受支持（只支持带上下限的 mm 闭区间）。',
  INVALID_INPUT: '输入待修正，当前检查未完成。',
  INPUT_EMPTY: '输入为空，当前检查未完成。',
  INPUT_FORMAT: '输入不是合法的十进制数值，当前检查未完成。',
  INPUT_PRECISION: '输入超过 4 位小数（最小步长 0.0001 mm），当前检查未完成。',
  INPUT_RANGE: '输入超出允许范围，当前检查未完成。',
  MISSING_BOUNDS: '条款缺少上下限，不能执行检查。',
  CALCULATION_UNAVAILABLE: '当前不能得到可用的候选链，本次检查未完成。',
  REQUIREMENT_EDIT_UNCONFIRMED: '条款表单尚未确认，当前结论待确认。',
  SOURCE_VERSION_CHANGED: '任务书 PDF 已换版，需核对新版后重新确认条款。',
  SOURCE_UNREADABLE: '条款引用的任务书资料不可读，无法确认判定依据。',
  SOURCE_HASH_MISMATCH: '任务书 PDF 字节哈希与条款确认时不一致，需重新核对来源。',
  BINDING_UNREVIEWED: '参数绑定尚无确认凭据，需先核对绑定。',
  BINDING_ADDED: '条款确认后新增了参数绑定，需核对新增绑定。',
  BINDING_REBOUND: '条款确认后参数绑定被改绑，需重新核对绑定。',
  BINDING_TERM_REMOVED: '条款确认时绑定的组成环或绑定已不存在，需重新核对。',
  WITHIN_REQUIREMENT: '候选区间完全落在任务书要求内。',
  LOWER_VIOLATED: '候选区间在下界越界（下裕量为负）。',
  UPPER_VIOLATED: '候选区间在上界越界（上裕量为负）。',
  BOTH_VIOLATED: '候选区间两侧均越界。',
}

function evaluationOf(
  check: RequirementCheck,
  eligibleForCommit: boolean,
): RequirementEvaluation {
  return {
    requirementRevisionId: check.requirementRevisionId,
    status: check.status,
    reasonCodes: [...check.reasonCodes],
    resultInterval: check.resultInterval === null ? null : { ...check.resultInterval },
    margins: check.margins === null ? null : { ...check.margins },
    eligibleForCommit,
    reasons: check.reasonCodes.map((code) => REQUIREMENT_REASON_TEXT[code]),
  }
}

function cloneChain(chain: ChainDefinition): ChainDefinition {
  return {
    terms: chain.terms.map((term) => ({ ...term })),
    target: chain.target === null ? null : { ...chain.target },
    assumptions: chain.assumptions,
  }
}

function parameterBindingsOf(
  snapshot: ProjectFileSnapshot,
): import('../project-file/types').ProjectFileParameterBindingLink[] {
  return snapshot.project.dimensionLinks.filter(
    (link): link is import('../project-file/types').ProjectFileParameterBindingLink =>
      link.kind === 'parameter-binding',
  )
}

function hasBoundParameters(snapshot: ProjectFileSnapshot): boolean {
  return snapshot.project.parameters.length === 3
}

/**
 * 绑定依据有效性：只看身份（绑定/环/参数是否仍对应），不看长度数值。
 * 已确认有效绑定下单纯改长度允许重算候选，不能因此永远卡待确认。
 */
export function requirementBindingProblems(
  snapshot: ProjectFileSnapshot,
  requirement: RequirementRevision,
): RequirementReasonCode[] {
  const current = parameterBindingsOf(snapshot)
  const byTerm = new Map(current.map((link) => [link.termId, link]))
  const basisByTerm = new Map(
    requirement.bindingBasis.bindings.map((item) => [item.termId, item]),
  )
  const codes: RequirementReasonCode[] = []
  const push = (code: RequirementReasonCode): void => {
    if (!codes.includes(code)) codes.push(code)
  }

  for (const [termId, basis] of basisByTerm) {
    const now = byTerm.get(termId)
    if (now === undefined) {
      push('BINDING_TERM_REMOVED')
      continue
    }
    if (now.bindingId !== basis.bindingId || now.parameterId !== basis.parameterId) {
      push('BINDING_REBOUND')
    }
  }
  for (const [termId] of byTerm) {
    if (!basisByTerm.has(termId)) push('BINDING_ADDED')
  }
  // 新建/改绑的绑定若没有任何 D 层确认事件，则“未核”。已确认的绑定即使
  // 参数修订前进（单纯改长度）也不在这里降级。
  const statusRows = parameterBindingStatusRows(snapshot.project, snapshot.events)
  const confirmedIds = new Set(
    statusRows.filter((row) => row.state !== 'pending').map((row) => row.bindingId),
  )
  for (const [termId, basis] of basisByTerm) {
    const now = byTerm.get(termId)
    if (now === undefined) continue
    if (now.bindingId === basis.bindingId && !confirmedIds.has(now.bindingId)) {
      const hasEvent = snapshot.events.some(
        (event) =>
          event.type === 'parameter_binding_confirmed' &&
          event.bindingId === now.bindingId &&
          event.parameterId === now.parameterId,
      )
      // 有确认事件但参数/环修订前进 = 单纯数值变化，允许；没有任何确认事件才待核。
      if (!hasEvent) push('BINDING_UNREVIEWED')
    }
  }
  return codes
}

/** 来源有效性：换版/不可读/哈希不符 → 待确认，不沿用旧满足。 */
function sourceProblems(
  snapshot: ProjectFileSnapshot,
  requirement: RequirementRevision,
): RequirementReasonCode[] {
  const codes: RequirementReasonCode[] = []
  // 无任务书项目：来源是用户断言，没有文件可换版；撤销由 provenanceValidity 判定。
  if (!isPdfRequirementSource(requirement.source)) {
    const validity = provenanceValidity(requirement.source.attestation, {
      revisions: snapshot.revisions.map((item) => ({ revisionId: item.id, sha256: item.sha256 })),
    })
    if (validity === 'revoked') codes.push('SOURCE_VERSION_CHANGED')
    return codes
  }
  const source = requirement.source
  const document = snapshot.documents.find(
    (item) => item.id === source.documentId,
  )
  const revision = snapshot.revisions.find(
    (item) => item.id === source.revisionId,
  )
  if (document === undefined || revision === undefined) {
    codes.push('SOURCE_UNREADABLE')
    return codes
  }
  if (document.latestRevisionId !== requirement.confirmedAgainstLatestRevisionId) {
    codes.push('SOURCE_VERSION_CHANGED')
  }
  const blob = snapshot.blobs.find((item) => item.blobKey === revision.blobKey)
  const readable =
    snapshot.attachments.some((item) => item.blobKey === revision.blobKey) &&
    snapshot.missingAttachments.every((item) => item.blobKey !== revision.blobKey)
  if (!readable || blob === undefined) {
    codes.push('SOURCE_UNREADABLE')
  } else if (blob.sha256 !== source.sha256) {
    codes.push('SOURCE_HASH_MISMATCH')
  }
  if (
    source.page > revision.pageCount ||
    validateBindingRegion(source.pageBoxPdf, source.rectPdf) !== null
  ) {
    codes.push('SOURCE_UNREADABLE')
  }
  return [...new Set(codes)]
}

/**
 * 闭区间判定的**唯一实现**（服务端条款判定与 MCP `check_requirement` 共用）。
 *
 * 判据：满足 iff Cmin ≥ 下限 且 Cmax ≤ 上限；`inclusive=false` 时改为严格不等。
 * 裕量含负值：下裕量 = Cmin − 下限，上裕量 = 上限 − Cmax。
 * 边界相等默认算满足（inclusive），部分相交不算满足。
 */
export function closedIntervalVerdict(input: {
  minQ: number
  maxQ: number
  lowerQ: number
  upperQ: number
  inclusive?: boolean
}): {
  satisfied: boolean
  lowerMarginQ: number
  upperMarginQ: number
  codes: RequirementReasonCode[]
} {
  const inclusive = input.inclusive ?? true
  const lowerOk = inclusive ? input.minQ >= input.lowerQ : input.minQ > input.lowerQ
  const upperOk = inclusive ? input.maxQ <= input.upperQ : input.maxQ < input.upperQ
  const lowerMarginQ = input.minQ - input.lowerQ
  const upperMarginQ = input.upperQ - input.maxQ
  if (lowerOk && upperOk) {
    return { satisfied: true, lowerMarginQ, upperMarginQ, codes: ['WITHIN_REQUIREMENT'] }
  }
  const codes: RequirementReasonCode[] = []
  if (!lowerOk) codes.push('LOWER_VIOLATED')
  if (!upperOk) codes.push('UPPER_VIOLATED')
  return {
    satisfied: false,
    lowerMarginQ,
    upperMarginQ,
    codes: codes.length === 2 ? ['BOTH_VIOLATED'] : codes,
  }
}

function numericVerdict(
  requirement: RequirementRevision,
  chain: ChainDefinition,
): { result: ChainResult; status: RequirementCheckStatus; codes: RequirementReasonCode[] } {
  // 只替换临时副本的 target；原链及其 target 不变（不写回 chain.target）。
  const probe: ChainDefinition = {
    terms: chain.terms.map((term) => ({ ...term })),
    target: { minQ: requirement.lowerQ, maxQ: requirement.upperQ },
    assumptions: chain.assumptions,
  }
  const result = calculateChain(probe)
  const verdict = closedIntervalVerdict({
    minQ: result.minQ,
    maxQ: result.maxQ,
    lowerQ: requirement.lowerQ,
    upperQ: requirement.upperQ,
  })
  return {
    result,
    status: verdict.satisfied ? 'satisfied' : 'unsatisfied',
    codes: verdict.codes,
  }
}

/**
 * 计算一次候选条款检查；不修改正式项目。
 *
 * 无条款/规则不支持/输入无效 → 未检查（区间与裕量为 null）；
 * 换版/不可读/表单未确认/绑定待核 → 待确认（可带候选数值）；
 * 其余按闭区间给满足/不满足。
 */
export async function computeCandidateRequirementCheck(
  input: RequirementCheckInput,
): Promise<RequirementCheckResult> {
  return computeRequirementCheck(input)
}

/**
 * 提交调用域：只接受原始输入，内部独立计算；不接受预览、chain 或 computation。
 * 私有链副本仅由无参数闭包使用，不向公共 standalone check 增加可信结果入口。
 * 返回的 computation 即使被调用者修改，也不能替换闭包中的检查依据。
 */
export function createRecomputedRequirementContext(
  input: RequirementCheckInput & { draft: NonNullable<RequirementCheckInput['draft']> },
  options: ComputeChangeOptions,
) {
  const computation = computeChange(input.snapshot, input.draft, options)
  const chain = cloneChain(computation.chain)
  return {
    computation,
    computeCheck: () => computeRequirementCheck(input, chain),
  }
}

async function computeRequirementCheck(
  input: RequirementCheckInput,
  recomputedChain?: ChainDefinition,
): Promise<RequirementCheckResult> {
  const { snapshot } = input
  const chainRef = { projectId: snapshot.project.id, kind: 'project-dimension-chain' as const }
  const baseRevisionId = input.baseRevisionId ?? snapshot.project.currentRevisionId
  const basis: RequirementCheckBasis =
    input.basis ??
    (input.draft === null
      ? {
          kind: 'project-revision',
          projectRevisionId: baseRevisionId,
          parentRevisionId: null,
        }
      : {
          kind: 'draft',
          baseRevisionId,
          draftId: input.draft.draftId,
          draftRevision: input.draft.draftRevision,
        })
  const provenance = input.provenance ?? (basis.kind === 'draft' ? 'candidate' : 'committed')

  let requirement: RequirementRevision | null = null
  if (input.activeRequirementRevisionId !== null) {
    requirement =
      input.requirementRevisions.find(
        (item) => item.revisionId === input.activeRequirementRevisionId,
      ) ?? null
    if (requirement === null) {
      return {
        ok: false,
        error: {
          code: 'MISSING_REFERENCE',
          message: '活动条款版本不存在',
          detail: input.activeRequirementRevisionId,
        },
      }
    }
  }

  // 候选链：有隔套参数时复用 computeChange（同一极值法内核），否则直接用链。
  let chain: ChainDefinition | null = null
  let computationIssue: RequirementReasonCode | null = null
  let chainFailure: RequirementCheckError | null = null
  if (input.inputIssue === null) {
    if (hasBoundParameters(snapshot)) {
      try {
        chain = recomputedChain ?? computeChange(
          snapshot,
          {
            parameters: input.draft?.parameters ?? snapshot.project.parameters,
            bindings: input.draft?.bindings ?? parameterBindingsOf(snapshot),
          },
          { revisionId: baseRevisionId, now: input.checkedAt },
        ).chain
      } catch (error) {
        if (error instanceof ChangeError && error.code === 'INVALID_PARAMETER') {
          computationIssue = 'INVALID_INPUT'
        } else if (error instanceof ChangeError) {
          chainFailure = {
            code:
              error.code === 'DRAWING_FAILED'
                ? 'INVALID_DRAWING'
                : error.code === 'MISSING_REFERENCE'
                  ? 'MISSING_REFERENCE'
                  : error.code === 'INVALID_BINDING'
                    ? 'INVALID_BINDING'
                    : 'CALCULATION_FAILED',
            message: error.message,
            ...(error.detail === undefined ? {} : { detail: error.detail }),
          }
        } else {
          chainFailure = {
            code: 'CALCULATION_FAILED',
            message: error instanceof Error ? error.message : String(error),
          }
        }
      }
    } else {
      chain = cloneChain(snapshot.project.dimensionChain)
    }
  }
  if (chainFailure !== null) {
    return { ok: false, error: chainFailure }
  }

  const fingerprint = await computeRequirementInputFingerprint(
    buildRequirementFingerprintInput({
      snapshot,
      requirement,
      draft: input.draft,
      baseRevisionId,
      baseGeneration: input.baseGeneration ?? 0,
      acceptedSeq: input.acceptedSeq ?? 0,
    }),
  )

  let status: RequirementCheckStatus
  const codes: RequirementReasonCode[] = []
  let originalTargetResult: ChainResult | null = null

  if (chain !== null) {
    originalTargetResult = calculateChain(chain)
  }
  const verdict = requirement !== null && chain !== null
    ? numericVerdict(requirement, chain)
    : null
  const requirementResult = verdict?.result ?? null

  const pendingCodes: RequirementReasonCode[] = []
  if (requirement !== null) {
    if (input.pendingEdit !== null) pendingCodes.push('REQUIREMENT_EDIT_UNCONFIRMED')
    if (requirement.ruleType !== 'closed-interval-mm') {
      // 规则不支持属于“未检查”，不是待确认。
      codes.push('UNSUPPORTED_RULE')
    } else if (
      !Number.isSafeInteger(requirement.lowerQ) ||
      !Number.isSafeInteger(requirement.upperQ) ||
      requirement.lowerQ > requirement.upperQ
    ) {
      codes.push('MISSING_BOUNDS')
    } else {
      pendingCodes.push(...sourceProblems(snapshot, requirement))
      pendingCodes.push(...requirementBindingProblems(snapshot, requirement))
    }
  }

  if (requirement === null) {
    status = 'unchecked'
    codes.push('NO_REQUIREMENT')
  } else if (codes.includes('UNSUPPORTED_RULE') || codes.includes('MISSING_BOUNDS')) {
    status = 'unchecked'
  } else if (input.inputIssue !== null) {
    status = 'unchecked'
    codes.push(ISSUE_REASON[input.inputIssue.code])
  } else if (chain === null) {
    status = 'unchecked'
    codes.push(computationIssue ?? 'CALCULATION_UNAVAILABLE')
  } else if (pendingCodes.length > 0) {
    status = 'pending-confirmation'
    codes.push(...pendingCodes)
  } else {
    // 有条款且链有效时已计算；四态优先级不变，待确认仍可携带候选数值。
    const numeric = verdict!
    status = numeric.status
    codes.push(...numeric.codes)
  }

  const keepCandidateNumbers =
    status === 'satisfied' || status === 'unsatisfied' || status === 'pending-confirmation'
  const resultInterval =
    keepCandidateNumbers && requirementResult !== null
      ? { minQ: requirementResult.minQ, maxQ: requirementResult.maxQ }
      : null
  const margins =
    keepCandidateNumbers && requirementResult !== null
      ? {
          lowerQ: requirementResult.minQ - (requirement?.lowerQ ?? 0),
          upperQ: (requirement?.upperQ ?? 0) - requirementResult.maxQ,
        }
      : null

  const check: RequirementCheck = {
    checkId: input.checkId,
    projectId: snapshot.project.id,
    requirementRevisionId: requirement?.revisionId ?? null,
    chainRef,
    basis,
    engineVersion: snapshot.project.engineVersion,
    requirementRulesVersion: REQUIREMENT_RULES_VERSION,
    inputFingerprint: fingerprint,
    checkedAt: input.checkedAt,
    status,
    reasonCodes: [...new Set(codes)],
    resultInterval,
    margins,
    evidenceRef:
      requirement === null
        ? null
        : {
            requirementId: requirement.requirementId,
            requirementRevisionId: requirement.revisionId,
            requirementRulesVersion: REQUIREMENT_RULES_VERSION,
            source: { ...requirement.source },
            bindingBasisDigest: requirement.bindingBasis.digest,
            analysisSnapshotId: null,
            projectRevisionId:
              basis.kind === 'project-revision' ? basis.projectRevisionId : null,
            drawingFingerprint: null,
          },
    provenance,
  }

  return {
    ok: true,
    value: {
      check,
      evaluation: evaluationOf(check, status === 'satisfied'),
      chain,
      originalTargetResult,
      requirementResult,
    },
  }
}

/** 确认条款时构造 bindingBasis（身份摘要 + 当前数值，用于可追溯展示）。 */
export function buildBindingBasis(snapshot: ProjectFileSnapshot): RequirementRevision['bindingBasis'] {
  const parameters = snapshot.project.parameters.map((parameter) => ({
    parameterId: parameter.parameterId,
    key: parameter.key,
    valueQ: parameter.valueQ,
    parameterRevision: parameter.parameterRevision,
  }))
  const terms: { termId: string; nominalQ: number; termRevision: number }[] = snapshot.project.dimensionChain.terms.map(
    (term: DimensionTerm) => ({
      termId: term.id,
      nominalQ: term.nominalQ,
      termRevision: term.termRevision,
    }),
  )
  const bindings = parameterBindingsOf(snapshot).map((link) => ({
    bindingId: link.bindingId,
    termId: link.termId,
    parameterId: link.parameterId,
  }))
  return {
    parameters,
    terms,
    bindings,
    digest: bindingBasisDigest({ parameters, terms, bindings }),
  }
}

/** 供提交路径复用的“数值判定 + 闭区间”纯函数（不查来源/绑定）。 */
export function requirementVerdict(
  requirement: RequirementRevision,
  chain: ChainDefinition,
): { result: ChainResult; status: 'satisfied' | 'unsatisfied'; codes: RequirementReasonCode[] } {
  const verdict = numericVerdict(requirement, chain)
  return {
    result: verdict.result,
    status: verdict.status === 'satisfied' ? 'satisfied' : 'unsatisfied',
    codes: verdict.codes,
  }
}
