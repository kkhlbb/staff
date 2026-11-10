import { describe, expect, it } from 'vitest'
import { readZipEntries, writeZipEntries } from '../backup/zip'
import { sha256Hex } from '../sources/hash'
import { decodeProjectFile, encodeProjectFile } from './codec'
import { createSampleSnapshot } from './__fixtures__/sampleProjectFile'
import { parseProjectVersioned } from './validation'
import { upgradeSnapshotToCurrent } from './upgrade'
import type {
  ProjectFileDrawingRecord,
  ProjectFileSnapshot,
  ProjectFileSpacerParameter,
} from './types'
import { buildSpacerDrawing } from '../drawing/spacerDrawing'
import { parseSpacerParameters } from '../parts/spacerParameters'

async function buildDrawingRecord(
  snapshot: ProjectFileSnapshot,
): Promise<{ parameters: ProjectFileSpacerParameter[]; drawing: ProjectFileDrawingRecord }> {
  const parsed = parseSpacerParameters({
    innerDiameter: '20.00',
    outerDiameter: '32.00',
    length: '12.00',
  })
  if (!parsed.ok) throw new Error(parsed.message)
  const parameters: ProjectFileSpacerParameter[] = parsed.parameters.map((item) => ({ ...item, parameterRevision: 1 }))
  const drawing = buildSpacerDrawing({
    projectId: snapshot.project.id,
    revisionId: snapshot.project.currentRevisionId,
    drawingId: 'drawing-c-1',
    parameters,
    scale: { numerator: 1, denominator: 1 },
    frameFields: {
      partName: '隔套',
      drawingNumber: '',
      version: '',
      material: '',
      tolerance: '',
      surface: '',
      drafter: '',
      date: '',
    },
  })
  const record: ProjectFileDrawingRecord = {
    drawingId: drawing.drawingId,
    drawingDataVersion: 1,
    templateId: drawing.templateId,
    templateVersion: drawing.templateVersion,
    partId: drawing.partId,
    revisionId: drawing.revisionId,
    parameterIds: drawing.parameterSnapshot.map((item) => item.parameterId),
    paper: { format: 'A4', orientation: 'landscape', widthMm: 297, heightMm: 210 },
    scale: drawing.scale,
    frameFields: {
      partName: '隔套',
      drawingNumber: '',
      version: '',
      material: '',
      tolerance: '',
      surface: '',
      drafter: '',
      date: '',
    },
    status: 'pending-review-draft',
    dataFingerprint: drawing.fingerprint,
  }
  return { parameters, drawing: record }
}

async function withDrawing(): Promise<ProjectFileSnapshot> {
  const base = await createSampleSnapshot()
  const { parameters, drawing } = await buildDrawingRecord(base)
  return {
    ...base,
    project: {
      ...base.project,
      parameters,
      drawings: [drawing],
    },
  }
}

describe('C-03 schema 5 持久化', () => {
  it('三参数 q/有效位/来源备注与图纸快照引用往返；不存图元数组', async () => {
    const snapshot = await withDrawing()
    const encoded = await encodeProjectFile(snapshot)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(encoded.value.manifest.formatVersion).toBe(2)
    expect(encoded.value.manifest.project.projectSchemaVersion).toBe(6)
    expect(encoded.value.manifest.counts.drawings).toBe(1)

    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const project = decoded.value.snapshot.project
    expect(project.parameters.map((item) => item.valueQ)).toEqual([200000, 320000, 120000])
    expect(project.parameters.map((item) => item.inputDecimals)).toEqual([2, 2, 2])
    expect(project.drawings).toHaveLength(1)
    expect(project.drawings[0].dataFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(project.drawings[0].parameterIds).toEqual([
      'param:spacer:inner-diameter',
      'param:spacer:outer-diameter',
      'param:spacer:length',
    ])
    // 持久化记录里不允许出现整份图元/SVG/截图字段。
    const record = project.drawings[0] as unknown as Record<string, unknown>
    for (const forbidden of ['primitives', 'annotations', 'svg', 'screenshot', 'image', 'pdfBase64']) {
      expect(record[forbidden]).toBeUndefined()
    }
    expect(JSON.stringify(record).length).toBeLessThan(4000)
  })

  it('篡改 dataFingerprint 或参数后重建校验拒绝打开', async () => {
    const snapshot = await withDrawing()
    const encoded = await encodeProjectFile(snapshot)
    if (!encoded.ok) throw new Error('encode failed')
    // 直接改内存快照再走 assemble（模拟磁盘 JSON 被改）。
    const tampered: ProjectFileSnapshot = {
      ...snapshot,
      project: {
        ...snapshot.project,
        drawings: [{ ...snapshot.project.drawings[0], dataFingerprint: 'b'.repeat(64) }],
      },
    }
    const { assembleSnapshot } = await import('./validation')
    const result = assembleSnapshot({
      project: tampered.project,
      draft: tampered.draft,
      documents: tampered.documents,
      revisions: tampered.revisions,
      bindings: tampered.bindings,
      blobs: tampered.blobs,
      events: tampered.events,
      analysisSnapshots: tampered.analysisSnapshots,
      importSnapshots: tampered.importSnapshots,
      migrationBackups: tampered.migrationBackups,
      legacyArchive: tampered.legacyArchive,
      fileRevisions: tampered.fileRevisions,
      attachments: tampered.attachments,
      missingAttachments: tampered.missingAttachments,
      snapshotReferences: tampered.snapshotReferences,
      manifestMeta: tampered.manifestMeta,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('重建指纹')

    // 参数被改但图纸指纹不变，同样拒绝。
    const parameterTampered: ProjectFileSnapshot = {
      ...snapshot,
      project: {
        ...snapshot.project,
        parameters: snapshot.project.parameters.map((item) =>
          item.key === 'length' ? { ...item, valueQ: 121000 } : item,
        ),
      },
    }
    const second = assembleSnapshot({
      project: parameterTampered.project,
      draft: parameterTampered.draft,
      documents: parameterTampered.documents,
      revisions: parameterTampered.revisions,
      bindings: parameterTampered.bindings,
      blobs: parameterTampered.blobs,
      events: parameterTampered.events,
      analysisSnapshots: parameterTampered.analysisSnapshots,
      importSnapshots: parameterTampered.importSnapshots,
      migrationBackups: parameterTampered.migrationBackups,
      legacyArchive: parameterTampered.legacyArchive,
      fileRevisions: parameterTampered.fileRevisions,
      attachments: parameterTampered.attachments,
      missingAttachments: parameterTampered.missingAttachments,
      snapshotReferences: parameterTampered.snapshotReferences,
      manifestMeta: parameterTampered.manifestMeta,
    })
    expect(second.ok).toBe(false)
  })

  it('schema4 文件仍可读，但非空 parameters/drawings 仍拒绝（不放宽旧格式）', async () => {
    const snapshot = await createSampleSnapshot()
    const schema4 = { ...snapshot.project, schemaVersion: 4 }
    const parsed = parseProjectVersioned(schema4)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.version).toBe(2)
      expect(parsed.value.project.schemaVersion).toBe(4)
    }
    const full = await withDrawing()
    const withParameters = {
      ...full.project,
      schemaVersion: 4,
    }
    const rejected = parseProjectVersioned(withParameters)
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.error.code).toBe('INVALID_RECORD')
  })

  it('schema5 记录缺少参数时，图纸引用报缺失而不是猜值', async () => {
    const snapshot = await withDrawing()
    const broken = {
      ...snapshot.project,
      parameters: [],
    }
    const { assembleSnapshot } = await import('./validation')
    const result = assembleSnapshot({
      project: broken,
      draft: snapshot.draft,
      documents: snapshot.documents,
      revisions: snapshot.revisions,
      bindings: snapshot.bindings,
      blobs: snapshot.blobs,
      events: snapshot.events,
      analysisSnapshots: snapshot.analysisSnapshots,
      importSnapshots: snapshot.importSnapshots,
      migrationBackups: snapshot.migrationBackups,
      legacyArchive: snapshot.legacyArchive,
      fileRevisions: snapshot.fileRevisions,
      attachments: snapshot.attachments,
      missingAttachments: snapshot.missingAttachments,
      snapshotReferences: snapshot.snapshotReferences,
      manifestMeta: snapshot.manifestMeta,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('缺少隔套参数')
  })
})

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function rewriteAsSchema4(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = await readZipEntries(bytes)
  if (!zip.ok) throw new Error('decode zip failed')
  const parts = zip.value
  const patch = (path: string, mutate: (value: Record<string, unknown>) => void) => {
    const raw = parts.get(path)
    if (raw === undefined) return
    const value = JSON.parse(decoder.decode(raw)) as Record<string, unknown>
    mutate(value)
    parts.set(path, encoder.encode(`${JSON.stringify(value, null, 2)}\n`))
  }
  patch('project/project.json', (project) => {
    project.schemaVersion = 4
    project.parameters = []
    project.drawings = []
  })
  for (const path of [...parts.keys()]) {
    if (path.startsWith('revisions/')) {
      patch(path, (revision) => {
        const project = revision.project as Record<string, unknown>
        project.schemaVersion = 4
        project.parameters = []
        project.drawings = []
      })
    }
  }
  patch('manifest.json', (manifest) => {
    const project = manifest.project as Record<string, unknown>
    project.projectSchemaVersion = 4
  })
  const manifest = JSON.parse(decoder.decode(parts.get('manifest.json')!)) as {
    entries: { path: string; role: string }[]
  }
  const roleByPath = new Map(manifest.entries.map((entry) => [entry.path, entry.role]))
  const entries: { path: string; role: string; byteSize: number; sha256: string }[] = []
  let payloadBytes = 0
  for (const [path, value] of parts) {
    if (path === 'manifest.json') continue
    entries.push({
      path,
      role: roleByPath.get(path) ?? 'history',
      byteSize: value.byteLength,
      sha256: await sha256Hex(value),
    })
    payloadBytes += value.byteLength
  }
  entries.sort((left, right) => (left.path < right.path ? -1 : 1))
  parts.set(
    'manifest.json',
    encoder.encode(`${JSON.stringify({ ...manifest, entries, payloadBytes }, null, 2)}\n`),
  )
  const written = await writeZipEntries([...parts].map(([path, value]) => ({ path, bytes: value })))
  if (!written.ok) throw new Error('rewrite zip failed')
  return written.value
}

describe('C-03 旧 formatVersion 2 / schema 4 文件兼容', () => {
  it('真实容器按 schema4 读入不 dirty；保存升级到 5 且旧历史保持 4', async () => {
    const sample = await createSampleSnapshot()
    const encoded = await encodeProjectFile(sample)
    if (!encoded.ok) throw new Error('encode failed')
    const schema4Bytes = await rewriteAsSchema4(encoded.value.bytes)

    const decoded = await decodeProjectFile(schema4Bytes)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value.manifest.formatVersion).toBe(2)
    expect(decoded.value.manifest.project.projectSchemaVersion).toBe(4)
    // 读入后的工作形状为当前 schema5，但来源格式仍是 2（不产生 dirty）。
    expect(decoded.value.snapshot.project.schemaVersion).toBe(6)
    expect(decoded.value.snapshot.project.sourceFormatVersion).toBe(2)
    expect(decoded.value.snapshot.project.parameters).toEqual([])
    expect(decoded.value.snapshot.project.drawings).toEqual([])
    expect(decoded.value.snapshot.project.dimensionChain.terms.map((term) => term.nominalQ)).toEqual([
      522000, 200000, 120000, 200000,
    ])

    const upgraded = upgradeSnapshotToCurrent(decoded.value.snapshot, {
      newRevisionId: () => 'rev-upgraded-c',
      now: () => new Date('2026-11-09T12:00:00.000Z'),
    })
    expect(upgraded.upgraded).toBe(true)
    expect(upgraded.snapshot.project.schemaVersion).toBe(6)
    // 旧版本记录保持 schema4 原样（不可变历史）。
    expect(upgraded.snapshot.fileRevisions[0]?.project.schemaVersion).toBe(4)
    expect(upgraded.snapshot.fileRevisions.at(-1)?.project.schemaVersion).toBe(6)

    const saved = await encodeProjectFile(upgraded.snapshot)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.value.manifest.project.projectSchemaVersion).toBe(6)
    const reopened = await decodeProjectFile(saved.value.bytes)
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.value.snapshot.project.schemaVersion).toBe(6)
    expect(reopened.value.snapshot.fileRevisions[0]?.project.schemaVersion).toBe(4)
  })
})
