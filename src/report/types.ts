import type { EvidenceRef } from '../document-extraction/types'
import type { MonteCarloOptions } from '../domain/statistics'
import type {
  AssemblyMate, AssemblyPart, AssemblyPhysicsSpec, CompliantModelSpec, DatumDefinition,
  GdtFeatureControl, GdtValidationWarning, MaterialSpec, MicMatrixPayloadV1,
} from '../project-file/assembly3d'

type IntervalMm = readonly [lower: number, upper: number]

export interface ReportProcessMetrics {
  threeSigmaIntervalMm: IntervalMm
  cp: number | null
  cpk: number | null
  ppm: number
}

export interface ReportConclusion {
  checkId: string
  label: string
  requirementMm: IntervalMm
  extremeIntervalMm: IntervalMm
  status: 'pass' | 'fail' | 'indeterminate'
  rigid: ReportProcessMetrics
  compliant: ReportProcessMetrics | null
  flexDeltaCpk: number | null
  histogram: readonly { intervalMm: IntervalMm; count: number; outOfSpecCount: number }[]
  /** Sorted by descending variance contribution, with percentages on a 0–100 scale. */
  pareto: readonly {
    inputId: string
    label: string
    varianceSharePct: number
    cumulativeSharePct: number
  }[]
}

export interface ReportViewportSnapshots {
  nominalPngDataUrl?: string
  heatmapPngDataUrl?: string
}

/** Standalone, serializable report data captured from one authorized project revision. */
export interface SimulationReportPayloadV1 {
  schemaVersion: 1
  projectId: string
  projectName: string
  appVersion: string
  revision: string
  isDraft: boolean
  checksetFingerprint: string
  seed: number
  sampleCount: number
  distribution: MonteCarloOptions['distribution']
  generatedAtIso: string
  conclusions: readonly ReportConclusion[]
  viewportSnapshots?: ReportViewportSnapshots
  hlrSvg?: string
  parameters: {
    parts: readonly AssemblyPart[]
    materials: readonly MaterialSpec[]
    fits: readonly AssemblyMate[]
    datums: readonly DatumDefinition[]
    gdt: readonly {
      control: GdtFeatureControl
      bonusMeanMm: number | null
      datumShiftContributionPct: number | null
      warnings: readonly GdtValidationWarning[]
    }[]
    compliantModels: readonly CompliantModelSpec[]
    loads: NonNullable<AssemblyPhysicsSpec['loads']>
    initialWarp: NonNullable<AssemblyPhysicsSpec['initialWarp']>
    mic: {
      partId: string
      attachmentId: string
      sha256: string
      units: MicMatrixPayloadV1['units']
      forceUnits: MicMatrixPayloadV1['forceUnits']
      controlPointCount: number
      measurePointCount: number
    } | null
  }
  /** Preserve each full EvidenceRef, keyed by the report input or check it supports. */
  evidence: readonly { target: string; ref: EvidenceRef }[]
}
