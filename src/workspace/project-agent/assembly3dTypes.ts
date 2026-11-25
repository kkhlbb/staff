import type { EvidenceRef } from '../../document-extraction/types'
import type {
  AssemblyMate,
  AssemblyModelV1,
  AssemblyPart,
  DatumDefinition,
  MeasurementSpec,
  PersistentFeature,
} from '../../project-file/types'
import type { M2MeshBounds, M2MeshTriangleRange, M2SidebarSection } from './m2WorkbenchBridge'

export type {
  AssemblyMate,
  AssemblyModelV1,
  AssemblyPart,
  DatumDefinition,
  EvidenceRef,
  MeasurementSpec,
  PersistentFeature,
}

export type WorkbenchSidebarSection = M2SidebarSection | 'simulation'

export type CameraPresetId = 'iso' | 'front' | 'top' | 'right'

export type PickedFeatureGeometryKind =
  | 'face'
  | 'cylindrical-hole-axis'
  | 'edge'
  | 'point'
  | 'other'

export type RowMajorMatrix4 = readonly [
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [0, 0, 0, 1],
]

export interface PartEdgeSegment {
  readonly featureId: string
  readonly partId: string
  readonly label: string
  readonly kind: 'edge' | 'cylindrical-hole-axis'
  /** Flat pairs of 3D coordinates [x0, y0, z0, x1, y1, z1, ...]. */
  readonly points: readonly number[]
}

export interface PartFaceTriangleRange extends M2MeshTriangleRange {
  readonly partId: string
  readonly geometryKind?: PickedFeatureGeometryKind
  readonly label?: string
}

export interface PartMesh {
  readonly partId: string
  readonly displayName: string
  readonly color: string
  readonly positions: readonly number[] | Float32Array
  readonly indices: readonly number[] | Uint32Array | Uint16Array
  readonly normals?: readonly number[] | Float32Array
  readonly faceTriangleRanges: readonly PartFaceTriangleRange[]
  readonly edgeSegments?: readonly PartEdgeSegment[]
  readonly nominalTransform: RowMajorMatrix4
  readonly bounds: M2MeshBounds
  readonly centroid?: readonly [number, number, number]
  readonly explodeVector?: readonly [number, number, number]
}

export interface AssemblyFeatureSelectionItem {
  readonly featureId: string
  readonly partId: string
  readonly partName: string
  readonly featureLabel: string
  readonly geometryKind: PickedFeatureGeometryKind
}

export type ContextPillActionId =
  | 'set-datum'
  | 'add-second-feature'
  | 'create-face-contact'
  | 'create-coaxial'
  | 'create-distance-align'
  | 'create-3d-loop'
  | 'send-to-ai'

export interface ContextPillActionSpec {
  readonly id: ContextPillActionId
  readonly label: string
  readonly primary?: boolean
  readonly active?: boolean
}

/** M3 pre-wired CSS2DRenderer annotation anchor interface. */
export interface Css2dAnnotationItem {
  readonly id: string
  readonly label: string
  readonly position: readonly [number, number, number]
  readonly partId?: string
  readonly featureId?: string
  readonly symbol?: string
  readonly valueText?: string
  readonly kind?: 'fcf' | 'datum' | 'note'
}

/** M4 pre-wired BufferGeometry vertex color field channel. */
export interface VertexColorFieldChannel {
  readonly partId: string
  /** RGB triples (0..1), length = vertexCount * 3. */
  readonly colors: Float32Array | readonly number[]
}

/** M4 pre-wired BufferGeometry vertex displacement channel. */
export interface VertexDisplacementChannel {
  readonly partId: string
  /** XYZ displacements in mm, length = vertexCount * 3. */
  readonly displacements: Float32Array | readonly number[]
  readonly scale?: number
}

export type AiMateDraftKind =
  | 'face-contact'
  | 'coaxial'
  | 'floating-clearance'
  | 'parallel'
  | 'distance'

export interface AiMateDraftItem {
  readonly id: string
  readonly kind: AiMateDraftKind
  readonly mateTypeLabel: string
  readonly featureIds: readonly [string, string]
  readonly featureLabels: readonly [string, string]
  readonly confidencePercent: number
  readonly rationale: string
  readonly evidenceRefs: readonly EvidenceRef[]
  readonly selected: boolean
  readonly applied?: boolean
}

export interface ToleranceContributorSpec {
  readonly id: string
  readonly label: string
  readonly partId: string
  readonly featureId: string
  readonly partName: string
  readonly featureLabel: string
  readonly currentTolMm: number
  readonly minTolMm: number
  readonly maxTolMm: number
  readonly stepMm: number
  readonly sensitivity: number
  readonly sign: 1 | -1
  readonly formatPrefix?: '±' | 'Ø' | ''
}

export interface SimulationLoopSpec {
  readonly id: string
  readonly title: string
  readonly measurementKind: MeasurementSpec['kind']
  readonly nominalMm: number
  readonly lslMm: number
  readonly uslMm: number
  readonly sampleCount: number
  readonly seed: number
  readonly contributors: readonly ToleranceContributorSpec[]
}

export interface HistogramBin {
  readonly startMm: number
  readonly endMm: number
  readonly count: number
  readonly ratio: number
  readonly outOfSpec: boolean
}

export interface ParetoContributionItem {
  readonly contributorId: string
  readonly label: string
  readonly partId: string
  readonly featureId: string
  readonly currentTolMm: number
  readonly minTolMm: number
  readonly maxTolMm: number
  readonly stepMm: number
  readonly formatPrefix: '±' | 'Ø' | ''
  readonly varianceSharePercent: number
}

export interface SimulationDiagnosticResult {
  readonly loopId: string
  readonly title: string
  readonly nominalMm: number
  readonly meanMm: number
  readonly sigmaMm: number
  readonly threeSigmaLowMm: number
  readonly threeSigmaHighMm: number
  readonly lslMm: number
  readonly uslMm: number
  readonly cp: number
  readonly cpk: number
  readonly ppm: number
  readonly status: 'pass' | 'warn' | 'fail'
  readonly sampleCount: number
  readonly histogram: readonly HistogramBin[]
  readonly pareto: readonly ParetoContributionItem[]
  readonly computeMs: number
  readonly source: 'transport' | 'local-fallback'
}

export interface Assembly3dInitialState {
  readonly assembly3d?: AssemblyModelV1
  readonly partMeshes?: readonly PartMesh[]
  readonly aiMateDrafts?: readonly AiMateDraftItem[]
  readonly simulationSpec?: SimulationLoopSpec
}

export const IDENTITY_MATRIX_4X4: RowMajorMatrix4 = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
]
