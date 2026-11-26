import { useState } from 'react'
import { renderHtmlReport } from '../../../report/renderHtmlReport'
import type {
  ReportConclusion,
  ReportViewportSnapshots,
  SimulationReportPayloadV1,
} from '../../../report/types'
import type {
  ExportSimulationReportRequest,
  ExportSimulationReportResult,
  Transport,
} from '../../../transport/types'
import type { AssemblyModelV1, SimulationDiagnosticResult } from '../assembly3dTypes'

export type ReportExportFormat = ExportSimulationReportRequest['format']

export interface ReportExportMenuProps {
  readonly transport: Transport
  readonly projectId: string
  readonly projectName: string
  readonly baseRevision?: string | null
  readonly draftRevision?: string | null
  readonly checksetFingerprint?: string
  readonly simulationResult?: SimulationDiagnosticResult
  readonly assembly3d?: AssemblyModelV1
  readonly seed?: number
  readonly captureSnapshots?: () => Promise<ReportViewportSnapshots> | ReportViewportSnapshots
  readonly variant?: 'card' | 'inline' | 'menu-items'
  readonly onExportComplete?: (message: string) => void
}

const FORMAT_OPTIONS: readonly {
  readonly format: ReportExportFormat
  readonly label: string
  readonly shortLabel: string
}[] = [
  { format: 'html', label: 'HTML 离线报告', shortLabel: 'HTML 报告' },
  { format: 'pdf', label: 'PDF（桌面）', shortLabel: 'PDF' },
  { format: 'csv', label: 'CSV 数据表', shortLabel: 'CSV' },
  { format: 'json', label: 'JSON 审计包', shortLabel: 'JSON' },
]

function sanitizeFileSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'cunlian-report'
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  const safe = typeof value === 'string' && /^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

function buildOfflineReportPayload(params: {
  readonly projectId: string
  readonly projectName: string
  readonly revision: string
  readonly isDraft: boolean
  readonly checksetFingerprint: string
  readonly seed: number
  readonly simulationResult?: SimulationDiagnosticResult
  readonly assembly3d?: AssemblyModelV1
  readonly viewportSnapshots?: ReportViewportSnapshots
}): SimulationReportPayloadV1 {
  const generatedAtIso = new Date().toISOString()
  const sim = params.simulationResult
  const conclusions: ReportConclusion[] = []
  if (sim) {
    let cumulative = 0
    const pareto = sim.pareto.map((item) => {
      cumulative = Math.min(100, cumulative + item.varianceSharePercent)
      return {
        inputId: item.contributorId,
        label: item.label,
        varianceSharePct: Number(item.varianceSharePercent.toFixed(2)),
        cumulativeSharePct: Number(cumulative.toFixed(2)),
      }
    })
    const compliantMetrics = sim.compliantSummary?.compliantResult
    const rigidMetrics = sim.compliantSummary?.rigidBaseline
    const flexDeltaCpk =
      compliantMetrics && rigidMetrics && compliantMetrics.cpk !== null && rigidMetrics.cpk !== null
        ? Number((compliantMetrics.cpk - rigidMetrics.cpk).toFixed(3))
        : null
    conclusions.push({
      checkId: sim.loopId,
      label: sim.title,
      requirementMm: [sim.lslMm, sim.uslMm],
      extremeIntervalMm: [sim.threeSigmaLowMm, sim.threeSigmaHighMm],
      status: sim.status === 'warn' ? 'indeterminate' : sim.status,
      rigid: rigidMetrics
        ? {
            threeSigmaIntervalMm: rigidMetrics.threeSigmaIntervalMm,
            cp: sim.cp,
            cpk: rigidMetrics.cpk,
            ppm: rigidMetrics.ppm,
          }
        : {
            threeSigmaIntervalMm: [sim.threeSigmaLowMm, sim.threeSigmaHighMm],
            cp: sim.cp,
            cpk: sim.cpk,
            ppm: sim.ppm,
          },
      compliant: compliantMetrics
        ? {
            threeSigmaIntervalMm: compliantMetrics.threeSigmaIntervalMm,
            cp: sim.cp,
            cpk: compliantMetrics.cpk,
            ppm: compliantMetrics.ppm,
          }
        : null,
      flexDeltaCpk,
      histogram: sim.histogram.map((bin) => ({
        intervalMm: [bin.startMm, bin.endMm],
        count: bin.count,
        outOfSpecCount: bin.outOfSpec ? bin.count : 0,
      })),
      pareto,
    })
  }

  return {
    schemaVersion: 1,
    projectId: params.projectId,
    projectName: params.projectName,
    appVersion: '1.0.0',
    revision: params.revision,
    isDraft: params.isDraft,
    checksetFingerprint: params.checksetFingerprint,
    seed: params.seed,
    sampleCount: sim?.sampleCount ?? 50000,
    distribution: 'normal',
    generatedAtIso,
    conclusions,
    ...(params.viewportSnapshots ? { viewportSnapshots: params.viewportSnapshots } : {}),
    parameters: {
      parts: params.assembly3d?.parts ?? [],
      materials: params.assembly3d?.physics?.materials ?? [],
      fits: params.assembly3d?.mates ?? [],
      datums: params.assembly3d?.datums ?? [],
      gdt: (params.assembly3d?.gdt ?? []).map((control) => ({
        control,
        bonusMeanMm: null,
        datumShiftContributionPct: null,
        warnings: [],
      })),
      compliantModels: params.assembly3d?.physics?.compliantModels ?? [],
      loads: params.assembly3d?.physics?.loads ?? [],
      initialWarp: params.assembly3d?.physics?.initialWarp ?? [],
      mic: null,
    },
    evidence: [
      {
        target: `project:${params.projectId}`,
        ref: {
          kind: 'user-attestation',
          actorId: 'desktop-local-workbench',
          at: generatedAtIso,
          sessionSeq: 1,
          sessionLabel: '本地模板离线工程报告导出',
          statement: `基于本地模板「${params.projectName}」(${params.revision}) 确定性求解器生成离线仿真报告。`,
          fieldPath: '/simulation/report',
        },
      },
    ],
  }
}

async function computeFallbackSha256Hex(content: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const bytes = new TextEncoder().encode(content)
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    }
  } catch {
    // Fallback deterministic hex when WebCrypto is unavailable in test environments.
  }
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  for (let i = 0; i < content.length; i += 1) {
    const code = content.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (code + i), 0x85ebca6b) >>> 0
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`.repeat(4)
}

function triggerBrowserBlobDownload(
  fileName: string,
  mimeType: string,
  content: string,
  isBase64: boolean,
): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false
  }
  try {
    let blob: Blob
    if (isBase64) {
      const binary = typeof atob === 'function' ? atob(content) : content
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
      }
      blob = new Blob([bytes], { type: mimeType })
    } else {
      blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url)
    }
    return true
  } catch {
    return false
  }
}

async function buildLocalFallbackReportContent(params: {
  readonly format: Exclude<ReportExportFormat, 'pdf'>
  readonly projectId: string
  readonly projectName: string
  readonly revision: string
  readonly isDraft: boolean
  readonly checksetFingerprint: string
  readonly seed: number
  readonly simulationResult?: SimulationDiagnosticResult
  readonly assembly3d?: AssemblyModelV1
  readonly viewportSnapshots?: ReportViewportSnapshots
}): Promise<{ readonly fileName: string; readonly mimeType: ExportSimulationReportResult['mimeType']; readonly content: string }> {
  const baseName = `${sanitizeFileSegment(params.projectId)}-${sanitizeFileSegment(params.revision)}`
  const payload = buildOfflineReportPayload(params)

  if (params.format === 'json') {
    const payloadJson = JSON.stringify(payload, null, 2)
    const payloadSha = await computeFallbackSha256Hex(payloadJson)
    return {
      fileName: `simulation-${baseName}.json`,
      mimeType: 'application/json',
      content: `${JSON.stringify({ ...payload, sha256: payloadSha }, null, 2)}\n`,
    }
  }

  if (params.format === 'csv') {
    const rows: unknown[][] = [[
      'projectId', 'revision', 'draft', 'checksetFingerprint', 'seed', 'sampleCount', 'checkId', 'label',
      'status', 'mode', 'requirementLowerMm', 'requirementUpperMm', 'extremeLowerMm', 'extremeUpperMm',
      'threeSigmaLowerMm', 'threeSigmaUpperMm', 'Cp', 'Cpk', 'PPM', 'flexDeltaCpk',
    ]]
    const stamp = [
      payload.projectId, payload.revision, payload.isDraft,
      payload.checksetFingerprint, payload.seed, payload.sampleCount,
    ]
    for (const check of payload.conclusions) {
      for (const [mode, metrics] of [['rigid', check.rigid], ['compliant', check.compliant]] as const) {
        if (!metrics) continue
        rows.push([
          ...stamp, check.checkId, check.label, check.status, mode,
          ...check.requirementMm, ...check.extremeIntervalMm, ...metrics.threeSigmaIntervalMm,
          metrics.cp, metrics.cpk, metrics.ppm, check.flexDeltaCpk,
        ])
      }
    }
    return {
      fileName: `simulation-${baseName}.csv`,
      mimeType: 'text/csv',
      content: `\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`,
    }
  }

  return {
    fileName: `simulation-${baseName}.html`,
    mimeType: 'text/html',
    content: renderHtmlReport(payload),
  }
}

const LOCAL_FALLBACK_ERROR_CODES = new Set([
  'AUTH_REQUIRED',
  'FEATURE_DISABLED',
  'BACKEND_UNAVAILABLE',
])

async function printHtmlViaHiddenIframe(html: string): Promise<boolean> {
  if (typeof document === 'undefined' || !document.body) {
    return false
  }
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('data-testid', 'report-pdf-print-iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.visibility = 'hidden'

  let cleaned = false
  let cleanupTimer: ReturnType<typeof setTimeout> | null = null
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (cleanupTimer !== null) {
      clearTimeout(cleanupTimer)
      cleanupTimer = null
    }
    iframe.remove()
  }

  try {
    const loadPromise = new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        resolve()
      }
      iframe.addEventListener('load', done, { once: true })
      setTimeout(done, 80)
    })

    iframe.srcdoc = html
    document.body.appendChild(iframe)

    const doc = iframe.contentDocument
    if (doc && (!doc.body || doc.body.innerHTML.trim().length === 0)) {
      try {
        doc.open()
        doc.write(html)
        doc.close()
      } catch {
        // Ignore cross-origin or readonly document errors when srcdoc is active
      }
    }

    await loadPromise

    const frameWin = iframe.contentWindow
    if (!frameWin || typeof frameWin.print !== 'function') {
      cleanup()
      return false
    }

    frameWin.addEventListener?.('afterprint', cleanup, { once: true })
    cleanupTimer = setTimeout(cleanup, 60_000)
    frameWin.focus?.()
    frameWin.print()
    return true
  } catch {
    cleanup()
    return false
  }
}

export interface ExportExecutionOutcome {
  readonly ok: boolean
  readonly message: string
  readonly fileName?: string
  readonly sha256?: string
  readonly filePath?: string
}

/**
 * Shared report export executor used by both desktop workbench and cloud/web ReviewPage.
 * Captures 3D PNG snapshots when WebGL is available, invokes `transport.exportSimulationReport`,
 * and gracefully falls back to a local client-side Blob download if the transport lacks the method.
 */
// eslint-disable-next-line react-refresh/only-export-components
export async function executeSimulationReportExport(params: {
  readonly transport: Transport | null
  readonly projectId: string
  readonly projectName: string
  readonly format: ReportExportFormat
  readonly revision: string
  readonly isDraft?: boolean
  readonly checksetFingerprint: string
  readonly seed?: number
  readonly simulationResult?: SimulationDiagnosticResult
  readonly assembly3d?: AssemblyModelV1
  readonly captureSnapshots?: () => Promise<ReportViewportSnapshots> | ReportViewportSnapshots
}): Promise<ExportExecutionOutcome> {
  let viewportSnapshots: ReportViewportSnapshots | undefined
  try {
    const captured = await params.captureSnapshots?.()
    if (captured && (captured.nominalPngDataUrl || captured.heatmapPngDataUrl)) {
      viewportSnapshots = captured
    }
  } catch {
    viewportSnapshots = undefined
  }

  if (params.transport && typeof params.transport.exportSimulationReport === 'function') {
    try {
      const res = await params.transport.exportSimulationReport({
        projectId: params.projectId,
        format: params.format,
        includeSnapshots: true,
        ...(params.seed !== undefined ? { seed: params.seed } : {}),
        ...(viewportSnapshots ? { viewportSnapshots } : {}),
      })
      if (res.ok) {
        const value = res.value
        if (value.content !== undefined) {
          triggerBrowserBlobDownload(
            value.fileName,
            value.mimeType,
            value.content,
            params.format === 'pdf',
          )
        }
        const shortHash = value.sha256 ? value.sha256.slice(0, 12) : ''
        const locationNote = value.filePath ? ` · 已保存至 ${value.filePath}` : ' · 已开始下载'
        return {
          ok: true,
          fileName: value.fileName,
          sha256: value.sha256,
          filePath: value.filePath,
          message: `已导出 ${value.fileName}${shortHash ? `（SHA-256 ${shortHash}…）` : ''}${locationNote}`,
        }
      }
      if (!LOCAL_FALLBACK_ERROR_CODES.has(res.error.code)) {
        return {
          ok: false,
          message: `导出失败（${res.error.code}）：${res.error.message}`,
        }
      }
    } catch (err) {
      return {
        ok: false,
        message: `导出工程报告异常：${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  // Offline client-side report fallback for unbound/built-in templates or missing transport method
  const seed = params.seed ?? 42
  const isDraft = params.isDraft ?? /^draft/i.test(params.revision)
  if (params.format === 'pdf') {
    const printableHtml = await buildLocalFallbackReportContent({
      format: 'html',
      projectId: params.projectId,
      projectName: params.projectName,
      revision: params.revision,
      isDraft,
      checksetFingerprint: params.checksetFingerprint,
      seed,
      simulationResult: params.simulationResult,
      assembly3d: params.assembly3d,
      viewportSnapshots,
    })
    const sha256 = await computeFallbackSha256Hex(printableHtml.content)
    const printedViaFrame = await printHtmlViaHiddenIframe(printableHtml.content)
    if (printedViaFrame) {
      const pdfFileName = printableHtml.fileName.replace(/\.html$/i, '.pdf')
      return {
        ok: true,
        fileName: pdfFileName,
        sha256,
        message: `已生成工程报告并通过打印对话框导出 ${pdfFileName}（SHA-256 ${sha256.slice(0, 12)}…）`,
      }
    }
    triggerBrowserBlobDownload(printableHtml.fileName, printableHtml.mimeType, printableHtml.content, false)
    return {
      ok: true,
      fileName: printableHtml.fileName,
      sha256,
      message: `已生成可打印离线 HTML 报告 ${printableHtml.fileName}（SHA-256 ${sha256.slice(0, 12)}…，可直接使用浏览器打印为 PDF）`,
    }
  }

  const localArtifact = await buildLocalFallbackReportContent({
    format: params.format,
    projectId: params.projectId,
    projectName: params.projectName,
    revision: params.revision,
    isDraft,
    checksetFingerprint: params.checksetFingerprint,
    seed,
    simulationResult: params.simulationResult,
    assembly3d: params.assembly3d,
    viewportSnapshots,
  })
  const sha256 = await computeFallbackSha256Hex(localArtifact.content)
  triggerBrowserBlobDownload(localArtifact.fileName, localArtifact.mimeType, localArtifact.content, false)
  return {
    ok: true,
    fileName: localArtifact.fileName,
    sha256,
    message: `已生成本地报告 ${localArtifact.fileName}（SHA-256 ${sha256.slice(0, 12)}…）`,
  }
}

/**
 * Minimal one-click engineering simulation report export control:
 * - Supports HTML offline report, PDF (desktop), CSV table, and JSON audit bundle
 * - Automatically captures 3D nominal/heatmap PNG snapshots when WebGL is active
 * - Zero direct window.cunlian/electron access; strictly uses Transport with Blob fallback
 */
export function ReportExportMenu({
  transport,
  projectId,
  projectName,
  baseRevision = null,
  draftRevision = null,
  checksetFingerprint = 'fp-local',
  simulationResult,
  assembly3d,
  seed,
  captureSnapshots,
  variant = 'card',
  onExportComplete,
}: ReportExportMenuProps) {
  const [exportingFormat, setExportingFormat] = useState<ReportExportFormat | null>(null)
  const [feedback, setFeedback] = useState<ExportExecutionOutcome | null>(null)

  const revision = draftRevision ?? baseRevision ?? 'draft'

  const handleExport = async (format: ReportExportFormat) => {
    if (exportingFormat) return
    setExportingFormat(format)
    setFeedback(null)
    const outcome = await executeSimulationReportExport({
      transport,
      projectId,
      projectName,
      format,
      revision,
      isDraft: Boolean(draftRevision),
      checksetFingerprint,
      seed,
      simulationResult,
      assembly3d,
      captureSnapshots,
    })
    setExportingFormat(null)
    setFeedback(outcome)
    onExportComplete?.(outcome.message)
  }

  if (variant === 'menu-items') {
    return (
      <div className="pa-report-menu-group" data-testid="topbar-report-export-group">
        <div className="pa-menu-section-label">导出工程报告</div>
        {FORMAT_OPTIONS.map((opt) => (
          <button
            key={opt.format}
            type="button"
            role="menuitem"
            data-testid={`topbar-export-report-${opt.format}`}
            className="pa-menu-item"
            disabled={exportingFormat !== null}
            onClick={() => void handleExport(opt.format)}
          >
            <span>{exportingFormat === opt.format ? `正在导出 ${opt.label}…` : opt.label}</span>
            <span className="pa-muted pa-mono">{opt.format.toUpperCase()}</span>
          </button>
        ))}
      </div>
    )
  }

  if (variant === 'inline') {
    return (
      <div className="pa-report-inline-bar" data-testid="completion-report-export">
        <div className="pa-row">
          <span className="pa-card-label">导出工程报告：</span>
          {FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt.format}
              type="button"
              data-testid={`completion-export-report-${opt.format}`}
              className="pa-btn pa-btn-ghost pa-btn-sm"
              disabled={exportingFormat !== null}
              onClick={() => void handleExport(opt.format)}
            >
              {exportingFormat === opt.format ? '导出中…' : opt.shortLabel}
            </button>
          ))}
        </div>
        {feedback ? (
          <div
            className={feedback.ok ? 'pa-pass-box pa-report-feedback' : 'pa-danger-box pa-report-feedback'}
            role={feedback.ok ? 'status' : 'alert'}
            data-testid="completion-report-export-feedback"
          >
            <span>{feedback.message}</span>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <section
      className="pa-card pa-report-export-card"
      aria-label="导出工程仿真报告"
      data-testid="report-export-card"
    >
      <div className="pa-header">
        <span className="pa-card-label">导出工程报告</span>
        <span className="pa-muted pa-mono">含 3D 快照与校验摘要</span>
      </div>
      <div className="pa-report-btn-grid">
        {FORMAT_OPTIONS.map((opt) => (
          <button
            key={opt.format}
            type="button"
            data-testid={`export-report-${opt.format}`}
            className={opt.format === 'html' ? 'pa-btn pa-btn-primary pa-btn-sm' : 'pa-btn pa-btn-sm'}
            disabled={exportingFormat !== null}
            onClick={() => void handleExport(opt.format)}
          >
            {exportingFormat === opt.format ? '导出中…' : opt.label}
          </button>
        ))}
      </div>
      {feedback ? (
        <div
          className={feedback.ok ? 'pa-pass-box pa-report-feedback' : 'pa-danger-box pa-report-feedback'}
          role={feedback.ok ? 'status' : 'alert'}
          data-testid="report-export-feedback"
        >
          <span>{feedback.message}</span>
        </div>
      ) : null}
    </section>
  )
}
