/**
 * V4.0 阶段 2：Agent 调度骨架。
 *
 * 边界：
 * - 模型只能发工具调用；调度层先解析 JSON、再按 JSON Schema 校验，之后才把
 *   调用交给注入的 dispatcher（生产实现调用阶段 1 的 AgentToolService）。
 * - 任务是否成功以工具 ToolResult 为准；模型自述只作为文本，不构成回执。
 * - 陈旧回包按 taskId + projectId 丢弃；切换项目后不得写入新项目。
 * - 取消后未执行的调用不再执行；已进入执行的调用跑到成功/失败边界并如实记录。
 */
import { randomUUID } from 'node:crypto'
import { fingerprint, redactText, summarizeArguments, summarizeMessages } from '../../src/agent/redact'
import { formatQWithDecimals } from '../../src/drawing/formatDimension'
import { isTerminal, nextState } from '../../src/agent/stateMachine'
import { MODEL_TOOL_SCHEMAS, validateToolArguments } from '../../src/agent/toolSchemas'
import type {
  AgentBudget,
  AgentStepRecord,
  AgentTaskRecord,
  AgentTaskState,
  AgentToolCommand,
  ModelAdapter,
  ModelEvent,
  ModelMessage,
  ModelReply,
  ModelRequest,
} from '../../src/agent/types'
import type { ToolResult } from '../shared/contracts'
import { AgentTaskStore } from './agentTaskStore'
import { ModelAdapterError, ModelAdapterRegistry, type ProviderStatus } from './modelAdapter'

export const DEFAULT_AGENT_BUDGET: AgentBudget = {
  maxToolCalls: 20,
  maxConsecutiveSameFailure: 2,
  requestTimeoutMs: 120_000,
}

export const DEFAULT_SYSTEM_PROMPT = [
  '你是寸链工程 Agent。',
  '你不能直接修改项目文件；只能调用提供的工具，由应用校验参数后执行。',
  '工具回执是唯一事实：工具返回失败时不得声称已保存。',
  '参数不合法时不要猜测或改写参数，应报告需要补充的信息。',
].join('\n')

export interface AgentToolDispatch {
  taskId: string
  projectId: string
  command: AgentToolCommand
  arguments: unknown
  /** 本轮用户原话（逐字）；无任务书工具据此校验“值来自人”。 */
  userText: string
  /** 无任务书建项的责任人（用户界面手输）；不由模型提供。 */
  intentIdentity?: { actorId: string; sessionLabel: string | null }
}

export interface AgentToolDispatcher {
  dispatch(call: AgentToolDispatch): Promise<ToolResult<unknown>>
}

/** 工具回执进模型上下文的字节预算；超出时保留结构并注明截断，不丢 ok/code。 */
export const TOOL_MESSAGE_MAX_CHARS = 24_000

/** 草稿类工具回执在进模型上下文前压缩：去掉图纸/差分，保留复核所需字段。 */
function compactDraftData(data: unknown): unknown {
  if (data === null || typeof data !== 'object') return data
  const value = data as Record<string, unknown>
  if (typeof value.draftId !== 'string') return data
  const mm = (q: unknown): string | undefined => typeof q === 'number' ? (formatQWithDecimals(q, 4) ?? String(q)) : undefined
  const parameters = Array.isArray(value.parameters)
    ? value.parameters.map((parameter) => {
        const item = parameter as { key?: unknown; valueQ?: unknown; inputDecimals?: unknown; reviewStatus?: unknown }
        return { key: item.key, valueQ: item.valueQ, valueMm: mm(item.valueQ), inputDecimals: item.inputDecimals, reviewStatus: item.reviewStatus }
      })
    : []
  const computation = value.computation as { result?: { minQ?: number; maxQ?: number; status?: string }; chain?: { terms?: { symbol: string; nominalQ: number; lowerDeviationQ: number; upperDeviationQ: number; sign: number }[] } } | undefined
  return {
    draftId: value.draftId,
    draftRevision: value.draftRevision,
    baseRevisionId: value.baseRevisionId,
    stale: value.stale,
    parameters,
    geometry: value.geometry,
    issues: value.issues,
    requirementPreview: (value.requirementPreview as { status?: unknown; reasonCodes?: unknown } | undefined) === undefined
      ? null
      : { status: (value.requirementPreview as { status?: unknown }).status, reasonCodes: (value.requirementPreview as { reasonCodes?: unknown }).reasonCodes },
    result: computation?.result === undefined ? null : { ...computation.result, minMm: mm(computation.result.minQ), maxMm: mm(computation.result.maxQ) },
    chainTerms: computation?.chain?.terms ?? [],
    ...(typeof value.previewId === 'string' ? { previewId: value.previewId } : {}),
    ...(typeof value.previewFingerprint === 'string' ? { previewFingerprint: value.previewFingerprint } : {}),
  }
}

/**
 * 工具消息内容：成功带 data，失败带 code/message/details。
 * 模型只能看到这里的实际回执，不能用自述替代。
 */
export function toolMessageContent(tool: string, result: ToolResult<unknown>): string {
  const data = result.ok && (tool === 'apply' || tool === 'stage' || tool === 'preview')
    ? compactDraftData(result.data)
    : result.ok ? result.data : undefined
  const payload: Record<string, unknown> = result.ok
    ? { tool, ok: true, code: null, objectVersion: result.objectVersion, data }
    : { tool, ok: false, code: result.code, message: result.message, ...(result.details === undefined ? {} : { details: result.details }) }
  const text = JSON.stringify(payload)
  if (text.length <= TOOL_MESSAGE_MAX_CHARS) return text
  return JSON.stringify({
    tool,
    ok: payload.ok,
    code: payload.code,
    truncated: true,
    limitChars: TOOL_MESSAGE_MAX_CHARS,
    preview: text.slice(0, TOOL_MESSAGE_MAX_CHARS),
  })
}

export interface StartAgentTaskOptions {
  projectId: string
  baseRevisionId: string
  goal: string
  modelId?: string
  writes?: boolean
  systemPrompt?: string
  messages?: ModelMessage[]
  taskId?: string
  /** 用户界面注入的责任人；模型不可见、不可改。 */
  intentIdentity?: { actorId: string; sessionLabel: string | null }
}

export type AgentFailureCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'CONSTRAINT_VIOLATED'
  | 'INVALID_INPUT'
  | 'STALE_BASE'

export type StartAgentTaskResult =
  | { ok: true; taskId: string; completion: Promise<AgentTaskRecord> }
  | { ok: false; code: AgentFailureCode; message: string }

export type ResumeAgentTaskResult =
  | { ok: true; completion: Promise<AgentTaskRecord> }
  | { ok: false; code: AgentFailureCode; message: string }

export type CancelAgentTaskResult =
  | { ok: true; state: AgentTaskState }
  | { ok: false; code: 'INVALID_INPUT'; message: string }

export interface AgentSchedulerDeps {
  store: AgentTaskStore
  dispatch: AgentToolDispatcher
  adapters: ModelAdapterRegistry
  provider: { getProviderStatus(): ProviderStatus }
  activeProjectId: string
  now?: () => number
  budget?: Partial<AgentBudget>
  /** 阶段 3：任务/步骤落盘后通知侧栏；不参与调度判定。 */
  onUpdate?: (taskId: string) => void
}

interface TaskEntry {
  task: AgentTaskRecord
  steps: AgentStepRecord[]
  events: ModelEvent[]
  options: StartAgentTaskOptions
  adapter: ModelAdapter
  cancelRequested: boolean
  completion: Promise<AgentTaskRecord> | null
}

class ModelTimeoutError extends Error {
  constructor() {
    super('模型请求超时')
    this.name = 'ModelTimeoutError'
  }
}

export class AgentScheduler {
  private readonly deps: AgentSchedulerDeps
  private readonly tasks = new Map<string, TaskEntry>()
  private readonly writeLocks = new Map<string, string>()
  private activeProjectId: string

  constructor(deps: AgentSchedulerDeps) {
    this.deps = deps
    this.activeProjectId = deps.activeProjectId
  }

  getActiveProjectId(): string {
    return this.activeProjectId
  }

  setActiveProject(projectId: string): void {
    if (projectId === this.activeProjectId) return
    this.activeProjectId = projectId
    // 只是取消旧任务的模型等待；晚到回包由 isStaleReply 的 taskId+projectId 身份检查丢弃。
    for (const entry of this.tasks.values()) {
      if (entry.task.projectId !== projectId && !isTerminal(entry.task.state)) {
        entry.adapter.cancel(entry.task.taskId)
      }
    }
  }

  async startTask(options: StartAgentTaskOptions): Promise<StartAgentTaskResult> {
    const status = this.deps.provider.getProviderStatus()
    if (!status.configured) {
      return { ok: false, code: 'MODEL_NOT_CONFIGURED', message: '模型尚未配置；阶段 2 只提供假模型，不会假装可用' }
    }
    if (options.projectId !== this.activeProjectId) {
      return { ok: false, code: 'STALE_BASE', message: '目标项目不是当前活动项目' }
    }
    const writes = options.writes ?? true
    if (writes && this.writeLocks.has(options.projectId)) {
      return { ok: false, code: 'CONSTRAINT_VIOLATED', message: '同一项目已有进行中的 Agent 写任务' }
    }
    const modelId = options.modelId ?? 'fake-1'
    const adapter = this.deps.adapters.get(modelId)
    if (adapter === undefined) {
      return { ok: false, code: 'MODEL_NOT_CONFIGURED', message: `模型适配器 ${modelId} 未注册` }
    }
    const taskId = options.taskId ?? randomUUID()
    const budget: AgentBudget = { ...DEFAULT_AGENT_BUDGET, ...(this.deps.budget ?? {}) }
    const task: AgentTaskRecord = {
      taskId,
      projectId: options.projectId,
      baseRevisionId: options.baseRevisionId,
      goal: redactText(options.goal, 160),
      modelId,
      state: 'idle',
      budget,
      createdAt: this.iso(),
      endedAt: null,
      writes,
      errorCode: null,
      errorMessage: null,
      transitions: [],
      cancelOutcome: null,
    }
    const entry: TaskEntry = {
      task,
      steps: [],
      events: [],
      options: { ...options, writes },
      adapter,
      cancelRequested: false,
      completion: null,
    }
    this.tasks.set(taskId, entry)
    if (writes) this.writeLocks.set(options.projectId, taskId)
    await this.deps.store.save(task, [])
    const completion = this.runLoop(entry).finally(() => this.releaseLock(entry))
    entry.completion = completion
    return { ok: true, taskId, completion }
  }

  async resumeTask(taskId: string): Promise<ResumeAgentTaskResult> {
    const entry = this.tasks.get(taskId)
    if (entry === undefined) return { ok: false, code: 'INVALID_INPUT', message: '任务不存在' }
    if (entry.task.state !== 'failed' && entry.task.state !== 'awaiting-input') {
      return { ok: false, code: 'INVALID_INPUT', message: '只有 failed 或 awaiting-input 任务可以继续' }
    }
    if (entry.task.projectId !== this.activeProjectId) {
      return { ok: false, code: 'STALE_BASE', message: '任务所属项目不是当前活动项目' }
    }
    const holder = this.writeLocks.get(entry.task.projectId)
    if (entry.task.writes && holder !== undefined && holder !== taskId) {
      return { ok: false, code: 'CONSTRAINT_VIOLATED', message: '同一项目已有进行中的 Agent 写任务' }
    }
    if (entry.task.writes) this.writeLocks.set(entry.task.projectId, taskId)
    entry.cancelRequested = false
    entry.task.errorCode = null
    entry.task.errorMessage = null
    entry.task.endedAt = null
    entry.task.cancelOutcome = null
    // §4：恢复前先读当前正式版本与来源，只追加新步骤，不用旧记录覆盖现状。
    const probe = await this.probeResumeContext(entry)
    if (!probe.ok) {
      entry.task.errorCode = probe.code
      entry.task.errorMessage = redactText(probe.message, 120)
      await this.persist(entry)
      return { ok: false, code: 'STALE_BASE', message: probe.message }
    }
    const completion = this.runLoop(entry).finally(() => this.releaseLock(entry))
    entry.completion = completion
    return { ok: true, completion }
  }

  /**
   * 取消只置标志并通知适配器；不立刻把状态写成 cancelled。
   * 若工具正在执行，它必须跑到成功/失败边界后由调度层记录真实结果。
   */
  async cancel(taskId: string): Promise<CancelAgentTaskResult> {
    const entry = this.tasks.get(taskId)
    if (entry === undefined) return { ok: false, code: 'INVALID_INPUT', message: '任务不存在' }
    if (isTerminal(entry.task.state)) return { ok: false, code: 'INVALID_INPUT', message: '任务已结束' }
    entry.cancelRequested = true
    entry.adapter.cancel(taskId)
    await this.deps.store.save(entry.task, entry.steps)
    return { ok: true, state: entry.task.state }
  }

  getTask(taskId: string): AgentTaskRecord | null {
    const entry = this.tasks.get(taskId)
    return entry === undefined ? null : structuredClone(entry.task)
  }

  getSteps(taskId: string): AgentStepRecord[] {
    const entry = this.tasks.get(taskId)
    return entry === undefined ? [] : structuredClone(entry.steps)
  }

  getTrace(taskId: string): { task: AgentTaskRecord; steps: AgentStepRecord[]; events: ModelEvent[] } | null {
    const entry = this.tasks.get(taskId)
    if (entry === undefined) return null
    return { task: structuredClone(entry.task), steps: structuredClone(entry.steps), events: structuredClone(entry.events) }
  }

  private async runLoop(entry: TaskEntry): Promise<AgentTaskRecord> {
    const budget = entry.task.budget
    const options = entry.options
    const messages: ModelMessage[] = [...(options.messages ?? [])]
    let callsMade = 0
    let consecutiveKey: string | null = null
    let consecutiveCount = 0
    let anyToolFailed = false
    let previewOk = false
    let lastFailure: { code: string; message: string } | null = null
    try {
      await this.move(entry, 'reading')
      for (;;) {
        if (this.isStaleReply(entry)) return await this.finishStale(entry)
        if (entry.cancelRequested) return await this.finish(entry, 'cancelled', 'CANCELLED', '取消发生在下一次模型请求之前')
        const request: ModelRequest = {
          taskId: entry.task.taskId,
          systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
          messages: [...messages],
          tools: MODEL_TOOL_SCHEMAS,
          budget,
        }
        const startedAt = this.now()
        let reply: ModelReply | null = null
        let failure: { code: string; message: string } | null = null
        try {
          reply = await this.withTimeout(
            entry.adapter.streamEvents(request, (event) => { entry.events.push(event) }),
            budget.requestTimeoutMs,
            () => entry.adapter.cancel(entry.task.taskId),
          )
        } catch (error) {
          failure = this.classifyModelError(error)
        }
        const durationMs = Math.max(0, this.now() - startedAt)
        if (failure !== null || reply === null) {
          const code = failure?.code ?? 'TOOL_FAILED'
          await this.recordStep(entry, {
            kind: 'model',
            inputSummary: { request: this.requestSummary(request) },
            outputRef: null,
            errorCode: code,
            durationMs,
          })
          if (this.isStaleReply(entry)) return await this.finishStale(entry)
          if (entry.cancelRequested) return await this.finish(entry, 'cancelled', 'CANCELLED', '取消时模型请求以错误结束')
          return await this.finish(entry, 'failed', code, failure?.message ?? '模型请求失败')
        }
        if (this.isStaleReply(entry)) return await this.finishStale(entry)
        if (entry.cancelRequested) {
          await this.recordStep(entry, {
            kind: 'model',
            inputSummary: { request: this.requestSummary(request) },
            outputRef: `reply:${reply.text.length}:${fingerprint(reply.text)}`,
            errorCode: 'CANCELLED',
            durationMs,
          })
          return await this.finish(entry, 'cancelled', 'CANCELLED', '取消后到达的模型回包已丢弃')
        }
        await this.recordStep(entry, {
          kind: 'model',
          inputSummary: { request: this.requestSummary(request), ...(reply.usage === undefined ? {} : { usage: reply.usage }) },
          outputRef: `reply:${reply.text.length}:${fingerprint(reply.text)}`,
          errorCode: null,
          durationMs,
        })
        if (reply.toolCalls.length === 0) {
          // M11: 是否成功只看工具回执，模型文本不能覆盖失败。
          const target: AgentTaskState = anyToolFailed ? 'failed' : previewOk ? 'ready-to-commit' : 'completed'
          return await this.finish(entry, target, anyToolFailed ? lastFailure?.code ?? 'TOOL_FAILED' : null,
            anyToolFailed ? lastFailure?.message ?? '工具执行失败' : null)
        }
        if (reply.text.length > 0 || reply.toolCalls.length > 0) {
          messages.push({ role: 'assistant', content: reply.text, ...(reply.toolCalls.length === 0 ? {} : { toolCalls: reply.toolCalls }) })
        }
        for (const call of reply.toolCalls) {
          if (this.isStaleReply(entry)) return await this.finishStale(entry)
          if (entry.cancelRequested) {
            await this.recordStep(entry, {
              kind: 'tool', inputSummary: { tool: call.name }, outputRef: null, errorCode: 'CANCELLED', durationMs: 0,
            })
            return await this.finish(entry, 'cancelled', 'CANCELLED', '取消后未执行的工具调用已丢弃')
          }
          if (callsMade >= budget.maxToolCalls) {
            await this.recordStep(entry, {
              kind: 'tool', inputSummary: { tool: call.name }, outputRef: null, errorCode: 'BUDGET_EXHAUSTED', durationMs: 0,
            })
            return await this.finish(entry, 'awaiting-input', 'BUDGET_EXHAUSTED',
              `本轮已达到 ${budget.maxToolCalls} 次工具调用上限；草稿与证据保留，由用户决定是否继续`)
          }
          callsMade += 1
          let args: unknown
          try {
            args = JSON.parse(call.argumentsJson)
          } catch {
            anyToolFailed = true
            lastFailure = { code: 'INVALID_INPUT', message: '工具参数不是合法 JSON' }
            await this.recordStep(entry, {
              kind: 'tool', inputSummary: { tool: call.name, arguments: '<unparsable>' }, outputRef: null, errorCode: 'INVALID_INPUT', durationMs: 0,
            })
            continue
          }
          // M10: 唯一参数门禁；校验失败绝不执行、不猜、不修参数。
          const validation = validateToolArguments(call.name, args)
          if (!validation.ok) {
            anyToolFailed = true
            lastFailure = { code: 'INVALID_INPUT', message: validation.message }
            await this.recordStep(entry, {
              kind: 'tool',
              inputSummary: { tool: call.name, argumentKeys: Object.keys(args as Record<string, unknown>) },
              outputRef: null,
              errorCode: 'INVALID_INPUT',
              durationMs: 0,
            })
            continue
          }
          await this.move(entry, 'executing')
          const toolStartedAt = this.now()
          let result: ToolResult<unknown>
          try {
            result = await this.deps.dispatch.dispatch({
              taskId: entry.task.taskId,
              projectId: entry.task.projectId,
              command: call.name as AgentToolCommand,
              arguments: validation.value,
              userText: entry.options.goal,
              ...(entry.options.intentIdentity === undefined
                ? {}
                : { intentIdentity: entry.options.intentIdentity }),
            })
          } catch (error) {
            result = {
              ok: false,
              code: 'TOOL_FAILED',
              message: redactText(error instanceof Error ? error.message : '工具执行失败', 120),
              requestId: randomUUID(),
              objectVersion: 'unavailable',
            }
          }
          const toolDuration = Math.max(0, this.now() - toolStartedAt)
          await this.recordStep(entry, {
            kind: 'tool',
            inputSummary: { tool: call.name, arguments: summarizeArguments(validation.value) },
            outputRef: result.ok ? `tool:${result.requestId}:${result.objectVersion}` : `tool:${result.requestId}:${result.code}`,
            errorCode: result.ok ? null : result.code,
            durationMs: toolDuration,
          })
          const outcome = result.ok
            ? { tool: call.name, result: 'ok' as const, code: null }
            : { tool: call.name, result: 'failed' as const, code: result.code }
          if (this.isStaleReply(entry)) {
            entry.task.cancelOutcome = outcome
            return await this.finishStale(entry)
          }
          if (result.ok) {
            consecutiveKey = null
            consecutiveCount = 0
            if (call.name === 'preview') {
              previewOk = true
              await this.move(entry, 'checking')
            } else {
              await this.move(entry, 'reading')
            }
          } else {
            anyToolFailed = true
            lastFailure = { code: result.code, message: result.message }
            const key = `${call.name}:${result.code}`
            consecutiveCount = key === consecutiveKey ? consecutiveCount + 1 : 1
            consecutiveKey = key
            await this.move(entry, 'reading')
            if (consecutiveCount >= budget.maxConsecutiveSameFailure) {
              return await this.finish(entry, 'failed', 'REPEATED_FAILURE',
                `工具 ${call.name} 连续 ${consecutiveCount} 次相同失败（${result.code}），停止并保留现状`)
            }
          }
          if (entry.cancelRequested) {
            entry.task.cancelOutcome = outcome
            return await this.finish(entry, 'cancelled', result.ok ? null : result.code,
              result.ok ? '取消时工具已执行到成功边界，草稿已写入并如实报告' : '取消时工具已执行到失败边界，原项目未改变')
          }
          messages.push({
            role: 'tool',
            content: toolMessageContent(call.name, result),
            toolCallId: call.id,
            name: call.name,
          })
        }
        if (entry.cancelRequested) return await this.finish(entry, 'cancelled', 'CANCELLED', '取消后剩余调用不再执行')
      }
    } catch (error) {
      const message = redactText(error instanceof Error ? error.message : '调度失败', 120)
      if (isTerminal(entry.task.state)) {
        entry.task.errorMessage ??= message
        await this.persist(entry)
        return this.snapshot(entry)
      }
      // 兜底：非法迁移或未预期异常也必须留下失败记录，不能静默继续。
      entry.task.state = 'failed'
      entry.task.errorCode = 'TOOL_FAILED'
      entry.task.errorMessage = message
      entry.task.endedAt = this.iso()
      await this.persist(entry)
      return this.snapshot(entry)
    }
  }

  private async probeResumeContext(entry: TaskEntry): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
    const startedAt = this.now()
    let result: ToolResult<unknown>
    try {
      result = await this.deps.dispatch.dispatch({
        taskId: entry.task.taskId,
        projectId: entry.task.projectId,
        command: 'context',
        arguments: {},
        userText: entry.options.goal,
      })
    } catch (error) {
      result = {
        ok: false,
        code: 'TOOL_FAILED',
        message: redactText(error instanceof Error ? error.message : '读取当前项目失败', 120),
        requestId: randomUUID(),
        objectVersion: 'unavailable',
      }
    }
    await this.recordStep(entry, {
      kind: 'tool',
      inputSummary: { tool: 'context', trigger: 'resume' },
      outputRef: result.ok ? `tool:${result.requestId}:${result.objectVersion}` : `tool:${result.requestId}:${result.code}`,
      errorCode: result.ok ? null : result.code,
      durationMs: Math.max(0, this.now() - startedAt),
    })
    if (!result.ok) return { ok: false, code: result.code, message: `恢复前读取当前项目失败：${result.message}` }
    entry.options = {
      ...entry.options,
      messages: [
        ...(entry.options.messages ?? []),
        { role: 'tool', content: JSON.stringify({ tool: 'context', ok: true, objectVersion: result.objectVersion }) },
      ],
    }
    return { ok: true }
  }

  private isStaleReply(entry: TaskEntry): boolean {
    return entry.task.projectId !== this.activeProjectId
  }

  private async finishStale(entry: TaskEntry): Promise<AgentTaskRecord> {
    await this.recordStep(entry, {
      kind: 'model',
      inputSummary: {
        staleReply: {
          taskId: entry.task.taskId,
          projectId: entry.task.projectId,
          activeProjectId: this.activeProjectId,
        },
      },
      outputRef: null,
      errorCode: 'STALE_REPLY',
      durationMs: 0,
    })
    return await this.finish(entry, 'cancelled', 'STALE_REPLY', '项目已切换，旧任务回包按 taskId+projectId 丢弃')
  }

  private async finish(
    entry: TaskEntry,
    state: AgentTaskState,
    errorCode: string | null,
    errorMessage: string | null,
  ): Promise<AgentTaskRecord> {
    if (entry.task.state !== state) await this.move(entry, state)
    entry.task.errorCode = errorCode
    entry.task.errorMessage = errorMessage === null ? null : redactText(errorMessage, 120)
    entry.task.endedAt = this.iso()
    await this.persist(entry)
    this.releaseLock(entry)
    return this.snapshot(entry)
  }

  private async move(entry: TaskEntry, to: AgentTaskState): Promise<void> {
    const result = nextState(entry.task.state, to)
    if (!result.ok) throw new Error(result.message)
    entry.task.transitions.push({ from: entry.task.state, to, at: this.iso() })
    entry.task.state = to
    await this.persist(entry)
  }

  private async recordStep(
    entry: TaskEntry,
    step: Omit<AgentStepRecord, 'stepId' | 'taskId' | 'at' | 'idempotencyKey'>,
  ): Promise<void> {
    const record: AgentStepRecord = {
      stepId: `step-${randomUUID()}`,
      taskId: entry.task.taskId,
      kind: step.kind,
      inputSummary: step.inputSummary,
      outputRef: step.outputRef,
      errorCode: step.errorCode,
      durationMs: Math.round(step.durationMs),
      idempotencyKey: fingerprint({
        taskId: entry.task.taskId,
        index: entry.steps.length + 1,
        kind: step.kind,
        inputSummary: step.inputSummary,
        outputRef: step.outputRef,
        errorCode: step.errorCode,
      }),
      at: this.iso(),
    }
    entry.steps.push(record)
    await this.persist(entry)
  }

  private requestSummary(request: ModelRequest): Record<string, unknown> {
    return {
      systemPrompt: redactText(request.systemPrompt, 100),
      messages: summarizeMessages(request.messages),
      tools: request.tools.map((tool) => tool.name),
      budget: request.budget,
    }
  }

  private snapshot(entry: TaskEntry): AgentTaskRecord {
    return structuredClone(entry.task)
  }

  private async persist(entry: TaskEntry): Promise<void> {
    await this.deps.store.save(entry.task, entry.steps)
    try { this.deps.onUpdate?.(entry.task.taskId) } catch { /* UI 通知失败不影响任务记录 */ }
  }

  private releaseLock(entry: TaskEntry): void {
    if (this.writeLocks.get(entry.task.projectId) === entry.task.taskId) {
      this.writeLocks.delete(entry.task.projectId)
    }
  }

  private classifyModelError(error: unknown): { code: string; message: string } {
    if (error instanceof ModelTimeoutError) return { code: 'TIMEOUT', message: '模型请求超时；已完成草稿保留，可继续' }
    if (error instanceof ModelAdapterError) {
      if (error.code === 'CANCELLED') return { code: 'CANCELLED', message: '模型请求已取消' }
      if (error.code === 'TIMEOUT') return { code: 'TIMEOUT', message: error.message }
      if (error.code === 'INVALID_INPUT') return { code: 'INVALID_INPUT', message: error.message }
      // 真实供应商的连接/鉴权/协议失败统一记为 TOOL_FAILED，原始原因保留在消息里。
      return { code: 'TOOL_FAILED', message: error.message }
    }
    return { code: 'TOOL_FAILED', message: '模型连接失败或返回内容不可解析' }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        onTimeout()
        reject(new ModelTimeoutError())
      }, timeoutMs)
      promise.then(
        (value) => { clearTimeout(timer); resolve(value) },
        (error) => { clearTimeout(timer); reject(error) },
      )
    })
  }

  private iso(): string {
    return new Date(this.now()).toISOString()
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}
