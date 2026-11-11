/**
 * §7 任务状态机：合法迁移表显式定义，非法迁移返回 INVALID_INPUT 且保持原状态。
 *
 * 设计说明（阶段 2）：
 * - failed 允许回到 reading，用于“模型超时后保留草稿继续”。
 * - cancelled 是终态；用户要再来一轮应新建任务。
 * - ready-to-commit 在阶段 2 没有提交能力，任务停在 ready-to-commit 并等待阶段 3。
 */
import type { AgentTaskState } from './types'

export const LEGAL_TRANSITIONS: Readonly<Record<AgentTaskState, readonly AgentTaskState[]>> = {
  idle: ['reading', 'failed', 'cancelled'],
  reading: ['executing', 'checking', 'awaiting-input', 'awaiting-confirmation', 'ready-to-commit', 'completed', 'failed', 'cancelled'],
  'awaiting-input': ['reading', 'failed', 'cancelled'],
  'awaiting-confirmation': ['reading', 'committing', 'cancelled'],
  executing: ['reading', 'checking', 'failed', 'cancelled'],
  checking: ['ready-to-commit', 'reading', 'awaiting-input', 'failed', 'cancelled'],
  'ready-to-commit': ['awaiting-confirmation', 'completed', 'cancelled'],
  committing: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: ['reading'],
  cancelled: [],
}

export type TransitionResult =
  | { ok: true; to: AgentTaskState }
  | { ok: false; code: 'INVALID_INPUT'; message: string }

export function canTransition(from: AgentTaskState, to: AgentTaskState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to)
}

export function nextState(from: AgentTaskState, to: AgentTaskState): TransitionResult {
  if (!canTransition(from, to)) {
    return { ok: false, code: 'INVALID_INPUT', message: `非法状态迁移：${from} → ${to}` }
  }
  return { ok: true, to }
}

export function isTerminal(state: AgentTaskState): boolean {
  return LEGAL_TRANSITIONS[state].length === 0
}
