import { candidateNumericFields, type ExtractionCandidate } from '../document-extraction/types'

/** Structural display boundary: never infer a reading from a verification flag. */
export interface AgentReadSource {
  readonly kind: 'agent-read'
  readonly actorId: string
  readonly statement: string
  readonly source:
    | { readonly kind: 'pdf-page'; readonly revisionId: string; readonly sha256: string; readonly page: number }
    | { readonly kind: 'image'; readonly imageId: string; readonly sha256: string }
}

export function agentReadSources(refs: readonly unknown[]): AgentReadSource[] {
  const seen = new Set<string>()
  return refs.filter((ref): ref is AgentReadSource => {
    if (typeof ref !== 'object' || ref === null || !('kind' in ref) || ref.kind !== 'agent-read') return false
    const reading = ref as AgentReadSource
    const key = JSON.stringify(reading)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function provenanceOf(value: unknown): readonly unknown[] {
  if (typeof value !== 'object' || value === null || !('provenance' in value)) return []
  return Array.isArray(value.provenance) ? value.provenance : []
}

export function candidateReadSources(candidate: ExtractionCandidate): AgentReadSource[] {
  return agentReadSources([
    ...(candidate.provenance ?? []),
    ...candidateNumericFields(candidate).flatMap(({ value }) => value.provenance ?? []),
  ])
}

export function readingSourceLabel(reading: AgentReadSource): string {
  return `${reading.source.kind === 'pdf-page' ? `第 ${reading.source.page} 页` : '图片'}，${reading.actorId} 提供`
}
