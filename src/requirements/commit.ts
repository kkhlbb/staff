/**
 * V3.5 Beta：提交已重算的变更（领域操作 3，可独立调用）。
 *
 * 唯一提交语义：
 * - 从权威草稿**重新** computeChange，再**重新**计算条款检查；
 * - 与预览展示的检查指纹/状态比对，不一致即拒绝（旧预览/旧检查不得提交）；
 * - 只有 satisfied 可进入原人工确认流程；unsatisfied/pending/unchecked 拒绝，
 *   草稿保留；
 * - renderer 的 status/裕量/“已重算”布尔永不作为依据。
 *
 * 本函数只构造候选，不写盘；main 适配器负责 CAS、保存与发布。
 */
import type { ProjectFileSnapshot } from '../project-file/types'
import { buildCommitCandidate, type CommitCandidate } from '../revisions/commit'
import { ChangeError, computeChange } from '../revisions/compute'
import type { ChangeComputation } from '../revisions/types'
import type { RequirementCheck, RequirementEditDraft, RequirementRevision } from './types'
import {
  computeCandidateRequirementCheck,
  type RequirementCheckErrorCode,
} from './check'
import type { RequirementResult } from './confirm'

export type CommitRecomputedErrorCode =
  | 'STALE_PREVIEW'
  | 'STALE_REQUIREMENT'
  | 'STALE_DRAFT'
  | 'REQUIREMENT_NOT_SATISFIED'
  | 'REQUIREMENT_PENDING_CONFIRMATION'
  | 'REQUIREMENT_UNCHECKED'
  | 'INVALID_PARAMETER'
  | 'INVALID_DRAWING'
  | 'MISSING_REFERENCE'
  | 'INVALID_BINDING'
  | 'CALCULATION_FAILED'
  | RequirementCheckErrorCode

export interface CommitRecomputedChangeInput {
  snapshot: ProjectFileSnapshot
  draft: {
    draftId: string
    draftRevision: number
    parameters: ProjectFileSnapshot['project']['parameters']
    bindings: import('../project-file/types').ProjectFileParameterBindingLink[]
  }
  requirementRevisions: readonly RequirementRevision[]
  activeRequirementRevisionId: string | null
  pendingEdit: RequirementEditDraft | null
  /** 预览时 main 记录的条款检查；提交必须重算并与它比对。 */
  previewCheck: RequirementCheck | null
  /**
   * 预览时 main 持有的计算结果。仅用于一致性比对，**绝不作为提交结果**；
   * 重算必须从当前草稿重新执行 computeChange。
   */
  previewComputation?: ChangeComputation
  baseRevisionId: string
  baseGeneration: number
  acceptedSeq: number
  checkedAt: string
  checkId: string
  revisionId: string
  analysisSnapshotId: string
  reason: string
  restoredFromRevisionId: string | null
  /** 依赖注入仅供测试证明“提交确实重算”；生产使用真实实现。 */
  deps?: {
    computeChange?: typeof computeChange
    computeCheck?: typeof computeCandidateRequirementCheck
  }
}

export interface CommitRecomputedChangeValue {
  candidate: CommitCandidate
  computation: ChangeComputation
  check: RequirementCheck
  /** 是否启用了 Beta 门禁（无条款的老项目走原 D 路径）。 */
  requirementGate: boolean
}

/** 参数/环/结果的稳定比较键；不比较 revisionId 等每次调用都会变的身份。 */
function computationSignature(computation: ChangeComputation): string {
  return JSON.stringify({
    parameters: computation.parameters
      .map((parameter) => ({
        parameterId: parameter.parameterId,
        valueQ: parameter.valueQ,
        inputDecimals: parameter.inputDecimals,
        parameterRevision: parameter.parameterRevision,
      }))
      .sort((left, right) => (left.parameterId < right.parameterId ? -1 : 1)),
    terms: computation.chain.terms
      .map((term) => ({
        id: term.id,
        nominalQ: term.nominalQ,
        lowerDeviationQ: term.lowerDeviationQ,
        upperDeviationQ: term.upperDeviationQ,
        sign: term.sign,
      }))
      .sort((left, right) => (left.id < right.id ? -1 : 1)),
    result: {
      nominalQ: computation.result.nominalQ,
      minQ: computation.result.minQ,
      maxQ: computation.result.maxQ,
      status: computation.result.status,
    },
  })
}

export async function commitRecomputedChange(
  input: CommitRecomputedChangeInput,
): Promise<RequirementResult<CommitRecomputedChangeValue, CommitRecomputedErrorCode>> {
  const runCompute = input.deps?.computeChange ?? computeChange
  const runCheck = input.deps?.computeCheck ?? computeCandidateRequirementCheck

  let computation: ChangeComputation
  try {
    computation = runCompute(
      input.snapshot,
      { parameters: input.draft.parameters, bindings: input.draft.bindings },
      { revisionId: input.revisionId, now: input.checkedAt },
    )
  } catch (error) {
    if (error instanceof ChangeError) {
      return {
        ok: false,
        error: {
          code:
            error.code === 'DRAWING_FAILED'
              ? 'INVALID_DRAWING'
              : error.code === 'INVALID_PARAMETER'
                ? 'INVALID_PARAMETER'
                : error.code === 'MISSING_REFERENCE'
                  ? 'MISSING_REFERENCE'
                  : error.code === 'INVALID_BINDING'
                    ? 'INVALID_BINDING'
                    : 'CALCULATION_FAILED',
          message: error.message,
          ...(error.detail === undefined ? {} : { detail: error.detail }),
        },
      }
    }
    return {
      ok: false,
      error: {
        code: 'CALCULATION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }

  if (
    input.previewComputation !== undefined &&
    computationSignature(input.previewComputation) !== computationSignature(computation)
  ) {
    return {
      ok: false,
      error: {
        code: 'STALE_PREVIEW',
        message: '提交重算结果与预览计算不一致，已拒绝；请重新预览。',
      },
    }
  }

  const recomputed = await runCheck({
    snapshot: input.snapshot,
    requirementRevisions: input.requirementRevisions,
    activeRequirementRevisionId: input.activeRequirementRevisionId,
    pendingEdit: input.pendingEdit,
    draft: input.draft,
    baseRevisionId: input.baseRevisionId,
    baseGeneration: input.baseGeneration,
    acceptedSeq: input.acceptedSeq,
    checkedAt: input.checkedAt,
    checkId: input.checkId,
    inputIssue: null,
    basis: {
      kind: 'draft',
      baseRevisionId: input.baseRevisionId,
      draftId: input.draft.draftId,
      draftRevision: input.draft.draftRevision,
    },
    provenance: 'candidate',
  })
  if (!recomputed.ok) {
    return {
      ok: false,
      error: {
        code: recomputed.error.code,
        message: recomputed.error.message,
        ...(recomputed.error.detail === undefined ? {} : { detail: recomputed.error.detail }),
      },
    }
  }
  const check = recomputed.value.check
  const requirementGate = input.activeRequirementRevisionId !== null

  if (requirementGate) {
    const preview = input.previewCheck
    if (preview === null) {
      return {
        ok: false,
        error: {
          code: 'STALE_PREVIEW',
          message: '预览中没有条款检查，不能提交；请重新预览。',
        },
      }
    }
    if (preview.basis.kind === 'draft') {
      if (
        preview.basis.draftId !== input.draft.draftId ||
        preview.basis.draftRevision !== input.draft.draftRevision
      ) {
        return {
          ok: false,
          error: {
            code: 'STALE_DRAFT',
            message: '草稿在预览后已变化，旧预览不能提交；请重新预览。',
          },
        }
      }
    }
    // 指纹覆盖条款版本、来源精确版本与可读性、参数/组成环/绑定、target 与版本。
    if (
      preview.inputFingerprint !== check.inputFingerprint ||
      preview.requirementRevisionId !== check.requirementRevisionId
    ) {
      return {
        ok: false,
        error: {
          code: 'STALE_REQUIREMENT',
          message: '条款或来源/输入在预览后已变化，旧检查不能提交；请重新预览。',
          detail: `preview=${preview.status}/${preview.inputFingerprint.slice(0, 12)}，recomputed=${
            check.status
          }/${check.inputFingerprint.slice(0, 12)}`,
        },
      }
    }
    if (check.status === 'unsatisfied') {
      return {
        ok: false,
        error: {
          code: 'REQUIREMENT_NOT_SATISFIED',
          message: '条款检查不满足要求，禁止参数正式提交；草稿与证据已保留。',
          reasonCodes: [...check.reasonCodes],
        },
      }
    }
    if (check.status === 'pending-confirmation') {
      return {
        ok: false,
        error: {
          code: 'REQUIREMENT_PENDING_CONFIRMATION',
          message: '条款检查待确认，禁止参数正式提交；请先补齐来源/绑定/条款确认。',
          reasonCodes: [...check.reasonCodes],
        },
      }
    }
    if (check.status === 'unchecked') {
      return {
        ok: false,
        error: {
          code: 'REQUIREMENT_UNCHECKED',
          message: '条款检查未完成，禁止参数正式提交；请修正输入后重新预览。',
          reasonCodes: [...check.reasonCodes],
        },
      }
    }
  }

  // 写入正式聚合前把来源标为 committed：候选检查一旦随原子提交落盘，就不再是“候选”。
  const committedCheck: RequirementCheck = { ...check, provenance: 'committed' }
  const candidate = buildCommitCandidate(input.snapshot, computation, {
    revisionId: input.revisionId,
    analysisSnapshotId: input.analysisSnapshotId,
    createdAt: input.checkedAt,
    reason: input.reason,
    restoredFromRevisionId: input.restoredFromRevisionId,
    reauthenticateBindings: false,
    ...(requirementGate
      ? {
          requirement: {
            requirementRevisionId: committedCheck.requirementRevisionId,
            check: committedCheck,
          },
        }
      : {}),
  })

  return {
    ok: true,
    value: { candidate, computation, check: committedCheck, requirementGate },
  }
}
