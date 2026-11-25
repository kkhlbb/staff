// @vitest-environment node
/**
 * V3.6 起 schema8 / ADR-001 起 schema9：提取草稿随 project.json 持久化。
 *
 * 证明：
 * - 候选/出处/决定逐字段往返；
 * - 旧 schema7 不偷偷接受 extractionDrafts（严格拒绝），读取时补空数组；
 * - “已确认但没有决定”的伪造状态被引用校验拒绝；
 * - 尺寸链/目标/参数/绑定/条款不受影响（草稿只是新增字段）。
 */
import { describe, expect, it } from 'vitest'
import { decodeProjectFile, encodeProjectFile } from './codec'
import { createSampleSnapshot } from './__fixtures__/sampleProjectFile'
import type { ProjectFileSnapshot } from './types'
import { buildExtractionDraft, buildPdfTextLayer, confirmCandidate, rejectCandidate } from '../document-extraction'
import type { RawPdfTextPage } from '../document-extraction/textLayer'
import { fixtureBytes, fixtureSha256, readPdfTextPages } from '../document-extraction/__tests__/helpers/pdfFixture'
import { rewriteArchive } from '../../desktop/tests/helpers/legacyArchive'

async function snapshotWithDrafts(): Promise<ProjectFileSnapshot> {
  const pdf = fixtureBytes('taskbook-TB-2026-1110.pdf')
  const pdfSha = fixtureSha256('taskbook-TB-2026-1110.pdf')
  const base = await createSampleSnapshot()
  const { pages, pageCount } = await readPdfTextPages('taskbook-TB-2026-1110.pdf')
  const layer = buildPdfTextLayer(pages)
  const draft = buildExtractionDraft({
    projectId: base.project.id,
    baseToken: `base-${base.project.id}`,
    source: {
      documentId: 'doc-1',
      revisionId: 'sr-1',
      sha256: pdfSha,
      blobKey: 'blob-1',
      pageCount,
    },
    pageRange: { from: 1, to: 2 },
    layer,
  })
  return {
    ...base,
    project: { ...base.project, extractionDrafts: [draft] },
    documents: [{ ...base.documents[0]!, title: 'taskbook-TB-2026-1110.pdf' }],
    revisions: [
      {
        ...base.revisions[0]!,
        fileName: 'taskbook-TB-2026-1110.pdf',
        sha256: pdfSha,
        byteSize: pdf.byteLength,
        pageCount,
      },
    ],
    blobs: [{ ...base.blobs[0]!, sha256: pdfSha, byteSize: pdf.byteLength }],
    attachments: [{ blobKey: 'blob-1', bytes: pdf }],
  }
}

function findRing(snapshot: ProjectFileSnapshot, symbol: string) {
  const draft = snapshot.project.extractionDrafts[0]!
  const found = draft.candidates.find(
    (candidate) => candidate.kind === 'ring' && candidate.data.symbol === symbol,
  )
  if (found === undefined) throw new Error(`找不到 ${symbol}`)
  return { draft, candidate: found }
}

describe('schema8→9：提取草稿持久化与严格校验', () => {
  it('候选/出处/决定往返：schema11 编码解码逐字段保留', async () => {
    const snapshot = await snapshotWithDrafts()
    const { draft } = findRing(snapshot, 'H')
    const decided = confirmCandidate(draft, {
      candidateId: findRing(snapshot, 'H').candidate.candidateId,
      editRevision: 0,
      confirmed: true,
      actor: 'local-operator',
      decidedAt: '2026-11-10T09:00:00.000Z',
    })
    expect(decided.ok).toBe(true)
    if (!decided.ok) return
    const rejected = rejectCandidate(decided.value, {
      candidateId: findRing(snapshot, 'S').candidate.candidateId,
      editRevision: 0,
      actor: 'local-operator',
      decidedAt: '2026-11-10T09:01:00.000Z',
      reason: '长度需人工核对',
    })
    expect(rejected.ok).toBe(true)
    if (!rejected.ok) return

    const withDecision: ProjectFileSnapshot = {
      ...snapshot,
      project: { ...snapshot.project, extractionDrafts: [rejected.value] },
    }
    const encoded = await encodeProjectFile(withDecision)
    expect(encoded.ok, encoded.ok ? '' : `${encoded.error.code}: ${encoded.error.message}`).toBe(true)
    if (!encoded.ok) return
    expect(encoded.value.manifest.project.projectSchemaVersion).toBe(11)

    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value.snapshot.project.extractionDrafts).toEqual([rejected.value])
    expect(decoded.value.snapshot.project.dimensionChain).toEqual(snapshot.project.dimensionChain)
    expect(decoded.value.snapshot.project.dimensionChain.target).toEqual({ minQ: 1000, maxQ: 3000 })
    expect(decoded.value.snapshot.project.parameters).toEqual([])
    expect(decoded.value.snapshot.bindings).toEqual(snapshot.bindings)
    expect(decoded.value.snapshot.project.requirementRevisions).toEqual([])
  })

  it('切块草稿（170 页）往返：CHUNK_* issue 的 chunk 页范围逐字段保留', async () => {
    const snapshot = await snapshotWithDrafts()
    const pages: RawPdfTextPage[] = Array.from({ length: 170 }, (_, index) => ({
      page: index + 1,
      view: [0, 0, 595, 842],
      items: [
        {
          str: `A${String(index + 1).padStart(3, '0')} = 10 mm`,
          transform: [1, 0, 0, 1, 60, 780],
          width: 320,
          height: 12,
          hasEOL: true,
        },
      ],
    }))
    const draft = buildExtractionDraft({
      projectId: snapshot.project.id,
      baseToken: `base-${snapshot.project.id}`,
      source: {
        documentId: 'doc-1',
        revisionId: 'sr-1',
        sha256: snapshot.revisions[0]!.sha256,
        blobKey: 'blob-1',
        pageCount: 170,
      },
      pageRange: { from: 1, to: 170 },
      layer: buildPdfTextLayer(pages),
    })
    // 切块生效：170 条候选、两条块踪迹，没有 PAGE_LIMIT。
    expect(draft.candidates).toHaveLength(170)
    expect(draft.issues.some((item) => item.code === 'PAGE_LIMIT')).toBe(false)

    const chunked: ProjectFileSnapshot = {
      ...snapshot,
      project: { ...snapshot.project, extractionDrafts: [draft] },
      revisions: [{ ...snapshot.revisions[0]!, pageCount: 170 }],
    }
    const encoded = await encodeProjectFile(chunked)
    expect(encoded.ok, encoded.ok ? '' : JSON.stringify(encoded.error)).toBe(true)
    if (!encoded.ok) return
    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok, decoded.ok ? '' : `${decoded.error.code}: ${decoded.error.message}`).toBe(true)
    if (!decoded.ok) return
    const roundTrip = decoded.value.snapshot.project.extractionDrafts[0]!
    expect(
      roundTrip.issues
        .filter((item) => item.code === 'CHUNK_PROCESSED')
        .map((item) => item.chunk),
    ).toEqual([
      { index: 1, from: 1, to: 100 },
      { index: 2, from: 101, to: 170 },
    ])
    // 纯加法字段：其余内容逐字段不变（解码后键顺序由 schema 决定，用深比较）。
    expect(roundTrip).toEqual(draft)
  })

  it('旧 schema7 文件缺少 extractionDrafts：读入补空数组，不凭空造候选', async () => {
    const snapshot = await snapshotWithDrafts()
    const encoded = await encodeProjectFile({ ...snapshot, project: { ...snapshot.project, extractionDrafts: [] } })
    if (!encoded.ok) throw new Error(encoded.error.message)
    const legacy = await rewriteArchive(encoded.value.bytes, (parts) => {
      const strip = (project: Record<string, unknown>): void => {
        project.schemaVersion = 7
        delete project.extractionDrafts
        delete project.sourceKind
        delete project.actorId
        delete project.sessionSeq
        delete project.sessionLabel
        delete project.attestations
      }
      for (const [path, bytes] of parts) {
        if (path === 'project/project.json') {
          const value = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
          strip(value)
          parts.set(path, new TextEncoder().encode(JSON.stringify(value)))
        }
        if (path.startsWith('revisions/')) {
          const revision = JSON.parse(new TextDecoder().decode(bytes)) as { project: Record<string, unknown> }
          strip(revision.project)
          parts.set(path, new TextEncoder().encode(JSON.stringify(revision)))
        }
        if (path === 'manifest.json') {
          const manifest = JSON.parse(new TextDecoder().decode(bytes)) as {
            project: Record<string, unknown>
          }
          manifest.project.projectSchemaVersion = 7
          parts.set(path, new TextEncoder().encode(JSON.stringify(manifest)))
        }
      }
    })
    const decoded = await decodeProjectFile(legacy)
    expect(decoded.ok, decoded.ok ? '' : `${decoded.error.code}: ${decoded.error.message}`).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value.snapshot.project.schemaVersion).toBe(11)
    expect(decoded.value.snapshot.project.extractionDrafts).toEqual([])
  })

  it('schema7 项目混入 extractionDrafts：严格拒绝（不偷偷扩展旧 schema）', async () => {
    const snapshot = await snapshotWithDrafts()
    const encoded = await encodeProjectFile(snapshot)
    if (!encoded.ok) throw new Error(encoded.error.message)
    const legacy = await rewriteArchive(encoded.value.bytes, (parts) => {
      for (const [path, bytes] of parts) {
        if (path === 'project/project.json') {
          const value = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
          value.schemaVersion = 7
          parts.set(path, new TextEncoder().encode(JSON.stringify(value)))
        }
        if (path === 'manifest.json') {
          const manifest = JSON.parse(new TextDecoder().decode(bytes)) as {
            project: Record<string, unknown>
          }
          manifest.project.projectSchemaVersion = 7
          parts.set(path, new TextEncoder().encode(JSON.stringify(manifest)))
        }
      }
    })
    const decoded = await decodeProjectFile(legacy)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe('INVALID_RECORD')
  })

  it('伪造“已确认但无决定”或篡改确认快照：编码前拒绝', async () => {
    const snapshot = await snapshotWithDrafts()
    const draft = snapshot.project.extractionDrafts[0]!
    const forged: ProjectFileSnapshot = {
      ...snapshot,
      project: {
        ...snapshot.project,
        extractionDrafts: [
          {
            ...draft,
            candidates: draft.candidates.map((candidate, index) => ({
              ...candidate,
              status: index === 0 ? ('confirmed' as const) : candidate.status,
            })),
          },
        ],
      },
    }
    const encoded = await encodeProjectFile(forged)
    expect(encoded.ok).toBe(false)
    if (!encoded.ok) expect(encoded.error.code).toBe('INVALID_RECORD')

    // 真确认后把数值改掉但保留旧决定：快照不一致，同样拒绝。
    const candidate = findRing(snapshot, 'H').candidate
    const confirmed = confirmCandidate(draft, {
      candidateId: candidate.candidateId,
      editRevision: 0,
      confirmed: true,
      actor: 'local-operator',
      decidedAt: '2026-11-10T09:00:00.000Z',
    })
    if (!confirmed.ok) throw new Error(confirmed.message)
    const tamperedDraft = {
      ...confirmed.value,
      candidates: confirmed.value.candidates.map((item) =>
        item.candidateId !== candidate.candidateId
          ? item
          : {
              ...item,
              data: {
                ...(item.data as { nominal: { text: string } }),
                nominal: { ...(item.data as { nominal: { text: string } }).nominal, text: '52.25' },
              },
            },
      ),
    }
    const tampered: ProjectFileSnapshot = {
      ...snapshot,
      project: { ...snapshot.project, extractionDrafts: [tamperedDraft as typeof draft] },
    }
    const rejected = await encodeProjectFile(tampered)
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.error.code).toBe('INVALID_RECORD')
  })

  it('草稿引用的 PDF 版本不在项目里：拒绝（MISSING_REFERENCE）', async () => {
    const snapshot = await snapshotWithDrafts()
    const draft = snapshot.project.extractionDrafts[0]!
    const broken: ProjectFileSnapshot = {
      ...snapshot,
      project: {
        ...snapshot.project,
        extractionDrafts: [
          {
            ...draft,
            sourceIdentity: { ...draft.sourceIdentity, revisionId: 'sr-missing' },
            candidates: [],
            issues: [],
            decisions: [],
          },
        ],
      },
    }
    const encoded = await encodeProjectFile(broken)
    expect(encoded.ok).toBe(false)
    if (!encoded.ok) expect(encoded.error.code).toBe('MISSING_REFERENCE')
  })
})
