// @vitest-environment node
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChainDefinition } from '../domain/types'
import { parseMm } from '../domain/units'
import { createSourceBinding } from '../sources/bindings'
import { importSourceRevision } from '../sources/revisions'
import type { SourceDocument, SourceRevision } from '../sources/types'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import { deleteProjectDatabase } from '../test/projectDb'
import type { WorkspaceDraft } from '../workspace/draft'
import {
  BINDING_STORE_NAME,
  DRAFT_STORE_NAME,
  EVENT_STORE_NAME,
  IMPORT_SNAPSHOT_STORE_NAME,
  PROJECT_STORE_NAME,
  SOURCE_BLOB_STORE_NAME,
  SOURCE_DOCUMENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
  openDatabase,
  requestResult,
  transactionDone,
} from './db'
import {
  createProject,
  deleteProject,
  saveDraft,
  type ImportSnapshot,
} from './projects'

/**
 * 只验证“删除事务失败必须整体回滚”。这里用同步 throw 注入，因为它正是
 * transaction.abort() 缺失时不会被 IndexedDB 自动取消的路径：已排队的 put
 * 仍会随事务自动提交，形成“删除报失败、部分来源已退役”。
 */

const chain: ChainDefinition = {
  terms: [
    {
      id: 't-h',
      symbol: 'H',
      name: '孔',
      nominalQ: parseMm('100'),
      lowerDeviationQ: parseMm('0'),
      upperDeviationQ: parseMm('0.1'),
      sign: 1,
      sourceNote: '',
      termRevision: 1,
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
      termRevision: 1,
    },
  ],
  target: { minQ: parseMm('0.05'), maxQ: parseMm('0.2') },
  assumptions: '',
}

function draftFromChain(source: ChainDefinition): WorkspaceDraft {
  return {
    terms: source.terms.map((term) => ({
      id: term.id,
      symbol: term.symbol,
      name: term.name,
      nominal: '100.0000',
      lower: '0.0000',
      upper: '0.1000',
      sign: term.sign,
      sourceNote: term.sourceNote,
      termRevision: 1,
    })),
    targetMin: '0.05',
    targetMax: '0.2',
    relationRevision: 0,
    assumptions: '',
  }
}

interface StoreSnapshot {
  project: unknown
  draft: unknown
  snapshots: ImportSnapshot[]
  documents: SourceDocument[]
  revisions: SourceRevision[]
  blobs: { blobKey: string; projectId: string; sha256: string; byteSize: number; bytes: number[] }[]
  bindings: unknown[]
  events: unknown[]
}

/** 直接读原始 store，不经过公开查询 API，避免“查询刚好也按旧作用域过滤”。 */
async function readStores(projectId: string): Promise<StoreSnapshot> {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(
      [
        PROJECT_STORE_NAME,
        DRAFT_STORE_NAME,
        IMPORT_SNAPSHOT_STORE_NAME,
        SOURCE_DOCUMENT_STORE_NAME,
        SOURCE_REVISION_STORE_NAME,
        SOURCE_BLOB_STORE_NAME,
        BINDING_STORE_NAME,
        EVENT_STORE_NAME,
      ],
      'readonly',
    )
    const done = transactionDone(transaction)
    const project = await requestResult(
      transaction.objectStore(PROJECT_STORE_NAME).get(projectId),
    )
    const draft = await requestResult(
      transaction.objectStore(DRAFT_STORE_NAME).get(projectId),
    )
    const snapshots = (await requestResult(
      transaction
        .objectStore(IMPORT_SNAPSHOT_STORE_NAME)
        .index('projectId')
        .getAll(projectId),
    )) as ImportSnapshot[]
    const documents = (await requestResult(
      transaction
        .objectStore(SOURCE_DOCUMENT_STORE_NAME)
        .index('projectId')
        .getAll(projectId),
    )) as SourceDocument[]
    const revisions = (await requestResult(
      transaction
        .objectStore(SOURCE_REVISION_STORE_NAME)
        .index('projectId')
        .getAll(projectId),
    )) as SourceRevision[]
    const blobRecords = (await requestResult(
      transaction
        .objectStore(SOURCE_BLOB_STORE_NAME)
        .index('projectId')
        .getAll(projectId),
    )) as { blobKey: string; projectId: string; sha256: string; byteSize: number; blob: Blob }[]
    const bindings = await requestResult(
      transaction.objectStore(BINDING_STORE_NAME).index('projectId').getAll(projectId),
    )
    const events = await requestResult(
      transaction.objectStore(EVENT_STORE_NAME).index('projectId').getAll(projectId),
    )
    const blobs = await Promise.all(
      blobRecords.map(async (record) => ({
        blobKey: record.blobKey,
        projectId: record.projectId,
        sha256: record.sha256,
        byteSize: record.byteSize,
        bytes: Array.from(new Uint8Array(await record.blob.arrayBuffer())),
      })),
    )
    await done
    return {
      project,
      draft,
      snapshots,
      documents,
      revisions,
      blobs,
      bindings,
      events,
    }
  } finally {
    db.close()
  }
}

beforeEach(async () => {
  await deleteProjectDatabase()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await deleteProjectDatabase()
})

describe('删除项目的故障回滚', () => {
  it('退役写入同步抛错：显式 abort，项目/草稿/快照/来源/绑定/事件全部回到删除前', async () => {
    const created = await createProject({ name: '删除回滚项目', working: chain })
    expect(created.ok).toBe(true)
    if (!created.ok) {
      throw new Error(`${created.error.code}: ${created.error.message}`)
    }
    const projectId = created.value.id

    const savedDraft = await saveDraft(projectId, draftFromChain(chain), {
      snapshotBefore: 'replace',
    })
    expect(savedDraft.ok).toBe(true)

    const imported = await importSourceRevision({
      projectId,
      fileName: '删除回滚.pdf',
      bytes: buildSyntheticPdf({ pageCount: 2 }),
    })
    expect(imported.ok).toBe(true)
    if (!imported.ok) {
      throw new Error(imported.error.message)
    }

    const bound = await createSourceBinding({
      projectId,
      termId: 't-h',
      revisionId: imported.value.revision.id,
      page: 2,
      rectPdf: [50, 60, 250, 460],
      pageBoxPdf: [0, 0, 600, 800],
      note: '删除回滚绑定',
    })
    expect(bound.ok).toBe(true)

    const before = await readStores(projectId)
    expect(before.project).toBeTruthy()
    expect(before.draft).toBeTruthy()
    expect(before.snapshots).toHaveLength(1)
    expect(before.documents).toHaveLength(1)
    expect(before.revisions).toHaveLength(1)
    expect(before.blobs).toHaveLength(1)
    expect(before.bindings).toHaveLength(1)
    expect(before.events.length).toBeGreaterThanOrEqual(2)

    // 在来源文档 put 已排队之后、来源版本 put 时同步抛错。
    const originalPut = IDBObjectStore.prototype.put
    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (this.name === SOURCE_REVISION_STORE_NAME) {
          throw new DOMException('注入的同步写入异常', 'DataError')
        }
        return originalPut.call(this, value as never, key)
      })

    const deleted = await deleteProject(projectId)
    expect(putSpy).toHaveBeenCalled()
    expect(deleted.ok).toBe(false)
    if (!deleted.ok) {
      expect(deleted.error.message).toContain('删除项目失败')
    }

    const after = await readStores(projectId)
    // 逐 store 深比较：项目、草稿、快照、来源（文档/版本/Blob 字节）、绑定、事件。
    expect(after).toEqual(before)
    // 再显式核对作用域键没有进入 retired，也没有被部分改写。
    expect((after.project as { id: string }).id).toBe(projectId)
    expect(after.documents[0].projectId).toBe(projectId)
    expect(after.revisions[0].projectId).toBe(projectId)
    expect(after.blobs[0].projectId).toBe(projectId)
    expect((after.bindings[0] as { projectId: string }).projectId).toBe(projectId)
    expect((after.events[0] as { projectId: string }).projectId).toBe(projectId)
  })
})
