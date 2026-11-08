// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChainDefinition } from '../domain/types'
import { parseMm } from '../domain/units'
import {
  BINDING_STORE_NAME,
  EVENT_STORE_NAME,
  SOURCE_BLOB_STORE_NAME,
  SOURCE_DOCUMENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
  requestResult,
  transactionDone,
  withDatabase,
} from '../storage/db'
import { createProject, deleteProject, getProject } from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import {
  countBindingsByTerm,
  createSourceBinding,
  getSourceBinding,
  listSourceBindings,
  listSourceBindingsForTerm,
  rebindSourceBinding,
  removeSourceBinding,
  reviewSourceBinding,
  updateSourceBindingRegion,
  validateBindingRegion,
  type CreateSourceBindingInput,
} from './bindings'
import {
  getSourceRevision,
  importSourceRevision,
  listSourceDocuments,
  listSourceRevisions,
  readSourceBlobBytes,
} from './revisions'
import type { SourceRevision, StorageCapacity } from './types'

const PAGE_BOX = [0, 0, 600, 800] as const
const RECT_A = [50, 60, 250, 460] as const
const RECT_B = [300, 100, 520, 500] as const

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
      sourceNote: '图纸备注 ≠ 来源绑定',
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
  target: null,
  assumptions: '',
}

function unsupportedCapacity(): Promise<StorageCapacity> {
  return Promise.resolve({
    supported: false,
    usageBytes: null,
    quotaBytes: null,
    availableBytes: null,
    note: '测试环境不支持容量估算',
  })
}

async function createTestProject(): Promise<string> {
  const created = await createProject({ name: '绑定测试项目', working: sampleChain })
  expect(created.ok).toBe(true)
  if (!created.ok) {
    throw new Error(created.error.message)
  }
  return created.value.id
}

async function importRevision(
  projectId: string,
  variant: string,
  fileName = '同一名称.pdf',
  documentId?: string,
): Promise<SourceRevision> {
  const imported = await importSourceRevision(
    { projectId, fileName, bytes: buildSyntheticPdf({ pageCount: 2, variant }), documentId },
    { estimateCapacity: unsupportedCapacity },
  )
  expect(imported.ok, imported.ok ? '' : imported.error.message).toBe(true)
  if (!imported.ok) {
    throw new Error(imported.error.message)
  }
  return imported.value.revision
}

function bindingInput(
  projectId: string,
  revisionId: string,
  overrides: Partial<CreateSourceBindingInput> = {},
): CreateSourceBindingInput {
  return {
    projectId,
    termId: 't-h',
    revisionId,
    page: 2,
    rectPdf: RECT_A,
    pageBoxPdf: PAGE_BOX,
    note: '第 2 页孔公差框',
    ...overrides,
  }
}

async function bindingCount(): Promise<number> {
  return withDatabase(async (db) => {
    const transaction = db.transaction(BINDING_STORE_NAME, 'readonly')
    const done = transactionDone(transaction)
    const count = await requestResult(
      transaction.objectStore(BINDING_STORE_NAME).count(),
    )
    await done
    return count
  })
}

beforeEach(async () => {
  await deleteProjectDatabase()
})

describe('来源绑定：多绑定与持久化', () => {
  it('同一组成环保存两个绑定：各自独立、按创建时间读取、不覆盖', async () => {
    const projectId = await createTestProject()
    const revision = await importRevision(projectId, 'A')

    const first = await createSourceBinding(
      bindingInput(projectId, revision.id, {
        page: 1,
        rectPdf: RECT_A,
        note: '第 1 页',
      }),
      { now: () => '2026-11-08T04:00:00.000Z', newId: () => 'bind-1' },
    )
    expect(first.ok, first.ok ? '' : first.error.message).toBe(true)

    const second = await createSourceBinding(
      bindingInput(projectId, revision.id, {
        page: 2,
        rectPdf: RECT_B,
        note: '第 2 页',
      }),
      { now: () => '2026-11-08T04:01:00.000Z', newId: () => 'bind-2' },
    )
    expect(second.ok, second.ok ? '' : second.error.message).toBe(true)

    const listed = await listSourceBindings(projectId)
    expect(listed.ok).toBe(true)
    if (!listed.ok) {
      throw new Error(listed.error.message)
    }
    expect(listed.value.map((binding) => binding.id)).toEqual(['bind-1', 'bind-2'])
    expect(listed.value.map((binding) => binding.page)).toEqual([1, 2])
    expect(listed.value.map((binding) => binding.rectPdf)).toEqual([RECT_A, RECT_B])
    expect(listed.value.map((binding) => binding.note)).toEqual(['第 1 页', '第 2 页'])
    expect(listed.value.every((binding) => binding.revisionId === revision.id)).toBe(true)
    expect(listed.value.every((binding) => binding.documentId === revision.documentId)).toBe(
      true,
    )

    const forTerm = await listSourceBindingsForTerm(projectId, 't-h')
    expect(forTerm.ok && forTerm.value).toHaveLength(2)
    const otherTerm = await listSourceBindingsForTerm(projectId, 't-b')
    expect(otherTerm.ok && otherTerm.value).toHaveLength(0)

    expect(countBindingsByTerm(listed.value)).toEqual({ 't-h': 2 })

    const reloaded = await getSourceBinding('bind-1')
    expect(reloaded).toEqual({ ok: true, value: listed.value[0] })
  })

  it('绑定与 revision 同项目校验：跨项目 revision 拒绝且不写入', async () => {
    const projectA = await createTestProject()
    const projectB = await createTestProject()
    const revisionB = await importRevision(projectB, 'A')

    const result = await createSourceBinding(bindingInput(projectA, revisionB.id))
    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('跨项目 revision 不应保存成功')
    }
    expect(result.error.code).toBe('revision_not_found')
    expect(await bindingCount()).toBe(0)
  })
})

describe('来源绑定：区域与页码校验', () => {
  it('越界、空区域、非有限数值与非法页码全部拒绝，已有绑定不变', async () => {
    const projectId = await createTestProject()
    const revision = await importRevision(projectId, 'A')

    const good = await createSourceBinding(bindingInput(projectId, revision.id))
    expect(good.ok).toBe(true)
    expect(await bindingCount()).toBe(1)

    const rejected: CreateSourceBindingInput[] = [
      bindingInput(projectId, revision.id, { rectPdf: [0, 0, 601, 400] }),
      bindingInput(projectId, revision.id, { rectPdf: [10, 10, 10, 40] }),
      bindingInput(projectId, revision.id, { rectPdf: [10, 10, Number.NaN, 40] }),
      bindingInput(projectId, revision.id, { page: 0 }),
      bindingInput(projectId, revision.id, { page: 3 }),
      bindingInput(projectId, revision.id, { page: 1.5 }),
      bindingInput(projectId, revision.id, { pageBoxPdf: [0, 0, 0, 800] }),
    ]

    for (const input of rejected) {
      const result = await createSourceBinding(input)
      expect(result.ok, JSON.stringify(input)).toBe(false)
      if (!result.ok) {
        expect(['invalid_region', 'invalid_input', 'page_out_of_range']).toContain(
          result.error.code,
        )
        expect(result.error.message.length).toBeGreaterThan(0)
      }
    }

    expect(await bindingCount()).toBe(1)
    const listed = await listSourceBindings(projectId)
    expect(listed.ok && listed.value[0].id).toBe(good.ok ? good.value.id : null)
  })

  it('validateBindingRegion 对贴边矩形接受，对越界/空区域给出明确原因', () => {
    expect(validateBindingRegion(PAGE_BOX, [0, 0, 600, 800])).toBeNull()
    expect(validateBindingRegion(PAGE_BOX, [0, 0, 600.01, 800])).toBe('矩形超出页面边界')
    expect(validateBindingRegion(PAGE_BOX, [20, 20, 20, 80])).toBe('矩形面积必须大于 0')
    expect(validateBindingRegion([0, 0, 0, 0], [0, 0, 1, 1])).toBe('页面边界无效')
  })

  it('page.view 非零原点：按真实四元组校验并原样保存，不假定 0..width', async () => {
    const projectId = await createTestProject()
    const revision = await importRevision(projectId, 'A')
    const pageBox = [100, 200, 700, 1000] as const

    const saved = await createSourceBinding(
      bindingInput(projectId, revision.id, {
        pageBoxPdf: pageBox,
        rectPdf: [650, 900, 690, 990],
        note: '非零原点页面',
      }),
    )
    expect(saved.ok, saved.ok ? '' : saved.error.message).toBe(true)
    if (!saved.ok) {
      throw new Error(saved.error.message)
    }
    expect(saved.value.pageBoxPdf).toEqual([100, 200, 700, 1000])
    expect(saved.value.rectPdf).toEqual([650, 900, 690, 990])

    // [0,0,10,10] 在原点 100/200 的页面上是越界的，必须拒绝。
    const rejected = await createSourceBinding(
      bindingInput(projectId, revision.id, {
        pageBoxPdf: pageBox,
        rectPdf: [0, 0, 10, 10],
      }),
    )
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      expect(rejected.error.code).toBe('invalid_region')
      expect(rejected.error.message).toBe('矩形超出页面边界')
    }
    expect(await bindingCount()).toBe(1)
  })
})

describe('来源绑定：不复制数值、不改项目', () => {
  it('绑定记录不含工程数值字段，创建前后 project.working 完全不变', async () => {
    const projectId = await createTestProject()
    const revision = await importRevision(projectId, 'A')
    const before = await getProject(projectId)
    expect(before.ok).toBe(true)

    const created = await createSourceBinding(bindingInput(projectId, revision.id))
    expect(created.ok, created.ok ? '' : created.error.message).toBe(true)
    if (!created.ok) {
      throw new Error(created.error.message)
    }

    expect(Object.keys(created.value).sort()).toEqual(
      [
        'createdAt',
        'documentId',
        'historicalAcceptance',
        'id',
        'note',
        'page',
        'pageBoxPdf',
        'projectId',
        'rectPdf',
        'revisionId',
        'reviewedAt',
        'reviewedTermRevision',
        'termId',
      ].sort(),
    )
    for (const forbidden of [
      'nominalQ',
      'lowerDeviationQ',
      'upperDeviationQ',
      'sign',
      'symbol',
      'name',
      'result',
    ]) {
      expect(created.value).not.toHaveProperty(forbidden)
    }

    const after = await getProject(projectId)
    expect(after.ok).toBe(true)
    if (!before.ok || !after.ok) {
      throw new Error('读取项目失败')
    }
    expect(after.value).toEqual(before.value)
  })

  it('same-name 新版本：旧 revision 上的绑定仍指向旧 revision，不跟随 latest 指针', async () => {
    const projectId = await createTestProject()
    const first = await importRevision(projectId, 'A', '同名.pdf')
    const second = await importRevision(projectId, 'B', '同名.pdf', first.documentId)
    expect(second.id).not.toBe(first.id)

    const created = await createSourceBinding(
      bindingInput(projectId, first.id, { page: 1, note: '旧版本上的区域' }),
    )
    expect(created.ok, created.ok ? '' : created.error.message).toBe(true)

    const listed = await listSourceBindings(projectId)
    expect(listed.ok).toBe(true)
    if (!listed.ok) {
      throw new Error(listed.error.message)
    }
    expect(listed.value).toHaveLength(1)
    expect(listed.value[0].revisionId).toBe(first.id)
    expect(listed.value[0].revisionId).not.toBe(second.id)

    const storedRevision = await getSourceRevision(listed.value[0].revisionId)
    expect(storedRevision.ok && storedRevision.value?.sha256).toBe(first.sha256)
    expect(storedRevision.ok && storedRevision.value?.sha256).not.toBe(second.sha256)
  })
})

describe('数据库升级到 v7', () => {
  it('bindings store 使用 id 主键并建立 projectId / termId / revisionId 索引', async () => {
    const projectId = await createTestProject()
    const revision = await importRevision(projectId, 'A')
    await createSourceBinding(bindingInput(projectId, revision.id))

    const meta = await withDatabase(async (db) => {
      const transaction = db.transaction(BINDING_STORE_NAME, 'readonly')
      const store = transaction.objectStore(BINDING_STORE_NAME)
      const info = {
        version: db.version,
        keyPath: store.keyPath,
        indexes: Array.from(store.indexNames).sort(),
      }
      await transactionDone(transaction)
      return info
    })
    expect(meta.version).toBe(7)
    expect(meta.keyPath).toBe('id')
    expect(meta.indexes).toEqual(['projectId', 'revisionId', 'termId'])
  })

  it('events store 使用 id 主键并建立 projectId / createdAt 索引', async () => {
    const meta = await withDatabase(async (db) => {
      const transaction = db.transaction(EVENT_STORE_NAME, 'readonly')
      const store = transaction.objectStore(EVENT_STORE_NAME)
      const info = {
        keyPath: store.keyPath,
        indexes: Array.from(store.indexNames).sort(),
      }
      await transactionDone(transaction)
      return info
    })
    expect(meta.keyPath).toBe('id')
    expect(meta.indexes).toEqual(['createdAt', 'projectId'])
  })
})

interface RawEvent {
  id: string
  projectId: string
  type: string
  createdAt: string
  bindingId?: string
}

async function listEvents(): Promise<RawEvent[]> {
  return withDatabase(async (db) => {
    const transaction = db.transaction(EVENT_STORE_NAME, 'readonly')
    const done = transactionDone(transaction)
    const events = (await requestResult(
      transaction.objectStore(EVENT_STORE_NAME).getAll(),
    )) as RawEvent[]
    await done
    return events
  })
}

async function countStore(name: string): Promise<number> {
  return withDatabase(async (db) => {
    const transaction = db.transaction(name, 'readonly')
    const done = transactionDone(transaction)
    const count = await requestResult(transaction.objectStore(name).count())
    await done
    return count
  })
}

describe('来源绑定：事件与解除绑定', () => {
  it('导入与绑定写入事件；解除绑定只删绑定，revision / Blob 保留', async () => {
    const projectId = await createTestProject()
    const revision = await importRevision(projectId, 'A')
    const created = await createSourceBinding(bindingInput(projectId, revision.id))
    expect(created.ok, created.ok ? '' : created.error.message).toBe(true)
    if (!created.ok) {
      throw new Error(created.error.message)
    }

    const eventsAfterCreate = await listEvents()
    expect(eventsAfterCreate.map((event) => event.type).sort()).toEqual([
      'source_binding_added',
      'source_import',
    ])

    const removed = await removeSourceBinding(created.value.id)
    expect(removed).toEqual({ ok: true, value: true })
    expect(await bindingCount()).toBe(0)
    // 解除绑定不等于删除原始资料。
    expect(await countStore(SOURCE_DOCUMENT_STORE_NAME)).toBe(1)
    expect(await countStore(SOURCE_REVISION_STORE_NAME)).toBe(1)
    expect(await countStore(SOURCE_BLOB_STORE_NAME)).toBe(1)
    const blob = await readSourceBlobBytes(revision.blobKey)
    expect(blob.ok).toBe(true)
    if (blob.ok) {
      expect(Array.from(blob.value ?? [])).toEqual(
        Array.from(buildSyntheticPdf({ pageCount: 2, variant: 'A' })),
      )
    }
    const eventsAfterRemove = await listEvents()
    expect(eventsAfterRemove.map((event) => event.type)).toContain(
      'source_binding_removed',
    )

    // 重复解除是幂等的，不写第二条删除事件。
    expect(await removeSourceBinding(created.value.id)).toEqual({
      ok: true,
      value: false,
    })
    expect(
      (await listEvents()).filter((event) => event.type === 'source_binding_removed'),
    ).toHaveLength(1)
  })
})

describe('删除项目：bindings / events 与来源同事务退役', () => {
  it('项目、草稿删除；来源/绑定/事件只改作用域，Blob 字节与绑定矩形不变', async () => {
    const projectId = await createTestProject()
    const revision = await importRevision(projectId, 'A')
    const created = await createSourceBinding(
      bindingInput(projectId, revision.id, { page: 2, rectPdf: RECT_B }),
    )
    expect(created.ok, created.ok ? '' : created.error.message).toBe(true)
    if (!created.ok) {
      throw new Error(created.error.message)
    }

    const before = {
      documents: await countStore(SOURCE_DOCUMENT_STORE_NAME),
      revisions: await countStore(SOURCE_REVISION_STORE_NAME),
      blobs: await countStore(SOURCE_BLOB_STORE_NAME),
      bindings: await countStore(BINDING_STORE_NAME),
      events: await countStore(EVENT_STORE_NAME),
    }
    expect(before.bindings).toBe(1)

    expect(await deleteProject(projectId)).toEqual({ ok: true, value: true })

    // 新项目身份看不到旧来源与旧绑定。
    expect(await listSourceDocuments(projectId)).toEqual({ ok: true, value: [] })
    expect(await listSourceRevisions(projectId)).toEqual({ ok: true, value: [] })
    expect(await listSourceBindings(projectId)).toEqual({ ok: true, value: [] })
    expect(await getProject(projectId)).toEqual({ ok: true, value: null })

    // 记录数不变：没有级联删除。
    expect(await countStore(SOURCE_DOCUMENT_STORE_NAME)).toBe(before.documents)
    expect(await countStore(SOURCE_REVISION_STORE_NAME)).toBe(before.revisions)
    expect(await countStore(SOURCE_BLOB_STORE_NAME)).toBe(before.blobs)
    expect(await countStore(BINDING_STORE_NAME)).toBe(before.bindings)
    expect(await countStore(EVENT_STORE_NAME)).toBe(before.events)

    const retired = await getSourceBinding(created.value.id)
    expect(retired.ok).toBe(true)
    if (retired.ok && retired.value !== null) {
      expect(retired.value.projectId.startsWith(`${projectId}::retired::`)).toBe(
        true,
      )
      // 绑定的 PDF 矩形、页码、备注不因退役而改变。
      expect(retired.value.rectPdf).toEqual(RECT_B)
      expect(retired.value.page).toBe(2)
      expect(retired.value.note).toBe('第 2 页孔公差框')
    }

    const events = await listEvents()
    expect(events).toHaveLength(before.events)
    expect(
      events.every((event) => event.projectId.startsWith(`${projectId}::retired::`)),
    ).toBe(true)

    const blob = await readSourceBlobBytes(revision.blobKey)
    expect(blob.ok).toBe(true)
    if (blob.ok) {
      expect(Array.from(blob.value ?? [])).toEqual(
        Array.from(buildSyntheticPdf({ pageCount: 2, variant: 'A' })),
      )
    }
  })
})

describe('来源核对凭据与失效契约', () => {
  async function eventTypes(): Promise<string[]> {
    return withDatabase(async (db) => {
      const transaction = db.transaction(EVENT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const events = (await requestResult(
        transaction.objectStore(EVENT_STORE_NAME).getAll(),
      )) as { type: string }[]
      await done
      return events.map((event) => event.type)
    })
  }

  async function createReviewedBinding(): Promise<{
    projectId: string
    revision: SourceRevision
    bindingId: string
  }> {
    const projectId = await createTestProject()
    const revision = await importRevision(projectId, 'A')
    const created = await createSourceBinding(
      bindingInput(projectId, revision.id),
      { newId: () => 'bind-review', now: () => '2026-11-08T05:00:00.000Z' },
    )
    expect(created.ok, created.ok ? '' : created.error.message).toBe(true)
    if (!created.ok) {
      throw new Error(created.error.message)
    }
    const reviewed = await reviewSourceBinding(created.value.id, { termRevision: 1 })
    expect(reviewed.ok, reviewed.ok ? '' : reviewed.error.message).toBe(true)
    return { projectId, revision, bindingId: created.value.id }
  }

  it('新建绑定未核对；显式核对后记录环修订号与时间', async () => {
    const projectId = await createTestProject()
    const revision = await importRevision(projectId, 'A')
    const created = await createSourceBinding(
      bindingInput(projectId, revision.id),
      { newId: () => 'bind-review', now: () => '2026-11-08T05:00:00.000Z' },
    )
    expect(created.ok, created.ok ? '' : created.error.message).toBe(true)
    if (!created.ok) {
      throw new Error(created.error.message)
    }
    const fresh = await getSourceBinding('bind-review')
    expect(fresh.ok && fresh.value?.reviewedTermRevision).toBeNull()
    expect(fresh.ok && fresh.value?.reviewedAt).toBeNull()

    const reviewed = await reviewSourceBinding(
      'bind-review',
      { termRevision: 1 },
      { now: () => '2026-11-08T06:00:00.000Z' },
    )
    expect(reviewed.ok, reviewed.ok ? '' : reviewed.error.message).toBe(true)
    if (reviewed.ok) {
      expect(reviewed.value.reviewedTermRevision).toBe(1)
      expect(reviewed.value.reviewedAt).toBe('2026-11-08T06:00:00.000Z')
      expect(reviewed.value.revisionId).toBe(revision.id)
    }
    expect(await eventTypes()).toContain('source_binding_reviewed')
    expect((await getProject(projectId)).ok).toBe(true)
  })

  it('改绑定区域 → 只清该绑定的核对，其他绑定与数值不变', async () => {
    const projectId = await createTestProject()
    const revision = await importRevision(projectId, 'A')
    const first = await createSourceBinding(bindingInput(projectId, revision.id), {
      newId: () => 'bind-1',
    })
    const second = await createSourceBinding(
      bindingInput(projectId, revision.id, { termId: 't-b', rectPdf: RECT_B }),
      { newId: () => 'bind-2' },
    )
    expect(first.ok && second.ok).toBe(true)

    for (const id of ['bind-1', 'bind-2']) {
      const reviewed = await reviewSourceBinding(id, { termRevision: 1 })
      expect(reviewed.ok).toBe(true)
    }
    const beforeProject = await getProject(projectId)

    const changed = await updateSourceBindingRegion('bind-1', {
      rectPdf: [60, 70, 260, 470],
    })
    expect(changed.ok, changed.ok ? '' : changed.error.message).toBe(true)
    if (changed.ok) {
      expect(changed.value.reviewedTermRevision).toBeNull()
      expect(changed.value.reviewedAt).toBeNull()
      expect(changed.value.rectPdf).toEqual([60, 70, 260, 470])
      expect(changed.value.page).toBe(2)
    }

    const other = await getSourceBinding('bind-2')
    expect(other.ok && other.value?.reviewedTermRevision).toBe(1)
    // 只改绑定，不改工作方案数值。
    expect(await getProject(projectId)).toEqual(beforeProject)
    expect(await eventTypes()).toContain('source_binding_region_changed')
  })

  it('只改备注不清核对；改页码清核对', async () => {
    const { bindingId } = await createReviewedBinding()
    const noteOnly = await updateSourceBindingRegion(bindingId, { note: '补充说明' })
    expect(noteOnly.ok).toBe(true)
    if (noteOnly.ok) {
      expect(noteOnly.value.reviewedTermRevision).toBe(1)
      expect(noteOnly.value.note).toBe('补充说明')
    }

    const pageChanged = await updateSourceBindingRegion(bindingId, { page: 1 })
    expect(pageChanged.ok).toBe(true)
    if (pageChanged.ok) {
      expect(pageChanged.value.page).toBe(1)
      expect(pageChanged.value.reviewedTermRevision).toBeNull()
    }
  })

  it('换关联来源 → 该绑定核对失效、documentId 更新，其他绑定不变', async () => {
    const projectId = await createTestProject()
    const firstRevision = await importRevision(projectId, 'A')
    const secondRevision = await importRevision(
      projectId,
      'B',
      '同一名称.pdf',
      firstRevision.documentId,
    )
    const created = await createSourceBinding(
      bindingInput(projectId, firstRevision.id, { note: '旧版' }),
      { newId: () => 'bind-rebind' },
    )
    expect(created.ok).toBe(true)
    const other = await createSourceBinding(
      bindingInput(projectId, firstRevision.id, { termId: 't-b', rectPdf: RECT_B }),
      { newId: () => 'bind-other' },
    )
    expect(other.ok).toBe(true)
    for (const id of ['bind-rebind', 'bind-other']) {
      expect((await reviewSourceBinding(id, { termRevision: 1 })).ok).toBe(true)
    }

    const rebound = await rebindSourceBinding('bind-rebind', {
      revisionId: secondRevision.id,
      page: 1,
      rectPdf: [10, 20, 110, 120],
      pageBoxPdf: PAGE_BOX,
      note: '新版',
    })
    expect(rebound.ok, rebound.ok ? '' : rebound.error.message).toBe(true)
    if (rebound.ok) {
      expect(rebound.value.revisionId).toBe(secondRevision.id)
      expect(rebound.value.documentId).toBe(secondRevision.documentId)
      expect(rebound.value.reviewedTermRevision).toBeNull()
      expect(rebound.value.rectPdf).toEqual([10, 20, 110, 120])
      expect(rebound.value.note).toBe('新版')
    }
    const untouched = await getSourceBinding('bind-other')
    expect(untouched.ok && untouched.value?.reviewedTermRevision).toBe(1)
    expect(untouched.ok && untouched.value?.revisionId).toBe(firstRevision.id)
    expect(await eventTypes()).toContain('source_binding_rebound')
  })

  it('核对不存在的绑定返回明确错误，不写任何记录', async () => {
    const result = await reviewSourceBinding('missing', { termRevision: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('binding_not_found')
    }
    expect(await bindingCount()).toBe(0)
  })
})
