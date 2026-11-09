// @vitest-environment node
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RecentProjectsStore, RECENT_PROJECTS_LIMIT } from '../main/recentProjects'
import { SAMPLE_PROJECT_ID, createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import { encodeProjectFile } from '../../src/project-file/codec'

let directory: string
let counter = 0

beforeEach(async () => {
  directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'cunlian-a04-recent-'))
  counter = 0
})

afterEach(async () => {
  await fsp.rm(directory, { recursive: true, force: true })
})

function store(): RecentProjectsStore {
  return new RecentProjectsStore({
    rootDir: directory,
    newId: () => `recent-${(counter += 1)}`,
    now: () => new Date(Date.UTC(2026, 10, 9, 10, 0, counter)),
  })
}

function fingerprint(seed = 'a'): string {
  return seed.repeat(64).slice(0, 64)
}

async function touch(name: string): Promise<string> {
  const target = path.join(directory, name)
  await fsp.writeFile(target, 'x')
  return target
}

describe('最近项目索引', () => {
  it('最多保留 20 项且最新在前', async () => {
    const recent = store()
    for (let index = 0; index < RECENT_PROJECTS_LIMIT + 2; index += 1) {
      const target = await touch(`p-${index}.cunlian`)
      const recorded = await recent.record({
        projectId: `project-${index}`,
        name: `项目 ${index}`,
        path: target,
        fingerprint: fingerprint('b'),
      })
      expect(recorded.ok).toBe(true)
    }
    const listed = await recent.list()
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.value.items).toHaveLength(RECENT_PROJECTS_LIMIT)
    expect(listed.value.items[0].path).toBe(path.join(directory, 'p-21.cunlian'))
    expect(listed.value.items.map((item) => item.name)).not.toContain('项目 0')
  })

  it('同路径去重且保留 recentId；同 projectId 的不同副本都保留', async () => {
    const recent = store()
    const first = await touch('one.cunlian')
    const second = await touch('copy.cunlian')
    const a = await recent.record({
      projectId: 'project-x',
      name: '旧名字',
      path: first,
      fingerprint: fingerprint('a'),
    })
    expect(a.ok).toBe(true)
    const listed1 = await recent.list()
    if (!listed1.ok) throw new Error('list failed')
    const recentId = listed1.value.items[0].recentId

    await recent.record({
      projectId: 'project-x',
      name: '新名字',
      path: first,
      fingerprint: fingerprint('c'),
    })
    await recent.record({
      projectId: 'project-x',
      name: '同项目副本',
      path: second,
      fingerprint: fingerprint('c'),
    })
    const listed2 = await recent.list()
    expect(listed2.ok).toBe(true)
    if (!listed2.ok) return
    expect(listed2.value.items).toHaveLength(2)
    const samePath = listed2.value.items.filter((item) => item.path === first)
    expect(samePath).toHaveLength(1)
    expect(samePath[0].recentId).toBe(recentId)
    expect(samePath[0].name).toBe('新名字')
    expect(listed2.value.items.some((item) => item.path === second)).toBe(true)
  })

  it('路径失效标 missing，不自动删除记录', async () => {
    const recent = store()
    const target = await touch('gone.cunlian')
    await recent.record({
      projectId: 'project-gone',
      name: '将消失',
      path: target,
      fingerprint: fingerprint('d'),
    })
    await fsp.unlink(target)
    const listed = await recent.list()
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.value.items[0].missing).toBe(true)
    expect(listed.value.items[0].path).toBe(target)
  })

  it('索引损坏时报 INDEX_READ_FAILED，写入前把损坏文件隔离', async () => {
    const recent = store()
    const indexFile = path.join(directory, 'recent-projects.v1.json')
    await fsp.writeFile(indexFile, '{not-json')
    const listed = await recent.list()
    expect(listed.ok).toBe(false)
    if (!listed.ok) {
      expect(listed.error.code).toBe('INDEX_READ_FAILED')
    }

    const target = await touch('fresh.cunlian')
    const recorded = await recent.record({
      projectId: 'project-fresh',
      name: '新记录',
      path: target,
      fingerprint: fingerprint('e'),
    })
    expect(recorded.ok).toBe(true)
    const files = await fsp.readdir(directory)
    expect(files.some((name) => name.startsWith('recent-projects.v1.json.corrupt-'))).toBe(true)
    const listedAgain = await recent.list()
    expect(listedAgain.ok).toBe(true)
    if (listedAgain.ok) {
      expect(listedAgain.value.items).toHaveLength(1)
    }
  })

  it('索引超过 20 项按损坏处理，不静默截断', async () => {
    const items = Array.from({ length: RECENT_PROJECTS_LIMIT + 1 }, (_, index) => ({
      recentId: `r-${index}`,
      projectId: `p-${index}`,
      name: `项目 ${index}`,
      path: path.join(directory, `p-${index}.cunlian`),
      lastOpenedAt: '2026-11-09T10:00:00.000Z',
      fingerprint: fingerprint('f'),
    }))
    await fsp.writeFile(
      path.join(directory, 'recent-projects.v1.json'),
      JSON.stringify({ schemaVersion: 1, items }),
    )
    const listed = await store().list()
    expect(listed.ok).toBe(false)
    if (!listed.ok) {
      expect(listed.error.code).toBe('INDEX_READ_FAILED')
    }
  })

  it('relink 只在项目 ID 相符时修索引；不符返回 PROJECT_ID_MISMATCH', async () => {
    const recent = store()
    const original = await touch('original.cunlian')
    const recorded = await recent.record({
      projectId: SAMPLE_PROJECT_ID,
      name: '隔套间隙演示',
      path: original,
      fingerprint: fingerprint('a'),
    })
    expect(recorded.ok).toBe(true)
    const listed = await recent.list()
    if (!listed.ok) throw new Error('list failed')
    const recentId = listed.value.items[0].recentId

    const sample = await createSampleSnapshot()
    const encoded = await encodeProjectFile(sample)
    if (!encoded.ok) throw new Error('encode failed')
    const moved = path.join(directory, 'moved.cunlian')
    await fsp.writeFile(moved, encoded.value.bytes)

    const mismatch = await recent.relink({
      recentId,
      path: moved,
      projectId: 'other-project',
      fingerprint: fingerprint('b'),
    })
    expect(mismatch.ok).toBe(false)
    if (!mismatch.ok) {
      expect(mismatch.error.code).toBe('PROJECT_ID_MISMATCH')
    }
    const untouched = await recent.get(recentId)
    expect(untouched.ok).toBe(true)
    if (untouched.ok) {
      expect(untouched.value.path).toBe(original)
    }

    const relinked = await recent.relink({
      recentId,
      path: moved,
      projectId: SAMPLE_PROJECT_ID,
      fingerprint: fingerprint('c'),
    })
    expect(relinked.ok).toBe(true)
    if (relinked.ok) {
      expect(relinked.value.item.path).toBe(moved)
      expect(relinked.value.item.missing).toBe(false)
      expect(relinked.value.item.recentId).toBe(recentId)
    }
  })
})
