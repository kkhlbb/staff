import { gdtConclusions } from './gdtConclusions.mjs'
import type { MicMatrixPayloadV1 } from '../project-file/assembly3d'
import { provenanceRefSchema } from '../project-file/validation'
import type { AssemblyModelV1 } from '../project-file/assembly3d'
import type { ExportSimulationReportRequest } from '../transport/types'
import type { SimulationReportPayloadV1 } from './types'

type Stamp = Pick<SimulationReportPayloadV1, 'projectName' | 'appVersion' | 'revision' | 'isDraft' | 'checksetFingerprint' | 'sampleCount' | 'distribution'>

export function buildReport(
  request: ExportSimulationReportRequest,
  stamp: Stamp,
  assembly: AssemblyModelV1 | undefined,
  data: Pick<SimulationReportPayloadV1, 'conclusions' | 'evidence'> &
    Partial<Pick<SimulationReportPayloadV1, 'hlrSvg'>> &
    { mic?: { id: string; sha256: string; payload: MicMatrixPayloadV1 } },
): SimulationReportPayloadV1 {
  const advanced = gdtConclusions(assembly, request.seed ?? 42, Math.max(2000, stamp.sampleCount), data.mic?.payload)
  return {
    ...stamp,
    sampleCount: advanced.conclusions.length ? Math.max(2000, stamp.sampleCount) : stamp.sampleCount,
    schemaVersion: 1,
    projectId: request.projectId,
    seed: request.seed ?? 42,
    generatedAtIso: new Date().toISOString(),
    conclusions: [...data.conclusions, ...advanced.conclusions],
    evidence: data.evidence,
    ...(request.includeSnapshots !== false && request.viewportSnapshots ? { viewportSnapshots: request.viewportSnapshots } : {}),
    ...(data.hlrSvg ? { hlrSvg: data.hlrSvg } : {}),
    parameters: {
      parts: assembly?.parts ?? [],
      materials: assembly?.physics?.materials ?? [],
      fits: assembly?.mates ?? [],
      datums: assembly?.datums ?? [],
      gdt: (assembly?.gdt ?? []).map(control => {
        const contribution = advanced.contributions.find(item => item.gdtId === control.id)
        return { control, bonusMeanMm: contribution?.bonusMeanMm ?? null,
          datumShiftContributionPct: contribution?.datumShiftContributionPct ?? null,
          warnings: advanced.warnings.filter(item => item.gdtId === control.id) }
      }),
      compliantModels: assembly?.physics?.compliantModels ?? [],
      loads: assembly?.physics?.loads ?? [],
      initialWarp: assembly?.physics?.initialWarp ?? [],
      mic: data.mic ? {
        partId: data.mic.payload.partId, attachmentId: data.mic.id, sha256: data.mic.sha256,
        units: data.mic.payload.units, forceUnits: data.mic.payload.forceUnits,
        controlPointCount: data.mic.payload.controlPointsMm.length,
        measurePointCount: data.mic.payload.measurePointsMm.length,
      } : null,
    },
  }
}

export function journalReportEvidence(records: Record<string, unknown> = {}): SimulationReportPayloadV1['evidence'] {
  return Object.entries(records).flatMap(([target, value]) => {
    const refs = value && typeof value === 'object' && 'evidence' in value ? value.evidence : value
    return (Array.isArray(refs) ? refs : [refs]).flatMap(ref => {
      const validated = provenanceRefSchema.safeParse(ref)
      return validated.success ? [{ target, ref: validated.data }] : []
    })
  })
}
