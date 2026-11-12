// @vitest-environment node
/**
 * ADR-001 第 3 步 schema 10：无任务书入口的加法字段与 schema 9 迁移。
 *
 * 证明：
 * - schema 10 往返：sourceKind / actorId / sessionSeq / sessionLabel / attestations
 *   与 user-attestation 出处逐字段保留；
 * - schema 9 文件读入：sourceKind 固定补 'pdf'、账本为空，**不重算、不改值**
 *   （尺寸链、参数、图纸指纹、calculateChain 结果完全一致），保存时才写 10；
 * - 无任务书项目缺责任人 / 断言跨责任人时明确拒绝。
 */
import { describe, expect, it } from 'vitest'
import { readZipEntries, writeZipEntries } from '../backup/zip'
import { calculateChain } from '../domain/calculate'
import { sha256Hex } from '../sources/hash'
import { buildSyntheticExtractionDraft } from '../document-extraction/__fixtures__/draftFixture'
import type { UserAttestation } from '../document-extraction/types'
import { decodeProjectFile, encodeProjectFile } from '../project-file/codec'
import { createSampleSnapshot, SAMPLE_PDF_BYTES } from '../project-file/__fixtures__/sampleProjectFile'
import { parseProjectVersioned } from '../project-file/validation'
import type { ProjectFileProject, ProjectFileSnapshot } from '../project-file/types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const AT = '2026-11-12T09:00:00.000Z'

const ATTESTATION: UserAttestation = {
  kind: 'user-attestation',
  actorId: '老王',
  at: AT,
  sessionSeq: 1,
  sessionLabel: '2026-11-12 复检',
  statement: '总长按 52.20 算，我量的',
  fieldPath: 'chain.terms',
  turnId: 'turn-1',
}

async function rebuildArchive(
  bytes: Uint8Array,
  mutate: (parts: Map<string, Uint8Array>) => void,
): Promise<Uint8Array> {
  const zip = await readZipEntries(bytes)
  if (!zip.ok) throw new Error(`不是合法 ZIP：${zip.error.message}`)
  const parts = zip.value
  mutate(parts)
  const manifestBytes = parts.get('manifest.json')
  if (manifestBytes === undefined) throw new Error('缺少 manifest')
  const manifest = JSON.parse(decoder.decode(manifestBytes)) as {
    entries: { path: string; role: string }[]
    payloadBytes: number
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
  if (!written.ok) throw new Error(`重写失败：${written.error.message}`)
  return written.value
}

function patchJson(
  parts: Map<string, Uint8Array>,
  path: string,
  patch: (value: Record<string, unknown>) => void,
): void {
  const bytes = parts.get(path)
  if (bytes === undefined) throw new Error(`缺失条目 ${path}`)
  const value = JSON.parse(decoder.decode(bytes)) as Record<string, unknown>
  patch(value)
  parts.set(path, encoder.encode(`${JSON.stringify(value, null, 2)}\n`))
}

function patchAllProjects(
  parts: Map<string, Uint8Array>,
  patch: (project: Record<string, unknown>) => void,
): void {
  patchJson(parts, 'project/project.json', patch)
  for (const path of [...parts.keys()]) {
    if (!path.startsWith('revisions/')) continue
    patchJson(parts, path, (revision) => patch(revision.project as Record<string, unknown>))
  }
}

/** 把 schema 10 容器改写成 schema 9：删掉本步的加法字段并降版本号。 */
async function downgradeToSchema9(bytes: Uint8Array): Promise<Uint8Array> {
  return rebuildArchive(bytes, (parts) => {
    patchJson(parts, 'manifest.json', (manifest) => {
      ;(manifest.project as Record<string, unknown>).projectSchemaVersion = 9
    })
    patchAllProjects(parts, (project) => {
      project.schemaVersion = 9
      delete project.sourceKind
      delete project.actorId
      delete project.sessionSeq
      delete project.sessionLabel
      delete project.attestations
    })
  })
}

function asIntent(project: ProjectFileProject): ProjectFileProject {
  return {
    ...project,
    sourceKind: 'user-intent',
    actorId: ATTESTATION.actorId,
    sessionSeq: 1,
    sessionLabel: ATTESTATION.sessionLabel,
    attestations: [ATTESTATION],
  }
}

describe('ADR-001 第 3 步 schema 10：来源种类/身份/断言账本', () => {
  it('schema 10 往返：PDF 项目写 sourceKind=pdf、账本为空', async () => {
    const snapshot = await createSampleSnapshot()
    const encoded = await encodeProjectFile(snapshot)
    expect(encoded.ok, JSON.stringify(encoded)).toBe(true)
    if (!encoded.ok) return
    expect(encoded.value.manifest.project.projectSchemaVersion).toBe(10)
    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok, JSON.stringify(decoded)).toBe(true)
    if (!decoded.ok) return
    const project = decoded.value.snapshot.project
    expect(project.schemaVersion).toBe(10)
    expect(project.sourceKind).toBe('pdf')
    expect(project.actorId).toBeNull()
    expect(project.sessionSeq).toBe(0)
    expect(project.attestations).toEqual([])
  })

  it('schema 9 → 10：补 sourceKind=pdf 与空账本，链/参数/图纸/结果不重算不改值', async () => {
    const snapshot = await createSampleSnapshot()
    const bytes = await downgradeToSchema9(
      (await encodeProjectFile(snapshot) as { ok: true; value: { bytes: Uint8Array } }).value.bytes,
    )
    const decoded = await decodeProjectFile(bytes)
    expect(decoded.ok, JSON.stringify(decoded)).toBe(true)
    if (!decoded.ok) return
    const project = decoded.value.snapshot.project
    const original = snapshot.project
    expect(project.schemaVersion).toBe(10)
    expect(project.sourceKind).toBe('pdf')
    expect(project.actorId).toBeNull()
    expect(project.sessionSeq).toBe(0)
    expect(project.sessionLabel).toBeNull()
    expect(project.attestations).toEqual([])
    // 数值与身份：逐字段一致，不重算。
    expect(project.dimensionChain).toEqual(original.dimensionChain)
    expect(project.parameters).toEqual(original.parameters)
    expect(project.drawings).toEqual(original.drawings)
    expect(project.currentRevisionId).toBe(original.currentRevisionId)
    expect(calculateChain(project.dimensionChain)).toEqual(calculateChain(original.dimensionChain))
    // 保存时才写 10。
    const reencoded = await encodeProjectFile(decoded.value.snapshot)
    expect(reencoded.ok).toBe(true)
    if (reencoded.ok) expect(reencoded.value.manifest.project.projectSchemaVersion).toBe(10)
  })

  it('无任务书项目：断言账本与 user-attestation 出处可随文件往返', async () => {
    const base = await createSampleSnapshot()
    const sha256 = await sha256Hex(SAMPLE_PDF_BYTES)
    const draft = buildSyntheticExtractionDraft({
      projectId: base.project.id,
      baseToken: `base-${base.project.id}`,
      source: { documentId: 'doc-1', revisionId: 'sr-1', sha256, blobKey: 'blob-1', pageCount: 2 },
    })
    const attestedDraft = {
      ...draft,
      candidates: draft.candidates.map((candidate) =>
        candidate.kind === 'ring'
          ? { ...candidate, provenance: [ATTESTATION] }
          : candidate,
      ),
    }
    const snapshot: ProjectFileSnapshot = {
      ...base,
      project: {
        ...asIntent(base.project),
        extractionDrafts: [attestedDraft],
      },
    }
    const encoded = await encodeProjectFile(snapshot)
    expect(encoded.ok, JSON.stringify(encoded)).toBe(true)
    if (!encoded.ok) return
    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok, JSON.stringify(decoded)).toBe(true)
    if (!decoded.ok) return
    const project = decoded.value.snapshot.project
    expect(project.sourceKind).toBe('user-intent')
    expect(project.actorId).toBe('老王')
    expect(project.sessionSeq).toBe(1)
    expect(project.sessionLabel).toBe('2026-11-12 复检')
    expect(project.attestations).toEqual([ATTESTATION])
    const ring = project.extractionDrafts[0]!.candidates.find((candidate) => candidate.kind === 'ring')
    expect(ring?.provenance?.[0]).toMatchObject({ kind: 'user-attestation', statement: ATTESTATION.statement })
  })

  it('无任务书项目缺责任人 / 断言跨责任人 → 明确拒绝', async () => {
    const base = await createSampleSnapshot()
    const noActor = { ...asIntent(base.project), actorId: null }
    const parsed = parseProjectVersioned(noActor)
    expect(parsed.ok).toBe(false)

    const forged = { ...asIntent(base.project), attestations: [{ ...ATTESTATION, actorId: 'mallory' }] }
    const rejected = parseProjectVersioned(forged)
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.error.detail ?? '').toContain('责任人')
  })
})
