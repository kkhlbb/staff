/**
 * V4.0 阶段 3：Agent 任务侧栏的 IPC 网关（主进程）。
 *
 * - 任务调度仍由阶段 2 的 AgentScheduler 负责；这里只做 sender 校验、参数 schema、
 *   每窗口装配与事件推送。
 * - 唯一模型是阶段 2 的 fake-1（离线演示，显式标注）；真实模型仍未配置（阶段 4）。
 * - 本文件不签发授权、不做提交，只把界面动作转给 AgentToolService；授权签发与
 *   重算提交在 AgentToolService / ApprovalStore 内，模型永远拿不到 approvalId。
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { isTerminal } from '../../src/agent/stateMachine'
import type { AgentStepRecord, AgentTaskRecord } from '../../src/agent/types'
import type {
  AgentProviderStatusValue,
  AgentQuestionView,
  AgentStartValue,
  AgentTaskView,
  ToolErrorCode,
  ToolResult,
} from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'
import { AgentScheduler } from './agentScheduler'
import { AgentTaskStore } from './agentTaskStore'
import type { AgentToolService } from './agentToolService'
import type { ApprovalStore } from './approvalStore'
import { toSenderInfo, type IpcMainLike } from './ipc'
import { FAKE_MODEL_ID, FakeModelAdapter, ModelAdapterRegistry, ModelConfig, type FakeModelStep } from './modelAdapter'
import type { SenderGuard } from './senderGuard'

export interface AgentSessionDeps {
  guard: SenderGuard
  controller: import('./sessionController').SessionController
  service: AgentToolService
  approvals: ApprovalStore
  rootDir: string
  /** 主进程 → 渲染进程的事件端口；测试注入收集器。 */
  emit: (windowId: number, view: AgentTaskView) => void
  /** 真实模型状态；阶段 3 固定未配置。 */
  provider?: { getProviderStatus(): { configured: boolean; provider: string | null } }
  now?: () => number
}

const id = z.string().min(1).max(240)
const schemas = {
  start: z.object({ goal: z.string().min(1).max(2000), demo: z.enum(['normal', 'ask', 'failure']) }).strict(),
  cancel: z.object({ taskId: id }).strict(),
  resume: z.object({ taskId: id }).strict(),
  taskState: z.object({ taskId: id }).strict(),
  issueApproval: z.object({ previewId: id }).strict(),
  commit: z.object({ approvalId: id, draftId: id, previewFingerprint: z.string().min(8).max(128) }).strict(),
  locate: z.object({ requirementRevisionId: id.optional(), checkId: id.optional(), parameterId: id.optional() }).strict(),
} as const

function fail(code: ToolErrorCode, message: string, details?: unknown): ToolResult<never> {
  return { ok: false, code, message, requestId: randomUUID(), objectVersion: 'unavailable', ...(details === undefined ? {} : { details }) }
}

/** 演示脚本只包含工具调用与一段模型文本；文本不进入任何结论位。 */
function demoScript(scenario: 'normal' | 'ask' | 'failure', draftId: string, baseRevisionId: string): FakeModelStep[] {
  const basis = { toolMode: 'agent' as const, draftId, baseRevisionId }
  const stage = (patch: Record<string, unknown>): FakeModelStep => ({
    kind: 'tool_calls',
    calls: [{ name: 'stage', argumentsJson: JSON.stringify({ ...basis, ...patch }) }],
  })
  switch (scenario) {
    case 'normal':
      return [
        stage({ parameter: 'length', deltaMm: '0.04', lockedKeys: ['innerDiameter', 'outerDiameter'] }),
        { kind: 'tool_calls', calls: [{ name: 'preview', argumentsJson: JSON.stringify(basis) }] },
        { kind: 'text', text: '预览完成，请确认保存。' },
      ]
    case 'ask':
      return [
        stage({ parameter: 'length', deltaMm: '0.04', lockedKeys: ['length'] }),
        { kind: 'text', text: '已按要求加厚，请确认。' },
      ]
    case 'failure':
      return [
        stage({ parameter: 'length', deltaMm: '0.1x', lockedKeys: ['innerDiameter', 'outerDiameter'] }),
        { kind: 'text', text: '已完成并保存成功。' },
      ]
  }
}

function askQuestions(task: AgentTaskRecord, steps: AgentStepRecord[]): AgentQuestionView[] {
  if (isTerminal(task.state) && task.state !== 'failed' && task.state !== 'awaiting-input') return []
  const lastFailure = [...steps].reverse().find(step => step.kind === 'tool' && step.errorCode !== null)
  if (task.state === 'awaiting-input') {
    return [{ code: task.errorCode ?? 'AWAITING_INPUT', tool: 'scheduler', message: task.errorMessage ?? '需要用户决定是否继续' }]
  }
  if (task.state === 'failed' && lastFailure !== undefined && lastFailure.errorCode !== null) {
    const tool = typeof lastFailure.inputSummary.tool === 'string' ? lastFailure.inputSummary.tool : 'tool'
    return [{ code: lastFailure.errorCode, tool, message: task.errorMessage ?? `工具 ${tool} 返回 ${lastFailure.errorCode}` }]
  }
  return []
}

export function registerAgentSessionChannels(ipc: IpcMainLike, deps: AgentSessionDeps): void {
  const schedulers = new Map<number, AgentScheduler>()
  const registries = new Map<number, ModelAdapterRegistry>()
  const provider = deps.provider ?? new ModelConfig()

  const viewOf = (windowId: number, taskId: string): AgentTaskView | null => {
    const scheduler = schedulers.get(windowId)
    if (scheduler === undefined) return null
    const trace = scheduler.getTrace(taskId)
    if (trace === null) return null
    return { task: trace.task, steps: trace.steps, questions: askQuestions(trace.task, trace.steps) }
  }

  const notify = (windowId: number, taskId: string): void => {
    const view = viewOf(windowId, taskId)
    if (view !== null) deps.emit(windowId, view)
  }

  const schedulerFor = (windowId: number): AgentScheduler | null => {
    const cached = schedulers.get(windowId)
    if (cached !== undefined) {
      const session = deps.controller.sessionFor(windowId)
      if (session !== null) cached.setActiveProject(session.snapshot.project.id)
      return cached
    }
    const session = deps.controller.sessionFor(windowId)
    if (session === null) return null
    const registry = new ModelAdapterRegistry()
    registry.register(new FakeModelAdapter(FAKE_MODEL_ID, []))
    const scheduler = new AgentScheduler({
      store: new AgentTaskStore({ rootDir: deps.rootDir }),
      dispatch: { dispatch: call => deps.service.run(windowId, call.command, call.arguments) },
      adapters: registry,
      // 阶段 3 唯一可执行模型是显式标注的 fake-1；真实供应商状态单独在 agentProviderStatus 展示。
      provider: { getProviderStatus: () => ({ configured: true, provider: FAKE_MODEL_ID }) },
      activeProjectId: session.snapshot.project.id,
      ...(deps.now === undefined ? {} : { now: deps.now }),
      onUpdate: (taskId) => notify(windowId, taskId),
    })
    schedulers.set(windowId, scheduler)
    registries.set(windowId, registry)
    return scheduler
  }

  // installChannel 的包络是 IpcResult；Agent 工具沿用阶段 1/2 的 ToolResult 信封。
  // 因此这里自己校验 sender + schema，并把参数直接交给处理函数。
  const install = <P>(channel: string, schema: z.ZodType<P>, run: (windowId: number, params: P, event: unknown) => Promise<ToolResult<unknown>> | ToolResult<unknown>): void => {
    ipc.handle(channel, async (event, ...args) => {
      const sender = toSenderInfo(event)
      if (!deps.guard.verify(sender).ok) return fail('INVALID_INPUT', '不可信的调用窗口') as never
      const parsed = schema.safeParse(args[0] ?? {})
      if (!parsed.success) return fail('INVALID_INPUT', '任务侧栏参数校验失败') as never
      try {
        return (await run(sender.webContentsId, parsed.data, event)) as never
      } catch {
        return fail('TOOL_FAILED', '任务侧栏请求失败') as never
      }
    })
  }

  install(IPC_CHANNELS.agentProviderStatus, z.object({}).strict(), () => {
    const value: AgentProviderStatusValue = {
      real: provider.getProviderStatus(),
      demo: { available: true, modelId: FAKE_MODEL_ID, label: '离线演示（假模型，不联网）' },
    }
    return { ok: true, data: value, requestId: randomUUID(), objectVersion: 'n/a' }
  })

  install(IPC_CHANNELS.agentStart, schemas.start, async (windowId, request) => {
    const session = deps.controller.sessionFor(windowId)
    if (session === null) return fail('STALE_BASE', '没有活动项目，先打开项目')
    const scheduler = schedulerFor(windowId)
    if (scheduler === null) return fail('STALE_BASE', '没有活动项目，先打开项目')
    // 演示草稿只写应用工作区；失败时不启动任务。
    const draft = await deps.service.prepareDemoDraft(windowId)
    if (!draft.ok) return fail(draft.code, draft.message)
    const registry = registries.get(windowId)!
    registry.register(new FakeModelAdapter(FAKE_MODEL_ID, demoScript(request.demo, draft.data.draftId, draft.data.baseRevisionId)))
    const started = await scheduler.startTask({
      projectId: session.snapshot.project.id,
      baseRevisionId: session.snapshot.project.currentRevisionId,
      goal: request.goal,
      modelId: FAKE_MODEL_ID,
      writes: true,
    })
    if (!started.ok) return fail(started.code === 'MODEL_NOT_CONFIGURED' ? 'INVALID_INPUT' : started.code, started.message)
    // 不等待完成：状态与步骤通过 onUpdate 推送；界面另可轮询 task-state。
    void started.completion.catch(() => undefined)
    notify(windowId, started.taskId)
    const value: AgentStartValue = { taskId: started.taskId, demo: request.demo, modelId: FAKE_MODEL_ID }
    return { ok: true, data: value, requestId: randomUUID(), objectVersion: session.snapshot.project.currentRevisionId }
  })

  install(IPC_CHANNELS.agentTaskState, schemas.taskState, (windowId, request) => {
    const view = viewOf(windowId, request.taskId)
    if (view === null) return fail('INVALID_INPUT', '任务不存在或不属于当前窗口')
    return { ok: true, data: view, requestId: randomUUID(), objectVersion: view.task.baseRevisionId }
  })

  install(IPC_CHANNELS.agentCancel, schemas.cancel, async (windowId, request) => {
    const scheduler = schedulers.get(windowId)
    if (scheduler === undefined) return fail('INVALID_INPUT', '任务不存在')
    const result = await scheduler.cancel(request.taskId)
    if (!result.ok) return fail(result.code, result.message)
    return { ok: true, data: { cancelled: true }, requestId: randomUUID(), objectVersion: 'n/a' }
  })

  install(IPC_CHANNELS.agentResume, schemas.resume, async (windowId, request) => {
    const scheduler = schedulers.get(windowId)
    if (scheduler === undefined) return fail('INVALID_INPUT', '任务不存在')
    const result = await scheduler.resumeTask(request.taskId)
    if (!result.ok) return fail(result.code === 'MODEL_NOT_CONFIGURED' ? 'INVALID_INPUT' : result.code, result.message)
    void result.completion.catch(() => undefined)
    notify(windowId, request.taskId)
    return { ok: true, data: { resumed: true }, requestId: randomUUID(), objectVersion: 'n/a' }
  })

  install(IPC_CHANNELS.agentPreviewSummary, z.object({}).strict(), (windowId) => deps.service.previewSummary(windowId))

  install(IPC_CHANNELS.agentIssueApproval, schemas.issueApproval, (windowId, request) => deps.service.issueApproval(windowId, request.previewId))

  install(IPC_CHANNELS.agentCommitApprovedDraft, schemas.commit, (windowId, request) => deps.service.commitApprovedDraft(windowId, request))

  install(IPC_CHANNELS.agentLocateEvidence, schemas.locate, (windowId, request) => deps.service.locateEvidence(windowId, request))
}
