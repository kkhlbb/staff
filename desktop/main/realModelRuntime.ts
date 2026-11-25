/**
 * V4.0 阶段 4：真实供应商运行时（ModelConfig + OpenAI 兼容适配器）的装配。
 *
 * 供主进程 IPC 与证据脚本共用同一实现：状态、保存、清除密钥、连接测试与适配器
 * 创建全部经由这里，避免界面、调度器、测试各自读一套配置。
 * 凭据仅在主进程内解析，交给适配器请求头、脱敏器或系统安全存储。
 */
import { createHash } from 'node:crypto'
import type { ModelAdapter } from '../../src/agent/types'
import type {
  AgentProviderSaveRequest,
  AgentProviderStatusValue,
  AgentProviderTestValue,
} from '../shared/contracts'
import type { KeychainStore } from './keychain'
import { ModelConfig, type ProviderSettings } from './modelConfig'
import { OPENAI_COMPATIBLE_1, OpenAICompatibleAdapter } from './openaiCompatibleAdapter'

export interface RealModelRuntimeDeps {
  rootDir: string
  keychain: KeychainStore
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  /** 连接测试超时；默认 20s。 */
  testTimeoutMs?: number
}

export class RealModelRuntime {
  private readonly config: ModelConfig
  private readonly deps: RealModelRuntimeDeps

  constructor(deps: RealModelRuntimeDeps) {
    this.deps = deps
    this.config = new ModelConfig({ rootDir: deps.rootDir, keychain: deps.keychain, ...(deps.env === undefined ? {} : { env: deps.env }) })
  }

  async ensureLoaded(): Promise<void> {
    await this.config.ensureLoaded()
  }

  async settings(): Promise<ProviderSettings> {
    return this.config.readSettings()
  }

  status(): AgentProviderStatusValue['real'] {
    const status = this.config.getProviderStatus()
    return {
      configured: status.configured,
      provider: status.provider,
      adapterId: status.adapterId,
      model: status.model,
      host: status.host,
      keyPresent: status.keyPresent,
      keySource: status.keySource,
      keyEnvVar: status.keyEnvVar,
      baseUrl: status.baseUrl,
    }
  }

  async save(input: AgentProviderSaveRequest): Promise<{ ok: true } | { ok: false; message: string }> {
    return this.config.save(input)
  }

  async clearKey(): Promise<void> {
    await this.config.clearKey()
  }

  /** 适配器按当前配置创建；每次任务新建，避免跨任务共享在途取消状态。 */
  async createAdapter(): Promise<ModelAdapter | null> {
    await this.config.ensureLoaded()
    const settings = await this.config.readSettings()
    if (settings.adapterId !== OPENAI_COMPATIBLE_1) return null
    if (settings.baseUrl === '' || settings.model === '') return null
    const adapter = new OpenAICompatibleAdapter({
      getApiKey: () => this.config.resolveApiKey(),
      settings: { baseUrl: settings.baseUrl, model: settings.model },
      ...(this.deps.fetchImpl === undefined ? {} : { fetchImpl: this.deps.fetchImpl }),
    })
    return adapter
  }

  /** Resolve credentials once for a tested endpoint; chat never rereads a changed global key. */
  async createM1Connection(input: { baseUrl: string; model: string; apiKey: string }) {
    const account = 'm1-model-api:' + createHash('sha256').update(JSON.stringify([input.baseUrl, input.model])).digest('hex')
    const key = input.apiKey || await this.deps.keychain.read(account)
    if (!key || !/^[!-~]+$/u.test(key)) return null
    return {
      createAdapter: (signal: AbortSignal) => new OpenAICompatibleAdapter({
        getApiKey: async () => key,
        settings: { baseUrl: input.baseUrl, model: input.model, strictToolProtocol: true, maxRetries: 0,
          timeoutMs: this.deps.testTimeoutMs ?? 20_000 },
        ...(this.deps.fetchImpl === undefined ? {} : { fetchImpl: this.deps.fetchImpl }),
        signal,
      }),
      redact: (value: string) => value.split(key).join('[已隐藏]'),
      containsKey: (value: string) => value.includes(key),
      persistKey: () => this.deps.keychain.write(account, key),
    }
  }

  /** 连接测试只用合成文本；成功返回供应商回报的模型名与耗时。 */
  async testConnection(): Promise<AgentProviderTestValue> {
    await this.config.ensureLoaded()
    const settings = await this.config.readSettings()
    if (settings.adapterId !== OPENAI_COMPATIBLE_1) {
      return { ok: false, code: 'UNSUPPORTED_SCOPE', model: null, latencyMs: 0, message: `暂不支持适配器 ${settings.adapterId}` }
    }
    if (settings.baseUrl === '' || settings.model === '') {
      return { ok: false, code: 'INVALID_INPUT', model: null, latencyMs: 0, message: '请先填写 base_url 与模型 ID' }
    }
    const adapter = new OpenAICompatibleAdapter({
      getApiKey: () => this.config.resolveApiKey(),
      settings: {
        baseUrl: settings.baseUrl,
        model: settings.model,
        ...(this.deps.testTimeoutMs === undefined ? {} : { timeoutMs: this.deps.testTimeoutMs }),
      },
      ...(this.deps.fetchImpl === undefined ? {} : { fetchImpl: this.deps.fetchImpl }),
    })
    const result = await adapter.testConnection()
    return result.ok
      ? { ok: true, code: null, model: result.model, latencyMs: result.latencyMs, message: '连接成功' }
      : { ok: false, code: result.code, model: null, latencyMs: 0, message: result.message }
  }
}
