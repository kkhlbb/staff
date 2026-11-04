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

/** 报告被拒绝的原因；工作台入口和打印页必须显示同一份说明。 */
export type ReportBlockReason = 'invalid-draft' | 'unconfirmed'

export const REPORT_BLOCK_MESSAGE: Record<ReportBlockReason, string> = {
  'invalid-draft':
    '当前输入未通过校验或不是有效方案，不能打印报告。请修正输入并重新核对尺寸关系。',
  unconfirmed:
    '尺寸关系与作用方向尚未确认，不能打印报告。请先勾选“已核对尺寸关系与作用方向”。',
}

export interface ReportEligibility {
  eligible: boolean
  status: WorkspaceStatus
  reason: ReportBlockReason | null
  message: string | null
}

/**
 * 报告门槛：只有“当前草稿有效且关系已确认”的正式方案可以出报告。
 *
 * 复用 resolveWorkspaceStatus，所以工作台入口、项目列表和打印页对
 * “待确认 / 暂无结果”的解释保持一致；未设置目标仍是有效且已确认的方案。
 */
export function resolveReportEligibility(
  input: WorkspaceStatusInput,
): ReportEligibility {
  const status = resolveWorkspaceStatus(input)

  if (status.kind === 'pending' || status.kind === 'no-result') {
    const reason: ReportBlockReason =
      input.result === null || input.stale ? 'invalid-draft' : 'unconfirmed'
    return {
      eligible: false,
      status,
      reason,
      message: REPORT_BLOCK_MESSAGE[reason],
    }
  }

  return { eligible: true, status, reason: null, message: null }
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
