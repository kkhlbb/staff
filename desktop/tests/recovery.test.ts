// @vitest-environment node
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RecoveryStore, RECOVERY_DEBOUNCE_MS } from '../main/recovery'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import { decodeProjectFile } from '../../src/project-file/codec'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import { failingWorkspaceOps } from './helpers/a04'
import type { WorkspaceOps } from '../main/workspaceJson'

let directory: string
let counter = 0

beforeEach(async () => {
  directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'cunlian-a04-recovery-'))
  counter = 0
})

afterEach(async () => {
  await fsp.rm(directory, { recursive: true, force: true })
})

function makeStore(options: { debounceMs?: number; ops?: WorkspaceOps } = {}): RecoveryStore {
  return new RecoveryStore({
    rootDir: directory,
    debounceMs: options.debounceMs ?? 10,
    ops: options.ops,
    newId: () => `recovery-${(counter += 1)}`,
    now: () => new Date('2026-11-09T10:00:00.000Z'),
  })
}

function meta(snapshot: ProjectFileSnapshot) {
  return {
    projectId: snapshot.project.id,
    name: snapshot.project.name,
    basePath: null,
    baseFingerprint: null,
  }
}

async function sample(): Promise<ProjectFileSnapshot> {
  return createSampleSnapshot()
}

describe('恢复草稿', () => {
  it('stage 只接受内存编辑；防抖到期后才落盘，flush 可立即确认写入', async () => {
    const store = makeStore({ debounceMs: RECOVERY_DEBOUNCE_MS })
    const snapshot = await sample()
    const staged = await store.stage('s1', snapshot, 1, meta(snapshot))
    expect(staged.state).toBe('pending')
    expect(store.hasPending('s1')).toBe(true)

    const draftPath = store.draftPath('recovery-1')
    await expect(fsp.stat(draftPath)).rejects.toThrow()

    const flushed = await store.flush('s1')
    expect(flushed.state).toBe('written')
    const bytes = new Uint8Array(await fsp.readFile(draftPath))
    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) {
      expect(decoded.value.snapshot.project.id).toBe(snapshot.project.id)
      expect(decoded.value.snapshot.attachments).toHaveLength(1)
    }

    const listed = await store.list()
    expect(listed.ok).toBe(true)
    if (listed.ok) {
      expect(listed.value.items).toHaveLength(1)
      expect(listed.value.items[0].editSeq).toBe(1)
      expect(listed.value.items[0].error).toBeUndefined()
    }
  })

  it('防抖 1 秒外可自动写；内容相同的再次 stage 报 unchanged', async () => {
    const store = makeStore({ debounceMs: 10 })
    const snapshot = await sample()
    expect((await store.stage('s1', snapshot, 1, meta(snapshot))).state).toBe('pending')
    await waitFor(async () => {
      const listed = await store.list()
      return listed.ok && listed.value.items.length === 1
    })
    // 索引先于写入 Promise 结束可见；显式 flush 等到写入完整结束。
    await store.flush('s1')
    expect(store.hasPending('s1')).toBe(false)

    const again = await store.stage('s1', snapshot, 2, meta(snapshot))
    expect(again.state).toBe('unchanged')
  })

  it('草稿写失败返回 failed + warning，不谎报 written，编辑仍保留待重试', async () => {
    const store = makeStore({ ops: failingWorkspaceOps('ENOSPC') })
    const snapshot = await sample()
    expect((await store.stage('s1', snapshot, 1, meta(snapshot))).state).toBe('pending')
    const flushed = await store.flush('s1')
    expect(flushed.state).toBe('failed')
    expect(flushed.warning ?? '').toContain('ENOSPC')
    expect(store.hasPending('s1')).toBe(true)
    const listed = await store.list()
    // 索引没有登记任何草稿；失败没有被当成空项目写入。
    expect(listed.ok).toBe(true)
    if (listed.ok) {
      expect(listed.value.items).toHaveLength(0)
    }
  })

  it('索引损坏时 list 报 RECOVERY_READ_FAILED；写入前隔离损坏索引', async () => {
    const store = makeStore()
    const indexFile = path.join(directory, 'recovery-index.v1.json')
    await fsp.writeFile(indexFile, '{"schemaVersion":1,"items":[{"bad":true}]}')
    const listed = await store.list()
    expect(listed.ok).toBe(false)
    if (!listed.ok) {
      expect(listed.error.code).toBe('RECOVERY_READ_FAILED')
    }
    const snapshot = await sample()
    await store.stage('s1', snapshot, 1, meta(snapshot))
    const flushed = await store.flush('s1')
    expect(flushed.state).toBe('written')
    const files = await fsp.readdir(directory)
    expect(files.some((name) => name.startsWith('recovery-index.v1.json.corrupt-'))).toBe(true)
    const listedAgain = await store.list()
    expect(listedAgain.ok).toBe(true)
    if (listedAgain.ok) {
      expect(listedAgain.value.items).toHaveLength(1)
    }
  })

  it('草稿文件损坏时列表带 error 原因，不当作空项目', async () => {
    const store = makeStore()
    const snapshot = await sample()
    await store.stage('s1', snapshot, 1, meta(snapshot))
    await store.flush('s1')
    await fsp.writeFile(store.draftPath('recovery-1'), 'not-a-zip')
    const listed = await store.list()
    expect(listed.ok).toBe(true)
    if (listed.ok) {
      expect(listed.value.items).toHaveLength(1)
      expect(listed.value.items[0].error).toBeDefined()
      expect(listed.value.items[0].error ?? '').toMatch(/INVALID_ZIP|INVALID_MANIFEST|EMPTY_BACKUP/)
    }
  })

  it('discard 同时删除草稿文件与索引记录', async () => {
    const store = makeStore()
    const snapshot = await sample()
    await store.stage('s1', snapshot, 1, meta(snapshot))
    await store.flush('s1')
    const draftPath = store.draftPath('recovery-1')
    await expect(fsp.stat(draftPath)).resolves.toBeTruthy()

    await store.discard('s1')
    await expect(fsp.stat(draftPath)).rejects.toThrow()
    const listed = await store.list()
    expect(listed.ok).toBe(true)
    if (listed.ok) {
      expect(listed.value.items).toHaveLength(0)
    }
    expect(store.activeSessionCount()).toBe(0)
  })
})

async function waitFor(check: () => Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('等待条件超时')
}
