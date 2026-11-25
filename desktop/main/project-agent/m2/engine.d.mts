import type { Axis, FeatureId, Frame, MountingPlate, Role, Variable } from './model.mjs'

type Status = 'pass' | 'fail' | 'needsClarification' | 'uncovered' | 'executionFailed'
type Clause = 'MP-01' | 'MP-02' | 'MP-03' | 'MP-04' | 'MP-05'
type ViewId = 'front' | 'top' | 'side'
type Point = [number, number]
type Ref = { role: Role; featureId?: FeatureId }
type Bounds = { min: Axis; max: Axis }
type Cylinder = { origin: Axis; direction: Axis; radius: number; bounds: Bounds }
type FaceReference = { resolved: true; role: Role; featureId: FeatureId; geometry: Cylinder | Bounds }
type AssemblyEvidence = {
  plateTopMm: number
  plateBottomMm: number
  coverBottomMm: number
  coverTopMm: number
  signedGapMm: number
  commonVolumeMm3: number
  worldPlateBounds: Bounds
}

export interface Check {
  id: Clause | 'fixedPose'
  status: Status
  page?: number | null
  targets?: Ref[]
  missing?: Role[]
  relation?: 'contact' | 'interference' | 'clearance'
  intervalMm?: [number, number]
  nominalMm?: number
  targetMm?: number
  marginMm?: number
  deficitMm?: number
  clearanceMm?: number
  overlapDepthMm?: number
  variables?: Variable[]
  extremesMm?: Record<'min' | 'max', Record<string, number | [number, number]>>
  method?: string
  frame?: Frame
  evidence?: AssemblyEvidence
  reason?: string
  toleranceMm?: number
  objectIds?: FeatureId[]
  angularVariationDegrees?: number
}

type DrawingError =
  | { code: 'projectionFailed'; message: string }
  | { code: 'missingReference'; annotationId: string; role: Role; featureId?: FeatureId }
  | { code: 'annotationConflict'; annotationIds: string[]; view: ViewId; side: string; lane: number }
type DrawingGeometry =
  | { kind: 'polyline'; closed: true; points: Point[] }
  | { kind: 'circle'; center: Point; radius: number }
  | { kind: 'line'; style: 'hidden'; points: [Point, Point] }

export interface Drawing {
  unit: 'mm'
  revision: string
  displayDecimals: number
  convention: string
  views: { id: ViewId; size: Point; u: string; v: string; geometry: DrawingGeometry[] }[]
  annotations: { id: string; view: ViewId; side: string; lane: number; valueMm: number;
    witnesses: [Point, Point]; reference: Required<Ref> }[]
  errors: DrawingError[]
}

interface Mesh {
  frameId: string
  positions: Axis[]
  triangles: [number, number, number][]
  objects: { featureId: FeatureId; role?: Role; firstTriangle: number; triangleCount: number }[]
}

interface ReportMetadata {
  status: Status
  revision: string
  unit: 'mm'
  modelingToleranceMm: number
  rulesVersion: string
  solverVersion: string
  source: { file: string; sha256: string }
  execution: { jobId: string; attempt: number; inputFingerprint: string; version: number }
  checks: Check[]
}

export interface GeometryReport extends ReportMetadata {
  model: MountingPlate
  measured: { valid: boolean; solids: number; bounds: Bounds; volumeMm3: number; cylinders: Cylinder[] }
  references: Record<Role, FaceReference | ({ resolved: false } & Ref)>
  invalidations: (Ref & { clauses: Clause[]; annotations: string[] })[]
  drawing: Drawing
  mesh: { plate: Mesh; cover: Mesh }
  plateStep: Uint8Array
  placement: { frame: Frame; worldPlateBounds: Bounds }
}

export type EngineReport = GeometryReport | (ReportMetadata & {
  status: 'executionFailed'
  error: { code: 'geometryFailed'; message: string }
})

export interface RunOptions {
  workerUrl?: URL
  projectId?: string
  deferDrawing?: boolean
  signal?: AbortSignal
  timeoutMs?: number
  jobId?: string
  attempt?: number
  drawing?: { convention?: string; lanes?: Record<string, number> }
}

export function runMountingPlate(model: MountingPlate, options?: RunOptions): Promise<EngineReport>

export function fingerprint(payload: unknown): string
export function runMountingPlateDrawing(report: GeometryReport, options?: RunOptions): Promise<Drawing>

export function releaseMountingPlate(projectId: string, revision?: string, workerUrl?: URL): Promise<void>
