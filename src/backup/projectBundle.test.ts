// @vitest-environment node
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChainDefinition, DimensionTerm, Project } from '../domain/types'
import { parseMm } from '../domain/units'
import type { AnalysisSnapshot } from '../history/snapshots'
import { createAnalysisSnapshot } from '../history/snapshots'
import { sha256Hex } from '../sources/hash'
import {
  acceptHistoricalSource,
  createSourceBinding,
  listSourceBindings,
  reviewSourceBinding,
} from '../sources/bindings'
import {
  importSourceRevision,
  listSourceDocuments,
  listSourceRevisions,
  readSourceBlobBytes,
} from '../sources/revisions'
import {
  createProject,
  exportProject,
  getDraft,
  getProject,
  importProject,
  listImportSnapshots,
  saveDraft,
} from '../storage/projects'
import {
  BINDING_STORE_NAME,
  DRAFT_STORE_NAME,
  EVENT_STORE_NAME,
  IMPORT_SNAPSHOT_STORE_NAME,
  MAPPING_TEMPLATE_STORE_NAME,
  MIGRATION_BACKUP_STORE_NAME,
  PROJECT_STORE_NAME,
  SNAPSHOT_STORE_NAME,
  SOURCE_BLOB_STORE_NAME,
  SOURCE_DOCUMENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
  requestResult,
  transactionDone,
  withDatabase,
} from '../storage/db'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import { deleteProjectDatabase } from '../test/projectDb'
import { chainToDraft } from '../workspace/draft'
import { createRelationReview } from '../workspace/relation'
import {
  MAPPING_TEMPLATES_EXCLUDED_NOTE,
  createProjectBundle,
  type ProjectBundle,
} from './projectBundle'
import { inspectBackup, restoreBackup } from './restore'
import { readZipEntries } from './zip'

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
    assumptions: '完整备份测试',
  }
}

function caseBaseline(): ChainDefinition {
  const chain = caseA()
  chain.terms[0] = { ...chain.terms[0], upperDeviationQ: parseMm('0.0300') }
  return chain
}

interface SeedResult {
  project: Project
  snapshot: AnalysisSnapshot
  bindingId: string
  revisionId: string
  blobKey: string
  blobSha256: string
  documentId: string
}

async function seedFullProject(): Promise<SeedResult> {
  const working = caseA()
  const created = await createProject({
    name: '完整备份项目',
    working,
    baseline: {
      savedAt: '2026-11-04T08:00:00.000Z',
      definition: caseBaseline(),
    },
    relationRevision: 1,
    relationReview: createRelationReview(
      working,
      1,
      '2026-11-05T08:00:00.000Z',
    ),
  })
  if (!created.ok) {
    throw new Error(created.error.message)
  }
  const project = created.value

  const draft = await saveDraft(project.id, chainToDraft(working), {
    relationState: {
      relationRevision: project.relationRevision,
      relationReview: project.relationReview,
    },
  })
  expect(draft.ok).toBe(true)

  const first = await importSourceRevision({
    projectId: project.id,
    fileName: 'source-v1.pdf',
    bytes: buildSyntheticPdf({ pageCount: 2, variant: 'v1' }),
  })
  if (!first.ok) {
    throw new Error(first.error.message)
  }
  const second = await importSourceRevision({
    projectId: project.id,
    documentId: first.value.document.id,
    fileName: 'source-v2.pdf',
    bytes: buildSyntheticPdf({ pageCount: 3, variant: 'v2' }),
  })
  if (!second.ok) {
    throw new Error(second.error.message)
  }

  const binding = await createSourceBinding({
    projectId: project.id,
    termId: 'h',
    revisionId: first.value.revision.id,
    page: 2,
    rectPdf: [20, 30, 220, 90],
    pageBoxPdf: [0, 0, 600, 800],
    note: 'H 的来源区域',
  })
  if (!binding.ok) {
    throw new Error(binding.error.message)
  }
  const accepted = await acceptHistoricalSource(binding.value.id, {
    reason: '旧版图纸仍是本次分析的依据',
    scope: '仅用于当前批次分析',
    acceptedAt: '2026-11-06T08:00:00.000Z',
  })
  if (!accepted.ok) {
    throw new Error(accepted.error.message)
  }
  const reviewed = await reviewSourceBinding(binding.value.id, {
    termRevision: 1,
    reviewedAt: '2026-11-06T09:00:00.000Z',
  })
  if (!reviewed.ok) {
    throw new Error(reviewed.error.message)
  }

  const secondBinding = await createSourceBinding({
    projectId: project.id,
    termId: 'b1',
    revisionId: second.value.revision.id,
    page: 3,
    rectPdf: [40, 50, 260, 110],
    pageBoxPdf: [0, 0, 600, 800],
    note: 'B1 的来源区域',
  })
  if (!secondBinding.ok) {
    throw new Error(secondBinding.error.message)
  }
  const reviewedSecond = await reviewSourceBinding(secondBinding.value.id, {
    termRevision: 1,
  })
  if (!reviewedSecond.ok) {
    throw new Error(reviewedSecond.error.message)
  }

  const snapshot = await createAnalysisSnapshot({
    project,
    draft: chainToDraft(working),
    relationState: {
      relationRevision: project.relationRevision,
      relationReview: project.relationReview,
    },
    baseline: project.baseline,
    now: '2026-11-07T08:00:00.000Z',
  })
  if (!snapshot.ok) {
    throw new Error(snapshot.error.message)
  }

  // 历史与全局排除项：替换前快照、迁移备份、全局映射模板。
  await withDatabase(async (db) => {
    const transaction = db.transaction(
      [IMPORT_SNAPSHOT_STORE_NAME, MIGRATION_BACKUP_STORE_NAME, MAPPING_TEMPLATE_STORE_NAME],
      'readwrite',
    )
    const done = transactionDone(transaction)
    transaction.objectStore(IMPORT_SNAPSHOT_STORE_NAME).add({
      id: 'import-snapshot-fixture',
      projectId: project.id,
      createdAt: '2026-11-06T10:00:00.000Z',
      kind: 'replace-before-import',
      definition: caseBaseline(),
    })
    transaction.objectStore(MIGRATION_BACKUP_STORE_NAME).add({
      id: 'migration-backup-fixture',
      projectId: project.id,
      original: { schemaVersion: 1, id: project.id },
    })
    transaction.objectStore(MAPPING_TEMPLATE_STORE_NAME).add({
      id: 'global-template-fixture',
      name: '全局映射模板',
      mapping: { symbol: '代号', nominal: '基本尺寸' },
    })
    await done
  })

  return {
    project,
    snapshot: snapshot.value,
    bindingId: binding.value.id,
    revisionId: first.value.revision.id,
    blobKey: first.value.revision.blobKey,
    blobSha256: first.value.revision.sha256,
    documentId: first.value.document.id,
  }
}

async function makeBundle(): Promise<ProjectBundle> {
  const bundle = await createProjectBundle({
    now: '2026-11-08T12:00:00.000Z',
  })
  if (!bundle.ok) {
    throw new Error(bundle.error.message)
  }
  return bundle.value
}

/** 逐 store 导出可比对快照；Blob 用 SHA-256 表示字节内容。 */
async function dumpStores(): Promise<Record<string, unknown>> {
  return withDatabase(async (db) => {
    const stores = [
      PROJECT_STORE_NAME,
      DRAFT_STORE_NAME,
      SOURCE_DOCUMENT_STORE_NAME,
      SOURCE_REVISION_STORE_NAME,
      SOURCE_BLOB_STORE_NAME,
      BINDING_STORE_NAME,
      EVENT_STORE_NAME,
      SNAPSHOT_STORE_NAME,
      IMPORT_SNAPSHOT_STORE_NAME,
      MIGRATION_BACKUP_STORE_NAME,
      MAPPING_TEMPLATE_STORE_NAME,
    ]
    const transaction = db.transaction(stores, 'readonly')
    const done = transactionDone(transaction)
    const result: Record<string, unknown> = {}
    const blobRows: Record<string, unknown>[] = []
    for (const storeName of stores) {
      const rows = (await requestResult(
        transaction.objectStore(storeName).getAll(),
      )) as Record<string, unknown>[]
      if (storeName === SOURCE_BLOB_STORE_NAME) {
        blobRows.push(...rows)
      } else {
        result[storeName] = rows
      }
    }
    await done
    const blobs = []
    for (const row of blobRows) {
      const blob = row.blob as Blob
      const bytes = new Uint8Array(await blob.arrayBuffer())
      blobs.push({
        blobKey: row.blobKey,
        projectId: row.projectId,
        sha256: row.sha256,
        byteSize: row.byteSize,
        bytesSha256: await sha256Hex(bytes),
      })
    }
    result[SOURCE_BLOB_STORE_NAME] = blobs
    return result
  })
}

function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)),
  )
}

describe('完整备份：生成', () => {
  it('manifest 明示不含全局映射模板，包含来源文件字节、版本、历史与快照', async () => {
    const seed = await seedFullProject()
    const bundle = await makeBundle()

    expect(bundle.fileName).toBe('寸链完整备份-2026-11-08.cunlian.zip')
    const read = await readZipEntries(bundle.bytes)
    expect(read.ok).toBe(true)
    if (!read.ok) {
      return
    }
    const files = read.value
    const manifestBytes = files.get('manifest.json')
    expect(manifestBytes).toBeDefined()
    if (manifestBytes === undefined) {
      return
    }
    const manifest = JSON.parse(
      new TextDecoder().decode(manifestBytes),
    ) as ProjectBundle['manifest']

    expect(manifest.format).toBe('cunlian-backup')
    expect(manifest.excludes.mappingTemplates.included).toBe(false)
    expect(manifest.excludes.mappingTemplates.count).toBe(1)
    expect(manifest.excludes.mappingTemplates.note).toBe(
      MAPPING_TEMPLATES_EXCLUDED_NOTE,
    )
    expect(manifest.counts).toMatchObject({
      projects: 1,
      drafts: 1,
      documents: 1,
      revisions: 2,
      blobs: 2,
      bindings: 2,
      snapshots: 1,
      importSnapshots: 1,
      migrationBackups: 1,
    })
    expect(
      [...files.keys()].some((path) => path.startsWith('mappingTemplates/')),
    ).toBe(false)

    // 来源文件字节真实存在，且与版本记录的哈希一致。
    const blobFile = files.get(`sourceFiles/${seed.blobKey}.bin`)
    expect(blobFile).toBeDefined()
    if (blobFile !== undefined) {
      expect(await sha256Hex(blobFile)).toBe(seed.blobSha256)
    }
    expect(files.get(`snapshots/${seed.snapshot.id}.json`)).toBeDefined()

    // manifest 逐个文件哈希与实际字节一致。
    for (const entry of manifest.entries) {
      const bytes = files.get(entry.path)
      expect(bytes, entry.path).toBeDefined()
      if (bytes !== undefined) {
        expect(await sha256Hex(bytes)).toBe(entry.sha256)
        expect(bytes.byteLength).toBe(entry.byteSize)
      }
    }
    expect(files.size).toBe(manifest.entries.length + 1)
  })

  it('解压总量按最终 ZIP 全部条目累计，临近上限时不会导出成功、恢复失败', async () => {
    await seedFullProject()
    const full = await createProjectBundle({
      now: '2026-11-08T12:00:00.000Z',
    })
    expect(full.ok).toBe(true)
    if (!full.ok) {
      return
    }
    // payload 恰好等于上限：旧实现只累计 payload，会通过；修复后 manifest.json
    // 也计入最终 ZIP 总量，必须拒绝。
    const payloadBytes = full.value.manifest.totalUncompressedBytes
    const tooTight = await createProjectBundle({
      now: '2026-11-08T12:00:00.000Z',
      maxUncompressedBytes: payloadBytes,
    })
    expect(tooTight.ok).toBe(false)
    if (!tooTight.ok) {
      expect(tooTight.error.code).toBe('too_large')
      expect(tooTight.error.detail).toContain('manifest.json')
    }

    // 留出 manifest 的空间后可以正常导出，证明拒绝原因确实只是口径差异。
    const enough = await createProjectBundle({
      now: '2026-11-08T12:00:00.000Z',
      maxUncompressedBytes: payloadBytes + 64 * 1024,
    })
    expect(enough.ok).toBe(true)
  })

  it('空库或存在未迁移旧版项目时拒绝生成，不产出不可恢复的包', async () => {
    const empty = await createProjectBundle()
    expect(empty.ok).toBe(false)
    if (!empty.ok) {
      expect(empty.error.code).toBe('empty_backup')
    }

    await withDatabase(async (db) => {
      const transaction = db.transaction(PROJECT_STORE_NAME, 'readwrite')
      const done = transactionDone(transaction)
      transaction.objectStore(PROJECT_STORE_NAME).put({
        schemaVersion: 1,
        id: 'legacy-project',
        name: '未迁移项目',
        working: caseA(),
      })
      await done
    })

    const legacy = await createProjectBundle()
    expect(legacy.ok).toBe(false)
    if (!legacy.ok) {
      expect(legacy.error.code).toBe('legacy_projects')
      expect(legacy.error.message).toContain('迁移')
    }
  })
})

describe('完整备份：空库恢复', () => {
  it('数值、文件哈希、绑定坐标一致；人工确认清除；历史与草稿保留', async () => {
    const seed = await seedFullProject()
    const bundle = await makeBundle()

    const before = await dumpStores()
    const beforeProject = await getProject(seed.project.id)
    const beforeBindings = await listSourceBindings(seed.project.id)
    const beforeRevisionBytes = await readSourceBlobBytes(seed.blobKey)
    expect(beforeProject.ok && beforeProject.value !== null).toBe(true)
    expect(beforeBindings.ok).toBe(true)
    expect(beforeRevisionBytes.ok).toBe(true)

    await deleteProjectDatabase()

    const inspected = await inspectBackup(bundle.bytes)
    expect(inspected.ok).toBe(true)
    if (inspected.ok) {
      expect(inspected.value.projectSummaries[0].id).toBe(seed.project.id)
      expect(inspected.value.counts.revisions).toBe(2)
    }

    const restored = await restoreBackup(bundle.bytes, {
      now: '2026-11-08T13:00:00.000Z',
    })
    expect(restored.ok).toBe(true)
    if (!restored.ok) {
      return
    }
    expect(restored.value.projects).toEqual([
      { id: seed.project.id, name: seed.project.name },
    ])
    expect(restored.value.confirmationsCleared).toBe(true)

    const project = await getProject(seed.project.id)
    expect(project.ok).toBe(true)
    if (!project.ok || project.value === null) {
      return
    }
    expect(project.value.working).toEqual(seed.project.working)
    expect(project.value.baseline).toEqual(seed.project.baseline)
    expect(project.value.relationRevision).toBe(seed.project.relationRevision)
    // 人工确认清除：数值保留，凭据置空。
    expect(project.value.relationReview).toBeNull()

    const bindings = await listSourceBindings(seed.project.id)
    expect(bindings.ok).toBe(true)
    if (bindings.ok) {
      const binding = bindings.value.find((item) => item.id === seed.bindingId)
      expect(binding).toBeDefined()
      if (binding !== undefined) {
        expect(binding.rectPdf).toEqual([20, 30, 220, 90])
        expect(binding.pageBoxPdf).toEqual([0, 0, 600, 800])
        expect(binding.page).toBe(2)
        expect(binding.revisionId).toBe(seed.revisionId)
        expect(binding.reviewedTermRevision).toBeNull()
        expect(binding.reviewedAt).toBeNull()
        expect(binding.historicalAcceptance).toBeNull()
      }
    }

    // 文件哈希与字节长度一致。
    const revisions = await listSourceRevisions(seed.project.id)
    expect(revisions.ok).toBe(true)
    if (revisions.ok) {
      const revision = revisions.value.find(
        (item) => item.id === seed.revisionId,
      )
      expect(revision?.sha256).toBe(seed.blobSha256)
      expect(revision?.fileName).toBe('source-v1.pdf')
    }
    const bytes = await readSourceBlobBytes(seed.blobKey)
    expect(bytes.ok).toBe(true)
    if (bytes.ok && bytes.value !== null) {
      expect(await sha256Hex(bytes.value)).toBe(seed.blobSha256)
      expect(beforeRevisionBytes.ok && beforeRevisionBytes.value !== null).toBe(
        true,
      )
      if (beforeRevisionBytes.ok && beforeRevisionBytes.value !== null) {
        expect(bytes.value.byteLength).toBe(
          beforeRevisionBytes.value.byteLength,
        )
      }
    }

    // 草稿、分析快照、替换前快照、迁移备份保留；映射模板不进入备份。
    const draft = await getDraft(seed.project.id)
    expect(draft.ok).toBe(true)
    if (draft.ok && draft.value !== null) {
      expect(draft.value.draft).toEqual(chainToDraft(seed.project.working))
    }
    const snapshots = await withDatabase(async (db) => {
      const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const rows = (await requestResult(
        transaction.objectStore(SNAPSHOT_STORE_NAME).getAll(),
      )) as AnalysisSnapshot[]
      await done
      return rows
    })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toEqual(seed.snapshot)

    const importSnapshots = await listImportSnapshots(seed.project.id)
    expect(importSnapshots.ok).toBe(true)
    if (importSnapshots.ok) {
      expect(importSnapshots.value).toHaveLength(1)
    }

    const migrationBackups = await withDatabase(async (db) => {
      const transaction = db.transaction(MIGRATION_BACKUP_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const rows = await requestResult(
        transaction.objectStore(MIGRATION_BACKUP_STORE_NAME).getAll(),
      )
      await done
      return rows
    })
    expect(migrationBackups).toHaveLength(1)
    const templates = await withDatabase(async (db) => {
      const transaction = db.transaction(MAPPING_TEMPLATE_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const count = await requestResult(
        transaction.objectStore(MAPPING_TEMPLATE_STORE_NAME).count(),
      )
      await done
      return count
    })
    expect(templates).toBe(0)

    // 恢复事件与数据同事务写入，原事件保留。
    const events = await withDatabase(async (db) => {
      const transaction = db.transaction(EVENT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const rows = (await requestResult(
        transaction.objectStore(EVENT_STORE_NAME).getAll(),
      )) as { type: string; id: string }[]
      await done
      return rows
    })
    const beforeEvents = before[EVENT_STORE_NAME] as { type: string; id: string }[]
    expect(events.length).toBe(beforeEvents.length + 1)
    expect(events.some((event) => event.type === 'project_restored_from_bundle')).toBe(
      true,
    )
    // 原有事件逐条深比较（排除恢复新增事件），不只比数量。
    const restoredOriginals = events
      .filter((event) => event.type !== 'project_restored_from_bundle')
      .sort((left, right) => left.id.localeCompare(right.id))
    const expectedOriginals = [...beforeEvents].sort((left, right) =>
      left.id.localeCompare(right.id),
    )
    expect(restoredOriginals).toEqual(expectedOriginals)
  })

  it('JSON 导入产生的合法缺附件项目可以完整备份，并在空库恢复为附件不可用', async () => {
    const seed = await seedFullProject()
    const exported = await exportProject(seed.project.id)
    expect(exported.ok).toBe(true)
    if (!exported.ok) {
      return
    }
    const imported = await importProject(exported.value)
    expect(imported.ok).toBe(true)
    if (!imported.ok) {
      return
    }
    expect(imported.value.sources?.attachmentsMissing).toBe(true)
    const importedProject = imported.value.project
    const importedRevisions = await listSourceRevisions(importedProject.id)
    expect(importedRevisions.ok).toBe(true)
    if (!importedRevisions.ok) {
      return
    }
    expect(importedRevisions.value.length).toBeGreaterThan(0)

    const bundle = await makeBundle()
    const importedBlobKeys = new Set(
      importedRevisions.value.map((revision) => revision.blobKey),
    )
    const declared = bundle.manifest.missingAttachments.filter((item) =>
      importedBlobKeys.has(item.blobKey),
    )
    expect(declared).toHaveLength(importedRevisions.value.length)
    expect(bundle.manifest.counts.revisions).toBe(4)
    expect(bundle.manifest.counts.blobs).toBe(2)

    const read = await readZipEntries(bundle.bytes)
    expect(read.ok).toBe(true)
    if (!read.ok) {
      return
    }
    for (const revision of importedRevisions.value) {
      expect(read.value.has(`sourceFiles/${revision.blobKey}.bin`)).toBe(false)
      expect(read.value.has(`sourceBlobs/${revision.blobKey}.json`)).toBe(false)
    }

    await deleteProjectDatabase()
    const restored = await restoreBackup(bundle.bytes, {
      now: '2026-11-08T13:30:00.000Z',
    })
    expect(restored.ok).toBe(true)
    if (!restored.ok) {
      return
    }

    const restoredRevisions = await listSourceRevisions(importedProject.id)
    expect(restoredRevisions.ok).toBe(true)
    if (!restoredRevisions.ok) {
      return
    }
    expect(restoredRevisions.value).toHaveLength(importedRevisions.value.length)
    for (const revision of restoredRevisions.value) {
      // 恢复接受“附件缺失”，但绝不伪造 Blob：读取结果仍为 null。
      const bytes = await readSourceBlobBytes(revision.blobKey)
      expect(bytes.ok).toBe(true)
      if (bytes.ok) {
        expect(bytes.value).toBeNull()
      }
    }
  })

  it('写入中途失败时整体回滚，所有 store 保持空库', async () => {
    await seedFullProject()
    const bundle = await makeBundle()
    await deleteProjectDatabase()
    const before = await dumpStores()

    const restored = await restoreBackup(bundle.bytes, {
      afterPartialWrite: () => {
        throw new Error('模拟写入中途失败')
      },
    })
    expect(restored.ok).toBe(false)
    if (!restored.ok) {
      expect(restored.error.code).toBe('write_failed')
      expect(restored.error.detail).toContain('模拟写入中途失败')
    }
    expect(await dumpStores()).toEqual(before)
  })

  it('目标库非空时拒绝恢复，所有 store 前后一致', async () => {
    await seedFullProject()
    const bundle = await makeBundle()
    const before = await dumpStores()

    const restored = await restoreBackup(bundle.bytes)
    expect(restored.ok).toBe(false)
    if (!restored.ok) {
      expect(restored.error.code).toBe('database_not_empty')
    }
    expect(await dumpStores()).toEqual(before)
  })
})

describe('完整备份：历史快照兼容（F3）', () => {
  it('快照冻结 v1 而来源文档已升级 v2 时仍可导出并恢复，冻结指针与历史结论不变', async () => {
    const working = caseA()
    const created = await createProject({
      name: '历史快照项目',
      working,
      baseline: {
        savedAt: '2026-11-04T08:00:00.000Z',
        definition: caseBaseline(),
      },
      relationRevision: 1,
      relationReview: createRelationReview(
        working,
        1,
        '2026-11-05T08:00:00.000Z',
      ),
    })
    if (!created.ok) {
      throw new Error(created.error.message)
    }
    const project = created.value
    const draft = await saveDraft(project.id, chainToDraft(working), {
      relationState: {
        relationRevision: project.relationRevision,
        relationReview: project.relationReview,
      },
    })
    expect(draft.ok).toBe(true)

    // 快照创建时文档只有 v1：冻结清单里的 latestRevisionId 指向 v1。
    const first = await importSourceRevision({
      projectId: project.id,
      fileName: 'source-v1.pdf',
      bytes: buildSyntheticPdf({ pageCount: 2, variant: 'v1' }),
    })
    if (!first.ok) {
      throw new Error(first.error.message)
    }
    const frozen = await createAnalysisSnapshot({
      project,
      draft: chainToDraft(working),
      relationState: {
        relationRevision: project.relationRevision,
        relationReview: project.relationReview,
      },
      baseline: project.baseline,
      now: '2026-11-06T08:00:00.000Z',
    })
    if (!frozen.ok) {
      throw new Error(frozen.error.message)
    }
    expect(frozen.value.sourceManifest.documents).toHaveLength(1)
    expect(frozen.value.sourceManifest.documents[0].latestRevisionId).toBe(
      first.value.revision.id,
    )
    expect(frozen.value.comparison).not.toBeNull()

    // 之后来源文档升级到 v2：这是正常的当前状态，不是历史快照的变更。
    const second = await importSourceRevision({
      projectId: project.id,
      documentId: first.value.document.id,
      fileName: 'source-v2.pdf',
      bytes: buildSyntheticPdf({ pageCount: 3, variant: 'v2' }),
    })
    if (!second.ok) {
      throw new Error(second.error.message)
    }
    expect(second.value.document.latestRevisionId).toBe(
      second.value.revision.id,
    )
    expect(second.value.revision.id).not.toBe(first.value.revision.id)

    // 文档标题也是可编辑的当前元数据：这里直接改库模拟改名（当前没有改名 API），
    // 快照仍冻结旧标题。恢复不得因标题漂移拒绝历史快照。
    const renamedTitle = 'source-v2 改名后.pdf'
    await withDatabase(async (db) => {
      const transaction = db.transaction(SOURCE_DOCUMENT_STORE_NAME, 'readwrite')
      const done = transactionDone(transaction)
      const store = transaction.objectStore(SOURCE_DOCUMENT_STORE_NAME)
      const record = (await requestResult(
        store.get(first.value.document.id),
      )) as Record<string, unknown>
      store.put({ ...record, title: renamedTitle })
      await done
    })

    const bundle = await makeBundle()
    await deleteProjectDatabase()

    const restored = await restoreBackup(bundle.bytes, {
      now: '2026-11-08T13:10:00.000Z',
    })
    expect(restored.ok, restored.ok ? '' : `${restored.error.code}: ${restored.error.message}`).toBe(true)
    if (!restored.ok) {
      return
    }

    // 当前文档仍是 v2：恢复不回退“当前”指针。
    const documents = await listSourceDocuments(project.id)
    expect(documents.ok).toBe(true)
    if (documents.ok) {
      expect(documents.value).toHaveLength(1)
      expect(documents.value[0].latestRevisionId).toBe(
        second.value.revision.id,
      )
      expect(documents.value[0].title).toBe(renamedTitle)
    }

    // 冻结快照原样保留：指针仍是 v1，结果/审查/冻结对比逐字段不变。
    const snapshots = await withDatabase(async (db) => {
      const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const rows = (await requestResult(
        transaction.objectStore(SNAPSHOT_STORE_NAME).getAll(),
      )) as AnalysisSnapshot[]
      await done
      return rows
    })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].sourceManifest.documents[0].latestRevisionId).toBe(
      first.value.revision.id,
    )
    expect(snapshots[0].sourceManifest.documents[0].title).toBe(
      first.value.document.title,
    )
    expect(snapshots[0]).toEqual(frozen.value)
  })
})

describe('完整备份：恶意与坏结构 ZIP 真实夹具', () => {
  it('每个路径穿越变体、结构坏包与引用错误都按具体错误码拒绝且零写入', async () => {
    const cases: { name: string; code: string }[] = [
      {
        name: 'malicious-traversal-relative.cunlian.zip',
        code: 'unsafe_path',
      },
      {
        name: 'malicious-traversal-absolute.cunlian.zip',
        code: 'unsafe_path',
      },
      {
        name: 'malicious-traversal-backslash.cunlian.zip',
        code: 'unsafe_path',
      },
      {
        name: 'malicious-traversal-encoded.cunlian.zip',
        code: 'unsafe_path',
      },
      {
        name: 'malicious-duplicate-entry.cunlian.zip',
        code: 'duplicate_entry',
      },
      {
        name: 'malicious-too-many-entries.cunlian.zip',
        code: 'too_many_entries',
      },
      { name: 'malicious-too-large.cunlian.zip', code: 'too_large' },
      {
        name: 'malicious-hash-mismatch.cunlian.zip',
        code: 'hash_mismatch',
      },
      {
        name: 'malicious-missing-reference.cunlian.zip',
        code: 'missing_reference',
      },
      {
        name: 'invalid-cross-project-blob.cunlian.zip',
        code: 'missing_reference',
      },
      {
        name: 'invalid-snapshot-review.cunlian.zip',
        code: 'invalid_record',
      },
      {
        name: 'invalid-snapshot-binding.cunlian.zip',
        code: 'invalid_record',
      },
      {
        name: 'invalid-snapshot-documents.cunlian.zip',
        code: 'invalid_record',
      },
      {
        name: 'invalid-snapshot-inconsistent.cunlian.zip',
        code: 'invalid_record',
      },
      {
        name: 'invalid-snapshot-comparison.cunlian.zip',
        code: 'invalid_record',
      },
      {
        name: 'invalid-snapshot-pointer.cunlian.zip',
        code: 'invalid_record',
      },
    ]

    for (const testCase of cases) {
      const before = await dumpStores()
      const result = await restoreBackup(fixture(testCase.name))
      expect(result.ok, testCase.name).toBe(false)
      if (!result.ok) {
        expect(result.error.code, testCase.name).toBe(testCase.code)
      }
      expect(await dumpStores(), `${testCase.name} 零写入`).toEqual(before)
    }
  })

  it('新坏包夹具按预期原因拒绝：缺基线却带冻结对比、冻结指针指向清单外版本', async () => {
    const comparison = await restoreBackup(
      fixture('invalid-snapshot-comparison.cunlian.zip'),
    )
    expect(comparison.ok).toBe(false)
    if (!comparison.ok) {
      expect(comparison.error.code).toBe('invalid_record')
      expect(comparison.error.message).toContain('有冻结对比结果却没有基线')
    }

    const pointer = await restoreBackup(
      fixture('invalid-snapshot-pointer.cunlian.zip'),
    )
    expect(pointer.ok).toBe(false)
    if (!pointer.ok) {
      expect(pointer.error.code).toBe('invalid_record')
      expect(pointer.error.message).toContain('最新版本不在清单内')
    }
  })

  it('拒绝跨项目 Blob 引用，按 missing_reference 说明项目作用域', async () => {
    const result = await restoreBackup(
      fixture('invalid-cross-project-blob.cunlian.zip'),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('missing_reference')
      expect(result.error.message).toContain('项目作用域不一致')
      expect(result.error.message).toContain('跨项目')
    }
  })

  it('合法最小备份可以恢复（对照组）', async () => {
    const result = await restoreBackup(fixture('valid-minimal.cunlian.zip'), {
      now: '2026-11-08T14:00:00.000Z',
    })
    expect(result.ok).toBe(true)
    const project = await getProject('fixture-project')
    expect(project.ok).toBe(true)
    if (project.ok && project.value !== null) {
      expect(project.value.name).toBe('夹具项目')
      expect(project.value.relationReview).toBeNull()
    }
  })
})
