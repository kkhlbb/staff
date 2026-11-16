// @vitest-environment node
/**
 * V4.0 阶段 2 状态级验收：S2-01 ～ S2-12。
 *
 * 假模型 + 可注入工具调度；真实临时工作区落盘。断言任务状态、步骤记录与磁盘。
 * 阶段 1 的工程工具语义由 desktop/tests/agentTools.test.ts 覆盖，本文件只验证调度骨架。
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentScheduler, toolMessageContent, type AgentToolDispatch, type StartAgentTaskOptions } from '../main/agentScheduler'
import { AgentTaskStore } from '../main/agentTaskStore'
import {
  FakeModelAdapter,
  ModelAdapterRegistry,
  type FakeModelStep,
} from '../main/modelAdapter'
import { ModelConfig } from '../main/modelConfig'
import { MemoryKeychainStore } from '../main/keychain'
import type { ToolErrorCode, ToolResult } from '../shared/contracts'
import type { AgentBudget } from '../../src/agent/types'
import { serializeEvidence } from '../../scripts/evidence-json'

const cleanup: Harness[] = []
afterEach(async () => { for (const harness of cleanup.splice(0)) await harness.dispose() })

const ok = (data: unknown): ToolResult<unknown> => ({ ok: true, data, requestId: 'req-fixed', objectVersion: 'rev-alpha' })
const fail = (code: ToolErrorCode, message = '工具执行失败'): ToolResult<never> => ({ ok: false, code, message, requestId: 'req-fixed', objectVersion: 'rev-alpha' })
const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor 超时')
    await sleep(2)
  }
}

type Behaviour = (call: AgentToolDispatch) => ToolResult<unknown> | Promise<ToolResult<unknown>>

interface Harness {
  dir: string
  workspace: string
  store: AgentTaskStore
  scheduler: AgentScheduler
  stub: { calls: AgentToolDispatch[]; behaviour: Behaviour | undefined }
  adapter: FakeModelAdapter
  dispose: () => Promise<void>
}

interface HarnessOptions {
  script: FakeModelStep[]
  configured?: boolean
  behaviour?: Behaviour
  budget?: Partial<AgentBudget>
  activeProjectId?: string
}

async function makeHarness(options: HarnessOptions): Promise<Harness> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cunlian-v40s2-'))
  const workspace = path.join(dir, 'workspace')
  await fs.mkdir(workspace, { recursive: true })
  const adapter = new FakeModelAdapter('fake-1', options.script)
  const adapters = new ModelAdapterRegistry()
  adapters.register(adapter)
  const configured = options.configured ?? true
  const provider = {
    getProviderStatus: () => (configured ? { configured: true, provider: 'fake' } : { configured: false, provider: null }),
  }
  const stub: Harness['stub'] = { calls: [], behaviour: options.behaviour }
  const store = new AgentTaskStore({ rootDir: workspace })
  const scheduler = new AgentScheduler({
    store,
    dispatch: {
      async dispatch(call) {
        stub.calls.push(structuredClone(call))
        if (stub.behaviour !== undefined) return await stub.behaviour(call)
        return ok({ command: call.command })
      },
    },
    adapters,
    provider,
    activeProjectId: options.activeProjectId ?? 'project-alpha',
    ...(options.budget === undefined ? {} : { budget: options.budget }),
  })
  const harness: Harness = {
    dir,
    workspace,
    store,
    scheduler,
    stub,
    adapter,
    dispose: async () => { await fs.rm(dir, { recursive: true, force: true }) },
  }
  cleanup.push(harness)
  return harness
}

const startOptions = {
  projectId: 'project-alpha',
  baseRevisionId: 'rev-alpha',
  goal: '把隔套加厚 0.10 mm 并检查间隙',
}

async function start(harness: Harness, overrides: Partial<StartAgentTaskOptions> = {}) {
  const result = await harness.scheduler.startTask({ ...startOptions, ...overrides })
  expect(result.ok, JSON.stringify(result)).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return result
}

async function readTaskFile(harness: Harness, taskId: string) {
  return JSON.parse(await fs.readFile(harness.store.filePath(taskId), 'utf8')) as {
    task: { state: string; errorCode: string | null; steps: unknown }; steps: { kind: string; inputSummary: Record<string, unknown>; errorCode: string | null }[]
  }
}

async function tree(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      for (const [key, value] of Object.entries(await tree(target))) result[`${entry.name}/${key}`] = value
    } else {
      result[entry.name] = (await fs.readFile(target)).toString('base64')
    }
  }
  return result
}

const stageCall = (overrides: Record<string, unknown> = {}) => ({
  name: 'stage',
  argumentsJson: JSON.stringify({
    toolMode: 'agent',
    draftId: 'draft-alpha',
    baseRevisionId: 'rev-alpha',
    parameter: 'length',
    valueMm: '12.04',
    lockedKeys: [],
    ...overrides,
  }),
})
const previewCall = { name: 'preview', argumentsJson: JSON.stringify({ toolMode: 'agent', draftId: 'draft-alpha', baseRevisionId: 'rev-alpha' }) }
const contextCall = { name: 'context', argumentsJson: '{}' }

describe('V4.0 阶段 2：Agent 调度十二项状态验收', () => {
  it.each([true, false])('S04 preview followed by a normal context tool (same reply: %s)', async (sameReply) => {
    const harness = await makeHarness({ script: sameReply ? [
      { kind: 'tool_calls', calls: [previewCall, contextCall] },
      { kind: 'text', text: 'done' },
    ] : [
      { kind: 'tool_calls', calls: [previewCall] },
      { kind: 'tool_calls', calls: [contextCall] },
      { kind: 'text', text: 'done' },
    ] })
    const { completion } = await start(harness)
    const task = await completion
    expect(task.state).toBe('ready-to-commit')
    expect(task.errorCode).toBeNull()
    expect(harness.stub.calls.map(call => call.command)).toEqual(['preview', 'context'])
    expect(task.transitions.map(t => `${t.from}>${t.to}`)).toContain('checking>reading')
    expect(task.transitions.map(t => `${t.from}>${t.to}`)).not.toContain('checking>executing')
  })
  it('S2-01 假模型正常：context → stage → preview → done，状态按表推进、步骤与草稿落盘', async () => {
    const harness = await makeHarness({
      script: [
        { kind: 'tool_calls', text: '读取项目', calls: [contextCall] },
        { kind: 'tool_calls', text: '修改长度', calls: [stageCall()] },
        { kind: 'tool_calls', text: '预览检查', calls: [previewCall] },
        { kind: 'text', text: '草稿已就绪，等待用户确认保存。' },
      ],
      behaviour: async (call) => {
        if (call.command === 'stage') {
          await fs.mkdir(path.join(harness.workspace, 'drafts'), { recursive: true })
          await fs.writeFile(path.join(harness.workspace, 'drafts', 'alpha.json'), JSON.stringify({ parameter: 'length', valueMm: '12.04' }))
        }
        return ok({ command: call.command })
      },
    })
    const { taskId, completion } = await start(harness)
    const task = await completion
    expect(task.state).toBe('ready-to-commit')
    expect(task.errorCode).toBeNull()
    expect(task.transitions.map((transition) => `${transition.from}>${transition.to}`)).toEqual([
      'idle>reading',
      'reading>executing',
      'executing>reading',
      'reading>executing',
      'executing>reading',
      'reading>executing',
      'executing>checking',
      'checking>ready-to-commit',
    ])
    expect(harness.stub.calls.map((call) => call.command)).toEqual(['context', 'stage', 'preview'])
    const steps = harness.scheduler.getSteps(taskId)
    expect(steps.map((step) => step.kind)).toEqual(['model', 'tool', 'model', 'tool', 'model', 'tool', 'model'])
    expect(steps.filter((step) => step.kind === 'tool').map((step) => step.inputSummary.tool)).toEqual(['context', 'stage', 'preview'])
    expect(steps.every((step) => step.idempotencyKey.length > 0)).toBe(true)
    expect(JSON.parse(await fs.readFile(path.join(harness.workspace, 'drafts', 'alpha.json'), 'utf8'))).toEqual({ parameter: 'length', valueMm: '12.04' })
    const stored = await readTaskFile(harness, taskId)
    expect(stored.task.state).toBe('ready-to-commit')
    expect(stored.steps).toHaveLength(7)
    expect(harness.scheduler.getTrace(taskId)!.events.filter((event) => event.type === 'tool_call_args_done')).toHaveLength(3)
    if (process.env.V40_RECORD === '1') {
      const trace = harness.scheduler.getTrace(taskId)!
      await fs.mkdir('docs/evidence/v40-stage2', { recursive: true })
      await fs.writeFile('docs/evidence/v40-stage2/fake-session-trace.json', serializeEvidence({
        purpose: 'V4.0 阶段 2 假模型完整会话（正常路径，无真实模型调用）',
        provider: { configured: true, provider: 'fake' },
        modelId: 'fake-1',
        task: trace.task,
        steps: trace.steps,
        modelEvents: trace.events,
        toolCalls: harness.stub.calls.map((call) => ({ command: call.command, projectId: call.projectId, arguments: call.arguments })),
        disk: {
          taskFile: path.basename(harness.store.filePath(taskId)),
          draft: JSON.parse(await fs.readFile(path.join(harness.workspace, 'drafts', 'alpha.json'), 'utf8')),
        },
        assertions: [
          'final state ready-to-commit (no commit capability in stage 2)',
          'tool sequence context, stage, preview; 7 steps persisted',
          'model text alone did not decide success',
        ],
      }))
    }
  }, 20_000)

  it('S2-02 模型超时：TIMEOUT → failed，草稿保留，可继续并在原记录后追加步骤', async () => {
    const harness = await makeHarness({
      script: [
        { kind: 'timeout' },
        { kind: 'tool_calls', text: '恢复后读取项目', calls: [contextCall] },
        { kind: 'text', text: '已恢复。' },
      ],
      budget: { requestTimeoutMs: 25 },
    })
    const draftPath = path.join(harness.workspace, 'drafts')
    await fs.mkdir(draftPath, { recursive: true })
    const beforeBytes = Buffer.from('draft-preserved')
    await fs.writeFile(path.join(draftPath, 'alpha.json'), beforeBytes)

    const { taskId, completion } = await start(harness)
    const failed = await completion
    expect(failed.state).toBe('failed')
    expect(failed.errorCode).toBe('TIMEOUT')
    expect(harness.stub.calls).toHaveLength(0)
    expect(await fs.readFile(path.join(draftPath, 'alpha.json'))).toEqual(beforeBytes)
    const failedSteps = harness.scheduler.getSteps(taskId)
    expect(failedSteps.map((step) => step.errorCode)).toEqual(['TIMEOUT'])

    const resumed = await harness.scheduler.resumeTask(taskId)
    expect(resumed.ok, JSON.stringify(resumed)).toBe(true)
    if (!resumed.ok) throw new Error(resumed.message)
    const finished = await resumed.completion
    expect(finished.state).toBe('completed')
    expect(await fs.readFile(path.join(draftPath, 'alpha.json'))).toEqual(beforeBytes)
    const allSteps = harness.scheduler.getSteps(taskId)
    expect(allSteps.map((step) => [step.kind, step.errorCode])).toEqual([
      ['model', 'TIMEOUT'],
      ['tool', null],
      ['model', null],
      ['tool', null],
      ['model', null],
    ])
    expect(allSteps[1].inputSummary).toMatchObject({ tool: 'context', trigger: 'resume' })
    expect(harness.stub.calls.map((call) => call.command)).toEqual(['context', 'context'])
    expect(allSteps[2].stepId).not.toBe(allSteps[0].stepId)
    expect(JSON.parse(await fs.readFile(harness.store.filePath(taskId), 'utf8')).steps).toHaveLength(5)
  })

  it('S2-03 连接失败与非 JSON 回包：TOOL_FAILED，不执行任何工具', async () => {
    for (const step of [{ kind: 'connection_failure' as const }, { kind: 'invalid_reply' as const }]) {
      const harness = await makeHarness({ script: [step] })
      const { taskId, completion } = await start(harness)
      const task = await completion
      expect(task.state).toBe('failed')
      expect(task.errorCode).toBe('TOOL_FAILED')
      expect(harness.stub.calls).toHaveLength(0)
      expect(harness.scheduler.getSteps(taskId).map((record) => record.errorCode)).toEqual(['TOOL_FAILED'])
      expect((await readTaskFile(harness, taskId)).task.errorCode).toBe('TOOL_FAILED')
    }
  })

  it('S2-04 工具参数不合法（缺字段/类型错/多字段/非 JSON）：INVALID_INPUT，不执行、不猜参数', async () => {
    const harness = await makeHarness({
      script: [
        {
          kind: 'tool_calls',
          calls: [
            { name: 'stage', argumentsJson: JSON.stringify({ toolMode: 'agent', baseRevisionId: 'rev-alpha', parameter: 'length', valueMm: '12.04', lockedKeys: [] }) },
            { name: 'stage', argumentsJson: JSON.stringify({ toolMode: 'agent', draftId: 42, baseRevisionId: 'rev-alpha', parameter: 'length', valueMm: '12.04', lockedKeys: [] }) },
            { name: 'preview', argumentsJson: JSON.stringify({ toolMode: 'agent', draftId: 'draft-alpha', baseRevisionId: 'rev-alpha', confirmed: true }) },
            { name: 'stage', argumentsJson: '{not-json' },
          ],
        },
        { kind: 'text', text: '已保存。' },
      ],
    })
    const { taskId, completion } = await start(harness)
    const task = await completion
    expect(task.state).toBe('failed')
    expect(task.errorCode).toBe('INVALID_INPUT')
    expect(harness.stub.calls).toHaveLength(0)
    const toolSteps = harness.scheduler.getSteps(taskId).filter((step) => step.kind === 'tool')
    expect(toolSteps).toHaveLength(4)
    expect(toolSteps.map((step) => step.errorCode)).toEqual(['INVALID_INPUT', 'INVALID_INPUT', 'INVALID_INPUT', 'INVALID_INPUT'])
    expect(toolSteps.map((step) => step.inputSummary.tool)).toEqual(['stage', 'stage', 'preview', 'stage'])
    // 参数值没有回显到记录里，避免把模型乱传的内容当证据。
    expect(JSON.stringify(toolSteps)).not.toContain('12.04')
    expect((await readTaskFile(harness, taskId)).task.state).toBe('failed')
  })

  it('S2-05 模型说“已保存”但工具失败：状态按工具回执，不得标记完成', async () => {
    const harness = await makeHarness({
      script: [
        { kind: 'tool_calls', text: '正在保存', calls: [stageCall()] },
        { kind: 'text', text: '已保存，参数已更新。' },
      ],
      behaviour: () => fail('STALE_BASE', '工程草稿正式基准已过期'),
    })
    const draftPath = path.join(harness.workspace, 'drafts', 'alpha.json')
    const { taskId, completion } = await start(harness)
    const task = await completion
    expect(task.state).toBe('failed')
    expect(task.state).not.toBe('completed')
    expect(task.errorCode).toBe('STALE_BASE')
    expect(task.endedAt).not.toBeNull()
    expect(harness.stub.calls).toHaveLength(1)
    expect(harness.scheduler.getSteps(taskId).filter((step) => step.kind === 'tool').map((step) => step.errorCode)).toEqual(['STALE_BASE'])
    await expect(fs.readFile(draftPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await readTaskFile(harness, taskId)).task.state).toBe('failed')
  })

  it('S2-06 超过 20 次工具调用：第 21 次不执行，awaiting-input 并保留证据', async () => {
    const calls = Array.from({ length: 21 }, () => ({ kind: 'tool_calls' as const, calls: [contextCall] }))
    const harness = await makeHarness({ script: [...calls, { kind: 'text', text: '继续。' }] })
    const { taskId, completion } = await start(harness)
    const task = await completion
    expect(harness.stub.calls).toHaveLength(20)
    expect(task.state).toBe('awaiting-input')
    expect(task.errorCode).toBe('BUDGET_EXHAUSTED')
    expect(task.budget).toMatchObject({ maxToolCalls: 20, maxConsecutiveSameFailure: 2, requestTimeoutMs: 120_000 })
    const steps = harness.scheduler.getSteps(taskId)
    expect(steps.filter((step) => step.errorCode === 'BUDGET_EXHAUSTED')).toHaveLength(1)
    expect(steps.filter((step) => step.kind === 'tool' && step.errorCode === null)).toHaveLength(20)
    const stored = await readTaskFile(harness, taskId)
    expect(stored.task.state).toBe('awaiting-input')
    expect(stored.steps.length).toBeGreaterThanOrEqual(20)
  }, 20_000)

  it('S2-07 同一工具连续两次相同失败：停止并说明（REPEATED_FAILURE）', async () => {
    const harness = await makeHarness({
      script: [
        { kind: 'tool_calls', calls: [stageCall()] },
        { kind: 'tool_calls', calls: [stageCall()] },
        { kind: 'text', text: '已保存。' },
      ],
      behaviour: () => fail('STALE_PREVIEW', '工程草稿不存在或已过期'),
    })
    const { taskId, completion } = await start(harness)
    const task = await completion
    expect(harness.stub.calls).toHaveLength(2)
    expect(task.state).toBe('failed')
    expect(task.errorCode).toBe('REPEATED_FAILURE')
    expect(task.errorMessage).toContain('连续 2 次')
    expect(harness.scheduler.getSteps(taskId).filter((step) => step.kind === 'tool').map((step) => step.errorCode)).toEqual(['STALE_PREVIEW', 'STALE_PREVIEW'])
    expect((await readTaskFile(harness, taskId)).task.errorCode).toBe('REPEATED_FAILURE')
  })

  it('S2-08 取消：未执行回包丢弃；已进入执行的跑到边界并如实报告真实结果', async () => {
    // a) 回包尚未到达时取消：不再执行工具，回包丢弃。
    const pending = await makeHarness({
      script: [{ kind: 'tool_calls', calls: [contextCall], delayMs: 40 }],
    })
    const first = await start(pending)
    await waitFor(() => pending.adapter.remainingSteps() === 0)
    const cancelled = await pending.scheduler.cancel(first.taskId)
    expect(cancelled.ok).toBe(true)
    const dropped = await first.completion
    expect(dropped.state).toBe('cancelled')
    expect(pending.stub.calls).toHaveLength(0)
    expect(dropped.cancelOutcome).toBeNull()
    expect(pending.scheduler.getSteps(first.taskId).some((step) => step.errorCode === 'CANCELLED')).toBe(true)

    // b) 工具已进入执行：取消后仍跑到边界，草稿已写入且任务如实记录 ok。
    const inflight = await makeHarness({
      script: [{ kind: 'tool_calls', calls: [stageCall()] }],
      behaviour: async () => {
        await sleep(40)
        const drafts = path.join(inflight.workspace, 'drafts')
        await fs.mkdir(drafts, { recursive: true })
        await fs.writeFile(path.join(drafts, 'alpha.json'), JSON.stringify({ valueMm: '12.04' }))
        return ok({ command: 'stage' })
      },
    })
    const second = await start(inflight)
    await waitFor(() => inflight.stub.calls.length === 1)
    expect((await inflight.scheduler.cancel(second.taskId)).ok).toBe(true)
    const honest = await second.completion
    expect(honest.state).toBe('cancelled')
    expect(honest.cancelOutcome).toEqual({ tool: 'stage', result: 'ok', code: null })
    expect(JSON.parse(await fs.readFile(path.join(inflight.workspace, 'drafts', 'alpha.json'), 'utf8'))).toEqual({ valueMm: '12.04' })
    const toolSteps = inflight.scheduler.getSteps(second.taskId).filter((step) => step.kind === 'tool')
    expect(toolSteps.map((step) => step.errorCode)).toEqual([null])
  })

  it('S2-09 切换项目后旧任务回包：按 taskId+projectId 丢弃，新项目零写入（M12）', async () => {
    const harness = await makeHarness({
      script: [{ kind: 'tool_calls', calls: [stageCall()], delayMs: 40 }],
    })
    const beta = path.join(harness.workspace, 'project-beta')
    await fs.mkdir(beta, { recursive: true })
    await fs.writeFile(path.join(beta, 'sentinel.json'), JSON.stringify({ project: 'beta' }))
    const betaBefore = await tree(beta)

    const { taskId, completion } = await start(harness)
    await waitFor(() => harness.adapter.remainingSteps() === 0)
    harness.scheduler.setActiveProject('project-beta')
    const task = await completion
    expect(task.state).toBe('cancelled')
    expect(task.errorCode).toBe('STALE_REPLY')
    expect(harness.stub.calls).toHaveLength(0)
    expect(await tree(beta)).toEqual(betaBefore)
    const staleSteps = harness.scheduler.getSteps(taskId).filter((step) => step.errorCode === 'STALE_REPLY')
    expect(staleSteps).toHaveLength(1)
    expect(staleSteps[0].inputSummary.staleReply).toMatchObject({ projectId: 'project-alpha', activeProjectId: 'project-beta' })
    expect(task.projectId).toBe('project-alpha')
  })

  it('S2-10 同项目第二个写任务：CONSTRAINT_VIOLATED，不创建第二条任务', async () => {
    const harness = await makeHarness({
      script: [
        { kind: 'tool_calls', calls: [contextCall], delayMs: 40 },
        { kind: 'text', text: '完成。' },
      ],
    })
    const first = await start(harness)
    const second = await harness.scheduler.startTask({ ...startOptions, goal: '第二个写任务' })
    expect(second).toMatchObject({ ok: false, code: 'CONSTRAINT_VIOLATED' })
    const finished = await first.completion
    expect(finished.state).toBe('completed')
    expect(harness.stub.calls).toHaveLength(1)
    const files = await fs.readdir(path.join(harness.workspace, 'agent-tasks'))
    expect(files).toHaveLength(1)
  })

  it('S2-11 任务记录脱敏：不含 key、/Users/、PDF 全文，保留工具名与关键数值', async () => {
    const pdfText = 'PDF全文片段'.repeat(80)
    const harness = await makeHarness({
      script: [{ kind: 'tool_calls', calls: [stageCall()] }, { kind: 'text', text: '完成。' }],
      behaviour: () => ok({ command: 'stage' }),
    })
    const { taskId, completion } = await start(harness, {
      goal: '/Users/aston/taskbook.pdf 要求 sk-live-ABCDEF123456789 把隔套加厚',
      systemPrompt: '任务书路径 /Users/aston/secret.pdf',
      messages: [{ role: 'user', content: pdfText }],
    })
    await completion
    const text = await fs.readFile(harness.store.filePath(taskId), 'utf8')
    expect(text).not.toContain('/Users/')
    expect(text).not.toContain('sk-live-')
    expect(text).not.toContain(pdfText)
    expect(text).toContain('<path>')
    expect(text).toContain('12.04')
    const stored = JSON.parse(text) as { task: { goal: string }; steps: { inputSummary: Record<string, unknown> }[] }
    expect(stored.task.goal).toContain('<path>')
    const stage = stored.steps.find((step) => step.inputSummary.tool === 'stage')
    expect(stage?.inputSummary.arguments).toMatchObject({ valueMm: '12.04', parameter: 'length' })
  })

  it('S2-12 未配置模型：明确报未配置，不创建任务、不假装可用', async () => {
    const harness = await makeHarness({ script: [{ kind: 'text', text: '不应到达' }], configured: false })
    const result = await harness.scheduler.startTask(startOptions)
    expect(result).toMatchObject({ ok: false, code: 'MODEL_NOT_CONFIGURED' })
    if (result.ok) throw new Error('unexpected success')
    expect(result.message).toContain('未配置')
    expect(harness.stub.calls).toHaveLength(0)
    await expect(fs.readdir(path.join(harness.workspace, 'agent-tasks'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(new ModelConfig({ rootDir: harness.workspace, keychain: new MemoryKeychainStore(), env: {} }).getProviderStatus()).toMatchObject({ configured: false, provider: null, keyPresent: false })
  })

  it('S4-00 工具回执带 data 进入模型上下文；超限时截断但保留 ok/code', () => {
    const content = toolMessageContent('context', ok({ length: 120400 }))
    expect(JSON.parse(content)).toMatchObject({ tool: 'context', ok: true, code: null, data: { length: 120400 } })
    const failed = toolMessageContent('stage', fail('CONSTRAINT_VIOLATED', '不能修改锁定参数'))
    expect(JSON.parse(failed)).toMatchObject({ tool: 'stage', ok: false, code: 'CONSTRAINT_VIOLATED', message: '不能修改锁定参数' })
    const big = toolMessageContent('confirmed', ok({ text: 'x'.repeat(40_000) }))
    const parsed = JSON.parse(big) as { truncated: boolean; ok: boolean; code: null }
    expect(parsed.truncated).toBe(true)
    expect(parsed.ok).toBe(true)
    expect(parsed.code).toBeNull()
    expect(big.length).toBeLessThan(25_000)
  })
})
