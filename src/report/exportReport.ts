import { createHash } from 'node:crypto'
import type { EvidenceRef } from '../document-extraction/types'
import type { ExportSimulationReportRequest, ExportSimulationReportResult } from '../transport/types'
import { renderHtmlReport } from './renderHtmlReport'
import type { SimulationReportPayloadV1 } from './types'

const mimeTypes = {
  html: 'text/html',
  pdf: 'application/pdf',
  csv: 'text/csv',
  json: 'application/json',
} as const

export class ReportPdfUnavailable extends Error {
  readonly code = 'PDF_UNAVAILABLE'
  constructor() {
    super('PDF export requires the desktop renderer. Export HTML to print offline.')
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
      : item,
  )
}

function digest(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
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

function renderCsv(payload: SimulationReportPayloadV1): string {
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

export async function exportReport(
  payload: SimulationReportPayloadV1,
  format: ExportSimulationReportRequest['format'],
  printPdf?: (html: string) => Promise<Uint8Array>,
): Promise<ExportSimulationReportResult> {
  let content: string
  let sha256: string
  if (format === 'pdf') {
    if (!printPdf) throw new ReportPdfUnavailable()
    const bytes = Buffer.from(await printPdf(renderHtmlReport(payload)))
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('PDF renderer returned invalid bytes')
    content = bytes.toString('base64')
    sha256 = digest(bytes)
  } else {
    if (format === 'html') content = renderHtmlReport(payload)
    else if (format === 'csv') content = renderCsv(payload)
    // The embedded digest covers the canonical payload. The envelope digest covers the complete file.
    else content = canonicalJson({ ...payload, sha256: digest(canonicalJson(payload)) }) + '\n'
    sha256 = digest(content)
  }
  const fileStem = [payload.projectName, payload.revision].join('-').replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 100)
  return {
    fileName: `simulation-${fileStem}.${format}`,
    mimeType: mimeTypes[format],
    sha256,
    revision: payload.revision,
    checksetFingerprint: payload.checksetFingerprint,
    content,
  }
}
