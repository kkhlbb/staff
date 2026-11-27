import { createHash } from 'node:crypto'
import type { ExportSimulationReportRequest, ExportSimulationReportResult } from '../transport/types'
import { canonicalJson, renderCsvReport } from './renderCsvReport'
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

function digest(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
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
    else if (format === 'csv') content = renderCsvReport(payload)
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
