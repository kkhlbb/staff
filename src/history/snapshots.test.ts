// @vitest-environment node
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { calculateChain } from '../domain/calculate'
import type { ChainDefinition, DimensionTerm, Project } from '../domain/types'
import { parseMm } from '../domain/units'
import {
  createAnalysisSnapshot,
  getAnalysisSnapshot,
  listAnalysisSnapshots,
} from '../history/snapshots'
import { evaluateReviewChecklist } from '../review/rules'
import { createSourceBinding, reviewSourceBinding } from '../sources/bindings'
import { importSourceRevision } from '../sources/revisions'
import {
  createProject,
  deleteProject,
  getProject,
  updateProject,
} from '../storage/projects'
import {
  EVENT_STORE_NAME,
  SNAPSHOT_STORE_NAME,
  requestResult,
  transactionDone,
  withDatabase,
} from '../storage/db'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import { deleteProjectDatabase } from '../test/projectDb'
import { chainToDraft } from '../workspace/draft'
import { createRelationReview } from '../workspace/relation'

beforeEach(async () => {
  await deleteProjectDatabase()
})

afterEach(async () => {
  await deleteProjectDatabase()
})

function term(
  id: string,
  symbol: string,
  nominal: string,
  lower: string,
  upper: string,
  sign: 1 | -1,
): DimensionTerm {
  return {
    id,
    symbol,
    name: symbol,
    nominalQ: parseMm(nominal),
    lowerDeviationQ: parseMm(lower),
    upperDeviationQ: parseMm(upper),
    sign,
    sourceNote: '',
    termRevision: 1,
  }
}

function caseA(): ChainDefinition {
  return {
    terms: [
      term('h', 'H', '100.0000', '0.0000', '0.1000', 1),
      term('b1', 'B1', '20.0000', '-0.0200', '0.0000', -1),
      term('s', 'S', '59.8000', '-0.0500', '0.0500', -1),
      term('b2', 'B2', '20.0000', '-0.0200', '0.0000', -1),
    ],
    target: { minQ: parseMm('0.1000'), maxQ: parseMm('0.3000') },
    assumptions: '',
  }
}

async function createProjectWith(
  options: { confirmed?: boolean; name?: string } = {},
): Promise<Project> {
  const working = caseA()
  const relationRevision = 1
  const created = await createProject({
    name: options.name ?? '快照测试项目',
    working,
    relationRevision,
    relationReview:
      options.confirmed === false
        ? null
        : createRelationReview(
            working,
            relationRevision,
            '2026-01-01T00:00:00.000Z',
          ),
  })
  if (!created.ok) {
    throw new Error(created.error.message)
  }
  return created.value
}

async function makeSnapshot(
  project: Project,
  options: { id?: string; now?: string } = {},
) {
  return createAnalysisSnapshot({
    project,
    draft: chainToDraft(project.working),
    relationState: {
      relationRevision: project.relationRevision,
      relationReview: project.relationReview,
    },
    baseline: project.baseline,
    id: options.id,
    now: options.now,
  })
}

describe('AnalysisSnapshot：创建时冻结', () => {
  it('冻结定义、结果、审查结果、版本与来源清单，并递归不可变', async () => {
    const project = await createProjectWith()
    const created = await makeSnapshot(project, {
      now: '2026-11-08T10:00:00.000Z',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) {
      return
    }
    const snapshot = created.value

    expect(snapshot.projectId).toBe(project.id)
    expect(snapshot.projectName).toBe(project.name)
    expect(snapshot.createdAt).toBe('2026-11-08T10:00:00.000Z')
    expect(snapshot.definition).toEqual(project.working)
    expect(snapshot.result).toEqual(calculateChain(project.working))
    expect(snapshot.reviewRulesVersion).toBe('1.0.0')
    expect(snapshot.engineVersion).toBe(project.engineVersion)

    // 审查结果必须与统一规则在同一输入上的输出完全一致。
    const expected = evaluateReviewChecklist({
      chain: project.working,
      result: calculateChain(project.working),
      relationConfirmed: true,
      relationReviewStale: false,
      relationRevision: 1,
      terms: project.working.terms.map((item) => ({
        id: item.id,
        symbol: item.symbol,
        name: item.name,
        termRevision: item.termRevision,
      })),
      bindings: [],
      documents: [],
      revisions: [],
      availableBlobKeys: new Set(),
    })
    expect(snapshot.review).toEqual(expected)
    expect(snapshot.status).toBe('pending')
    expect(snapshot.pendingCount).toBe(expected.pending.length)

    // 不可变：顶层与嵌套对象都冻结，推入数组会抛错。
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.definition)).toBe(true)
    expect(Object.isFrozen(snapshot.review.findings)).toBe(true)
    expect(() => {
      snapshot.definition.terms.push(term('x', 'X', '1.0000', '0.0000', '0.0000', 1))
    }).toThrow()
    expect(project.working.terms).toHaveLength(4)
  })

  it('非法草稿拒绝创建，不写入快照', async () => {
    const project = await createProjectWith()
    const draft = chainToDraft(project.working)
    draft.terms[0] = { ...draft.terms[0], nominal: '' }

    const created = await createAnalysisSnapshot({
      project,
      draft,
      relationState: {
        relationRevision: project.relationRevision,
        relationReview: project.relationReview,
      },
    })
    expect(created.ok).toBe(false)
    if (!created.ok) {
      expect(created.error.code).toBe('invalid_draft')
    }

    await withDatabase(async (db) => {
      const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      expect(
        await requestResult(transaction.objectStore(SNAPSHOT_STORE_NAME).count()),
      ).toBe(0)
      await done
    })
  })

  it('同一快照 ID 不能覆盖；原快照内容保持不变', async () => {
    const project = await createProjectWith()
    const first = await makeSnapshot(project, { id: 'snapshot-fixed' })
    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }

    const second = await makeSnapshot(project, { id: 'snapshot-fixed' })
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.error.code).toBe('snapshot_exists')
    }

    const stored = await getAnalysisSnapshot('snapshot-fixed')
    expect(stored.ok).toBe(true)
    if (stored.ok && stored.value !== null) {
      expect(stored.value.createdAt).toBe(first.value.createdAt)
      expect(stored.value.inputFingerprint).toBe(first.value.inputFingerprint)
    }
  })

  it('创建事件与快照同事务写入', async () => {
    const project = await createProjectWith()
    const created = await makeSnapshot(project)
    expect(created.ok).toBe(true)
    if (!created.ok) {
      return
    }
    const events = await withDatabase(async (db) => {
      const transaction = db.transaction(EVENT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction.objectStore(EVENT_STORE_NAME).getAll(),
      )
      await done
      return value as { type: string; id: string }[]
    })
    expect(
      events.some(
        (event) =>
          event.type === 'analysis_snapshot_created' &&
          event.id === `analysis_snapshot_created:${created.value.id}`,
      ),
    ).toBe(true)
  })
})

describe('AnalysisSnapshot：来源清单', () => {
  it('冻结每个绑定的 revisionId、页、区域、附件可用性与规则状态', async () => {
    const project = await createProjectWith()
    const imported = await importSourceRevision({
      projectId: project.id,
      fileName: 'source.pdf',
      bytes: buildSyntheticPdf({ pageCount: 2 }),
    })
    expect(imported.ok).toBe(true)
    if (!imported.ok) {
      return
    }
    const binding = await createSourceBinding({
      projectId: project.id,
      termId: 'h',
      revisionId: imported.value.revision.id,
      page: 2,
      rectPdf: [30, 40, 230, 90],
      pageBoxPdf: [0, 0, 600, 800],
      note: 'H 的来源区域',
    })
    expect(binding.ok).toBe(true)
    if (!binding.ok) {
      return
    }
    const reviewed = await reviewSourceBinding(binding.value.id, {
      termRevision: 1,
    })
    expect(reviewed.ok).toBe(true)

    const created = await makeSnapshot(project)
    expect(created.ok).toBe(true)
    if (!created.ok) {
      return
    }
    const entry = created.value.sourceManifest.bindings[0]
    expect(entry.bindingId).toBe(binding.value.id)
    expect(entry.termId).toBe('h')
    expect(entry.revisionId).toBe(imported.value.revision.id)
    expect(entry.fileName).toBe('source.pdf')
    expect(entry.page).toBe(2)
    expect(entry.rectPdf).toEqual([30, 40, 230, 90])
    expect(entry.pageBoxPdf).toEqual([0, 0, 600, 800])
    expect(entry.blobAvailable).toBe(true)
    expect(entry.status.available).toBe('passed')
    expect(entry.status.current).toBe('passed')
    expect(entry.status.valueReviewed).toBe('passed')
    expect(entry.revisionSha256).toBe(imported.value.revision.sha256)
    expect(created.value.sourceManifest.unboundTermIds).toEqual([
      'b1',
      's',
      'b2',
    ])
  })
})

describe('AnalysisSnapshot：当前/历史派生', () => {
  it('工作数据变化后旧快照标历史且不重算；新快照成为当前', async () => {
    const project = await createProjectWith()
    const first = await makeSnapshot(project, {
      now: '2026-11-08T09:00:00.000Z',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }

    const changed = caseA()
    changed.target = { minQ: parseMm('0.2000'), maxQ: parseMm('0.4000') }
    const updated = await updateProject(project.id, { working: changed })
    expect(updated.ok).toBe(true)

    const afterChange = await listAnalysisSnapshots(project.id)
    expect(afterChange.ok).toBe(true)
    if (!afterChange.ok) {
      return
    }
    expect(afterChange.value).toHaveLength(1)
    expect(afterChange.value[0].historical).toBe(true)
    expect(afterChange.value[0].historicalReason).toContain('已变化')
    // 旧快照结果仍是旧目标下的结果，没有重新计算。
    expect(afterChange.value[0].snapshot.result).toEqual(first.value.result)
    expect(afterChange.value[0].snapshot.definition.target).toEqual(
      first.value.definition.target,
    )

    const reloaded = await getProject(project.id)
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok || reloaded.value === null) {
      return
    }
    const second = await makeSnapshot(reloaded.value, {
      now: '2026-11-08T09:30:00.000Z',
    })
    expect(second.ok).toBe(true)

    const afterSecond = await listAnalysisSnapshots(project.id)
    expect(afterSecond.ok).toBe(true)
    if (!afterSecond.ok) {
      return
    }
    expect(afterSecond.value).toHaveLength(2)
    const current = afterSecond.value.filter((item) => !item.historical)
    expect(current).toHaveLength(1)
    expect(current[0].snapshot.id).toBe(
      second.ok ? second.value.id : 'missing',
    )
    const old = afterSecond.value.find(
      (item) => item.snapshot.id === first.value.id,
    )
    expect(old?.historical).toBe(true)
  })

  it('删除项目同时删除分析快照', async () => {
    const project = await createProjectWith()
    const created = await makeSnapshot(project)
    expect(created.ok).toBe(true)

    const deleted = await deleteProject(project.id)
    expect(deleted.ok).toBe(true)

    await withDatabase(async (db) => {
      const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      expect(
        await requestResult(transaction.objectStore(SNAPSHOT_STORE_NAME).count()),
      ).toBe(0)
      await done
    })
    const listed = await listAnalysisSnapshots(project.id)
    expect(listed.ok).toBe(false)
    if (!listed.ok) {
      expect(listed.error.code).toBe('project_not_found')
    }
  })
})
