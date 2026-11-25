/**
 * Narrow duck-typing bridge and pure state/event reducers for M2-FE-01:
 * dual-view canvas linkage (model / drawing / split), object reference context,
 * check & evidence source localization, clarification responses, and
 * out-of-order / late artifact guards.
 *
 * Boundary rules:
 * - Never modifies frozen `desktop/shared/contracts.ts`, `desktop/preload`, or `desktop/main`.
 * - Never fabricates backend success when M2 narrow methods are missing.
 */

import {
  normalizeWorkbenchBridgeError,
  type M1SelectedObjectRef,
  type M1WorkbenchBridgeResult,
} from './m1WorkbenchBridge'

export type M2ViewMode = 'model' | 'drawing' | 'split'
export type M2SingleViewTab = 'model' | 'drawing'
export type M2SidebarSection = 'conversation' | 'requirements' | 'checks' | 'history'

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

export interface M2ModelFeatureItem extends M1SelectedObjectRef {
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

export interface M2CameraState {
  readonly yawDeg: number
  readonly pitchDeg: number
  readonly zoomPercent: number
}

export interface M2DrawingViewportState {
  readonly panX: number
  readonly panY: number
  readonly zoomPercent: number
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

export interface M2WorkbenchBridge {
  readonly getM2PreviewSnapshot?: (request: {
    readonly projectId: string
    readonly revision?: string | null
  }) => Promise<M1WorkbenchBridgeResult<M2PreviewSnapshot>>
  readonly locateM2Evidence?: (
    request: M2LocateEvidenceRequest,
  ) => Promise<M1WorkbenchBridgeResult<M2EvidenceResult>>
  readonly retryM2Drawing?: (
    request: M2RetryDrawingRequest,
  ) => Promise<M1WorkbenchBridgeResult<M2RetryDrawingResult>>
  readonly submitM2Clarification?: (
    request: M2ClarificationSubmitRequest,
  ) => Promise<M1WorkbenchBridgeResult<M2ClarificationSubmitResult>>
  readonly subscribeM2PreviewEvents?: (
    request: { readonly projectId: string },
    listener: (event: M2PreviewEvent) => void,
  ) => Promise<
    M1WorkbenchBridgeResult<{
      readonly subscriptionId: string
      readonly unsubscribe?: () => void
    }>
  >
}

export const M2_WORKBENCH_BRIDGE_METHODS = [
  'getM2PreviewSnapshot',
  'locateM2Evidence',
  'retryM2Drawing',
  'submitM2Clarification',
  'subscribeM2PreviewEvents',
] as const

export type M2WorkbenchBridgeMethodName = (typeof M2_WORKBENCH_BRIDGE_METHODS)[number]

export interface M2WorkbenchBridgeProbe {
  readonly bridge: M2WorkbenchBridge
  readonly capabilities: {
    readonly previewSnapshot: boolean
    readonly locateM2Evidence: boolean
    readonly retryDrawing: boolean
    readonly submitClarification: boolean
    readonly previewEvents: boolean
  }
  readonly anyAvailable: boolean
  readonly missingMethods: readonly M2WorkbenchBridgeMethodName[]
}

export function probeM2WorkbenchBridge(candidate: unknown): M2WorkbenchBridgeProbe {
  const record =
    candidate !== null && typeof candidate === 'object'
      ? (candidate as Record<string, unknown>)
      : null

  const bindMethod = <K extends M2WorkbenchBridgeMethodName>(
    name: K,
  ): M2WorkbenchBridge[K] | undefined => {
    if (!record || typeof record[name] !== 'function') {
      return undefined
    }
    const fn = record[name] as (...args: unknown[]) => unknown
    return ((...args: unknown[]) => fn.apply(record, args)) as M2WorkbenchBridge[K]
  }

  const bridge: M2WorkbenchBridge = {
    getM2PreviewSnapshot: bindMethod('getM2PreviewSnapshot'),
    locateM2Evidence: bindMethod('locateM2Evidence'),
    retryM2Drawing: bindMethod('retryM2Drawing'),
    submitM2Clarification: bindMethod('submitM2Clarification'),
    subscribeM2PreviewEvents: bindMethod('subscribeM2PreviewEvents'),
  }

  const missingMethods: M2WorkbenchBridgeMethodName[] = []
  for (const name of M2_WORKBENCH_BRIDGE_METHODS) {
    if (typeof bridge[name] !== 'function') {
      missingMethods.push(name)
    }
  }

  const capabilities = {
    previewSnapshot: typeof bridge.getM2PreviewSnapshot === 'function',
    locateM2Evidence: typeof bridge.locateM2Evidence === 'function',
    retryDrawing: typeof bridge.retryM2Drawing === 'function',
    submitClarification: typeof bridge.submitM2Clarification === 'function',
    previewEvents: typeof bridge.subscribeM2PreviewEvents === 'function',
  }

  return {
    bridge,
    capabilities,
    anyAvailable: Object.values(capabilities).some(Boolean),
    missingMethods,
  }
}

export function resolveWindowM2WorkbenchBridge(): M2WorkbenchBridgeProbe {
  const candidate =
    typeof window !== 'undefined' ? (window as { cunlian?: unknown }).cunlian : undefined
  return probeM2WorkbenchBridge(candidate)
}

export function normalizeM2BridgeError(error: unknown, fallbackMessage: string) {
  return normalizeWorkbenchBridgeError(error, fallbackMessage)
}

/**
 * Parse numeric order from revision identifiers like `draft-8`, `v7`, `r3`, or `8`.
 */
export function parseRevisionOrder(
  revision: string | null | undefined,
  explicitOrder?: number | null,
): number | null {
  if (typeof explicitOrder === 'number' && Number.isFinite(explicitOrder)) {
    return explicitOrder
  }
  if (!revision) return null
  const match = /(\d+)(?!.*\d)/.exec(revision.trim())
  if (!match) return null
  const num = Number.parseInt(match[1], 10)
  return Number.isFinite(num) ? num : null
}

/**
 * Human-readable Chinese revision label:
 * - `draft-8` -> `草稿 8`
 * - `v7` -> `版本 7`
 */
export function formatRevisionDisplay(revision: string | null | undefined): string {
  if (!revision) return '无'
  const trimmed = revision.trim()
  const draftMatch = /^draft[-_\s]?(\d+)$/i.exec(trimmed)
  if (draftMatch) {
    return `草稿 ${draftMatch[1]}`
  }
  const versionMatch = /^v(\d+)$/i.exec(trimmed)
  if (versionMatch) {
    return `版本 ${versionMatch[1]}`
  }
  return trimmed
}

export function formatPartialDrawingFailureMessage(
  modelRevision: string | null,
  drawingFailure: M2DrawingFailureNotice,
  currentDrawingRevision: string | null,
): string {
  const modelLabel = formatRevisionDisplay(modelRevision ?? drawingFailure.failedRevision)
  if (currentDrawingRevision) {
    return `${modelLabel} 的模型已生成；图纸生成失败，当前显示${formatRevisionDisplay(currentDrawingRevision)}`
  }
  return `${modelLabel} 的模型已生成；图纸生成失败，当前暂无可用图纸`
}

export interface M2CheckStatusMeta {
  readonly status: M2CheckStatus
  readonly symbol: string
  readonly label: string
  readonly toneClass: string
}

export const M2_CHECK_STATUS_META: Record<M2CheckStatus, M2CheckStatusMeta> = {
  pass: { status: 'pass', symbol: '✓', label: '通过', toneClass: 'pa-tone-pass' },
  fail: { status: 'fail', symbol: '✕', label: '失败', toneClass: 'pa-tone-danger' },
  needsClarification: {
    status: 'needsClarification',
    symbol: '?',
    label: '待澄清',
    toneClass: 'pa-tone-pending',
  },
  uncovered: { status: 'uncovered', symbol: '○', label: '未覆盖', toneClass: 'pa-tone-muted' },
  executionFailed: {
    status: 'executionFailed',
    symbol: '!',
    label: '执行失败',
    toneClass: 'pa-tone-danger',
  },
  checking: { status: 'checking', symbol: '◌', label: '检查中', toneClass: 'pa-tone-action' },
}

export function getCheckStatusMeta(status: M2CheckStatus): M2CheckStatusMeta {
  return M2_CHECK_STATUS_META[status]
}

export function resolveEffectiveViewMode(
  requestedMode: M2ViewMode,
  isNarrow: boolean,
  fallbackTab: M2SingleViewTab,
): M2ViewMode {
  if (isNarrow && requestedMode === 'split') {
    return fallbackTab
  }
  return requestedMode
}

export function areArtifactsRevisionAligned(
  model: M2ArtifactSlotState,
  drawing: M2ArtifactSlotState,
  expectedRevision?: string | null,
): boolean {
  if (model.status !== 'ready' || drawing.status !== 'ready') {
    return false
  }
  const modelFp = model.fingerprint?.trim() ?? ''
  const drawingFp = drawing.fingerprint?.trim() ?? ''
  if (!modelFp || !drawingFp || modelFp !== drawingFp) {
    return false
  }
  if (!model.revision || !drawing.revision || model.revision !== drawing.revision) {
    return false
  }
  if (expectedRevision !== undefined && expectedRevision !== null) {
    if (model.revision !== expectedRevision || drawing.revision !== expectedRevision) {
      return false
    }
  }
  return true
}

export interface M2NaturalCompletionSummary {
  readonly revision: string
  readonly fingerprint: string
  readonly triggeredByTaskSignal: boolean
  readonly isPendingChecksTerminal: boolean
  readonly checksInProgress: boolean
  readonly totalRequirements: number
  readonly confirmedRequirements: number
  readonly unmetRequiredCount: number
  readonly unmetRequiredTitles: readonly string[]
  readonly totalChecks: number
  readonly passCount: number
  readonly failCount: number
  readonly needsClarificationCount: number
  readonly uncoveredCount: number
  readonly executionFailedCount: number
  readonly allRequiredPassed: boolean
  readonly summaryText: string
}

export interface M2CanvasState {
  readonly projectId: string
  readonly currentRevision: string | null
  readonly currentRevisionOrder: number | null
  readonly viewMode: M2ViewMode
  readonly lastSingleTab: M2SingleViewTab
  readonly hasSeenRebuildableDraft: boolean
  readonly model: M2ArtifactSlotState
  readonly drawing: M2ArtifactSlotState
  readonly drawingFailure: M2DrawingFailureNotice | null
  readonly drawingFailureGeneration: number
  readonly drawingStateGeneration: number
  readonly checksInProgress: boolean
  readonly taskCompleted: boolean
  readonly features: readonly M2ModelFeatureItem[]
  readonly annotations: readonly M2DrawingAnnotationItem[]
  readonly annotationsByRevision: Readonly<Record<string, readonly M2DrawingAnnotationItem[]>>
  readonly modelMesh: M2ModelMesh | null
  readonly drawingVector: M2DrawingVector | null
  readonly drawingVectorByRevision: Readonly<Record<string, M2DrawingVector | null>>
  readonly requirements: readonly M2RequirementItem[]
  readonly checks: readonly M2CheckItem[]
  readonly history: readonly M2HistoryEntry[]
  readonly lastEventSequence: number
  readonly revisionSequences: Readonly<Record<string, number>>
  readonly selectedObjectId: string | null
  readonly selectedAnnotationId: string | null
  readonly selectionInvalidated: boolean
  readonly invalidatedObjectLabel: string | null
  readonly camera: M2CameraState
  readonly drawingViewport: M2DrawingViewportState
}

/**
 * Compute natural completion summary when model + drawing + checks are aligned for
 * the same revision and checks have finished (never auto-commits formal version).
 *
 * - E3: Any required requirement that is not confirmed (`needsClarification` / `conflict` / `uncovered`)
 *   or lacks a passed check bound to the current revision fingerprint prevents natural completion.
 * - E4 / N5: When `taskCompleted` is true and both slots are aligned-ready, but `checks` for the current
 *   revision is empty (whether `checksInProgress` is true or false), emits a clear non-completion
 *   terminal summary indicating waiting/checking while keeping formal commit blocked.
 */
export function computeNaturalCompletionSummary(
  state: Pick<
    M2CanvasState,
    'model' | 'drawing' | 'drawingFailure' | 'checksInProgress' | 'taskCompleted' | 'requirements' | 'checks'
  >,
): M2NaturalCompletionSummary | null {
  if (!areArtifactsRevisionAligned(state.model, state.drawing)) return null
  const revision = state.model.revision
  const fingerprint = state.model.fingerprint?.trim() ?? ''
  if (!revision || !fingerprint) return null
  if (state.drawingFailure && state.drawingFailure.failedRevision === revision) return null

  const currentRevChecks = state.checks.filter(
    (item) => item.revisionFingerprint?.trim() === fingerprint,
  )

  const totalRequirements = state.requirements.length
  const confirmedRequirements = state.requirements.filter((r) => r.status === 'confirmed').length
  const requiredRequirements = state.requirements.filter((r) => r.required)
  const unmetRequiredRequirements = requiredRequirements.filter((req) => {
    if (req.status !== 'confirmed') return true
    return !currentRevChecks.some(
      (chk) => chk.requirementId === req.requirementId && chk.status === 'pass',
    )
  })
  const unmetRequiredTitles = unmetRequiredRequirements.map((r) => r.title)

  // E4 / N5: task_completed arrived with aligned model + drawing, but current-revision checks are empty.
  // Must remain visible even when checksInProgress === true (while formal commit stays blocked).
  if (currentRevChecks.length === 0) {
    if (!state.taskCompleted) return null
    const unmetDetail =
      unmetRequiredRequirements.length > 0
        ? `（存在 ${unmetRequiredRequirements.length} 项未满足/待澄清必需要求：${unmetRequiredTitles.join('、')}）`
        : ''
    const statusPhase = state.checksInProgress ? '检查进行中' : '等待检查结果'
    return {
      revision,
      fingerprint,
      triggeredByTaskSignal: true,
      isPendingChecksTerminal: true,
      checksInProgress: state.checksInProgress,
      totalRequirements,
      confirmedRequirements,
      unmetRequiredCount: unmetRequiredRequirements.length,
      unmetRequiredTitles,
      totalChecks: 0,
      passCount: 0,
      failCount: 0,
      needsClarificationCount: 0,
      uncoveredCount: 0,
      executionFailedCount: 0,
      allRequiredPassed: false,
      summaryText: `${formatRevisionDisplay(revision)} 任务已结束 · ${statusPhase} · 尚未满足正式保存条件${unmetDetail}。`,
    }
  }

  if (state.checksInProgress) return null
  if (state.checks.some((item) => item.status === 'checking')) return null

  // E3: Unmet or unconfirmed required requirements MUST NOT be judged as natural completion.
  if (unmetRequiredRequirements.length > 0) {
    return null
  }

  const passCount = currentRevChecks.filter((c) => c.status === 'pass').length
  const failCount = currentRevChecks.filter((c) => c.status === 'fail').length
  const needsClarificationCount = currentRevChecks.filter(
    (c) => c.status === 'needsClarification',
  ).length
  const uncoveredCount = currentRevChecks.filter((c) => c.status === 'uncovered').length
  const executionFailedCount = currentRevChecks.filter(
    (c) => c.status === 'executionFailed',
  ).length
  const requiredChecks = currentRevChecks.filter((c) => c.required)
  const allRequiredPassed =
    requiredChecks.length > 0 && requiredChecks.every((c) => c.status === 'pass')

  const summaryText = `${formatRevisionDisplay(revision)} 模型、图纸与检查已同版就绪：要求 ${confirmedRequirements}/${totalRequirements} 已确认，检查通过 ${passCount}/${currentRevChecks.length}（失败 ${failCount} · 待澄清 ${needsClarificationCount} · 未覆盖 ${uncoveredCount} · 执行失败 ${executionFailedCount}）。`

  return {
    revision,
    fingerprint,
    triggeredByTaskSignal: state.taskCompleted,
    isPendingChecksTerminal: false,
    checksInProgress: false,
    totalRequirements,
    confirmedRequirements,
    unmetRequiredCount: 0,
    unmetRequiredTitles: [],
    totalChecks: currentRevChecks.length,
    passCount,
    failCount,
    needsClarificationCount,
    uncoveredCount,
    executionFailedCount,
    allRequiredPassed,
    summaryText,
  }
}

export const DEFAULT_M2_CAMERA: M2CameraState = {
  yawDeg: 35,
  pitchDeg: 25,
  zoomPercent: 100,
}

export const DEFAULT_M2_DRAWING_VIEWPORT: M2DrawingViewportState = {
  panX: 0,
  panY: 0,
  zoomPercent: 100,
}

export const DEFAULT_M2_FEATURES: readonly M2ModelFeatureItem[] = [
  {
    objectId: 'obj-right-hole',
    breadcrumb: '安装板 › 右孔 › 圆柱面',
    featureRef: 'plate/right-hole/cylinder',
    partName: '安装板',
    role: '右孔圆柱面',
    kind: 'hole',
    linkedAnnotationIds: ['ann-right-margin', 'ann-right-hole-dia'],
    bounds: { x: 66, y: 46, w: 12, h: 12 },
  },
  {
    objectId: 'obj-left-hole',
    breadcrumb: '安装板 › 左孔 › 圆柱面',
    featureRef: 'plate/left-hole/cylinder',
    partName: '安装板',
    role: '左孔圆柱面',
    kind: 'hole',
    linkedAnnotationIds: ['ann-hole-pitch'],
    bounds: { x: 24, y: 46, w: 12, h: 12 },
  },
  {
    objectId: 'obj-right-face',
    breadcrumb: '安装板 › 右端面',
    featureRef: 'plate/right-end-face',
    partName: '安装板',
    role: '右端面',
    kind: 'face',
    linkedAnnotationIds: ['ann-right-margin', 'ann-plate-length'],
    bounds: { x: 86, y: 20, w: 6, h: 60 },
  },
  {
    objectId: 'obj-cover-gap',
    breadcrumb: '参考盖板 › 底面与安装板顶面间隙',
    featureRef: 'assembly/cover-plate/top-gap',
    partName: '参考盖板',
    role: '顶面法向间隙',
    kind: 'gap',
    linkedAnnotationIds: ['ann-cover-gap'],
    bounds: { x: 18, y: 12, w: 64, h: 10 },
  },
]

export const DEFAULT_M2_ANNOTATIONS: readonly M2DrawingAnnotationItem[] = [
  {
    annotationId: 'ann-right-margin',
    label: '右孔至右端面边距',
    valueText: '15.0 mm (最差 ≥ 13.0 mm)',
    view: 'top',
    linkedFeatureIds: ['obj-right-hole', 'obj-right-face'],
    requirementIds: ['req-right-margin'],
  },
  {
    annotationId: 'ann-right-hole-dia',
    label: '右孔孔径',
    valueText: 'Ø10.0 ±0.1 mm',
    view: 'top',
    linkedFeatureIds: ['obj-right-hole'],
    requirementIds: ['req-plate-geometry'],
  },
  {
    annotationId: 'ann-hole-pitch',
    label: '两孔中心距',
    valueText: '40.0 mm',
    view: 'top',
    linkedFeatureIds: ['obj-left-hole', 'obj-right-hole'],
    requirementIds: ['req-plate-geometry'],
  },
  {
    annotationId: 'ann-plate-length',
    label: '安装板外形长度',
    valueText: '80.0 × 50.0 × 8.0 mm',
    view: 'front',
    linkedFeatureIds: ['obj-right-face'],
    requirementIds: ['req-plate-geometry'],
  },
  {
    annotationId: 'ann-cover-gap',
    label: '盖板与安装板间隙',
    valueText: '2.0 mm [1.7, 2.3]',
    view: 'side',
    linkedFeatureIds: ['obj-cover-gap'],
    requirementIds: ['req-cover-gap'],
  },
]

export const DEFAULT_M2_REQUIREMENTS: readonly M2RequirementItem[] = [
  {
    requirementId: 'req-right-margin',
    title: '右孔至右端面剩余材料 ≥ 13 mm',
    interpretation: '在 X/Y 位置 ±0.2 mm、孔径 ±0.1 mm 独立变化下，最小剩余材料不得低于 13 mm。',
    required: true,
    status: 'confirmed',
    anchor: {
      documentRef: 'doc-plate-taskbook',
      documentName: '安装板任务书.pdf',
      page: 2,
      region: { x: 110, y: 240, width: 420, height: 64, unit: 'pdfPoint1000' },
      excerpt: '右孔至右端面的剩余材料在全部允许变化下至少为 13 mm。',
    },
    linkedFeatureIds: ['obj-right-hole', 'obj-right-face'],
    linkedAnnotationIds: ['ann-right-margin'],
  },
  {
    requirementId: 'req-cover-gap',
    title: '参考盖板与安装板间隙 ≥ 1.5 mm',
    interpretation: '盖板底面 Z = 10 ±0.1 mm，安装板厚度 8 ±0.2 mm，沿法向间隙至少 1.5 mm。',
    required: true,
    status: 'confirmed',
    anchor: {
      documentRef: 'doc-plate-taskbook',
      documentName: '安装板任务书.pdf',
      page: 2,
      region: { x: 110, y: 340, width: 430, height: 72, unit: 'pdfPoint1000' },
      excerpt: '参考盖板底面 Z 为 10 ±0.1 mm，安装板厚度 8 ±0.2 mm，要求间隙至少 1.5 mm。',
    },
    linkedFeatureIds: ['obj-cover-gap'],
    linkedAnnotationIds: ['ann-cover-gap'],
  },
  {
    requirementId: 'req-datum-conflict',
    title: '孔中心基准与厚度说明复核',
    interpretation: '当前识别到两处厚度说明不一致，且孔中心基准需确认。',
    required: true,
    status: 'needsClarification',
    clarificationReason: 'conflict',
    clarificationPrompt: '请确认安装板厚度以第 1 页 8 mm 为准，并确认孔中心基准面。',
    anchor: {
      documentRef: 'doc-plate-taskbook',
      documentName: '安装板任务书.pdf',
      page: 1,
      region: { x: 96, y: 180, width: 410, height: 58, unit: 'pdfPoint1000' },
      excerpt: '长方形安装板 80 × 50 × 8 mm，两只直径 10 mm 的通孔中心 (20,25) 与 (60,25) mm。',
    },
    linkedFeatureIds: ['obj-left-hole', 'obj-right-hole'],
    linkedAnnotationIds: ['ann-hole-pitch'],
  },
]

export const DEFAULT_M2_CHECKS: readonly M2CheckItem[] = [
  {
    checkId: 'chk-right-margin',
    requirementId: 'req-right-margin',
    title: '右孔至右端面最小剩余材料',
    required: true,
    status: 'pass',
    summary: '名义 15.0 mm，最差区间 [14.75, 15.25] mm ≥ 13.0 mm',
    linkedFeatureIds: ['obj-right-hole', 'obj-right-face'],
    linkedAnnotationIds: ['ann-right-margin'],
    revisionFingerprint: 'fp-draft-2',
    anchor: DEFAULT_M2_REQUIREMENTS[0].anchor,
  },
  {
    checkId: 'chk-cover-gap',
    requirementId: 'req-cover-gap',
    title: '参考盖板与安装板法向间隙',
    required: true,
    status: 'pass',
    summary: '名义 2.0 mm，区间 [1.7, 2.3] mm ≥ 1.5 mm',
    linkedFeatureIds: ['obj-cover-gap'],
    linkedAnnotationIds: ['ann-cover-gap'],
    revisionFingerprint: 'fp-draft-2',
    anchor: DEFAULT_M2_REQUIREMENTS[1].anchor,
  },
  {
    checkId: 'chk-datum-clarify',
    requirementId: 'req-datum-conflict',
    title: '孔中心基准与厚度冲突澄清',
    required: true,
    status: 'needsClarification',
    summary: '存在缺失基准或来源冲突，需设计师逐条回答或纠正解释',
    clarificationReason: 'conflict',
    clarificationPrompt: '请确认中心距与厚度来源，确认后再继续重算。',
    linkedFeatureIds: ['obj-left-hole', 'obj-right-hole'],
    linkedAnnotationIds: ['ann-hole-pitch'],
    revisionFingerprint: 'fp-draft-2',
    anchor: DEFAULT_M2_REQUIREMENTS[2].anchor,
  },
]

export function resolveMeshTrianglePick(
  triangleIndex: number,
  triangleRanges: readonly M2MeshTriangleRange[] | null | undefined,
): M2MeshTriangleRange | null {
  if (!Number.isInteger(triangleIndex) || triangleIndex < 0) {
    return null
  }
  if (!triangleRanges || triangleRanges.length === 0) {
    return null
  }
  for (const range of triangleRanges) {
    if (
      Number.isInteger(range.startTriangle) &&
      Number.isInteger(range.endTriangle) &&
      range.endTriangle > range.startTriangle &&
      triangleIndex >= range.startTriangle &&
      triangleIndex < range.endTriangle
    ) {
      return range
    }
  }
  return null
}

function computeBoundsFromFlatPositions(positions: readonly number[] | Float32Array): M2MeshBounds {
  if (positions.length < 3) {
    return { min: [0, 0, 0], max: [0, 0, 0] }
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]
    const y = positions[i + 1]
    const z = positions[i + 2]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  if (!Number.isFinite(minX)) {
    return { min: [0, 0, 0], max: [0, 0, 0] }
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
}

function isValidBounds(bounds: M2MeshBounds | undefined | null): bounds is M2MeshBounds {
  if (!bounds || !Array.isArray(bounds.min) || !Array.isArray(bounds.max)) return false
  if (bounds.min.length < 3 || bounds.max.length < 3) return false
  return (
    bounds.min.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    bounds.max.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}

function appendBackendMesh(
  mesh: M2BackendMesh,
  partName: string | undefined,
  positions: number[],
  indices: number[],
  triangleRanges: M2MeshTriangleRange[],
): void {
  const vertexOffset = positions.length / 3
  const triangleOffset = indices.length / 3
  for (const pt of mesh.positions) {
    positions.push(pt[0], pt[1], pt[2])
  }
  for (const tri of mesh.triangles) {
    indices.push(tri[0] + vertexOffset, tri[1] + vertexOffset, tri[2] + vertexOffset)
  }
  if (mesh.objects) {
    for (const obj of mesh.objects) {
      if (obj.triangleCount <= 0) continue
      const startTriangle = triangleOffset + obj.firstTriangle
      const endTriangle = startTriangle + obj.triangleCount
      triangleRanges.push({
        startTriangle,
        endTriangle,
        objectId: obj.featureId,
        featureRef: obj.role ?? obj.featureId,
        role: obj.role,
        partName,
      })
    }
  }
}

/**
 * Normalize either canonical frontend `M2ModelMesh` or backend `M2-BE-01` `Mesh` / `{ plate, cover }`
 * into a unified `M2ModelMesh`. Returns `null` when input is empty or missing.
 */
export function normalizeM2ModelMesh(
  input: M2ModelMeshInput | null | undefined,
): M2ModelMesh | null {
  if (!input) return null

  // Composite backend mesh `{ plate, cover }` from `engine.d.mts` GeometryReport['mesh']
  if ('plate' in input && input.plate) {
    const positions: number[] = []
    const indices: number[] = []
    const triangleRanges: M2MeshTriangleRange[] = []
    appendBackendMesh(input.plate, 'plate', positions, indices, triangleRanges)
    if (input.cover) {
      appendBackendMesh(input.cover, 'cover', positions, indices, triangleRanges)
    }
    if (positions.length === 0 || indices.length === 0) return null
    return {
      frameId: input.plate.frameId,
      positions,
      indices,
      triangleRanges,
      bounds: isValidBounds(input.bounds)
        ? input.bounds
        : computeBoundsFromFlatPositions(positions),
    }
  }

  // Single backend mesh `{ positions: Axis[], triangles: [i0,i1,i2][], objects }`
  if ('triangles' in input && Array.isArray(input.triangles)) {
    const positions: number[] = []
    const indices: number[] = []
    const triangleRanges: M2MeshTriangleRange[] = []
    appendBackendMesh(input, undefined, positions, indices, triangleRanges)
    if (positions.length === 0 || indices.length === 0) return null
    return {
      frameId: input.frameId,
      positions,
      indices,
      triangleRanges,
      bounds: isValidBounds(input.bounds)
        ? input.bounds
        : computeBoundsFromFlatPositions(positions),
    }
  }

  // Canonical frontend M2ModelMesh
  const canonical = input as M2ModelMesh
  if (!canonical.positions || canonical.positions.length < 3 || !canonical.indices || canonical.indices.length < 3) {
    return null
  }
  return {
    frameId: canonical.frameId,
    positions: canonical.positions,
    indices: canonical.indices,
    normals: canonical.normals,
    triangleRanges: canonical.triangleRanges ?? [],
    bounds: isValidBounds(canonical.bounds)
      ? canonical.bounds
      : computeBoundsFromFlatPositions(canonical.positions),
  }
}

const DEFAULT_VIEW_TITLES: Record<M2DrawingViewId, string> = {
  front: '主视图',
  top: '俯视图',
  side: '侧视图',
}

function formatBackendAnnotationValue(
  id: string,
  valueMm: number,
  unit: string,
  displayDecimals: number,
): string {
  const formatted = Number.isFinite(valueMm) ? valueMm.toFixed(displayDecimals) : String(valueMm)
  const isDiameter = /diameter|dia/i.test(id)
  return isDiameter ? `Ø${formatted} ${unit}` : `${formatted} ${unit}`
}

/**
 * Normalize either canonical frontend `M2DrawingVector` or backend `M2-BE-01` `Drawing`
 * (`engine.d.mts` / `drawing.mjs`) into a unified `M2DrawingVector`.
 */
export function normalizeM2DrawingVector(
  input: M2DrawingVectorInput | null | undefined,
): M2DrawingVector | null {
  if (!input || !Array.isArray(input.views) || input.views.length === 0) {
    return null
  }
  const unit = input.unit || 'mm'
  const displayDecimals =
    typeof input.displayDecimals === 'number' && Number.isInteger(input.displayDecimals)
      ? Math.max(0, Math.min(4, input.displayDecimals))
      : 1

  const views: M2DrawingVectorView[] = input.views.map((rawView) => {
    if ('geometry' in rawView && Array.isArray(rawView.geometry)) {
      const backendView = rawView as M2BackendDrawingView
      const lines: M2DrawingVectorLine[] = []
      const circles: M2DrawingVectorCircle[] = []
      const hiddenLines: M2DrawingVectorLine[] = []
      for (const geom of backendView.geometry) {
        if (geom.kind === 'polyline' && geom.points.length >= 2) {
          const pts = geom.points
          for (let i = 0; i < pts.length - 1; i += 1) {
            lines.push({
              x1: pts[i][0],
              y1: pts[i][1],
              x2: pts[i + 1][0],
              y2: pts[i + 1][1],
            })
          }
          if (geom.closed !== false && pts.length >= 3) {
            const last = pts[pts.length - 1]
            const first = pts[0]
            lines.push({ x1: last[0], y1: last[1], x2: first[0], y2: first[1] })
          }
        } else if (geom.kind === 'circle') {
          circles.push({ cx: geom.center[0], cy: geom.center[1], r: geom.radius })
        } else if (geom.kind === 'line' && geom.points.length >= 2) {
          const seg: M2DrawingVectorLine = {
            x1: geom.points[0][0],
            y1: geom.points[0][1],
            x2: geom.points[1][0],
            y2: geom.points[1][1],
          }
          if (geom.style === 'hidden') {
            hiddenLines.push(seg)
          } else {
            lines.push(seg)
          }
        }
      }
      return {
        id: backendView.id,
        title: DEFAULT_VIEW_TITLES[backendView.id],
        size: backendView.size,
        u: backendView.u,
        v: backendView.v,
        lines,
        circles,
        hiddenLines,
      }
    }
    const canonicalView = rawView as M2DrawingVectorView
    return {
      id: canonicalView.id,
      title: canonicalView.title ?? DEFAULT_VIEW_TITLES[canonicalView.id],
      size: canonicalView.size,
      u: canonicalView.u,
      v: canonicalView.v,
      lines: canonicalView.lines ?? [],
      circles: canonicalView.circles ?? [],
      hiddenLines: canonicalView.hiddenLines ?? [],
    }
  })

  const annotations: M2DrawingVectorAnnotationAnchor[] | undefined = input.annotations
    ? input.annotations.map((rawAnn) => {
        if ('id' in rawAnn) {
          const backendAnn = rawAnn as M2BackendDrawingAnnotation
          return {
            annotationId: backendAnn.id,
            view: backendAnn.view,
            side: backendAnn.side,
            lane: backendAnn.lane,
            label: backendAnn.id,
            valueMm: backendAnn.valueMm,
            valueText: formatBackendAnnotationValue(
              backendAnn.id,
              backendAnn.valueMm,
              unit,
              displayDecimals,
            ),
            witnesses: backendAnn.witnesses,
            linkedFeatureIds: backendAnn.reference?.featureId
              ? [backendAnn.reference.featureId]
              : [],
            reference: backendAnn.reference,
          }
        }
        return rawAnn
      })
    : undefined

  return {
    unit,
    revision: input.revision,
    displayDecimals,
    convention: input.convention,
    views,
    annotations,
  }
}

export function createInitialM2CanvasState(params: {
  readonly projectId: string
  readonly initialDraftRevision: string | null
  readonly initialBaseRevision: string | null
  readonly initialPreviewSnapshot?: Partial<M2PreviewSnapshot>
  readonly initialSelectedObjectId?: string | null
  readonly initialViewMode?: M2ViewMode
}): M2CanvasState {
  const snap = params.initialPreviewSnapshot
  const currentRevision =
    snap?.currentRevision !== undefined
      ? snap.currentRevision
      : params.initialDraftRevision ?? params.initialBaseRevision
  const currentRevisionOrder = parseRevisionOrder(
    currentRevision,
    snap?.currentRevisionOrder ?? null,
  )

  // F08: Never synthesize ready status or fingerprints when no artifact snapshot was provided.
  const model: M2ArtifactSlotState = snap?.model ?? {
    status: 'empty',
    revision: null,
    revisionOrder: null,
    isDraft: false,
    fingerprint: null,
    summary: null,
  }

  const drawing: M2ArtifactSlotState = snap?.drawing ?? {
    status: 'empty',
    revision: null,
    revisionOrder: null,
    isDraft: false,
    fingerprint: null,
    summary: null,
  }

  const aligned = areArtifactsRevisionAligned(model, drawing)
  const initialViewMode: M2ViewMode =
    params.initialViewMode ??
    (aligned ? 'split' : model.status === 'ready' ? 'model' : 'model')

  const features = snap?.features ?? DEFAULT_M2_FEATURES
  const selectedObjectId =
    params.initialSelectedObjectId !== undefined
      ? params.initialSelectedObjectId
      : features[0]?.objectId ?? null

  const annotations = snap?.annotations ?? DEFAULT_M2_ANNOTATIONS
  const annotationsByRevision: Record<string, readonly M2DrawingAnnotationItem[]> = {}
  if (drawing.revision) {
    annotationsByRevision[drawing.revision] = annotations
  }

  const modelMesh = normalizeM2ModelMesh(snap?.modelMesh)
  const drawingVector = normalizeM2DrawingVector(snap?.drawingVector)
  const drawingVectorByRevision: Record<string, M2DrawingVector | null> = {}
  if (drawing.revision && drawingVector) {
    drawingVectorByRevision[drawing.revision] = drawingVector
  }

  const checks = snap?.checks ?? DEFAULT_M2_CHECKS
  const checksInProgress =
    snap?.checksInProgress ?? checks.some((item) => item.status === 'checking')

  return {
    projectId: params.projectId,
    currentRevision,
    currentRevisionOrder,
    viewMode: initialViewMode,
    lastSingleTab: initialViewMode === 'drawing' ? 'drawing' : 'model',
    hasSeenRebuildableDraft: model.status === 'ready' && model.isDraft,
    model,
    drawing,
    drawingFailure: snap?.drawingFailure ?? null,
    drawingFailureGeneration: snap?.drawingFailure ? 1 : 0,
    drawingStateGeneration: snap?.drawingFailure || drawing.status === 'ready' ? 1 : 0,
    checksInProgress,
    taskCompleted: false,
    features,
    annotations,
    annotationsByRevision,
    modelMesh,
    drawingVector,
    drawingVectorByRevision,
    requirements: snap?.requirements ?? DEFAULT_M2_REQUIREMENTS,
    checks,
    history: snap?.history ?? [],
    lastEventSequence: 0,
    revisionSequences: {},
    selectedObjectId,
    selectedAnnotationId: null,
    selectionInvalidated: false,
    invalidatedObjectLabel: null,
    camera: DEFAULT_M2_CAMERA,
    drawingViewport: DEFAULT_M2_DRAWING_VIEWPORT,
  }
}

function isEventOlderThanCurrent(
  state: M2CanvasState,
  incomingRevision: string,
  incomingOrder: number | null,
): boolean {
  if (state.currentRevisionOrder !== null && incomingOrder !== null) {
    return incomingOrder < state.currentRevisionOrder
  }
  return (
    state.currentRevision !== null &&
    state.currentRevision !== incomingRevision &&
    incomingOrder !== null &&
    state.currentRevisionOrder !== null &&
    incomingOrder < state.currentRevisionOrder
  )
}

function validateSelectionAfterRefresh(
  state: M2CanvasState,
  nextFeatures: readonly M2ModelFeatureItem[],
  nextAnnotations: readonly M2DrawingAnnotationItem[],
  featuresUpdated: boolean,
  annotationsUpdated: boolean,
): {
  readonly selectedObjectId: string | null
  readonly selectedAnnotationId: string | null
  readonly selectionInvalidated: boolean
  readonly invalidatedObjectLabel: string | null
} {
  let nextSelectedObjectId = state.selectedObjectId
  let nextSelectedAnnotationId = state.selectedAnnotationId
  // F07: Never silently clear an existing selectionInvalidated flag on subsequent events.
  let nextSelectionInvalidated = state.selectionInvalidated
  let nextInvalidatedLabel = state.invalidatedObjectLabel

  if (featuresUpdated && state.selectedObjectId) {
    const prevFeature = state.features.find((f) => f.objectId === state.selectedObjectId)
    // F07 / A12: Match strictly by objectId; NEVER silently rebind to a different objectId via featureRef.
    const stillExists = nextFeatures.some((f) => f.objectId === state.selectedObjectId)
    if (!stillExists) {
      nextSelectedObjectId = null
      nextSelectionInvalidated = true
      nextInvalidatedLabel = prevFeature?.breadcrumb ?? state.selectedObjectId
    }
  }

  if (annotationsUpdated && state.selectedAnnotationId) {
    const prevAnnotation = state.annotations.find(
      (a) => a.annotationId === state.selectedAnnotationId,
    )
    const annotationStillExists = nextAnnotations.some(
      (a) => a.annotationId === state.selectedAnnotationId,
    )
    if (!annotationStillExists) {
      nextSelectedAnnotationId = null
      nextSelectionInvalidated = true
      const annLabel = prevAnnotation?.label ?? state.selectedAnnotationId
      nextInvalidatedLabel =
        nextInvalidatedLabel && nextInvalidatedLabel !== annLabel
          ? `${nextInvalidatedLabel}、${annLabel}`
          : annLabel
    }
  }

  return {
    selectedObjectId: nextSelectedObjectId,
    selectedAnnotationId: nextSelectedAnnotationId,
    selectionInvalidated: nextSelectionInvalidated,
    invalidatedObjectLabel: nextInvalidatedLabel,
  }
}

function resolveSlotFingerprint(
  incomingFingerprint: string | null | undefined,
  prevSlot: M2ArtifactSlotState,
  incomingRevision: string,
): string | null {
  const normalized = incomingFingerprint?.trim() ?? ''
  if (normalized) {
    return normalized
  }
  // E1: Same revision may retain its existing non-empty fingerprint when omitted;
  // cross-revision MUST NEVER inherit the previous revision's fingerprint.
  if (prevSlot.revision === incomingRevision) {
    return prevSlot.fingerprint?.trim() || null
  }
  return null
}

function isOpaqueUnorderedRevision(
  state: M2CanvasState,
  incomingRevision: string,
  incomingOrder: number | null,
): boolean {
  return (
    state.currentRevision !== null &&
    incomingRevision !== state.currentRevision &&
    incomingOrder === null
  )
}

function isSameOrderRevisionCollision(
  state: M2CanvasState,
  incomingRevision: string,
  incomingOrder: number | null,
): boolean {
  return (
    state.currentRevision !== null &&
    state.currentRevisionOrder !== null &&
    incomingOrder !== null &&
    incomingRevision !== state.currentRevision &&
    incomingOrder === state.currentRevisionOrder
  )
}

/**
 * Pure reducer for M2 preview stream events:
 * - Enforces per-revision sequence deduplication and project scoping (F06).
 * - Enforces out-of-order / late artifact guard (older revision events only enter history
 *   and never advance the watermark blocking current/newer revision events).
 * - E7: Fail-closed rejection of opaque revisions lacking numeric suffix and explicit revisionOrder
 *   when a currentRevision already exists (archived in history, never overwrites canvas or watermarks).
 * - E1: Never inherits previous revision fingerprint or previous revision checks across revisions.
 * - E2: Never falls back to previous revision annotations when new revision drawing_ready omits annotations.
 * - Isolates displayed drawing annotations by drawing revision (F06).
 * - Preserves viewMode, camera, drawingViewport, and valid selection across continuous refreshes;
 *   flags invalidated feature/annotation selection without silent featureRef rebinding or early reset (F07).
 * - Implements A08 / A11 auto-display rules & natural completion linkage (F11 / E3 / E4).
 */
export function reduceM2PreviewEvent(
  state: M2CanvasState,
  event: M2PreviewEvent,
): M2CanvasState {
  if (event.projectId !== state.projectId) {
    return state
  }

  const incomingOrder = parseRevisionOrder(event.revision, event.revisionOrder)
  const incomingIsDraft = event.isDraft ?? /^draft/i.test(event.revision)

  // E7: Fail-closed guard for opaque revision without numeric suffix or explicit revisionOrder.
  // Must not overwrite current canvas, advance currentRevision, or pollute sequence watermarks.
  if (isOpaqueUnorderedRevision(state, event.revision, incomingOrder)) {
    const opaqueId = `hist-opaque-${event.sequence}-${event.revision}`
    if (state.history.some((item) => item.id === opaqueId)) {
      return state
    }
    const entryKind: M2HistoryEntry['kind'] =
      event.type === 'drawing_ready' || event.type === 'drawing_failed'
        ? 'drawing'
        : event.type === 'checks_updated'
          ? 'checks'
          : 'model'
    const opaqueEntry: M2HistoryEntry = {
      id: opaqueId,
      sequence: event.sequence,
      revision: event.revision,
      kind: entryKind,
      status: 'stale_late',
      title: `不透明修订 ${event.revision} 无法判定顺序（已拒绝覆盖当前视图）`,
      detail: `当前展示为 ${formatRevisionDisplay(state.currentRevision)}，事件修订「${event.revision}」无数值后缀且缺少显式 revisionOrder，已按 fail-closed 原则仅归档历史。`,
      isLateStale: true,
    }
    return {
      ...state,
      history: [opaqueEntry, ...state.history],
    }
  }

  // N3: Fail-closed guard for same revisionOrder collision with a different revision ID
  // (e.g. currentRevision='draft-7' vs incoming='branch-7' both resolving to order 7).
  if (isSameOrderRevisionCollision(state, event.revision, incomingOrder)) {
    const collisionId = `hist-collision-${event.sequence}-${event.revision}`
    if (state.history.some((item) => item.id === collisionId)) {
      return state
    }
    const entryKind: M2HistoryEntry['kind'] =
      event.type === 'drawing_ready' || event.type === 'drawing_failed'
        ? 'drawing'
        : event.type === 'checks_updated'
          ? 'checks'
          : 'model'
    const collisionEntry: M2HistoryEntry = {
      id: collisionId,
      sequence: event.sequence,
      revision: event.revision,
      kind: entryKind,
      status: 'stale_late',
      title: `同序号不同修订 ${event.revision} 冲突（已拒绝覆盖当前视图）`,
      detail: `当前展示为 ${formatRevisionDisplay(state.currentRevision)}（序号 ${state.currentRevisionOrder}），事件修订「${event.revision}」具有相同序号 ${incomingOrder} 但标识不同，已按 fail-closed 原则仅归档历史。`,
      isLateStale: true,
    }
    return {
      ...state,
      history: [collisionEntry, ...state.history],
    }
  }

  const prevSeqForRev = state.revisionSequences[event.revision] ?? 0
  if (event.sequence <= prevSeqForRev) {
    return state
  }

  const nextRevisionSequences: Readonly<Record<string, number>> = {
    ...state.revisionSequences,
    [event.revision]: event.sequence,
  }

  // Out-of-order / late artifact guard: older revision events only enter history
  // and MUST NOT advance lastEventSequence for current/newer revisions (F06).
  if (isEventOlderThanCurrent(state, event.revision, incomingOrder)) {
    const kindLabel =
      event.type === 'drawing_ready' || event.type === 'drawing_failed'
        ? '图纸'
        : event.type === 'checks_updated'
          ? '检查'
          : event.type === 'task_completed'
            ? '完成信号'
            : '模型'
    const entryKind: M2HistoryEntry['kind'] =
      event.type === 'drawing_ready' || event.type === 'drawing_failed'
        ? 'drawing'
        : event.type === 'checks_updated'
          ? 'checks'
          : 'model'
    const lateEntry: M2HistoryEntry = {
      id: `hist-late-${event.sequence}-${event.revision}`,
      sequence: event.sequence,
      revision: event.revision,
      kind: entryKind,
      status: 'stale_late',
      title: `${formatRevisionDisplay(event.revision)} 迟到${kindLabel}事件（已归档历史）`,
      detail: `当前展示为较新修订 ${formatRevisionDisplay(state.currentRevision)}，旧修订 ${formatRevisionDisplay(event.revision)} 的迟到事件未覆盖当前视图。`,
      isLateStale: true,
    }
    return {
      ...state,
      revisionSequences: nextRevisionSequences,
      history: [lateEntry, ...state.history],
    }
  }

  const baseNext: M2CanvasState = {
    ...state,
    lastEventSequence: Math.max(state.lastEventSequence, event.sequence),
    revisionSequences: nextRevisionSequences,
  }

  const isRevisionChanged = event.revision !== state.currentRevision
  const nextCurrentRevision = event.revision
  const nextCurrentOrder = incomingOrder ?? state.currentRevisionOrder
  const nextFeatures = event.features ?? state.features
  const nextRequirements = event.requirements ?? state.requirements
  // E1: When advancing to a new revision and `checks` is omitted, NEVER inherit old revision checks.
  const nextChecks = event.checks !== undefined ? event.checks : isRevisionChanged ? [] : state.checks
  // N1: When a same-revision event omits both `checks` and `checksInProgress`, preserve existing
  // `state.checksInProgress` so formal commit remains blocked until checks explicitly finish.
  const nextChecksInProgress =
    event.checksInProgress !== undefined
      ? event.checksInProgress
      : event.checks !== undefined
        ? nextChecks.some((c) => c.status === 'checking')
        : isRevisionChanged
          ? false
          : state.checksInProgress || nextChecks.some((c) => c.status === 'checking')

  const nextAnnotationsByRevision: Readonly<Record<string, readonly M2DrawingAnnotationItem[]>> =
    event.annotations !== undefined
      ? { ...state.annotationsByRevision, [event.revision]: event.annotations }
      : state.annotationsByRevision

  const incomingModelMesh =
    event.modelMesh !== undefined ? normalizeM2ModelMesh(event.modelMesh) : undefined
  const nextModelMesh = incomingModelMesh !== undefined ? incomingModelMesh : state.modelMesh

  const incomingDrawingVector =
    event.drawingVector !== undefined ? normalizeM2DrawingVector(event.drawingVector) : undefined
  const nextDrawingVectorByRevision: Readonly<Record<string, M2DrawingVector | null>> =
    incomingDrawingVector !== undefined
      ? { ...state.drawingVectorByRevision, [event.revision]: incomingDrawingVector }
      : state.drawingVectorByRevision

  let nextModel = state.model
  let nextDrawing = state.drawing
  let nextDrawingFailure = state.drawingFailure
  let nextDrawingFailureGeneration = state.drawingFailureGeneration
  let nextDrawingStateGeneration = state.drawingStateGeneration
  let nextViewMode = state.viewMode
  let nextHasSeenDraft = state.hasSeenRebuildableDraft
  let nextTaskCompleted =
    event.type === 'task_completed' || event.taskCompleted === true
      ? true
      : isRevisionChanged
        ? false
        : state.taskCompleted
  let historyEntry: M2HistoryEntry | null = null

  if (event.type === 'model_ready') {
    nextModel = {
      status: 'ready',
      revision: event.revision,
      revisionOrder: incomingOrder,
      isDraft: incomingIsDraft,
      fingerprint: resolveSlotFingerprint(event.fingerprint, state.model, event.revision),
      summary: event.summary ?? '3D 模型已更新',
    }
    // First rebuildable draft -> auto switch to 3D (model) view and mark as draft
    if (incomingIsDraft && !state.hasSeenRebuildableDraft) {
      nextHasSeenDraft = true
      nextViewMode = 'model'
    }
    // If model & drawing are now revision-aligned and no same-revision drawing failure -> auto switch to split view
    const hasSameRevFailure =
      nextDrawingFailure !== null && nextDrawingFailure.failedRevision === event.revision
    if (!hasSameRevFailure && areArtifactsRevisionAligned(nextModel, nextDrawing)) {
      nextViewMode = 'split'
      nextDrawingFailure = null
    }
    historyEntry = {
      id: `hist-model-${event.sequence}`,
      sequence: event.sequence,
      revision: event.revision,
      kind: 'model',
      status: 'ready',
      title: `${formatRevisionDisplay(event.revision)} 模型已生成`,
      detail: event.summary ?? '三维实体与特征映射已刷新。',
    }
  } else if (event.type === 'drawing_ready') {
    nextDrawingStateGeneration = state.drawingStateGeneration + 1
    nextDrawing = {
      status: 'ready',
      revision: event.revision,
      revisionOrder: incomingOrder,
      isDraft: incomingIsDraft,
      fingerprint: resolveSlotFingerprint(event.fingerprint, state.drawing, event.revision),
      summary: event.summary ?? '二维图纸与标注已更新',
    }
    nextDrawingFailure = null
    if (areArtifactsRevisionAligned(nextModel, nextDrawing)) {
      nextViewMode = 'split'
    }
    historyEntry = {
      id: `hist-drawing-${event.sequence}`,
      sequence: event.sequence,
      revision: event.revision,
      kind: 'drawing',
      status: 'ready',
      title: `${formatRevisionDisplay(event.revision)} 图纸已生成`,
      detail: event.summary ?? '二维工程图投影与尺寸标注已刷新。',
    }
  } else if (event.type === 'drawing_failed') {
    // Keep previous valid drawing if present; record partial failure for current revision
    nextDrawingFailureGeneration = state.drawingFailureGeneration + 1
    nextDrawingStateGeneration = state.drawingStateGeneration + 1
    nextDrawingFailure = {
      failedRevision: event.revision,
      failedRevisionOrder: incomingOrder,
      reason: event.errorReason ?? '二维投影或标注生成失败',
      retryable: event.retryable ?? true,
    }
    historyEntry = {
      id: `hist-drawing-fail-${event.sequence}`,
      sequence: event.sequence,
      revision: event.revision,
      kind: 'drawing',
      status: 'failed',
      title: `${formatRevisionDisplay(event.revision)} 图纸生成失败`,
      detail: event.errorReason ?? '保留上一有效图纸版本，可点击「重试图纸」。',
    }
  } else if (event.type === 'checks_updated') {
    historyEntry = {
      id: `hist-checks-${event.sequence}`,
      sequence: event.sequence,
      revision: event.revision,
      kind: 'checks',
      status: 'ready',
      title: `${formatRevisionDisplay(event.revision)} 检查结果更新`,
      detail: nextChecksInProgress
        ? '部分条款仍在检查中。'
        : `共 ${nextChecks.length} 项条款已更新。`,
    }
  } else if (event.type === 'revision_refreshed') {
    nextModel = {
      status: 'ready',
      revision: event.revision,
      revisionOrder: incomingOrder,
      isDraft: incomingIsDraft,
      fingerprint: resolveSlotFingerprint(event.fingerprint, state.model, event.revision),
      summary: event.summary ?? '连续修改已刷新模型',
    }
    if (incomingIsDraft && !state.hasSeenRebuildableDraft) {
      nextHasSeenDraft = true
      nextViewMode = 'model'
    }
    historyEntry = {
      id: `hist-refresh-${event.sequence}`,
      sequence: event.sequence,
      revision: event.revision,
      kind: 'revision',
      status: 'ready',
      title: `${formatRevisionDisplay(event.revision)} 连续修改刷新`,
      detail: '已尝试保留视图模式、视角缩放与有效选择。',
    }
  } else if (event.type === 'task_completed') {
    nextTaskCompleted = true
    historyEntry = {
      id: `hist-complete-${event.sequence}`,
      sequence: event.sequence,
      revision: event.revision,
      kind: 'revision',
      status: 'ready',
      title: `${formatRevisionDisplay(event.revision)} 任务自然完成`,
      detail: event.summary ?? '模型、图纸与检查结果已归集，等待人工复核确认后方可提交正式版本。',
    }
  }

  // F06 / E2: Isolate displayed drawing annotations by drawing revision.
  // When drawing_ready arrives for a new revision without annotations and without a cached entry
  // in annotationsByRevision, NEVER fall back to the previous revision's annotations (set to []).
  let nextAnnotations = state.annotations
  if (event.type === 'drawing_ready') {
    const isSameDrawingRevision = state.drawing.revision === event.revision
    nextAnnotations =
      event.annotations ??
      nextAnnotationsByRevision[event.revision] ??
      (isSameDrawingRevision ? state.annotations : [])
  } else if (event.annotations !== undefined) {
    const drawingShowsDifferentRevision =
      nextDrawing.status === 'ready' &&
      nextDrawing.revision !== null &&
      nextDrawing.revision !== event.revision
    if (!drawingShowsDifferentRevision) {
      nextAnnotations = event.annotations
    }
  }

  // F06 / E2: Isolate displayed drawingVector by drawing revision.
  // Preserving draft-7 old drawing while receiving draft-8 model event NEVER overwrites or clears
  // draft-7 drawingVector; draft-8 drawing_ready omitting drawingVector without draft-8 cache
  // NEVER falls back to draft-7 drawingVector (set to null).
  let nextDrawingVector = state.drawingVector
  if (event.type === 'drawing_ready') {
    const isSameDrawingRevision = state.drawing.revision === event.revision
    if (incomingDrawingVector !== undefined) {
      nextDrawingVector = incomingDrawingVector
    } else if (Object.prototype.hasOwnProperty.call(nextDrawingVectorByRevision, event.revision)) {
      nextDrawingVector = nextDrawingVectorByRevision[event.revision] ?? null
    } else {
      nextDrawingVector = isSameDrawingRevision ? state.drawingVector : null
    }
  } else if (incomingDrawingVector !== undefined) {
    const drawingShowsDifferentRevision =
      nextDrawing.status === 'ready' &&
      nextDrawing.revision !== null &&
      nextDrawing.revision !== event.revision
    if (!drawingShowsDifferentRevision) {
      nextDrawingVector = incomingDrawingVector
    }
  }

  const selectionUpdate = validateSelectionAfterRefresh(
    state,
    nextFeatures,
    nextAnnotations,
    event.features !== undefined,
    nextAnnotations !== state.annotations ||
      event.type === 'drawing_ready' ||
      event.annotations !== undefined,
  )

  if (event.type === 'revision_refreshed' && historyEntry) {
    historyEntry = {
      ...historyEntry,
      detail: selectionUpdate.selectionInvalidated
        ? '已保留视图模式与视角状态；原选中对象已失效。'
        : '已保留视图模式、视角缩放与有效选择。',
    }
  }

  // F11: Natural completion linkage -> auto-display side-by-side view when model + drawing + checks
  // are all aligned for the current revision and checks are finished (never auto-commits).
  const naturalSummary = computeNaturalCompletionSummary({
    model: nextModel,
    drawing: nextDrawing,
    drawingFailure: nextDrawingFailure,
    checksInProgress: nextChecksInProgress,
    taskCompleted: nextTaskCompleted,
    requirements: nextRequirements,
    checks: nextChecks,
  })
  if (naturalSummary) {
    nextViewMode = 'split'
  }

  return {
    ...baseNext,
    currentRevision: nextCurrentRevision,
    currentRevisionOrder: nextCurrentOrder,
    viewMode: nextViewMode,
    hasSeenRebuildableDraft: nextHasSeenDraft,
    model: nextModel,
    drawing: nextDrawing,
    drawingFailure: nextDrawingFailure,
    drawingFailureGeneration: nextDrawingFailureGeneration,
    drawingStateGeneration: nextDrawingStateGeneration,
    checksInProgress: nextChecksInProgress,
    taskCompleted: nextTaskCompleted,
    features: nextFeatures,
    annotations: nextAnnotations,
    annotationsByRevision: nextAnnotationsByRevision,
    modelMesh: nextModelMesh,
    drawingVector: nextDrawingVector,
    drawingVectorByRevision: nextDrawingVectorByRevision,
    requirements: nextRequirements,
    checks: nextChecks,
    history: historyEntry ? [historyEntry, ...state.history] : state.history,
    selectedObjectId: selectionUpdate.selectedObjectId,
    selectedAnnotationId: selectionUpdate.selectedAnnotationId,
    selectionInvalidated: selectionUpdate.selectionInvalidated,
    invalidatedObjectLabel: selectionUpdate.invalidatedObjectLabel,
  }
}

export type M2DrawingRetryRejectionReason =
  | 'project_mismatch'
  | 'drawing_failure_generation_mismatch'
  | 'drawing_state_generation_mismatch'
  | 'stale_revision'
  | 'opaque_revision'
  | 'revision_order_collision'

export interface M2ApplyDrawingRetryResultStatus {
  readonly state: M2CanvasState
  readonly applied: boolean
  readonly rejectedReason?: M2DrawingRetryRejectionReason
}

/**
 * S5 / N2 / P1-4 / R-C: Apply a local drawing retry result directly to the drawing slot, annotations,
 * and history WITHOUT advancing `revisionSequences` or `lastEventSequence`, returning explicit
 * acceptance status `{ state, applied, rejectedReason? }` so callers never report false success
 * when a late older-revision retry is rejected.
 */
export function applyM2DrawingRetryResultWithStatus(
  state: M2CanvasState,
  result: M2RetryDrawingResult,
  options?: {
    readonly expectedDrawingFailureGeneration?: number
    readonly expectedDrawingStateGeneration?: number
  },
): M2ApplyDrawingRetryResultStatus {
  if (result.projectId !== state.projectId) {
    return { state, applied: false, rejectedReason: 'project_mismatch' }
  }
  // N2 / P1-4: If a newer drawing_failed or drawing_ready occurred while this retry was in flight, strictly discard.
  if (
    options?.expectedDrawingFailureGeneration !== undefined &&
    state.drawingFailureGeneration !== options.expectedDrawingFailureGeneration
  ) {
    return { state, applied: false, rejectedReason: 'drawing_failure_generation_mismatch' }
  }
  if (
    options?.expectedDrawingStateGeneration !== undefined &&
    state.drawingStateGeneration !== options.expectedDrawingStateGeneration
  ) {
    return { state, applied: false, rejectedReason: 'drawing_state_generation_mismatch' }
  }
  const incomingOrder = parseRevisionOrder(result.revision, result.revisionOrder)
  if (isEventOlderThanCurrent(state, result.revision, incomingOrder)) {
    return { state, applied: false, rejectedReason: 'stale_revision' }
  }
  if (isOpaqueUnorderedRevision(state, result.revision, incomingOrder)) {
    return { state, applied: false, rejectedReason: 'opaque_revision' }
  }
  if (isSameOrderRevisionCollision(state, result.revision, incomingOrder)) {
    return { state, applied: false, rejectedReason: 'revision_order_collision' }
  }

  const incomingIsDraft = /^draft/i.test(result.revision)
  const nextDrawing: M2ArtifactSlotState = {
    status: 'ready',
    revision: result.revision,
    revisionOrder: incomingOrder,
    isDraft: incomingIsDraft,
    fingerprint: resolveSlotFingerprint(result.fingerprint, state.drawing, result.revision),
    summary: result.summary ?? '重试图纸成功',
  }

  const nextAnnotationsByRevision: Readonly<Record<string, readonly M2DrawingAnnotationItem[]>> =
    result.annotations !== undefined
      ? { ...state.annotationsByRevision, [result.revision]: result.annotations }
      : state.annotationsByRevision

  const isSameDrawingRevision = state.drawing.revision === result.revision
  const nextAnnotations =
    result.annotations ??
    nextAnnotationsByRevision[result.revision] ??
    (isSameDrawingRevision ? state.annotations : [])

  const incomingRetryDrawingVector =
    result.drawingVector !== undefined ? normalizeM2DrawingVector(result.drawingVector) : undefined
  const nextDrawingVectorByRevision: Readonly<Record<string, M2DrawingVector | null>> =
    incomingRetryDrawingVector !== undefined
      ? { ...state.drawingVectorByRevision, [result.revision]: incomingRetryDrawingVector }
      : state.drawingVectorByRevision
  const nextDrawingVector =
    incomingRetryDrawingVector !== undefined
      ? incomingRetryDrawingVector
      : Object.prototype.hasOwnProperty.call(nextDrawingVectorByRevision, result.revision)
        ? (nextDrawingVectorByRevision[result.revision] ?? null)
        : isSameDrawingRevision
          ? state.drawingVector
          : null

  const selectionUpdate = validateSelectionAfterRefresh(
    state,
    state.features,
    nextAnnotations,
    false,
    true,
  )

  const nextDrawingFailure =
    state.drawingFailure && state.drawingFailure.failedRevision === result.revision
      ? null
      : state.drawingFailure

  let nextViewMode = state.viewMode
  if (!nextDrawingFailure && areArtifactsRevisionAligned(state.model, nextDrawing)) {
    nextViewMode = 'split'
  }

  const naturalSummary = computeNaturalCompletionSummary({
    model: state.model,
    drawing: nextDrawing,
    drawingFailure: nextDrawingFailure,
    checksInProgress: state.checksInProgress,
    taskCompleted: state.taskCompleted,
    requirements: state.requirements,
    checks: state.checks,
  })
  if (naturalSummary) {
    nextViewMode = 'split'
  }

  const historyEntry: M2HistoryEntry = {
    id: `hist-drawing-retry-${result.revision}-${state.history.length + 1}`,
    sequence: state.lastEventSequence,
    revision: result.revision,
    kind: 'drawing',
    status: 'ready',
    title: `${formatRevisionDisplay(result.revision)} 图纸重试已生成`,
    detail: result.summary ?? '重试图纸成功，二维工程图投影与尺寸标注已刷新。',
  }

  return {
    state: {
      ...state,
      // S5: Strictly preserve lastEventSequence & revisionSequences.
      viewMode: nextViewMode,
      drawing: nextDrawing,
      drawingFailure: nextDrawingFailure,
      drawingStateGeneration: state.drawingStateGeneration + 1,
      annotations: nextAnnotations,
      annotationsByRevision: nextAnnotationsByRevision,
      drawingVector: nextDrawingVector,
      drawingVectorByRevision: nextDrawingVectorByRevision,
      history: [historyEntry, ...state.history],
      selectedObjectId: selectionUpdate.selectedObjectId,
      selectedAnnotationId: selectionUpdate.selectedAnnotationId,
      selectionInvalidated: selectionUpdate.selectionInvalidated,
      invalidatedObjectLabel: selectionUpdate.invalidatedObjectLabel,
    },
    applied: true,
  }
}

/**
 * S5 / N2 / P1-4: Backward-compatible wrapper returning only the resulting `M2CanvasState`.
 */
export function applyM2DrawingRetryResult(
  state: M2CanvasState,
  result: M2RetryDrawingResult,
  options?: {
    readonly expectedDrawingFailureGeneration?: number
    readonly expectedDrawingStateGeneration?: number
  },
): M2CanvasState {
  return applyM2DrawingRetryResultWithStatus(state, result, options).state
}
