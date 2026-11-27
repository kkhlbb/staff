import type { EvidenceRef } from '../document-extraction/types'
import type { SimulationReportPayloadV1 } from './types'

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
      : item,
  )
}

function csvRow(cells: readonly unknown[]): string {
  return cells.map(cell => {
    const text = String(cell ?? '')
    const safe = typeof cell === 'string' && /^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text
    return '"' + safe.replaceAll('"', '""') + '"'
  }).join(',')
}

function describeEvidenceRef(ref: EvidenceRef): {
  kind: string
  source: string
  excerpt: string
  actor: string
  hash: string
  timestamp: string
} {
  switch (ref.kind) {
    case 'agent-read': {
      const source = ref.source.kind === 'pdf-page'
        ? `pdf-page:${ref.source.revisionId}#p${ref.source.page}`
        : `image:${ref.source.imageId}`
      return {
        kind: ref.kind,
        source,
        excerpt: ref.statement,
        actor: ref.modelId ? `${ref.actorId} (${ref.modelId})` : ref.actorId,
        hash: ref.source.sha256,
        timestamp: ref.at,
      }
    }
    case 'pdf-ocr':
      return {
        kind: ref.kind,
        source: `${ref.documentId}@${ref.revisionId}#p${ref.page} (conf=${ref.confidence})`,
        excerpt: ref.textSnippet,
        actor: '',
        hash: ref.sha256,
        timestamp: '',
      }
    case 'image-ocr':
      return {
        kind: ref.kind,
        source: `${ref.fileName}#${ref.imageId} (conf=${ref.confidence})`,
        excerpt: ref.recognizedText,
        actor: '',
        hash: ref.sha256,
        timestamp: '',
      }
    case 'user-attestation': {
      const label = ref.sessionLabel ? `${ref.sessionLabel} (#${ref.sessionSeq})` : `#${ref.sessionSeq}`
      return {
        kind: ref.kind,
        source: `${ref.fieldPath} · ${label}`,
        excerpt: ref.statement,
        actor: ref.actorId,
        hash: '',
        timestamp: ref.at,
      }
    }
    case 'pdf-text':
    case undefined:
      return {
        kind: 'pdf-text',
        source: `${ref.documentId}@${ref.revisionId}#p${ref.page}`,
        excerpt: ref.textSnippet,
        actor: '',
        hash: ref.sha256,
        timestamp: '',
      }
  }
}

export function renderCsvReport(payload: SimulationReportPayloadV1): string {
  const rows: unknown[][] = [[
    'projectId', 'revision', 'draft', 'checksetFingerprint', 'seed', 'sampleCount', 'checkId', 'label',
    'status', 'mode', 'requirementLowerMm', 'requirementUpperMm', 'extremeLowerMm', 'extremeUpperMm',
    'threeSigmaLowerMm', 'threeSigmaUpperMm', 'Cp', 'Cpk', 'PPM', 'flexDeltaCpk',
  ]]
  const stamp = [payload.projectId, payload.revision, payload.isDraft, payload.checksetFingerprint, payload.seed, payload.sampleCount]
  for (const check of payload.conclusions) {
    for (const [mode, metrics] of [['rigid', check.rigid], ['compliant', check.compliant]] as const) {
      if (!metrics) continue
      rows.push([...stamp, check.checkId, check.label, check.status, mode, ...check.requirementMm,
        ...check.extremeIntervalMm, ...metrics.threeSigmaIntervalMm, metrics.cp, metrics.cpk, metrics.ppm, check.flexDeltaCpk])
    }
  }
  rows.push([])
  rows.push([
    'section', 'projectId', 'revision', 'draft', 'checksetFingerprint', 'seed', 'sampleCount',
    'evidenceTarget', 'evidenceKind', 'evidenceSource', 'evidenceExcerpt', 'evidenceActor',
    'evidenceHash', 'evidenceTimestamp', 'evidenceRefJson',
  ])
  for (const entry of payload.evidence) {
    const info = describeEvidenceRef(entry.ref)
    rows.push([
      'evidenceRef', ...stamp, entry.target, info.kind, info.source, info.excerpt,
      info.actor, info.hash, info.timestamp, canonicalJson(entry.ref),
    ])
  }
  return '\uFEFF' + rows.map(csvRow).join('\r\n') + '\r\n'
}
