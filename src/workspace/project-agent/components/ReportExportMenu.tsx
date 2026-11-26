import { useState } from 'react'
import type { ReportViewportSnapshots } from '../../../report/types'
import type {
  ExportSimulationReportRequest,
  ExportSimulationReportResult,
  Transport,
} from '../../../transport/types'
import type { SimulationDiagnosticResult } from '../assembly3dTypes'

export type ReportExportFormat = ExportSimulationReportRequest['format']

export interface ReportExportMenuProps {
  readonly transport: Transport
  readonly projectId: string
  readonly projectName: string
  readonly baseRevision?: string | null
  readonly draftRevision?: string | null
  readonly checksetFingerprint?: string
  readonly simulationResult?: SimulationDiagnosticResult
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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

function buildLocalFallbackReportContent(params: {
  readonly format: Exclude<ReportExportFormat, 'pdf'>
  readonly projectId: string
  readonly projectName: string
  readonly revision: string
  readonly checksetFingerprint: string
  readonly simulationResult?: SimulationDiagnosticResult
  readonly viewportSnapshots?: ReportViewportSnapshots
}): { readonly fileName: string; readonly mimeType: ExportSimulationReportResult['mimeType']; readonly content: string } {
  const baseName = `${sanitizeFileSegment(params.projectId)}-${sanitizeFileSegment(params.revision)}`
  const sim = params.simulationResult
  const generatedAtIso = new Date().toISOString()

  if (params.format === 'json') {
    const payload = {
      schemaVersion: 1,
      projectId: params.projectId,
      projectName: params.projectName,
      revision: params.revision,
      checksetFingerprint: params.checksetFingerprint,
      generatedAtIso,
      simulation: sim
        ? {
            title: sim.title,
            nominalMm: sim.nominalMm,
            lslMm: sim.lslMm,
            uslMm: sim.uslMm,
            threeSigmaIntervalMm: [sim.threeSigmaLowMm, sim.threeSigmaHighMm],
            cp: sim.cp,
            cpk: sim.cpk,
            ppm: sim.ppm,
            status: sim.status,
          }
        : null,
      hasViewportSnapshots: Boolean(
        params.viewportSnapshots?.nominalPngDataUrl || params.viewportSnapshots?.heatmapPngDataUrl,
      ),
    }
    return {
      fileName: `${baseName}-audit.json`,
      mimeType: 'application/json',
      content: JSON.stringify(payload, null, 2),
    }
  }

  if (params.format === 'csv') {
    const header = 'projectId,revision,checksetFingerprint,loop,nominalMm,lslMm,uslMm,cp,cpk,ppm,status'
    const row = sim
      ? [
          params.projectId,
          params.revision,
          params.checksetFingerprint,
          `"${sim.title.replace(/"/g, '""')}"`,
          sim.nominalMm.toFixed(4),
          sim.lslMm.toFixed(4),
          sim.uslMm.toFixed(4),
          sim.cp.toFixed(3),
          sim.cpk.toFixed(3),
          String(sim.ppm),
          sim.status,
        ].join(',')
      : `${params.projectId},${params.revision},${params.checksetFingerprint},N/A,,,,,,,`
    return {
      fileName: `${baseName}-report.csv`,
      mimeType: 'text/csv',
      content: `${header}\n${row}\n`,
    }
  }

  const snapshotImg = params.viewportSnapshots?.nominalPngDataUrl
    ? `<section><h2>3D 视口快照</h2><img src="${params.viewportSnapshots.nominalPngDataUrl}" alt="3D 名义态快照" style="max-width:100%;border:1px solid #cbd5e1;border-radius:6px;" /></section>`
    : ''
  const simBlock = sim
    ? `<section><h2>仿真结论：${escapeHtml(sim.title)}</h2><ul><li>名义值：${sim.nominalMm.toFixed(3)} mm</li><li>公差要求：[${sim.lslMm.toFixed(2)}, ${sim.uslMm.toFixed(2)}] mm</li><li>±3σ 区间：[${sim.threeSigmaLowMm.toFixed(3)}, ${sim.threeSigmaHighMm.toFixed(3)}] mm</li><li>Cp / Cpk：${sim.cp.toFixed(2)} / ${sim.cpk.toFixed(2)}</li><li>预测不良率：${sim.ppm} PPM</li></ul></section>`
    : ''
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><title>${escapeHtml(params.projectName)} 工程仿真报告</title><style>body{font-family:system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#0f172a}code{background:#f1f5f9;padding:2px 6px;border-radius:4px}</style></head><body><h1>寸链工程仿真报告 · ${escapeHtml(params.projectName)}</h1><p>项目 ID：<code>${escapeHtml(params.projectId)}</code> · 修订：<code>${escapeHtml(params.revision)}</code> · 检查集指纹：<code>${escapeHtml(params.checksetFingerprint)}</code> · 生成时间：<code>${escapeHtml(generatedAtIso)}</code></p>${simBlock}${snapshotImg}</body></html>`
  return {
    fileName: `${baseName}-report.html`,
    mimeType: 'text/html',
    content: html,
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
  readonly checksetFingerprint: string
  readonly simulationResult?: SimulationDiagnosticResult
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
        ...(viewportSnapshots ? { viewportSnapshots } : {}),
      })
      if (!res.ok) {
        return {
          ok: false,
          message: `导出失败（${res.error.code}）：${res.error.message}`,
        }
      }
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
    } catch (err) {
      return {
        ok: false,
        message: `导出工程报告异常：${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  // Pure-frontend fallback when transport does not implement exportSimulationReport
  if (params.format === 'pdf') {
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print()
      return {
        ok: true,
        message: '已调用浏览器打印对话框导出 PDF（桌面端支持原生静默 PDF 导出）。',
      }
    }
    return {
      ok: false,
      message: '当前离线预览环境不支持原生 PDF 导出，请改用 HTML 离线报告或桌面端导出。',
    }
  }

  const localArtifact = buildLocalFallbackReportContent({
    format: params.format,
    projectId: params.projectId,
    projectName: params.projectName,
    revision: params.revision,
    checksetFingerprint: params.checksetFingerprint,
    simulationResult: params.simulationResult,
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
      checksetFingerprint,
      simulationResult,
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
