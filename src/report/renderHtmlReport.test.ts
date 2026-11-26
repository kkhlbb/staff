import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { exportReport } from './exportReport'
import { renderHtmlReport } from './renderHtmlReport'
import type { ReportConclusion, SimulationReportPayloadV1 } from './types'

const rigid = { threeSigmaIntervalMm: [1, 2] as const, cp: 1.5, cpk: 1.25, ppm: 50 }
const check: ReportConclusion = {
  checkId: 'loop', label: '=1+1,"轴"', requirementMm: [0, 3], extremeIntervalMm: [-1, 4],
  status: 'fail', rigid, compliant: { ...rigid, cpk: 1 }, flexDeltaCpk: -0.25,
  histogram: [{ intervalMm: [-1, 1], count: 7, outOfSpecCount: 3 }],
  pareto: [{ inputId: 'gdt-1', label: 'Hole position', varianceSharePct: 100, cumulativeSharePct: 100 }],
}
const kinds = ['position', 'perpendicularity', 'parallelism', 'flatness', 'coaxiality',
  'profile-surface', 'circular-runout', 'total-runout', 'cylindricity', 'composite-position'] as const
const rect = [10, 20, 110, 32] as const
const pageBox = [0, 0, 595, 842] as const
const hashA = 'a'.repeat(64)
const hashB = 'b'.repeat(64)
const hashC = 'c'.repeat(64)
const hashD = 'd'.repeat(64)

const payload: SimulationReportPayloadV1 = {
  schemaVersion: 1, projectId: 'project-123', projectName: '<img src="https://bad.invalid">', revision: 'draft-3',
  appVersion: '1.0.0', isDraft: true, checksetFingerprint: 'fp-123', seed: 321, sampleCount: 500,
  distribution: 'normal', generatedAtIso: '2026-11-26T12:00:00Z', conclusions: [check],
  viewportSnapshots: {
    nominalPngDataUrl: 'data:image/png;base64,AAAA',
    heatmapPngDataUrl: 'data:image/png;base64,BBBB',
  },
  hlrSvg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>',
  parameters: {
    parts: [{
      id: 'cover', kind: 'parametric-primitive', baseKind: 'plate', displayName: 'Cover', color: '#72b7b2',
      nominalTransform: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
      sizeQ: { lengthQ: 800000, widthQ: 500000, thicknessQ: 15000 }, modifiers: [],
    }],
    materials: [{
      partId: 'cover', presetId: 'al-6061', name: '6061-T6',
      youngsModulusMpa: 68900, poissonRatio: 0.33, thermalExpansionPerK: 23.6e-6, deltaTemperatureK: 20,
    }],
    fits: [],
    datums: [{ id: 'datum-a', label: 'A', featureId: 'face-a' }],
    compliantModels: [{
      id: 'clamp-1', kind: 'plate-clamping', partId: 'cover', surfaceFeatureId: 'face-a',
      thicknessQ: 15000, initialWarpPeakQ: 2800, clampFeatureIds: ['bolt-1', 'bolt-2'], clampForceN: 450,
    }],
    loads: [],
    initialWarp: [],
    mic: {
      partId: 'cover', attachmentId: 'mic-1', sha256: hashD,
      units: 'mm', forceUnits: 'N', controlPointCount: 2, measurePointCount: 1,
    },
    gdt: kinds.map((kind, n) => ({
      control: kind === 'composite-position'
        ? {
            id: String(n), kind, featureId: 'a', datumIds: ['datum-a'], toleranceQ: 100,
            modifier: 'MMC' as const, upperToleranceQ: 200, lowerToleranceQ: 50, lowerDatumIds: ['datum-a'],
          }
        : { id: String(n), kind, featureId: 'a', datumIds: ['datum-a'], toleranceQ: 100 },
      bonusMeanMm: kind === 'position' ? 0.015 : null,
      datumShiftContributionPct: kind === 'position' ? 12.5 : null,
      warnings: [],
    })),
  },
  evidence: [
    {
      target: 'dim-pdf-text',
      ref: {
        kind: 'pdf-text', documentId: 'doc-1', revisionId: 'rev-1', sha256: hashA, blobKey: 'blob-1',
        page: 1, rectPdf: rect, pageBoxPdf: pageBox, textSnippet: 'L=12.00±0.05', normalizedSnippet: 'L=12.00±0.05',
        textItemIndexes: [0],
      },
    },
    {
      target: 'dim-pdf-ocr',
      ref: {
        kind: 'pdf-ocr', documentId: 'doc-2', revisionId: 'rev-2', sha256: hashB, blobKey: 'blob-2',
        page: 2, rectPdf: rect, pageBoxPdf: pageBox, textSnippet: 'D=20.00', confidence: 0.94,
      },
    },
    {
      target: 'dim-image-ocr',
      ref: {
        kind: 'image-ocr', imageId: 'img-1', sha256: hashC, fileName: 'sketch.png',
        rectPdf: rect, recognizedText: 't=1.50', confidence: 0.91,
      },
    },
    {
      target: 'physics-user',
      ref: {
        kind: 'user-attestation', actorId: 'eng-1', at: '2026-11-26T00:00:00Z',
        sessionSeq: 1, sessionLabel: 'Review', statement: '6061-T6 verified', fieldPath: 'physics.materials',
      },
    },
    {
      target: 'mic-agent',
      ref: {
        kind: 'agent-read', actorId: 'agent-1', at: '2026-11-26T00:05:00Z',
        sessionSeq: 2, turnId: 'turn-1', modelId: 'model-v1',
        source: { kind: 'pdf-page', revisionId: 'rev-1', sha256: hashA, page: 3 },
        statement: 'Read MIC table from FEA appendix',
      },
    },
  ],
}

describe('offline simulation report', () => {
  it('embeds views, engineering parameters, all 5 EvidenceRef branches, and the reproducibility stamp safely', () => {
    const html = renderHtmlReport(payload)
    expect(html).not.toMatch(/<(?:img|script|link)\b[^>]*(?:src|href)=["']https?:/i)
    expect(html).toContain('@media print')
    for (const label of [
      'project-123', 'draft-3', 'fp-123', '321', '500', 'EvidenceRef', 'Rigid vs Compliant', '-0.25',
      'data:image/png;base64,AAAA', 'data:image/png;base64,BBBB', 'data:image/svg+xml;base64,', '#b52634',
      '68900', '0.33', '0.0000236', 'plate-clamping', hashD,
      'pdf-text', 'pdf-ocr', 'image-ocr', 'user-attestation', 'agent-read',
      ...kinds,
    ]) {
      expect(html).toContain(label)
    }
    expect(renderHtmlReport({ ...payload, viewportSnapshots: undefined, hlrSvg: undefined })).not.toContain('<figure>')
  })

  it.each(['html', 'csv', 'json'] as const)('hashes the exact %s UTF-8 bytes', async format => {
    const result = await exportReport(payload, format)
    expect(result.sha256).toBe(createHash('sha256').update(result.content!).digest('hex'))
    expect(result.checksetFingerprint).toBe(payload.checksetFingerprint)
    if (format === 'csv') {
      expect(result.content!.charCodeAt(0)).toBe(0xfeff)
      expect(result.content).toContain('""轴""')
    }
    if (format === 'json') expect(JSON.parse(result.content!).sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('supports desktop PDF bytes and reports a headless limitation', async () => {
    await expect(exportReport(payload, 'pdf')).rejects.toMatchObject({ code: 'PDF_UNAVAILABLE' })
    const bytes = Buffer.from('%PDF-example')
    const result = await exportReport(payload, 'pdf', async html => {
      expect(html).toContain('fp-123')
      return bytes
    })
    expect(result.content).toBe(bytes.toString('base64'))
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
  })
})
