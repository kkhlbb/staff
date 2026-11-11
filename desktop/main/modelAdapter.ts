/**
 * §8 模型适配器：阶段 2 只实现可脚本化的 fake 适配器与“未配置”状态。
 *
 * 真实 GPT 适配器（openai-responses-1）只保留接口标识；密钥读取与 Keychain
 * 写入留到阶段 4。本文件不读取、不记录、不持久化任何密钥。
 */
import type { ModelAdapter, ModelEvent, ModelReply, ModelRequest } from '../../src/agent/types'

export const FAKE_MODEL_ID = 'fake-1'
export const OPENAI_RESPONSES_1 = 'openai-responses-1'

export type FakeModelStep =
  | { kind: 'text'; text: string }
  | { kind: 'tool_calls'; text?: string; calls: { name: string; argumentsJson: string }[]; delayMs?: number }
  /** 永不返回；由调度层超时中止。 */
  | { kind: 'timeout' }
  /** 模拟连接失败。 */
  | { kind: 'connection_failure'; message?: string }
  /** 模拟返回非 JSON / 协议错误。 */
  | { kind: 'invalid_reply'; message?: string }

export class ModelAdapterError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ModelAdapterError'
    this.code = code
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

/** 按脚本逐步返回的假模型；脚本步耗尽后返回空文本，便于测试显式控制。 */
export class FakeModelAdapter implements ModelAdapter {
  readonly id: string
  private readonly script: FakeModelStep[]
  private readonly cancelled = new Set<string>()

  constructor(id: string = FAKE_MODEL_ID, script: FakeModelStep[] = []) {
    this.id = id
    this.script = [...script]
  }

  remainingSteps(): number {
    return this.script.length
  }

  async generate(request: ModelRequest): Promise<ModelReply> {
    return this.streamEvents(request, () => { /* generate 不消费事件 */ })
  }

  async streamEvents(request: ModelRequest, onEvent: (event: ModelEvent) => void): Promise<ModelReply> {
    // 取消只作用于“当前在途请求”：进入新请求时清掉上一轮遗留标志，
    // 这样超时后的任务可以按 §7 恢复继续。
    this.cancelled.delete(request.taskId)
    const step = this.script.shift()
    if (step === undefined) return { text: '', toolCalls: [] }
    switch (step.kind) {
      case 'text': {
        onEvent({ type: 'token', text: step.text })
        const reply: ModelReply = { text: step.text, toolCalls: [] }
        onEvent({ type: 'done', reply })
        return reply
      }
      case 'tool_calls': {
        if (step.delayMs !== undefined) await delay(step.delayMs)
        // 取消只作为提示；在途回包仍会到达，由调度层按 taskId+projectId 与取消标志丢弃。
        step.calls.forEach((call, index) => {
          onEvent({ type: 'tool_call_start', index, name: call.name })
          onEvent({ type: 'tool_call_args_done', index, name: call.name, argumentsJson: call.argumentsJson })
        })
        const reply: ModelReply = { text: step.text ?? '', toolCalls: step.calls.map((call) => ({ ...call })) }
        onEvent({ type: 'done', reply })
        return reply
      }
      case 'timeout':
        return new Promise<ModelReply>(() => { /* 由调度层超时中断 */ })
      case 'connection_failure': {
        const message = step.message ?? '模型连接失败'
        onEvent({ type: 'error', code: 'CONNECTION_FAILED', message })
        throw new ModelAdapterError('CONNECTION_FAILED', message)
      }
      case 'invalid_reply': {
        const message = step.message ?? '模型返回内容不是合法 JSON'
        onEvent({ type: 'error', code: 'INVALID_REPLY', message })
        throw new ModelAdapterError('INVALID_REPLY', message)
      }
    }
  }

  cancel(taskId: string): void {
    this.cancelled.add(taskId)
  }
}

export class ModelAdapterRegistry {
  private readonly adapters = new Map<string, ModelAdapter>()

  register(adapter: ModelAdapter): void {
    this.adapters.set(adapter.id, adapter)
  }

  get(id: string): ModelAdapter | undefined {
    return this.adapters.get(id)
  }

  ids(): string[] {
    return [...this.adapters.keys()]
  }
}

export interface ProviderStatus {
  configured: boolean
  provider: string | null
}

/**
 * 未配置供应商：没有真实适配器时的显式状态（阶段 2 语义，阶段 4 仍作为兜底）。
 * 不返回模型 ID、不返回密钥片段，也不尝试联网，避免“看起来可用”。
 */
export class UnconfiguredModelProvider {
  getProviderStatus(): ProviderStatus {
    return { configured: false, provider: null }
  }
}
