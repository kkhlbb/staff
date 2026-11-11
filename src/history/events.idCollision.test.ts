// @vitest-environment node
/**
 * EID-01..04 / EID-06：变更事件 ID 唯一性回归。
 *
 * 缺陷现场：事件 ID 由 `${type}:${业务主键}` 推导，业务主键里常含毫秒时间戳；
 * 同一绑定在同一毫秒内核对两次会得到同一个 ID → `add()` 撞主键 → 整个事务 abort。
 * 修复在 `addChangeEvent` 一层集中分配写入序号（见 events.ts），本文件只验证产品行为。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSourceBinding, reviewSourceBinding } from '../sources/bindings'
import { importSourceRevision } from '../sources/revisions'
import { EVENT_STORE_NAME, requestResult, transactionDone, withDatabase } from '../storage/db'
import { createProject, saveDraft } from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import { chainToDraft, type WorkspaceDraft } from '../workspace/draft'
import { relationFingerprint } from '../workspace/relation'
import type { ChainDefinition } from '../domain/types'
import { parseMm } from '../domain/units'
import { changeEventId, compareChangeEvents, putChangeEvent, type ChangeEvent } from './events'

const SAME_MS = '2026-03-01T00:00:00.000Z'

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

async function listEvents(): Promise<ChangeEvent[]> {
  return withDatabase(async (db) => {
    const transaction = db.transaction(EVENT_STORE_NAME, 'readonly')
    const done = transactionDone(transaction)
    const all = (await requestResult(
      transaction.objectStore(EVENT_STORE_NAME).getAll(),
    )) as ChangeEvent[]
    await done
    return all
  })
}

interface Fixture {
  projectId: string
  bindingId: string
  draft: WorkspaceDraft
}

async function createFixture(): Promise<Fixture> {
  const relationRevision = 7
  const created = await createProject({
    name: '事件 ID 碰撞测试',
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
  const projectId = created.value.id

  const imported = await importSourceRevision({
    projectId,
    fileName: '装配图.pdf',
    bytes: buildSyntheticPdf({ pageCount: 1, variant: 'a' }),
  })
  expect(imported.ok, imported.ok ? '' : imported.error.message).toBe(true)
  if (!imported.ok) {
    throw new Error(imported.error.message)
  }

  const binding = await createSourceBinding({
    projectId,
    termId: 't-h',
    revisionId: imported.value.revision.id,
    page: 1,
    rectPdf: [10, 10, 100, 100],
    pageBoxPdf: [0, 0, 600, 800],
  })
  expect(binding.ok, binding.ok ? '' : binding.error.message).toBe(true)
  if (!binding.ok) {
    throw new Error(binding.error.message)
  }

  return {
    projectId,
    bindingId: binding.value.id,
    draft: { ...chainToDraft(chain), relationRevision },
  }
}

beforeEach(async () => {
  await deleteProjectDatabase()
})

describe('事件 ID 唯一性（EID）', () => {
  it('EID-01 同一绑定、同一注入时刻连续核对两次：两次都成功，事件 2 条，id 不同', async () => {
    const { bindingId } = await createFixture()

    const first = await reviewSourceBinding(bindingId, {
      termRevision: 1,
      reviewedAt: SAME_MS,
    })
    const second = await reviewSourceBinding(bindingId, {
      termRevision: 1,
      reviewedAt: SAME_MS,
    })

    expect(first.ok, first.ok ? '' : first.error.message).toBe(true)
    expect(second.ok, second.ok ? '' : second.error.message).toBe(true)

    const reviewed = (await listEvents()).filter(
      (event) => event.type === 'source_binding_reviewed',
    )
    expect(reviewed).toHaveLength(2)
    expect(reviewed.every((event) => event.createdAt === SAME_MS)).toBe(true)
    expect(new Set(reviewed.map((event) => event.id)).size).toBe(2)
  })

  it('EID-02 同一时刻连续 100 次同类操作：全部成功，无 ConstraintError，id 全不同', async () => {
    const { bindingId } = await createFixture()

    const failures: string[] = []
    for (let index = 0; index < 100; index += 1) {
      const result = await reviewSourceBinding(bindingId, {
        termRevision: 1,
        reviewedAt: SAME_MS,
      })
      if (!result.ok) {
        failures.push(`${index}:${result.error.code}:${result.error.message}`)
      }
    }

    expect(failures).toEqual([])
    const reviewed = (await listEvents()).filter(
      (event) => event.type === 'source_binding_reviewed',
    )
    expect(reviewed).toHaveLength(100)
    expect(new Set(reviewed.map((event) => event.id)).size).toBe(100)
  })

  it('EID-03 幂等路径：同一业务键 put 两次仍只有一条，内容取最后一次', async () => {
    const { projectId, draft } = await createFixture()
    const eventId = changeEventId('project_name_changed', `${projectId}:${SAME_MS}`)

    // 直接验证 putChangeEvent 的覆盖语义。
    await withDatabase(async (db) => {
      const transaction = db.transaction(EVENT_STORE_NAME, 'readwrite')
      const done = transactionDone(transaction)
      const base = {
        id: eventId,
        projectId,
        type: 'project_name_changed' as const,
        createdAt: SAME_MS,
      }
      putChangeEvent(transaction, { ...base, after: '第一次' })
      putChangeEvent(transaction, { ...base, after: '第二次' })
      await done
    })
    const direct = (await listEvents()).filter((event) => event.id === eventId)
    expect(direct).toHaveLength(1)
    expect(direct[0]?.after).toBe('第二次')

    // 产品路径：同一毫秒内保存两次同一组成环代号，仍只有一条事件（覆盖，不新增）。
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(SAME_MS))
      const firstSave = await saveDraft(projectId, {
        ...draft,
        terms: draft.terms.map((term) =>
          term.id === 't-h' ? { ...term, symbol: 'H1' } : term,
        ),
      })
      const secondSave = await saveDraft(projectId, {
        ...draft,
        terms: draft.terms.map((term) =>
          term.id === 't-h' ? { ...term, symbol: 'H2' } : term,
        ),
      })
      expect(firstSave.ok, firstSave.ok ? '' : firstSave.error.message).toBe(true)
      expect(secondSave.ok, secondSave.ok ? '' : secondSave.error.message).toBe(true)
    } finally {
      vi.useRealTimers()
    }

    const symbolEvents = (await listEvents()).filter(
      (event) => event.type === 'term_symbol_changed' && event.termId === 't-h',
    )
    expect(symbolEvents).toHaveLength(1)
    expect(symbolEvents[0]?.after).toBe('H2')
  })

  it('EID-04 事件顺序与 createdAt：同毫秒写入仍按操作顺序稳定排序', async () => {
    const { bindingId } = await createFixture()

    const revisions = [1, 2, 3]
    for (const termRevision of revisions) {
      const result = await reviewSourceBinding(bindingId, {
        termRevision,
        reviewedAt: SAME_MS,
      })
      expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
    }

    const reviewed = (await listEvents()).filter(
      (event) => event.type === 'source_binding_reviewed',
    )
    expect(reviewed).toHaveLength(3)
    expect(reviewed.every((event) => event.createdAt === SAME_MS)).toBe(true)

    // createdAt 全相同时，顺序必须由事件 ID 里的写入序号保证。
    const sorted = [...reviewed].sort(compareChangeEvents).map((event) => event.message)
    const written = revisions.map(
      (termRevision) => `已核对来源区域与组成环修订 ${termRevision}`,
    )
    expect(sorted).toEqual(written)
  })

  it('EID-06 旧数据兼容：历史事件 id 原样可读，混合后排序仍按 createdAt', async () => {
    const { projectId, bindingId } = await createFixture()

    // 旧版本写入的事件：id 只有业务键，没有写入序号。
    const legacy: ChangeEvent[] = [
      {
        id: 'source_import:legacy-rev-1',
        projectId,
        type: 'source_import',
        createdAt: '1999-01-01T00:00:00.000Z',
        message: '旧事件（1999）',
      },
      {
        id: 'source_binding_reviewed:legacy-binding:2020-01-01T00:00:00.000Z',
        projectId,
        type: 'source_binding_reviewed',
        createdAt: '2020-01-01T00:00:00.000Z',
        bindingId: 'legacy-binding',
        message: '旧事件（2020）',
      },
    ]
    await withDatabase(async (db) => {
      const transaction = db.transaction(EVENT_STORE_NAME, 'readwrite')
      const done = transactionDone(transaction)
      for (const event of legacy) {
        transaction.objectStore(EVENT_STORE_NAME).put(event)
      }
      await done
    })

    const fresh = await reviewSourceBinding(bindingId, {
      termRevision: 1,
      reviewedAt: SAME_MS,
    })
    expect(fresh.ok, fresh.ok ? '' : fresh.error.message).toBe(true)

    const all = await listEvents()
    const ids = all.map((event) => event.id)
    expect(ids).toContain('source_import:legacy-rev-1')
    expect(ids).toContain('source_binding_reviewed:legacy-binding:2020-01-01T00:00:00.000Z')

    const sorted = [...all].sort(compareChangeEvents)
    const timestamps = sorted.map((event) => event.createdAt)
    expect(timestamps).toEqual([...timestamps].sort((left, right) => left.localeCompare(right)))
    expect(sorted[0]?.id).toBe('source_import:legacy-rev-1')
  })
})
