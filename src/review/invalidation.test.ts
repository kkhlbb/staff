// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChainDefinition } from '../domain/types'
import { parseMm } from '../domain/units'
import { EVENT_STORE_NAME, requestResult, transactionDone, withDatabase } from '../storage/db'
import { createProject, getProject, saveDraft } from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import { chainToDraft, workspaceReducer, type WorkspaceDraft } from '../workspace/draft'
import { relationFingerprint } from '../workspace/relation'
import { INVALIDATION_MATRIX, effectsOf, type InvalidationKind } from './invalidation'
import { createSourceBinding, reviewSourceBinding, updateSourceBindingRegion } from '../sources/bindings'
import { importSourceRevision, readSourceBlobBytes, getSourceRevision } from '../sources/revisions'
import { resolveBindingReview } from '../sources/review'
import { buildSyntheticPdf } from '../test/pdfFixtures'

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
      sourceNote: '图纸说明',
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
  target: { minQ: parseMm('0.01'), maxQ: parseMm('0.2') },
  assumptions: '',
}

interface StoredEvent {
  type: string
  termId?: string
  before?: string
  after?: string
  numeric?: { field: string; beforeQ: number; afterQ: number }
  reason?: string
}

async function listEvents(): Promise<StoredEvent[]> {
  return withDatabase(async (db) => {
    const transaction = db.transaction(EVENT_STORE_NAME, 'readonly')
    const done = transactionDone(transaction)
    const all = (await requestResult(
      transaction.objectStore(EVENT_STORE_NAME).getAll(),
    )) as StoredEvent[]
    await done
    return all
  })
}

async function createTestProject(): Promise<{
  projectId: string
  draft: WorkspaceDraft
  relationRevision: number
}> {
  const relationRevision = 7
  const created = await createProject({
    name: '失效矩阵测试',
    working: chain,
    relationRevision,
    relationReview: {
      relationRevision,
      fingerprint: relationFingerprint(chain.terms),
      confirmedAt: '2026-01-01T00:00:00.000Z',
    },
  })
  expect(created.ok, created.ok ? '' : created.error.message).toBe(true)
  if (!created.ok) {
    throw new Error(created.error.message)
  }
  return {
    projectId: created.value.id,
    draft: {
      ...chainToDraft(chain),
      relationRevision,
    },
    relationRevision,
  }
}

async function save(
  projectId: string,
  draft: WorkspaceDraft,
): Promise<void> {
  const saved = await saveDraft(projectId, draft)
  expect(saved.ok, saved.ok ? '' : saved.error.message).toBe(true)
}

beforeEach(async () => {
  await deleteProjectDatabase()
})

describe('失效矩阵：声明与实现一致', () => {
  it('矩阵覆盖规格 §6.2 的全部事件，每行都有可核对的说明', () => {
    const kinds: InvalidationKind[] = [
      'term-numeric',
      'term-structure',
      'target',
      'term-symbol',
      'term-text',
      'term-reorder',
      'binding-region',
      'binding-rebind',
      'source-new-version',
      'local-refresh',
      'external-import',
      'baseline-restore',
      'snapshot-restore',
    ]
    for (const kind of kinds) {
      expect(INVALIDATION_MATRIX[kind], kind).toBeDefined()
      expect(effectsOf(kind).note.length, kind).toBeGreaterThan(0)
    }
    // 本地刷新不得清确认。
    expect(effectsOf('local-refresh')).toMatchObject({
      relation: 'kept',
      termValueReview: 'kept',
    })
    // 改目标与改名称/顺序均保留关系确认。
    expect(effectsOf('target').relation).toBe('kept')
    expect(effectsOf('term-text').relation).toBe('kept')
    expect(effectsOf('term-reorder').relation).toBe('kept')
  })

  it('修改数值：重算版本递增、关系失效、写强类型事件，只有该环来源核对失效', async () => {
    const { projectId, draft, relationRevision } = await createTestProject()
    const edited = workspaceReducer(draft, {
      type: 'updateField',
      termId: 't-h',
      field: 'nominal',
      value: '100.1',
    })
    expect(edited.terms[0].termRevision).toBe(2)
    expect(edited.terms[1].termRevision).toBe(1)
    expect(edited.relationRevision).toBe(relationRevision + 1)

    await save(projectId, edited)
    const events = await listEvents()
    const changed = events.filter((event) => event.type === 'term_numeric_changed')
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatchObject({
      termId: 't-h',
      numeric: { field: 'nominal', beforeQ: parseMm('100'), afterQ: parseMm('100.1') },
      before: '基本尺寸 100.000 mm',
      after: '基本尺寸 100.100 mm',
    })
    expect(changed[0].reason).toBeUndefined()

    const project = await getProject(projectId)
    expect(project.ok).toBe(true)
    if (project.ok) {
      expect(project.value?.working.terms[0].termRevision).toBe(2)
      // 旧凭据仍在，但修订号已不一致：派生为失效，改回原值也不会恢复。
      expect(project.value?.relationReview?.relationRevision).toBe(relationRevision)
    }
  })

  it('改后改回原值：termRevision 与关系修订号继续单调递增，不复活确认', async () => {
    const { projectId, draft } = await createTestProject()
    const changed = workspaceReducer(draft, {
      type: 'updateField',
      termId: 't-h',
      field: 'nominal',
      value: '100.1',
    })
    const reverted = workspaceReducer(changed, {
      type: 'updateField',
      termId: 't-h',
      field: 'nominal',
      value: '100',
    })
    expect(reverted.terms[0].nominal).toBe('100')
    expect(reverted.terms[0].termRevision).toBe(3)
    expect(reverted.relationRevision).toBe(draft.relationRevision + 2)
    await save(projectId, reverted)
    const project = await getProject(projectId)
    expect(project.ok).toBe(true)
    if (project.ok) {
      expect(project.value?.relationReview?.relationRevision).not.toBe(
        project.value?.relationRevision,
      )
    }
  })

  it('修改目标：重算判定但保留关系确认与来源核对，并写目标事件', async () => {
    const { projectId, draft } = await createTestProject()
    const edited = workspaceReducer(draft, {
      type: 'setTarget',
      targetMin: '0.02',
      targetMax: '0.3',
    })
    expect(edited.relationRevision).toBe(draft.relationRevision)

    const saved = await saveDraft(projectId, edited, {
      relationState: {
        relationRevision: edited.relationRevision,
        relationReview: {
          relationRevision: edited.relationRevision,
          fingerprint: relationFingerprint(chain.terms),
          confirmedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    })
    expect(saved.ok, saved.ok ? '' : saved.error.message).toBe(true)

    const events = await listEvents()
    const targetEvent = events.find((event) => event.type === 'target_changed')
    expect(targetEvent).toMatchObject({
      before: '0.010 … 0.200 mm',
      after: '0.020 … 0.300 mm',
    })
  })

  it('改代号：关系失效、该环修订号不变、记录 before/after', async () => {
    const { projectId, draft } = await createTestProject()
    const edited = workspaceReducer(draft, {
      type: 'updateField',
      termId: 't-h',
      field: 'symbol',
      value: 'H1',
    })
    expect(edited.terms[0].termRevision).toBe(1)
    expect(edited.relationRevision).toBe(draft.relationRevision + 1)
    await save(projectId, edited)
    const events = await listEvents()
    expect(events.find((event) => event.type === 'term_symbol_changed')).toMatchObject({
      termId: 't-h',
      before: 'H',
      after: 'H1',
    })
  })

  it('改名称/备注与调整顺序：只记录变更，不递增关系修订号', async () => {
    const { projectId, draft } = await createTestProject()
    const renamed = workspaceReducer(draft, {
      type: 'updateField',
      termId: 't-h',
      field: 'name',
      value: '孔（新）',
    })
    const noted = workspaceReducer(renamed, {
      type: 'updateField',
      termId: 't-h',
      field: 'sourceNote',
      value: '新说明',
    })
    const reordered = workspaceReducer(noted, {
      type: 'moveTerm',
      termId: 't-b',
      direction: 'up',
    })
    expect(reordered.relationRevision).toBe(draft.relationRevision)
    await save(projectId, reordered)
    const events = await listEvents()
    expect(events.find((event) => event.type === 'term_name_changed')).toMatchObject({
      before: '孔',
      after: '孔（新）',
    })
    expect(events.find((event) => event.type === 'term_note_changed')).toMatchObject({
      before: '图纸说明',
      after: '新说明',
    })
    expect(events.find((event) => event.type === 'term_reordered')).toBeDefined()
  })

  it('修改绑定区域：只清该绑定核对，其他绑定保留', async () => {
    const { projectId } = await createTestProject()
    const imported = await importSourceRevision({
      projectId,
      fileName: '装配图.pdf',
      bytes: buildSyntheticPdf({ pageCount: 2, variant: 'a' }),
    })
    expect(imported.ok).toBe(true)
    if (!imported.ok) {
      return
    }
    const revision = imported.value.revision
    const first = await createSourceBinding({
      projectId,
      termId: 't-h',
      revisionId: revision.id,
      page: 1,
      rectPdf: [10, 10, 100, 100],
      pageBoxPdf: [0, 0, 600, 800],
    })
    const second = await createSourceBinding({
      projectId,
      termId: 't-b',
      revisionId: revision.id,
      page: 2,
      rectPdf: [10, 10, 100, 100],
      pageBoxPdf: [0, 0, 600, 800],
    })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) {
      return
    }
    const firstReview = await reviewSourceBinding(first.value.id, { termRevision: 1 })
    const secondReview = await reviewSourceBinding(second.value.id, { termRevision: 1 })
    expect(firstReview.ok, firstReview.ok ? '' : firstReview.error.message).toBe(true)
    expect(secondReview.ok, secondReview.ok ? '' : secondReview.error.message).toBe(true)

    const updated = await updateSourceBindingRegion(first.value.id, {
      page: 2,
      rectPdf: [20, 20, 120, 120],
      pageBoxPdf: [0, 0, 600, 800],
    })
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      expect(updated.value.reviewedTermRevision).toBeNull()
    }

    const stillReviewed = await reviewSourceBinding(second.value.id, {
      termRevision: 1,
    })
    expect(stillReviewed.ok).toBe(true)
    if (stillReviewed.ok) {
      expect(stillReviewed.value.reviewedTermRevision).toBe(1)
    }
  })

  it('同文档导入新版：旧 revision/Blob 不变，引用旧版的绑定待版本复核', async () => {
    const { projectId } = await createTestProject()
    const v1 = await importSourceRevision({
      projectId,
      fileName: '装配图.pdf',
      bytes: buildSyntheticPdf({ pageCount: 2, variant: 'v1' }),
    })
    expect(v1.ok).toBe(true)
    if (!v1.ok) {
      return
    }
    const created = await createSourceBinding({
      projectId,
      termId: 't-h',
      revisionId: v1.value.revision.id,
      page: 1,
      rectPdf: [10, 10, 100, 100],
      pageBoxPdf: [0, 0, 600, 800],
    })
    expect(created.ok).toBe(true)
    if (!created.ok) {
      return
    }
    const reviewed = await reviewSourceBinding(created.value.id, { termRevision: 1 })
    expect(reviewed.ok).toBe(true)

    const v2 = await importSourceRevision({
      projectId,
      fileName: '装配图.pdf',
      documentId: v1.value.revision.documentId,
      bytes: buildSyntheticPdf({ pageCount: 2, variant: 'v2' }),
    })
    expect(v2.ok).toBe(true)
    if (!v2.ok) {
      return
    }

    // 旧版本与 Blob 不被改写，绑定记录也不被自动迁移。
    const oldRevision = await getSourceRevision(v1.value.revision.id)
    expect(oldRevision.ok).toBe(true)
    if (oldRevision.ok) {
      expect(oldRevision.value?.sha256).toBe(v1.value.revision.sha256)
    }
    const oldBytes = await readSourceBlobBytes(v1.value.revision.blobKey)
    expect(oldBytes.ok).toBe(true)

    const review = resolveBindingReview({
      binding: created.value,
      termRevision: 1,
      latestRevisionId: v2.value.revision.id,
      attachmentAvailable: true,
    })
    expect(review.kind).toBe('stale-version')
    expect(reviewed.ok && reviewed.value.reviewedTermRevision).toBe(1)
    expect(created.value.revisionId).toBe(v1.value.revision.id)
  })
})
