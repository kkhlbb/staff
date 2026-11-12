/**
 * macOS Keychain 存储（V4.0 阶段 4 实现）。
 *
 * 只存密钥本身；base_url / model 等非敏感配置另存 JSON，不含密钥。
 * 写入方式：`security -i` 从 stdin 读取命令，密钥不出现在进程参数（ps 不可见），
 * 也不写入任何项目文件、日志或证据。
 */
import { execFile } from 'node:child_process'

export interface KeychainStore {
  read(account: string): Promise<string | null>
  write(account: string, secret: string): Promise<void>
  remove(account: string): Promise<void>
}

export const KEYCHAIN_SERVICE = 'com.kkhlbb.cunlian.model'

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
