/**
 * V4.0 阶段 4：OpenAI 兼容适配器（供应商可替换）。
 *
 * 契约（§8）：generate / streamEvents / cancel。请求走 `{baseUrl}/chat/completions`，
 * 带 `tools` 的 function calling 与结构流式（SSE）接收。
 *
 * 边界：
 * - 密钥只通过 getApiKey 注入，不进入请求体、事件、错误消息或日志；所有对外文本
 *   都过 scrub()，即使供应商回显也会被替换。
 * - 重试只在网络层（fetch 抛错 / 429 / 5xx）；4xx 参数或鉴权错误不重试。
 * - 取消与超时都用 AbortController；取消导致的失败码是 CANCELLED，超时是 TIMEOUT。
 * - 错误码映射到 ToolErrorCode 子集，供调度层记录与界面展示。
 */
import type {
  ModelAdapter,
  ModelEvent,
  ModelMessage,
  ModelReply,
  ModelRequest,
  ModelToolCall,
  ModelUsage,
} from '../../src/agent/types'
import { ModelAdapterError } from './modelAdapter'

export const OPENAI_COMPATIBLE_1 = 'openai-compatible-1'
export const OPENAI_COMPATIBLE_LABEL = 'OpenAI 兼容协议（chat/completions + tools）'

export interface OpenAICompatibleSettings {
  /** 例如 https://api.deepseek.com/v1（不带尾斜杠也可）。 */
  baseUrl: string
  /** 供应商模型 ID，例如 deepseek-chat。 */
  model: string
  /** 单次请求超时；未给出时用任务预算。 */
  timeoutMs?: number
  /** Require provider-authored IDs and use non-streaming Chat Completions. */
  strictToolProtocol?: boolean
  /** 网络层重试次数，默认 2；只对可重试错误生效。 */
  maxRetries?: number
  /** 重试基础退避毫秒，默认 400，按次数指数增长。 */
  retryBaseMs?: number
}

export interface OpenAICompatibleDeps {
  /** 每次请求时读取；返回 null 表示未配置密钥（不抛错）。 */
  getApiKey: () => Promise<string | null>
  settings: OpenAICompatibleSettings
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  /** 允许注入等待函数，测试里跳过退避。 */
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_BASE_MS = 400

interface WireToolCall {
  id?: string
  index?: number
  type?: string
  function?: { name?: string; arguments?: string }
}

const delay = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

/** 把任何出现在文本里的密钥替换掉；不依赖调用方记得脱敏。 */
function scrub(text: string, key: string | null): string {
  if (key === null || key.length < 8) return text
  return text.split(key).join('<redacted>')
}

function joinUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}${suffix}`
}

/** 把调度层消息映射成 OpenAI 兼容 wire 消息；tool 轮必须带 tool_call_id。 */
export function toWireMessages(messages: ModelMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId ?? 'call_unknown',
        content: message.content,
      }
    }
    if (message.role === 'assistant' && message.toolCalls !== undefined && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content,
        tool_calls: message.toolCalls.map((call, index) => ({
          id: call.id ?? `call_local_${index}`,
          type: 'function',
          function: { name: call.name, arguments: call.argumentsJson },
        })),
      }
    }
    return { role: message.role, content: message.content }
  })
}

export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly id = OPENAI_COMPATIBLE_1
  private readonly deps: OpenAICompatibleDeps
  private readonly controllers = new Map<string, AbortController>()
  private readonly cancelled = new Set<string>()

  constructor(deps: OpenAICompatibleDeps) {
    this.deps = deps
  }

  async generate(request: ModelRequest): Promise<ModelReply> {
    return this.streamEvents(request, () => { /* generate 不消费事件 */ })
  }

  async streamEvents(request: ModelRequest, onEvent: (event: ModelEvent) => void): Promise<ModelReply> {
    this.deps.signal?.throwIfAborted()
    const key = await this.deps.getApiKey()
    this.deps.signal?.throwIfAborted()
    if (key === null || key.trim() === '') {
      onEvent({ type: 'error', code: 'CONNECTION_FAILED', message: '模型尚未配置密钥' })
      throw new ModelAdapterError('CONNECTION_FAILED', '模型尚未配置密钥')
    }
    this.cancelled.delete(request.taskId)
    const controller = new AbortController()
    this.controllers.set(request.taskId, controller)
    const timeoutMs = this.deps.settings.timeoutMs ?? request.budget.requestTimeoutMs
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    const maxRetries = this.deps.settings.maxRetries ?? DEFAULT_MAX_RETRIES
    const baseMs = this.deps.settings.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
    const sleep = this.deps.sleep ?? delay
    try {
      let attempt = 0
      for (;;) {
        try {
          return await this.once(request, key, this.signal(controller.signal), onEvent)
        } catch (error) {
          if (this.deps.signal?.aborted || this.cancelled.has(request.taskId) || (error instanceof Error && error.name === 'AbortError')) {
            if (timedOut) throw new ModelAdapterError('TIMEOUT', scrub(`模型请求超过 ${timeoutMs} ms 未返回`, key))
            throw new ModelAdapterError('CANCELLED', '模型请求已取消')
          }
          const failure = this.asFailure(error, key)
          if (failure.retryable && attempt < maxRetries) {
            attempt += 1
            await sleep(baseMs * 2 ** (attempt - 1))
            continue
          }
          onEvent({ type: 'error', code: failure.code, message: failure.message })
          throw new ModelAdapterError(failure.code, failure.message)
        }
      }
    } finally {
      clearTimeout(timer)
      this.controllers.delete(request.taskId)
    }
  }

  cancel(taskId: string): void {
    this.cancelled.add(taskId)
    this.controllers.get(taskId)?.abort()
  }

  /** 连接测试：只发合成文本，不带项目资料；返回供应商回执里的模型名与耗时。 */
  async testConnection(): Promise<{ ok: true; model: string; latencyMs: number } | { ok: false; code: string; message: string }> {
    const key = await this.deps.getApiKey()
    if (key === null || key.trim() === '') return { ok: false, code: 'CONNECTION_FAILED', message: '尚未配置密钥' }
    const startedAt = Date.now()
    const controller = new AbortController()
    const timeoutMs = this.deps.settings.timeoutMs ?? 20_000
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await (this.deps.fetchImpl ?? fetch)(joinUrl(this.deps.settings.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: this.deps.settings.model,
          messages: [{ role: 'user', content: '连接测试：请只回复 OK。' }],
          max_tokens: 8,
          stream: false,
        }),
        signal: controller.signal,
      })
      const text = await response.text()
      if (!response.ok) {
        const failure = this.httpFailure(response.status, text, key)
        return { ok: false, code: failure.code, message: failure.message }
      }
      const body = JSON.parse(text) as { model?: string; choices?: unknown[] }
      if (!Array.isArray(body.choices) || body.choices.length === 0) {
        return { ok: false, code: 'INVALID_REPLY', message: '供应商回执缺少 choices' }
      }
      return { ok: true, model: typeof body.model === 'string' ? body.model : this.deps.settings.model, latencyMs: Date.now() - startedAt }
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') {
        return { ok: false, code: 'TIMEOUT', message: `连接测试超过 ${timeoutMs} ms` }
      }
      return { ok: false, code: 'CONNECTION_FAILED', message: scrub(caught instanceof Error ? caught.message : '连接失败', key) }
    } finally {
      clearTimeout(timer)
    }
  }

  private signal(local: AbortSignal): AbortSignal {
    return this.deps.signal ? AbortSignal.any([local, this.deps.signal]) : local
  }

  async listModels({ allowAnonymous = false } = {}): Promise<string[]> {
    const key = await this.deps.getApiKey()
    if (!key && !allowAnonymous) throw new ModelAdapterError('INVALID_API_KEY', '模型尚未配置密钥')
    const response = await (this.deps.fetchImpl ?? fetch)(joinUrl(this.deps.settings.baseUrl, '/models'), {
      headers: key ? { authorization: `Bearer ${key}` } : {},
      redirect: 'error',
      signal: this.signal(AbortSignal.timeout(this.deps.settings.timeoutMs ?? 20_000)),
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new ModelAdapterError(response.status === 401 || response.status === 403 ? 'AUTH_FAILED' : 'DISCONNECTED', '模型列表请求失败')
    }
    const body: unknown = await response.json()
    const data = body && typeof body === 'object' && 'data' in body ? body.data : null
    if (!Array.isArray(data)) throw new ModelAdapterError('DISCONNECTED', '模型列表格式无效')
    return [...new Set(data.flatMap((entry: unknown) =>
      entry && typeof entry === 'object' && 'id' in entry && typeof entry.id === 'string' && entry.id.trim() !== '' ? [entry.id] : []))]
  }

  private async once(
    request: ModelRequest,
    key: string,
    signal: AbortSignal,
    onEvent: (event: ModelEvent) => void,
  ): Promise<ModelReply> {
    const response = await (this.deps.fetchImpl ?? fetch)(joinUrl(this.deps.settings.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: this.deps.settings.model,
        messages: [{ role: 'system', content: request.systemPrompt }, ...toWireMessages(request.messages)],
        tools: request.tools.map((tool) => ({
          type: 'function',
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        })),
        tool_choice: 'auto',
        ...(this.deps.settings.strictToolProtocol ? { stream: false } : { stream: true, stream_options: { include_usage: true } }),
      }),
      signal,
      ...(this.deps.settings.strictToolProtocol ? { redirect: 'error' as const } : {}),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      if (this.deps.settings.strictToolProtocol && [401, 403].includes(response.status)) {
        throw Object.assign(new Error('模型认证失败'), { adapterCode: 'AUTH_FAILED' })
      }
      if (this.deps.settings.strictToolProtocol && [400, 422].includes(response.status) &&
        /(?:tools?|function.calling)/iu.test(text)) {
        throw Object.assign(new Error('模型拒绝工具调用'), { adapterCode: 'TOOL_CALL_UNSUPPORTED' })
      }
      const failure = this.httpFailure(response.status, text, key)
      throw Object.assign(new Error(failure.message), { adapterCode: failure.code, retryable: failure.retryable })
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (!this.deps.settings.strictToolProtocol && contentType.includes('text/event-stream') && response.body !== null) {
      return this.readStream(response.body, request.taskId, onEvent)
    }
    const body = await response.text()
    return this.readJson(body, request.taskId, onEvent, key)
  }

  private async readStream(
    body: ReadableStream<Uint8Array>,
    taskId: string,
    onEvent: (event: ModelEvent) => void,
  ): Promise<ModelReply> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let usage: ModelUsage | undefined
    const calls = new Map<number, { id?: string; name: string; argumentsJson: string; emittedStart: boolean }>()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE 事件以空行分隔；保留最后一段未完成数据。
      const events = buffer.split(/\r?\n\r?\n/u)
      buffer = events.pop() ?? ''
      for (const chunk of events) {
        const dataLines = chunk.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim())
        if (dataLines.length === 0) continue
        const payload = dataLines.join('\n')
        if (payload === '[DONE]') continue
        let parsed: {
          model?: string
          choices?: { delta?: { content?: string | null; tool_calls?: WireToolCall[] } }[]
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number } | null
        }
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue
        }
        if (parsed.usage !== undefined && parsed.usage !== null) {
          usage = {
            promptTokens: parsed.usage.prompt_tokens ?? 0,
            completionTokens: parsed.usage.completion_tokens ?? 0,
            totalTokens: parsed.usage.total_tokens ?? 0,
            ...(parsed.usage.prompt_cache_hit_tokens === undefined ? {} : { cacheHitTokens: parsed.usage.prompt_cache_hit_tokens }),
            ...(parsed.usage.prompt_cache_miss_tokens === undefined ? {} : { cacheMissTokens: parsed.usage.prompt_cache_miss_tokens }),
          }
        }
        const delta = parsed.choices?.[0]?.delta
        if (delta === undefined) continue
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          text += delta.content
          onEvent({ type: 'token', text: delta.content })
        }
        for (const wire of delta.tool_calls ?? []) {
          const index = wire.index ?? calls.size
          const current = calls.get(index) ?? { id: wire.id, name: '', argumentsJson: '', emittedStart: false }
          if (wire.id !== undefined) current.id = wire.id
          if (wire.function?.name !== undefined && wire.function.name !== '') current.name = wire.function.name
          if (wire.function?.arguments !== undefined) current.argumentsJson += wire.function.arguments
          if (!current.emittedStart && current.name !== '') {
            current.emittedStart = true
            onEvent({ type: 'tool_call_start', index, name: current.name })
          }
          calls.set(index, current)
        }
      }
    }
    const toolCalls: ModelToolCall[] = [...calls.entries()]
      .sort(([left], [right]) => left - right)
      .filter(([, call]) => call.name !== '')
      .map(([index, call]) => {
        onEvent({ type: 'tool_call_args_done', index, name: call.name, argumentsJson: call.argumentsJson === '' ? '{}' : call.argumentsJson })
        return { id: call.id ?? `call_${taskId.slice(0, 8)}_${index}`, name: call.name, argumentsJson: call.argumentsJson === '' ? '{}' : call.argumentsJson }
      })
    const reply: ModelReply = { text, toolCalls, ...(usage === undefined ? {} : { usage }) }
    onEvent({ type: 'done', reply })
    return reply
  }

  private readJson(
    body: string,
    taskId: string,
    onEvent: (event: ModelEvent) => void,
    key: string,
  ): ModelReply {
    let parsed: {
      model?: string
      choices?: { message?: { content?: string | null; tool_calls?: WireToolCall[] } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }
    try {
      parsed = JSON.parse(body)
    } catch {
      throw Object.assign(new Error(scrub('供应商返回内容不是合法 JSON', key)), { adapterCode: 'INVALID_REPLY', retryable: false })
    }
    const message = parsed?.choices?.[0]?.message
    if (message == null || (this.deps.settings.strictToolProtocol && (typeof message !== 'object' ||
      (message.tool_calls != null && !Array.isArray(message.tool_calls))))) {
      throw Object.assign(new Error('供应商回执缺少 choices[0].message'), { adapterCode: 'INVALID_REPLY', retryable: false })
    }
    const text = typeof message.content === 'string' ? message.content : ''
    if (text.length > 0) onEvent({ type: 'token', text })
    const toolCalls: ModelToolCall[] = (message.tool_calls ?? []).map((call, index) => {
      if (this.deps.settings.strictToolProtocol &&
        (call?.type !== 'function' || typeof call.id !== 'string' || !call.id.trim() ||
          typeof call.function?.name !== 'string' || typeof call.function.arguments !== 'string')) {
        throw Object.assign(new Error('工具调用格式无效'), { adapterCode: 'INVALID_REPLY' })
      }
      const name = call.function?.name ?? ''
      const argumentsJson = call.function?.arguments ?? '{}'
      onEvent({ type: 'tool_call_start', index, name })
      onEvent({ type: 'tool_call_args_done', index, name, argumentsJson })
      return { id: call.id ?? `call_${taskId.slice(0, 8)}_${index}`, name, argumentsJson }
    })
    const usage = parsed.usage === undefined ? undefined : {
      promptTokens: parsed.usage.prompt_tokens ?? 0,
      completionTokens: parsed.usage.completion_tokens ?? 0,
      totalTokens: parsed.usage.total_tokens ?? 0,
    }
    const reply: ModelReply = { text, toolCalls, ...(usage === undefined ? {} : { usage }) }
    onEvent({ type: 'done', reply })
    return reply
  }

  private httpFailure(status: number, body: string, key: string): { code: string; message: string; retryable: boolean } {
    const detail = scrub(extractErrorMessage(body), key).slice(0, 200)
    if (status === 401 || status === 403) return { code: 'CONNECTION_FAILED', message: `模型认证失败（HTTP ${status}）${detail === '' ? '' : `：${detail}`}`, retryable: false }
    if (status === 429 || status >= 500) return { code: 'CONNECTION_FAILED', message: `供应商暂时不可用（HTTP ${status}）${detail === '' ? '' : `：${detail}`}`, retryable: true }
    return { code: 'INVALID_INPUT', message: `供应商拒绝请求（HTTP ${status}）${detail === '' ? '' : `：${detail}`}`, retryable: false }
  }

  private asFailure(error: unknown, key: string): { code: string; message: string; retryable: boolean } {
    const tagged = error as { adapterCode?: string; retryable?: boolean; message?: string }
    if (typeof tagged.adapterCode === 'string') {
      return { code: tagged.adapterCode, message: scrub(tagged.message ?? '供应商请求失败', key), retryable: tagged.retryable === true }
    }
    return { code: 'CONNECTION_FAILED', message: scrub(tagged.message ?? '模型连接失败', key), retryable: true }
  }
}

/** 供应商错误体通常是 {"error":{"message":...}}；只取文本，绝不回显请求头。 */
function extractErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    if (typeof parsed.error === 'string') return parsed.error
    if (parsed.error !== undefined && typeof parsed.error.message === 'string') return parsed.error.message
    if (typeof parsed.message === 'string') return parsed.message
  } catch { /* 非 JSON 错误体 */ }
  return body.trim().slice(0, 200)
}
