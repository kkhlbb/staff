/**
 * 任务卡 §8「原子保存」回退实验的验收用例。
 *
 * 原交付的 desktop/tests/fileStore.test.ts 里 ENOSPC 用例只让注入层“立刻抛出”，
 * 没有“先写入若干字节再 ENOSPC”，也没有独立打开校验，因此无法区分
 * “临时文件→自校验→rename”和“直接 writeFile(目标)”两种实现。
 *
 * 本文件按任务卡原文补上该用例，不改动仓库既有测试的任何断言：
 * 1. P0 以真实 fs 落盘并记录 SHA-256；
 * 2. 用现有 FileOps 故障注入钩子 writeExclusive 先写 32 字节，再抛 ENOSPC；
 * 3. 必须失败、原文件哈希不变、且用独立的 FileStore/readProjectFile +
 *    decodeProjectFile 能成功打开 P0；
 * 4. 另存恢复路径 Q 能成功写入并独立打开为 P1，P0 仍为原值。
 */
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FileStore,
  nodeFileOps,
  sha256Bytes,
  type FileOps,
  type VerifyBytes,
} from '../../../../desktop/main/fileStore'
import { decodeProjectFile, encodeProjectFile } from '../../../../src/project-file/codec'
import { createSampleSnapshot } from '../../../../src/project-file/__fixtures__/sampleProjectFile'

let directory: string

beforeEach(async () => {
  directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'cunlian-rollback-a02-'))
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

const verifyByOpen: VerifyBytes = async (bytes) => {
  const decoded = await decodeProjectFile(bytes)
  return decoded.ok
    ? { ok: true }
    : { ok: false, code: decoded.error.code, message: decoded.error.message }
}

async function encodeNamed(name: string): Promise<Uint8Array> {
  const snapshot = await createSampleSnapshot()
  const encoded = await encodeProjectFile({
    ...snapshot,
    project: { ...snapshot.project, name },
  })
  if (!encoded.ok) {
    throw new Error(`fixture encode failed: ${encoded.error.code} ${encoded.error.message}`)
  }
  return encoded.value.bytes
}

/** 独立“打开”通道：新 FileStore 读盘 + decodeProjectFile，不复用保存端内存态。 */
async function independentOpen(
  filePath: string,
): Promise<
  | { ok: true; fingerprint: string; name: string }
  | { ok: false; code: string; message: string }
> {
  const read = await new FileStore().readProjectFile(filePath)
  if (!read.ok) {
    return { ok: false, code: read.error.code, message: read.error.message }
  }
  const decoded = await decodeProjectFile(read.value.bytes)
  if (!decoded.ok) {
    return { ok: false, code: decoded.error.code, message: decoded.error.message }
  }
  return {
    ok: true,
    fingerprint: read.value.fingerprint,
    name: decoded.value.snapshot.project.name,
  }
}

async function seedP0(name: string): Promise<{ fingerprint: string; bytes: Uint8Array }> {
  const bytes = await encodeNamed(name)
  const saved = await new FileStore().saveAtomic({
    targetPath: targetPath(),
    bytes,
    expectedFingerprint: null,
    verify: verifyByOpen,
  })
  if (!saved.ok) {
    throw new Error(`seed failed: ${saved.error.code} ${saved.error.message}`)
  }
  return { fingerprint: saved.value.fingerprint, bytes }
}

describe('回退实验：原子保存', () => {
  it('save-failure-preserves-original：写入 32 字节后 ENOSPC，P0 哈希不变且可独立打开', async () => {
    const seeded = await seedP0('P0 原始项目')
    expect(seeded.fingerprint).toBe(await sha256Bytes(seeded.bytes))

    const p1 = await encodeNamed('P1 新项目')
    let firstWritePath = ''

    // 沿用现有 FileOps 故障注入钩子：先写入若干字节，再报 ENOSPC。
    const failingOps: FileOps = {
      ...nodeFileOps,
      writeExclusive: async (filePath, bytes) => {
        firstWritePath = filePath
        await fsp.writeFile(filePath, bytes.slice(0, 32))
        throw errno('ENOSPC')
      },
    }

    const result = await new FileStore({ ops: failingOps }).saveAtomic({
      targetPath: targetPath(),
      bytes: p1,
      expectedFingerprint: seeded.fingerprint,
      verify: verifyByOpen,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NO_SPACE')
      expect(result.error.detail).toContain('ENOSPC')
    }

    const afterHash = await new FileStore().fingerprint(targetPath())
    expect.soft(afterHash, '原文件 SHA-256 必须保持不变').toBe(seeded.fingerprint)

    const reopened = await independentOpen(targetPath())
    expect.soft(reopened.ok, '原文件必须能独立打开并通过完整校验').toBe(true)
    if (reopened.ok) {
      expect.soft(reopened.name, '独立打开的项目名仍为 P0').toBe('P0 原始项目')
      expect.soft(reopened.fingerprint, '独立打开的指纹仍为 P0').toBe(seeded.fingerprint)
    }

    // 原子策略下第一次写入的目标必须是同目录临时文件，而不是正式文件。
    expect.soft(firstWritePath.endsWith('.tmp'), '第一次写入必须落在 .tmp 临时文件').toBe(true)
  })

  it('另存恢复路径：故障后另存 Q 成功，Q 为 P1 且 P0 仍为原值', async () => {
    const seeded = await seedP0('P0 原始项目')
    const p1 = await encodeNamed('P1 新项目')

    const failingOps: FileOps = {
      ...nodeFileOps,
      writeExclusive: async (filePath) => {
        await fsp.writeFile(filePath, p1.slice(0, 32))
        throw errno('ENOSPC')
      },
    }
    const failed = await new FileStore({ ops: failingOps }).saveAtomic({
      targetPath: targetPath(),
      bytes: p1,
      expectedFingerprint: seeded.fingerprint,
      verify: verifyByOpen,
    })
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('NO_SPACE')

    // 恢复：不再注入故障，另存到新目标 Q。
    const qPath = targetPath('recovery')
    const saved = await new FileStore().saveAtomic({
      targetPath: qPath,
      bytes: p1,
      expectedFingerprint: null,
      verify: verifyByOpen,
    })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    const q = await independentOpen(qPath)
    expect(q.ok).toBe(true)
    if (q.ok) expect(q.name).toBe('P1 新项目')
    expect(saved.value.fingerprint).toBe(await sha256Bytes(p1))

    const p0 = await independentOpen(targetPath())
    expect(p0.ok).toBe(true)
    if (p0.ok) {
      expect(p0.name).toBe('P0 原始项目')
      expect(p0.fingerprint).toBe(seeded.fingerprint)
    }
  })
})
