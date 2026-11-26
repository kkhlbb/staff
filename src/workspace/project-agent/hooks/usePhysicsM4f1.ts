import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Transport } from '../../../transport/types'
import type {
  AiPhysicsDraftItem,
  AssemblyPhysicsSpec,
  CompliantModelSpec,
  CompliantSimulationSummary,
  DeformationViewMode,
  EvidenceRef,
  MaterialSpec,
  MicMatrixPayloadV1,
  PartDisplacementField,
  PartMesh,
  PhysicsPatch,
  SimulationDiagnosticResult,
} from '../assembly3dTypes'
import {
  collectCompliantPartIds,
  computeLocalCompliantDiagnostics,
  createDefaultM4f1PhysicsFixture,
} from '../physics3dMath'

export interface UsePhysicsM4f1Options {
  readonly transport: Transport
  readonly enabled: boolean
  readonly projectId: string
  readonly baseRevision?: string | null
  readonly draftRevision: string | null
  readonly writerEpoch?: number
  readonly partMeshes: readonly PartMesh[]
  readonly baseSimulationResult: SimulationDiagnosticResult
  readonly initialPhysics?: AssemblyPhysicsSpec
  readonly initialAiPhysicsDrafts?: readonly AiPhysicsDraftItem[]
  readonly initialDisplacementFields?: readonly PartDisplacementField[]
  readonly onSetContextFeedback: (message: string | null) => void
}

function createPhysicsEvidence(
  statement: string,
  fieldPath: string,
  sessionSeq: number,
): EvidenceRef {
  return {
    kind: 'user-attestation',
    actorId: 'workbench-user',
    at: new Date().toISOString(),
    sessionSeq,
    sessionLabel: '柔性形变配置交互',
    statement,
    fieldPath,
  }
}

/**
 * Encapsulates all M4F1 compliant deformation state, transport calls (`stagePhysics`,
 * `importMicMatrix`, `analyzeCompliantStackup`), 3D heatmap/animation view state,
 * rigid-vs-compliant comparison, and AI physics drafts — keeping
 * `ProjectAgentM1Workbench.tsx` strictly < 800 lines.
 */
export function usePhysicsM4f1({
  transport,
  enabled,
  projectId,
  baseRevision,
  draftRevision,
  writerEpoch,
  partMeshes,
  baseSimulationResult,
  initialPhysics,
  initialAiPhysicsDrafts,
  initialDisplacementFields,
  onSetContextFeedback,
}: UsePhysicsM4f1Options) {
  const defaultFixture = useMemo(() => createDefaultM4f1PhysicsFixture(), [])

  const [physicsSpec, setPhysicsSpec] = useState<AssemblyPhysicsSpec | undefined>(() =>
    initialPhysics !== undefined ? initialPhysics : defaultFixture.defaultPhysics,
  )
  const [userEditedPhysics, setUserEditedPhysics] = useState<boolean>(() => initialPhysics !== undefined)
  const [includeCompliant, setIncludeCompliant] = useState<boolean>(() => {
    const src = initialPhysics !== undefined ? initialPhysics : defaultFixture.defaultPhysics
    return Boolean(
      src &&
        src.enabled !== false &&
        ((src.compliantModels?.length ?? 0) > 0 || Boolean(src.micMatrixRef)),
    )
  })
  const [deformationMode, setDeformationMode] = useState<DeformationViewMode>('nominal')
  const [exaggerationScale, setExaggerationScale] = useState<number>(25)
  const [transportSummary, setTransportSummary] = useState<CompliantSimulationSummary | null>(null)
  const [transportFields, setTransportFields] = useState<readonly PartDisplacementField[] | null>(
    () => (initialDisplacementFields ? [...initialDisplacementFields] : null),
  )
  const [compliantComputing, setCompliantComputing] = useState(false)

  // AI Physics Drafts state
  const [aiPhysicsDrafts, setAiPhysicsDrafts] = useState<readonly AiPhysicsDraftItem[]>(() =>
    initialAiPhysicsDrafts ?? defaultFixture.aiPhysicsDrafts,
  )
  const [appliedPhysicsCount, setAppliedPhysicsCount] = useState<number>(0)
  const [physicsDraftsFeedback, setPhysicsDraftsFeedback] = useState<string | null>(null)
  const [hoveredPhysicsDraft, setHoveredPhysicsDraft] = useState<AiPhysicsDraftItem | null>(null)

  const seqRef = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestDraftRevRef = useRef<string | null>(draftRevision)

  useEffect(() => {
    latestDraftRevRef.current = draftRevision
  }, [draftRevision])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const compliantPartIds = useMemo(
    () => (enabled ? collectCompliantPartIds(physicsSpec) : new Set<string>()),
    [enabled, physicsSpec],
  )

  const localComputed = useMemo(
    () =>
      computeLocalCompliantDiagnostics(
        baseSimulationResult,
        partMeshes,
        enabled ? physicsSpec : undefined,
        includeCompliant,
      ),
    [baseSimulationResult, partMeshes, enabled, physicsSpec, includeCompliant],
  )

  const effectiveSummary: CompliantSimulationSummary = transportSummary ?? localComputed.summary

  const effectiveSimulationResult: SimulationDiagnosticResult = useMemo(() => {
    if (!enabled) return baseSimulationResult
    if (!transportSummary) {
      if (baseSimulationResult.source === 'transport' && !userEditedPhysics) {
        return {
          ...baseSimulationResult,
          compliantSummary: localComputed.summary,
          includeCompliant,
        }
      }
      return localComputed.result
    }

    const activeMetrics = includeCompliant
      ? transportSummary.compliantResult
      : transportSummary.rigidBaseline
    const activeCpk = activeMetrics.cpk ?? baseSimulationResult.cpk
    const activeStatus: SimulationDiagnosticResult['status'] =
      activeCpk >= 1.33 ? 'pass' : activeCpk >= 1.0 ? 'warn' : 'fail'

    return {
      ...baseSimulationResult,
      meanMm: (activeMetrics.threeSigmaIntervalMm[0] + activeMetrics.threeSigmaIntervalMm[1]) / 2,
      sigmaMm: Math.max(
        1e-6,
        (activeMetrics.threeSigmaIntervalMm[1] - activeMetrics.threeSigmaIntervalMm[0]) / 6,
      ),
      threeSigmaLowMm: activeMetrics.threeSigmaIntervalMm[0],
      threeSigmaHighMm: activeMetrics.threeSigmaIntervalMm[1],
      cpk: activeCpk,
      ppm: activeMetrics.ppm,
      status: activeStatus,
      compliantSummary: transportSummary,
      includeCompliant,
      source: 'transport',
    }
  }, [enabled, baseSimulationResult, transportSummary, localComputed.result, localComputed.summary, includeCompliant, userEditedPhysics])

  const displacementFields: readonly PartDisplacementField[] = useMemo(() => {
    if (!enabled) return []
    if (!includeCompliant) return []
    if (transportFields && transportFields.length > 0) return transportFields
    return localComputed.displacementFields
  }, [enabled, includeCompliant, transportFields, localComputed.displacementFields])

  const scheduleCompliantAnalysis = useCallback(
    (whatIfPatch?: PhysicsPatch) => {
      if (!enabled) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (typeof transport.analyzeCompliantStackup !== 'function') {
        setTransportSummary(null)
        return
      }
      setCompliantComputing(true)
      seqRef.current += 1
      const callSeq = seqRef.current

      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        const activeDraftRevision = latestDraftRevRef.current ?? draftRevision ?? 'draft-1'
        void transport
          .analyzeCompliantStackup!({
            projectId,
            draftRevision: activeDraftRevision,
            expectedWriterEpoch: writerEpoch ?? 0,
            monteCarlo: {
              distribution: 'normal',
              seed: 20261126,
              samples: 10000,
            },
            ...(whatIfPatch ? { whatIf: whatIfPatch } : {}),
          })
          .then((res) => {
            if (callSeq !== seqRef.current) return
            setCompliantComputing(false)
            if (res.ok) {
              setTransportSummary(res.value.summary)
              setTransportFields(res.value.displacementFields)
            } else {
              // Fallback smoothly to deterministic local calculation
              setTransportSummary(null)
            }
          })
          .catch(() => {
            if (callSeq !== seqRef.current) return
            setCompliantComputing(false)
            setTransportSummary(null)
          })
      }, 40)
    },
    [enabled, transport, projectId, draftRevision, writerEpoch],
  )

  const stagePhysicsPatch = useCallback(
    async (
      patch: PhysicsPatch,
      evidenceByField: Readonly<Record<string, readonly EvidenceRef[]>>,
      feedbackPrefix: string,
      onFeedback?: (msg: string) => void,
    ) => {
      const notify = onFeedback ?? onSetContextFeedback
      if (typeof transport.stagePhysics !== 'function') {
        notify(`${feedbackPrefix}（本地草稿已更新）。`)
        scheduleCompliantAnalysis(patch)
        return
      }
      seqRef.current += 1
      const seq = seqRef.current
      try {
        const res = await transport.stagePhysics({
          projectId,
          expectedWriterEpoch: writerEpoch ?? 0,
          baseRevision: baseRevision ?? 'v1',
          expectedDraftRevision: latestDraftRevRef.current,
          idempotencyKey: `ui-stage-physics-${projectId}-${seq}`,
          physics: patch,
          evidenceByField,
        })
        if (res.ok) {
          latestDraftRevRef.current = res.value.draftRevision
          setPhysicsSpec(res.value.physics)
          notify(`${feedbackPrefix}（已写入草稿 ${res.value.draftRevision}）。`)
        } else if (
          res.error.code === 'BACKEND_UNAVAILABLE' ||
          res.error.code === 'FEATURE_DISABLED'
        ) {
          notify(`${feedbackPrefix}（本地草稿已更新）。`)
        } else {
          notify(`柔性配置暂存失败（${res.error.code}）：${res.error.message}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        notify(`柔性配置暂存异常（已保留本地草稿）：${msg}`)
      }
      scheduleCompliantAnalysis(patch)
    },
    [transport, projectId, baseRevision, writerEpoch, onSetContextFeedback, scheduleCompliantAnalysis],
  )

  const savePartPhysics = useCallback(
    (params: {
      readonly partId: string
      readonly partName: string
      readonly material: MaterialSpec
      readonly models: readonly CompliantModelSpec[]
    }) => {
      const prevMaterials = (physicsSpec?.materials ?? []).filter((m) => m.partId !== params.partId)
      const prevModels = (physicsSpec?.compliantModels ?? []).filter((m) =>
        m.kind === 'thermal-expansion' ? !m.partIds.includes(params.partId) : m.partId !== params.partId,
      )
      const nextMaterials = [...prevMaterials, params.material]
      const nextModels = [...prevModels, ...params.models]
      const nextPatch: PhysicsPatch = {
        enabled: true,
        materials: nextMaterials,
        compliantModels: nextModels,
      }
      setPhysicsSpec((prev) => ({
        ...prev,
        ...nextPatch,
      }))
      setUserEditedPhysics(true)
      setIncludeCompliant(true)
      setTransportSummary(null)

      const ev = createPhysicsEvidence(
        `为「${params.partName}」配置材料 ${params.material.name ?? params.material.presetId ?? '自定义'} 与 ${params.models.length} 项柔性模型`,
        `/materials/${params.partId}`,
        seqRef.current + 1,
      )
      void stagePhysicsPatch(
        nextPatch,
        {
          '/materials': [ev],
          '/compliantModels': [ev],
        },
        `已保存「${params.partName}」柔性形变配置`,
      )
    },
    [physicsSpec, stagePhysicsPatch],
  )

  const importMicMatrix = useCallback(
    async (params: { readonly fileName: string; readonly payload: MicMatrixPayloadV1 }) => {
      const ev = createPhysicsEvidence(
        `导入 MIC 影响系数矩阵 ${params.fileName}（零件 ${params.payload.partId}）`,
        '/micMatrixRef',
        seqRef.current + 1,
      )
      if (typeof transport.importMicMatrix !== 'function') {
        const localRef = `mic-local-${params.payload.partId}`
        setPhysicsSpec((prev) => ({ ...prev, enabled: true, micMatrixRef: localRef }))
        setIncludeCompliant(true)
        onSetContextFeedback(`已在本地载入 MIC 影响系数矩阵：${params.fileName}。`)
        scheduleCompliantAnalysis()
        return
      }

      seqRef.current += 1
      const seq = seqRef.current
      try {
        const res = await transport.importMicMatrix({
          projectId,
          expectedWriterEpoch: writerEpoch ?? 0,
          baseRevision: baseRevision ?? 'v1',
          expectedDraftRevision: latestDraftRevRef.current,
          idempotencyKey: `ui-import-mic-${projectId}-${seq}`,
          fileName: params.fileName,
          payload: params.payload,
          evidence: [ev],
        })
        if (res.ok) {
          latestDraftRevRef.current = res.value.draftRevision
          setPhysicsSpec((prev) => ({
            ...prev,
            enabled: true,
            micMatrixRef: res.value.attachment.revisionId,
          }))
          setIncludeCompliant(true)
          onSetContextFeedback(
            `已导入 MIC 影响系数矩阵「${params.fileName}」（草稿 ${res.value.draftRevision}）。`,
          )
          scheduleCompliantAnalysis()
        } else if (
          res.error.code === 'BACKEND_UNAVAILABLE' ||
          res.error.code === 'FEATURE_DISABLED'
        ) {
          setPhysicsSpec((prev) => ({
            ...prev,
            enabled: true,
            micMatrixRef: `mic-local-${params.payload.partId}`,
          }))
          setIncludeCompliant(true)
          onSetContextFeedback(`已在本地载入 MIC 影响系数矩阵：${params.fileName}。`)
          scheduleCompliantAnalysis()
        } else {
          onSetContextFeedback(`MIC 矩阵导入失败（${res.error.code}）：${res.error.message}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        onSetContextFeedback(`MIC 矩阵导入异常：${msg}`)
      }
    },
    [transport, projectId, baseRevision, writerEpoch, onSetContextFeedback, scheduleCompliantAnalysis],
  )

  const toggleIncludeCompliant = useCallback(
    (next: boolean) => {
      setUserEditedPhysics(true)
      setIncludeCompliant(next)
      if (!next) {
        setDeformationMode('nominal')
      }
      scheduleCompliantAnalysis({ enabled: next })
    },
    [scheduleCompliantAnalysis],
  )

  const togglePhysicsDraft = useCallback((draftId: string) => {
    setAiPhysicsDrafts((prev) =>
      prev.map((item) =>
        item.id === draftId && !item.applied ? { ...item, selected: !item.selected } : item,
      ),
    )
  }, [])

  const applySelectedPhysicsDrafts = useCallback(() => {
    const toApply = aiPhysicsDrafts.filter((item) => item.selected && !item.applied)
    if (toApply.length === 0) return

    let nextMaterials = [...(physicsSpec?.materials ?? [])]
    let nextModels = [...(physicsSpec?.compliantModels ?? [])]
    const evidenceList: EvidenceRef[] = []

    for (const draft of toApply) {
      for (const mat of draft.physicsPatch.materials ?? []) {
        nextMaterials = [...nextMaterials.filter((m) => m.partId !== mat.partId), mat]
      }
      for (const model of draft.physicsPatch.compliantModels ?? []) {
        nextModels = [...nextModels.filter((m) => m.id !== model.id), model]
      }
      if (draft.evidenceRefs.length > 0) {
        evidenceList.push(...draft.evidenceRefs)
      } else {
        evidenceList.push(
          createPhysicsEvidence(`应用 AI 柔性草案：${draft.title}`, '/compliantModels', seqRef.current + 1),
        )
      }
    }

    const mergedPatch: PhysicsPatch = {
      enabled: true,
      materials: nextMaterials,
      compliantModels: nextModels,
    }
    setPhysicsSpec((prev) => ({ ...prev, ...mergedPatch }))
    setIncludeCompliant(true)
    setTransportSummary(null)
    setAiPhysicsDrafts((prev) =>
      prev.map((item) => (item.selected && !item.applied ? { ...item, applied: true } : item)),
    )
    setAppliedPhysicsCount((prev) => prev + toApply.length)
    setHoveredPhysicsDraft(null)
    setPhysicsDraftsFeedback(`已确认并应用 ${toApply.length} 条 AI 建议柔性形变草案。`)

    void stagePhysicsPatch(
      mergedPatch,
      { '/materials': evidenceList, '/compliantModels': evidenceList },
      `已确认并应用 ${toApply.length} 条 AI 建议柔性形变草案`,
      setPhysicsDraftsFeedback,
    )
  }, [aiPhysicsDrafts, physicsSpec, stagePhysicsPatch])

  return {
    physicsSpec,
    compliantPartIds,
    includeCompliant,
    toggleIncludeCompliant,
    deformationMode,
    setDeformationMode,
    exaggerationScale,
    setExaggerationScale,
    displacementFields,
    compliantSummary: effectiveSummary,
    simulationResult: effectiveSimulationResult,
    compliantComputing,
    scheduleCompliantAnalysis,
    savePartPhysics,
    importMicMatrix,
    aiPhysicsDrafts,
    appliedPhysicsCount,
    physicsDraftsFeedback,
    hoveredPhysicsDraft,
    setHoveredPhysicsDraft,
    togglePhysicsDraft,
    applySelectedPhysicsDrafts,
    canvasBundle: {
      physicsSpec,
      compliantPartIds,
      displacementFields,
      deformationMode,
      onChangeDeformationMode: setDeformationMode,
      exaggerationScale,
      onChangeExaggerationScale: setExaggerationScale,
      onSavePhysics: savePartPhysics,
      onImportMicMatrix: importMicMatrix,
    },
  }
}
