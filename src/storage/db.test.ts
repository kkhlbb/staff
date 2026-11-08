// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { V1Project } from './migrateV1'
import { parseMm } from '../domain/units'
import { deleteProjectDatabase } from '../test/projectDb'
import {
  BINDING_STORE_NAME,
  DRAFT_STORE_NAME,
  EVENT_STORE_NAME,
  IMPORT_SNAPSHOT_STORE_NAME,
  MAPPING_TEMPLATE_STORE_NAME,
  MIGRATION_BACKUP_STORE_NAME,
  PROJECT_DB_NAME,
  PROJECT_DB_VERSION,
  PROJECT_STORE_NAME,
  SOURCE_BLOB_STORE_NAME,
  SOURCE_DOCUMENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
  databaseErrorCode,
  openDatabase,
  requestResult,
  subscribeDatabaseVersionChange,
} from './db'
import { getDraft, getProject, listProjects } from './projects'

const ALL_STORES = [
  BINDING_STORE_NAME,
  DRAFT_STORE_NAME,
  EVENT_STORE_NAME,
  IMPORT_SNAPSHOT_STORE_NAME,
  MAPPING_TEMPLATE_STORE_NAME,
  MIGRATION_BACKUP_STORE_NAME,
  PROJECT_STORE_NAME,
  SOURCE_BLOB_STORE_NAME,
  SOURCE_DOCUMENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
]

const sampleProject: V1Project = {
  schemaVersion: 1,
  engineVersion: 'test-engine',
  id: 'v1-project',
  name: 'V1 迁移前项目',
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
        sourceNote: '原数据',
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
    target: { minQ: parseMm('0.1'), maxQ: parseMm('0.2') },
    assumptions: 'V1 假设',
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
          upperDeviationQ: parseMm('0.1'),
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
}

const sampleDraft = {
  projectId: sampleProject.id,
  savedAt: '2026-01-02T00:00:00.000Z',
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
        sourceNote: '原数据',
      },
      {
        id: 't-b',
        symbol: 'B',
        name: '轴',
        nominal: '99.9000',
        lower: '-0.0500',
        upper: '0.0000',
        sign: -1,
        sourceNote: '',
      },
    ],
    targetMin: '0.1000',
    targetMax: '0.2000',
    assumptions: 'V1 假设',
    relationConfirmed: true,
  },
}

beforeEach(async () => {
  await deleteProjectDatabase()
})

/** 建立一个真正的 version=1 数据库，并写入 projects / drafts 数据。 */
function createV1Database(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PROJECT_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore(PROJECT_STORE_NAME, { keyPath: 'id' })
      db.createObjectStore(DRAFT_STORE_NAME, { keyPath: 'projectId' })
    }
    request.onerror = () => reject(request.error ?? new Error('open v1 failed'))
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction(
        [PROJECT_STORE_NAME, DRAFT_STORE_NAME],
        'readwrite',
      )
      transaction.objectStore(PROJECT_STORE_NAME).put(sampleProject)
      transaction.objectStore(DRAFT_STORE_NAME).put(sampleDraft)
      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('seed v1 failed'))
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('seed v1 aborted'))
    }
  })
}

function readV2Raw(): Promise<{ project: unknown; draft: unknown }> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PROJECT_DB_NAME, 2)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(MAPPING_TEMPLATE_STORE_NAME)) {
        db.createObjectStore(MAPPING_TEMPLATE_STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onerror = () => reject(request.error ?? new Error('open v2 failed'))
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction(
        [PROJECT_STORE_NAME, DRAFT_STORE_NAME],
        'readonly',
      )
      const projectRequest = transaction
        .objectStore(PROJECT_STORE_NAME)
        .get(sampleProject.id)
      const draftRequest = transaction
        .objectStore(DRAFT_STORE_NAME)
        .get(sampleProject.id)
      transaction.oncomplete = () => {
        db.close()
        resolve({
          project: projectRequest.result,
          draft: draftRequest.result,
        })
      }
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('read v2 failed'))
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('read v2 aborted'))
    }
  })
}

describe('数据库迁移：v1 项目首次升级', () => {
  it('原始记录留备份，项目/基线/草稿保留并清除旧人工确认', async () => {
    await createV1Database()

    const raw = await readV2Raw()
    expect(raw.project).toEqual(sampleProject)
    expect(raw.draft).toEqual(sampleDraft)

    // 当前代码（v6）打开同一个库：只补缺失 store，不重建、不清空。
    const db = await openDatabase()
    expect(db.version).toBe(PROJECT_DB_VERSION)
    expect(db.version).toBe(6)
    expect(Array.from(db.objectStoreNames).sort()).toEqual(
      ALL_STORES.slice().sort(),
    )
    db.close()

    // 公开读取路径负责迁移：项目、基线、草稿全部保留，旧确认被清除。
    const loaded = await getProject(sampleProject.id)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok || loaded.value === null) {
      throw new Error(loaded.ok ? '项目缺失' : loaded.error.message)
    }
    const project = loaded.value
    expect(project.schemaVersion).toBe(2)
    expect(project.name).toBe('V1 迁移前项目')
    expect(project.engineVersion).toBe('test-engine')
    expect(project.createdAt).toBe(sampleProject.createdAt)
    expect(project.updatedAt).toBe(sampleProject.updatedAt)
    expect(project.working.target).toEqual(sampleProject.working.target)
    expect(project.working.assumptions).toBe('V1 假设')
    expect(
      project.working.terms.map((term) => [
        term.id,
        term.nominalQ,
        term.lowerDeviationQ,
        term.upperDeviationQ,
        term.sign,
        term.termRevision,
      ]),
    ).toEqual([
      ['t-h', parseMm('100'), parseMm('0'), parseMm('0.1'), 1, 1],
      ['t-b', parseMm('99.9'), parseMm('-0.05'), parseMm('0'), -1, 1],
    ])
    expect(project.relationRevision).toBe(1)
    expect(project.relationReview).toBeNull()
    expect(project.migration?.fromSchemaVersion).toBe(1)
    expect(project.migration?.migratedAt).toEqual(expect.any(String))
    expect(project.baseline?.savedAt).toBe(sampleProject.baseline?.savedAt)
    expect(
      project.baseline?.definition.terms.every((term) => term.termRevision === 1),
    ).toBe(true)

    const draft = await getDraft(sampleProject.id)
    expect(draft.ok).toBe(true)
    if (!draft.ok) {
      throw new Error(draft.error.message)
    }
    expect(draft.value?.draft.relationRevision).toBe(1)
    expect(draft.value?.draft.terms.every((term) => term.termRevision === 1)).toBe(
      true,
    )
    expect(draft.value?.draft.terms.map((term) => term.nominal)).toEqual([
      '100.0000',
      '99.9000',
    ])

    // 原始 V1 记录必须完整留在 migrationBackups，不能只靠“升级后字段”冒充历史。
    const backups = await readMigrationBackups(sampleProject.id)
    expect(backups).toHaveLength(1)
    expect(backups[0].fromSchemaVersion).toBe(1)
    expect(backups[0].raw).toEqual(sampleProject)

    const projects = await listProjects()
    expect(projects.ok).toBe(true)
    if (projects.ok) {
      expect(projects.value).toHaveLength(1)
      expect(projects.value[0].id).toBe(sampleProject.id)
      expect(projects.value[0].relationReview).toBeNull()
    }
  })
})

function readMigrationBackups(
  projectId: string,
): Promise<{ raw: unknown; fromSchemaVersion: number }[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PROJECT_DB_NAME)
    request.onerror = () => reject(request.error ?? new Error('open failed'))
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction(MIGRATION_BACKUP_STORE_NAME, 'readonly')
      const backupRequest = transaction
        .objectStore(MIGRATION_BACKUP_STORE_NAME)
        .index('projectId')
        .getAll(projectId)
      transaction.oncomplete = () => {
        db.close()
        resolve(backupRequest.result as { raw: unknown; fromSchemaVersion: number }[])
      }
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('read backups failed'))
    }
  })
}

interface DatabaseMeta {
  version: number
  stores: string[]
}

/** 不带版本打开已存在的库，只读出当前版本与 store 列表；只有库不存在时才会触发升级。 */
function readDatabaseMeta(): Promise<DatabaseMeta> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PROJECT_DB_NAME)
    request.onupgradeneeded = () => {
      reject(new Error('数据库不存在：v1 建库步骤没有生效'))
    }
    request.onerror = () => reject(request.error ?? new Error('读取库信息失败'))
    request.onsuccess = () => {
      const db = request.result
      resolve({ version: db.version, stores: Array.from(db.objectStoreNames) })
      db.close()
    }
  })
}

/** 从已打开的连接里按原始记录读出 projects / drafts（不经过任何解析层）。 */
function readRawFromConnection(
  db: IDBDatabase,
): Promise<{ project: unknown; draft: unknown }> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [PROJECT_STORE_NAME, DRAFT_STORE_NAME],
      'readonly',
    )
    const projectRequest = transaction
      .objectStore(PROJECT_STORE_NAME)
      .get(sampleProject.id)
    const draftRequest = transaction
      .objectStore(DRAFT_STORE_NAME)
      .get(sampleProject.id)
    transaction.oncomplete = () => {
      resolve({ project: projectRequest.result, draft: draftRequest.result })
    }
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('read raw failed'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('read raw aborted'))
  })
}

interface OpenCall {
  version: number | undefined
  upgrades: { oldVersion: number; newVersion: number | null }[]
}

/**
 * 记录被包裹期间每次 indexedDB.open 请求的版本号，以及真实 upgradeneeded
 * 事件上的 oldVersion / newVersion，用来确认升级是一次完成还是分几次。
 */
async function recordOpenCalls<T>(
  run: () => Promise<T>,
): Promise<{ value: T; calls: OpenCall[] }> {
  const originalOpen = indexedDB.open
  const calls: OpenCall[] = []
  const patchedOpen: IDBFactory['open'] = (name: string, version?: number) => {
    const call: OpenCall = { version, upgrades: [] }
    calls.push(call)
    const request = originalOpen.call(indexedDB, name, version)
    request.addEventListener('upgradeneeded', (event) => {
      const change = event as IDBVersionChangeEvent
      call.upgrades.push({
        oldVersion: change.oldVersion,
        newVersion: change.newVersion,
      })
    })
    return request
  }
  indexedDB.open = patchedOpen
  try {
    return { value: await run(), calls }
  } finally {
    indexedDB.open = originalOpen
  }
}

describe('数据库迁移：真实老用户从 v1 直接打开 v5', () => {
  it('v1 库由当前代码一次性升级到 v6：同一次升级建出新 store，旧数据逐字段不变', async () => {
    await createV1Database()

    // 前提：库确实是 version=1，只有老用户就有的两个 store。
    const before = await readDatabaseMeta()
    expect(before.version).toBe(1)
    expect(before.stores.slice().sort()).toEqual(
      [DRAFT_STORE_NAME, PROJECT_STORE_NAME].slice().sort(),
    )

    // 当前代码（PROJECT_DB_VERSION=6）一次性打开：oldVersion=1、newVersion=6。
    const { value: db, calls } = await recordOpenCalls(() => openDatabase())

    expect(calls.map((call) => call.version)).toEqual([6])
    expect(calls[0].upgrades).toEqual([{ oldVersion: 1, newVersion: 6 }])

    expect(db.version).toBe(PROJECT_DB_VERSION)
    expect(db.version).toBe(6)
    expect(Array.from(db.objectStoreNames).sort()).toEqual(
      ALL_STORES.slice().sort(),
    )

    // 升级没有往新表里写任何东西，也没有建出重复的旧表。
    const newStoreTransaction = db.transaction(
      [
        MAPPING_TEMPLATE_STORE_NAME,
        IMPORT_SNAPSHOT_STORE_NAME,
        SOURCE_DOCUMENT_STORE_NAME,
        SOURCE_REVISION_STORE_NAME,
        SOURCE_BLOB_STORE_NAME,
        BINDING_STORE_NAME,
        EVENT_STORE_NAME,
      ],
      'readonly',
    )
    const countOf = (name: string) =>
      requestResult(newStoreTransaction.objectStore(name).count())
    expect(await countOf(MAPPING_TEMPLATE_STORE_NAME)).toBe(0)
    expect(await countOf(IMPORT_SNAPSHOT_STORE_NAME)).toBe(0)
    expect(await countOf(SOURCE_DOCUMENT_STORE_NAME)).toBe(0)
    expect(await countOf(SOURCE_REVISION_STORE_NAME)).toBe(0)
    expect(await countOf(SOURCE_BLOB_STORE_NAME)).toBe(0)
    expect(await countOf(BINDING_STORE_NAME)).toBe(0)
    expect(await countOf(EVENT_STORE_NAME)).toBe(0)
    expect(
      newStoreTransaction
        .objectStore(IMPORT_SNAPSHOT_STORE_NAME)
        .indexNames.contains('projectId'),
    ).toBe(true)
    expect(
      newStoreTransaction
        .objectStore(SOURCE_DOCUMENT_STORE_NAME)
        .indexNames.contains('projectId'),
    ).toBe(true)
    expect(
      newStoreTransaction
        .objectStore(SOURCE_REVISION_STORE_NAME)
        .indexNames.contains('documentId'),
    ).toBe(true)
    expect(
      newStoreTransaction
        .objectStore(SOURCE_BLOB_STORE_NAME)
        .indexNames.contains('projectId'),
    ).toBe(true)
    const bindingStore = newStoreTransaction.objectStore(BINDING_STORE_NAME)
    expect(bindingStore.keyPath).toBe('id')
    expect(Array.from(bindingStore.indexNames).sort()).toEqual([
      'projectId',
      'revisionId',
      'termId',
    ])
    const eventStore = newStoreTransaction.objectStore(EVENT_STORE_NAME)
    expect(eventStore.keyPath).toBe('id')
    expect(Array.from(eventStore.indexNames).sort()).toEqual([
      'createdAt',
      'projectId',
    ])

    // 老数据在升级后的同一条连接里逐字段比对（toEqual 是全字段深比较）。
    const raw = await readRawFromConnection(db)
    expect(raw.project).toEqual(sampleProject)
    expect(raw.draft).toEqual(sampleDraft)

    const stored = raw.project as unknown as V1Project
    expect(stored.working).toEqual(sampleProject.working)
    expect(
      stored.working.terms.map((term) => [
        term.id,
        term.symbol,
        term.nominalQ,
        term.lowerDeviationQ,
        term.upperDeviationQ,
        term.sign,
      ]),
    ).toEqual([
      ['t-h', 'H', parseMm('100'), parseMm('0'), parseMm('0.1'), 1],
      ['t-b', 'B', parseMm('99.9'), parseMm('-0.05'), parseMm('0'), -1],
    ])
    expect(stored.working.target).toEqual({
      minQ: parseMm('0.1'),
      maxQ: parseMm('0.2'),
    })
    expect(stored.working.assumptions).toBe('V1 假设')
    expect(stored.working.relationConfirmed).toBe(true)
    // working 未被改写：项目时间戳仍是老用户写入的值。
    expect(stored.updatedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(stored.baseline).toEqual(sampleProject.baseline)
    db.close()

    // 再用公开 API 走一遍：读取路径会迁移，数值保留、旧确认清除。
    const migrated = await getProject(sampleProject.id)
    expect(migrated.ok).toBe(true)
    if (!migrated.ok || migrated.value === null) {
      throw new Error(migrated.ok ? '项目缺失' : migrated.error.message)
    }
    expect(migrated.value.working).toEqual({
      terms: sampleProject.working.terms.map((term) => ({ ...term, termRevision: 1 })),
      target: sampleProject.working.target,
      assumptions: sampleProject.working.assumptions,
    })
    expect(migrated.value.relationReview).toBeNull()
    const migratedDraft = await getDraft(sampleProject.id)
    expect(migratedDraft.ok).toBe(true)
    if (migratedDraft.ok) {
      expect(migratedDraft.value?.draft.relationRevision).toBe(1)
      expect(
        migratedDraft.value?.draft.terms.every((term) => term.termRevision === 1),
      ).toBe(true)
    }
    const projects = await listProjects()
    expect(projects.ok).toBe(true)
    if (projects.ok) {
      expect(projects.value.map((project) => project.id)).toEqual([sampleProject.id])
    }
    expect((await readDatabaseMeta()).version).toBe(6)
  })
})

const sampleTemplate = {
  id: 'template-1',
  name: '默认映射',
  mapping: { symbol: '代号', nominal: '基本尺寸' },
}

const sampleImportSnapshot = {
  id: 'snapshot-1',
  projectId: sampleProject.id,
  createdAt: '2026-01-03T00:00:00.000Z',
  kind: 'replace-before-import',
  definition: sampleProject.working,
}

/** 建立一个真正的 version=3 数据库（V2.0 实际发布版本），并写入四类旧数据。 */
function createV3Database(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PROJECT_DB_NAME, 3)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore(PROJECT_STORE_NAME, { keyPath: 'id' })
      db.createObjectStore(DRAFT_STORE_NAME, { keyPath: 'projectId' })
      db.createObjectStore(MAPPING_TEMPLATE_STORE_NAME, { keyPath: 'id' })
      const snapshots = db.createObjectStore(IMPORT_SNAPSHOT_STORE_NAME, {
        keyPath: 'id',
      })
      snapshots.createIndex('projectId', 'projectId')
    }
    request.onerror = () => reject(request.error ?? new Error('open v3 failed'))
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction(
        [
          PROJECT_STORE_NAME,
          DRAFT_STORE_NAME,
          MAPPING_TEMPLATE_STORE_NAME,
          IMPORT_SNAPSHOT_STORE_NAME,
        ],
        'readwrite',
      )
      transaction.objectStore(PROJECT_STORE_NAME).put(sampleProject)
      transaction.objectStore(DRAFT_STORE_NAME).put(sampleDraft)
      transaction
        .objectStore(MAPPING_TEMPLATE_STORE_NAME)
        .put(sampleTemplate)
      transaction
        .objectStore(IMPORT_SNAPSHOT_STORE_NAME)
        .put(sampleImportSnapshot)
      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('seed v3 failed'))
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('seed v3 aborted'))
    }
  })
}

interface OldStoreData {
  project: unknown
  draft: unknown
  template: unknown
  snapshot: unknown
}

/** 从连接里按原始记录读取四类旧数据，不经过任何解析层。 */
function readOldStoresFromConnection(db: IDBDatabase): Promise<OldStoreData> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [
        PROJECT_STORE_NAME,
        DRAFT_STORE_NAME,
        MAPPING_TEMPLATE_STORE_NAME,
        IMPORT_SNAPSHOT_STORE_NAME,
      ],
      'readonly',
    )
    const project = transaction
      .objectStore(PROJECT_STORE_NAME)
      .get(sampleProject.id)
    const draft = transaction.objectStore(DRAFT_STORE_NAME).get(sampleProject.id)
    const template = transaction
      .objectStore(MAPPING_TEMPLATE_STORE_NAME)
      .get(sampleTemplate.id)
    const snapshot = transaction
      .objectStore(IMPORT_SNAPSHOT_STORE_NAME)
      .get(sampleImportSnapshot.id)
    transaction.oncomplete = () => {
      resolve({
        project: project.result,
        draft: draft.result,
        template: template.result,
        snapshot: snapshot.result,
      })
    }
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('read old stores failed'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('read old stores aborted'))
  })
}

describe('数据库迁移：V2.0 的真实 v3 库升级到 v6', () => {
  it('四类旧数据逐字段不变，只新增来源/绑定 store 与索引，新表为空', async () => {
    await createV3Database()

    const before = await readDatabaseMeta()
    expect(before.version).toBe(3)
    expect(before.stores.slice().sort()).toEqual(
      [
        DRAFT_STORE_NAME,
        IMPORT_SNAPSHOT_STORE_NAME,
        MAPPING_TEMPLATE_STORE_NAME,
        PROJECT_STORE_NAME,
      ].sort(),
    )

    const { value: db, calls } = await recordOpenCalls(() => openDatabase())
    expect(calls.map((call) => call.version)).toEqual([6])
    expect(calls[0].upgrades).toEqual([{ oldVersion: 3, newVersion: 6 }])
    expect(db.version).toBe(PROJECT_DB_VERSION)
    expect(Array.from(db.objectStoreNames).sort()).toEqual(
      ALL_STORES.slice().sort(),
    )

    const oldData = await readOldStoresFromConnection(db)
    expect(oldData.project).toEqual(sampleProject)
    expect(oldData.draft).toEqual(sampleDraft)
    expect(oldData.template).toEqual(sampleTemplate)
    expect(oldData.snapshot).toEqual(sampleImportSnapshot)

    // 新 store 只建结构，不写入任何占位记录。
    const sourceTransaction = db.transaction(
      [
        SOURCE_DOCUMENT_STORE_NAME,
        SOURCE_REVISION_STORE_NAME,
        SOURCE_BLOB_STORE_NAME,
        BINDING_STORE_NAME,
        EVENT_STORE_NAME,
      ],
      'readonly',
    )
    expect(
      await requestResult(
        sourceTransaction.objectStore(SOURCE_DOCUMENT_STORE_NAME).count(),
      ),
    ).toBe(0)
    expect(
      await requestResult(
        sourceTransaction.objectStore(SOURCE_REVISION_STORE_NAME).count(),
      ),
    ).toBe(0)
    expect(
      await requestResult(
        sourceTransaction.objectStore(SOURCE_BLOB_STORE_NAME).count(),
      ),
    ).toBe(0)
    expect(
      await requestResult(sourceTransaction.objectStore(BINDING_STORE_NAME).count()),
    ).toBe(0)
    expect(
      await requestResult(sourceTransaction.objectStore(EVENT_STORE_NAME).count()),
    ).toBe(0)
    expect(
      sourceTransaction
        .objectStore(SOURCE_DOCUMENT_STORE_NAME)
        .indexNames.contains('projectId'),
    ).toBe(true)
    expect(
      sourceTransaction
        .objectStore(SOURCE_REVISION_STORE_NAME)
        .indexNames.contains('projectId') &&
        sourceTransaction
          .objectStore(SOURCE_REVISION_STORE_NAME)
          .indexNames.contains('documentId'),
    ).toBe(true)
    expect(
      sourceTransaction
        .objectStore(SOURCE_BLOB_STORE_NAME)
        .indexNames.contains('projectId'),
    ).toBe(true)
    db.close()

    expect((await readDatabaseMeta()).version).toBe(6)
  })

  it('已升级到 v6 的库重复打开不会再次触发升级', async () => {
    await createV3Database()

    const first = await recordOpenCalls(() => openDatabase())
    expect(first.calls[0].upgrades).toEqual([{ oldVersion: 3, newVersion: 6 }])
    first.value.close()

    const second = await recordOpenCalls(() => openDatabase())
    expect(second.calls.map((call) => call.version)).toEqual([6])
    expect(second.calls[0].upgrades).toEqual([])
    expect(second.value.version).toBe(6)
    second.value.close()
  })
})

const sampleSourceDocument = {
  id: 'doc-v4',
  projectId: sampleProject.id,
  title: 'V4 图纸.pdf',
  latestRevisionId: 'rev-v4',
}

const sampleSourceRevision = {
  id: 'rev-v4',
  projectId: sampleProject.id,
  documentId: sampleSourceDocument.id,
  fileName: 'V4 图纸.pdf',
  sha256: 'a'.repeat(64),
  byteSize: 5,
  pageCount: 2,
  createdAt: '2026-11-07T00:00:00.000Z',
  blobKey: 'blob-v4',
}

/** 建立一个真正的 version=4 数据库（V2.1 第一组实际发布版本）。 */
function createV4Database(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PROJECT_DB_NAME, 4)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore(PROJECT_STORE_NAME, { keyPath: 'id' })
      db.createObjectStore(DRAFT_STORE_NAME, { keyPath: 'projectId' })
      db.createObjectStore(MAPPING_TEMPLATE_STORE_NAME, { keyPath: 'id' })
      const snapshots = db.createObjectStore(IMPORT_SNAPSHOT_STORE_NAME, {
        keyPath: 'id',
      })
      snapshots.createIndex('projectId', 'projectId')
      const documents = db.createObjectStore(SOURCE_DOCUMENT_STORE_NAME, {
        keyPath: 'id',
      })
      documents.createIndex('projectId', 'projectId')
      const revisions = db.createObjectStore(SOURCE_REVISION_STORE_NAME, {
        keyPath: 'id',
      })
      revisions.createIndex('projectId', 'projectId')
      revisions.createIndex('documentId', 'documentId')
      const blobs = db.createObjectStore(SOURCE_BLOB_STORE_NAME, {
        keyPath: 'blobKey',
      })
      blobs.createIndex('projectId', 'projectId')
    }
    request.onerror = () => reject(request.error ?? new Error('open v4 failed'))
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction(
        [
          PROJECT_STORE_NAME,
          DRAFT_STORE_NAME,
          MAPPING_TEMPLATE_STORE_NAME,
          IMPORT_SNAPSHOT_STORE_NAME,
          SOURCE_DOCUMENT_STORE_NAME,
          SOURCE_REVISION_STORE_NAME,
          SOURCE_BLOB_STORE_NAME,
        ],
        'readwrite',
      )
      transaction.objectStore(PROJECT_STORE_NAME).put(sampleProject)
      transaction.objectStore(DRAFT_STORE_NAME).put(sampleDraft)
      transaction
        .objectStore(MAPPING_TEMPLATE_STORE_NAME)
        .put(sampleTemplate)
      transaction
        .objectStore(IMPORT_SNAPSHOT_STORE_NAME)
        .put(sampleImportSnapshot)
      transaction.objectStore(SOURCE_DOCUMENT_STORE_NAME).put(sampleSourceDocument)
      transaction.objectStore(SOURCE_REVISION_STORE_NAME).put(sampleSourceRevision)
      transaction.objectStore(SOURCE_BLOB_STORE_NAME).put({
        blobKey: 'blob-v4',
        projectId: sampleProject.id,
        sha256: sampleSourceRevision.sha256,
        byteSize: 5,
        blob: new Blob([new Uint8Array([37, 80, 68, 70, 45])]),
      })
      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('seed v4 failed'))
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('seed v4 aborted'))
    }
  })
}

describe('数据库迁移：V2.1 第一组的真实 v4 库升级到 v6', () => {
  it('项目/草稿/模板/快照/来源记录与 Blob 字节逐字段不变，只增补 bindings / events / migrationBackups', async () => {
    const v4BlobBytes = [37, 80, 68, 70, 45]
    await createV4Database()
    const before = await readDatabaseMeta()
    expect(before.version).toBe(4)
    expect(before.stores).not.toContain(BINDING_STORE_NAME)
    expect(before.stores).not.toContain(EVENT_STORE_NAME)
    // 升级前先按 v4 读出全部数据，作为“逐字段不变”的基线。
    const beforeDb = await openDatabase({ version: 4 })
    const beforeData = await readV4Stores(beforeDb)
    const beforeBlobBytes = await readBlobBytes(beforeDb, 'blob-v4')
    expect(beforeBlobBytes).toEqual(v4BlobBytes)
    beforeDb.close()

    const { value: db, calls } = await recordOpenCalls(() => openDatabase())
    expect(calls.map((call) => call.version)).toEqual([6])
    expect(calls[0].upgrades).toEqual([{ oldVersion: 4, newVersion: 6 }])
    expect(db.version).toBe(PROJECT_DB_VERSION)
    expect(Array.from(db.objectStoreNames).sort()).toEqual(ALL_STORES.slice().sort())

    const afterData = await readV4Stores(db)
    const afterBlobBytes = await readBlobBytes(db, 'blob-v4')

    // 逐字段深比较：项目、草稿、映射模板、替换前快照、来源文档、来源版本。
    expect(afterData.project).toEqual(beforeData.project)
    expect(afterData.project).toEqual(sampleProject)
    expect(afterData.draft).toEqual(beforeData.draft)
    expect(afterData.draft).toEqual(sampleDraft)
    expect(afterData.template).toEqual(sampleTemplate)
    expect(afterData.snapshot).toEqual(sampleImportSnapshot)
    expect(afterData.document).toEqual(sampleSourceDocument)
    expect(afterData.revision).toEqual(sampleSourceRevision)
    // Blob 的字节内容与升级前完全一致，而不只是“结构还在”。
    expect(afterBlobBytes).toEqual(beforeBlobBytes)
    expect(afterBlobBytes).toEqual(v4BlobBytes)
    expect(afterData.blob).toMatchObject({
      blobKey: 'blob-v4',
      projectId: sampleProject.id,
      sha256: sampleSourceRevision.sha256,
      byteSize: 5,
    })

    // 新 store 只建结构，不写入任何占位记录。
    const newStores = db.transaction(
      [BINDING_STORE_NAME, EVENT_STORE_NAME],
      'readonly',
    )
    expect(
      await requestResult(newStores.objectStore(BINDING_STORE_NAME).count()),
    ).toBe(0)
    expect(
      await requestResult(newStores.objectStore(EVENT_STORE_NAME).count()),
    ).toBe(0)
    const bindingStore = newStores.objectStore(BINDING_STORE_NAME)
    expect(bindingStore.keyPath).toBe('id')
    expect(Array.from(bindingStore.indexNames).sort()).toEqual([
      'projectId',
      'revisionId',
      'termId',
    ])
    const eventStore = newStores.objectStore(EVENT_STORE_NAME)
    expect(eventStore.keyPath).toBe('id')
    expect(Array.from(eventStore.indexNames).sort()).toEqual([
      'createdAt',
      'projectId',
    ])
    db.close()

    expect((await readDatabaseMeta()).version).toBe(6)
  })
})

interface V4StoreData {
  project: unknown
  draft: unknown
  template: unknown
  snapshot: unknown
  document: unknown
  revision: unknown
  blob: unknown
}

/** 用同一条连接读出 v4/v5 共有的六类记录与 Blob 记录。 */
function readV4Stores(db: IDBDatabase): Promise<V4StoreData> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [
        PROJECT_STORE_NAME,
        DRAFT_STORE_NAME,
        MAPPING_TEMPLATE_STORE_NAME,
        IMPORT_SNAPSHOT_STORE_NAME,
        SOURCE_DOCUMENT_STORE_NAME,
        SOURCE_REVISION_STORE_NAME,
        SOURCE_BLOB_STORE_NAME,
      ],
      'readonly',
    )
    const project = transaction
      .objectStore(PROJECT_STORE_NAME)
      .get(sampleProject.id)
    const draft = transaction.objectStore(DRAFT_STORE_NAME).get(sampleProject.id)
    const template = transaction
      .objectStore(MAPPING_TEMPLATE_STORE_NAME)
      .get(sampleTemplate.id)
    const snapshot = transaction
      .objectStore(IMPORT_SNAPSHOT_STORE_NAME)
      .get(sampleImportSnapshot.id)
    const document = transaction
      .objectStore(SOURCE_DOCUMENT_STORE_NAME)
      .get('doc-v4')
    const revision = transaction
      .objectStore(SOURCE_REVISION_STORE_NAME)
      .get('rev-v4')
    const blob = transaction.objectStore(SOURCE_BLOB_STORE_NAME).get('blob-v4')
    transaction.oncomplete = () => {
      resolve({
        project: project.result,
        draft: draft.result,
        template: template.result,
        snapshot: snapshot.result,
        document: document.result,
        revision: revision.result,
        blob: blob.result,
      })
    }
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('读取 v4 数据失败'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('读取 v4 数据已取消'))
  })
}

/** 直接读取 Blob 字节；切到 node 环境后 fake-indexeddb 会保留真正的 Blob。 */
function readBlobBytes(db: IDBDatabase, blobKey: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SOURCE_BLOB_STORE_NAME, 'readonly')
    const request = transaction.objectStore(SOURCE_BLOB_STORE_NAME).get(blobKey)
    request.onsuccess = () => {
      const record = request.result as { blob?: Blob } | undefined
      if (record?.blob === undefined) {
        reject(new Error('Blob 记录不存在'))
        return
      }
      void record.blob
        .arrayBuffer()
        .then((buffer) => resolve(Array.from(new Uint8Array(buffer))))
        .catch(reject)
    }
    request.onerror = () => reject(request.error ?? new Error('读取 Blob 失败'))
  })
}

describe('数据库版本与阻塞', () => {
  it('库升到 v5 后，指定 version=4 的旧前端打开得到明确的 VersionError 提示', async () => {
    const current = await openDatabase()
    expect(current.version).toBe(6)
    current.close()

    let rejection: unknown
    try {
      await openDatabase({ version: 4 })
    } catch (error) {
      rejection = error
    }
    expect(rejection).toBeDefined()
    expect(databaseErrorCode(rejection)).toBe('database_too_new')
    const message = rejection instanceof Error ? rejection.message : ''
    expect(message).toContain('v4')
    expect(message).toContain('刷新页面')
    // 明确禁止删库降级这一错误处置。
    expect(message).toContain('不要删除数据库或降级')
  })

  it('其它标签页升级时，本页收到 versionchange 后自动关闭旧连接并通知 UI', async () => {
    const holder = await openDatabase()
    const seen: { oldVersion: number; newVersion: number | null }[] = []
    const unsubscribe = subscribeDatabaseVersionChange((info) => {
      seen.push(info)
    })

    try {
      // 新页面升级；旧连接若不自关会 blocked。实现应自动关闭并 resolve。
      const upgraded = await openDatabase({ version: PROJECT_DB_VERSION + 1 })
      expect(upgraded.version).toBe(PROJECT_DB_VERSION + 1)
      upgraded.close()
    } finally {
      unsubscribe()
    }

    expect(seen).toEqual([
      { oldVersion: PROJECT_DB_VERSION, newVersion: PROJECT_DB_VERSION + 1 },
    ])
    // holder 已由 versionchange 处理器关闭；再关闭一次是幂等的。
    holder.close()

    const deleted = await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(PROJECT_DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('删除失败'))
      request.onblocked = () => reject(new Error('versionchange 未关闭旧连接'))
    })
    expect(deleted).toBeUndefined()
  })

  it('blocked 明确报失败；旧页面关闭后升级仍完成，迟到连接被关闭且数据完好', async () => {
    // 先建立当前版本的库，后续原始连接只“占住”它，不触发升级。
    const setup = await openDatabase()
    setup.close()

    // 用原始 IDB 连接模拟“旧版本客户端”：它没有 versionchange 处理器，
    // 不会主动关闭，因此新页面升级会先收到 blocked。
    const holder = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(PROJECT_DB_NAME, PROJECT_DB_VERSION)
      request.onupgradeneeded = () => reject(new Error('不应创建新库'))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开旧连接失败'))
    })

    const blocked = openDatabase({ version: PROJECT_DB_VERSION + 1 })
    let blockedError: unknown
    try {
      await blocked
    } catch (error) {
      blockedError = error
    }
    expect(blockedError).toBeDefined()
    expect(databaseErrorCode(blockedError)).toBe('database_blocked')
    const blockedMessage =
      blockedError instanceof Error ? blockedError.message : ''
    expect(blockedMessage).toContain('关闭或刷新其它标签页')
    expect(blockedMessage).toContain('升级仍会继续')

    // 旧页面关闭后，之前报 blocked 的请求仍会完成升级；实现必须关闭这条
    // 没人接收的迟到连接，否则 deleteDatabase 会再次被 blocked。
    holder.close()
    await new Promise((resolve) => setTimeout(resolve, 100))

    const upgraded = await openDatabase({ version: PROJECT_DB_VERSION + 1 })
    expect(upgraded.version).toBe(PROJECT_DB_VERSION + 1)
    expect(Array.from(upgraded.objectStoreNames).sort()).toEqual(
      ALL_STORES.slice().sort(),
    )
    upgraded.close()

    const deleted = await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(PROJECT_DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('删除失败'))
      request.onblocked = () =>
        reject(new Error('打开请求泄漏了连接：deleteDatabase 被 blocked'))
    })
    expect(deleted).toBeUndefined()
  })
})
