// @vitest-environment node
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decodeProjectFile, encodeProjectFile, toSnapshotDto } from '../../src/project-file/codec'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import { FileStore } from '../main/fileStore'
import {
  MIGRATION_TOKEN_TTL_MS,
  MigrationService,
  type MigrationDeps,
  type MigrationInput,
} from '../main/migrationService'
import { ProjectService } from '../main/projectService'

let directory: string
let counter = 0

beforeEach(async () => {
  directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'cunlian-a03-'))
  counter = 0
})

afterEach(async () => {
  await fsp.rm(directory, { recursive: true, force: true })
})

function fixturePath(name: string): string {
  return new URL(`../../src/backup/__fixtures__/${name}`, import.meta.url).pathname
}

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fixturePath(name)))
}

function target(name = 'migrated'): string {
  return path.join(directory, `${name}.cunlian`)
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

interface Harness {
  service: MigrationService
  projectService: ProjectService
  picks: { input: MigrationInput | null; target: string | null }
  gate: 'proceed' | 'cancel'
  clock: { now: number }
}

function harness(options: { gate?: 'proceed' | 'cancel' } = {}): Harness {
  const projectService = new ProjectService({
    newSessionId: () => `session-${(counter += 1)}`,
    store: new FileStore(),
  })
  const picks: { input: MigrationInput | null; target: string | null } = {
    input: null,
    target: null,
  }
  const state: Harness = {
    service: undefined as unknown as MigrationService,
    projectService,
    picks,
    gate: options.gate ?? 'proceed',
    clock: { now: 1_000_000 },
  }
  const deps: MigrationDeps = {
    projectService,
    pickInput: async () => picks.input,
    pickTarget: async () => picks.target,
    dirtyGate: async () => state.gate,
    now: () => state.clock.now,
    newToken: () => `token-${(counter += 1)}`,
    appVersion: '2.0.0-test',
    electronVersion: '45.2.3-test',
  }
  state.service = new MigrationService(deps)
  return state
}

function bundleInput(): MigrationInput {
  return { path: fixturePath('valid-minimal.cunlian.zip'), bytes: fixtureBytes('valid-minimal.cunlian.zip') }
}

function v2JsonText(): string {
  return JSON.stringify({
    schemaVersion: 2,
    unit: 'q',
    qPerMm: 10000,
    engineVersion: '0.1.0',
    id: 'json-project',
    name: '旧 JSON 项目',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    relationRevision: 4,
    relationReview: {
      relationRevision: 4,
      fingerprint: 'old-fingerprint',
      confirmedAt: '2026-02-02T00:00:00.000Z',
    },
    working: {
      terms: [
        {
          id: 'h',
          symbol: 'H',
          name: '机架',
          nominalQ: 1000000,
          lowerDeviationQ: 0,
          upperDeviationQ: 1000,
          sign: 1,
          sourceNote: '',
          termRevision: 2,
        },
        {
          id: 'b1',
          symbol: 'B1',
          name: '轴承',
          nominalQ: 200000,
          lowerDeviationQ: -200,
          upperDeviationQ: 0,
          sign: -1,
          sourceNote: '',
          termRevision: 3,
        },
      ],
      target: { minQ: 1000, maxQ: 3000 },
      assumptions: 'JSON 假设',
    },
    baseline: null,
    sources: {
      documents: [
        { id: 'doc-1', title: '旧装配图.pdf', latestRevisionId: 'rev-1' },
      ],
      revisions: [
        {
          id: 'rev-1',
          documentId: 'doc-1',
          fileName: '旧装配图.pdf',
          sha256: 'a'.repeat(64),
          byteSize: 2048,
          pageCount: 2,
          createdAt: '2026-01-05T00:00:00.000Z',
          blobKey: 'old-blob',
        },
      ],
      bindings: [
        {
          id: 'bind-1',
          termId: 'h',
          revisionId: 'rev-1',
          documentId: 'doc-1',
          page: 1,
          rectPdf: [10, 10, 100, 40],
          pageBoxPdf: [0, 0, 600, 800],
          note: '旧绑定',
          createdAt: '2026-01-06T00:00:00.000Z',
          reviewedTermRevision: 2,
          reviewedAt: '2026-01-07T00:00:00.000Z',
          historicalAcceptance: {
            reason: '旧版仍有效',
            scope: '本批次',
            acceptedAt: '2026-01-07T00:00:00.000Z',
            latestRevisionId: 'rev-1',
          },
        },
      ],
    },
  })
}

describe('migration:inspect 预检', () => {
  it('完整备份预检只读：返回 token 与候选，不建会话、不落盘', async () => {
    const h = harness()
    h.picks.input = bundleInput()
    const value = await h.service.inspect(1, { kind: 'bundle' })
    expect(value.importToken).toBe('token-1')
    expect(value.projects).toEqual([
      { id: 'fixture-project', name: '夹具项目', attachmentCount: 0, missingItems: 0 },
    ])
    expect(h.service.activeTokenCount()).toBe(1)
    expect(h.projectService.dirtySessionCount()).toBe(0)
    await expect(fsp.stat(target())).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('取消选择输入返回 CANCELLED，不产生 token', async () => {
    const h = harness()
    h.picks.input = null
    await expect(h.service.inspect(1, { kind: 'json' })).rejects.toMatchObject({
      code: 'CANCELLED',
    })
    expect(h.service.activeTokenCount()).toBe(0)
  })

  it('坏包与超限 JSON 在预检阶段拒绝，不产生 token', async () => {
    const h = harness()
    h.picks.input = {
      path: 'bad.zip',
      bytes: fixtureBytes('malicious-traversal-relative.cunlian.zip'),
    }
    await expect(h.service.inspect(1, { kind: 'bundle' })).rejects.toMatchObject({
      code: 'UNSAFE_PATH',
    })
    h.picks.input = { path: 'big.json', bytes: new Uint8Array(1024 * 1024 + 1) }
    await expect(h.service.inspect(1, { kind: 'json' })).rejects.toMatchObject({
      code: 'TOO_LARGE',
    })
    expect(h.service.activeTokenCount()).toBe(0)
  })
})

describe('migration:commit 提交', () => {
  it('成功提交：另存新文件、回读一致、建立会话；输入字节不变', async () => {
    const h = harness()
    h.picks.input = bundleInput()
    const before = sha256(h.picks.input.bytes)
    const preview = await h.service.inspect(1, { kind: 'bundle' })
    h.picks.target = target()

    const committed = await h.service.commit(1, {
      importToken: preview.importToken,
      projectId: 'fixture-project',
    })
    expect(committed.path).toBe(target())
    expect(committed.editSeq).toBe(0)
    expect(committed.warnings.join('')).toContain('当前关系确认')
    expect(h.projectService.getSession(committed.sessionId)).not.toBeNull()

    const written = new Uint8Array(await fsp.readFile(target()))
    const decoded = await decodeProjectFile(written)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(toSnapshotDto(decoded.value.snapshot)).toEqual(committed.snapshot)
    // 用会话服务重新打开落盘文件，renderer 可见 DTO 与提交返回逐字段一致。
    const reopened = await h.projectService.openFile(committed.path as string)
    expect(reopened.ok).toBe(true)
    if (reopened.ok) {
      expect(reopened.value.snapshot).toEqual(committed.snapshot)
      expect(reopened.value.path).toBe(committed.path)
    }
    expect(sha256(h.picks.input.bytes)).toBe(before)
    // token 提交成功后不可重复使用。
    await expect(
      h.service.commit(1, { importToken: preview.importToken, projectId: 'fixture-project' }),
    ).rejects.toMatchObject({ code: 'STALE_IMPORT' })
  })

  it('dirty gate 取消：不落盘、不建会话、当前项目不变', async () => {
    const h = harness({ gate: 'cancel' })
    h.picks.input = bundleInput()
    h.picks.target = target()
    const preview = await h.service.inspect(1, { kind: 'bundle' })
    await expect(
      h.service.commit(1, { importToken: preview.importToken, projectId: 'fixture-project' }),
    ).rejects.toMatchObject({ code: 'CANCELLED' })
    await expect(fsp.stat(target())).rejects.toMatchObject({ code: 'ENOENT' })
    expect(h.projectService.dirtySessionCount()).toBe(0)
  })

  it('保存失败零写入：父目录不存在、目标已存在、目标与输入相同都被拒绝', async () => {
    const h = harness()
    h.picks.input = bundleInput()
    const preview = await h.service.inspect(1, { kind: 'bundle' })

    h.picks.target = path.join(directory, 'missing-dir', 'out.cunlian')
    await expect(
      h.service.commit(1, { importToken: preview.importToken, projectId: 'fixture-project' }),
    ).rejects.toMatchObject({ code: 'SAVE_FAILED' })
    await expect(
      fsp.stat(path.join(directory, 'missing-dir', 'out.cunlian')),
    ).rejects.toMatchObject({ code: 'ENOENT' })

    h.picks.target = target()
    await fsp.writeFile(target(), 'existing')
    await expect(
      h.service.commit(1, { importToken: preview.importToken, projectId: 'fixture-project' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(await fsp.readFile(target(), 'utf8')).toBe('existing')

    // 输入路径本身是 .cunlian 时，目标等于输入必须拒绝（不覆盖源）。
    h.picks.input = {
      path: path.join(directory, 'input.cunlian'),
      bytes: new Uint8Array(Buffer.from(v2JsonText(), 'utf8')),
    }
    h.picks.target = h.picks.input.path
    const jsonPreview = await h.service.inspect(1, { kind: 'json' })
    await expect(
      h.service.commit(1, { importToken: jsonPreview.importToken, projectId: 'json-project' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(h.projectService.dirtySessionCount()).toBe(0)
  })

  it('token 过期或跨窗口：STALE_IMPORT，且零写入', async () => {
    const h = harness()
    h.picks.input = bundleInput()
    h.picks.target = target()
    const preview = await h.service.inspect(1, { kind: 'bundle' })
    await expect(
      h.service.commit(2, { importToken: preview.importToken, projectId: 'fixture-project' }),
    ).rejects.toMatchObject({ code: 'STALE_IMPORT' })

    h.clock.now += MIGRATION_TOKEN_TTL_MS + 1
    await expect(
      h.service.commit(1, { importToken: preview.importToken, projectId: 'fixture-project' }),
    ).rejects.toMatchObject({ code: 'STALE_IMPORT' })
    await expect(fsp.stat(target())).rejects.toMatchObject({ code: 'ENOENT' })
    expect(h.projectService.dirtySessionCount()).toBe(0)
  })

  it('旧 JSON：清当前确认、relationRevision+1、缺附件新 blobKey；重开逐字段一致', async () => {
    const h = harness()
    h.picks.input = {
      path: path.join(directory, 'legacy.json'),
      bytes: new Uint8Array(Buffer.from(v2JsonText(), 'utf8')),
    }
    h.picks.target = target('json-migrated')
    const preview = await h.service.inspect(1, { kind: 'json' })
    expect(preview.projects[0]).toMatchObject({
      id: 'json-project',
      attachmentCount: 0,
      missingItems: 1,
    })
    const committed = await h.service.commit(1, {
      importToken: preview.importToken,
      projectId: 'json-project',
    })
    const snapshot = committed.snapshot as ProjectFileSnapshot
    expect(snapshot.project.relationReview).toBeNull()
    expect(snapshot.project.relationRevision).toBe(5)
    expect(snapshot.bindings[0]?.reviewedTermRevision).toBeNull()
    expect(snapshot.bindings[0]?.reviewedAt).toBeNull()
    expect(snapshot.bindings[0]?.historicalAcceptance).toBeNull()
    expect(snapshot.missingAttachments).toHaveLength(1)
    expect(snapshot.missingAttachments[0]?.reason).toBe('legacy-json')
    expect(snapshot.revisions[0]?.blobKey).not.toBe('old-blob')
    expect(snapshot.missingAttachments[0]?.blobKey).toBe(snapshot.revisions[0]?.blobKey)

    const written = new Uint8Array(await fsp.readFile(target('json-migrated')))
    const decoded = await decodeProjectFile(written)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(toSnapshotDto(decoded.value.snapshot)).toEqual(snapshot)
  })

  it('提交前失败不改变当前会话、编辑序号与 dirty，源文件字节不变', async () => {
    const h = harness()
    const sample = await createSampleSnapshot()
    const encoded = await encodeProjectFile(sample)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const current = path.join(directory, 'current.cunlian')
    await fsp.writeFile(current, encoded.value.bytes)
    const opened = await h.projectService.openFile(current)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const staged = h.projectService.stage(opened.value.sessionId, 1, {
      ...sample,
      project: { ...sample.project, name: '未保存的改名' },
    })
    expect(staged.ok).toBe(true)
    expect(h.projectService.dirtySessionCount()).toBe(1)

    const input = bundleInput()
    const before = sha256(input.bytes)
    h.picks.input = input
    const preview = await h.service.inspect(1, { kind: 'bundle' })
    h.picks.target = path.join(directory, 'missing-dir', 'out.cunlian')
    await expect(
      h.service.commit(1, { importToken: preview.importToken, projectId: 'fixture-project' }),
    ).rejects.toMatchObject({ code: 'SAVE_FAILED' })

    const session = h.projectService.getSession(opened.value.sessionId)
    expect(session?.acceptedSeq).toBe(1)
    expect(session?.savedSeq).toBe(0)
    expect(session?.path).toBe(current)
    expect(h.projectService.dirtySessionCount()).toBe(1)
    expect(sha256(input.bytes)).toBe(before)
    // 源文件仍是可打开的当前项目，未被迁移改动。
    const still = await h.projectService.openFile(current)
    expect(still.ok).toBe(true)
  })
})
