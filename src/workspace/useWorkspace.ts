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

export interface UseWorkspaceResult {
  draft: WorkspaceDraft
  dispatch: Dispatch<WorkspaceAction>
  /** 当前草稿有效时是对应领域链，否则为 null。 */
  chain: ChainDefinition | null
  /** 只由 calculateChain 生成；草稿无效时保留最后一次有效结果。 */
  result: ChainResult | null
  cellErrors: CellErrors
  /** 当前草稿是否无效（显示中的 result 已不是当前输入的结论）。 */
  stale: boolean
}

const EMPTY_CELL_ERRORS: CellErrors = {}

type Evaluation =
  | { ok: false; cellErrors: CellErrors }
  | {
      ok: true
      chain: ChainDefinition
      result: ChainResult
    }

export function useWorkspace(initial?: WorkspaceDraft): UseWorkspaceResult {
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
  const [lastValid, setLastValid] = useState<Extract<Evaluation, { ok: true }> | null>(
    evaluation.ok ? evaluation : null,
  )
  if (evaluation.ok && evaluation !== lastValid) {
    setLastValid(evaluation)
  }

  if (evaluation.ok) {
    return {
      draft,
      dispatch,
      chain: evaluation.chain,
      result: evaluation.result,
      cellErrors: EMPTY_CELL_ERRORS,
      stale: false,
    }
  }

  return {
    draft,
    dispatch,
    chain: null,
    result: lastValid?.result ?? null,
    cellErrors: evaluation.cellErrors,
    stale: true,
  }
}
