import { calculateChain } from '../domain/calculate'
import type { ChainDefinition, ChainResult } from '../domain/types'
import { validateChain } from '../domain/validation'
import { chainToDraft, draftToChain, type WorkspaceDraft } from './draft'

/**
 * 工作台正式状态。数值判定只来自 calculateChain；是否已确认和当前草稿是否
 * 有效是额外的展示门槛，必须由工作台和项目列表用同一份规则解释。
 */
export type WorkspaceStatusKind =
  | ChainResult['status']
  | 'pending'
  | 'no-result'

export interface WorkspaceStatus {
  kind: WorkspaceStatusKind
  label: string
}

const STATUS_LABEL: Record<WorkspaceStatusKind, string> = {
  within: '满足',
  outside: '不满足',
  'no-target': '未设置目标',
  pending: '待确认（预览）',
  'no-result': '暂无结果',
}

export interface WorkspaceStatusInput {
  result: ChainResult | null
  relationConfirmed: boolean
  stale: boolean
}

/**
 * 工作台已有的状态判定，供结果卡和项目列表共用。
 *
 * 没有结果时不能给出任何工程结论；草稿无效（stale）或关系未确认时只算预览，
 * 即使 calculateChain 的数值区间满足目标也不能显示“满足”。
 */
export function resolveWorkspaceStatus({
  result,
  relationConfirmed,
  stale,
}: WorkspaceStatusInput): WorkspaceStatus {
  if (result === null) {
    return { kind: 'no-result', label: STATUS_LABEL['no-result'] }
  }
  if (!relationConfirmed || stale) {
    return { kind: 'pending', label: STATUS_LABEL.pending }
  }
  return { kind: result.status, label: STATUS_LABEL[result.status] }
}

export interface StoredWorkspaceStatusInput {
  /** 已保存的最后一个有效工作方案。 */
  working: ChainDefinition
  /** 独立保存的输入草稿；没有草稿时按工作方案还原输入。 */
  draft?: WorkspaceDraft | null
}

/**
 * 从磁盘恢复时的工作台状态，必须与 useWorkspace 的规则一致：
 * 草稿有效时以草稿为准；草稿无效时保留最近一次有效工作方案的结果，
 * 但标记为 stale（结果卡显示“上次有效结果”）。
 *
 * 纯函数，不读取存储也不依赖 React；项目列表只调用这一处推导状态。
 */
export function resolveStoredWorkspaceStatus({
  working,
  draft = null,
}: StoredWorkspaceStatusInput): WorkspaceStatus {
  const effectiveDraft = draft ?? chainToDraft(working)
  const conversion = draftToChain(effectiveDraft)

  if (conversion.ok) {
    return resolveWorkspaceStatus({
      result: calculateChain(conversion.chain),
      relationConfirmed: conversion.chain.relationConfirmed,
      stale: false,
    })
  }

  const fallback = validateChain(working)
  return resolveWorkspaceStatus({
    result: fallback.ok ? calculateChain(fallback.value) : null,
    relationConfirmed: effectiveDraft.relationConfirmed,
    stale: true,
  })
}
