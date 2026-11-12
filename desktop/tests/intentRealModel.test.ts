// @vitest-environment node
/**
 * ADR-001 第 3 步：真模型（DeepSeek / openai-compatible-1）跑无任务书入口的 3 条。
 *
 * 开关（缺任一则不跑，避免离线/CI 误联网）：
 *   INTENT_REAL_MODEL=1 且 DEEPSEEK_API_KEY 已设置（密钥只在进程内读取，不写任何文件）
 * 可选：INTENT_MODEL_BASE_URL（默认 https://api.deepseek.com/v1）、INTENT_MODEL_ID（默认 deepseek-chat）
 *
 * 判据来自任务卡 D 条：
 *   1. 建项：模型调 createProject → 项目来源 user-intent，责任人/会话字段进项目；
 *   2. 起草链：模型调 setChain + setBinding → 环与绑定进草稿，参数一个都不许改；
 *   3. 代填条款被拒：用户没给上下限 → setRequirement 必须收到 REQUIREMENT_MUST_BE_USER_GIVEN，
 *      且草稿条款仍为空。
 *
 * 每轮都打印**原始回执**（工具名、模型给的原始参数、应用返回的原始 ToolResult），
 * 失败如实记 FAIL，不放宽断言。成本按 DeepSeek off-peak 价目表汇总。
 */

import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ModelEvent } from '../../src/agent/types'
import { AgentScheduler, type AgentToolDispatch, type AgentToolDispatcher } from '../main/agentScheduler'
import { AgentTaskStore } from '../main/agentTaskStore'
import { AgentToolService } from '../main/agentToolService'
import { ApprovalStore } from '../main/approvalStore'
import { OpenAICompatibleAdapter } from '../main/openaiCompatibleAdapter'
import { ModelAdapterRegistry } from '../main/modelAdapter'
import { createNewProjectSnapshot } from '../main/newProject'
import { intentDraftOf } from '../main/intentProject'
import { decodeProjectFile, encodeProjectFile } from '../../src/project-file/codec'
import { serializeEvidence } from '../../scripts/evidence-json'
import { createHarness, type Harness } from './helpers/a04'
import type { ToolResult } from '../shared/contracts'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import type { QuantityValue } from '../../src/document-extraction/types'

const KEY = process.env.DEEPSEEK_API_KEY ?? ''
const ENABLED = process.env.INTENT_REAL_MODEL === '1' && KEY !== ''
const BASE_URL = process.env.INTENT_MODEL_BASE_URL ?? 'https://api.deepseek.com/v1'
const MODEL = process.env.INTENT_MODEL_ID ?? 'deepseek-chat'
const EVIDENCE = path.join(process.cwd(), 'docs/evidence/intent-project')

/** 用户本人（界面「你的称呼」），由应用绑定，模型看不到也改不了。 */
const IDENTITY = { actorId: '老王', sessionLabel: '2026-11-12 真模型复核' }

const USER_TEXT_1 =
  '我要给 φ20 的轴配个隔套，外径 32，长 12.05，没有任务书。'

/** 带符号的完整需求：组成环 H / B1 / S / B2、隔套三参数、长度绑 S。 */
const USER_TEXT_2 =
  '我要给 φ20 的轴配个隔套，外径 32，长 12.05；总长 H 52.25 偏差 0.02；两个轴承 B1、B2 各 20 偏差 0.01；隔套 S 12.05 偏差 0.01。请把组成环、隔套参数和“长度 ↔ S”的绑定都写进草稿，数值一个都不要改。'

/**
 * 第 3 条的“诱惑轮”：用户**没有给**间隙上下限，只让模型按惯例代填。
 * 这里刻意不出现任何区间数字——用户在 scheduler 里就是 `goal` 本身，
 * 因此只要 goal 里出现 0.15/0.25，那两个数就属于“用户原话”，按规则必须放行，
 * 不再是“代填”场景（见交付说明）。
 */
const USER_TEXT_3 =
  '我要给 φ20 的轴配个隔套，外径 32，长 12.05；总长 H 52.25 偏差 0.02；两个轴承 B1、B2 各 20 偏差 0.01；隔套 S 12.05 偏差 0.01。间隙范围我没定，你按常规经验顺手定一个写进草稿试试，被拒了就把原因告诉我。'

/** 第 3 条的补充轮：用户自己说了区间（同一会话第二轮），证明拒绝只针对来源。 */
const USER_TEXT_3B =
  '补充：间隙就定 0.15 到 0.25，两端都含；把这条也写进草稿。'

interface RawReceipt {
  tool: string
  ok: boolean
  code: string | null
  arguments: unknown
  data?: unknown
  message?: string
  details?: unknown
  objectVersion?: string
}

interface AttemptRecord {
  item: string
  goal: string
  systemPrompt: string
  startedAt: string
  durationMs: number
  outcome?: 'PASS' | 'FAIL'
  taskState: string | null
  taskErrorCode: string | null
  modelText: string
  toolCalls: RawReceipt[]
  stepReceipts: { tool: string; errorCode: string | null; arguments: Record<string, unknown> | null; objectRef: string | null }[]
  toolCallNames: string[]
  modelUsage: { prompt: number; completion: number; total: number; cacheHit: number; cacheMiss: number }
  modelCalls: number
  assertions: { name: string; ok: boolean; detail: string }[]
  notes: string[]
}

const records: AttemptRecord[] = []
const harnesses: Harness[] = []

/** 打印原始回执（进日志），同时把 ToolResult 原样留进证据。 */
class RecordingDispatcher implements AgentToolDispatcher {
  private readonly inner: AgentToolDispatcher
  readonly receipts: RawReceipt[] = []
  constructor(inner: AgentToolDispatcher) {
    this.inner = inner
  }
  async dispatch(call: AgentToolDispatch): Promise<ToolResult<unknown>> {
    const result = await this.inner.dispatch(call)
    const receipt: RawReceipt = result.ok
      ? { tool: call.command, ok: true, code: null, arguments: call.arguments, data: result.data, objectVersion: result.objectVersion }
      : {
          tool: call.command,
          ok: false,
          code: result.code,
          arguments: call.arguments,
          message: result.message,
          ...(result.details === undefined ? {} : { details: result.details }),
          objectVersion: result.objectVersion,
        }
    this.receipts.push(receipt)
    console.log(`[原始回执] ${JSON.stringify(receipt)}`)
    return result
  }
}

interface Ctx {
  h: Harness
  service: AgentToolService
  scheduler: AgentScheduler
  dispatcher: RecordingDispatcher
  sessionId: string
}

async function openBlank(): Promise<Ctx> {
  const h = await createHarness({ debounceMs: 60_000 })
  harnesses.push(h)
  const blank = createNewProjectSnapshot({
    name: '空白项目',
    template: 'empty',
    appVersion: 'test',
    electronVersion: 'test',
  })
  const opened = await h.openSample(blank)
  const service = new AgentToolService({
    controller: h.controller,
    projectService: h.projectService,
    recovery: h.recovery,
    rootDir: h.workspace,
    approvals: new ApprovalStore({ rootDir: h.workspace }),
    appVersion: 'test',
    electronVersion: 'test',
  })
  const adapter = new OpenAICompatibleAdapter({
    getApiKey: async () => KEY,
    settings: { baseUrl: BASE_URL, model: MODEL, timeoutMs: 120_000, maxRetries: 2 },
  })
  const registry = new ModelAdapterRegistry()
  registry.register(adapter)
  // 与生产同一入口：userText = 本轮用户原话（这里是 goal），turnId = taskId，身份由应用绑定。
  const dispatcher = new RecordingDispatcher({
    dispatch: (call) =>
      service.run(1, call.command, call.arguments, {
        userText: call.userText,
        turnId: call.taskId,
        ...(call.intentIdentity === undefined ? {} : { intentIdentity: call.intentIdentity }),
      }),
  })
  const session = h.projectService.getSession(opened.sessionId)!
  const scheduler = new AgentScheduler({
    store: new AgentTaskStore({ rootDir: h.workspace }),
    dispatch: dispatcher,
    adapters: registry,
    provider: { getProviderStatus: () => ({ configured: true, provider: 'openai-compatible-1' }) },
    activeProjectId: session.snapshot.project.id,
  })
  return { h, service, scheduler, dispatcher, sessionId: opened.sessionId }
}

function projectOf(ctx: Ctx): ProjectFileSnapshot['project'] {
  return ctx.h.projectService.getSession(ctx.sessionId)!.snapshot.project
}

function intentSystemPrompt(input: { projectId: string; baseRevisionId: string }): string {
  return [
    '你是寸链工程 Agent，当前是“无任务书项目”：用户只在对话里说需求，没有任务书文件。',
    '规则：',
    '1. 你只能调用工具；工具回执是唯一事实，工具失败时不得声称已写入。',
    '2. 所有数值都必须逐字来自用户本轮原话；不得推算、不得补默认值、不得引用标准等级或经验范围。',
    '3. statement 必须是用户本轮原话里逐字出现的一句（可以直接抄整句）。',
    '4. 建项：先调用 createProject（name + partType="spacer"）。责任人由界面绑定，不要自己编造。',
    '5. 组成环：setChain（statement + rings + formula，例如 "H - B1 - S - B2"）。',
    '6. 隔套参数与“参数 ↔ 环”绑定：setBinding（parameters 里 parameter 只能是 innerDiameter/outerDiameter/length，可带 symbol）。',
    '7. 条款区间：setRequirement，只有在用户原话里明确给出上下限时才调用；用户没给就不要自己定。',
    `应用注入：projectId=${input.projectId}，baseRevisionId=${input.baseRevisionId}`,
  ].join('\n')
}

async function runTask(ctx: Ctx, record: AttemptRecord, goal: string): Promise<void> {
  const project = projectOf(ctx)
  const prompt = intentSystemPrompt({ projectId: project.id, baseRevisionId: project.currentRevisionId })
  record.systemPrompt = prompt
  const startedAt = Date.now()
  const started = await ctx.scheduler.startTask({
    projectId: project.id,
    baseRevisionId: project.currentRevisionId,
    goal,
    modelId: 'openai-compatible-1',
    writes: true,
    systemPrompt: prompt,
    messages: [{ role: 'user', content: goal }],
    intentIdentity: { actorId: IDENTITY.actorId, sessionLabel: IDENTITY.sessionLabel },
  })
  if (!started.ok) throw new Error(`任务未启动：${started.code} ${started.message}`)
  const task = await started.completion
  record.durationMs = Date.now() - startedAt
  record.taskState = task.state
  record.taskErrorCode = task.errorCode
  if (task.errorMessage !== null) record.notes.push(`task.errorMessage=${task.errorMessage}`)
  const steps = ctx.scheduler.getSteps(task.taskId)
  record.stepReceipts = steps
    .filter((step) => step.kind === 'tool')
    .map((step) => ({
      tool: typeof step.inputSummary.tool === 'string' ? step.inputSummary.tool : 'tool',
      errorCode: step.errorCode,
      arguments: (step.inputSummary.arguments as Record<string, unknown> | undefined) ?? null,
      objectRef: step.outputRef,
    }))
  record.toolCallNames = record.stepReceipts.map((step) => step.tool)
  const modelSteps = steps.filter((step) => step.kind === 'model')
  record.modelCalls = modelSteps.length
  record.modelUsage = modelSteps.reduce((sum, step) => {
    const usage = (step.inputSummary as { usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number; cacheHitTokens?: number; cacheMissTokens?: number } }).usage
    return {
      prompt: sum.prompt + (usage?.promptTokens ?? 0),
      completion: sum.completion + (usage?.completionTokens ?? 0),
      total: sum.total + (usage?.totalTokens ?? 0),
      cacheHit: sum.cacheHit + (usage?.cacheHitTokens ?? 0),
      cacheMiss: sum.cacheMiss + (usage?.cacheMissTokens ?? 0),
    }
  }, { prompt: 0, completion: 0, total: 0, cacheHit: 0, cacheMiss: 0 })
  const trace = ctx.scheduler.getTrace(task.taskId)!
  record.modelText = (trace.events as ModelEvent[])
    .filter((event): event is Extract<ModelEvent, { type: 'token' }> => event.type === 'token')
    .map((event) => event.text)
    .join('')
  console.log(`[任务] ${record.item} state=${task.state}/${task.errorCode} 工具=${JSON.stringify(record.toolCallNames)} 模型文本=${record.modelText.slice(0, 400)}`)
}

function makeChecker(record: AttemptRecord) {
  return (name: string, ok: boolean, detail: unknown = ''): void => {
    record.assertions.push({ name, ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) })
    expect.soft(ok, `${record.item} ${name} ${JSON.stringify(detail)}`).toBe(true)
  }
}

/** 把这一条的断言与 notes 原样打进日志（证据自洽，不必再翻 JSON）。 */
function dump(record: AttemptRecord): void {
  record.outcome = record.assertions.length > 0 && record.assertions.every((assertion) => assertion.ok) ? 'PASS' : 'FAIL'
  console.log(`[结果] ${record.item} ${record.outcome} state=${record.taskState}/${record.taskErrorCode} 工具=${JSON.stringify(record.toolCallNames)} `
    + `tokens=${record.modelUsage.total}(hit ${record.modelUsage.cacheHit}/miss ${record.modelUsage.cacheMiss})`)
  for (const assertion of record.assertions) {
    console.log(`[断言] ${record.item} ${assertion.ok ? 'PASS' : 'FAIL'} ${assertion.name} :: ${assertion.detail}`)
  }
  for (const note of record.notes) console.log(`[说明] ${record.item} ${note}`)
}

function receiptOf(record: AttemptRecord, tool: string): RawReceipt | undefined {
  return record.toolCalls.find((receipt) => receipt.tool === tool)
}

function valueOf(quantity: QuantityValue | null): number | null {
  return quantity === null ? null : quantity.valueQ
}

async function cleanupAll(): Promise<void> {
  for (const h of harnesses.splice(0)) await h.dispose()
}

describe.skipIf(!ENABLED)('ADR-001 第 3 步：真模型跑无任务书入口（3 条）', () => {
  let providerProbe: { ok: boolean; model: string | null; latencyMs: number; message: string } | null = null

  beforeAll(async () => {
    const adapter = new OpenAICompatibleAdapter({
      getApiKey: async () => KEY,
      settings: { baseUrl: BASE_URL, model: MODEL, timeoutMs: 120_000, maxRetries: 2 },
    })
    const probe = await adapter.testConnection()
    providerProbe = probe.ok
      ? { ok: true, model: probe.model, latencyMs: probe.latencyMs, message: '连接成功' }
      : { ok: false, model: null, latencyMs: 0, message: `${probe.code}: ${probe.message}` }
    console.log(`[连接测试] ${JSON.stringify(providerProbe)}`)
  }, 60_000)

  afterAll(async () => {
    await cleanupAll()
    for (const record of records) {
      record.outcome ??= record.assertions.length > 0 && record.assertions.every((assertion) => assertion.ok) ? 'PASS' : 'FAIL'
    }
    await fsp.mkdir(EVIDENCE, { recursive: true })
    const cost = accumulateCost(records)
    await fsp.writeFile(path.join(EVIDENCE, 'real-model-results.json'), serializeEvidence({
      adapter: { id: 'openai-compatible-1', baseUrlHost: new URL(BASE_URL).host, modelRequested: MODEL },
      providerProbe,
      identity: IDENTITY,
      budget: { maxToolCalls: 20, maxConsecutiveSameFailure: 2, requestTimeoutMs: 120_000 },
      pricing: PRICING,
      cost,
      records,
    }))
    // 原始回执另存一份日志（含真实 id 与模型原始参数）：证据 JSON 按仓库约定做归一化，
    // 这里保留逐条调用原文，供人工逐条核对。故意用 .log 后缀：docs/evidence 下的证据守卫
    // 会扫描全部 *.json（禁止未标记 UUID 与机器路径），原始回执在这种扫描之外。
    await fsp.writeFile(path.join(EVIDENCE, 'logs/25-intent-real-model-raw.log'), `${JSON.stringify({
      providerProbe,
      identity: IDENTITY,
      cost,
      records: records.map((record) => ({
        item: record.item,
        goal: record.goal,
        systemPrompt: record.systemPrompt,
        startedAt: record.startedAt,
        durationMs: record.durationMs,
        outcome: record.outcome,
        taskState: record.taskState,
        taskErrorCode: record.taskErrorCode,
        modelText: record.modelText,
        modelCalls: record.modelCalls,
        modelUsage: record.modelUsage,
        toolCalls: record.toolCalls,
        stepReceipts: record.stepReceipts,
        assertions: record.assertions,
        notes: record.notes,
      })),
    }, null, 2)}\n`)
    console.log(`[成本] ${JSON.stringify(cost)}`)
  }, 60_000)

  /**
   * D1 建项：一句自然语言需求 → 模型必须调 createProject。
   * 判据：工具回执成功（结构化） + 项目来源 user-intent + 责任人/会话字段写进项目，
   * 且这些字段经 .cunlian 编码/解码后仍逐字段一致（落盘形状）。
   */
  it('D1 建项：模型调 createProject，来源 user-intent，责任人与会话字段进项目', async () => {
    const record: AttemptRecord = {
      item: 'D1', goal: USER_TEXT_1, systemPrompt: '', startedAt: new Date().toISOString(), durationMs: 0,
      taskState: null, taskErrorCode: null, modelText: '', toolCalls: [], stepReceipts: [], toolCallNames: [],
      modelUsage: { prompt: 0, completion: 0, total: 0, cacheHit: 0, cacheMiss: 0 }, modelCalls: 0, assertions: [], notes: [],
    }
    records.push(record)
    const check = makeChecker(record)
    try {
      const ctx = await openBlank()
      await runTask(ctx, record, USER_TEXT_1)
      record.toolCalls = [...ctx.dispatcher.receipts]
      const create = receiptOf(record, 'createProject')
      check('模型确实调用了 createProject', create !== undefined, record.toolCallNames)
      check('createProject 回执成功（工具回执是唯一事实）', create?.ok === true, create ?? 'no-call')
      const project = projectOf(ctx)
      check('项目来源 = user-intent', project.sourceKind === 'user-intent', project.sourceKind)
      check('责任人 = 老王（界面绑定，不是模型编的）', project.actorId === IDENTITY.actorId, project.actorId)
      check('会话序号 = 1', project.sessionSeq === 1, project.sessionSeq)
      check('会话标签写进项目', project.sessionLabel === IDENTITY.sessionLabel, project.sessionLabel)
      check('意图草稿已建立', intentDraftOf(project) !== null,
        intentDraftOf(project) === null ? 'no-draft' : { draftId: intentDraftOf(project)!.draftId, candidates: intentDraftOf(project)!.candidates.length })
      check('正式数据未被写（项目参数/条款仍为空；模型只写草稿）',
        project.parameters.length === 0 && project.requirementRevisions.length === 0,
        { parameters: project.parameters.length, requirements: project.requirementRevisions.length })
      // 落盘形状：编成 .cunlian 再读回，身份字段逐字段一致。
      const encoded = await encodeProjectFile(ctx.h.projectService.getSession(ctx.sessionId)!.snapshot)
      check('.cunlian 编码成功', encoded.ok, encoded.ok ? '' : `${encoded.error.code} ${encoded.error.message}`)
      if (encoded.ok) {
        const decoded = await decodeProjectFile(encoded.value.bytes)
        check('.cunlian 解码成功', decoded.ok, decoded.ok ? '' : `${decoded.error.code} ${decoded.error.message}`)
        const restored = decoded.ok ? decoded.value.snapshot.project : null
        check('落盘后来源种类/责任人/会话字段逐字段一致',
          restored?.sourceKind === 'user-intent' && restored?.actorId === IDENTITY.actorId
          && restored?.sessionSeq === 1 && restored?.sessionLabel === IDENTITY.sessionLabel,
          restored === null ? 'no-decode' : {
            sourceKind: restored.sourceKind, actorId: restored.actorId, sessionSeq: restored.sessionSeq, sessionLabel: restored.sessionLabel,
          })
      }
      check('任务没以失败结束', record.taskState !== 'failed', `${record.taskState}/${record.taskErrorCode}`)
    } catch (error) {
      record.notes.push(`异常：${error instanceof Error ? error.message : String(error)}`)
      check('流程无异常', false, record.notes.at(-1))
    } finally {
      record.outcome = record.assertions.length > 0 && record.assertions.every((assertion) => assertion.ok) ? 'PASS' : 'FAIL'
      dump(record)
      await cleanupAll()
    }
  }, 600_000)

  /**
   * D2 起草链：模型必须调 setChain 与 setBinding；环、参数与绑定进草稿且数值一个不改。
   * 期望值直接由用户原话推出（52.25/20/12.05/32/20，偏差 0.02/0.01），不写死“模型应该说什么”。
   */
  it('D2 起草链：模型调 setChain + setBinding，环与绑定进草稿，数值一个不改', async () => {
    const record: AttemptRecord = {
      item: 'D2', goal: USER_TEXT_2, systemPrompt: '', startedAt: new Date().toISOString(), durationMs: 0,
      taskState: null, taskErrorCode: null, modelText: '', toolCalls: [], stepReceipts: [], toolCallNames: [],
      modelUsage: { prompt: 0, completion: 0, total: 0, cacheHit: 0, cacheMiss: 0 }, modelCalls: 0, assertions: [], notes: [],
    }
    records.push(record)
    const check = makeChecker(record)
    try {
      const ctx = await openBlank()
      await runTask(ctx, record, USER_TEXT_2)
      record.toolCalls = [...ctx.dispatcher.receipts]
      const chainCalls = record.toolCalls.filter((receipt) => receipt.tool === 'setChain')
      const bindingCalls = record.toolCalls.filter((receipt) => receipt.tool === 'setBinding')
      check('模型确实调用了 setChain', chainCalls.length > 0, record.toolCallNames)
      check('至少一次 setChain 成功（失败尝试见 notes）', chainCalls.some((receipt) => receipt.ok), chainCalls.map((receipt) => receipt.code))
      check('模型确实调用了 setBinding', bindingCalls.length > 0, record.toolCallNames)
      check('至少一次 setBinding 成功（失败尝试见 notes）', bindingCalls.some((receipt) => receipt.ok), bindingCalls.map((receipt) => receipt.code))
      const failedCalls = record.toolCalls.filter((receipt) => !receipt.ok)
      if (failedCalls.length > 0) {
        record.notes.push(`模型有 ${failedCalls.length} 次失败调用（随后自纠）：${JSON.stringify(failedCalls.map((receipt) => ({ tool: receipt.tool, code: receipt.code, message: receipt.message, arguments: receipt.arguments })))}`)
      }
      record.notes.push(`任务最终状态 ${record.taskState}/${record.taskErrorCode}`)
      if (record.taskState === 'failed') {
        record.notes.push('调度层把“本轮有过工具失败”记为 failed（既有语义），本条的判据是工具与草稿内容，不拿任务终态判定；'
          + '该状态在界面上的表现见交付说明。')
      }
      const project = projectOf(ctx)
      const draft = intentDraftOf(project)
      check('意图草稿存在', draft !== null, draft === null ? 'null' : draft.draftId)
      if (draft === null) return
      const rings = draft.candidates
        .filter((candidate) => candidate.kind === 'ring')
        .map((candidate) => candidate as Extract<typeof candidate, { kind: 'ring' }>)
      check('组成环 4 个：H/B1/S/B2', JSON.stringify(rings.map((ring) => ring.data.symbol).sort()) === JSON.stringify(['B1', 'B2', 'H', 'S']),
        rings.map((ring) => ring.data.symbol))
      const bySymbol = new Map(rings.map((ring) => [ring.data.symbol, ring.data]))
      const expected: [string, number, number, number][] = [
        ['H', 522_500, 200, -200],
        ['B1', 200_000, 100, -100],
        ['B2', 200_000, 100, -100],
        ['S', 120_500, 100, -100],
      ]
      for (const [symbol, nominalQ, upperQ, lowerQ] of expected) {
        const ring = bySymbol.get(symbol)
        check(`${symbol} 基本尺寸/上下偏差一个不改（${nominalQ / 10_000} / +${upperQ / 10_000} / ${lowerQ / 10_000}）`,
          valueOf(ring?.nominal ?? null) === nominalQ
          && valueOf(ring?.upperDeviation ?? null) === upperQ
          && valueOf(ring?.lowerDeviation ?? null) === lowerQ,
          ring === undefined ? `缺 ${symbol}` : {
            nominal: valueOf(ring.nominal), upper: valueOf(ring.upperDeviation), lower: valueOf(ring.lowerDeviation),
          })
      }
      const part = draft.candidates.find((candidate) => candidate.kind === 'part-dimension')
      check('隔套参数 内径 20 / 外径 32 / 长 12.05 一个不改',
        part?.kind === 'part-dimension'
        && valueOf(part.data.innerDiameter) === 200_000
        && valueOf(part.data.outerDiameter) === 320_000
        && valueOf(part.data.length) === 120_500,
        part?.kind === 'part-dimension' ? {
          inner: valueOf(part.data.innerDiameter), outer: valueOf(part.data.outerDiameter), length: valueOf(part.data.length),
        } : 'no-part-candidate')
      const lengthBinding = (draft.intentBindings ?? []).find((item) => item.parameter === 'length')
      check('长度 ↔ S 的绑定写进草稿（120500）',
        lengthBinding?.symbol === 'S' && lengthBinding?.valueQ === 120_500, lengthBinding ?? 'no-binding')
      check('候选全部仍是 pending（模型不能替用户确认）',
        draft.candidates.every((candidate) => candidate.status === 'pending'),
        draft.candidates.map((candidate) => `${candidate.kind}:${candidate.status}`))
      check('项目正式数据未被写（参数/条款/图纸仍为空）',
        project.parameters.length === 0 && project.requirementRevisions.length === 0 && project.drawings.length === 0,
        { parameters: project.parameters.length, requirements: project.requirementRevisions.length, drawings: project.drawings.length })
    } catch (error) {
      record.notes.push(`异常：${error instanceof Error ? error.message : String(error)}`)
      check('流程无异常', false, record.notes.at(-1))
    } finally {
      record.outcome = record.assertions.length > 0 && record.assertions.every((assertion) => assertion.ok) ? 'PASS' : 'FAIL'
      dump(record)
      await cleanupAll()
    }
  }, 600_000)

  /**
   * D3 代填条款被拒：用户没给上下限 → setRequirement 必须收到 REQUIREMENT_MUST_BE_USER_GIVEN。
   * 同时验证草稿条款仍为空。附带补充轮（D3b）证明同一工具对“用户自己说的区间”是放行的。
   */
  it('D3 代填条款被拒：REQUIREMENT_MUST_BE_USER_GIVEN，且草稿条款仍为空', async () => {
    const record: AttemptRecord = {
      item: 'D3', goal: USER_TEXT_3, systemPrompt: '', startedAt: new Date().toISOString(), durationMs: 0,
      taskState: null, taskErrorCode: null, modelText: '', toolCalls: [], stepReceipts: [], toolCallNames: [],
      modelUsage: { prompt: 0, completion: 0, total: 0, cacheHit: 0, cacheMiss: 0 }, modelCalls: 0, assertions: [], notes: [],
    }
    const supplement: AttemptRecord = {
      item: 'D3b', goal: USER_TEXT_3B, systemPrompt: '', startedAt: new Date().toISOString(), durationMs: 0,
      taskState: null, taskErrorCode: null, modelText: '', toolCalls: [], stepReceipts: [], toolCallNames: [],
      modelUsage: { prompt: 0, completion: 0, total: 0, cacheHit: 0, cacheMiss: 0 }, modelCalls: 0, assertions: [], notes: [],
    }
    records.push(record, supplement)
    const check = makeChecker(record)
    const checkSupplement = makeChecker(supplement)
    try {
      const ctx = await openBlank()
      await runTask(ctx, record, USER_TEXT_3)
      record.toolCalls = [...ctx.dispatcher.receipts]
      const requirementAttempts = record.toolCalls.filter((receipt) => receipt.tool === 'setRequirement')
      check('模型确实尝试代填条款（调用了 setRequirement）', requirementAttempts.length > 0, record.toolCallNames)
      check('每次代填都被拒：REQUIREMENT_MUST_BE_USER_GIVEN',
        requirementAttempts.length > 0
        && requirementAttempts.every((receipt) => receipt.ok === false && receipt.code === 'REQUIREMENT_MUST_BE_USER_GIVEN'),
        requirementAttempts.map((receipt) => ({ ok: receipt.ok, code: receipt.code, message: receipt.message, arguments: receipt.arguments })))
      const draft = intentDraftOf(projectOf(ctx))
      const intervals = draft?.candidates.filter((candidate) => candidate.kind === 'interval') ?? []
      check('草稿条款仍为空（没有任何区间候选）', intervals.length === 0, intervals.map((candidate) => candidate.candidateId))
      check('项目里没有生成条款版本', projectOf(ctx).requirementRevisions.length === 0, projectOf(ctx).requirementRevisions.length)
      record.notes.push(`模型原文：${record.modelText.slice(0, 400)}`)

      // 补充轮：同一会话、用户自己给出区间 → 应当放行（证明拒绝只针对“不是用户给的”）。
      await runTask(ctx, supplement, USER_TEXT_3B)
      supplement.toolCalls = [...ctx.dispatcher.receipts].filter((receipt) => !record.toolCalls.includes(receipt))
      const accepted = supplement.toolCalls.filter((receipt) => receipt.tool === 'setRequirement')
      checkSupplement('用户给出区间后 setRequirement 被接受（补充证据，不改变 D3 结论）',
        accepted.length > 0 && accepted.every((receipt) => receipt.ok === true),
        accepted.map((receipt) => ({ ok: receipt.ok, code: receipt.code, arguments: receipt.arguments })))
      const interval = intentDraftOf(projectOf(ctx))?.candidates.find((candidate) => candidate.kind === 'interval')
      checkSupplement('区间写入草稿为 0.15～0.25 且两端含',
        interval?.kind === 'interval'
        && valueOf(interval.data.lower) === 1500
        && valueOf(interval.data.upper) === 2500
        && interval.data.lowerInclusive === true
        && interval.data.upperInclusive === true,
        interval?.kind === 'interval' ? {
          lower: valueOf(interval.data.lower), upper: valueOf(interval.data.upper),
          lowerInclusive: interval.data.lowerInclusive, upperInclusive: interval.data.upperInclusive,
        } : 'no-interval')
    } catch (error) {
      record.notes.push(`异常：${error instanceof Error ? error.message : String(error)}`)
      check('流程无异常', false, record.notes.at(-1))
    } finally {
      record.outcome = record.assertions.length > 0 && record.assertions.every((assertion) => assertion.ok) ? 'PASS' : 'FAIL'
      supplement.outcome = supplement.assertions.length > 0 && supplement.assertions.every((assertion) => assertion.ok) ? 'PASS' : 'FAIL'
      dump(record)
      dump(supplement)
      await cleanupAll()
    }
  }, 900_000)
})

/** DeepSeek 官网页脚价目表（USD / 百万 token，2026-11，deepseek-flash off-peak）。 */
const PRICING = {
  currency: 'USD',
  period: 'off-peak',
  inputCacheMissPerMillion: 0.15,
  inputCacheHitPerMillion: 0.003,
  outputPerMillion: 0.6,
  source: 'https://api-docs.deepseek.com/quick_start/pricing（deepseek-flash 列，off-peak 价）',
}

function accumulateCost(items: AttemptRecord[]) {
  let cacheMiss = 0
  let cacheHit = 0
  let completion = 0
  let prompt = 0
  let toolCalls = 0
  for (const item of items) {
    prompt += item.modelUsage.prompt
    completion += item.modelUsage.completion
    cacheMiss += item.modelUsage.cacheMiss
    cacheHit += item.modelUsage.cacheHit
    toolCalls += item.toolCalls.length
  }
  const cost = (cacheMiss * PRICING.inputCacheMissPerMillion + cacheHit * PRICING.inputCacheHitPerMillion + completion * PRICING.outputPerMillion) / 1_000_000
  return {
    promptTokens: prompt, completionTokens: completion, cacheHitTokens: cacheHit, cacheMissTokens: cacheMiss,
    toolCalls, estimatedUsd: Number(cost.toFixed(6)),
  }
}
