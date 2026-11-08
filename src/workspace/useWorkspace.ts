import { useMemo, useReducer, useState, type Dispatch } from 'react'
import { calculateChain } from '../domain/calculate'
import type { ChainDefinition, ChainResult } from '../domain/types'
import {
  draftToChain,
  emptyDraft,
  workspaceReducer,
  type CellErrors,
  type WorkspaceAction,
  type WorkspaceDraft,
} from './draft'
import {
  isRelationConfirmed,
  isRelationReviewStale,
  type RelationState,
} from './relation'

export interface UseWorkspaceResult {
  draft: WorkspaceDraft
  dispatch: Dispatch<WorkspaceAction>
  /** 当前草稿有效时是对应领域链，否则为 null。 */
  chain: ChainDefinition | null
  /** 当前或最后一次有效领域链；用于无效草稿时继续显示上次有效的目标与组成环。 */
  lastValidChain: ChainDefinition | null
  /** 只由 calculateChain 生成；草稿无效时保留最后一次有效结果。 */
  result: ChainResult | null
  cellErrors: CellErrors
  /** 当前草稿是否无效（显示中的 result 已不是当前输入的结论）。 */
  stale: boolean
  /** 由 relationRevision + 指纹 + 当前环数据派生，不是第二份可写布尔。 */
  relationConfirmed: boolean
  /** 曾确认过、但后续编辑已使凭据失效。 */
  relationReviewStale: boolean
}

const EMPTY_CELL_ERRORS: CellErrors = {}

type Evaluation =
  | { ok: false; cellErrors: CellErrors }
  | {
      ok: true
      chain: ChainDefinition
      result: ChainResult
    }

function validEvaluation(chain: ChainDefinition): Extract<Evaluation, { ok: true }> {
  return { ok: true, chain, result: calculateChain(chain) }
}

/**
 * 工作台状态。
 *
 * @param initial 首次渲染使用的草稿。
 * @param fallbackChain 从存储恢复无效草稿时，项目里最后一个有效模型；
 *   只用于首次渲染的“上次有效结果”，不会覆盖当前草稿。
 */
export function useWorkspace(
  initial?: WorkspaceDraft,
  fallbackChain?: ChainDefinition | null,
  relationState: RelationState = { relationRevision: 0, relationReview: null },
): UseWorkspaceResult {
  const [draft, dispatch] = useReducer(workspaceReducer, initial ?? emptyDraft)

  const evaluation = useMemo<Evaluation>(() => {
    const conversion = draftToChain(draft)
    if (!conversion.ok) {
      return { ok: false, cellErrors: conversion.cellErrors }
    }
    return {
      ok: true,
      chain: conversion.chain,
      result: calculateChain(conversion.chain),
    }
  }, [draft])

  // 草稿无效时保留最后一次有效结果。按 React 文档“存储前一次渲染的信息”的做法，
  // 在渲染期间用 state 记住最后一次有效的 evaluation，不在渲染期读写 ref。
  // 刷新恢复无效草稿时，项目里的最后一个有效链作为初始值，保证重新挂载后
  // 仍显示上次有效结果，而不是空白。
  const [lastValid, setLastValid] = useState<Extract<Evaluation, { ok: true }> | null>(
    () => {
      if (evaluation.ok) {
        return evaluation
      }
      if (fallbackChain !== null && fallbackChain !== undefined) {
        return validEvaluation(fallbackChain)
      }
      return null
    },
  )
  if (evaluation.ok && evaluation !== lastValid) {
    setLastValid(evaluation)
  }

  const relationConfirmed = isRelationConfirmed(
    evaluation.ok ? evaluation.chain : null,
    {
      // 草稿修订号可能已超过持久化记录（编辑先于保存）；取较大值保证旧凭据
      // 在首帧就失效，不必等 effect 再同步一次状态。
      relationRevision: Math.max(draft.relationRevision, relationState.relationRevision),
      relationReview: relationState.relationReview,
    },
  )
  const relationReviewStale = isRelationReviewStale(
    evaluation.ok ? evaluation.chain : null,
    {
      relationRevision: Math.max(draft.relationRevision, relationState.relationRevision),
      relationReview: relationState.relationReview,
    },
  )

  if (evaluation.ok) {
    return {
      draft,
      dispatch,
      chain: evaluation.chain,
      lastValidChain: evaluation.chain,
      result: evaluation.result,
      cellErrors: EMPTY_CELL_ERRORS,
      stale: false,
      relationConfirmed,
      relationReviewStale,
    }
  }

  return {
    draft,
    dispatch,
    chain: null,
    lastValidChain: lastValid?.chain ?? null,
    result: lastValid?.result ?? null,
    cellErrors: evaluation.cellErrors,
    stale: true,
    relationConfirmed: false,
    relationReviewStale,
  }
}
