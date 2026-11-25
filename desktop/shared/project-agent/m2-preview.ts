export type M2CheckStatus =
  | 'pass'
  | 'fail'
  | 'needsClarification'
  | 'uncovered'
  | 'executionFailed'
  | 'checking'

export type M2ClarificationReason = 'missing' | 'conflict' | 'ambiguousReference'

export interface M2SourceRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly unit?: 'pdfPoint1000' | 'px' | 'mm'
}

export interface M2SourceAnchor {
  readonly documentRef: string
  readonly documentName: string
  readonly page: number
  readonly region?: M2SourceRegion | null
  readonly excerpt: string
}

export interface M2ModelFeatureItem {
  readonly objectId: string
  readonly breadcrumb: string
  readonly featureRef: string
  readonly partName: string
  readonly role: string
  readonly kind: 'plate' | 'hole' | 'face' | 'gap' | 'other'
  readonly linkedAnnotationIds: readonly string[]
  /** Schematic placement in normalized 0..100 coordinates for interactive preview */
  readonly bounds?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
}

export interface M2DrawingAnnotationItem {
  readonly annotationId: string
  readonly label: string
  readonly valueText: string
  readonly view: 'front' | 'top' | 'side'
  readonly linkedFeatureIds: readonly string[]
  readonly requirementIds?: readonly string[]
}

export interface M2RequirementItem {
  readonly requirementId: string
  readonly title: string
  readonly interpretation: string
  readonly required: boolean
  readonly status: 'confirmed' | 'needsClarification' | 'conflict' | 'uncovered'
  readonly clarificationReason?: M2ClarificationReason
  readonly clarificationPrompt?: string
  readonly anchor: M2SourceAnchor
  readonly linkedFeatureIds: readonly string[]
  readonly linkedAnnotationIds: readonly string[]
}

export interface M2CheckItem {
  readonly checkId: string
  readonly requirementId: string
  readonly title: string
  readonly required: boolean
  readonly status: M2CheckStatus
  readonly summary: string
  readonly detail?: string
  readonly linkedFeatureIds: readonly string[]
  readonly linkedAnnotationIds: readonly string[]
  readonly clarificationPrompt?: string
  readonly clarificationReason?: M2ClarificationReason
  readonly revisionFingerprint?: string | null
  readonly anchor?: M2SourceAnchor | null
}

export interface M2EvidenceResult {
  readonly requirementId: string
  readonly checkId?: string
  readonly anchors: readonly M2SourceAnchor[]
  readonly featureIds: readonly string[]
  readonly annotationIds: readonly string[]
  readonly inputs?: readonly { readonly name: string; readonly valueText: string }[]
  readonly thresholdText?: string | null
}

export interface M2ArtifactSlotState {
  readonly status: 'empty' | 'building' | 'ready' | 'failed'
  readonly revision: string | null
  readonly revisionOrder: number | null
  readonly isDraft: boolean
  readonly fingerprint: string | null
  readonly summary?: string | null
}

export interface M2DrawingFailureNotice {
  readonly failedRevision: string
  readonly failedRevisionOrder: number | null
  readonly reason: string
  readonly retryable: boolean
}

export interface M2HistoryEntry {
  readonly id: string
  readonly sequence: number
  readonly revision: string | null
  readonly kind: 'model' | 'drawing' | 'checks' | 'revision' | 'clarification'
  readonly status: 'ready' | 'failed' | 'stale_late' | 'info'
  readonly title: string
  readonly detail: string
  readonly isLateStale?: boolean
}

export type M2Point2D = readonly [number, number]
export type M2Point3D = readonly [number, number, number]
export type M2DrawingViewId = 'front' | 'top' | 'side'

export interface M2MeshTriangleRange {
  readonly startTriangle: number
  readonly endTriangle: number
  readonly objectId: string
  readonly featureRef?: string
  readonly role?: string
  readonly partName?: string
}

export interface M2MeshBounds {
  readonly min: M2Point3D
  readonly max: M2Point3D
}

export interface M2ModelMesh {
  readonly frameId?: string
  readonly positions: readonly number[] | Float32Array
  readonly indices: readonly number[] | Uint32Array | Uint16Array
  readonly normals?: readonly number[] | Float32Array
  readonly triangleRanges: readonly M2MeshTriangleRange[]
  readonly bounds: M2MeshBounds
}

/** Backend M2-BE-01 Mesh object range (`engine.d.mts` -> `Mesh['objects'][number]`). */
export interface M2BackendMeshObject {
  readonly featureId: string
  readonly role?: string
  readonly firstTriangle: number
  readonly triangleCount: number
}

/** Backend M2-BE-01 Mesh structure (`engine.d.mts` -> `Mesh`). */
export interface M2BackendMesh {
  readonly frameId?: string
  readonly positions: readonly M2Point3D[]
  readonly triangles: readonly M2Point3D[]
  readonly objects?: readonly M2BackendMeshObject[]
  readonly bounds?: M2MeshBounds
}

/** Backend M2-BE-01 composite mesh (`engine.d.mts` -> `GeometryReport['mesh']`). */
export interface M2BackendCompositeMesh {
  readonly plate: M2BackendMesh
  readonly cover?: M2BackendMesh | null
  readonly bounds?: M2MeshBounds
}

export type M2ModelMeshInput = M2ModelMesh | M2BackendMesh | M2BackendCompositeMesh

export interface M2DrawingVectorLine {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

export interface M2DrawingVectorCircle {
  readonly cx: number
  readonly cy: number
  readonly r: number
}

export interface M2DrawingVectorAnnotationAnchor {
  readonly annotationId: string
  readonly view: M2DrawingViewId
  readonly side?: string
  readonly lane?: number
  readonly label?: string
  readonly valueText?: string
  readonly valueMm?: number
  readonly witnesses?: readonly [M2Point2D, M2Point2D]
  readonly anchor?: M2Point2D
  readonly linkedFeatureIds?: readonly string[]
  readonly reference?: { readonly role: string; readonly featureId: string }
}

export interface M2DrawingVectorView {
  readonly id: M2DrawingViewId
  readonly title?: string
  readonly size: M2Point2D
  readonly u?: string
  readonly v?: string
  readonly lines: readonly M2DrawingVectorLine[]
  readonly circles: readonly M2DrawingVectorCircle[]
  readonly hiddenLines: readonly M2DrawingVectorLine[]
}

export interface M2DrawingVector {
  readonly unit: string
  readonly revision: string
  readonly displayDecimals?: number
  readonly convention?: string
  readonly views: readonly M2DrawingVectorView[]
  readonly annotations?: readonly M2DrawingVectorAnnotationAnchor[]
}

/** Backend M2-BE-01 DrawingGeometry (`engine.d.mts` -> `DrawingGeometry`). */
export type M2BackendDrawingGeometry =
  | { readonly kind: 'polyline'; readonly closed?: boolean; readonly points: readonly M2Point2D[] }
  | { readonly kind: 'circle'; readonly center: M2Point2D; readonly radius: number }
  | {
      readonly kind: 'line'
      readonly style?: 'hidden' | 'solid'
      readonly points: readonly [M2Point2D, M2Point2D]
    }

/** Backend M2-BE-01 Drawing view (`engine.d.mts` -> `Drawing['views'][number]`). */
export interface M2BackendDrawingView {
  readonly id: M2DrawingViewId
  readonly size: M2Point2D
  readonly u?: string
  readonly v?: string
  readonly geometry: readonly M2BackendDrawingGeometry[]
}

/** Backend M2-BE-01 Drawing annotation (`engine.d.mts` -> `Drawing['annotations'][number]`). */
export interface M2BackendDrawingAnnotation {
  readonly id: string
  readonly view: M2DrawingViewId
  readonly side: string
  readonly lane: number
  readonly valueMm: number
  readonly witnesses: readonly [M2Point2D, M2Point2D]
  readonly reference: { readonly role: string; readonly featureId: string }
}

/** Backend M2-BE-01 Drawing (`engine.d.mts` -> `Drawing`). */
export interface M2BackendDrawing {
  readonly unit: string
  readonly revision: string
  readonly displayDecimals?: number
  readonly convention?: string
  readonly views: readonly M2BackendDrawingView[]
  readonly annotations?: readonly M2BackendDrawingAnnotation[]
}

export type M2DrawingVectorInput = M2DrawingVector | M2BackendDrawing

export interface M2PreviewSnapshot {
  readonly projectId: string
  readonly currentRevision: string | null
  readonly currentRevisionOrder?: number | null
  readonly model: M2ArtifactSlotState
  readonly drawing: M2ArtifactSlotState
  readonly drawingFailure?: M2DrawingFailureNotice | null
  readonly checksInProgress?: boolean
  readonly features: readonly M2ModelFeatureItem[]
  readonly annotations: readonly M2DrawingAnnotationItem[]
  readonly requirements: readonly M2RequirementItem[]
  readonly checks: readonly M2CheckItem[]
  readonly history?: readonly M2HistoryEntry[]
  readonly modelMesh?: M2ModelMeshInput | null
  readonly drawingVector?: M2DrawingVectorInput | null
}

export interface M2PreviewEvent {
  readonly projectId: string
  readonly sequence: number
  readonly revision: string
  readonly revisionOrder?: number
  readonly isDraft?: boolean
  readonly fingerprint?: string | null
  readonly scopeEpoch?: number | null
  readonly writerEpoch?: number | null
  readonly taskCompleted?: boolean
  readonly type:
    | 'model_ready'
    | 'drawing_ready'
    | 'drawing_failed'
    | 'checks_updated'
    | 'revision_refreshed'
    | 'task_completed'
  readonly summary?: string
  readonly errorReason?: string
  readonly retryable?: boolean
  readonly features?: readonly M2ModelFeatureItem[]
  readonly annotations?: readonly M2DrawingAnnotationItem[]
  readonly requirements?: readonly M2RequirementItem[]
  readonly checks?: readonly M2CheckItem[]
  readonly checksInProgress?: boolean
  readonly modelMesh?: M2ModelMeshInput | null
  readonly drawingVector?: M2DrawingVectorInput | null
}

export interface M2LocateEvidenceRequest {
  readonly projectId: string
  readonly revision: string | null
  readonly target:
    | { readonly kind: 'check'; readonly checkId: string; readonly requirementId: string }
    | { readonly kind: 'requirement'; readonly requirementId: string }
    | { readonly kind: 'feature'; readonly objectId: string; readonly featureRef: string }
    | { readonly kind: 'annotation'; readonly annotationId: string }
}

export interface M2RetryDrawingRequest {
  readonly projectId: string
  readonly revision: string
  readonly requestId: string
}

export interface M2RetryDrawingResult {
  readonly projectId: string
  readonly revision: string
  readonly revisionOrder?: number
  readonly fingerprint: string
  readonly summary?: string
  readonly annotations?: readonly M2DrawingAnnotationItem[]
  readonly drawingVector?: M2DrawingVectorInput | null
}

export interface M2ClarificationSubmitRequest {
  readonly projectId: string
  readonly revision: string | null
  readonly targetId: string
  readonly mode: 'answer' | 'correct_interpretation'
  readonly content: string
  readonly requestId: string
}

export interface M2ClarificationSubmitResult {
  readonly targetId: string
  readonly accepted: boolean
  readonly updatedInterpretation?: string
  readonly nextRevision?: string | null
  readonly message: string
}

export type M2Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; detail?: string } }

export interface M2PreviewApi {
  readonly getM2PreviewSnapshot: (request: {
    readonly projectId: string
    readonly revision?: string | null
  }) => Promise<M2Result<M2PreviewSnapshot>>
  readonly locateM2Evidence: (
    request: M2LocateEvidenceRequest,
  ) => Promise<M2Result<M2EvidenceResult>>
  readonly retryM2Drawing: (
    request: M2RetryDrawingRequest,
  ) => Promise<M2Result<M2RetryDrawingResult>>
  readonly submitM2Clarification: (
    request: M2ClarificationSubmitRequest,
  ) => Promise<M2Result<M2ClarificationSubmitResult>>
  readonly subscribeM2PreviewEvents: (
    request: { readonly projectId: string },
    listener: (event: M2PreviewEvent) => void,
  ) => Promise<
    M2Result<{
      readonly subscriptionId: string
      readonly unsubscribe: () => void
    }>
  >
}
