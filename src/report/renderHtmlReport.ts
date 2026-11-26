import type { ReportConclusion, SimulationReportPayloadV1 } from './types'

function escape(value: unknown): string {
  return String(value ?? '—').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
}

function table(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return `<table><thead><tr>${headers.map(header => `<th>${escape(header)}</th>`).join('')}</tr></thead><tbody>${
    rows.map(row => `<tr>${row.map(value => `<td>${escape(value)}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`
}

function plot(check: ReportConclusion): string {
  const max = Math.max(1, ...check.histogram.map(bin => bin.count))
  const width = 480 / Math.max(1, check.histogram.length)
  const bars = check.histogram.map((bin, index) => {
    const height = 100 * bin.count / max
    const tail = 100 * bin.outOfSpecCount / max
    return `<rect x="${index * width}" y="${100 - height}" width="${width}" height="${height}" fill="#306785"><title>${escape(bin.intervalMm.join('–'))}: ${escape(bin.count)}</title></rect><rect x="${index * width}" y="${100 - height}" width="${width}" height="${tail}" fill="#b52634"/>`
  }).join('')
  const pareto = check.pareto.map((item, index) =>
    `<text x="0" y="${index * 24 + 16}">${escape(item.label)}</text><rect x="220" y="${index * 24 + 4}" width="${2.5 * Math.min(100, Math.max(0, item.varianceSharePct))}" height="12" fill="#306785"><title>${escape(item.varianceSharePct)}%</title></rect>`,
  ).join('')
  return `<h4>Distribution histogram</h4><svg viewBox="0 0 480 100" role="img" aria-label="Distribution histogram">${bars}</svg>
<h4>Top contributors</h4><svg viewBox="0 0 480 ${Math.max(24, 24 * check.pareto.length)}" role="img" aria-label="Top contributor Pareto">${pareto}</svg>`
}

export function renderHtmlReport(report: SimulationReportPayloadV1): string {
  const snapshots = Object.entries(report.viewportSnapshots ?? {}).map(([name, value]) =>
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
      ? `<figure><img src="${value}" alt="${escape(name)}"><figcaption>${name === 'nominalPngDataUrl' ? 'Nominal model' : 'Displacement heatmap'}</figcaption></figure>`
      : '',
  ).join('')
  // An isolated image document keeps embedded SVG inert. CSP blocks its external resources.
  const drawing = report.hlrSvg
    ? `<figure><img src="data:image/svg+xml;base64,${Buffer.from(report.hlrSvg).toString('base64')}" alt="HLR engineering drawing"></figure>`
    : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escape(report.projectName)} · Simulation report</title><style>
@page{size:A4;margin:16mm}body{font:15px/1.5 system-ui,sans-serif;color:#172938;max-width:1000px;margin:2rem auto;padding:0 1rem}
h1,h2,h3,h4{line-height:1.2}table{width:100%;border-collapse:collapse;margin:1em 0}td,th{padding:.45em;text-align:left;border-bottom:1px solid #cbd5da;overflow-wrap:anywhere}
img,svg{max-width:100%;height:auto}svg{width:min(100%,480px)}figure{margin:1em 0}.pass{color:#216c45}.fail{color:#b52634}.indeterminate{color:#875619}
@media print{body{margin:0;padding:0}header{break-after:page}thead{display:table-header-group}tr,figure,svg{break-inside:avoid}h2,h3,h4{break-after:avoid}}
</style></head><body><header><h1>${escape(report.projectName)}</h1><p>Cunlian v${escape(report.appVersion.replace(/^v/, ''))} · Engineering simulation report</p>
${table(['Reproducibility stamp', 'Value'], Object.entries({
  projectId: report.projectId, revision: report.revision, status: report.isDraft ? 'Draft' : 'Formal',
  checksetFingerprint: report.checksetFingerprint, seed: report.seed, sampleCount: report.sampleCount,
  distribution: report.distribution, generatedAtIso: report.generatedAtIso,
}))}</header><main><h2>Executive summary</h2>
${report.conclusions.map(check => `<section><h3>${escape(check.label)} <small class="${escape(check.status)}">${check.status === 'indeterminate' ? 'warn' : escape(check.status)}</small></h3>
<p>Requirement: ${escape(check.requirementMm.join(' to '))} mm · ${check.status === 'indeterminate' || check.checkId !== 'dimension-chain' ? 'Sampled extrema' : 'Worst-case'}: ${escape(check.extremeIntervalMm.join(' to '))} mm · Δ Cpk: ${escape(check.flexDeltaCpk)}</p>
${table(['Rigid vs Compliant', '±3σ (mm)', 'Cp', 'Cpk', 'PPM'], [
  ['Rigid baseline', check.rigid.threeSigmaIntervalMm.join(' to '), check.rigid.cp, check.rigid.cpk, check.rigid.ppm],
  ...(check.compliant ? [['Compliant result', check.compliant.threeSigmaIntervalMm.join(' to '), check.compliant.cp, check.compliant.cpk, check.compliant.ppm]] : []),
])}${plot(check)}</section>`).join('')}
${snapshots || drawing ? `<section><h2>Engineering views</h2>${snapshots}${drawing}</section>` : ''}
<h2>Engineering parameters</h2>
${Object.entries(report.parameters).map(([name, values]) => `<h3>${escape(name)}</h3>${table(['Parameters'], (Array.isArray(values) ? values : values ? [values] : []).map(value => [JSON.stringify(value)]))}`).join('')}
<h2>EvidenceRef audit appendix · ADR-001</h2>${table(['Target', 'Source and verification'], report.evidence.map(entry => [entry.target, JSON.stringify(entry.ref)]))}
</main></body></html>`
}
