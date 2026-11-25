import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { ElectronTransport } from '../../../transport/electronTransport'
import {
  isScopedArtifactEventAccepted,
  type M1SelectedObjectRef,
} from '../m1WorkbenchBridge'
import {
  applyM2DrawingRetryResultWithStatus,
  computeNaturalCompletionSummary,
  createInitialM2CanvasState,
  DEFAULT_M2_FEATURES,
  formatRevisionDisplay,
  normalizeM2BridgeError,
  reduceM2PreviewEvent,
  resolveEffectiveViewMode,
  type M2CameraState,
  type M2CheckItem,
  type M2DrawingAnnotationItem,
  type M2DrawingViewportState,
  type M2EvidenceResult,
  type M2ModelFeatureItem,
  type M2PreviewEvent,
  type M2PreviewSnapshot,
  type M2RequirementItem,
  type M2SidebarSection,
  type M2ViewMode,
} from '../m2WorkbenchBridge'
import { getArtifactStatusMeta } from '../M2CenterCanvas'
import type { WorkbenchTracker } from '../workbenchHelpers'

export interface UseAssemblyViewportOptions {
  readonly transport: ElectronTransport
  readonly trackerRef: MutableRefObject<WorkbenchTracker>
  readonly projectId: string
  readonly initialBaseRevision: string | null
  readonly initialDraftRevision: string | null
  readonly initialPreviewSnapshot?: Partial<M2PreviewSnapshot>
  readonly initialViewMode?: M2ViewMode
  readonly availableObjectsProp?: readonly M1SelectedObjectRef[]
  readonly forceNarrowViewport?: boolean
  readonly scopeEpoch: number
  readonly subscriptionRetryNonce: number
  readonly allocateRequestId: (prefix: string) => string
  readonly onDraftRevisionUpdated: (nextDraftRevision: string) => void
  readonly onHasRealRequirementsContext: () => void
  readonly onDiscardedStale: () => void
  readonly onSwitchSidebarSection: (section: M2SidebarSection) => void
}

/**
 * Manages the central assembly / drawing viewport state:
 * - Multi-select `selectedObjectIds` (backward-compatible with single-select `selectedObjectId`)
 * - View mode (model / drawing / split / narrow-viewport degradation)
 * - Camera & 2D drawing viewport transforms
 * - Reserved M1B 3D assembly viewport controls (`explosionFactor`, `xrayMode`)
 * - M2 real-time preview event subscription & reducer (via `Transport`, no direct preload global access)
 * - Evidence localization, drawing retry, and clarification submission
 */
export function useAssemblyViewport({
  transport,
  trackerRef,
  projectId,
  initialBaseRevision,
  initialDraftRevision,
  initialPreviewSnapshot,
  initialViewMode,
  availableObjectsProp,
  forceNarrowViewport,
  scopeEpoch,
  subscriptionRetryNonce,
  allocateRequestId,
  onDraftRevisionUpdated,
  onHasRealRequirementsContext,
  onDiscardedStale,
  onSwitchSidebarSection,
}: UseAssemblyViewportOptions) {
  const hasRealChatBridge = transport.probes.m1.capabilities.builtinChat

  // Narrow viewport tracking for automatic split -> tab degradation
  const [windowNarrow, setWindowNarrow] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 960 : false,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || forceNarrowViewport !== undefined) return
    const handleResize = () => {
      setWindowNarrow(window.innerWidth <= 960)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [forceNarrowViewport])
  const isNarrow = forceNarrowViewport !== undefined ? forceNarrowViewport : windowNarrow

  const resolvedInitialFeatures: readonly M2ModelFeatureItem[] =
    initialPreviewSnapshot?.features ??
    (availableObjectsProp !== undefined
      ? availableObjectsProp.map((obj) => ({
          ...obj,
          partName: obj.breadcrumb.split('›')[0]?.trim() || '零件',
          role: obj.breadcrumb.split('›').slice(1).join('›').trim() || obj.featureRef,
          kind: 'other' as const,
          linkedAnnotationIds: [],
        }))
      : !hasRealChatBridge
        ? DEFAULT_M2_FEATURES
        : [])

  const [canvasState, setCanvasState] = useState(() =>
    createInitialM2CanvasState({
      projectId,
      initialDraftRevision,
      initialBaseRevision,
      initialPreviewSnapshot: {
        ...initialPreviewSnapshot,
        features: resolvedInitialFeatures,
      },
      initialViewMode,
    }),
  )

  // Reserved M1B 3D assembly viewport states (multi-select, explosion factor, X-Ray mode)
  const [extraSelectedObjectIds, setExtraSelectedObjectIds] = useState<readonly string[]>([])
  const [explosionFactor, setExplosionFactorRaw] = useState<number>(0)
  const [xrayMode, setXrayMode] = useState<boolean>(false)
  const [structureOpen, setStructureOpen] = useState(false)

  const setExplosionFactor = useCallback((next: number) => {
    const clamped = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : 0
    setExplosionFactorRaw(clamped)
  }, [])

  const toggleXrayMode = useCallback(() => {
    setXrayMode((prev) => !prev)
  }, [])

  const selectedObjectIds: readonly string[] = useMemo(() => {
    const ids: string[] = []
    if (canvasState.selectedObjectId) {
      ids.push(canvasState.selectedObjectId)
    }
    for (const id of extraSelectedObjectIds) {
      if (!ids.includes(id)) ids.push(id)
    }
    return ids
  }, [canvasState.selectedObjectId, extraSelectedObjectIds])

  const [activeCheckId, setActiveCheckId] = useState<string | null>(null)
  const [activeEvidence, setActiveEvidence] = useState<M2EvidenceResult | null>(null)
  const [evidenceLoading, setEvidenceLoading] = useState(false)
  const [evidenceNotice, setEvidenceNotice] = useState<string | null>(null)
  const [evidenceHighlightFeatures, setEvidenceHighlightFeatures] = useState<readonly string[]>([])
  const [evidenceHighlightAnnotations, setEvidenceHighlightAnnotations] = useState<
    readonly string[]
  >([])
  const [retryDrawingPending, setRetryDrawingPending] = useState(false)
  const [retryDrawingFeedback, setRetryDrawingFeedback] = useState<string | null>(null)
  const [retryDrawingFailureSeq, setRetryDrawingFailureSeq] = useState(0)
  const [clarificationPendingId, setClarificationPendingId] = useState<string | null>(null)
  const [clarificationFeedback, setClarificationFeedback] = useState<
    Record<string, { readonly ok: boolean; readonly message: string }>
  >({})
  const [contextActionFeedback, setContextActionFeedback] = useState<string | null>(null)

  const canvasStateRef = useRef(canvasState)
  useEffect(() => {
    canvasStateRef.current = canvasState
    trackerRef.current.drawingFailureGeneration = canvasState.drawingFailureGeneration
    trackerRef.current.drawingStateGeneration = canvasState.drawingStateGeneration
  }, [canvasState, trackerRef])

  // Subscribe to M2 preview/artifact/check events via Transport (out-of-order / late event guard)
  useEffect(() => {
    if (!transport.probes.m2.capabilities.previewEvents) {
      return
    }
    let active = true
    let unsubscribe: (() => void) | undefined

    const handlePreviewEvent = (event: M2PreviewEvent) => {
      const tracker = trackerRef.current
      if (!active || !tracker.mounted) return
      if (!isScopedArtifactEventAccepted(tracker, event)) {
        onDiscardedStale()
        return
      }
      if (event.requirements !== undefined) {
        onHasRealRequirementsContext()
      }
      setCanvasState((prev) => {
        const next = reduceM2PreviewEvent(prev, event)
        tracker.drawingFailureGeneration = next.drawingFailureGeneration
        tracker.drawingStateGeneration = next.drawingStateGeneration
        if (next.currentRevision && next.currentRevision !== prev.currentRevision) {
          if (/^draft/i.test(next.currentRevision)) {
            onDraftRevisionUpdated(next.currentRevision)
          }
        }
        return next
      })
    }

    void transport
      .subscribePreviewEvents({ projectId }, handlePreviewEvent)
      .then((res) => {
        if (res.ok && res.value.unsubscribe) {
          if (!active) {
            res.value.unsubscribe()
          } else {
            unsubscribe = res.value.unsubscribe
          }
        }
      })
      .catch(() => {
        // Keep honest state
      })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [
    transport,
    trackerRef,
    projectId,
    scopeEpoch,
    subscriptionRetryNonce,
    onDraftRevisionUpdated,
    onHasRealRequirementsContext,
    onDiscardedStale,
  ])

  const selectedObject: M1SelectedObjectRef | null = useMemo(() => {
    if (!canvasState.selectedObjectId) return null
    const found = canvasState.features.find((f) => f.objectId === canvasState.selectedObjectId)
    if (!found) return null
    return {
      objectId: found.objectId,
      breadcrumb: found.breadcrumb,
      featureRef: found.featureRef,
    }
  }, [canvasState.features, canvasState.selectedObjectId])

  const highlightedFeatureIds = useMemo(() => {
    const ids = new Set<string>()
    for (const sid of selectedObjectIds) {
      ids.add(sid)
    }
    if (canvasState.selectedAnnotationId) {
      const ann = canvasState.annotations.find(
        (item) => item.annotationId === canvasState.selectedAnnotationId,
      )
      ann?.linkedFeatureIds.forEach((fid) => ids.add(fid))
    }
    evidenceHighlightFeatures.forEach((fid) => ids.add(fid))
    return ids
  }, [
    selectedObjectIds,
    canvasState.selectedAnnotationId,
    canvasState.annotations,
    evidenceHighlightFeatures,
  ])

  const highlightedAnnotationIds = useMemo(() => {
    const ids = new Set<string>()
    if (canvasState.selectedAnnotationId) {
      ids.add(canvasState.selectedAnnotationId)
    }
    if (canvasState.selectedObjectId) {
      const feat = canvasState.features.find(
        (item) => item.objectId === canvasState.selectedObjectId,
      )
      feat?.linkedAnnotationIds.forEach((aid) => ids.add(aid))
    }
    evidenceHighlightAnnotations.forEach((aid) => ids.add(aid))
    return ids
  }, [
    canvasState.selectedAnnotationId,
    canvasState.selectedObjectId,
    canvasState.features,
    evidenceHighlightAnnotations,
  ])

  const handleChangeViewMode = useCallback((mode: M2ViewMode) => {
    setCanvasState((prev) => ({
      ...prev,
      viewMode: mode,
      lastSingleTab: mode === 'model' || mode === 'drawing' ? mode : prev.lastSingleTab,
    }))
  }, [])

  const handleSelectFeature = useCallback(
    (feature: M2ModelFeatureItem, options?: { readonly additive?: boolean }) => {
      setEvidenceHighlightFeatures([])
      setEvidenceHighlightAnnotations([])
      setContextActionFeedback(null)
      if (options?.additive) {
        setExtraSelectedObjectIds((prev) =>
          prev.includes(feature.objectId) ? prev : [...prev, feature.objectId],
        )
        setCanvasState((prev) => ({
          ...prev,
          selectedObjectId: prev.selectedObjectId ?? feature.objectId,
          selectedAnnotationId: null,
          selectionInvalidated: false,
          invalidatedObjectLabel: null,
        }))
        return
      }
      setExtraSelectedObjectIds([])
      setCanvasState((prev) => ({
        ...prev,
        selectedObjectId: feature.objectId,
        selectedAnnotationId: null,
        selectionInvalidated: false,
        invalidatedObjectLabel: null,
      }))
    },
    [],
  )

  const handleSelectAnnotation = useCallback((annotation: M2DrawingAnnotationItem) => {
    setEvidenceHighlightFeatures([])
    setEvidenceHighlightAnnotations([])
    setContextActionFeedback(null)
    setExtraSelectedObjectIds([])
    setCanvasState((prev) => ({
      ...prev,
      selectedAnnotationId: annotation.annotationId,
      selectedObjectId: annotation.linkedFeatureIds[0] ?? prev.selectedObjectId,
      selectionInvalidated: false,
      invalidatedObjectLabel: null,
    }))
  }, [])

  const handleClearSelection = useCallback(() => {
    setEvidenceHighlightFeatures([])
    setEvidenceHighlightAnnotations([])
    setExtraSelectedObjectIds([])
    setActiveCheckId(null)
    setContextActionFeedback('已取消当前几何对象选择。')
    setCanvasState((prev) => ({
      ...prev,
      selectedObjectId: null,
      selectedAnnotationId: null,
      selectionInvalidated: false,
      invalidatedObjectLabel: null,
    }))
  }, [])

  const updateCamera = useCallback((updater: (prev: M2CameraState) => M2CameraState) => {
    setCanvasState((prev) => ({ ...prev, camera: updater(prev.camera) }))
  }, [])

  const updateDrawingViewport = useCallback(
    (updater: (prev: M2DrawingViewportState) => M2DrawingViewportState) => {
      setCanvasState((prev) => ({
        ...prev,
        drawingViewport: updater(prev.drawingViewport),
      }))
    },
    [],
  )

  const handleRetryDrawing = async (): Promise<void> => {
    const failedRev = canvasState.drawingFailure?.failedRevision ?? canvasState.currentRevision
    if (!failedRev) return
    setRetryDrawingFeedback(null)
    if (!transport.probes.m2.capabilities.retryDrawing) {
      setRetryDrawingFeedback(
        '后端尚未接线/不可用（缺失方法：retryM2Drawing），无法重试图纸生成。',
      )
      return
    }
    const tracker = trackerRef.current
    const capturedProjectId = tracker.projectId
    const capturedSwitchEpoch = tracker.switchProjectEpoch
    const capturedScopeEpoch = tracker.scopeEpoch
    const expectedDrawingFailureGeneration = Math.max(
      tracker.drawingFailureGeneration,
      canvasState.drawingFailureGeneration,
    )
    const expectedDrawingStateGeneration = Math.max(
      tracker.drawingStateGeneration,
      canvasState.drawingStateGeneration,
    )
    tracker.retryDrawingEpoch += 1
    const capturedRetryEpoch = tracker.retryDrawingEpoch
    const requestId = allocateRequestId('retry-drawing')
    setRetryDrawingPending(true)
    let result
    try {
      result = await transport.retryDrawing({
        projectId: capturedProjectId,
        revision: failedRev,
        requestId,
      })
    } catch (err) {
      result = {
        ok: false as const,
        error: normalizeM2BridgeError(err, '重试图纸异常'),
      }
    }
    if (
      !tracker.mounted ||
      tracker.projectId !== capturedProjectId ||
      tracker.switchProjectEpoch !== capturedSwitchEpoch ||
      tracker.scopeEpoch !== capturedScopeEpoch ||
      tracker.retryDrawingEpoch !== capturedRetryEpoch
    ) {
      if (tracker.mounted && tracker.retryDrawingEpoch === capturedRetryEpoch) {
        setRetryDrawingPending(false)
      }
      onDiscardedStale()
      return
    }
    setRetryDrawingPending(false)
    if (!result.ok) {
      setRetryDrawingFeedback(`重试图纸失败（${result.error.code}）：${result.error.message}`)
      setRetryDrawingFailureSeq((seq) => seq + 1)
      return
    }
    if (
      result.value.projectId !== tracker.projectId ||
      tracker.drawingFailureGeneration !== expectedDrawingFailureGeneration ||
      tracker.drawingStateGeneration !== expectedDrawingStateGeneration
    ) {
      onDiscardedStale()
      return
    }
    const formatStaleRetryNotice = (currentRevision: string | null): string => {
      const currentLabel = currentRevision ? `（${formatRevisionDisplay(currentRevision)}）` : ''
      return `旧修订（${formatRevisionDisplay(result.value.revision)}）的图纸重试结果已过期丢弃，当前已推进至新修订${currentLabel}。`
    }

    const preCheckOutcome = applyM2DrawingRetryResultWithStatus(
      canvasStateRef.current,
      result.value,
      {
        expectedDrawingFailureGeneration,
        expectedDrawingStateGeneration,
      },
    )
    if (!preCheckOutcome.applied) {
      onDiscardedStale()
      setRetryDrawingFeedback(formatStaleRetryNotice(canvasStateRef.current.currentRevision))
      return
    }

    setCanvasState((prev) => {
      const outcome = applyM2DrawingRetryResultWithStatus(prev, result.value, {
        expectedDrawingFailureGeneration,
        expectedDrawingStateGeneration,
      })
      tracker.drawingFailureGeneration = outcome.state.drawingFailureGeneration
      tracker.drawingStateGeneration = outcome.state.drawingStateGeneration
      if (!outcome.applied) {
        queueMicrotask(() => {
          if (!tracker.mounted) return
          onDiscardedStale()
          setRetryDrawingFeedback(formatStaleRetryNotice(prev.currentRevision))
        })
        return prev
      }
      return outcome.state
    })
    setRetryDrawingFeedback(
      `${formatRevisionDisplay(result.value.revision)} 图纸重试成功，已同步更新。`,
    )
  }

  const locateEvidenceForTarget = async (params: {
    readonly checkId?: string
    readonly requirementId: string
    readonly linkedFeatureIds: readonly string[]
    readonly linkedAnnotationIds: readonly string[]
  }): Promise<void> => {
    setEvidenceHighlightFeatures(params.linkedFeatureIds)
    setEvidenceHighlightAnnotations(params.linkedAnnotationIds)
    if (params.linkedFeatureIds.length > 0) {
      setExtraSelectedObjectIds([])
      setCanvasState((prev) => ({
        ...prev,
        selectedObjectId: params.linkedFeatureIds[0],
        selectedAnnotationId: params.linkedAnnotationIds[0] ?? null,
        selectionInvalidated: false,
      }))
    }
    setEvidenceNotice(null)

    if (!transport.probes.m2.capabilities.locateM2Evidence) {
      setActiveEvidence(null)
      setEvidenceNotice(
        '后端尚未接线/不可用（缺失方法：locateM2Evidence），无法向后端请求最新原文页与选区定位；已按本地映射同步高亮模型特征与图纸标注。',
      )
      return
    }

    setEvidenceLoading(true)
    let result
    try {
      result = await transport.locateEvidence({
        projectId: trackerRef.current.projectId,
        revision: canvasState.currentRevision,
        target: params.checkId
          ? { kind: 'check', checkId: params.checkId, requirementId: params.requirementId }
          : { kind: 'requirement', requirementId: params.requirementId },
      })
    } catch (err) {
      result = {
        ok: false as const,
        error: normalizeM2BridgeError(err, '来源定位请求异常'),
      }
    }
    if (!trackerRef.current.mounted) return
    setEvidenceLoading(false)
    if (!result.ok) {
      setActiveEvidence(null)
      setEvidenceNotice(`来源定位失败（${result.error.code}）：${result.error.message}`)
      return
    }
    setActiveEvidence(result.value)
    if (result.value.featureIds.length > 0) {
      setEvidenceHighlightFeatures(result.value.featureIds)
      setCanvasState((prev) => ({
        ...prev,
        selectedObjectId: result.value.featureIds[0],
      }))
    }
    if (result.value.annotationIds.length > 0) {
      setEvidenceHighlightAnnotations(result.value.annotationIds)
    }
  }

  const handleSelectCheck = (check: M2CheckItem) => {
    setActiveCheckId(check.checkId)
    void locateEvidenceForTarget({
      checkId: check.checkId,
      requirementId: check.requirementId,
      linkedFeatureIds: check.linkedFeatureIds,
      linkedAnnotationIds: check.linkedAnnotationIds,
    })
  }

  const handleSelectRequirement = (req: M2RequirementItem) => {
    onSwitchSidebarSection('checks')
    void locateEvidenceForTarget({
      requirementId: req.requirementId,
      linkedFeatureIds: req.linkedFeatureIds,
      linkedAnnotationIds: req.linkedAnnotationIds,
    })
  }

  const handleSubmitClarification = async (params: {
    readonly targetId: string
    readonly mode: 'answer' | 'correct_interpretation'
    readonly content: string
  }): Promise<void> => {
    if (!transport.probes.m2.capabilities.submitClarification) {
      setClarificationFeedback((prev) => ({
        ...prev,
        [params.targetId]: {
          ok: false,
          message:
            '后端尚未接线/不可用（缺失方法：submitM2Clarification），无法提交澄清回答或纠正解释。',
        },
      }))
      return
    }
    const requestId = allocateRequestId('clarify')
    setClarificationPendingId(params.targetId)
    let result
    try {
      result = await transport.submitClarification({
        projectId: trackerRef.current.projectId,
        revision: canvasState.currentRevision,
        targetId: params.targetId,
        mode: params.mode,
        content: params.content,
        requestId,
      })
    } catch (err) {
      result = {
        ok: false as const,
        error: normalizeM2BridgeError(err, '提交澄清回答异常'),
      }
    }
    if (!trackerRef.current.mounted) return
    setClarificationPendingId(null)
    if (!result.ok) {
      setClarificationFeedback((prev) => ({
        ...prev,
        [params.targetId]: {
          ok: false,
          message: `提交失败（${result.error.code}）：${result.error.message}`,
        },
      }))
      return
    }
    setClarificationFeedback((prev) => ({
      ...prev,
      [params.targetId]: { ok: true, message: result.value.message },
    }))
    setCanvasState((prev) => ({
      ...prev,
      requirements: prev.requirements.map((req) =>
        req.requirementId === params.targetId
          ? {
              ...req,
              status: 'confirmed',
              interpretation: result.value.updatedInterpretation ?? params.content,
            }
          : req,
      ),
      checks: prev.checks.map((chk) =>
        chk.checkId === params.targetId || chk.requirementId === params.targetId
          ? {
              ...chk,
              status: 'checking',
              summary: `已提交${params.mode === 'correct_interpretation' ? '纠正解释' : '澄清回答'}，等待重算`,
            }
          : chk,
      ),
      checksInProgress: true,
      history: [
        {
          id: `hist-clarify-${requestId}`,
          sequence: prev.lastEventSequence + 1,
          revision: result.value.nextRevision ?? prev.currentRevision,
          kind: 'clarification',
          status: 'info',
          title:
            params.mode === 'correct_interpretation' ? '已纠正条款解释' : '已提交待澄清回答',
          detail: `${params.targetId}：${params.content}`,
        },
        ...prev.history,
      ],
    }))
  }

  const resetViewportForProjectSwitch = useCallback(
    (params: {
      readonly nextProjectId: string
      readonly nextBaseRevision: string | null
      readonly nextDraftRevision: string | null
      readonly nextPreviewSnapshot?: Partial<M2PreviewSnapshot>
    }) => {
      setExtraSelectedObjectIds([])
      setExplosionFactorRaw(0)
      setXrayMode(false)
      setActiveCheckId(null)
      setActiveEvidence(null)
      setEvidenceLoading(false)
      setEvidenceNotice(null)
      setEvidenceHighlightFeatures([])
      setEvidenceHighlightAnnotations([])
      setClarificationPendingId(null)
      setClarificationFeedback({})
      setRetryDrawingPending(false)
      setRetryDrawingFeedback(null)
      setContextActionFeedback(null)

      trackerRef.current.drawingFailureGeneration = params.nextPreviewSnapshot?.drawingFailure
        ? 1
        : 0
      trackerRef.current.drawingStateGeneration =
        params.nextPreviewSnapshot?.drawingFailure ||
        params.nextPreviewSnapshot?.drawing?.status === 'ready'
          ? 1
          : 0
      const nextSnapshotForSwitch: Partial<M2PreviewSnapshot> | undefined =
        params.nextPreviewSnapshot?.features !== undefined
          ? params.nextPreviewSnapshot
          : hasRealChatBridge && availableObjectsProp === undefined
            ? { ...params.nextPreviewSnapshot, features: [] }
            : params.nextPreviewSnapshot
      setCanvasState(
        createInitialM2CanvasState({
          projectId: params.nextProjectId,
          initialDraftRevision: params.nextDraftRevision,
          initialBaseRevision: params.nextBaseRevision,
          initialPreviewSnapshot: nextSnapshotForSwitch,
          initialSelectedObjectId: null,
        }),
      )
    },
    [availableObjectsProp, hasRealChatBridge, trackerRef],
  )

  const naturalCompletionSummary = useMemo(
    () => computeNaturalCompletionSummary(canvasState),
    [canvasState],
  )

  const effectiveViewMode = resolveEffectiveViewMode(
    canvasState.viewMode,
    isNarrow,
    canvasState.lastSingleTab,
  )
  const modelStatusMeta = getArtifactStatusMeta(canvasState.model, '模型')
  const drawingStatusMeta = getArtifactStatusMeta(
    canvasState.drawing,
    '图纸',
    canvasState.drawingFailure,
  )

  const checksSummaryCounts = useMemo(() => {
    let failed = 0
    let pending = 0
    let passed = 0
    for (const chk of canvasState.checks) {
      if (chk.status === 'fail' || chk.status === 'executionFailed') failed += 1
      else if (chk.status === 'needsClarification' || chk.status === 'uncovered') pending += 1
      else if (chk.status === 'pass') passed += 1
    }
    return { total: canvasState.checks.length, failed, pending, passed }
  }, [canvasState.checks])

  return {
    isNarrow,
    canvasState,
    setCanvasState,
    canvasStateRef,
    selectedObject,
    selectedObjectIds,
    explosionFactor,
    setExplosionFactor,
    xrayMode,
    setXrayMode,
    toggleXrayMode,
    structureOpen,
    setStructureOpen,
    highlightedFeatureIds,
    highlightedAnnotationIds,
    effectiveViewMode,
    modelStatusMeta,
    drawingStatusMeta,
    checksSummaryCounts,
    naturalCompletionSummary,
    activeCheckId,
    activeEvidence,
    evidenceLoading,
    evidenceNotice,
    retryDrawingPending,
    retryDrawingFeedback,
    retryDrawingFailureSeq,
    clarificationPendingId,
    clarificationFeedback,
    contextActionFeedback,
    setContextActionFeedback,
    handleChangeViewMode,
    handleSelectFeature,
    handleSelectAnnotation,
    handleClearSelection,
    updateCamera,
    updateDrawingViewport,
    handleRetryDrawing,
    handleSelectCheck,
    handleSelectRequirement,
    handleSubmitClarification,
    resetViewportForProjectSwitch,
  }
}
