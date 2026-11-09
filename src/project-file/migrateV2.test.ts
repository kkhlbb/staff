// @vitest-environment node
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChainDefinition, DimensionTerm } from '../domain/types'
import { calculateChain } from '../domain/calculate'
import { parseMm } from '../domain/units'
import type { AnalysisSnapshot } from '../history/snapshots'
import { createAnalysisSnapshot } from '../history/snapshots'
import { sha256Hex } from '../sources/hash'
import {
  acceptHistoricalSource,
  createSourceBinding,
  reviewSourceBinding,
} from '../sources/bindings'
import { importSourceRevision } from '../sources/revisions'
import {
  createProject,
  exportProject,
  saveDraft,
} from '../storage/projects'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import { deleteProjectDatabase } from '../test/projectDb'
import { chainToDraft } from '../workspace/draft'
import { createRelationReview } from '../workspace/relation'
import {
  backupPath,
  createProjectBundle,
} from '../backup/projectBundle'
import { parseBackup } from '../backup/restoreParser'
import { readZipEntries, writeZipEntries } from '../backup/zip'
import { evaluateReviewChecklist } from '../review/rules'
import { inspectV2Bundle, inspectV2Json, migrateV2Bundle, migrateV2Json } from './migrateV2'
import { PROJECT_FILE_SCHEMA_VERSION } from './types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

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
    sourceNote: `${symbol} 来源备注`,
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
    assumptions: 'A-03 迁移测试',
  }
}

function caseBaseline(): ChainDefinition {
  const chain = caseA()
  chain.terms[0] = { ...chain.terms[0], upperDeviationQ: parseMm('0.0300') }
  return chain
}

interface SeedResult {
  projectId: string
  projectName: string
  snapshot: AnalysisSnapshot
  relationRevision: number
  revisionV1Id: string
  blobKey: string
  blobSha256: string
  documentId: string
}

async function seedFullProject(name = '迁移样本项目'): Promise<SeedResult> {
  const working = caseA()
  const created = await createProject({
    name,
    working,
    baseline: { savedAt: '2026-11-04T08:00:00.000Z', definition: caseBaseline() },
    relationRevision: 3,
    relationReview: createRelationReview(working, 3, '2026-11-05T08:00:00.000Z'),
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

  return {
    projectId: project.id,
    projectName: project.name,
    snapshot: snapshot.value,
    relationRevision: project.relationRevision,
    revisionV1Id: first.value.revision.id,
    blobKey: first.value.revision.blobKey,
    blobSha256: first.value.revision.sha256,
    documentId: first.value.document.id,
  }
}

async function makeBundle(): Promise<Uint8Array> {
  const bundle = await createProjectBundle({ now: '2026-11-08T12:00:00.000Z' })
  if (!bundle.ok) {
    throw new Error(bundle.error.message)
  }
  return bundle.value.bytes
}

type JsonPart = unknown

interface BundleEditor {
  getJson: (path: string) => JsonPart
  setJson: (path: string, value: JsonPart) => void
  setBytes: (path: string, bytes: Uint8Array) => void
  paths: () => string[]
}

/** 只改 ZIP 载荷后按 V2 manifest 规则重算 entries/size/counts；用于负向样本。 */
async function rewriteBundle(
  bytes: Uint8Array,
  mutate: (editor: BundleEditor) => void,
): Promise<Uint8Array> {
  const read = await readZipEntries(bytes)
  if (!read.ok) {
    throw new Error(read.error.message)
  }
  const manifestBytes = read.value.get('manifest.json')
  if (manifestBytes === undefined) {
    throw new Error('缺少 manifest.json')
  }
  const manifest = JSON.parse(decoder.decode(manifestBytes)) as Record<string, unknown>
  const parts = new Map<string, Uint8Array>()
  for (const [path, data] of read.value) {
    if (path !== 'manifest.json') {
      parts.set(path, data)
    }
  }
  const editor: BundleEditor = {
    getJson: (path) => {
      const data = parts.get(path)
      if (data === undefined) {
        throw new Error(`缺少条目 ${path}`)
      }
      return JSON.parse(decoder.decode(data)) as JsonPart
    },
    setJson: (path, value) => {
      parts.set(path, encoder.encode(`${JSON.stringify(value, null, 2)}\n`))
    },
    setBytes: (path, value) => {
      parts.set(path, value)
    },
    paths: () => [...parts.keys()],
  }
  mutate(editor)

  const counts = {
    projects: 0,
    drafts: 0,
    documents: 0,
    revisions: 0,
    blobs: 0,
    bindings: 0,
    events: 0,
    snapshots: 0,
    importSnapshots: 0,
    migrationBackups: 0,
  }
  const entries: { path: string; sha256: string; byteSize: number }[] = []
  let total = 0
  for (const [path, data] of parts) {
    const prefix = path.slice(0, path.indexOf('/') + 1)
    if (prefix === 'projects/') counts.projects += 1
    else if (prefix === 'drafts/') counts.drafts += 1
    else if (prefix === 'sourceDocuments/') counts.documents += 1
    else if (prefix === 'sourceRevisions/') counts.revisions += 1
    else if (prefix === 'sourceBlobs/') counts.blobs += 1
    else if (prefix === 'bindings/') counts.bindings += 1
    else if (prefix === 'events/') counts.events += 1
    else if (prefix === 'snapshots/') counts.snapshots += 1
    else if (prefix === 'importSnapshots/') counts.importSnapshots += 1
    else if (prefix === 'migrationBackups/') counts.migrationBackups += 1
    entries.push({ path, sha256: await sha256Hex(data), byteSize: data.byteLength })
    total += data.byteLength
  }
  entries.sort((left, right) => (left.path < right.path ? -1 : 1))
  manifest.entries = entries
  manifest.totalUncompressedBytes = total
  manifest.counts = counts
  const written = await writeZipEntries([
    ...[...parts].map(([path, data]) => ({ path, bytes: data })),
    {
      path: 'manifest.json',
      bytes: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`),
      level: 6,
    },
  ])
  if (!written.ok) {
    throw new Error(written.error.message)
  }
  return written.value
}

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../backup/__fixtures__/${name}`, import.meta.url)))
}

function text(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

describe('V2 完整备份：预检与字段保留', () => {
  it('预检只读：列出项目与附件/缺失/历史数量，不改数据库也不生成会话', async () => {
    const seed = await seedFullProject()
    const bundle = await makeBundle()
    const inspected = await inspectV2Bundle(bundle)
    expect(inspected.ok).toBe(true)
    if (!inspected.ok) return
    expect(inspected.value.sourceKind).toBe('v2-bundle')
    expect(inspected.value.projects).toHaveLength(1)
    const summary = inspected.value.projects[0]
    expect(summary.id).toBe(seed.projectId)
    expect(summary.attachmentCount).toBe(2)
    expect(summary.revisionCount).toBe(2)
    expect(summary.bindingCount).toBe(2)
    expect(summary.snapshotCount).toBe(1)
    expect(summary.missingItems).toBe(0)
    expect(inspected.value.sourceSha256).toBe(await sha256Hex(bundle))
  })

  it('迁移保留工程输入/基线/草稿/来源版本/绑定/事件/历史快照/迁移备份（逐字段）', async () => {
    const seed = await seedFullProject()
    const bundle = await makeBundle()
    const parsed = await parseBackup(bundle)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const original = parsed.value

    const migrated = await migrateV2Bundle(
      { bytes: bundle, projectId: seed.projectId },
      { now: '2026-11-09T10:00:00.000Z', newRevisionId: () => 'file-rev-1' },
    )
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    const snapshot = migrated.value.snapshot
    const project = original.projects[0]
    expect(project).toBeDefined()
    if (project === undefined) return

    // 工程输入、基线、版本元数据与关系修订号原样保留。
    expect(snapshot.project.id).toBe(project.id)
    expect(snapshot.project.name).toBe(project.name)
    expect(snapshot.project.engineVersion).toBe(project.engineVersion)
    expect(snapshot.project.createdAt).toBe(project.createdAt)
    expect(snapshot.project.updatedAt).toBe(project.updatedAt)
    expect(snapshot.project.dimensionChain).toEqual(project.working)
    expect(snapshot.project.baseline).toEqual(project.baseline)
    expect(snapshot.project.relationRevision).toBe(project.relationRevision)
    expect(snapshot.project.currentRevisionId).toBe('file-rev-1')
    expect(snapshot.fileRevisions).toHaveLength(1)

    // 来源文档/版本/附件元数据逐字段一致；PDF 字节哈希一致。
    expect(snapshot.documents).toEqual(
      original.documents.filter((item) => item.projectId === project.id),
    )
    expect(snapshot.revisions).toEqual(
      original.revisions.filter((item) => item.projectId === project.id),
    )
    expect(snapshot.blobs).toEqual(
      original.blobs
        .filter((item) => item.projectId === project.id)
        .map((item) => ({
          blobKey: item.blobKey,
          projectId: item.projectId,
          sha256: item.sha256,
          byteSize: item.byteSize,
        })),
    )
    for (const attachment of snapshot.attachments) {
      const revision = snapshot.revisions.find((item) => item.blobKey === attachment.blobKey)
      expect(revision).toBeDefined()
      expect(await sha256Hex(attachment.bytes)).toBe(revision?.sha256)
      expect(attachment.bytes.byteLength).toBe(revision?.byteSize)
    }

    // 绑定几何/页码/备注/版本引用保留，仅当前确认三字段清零。
    for (const binding of original.bindings.filter((item) => item.projectId === project.id)) {
      const found = snapshot.bindings.find((item) => item.id === binding.id)
      expect(found).toEqual({
        ...binding,
        reviewedTermRevision: null,
        reviewedAt: null,
        historicalAcceptance: null,
      })
    }

    // 草稿原始输入、事件、替换前快照与迁移备份保留。
    const originalDraft = original.drafts.find((item) => item.projectId === project.id)
    expect(snapshot.draft).toEqual(originalDraft?.draft ?? null)
    for (const event of original.events.filter((item) => item.projectId === project.id)) {
      expect(snapshot.events).toContainEqual(event)
    }
    expect(snapshot.importSnapshots).toEqual(original.importSnapshots)
    expect(JSON.parse(JSON.stringify(snapshot.migrationBackups))).toEqual(
      JSON.parse(JSON.stringify(original.migrationBackups)),
    )

    // 迁移元数据与事件。
    expect(snapshot.manifestMeta.migration).toMatchObject({
      sourceKind: 'v2-bundle',
      sourceProjectId: project.id,
      confirmationPolicy: 'v2-external-import',
    })
    expect(snapshot.manifestMeta.migration?.sourceSha256).toBe(await sha256Hex(bundle))
    expect(snapshot.events.some((event) => event.type === 'project_migrated_from_v2')).toBe(true)
  })

  it('migration-clears-current-preserves-history：当前确认非 null 即失败', async () => {
    const seed = await seedFullProject()
    const bundle = await makeBundle()
    const migrated = await migrateV2Bundle({ bytes: bundle, projectId: seed.projectId })
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    const project = migrated.value.snapshot.project
    // 回退实验只把“清当前确认”退回“保留原凭据”，以下断言必须变红。
    expect(project.relationReview).toBeNull()
    for (const binding of migrated.value.snapshot.bindings) {
      expect(binding.reviewedTermRevision).toBeNull()
      expect(binding.reviewedAt).toBeNull()
      expect(binding.historicalAcceptance).toBeNull()
    }
    // 迁移不手填复核结论：待办必须由 review/rules.ts 从清零后的状态重新派生。
    const summary = evaluateReviewChecklist({
      chain: project.dimensionChain,
      result: calculateChain(project.dimensionChain),
      relationConfirmed: project.relationReview !== null,
      relationReviewStale: false,
      relationRevision: project.relationRevision,
      terms: project.dimensionChain.terms,
      bindings: migrated.value.snapshot.bindings,
      documents: migrated.value.snapshot.documents,
      revisions: migrated.value.snapshot.revisions,
      availableBlobKeys: new Set(migrated.value.snapshot.blobs.map((blob) => blob.blobKey)),
    })
    expect(summary.reviewComplete).toBe(false)
    expect(summary.pending.some((finding) => finding.ruleId === 'RELATION_CONFIRMED')).toBe(true)
    expect(
      summary.findings.find((finding) => finding.ruleId === 'RELATION_CONFIRMED')?.status,
    ).not.toBe('passed')
  })

  it('migration-keeps-history-verbatim：历史快照含 review/result/sourceManifest/comparison 逐字段不变', async () => {
    const seed = await seedFullProject()
    const bundle = await makeBundle()
    const parsed = await parseBackup(bundle)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const migrated = await migrateV2Bundle({ bytes: bundle, projectId: seed.projectId })
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.value.snapshot.analysisSnapshots).toEqual(parsed.value.snapshots)
    expect(migrated.value.snapshot.analysisSnapshots[0]?.comparison).toEqual(
      seed.snapshot.comparison,
    )
    // 旧版快照没有 comparison 时不补算：迁移结果仍无该字段/为 null。
    expect(seed.snapshot.comparison).not.toBeUndefined()
  })

  it('没有基线对比的旧快照迁移后仍“未冻结”，不补算 comparison', async () => {
    const working = caseA()
    const created = await createProject({ name: '无基线项目', working })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const snapshot = await createAnalysisSnapshot({
      project: created.value,
      draft: chainToDraft(working),
      relationState: { relationRevision: created.value.relationRevision, relationReview: null },
      now: '2026-11-07T09:00:00.000Z',
    })
    expect(snapshot.ok).toBe(true)
    if (!snapshot.ok) return
    const bundle = await makeBundle()
    const migrated = await migrateV2Bundle({
      bytes: bundle,
      projectId: created.value.id,
    })
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    const history = migrated.value.snapshot.analysisSnapshots[0]
    expect(history).toEqual(snapshot.value)
    expect(history?.comparison ?? null).toBeNull()
    expect(history?.baseline).toBeNull()
  })

  it('多项目：预检列出全部，迁移只带所选项目，其余仍可选', async () => {
    const seed = await seedFullProject('项目甲')
    const other = await createProject({ name: '项目乙', working: caseA() })
    expect(other.ok).toBe(true)
    if (!other.ok) return
    const bundle = await makeBundle()
    const inspected = await inspectV2Bundle(bundle)
    expect(inspected.ok).toBe(true)
    if (!inspected.ok) return
    expect(inspected.value.projects.map((item) => item.id).sort()).toEqual(
      [seed.projectId, other.value.id].sort(),
    )
    const migrated = await migrateV2Bundle({ bytes: bundle, projectId: seed.projectId })
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.value.snapshot.project.id).toBe(seed.projectId)
    expect(migrated.value.snapshot.documents.every((item) => item.projectId === seed.projectId)).toBe(
      true,
    )
  })

  it('退役作用域闭包与孤立退役记录进入只读归档，并列出数量', async () => {
    const seed = await seedFullProject('含退役历史的项目')
    const bundle = await makeBundle()
    const retiredScope = `${seed.projectId}::retired::scope-1`
    const orphanScope = '未知来源项目::retired::scope-2'
    const retiredBytes = buildSyntheticPdf({ pageCount: 1, variant: 'v1' })
    const orphanBytes = buildSyntheticPdf({ pageCount: 1, variant: 'v2' })
    const retiredSha = await sha256Hex(retiredBytes)
    const orphanSha = await sha256Hex(orphanBytes)
    const rewritten = await rewriteBundle(bundle, (editor) => {
      editor.setJson(backupPath('documents', 'retired-doc'), {
        id: 'retired-doc',
        projectId: retiredScope,
        title: '退役来源',
        latestRevisionId: 'retired-rev',
      })
      editor.setJson(backupPath('revisions', 'retired-rev'), {
        id: 'retired-rev',
        projectId: retiredScope,
        documentId: 'retired-doc',
        fileName: 'retired.pdf',
        sha256: retiredSha,
        byteSize: retiredBytes.byteLength,
        pageCount: 1,
        createdAt: '2026-10-01T00:00:00.000Z',
        blobKey: 'retired-blob',
      })
      editor.setJson(backupPath('blobs', 'retired-blob'), {
        blobKey: 'retired-blob',
        projectId: retiredScope,
        sha256: retiredSha,
        byteSize: retiredBytes.byteLength,
      })
      editor.setBytes(backupPath('files', 'retired-blob', 'bin'), retiredBytes)
      editor.setJson(backupPath('bindings', 'retired-binding'), {
        id: 'retired-binding',
        projectId: retiredScope,
        termId: 'h',
        revisionId: 'retired-rev',
        documentId: 'retired-doc',
        page: 1,
        rectPdf: [1, 2, 30, 40],
        pageBoxPdf: [0, 0, 600, 800],
        note: '退役绑定',
        createdAt: '2026-10-01T00:00:00.000Z',
        reviewedTermRevision: 1,
        reviewedAt: '2026-10-01T00:00:00.000Z',
        historicalAcceptance: null,
      })
      editor.setJson(backupPath('events', 'retired-event'), {
        id: 'retired-event',
        projectId: retiredScope,
        type: 'project_sources_retired',
        createdAt: '2026-10-01T00:00:00.000Z',
      })
      editor.setJson(backupPath('documents', 'orphan-doc'), {
        id: 'orphan-doc',
        projectId: orphanScope,
        title: '孤立来源',
        latestRevisionId: 'orphan-rev',
      })
      editor.setJson(backupPath('revisions', 'orphan-rev'), {
        id: 'orphan-rev',
        projectId: orphanScope,
        documentId: 'orphan-doc',
        fileName: 'orphan.pdf',
        sha256: orphanSha,
        byteSize: orphanBytes.byteLength,
        pageCount: 1,
        createdAt: '2026-10-02T00:00:00.000Z',
        blobKey: 'orphan-blob',
      })
      editor.setJson(backupPath('blobs', 'orphan-blob'), {
        blobKey: 'orphan-blob',
        projectId: orphanScope,
        sha256: orphanSha,
        byteSize: orphanBytes.byteLength,
      })
      editor.setBytes(backupPath('files', 'orphan-blob', 'bin'), orphanBytes)
    })

    const inspected = await inspectV2Bundle(rewritten)
    expect(inspected.ok).toBe(true)
    if (!inspected.ok) return
    const summary = inspected.value.projects.find((item) => item.id === seed.projectId)
    expect(summary?.retiredRecordCount).toBe(5)
    expect(summary?.orphanRetiredRecordCount).toBe(3)
    expect(inspected.value.warnings.join('')).toContain('归属不明')
    expect(inspected.value.warnings.join('')).toContain('3')

    const migrated = await migrateV2Bundle({ bytes: rewritten, projectId: seed.projectId })
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    const archive = migrated.value.snapshot.legacyArchive
    expect(archive).not.toBeNull()
    if (archive === null) return
    expect(archive.sourceProjectId).toBe(seed.projectId)
    expect(archive.records).toHaveLength(8)
    const kinds = archive.records.map((item) => (item as { kind: string }).kind)
    expect(kinds.filter((kind) => kind === 'document')).toHaveLength(2)
    expect(kinds.filter((kind) => kind === 'revision')).toHaveLength(2)
    expect(kinds.filter((kind) => kind === 'blob')).toHaveLength(2)
    expect(kinds.filter((kind) => kind === 'binding')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'event')).toHaveLength(1)
    // 退役来源不混入当前来源或当前绑定。
    expect(migrated.value.snapshot.documents.some((item) => item.projectId !== seed.projectId)).toBe(
      false,
    )
    expect(
      migrated.value.snapshot.bindings.some((item) => item.projectId !== seed.projectId),
    ).toBe(false)
    expect(archive.warnings.join('')).toContain('孤立退役记录')
  })
})

describe('V2 完整备份：负向拒绝', () => {
  it('跨项目 Blob 引用拒绝，不进入迁移候选', async () => {
    const migrated = await migrateV2Bundle(
      { bytes: fixture('invalid-cross-project-blob.cunlian.zip'), projectId: 'fixture-project' },
    )
    expect(migrated.ok).toBe(false)
    if (migrated.ok) return
    expect(['MISSING_REFERENCE', 'INVALID_RECORD']).toContain(migrated.error.code)
  })

  it('非法 PDF 坐标拒绝迁移', async () => {
    const seed = await seedFullProject()
    const bundle = await makeBundle()
    const rewritten = await rewriteBundle(bundle, (editor) => {
      const path = editor.paths().find((item) => item.startsWith('bindings/'))
      if (path === undefined) throw new Error('缺少绑定条目')
      const binding = editor.getJson(path) as Record<string, unknown>
      editor.setJson(path, { ...binding, rectPdf: [700, 30, 800, 90] })
    })
    const migrated = await migrateV2Bundle({ bytes: rewritten, projectId: seed.projectId })
    expect(migrated.ok).toBe(false)
    if (migrated.ok) return
    expect(migrated.error.code).toBe('INVALID_RECORD')
    expect(migrated.error.message).toContain('区域')
  })

  it('孤立附件元数据拒绝迁移，不静默丢弃也不生成无版本附件', async () => {
    const seed = await seedFullProject()
    const bundle = await makeBundle()
    const orphanBytes = buildSyntheticPdf({ pageCount: 1, variant: 'v2' })
    const orphanSha = await sha256Hex(orphanBytes)
    const rewritten = await rewriteBundle(bundle, (editor) => {
      editor.setJson(backupPath('blobs', 'orphan-blob'), {
        blobKey: 'orphan-blob',
        projectId: seed.projectId,
        sha256: orphanSha,
        byteSize: orphanBytes.byteLength,
      })
      editor.setBytes(backupPath('files', 'orphan-blob', 'bin'), orphanBytes)
    })
    const migrated = await migrateV2Bundle({ bytes: rewritten, projectId: seed.projectId })
    expect(migrated.ok).toBe(false)
    if (migrated.ok) return
    expect(migrated.error.code).toBe('INVALID_RECORD')
    expect(migrated.error.detail).toContain('orphan-blob')
  })

  it('危险路径、未来格式版本与超大 JSON 全拒绝', async () => {
    const traversal = await migrateV2Bundle(
      { bytes: fixture('malicious-traversal-relative.cunlian.zip'), projectId: 'fixture-project' },
    )
    expect(traversal.ok).toBe(false)
    if (!traversal.ok) {
      expect(traversal.error.code).toBe('UNSAFE_PATH')
    }

    const seed = await seedFullProject()
    const bundle = await makeBundle()
    // 未来 formatVersion 只能改 manifest 本身：读出后手写回。
    const read = await readZipEntries(bundle)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    const manifest = JSON.parse(text(read.value.get('manifest.json') as Uint8Array)) as Record<
      string,
      unknown
    >
    manifest.formatVersion = 2
    const parts = [...read.value].filter(([path]) => path !== 'manifest.json')
    const written = await writeZipEntries([
      ...parts.map(([path, bytes]) => ({ path, bytes })),
      {
        path: 'manifest.json',
        bytes: encoder.encode(JSON.stringify(manifest)),
      },
    ])
    expect(written.ok).toBe(true)
    if (!written.ok) return
    const upgraded = await migrateV2Bundle({
      bytes: written.value,
      projectId: seed.projectId,
    })
    expect(upgraded.ok).toBe(false)
    if (!upgraded.ok) {
      expect(upgraded.error.code).toBe('INVALID_MANIFEST')
    }

    const tooLarge = await migrateV2Json(
      encoder.encode(`{"schemaVersion":2,"padding":"${'x'.repeat(1024 * 1024 + 10)}"}`),
    )
    expect(tooLarge.ok).toBe(false)
    if (!tooLarge.ok) {
      expect(tooLarge.error.code).toBe('TOO_LARGE')
    }
  })
})

describe('V2 旧 JSON：分派、版本差异与缺附件', () => {
  it('V2 JSON：relationRevision = 原值 + 1；缺附件重新生成 blobKey 并同步 missingAttachments', async () => {
    const seed = await seedFullProject()
    const exported = await exportProject(seed.projectId)
    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    const inspected = await inspectV2Json(encoder.encode(exported.value))
    expect(inspected.ok).toBe(true)
    if (!inspected.ok) return
    expect(inspected.value.sourceKind).toBe('v2-json')
    expect(inspected.value.formatVersion).toBe(2)
    expect(inspected.value.projects[0]?.missingItems).toBeGreaterThan(0)

    const migrated = await migrateV2Json(encoder.encode(exported.value))
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    const snapshot = migrated.value.snapshot
    expect(snapshot.project.relationRevision).toBe(seed.relationRevision + 1)
    expect(snapshot.project.relationReview).toBeNull()
    expect(snapshot.attachments).toHaveLength(0)
    expect(snapshot.blobs).toHaveLength(0)
    expect(snapshot.analysisSnapshots).toHaveLength(0)
    expect(snapshot.manifestMeta.migration?.sourceKind).toBe('v2-json')
    expect(snapshot.manifestMeta.migration?.sourceFormatVersion).toBe(2)

    expect(snapshot.missingAttachments.length).toBe(snapshot.revisions.length)
    const revisionIds = new Set(snapshot.revisions.map((item) => item.id))
    for (const missing of snapshot.missingAttachments) {
      expect(missing.reason).toBe('legacy-json')
      expect(revisionIds.has(missing.revisionId)).toBe(true)
      expect(missing.blobKey).not.toBe(seed.blobKey)
    }
    for (const revision of snapshot.revisions) {
      const missing = snapshot.missingAttachments.find(
        (item) => item.revisionId === revision.id,
      )
      expect(missing?.blobKey).toBe(revision.blobKey)
      expect(missing?.documentId).toBe(revision.documentId)
    }
    // 绑定几何与页码保留，确认字段清零。
    expect(snapshot.bindings.length).toBeGreaterThan(0)
    for (const binding of snapshot.bindings) {
      expect(binding.reviewedTermRevision).toBeNull()
      expect(binding.reviewedAt).toBeNull()
      expect(binding.historicalAcceptance).toBeNull()
      expect(binding.rectPdf).toHaveLength(4)
    }
    expect(migrated.value.warnings.join('')).toContain('不含 PDF 原字节')
  })

  it('V1 JSON：relationRevision = 1，环补 termRevision=1，保留基线与来源状态', async () => {
    const working = caseA().terms.map((term) => {
      const { termRevision: _termRevision, ...rest } = term
      void _termRevision
      return rest
    })
    const v1 = {
      schemaVersion: 1,
      id: 'legacy-v1',
      name: 'V1 旧项目',
      engineVersion: '0.0.9',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      unit: 'q',
      qPerMm: 10000,
      working: {
        terms: working,
        target: { minQ: 1000, maxQ: 3000 },
        assumptions: 'V1 假设',
      },
      baseline: null,
    }
    const migrated = await migrateV2Json(encoder.encode(JSON.stringify(v1)))
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    const snapshot = migrated.value.snapshot
    expect(snapshot.project.relationRevision).toBe(1)
    expect(snapshot.project.id).toBe('legacy-v1')
    expect(snapshot.project.dimensionChain.terms.every((item) => item.termRevision === 1)).toBe(true)
    expect(snapshot.revisions).toHaveLength(0)
    expect(snapshot.missingAttachments).toHaveLength(0)
    expect(snapshot.manifestMeta.migration?.sourceFormatVersion).toBe(1)
  })

  it('单位错误、未来 schema、非法 JSON 全拒绝且错误码具体', async () => {
    const seed = await seedFullProject()
    const exported = await exportProject(seed.projectId)
    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    const v2 = JSON.parse(exported.value) as Record<string, unknown>

    const wrongUnit = await migrateV2Json(
      encoder.encode(JSON.stringify({ ...v2, unit: 'mm' })),
    )
    expect(wrongUnit.ok).toBe(false)
    if (!wrongUnit.ok) {
      expect(wrongUnit.error.code).toBe('INVALID_RECORD')
      expect(`${wrongUnit.error.message}${wrongUnit.error.detail ?? ''}`).toContain('unit')
    }

    const future = await migrateV2Json(
      encoder.encode(JSON.stringify({ ...v2, schemaVersion: 3 })),
    )
    expect(future.ok).toBe(false)
    if (!future.ok) {
      expect(future.error.code).toBe('UNSUPPORTED_VERSION')
    }

    const invalidJson = await migrateV2Json(encoder.encode('{not-json'))
    expect(invalidJson.ok).toBe(false)
    if (!invalidJson.ok) {
      expect(invalidJson.error.code).toBe('INVALID_JSON')
    }

    const wrongQPerMm = await migrateV2Json(
      encoder.encode(JSON.stringify({ ...v2, qPerMm: 1000 })),
    )
    expect(wrongQPerMm.ok).toBe(false)
    if (!wrongQPerMm.ok) {
      expect(`${wrongQPerMm.error.message}${wrongQPerMm.error.detail ?? ''}`).toContain('qPerMm')
    }

    const manyTerms = Array.from({ length: 21 }, (_, index) => ({
      id: `t${index}`,
      symbol: `T${index}`,
      name: `环 ${index}`,
      nominalQ: 1000 + index,
      lowerDeviationQ: -1,
      upperDeviationQ: 1,
      sign: 1,
      sourceNote: '',
      termRevision: 1,
    }))
    const tooManyTerms = await migrateV2Json(
      encoder.encode(
        JSON.stringify({
          ...v2,
          working: { terms: manyTerms, target: null, assumptions: '' },
        }),
      ),
    )
    expect(tooManyTerms.ok).toBe(false)
    if (!tooManyTerms.ok) {
      expect(tooManyTerms.error.code).toBe('INVALID_RECORD')
      expect(tooManyTerms.error.detail ?? '').toContain('组成环最多 20 项')
    }
  })
})

describe('迁移产物可编码与 V3 结构一致', () => {
  it('ZIP 迁移结果可被 .cunlian 编码器自校验（含两个 PDF 版本与原字节）', async () => {
    const seed = await seedFullProject()
    const bundle = await makeBundle()
    const migrated = await migrateV2Bundle(
      { bytes: bundle, projectId: seed.projectId },
      { now: '2026-11-09T11:00:00.000Z' },
    )
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.value.snapshot.project.schemaVersion).toBe(PROJECT_FILE_SCHEMA_VERSION)
    const { encodeProjectFile } = await import('./codec')
    const encoded = await encodeProjectFile(migrated.value.snapshot)
    expect(encoded.ok).toBe(true)
    if (encoded.ok) {
      expect(encoded.value.manifest.counts.revisions).toBe(2)
      expect(encoded.value.manifest.attachments).toHaveLength(2)
    }
  })
})
