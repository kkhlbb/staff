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
  type StorageResult,
} from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import { chainToDraft } from '../workspace/draft'
import {
  IMPORT_SNAPSHOT_STORE_NAME,
  PROJECT_STORE_NAME,
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
    relationConfirmed: true,
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
        relationConfirmed: true,
      },
    }),
  )
}

/** 让生产存储层的 add 写请求在指定 store 上失败（替换快照与新建项目都用 add）。 */
function failAddOnStore(storeName: string): () => void {
  const originalAdd = IDBObjectStore.prototype.add
  const spy = vi
    .spyOn(IDBObjectStore.prototype, 'add')
    .mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === storeName) {
        throw new DOMException('模拟 IndexedDB 写请求失败', 'DataError')
      }
      return originalAdd.call(this, value as never, key)
    })
  return () => {
    spy.mockRestore()
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
    expect(project.working.relationConfirmed).toBe(false)
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
    expect(committed.value.chain.relationConfirmed).toBe(false)
    expect(committed.value.chain.target).toEqual(project.working.target)
    expect(committed.value.chain.assumptions).toBe('原项目假设')

    const stored = expectOk(await getProject(project.id))
    expect(stored?.working).toEqual(committed.value.chain)
    const draft = expectOk(await getDraft(project.id))
    expect(draft?.draft).toEqual(committed.value.draft)
    expect(draft?.draft.relationConfirmed).toBe(false)
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
    expect(committed.value.chain.relationConfirmed).toBe(false)
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

  it('真实事务写入失败时 projects、drafts、基线、快照全部不变', async () => {
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

    const beforeProject = expectOk(await getProject(project.id))
    const beforeDraft = expectOk(await getDraft(project.id))
    const beforeDrafts = expectOk(await listDrafts())

    const restoreAdd = failAddOnStore(IMPORT_SNAPSHOT_STORE_NAME)
    let committed: Awaited<ReturnType<typeof commitImport>>
    try {
      // 走生产 saveDraft：projects / drafts 已排队写入，快照 add 抛 DataError 后
      // saveDraft 显式 abort，三者必须一起回滚。
      committed = await commitImport({
        mode: 'replace',
        projectId: project.id,
        baseDraft,
        terms: [extraTerm(50, 'Y'), extraTerm(51, 'Z')],
      })
    } finally {
      restoreAdd()
    }

    expect(committed.ok).toBe(false)
    if (!committed.ok) {
      expect(committed.error.message).toContain('原项目未改变')
    }
    expect(expectOk(await getProject(project.id))).toEqual(beforeProject)
    expect(expectOk(await getDraft(project.id))).toEqual(beforeDraft)
    expect(expectOk(await listDrafts())).toEqual(beforeDrafts)
    expect(expectOk(await listImportSnapshots(project.id))).toEqual([])
  })

  it('新建项目的事务失败不留下项目、草稿或快照', async () => {
    const restoreAdd = failAddOnStore(PROJECT_STORE_NAME)
    let committed: Awaited<ReturnType<typeof commitImport>>
    try {
      // 走生产 createProject：projects 的 add 请求失败，不能留下项目或草稿。
      committed = await commitImport({
        mode: 'new',
        baseDraft: null,
        terms: [extraTerm(60, 'A'), extraTerm(61, 'B')],
      })
    } finally {
      restoreAdd()
    }

    expect(committed.ok).toBe(false)
    expect(expectOk(await listProjects())).toEqual([])
    expect(expectOk(await listDrafts())).toEqual([])
    expect(expectOk(await listImportSnapshots())).toEqual([])
  })
})
