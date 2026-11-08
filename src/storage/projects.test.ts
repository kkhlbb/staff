import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { calculateChain } from '../domain/calculate'
import {
  MAX_ABS_Q,
  Q_PER_MM,
  type ChainDefinition,
  type DimensionTerm,
  type Project,
} from '../domain/types'
import { formatMm, parseMm } from '../domain/units'
import { draftToChain, type WorkspaceDraft } from '../workspace/draft'
import { createRelationReview } from '../workspace/relation'
import { createSourceBinding, listSourceBindings } from '../sources/bindings'
import {
  importSourceRevision,
  listSourceDocuments,
  listSourceRevisions,
} from '../sources/revisions'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import {
  EVENT_STORE_NAME,
  requestResult,
  transactionDone,
  withDatabase,
} from './db'
import {
  MAX_CHAIN_TERMS,
  MAX_IMPORT_BYTES,
  PROJECT_DB_NAME,
  createEmptyProject,
  createProject,
  deleteProject,
  exportProject,
  exportProjectJson,
  getDraft,
  getProject,
  importProjectJson,
  listProjects,
  saveDraft,
  updateProject,
  type ProjectJsonInput,
} from './projects'

function deleteProjectDatabase(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(PROJECT_DB_NAME)
    request.onsuccess = () => {
      resolve()
    }
    request.onerror = () => {
      reject(request.error ?? new Error('deleteDatabase failed'))
    }
    request.onblocked = () => {
      reject(new Error('deleteDatabase blocked'))
    }
  })
}

beforeEach(async () => {
  await deleteProjectDatabase()
})

afterEach(async () => {
  await deleteProjectDatabase()
})

function term(
  id: string,
  symbol: string,
  name: string,
  nominal: string,
  lower: string,
  upper: string,
  sign: 1 | -1,
): DimensionTerm {
  return {
    id,
    symbol,
    name,
    nominalQ: parseMm(nominal),
    lowerDeviationQ: parseMm(lower),
    upperDeviationQ: parseMm(upper),
    sign,
    sourceNote: '',
    termRevision: 1,
  }
}

/** 文档案例 A。 */
function chainA(): ChainDefinition {
  return {
    terms: [
      term('a-h', 'H', '孔', '100.0000', '0.0000', '0.1000', 1),
      term('a-b1', 'B1', '轴承 1', '20.0000', '-0.0200', '0.0000', -1),
      term('a-s', 'S', '隔套', '59.8000', '-0.0500', '0.0500', -1),
      term('a-b2', 'B2', '轴承 2', '20.0000', '-0.0200', '0.0000', -1),
    ],
    target: { minQ: parseMm('0.1000'), maxQ: parseMm('0.3000') },
    assumptions: '案例 A 假设',
  }
}

/** 文档案例 B：从 A 修改 H 上偏差、S 上下偏差。 */
function chainB(): ChainDefinition {
  const chain = chainA()
  chain.terms = [
    term('b-h', 'H', '孔', '100.0000', '0.0000', '0.0300', 1),
    term('b-b1', 'B1', '轴承 1', '20.0000', '-0.0200', '0.0000', -1),
    term('b-s', 'S', '隔套', '59.8000', '-0.0200', '0.0200', -1),
    term('b-b2', 'B2', '轴承 2', '20.0000', '-0.0200', '0.0000', -1),
  ]
  return chain
}

/** 文档案例 C：负间隙与目标边界相等。 */
function chainC(): ChainDefinition {
  return {
    terms: [
      term('c-p', 'P', '正环', '10.0000', '-0.1000', '0.0000', 1),
      term('c-q', 'Q', '负环', '10.0500', '0.0000', '0.0500', -1),
    ],
    target: { minQ: parseMm('-0.2000'), maxQ: parseMm('-0.0500') },
    assumptions: '案例 C 假设',
  }
}

function draftFromChain(chain: ChainDefinition): WorkspaceDraft {
  return {
    terms: chain.terms.map((item) => ({
      id: item.id,
      symbol: item.symbol,
      name: item.name,
      nominal: formatMm(item.nominalQ),
      lower: formatMm(item.lowerDeviationQ),
      upper: formatMm(item.upperDeviationQ),
      sign: item.sign,
      sourceNote: item.sourceNote,
      termRevision: 1,
    })),
    targetMin: chain.target === null ? '' : formatMm(chain.target.minQ),
    targetMax: chain.target === null ? '' : formatMm(chain.target.maxQ),
    relationRevision: 0,
    assumptions: chain.assumptions,
  }
}

function expectOk<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } },
): T {
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  }
  return result.value
}

async function seedProject(): Promise<Project> {
  return expectOk(await createProject({ name: '保留项目', working: chainA() }))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

function mutateJson(
  json: string,
  mutate: (raw: Record<string, unknown>) => void,
): string {
  const raw = asRecord(JSON.parse(json))
  mutate(raw)
  return JSON.stringify(raw)
}

describe('IndexedDB 项目 CRUD 与草稿', () => {
  it('create/get/list/update/delete 可用，基线随项目保存', async () => {
    const savedAt = '2024-01-02T03:04:05.000Z'
    const created = expectOk(
      await createProject({
        name: '  案例 A  ',
        working: chainA(),
        baseline: { savedAt, definition: chainA() },
      }),
    )

    expect(created.schemaVersion).toBe(2)
    expect(created.name).toBe('案例 A')
    expect(created.baseline).toEqual({ savedAt, definition: chainA() })
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    expect(expectOk(await getProject(created.id))).toEqual(created)
    expect(expectOk(await listProjects())).toEqual([created])

    const updated = expectOk(
      await updateProject(created.id, {
        name: '案例 B',
        working: chainB(),
        baseline: null,
      }),
    )
    expect(updated.name).toBe('案例 B')
    expect(updated.working).toEqual(chainB())
    expect(updated.baseline).toBeNull()
    expect(updated.createdAt).toBe(created.createdAt)
    expect(expectOk(await getProject(created.id))).toEqual(updated)

    expect(expectOk(await deleteProject(created.id))).toBe(true)
    expect(expectOk(await getProject(created.id))).toBeNull()
    expect(expectOk(await listProjects())).toEqual([])
    expect(expectOk(await deleteProject(created.id))).toBe(false)
  })

  it('创建和更新会拒绝非法 ChainDefinition，且不覆盖已有模型', async () => {
    const invalidChain: ChainDefinition = {
      ...chainA(),
      terms: chainA().terms.slice(0, 1),
    }
    const failedCreate = await createProject({ working: invalidChain })
    expect(failedCreate.ok).toBe(false)
    if (!failedCreate.ok) {
      expect(failedCreate.error.code).toBe('invalid_chain')
      expect(failedCreate.error.details.map((item) => item.code)).toContain('terms_count')
    }

    const created = expectOk(await createProject({ working: chainA() }))
    const failedUpdate = await updateProject(created.id, { working: invalidChain })
    expect(failedUpdate.ok).toBe(false)
    expect(expectOk(await getProject(created.id))).toEqual(created)
  })

  it('无效草稿只更新 drafts 表，不覆盖最后一个有效模型', async () => {
    const created = expectOk(await createProject({ working: chainA() }))
    const invalidDraft: WorkspaceDraft = {
      terms: [
        {
          id: 'draft-h',
          symbol: 'H',
          name: '孔',
          nominal: '',
          lower: '0.0000',
          upper: '0.1000',
          sign: 1,
          sourceNote: '',
          termRevision: 1,
        },
      ],
      targetMin: '',
      targetMax: '',
      relationRevision: 0,
      assumptions: '待修正',
    }

    const savedInvalid = expectOk(await saveDraft(created.id, invalidDraft))
    expect(savedInvalid.modelUpdated).toBe(false)
    expect(savedInvalid.project).toEqual(created)
    expect(savedInvalid.cellErrors['draft-h.nominal']).toBeDefined()
    expect(expectOk(await getProject(created.id))).toEqual(created)
    expect(expectOk(await getDraft(created.id))?.draft).toEqual(invalidDraft)

    const validDraft = draftFromChain(chainB())
    const conversion = draftToChain(validDraft)
    expect(conversion.ok).toBe(true)
    if (!conversion.ok) {
      return
    }

    const savedValid = expectOk(await saveDraft(created.id, validDraft))
    expect(savedValid.modelUpdated).toBe(true)
    expect(savedValid.project.working).toEqual(conversion.chain)
    expect(savedValid.cellErrors).toEqual({})
    expect(expectOk(await getProject(created.id))?.working).toEqual(conversion.chain)

    const savedInvalidAgain = expectOk(await saveDraft(created.id, invalidDraft))
    expect(savedInvalidAgain.modelUpdated).toBe(false)
    expect(expectOk(await getProject(created.id))?.working).toEqual(conversion.chain)
    expect(expectOk(await getDraft(created.id))?.draft).toEqual(invalidDraft)
  })

  it('删除项目时一并删除草稿', async () => {
    const created = expectOk(await createProject({ working: chainA() }))
    expectOk(await saveDraft(created.id, draftFromChain(chainA())))
    expect(expectOk(await getDraft(created.id))).not.toBeNull()

    expectOk(await deleteProject(created.id))
    expect(expectOk(await getDraft(created.id))).toBeNull()
  })

  it('保存不存在项目的草稿返回 not_found 且不留下草稿', async () => {
    const result = await saveDraft('missing-project', draftFromChain(chainA()))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('not_found')
    }
    expect(expectOk(await getDraft('missing-project'))).toBeNull()
  })
})

describe('项目 JSON 导出导入', () => {
  it.each([
    ['案例 A', chainA],
    ['案例 B', chainB],
    ['案例 C', chainC],
  ])('%s 导出再导入后工程输入与重算结果一致', async (name, buildChain) => {
    const chain = buildChain()
    const created = expectOk(await createProject({ name, working: chain }))
    const originalResult = calculateChain(created.working)
    const json = exportProjectJson(created)
    const raw = asRecord(JSON.parse(json))

    expect(raw.unit).toBe('q')
    expect(raw.qPerMm).toBe(Q_PER_MM)
    expect(raw).not.toHaveProperty('result')

    const terms = asRecord(raw.working).terms as Record<string, unknown>[]
    for (const item of terms) {
      expect(Number.isSafeInteger(item.nominalQ)).toBe(true)
      expect(Number.isSafeInteger(item.lowerDeviationQ)).toBe(true)
      expect(Number.isSafeInteger(item.upperDeviationQ)).toBe(true)
    }

    const imported = expectOk(await importProjectJson(json))
    expect(imported.project.working).toEqual({
      ...chain,
    })
    expect(imported.result).toEqual(originalResult)
    expect(calculateChain(imported.project.working)).toEqual(originalResult)
    expect(imported.idChanged).toBe(true)
    expect(imported.project.id).not.toBe(created.id)
  })

  it('导入已确认项目时清除 working 与 baseline.definition 的人工确认并重算', async () => {
    const savedAt = '2024-01-02T03:04:05.000Z'
    const created = expectOk(
      await createProject({
        name: '已确认项目',
        working: chainA(),
        baseline: { savedAt, definition: chainA() },
        relationRevision: 1,
        relationReview: createRelationReview(chainA(), 1, savedAt),
      }),
    )
    const json = exportProjectJson(created)

    const imported = expectOk(await importProjectJson(json))

    expect(imported.project.relationReview).toBeNull()
    expect(imported.project.relationRevision).toBe(2)
    expect(imported.project.baseline?.savedAt).toBe(savedAt)
    // 数值、方向与结果不因清除确认而变化；结果由导入后的定义重新计算。
    expect(
      imported.project.working.terms.map((item) => item.id),
    ).toEqual(chainA().terms.map((item) => item.id))
    expect(imported.result).toEqual(calculateChain(imported.project.working))
    expect(imported.result.minQ).toBe(parseMm('0.1500'))
    expect(imported.result.maxQ).toBe(parseMm('0.3900'))
  })

  it('没有 ID 冲突时保留原项目 ID', async () => {
    const created = expectOk(await createProject({ working: chainA() }))
    const json = exportProjectJson(created)
    expectOk(await deleteProject(created.id))

    const imported = expectOk(await importProjectJson(json))
    expect(imported.idChanged).toBe(false)
    expect(imported.project.id).toBe(created.id)
    expect(expectOk(await getProject(created.id))).toEqual(imported.project)
  })

  it('ID 冲突时生成新 ID，旧项目保持不变', async () => {
    const created = expectOk(await createProject({ name: '旧项目', working: chainA() }))
    const json = exportProjectJson(created)

    const imported = expectOk(await importProjectJson(json))
    expect(imported.idChanged).toBe(true)
    expect(imported.project.id).not.toBe(created.id)
    expect(imported.project.name).toBe('旧项目')
    expect(expectOk(await getProject(created.id))).toEqual(created)

    const all = expectOk(await listProjects())
    expect(all).toHaveLength(2)
    expect(all.map((item) => item.id).sort()).toEqual(
      [created.id, imported.project.id].sort(),
    )
  })

  it('0 项空项目导出再导入成功，作为未完成项目保留且原项目不变', async () => {
    const empty = expectOk(await createEmptyProject('空项目'))
    const json = exportProjectJson(empty)

    const imported = expectOk(await importProjectJson(json))
    expect(imported.project.working.terms).toEqual([])
    expect(imported.project.name).toBe('空项目')
    expect(imported.result).toEqual(calculateChain(empty.working))
    expect(imported.idChanged).toBe(true)
    expect(imported.project.id).not.toBe(empty.id)
    expect(expectOk(await getProject(empty.id))).toEqual(empty)
    expect(expectOk(await listProjects())).toHaveLength(2)
  })

  it('1 项工作链仍拒收，已有项目保持不变', async () => {
    const existing = await seedProject()
    const before = expectOk(await listProjects())
    const json = mutateJson(exportProjectJson(existing), (raw) => {
      const terms = asRecord(raw.working).terms as Record<string, unknown>[]
      asRecord(raw.working).terms = [terms[0]]
    })

    const result = await importProjectJson(json)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.details.map((item) => item.code)).toContain('terms_count')
    }
    expect(expectOk(await listProjects())).toEqual(before)
    expect(expectOk(await getProject(existing.id))).toEqual(existing)
  })

  it('文件中的结果字段一律忽略，导入后必须重新计算', async () => {
    const created = expectOk(await createProject({ working: chainA() }))
    const expectedResult = calculateChain(created.working)
    const json = mutateJson(exportProjectJson(created), (raw) => {
      raw.result = {
        nominalQ: 999_999,
        minQ: 999_999,
        maxQ: 999_999,
        status: 'within',
      }
      asRecord(raw.working).result = { nominalQ: 888_888, status: 'within' }
    })

    const imported = expectOk(await importProjectJson(json))
    expect(imported.result).toEqual(expectedResult)
    expect(imported.project).not.toHaveProperty('result')
  })
})

describe('项目 JSON 拒收规则', () => {
  interface RejectionCase {
    name: string
    expectedCode: string
    makePayload: (validJson: string) => ProjectJsonInput
  }

  const rejectionCases: RejectionCase[] = [
    {
      name: '未知 schemaVersion',
      expectedCode: 'unknown_schema_version',
      makePayload: (json) =>
        mutateJson(json, (raw) => {
          raw.schemaVersion = 3
        }),
    },
    {
      name: '重复的组成环 ID',
      expectedCode: 'duplicate_id',
      makePayload: (json) =>
        mutateJson(json, (raw) => {
          const terms = asRecord(raw.working).terms as Record<string, unknown>[]
          terms[1].id = terms[0].id
        }),
    },
    {
      name: '重复的组成环代号',
      expectedCode: 'duplicate_symbol',
      makePayload: (json) =>
        mutateJson(json, (raw) => {
          const terms = asRecord(raw.working).terms as Record<string, unknown>[]
          terms[1].symbol = terms[0].symbol
        }),
    },
    {
      name: '非整数 q 值',
      expectedCode: 'invalid_integer',
      makePayload: (json) =>
        mutateJson(json, (raw) => {
          const terms = asRecord(raw.working).terms as Record<string, unknown>[]
          terms[0].nominalQ = 100.5
        }),
    },
    {
      name: '字符串 q 值',
      expectedCode: 'invalid_integer',
      makePayload: (json) =>
        mutateJson(json, (raw) => {
          const terms = asRecord(raw.working).terms as Record<string, unknown>[]
          terms[0].lowerDeviationQ = '0'
        }),
    },
    {
      name: '超出 MAX_ABS_Q',
      expectedCode: 'out_of_range',
      makePayload: (json) =>
        mutateJson(json, (raw) => {
          const terms = asRecord(raw.working).terms as Record<string, unknown>[]
          terms[0].nominalQ = MAX_ABS_Q + 1
        }),
    },
    {
      name: '坏日期格式',
      expectedCode: 'invalid_date',
      makePayload: (json) =>
        mutateJson(json, (raw) => {
          raw.createdAt = '2024-13-01T00:00:00.000Z'
        }),
    },
    {
      name: '不存在的日历日期',
      expectedCode: 'invalid_date',
      makePayload: (json) =>
        mutateJson(json, (raw) => {
          raw.updatedAt = '2024-02-30T00:00:00.000Z'
        }),
    },
    {
      name: '坏基线日期',
      expectedCode: 'invalid_date',
      makePayload: (json) =>
        mutateJson(json, (raw) => {
          raw.baseline = {
            savedAt: 'not-a-date',
            definition: asRecord(raw.working),
          }
        }),
    },
    {
      name: '组成环超过 20 项',
      expectedCode: 'too_many_terms',
      makePayload: (json) =>
        mutateJson(json, (raw) => {
          const terms = asRecord(raw.working).terms as Record<string, unknown>[]
          const template = terms[0]
          for (let index = terms.length; index <= MAX_CHAIN_TERMS; index += 1) {
            terms.push({
              ...template,
              id: `extra-${index}`,
              symbol: `X${index}`,
              name: `额外组成环 ${index}`,
            })
          }
        }),
    },
    {
      name: '未知单位声明',
      expectedCode: 'invalid_unit',
      makePayload: (json) =>
        mutateJson(json, (raw) => {
          raw.unit = 'mm'
        }),
    },
    {
      name: '非法 JSON',
      expectedCode: 'invalid_json',
      makePayload: () => '{ not json',
    },
    {
      name: '超过 1 MB',
      expectedCode: 'file_too_large',
      makePayload: () => 'x'.repeat(MAX_IMPORT_BYTES + 1),
    },
  ]

  it.each(rejectionCases)('拒收 $name 且不改动已有数据', async (testCase) => {
    const existing = await seedProject()
    const before = expectOk(await listProjects())
    const validJson = exportProjectJson(existing)

    const result = await importProjectJson(testCase.makePayload(validJson))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const codes = [
        result.error.code,
        ...result.error.details.map((item) => item.code),
      ]
      expect(codes).toContain(testCase.expectedCode)
    }

    expect(expectOk(await listProjects())).toEqual(before)
    expect(expectOk(await getProject(existing.id))).toEqual(existing)
  })
})

describe('V1 项目 JSON 导入：迁移到 v2、清确认、ID 冲突', () => {
  function legacyJson(id: string): string {
    return JSON.stringify({
      schemaVersion: 1,
      unit: 'q',
      qPerMm: Q_PER_MM,
      engineVersion: 'v1-engine',
      id,
      name: '旧文件项目',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      working: {
        terms: [
          {
            id: 'a-h',
            symbol: 'H',
            name: '孔',
            nominalQ: parseMm('100'),
            lowerDeviationQ: parseMm('0'),
            upperDeviationQ: parseMm('0.1'),
            sign: 1,
            sourceNote: '旧备注',
          },
          {
            id: 'a-b',
            symbol: 'B',
            name: '轴',
            nominalQ: parseMm('99.9'),
            lowerDeviationQ: parseMm('-0.05'),
            upperDeviationQ: parseMm('0'),
            sign: -1,
            sourceNote: '',
          },
        ],
        target: { minQ: parseMm('0.05'), maxQ: parseMm('0.2') },
        assumptions: '旧假设',
        relationConfirmed: true,
      },
      baseline: {
        savedAt: '2025-01-01T12:00:00.000Z',
        definition: {
          terms: [
            {
              id: 'b-h',
              symbol: 'H',
              name: '孔',
              nominalQ: parseMm('100'),
              lowerDeviationQ: parseMm('0'),
              upperDeviationQ: parseMm('0.05'),
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
    })
  }

  it('保留整数 q、基线与项目信息，补 termRevision=1，清除旧人工确认', async () => {
    const imported = expectOk(await importProjectJson(legacyJson('legacy-1')))

    expect(imported.project.schemaVersion).toBe(2)
    expect(imported.project.name).toBe('旧文件项目')
    expect(imported.project.engineVersion).toBe('v1-engine')
    expect(imported.project.working.terms.map((term) => term.nominalQ)).toEqual([
      parseMm('100'),
      parseMm('99.9'),
    ])
    expect(imported.project.working.terms.map((term) => term.termRevision)).toEqual([1, 1])
    expect(imported.project.working.terms[1].sign).toBe(-1)
    expect(imported.project.working.assumptions).toBe('旧假设')
    expect(imported.project.relationRevision).toBe(1)
    expect(imported.project.relationReview).toBeNull()
    expect(imported.project.baseline?.savedAt).toBe('2025-01-01T12:00:00.000Z')
    expect(
      imported.project.baseline?.definition.terms.map((term) => term.termRevision),
    ).toEqual([1, 1])
    expect(imported.migratedFrom).toBe(1)
    expect(imported.sources).toBeNull()
    expect(imported.warnings.join(' ')).toContain('V1')
    expect(imported.warnings.join(' ')).toContain('旧的人工确认没有版本凭据')
    // 文件里的结果字段从不读取，一律由导入后的定义重新计算。
    expect(imported.result).toEqual(calculateChain(imported.project.working))
  })

  it('ID 冲突时生成新 ID，已有项目不被覆盖', async () => {
    const existing = expectOk(
      await createProject({ name: '本地项目', working: chainA() }),
    )
    const imported = expectOk(await importProjectJson(legacyJson(existing.id)))

    expect(imported.idChanged).toBe(true)
    expect(imported.project.id).not.toBe(existing.id)
    expect(expectOk(await getProject(existing.id))).toEqual(existing)
    const all = expectOk(await listProjects())
    expect(all.map((project) => project.id).sort()).toEqual(
      [existing.id, imported.project.id].sort(),
    )
  })

  it('V1 文件里的非法数值仍整体拒收，零写入', async () => {
    const existing = await seedProject()
    const before = expectOk(await listProjects())
    const raw = JSON.parse(legacyJson('bad-1')) as {
      working: { terms: { nominalQ: number }[] }
    }
    raw.working.terms[0].nominalQ = 0.5
    const result = await importProjectJson(JSON.stringify(raw))
    expect(result.ok).toBe(false)
    expect(expectOk(await listProjects())).toEqual(before)
    expect(expectOk(await getProject(existing.id))).toEqual(existing)
  })
})

describe('V2 项目 JSON：来源元数据与绑定往返，附件不包含', () => {
  it('导出包含文档/版本/绑定与不含附件提示，导入后附件不可用', async () => {
    const project = expectOk(
      await createProject({
        name: '带来源项目',
        working: chainA(),
        relationRevision: 1,
        relationReview: createRelationReview(chainA(), 1, '2026-01-01T00:00:00.000Z'),
      }),
    )
    const bytes = buildSyntheticPdf({ pageCount: 2 })
    const source = await importSourceRevision({
      projectId: project.id,
      fileName: '图纸 A.pdf',
      bytes,
    })
    expect(source.ok, source.ok ? '' : source.error.message).toBe(true)
    if (!source.ok) {
      return
    }
    const revision = source.value.revision

    const binding = await createSourceBinding({
      projectId: project.id,
      termId: 'a-h',
      revisionId: revision.id,
      page: 1,
      rectPdf: [10, 20, 110, 120],
      pageBoxPdf: [0, 0, 600, 800],
      note: 'H 尺寸',
    })
    expect(binding.ok, binding.ok ? '' : binding.error.message).toBe(true)

    const exported = expectOk(await exportProject(project.id))
    const raw = JSON.parse(exported) as {
      schemaVersion: number
      relationReview: unknown
      sources: {
        attachmentsIncluded: boolean
        notice: string
        documents: unknown[]
        revisions: { blobKey: string }[]
        bindings: { rectPdf: number[]; reviewedTermRevision?: unknown }[]
      }
    }
    expect(raw.schemaVersion).toBe(2)
    expect(raw.relationReview).not.toBeNull()
    expect(raw.sources.attachmentsIncluded).toBe(false)
    expect(raw.sources.notice).toContain('数据备份不含来源附件')
    expect(raw.sources.documents).toHaveLength(1)
    expect(raw.sources.revisions).toHaveLength(1)
    expect(raw.sources.bindings).toHaveLength(1)
    expect(raw.sources.bindings[0].rectPdf).toEqual([10, 20, 110, 120])
    // JSON 里不能出现 Blob 字节。
    expect(exported).not.toContain('base64')

    const imported = expectOk(await importProjectJson(exported))
    expect(imported.project.relationReview).toBeNull()
    expect(imported.sources).toEqual({
      documents: 1,
      revisions: 1,
      bindings: 1,
      attachmentsMissing: true,
    })
    expect(imported.warnings.join(' ')).toContain('数据备份不含来源附件')

    const importedRevisions = expectOk(
      await listSourceRevisions(imported.project.id),
    )
    expect(importedRevisions).toHaveLength(1)
    expect(importedRevisions[0].blobKey).not.toBe(revision.blobKey)
    const importedBindings = expectOk(await listSourceBindings(imported.project.id))
    expect(importedBindings).toHaveLength(1)
    expect(importedBindings[0].termId).toBe('a-h')
    expect(importedBindings[0].page).toBe(1)
    expect(importedBindings[0].rectPdf).toEqual([10, 20, 110, 120])
    expect(importedBindings[0].revisionId).toBe(importedRevisions[0].id)
  })

  it('来源 ID 与本地冲突时整体重映射，引用保持一致', async () => {
    const first = expectOk(await createProject({ name: '第一个', working: chainA() }))
    const bytes = buildSyntheticPdf({ pageCount: 1 })
    const source = await importSourceRevision({
      projectId: first.id,
      fileName: '同名.pdf',
      bytes,
    })
    expect(source.ok).toBe(true)
    if (!source.ok) {
      return
    }
    const exported = expectOk(await exportProject(first.id))

    const second = expectOk(await importProjectJson(exported))
    expect(second.idChanged).toBe(true)
    const revisions = expectOk(await listSourceRevisions(second.project.id))
    const documents = expectOk(await listSourceDocuments(second.project.id))
    expect(revisions).toHaveLength(1)
    expect(documents).toHaveLength(1)
    expect(revisions[0].id).not.toBe(source.value.revision.id)
    expect(documents[0].id).not.toBe(source.value.document.id)
    expect(documents[0].latestRevisionId).toBe(revisions[0].id)
    expect(revisions[0].documentId).toBe(documents[0].id)
  })
})

describe('改代号：记录名称变化但不清来源数值核对', () => {
  it('代号变化写事件，termRevision 不变（来源核对保留）', async () => {
    const project = expectOk(
      await createProject({ name: '代号变化', working: chainA() }),
    )
    const draft = draftFromChain(chainA())
    draft.terms[0] = { ...draft.terms[0], symbol: 'H2' }
    draft.relationRevision = 1

    const saved = expectOk(await saveDraft(project.id, draft))
    expect(saved.modelUpdated).toBe(true)
    expect(saved.project.working.terms[0].symbol).toBe('H2')
    // 改代号不提升环修订号：来源数值核对凭据仍然对应当前数值。
    expect(saved.project.working.terms[0].termRevision).toBe(1)
    // 关系确认已失效（relationRevision 递增、没有凭据）。
    expect(saved.project.relationReview).toBeNull()

    const events = await withDatabase(async (db) => {
      const transaction = db.transaction(EVENT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction.objectStore(EVENT_STORE_NAME).getAll(),
      )
      await done
      return value as {
        type: string
        termId?: string
        before?: string
        after?: string
      }[]
    })
    const symbolEvent = events.find((event) => event.type === 'term_symbol_changed')
    expect(symbolEvent).toBeDefined()
    expect(symbolEvent?.termId).toBe('a-h')
    expect(symbolEvent?.before).toBe('H')
    expect(symbolEvent?.after).toBe('H2')

    // 改名称/备注不写代号事件。
    const renamed = draftFromChain(saved.project.working)
    renamed.terms[0] = { ...renamed.terms[0], name: '机架改名', sourceNote: '新备注' }
    renamed.relationRevision = 2
    expectOk(await saveDraft(project.id, renamed))
    const eventsAfter = await withDatabase(async (db) => {
      const transaction = db.transaction(EVENT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction.objectStore(EVENT_STORE_NAME).getAll(),
      )
      await done
      return value as { type: string }[]
    })
    expect(
      eventsAfter.filter((event) => event.type === 'term_symbol_changed'),
    ).toHaveLength(1)
  })
})
