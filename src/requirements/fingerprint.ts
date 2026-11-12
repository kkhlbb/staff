/**
 * V3.5 Beta：条款检查指纹（canonicalJson + SHA-256）。
 *
 * 指纹只覆盖**输入**，不覆盖输出身份：checkId、checkedAt、inputFingerprint
 * 本身以及创建中的 Revision ID 都不参与哈希，避免自引用。
 *
 * 覆盖范围（任务卡 §12 已定）：
 * - 项目/链固定引用、基准 Revision 与代数、acceptedSeq；
 * - 条款 requirementId/revisionId/原文/规则/上下限/确认依据/来源精确版本与区域；
 * - 参数 ID/值/修订/显示位/来源备注，组成环数值/偏差/方向/修订，绑定身份；
 * - 原项目 target（只用于让旧预览过期，**绝不**作为条款通过依据）；
 * - 引擎与规则版本、来源当前最新版本与可读性。
 */
import type { ChainDefinition, DimensionTerm } from '../domain/types'
import { ENGINE_VERSION } from '../domain/calculate'
import type { ProjectFileSnapshot } from '../project-file/types'
import { canonicalJson, stableFingerprint } from '../revisions/canonical'
import { sha256Hex } from '../sources/hash'
import { REQUIREMENT_RULES_VERSION, isPdfRequirementSource } from './types'
import type {
  RequirementBindingBasis,
  RequirementChainRef,
  RequirementCheck,
  RequirementRevision,
} from './types'

export interface RequirementDraftInput {
  draftId: string
  draftRevision: number
  parameters: ProjectFileSnapshot['project']['parameters']
  bindings: import('../project-file/types').ProjectFileParameterBindingLink[]
}

export interface RequirementFingerprintInput {
  projectId: string
  chainRef: RequirementChainRef
  baseRevisionId: string
  baseGeneration: number
  acceptedSeq: number
  requirement: RequirementRevision | null
  /** 原项目目标：纳入摘要以便旧预览过期，但判定不读它。 */
  target: { minQ: number; maxQ: number } | null
  chain: { terms: DimensionTerm[]; assumptions: string }
  draft: RequirementDraftInput | null
  sourceAvailability: {
    documentId: string
    latestRevisionId: string
    revisionId: string | null
    readable: boolean
    sha256: string | null
  }[]
  engineVersion: string
  requirementRulesVersion: string
}

export function bindingBasisDigest(basis: Omit<RequirementBindingBasis, 'digest'>): string {
  return stableFingerprint({
    parameters: basis.parameters.map((item) => ({
      parameterId: item.parameterId,
      key: item.key,
      valueQ: item.valueQ,
      parameterRevision: item.parameterRevision,
    })),
    terms: basis.terms.map((item) => ({
      termId: item.termId,
      nominalQ: item.nominalQ,
      termRevision: item.termRevision,
    })),
    bindings: basis.bindings.map((item) => ({
      bindingId: item.bindingId,
      termId: item.termId,
      parameterId: item.parameterId,
    })),
  })
}

/**
 * 从权威聚合与草稿构造指纹输入。`requirement` 为 null 表示当前无活动条款
 * （仍会产出指纹，供“无条款 → 未检查”的历史证据使用）。
 */
export function buildRequirementFingerprintInput(options: {
  snapshot: ProjectFileSnapshot
  requirement: RequirementRevision | null
  draft: RequirementDraftInput | null
  baseRevisionId: string
  baseGeneration: number
  acceptedSeq: number
}): RequirementFingerprintInput {
  const { snapshot, requirement, draft } = options
  const readableBlobKeys = new Set(snapshot.attachments.map((item) => item.blobKey))
  const missingBlobKeys = new Set(snapshot.missingAttachments.map((item) => item.blobKey))
  const revisions = new Map(snapshot.revisions.map((item) => [item.id, item]))
  const chain: ChainDefinition = snapshot.project.dimensionChain
  return {
    projectId: snapshot.project.id,
    chainRef: {
      projectId: snapshot.project.id,
      kind: 'project-dimension-chain',
    },
    baseRevisionId: options.baseRevisionId,
    baseGeneration: options.baseGeneration,
    acceptedSeq: options.acceptedSeq,
    requirement,
    target: chain.target,
    chain: { terms: chain.terms, assumptions: chain.assumptions },
    draft,
    sourceAvailability: snapshot.documents.map((document) => {
      const latest = revisions.get(document.latestRevisionId) ?? null
      return {
        documentId: document.id,
        latestRevisionId: document.latestRevisionId,
        revisionId: latest?.id ?? null,
        readable:
          latest !== null &&
          (readableBlobKeys.has(latest.blobKey) || missingBlobKeys.has(latest.blobKey)),
        sha256: latest?.sha256 ?? null,
      }
    }),
    engineVersion: snapshot.project.engineVersion,
    requirementRulesVersion: REQUIREMENT_RULES_VERSION,
  }
}

export async function computeRequirementInputFingerprint(
  input: RequirementFingerprintInput,
): Promise<string> {
  const payload = {
    projectId: input.projectId,
    chainRef: input.chainRef,
    baseRevisionId: input.baseRevisionId,
    baseGeneration: input.baseGeneration,
    acceptedSeq: input.acceptedSeq,
    requirement:
      input.requirement === null
        ? null
        : {
            requirementId: input.requirement.requirementId,
            revisionId: input.requirement.revisionId,
            parentRevisionId: input.requirement.parentRevisionId,
            chainRef: input.requirement.chainRef,
            ruleType: input.requirement.ruleType,
            lowerQ: input.requirement.lowerQ,
            upperQ: input.requirement.upperQ,
            confirmedText: input.requirement.confirmedText,
            confirmedAt: input.requirement.confirmedAt,
            confirmedAgainstLatestRevisionId:
              input.requirement.confirmedAgainstLatestRevisionId,
            source: isPdfRequirementSource(input.requirement.source)
              ? {
                  documentId: input.requirement.source.documentId,
                  revisionId: input.requirement.source.revisionId,
                  sha256: input.requirement.source.sha256,
                  blobKey: input.requirement.source.blobKey,
                  page: input.requirement.source.page,
                  rectPdf: input.requirement.source.rectPdf,
                  pageBoxPdf: input.requirement.source.pageBoxPdf,
                }
              : {
                  // 用户断言来源：不伪造页码/哈希，只把“谁在第几次输入里说的原话”纳入指纹。
                  kind: 'user-attestation',
                  actorId: input.requirement.source.attestation.actorId,
                  sessionSeq: input.requirement.source.attestation.sessionSeq,
                  fieldPath: input.requirement.source.attestation.fieldPath,
                  statement: input.requirement.source.attestation.statement,
                },
            bindingBasis: input.requirement.bindingBasis.digest,
          },
    // target 纳入摘要：target 改变会使旧预览/旧候选过期；但判定不读它。
    target: input.target,
    chain: {
      assumptions: input.chain.assumptions,
      terms: input.chain.terms.map((term) => ({
        id: term.id,
        symbol: term.symbol,
        name: term.name,
        nominalQ: term.nominalQ,
        lowerDeviationQ: term.lowerDeviationQ,
        upperDeviationQ: term.upperDeviationQ,
        sign: term.sign,
        termRevision: term.termRevision,
        sourceNote: term.sourceNote,
      })),
    },
    draft:
      input.draft === null
        ? null
        : {
            draftId: input.draft.draftId,
            draftRevision: input.draft.draftRevision,
            parameters: input.draft.parameters
              .map((parameter) => ({
                parameterId: parameter.parameterId,
                partId: parameter.partId,
                key: parameter.key,
                valueQ: parameter.valueQ,
                inputDecimals: parameter.inputDecimals,
                parameterRevision: parameter.parameterRevision,
                sourceNote: parameter.sourceNote ?? '',
              }))
              .sort((left, right) => (left.parameterId < right.parameterId ? -1 : 1)),
            bindings: input.draft.bindings
              .filter((link) => link.kind === 'parameter-binding')
              .map((link) => ({
                bindingId: link.bindingId,
                termId: link.termId,
                parameterId: link.parameterId,
                syncField: link.syncField,
              }))
              .sort((left, right) => (left.bindingId < right.bindingId ? -1 : 1)),
          },
    versions: {
      engineVersion: input.engineVersion,
      requirementRulesVersion: input.requirementRulesVersion,
      engineConstant: ENGINE_VERSION,
    },
    sourceAvailability: [...input.sourceAvailability].sort((left, right) =>
      left.documentId < right.documentId ? -1 : 1,
    ),
  }
  return sha256Hex(new TextEncoder().encode(canonicalJson(payload)))
}

/** 过期性派生：指纹与当前对象不一致即过期；历史 check 的 status 不被改写。 */
export function isRequirementCheckStale(
  check: RequirementCheck,
  currentFingerprint: string,
): boolean {
  return check.inputFingerprint !== currentFingerprint
}
