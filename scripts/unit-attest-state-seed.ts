/**
 * 「批量补单位做成真状态变更」证据夹具（显式运行，不进入 npm test）。
 *
 * 产物：
 * 1. `.cunlian` 项目文件：6 份真实语料 → 真实 pdfjs → buildExtractionDraft →
 *    `attestCandidateUnits`（45 条仅差单位真转 pending）→ 项目账本 45 条 user-attestation；
 * 2. 脱敏 JSON 片段：从 encodeProjectFile 写出的字节 **decodeProjectFile 回读**后取
 *    `project.attestations`，证明 user-attestation 真的在项目文件里（不是只改了内存/界面）。
 *
 *   UNIT_ATTEST_SEED_OUT=/abs/path/UNIT-ATTEST.cunlian \
 *   UNIT_ATTEST_JSON_OUT=/abs/path/project-attestation.json \
 *     npx vitest run --config vitest.v36fixture.config.ts
 *
 * 语料缺失/被替换直接失败，不静默跳过。
 */
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSampleSnapshot } from '../src/project-file/__fixtures__/sampleProjectFile'
import { decodeProjectFile, encodeProjectFile } from '../src/project-file/codec'
import type { ProjectFileSnapshot } from '../src/project-file/types'
import {
  attestCandidateUnits,
  buildExtractionDraft,
  buildPdfTextLayer,
  candidateNumericFields,
  isUnitOnlyCandidate,
  isProvenanceCompleteness,
  type AttestUnitsValue,
  type ExtractionDraft,
  type UserAttestation,
} from '../src/document-extraction'
import { extractPdfTextPages } from '../desktop/main/pdfTextExtract'
import { serializeEvidence } from './evidence-json.ts'

const SEED_OUT = process.env.UNIT_ATTEST_SEED_OUT
const JSON_OUT = process.env.UNIT_ATTEST_JSON_OUT
const repoRoot = path.resolve(__dirname, '..')
const CORPUS = process.env.REAL_DOC_CORPUS ?? path.join(process.env.HOME ?? '', 'DSH/tmp/cunlian-v36/real-docs')
const STATEMENT = '本表单位 mm（2026-11-12 复核）'
const ACTOR = 'local-operator'
const AT = '2026-11-12T00:00:00.000Z'

interface CorpusItem {
  doc: { id: string; file: string; sha256: string; pages: number }
  bytes: Uint8Array
  draft: ExtractionDraft
  attest: AttestUnitsValue
  ids: string[]
}

describe('批量补单位真状态：项目文件夹具', () => {
  it.skipIf(!SEED_OUT || !JSON_OUT)('45 条 user-attestation 写入项目文件并可回读', async () => {
    const manifest = JSON.parse(
      await fsp.readFile(path.join(repoRoot, 'docs/evidence/real-doc-baseline/corpus-manifest.json'), 'utf8'),
    ) as { documents: { id: string; file: string; sha256: string; pages: number }[] }
    const corpus: CorpusItem[] = []
    for (const [index, doc] of manifest.documents.entries()) {
      const bytes = new Uint8Array(await fsp.readFile(path.join(CORPUS, doc.file)))
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      expect(sha256, `语料 ${doc.file} 与 manifest sha256 不一致`).toBe(doc.sha256)
      const rawPages = await extractPdfTextPages(
        bytes,
        { from: 1, to: doc.pages },
        { maxTextItems: 200000, timeoutMs: 300000 },
      )
      const layer = buildPdfTextLayer(rawPages)
      const draft = buildExtractionDraft({
        projectId: 'project-a',
        baseToken: 'base-1',
        source: {
          documentId: `doc-${index + 1}`,
          revisionId: `sr-${index + 1}`,
          sha256,
          blobKey: `blob-${index + 1}`,
          pageCount: doc.pages,
        },
        pageRange: { from: 1, to: doc.pages },
        layer,
      })
      const ids = draft.candidates
        .filter((candidate) => isUnitOnlyCandidate(candidate))
        .map((candidate) => candidate.candidateId)
      const attested = attestCandidateUnits(draft, {
        candidateIds: ids,
        statement: STATEMENT,
        actor: ACTOR,
        decidedAt: AT,
        sessionSeq: index + 1,
        turnId: `unit-attest-seed-${index + 1}`,
        sessionLabel: null,
      })
      expect(attested.ok, attested.ok ? '' : attested.message).toBe(true)
      if (!attested.ok) return
      corpus.push({ doc, bytes, draft: attested.value.draft, attest: attested.value, ids })
    }

    const totalAttested = corpus.reduce((sum, item) => sum + item.ids.length, 0)
    expect(totalAttested).toBe(45)
    const converted = corpus.flatMap((item) =>
      item.attest.candidateIds.map((candidateId) => {
        const candidate = item.draft.candidates.find((entry) => entry.candidateId === candidateId)
        expect(candidate, `${candidateId} 不在补单位后的草稿里`).toBeDefined()
        if (candidate === undefined) throw new Error(`missing candidate ${candidateId}`)
        const fields = candidateNumericFields(candidate)
        const refs = fields.flatMap(({ value }) =>
          (value.provenance ?? []).filter(
            (entry): entry is UserAttestation => entry.kind === 'user-attestation',
          ),
        )
        const ref = refs[0]
        expect(candidate.status).toBe('pending')
        expect(ref, `${candidateId} 缺少 user-attestation`).toBeDefined()
        if (ref === undefined) throw new Error('missing attestation')
        expect(isProvenanceCompleteness(ref)).toBe(true)
        expect(ref.actorId).toBe(ACTOR)
        expect(ref.statement).toBe(STATEMENT)
        expect(Number.isSafeInteger(ref.sessionSeq)).toBe(true)
        expect(typeof ref.turnId === 'string' && ref.turnId !== '').toBe(true)
        expect(ref.revokedAt ?? null).toBeNull()
        return {
          documentId: `doc-${corpus.indexOf(item) + 1}`,
          candidateId,
          actorId: ref.actorId,
          sessionSeq: ref.sessionSeq,
          turnId: ref.turnId,
          statement: ref.statement,
          fieldPath: ref.fieldPath,
          values: fields.map(({ field, value }) => ({
            field,
            text: value.text,
            unit: value.unit,
            unitText: value.unitText,
          })),
        }
      }),
    )
    expect(converted).toHaveLength(45)

    const base = await createSampleSnapshot()
    const documents = corpus.map((item, index) => ({
      ...base.documents[0]!,
      id: `doc-${index + 1}`,
      title: item.doc.file,
      latestRevisionId: `sr-${index + 1}`,
    }))
    const revisions = corpus.map((item, index) => ({
      ...base.revisions[0]!,
      id: `sr-${index + 1}`,
      documentId: `doc-${index + 1}`,
      fileName: item.doc.file,
      sha256: item.doc.sha256,
      byteSize: item.bytes.byteLength,
      pageCount: item.doc.pages,
      blobKey: `blob-${index + 1}`,
    }))
    const blobs = corpus.map((item, index) => ({
      ...base.blobs[0]!,
      blobKey: `blob-${index + 1}`,
      sha256: item.doc.sha256,
      byteSize: item.bytes.byteLength,
    }))
    const attestations: UserAttestation[] = converted.map((entry) => ({
      kind: 'user-attestation',
      actorId: entry.actorId,
      at: AT,
      sessionSeq: entry.sessionSeq,
      sessionLabel: null,
      statement: entry.statement,
      fieldPath: entry.fieldPath,
      turnId: entry.turnId ?? null,
    }))
    const snapshot: ProjectFileSnapshot = {
      ...base,
      project: {
        ...base.project,
        sourceKind: 'pdf',
        actorId: ACTOR,
        sessionSeq: corpus.length,
        sessionLabel: null,
        attestations,
        extractionDrafts: corpus.map((item) => item.draft),
      },
      documents,
      revisions,
      bindings: [{ ...base.bindings[0]!, documentId: 'doc-1', revisionId: 'sr-1' }],
      blobs,
      attachments: corpus.map((item, index) => ({ blobKey: `blob-${index + 1}`, bytes: item.bytes })),
    }
    const encoded = await encodeProjectFile(snapshot)
    expect(encoded.ok, encoded.ok ? '' : JSON.stringify(encoded.error)).toBe(true)
    if (!encoded.ok) return
    await fsp.mkdir(path.dirname(SEED_OUT!), { recursive: true })
    await fsp.writeFile(SEED_OUT!, encoded.value.bytes)

    // 项目文件真的能读回来：不是只写内存，也不是只改界面。
    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok, decoded.ok ? '' : JSON.stringify(decoded.error)).toBe(true)
    if (!decoded.ok) return
    const readBack = decoded.value.snapshot.project.attestations
    expect(readBack).toHaveLength(45)
    expect(readBack.every((entry) => entry.statement === STATEMENT)).toBe(true)
    expect(readBack.every((entry) => entry.actorId === ACTOR)).toBe(true)
    expect(readBack.every((entry) => typeof entry.turnId === 'string' && entry.turnId !== '')).toBe(true)
    const revertedDrafts = decoded.value.snapshot.project.extractionDrafts
    const statuses = revertedDrafts.flatMap((draft) => draft.candidates.map((c) => c.status))
    expect(statuses.filter((status) => status === 'pending')).toHaveLength(103)
    expect(statuses.filter((status) => status === 'blocked')).toHaveLength(35)

    const payload = {
      schemaVersion: 1,
      task: '批量补单位做成真状态变更（项目文件出处）',
      file: path.basename(SEED_OUT!),
      note: '从 encodeProjectFile 写出的 .cunlian 字节 decodeProjectFile 回读；无绝对路径、无 PDF 正文，仅出处身份与声明原话。',
      extractorVersion: corpus[0]?.draft.extractorVersion ?? null,
      counts: {
        documents: corpus.length,
        candidates: statuses.length,
        pending: statuses.filter((status) => status === 'pending').length,
        blocked: statuses.filter((status) => status === 'blocked').length,
        userAttestations: readBack.length,
      },
      attestations: converted,
    }
    await fsp.mkdir(path.dirname(JSON_OUT!), { recursive: true })
    await fsp.writeFile(JSON_OUT!, serializeEvidence(payload))
    console.log(`SEED_WRITTEN ${SEED_OUT} · 45 条 user-attestation · 回读 pending 103 / blocked 35`)
    console.log(`JSON_WRITTEN ${JSON_OUT}`)
  }, 600_000)
})
