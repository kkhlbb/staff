/**
 * V4.0 阶段 4：真实供应商配置（非敏感部分）与状态。
 *
 * 存什么：adapterId / baseUrl / model / keySource / keyEnvVar，写到应用工作区的
 * `model-config.json`。**不存密钥**；密钥只在 macOS Keychain（见 keychain.ts）。
 *
 * 状态语义：
 * - configured 只表示“adapterId、baseUrl、model 齐全且能取到密钥”，不代表连接可用；
 *   连接诊断由 testConnection 单独给出，界面不得把“已配置”显示成“已可用”。
 * - provider 只回显 `<adapterId>:<model>`，不含密钥、不含完整 URL 的路径。
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import type { ProviderStatus } from './modelAdapter'
import { OPENAI_COMPATIBLE_1 } from './openaiCompatibleAdapter'
import type { KeychainStore } from './keychain'

export type ProviderKeySource = 'keychain' | 'keychain-or-env'

export interface ProviderSettings {
  adapterId: string
  baseUrl: string
  model: string
  /** keychain：只读钥匙串；keychain-or-env：钥匙串缺失时可读环境变量（验收/开发用）。 */
  keySource: ProviderKeySource
  /** keychain-or-env 时读取的环境变量名；不得回显其值。 */
  keyEnvVar: string
}

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  adapterId: OPENAI_COMPATIBLE_1,
  baseUrl: '',
  model: '',
  keySource: 'keychain',
  keyEnvVar: 'DEEPSEEK_API_KEY',
}

export interface ModelConfigDeps {
  /** 应用工作区目录；配置文件为 <rootDir>/model-config.json。 */
  rootDir: string
  keychain: KeychainStore
  env?: NodeJS.ProcessEnv
}

export interface ProviderStatusDetail extends ProviderStatus {
  adapterId: string | null
  model: string | null
  /** 只显示主机名，便于诊断；不含路径、查询串或密钥。 */
  host: string | null
  keyPresent: boolean
  keySource: ProviderKeySource
  keyEnvVar: string
  baseUrl: string | null
}

function hostOf(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.host
  } catch {
    return null
  }
}

export function validateProviderInput(input: { baseUrl: string; model: string }): { ok: true } | { ok: false; message: string } {
  const baseUrl = input.baseUrl.trim()
  if (baseUrl === '') return { ok: false, message: '请填写 base_url' }
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return { ok: false, message: 'base_url 不是合法 URL' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, message: 'base_url 只支持 http/https' }
  if (input.model.trim() === '') return { ok: false, message: '请填写模型 ID' }
  if (input.model.length > 120) return { ok: false, message: '模型 ID 过长' }
  return { ok: true }
}

export class ModelConfig {
  private readonly deps: ModelConfigDeps
  private settings: ProviderSettings = { ...DEFAULT_PROVIDER_SETTINGS }
  private loaded: Promise<void> | null = null
  private keyPresent = false

  constructor(deps: ModelConfigDeps) {
    this.deps = deps
  }

  filePath(): string {
    return path.join(this.deps.rootDir, 'model-config.json')
  }

  /** 读取配置文件与密钥存在性；重复调用复用同一次加载。 */
  async ensureLoaded(): Promise<void> {
    if (this.loaded === null) this.loaded = this.load()
    return this.loaded
  }

  async readSettings(): Promise<ProviderSettings> {
    await this.ensureLoaded()
    return { ...this.settings }
  }

  private async load(): Promise<void> {
    try {
      const text = await fsp.readFile(this.filePath(), 'utf8')
      const raw = JSON.parse(text) as Partial<ProviderSettings>
      this.settings = {
        adapterId: typeof raw.adapterId === 'string' && raw.adapterId !== '' ? raw.adapterId : OPENAI_COMPATIBLE_1,
        baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
        model: typeof raw.model === 'string' ? raw.model : '',
        keySource: raw.keySource === 'keychain-or-env' ? 'keychain-or-env' : 'keychain',
        keyEnvVar: typeof raw.keyEnvVar === 'string' && raw.keyEnvVar !== '' ? raw.keyEnvVar : 'DEEPSEEK_API_KEY',
      }
    } catch {
      this.settings = { ...DEFAULT_PROVIDER_SETTINGS }
    }
    this.keyPresent = (await this.deps.keychain.read(this.settings.adapterId)) !== null
  }

  async save(input: { baseUrl: string; model: string; apiKey?: string; keySource?: ProviderKeySource; keyEnvVar?: string }): Promise<{ ok: true } | { ok: false; message: string }> {
    await this.ensureLoaded()
    const validated = validateProviderInput(input)
    if (!validated.ok) return validated
    const next: ProviderSettings = {
      ...this.settings,
      adapterId: this.settings.adapterId === '' ? OPENAI_COMPATIBLE_1 : this.settings.adapterId,
      baseUrl: input.baseUrl.trim(),
      model: input.model.trim(),
      keySource: input.keySource ?? this.settings.keySource,
      keyEnvVar: input.keyEnvVar ?? this.settings.keyEnvVar,
    }
    if (input.apiKey !== undefined && input.apiKey !== '') {
      await this.deps.keychain.write(next.adapterId, input.apiKey)
      this.keyPresent = true
    }
    // 先写入再回读：配置文件只含非敏感字段。
    await fsp.mkdir(this.deps.rootDir, { recursive: true })
    const temp = `${this.filePath()}.${process.pid}.tmp`
    await fsp.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    await fsp.rename(temp, this.filePath())
    this.settings = next
    return { ok: true }
  }

  async clearKey(): Promise<void> {
    await this.ensureLoaded()
    await this.deps.keychain.remove(this.settings.adapterId)
    this.keyPresent = false
  }

  /** 首次发送前由调度层调用；密钥只在内存里交给适配器。 */
  async resolveApiKey(): Promise<string | null> {
    await this.ensureLoaded()
    const fromKeychain = await this.deps.keychain.read(this.settings.adapterId)
    if (fromKeychain !== null && fromKeychain !== '') {
      this.keyPresent = true
      return fromKeychain
    }
    if (this.settings.keySource === 'keychain-or-env') {
      const env = (this.deps.env ?? process.env)[this.settings.keyEnvVar]
      if (typeof env === 'string' && env.trim() !== '') return env.trim()
    }
    this.keyPresent = false
    return null
  }

  getProviderStatus(): ProviderStatusDetail {
    const host = hostOf(this.settings.baseUrl)
    const usable = this.settings.baseUrl !== '' && this.settings.model !== '' && host !== null
    return {
      configured: usable && this.keyPresent,
      provider: usable ? `${this.settings.adapterId}:${this.settings.model}` : null,
      adapterId: usable ? this.settings.adapterId : null,
      model: usable ? this.settings.model : null,
      host,
      keyPresent: this.keyPresent,
      keySource: this.settings.keySource,
      keyEnvVar: this.settings.keyEnvVar,
      baseUrl: this.settings.baseUrl === '' ? null : this.settings.baseUrl,
    }
  }
}
