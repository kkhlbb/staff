// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateChain } from '../domain/calculate'
import type { ChainDefinition, DimensionTerm, Project } from '../domain/types'
import { parseMm } from '../domain/units'
import {
  createProject,
  getDraft,
  getProject,
  listDrafts,
  listImportSnapshots,
  listProjects,
  saveDraft,
  updateProject,
  type ImportSnapshot,
  type StorageResult,
} from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import { chainToDraft } from '../workspace/draft'
import {
  IMPORT_SNAPSHOT_STORE_NAME,
  openDatabase,
  transactionDone,
} from '../storage/db'
import {
  commitImport,
  planImportCommit,
} from './commit'
import {
  candidateDirectionValue,
  directionTokens,
  suggestMapping,
  type ColumnMapping,
} from './mapColumns'
import { parseTableText } from './parseTable'
import { importCellKey, validateImport, type ImportTerm } from './validateImport'

beforeEach(async () => {
  await deleteProjectDatabase()
})

function expectOk<T>(result: StorageResult<T>): T {
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`)
  }
  return result.value
}

function tableOf(text: string) {
  const parsed = parseTableText(text)
  if (!parsed.ok) {
    throw new Error(parsed.error.message)
  }
  return parsed.table
}

function mappingFor(table: ReturnType<typeof tableOf>): ColumnMapping {
  const mapping = suggestMapping(table, true)
  const directionValues: ColumnMapping['directionValues'] = {}
  for (const token of directionTokens(table, mapping)) {
    const candidate = candidateDirectionValue(token)
    if (candidate !== null) {
      directionValues[token] = candidate
    }
  }
  return { ...mapping, directionValues }
}

function calTerms(): ImportTerm[] {
  const table = tableOf(
    [
      '代号\t名称\t基本尺寸\t下偏差\t上偏差\t方向',
      'H\t机架\t100.0000\t0.0000\t0.1000\t+1',
      'B1\t轴承 1\t20.0000\t-0.0200\t0.0000\t-1',
      'S\t隔套\t59.8000\t-0.0500\t0.0500\t-1',
      'B2\t轴承 2\t20.0000\t-0.0200\t0.0000\t-1',
    ].join('\n'),
  )
  const result = validateImport(table, mappingFor(table))
  expect(result.validTerms).toHaveLength(4)
  return result.validTerms
}

function extraTerm(rowNumber: number, symbol = 'X'): ImportTerm {
  return {
    rowNumber,
    symbol,
    name: symbol,
    nominal: '10',
    lower: '0',
    upper: '0.1',
    sign: 1,
    sourceNote: '',
  }
}

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

function chainA(): ChainDefinition {
  return {
    terms: [
      term('a-h', 'H', '100.0000', '0.0000', '0.1000', 1),
      term('a-b1', 'B1', '20.0000', '-0.0200', '0.0000', -1),
      term('a-s', 'S', '59.8000', '-0.0500', '0.0500', -1),
      term('a-b2', 'B2', '20.0000', '-0.0200', '0.0000', -1),
    ],
    target: { minQ: parseMm('0.1000'), maxQ: parseMm('0.3000') },
    assumptions: '原项目假设',
  }
}

async function seedCaseA(): Promise<Project> {
  return expectOk(await createProject({ name: '案例 A', working: chainA() }))
}

async function seedFullChain(): Promise<Project> {
  const terms = Array.from({ length: 20 }, (_, index) =>
    term(`t-${index}`, `T${index}`, '1.0000', '0.0000', '0.0100', 1),
  )
  return expectOk(
    await createProject({
      name: '20 项项目',
      working: {
        terms,
        target: null,
        assumptions: '',
      },
    }),
  )
}

/**
 * 固定 UUID v4 随机源，用来构造可预期的快照主键。
 *
 * 只固定“随机数”，不替换任何存储函数或 IDBObjectStore.add：写入仍然走生产
 * saveDraft / createProject，失败也来自 IndexedDB 自己的主键约束
 * （add 触发 ConstraintError 请求错误，事务按规范 abort）。
 */
const PINNED_UUID = '11111111-1111-4111-8111-111111111111'

function pinRandomUuid(): () => void {
  const spy = vi
    .spyOn(globalThis.crypto, 'randomUUID')
    .mockReturnValue(PINNED_UUID)
  return () => {
    spy.mockRestore()
  }
}

/** 直接写入一条已有历史快照作为前置数据，不经过被测写入路径。 */
async function seedImportSnapshot(snapshot: ImportSnapshot): Promise<void> {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(IMPORT_SNAPSHOT_STORE_NAME, 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(IMPORT_SNAPSHOT_STORE_NAME).add(snapshot)
    await done
  } finally {
    db.close()
  }
}

describe('commitImport：新建与追加 / 替换', () => {
  it('新建项目走 createProject，结果与手输 CAL-01 一致且未确认', async () => {
    const committed = await commitImport({
      mode: 'new',
      baseDraft: null,
      projectName: '表格导入项目',
      terms: calTerms(),
    })

    expect(committed.ok).toBe(true)
    if (!committed.ok) {
      return
    }

    const project = committed.value.project
    expect(project.name).toBe('表格导入项目')
    expect(project.relationReview).toBeNull()
    expect(project.working.terms.every((term) => term.termRevision === 1)).toBe(true)
    expect(project.working.terms).toHaveLength(4)
    expect(project.working.target).toBeNull()

    const result = calculateChain(project.working)
    expect(result.minQ).toBe(1500)
    expect(result.maxQ).toBe(3900)
    expect(result.nominalQ).toBe(2000)

    const stored = expectOk(await getProject(project.id))
    expect(stored?.working).toEqual(project.working)
    expect(expectOk(await listProjects())).toHaveLength(1)
  })

  it('追加保留目标与假设、清除关系确认，并同步写入草稿', async () => {
    const project = await seedCaseA()
    const baseDraft = chainToDraft(project.working)
    const committed = await commitImport({
      mode: 'append',
      projectId: project.id,
      baseDraft,
      terms: [extraTerm(10, 'X')],
    })

    expect(committed.ok).toBe(true)
    if (!committed.ok) {
      return
    }
    expect(committed.value.chain.terms).toHaveLength(5)
    expect(committed.value.chain.target).toEqual(project.working.target)
    expect(committed.value.chain.assumptions).toBe('原项目假设')

    const stored = expectOk(await getProject(project.id))
    expect(stored?.working).toEqual(committed.value.chain)
    const draft = expectOk(await getDraft(project.id))
    expect(draft?.draft).toEqual(committed.value.draft)
    expect(draft?.draft.relationRevision).toBeGreaterThan(0)
  })

  it('替换全部保留目标、清除确认并同步草稿', async () => {
    const project = await seedCaseA()
    const baseDraft = chainToDraft(project.working)
    const committed = await commitImport({
      mode: 'replace',
      projectId: project.id,
      baseDraft,
      terms: [extraTerm(20, 'P'), extraTerm(21, 'Q')],
    })

    expect(committed.ok).toBe(true)
    if (!committed.ok) {
      return
    }
    expect(committed.value.chain.terms.map((item) => item.symbol)).toEqual(['P', 'Q'])
    expect(committed.value.chain.target).toEqual(project.working.target)
    expect(committed.value.chain.assumptions).toBe('原项目假设')

    const stored = expectOk(await getProject(project.id))
    expect(stored?.working).toEqual(committed.value.chain)
    const draft = expectOk(await getDraft(project.id))
    expect(draft?.draft.terms.map((item) => item.symbol)).toEqual(['P', 'Q'])
  })
})

describe('commitImport：阻止冲突且原项目不变', () => {
  it('追加导致总数超过 20 时拒绝', async () => {
    const project = await seedFullChain()
    const before = expectOk(await getProject(project.id))
    const baseDraft = chainToDraft(project.working)
    const committed = await commitImport({
      mode: 'append',
      projectId: project.id,
      baseDraft,
      terms: [extraTerm(30, 'NEW')],
    })

    expect(committed.ok).toBe(false)
    if (!committed.ok) {
      expect(committed.error.message).toContain('超过上限 20')
    }
    expect(expectOk(await getProject(project.id))).toEqual(before)
    expect(expectOk(await getDraft(project.id))).toBeNull()
  })

  it('追加代号与已有代号冲突时拒绝，并把错误定位到行', async () => {
    const project = await seedCaseA()
    const before = expectOk(await getProject(project.id))
    const baseDraft = chainToDraft(project.working)
    const planned = planImportCommit({
      mode: 'append',
      baseDraft,
      terms: [extraTerm(40, 'H')],
    })

    expect(planned.ok).toBe(false)
    if (!planned.ok) {
      expect(planned.cellErrors[importCellKey(40, 'symbol')]).toContain('重复')
    }

    const committed = await commitImport({
      mode: 'append',
      projectId: project.id,
      baseDraft,
      terms: [extraTerm(40, 'H')],
    })
    expect(committed.ok).toBe(false)
    expect(expectOk(await getProject(project.id))).toEqual(before)
  })

  it('单行追加到已有合法链可以通过（导入行数不等于最终链数量）', async () => {
    const project = await seedCaseA()
    const table = tableOf(
      [
        '代号\t基本尺寸\t下偏差\t上偏差\t方向',
        'X2\t10.0000\t0.0000\t0.1000\t+1',
      ].join('\n'),
    )
    const preview = validateImport(table, mappingFor(table))
    expect(preview.globalErrors).toEqual([])
    expect(preview.validTerms).toHaveLength(1)

    const committed = await commitImport({
      mode: 'append',
      projectId: project.id,
      baseDraft: chainToDraft(project.working),
      terms: preview.validTerms,
    })

    expect(committed.ok).toBe(true)
    if (!committed.ok) {
      return
    }
    expect(committed.value.chain.terms.map((item) => item.symbol)).toEqual([
      'H',
      'B1',
      'S',
      'B2',
      'X2',
    ])
  })

  it('替换全部组成环时在同一事务保存操作前快照，且不覆盖已有基线', async () => {
    const project = await seedCaseA()
    const baselineDefinition = { ...chainA(), assumptions: '已有基线' }
    expectOk(
      await updateProject(project.id, {
        baseline: {
          savedAt: new Date().toISOString(),
          definition: baselineDefinition,
        },
      }),
    )
    const before = expectOk(await getProject(project.id))
    expect(before).not.toBeNull()
    if (before === null) {
      return
    }
    expect(before.baseline).not.toBeNull()

    const committed = await commitImport({
      mode: 'replace',
      projectId: project.id,
      baseDraft: chainToDraft(project.working),
      terms: [extraTerm(20, 'P'), extraTerm(21, 'Q')],
    })

    expect(committed.ok).toBe(true)
    if (!committed.ok) {
      return
    }
    expect(committed.value.importSnapshot).not.toBeNull()
    expect(committed.value.importSnapshot?.definition).toEqual(before.working)

    const snapshots = expectOk(await listImportSnapshots(project.id))
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].kind).toBe('replace-before-import')
    expect(snapshots[0].definition).toEqual(before.working)

    const stored = expectOk(await getProject(project.id))
    expect(stored?.working).toEqual(committed.value.chain)
    expect(stored?.baseline).toEqual(before.baseline)
  })

  it('替换时快照写入触发真实主键约束冲突：projects（含基线）、drafts 与已有快照逐字段不变', async () => {
    const project = await seedCaseA()
    expectOk(
      await updateProject(project.id, {
        baseline: {
          savedAt: new Date().toISOString(),
          definition: { ...chainA(), assumptions: '已有基线' },
        },
      }),
    )
    const baseDraft = chainToDraft(project.working)
    expectOk(await saveDraft(project.id, baseDraft))

    // 对照组：同样固定 UUID，只要没有同 ID 的历史快照，替换就正常成功；
    // 说明下面的失败来自主键冲突，而不是“固定随机数”本身。
    const control = await seedCaseA()
    const restoreControlUuid = pinRandomUuid()
    let controlCommit: Awaited<ReturnType<typeof commitImport>>
    try {
      controlCommit = await commitImport({
        mode: 'replace',
        projectId: control.id,
        baseDraft: chainToDraft(control.working),
        terms: [extraTerm(40, 'C'), extraTerm(41, 'D')],
      })
    } finally {
      restoreControlUuid()
    }
    expect(controlCommit.ok).toBe(true)

    // 预置一条历史快照；固定随机 UUID 后，本次替换要写的快照 ID 与它相同，
    // add 因此触发 importSnapshots 的主键约束（真实 IDBRequest ConstraintError）。
    const existingSnapshot: ImportSnapshot = {
      id: `import-snapshot-${project.id}-${PINNED_UUID}`,
      projectId: project.id,
      createdAt: '2026-11-08T00:00:00.000Z',
      kind: 'replace-before-import',
      definition: { ...chainA(), assumptions: '已有历史快照' },
    }
    await seedImportSnapshot(existingSnapshot)

    const beforeProject = expectOk(await getProject(project.id))
    const beforeProjects = expectOk(await listProjects())
    const beforeDraft = expectOk(await getDraft(project.id))
    const beforeDrafts = expectOk(await listDrafts())
    const beforeSnapshots = expectOk(await listImportSnapshots(project.id))
    expect(beforeProject?.baseline).not.toBeNull()
    expect(beforeSnapshots).toHaveLength(1)

    const restoreUuid = pinRandomUuid()
    let committed: Awaited<ReturnType<typeof commitImport>>
    try {
      // 生产 saveDraft 先排队 drafts.put，再 add 新快照；主键冲突让 add 的请求
      // 失败、事务 abort，已排队的 projects / drafts 写入必须一起回滚。
      committed = await commitImport({
        mode: 'replace',
        projectId: project.id,
        baseDraft,
        terms: [extraTerm(50, 'Y'), extraTerm(51, 'Z')],
      })
    } finally {
      restoreUuid()
    }

    expect(committed.ok).toBe(false)
    if (!committed.ok) {
      expect(committed.error.message).toContain('原项目未改变')
      expect(committed.error.message).toContain('保存草稿失败')
      // 失败来自存储层事务（不是计划校验）：saveDraft 已排队 drafts.put 与快照 add。
      expect(committed.error.code).toBe('storage_failure')
    }

    // 逐字段深比较：项目（含 baseline 与 updatedAt）、草稿、快照全部原样。
    const afterProject = expectOk(await getProject(project.id))
    expect(afterProject).toEqual(beforeProject)
    expect(afterProject?.working).toEqual(beforeProject?.working)
    expect(afterProject?.baseline).toEqual(beforeProject?.baseline)
    expect(afterProject?.updatedAt).toBe(beforeProject?.updatedAt)
    expect(afterProject?.working.terms.map((term) => term.symbol)).toEqual([
      'H',
      'B1',
      'S',
      'B2',
    ])
    expect(expectOk(await listProjects())).toEqual(beforeProjects)
    const afterDraft = expectOk(await getDraft(project.id))
    expect(afterDraft).toEqual(beforeDraft)
    // 若 drafts.put 已提交，savedAt 会被改成本次写入时间；这里必须还是旧值。
    expect(afterDraft?.savedAt).toBe(beforeDraft?.savedAt)
    expect(expectOk(await listDrafts())).toEqual(beforeDrafts)

    const afterSnapshots = expectOk(await listImportSnapshots(project.id))
    expect(afterSnapshots).toEqual(beforeSnapshots)
    expect(afterSnapshots).toHaveLength(1)
    expect(afterSnapshots[0].id).toBe(existingSnapshot.id)
    expect(afterSnapshots[0].createdAt).toBe(existingSnapshot.createdAt)
    // 失败的新快照没有残留：定义仍是旧 working，不含导入的 Y / Z。
    expect(afterSnapshots[0].definition.terms.map((term) => term.symbol)).toEqual([
      'H',
      'B1',
      'S',
      'B2',
    ])
  })

  it('新建项目遇到持续的真实主键冲突时放弃，且不留下项目、草稿或快照', async () => {
    const restoreUuid = pinRandomUuid()
    let committed: Awaited<ReturnType<typeof commitImport>>
    let beforeProjects: Project[]
    try {
      // 先占住这个 ID（走生产 createProject）；随后新建会反复撞上同一条主键，
      // 8 次真实 ConstraintError 后按生产逻辑放弃。
      const occupant = expectOk(
        await createProject({ name: '占位项目', working: chainA() }),
      )
      expect(occupant.id).toBe(PINNED_UUID)
      beforeProjects = expectOk(await listProjects())
      committed = await commitImport({
        mode: 'new',
        baseDraft: null,
        terms: [extraTerm(60, 'A'), extraTerm(61, 'B')],
      })
    } finally {
      restoreUuid()
    }

    expect(committed.ok).toBe(false)
    if (!committed.ok) {
      expect(committed.error.message).toContain('创建项目失败')
      expect(committed.error.message).toContain('无法生成唯一的项目 ID')
    }
    expect(expectOk(await listProjects())).toEqual(beforeProjects)
    expect(expectOk(await listProjects())).toHaveLength(1)
    expect(expectOk(await listDrafts())).toEqual([])
    expect(expectOk(await listImportSnapshots())).toEqual([])
  })

  it('连续两次替换：旧快照原样保留，新快照追加，互不覆盖', async () => {
    const project = await seedCaseA()
    expectOk(
      await updateProject(project.id, {
        baseline: {
          savedAt: new Date().toISOString(),
          definition: { ...chainA(), assumptions: '已有基线' },
        },
      }),
    )
    const original = expectOk(await getProject(project.id))
    expect(original).not.toBeNull()
    if (original === null) {
      return
    }

    const first = await commitImport({
      mode: 'replace',
      projectId: project.id,
      baseDraft: chainToDraft(project.working),
      terms: [extraTerm(70, 'M'), extraTerm(71, 'N')],
    })
    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }
    const afterFirst = expectOk(await getProject(project.id))
    expect(afterFirst).not.toBeNull()
    if (afterFirst === null) {
      return
    }
    const firstSnapshot = first.value.importSnapshot
    expect(firstSnapshot).not.toBeNull()
    const firstSnapshotId = firstSnapshot?.id
    expect(expectOk(await listImportSnapshots(project.id))).toHaveLength(1)

    const second = await commitImport({
      mode: 'replace',
      projectId: project.id,
      baseDraft: chainToDraft(afterFirst.working),
      terms: [extraTerm(72, 'P'), extraTerm(73, 'Q'), extraTerm(74, 'R')],
    })
    expect(second.ok).toBe(true)
    if (!second.ok) {
      return
    }
    const secondSnapshot = second.value.importSnapshot
    expect(secondSnapshot).not.toBeNull()
    if (secondSnapshot == null) {
      return
    }

    const snapshots = expectOk(await listImportSnapshots(project.id))
    expect(snapshots).toHaveLength(2)
    // 旧快照逐字段不变（仍是第一次替换前的 working，4 个组成环）。
    const retained = snapshots.find((snapshot) => snapshot.id === firstSnapshotId)
    expect(retained).toEqual(firstSnapshot)
    expect(retained?.definition).toEqual(original.working)
    expect(retained?.definition.terms.map((term) => term.symbol)).toEqual([
      'H',
      'B1',
      'S',
      'B2',
    ])
    // 新快照记录的是第二次替换前的 working（2 个组成环），且 ID 与旧快照不同。
    const added = snapshots.find((snapshot) => snapshot.id === secondSnapshot.id)
    expect(added).toEqual(secondSnapshot)
    expect(added?.definition).toEqual(afterFirst.working)
    expect(added?.definition.terms.map((term) => term.symbol)).toEqual(['M', 'N'])
    expect(new Set(snapshots.map((snapshot) => snapshot.id)).size).toBe(2)

    const finalProject = expectOk(await getProject(project.id))
    expect(finalProject?.working).toEqual(second.value.chain)
    expect(finalProject?.working.terms.map((term) => term.symbol)).toEqual([
      'P',
      'Q',
      'R',
    ])
    // 两次替换都不碰已有基线。
    expect(finalProject?.baseline).toEqual(original.baseline)
    expect(finalProject?.baseline).not.toBeNull()
  })
})
