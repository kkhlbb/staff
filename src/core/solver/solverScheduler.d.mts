import type { ChainDefinition, ChainResult } from '../../domain/types.ts'
import type { MonteCarloOptions, MonteCarloResult } from '../../domain/statistics.ts'
import type { AssemblyModelV1 } from '../../project-file/assembly3d.ts'

import type { CompliantSimulationSummary, GdtStackupMetrics, GdtWhatIfEdit, PartDisplacementField, PhysicsPatch } from '../../transport/types.ts'

type TaskOptions = { signal?: AbortSignal; timeoutMs?: number }
type Dof = 'tx' | 'ty' | 'tz' | 'rx' | 'ry' | 'rz'
type AssemblyInput = { assembly: AssemblyModelV1; fixedPartIds?: string[] }
type ParameterBinding = { id: string; partId: string; featureId: string }
export type ToleranceParameter = ParameterBinding & (
  { dof: 'tx' | 'ty' | 'tz'; sigmaQ: number; lowerQ: number; upperQ: number } |
  { dof: 'rx' | 'ry' | 'rz'; sigmaRad: number; lowerRad: number; upperRad: number })
export type SimulationInput = AssemblyInput & {
  samples?: number
  seed?: number
  bins?: number
  limits?: Record<string, { lower: number; upper: number }>
  parameters: ToleranceParameter[]
  /** Opt in to GD&T sampling from 1 to 50,000 trials. Existing 3D parameter draws retain their normal model. */
  gdtDistribution?: 'normal' | 'uniform'
  gdtFeatureGeometry?: Record<string, { spanQ?: number; external?: boolean }>
  gdtEdits?: readonly GdtWhatIfEdit[]
}
type IncrementalInput = { incremental: {
  baselineRevision: string
  parameter?: ToleranceParameter
  edits?: readonly GdtWhatIfEdit[]
  physics?: PhysicsPatch
} & ({ parameter: ToleranceParameter } | { edits: readonly GdtWhatIfEdit[] } | { physics: PhysicsPatch }) }
export type SolverRequest =
  | { kind: 'extremes1d'; chain: ChainDefinition }
  | { kind: 'monteCarlo1d'; chain: ChainDefinition; options?: MonteCarloOptions }
  | { kind: 'se3'; inputs: AssemblyInput }
  | { kind: 'multivariate'; inputs: SimulationInput | IncrementalInput }

export type AssemblySolution = {
  status: 'solved' | 'underconstrained' | 'overconstrained'
  fixedPartIds: string[]
  remainingDof: number
  remainingDofs: { partId: string; dof: Dof; coefficient: number }[][]
  redundantMateIds: string[]
  conflictMateIds: string[]
  contradictions: { mateId: string; reason: string; angleRad?: number; lengthMm?: number }[]
  parts: { partId: string; nominalTransform: AssemblyModelV1['parts'][number]['nominalTransform'] }[]
}
type Interval = { min: number; max: number }
type MeasurementResult = {
  measurementId: string
  kind: Exclude<AssemblyModelV1['measurements'][number]['kind'], 'interference'>
  unit: 'mm' | 'rad'
  nominal: number
  extremeEstimate: Interval & { method: string; guaranteedBounds: false }
  mean: number
  sigma: number
  threeSigma: Interval
  cp: number | null
  cpk: number | null
  ppm: number | null
  failures: number | null
  histogram: Interval & { width: number; counts: number[] }
  contributionMethod: string
  contributions: { parameterId: string; partId: string; featureId: string; variance: number; fraction: number }[]
}
type SimulationResult = { status: 'overconstrained'; solution: AssemblySolution }
  | { status: 'ok'; baselineRevision: string; seed: number; samples: number; solution?: AssemblySolution;
      gdt?: { baseline: GdtStackupMetrics; whatIf?: GdtStackupMetrics; compliant?: GdtStackupMetrics; recalculatedGdtIds: string[] };
      compliant?: CompliantSimulationSummary; displacementFields?: readonly PartDisplacementField[];
      recalculatedMeasurementIds: string[]; measurements: MeasurementResult[] }

type SolverResult<T extends SolverRequest> = T extends { kind: 'extremes1d' } ? ChainResult
  : T extends { kind: 'monteCarlo1d' } ? MonteCarloResult
    : T extends { kind: 'se3' } ? AssemblySolution : SimulationResult

export function createSolverScheduler(workerUrl?: URL): {
  run<T extends SolverRequest>(request: T, options?: TaskOptions): Promise<SolverResult<T>>
  close(): Promise<void>
}
