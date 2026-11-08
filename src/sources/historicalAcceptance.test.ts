// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChainDefinition } from '../domain/types'
import { parseMm } from '../domain/units'
import {
  BINDING_STORE_NAME,
  EVENT_STORE_NAME,
  requestResult,
  transactionDone,
  withDatabase,
} from '../storage/db'
import { createProject, exportProjectJson, getProject, importProject, loadProjectSources } from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import {
  acceptHistoricalSource,
  createSourceBinding,
  getSourceBinding,
  listSourceBindings,
  rebindSourceBinding,
  reviewSourceBinding,
  type SourceBinding,
} from './bindings'
import { importSourceRevision } from './revisions'
import type { SourceRevision } from './types'

const PAGE_BOX = [0, 0, 600, 800] as const
const RECT_A = [50, 60, 250, 460] as const

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
  target: null,
  assumptions: '',
}

async function createTestProject(): Promise<string> {
  const created = await createProject({ name: '历史来源测试', working: chain })
  expect(created.ok).toBe(true)
  if (!created.ok) {
    throw new Error(created.error.message)
  }
  return created.value.id
}

async function importRevision(
  projectId: string,
  variant: string,
  fileName = '装配图.pdf',
  documentId?: string,
): Promise<SourceRevision> {
  const imported = await importSourceRevision({
    projectId,
    fileName,
    bytes: buildSyntheticPdf({ pageCount: 2, variant }),
    ...(documentId === undefined ? {} : { documentId }),
  })
  expect(imported.ok, imported.ok ? '' : imported.error.message).toBe(true)
  if (!imported.ok) {
    throw new Error(imported.error.message)
  }
  return imported.value.revision
}

async function eventsOfType(type: string): Promise<number> {
  return withDatabase(async (db) => {
    const transaction = db.transaction(EVENT_STORE_NAME, 'readonly')
    const done = transactionDone(transaction)
    const all = (await requestResult(
      transaction.objectStore(EVENT_STORE_NAME).getAll(),
    )) as { type: string }[]
    await done
    return all.filter((event) => event.type === type).length
  })
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

async function setupV1Binding(): Promise<{
  projectId: string
  v1: SourceRevision
  binding: SourceBinding
}> {
  const projectId = await createTestProject()
  const v1 = await importRevision(projectId, 'v1')
  const created = await createSourceBinding({
    projectId,
    termId: 't-h',
    revisionId: v1.id,
    page: 1,
    rectPdf: RECT_A,
    pageBoxPdf: PAGE_BOX,
    note: '孔公差框',
  })
  expect(created.ok, created.ok ? '' : created.error.message).toBe(true)
  if (!created.ok) {
    throw new Error(created.error.message)
  }
  return { projectId, v1, binding: created.value }
}

beforeEach(async () => {
  await deleteProjectDatabase()
})

describe('继续采用旧版来源（historicalAcceptance）', () => {
  it('理由与适用范围必填；缺失时零写入，绑定保持原样', async () => {
    const { projectId, v1, binding } = await setupV1Binding()
    await importRevision(projectId, 'v2', '装配图.pdf', v1.documentId)

    const emptyReason = await acceptHistoricalSource(binding.id, {
      reason: '   ',
      scope: '仅本轮',
    })
    expect(emptyReason.ok).toBe(false)
    if (!emptyReason.ok) {
      expect(emptyReason.error.message).toContain('理由')
    }

    const emptyScope = await acceptHistoricalSource(binding.id, {
      reason: '新版仅补充签署页',
      scope: ' ',
    })
    expect(emptyScope.ok).toBe(false)
    if (!emptyScope.ok) {
      expect(emptyScope.error.message).toContain('适用范围')
    }

    const after = await getSourceBinding(binding.id)
    expect(after.ok).toBe(true)
    if (after.ok) {
      expect(after.value?.historicalAcceptance).toBeNull()
      expect(after.value?.reviewedTermRevision).toBeNull()
    }
    expect(await eventsOfType('source_binding_historical_accepted')).toBe(0)
  })

  it('记录理由、适用范围、时间与本次处理的 latestRevisionId，并写入事件', async () => {
    const { projectId, v1, binding } = await setupV1Binding()
    const v2 = await importRevision(projectId, 'v2', '装配图.pdf', v1.documentId)

    const accepted = await acceptHistoricalSource(
      binding.id,
      { reason: '新版只是补充签署页', scope: '仅用于本轮尺寸校核' },
      { now: () => '2026-02-01T08:00:00.000Z' },
    )
    expect(accepted.ok, accepted.ok ? '' : accepted.error.message).toBe(true)
    if (!accepted.ok) {
      return
    }
    expect(accepted.value.historicalAcceptance).toEqual({
      reason: '新版只是补充签署页',
      scope: '仅用于本轮尺寸校核',
      acceptedAt: '2026-02-01T08:00:00.000Z',
      latestRevisionId: v2.id,
    })
    // 历史接受不代替数值核对。
    expect(accepted.value.reviewedTermRevision).toBeNull()
    expect(await eventsOfType('source_binding_historical_accepted')).toBe(1)

    const reloaded = await getSourceBinding(binding.id)
    expect(reloaded.ok).toBe(true)
    if (reloaded.ok) {
      expect(reloaded.value?.historicalAcceptance).toEqual(
        accepted.value.historicalAcceptance,
      )
    }
  })

  it('已是最新版本时拒绝接受，避免把最新版伪装成历史来源', async () => {
    const { projectId, v1, binding } = await setupV1Binding()
    const latest = await importRevision(projectId, 'v2', '装配图.pdf', v1.documentId)
    const rebound = await rebindSourceBinding(binding.id, {
      revisionId: latest.id,
      page: 1,
      rectPdf: RECT_A,
      pageBoxPdf: PAGE_BOX,
    })
    expect(rebound.ok).toBe(true)

    const accepted = await acceptHistoricalSource(binding.id, {
      reason: '不需要',
      scope: '不需要',
    })
    expect(accepted.ok).toBe(false)
    if (!accepted.ok) {
      expect(accepted.error.message).toContain('最新版本')
    }
    expect(await eventsOfType('source_binding_historical_accepted')).toBe(0)
  })

  it('之后再导入更新版本：已有接受记录不会被自动沿用', async () => {
    const { projectId, v1, binding } = await setupV1Binding()
    const v2 = await importRevision(projectId, 'v2', '装配图.pdf', v1.documentId)
    const accepted = await acceptHistoricalSource(binding.id, {
      reason: '旧理由',
      scope: '旧范围',
    })
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) {
      return
    }
    expect(accepted.value.historicalAcceptance?.latestRevisionId).toBe(v2.id)

    const v3 = await importRevision(projectId, 'v3', '装配图.pdf', v1.documentId)
    const reloaded = await getSourceBinding(binding.id)
    expect(reloaded.ok).toBe(true)
    if (reloaded.ok) {
      // 凭据原样保留，但 latestRevisionId 仍是 v2：规则会重新要求处置。
      expect(reloaded.value?.historicalAcceptance?.latestRevisionId).toBe(v2.id)
      expect(reloaded.value?.historicalAcceptance?.latestRevisionId).not.toBe(v3.id)
    }
  })

  it('换关联来源会清除旧的历史接受凭据', async () => {
    const { projectId, v1, binding } = await setupV1Binding()
    const v2 = await importRevision(projectId, 'v2', '装配图.pdf', v1.documentId)
    const accepted = await acceptHistoricalSource(binding.id, {
      reason: '继续旧版',
      scope: '仅本轮',
    })
    expect(accepted.ok).toBe(true)

    const rebound = await rebindSourceBinding(binding.id, {
      revisionId: v2.id,
      page: 1,
      rectPdf: RECT_A,
      pageBoxPdf: PAGE_BOX,
    })
    expect(rebound.ok).toBe(true)
    if (rebound.ok) {
      expect(rebound.value.historicalAcceptance).toBeNull()
    }
    const count = await bindingCount()
    expect(count).toBe(1)
  })

  it('外部 JSON 导入不采信文件中的核对与历史接受凭据', async () => {
    const { projectId, v1, binding } = await setupV1Binding()
    await importRevision(projectId, 'v2', '装配图.pdf', v1.documentId)
    const reviewed = await reviewSourceBinding(binding.id, { termRevision: 1 })
    expect(reviewed.ok).toBe(true)
    const accepted = await acceptHistoricalSource(binding.id, {
      reason: '继续旧版',
      scope: '仅本轮',
    })
    expect(accepted.ok).toBe(true)

    const project = await getProject(projectId)
    const sources = await loadProjectSources(projectId)
    expect(project.ok && sources.ok).toBe(true)
    if (!project.ok || !sources.ok || project.value === null) {
      return
    }
    const json = exportProjectJson(project.value, sources.value)
    expect(json).toContain('historicalAcceptance')

    const imported = await importProject(json)
    expect(imported.ok, imported.ok ? '' : imported.error.message).toBe(true)
    if (!imported.ok) {
      return
    }
    const importedBindings = await listSourceBindings(imported.value.project.id)
    expect(importedBindings.ok).toBe(true)
    if (!importedBindings.ok) {
      return
    }
    expect(importedBindings.value).toHaveLength(1)
    expect(importedBindings.value[0]).toMatchObject({
      reviewedTermRevision: null,
      reviewedAt: null,
      historicalAcceptance: null,
    })
  })
})
