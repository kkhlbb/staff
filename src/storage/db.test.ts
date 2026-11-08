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
  openDatabase,
} from './db'
import { getDraft, getProject, listProjects } from './projects'

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
  it('有数据的 v1 库升级到 v2 后 projects / drafts 完全不变', async () => {
    await createV1Database()

    const raw = await readV2Raw()
    expect(raw.project).toEqual(sampleProject)
    expect(raw.draft).toEqual(sampleDraft)

    // 再由当前代码（v3）打开同一个库：只会补缺失 store，不重建、不清空。
    const db = await openDatabase()
    expect(db.version).toBe(PROJECT_DB_VERSION)
    expect(db.version).toBeGreaterThanOrEqual(3)
    expect(Array.from(db.objectStoreNames).sort()).toEqual(
      [
        DRAFT_STORE_NAME,
        IMPORT_SNAPSHOT_STORE_NAME,
        MAPPING_TEMPLATE_STORE_NAME,
        PROJECT_STORE_NAME,
      ].sort(),
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
