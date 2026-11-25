/**
 * 密钥存储（V4.0 阶段 4 实现；本单改为 Electron `safeStorage`）。
 *
 * 只存密钥本身；base_url / model 等非敏感配置另存 JSON，不含密钥。
 *
 * 主路径：`safeStorage.encryptString/decryptString` + 本地密文文件
 *   - macOS 由 Electron 交给系统 Keychain（应用名为 Electron 的 safeStorage 条目）
 *   - Windows 交给 DPAPI
 *   - 密文文件只含 base64 密文，不含明文；权限 0600
 *
 * 迁移路径（只在 macOS 存在）：safeStorage 里没有、而旧 `security` Keychain 里有时，
 * 读出旧值 → 用 safeStorage 重存 → 之后读都命中新路径。旧记录不自动删除（删除是
 * 用户显式动作），但 `remove()` 会一并清掉旧记录，否则删掉的密钥会在下次读取时被迁回来。
 *
 * 仍然不许：密钥出现在进程参数、明文落盘、日志/证据/截图。写路径不再起子进程；
 * 旧 `security -i` 实现仅作为迁移读取源保留（仍然经 stdin 传密钥，ps 不可见）。
 */
import { execFile } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

export interface KeychainStore {
  read(account: string): Promise<string | null>
  write(account: string, secret: string): Promise<void>
  remove(account: string): Promise<void>
}

/** `safeStorage` 的最小接口；生产传 Electron 的 safeStorage，测试可注入假实现。 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export const KEYCHAIN_SERVICE = 'com.kkhlbb.cunlian.model'

/** 密文文件名（放在 userData 下，不进项目工作区，避免被备份/导出带走）。 */
export const KEY_FILE_NAME = 'model-key-store.json'

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function run(file: string, args: string[], stdin?: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(file, args, { timeout: 15_000, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
    if (stdin !== undefined && child.stdin !== null) {
      child.stdin.write(stdin)
      child.stdin.end()
    }
  })
}

/** `security -i` 的命令行参数按 shell 风格解析；对引号与反斜杠做转义。 */
function quoted(value: string): string {
  return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`
}

/** 旧的 macOS `security` Keychain 实现：现在只作为迁移读取源（以及测试用）。 */
export class MacKeychainStore implements KeychainStore {
  readonly service: string

  constructor(service: string = KEYCHAIN_SERVICE) {
    this.service = service
  }

  async read(account: string): Promise<string | null> {
    const result = await run('security', ['find-generic-password', '-s', this.service, '-a', account, '-w'])
    if (result.code !== 0) return null
    const secret = result.stdout.replace(/\n$/u, '')
    return secret === '' ? null : secret
  }

  async write(account: string, secret: string): Promise<void> {
    if (secret === '') throw new Error('KEYCHAIN_EMPTY_SECRET')
    const command = `add-generic-password -U -s ${quoted(this.service)} -a ${quoted(account)} -w ${quoted(secret)}\n`
    const result = await run('security', ['-i'], command)
    if (result.code !== 0) throw new Error('KEYCHAIN_WRITE_FAILED')
  }

  async remove(account: string): Promise<void> {
    await run('security', ['delete-generic-password', '-s', this.service, '-a', account])
  }
}

interface KeyFileShape {
  version: 1
  /** account → base64(safeStorage 密文)。 */
  entries: Record<string, string>
}

export interface SafeStorageStoreOptions {
  /** 密文文件绝对路径。 */
  filePath: string
  safeStorage: SafeStorageLike
  /** 迁移源（macOS 旧 Keychain）；Windows / 无旧记录时为 null。 */
  legacy?: KeychainStore | null
}

/**
 * safeStorage 密文文件存储。一套接口覆盖 macOS（Keychain）与 Windows（DPAPI）。
 *
 * 加密不可用（`isEncryptionAvailable() === false`）时拒绝写入并抛
 * `SAFE_STORAGE_UNAVAILABLE` —— 绝不退化成明文落盘。读取仍可命中原有密文。
 */
export class SafeStorageStore implements KeychainStore {
  private readonly filePath: string
  private readonly safeStorage: SafeStorageLike
  private readonly legacy: KeychainStore | null
  private cache: KeyFileShape | null = null
  private loading: Promise<KeyFileShape> | undefined
  private pendingWrites: Promise<void> = Promise.resolve()
  /** 已成功迁移过的 account：迁移失败（如加密不可用）不进集合，下次读取可重试。 */
  private readonly migrated = new Set<string>()

  constructor(options: SafeStorageStoreOptions) {
    this.filePath = options.filePath
    this.safeStorage = options.safeStorage
    this.legacy = options.legacy ?? null
  }

  async read(account: string): Promise<string | null> {
    const file = await this.load()
    const encoded = file.entries[account]
    if (encoded !== undefined) {
      const secret = this.tryDecrypt(encoded)
      if (secret !== null) return secret
    }
    if (this.legacy === null || this.migrated.has(account)) return null
    // 迁移：旧 Keychain 有、新路径没有 → 读出来重存到 safeStorage。
    const legacySecret = await this.legacy.read(account)
    if (legacySecret === null || legacySecret === '') return null
    try {
      await this.write(account, legacySecret)
      this.migrated.add(account)
    } catch {
      // 加密不可用时无法重存：不迁移、也不丢密钥，本次调用仍把旧值交回调用方。
    }
    return legacySecret
  }

  write(account: string, secret: string): Promise<void> {
    return this.mutate(async () => {
      if (secret === '') throw new Error('KEYCHAIN_EMPTY_SECRET')
      if (!this.safeStorage.isEncryptionAvailable()) throw new Error('SAFE_STORAGE_UNAVAILABLE')
      const encrypted = this.safeStorage.encryptString(secret).toString('base64')
      const file = await this.load()
      await this.save({ ...file, entries: { ...file.entries, [account]: encrypted } })
      this.migrated.add(account)
    })
  }

  remove(account: string): Promise<void> {
    return this.mutate(async () => {
      const file = await this.load()
      if (Object.hasOwn(file.entries, account)) {
        const entries = { ...file.entries }
        delete entries[account]
        await this.save({ ...file, entries })
      }
      this.migrated.delete(account)
      // 旧记录同步清掉，否则下次 read 会把刚删掉的密钥迁回来。
      if (this.legacy !== null) await this.legacy.remove(account)
    })
  }

  private mutate(write: () => Promise<void>): Promise<void> {
    const result = this.pendingWrites.then(write)
    this.pendingWrites = result.catch(() => {})
    return result
  }

  /** 仅供诊断/证据：密文文件里有哪些 account（不含任何密文或明文）。 */
  async accounts(): Promise<string[]> {
    const file = await this.load()
    return Object.keys(file.entries).sort()
  }

  private tryDecrypt(encoded: string): string | null {
    try {
      const secret = this.safeStorage.decryptString(Buffer.from(encoded, 'base64'))
      return secret === '' ? null : secret
    } catch {
      // 密文来自别的机器/别的用户（DPAPI 绑定用户、Keychain 绑定登录）时解密会失败。
      return null
    }
  }

  private async load(): Promise<KeyFileShape> {
    if (this.cache !== null) return this.cache
    this.loading ??= this.loadFile()
    return this.loading
  }

  private async loadFile(): Promise<KeyFileShape> {
    try {
      const text = await fsp.readFile(this.filePath, 'utf8')
      const raw = JSON.parse(text) as Partial<KeyFileShape>
      const entries: Record<string, string> = {}
      if (raw !== null && typeof raw === 'object' && raw.entries !== null && typeof raw.entries === 'object') {
        for (const [account, encoded] of Object.entries(raw.entries)) {
          if (typeof encoded === 'string' && encoded !== '') entries[account] = encoded
        }
      }
      this.cache = { version: 1, entries }
    } catch {
      this.cache = { version: 1, entries: {} }
    }
    return this.cache
  }

  private async save(file: KeyFileShape): Promise<void> {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.${process.pid}.tmp`
    try {
      await fsp.writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
      await fsp.rename(temp, this.filePath)
      this.cache = file
    } finally {
      await fsp.unlink(temp).catch(() => {})
    }
  }
}

/**
 * 生产装配：macOS 带旧 Keychain 迁移源，其他平台没有旧记录可迁（Windows 旧版本
 * 用的是 `security` 命令行，本来就不工作，没有遗留密钥）。
 */
export function createModelKeyStore(options: {
  userDataDir: string
  safeStorage: SafeStorageLike
  platform?: NodeJS.Platform
  legacy?: KeychainStore | null
}): KeychainStore {
  const platform = options.platform ?? process.platform
  const legacy = options.legacy !== undefined ? options.legacy : platform === 'darwin' ? new MacKeychainStore() : null
  return new SafeStorageStore({
    filePath: path.join(options.userDataDir, KEY_FILE_NAME),
    safeStorage: options.safeStorage,
    legacy,
  })
}

/** 测试用：不落盘的注入式实现；生产路径不使用。 */
export class MemoryKeychainStore implements KeychainStore {
  private readonly items = new Map<string, string>()

  async read(account: string): Promise<string | null> {
    return this.items.get(account) ?? null
  }

  async write(account: string, secret: string): Promise<void> {
    this.items.set(account, secret)
  }

  async remove(account: string): Promise<void> {
    this.items.delete(account)
  }
}
