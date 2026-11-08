// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChainDefinition } from '../domain/types'
import { parseMm } from '../domain/units'
import {
  DRAFT_STORE_NAME,
  IMPORT_SNAPSHOT_STORE_NAME,
  MAPPING_TEMPLATE_STORE_NAME,
  PROJECT_STORE_NAME,
  SOURCE_BLOB_STORE_NAME,
  SOURCE_DOCUMENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
  requestResult,
  transactionDone,
  withDatabase,
} from '../storage/db'
import { createProject } from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import { sha256Hex } from './hash'
import {
  DEFAULT_SOURCE_LIMITS,
  SOURCE_FILE_MAX_BYTES,
  SOURCE_PAGE_MAX,
  SOURCE_PROJECT_MAX_BYTES,
  exceedsFileLimit,
  exceedsPageLimit,
  exceedsProjectLimit,
} from './limits'
import { inspectPdfBytes, type PdfModuleLike } from './pdfInspect'
import {
  getSourceBlob,
  getSourceDocument,
  getSourceRevision,
  importSourceRevision,
  listSourceDocuments,
  listSourceRevisions,
  readSourceBlobBytes,
  sumRevisionBytes,
} from './revisions'
import type { StorageCapacity } from './types'

const sampleChain: ChainDefinition = {
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
  target: null,
  assumptions: '',
  relationConfirmed: false,
}

const FIXED_NOW = '2026-11-08T03:00:00.000Z'

function unsupportedCapacity(): Promise<StorageCapacity> {
  return Promise.resolve({
    supported: false,
    usageBytes: null,
    quotaBytes: null,
    availableBytes: null,
    note: '测试环境不支持容量估算',
  })
}

function idSequence(ids: string[]): () => string {
  let index = 0
  return () => {
    const id = ids[index]
    if (id === undefined) {
      throw new Error(`ID 序列不足：需要第 ${index + 1} 个 ID`)
    }
    index += 1
    return id
  }
}

async function createTestProject(): Promise<string> {
  const created = await createProject({ name: '来源测试项目', working: sampleChain })
  expect(created.ok).toBe(true)
  if (!created.ok) {
    throw new Error(created.error.message)
  }
  return created.value.id
}

async function countStore(storeName: string): Promise<number> {
  return withDatabase(async (db) => {
    const transaction = db.transaction(storeName, 'readonly')
    const done = transactionDone(transaction)
    const count = await requestResult(transaction.objectStore(storeName).count())
    await done
    return count
  })
}

interface StoreCounts {
  projects: number
  drafts: number
  templates: number
  importSnapshots: number
  documents: number
  revisions: number
  blobs: number
}

async function storeCounts(): Promise<StoreCounts> {
  return {
    projects: await countStore(PROJECT_STORE_NAME),
    drafts: await countStore(DRAFT_STORE_NAME),
    templates: await countStore(MAPPING_TEMPLATE_STORE_NAME),
    importSnapshots: await countStore(IMPORT_SNAPSHOT_STORE_NAME),
    documents: await countStore(SOURCE_DOCUMENT_STORE_NAME),
    revisions: await countStore(SOURCE_REVISION_STORE_NAME),
    blobs: await countStore(SOURCE_BLOB_STORE_NAME),
  }
}

beforeEach(async () => {
  await deleteProjectDatabase()
})

describe('产品限额（集中配置）', () => {
  it('单文件 20 MiB、单文档 100 页、单项目 100 MiB', () => {
    expect(SOURCE_FILE_MAX_BYTES).toBe(20 * 1024 * 1024)
    expect(SOURCE_PAGE_MAX).toBe(100)
    expect(SOURCE_PROJECT_MAX_BYTES).toBe(100 * 1024 * 1024)
    expect(exceedsFileLimit(SOURCE_FILE_MAX_BYTES)).toBe(false)
    expect(exceedsFileLimit(SOURCE_FILE_MAX_BYTES + 1)).toBe(true)
    expect(exceedsPageLimit(SOURCE_PAGE_MAX)).toBe(false)
    expect(exceedsPageLimit(SOURCE_PAGE_MAX + 1)).toBe(true)
    expect(exceedsProjectLimit(SOURCE_PROJECT_MAX_BYTES - 1, 1)).toBe(false)
    expect(exceedsProjectLimit(SOURCE_PROJECT_MAX_BYTES, 1)).toBe(true)
  })
})

describe('不可变来源版本', () => {
  it('导入真实合成 PDF：保存哈希、字节数、页数、Blob 与最新指针', async () => {
    const projectId = await createTestProject()
    const bytes = buildSyntheticPdf({ pageCount: 2, variant: 'A' })
    const expectedHash = await sha256Hex(bytes)

    const result = await importSourceRevision(
      { projectId, fileName: ' 图纸 A.pdf ', bytes },
      {
        newId: idSequence(['rev-1', 'doc-1', 'blob-1']),
        now: () => FIXED_NOW,
        estimateCapacity: unsupportedCapacity,
      },
    )

    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    expect(result.value.revision).toEqual({
      id: 'rev-1',
      projectId,
      documentId: 'doc-1',
      fileName: '图纸 A.pdf',
      sha256: expectedHash,
      byteSize: bytes.byteLength,
      pageCount: 2,
      createdAt: FIXED_NOW,
      blobKey: 'blob-1',
    })
    expect(result.value.document).toEqual({
      id: 'doc-1',
      projectId,
      title: '图纸 A.pdf',
      latestRevisionId: 'rev-1',
    })
    expect(result.value.storageCapacity.supported).toBe(false)
    expect(result.value.storageCapacity.note.length).toBeGreaterThan(0)

    const storedDocument = await getSourceDocument('doc-1')
    expect(storedDocument).toEqual({ ok: true, value: result.value.document })
    const storedRevision = await getSourceRevision('rev-1')
    expect(storedRevision).toEqual({ ok: true, value: result.value.revision })

    const storedBlob = await getSourceBlob('blob-1')
    expect(storedBlob.ok).toBe(true)
    if (storedBlob.ok && storedBlob.value !== null) {
      expect(storedBlob.value.sha256).toBe(expectedHash)
      expect(storedBlob.value.byteSize).toBe(bytes.byteLength)
    }
    const blobBytes = await readSourceBlobBytes('blob-1')
    expect(blobBytes.ok, blobBytes.ok ? '' : blobBytes.error.message).toBe(true)
    if (blobBytes.ok && blobBytes.value !== null) {
      expect(Array.from(blobBytes.value)).toEqual(Array.from(bytes))
    }
  })

  it('同名替换只新增 revision，不覆盖旧 revision / Blob，latestRevisionId 前移', async () => {
    const projectId = await createTestProject()
    const bytesA = buildSyntheticPdf({ pageCount: 2, variant: 'A' })
    const bytesB = buildSyntheticPdf({ pageCount: 2, variant: 'B' })

    const first = await importSourceRevision(
      { projectId, fileName: '同一名称.pdf', bytes: bytesA },
      {
        newId: idSequence(['rev-1', 'doc-1', 'blob-1']),
        estimateCapacity: unsupportedCapacity,
      },
    )
    expect(first.ok).toBe(true)
    if (!first.ok) {
      throw new Error(first.error.message)
    }

    const second = await importSourceRevision(
      {
        projectId,
        documentId: first.value.document.id,
        fileName: '同一名称.pdf',
        bytes: bytesB,
      },
      {
        newId: idSequence(['rev-2', 'unused-doc', 'blob-2']),
        estimateCapacity: unsupportedCapacity,
      },
    )
    expect(second.ok).toBe(true)
    if (!second.ok) {
      throw new Error(second.error.message)
    }

    expect(second.value.revision.id).toBe('rev-2')
    expect(second.value.revision.sha256).not.toBe(first.value.revision.sha256)
    expect(second.value.document.id).toBe(first.value.document.id)
    expect(second.value.document.latestRevisionId).toBe('rev-2')

    // 旧 record 与旧 Blob 都还在，内容未变。
    const oldRevision = await getSourceRevision('rev-1')
    expect(oldRevision).toEqual({ ok: true, value: first.value.revision })
    const oldBlob = await readSourceBlobBytes('blob-1')
    expect(oldBlob.ok).toBe(true)
    if (oldBlob.ok && oldBlob.value !== null) {
      expect(Array.from(oldBlob.value)).toEqual(Array.from(bytesA))
    }

    const revisions = await listSourceRevisions(projectId)
    expect(revisions.ok).toBe(true)
    if (revisions.ok) {
      expect(revisions.value).toHaveLength(2)
      expect(revisions.value.map((revision) => revision.id).sort()).toEqual([
        'rev-1',
        'rev-2',
      ])
    }
    expect(await countStore(SOURCE_DOCUMENT_STORE_NAME)).toBe(1)
    expect(await countStore(SOURCE_REVISION_STORE_NAME)).toBe(2)
    expect(await countStore(SOURCE_BLOB_STORE_NAME)).toBe(2)
  })

  it('文件名不作为唯一标识：同名文件不指定文档时各自建立文档', async () => {
    const projectId = await createTestProject()
    const bytes = buildSyntheticPdf({ pageCount: 2 })

    const first = await importSourceRevision(
      { projectId, fileName: '同名.pdf', bytes },
      {
        newId: idSequence(['rev-1', 'doc-1', 'blob-1']),
        estimateCapacity: unsupportedCapacity,
      },
    )
    const second = await importSourceRevision(
      { projectId, fileName: '同名.pdf', bytes },
      {
        newId: idSequence(['rev-2', 'doc-2', 'blob-2']),
        estimateCapacity: unsupportedCapacity,
      },
    )
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) {
      return
    }

    expect(first.value.document.id).not.toBe(second.value.document.id)
    const documents = await listSourceDocuments(projectId)
    expect(documents.ok).toBe(true)
    if (documents.ok) {
      expect(documents.value).toHaveLength(2)
      expect(documents.value.map((document) => document.title)).toEqual([
        '同名.pdf',
        '同名.pdf',
      ])
    }
  })

  it('替换到不存在或属于其它项目的文档时拒绝，且不写入', async () => {
    const projectId = await createTestProject()
    const bytes = buildSyntheticPdf({ pageCount: 2 })
    const before = await storeCounts()

    const result = await importSourceRevision(
      {
        projectId,
        documentId: 'missing-doc',
        fileName: '图纸.pdf',
        bytes,
      },
      { estimateCapacity: unsupportedCapacity },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('document_not_found')
    }
    expect(await storeCounts()).toEqual(before)
  })
})

describe('拒绝与失败路径', () => {
  it('超过 20 MiB 在解析前拒绝，不写任何 store', async () => {
    const projectId = await createTestProject()
    let inspections = 0
    const oversized = new Uint8Array(SOURCE_FILE_MAX_BYTES + 1)

    const result = await importSourceRevision(
      { projectId, fileName: '超大.pdf', bytes: oversized },
      {
        inspectPdf: async () => {
          inspections += 1
          return { pageCount: 1 }
        },
        estimateCapacity: unsupportedCapacity,
      },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('file_too_large')
      expect(result.error.message).toContain('20.0 MiB')
    }
    expect(inspections).toBe(0)
    expect(await countStore(SOURCE_REVISION_STORE_NAME)).toBe(0)
    expect(await countStore(SOURCE_BLOB_STORE_NAME)).toBe(0)
  })

  it('超过 100 页的真实 PDF 被拒绝，不写任何 store', async () => {
    const projectId = await createTestProject()
    const tooManyPages = buildSyntheticPdf({ pageCount: SOURCE_PAGE_MAX + 1 })

    const result = await importSourceRevision(
      { projectId, fileName: '一百零一页.pdf', bytes: tooManyPages },
      { estimateCapacity: unsupportedCapacity },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('too_many_pages')
      expect(result.error.message).toContain('101 页')
    }
    expect(await countStore(SOURCE_DOCUMENT_STORE_NAME)).toBe(0)
    expect(await countStore(SOURCE_REVISION_STORE_NAME)).toBe(0)
  })

  it('密码保护的 PDF 明确拒绝（PDF.js 错误注入，走真实映射路径）', async () => {
    const projectId = await createTestProject()
    const bytes = buildSyntheticPdf({ pageCount: 2 })
    const fakePdfModule: PdfModuleLike = {
      getDocument: () => ({
        promise: Promise.reject(
          Object.assign(new Error('No password given'), {
            name: 'PasswordException',
          }),
        ),
        destroy: () => Promise.resolve(),
      }),
    }

    const result = await importSourceRevision(
      { projectId, fileName: '加密.pdf', bytes },
      {
        inspectPdf: (input) => inspectPdfBytes(input, fakePdfModule),
        estimateCapacity: unsupportedCapacity,
      },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('password_protected')
      expect(result.error.message).toContain('密码')
    }
    expect(await countStore(SOURCE_REVISION_STORE_NAME)).toBe(0)
    expect(await countStore(SOURCE_BLOB_STORE_NAME)).toBe(0)
  })

  it('损坏文件由真实 PDF.js 解析失败拒绝', async () => {
    const projectId = await createTestProject()
    const corrupt = new TextEncoder().encode('%PDF-1.4\nthis is not a pdf')

    const result = await importSourceRevision(
      { projectId, fileName: '损坏.pdf', bytes: corrupt },
      { estimateCapacity: unsupportedCapacity },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_pdf')
    }
    expect(await countStore(SOURCE_DOCUMENT_STORE_NAME)).toBe(0)
    expect(await countStore(SOURCE_REVISION_STORE_NAME)).toBe(0)
  })

  it('哈希失败明确报错且不写入', async () => {
    const projectId = await createTestProject()
    const bytes = buildSyntheticPdf({ pageCount: 2 })

    const result = await importSourceRevision(
      { projectId, fileName: '图纸.pdf', bytes },
      {
        hashBytes: () => Promise.reject(new Error('注入哈希失败')),
        estimateCapacity: unsupportedCapacity,
      },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('hash_failed')
    }
    expect(await countStore(SOURCE_REVISION_STORE_NAME)).toBe(0)
  })

  it('估算可用空间不足时拒绝，不写任何 store', async () => {
    const projectId = await createTestProject()
    const bytes = buildSyntheticPdf({ pageCount: 2 })

    const result = await importSourceRevision(
      { projectId, fileName: '图纸.pdf', bytes },
      {
        estimateCapacity: () =>
          Promise.resolve({
            supported: true,
            usageBytes: 100,
            quotaBytes: 1000,
            availableBytes: 10,
            note: '测试估算',
          }),
      },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('insufficient_storage')
    }
    expect(await countStore(SOURCE_REVISION_STORE_NAME)).toBe(0)
  })

  it('项目总额度按保留的全部 revision 计算，超限拒绝且最新指针不变', async () => {
    const projectId = await createTestProject()
    const bytesA = buildSyntheticPdf({ pageCount: 2, variant: 'A' })
    const bytesB = buildSyntheticPdf({ pageCount: 2, variant: 'B' })
    const limits = {
      ...DEFAULT_SOURCE_LIMITS,
      maxProjectBytes: bytesA.byteLength + bytesB.byteLength - 1,
    }

    const first = await importSourceRevision(
      { projectId, fileName: '图纸.pdf', bytes: bytesA },
      {
        newId: idSequence(['rev-1', 'doc-1', 'blob-1']),
        estimateCapacity: unsupportedCapacity,
        limits,
      },
    )
    expect(first.ok).toBe(true)
    if (!first.ok) {
      throw new Error(first.error.message)
    }

    const second = await importSourceRevision(
      {
        projectId,
        documentId: first.value.document.id,
        fileName: '图纸.pdf',
        bytes: bytesB,
      },
      {
        newId: idSequence(['rev-2', 'unused', 'blob-2']),
        estimateCapacity: unsupportedCapacity,
        limits,
      },
    )
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.error.code).toBe('project_quota_exceeded')
    }

    const document = await getSourceDocument(first.value.document.id)
    expect(document).toEqual({ ok: true, value: first.value.document })
    const revisions = await listSourceRevisions(projectId)
    expect(revisions.ok).toBe(true)
    if (revisions.ok) {
      expect(revisions.value).toHaveLength(1)
      expect(sumRevisionBytes(revisions.value)).toBe(bytesA.byteLength)
    }
    expect(await countStore(SOURCE_BLOB_STORE_NAME)).toBe(1)
  })

  it('写入事务失败整体回滚：逐 store 前后一致，最新指针与旧 Blob 不变', async () => {
    const projectId = await createTestProject()
    const bytesA = buildSyntheticPdf({ pageCount: 2, variant: 'A' })
    const bytesB = buildSyntheticPdf({ pageCount: 2, variant: 'B' })

    const first = await importSourceRevision(
      { projectId, fileName: '图纸.pdf', bytes: bytesA },
      {
        newId: idSequence(['rev-1', 'doc-1', 'blob-1']),
        estimateCapacity: unsupportedCapacity,
      },
    )
    expect(first.ok).toBe(true)
    if (!first.ok) {
      throw new Error(first.error.message)
    }

    const before = await storeCounts()
    const originalAdd = IDBObjectStore.prototype.add
    let injected = false
    const patchedAdd: typeof IDBObjectStore.prototype.add = function add(
      this: IDBObjectStore,
      value,
      key,
    ) {
      if (!injected && this.name === SOURCE_BLOB_STORE_NAME) {
        injected = true
        throw new Error('注入 sourceBlobs 写入失败')
      }
      return originalAdd.call(this, value, key)
    }

    try {
      IDBObjectStore.prototype.add = patchedAdd
      const failed = await importSourceRevision(
        {
          projectId,
          documentId: first.value.document.id,
          fileName: '图纸.pdf',
          bytes: bytesB,
        },
        {
          newId: idSequence(['rev-2', 'unused', 'blob-2']),
          estimateCapacity: unsupportedCapacity,
        },
      )
      expect(failed.ok).toBe(false)
      if (!failed.ok) {
        expect(failed.error.code).toBe('storage_failure')
        expect(failed.error.message).toContain('现有版本与绑定未改变')
      }
    } finally {
      IDBObjectStore.prototype.add = originalAdd
    }

    expect(injected).toBe(true)
    expect(await storeCounts()).toEqual(before)
    const document = await getSourceDocument(first.value.document.id)
    expect(document).toEqual({ ok: true, value: first.value.document })
    const oldBlob = await readSourceBlobBytes('blob-1')
    expect(oldBlob.ok).toBe(true)
    if (oldBlob.ok && oldBlob.value !== null) {
      expect(Array.from(oldBlob.value)).toEqual(Array.from(bytesA))
    }
    // 失败事务里排队写入的 revision 不能留下。
    expect(await getSourceRevision('rev-2')).toEqual({ ok: true, value: null })
    expect(await countStore(SOURCE_BLOB_STORE_NAME)).toBe(1)
  })

  it('项目不存在时拒绝，不写任何来源记录', async () => {
    const bytes = buildSyntheticPdf({ pageCount: 2 })
    const result = await importSourceRevision(
      { projectId: 'missing-project', fileName: '图纸.pdf', bytes },
      { estimateCapacity: unsupportedCapacity },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('project_not_found')
    }
    expect(await countStore(SOURCE_DOCUMENT_STORE_NAME)).toBe(0)
  })
})
