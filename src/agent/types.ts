/**
 * V4.0 阶段 2：Agent 调度层共享类型。
 *
 * 这里是调度骨架、适配器与任务记录之间的唯一契约。本文件不依赖 Node 或
 * Electron API，渲染侧与主进程可以共同引用。
 */

/** §7 任务状态；顺序即文档顺序，便于证据阅读。 */
export const AGENT_TASK_STATES = [
  'idle',
  'reading',
  'awaiting-input',
  'awaiting-confirmation',
  'executing',
  'checking',
  'ready-to-commit',
  'committing',
  'completed',
  'failed',
  'cancelled',
] as const

export type AgentTaskState = (typeof AGENT_TASK_STATES)[number]

/** 阶段 1 已实现的 agent:* 工具命令。模型只能发这些调用。 */
export type AgentToolCommand = 'context' | 'confirmed' | 'apply' | 'stage' | 'preview'

export interface AgentBudget {
  /** 每轮任务最多执行的工具调用次数。 */
  maxToolCalls: number
  /** 同一工具连续相同失败上限。 */
  maxConsecutiveSameFailure: number
  /** 单次模型请求超时（毫秒）。 */
  requestTimeoutMs: number
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export interface ModelToolCall {
  name: string
  /** 原始参数 JSON；必须由调度层解析并做 JSON Schema 校验后才可执行。 */
  argumentsJson: string
}

export interface ModelReply {
  text: string
  toolCalls: ModelToolCall[]
}

export interface ToolSchema {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ModelRequest {
  taskId: string
  systemPrompt: string
  messages: ModelMessage[]
  tools: ToolSchema[]
  budget: AgentBudget
}

export type ModelEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call_start'; index: number; name: string }
  | { type: 'tool_call_args_done'; index: number; name: string; argumentsJson: string }
  | { type: 'done'; reply: ModelReply }
  | { type: 'error'; code: string; message: string }

/** §8 可替换适配器契约；真实供应商适配器在阶段 4 实现。 */
export interface ModelAdapter {
  id: string
  generate(request: ModelRequest): Promise<ModelReply>
  streamEvents(request: ModelRequest, onEvent: (event: ModelEvent) => void): Promise<ModelReply>
  cancel(taskId: string): void
}

export interface AgentTaskRecord {
  taskId: string
  projectId: string
  baseRevisionId: string
  goal: string
  modelId: string
  state: AgentTaskState
  budget: AgentBudget
  createdAt: string
  endedAt: string | null
  writes: boolean
  errorCode: string | null
  errorMessage: string | null
  transitions: { from: AgentTaskState; to: AgentTaskState; at: string }[]
  /** 取消时若已有工具进入执行，如实记录它的真实边界结果。 */
  cancelOutcome: { tool: string; result: 'ok' | 'failed'; code: string | null } | null
}

export interface AgentStepRecord {
  stepId: string
  taskId: string
  kind: 'model' | 'tool'
  /** 已脱敏：只保留工具名、参数键、短数值和摘要指纹。 */
  inputSummary: Record<string, unknown>
  outputRef: string | null
  errorCode: string | null
  durationMs: number
  idempotencyKey: string
  at: string
}
