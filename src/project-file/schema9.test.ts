// @vitest-environment node
/**
 * ADR-001 schema 9：provenance 纯加法 + schema8 → 9 迁移。
 *
 * 证明：
 * - schema9 往返：候选/出处/决定与 provenance 逐字段保留，候选身份与数值不变；
 * - 旧 schema8 文件读入：按原 evidence 逐条补 pdf-text 出处，不重算、不改值，
 *   尺寸链/参数/判据（calculateChain 结果）完全一致；保存时才写成 9；
 * - user-attestation 出处可以随项目文件往返（类型 + 校验 + 用例存在，不接产品流程）。
 */
import { describe, expect, it } from 'vitest'
import { readZipEntries, writeZipEntries } from '../backup/zip'
import { calculateChain } from '../domain/calculate'
import { sha256Hex } from '../sources/hash'
import { confirmCandidate } from '../document-extraction/draft'
import { buildSyntheticExtractionDraft } from '../document-extraction/__fixtures__/draftFixture'
import type { ExtractionDraft, UserAttestation } from '../document-extraction/types'
import { evidenceKey, provenanceKey } from '../document-extraction/types'
import { decodeProjectFile, encodeProjectFile } from '../project-file/codec'
import { createSampleSnapshot, SAMPLE_PDF_BYTES } from '../project-file/__fixtures__/sampleProjectFile'
import type { ProjectFileProject, ProjectFileSnapshot } from '../project-file/types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const AT = '2026-11-12T09:00:00.000Z'

async function snapshotWithDraft(): Promise<{ snapshot: ProjectFileSnapshot; draft: ExtractionDraft }> {
  const base = await createSampleSnapshot()
  const sha256 = await sha256Hex(SAMPLE_PDF_BYTES)
  const draft = buildSyntheticExtractionDraft({
    projectId: base.project.id,
    baseToken: `base-${base.project.id}`,
    source: {
      documentId: 'doc-1',
      revisionId: 'sr-1',
      sha256,
      blobKey: 'blob-1',
      pageCount: 2,
    },
  })
  return {
    snapshot: { ...base, project: { ...base.project, extractionDrafts: [draft] } },
    draft,
  }
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

/** 递归删掉所有 provenance 字段（模拟 schema8 记录）。 */
function stripProvenance(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) stripProvenance(item)
    return
  }
  if (value === null || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  delete record.provenance
  for (const item of Object.values(record)) stripProvenance(item)
}

/** 把 schema11 容器改写成 schema8：版本号降一级 + 删掉全部 provenance。 */
async function downgradeToSchema8(bytes: Uint8Array): Promise<Uint8Array> {
  return await rebuildArchive(bytes, (parts) => {
    patchJson(parts, 'manifest.json', (manifest) => {
      ;(manifest.project as Record<string, unknown>).projectSchemaVersion = 8
    })
    patchAllProjects(parts, (project) => {
      project.schemaVersion = 8
      stripProvenance(project)
      // schema8 严格拒绝 schema11 的加法字段。
      delete project.sourceKind
      delete project.actorId
      delete project.sessionSeq
      delete project.sessionLabel
      delete project.attestations
    })
  })
}

function sortedEvidenceKeys(draft: ExtractionDraft): string[] {
  return draft.candidates.flatMap((candidate) => candidate.evidence.map((item) => evidenceKey(item)))
}

describe('ADR-001 schema 9/10：provenance 纯加法往返', () => {
  it('编码解码：schema11 逐字段保留，候选身份与出处 key 不变', async () => {
    const { snapshot, draft } = await snapshotWithDraft()
    const encoded = await encodeProjectFile(snapshot)
    expect(encoded.ok, encoded.ok ? '' : encoded.error.message).toBe(true)
    if (!encoded.ok) return
    expect(encoded.value.manifest.project.projectSchemaVersion).toBe(11)

    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok, decoded.ok ? '' : `${decoded.error.code}: ${decoded.error.message}`).toBe(true)
    if (!decoded.ok) return
    const after = decoded.value.snapshot
    expect(after.project.extractionDrafts).toEqual(snapshot.project.extractionDrafts)
    expect(after.project.extractionDrafts[0]?.candidates.map((item) => item.candidateId)).toEqual(
      draft.candidates.map((item) => item.candidateId),
    )
    expect(sortedEvidenceKeys(after.project.extractionDrafts[0]!)).toEqual(sortedEvidenceKeys(draft))
    // 尺寸链/参数/判据不受影响
    expect(after.project.dimensionChain).toEqual(snapshot.project.dimensionChain)
    expect(calculateChain(after.project.dimensionChain)).toEqual(
      calculateChain(snapshot.project.dimensionChain),
    )
    expect(after.project.parameters).toEqual([])
  })

  it('schema8 文件读入：补 pdf-text 出处（不重算、不改值），保存升级为 10', async () => {
    const { snapshot, draft } = await snapshotWithDraft()
    const encoded = await encodeProjectFile(snapshot)
    if (!encoded.ok) throw new Error(encoded.error.message)
    const legacyBytes = await downgradeToSchema8(encoded.value.bytes)

    const decoded = await decodeProjectFile(legacyBytes)
    expect(decoded.ok, decoded.ok ? '' : `${decoded.error.code}: ${decoded.error.message}`).toBe(true)
    if (!decoded.ok) return
    const migrated = decoded.value.snapshot.project
    expect(migrated.schemaVersion).toBe(11)

    const migratedDraft = migrated.extractionDrafts[0]
    expect(migratedDraft).toBeDefined()
    if (migratedDraft === undefined) return
    // 只加 provenance：候选身份、候选数、数值与快照判据逐项不变。
    expect(migratedDraft.candidates.map((item) => item.candidateId)).toEqual(
      draft.candidates.map((item) => item.candidateId),
    )
    expect(migratedDraft.idempotencyKey).toBe(draft.idempotencyKey)
    expect(migratedDraft.pageRange).toEqual(draft.pageRange)
    expect(migratedDraft.decisions).toEqual(draft.decisions)
    for (const [index, candidate] of migratedDraft.candidates.entries()) {
      const before = draft.candidates[index]!
      expect(candidate.evidence).toEqual(before.evidence)
      // 补出来的 pdf-text 出处与 evidence 同序同 key，且没有多造一条。
      expect(candidate.provenance?.map((ref) => provenanceKey(ref))).toEqual(
        before.evidence.map((item) => evidenceKey(item)),
      )
    }
    // 参数与判据不变：尺寸链、目标区间、计算结果完全一致。
    expect(migrated.dimensionChain).toEqual(snapshot.project.dimensionChain)
    expect(migrated.dimensionChain.target).toEqual({ minQ: 1000, maxQ: 3000 })
    expect(calculateChain(migrated.dimensionChain)).toEqual(
      calculateChain(snapshot.project.dimensionChain),
    )
    expect(migrated.parameters).toEqual([])

    // 写出后才写 schema 9；旧历史记录仍是 8。
    const rewritten = await encodeProjectFile(decoded.value.snapshot)
    expect(rewritten.ok, rewritten.ok ? '' : rewritten.error.message).toBe(true)
    if (!rewritten.ok) return
    expect(rewritten.value.manifest.project.projectSchemaVersion).toBe(11)
    const reopened = await decodeProjectFile(rewritten.value.bytes)
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.value.snapshot.project.extractionDrafts).toEqual(
      decoded.value.snapshot.project.extractionDrafts,
    )
  })

  it('user-attestation 出处随项目文件往返（类型 + 校验；不接产品流程）', async () => {
    const { snapshot, draft } = await snapshotWithDraft()
    const target = draft.candidates.find(
      (candidate) => candidate.kind === 'ring' && candidate.data.symbol === 'H',
    )
    if (target === undefined || target.kind !== 'ring' || target.data.nominal === null) {
      throw new Error('缺少 H 候选')
    }
    const confirmed = confirmCandidate(draft, {
      candidateId: target.candidateId,
      editRevision: target.editRevision,
      confirmed: true,
      actor: 'local-operator',
      decidedAt: AT,
    })
    if (!confirmed.ok) throw new Error(confirmed.message)
    const attestation: UserAttestation = {
      kind: 'user-attestation',
      actorId: 'laowang',
      at: AT,
      sessionSeq: 1,
      sessionLabel: '2026-11-12 复检',
      statement: '总长按 52.20 算，我量的',
      fieldPath: 'ring.H.nominal',
    }
    const withAttestation: ExtractionDraft = {
      ...confirmed.value,
      candidates: confirmed.value.candidates.map((candidate) => {
        if (candidate.candidateId !== target.candidateId) return candidate
        if (candidate.kind !== 'ring' || candidate.data.nominal === null) return candidate
        return {
          ...candidate,
          data: {
            ...candidate.data,
            nominal: { ...candidate.data.nominal, evidence: [], provenance: [attestation] },
          },
        }
      }),
    }
    const project: ProjectFileProject = {
      ...snapshot.project,
      extractionDrafts: [withAttestation],
    }
    const encoded = await encodeProjectFile({ ...snapshot, project })
    expect(encoded.ok, encoded.ok ? '' : `${encoded.error.code}: ${encoded.error.message}`).toBe(true)
    if (!encoded.ok) return

    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok, decoded.ok ? '' : `${decoded.error.code}: ${decoded.error.message}`).toBe(true)
    if (!decoded.ok) return
    const roundTrip = decoded.value.snapshot.project.extractionDrafts[0]
    const roundTrippedCandidate = roundTrip?.candidates.find(
      (candidate) => candidate.candidateId === target.candidateId,
    )
    expect(roundTrippedCandidate?.kind).toBe('ring')
    if (roundTrippedCandidate?.kind !== 'ring' || roundTrippedCandidate.data.nominal === null) return
    expect(roundTrippedCandidate.data.nominal.provenance).toEqual([attestation])
    expect(roundTrippedCandidate.data.nominal.evidence).toEqual([])
  })
})
