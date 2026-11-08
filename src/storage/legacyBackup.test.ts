// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import { deleteProjectDatabase } from '../test/projectDb'
import { parseMm } from '../domain/units'
import type { V1Project } from './migrateV1'
import {
  EVENT_STORE_NAME,
  MIGRATION_BACKUP_STORE_NAME,
  PROJECT_STORE_NAME,
  databaseErrorCode,
  openDatabase,
  requestResult,
  transactionDone,
} from './db'
import {
  LEGACY_BACKUP_FORMAT,
  createProject,
  exportLegacyBackup,
  getDraft,
  getProject,
  inspectLegacyProjects,
  listProjects,
  migrateLegacyProjectsNow,
  restoreLegacyBackup,
} from './projects'

function v1Project(overrides: Partial<V1Project> = {}): V1Project {
  return {
    schemaVersion: 1,
    engineVersion: 'v1-engine',
    id: 'legacy-1',
    name: '旧版项目一',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    working: {
      terms: [
        {
          id: 't-h',
          symbol: 'H',
          name: '孔',
          nominalQ: parseMm('100'),
          lowerDeviationQ: parseMm('0'),
          upperDeviationQ: parseMm('0.1'),
          sign: 1,
          sourceNote: '原始备注',
        },
        {
          id: 't-b',
          symbol: 'B',
          name: '轴',
          nominalQ: parseMm('99.9'),
          lowerDeviationQ: parseMm('-0.05'),
          upperDeviationQ: parseMm('0'),
          sign: -1,
          sourceNote: '',
        },
      ],
      target: { minQ: parseMm('0.05'), maxQ: parseMm('0.2') },
      assumptions: '旧假设',
      relationConfirmed: true,
    },
    baseline: {
      savedAt: '2026-01-01T12:00:00.000Z',
      definition: {
        terms: [
          {
            id: 'b-h',
            symbol: 'H',
            name: '孔',
            nominalQ: parseMm('100'),
            lowerDeviationQ: parseMm('0'),
            upperDeviationQ: parseMm('0.05'),
            sign: 1,
            sourceNote: '',
          },
          {
            id: 'b-b',
            symbol: 'B',
            name: '轴',
            nominalQ: parseMm('99.9'),
            lowerDeviationQ: parseMm('-0.05'),
            upperDeviationQ: parseMm('0'),
            sign: -1,
            sourceNote: '',
          },
        ],
        target: null,
        assumptions: '',
        relationConfirmed: true,
      },
    },
    ...overrides,
  }
}

async function seedLegacy(
  projects: unknown[],
  drafts: { projectId: string; draft: unknown; savedAt: string }[] = [],
): Promise<void> {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(['projects', 'drafts'], 'readwrite')
    const done = transactionDone(transaction)
    for (const project of projects) {
      transaction.objectStore('projects').put(project)
    }
    for (const draft of drafts) {
      transaction.objectStore('drafts').put(draft)
    }
    await done
  } finally {
    db.close()
  }
}

async function readRawProjects(): Promise<unknown[]> {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(PROJECT_STORE_NAME, 'readonly')
    const done = transactionDone(transaction)
    const records = await requestResult(
      transaction.objectStore(PROJECT_STORE_NAME).getAll(),
    )
    await done
    return records
  } finally {
    db.close()
  }
}

async function countStore(storeName: string): Promise<number> {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(storeName, 'readonly')
    const done = transactionDone(transaction)
    const count = await requestResult(transaction.objectStore(storeName).count())
    await done
    return count
  } finally {
    db.close()
  }
}

beforeEach(async () => {
  await deleteProjectDatabase()
})

describe('迁移前影响预览：只读、不改库', () => {
  it('列出项目数/环数/基线/草稿/将清除的确认，并标出会阻止整批迁移的记录', async () => {
    const broken = v1Project({
      id: 'legacy-broken',
      name: '坏记录',
      working: {
        terms: [
          {
            id: 'bad',
            symbol: 'X',
            name: '非法',
            nominalQ: 0,
            lowerDeviationQ: 0,
            upperDeviationQ: 0,
            sign: 1,
            sourceNote: '',
          },
          {
            id: 'ok',
            symbol: 'Y',
            name: '合法',
            nominalQ: parseMm('10'),
            lowerDeviationQ: parseMm('0'),
            upperDeviationQ: parseMm('0.1'),
            sign: 1,
            sourceNote: '',
          },
        ],
        target: null,
        assumptions: '',
        relationConfirmed: false,
      },
      baseline: null,
    })
    const draft = {
      projectId: 'legacy-1',
      savedAt: '2026-01-02T00:00:00.000Z',
      draft: {
        terms: [
          {
            id: 't-h',
            symbol: 'H',
            name: '孔',
            nominal: '',
            lower: '0.0000',
            upper: '0.1000',
            sign: 1,
            sourceNote: '',
          },
        ],
        targetMin: '',
        targetMax: 'bad',
        assumptions: '',
        relationConfirmed: true,
      },
    }
    await seedLegacy([v1Project(), broken], [draft])

    const report = await inspectLegacyProjects()
    expect(report.ok).toBe(true)
    if (!report.ok) {
      throw new Error(report.error.message)
    }
    expect(report.value.projects).toHaveLength(2)
    expect(report.value.draftCount).toBe(1)
    expect(report.value.blocking).toBe(1)

    const first = report.value.projects.find((project) => project.id === 'legacy-1')
    expect(first).toEqual({
      id: 'legacy-1',
      name: '旧版项目一',
      updatedAt: '2026-01-02T00:00:00.000Z',
      termCount: 2,
      baselineTermCount: 2,
      workingConfirmationWillClear: true,
      baselineConfirmationWillClear: true,
      draftPresent: true,
      draftInvalid: true,
      migrationError: null,
    })
    const second = report.value.projects.find(
      (project) => project.id === 'legacy-broken',
    )
    expect(second?.migrationError).toContain('基本尺寸')

    // 预览不得触发迁移、备份或事件：原始 V1 记录原样仍在。
    const raw = await readRawProjects()
    expect(raw).toHaveLength(2)
    expect(raw.every((record) => (record as { schemaVersion: number }).schemaVersion === 1)).toBe(
      true,
    )
    expect(await countStore(MIGRATION_BACKUP_STORE_NAME)).toBe(0)
    expect(await countStore(EVENT_STORE_NAME)).toBe(0)
  })
})

describe('迁移前原始备份：导出到文件内容、可恢复', () => {
  it('导出内容为未改写的 V1 项目与草稿', async () => {
    const project = v1Project()
    const draft = {
      projectId: 'legacy-1',
      savedAt: '2026-01-02T00:00:00.000Z',
      draft: {
        terms: [],
        targetMin: '',
        targetMax: '',
        assumptions: '草稿假设',
        relationConfirmed: true,
      },
    }
    await seedLegacy([project], [draft])

    const exported = await exportLegacyBackup()
    expect(exported.ok).toBe(true)
    if (!exported.ok) {
      throw new Error(exported.error.message)
    }
    expect(exported.value.projectCount).toBe(1)
    expect(exported.value.draftCount).toBe(1)
    const payload = JSON.parse(exported.value.json) as {
      format: string
      projects: unknown[]
      drafts: unknown[]
    }
    expect(payload.format).toBe(LEGACY_BACKUP_FORMAT)
    expect(payload.projects).toEqual([project])
    expect(payload.drafts).toEqual([draft])
    expect(exported.value.json).toContain('relationConfirmed')
  })

  it('迁移后仍能导入原始备份：新 ID、数值/基线/无效草稿保留、原项目不被覆盖', async () => {
    const project = v1Project()
    const draft = {
      projectId: 'legacy-1',
      savedAt: '2026-01-02T00:00:00.000Z',
      draft: {
        terms: [
          {
            id: 't-h',
            symbol: 'H',
            name: '孔',
            nominal: '',
            lower: '0.0000',
            upper: '0.1000',
            sign: 1,
            sourceNote: '',
          },
        ],
        targetMin: '',
        targetMax: 'bad',
        assumptions: '',
        relationConfirmed: true,
      },
    }
    await seedLegacy([project], [draft])
    const exported = await exportLegacyBackup()
    if (!exported.ok) {
      throw new Error(exported.error.message)
    }

    const migrated = await migrateLegacyProjectsNow()
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) {
      throw new Error(migrated.error.message)
    }
    expect(migrated.value).toEqual(['legacy-1'])
    const migratedProject = await getProject('legacy-1')
    expect(migratedProject.ok && migratedProject.value?.schemaVersion).toBe(2)

    const restored = await restoreLegacyBackup(exported.value.json)
    expect(restored.ok).toBe(true)
    if (!restored.ok) {
      throw new Error(restored.error.message)
    }
    expect(restored.value.failed).toEqual([])
    expect(restored.value.restored).toHaveLength(1)
    const entry = restored.value.restored[0]
    expect(entry.originalId).toBe('legacy-1')
    expect(entry.newProjectId).not.toBe('legacy-1')
    expect(entry.draftRestored).toBe(true)

    const copy = await getProject(entry.newProjectId)
    expect(copy.ok).toBe(true)
    if (!copy.ok || copy.value === null) {
      throw new Error('恢复项目缺失')
    }
    expect(copy.value.working.terms.map((term) => [term.symbol, term.nominalQ])).toEqual([
      ['H', parseMm('100')],
      ['B', parseMm('99.9')],
    ])
    expect(copy.value.working.target).toEqual({ minQ: parseMm('0.05'), maxQ: parseMm('0.2') })
    expect(copy.value.baseline?.definition.terms.map((term) => term.symbol)).toEqual([
      'H',
      'B',
    ])
    expect(copy.value.relationReview).toBeNull()

    // 无效草稿输入原样保留（不通过校验也要保留）。
    const copyDraft = await getDraft(entry.newProjectId)
    expect(copyDraft.ok).toBe(true)
    if (copyDraft.ok && copyDraft.value !== null) {
      expect(copyDraft.value.draft.terms[0].nominal).toBe('')
      expect(copyDraft.value.draft.targetMax).toBe('bad')
      expect(copyDraft.value.draft.relationRevision).toBe(1)
    }

    // 已迁移的原项目没有被恢复操作覆盖，也没有第二个同 ID 项目。
    const listed = await listProjects()
    expect(listed.ok).toBe(true)
    if (listed.ok) {
      expect(listed.value.map((item) => item.id).sort()).toEqual(
        ['legacy-1', entry.newProjectId].sort(),
      )
    }
  })

  it('拒绝非本应用的 JSON，且不写任何项目', async () => {
    const before = await listProjects()
    expect(before.ok).toBe(true)
    const rejected = await restoreLegacyBackup('{"projects":[]}')
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      expect(rejected.error.message).toContain('不是本应用导出的迁移前原始备份')
    }
    const after = await listProjects()
    expect(after.ok).toBe(true)
    if (before.ok && after.ok) {
      expect(after.value).toEqual(before.value)
    }
  })
})

describe('迁移中途失败：整批回滚、可重试、不产生半迁移项目', () => {
  it('第二条项目非法时第一条也不落库；修正后重试一次完成', async () => {
    const broken = v1Project({
      id: 'broken-2',
      name: '第二条坏记录',
      working: {
        terms: [
          {
            id: 'x',
            symbol: 'X',
            name: '非法',
            nominalQ: 0,
            lowerDeviationQ: 0,
            upperDeviationQ: 0,
            sign: 1,
            sourceNote: '',
          },
          {
            id: 'y',
            symbol: 'Y',
            name: '合法',
            nominalQ: parseMm('10'),
            lowerDeviationQ: parseMm('0'),
            upperDeviationQ: parseMm('0.1'),
            sign: 1,
            sourceNote: '',
          },
        ],
        target: null,
        assumptions: '',
        relationConfirmed: false,
      },
      baseline: null,
    })
    await seedLegacy([v1Project(), broken])

    const failed = await migrateLegacyProjectsNow()
    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.error.message).toContain('整批已回滚')
    }

    // 整批回滚：两条都还是 V1；没有备份、没有事件、没有半迁移。
    const rawAfterFailure = await readRawProjects()
    expect(rawAfterFailure).toHaveLength(2)
    expect(
      rawAfterFailure.every(
        (record) => (record as { schemaVersion: number }).schemaVersion === 1,
      ),
    ).toBe(true)
    expect(await countStore(MIGRATION_BACKUP_STORE_NAME)).toBe(0)
    expect(await countStore(EVENT_STORE_NAME)).toBe(0)

    // 修正坏记录后重试：一次迁移两条，各留一份原始备份与事件。
    const fixed = v1Project({
      id: 'broken-2',
      name: '第二条修复后',
      working: v1Project().working,
      baseline: null,
    })
    await seedLegacy([fixed])
    const retried = await migrateLegacyProjectsNow()
    expect(retried.ok).toBe(true)
    if (retried.ok) {
      expect(retried.value.sort()).toEqual(['broken-2', 'legacy-1'])
    }
    const rawAfterRetry = await readRawProjects()
    expect(
      rawAfterRetry.every(
        (record) => (record as { schemaVersion: number }).schemaVersion === 2,
      ),
    ).toBe(true)
    expect(await countStore(MIGRATION_BACKUP_STORE_NAME)).toBe(2)
    expect(await countStore(EVENT_STORE_NAME)).toBe(2)

    const backups = await openDatabase().then(async (db) => {
      try {
        const transaction = db.transaction(MIGRATION_BACKUP_STORE_NAME, 'readonly')
        const done = transactionDone(transaction)
        const all = await requestResult(
          transaction.objectStore(MIGRATION_BACKUP_STORE_NAME).getAll(),
        )
        await done
        return all as { projectId: string; raw: { schemaVersion: number } }[]
      } finally {
        db.close()
      }
    })
    expect(backups.map((backup) => backup.projectId).sort()).toEqual([
      'broken-2',
      'legacy-1',
    ])
    expect(backups.every((backup) => backup.raw.schemaVersion === 1)).toBe(true)
  })
})

describe('blocked 晚升级：带真实项目、草稿与 Blob 的库前后对照', () => {
  it('升级被挡住时报错且不改数据；解除后补齐新 store，记录与 Blob 字节不变', async () => {
    const created = await createProject({
      name: '带来源的项目',
      working: v1Project().working
        ? {
            terms: v1Project().working.terms.map((term) => ({ ...term, termRevision: 1 })),
            target: { minQ: parseMm('0.05'), maxQ: parseMm('0.2') },
            assumptions: '旧假设',
          }
        : { terms: [], target: null, assumptions: '' },
    })
    expect(created.ok).toBe(true)
    if (!created.ok) {
      throw new Error(created.error.message)
    }
    const projectId = created.value.id
    const bytes = buildSyntheticPdf({ pageCount: 1, variant: 'A' })
    const seeded = await openDatabase()
    try {
      const transaction = seeded.transaction(
        ['drafts', 'sourceDocuments', 'sourceRevisions', 'sourceBlobs'],
        'readwrite',
      )
      const done = transactionDone(transaction)
      transaction.objectStore('drafts').put({
        projectId,
        savedAt: '2026-01-03T00:00:00.000Z',
        draft: {
          terms: [
            {
              id: 't-h',
              symbol: 'H',
              name: '孔',
              nominal: '100.0000',
              lower: '0.0000',
              upper: '0.1000',
              sign: 1,
              sourceNote: '',
              termRevision: 1,
            },
          ],
          targetMin: '0.0500',
          targetMax: '0.2000',
          assumptions: '草稿',
          relationRevision: 1,
        },
      })
      transaction.objectStore('sourceDocuments').put({
        id: 'doc-1',
        projectId,
        title: '装配图.pdf',
        latestRevisionId: 'rev-1',
        createdAt: '2026-01-03T00:00:00.000Z',
      })
      transaction.objectStore('sourceRevisions').put({
        id: 'rev-1',
        projectId,
        documentId: 'doc-1',
        fileName: '装配图.pdf',
        pageCount: 1,
        sha256: 'a'.repeat(64),
        byteLength: bytes.byteLength,
        blobKey: 'blob-1',
        createdAt: '2026-01-03T00:00:00.000Z',
      })
      transaction.objectStore('sourceBlobs').put({
        blobKey: 'blob-1',
        projectId,
        blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
      })
      await done
    } finally {
      seeded.close()
    }

    const before = await openDatabase()
    const beforeVersion = before.version
    const beforeSnapshot = await (async () => {
      try {
        const transaction = before.transaction(
          [PROJECT_STORE_NAME, 'drafts', 'sourceDocuments', 'sourceRevisions', 'sourceBlobs'],
          'readonly',
        )
        const done = transactionDone(transaction)
        const projects = await requestResult(
          transaction.objectStore(PROJECT_STORE_NAME).getAll(),
        )
        const drafts = await requestResult(transaction.objectStore('drafts').getAll())
        const documents = await requestResult(
          transaction.objectStore('sourceDocuments').getAll(),
        )
        const revisions = await requestResult(
          transaction.objectStore('sourceRevisions').getAll(),
        )
        const blobRecords = await requestResult(
          transaction.objectStore('sourceBlobs').getAll(),
        )
        await done
        const blobs = [] as number[][]
        for (const record of blobRecords as { blob: Blob }[]) {
          blobs.push(Array.from(new Uint8Array(await record.blob.arrayBuffer())))
        }
        return { projects, drafts, documents, revisions, blobs }
      } finally {
        before.close()
      }
    })()
    expect(beforeVersion).toBe(6)
    expect(beforeSnapshot.blobs[0]).toEqual(Array.from(bytes))

    // 旧客户端：没有 versionchange 处理器，占住连接不释放。
    const holder = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('shaft-tolerance-chain', beforeVersion)
      request.onupgradeneeded = () => reject(new Error('不应创建新库'))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开旧连接失败'))
    })

    const blocked = await (async () => {
      try {
        const opened = await openDatabase({ version: beforeVersion + 1 })
        opened.close()
        return null
      } catch (error) {
        return error
      }
    })()
    expect(blocked).not.toBeNull()
    expect(databaseErrorCode(blocked)).toBe('database_blocked')
    const blockedMessage = blocked instanceof Error ? blocked.message : ''
    expect(blockedMessage).toContain('关闭或刷新其它标签页')
    expect(blockedMessage).toContain('升级仍会继续')

    // blocked 期间数据不变；用占住连接的旧客户端本身读取（此时不要再开新连接，
    // 否则会排在未完成的升级请求之后）。
    {
      expect(holder.version).toBe(6)
      const transaction = holder.transaction(
        [PROJECT_STORE_NAME, 'drafts', 'sourceDocuments', 'sourceRevisions', 'sourceBlobs'],
        'readonly',
      )
      const done = transactionDone(transaction)
      const readProjects = await requestResult(
        transaction.objectStore(PROJECT_STORE_NAME).getAll(),
      )
      const readDrafts = await requestResult(transaction.objectStore('drafts').getAll())
      const readDocuments = await requestResult(
        transaction.objectStore('sourceDocuments').getAll(),
      )
      const readRevisions = await requestResult(
        transaction.objectStore('sourceRevisions').getAll(),
      )
      const blobs = (await requestResult(
        transaction.objectStore('sourceBlobs').getAll(),
      )) as { blob: Blob }[]
      expect(readProjects).toEqual(beforeSnapshot.projects)
      expect(readDrafts).toEqual(beforeSnapshot.drafts)
      expect(readDocuments).toEqual(beforeSnapshot.documents)
      expect(readRevisions).toEqual(beforeSnapshot.revisions)
      expect(Array.from(new Uint8Array(await blobs[0].blob.arrayBuffer()))).toEqual(
        Array.from(bytes),
      )
      await done
    }

    // 解除阻塞后，之前报 blocked 的请求仍会完成升级；实现必须关闭迟到的连接。
    holder.close()
    await new Promise((resolve) => setTimeout(resolve, 150))
    const upgraded = await openDatabase({ version: beforeVersion + 1 })
    expect(upgraded.version).toBe(7)
    try {
      expect(Array.from(upgraded.objectStoreNames)).toEqual(
        expect.arrayContaining([
          'migrationBackups',
          'bindings',
          'events',
          'sourceBlobs',
        ]),
      )
      const transaction = upgraded.transaction(
        [PROJECT_STORE_NAME, 'drafts', 'sourceDocuments', 'sourceRevisions', 'sourceBlobs'],
        'readonly',
      )
      const done = transactionDone(transaction)
      expect(await requestResult(transaction.objectStore(PROJECT_STORE_NAME).getAll())).toEqual(
        beforeSnapshot.projects,
      )
      expect(await requestResult(transaction.objectStore('drafts').getAll())).toEqual(
        beforeSnapshot.drafts,
      )
      expect(
        await requestResult(transaction.objectStore('sourceDocuments').getAll()),
      ).toEqual(beforeSnapshot.documents)
      const blobs = (await requestResult(
        transaction.objectStore('sourceBlobs').getAll(),
      )) as { blob: Blob }[]
      expect(Array.from(new Uint8Array(await blobs[0].blob.arrayBuffer()))).toEqual(
        Array.from(bytes),
      )
      await done
    } finally {
      upgraded.close()
    }

    // 迟到的连接必须已被关闭，否则 deleteDatabase 会再次 blocked。
    const deleted = await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('shaft-tolerance-chain')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('删除失败'))
      request.onblocked = () =>
        reject(new Error('打开请求泄漏了连接：deleteDatabase 被 blocked'))
    })
    expect(deleted).toBeUndefined()
  })
})
