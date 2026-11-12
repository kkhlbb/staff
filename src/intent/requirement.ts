/**
 * ADR-001 第 3 步：把“用户给出的条款区间 + 参数/组成环绑定”冻结成一条正式条款版本。
 *
 * 为什么放在提交/预览的同一条路径里：
 * - 无任务书项目没有 PDF 版本，条款不能走既有的“选页选区”确认对话框；
 * - 但**提交仍必须校验条款**（不允许因为无来源就跳过门禁）；
 * - 因此这条版本由用户已确认的区间候选派生，只在预览/提交的候选快照里注入，
 *   与版本一起原子落盘；不在会话里偷偷写第二份真源。
 *
 * 身份是确定的：同一草稿 + 同一区间 + 同一原话 → 同一 revisionId，
 * 预览指纹与提交重算因此可以逐字比较。
 */
import type { ChainDefinition } from '../domain/types'
import type { ExtractionCandidate } from '../document-extraction/types'
import { stableId } from '../document-extraction/ids'
import type {
  ProjectFileParameterBindingLink,
  ProjectFileSpacerParameter,
} from '../project-file/types'
import type { RequirementRevision } from '../requirements/types'
import { bindingBasisDigest } from '../requirements/fingerprint'

export type IntervalCandidate = Extract<ExtractionCandidate, { kind: 'interval' }>

export function buildIntentRequirementRevision(input: {
  projectId: string
  candidate: IntervalCandidate
  chain: ChainDefinition
  parameters: readonly ProjectFileSpacerParameter[]
  bindings: readonly ProjectFileParameterBindingLink[]
  requirementId: string | null
}): RequirementRevision | null {
  const lowerQ = input.candidate.data.lower?.valueQ ?? null
  const upperQ = input.candidate.data.upper?.valueQ ?? null
  if (lowerQ === null || upperQ === null || lowerQ > upperQ) return null
  if (input.candidate.data.lowerInclusive !== true || input.candidate.data.upperInclusive !== true) {
    return null
  }
  const attestation = input.candidate.provenance?.find(
    (ref) => ref.kind === 'user-attestation',
  )
  if (attestation === undefined || attestation.kind !== 'user-attestation') return null
  const parameters = input.parameters.map((parameter) => ({
    parameterId: parameter.parameterId,
    key: parameter.key,
    valueQ: parameter.valueQ,
    parameterRevision: parameter.parameterRevision,
  }))
  const terms = input.chain.terms.map((term) => ({
    termId: term.id,
    nominalQ: term.nominalQ,
    termRevision: term.termRevision,
  }))
  const bindings = input.bindings.map((link) => ({
    bindingId: link.bindingId,
    termId: link.termId,
    parameterId: link.parameterId,
  }))
  const requirementId =
    input.requirementId ??
    stableId('intent-requirement', [input.projectId, input.candidate.candidateId])
  const revisionId = stableId('intent-requirement-revision', [
    input.projectId,
    input.candidate.candidateId,
    input.candidate.editRevision,
    lowerQ,
    upperQ,
    attestation.statement,
  ])
  return {
    requirementId,
    revisionId,
    parentRevisionId: null,
    projectId: input.projectId,
    chainRef: { projectId: input.projectId, kind: 'project-dimension-chain' },
    source: { kind: 'user-attestation', attestation },
    confirmedText: input.candidate.rawText,
    // 断言时间就是用户说这句话的时间，不用提交时刻（保证预览/提交指纹一致）。
    confirmedAt: attestation.at,
    confirmedAgainstLatestRevisionId: `intent:${input.projectId}`,
    ruleType: 'closed-interval-mm',
    lowerQ,
    upperQ,
    changeReason: '无任务书项目：条款区间由用户在对话中给出',
    bindingBasis: {
      parameters,
      terms,
      bindings,
      digest: bindingBasisDigest({ parameters, terms, bindings }),
    },
  }
}
