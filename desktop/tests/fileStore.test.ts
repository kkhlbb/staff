import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FileStore,
  ShortWriteError,
  nodeFileOps,
  sha256Bytes,
  type FileOps,
  type VerifyBytes,
} from '../main/fileStore'

let directory: string

beforeEach(async () => {
  directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'cunlian-a02-'))
})

afterEach(async () => {
  await fsp.rm(directory, { recursive: true, force: true })
})

function targetPath(name = 'project'): string {
  return path.join(directory, `${name}.cunlian`)
}

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(`injected ${code}`) as NodeJS.ErrnoException
  error.code = code
  return error
}

const acceptAny: VerifyBytes = async () => ({ ok: true })

function storeWith(overrides: Partial<FileOps>): FileStore {
  return new FileStore({ ops: { ...nodeFileOps, ...overrides } })
}

async function listTempFiles(directoryPath: string): Promise<string[]> {
  const names = await fsp.readdir(directoryPath)
  return names.filter((name) => name.endsWith('.tmp'))
}

describe('FileStore.saveAtomic 成功路径（真实 fs）', () => {
  it('写入新文件、回读校验并清理临时文件', async () => {
    const store = new FileStore()
    const bytes = new TextEncoder().encode('cunlian payload')
    const saved = await store.saveAtomic({
      targetPath: targetPath(),
      bytes,
      expectedFingerprint: null,
      verify: acceptAny,
    })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.value.path).toBe(targetPath())
    expect(saved.value.fingerprint).toBe(await sha256Bytes(bytes))
    expect(await fsp.readFile(targetPath(), 'utf8')).toBe('cunlian payload')
    expect(await listTempFiles(directory)).toEqual([])
    // 0600：只有本人可读写。
    const mode = (await fsp.stat(targetPath())).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('覆盖已有文件时按期望指纹确认，成功后指纹更新', async () => {
    const store = new FileStore()
    const first = await store.saveAtomic({
      targetPath: targetPath(),
      bytes: new TextEncoder().encode('v1'),
      expectedFingerprint: null,
      verify: acceptAny,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = await store.saveAtomic({
      targetPath: targetPath(),
      bytes: new TextEncoder().encode('v2'),
      expectedFingerprint: first.value.fingerprint,
      verify: acceptAny,
    })
    expect(second.ok).toBe(true)
    expect(await fsp.readFile(targetPath(), 'utf8')).toBe('v2')
  })
})

describe('FileStore.saveAtomic 故障矩阵：原文件不坏', () => {
  async function seedOriginal(): Promise<{ store: FileStore; fingerprint: string }> {
    const store = new FileStore()
    const saved = await store.saveAtomic({
      targetPath: targetPath(),
      bytes: new TextEncoder().encode('P0 原始内容'),
      expectedFingerprint: null,
      verify: acceptAny,
    })
    if (!saved.ok) throw new Error('seed failed')
    return { store, fingerprint: saved.value.fingerprint }
  }

  it('EACCES → PERMISSION_DENIED，P0 哈希不变', async () => {
    const { fingerprint } = await seedOriginal()
    const failing = storeWith({
      writeExclusive: async () => {
        throw errno('EACCES')
      },
    })
    const result = await failing.saveAtomic({
      targetPath: targetPath(),
      bytes: new TextEncoder().encode('P1'),
      expectedFingerprint: fingerprint,
      verify: acceptAny,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('PERMISSION_DENIED')
      expect(result.error.detail).toContain('EACCES')
    }
    expect(await new FileStore().fingerprint(targetPath())).toBe(fingerprint)
    expect(await listTempFiles(directory)).toEqual([])
  })

  it('ENOSPC → NO_SPACE，P0 哈希不变', async () => {
    const { fingerprint } = await seedOriginal()
    const failing = storeWith({
      writeExclusive: async () => {
        throw errno('ENOSPC')
      },
    })
    const result = await failing.saveAtomic({
      targetPath: targetPath(),
      bytes: new TextEncoder().encode('P1'),
      expectedFingerprint: fingerprint,
      verify: acceptAny,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NO_SPACE')
    expect(await new FileStore().fingerprint(targetPath())).toBe(fingerprint)
  })

  it('短写 → WRITE_FAILED，P0 哈希不变', async () => {
    const { fingerprint } = await seedOriginal()
    const failing = storeWith({
      writeExclusive: async () => {
        throw new ShortWriteError(3, 10)
      },
    })
    const result = await failing.saveAtomic({
      targetPath: targetPath(),
      bytes: new TextEncoder().encode('0123456789'),
      expectedFingerprint: fingerprint,
      verify: acceptAny,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('WRITE_FAILED')
      expect(result.error.detail).toContain('短写')
    }
    expect(await new FileStore().fingerprint(targetPath())).toBe(fingerprint)
  })

  it('保存前自校验失败 → VERIFY_FAILED，原文件与临时文件都安全', async () => {
    const { fingerprint } = await seedOriginal()
    const store = new FileStore()
    const result = await store.saveAtomic({
      targetPath: targetPath(),
      bytes: new TextEncoder().encode('P1'),
      expectedFingerprint: fingerprint,
      verify: async () => ({
        ok: false,
        code: 'HASH_MISMATCH',
        message: '注入的校验失败',
      }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VERIFY_FAILED')
      expect(result.error.message).toContain('原文件保持不变')
    }
    expect(await new FileStore().fingerprint(targetPath())).toBe(fingerprint)
    expect(await listTempFiles(directory)).toEqual([])
  })

  it('临时文件回读内容不一致 → VERIFY_FAILED，原文件不变', async () => {
    const { fingerprint } = await seedOriginal()
    const store = storeWith({
      readFile: async (filePath) => {
        if (filePath.endsWith('.tmp')) {
          return new TextEncoder().encode('corrupted')
        }
        return nodeFileOps.readFile(filePath)
      },
    })
    const result = await store.saveAtomic({
      targetPath: targetPath(),
      bytes: new TextEncoder().encode('P1'),
      expectedFingerprint: fingerprint,
      verify: acceptAny,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VERIFY_FAILED')
    expect(await new FileStore().fingerprint(targetPath())).toBe(fingerprint)
  })

  it('rename 失败 → RENAME_FAILED，原文件保持且临时文件被清理', async () => {
    const { fingerprint } = await seedOriginal()
    const store = storeWith({
      rename: async () => {
        throw errno('EACCES')
      },
    })
    const result = await store.saveAtomic({
      targetPath: targetPath(),
      bytes: new TextEncoder().encode('P1'),
      expectedFingerprint: fingerprint,
      verify: acceptAny,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('RENAME_FAILED')
    expect(await new FileStore().fingerprint(targetPath())).toBe(fingerprint)
    expect(await fsp.readFile(targetPath(), 'utf8')).toBe('P0 原始内容')
    expect(await listTempFiles(directory)).toEqual([])
  })

  it('期望指纹不一致 → EXTERNAL_MODIFIED，不进行任何写入', async () => {
    const { fingerprint } = await seedOriginal()
    const store = new FileStore()
    const result = await store.saveAtomic({
      targetPath: targetPath(),
      bytes: new TextEncoder().encode('P1'),
      expectedFingerprint: 'f'.repeat(64),
      verify: acceptAny,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('EXTERNAL_MODIFIED')
    expect(await new FileStore().fingerprint(targetPath())).toBe(fingerprint)
  })

  it('rename 后回读不一致 → 报告“已替换但未确认”，不回滚也不谎称原文件未变', async () => {
    const { fingerprint } = await seedOriginal()
    let renamed = false
    const store = storeWith({
      rename: async (from, to) => {
        await nodeFileOps.rename(from, to)
        renamed = true
      },
      readFile: async (filePath) => {
        if (renamed && filePath === targetPath()) {
          return new TextEncoder().encode('unexpected after rename')
        }
        return nodeFileOps.readFile(filePath)
      },
    })
    const result = await store.saveAtomic({
      targetPath: targetPath(),
      bytes: new TextEncoder().encode('P1'),
      expectedFingerprint: fingerprint,
      verify: acceptAny,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VERIFY_FAILED')
      expect(result.error.message).toContain('已替换')
      expect(result.error.message).not.toContain('原文件保持不变')
    }
  })

  it('目录同步失败 → 保存成功但带持久化未确认警告', async () => {
    const store = storeWith({
      syncDirectory: async () => {
        throw errno('EIO')
      },
    })
    const result = await store.saveAtomic({
      targetPath: targetPath(),
      bytes: new TextEncoder().encode('P1'),
      expectedFingerprint: null,
      verify: acceptAny,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.warnings.join('')).toContain('持久化未确认')
  })
})

describe('FileStore.saveAtomic 目标校验', () => {
  it('拒绝非 .cunlian 后缀', async () => {
    const store = new FileStore()
    const result = await store.saveAtomic({
      targetPath: path.join(directory, 'project.zip'),
      bytes: new Uint8Array([1]),
      expectedFingerprint: null,
      verify: acceptAny,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('.cunlian')
  })

  it('拒绝符号链接目标', async () => {
    const realPath = path.join(directory, 'real.cunlian')
    await fsp.writeFile(realPath, 'x')
    const linkPath = targetPath('link')
    await fsp.symlink(realPath, linkPath)
    const store = new FileStore()
    const result = await store.saveAtomic({
      targetPath: linkPath,
      bytes: new Uint8Array([1]),
      expectedFingerprint: null,
      verify: acceptAny,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('SAVE_FAILED')
    expect(await fsp.readFile(realPath, 'utf8')).toBe('x')
  })

  it('父目录不存在时拒绝', async () => {
    const store = new FileStore()
    const result = await store.saveAtomic({
      targetPath: path.join(directory, 'missing-dir', 'project.cunlian'),
      bytes: new Uint8Array([1]),
      expectedFingerprint: null,
      verify: acceptAny,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('父目录')
  })
})
