import { agentReadSources, readingSourceLabel } from '../sources/agentReadDisplay'

/** Read-only provenance; statements remain verbatim React text, never markup. */
export function AgentReadEvidenceList({ provenance }: { provenance?: readonly unknown[] }) {
  const readings = agentReadSources(provenance ?? [])
  if (readings.length === 0) return null
  return <ul aria-label="读数出处">{readings.map((reading, index) => (
    <li key={index}>
      <strong>读数来源：{readingSourceLabel(reading)}</strong>
      <p>读数说明（原话）：{reading.statement}</p>
      <small>{reading.source.kind === 'pdf-page' ? reading.source.revisionId : reading.source.imageId} · SHA-256 {reading.source.sha256}</small>
    </li>
  ))}</ul>
}
