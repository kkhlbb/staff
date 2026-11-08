// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Project } from '../domain/types'
import { parseMm } from '../domain/units'
import { deleteProjectDatabase } from '../test/projectDb'
import type { StoredDraft } from './projects'
import {
  DRAFT_STORE_NAME,
  IMPORT_SNAPSHOT_STORE_NAME,
  MAPPING_TEMPLATE_STORE_NAME,
  PROJECT_DB_NAME,
  PROJECT_DB_VERSION,
  PROJECT_STORE_NAME,
  SOURCE_BLOB_STORE_NAME,
  SOURCE_DOCUMENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
  openDatabase,
  requestResult,
} from './db'
import { getDraft, getProject, listProjects } from './projects'

const ALL_STORES = [
  DRAFT_STORE_NAME,
  IMPORT_SNAPSHOT_STORE_NAME,
  MAPPING_TEMPLATE_STORE_NAME,
  PROJECT_STORE_NAME,
  SOURCE_BLOB_STORE_NAME,
  SOURCE_DOCUMENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
]

const sampleProject: Project = {
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

const sampleDraft: StoredDraft = {
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

describe('数据库迁移：v1 数据在升级后保持不变', () => {
  it('有数据的 v1 库升级到当前版本后 projects / drafts 完全不变', async () => {
    await createV1Database()

    const raw = await readV2Raw()
    expect(raw.project).toEqual(sampleProject)
    expect(raw.draft).toEqual(sampleDraft)

    // 再由当前代码（v4）打开同一个库：只会补缺失 store，不重建、不清空。
    const db = await openDatabase()
    expect(db.version).toBe(PROJECT_DB_VERSION)
    expect(db.version).toBe(4)
    expect(Array.from(db.objectStoreNames).sort()).toEqual(
      ALL_STORES.slice().sort(),
    )
    db.close()

    expect(await getProject(sampleProject.id)).toEqual({
      ok: true,
      value: sampleProject,
    })
    expect(await getDraft(sampleProject.id)).toEqual({
      ok: true,
      value: sampleDraft,
    })
    const projects = await listProjects()
    expect(projects.ok).toBe(true)
    if (projects.ok) {
      expect(projects.value).toEqual([sampleProject])
    }
  })
})

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

describe('数据库迁移：真实老用户从 v1 直接打开 v4', () => {
  it('v1 库由当前代码一次性升级到 v4：同一次升级建出新 store，旧数据逐字段不变', async () => {
    await createV1Database()

    // 前提：库确实是 version=1，只有老用户就有的两个 store。
    const before = await readDatabaseMeta()
    expect(before.version).toBe(1)
    expect(before.stores.slice().sort()).toEqual(
      [DRAFT_STORE_NAME, PROJECT_STORE_NAME].slice().sort(),
    )

    // 当前代码（PROJECT_DB_VERSION=4）一次性打开：oldVersion=1、newVersion=4。
    const { value: db, calls } = await recordOpenCalls(() => openDatabase())

    expect(calls.map((call) => call.version)).toEqual([4])
    expect(calls[0].upgrades).toEqual([{ oldVersion: 1, newVersion: 4 }])

    expect(db.version).toBe(PROJECT_DB_VERSION)
    expect(db.version).toBe(4)
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

    // 老数据在升级后的同一条连接里逐字段比对（toEqual 是全字段深比较）。
    const raw = await readRawFromConnection(db)
    expect(raw.project).toEqual(sampleProject)
    expect(raw.draft).toEqual(sampleDraft)

    const stored = raw.project as Project
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

    // 再用公开 API 走一遍，确认读取路径同样拿到原值。
    expect(await getProject(sampleProject.id)).toEqual({
      ok: true,
      value: sampleProject,
    })
    expect(await getDraft(sampleProject.id)).toEqual({
      ok: true,
      value: sampleDraft,
    })
    const projects = await listProjects()
    expect(projects.ok).toBe(true)
    if (projects.ok) {
      expect(projects.value).toEqual([sampleProject])
    }
    expect((await readDatabaseMeta()).version).toBe(4)
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

describe('数据库迁移：V2.0 的真实 v3 库升级到 v4', () => {
  it('四类旧数据逐字段不变，只新增来源 store 与索引，新表为空', async () => {
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
    expect(calls.map((call) => call.version)).toEqual([4])
    expect(calls[0].upgrades).toEqual([{ oldVersion: 3, newVersion: 4 }])
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

    expect((await readDatabaseMeta()).version).toBe(4)
  })

  it('已升级到 v4 的库重复打开不会再次触发升级', async () => {
    await createV3Database()

    const first = await recordOpenCalls(() => openDatabase())
    expect(first.calls[0].upgrades).toEqual([{ oldVersion: 3, newVersion: 4 }])
    first.value.close()

    const second = await recordOpenCalls(() => openDatabase())
    expect(second.calls.map((call) => call.version)).toEqual([4])
    expect(second.calls[0].upgrades).toEqual([])
    expect(second.value.version).toBe(4)
    second.value.close()
  })
})
