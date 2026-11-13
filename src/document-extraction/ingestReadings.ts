import { formatMm, tryParseMm } from '../domain/units'
import { stableId } from './ids'
import { extractionFailure, extractionSuccess, isProvenanceCompleteness,
  type AgentReadEvidence, type ExtractionCandidate, type ExtractionDraft,
  type ExtractionResult, type QuantityValue } from './types'

export interface ReadingInput {
  readonly kind: 'dimension'
  readonly symbol: string
  readonly nominalQ: number
  readonly upperDeviationQ: number
  readonly lowerDeviationQ: number
  readonly unit: 'mm'
}
export interface IngestReadingsInput {
  readonly source: AgentReadEvidence['source']
  readonly statement: string
  readonly readings: readonly ReadingInput[]
  readonly actorId: string
  readonly at: string
  readonly sessionSeq: number
  readonly turnId: string
  readonly modelId: string | null
}

/** 外部读数只进待核对候选。evidence 始终为空：绝不声称 PDF 有这段文本。 */
export function ingestReadings(draft: ExtractionDraft, input: IngestReadingsInput): ExtractionResult<ExtractionDraft> {
  const ref: AgentReadEvidence = {
    kind: 'agent-read', actorId: input.actorId, at: input.at, sessionSeq: input.sessionSeq,
    turnId: input.turnId, modelId: input.modelId, source: input.source, statement: input.statement,
  }
  if (!isProvenanceCompleteness(ref)) return extractionFailure('EVIDENCE_REQUIRED', '读数出处不完整')
  if (input.statement.length > 4000 || !Array.isArray(input.readings) || input.readings.length < 1 ||
    input.readings.length > 20 || draft.candidates.length + input.readings.length > 200) {
    return extractionFailure('VALUE_UNSUPPORTED', '每批需 1..20 条读数，草稿最多 200 条')
  }
  const candidates: ExtractionCandidate[] = []
  for (const [index, reading] of input.readings.entries()) {
    if (!reading || reading.kind !== 'dimension' || reading.unit !== 'mm' ||
      typeof reading.symbol !== 'string' || !/^[\p{L}][\p{L}\p{N}_]{0,19}$/u.test(reading.symbol) ||
      ![reading.nominalQ, reading.upperDeviationQ, reading.lowerDeviationQ].every((q) => {
        if (!Number.isSafeInteger(q)) return false
        const parsed = tryParseMm(formatMm(q))
        return parsed.ok && parsed.value === q
      }) || reading.nominalQ <= 0 || reading.lowerDeviationQ > reading.upperDeviationQ) {
      return extractionFailure('VALUE_UNSUPPORTED', '读数需合法符号、安全整数 q、正基本尺寸、mm 及有序偏差；不换算或推算')
    }
    const quantity = (q: number): QuantityValue => {
      const text = formatMm(q)
      return { text, decimals: text.includes('.') ? text.length - text.indexOf('.') - 1 : 0,
        valueQ: q, unitText: 'mm', unit: 'mm', evidence: [], provenance: [ref] }
    }
    const previous = draft.candidates.filter((c) => c.kind === 'ring' && c.data.symbol === reading.symbol)
    if (previous.length > 1) return extractionFailure('VALUE_UNSUPPORTED', '同符号已有多处候选，请先解决冲突再补入读数')
    candidates.push({
      candidateId: previous[0]?.candidateId ?? stableId('reading', [draft.draftId, input.turnId, draft.draftRevision, index]),
      kind: 'ring', groupId: `ring:${reading.symbol}`, rawText: input.statement,
      page: ref.source.kind === 'pdf-page' ? ref.source.page : 1,
      status: 'pending', requiresVerification: true, batchConfirmable: false,
      confidence: 'low', confidenceBasis: ['EXTERNAL_READING_UNVERIFIED'], reasonCodes: [],
      evidence: [], provenance: [ref], editRevision: (previous[0]?.editRevision ?? 0) + 1, occurrence: null,
      data: { symbol: reading.symbol, name: null, nominal: quantity(reading.nominalQ),
        upperDeviation: quantity(reading.upperDeviationQ), lowerDeviation: quantity(reading.lowerDeviationQ) },
    })
  }
  const symbols = new Set(input.readings.map((reading) => reading.symbol))
  if (symbols.size !== input.readings.length) return extractionFailure('VALUE_UNSUPPORTED', '一批读数不能重复符号')
  // 补入既有工程意图时，取代同符号旧候选；旧决定留痕并失效，不继承确认。
  const replaced = draft.candidates.filter((candidate) => candidate.kind === 'ring' && symbols.has(candidate.data.symbol ?? ''))
  const replacedIds = new Set(replaced.map((candidate) => candidate.candidateId))
  return extractionSuccess({ ...draft, draftRevision: draft.draftRevision + 1,
    decisions: draft.decisions.map((decision) => replacedIds.has(decision.candidateId)
      ? { ...decision, invalidatedByEditRevision: draft.draftRevision + 1 } : decision),
    candidates: [...draft.candidates.filter((candidate) => !replacedIds.has(candidate.candidateId)), ...candidates] })
}
