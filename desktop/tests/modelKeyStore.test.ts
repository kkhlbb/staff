// @vitest-environment node
/**
 * 密钥存储：safeStorage 主路径 + 旧 macOS Keychain 迁移。
 *
 * 断言重点：
 * - 写入后磁盘上只有密文文件（不含明文、0600），read 能还原；
 * - 预置旧 Keychain 记录 → 首次读取成功 → 密文文件里有 → 删掉旧记录仍能读（迁移后只走新路径）；
 * - 删除会同时清掉旧记录，否则删掉的密钥会被迁移逻辑带回来；
 * - 加密不可用时拒绝写入（不退化明文），读取旧密文失败时返回 null 而不是抛错；
 * - ModelConfig 接上 SafeStorageStore 后状态口径不变（keyPresent 由迁移后的读取决定）。
 */
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import {
  KEY_FILE_NAME,
  MacKeychainStore,
  SafeStorageStore,
  createModelKeyStore,
  type KeychainStore,
  type SafeStorageLike,
} from '../main/keychain'
import { ModelConfig } from '../main/modelConfig'

// 真实供应商密钥是 ASCII；`security -w` 对非 ASCII 值会输出十六进制（既有实现特性，不在本单范围）。
const SECRET = 'sk-platform-seam-key-0001'
const SERVICE = `com.kkhlbb.cunlian.keystore.test.${process.pid}`
const LEGACY = new MacKeychainStore(SERVICE)
const dirs: string[] = []

afterEach(async () => {
  for (const dir of dirs.splice(0)) await fsp.rm(dir, { recursive: true, force: true })
})
afterAll(async () => {
  await LEGACY.remove('openai-compatible-1')
  await LEGACY.remove('unit-test')
})

async function tempDir(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cunlian-keystore-'))
  dirs.push(dir)
  return dir
}

/** 测试替身：真实加密由 Electron safeStorage 提供，这里只做可逆变换并带前缀校验。 */
class FakeSafeStorage implements SafeStorageLike {
  available = true
  readonly algorithm = 'fake-v1:'

  isEncryptionAvailable(): boolean {
    return this.available
  }

  encryptString(plainText: string): Buffer {
    if (!this.available) throw new Error('SAFE_STORAGE_UNAVAILABLE')
    return Buffer.from(`${this.algorithm}${Buffer.from(plainText, 'utf8').toString('base64')}`, 'utf8')
  }

  decryptString(encrypted: Buffer): string {
    const text = encrypted.toString('utf8')
    if (!text.startsWith(this.algorithm)) throw new Error('DECRYPT_FAILED')
    return Buffer.from(text.slice(this.algorithm.length), 'base64').toString('utf8')
  }
}

function store(dir: string, options: { legacy?: KeychainStore | null; safeStorage?: SafeStorageLike } = {}): SafeStorageStore {
  return new SafeStorageStore({
    filePath: path.join(dir, KEY_FILE_NAME),
    safeStorage: options.safeStorage ?? new FakeSafeStorage(),
    legacy: options.legacy ?? null,
  })
}

describe('密钥存储：safeStorage 密文文件', () => {
  it('写入后磁盘只有密文，read 还原，文件权限 0600', async () => {
    const dir = await tempDir()
    const s = store(dir)
    await s.write('openai-compatible-1', SECRET)
    const filePath = path.join(dir, KEY_FILE_NAME)
    const raw = await fsp.readFile(filePath, 'utf8')
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain('sk-')
    expect(Object.values((JSON.parse(raw) as { entries: Record<string, string> }).entries)).toHaveLength(1)
    expect((await fsp.stat(filePath)).mode & 0o777).toBe(0o600)
    expect(await s.read('openai-compatible-1')).toBe(SECRET)
    expect(await store(dir).read('openai-compatible-1')).toBe(SECRET)
    expect(await s.read('other-account')).toBeNull()
  })

  it('删除后读不到，且磁盘条目被移除', async () => {
    const dir = await tempDir()
    const s = store(dir)
    await s.write('unit-test', SECRET)
    await s.remove('unit-test')
    expect(await s.read('unit-test')).toBeNull()
    expect(await s.accounts()).toEqual([])
  })

  it('加密不可用时拒绝写入，不落明文、不建文件', async () => {
    const dir = await tempDir()
    const fake = new FakeSafeStorage()
    fake.available = false
    const s = store(dir, { safeStorage: fake })
    await expect(s.write('unit-test', SECRET)).rejects.toThrow('SAFE_STORAGE_UNAVAILABLE')
    await expect(fsp.readFile(path.join(dir, KEY_FILE_NAME), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await s.read('unit-test')).toBeNull()
  })

  it('密文来自别的机器（解密失败）时返回 null，不抛错', async () => {
    const dir = await tempDir()
    const s = store(dir)
    await s.write('unit-test', SECRET)
    await fsp.writeFile(
      path.join(dir, KEY_FILE_NAME),
      `${JSON.stringify({ version: 1, entries: { 'unit-test': Buffer.from('dpapi-from-another-user').toString('base64') } }, null, 2)}\n`,
    )
    expect(await store(dir).read('unit-test')).toBeNull()
  })
})

describe('密钥迁移：旧 Keychain → safeStorage', () => {
  it('预置旧记录 → 首次读取成功 → 密文文件里有 → 删掉旧记录仍能读', async () => {
    const dir = await tempDir()
    const account = 'openai-compatible-1'
    // 预置：旧版本写进 macOS Keychain 的记录（走真实 security 命令）。
    await LEGACY.write(account, SECRET)
    expect(await LEGACY.read(account)).toBe(SECRET)

    const s = store(dir, { legacy: LEGACY })
    expect(await s.read(account)).toBe(SECRET)

    // safeStorage 里确实存下了（密文，不含明文）。
    const raw = await fsp.readFile(path.join(dir, KEY_FILE_NAME), 'utf8')
    expect(await s.accounts()).toEqual([account])
    expect(raw).not.toContain(SECRET)

    // 删掉旧记录：只剩新路径，仍然能读。
    await LEGACY.remove(account)
    expect(await LEGACY.read(account)).toBeNull()
    expect(await s.read(account)).toBe(SECRET)
    expect(await store(dir, { legacy: LEGACY }).read(account)).toBe(SECRET)
  })

  it('迁移之后不再每次回读旧 Keychain（旧记录被改也不影响）', async () => {
    const dir = await tempDir()
    const account = 'openai-compatible-1'
    let legacyReads = 0
    const counting: KeychainStore = {
      read: async (name) => {
        legacyReads += 1
        return name === account ? SECRET : null
      },
      write: async () => undefined,
      remove: async () => undefined,
    }
    const s = store(dir, { legacy: counting })
    expect(await s.read(account)).toBe(SECRET)
    expect(legacyReads).toBe(1)
    expect(await s.read(account)).toBe(SECRET)
    expect(legacyReads).toBe(1)
  })

  it('删除会一并清掉旧记录：不会在下次读取时被迁回来', async () => {
    const dir = await tempDir()
    const account = 'openai-compatible-1'
    await LEGACY.write(account, SECRET)
    const s = store(dir, { legacy: LEGACY })
    expect(await s.read(account)).toBe(SECRET)
    await s.remove(account)
    expect(await LEGACY.read(account)).toBeNull()
    expect(await s.read(account)).toBeNull()
  })

  it('新路径已有值时，旧记录的改动不影响读取（新路径优先）', async () => {
    const dir = await tempDir()
    const account = 'openai-compatible-1'
    await LEGACY.write(account, 'old-secret-value')
    const s = store(dir, { legacy: LEGACY })
    await s.write(account, SECRET)
    await LEGACY.write(account, 'old-secret-value-2')
    expect(await s.read(account)).toBe(SECRET)
  })
})

describe('createModelKeyStore：平台装配', () => {
  it('win32 没有旧 Keychain 迁移源（旧版本在 Windows 上本来就不工作）', async () => {
    const dir = await tempDir()
    const s = createModelKeyStore({ userDataDir: dir, safeStorage: new FakeSafeStorage(), platform: 'win32' })
    await s.write('openai-compatible-1', SECRET)
    expect(await s.read('openai-compatible-1')).toBe(SECRET)
    const raw = await fsp.readFile(path.join(dir, KEY_FILE_NAME), 'utf8')
    expect(raw).not.toContain(SECRET)
    expect(Object.keys((JSON.parse(raw) as { entries: Record<string, string> }).entries)).toEqual(['openai-compatible-1'])
  })

  it('filePath 落在 userData 下的固定文件名', async () => {
    const dir = await tempDir()
    const s = createModelKeyStore({ userDataDir: dir, safeStorage: new FakeSafeStorage(), platform: 'win32' }) as SafeStorageStore
    await s.write('unit-test', SECRET)
    await expect(fsp.stat(path.join(dir, KEY_FILE_NAME))).resolves.toMatchObject({ mode: expect.any(Number) })
  })
})

describe('ModelConfig 接 safeStorage 后状态口径不变', () => {
  it('旧 Keychain 有密钥时首次加载即迁移，configured 为 true', async () => {
    const dir = await tempDir()
    const account = 'openai-compatible-1'
    await LEGACY.write(account, SECRET)
    const s = store(dir, { legacy: LEGACY })
    const config = new ModelConfig({ rootDir: dir, keychain: s, env: {} })
    await config.ensureLoaded()
    expect(config.getProviderStatus()).toMatchObject({ keyPresent: true })
    expect(await config.resolveApiKey()).toBe(SECRET)
    expect(await s.accounts()).toEqual([account])
  })

  it('保存走 safeStorage；配置文件仍不含密钥', async () => {
    const dir = await tempDir()
    const s = store(dir)
    const config = new ModelConfig({ rootDir: dir, keychain: s, env: {} })
    await config.save({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: SECRET })
    expect(config.getProviderStatus()).toMatchObject({ configured: true, keyPresent: true })
    const text = await fsp.readFile(path.join(dir, 'model-config.json'), 'utf8')
    expect(text).not.toContain(SECRET)
    expect(await s.read('openai-compatible-1')).toBe(SECRET)
  })
})
