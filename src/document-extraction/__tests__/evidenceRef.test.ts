// @vitest-environment node
/**
 * ADR-001：EvidenceRef 泛化的契约用例。
 *
 * 覆盖四条不变量中可在领域层验证的部分：
 * - I1：唯一闸门 isProvenanceCompleteness；pdf-text 分支与改前 isEvidenceComplete 逐条等价；
 * - I2：出处为空（含显式空 provenance）不能确认/不能进入应用计划；
 * - I3：失效按 kind 分开（pdf 看 revision sha、image 看图片 sha、attestation 只认显式撤销）；
 * - M24 目标：跨会话伪造 user-attestation 必须被 planApplication 拒绝。
 *
 * 不新增工具、不写项目：只走现有纯函数。
 */
import { describe, expect, it } from 'vitest'
import {
  buildSyntheticExtractionDraft,
  SYNTHETIC_DRAFT_SOURCE,
  syntheticTaskbookPage,
} from '../__fixtures__/draftFixture'
import { buildExtractionDraft } from '../parse'
import { buildPdfTextLayer } from '../textLayer'
import { confirmCandidate, planApplication } from '../draft'
import {
  candidateNumericFields,
  evidenceKey,
  isEvidenceComplete,
  isProvenanceCompleteness,
  provenanceKey,
  provenanceValidity,
  revokeAttestation,
  uniqueProvenance,
  valueProvenance,
  type EvidenceRef,
  type ExtractionCandidate,
  type ExtractionDraft,
  type ExtractionEvidence,
  type ImageOcrEvidence,
  type PdfOcrEvidence,
  type UserAttestation,
} from '../types'

const SOURCE = SYNTHETIC_DRAFT_SOURCE
const AT = '2026-11-12T09:00:00.000Z'

function draft(): ExtractionDraft {
  return buildSyntheticExtractionDraft({
    projectId: 'project-evidence-ref',
    baseToken: 'base-evidence-ref',
    source: SOURCE,
  })
}

function ringCandidate(input: ExtractionDraft, symbol: string): ExtractionCandidate {
  const found = input.candidates.find(
    (candidate) => candidate.kind === 'ring' && candidate.data.symbol === symbol,
  )
  if (found === undefined) throw new Error(`找不到组成环 ${symbol}`)
  return found
}

function firstEvidence(input: ExtractionDraft): ExtractionEvidence {
  const evidence = ringCandidate(input, 'H').evidence[0]
  if (evidence === undefined) throw new Error('缺少出处')
  return evidence
}

function attestation(overrides: Partial<UserAttestation> = {}): UserAttestation {
  return {
    kind: 'user-attestation',
    actorId: 'laowang',
    at: AT,
    sessionSeq: 1,
    sessionLabel: '2026-11-12 复检',
    statement: '总长按 52.20 算，我量的',
    fieldPath: 'ring.H.nominal',
    ...overrides,
  }
}

function pdfOcr(overrides: Partial<PdfOcrEvidence> = {}): PdfOcrEvidence {
  return {
    kind: 'pdf-ocr',
    documentId: 'doc-scan',
    revisionId: 'rev-scan',
    sha256: 'b'.repeat(64),
    blobKey: 'blob-scan',
    page: 3,
    rectPdf: [10, 10, 60, 20],
    pageBoxPdf: [0, 0, 612, 792],
    textSnippet: '52.20',
    confidence: 0.72,
    ...overrides,
  }
}

function imageOcr(overrides: Partial<ImageOcrEvidence> = {}): ImageOcrEvidence {
  return {
    kind: 'image-ocr',
    imageId: 'img-sketch-1',
    sha256: 'c'.repeat(64),
    fileName: '草图-01.jpg',
    rectPdf: [4, 4, 120, 60],
    recognizedText: 'H=52.2',
    confidence: 0.55,
    ...overrides,
  }
}

/** 用 attestation 替换 ring.nominal 的出处（其它字段仍是 pdf-text）。 */
function withNominalAttestation(
  input: ExtractionDraft,
  candidateId: string,
  attestations: readonly UserAttestation[],
): ExtractionDraft {
  return {
    ...input,
    draftRevision: input.draftRevision + 1,
    candidates: input.candidates.map((candidate) => {
      if (candidate.candidateId !== candidateId) return candidate
      if (candidate.kind !== 'ring' || candidate.data.nominal === null) {
        throw new Error('用例需要带基本尺寸的组成环候选')
      }
      return {
        ...candidate,
        data: {
          ...candidate.data,
          nominal: { ...candidate.data.nominal, evidence: [], provenance: attestations },
        },
      }
    }),
  }
}

describe('ADR-001 I1：唯一闸门（pdf-text 分支与改前逐条等价）', () => {
  const base = (): ExtractionEvidence => ({
    documentId: 'doc-1',
    revisionId: 'rev-1',
    sha256: 'a'.repeat(64),
    blobKey: 'blob-1',
    page: 1,
    rectPdf: [10, 10, 20, 20],
    pageBoxPdf: [0, 0, 612, 792],
    textSnippet: '52.20',
    normalizedSnippet: '52.20',
    textItemIndexes: [3, 4],
  })

  it('字段缺项逐个返回 false（与改前一致）', () => {
    expect(isProvenanceCompleteness(base())).toBe(true)
    const mutations: ((value: ExtractionEvidence) => ExtractionEvidence)[] = [
      (value) => ({ ...value, documentId: ' ' }),
      (value) => ({ ...value, revisionId: '' }),
      (value) => ({ ...value, sha256: '' }),
      (value) => ({ ...value, blobKey: '' }),
      (value) => ({ ...value, page: 0 }),
      (value) => ({ ...value, page: 1.5 }),
      (value) => ({ ...value, textSnippet: '  ' }),
      (value) => ({ ...value, textItemIndexes: [0, -1] }),
      (value) => ({ ...value, textItemIndexes: [0, 1.2] }),
      (value) => ({ ...value, rectPdf: [10, 10, 10, 20] }),
      (value) => ({ ...value, rectPdf: [10, 20, 20, 10] }),
      (value) => ({ ...value, pageBoxPdf: [0, 0, 0, 792] }),
      (value) => ({ ...value, rectPdf: [10, 10, 20, Number.NaN] }),
      (value) => ({ ...value, rectPdf: [10, 10, 20] as unknown as ExtractionEvidence['rectPdf'] }),
    ]
    for (const mutate of mutations) {
      const mutated = mutate(base())
      expect(isProvenanceCompleteness(mutated)).toBe(false)
      expect(isEvidenceComplete(mutated)).toBe(false)
    }
  })

  it('矩形包含容差是 1e-6：贴边通过，超出 1e-5 拒绝', () => {
    const touching = { ...base(), rectPdf: [0, 0, 612, 792] as const }
    expect(isProvenanceCompleteness(touching)).toBe(true)
    const insideEpsilon = { ...base(), rectPdf: [-5e-7, -5e-7, 612 + 5e-7, 792 + 5e-7] as const }
    expect(isProvenanceCompleteness(insideEpsilon)).toBe(true)
    const beyondEpsilon = { ...base(), rectPdf: [-1e-5, 0, 612, 792] as const }
    expect(isProvenanceCompleteness(beyondEpsilon)).toBe(false)
    const beyondTop = { ...base(), rectPdf: [0, 0, 612, 792 + 1e-5] as const }
    expect(isProvenanceCompleteness(beyondTop)).toBe(false)
  })

  it('null / undefined / 空值一律 false（I2 的空出处不是一个对象）', () => {
    expect(isProvenanceCompleteness(null)).toBe(false)
    expect(isProvenanceCompleteness(undefined)).toBe(false)
  })

  it('pdf-text 分支的 provenanceKey 与 evidenceKey 逐字节一致', () => {
    const input = draft()
    const evidence = firstEvidence(input)
    expect(provenanceKey(evidence)).toBe(evidenceKey(evidence))
    expect(provenanceKey(evidence)).toBe(
      [
        evidence.revisionId,
        evidence.page,
        evidence.rectPdf[0].toFixed(2),
        evidence.rectPdf[1].toFixed(2),
        evidence.rectPdf[2].toFixed(2),
        evidence.rectPdf[3].toFixed(2),
        evidence.textSnippet,
      ].join('#'),
    )
  })

  it('其它 kind 的 key 不与 pdf-text 碰撞，且同值去重', () => {
    const input = draft()
    const evidence = firstEvidence(input)
    const keys = [provenanceKey(evidence), provenanceKey(pdfOcr()), provenanceKey(imageOcr()), provenanceKey(attestation())]
    expect(new Set(keys).size).toBe(keys.length)
    expect(uniqueProvenance([attestation(), attestation()])).toHaveLength(1)
    expect(uniqueProvenance([evidence, evidence])).toHaveLength(1)
  })

  it('真实草稿：每个数值的 provenance 与 evidence 同序同 key（pdf 路径零变化）', () => {
    const input = draft()
    for (const candidate of input.candidates) {
      expect(candidate.provenance).toBeDefined()
      expect(candidate.provenance?.map((ref) => provenanceKey(ref))).toEqual(
        candidate.evidence.map((item) => evidenceKey(item)),
      )
      for (const { value } of candidateNumericFields(candidate)) {
        expect(value.provenance?.map((ref) => provenanceKey(ref))).toEqual(
          value.evidence.map((item) => evidenceKey(item)),
        )
        expect(valueProvenance(value)).toHaveLength(value.evidence.length)
      }
    }
  })

  it('pdf-ocr：完整通过；缺 confidence 或 confidence 越界拒绝', () => {
    expect(isProvenanceCompleteness(pdfOcr())).toBe(true)
    expect(isProvenanceCompleteness(pdfOcr({ confidence: 1.2 }))).toBe(false)
    expect(
      isProvenanceCompleteness({ ...pdfOcr(), confidence: Number.NaN } as PdfOcrEvidence),
    ).toBe(false)
    expect(isProvenanceCompleteness(pdfOcr({ page: 0 }))).toBe(false)
    expect(isProvenanceCompleteness(pdfOcr({ rectPdf: [60, 10, 10, 20] }))).toBe(false)
  })

  it('image-ocr：锚在图片本身；缺 imageId/sha/识别文本拒绝', () => {
    expect(isProvenanceCompleteness(imageOcr())).toBe(true)
    expect(isProvenanceCompleteness(imageOcr({ imageId: ' ' }))).toBe(false)
    expect(isProvenanceCompleteness(imageOcr({ sha256: '' }))).toBe(false)
    expect(isProvenanceCompleteness(imageOcr({ recognizedText: '' }))).toBe(false)
    expect(isProvenanceCompleteness(imageOcr({ confidence: -0.1 }))).toBe(false)
    expect(isProvenanceCompleteness(imageOcr({ rectPdf: [10, 10, 10, 10] }))).toBe(false)
  })

  it('user-attestation：actorId/sessionSeq/statement/fieldPath/at 缺一不可', () => {
    expect(isProvenanceCompleteness(attestation())).toBe(true)
    expect(isProvenanceCompleteness(attestation({ actorId: ' ' }))).toBe(false)
    expect(isProvenanceCompleteness(attestation({ sessionSeq: 0 }))).toBe(false)
    expect(isProvenanceCompleteness(attestation({ statement: '   ' }))).toBe(false)
    expect(isProvenanceCompleteness(attestation({ fieldPath: '' }))).toBe(false)
    expect(isProvenanceCompleteness(attestation({ at: 'not-a-date' }))).toBe(false)
    expect(isProvenanceCompleteness(attestation({ sessionLabel: null }))).toBe(true)
  })
})

describe('ADR-001 I2：出处非空（显式空 provenance 等同非法）', () => {
  it('evidence 仍在但 provenance 显式为 [] → 不能确认', () => {
    const input = draft()
    const target = ringCandidate(input, 'H')
    const stripped: ExtractionDraft = {
      ...input,
      candidates: input.candidates.map((candidate) => {
        if (candidate.candidateId !== target.candidateId) return candidate
        if (candidate.kind !== 'ring' || candidate.data.nominal === null) return candidate
        return {
          ...candidate,
          data: { ...candidate.data, nominal: { ...candidate.data.nominal, provenance: [] } },
        }
      }),
    }
    const strippedCandidate = ringCandidate(stripped, 'H')
    expect(
      confirmCandidate(stripped, {
        candidateId: strippedCandidate.candidateId,
        editRevision: strippedCandidate.editRevision,
        confirmed: true,
        actor: 'local-operator',
        decidedAt: AT,
      }),
    ).toMatchObject({ ok: false, code: 'EVIDENCE_REQUIRED' })
  })

  it('候选级 provenance 为空（公式表达式）→ 不能确认', () => {
    const input = draft()
    const formula = input.candidates.find((candidate) => candidate.kind === 'formula')
    if (formula === undefined) throw new Error('合成草稿应包含公式候选')
    const stripped: ExtractionDraft = {
      ...input,
      candidates: input.candidates.map((candidate) =>
        candidate.candidateId === formula.candidateId
          ? { ...candidate, evidence: [], provenance: [] }
          : candidate,
      ),
    }
    const target = stripped.candidates.find((candidate) => candidate.kind === 'formula')
    if (target === undefined) throw new Error('缺少公式候选')
    expect(
      confirmCandidate(stripped, {
        candidateId: target.candidateId,
        editRevision: target.editRevision,
        confirmed: true,
        actor: 'local-operator',
        decidedAt: AT,
      }),
    ).toMatchObject({ ok: false, code: 'CANDIDATE_BLOCKED' })
  })
})

describe('ADR-001 I3：失效按 kind 分开', () => {
  const state = {
    revisions: [{ revisionId: SOURCE.revisionId, sha256: SOURCE.sha256 }],
    images: [{ imageId: 'img-sketch-1', sha256: 'c'.repeat(64) }],
  }

  it('pdf-text：revision sha 变化 → stale；版本消失 → stale', () => {
    const evidence = firstEvidence(draft())
    expect(provenanceValidity(evidence, state)).toBe('valid')
    expect(
      provenanceValidity(evidence, {
        revisions: [{ revisionId: SOURCE.revisionId, sha256: 'd'.repeat(64) }],
      }),
    ).toBe('stale')
    expect(provenanceValidity(evidence, { revisions: [] })).toBe('stale')
  })

  it('image-ocr：图片 sha 变化 → stale；PDF 变化不影响它', () => {
    const image = imageOcr()
    expect(provenanceValidity(image, state)).toBe('valid')
    expect(
      provenanceValidity(image, {
        revisions: [],
        images: [{ imageId: 'img-sketch-1', sha256: 'e'.repeat(64) }],
      }),
    ).toBe('stale')
  })

  it('user-attestation：文件怎么变都不 stale，只有显式撤销才失效', () => {
    const item = attestation()
    expect(provenanceValidity(item, { revisions: [], images: [] })).toBe('valid')
    const revoked = revokeAttestation(item, {
      by: 'laowang',
      at: '2026-11-12T10:00:00.000Z',
      statement: '这条我记错了',
    })
    expect(provenanceValidity(revoked, { revisions: [], images: [] })).toBe('revoked')
    // 撤销留痕：原话与身份字段不被改写，出处不被删除。
    expect(revoked.statement).toBe(item.statement)
    expect(revoked.actorId).toBe(item.actorId)
    expect(revoked.sessionSeq).toBe(item.sessionSeq)
    expect(revoked.revokedBy).toBe('laowang')
    expect(revoked.revokedStatement).toBe('这条我记错了')
    expect(isProvenanceCompleteness(revoked)).toBe(true)
  })

  it('planApplication 逐条比对 pdf 出处：指向其它 revision → SOURCE_STALE', () => {
    const input = draft()
    const target = ringCandidate(input, 'H')
    const confirmed = confirmCandidate(input, {
      candidateId: target.candidateId,
      editRevision: target.editRevision,
      confirmed: true,
      actor: 'local-operator',
      decidedAt: AT,
    })
    if (!confirmed.ok) throw new Error(confirmed.message)
    const forged: ExtractionDraft = {
      ...confirmed.value,
      candidates: confirmed.value.candidates.map((candidate) => {
        if (candidate.candidateId !== target.candidateId) return candidate
        if (candidate.kind !== 'ring' || candidate.data.nominal === null) return candidate
        return {
          ...candidate,
          data: {
            ...candidate.data,
            nominal: {
              ...candidate.data.nominal,
              provenance: candidate.data.nominal.provenance?.map((ref) => ({
                ...ref,
                revisionId: 'rev-other',
              })),
            },
          },
        }
      }),
    }
    expect(
      planApplication(forged, {
        candidateIds: [target.candidateId],
        source: { revisionId: SOURCE.revisionId, sha256: SOURCE.sha256 },
      }),
    ).toMatchObject({ ok: false, code: 'SOURCE_STALE' })
  })
})

describe('ADR-001 §4 / M24 目标：跨会话伪造 user-attestation 一律拒绝', () => {
  function confirmedWithAttestation(item: UserAttestation): {
    draft: ExtractionDraft
    candidateId: string
  } {
    const input = draft()
    const target = ringCandidate(input, 'H')
    const withAttestation = withNominalAttestation(input, target.candidateId, [item])
    const candidate = ringCandidate(withAttestation, 'H')
    const confirmed = confirmCandidate(withAttestation, {
      candidateId: candidate.candidateId,
      editRevision: candidate.editRevision,
      confirmed: true,
      actor: 'local-operator',
      decidedAt: AT,
    })
    if (!confirmed.ok) throw new Error(confirmed.message)
    return { draft: confirmed.value, candidateId: candidate.candidateId }
  }

  const source = { revisionId: SOURCE.revisionId, sha256: SOURCE.sha256 }

  it('同一 actorId + sessionSeq：可以生成应用计划，且计划携带 attestation 出处', () => {
    const item = attestation()
    const { draft: confirmed, candidateId } = confirmedWithAttestation(item)
    const plan = planApplication(confirmed, {
      candidateIds: [candidateId],
      source,
      session: { actorId: item.actorId, sessionSeq: item.sessionSeq },
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const planItem = plan.value.items.find((entry) => entry.candidateId === candidateId)
    expect(planItem?.provenance.some((ref) => provenanceKey(ref) === provenanceKey(item))).toBe(true)
  })

  it('actorId 不同（跨会话伪造）→ ATTESTATION_SESSION_MISMATCH', () => {
    const item = attestation()
    const { draft: confirmed, candidateId } = confirmedWithAttestation(item)
    expect(
      planApplication(confirmed, {
        candidateIds: [candidateId],
        source,
        session: { actorId: 'mallory', sessionSeq: item.sessionSeq },
      }),
    ).toMatchObject({ ok: false, code: 'ATTESTATION_SESSION_MISMATCH' })
  })

  it('sessionSeq 不同（同一人另一轮）→ ATTESTATION_SESSION_MISMATCH', () => {
    const item = attestation()
    const { draft: confirmed, candidateId } = confirmedWithAttestation(item)
    expect(
      planApplication(confirmed, {
        candidateIds: [candidateId],
        source,
        session: { actorId: item.actorId, sessionSeq: item.sessionSeq + 1 },
      }),
    ).toMatchObject({ ok: false, code: 'ATTESTATION_SESSION_MISMATCH' })
  })

  it('完全没有会话信息 → 拒绝（不能默认采信）', () => {
    const item = attestation()
    const { draft: confirmed, candidateId } = confirmedWithAttestation(item)
    expect(
      planApplication(confirmed, { candidateIds: [candidateId], source }),
    ).toMatchObject({ ok: false, code: 'ATTESTATION_SESSION_MISMATCH' })
  })

  it('已撤销的 attestation → PROVENANCE_REVOKED（出处仍在，但不再有效）', () => {
    const item = attestation()
    const { draft: confirmed, candidateId } = confirmedWithAttestation(item)
    const revoked: ExtractionDraft = {
      ...confirmed,
      candidates: confirmed.candidates.map((candidate) =>
        candidate.candidateId === candidateId && candidate.kind === 'ring'
          ? {
              ...candidate,
              data: {
                ...candidate.data,
                nominal:
                  candidate.data.nominal === null
                    ? null
                    : {
                        ...candidate.data.nominal,
                        provenance: candidate.data.nominal.provenance?.map((ref) =>
                          ref.kind === 'user-attestation'
                            ? revokeAttestation(ref, {
                                by: item.actorId,
                                at: AT,
                                statement: '这条我记错了',
                              })
                            : ref,
                        ),
                      },
              },
            }
          : candidate,
      ),
    }
    expect(
      planApplication(revoked, {
        candidateIds: [candidateId],
        source,
        session: { actorId: item.actorId, sessionSeq: item.sessionSeq },
      }),
    ).toMatchObject({ ok: false, code: 'PROVENANCE_REVOKED' })
  })
})

describe('ADR-001：pdf 路径计划项与改前一致', () => {
  it('未带 session/images 的 pdf 计划：项数、字段与原证据不改', () => {
    const input = draft()
    const target = ringCandidate(input, 'H')
    const confirmed = confirmCandidate(input, {
      candidateId: target.candidateId,
      editRevision: target.editRevision,
      confirmed: true,
      actor: 'local-operator',
      decidedAt: AT,
    })
    if (!confirmed.ok) throw new Error(confirmed.message)
    const plan = planApplication(confirmed.value, {
      candidateIds: [target.candidateId],
      source: { revisionId: SOURCE.revisionId, sha256: SOURCE.sha256 },
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const [item] = plan.value.items
    expect(item?.evidence).toEqual(target.evidence)
    expect(item?.provenance.map((ref) => provenanceKey(ref))).toEqual(
      target.evidence.map((evidence) => evidenceKey(evidence)),
    )
    expect(item?.fields.map((field) => field.field)).toEqual(
      ['nominal', 'upperDeviation', 'lowerDeviation'].filter((field) =>
        candidateNumericFields(target).some((entry) => entry.field === field),
      ),
    )
  })

  it('合成任务书草稿的候选数/ID 由真实解析产生（不是用例手写）', () => {
    const input = buildExtractionDraft({
      projectId: 'project-evidence-ref',
      baseToken: 'base-evidence-ref',
      source: SOURCE,
      pageRange: { from: 1, to: 1 },
      layer: buildPdfTextLayer([syntheticTaskbookPage()]),
    })
    expect(input.candidates).toHaveLength(5)
    const ids = input.candidates.map((candidate) => candidate.candidateId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(input.candidates.map((candidate) => candidate.status)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
      'blocked',
    ])
  })
})

/** 编译期检查：EvidenceRef 联合覆盖四支，供后续步骤引用。 */
const _kindSamples: readonly EvidenceRef[] = [
  ...(draft().candidates[0]?.evidence ?? []),
  pdfOcr(),
  imageOcr(),
  attestation(),
]
void _kindSamples
