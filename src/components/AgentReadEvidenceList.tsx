import { agentReadSources, readingSourceLabel } from '../sources/agentReadDisplay'

/** Read-only provenance; statements remain verbatim React text, never markup. */
export function AgentReadEvidenceList({ provenance }: { provenance?: readonly unknown[] }) {
  const readings = agentReadSources(provenance ?? [])
  if (readings.length === 0) return null
  return <ul aria-label="读数出处">{readings.map((reading, index) => (
    <li key={index}>
      <strong>读数来源：{readingSourceLabel(reading)}</strong>
      <p>读数说明（原话）：{reading.statement}</p>
      <small>{reading.source.kind === 'pdf-page' ? `来源 PDF · 第 ${reading.source.page} 页` : '来源图片'} · 校验信息保存在项目文件中</small>
    </li>
  ))}</ul>
}
