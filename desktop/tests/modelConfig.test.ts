// @vitest-environment node
/**
 * V4.0 阶段 4：供应商配置与 Keychain 存储。
 *
 * 断言重点：
 * - model-config.json 只有非敏感字段，任何位置都不含密钥；
 * - configured 需要 base_url + model + 密钥三者齐备；
 * - keySource=keychain 时不读环境变量，keychain-or-env 才允许；
 * - MacKeychainStore 经 /usr/bin/security 真实读写（仅限测试专用 service，用后删除）。
 */
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MacKeychainStore, MemoryKeychainStore } from '../main/keychain'
import { ModelConfig, validateProviderInput } from '../main/modelConfig'

const SECRET = 'sk-config-test-abcdef0123456789'
const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await fsp.rm(dir, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cunlian-modelcfg-'))
  dirs.push(dir)
  return dir
}

describe('V4.0 阶段4：模型配置（密钥零落盘）', () => {
  it('保存后配置文件不含密钥，状态在密钥齐备后才 configured', async () => {
    const dir = await tempDir()
    const keychain = new MemoryKeychainStore()
    const config = new ModelConfig({ rootDir: dir, keychain, env: {} })
    await config.ensureLoaded()
    expect(config.getProviderStatus().configured).toBe(false)

    expect(await config.save({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' })).toEqual({ ok: true })
    expect(config.getProviderStatus()).toMatchObject({
      configured: false,
      provider: 'openai-compatible-1:deepseek-chat',
      host: 'api.deepseek.com',
      keyPresent: false,
    })

    expect(await config.save({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: SECRET })).toEqual({ ok: true })
    const status = config.getProviderStatus()
    expect(status.configured).toBe(true)
    expect(status.keyPresent).toBe(true)

    const text = await fsp.readFile(path.join(dir, 'model-config.json'), 'utf8')
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('apiKey')
    expect(JSON.parse(text)).toMatchObject({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', adapterId: 'openai-compatible-1' })
    expect(await keychain.read('openai-compatible-1')).toBe(SECRET)

    // 重新加载（模拟重启应用）后仍能判定已配置，且不依赖内存缓存。
    const reloaded = new ModelConfig({ rootDir: dir, keychain, env: {} })
    await reloaded.ensureLoaded()
    expect(reloaded.getProviderStatus().configured).toBe(true)
    expect(await reloaded.resolveApiKey()).toBe(SECRET)
  })

  it('keySource=keychain 时不读环境变量；keychain-or-env 才回退', async () => {
    const dir = await tempDir()
    const keychain = new MemoryKeychainStore()
    const env = { DEEPSEEK_API_KEY: SECRET }
    const strict = new ModelConfig({ rootDir: dir, keychain, env })
    await strict.save({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' })
    expect(await strict.resolveApiKey()).toBeNull()
    expect(strict.getProviderStatus().configured).toBe(false)

    const permissive = new ModelConfig({ rootDir: dir, keychain, env })
    await permissive.save({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keySource: 'keychain-or-env' })
    expect(await permissive.resolveApiKey()).toBe(SECRET)
    expect((await permissive.readSettings()).keySource).toBe('keychain-or-env')
  })

  it('base_url / 模型 ID 校验拒绝非法输入', () => {
    expect(validateProviderInput({ baseUrl: '', model: 'x' })).toMatchObject({ ok: false })
    expect(validateProviderInput({ baseUrl: 'not-a-url', model: 'x' })).toMatchObject({ ok: false })
    expect(validateProviderInput({ baseUrl: 'ftp://example.com', model: 'x' })).toMatchObject({ ok: false })
    expect(validateProviderInput({ baseUrl: 'https://example.com/v1', model: '' })).toMatchObject({ ok: false })
    expect(validateProviderInput({ baseUrl: 'https://example.com/v1', model: 'm' })).toEqual({ ok: true })
  })

  it('清除密钥后状态回到未配置，配置文件仍在', async () => {
    const dir = await tempDir()
    const keychain = new MemoryKeychainStore()
    const config = new ModelConfig({ rootDir: dir, keychain, env: {} })
    await config.save({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: SECRET })
    await config.clearKey()
    expect(config.getProviderStatus()).toMatchObject({ configured: false, keyPresent: false })
    expect(JSON.parse(await fsp.readFile(path.join(dir, 'model-config.json'), 'utf8'))).toMatchObject({ model: 'deepseek-chat' })
  })

  it('MacKeychainStore 经系统 security 真实写入/读取/删除（测试专用 service）', async () => {
    const service = `com.kkhlbb.cunlian.test.${process.pid}`
    const store = new MacKeychainStore(service)
    const account = 'unit-test'
    try {
      expect(await store.read(account)).toBeNull()
      await store.write(account, SECRET)
      expect(await store.read(account)).toBe(SECRET)
      await store.remove(account)
      expect(await store.read(account)).toBeNull()
    } finally {
      await store.remove(account)
    }
  })
})
