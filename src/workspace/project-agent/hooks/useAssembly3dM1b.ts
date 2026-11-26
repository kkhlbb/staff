import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ElectronTransport } from '../../../transport/electronTransport'
import type { GdtStackupMetrics, GdtWhatIfEdit } from '../../../transport/types'
import {
  CAMERA_PRESETS,
  createDefaultM1bAssemblyFixture,
  formatHumanReadableFeatureLabel,
} from '../assembly3dMath'
import { resolvePartDisplayColor } from '../assemblyTreeModel'
import {
  computeLocalGdtSimulationDiagnostics,
  createDefaultM3gGdtFixture,
  formatFcfCells,
  type DatumLetter,
} from '../gdt3dMath'
import type {
  AiGdtDraftItem,
  AiMateDraftItem,
  AssemblyFeatureSelectionItem,
  AssemblyGroup,
  AssemblyModelV1,
  CameraPresetId,
  ContextPillActionId,
  DatumDefinition,
  EvidenceRef,
  FourWayHighlightTarget,
  GdtDisplayMode,
  GdtFeatureControl,
  GdtMaterialModifier,
  PartMesh,
  PickedFeatureGeometryKind,
  SimulationDiagnosticResult,
  SimulationLoopSpec,
} from '../assembly3dTypes'
import type { M2CameraState, M2ModelFeatureItem } from '../m2WorkbenchBridge'

export interface UseAssembly3dM1bOptions {
  readonly transport: ElectronTransport
  readonly projectId: string
  readonly baseRevision?: string | null
  readonly draftRevision: string | null
  readonly writerEpoch?: number
  readonly feature3dAssemblyM1Prop?: boolean
  readonly initialAssembly3d?: AssemblyModelV1
  readonly initialPartMeshes?: readonly PartMesh[]
  readonly initialAiMateDrafts?: readonly AiMateDraftItem[]
  readonly initialAiGdtDrafts?: readonly AiGdtDraftItem[]
  readonly initialDatums?: readonly DatumDefinition[]
  readonly initialGdtControls?: readonly GdtFeatureControl[]
  readonly initialSimulationSpec?: SimulationLoopSpec
  readonly selectedObjectIds: readonly string[]
  readonly onSelectFeature: (
    feature: M2ModelFeatureItem,
    options?: { readonly additive?: boolean },
  ) => void
  readonly onClearSelection: () => void
  readonly onUpdateCamera: (updater: (prev: M2CameraState) => M2CameraState) => void
  readonly onSetContextFeedback: (message: string | null) => void
  readonly onBringTextToChat: (promptText: string) => void
}

function deriveFeaturesFromPartMeshes(partMeshes: readonly PartMesh[]): {
  readonly features: readonly M2ModelFeatureItem[]
  readonly itemById: ReadonlyMap<string, AssemblyFeatureSelectionItem>
} {
  const features: M2ModelFeatureItem[] = []
  const itemById = new Map<string, AssemblyFeatureSelectionItem>()

  for (const part of partMeshes) {
    for (const range of part.faceTriangleRanges) {
      const label = range.label ?? range.role ?? '表面'
      const geometryKind: PickedFeatureGeometryKind = range.geometryKind ?? 'face'
      const item: AssemblyFeatureSelectionItem = {
        featureId: range.objectId,
        partId: part.partId,
        partName: part.displayName,
        featureLabel: label,
        geometryKind,
      }
      itemById.set(range.objectId, item)
      features.push({
        objectId: range.objectId,
        breadcrumb: `${part.displayName} › ${label}`,
        featureRef: range.featureRef ?? `${part.partId}/${range.objectId}`,
        partName: part.displayName,
        role: label,
        kind: geometryKind === 'cylindrical-hole-axis' ? 'hole' : 'face',
        linkedAnnotationIds: [],
      })
    }

    for (const seg of part.edgeSegments ?? []) {
      const item: AssemblyFeatureSelectionItem = {
        featureId: seg.featureId,
        partId: part.partId,
        partName: part.displayName,
        featureLabel: seg.label,
        geometryKind: seg.kind,
      }
      itemById.set(seg.featureId, item)
      features.push({
        objectId: seg.featureId,
        breadcrumb: `${part.displayName} › ${seg.label}`,
        featureRef: `${part.partId}/${seg.featureId}`,
        partName: part.displayName,
        role: seg.label,
        kind: seg.kind === 'cylindrical-hole-axis' ? 'hole' : 'other',
        linkedAnnotationIds: [],
      })
    }
  }

  return { features, itemById }
}

function createUserAttestationEvidence(
  statement: string,
  fieldPath: string,
  sessionSeq: number,
): EvidenceRef {
  return {
    kind: 'user-attestation',
    actorId: 'workbench-user',
    at: new Date().toISOString(),
    sessionSeq,
    sessionLabel: '3D 装配工作台交互',
    statement,
    fieldPath,
  }
}

function applyGdtStackupMetrics(
  prev: SimulationDiagnosticResult,
  metrics: GdtStackupMetrics,
): SimulationDiagnosticResult {
  const [threeSigmaLowMm, threeSigmaHighMm] = metrics.threeSigmaIntervalMm
  const meanMm = (threeSigmaLowMm + threeSigmaHighMm) / 2
  const sigmaMm = Math.max(0, (threeSigmaHighMm - threeSigmaLowMm) / 6)
  const cpk = metrics.cpk ?? prev.cpk
  const status: SimulationDiagnosticResult['status'] =
    metrics.cpk !== null
      ? metrics.cpk >= 1.33
        ? 'pass'
        : metrics.cpk >= 1.0
          ? 'warn'
          : 'fail'
      : metrics.ppm <= 63
        ? 'pass'
        : metrics.ppm <= 2700
          ? 'warn'
          : 'fail'

  return {
    ...prev,
    meanMm,
    sigmaMm,
    threeSigmaLowMm,
    threeSigmaHighMm,
    cpk,
    ppm: metrics.ppm,
    status,
    gdtContributions: [...metrics.contributions],
    gdtWarnings: [...metrics.warnings],
    source: 'transport',
  }
}

/**
 * Manages M1B 3D assembly state gated strictly by `FEATURE_3D_ASSEMBLY_M1`:
 * - Multi-part visibility, camera presets, additive pick mode
 * - Dynamic context pill actions (datum, mates, 3D loop, AI prompt)
 * - AI-suggested mate drafts selection & one-click apply
 * - 3D simulation diagnostics & debounced What-If slider recalculation (<500ms)
 * - Bidirectional Pareto hover/click -> 3D feature highlight
 */
export function useAssembly3dM1b({
  transport,
  projectId,
  baseRevision,
  draftRevision,
  writerEpoch,
  feature3dAssemblyM1Prop,
  initialAssembly3d,
  initialPartMeshes,
  initialAiMateDrafts,
  initialAiGdtDrafts,
  initialDatums,
  initialGdtControls,
  initialSimulationSpec,
  selectedObjectIds,
  onSelectFeature,
  onClearSelection,
  onUpdateCamera,
  onSetContextFeedback,
  onBringTextToChat,
}: UseAssembly3dM1bOptions) {
  const hasExplicitAssemblyContext = Boolean(
    initialAssembly3d || (initialPartMeshes && initialPartMeshes.length > 0),
  )

  const [capabilityFlag, setCapabilityFlag] = useState<boolean>(false)

  useEffect(() => {
    if (feature3dAssemblyM1Prop !== undefined || hasExplicitAssemblyContext) return
    let active = true
    void transport
      .capabilities()
      .then((res) => {
        if (active && res.ok && res.value.FEATURE_3D_ASSEMBLY_M1) {
          setCapabilityFlag(true)
        }
      })
      .catch(() => {
        // Keep false on capability probe failure
      })
    return () => {
      active = false
    }
  }, [transport, feature3dAssemblyM1Prop, hasExplicitAssemblyContext])

  const feature3dAssemblyM1 =
    feature3dAssemblyM1Prop !== undefined
      ? feature3dAssemblyM1Prop
      : hasExplicitAssemblyContext || capabilityFlag

  const defaultFixture = useMemo(() => createDefaultM1bAssemblyFixture(), [])
  const defaultGdtFixture = useMemo(() => createDefaultM3gGdtFixture(), [])

  const assemblyGroups: readonly AssemblyGroup[] = useMemo(
    () => (feature3dAssemblyM1 ? (initialAssembly3d?.assemblyGroups ?? []) : []),
    [feature3dAssemblyM1, initialAssembly3d?.assemblyGroups],
  )

  const partMeshes: readonly PartMesh[] = useMemo(() => {
    if (!feature3dAssemblyM1) return []
    const baseMeshes =
      initialPartMeshes && initialPartMeshes.length > 0
        ? initialPartMeshes
        : defaultFixture.partMeshes
    const modelPartById = new Map((initialAssembly3d?.parts ?? []).map((p) => [p.id, p]))
    return baseMeshes.map((mesh, index) => {
      const modelPart = modelPartById.get(mesh.partId)
      const groupId =
        mesh.groupId ?? (modelPart?.kind === 'imported-step' ? modelPart.groupId : undefined)
      const resolvedColor = resolvePartDisplayColor(mesh, index, modelPart?.color)
      if (groupId === mesh.groupId && resolvedColor === mesh.color) {
        return mesh
      }
      return {
        ...mesh,
        color: resolvedColor,
        ...(groupId !== undefined ? { groupId } : {}),
      }
    })
  }, [feature3dAssemblyM1, initialPartMeshes, initialAssembly3d?.parts, defaultFixture.partMeshes])

  const { features: assemblyFeatures, itemById: assemblyFeatureMap } = useMemo(
    () => deriveFeaturesFromPartMeshes(partMeshes),
    [partMeshes],
  )

  const featureKindById = useMemo(() => {
    const map = new Map<string, PickedFeatureGeometryKind>()
    for (const [id, item] of assemblyFeatureMap.entries()) {
      map.set(id, item.geometryKind)
    }
    return map
  }, [assemblyFeatureMap])

  const featureLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const [id, item] of assemblyFeatureMap.entries()) {
      map.set(id, formatHumanReadableFeatureLabel(item))
    }
    return map
  }, [assemblyFeatureMap])

  const [hiddenPartIds, setHiddenPartIds] = useState<ReadonlySet<string>>(() => new Set())
  const [additivePickMode, setAdditivePickMode] = useState(false)
  const [activeCameraPreset, setActiveCameraPreset] = useState<CameraPresetId>('iso')
  const [hoveredFeatureId, setHoveredFeatureId] = useState<string | null>(null)

  // M3G GD&T, Datums, Smart Anti-Occlusion & Four-Way Highlight state
  const [datums, setDatums] = useState<readonly DatumDefinition[]>(() =>
    initialDatums ?? initialAssembly3d?.datums ?? defaultGdtFixture.datums,
  )
  const [gdtControls, setGdtControls] = useState<readonly GdtFeatureControl[]>(() =>
    initialGdtControls ?? initialAssembly3d?.gdt ?? defaultGdtFixture.gdtControls,
  )
  const [gdtDisplayMode, setGdtDisplayMode] = useState<GdtDisplayMode>('smart')
  const [editingGdtId, setEditingGdtId] = useState<string | null>(null)
  const [fourWayTarget, setFourWayTarget] = useState<FourWayHighlightTarget | null>(null)
  const [hoveredGdtDraft, setHoveredGdtDraft] = useState<AiGdtDraftItem | null>(null)

  // AI Mate Drafts state
  const [aiMateDrafts, setAiMateDrafts] = useState<readonly AiMateDraftItem[]>(() =>
    initialAiMateDrafts ?? defaultFixture.aiMateDrafts,
  )
  const [mateDraftsFeedback, setMateDraftsFeedback] = useState<string | null>(null)
  const [appliedMatesCount, setAppliedMatesCount] = useState<number>(0)

  // AI GD&T & Datum Drafts state
  const [aiGdtDrafts, setAiGdtDrafts] = useState<readonly AiGdtDraftItem[]>(() =>
    initialAiGdtDrafts ?? defaultGdtFixture.aiGdtDrafts,
  )
  const [gdtDraftsFeedback, setGdtDraftsFeedback] = useState<string | null>(null)
  const [appliedGdtCount, setAppliedGdtCount] = useState<number>(0)

  // Simulation Diagnostics & What-If state
  const simulationSpec: SimulationLoopSpec = initialSimulationSpec ?? defaultFixture.simulationSpec
  const [toleranceOverrides, setToleranceOverrides] = useState<Record<string, number>>({})
  const [simulationComputing, setSimulationComputing] = useState(false)
  const [simulationResult, setSimulationResult] = useState<SimulationDiagnosticResult>(() =>
    computeLocalGdtSimulationDiagnostics(simulationSpec, {
      gdtControls: initialGdtControls ?? initialAssembly3d?.gdt ?? defaultGdtFixture.gdtControls,
      datums: initialDatums ?? initialAssembly3d?.datums ?? defaultGdtFixture.datums,
      featureKindById,
      featureLabelById,
    }),
  )
  const simDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestDraftRevisionRef = useRef<string | null>(draftRevision)
  const gdtSeqRef = useRef<number>(0)
  const simSeqRef = useRef<number>(0)
  const contextKeyRef = useRef<string>(`${projectId}:${simulationSpec.id}:${initialAssembly3d?.parts.length ?? 0}`)

  useEffect(() => {
    latestDraftRevisionRef.current = draftRevision
  }, [draftRevision])

  useEffect(() => {
    const nextKey = `${projectId}:${simulationSpec.id}:${initialAssembly3d?.parts.length ?? 0}`
    if (contextKeyRef.current === nextKey) return
    contextKeyRef.current = nextKey
    const nextDatums = initialDatums ?? initialAssembly3d?.datums ?? defaultGdtFixture.datums
    const nextControls = initialGdtControls ?? initialAssembly3d?.gdt ?? defaultGdtFixture.gdtControls
    setHiddenPartIds(new Set())
    setHoveredFeatureId(null)
    setEditingGdtId(null)
    setFourWayTarget(null)
    setToleranceOverrides({})
    setDatums(nextDatums)
    setGdtControls(nextControls)
    setSimulationResult(
      computeLocalGdtSimulationDiagnostics(simulationSpec, {
        gdtControls: nextControls,
        datums: nextDatums,
        featureKindById,
        featureLabelById,
      }),
    )
  }, [
    projectId,
    simulationSpec,
    initialAssembly3d,
    initialDatums,
    initialGdtControls,
    defaultGdtFixture.datums,
    defaultGdtFixture.gdtControls,
    featureKindById,
    featureLabelById,
  ])

  const focusedLoopFeatureIds = useMemo(() => {
    const ids = new Set<string>()
    for (const c of simulationSpec.contributors) {
      ids.add(c.featureId)
    }
    return ids
  }, [simulationSpec.contributors])

  useEffect(() => {
    return () => {
      if (simDebounceRef.current) {
        clearTimeout(simDebounceRef.current)
      }
    }
  }, [])

  const togglePartVisibility = useCallback((partId: string) => {
    setHiddenPartIds((prev) => {
      const next = new Set(prev)
      if (next.has(partId)) {
        next.delete(partId)
      } else {
        next.add(partId)
      }
      return next
    })
  }, [])

  const setPartsVisibility = useCallback((partIds: readonly string[], hidden: boolean) => {
    if (partIds.length === 0) return
    setHiddenPartIds((prev) => {
      const next = new Set(prev)
      for (const partId of partIds) {
        if (hidden) {
          next.add(partId)
        } else {
          next.delete(partId)
        }
      }
      return next
    })
  }, [])

  const applyCameraPreset = useCallback(
    (preset: CameraPresetId) => {
      setActiveCameraPreset(preset)
      const target = CAMERA_PRESETS[preset]
      onUpdateCamera(() => ({ ...target }))
    },
    [onUpdateCamera],
  )

  const selectPart = useCallback(
    (partId: string) => {
      const part = partMeshes.find((p) => p.partId === partId)
      const firstFeature = part
        ? assemblyFeatures.find((f) => f.partName === part.displayName)
        : undefined
      if (firstFeature) {
        onSelectFeature(firstFeature, { additive: false })
      }
    },
    [partMeshes, assemblyFeatures, onSelectFeature],
  )

  const focusFeatureById = useCallback(
    (featureId: string) => {
      const found = assemblyFeatures.find((f) => f.objectId === featureId)
      if (found) {
        onSelectFeature(found, { additive: false })
      }
    },
    [assemblyFeatures, onSelectFeature],
  )

  const handlePickAssemblyFeature = useCallback(
    (payload: {
      readonly objectId: string
      readonly additive: boolean
    }) => {
      const found = assemblyFeatures.find((f) => f.objectId === payload.objectId)
      if (!found) return
      const shouldAdd = payload.additive || additivePickMode
      onSelectFeature(found, { additive: shouldAdd })
      if (shouldAdd && additivePickMode) {
        setAdditivePickMode(false)
      }
    },
    [assemblyFeatures, additivePickMode, onSelectFeature],
  )

  const selectedAssemblyItems: readonly AssemblyFeatureSelectionItem[] = useMemo(() => {
    if (!feature3dAssemblyM1) return []
    const items: AssemblyFeatureSelectionItem[] = []
    for (const id of selectedObjectIds) {
      const item = assemblyFeatureMap.get(id)
      if (item && items.length < 2) {
        items.push(item)
      }
    }
    return items
  }, [feature3dAssemblyM1, selectedObjectIds, assemblyFeatureMap])

  const executeContextAction = useCallback(
    (actionId: ContextPillActionId) => {
      if (selectedAssemblyItems.length === 0) return
      const labels = selectedAssemblyItems.map(formatHumanReadableFeatureLabel)

      switch (actionId) {
        case 'set-datum':
          onSetContextFeedback(`已将「${labels[0]}」设为装配基准 A。`)
          return
        case 'add-second-feature':
          setAdditivePickMode((prev) => !prev)
          onSetContextFeedback(
            !additivePickMode
              ? '请点击 3D 画布中的第二个特征以完成双选。'
              : '已退出加选模式。',
          )
          return
        case 'create-face-contact':
          setAppliedMatesCount((c) => c + 1)
          onSetContextFeedback(`已建立面贴合配合：${labels[0]} ↔ ${labels[1]}。`)
          return
        case 'create-coaxial':
          setAppliedMatesCount((c) => c + 1)
          onSetContextFeedback(`已建立同轴配合：${labels[0]} ↔ ${labels[1]}。`)
          return
        case 'create-distance-align':
          setAppliedMatesCount((c) => c + 1)
          onSetContextFeedback(`已建立距离/对齐配合：${labels[0]} ↔ ${labels[1]}。`)
          return
        case 'create-3d-loop':
          onSetContextFeedback(`已设为 3D 封闭环测量目标：${labels[0]} 与 ${labels[1]}。`)
          return
        case 'send-to-ai':
          onBringTextToChat(
            labels.length === 2
              ? `请分析「${labels[0]}」与「${labels[1]}」之间的配合与 3D 公差封闭环。`
              : `请针对「${labels[0]}」给出公差与装配基准建议。`,
          )
          onSetContextFeedback(`已将「${labels.join('、')}」带入 AI 对话。`)
          return
      }
    },
    [selectedAssemblyItems, additivePickMode, onSetContextFeedback, onBringTextToChat],
  )

  const toggleMateDraft = useCallback((draftId: string) => {
    setAiMateDrafts((prev) =>
      prev.map((item) =>
        item.id === draftId && !item.applied ? { ...item, selected: !item.selected } : item,
      ),
    )
  }, [])

  const applySelectedMateDrafts = useCallback(() => {
    const toApply = aiMateDrafts.filter((item) => item.selected && !item.applied)
    if (toApply.length === 0) return
    setAiMateDrafts((prev) =>
      prev.map((item) =>
        item.selected && !item.applied ? { ...item, applied: true } : item,
      ),
    )
    setAppliedMatesCount((prev) => prev + toApply.length)
    setMateDraftsFeedback(
      `已确认并应用 ${toApply.length} 条 AI 建议配合（${toApply.map((m) => m.mateTypeLabel).join('、')}）。`,
    )
  }, [aiMateDrafts])

  const stageDatumToTransport = useCallback(
    async (
      items: readonly { readonly value: DatumDefinition; readonly evidence: readonly EvidenceRef[] }[],
      onFailure?: (message: string) => void,
    ) => {
      if (items.length === 0 || typeof transport.stageDatum !== 'function') return null
      gdtSeqRef.current += 1
      const seq = gdtSeqRef.current
      try {
        const res = await transport.stageDatum({
          projectId,
          expectedWriterEpoch: writerEpoch ?? 0,
          baseRevision: baseRevision ?? 'v1',
          expectedDraftRevision: latestDraftRevisionRef.current,
          idempotencyKey: `ui-stage-datum-${projectId}-${seq}-${items.map((i) => i.value.id).join(',')}`,
          items,
        })
        if (res.ok) {
          latestDraftRevisionRef.current = res.value.draftRevision
          if (res.value.warnings.length > 0) {
            setSimulationResult((prev) => ({
              ...prev,
              gdtWarnings: [...res.value.warnings],
            }))
          }
        } else if (
          res.error.code !== 'BACKEND_UNAVAILABLE' &&
          res.error.code !== 'FEATURE_DISABLED' &&
          res.error.code !== 'AUTH_REQUIRED'
        ) {
          onFailure?.(`基准暂存失败（${res.error.code}）：${res.error.message}`)
        }
        return res
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        onFailure?.(`基准暂存异常：${message}`)
        return null
      }
    },
    [transport, projectId, baseRevision, writerEpoch],
  )

  const stageGdtToTransport = useCallback(
    async (
      items: readonly {
        readonly value: GdtFeatureControl
        readonly evidence: readonly EvidenceRef[]
      }[],
      onFailure?: (message: string) => void,
    ) => {
      if (items.length === 0 || typeof transport.stageGdt !== 'function') return null
      gdtSeqRef.current += 1
      const seq = gdtSeqRef.current
      try {
        const res = await transport.stageGdt({
          projectId,
          expectedWriterEpoch: writerEpoch ?? 0,
          baseRevision: baseRevision ?? 'v1',
          expectedDraftRevision: latestDraftRevisionRef.current,
          idempotencyKey: `ui-stage-gdt-${projectId}-${seq}-${items.map((i) => i.value.id).join(',')}`,
          items,
        })
        if (res.ok) {
          latestDraftRevisionRef.current = res.value.draftRevision
          if (res.value.warnings.length > 0) {
            setSimulationResult((prev) => ({
              ...prev,
              gdtWarnings: [...res.value.warnings],
            }))
          }
        } else if (
          res.error.code !== 'BACKEND_UNAVAILABLE' &&
          res.error.code !== 'FEATURE_DISABLED' &&
          res.error.code !== 'AUTH_REQUIRED'
        ) {
          onFailure?.(`GD&T 暂存失败（${res.error.code}）：${res.error.message}`)
        }
        return res
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        onFailure?.(`GD&T 暂存异常：${message}`)
        return null
      }
    },
    [transport, projectId, baseRevision, writerEpoch],
  )

  const scheduleSimulationRefresh = useCallback(
    (
      nextOverrides: Readonly<Record<string, number>>,
      nextControls: readonly GdtFeatureControl[],
      nextDatums: readonly DatumDefinition[],
      gdtEdits?: readonly GdtWhatIfEdit[],
    ) => {
      // Fast deterministic local recomputation (< 5ms) ensures responsive <350ms UI
      const localResult = computeLocalGdtSimulationDiagnostics(simulationSpec, {
        toleranceOverrides: nextOverrides,
        gdtControls: nextControls,
        datums: nextDatums,
        featureKindById,
        featureLabelById,
      })
      setSimulationResult(localResult)

      if (simDebounceRef.current) {
        clearTimeout(simDebounceRef.current)
      }
      setSimulationComputing(true)
      simSeqRef.current += 1
      const seq = simSeqRef.current

      simDebounceRef.current = setTimeout(() => {
        simDebounceRef.current = null
        const activeDraftRevision = latestDraftRevisionRef.current ?? draftRevision ?? 'draft-1'
        const monteCarlo = {
          distribution: 'normal' as const,
          seed: simulationSpec.seed,
          samples: Math.min(simulationSpec.sampleCount, 10000),
        }

        const runLegacySimulation = () => {
          const terms = simulationSpec.contributors.map((c, idx) => {
            const tolMm = nextOverrides[c.id] ?? c.currentTolMm
            const halfQ = Math.max(1, Math.round(tolMm * 10000))
            return {
              id: c.id,
              symbol: `A${idx + 1}`,
              name: c.label,
              nominalQ: Math.round(simulationSpec.nominalMm * 10000),
              upperDeviationQ: halfQ,
              lowerDeviationQ: -halfQ,
              sign: c.sign,
              sourceNote: c.label,
              termRevision: 1,
            }
          })
          return transport
            .runSimulation({
              projectId,
              draftRevision: activeDraftRevision,
              chain: {
                terms,
                target: {
                  minQ: Math.round(simulationSpec.lslMm * 10000),
                  maxQ: Math.round(simulationSpec.uslMm * 10000),
                },
                assumptions: `3D 封闭环 What-If 试算：${simulationSpec.title}`,
              },
              monteCarlo,
            })
            .then((res) => {
              if (seq !== simSeqRef.current) return
              setSimulationComputing(false)
              if (res.ok && res.value.statistical) {
                setSimulationResult((prev) => ({
                  ...prev,
                  source: 'transport',
                }))
              }
            })
            .catch(() => {
              if (seq !== simSeqRef.current) return
              setSimulationComputing(false)
            })
        }

        if (typeof transport.analyzeGdtStackup === 'function') {
          void transport
            .analyzeGdtStackup({
              projectId,
              draftRevision: activeDraftRevision,
              expectedWriterEpoch: writerEpoch ?? 0,
              monteCarlo,
              ...(gdtEdits && gdtEdits.length > 0 ? { edits: gdtEdits } : {}),
            })
            .then((res) => {
              if (seq !== simSeqRef.current) return
              if (res.ok) {
                setSimulationComputing(false)
                const metrics = res.value.whatIf ?? res.value.baseline
                setSimulationResult((prev) => applyGdtStackupMetrics(prev, metrics))
                return
              }
              if (res.error.code === 'BACKEND_UNAVAILABLE') {
                void runLegacySimulation()
                return
              }
              setSimulationComputing(false)
              if (res.error.code !== 'FEATURE_DISABLED' && res.error.code !== 'AUTH_REQUIRED') {
                onSetContextFeedback(`GD&T 仿真调用失败（${res.error.code}）：${res.error.message}`)
              }
            })
            .catch(() => {
              if (seq !== simSeqRef.current) return
              setSimulationComputing(false)
            })
          return
        }

        void runLegacySimulation()
      }, 60)
    },
    [
      simulationSpec,
      featureKindById,
      featureLabelById,
      transport,
      projectId,
      draftRevision,
      writerEpoch,
      onSetContextFeedback,
    ],
  )

  const updateWhatIfTolerance = useCallback(
    (contributorId: string, nextTolMm: number) => {
      const nextOverrides = { ...toleranceOverrides, [contributorId]: nextTolMm }
      setToleranceOverrides(nextOverrides)
      scheduleSimulationRefresh(nextOverrides, gdtControls, datums)
    },
    [toleranceOverrides, gdtControls, datums, scheduleSimulationRefresh],
  )

  const assignDatum = useCallback(
    (featureId: string, letter: DatumLetter) => {
      const nextDatum: DatumDefinition = {
        id: `datum-${letter}`,
        label: letter,
        featureId,
        ...(featureKindById.get(featureId) === 'cylindrical-hole-axis'
          ? { sizeToleranceQ: { lowerQ: -300, upperQ: 300 } }
          : {}),
      }
      const nextDatums = [...datums.filter((d) => d.label !== letter), nextDatum].sort((a, b) =>
        a.label.localeCompare(b.label),
      )
      setDatums(nextDatums)
      const label = featureLabelById.get(featureId) ?? featureId
      onSetContextFeedback(`已将「${label}」设为装配基准 ${letter}。`)
      void stageDatumToTransport(
        [
          {
            value: nextDatum,
            evidence: [
              createUserAttestationEvidence(
                `将「${label}」设为装配基准 ${letter}`,
                `assembly3d.datums.${nextDatum.id}`,
                gdtSeqRef.current + 1,
              ),
            ],
          },
        ],
        onSetContextFeedback,
      )
      scheduleSimulationRefresh(toleranceOverrides, gdtControls, nextDatums)
    },
    [
      datums,
      featureKindById,
      featureLabelById,
      onSetContextFeedback,
      stageDatumToTransport,
      scheduleSimulationRefresh,
      toleranceOverrides,
      gdtControls,
    ],
  )

  const createGdtControl = useCallback(
    (control: GdtFeatureControl) => {
      const nextControls = [...gdtControls, control]
      setGdtControls(nextControls)
      const summary = formatFcfCells(control, datums, featureKindById.get(control.featureId)).summaryText
      const label = featureLabelById.get(control.featureId) ?? control.featureId
      onSetContextFeedback(`已为「${label}」贴附 GD&T 框格 ${summary}。`)
      void stageGdtToTransport(
        [
          {
            value: control,
            evidence: [
              createUserAttestationEvidence(
                `为「${label}」贴附 GD&T 框格 ${summary}`,
                `assembly3d.gdt.${control.id}`,
                gdtSeqRef.current + 1,
              ),
            ],
          },
        ],
        onSetContextFeedback,
      )
      scheduleSimulationRefresh(toleranceOverrides, nextControls, datums)
    },
    [
      gdtControls,
      datums,
      featureKindById,
      featureLabelById,
      onSetContextFeedback,
      stageGdtToTransport,
      scheduleSimulationRefresh,
      toleranceOverrides,
    ],
  )

  const updateGdtControl = useCallback(
    (
      gdtId: string,
      patch: {
        readonly toleranceQ?: number
        readonly modifier?: GdtMaterialModifier
        readonly unequalProfileOuterFraction?: number
        readonly lowerSegment?: GdtFeatureControl['lowerSegment']
      },
    ) => {
      let updatedControl: GdtFeatureControl | null = null
      const nextControls = gdtControls.map((c) => {
        if (c.id !== gdtId) return c
        const next: GdtFeatureControl = {
          ...c,
          ...(patch.toleranceQ !== undefined ? { toleranceQ: patch.toleranceQ } : {}),
          ...(patch.modifier !== undefined ? { modifier: patch.modifier } : {}),
          ...(patch.unequalProfileOuterFraction !== undefined
            ? { unequalProfileOuterFraction: patch.unequalProfileOuterFraction }
            : {}),
          ...(patch.lowerSegment !== undefined ? { lowerSegment: patch.lowerSegment } : {}),
        }
        updatedControl = next
        return next
      })
      setGdtControls(nextControls)
      if (updatedControl) {
        const controlToStage: GdtFeatureControl = updatedControl
        const label = featureLabelById.get(controlToStage.featureId) ?? controlToStage.featureId
        void stageGdtToTransport(
          [
            {
              value: controlToStage,
              evidence: [
                createUserAttestationEvidence(
                  `调整「${label}」GD&T 控制项 ${controlToStage.id}`,
                  `assembly3d.gdt.${controlToStage.id}`,
                  gdtSeqRef.current + 1,
                ),
              ],
            },
          ],
          onSetContextFeedback,
        )
      }
      const edits: GdtWhatIfEdit[] =
        patch.toleranceQ !== undefined || patch.modifier !== undefined
          ? [
              {
                gdtId,
                ...(patch.toleranceQ !== undefined ? { toleranceQ: patch.toleranceQ } : {}),
                ...(patch.modifier !== undefined ? { modifier: patch.modifier } : {}),
              },
            ]
          : []
      scheduleSimulationRefresh(toleranceOverrides, nextControls, datums, edits)
    },
    [
      gdtControls,
      featureLabelById,
      stageGdtToTransport,
      onSetContextFeedback,
      toleranceOverrides,
      datums,
      scheduleSimulationRefresh,
    ],
  )

  const deleteGdtControl = useCallback(
    (gdtId: string) => {
      const nextControls = gdtControls.filter((c) => c.id !== gdtId)
      setGdtControls(nextControls)
      setEditingGdtId((prev) => (prev === gdtId ? null : prev))
      scheduleSimulationRefresh(toleranceOverrides, nextControls, datums)
    },
    [gdtControls, toleranceOverrides, datums, scheduleSimulationRefresh],
  )

  const toggleGdtDraft = useCallback((draftId: string) => {
    setAiGdtDrafts((prev) =>
      prev.map((item) =>
        item.id === draftId && !item.applied ? { ...item, selected: !item.selected } : item,
      ),
    )
  }, [])

  const applySelectedGdtDrafts = useCallback(() => {
    const toApply = aiGdtDrafts.filter((item) => item.selected && !item.applied)
    if (toApply.length === 0) return

    let nextDatums = [...datums]
    let nextControls = [...gdtControls]
    const datumItemsToStage: { readonly value: DatumDefinition; readonly evidence: readonly EvidenceRef[] }[] = []
    const gdtItemsToStage: { readonly value: GdtFeatureControl; readonly evidence: readonly EvidenceRef[] }[] = []

    for (const draft of toApply) {
      if (draft.draftKind === 'datum' && draft.datum) {
        nextDatums = [...nextDatums.filter((d) => d.label !== draft.datum!.label), draft.datum]
        datumItemsToStage.push({
          value: draft.datum,
          evidence:
            draft.evidenceRefs.length > 0
              ? draft.evidenceRefs
              : [
                  createUserAttestationEvidence(
                    `应用 AI 基准草案：${draft.title}`,
                    `assembly3d.datums.${draft.datum.id}`,
                    gdtSeqRef.current + 1,
                  ),
                ],
        })
      }
      if (draft.draftKind === 'gdt' && draft.gdt) {
        nextControls = [...nextControls.filter((g) => g.id !== draft.gdt!.id), draft.gdt]
        gdtItemsToStage.push({
          value: draft.gdt,
          evidence:
            draft.evidenceRefs.length > 0
              ? draft.evidenceRefs
              : [
                  createUserAttestationEvidence(
                    `应用 AI GD&T 草案：${draft.title}`,
                    `assembly3d.gdt.${draft.gdt.id}`,
                    gdtSeqRef.current + 1,
                  ),
                ],
        })
      }
    }

    setDatums(nextDatums)
    setGdtControls(nextControls)
    setAiGdtDrafts((prev) =>
      prev.map((item) => (item.selected && !item.applied ? { ...item, applied: true } : item)),
    )
    setAppliedGdtCount((prev) => prev + toApply.length)
    setHoveredGdtDraft(null)
    setGdtDraftsFeedback(`已确认并应用 ${toApply.length} 条 AI 建议基准/GD&T 草案。`)

    void (async () => {
      if (datumItemsToStage.length > 0) {
        await stageDatumToTransport(datumItemsToStage, setGdtDraftsFeedback)
      }
      if (gdtItemsToStage.length > 0) {
        await stageGdtToTransport(gdtItemsToStage, setGdtDraftsFeedback)
      }
    })()

    scheduleSimulationRefresh(toleranceOverrides, nextControls, nextDatums)
  }, [
    aiGdtDrafts,
    datums,
    gdtControls,
    stageDatumToTransport,
    stageGdtToTransport,
    scheduleSimulationRefresh,
    toleranceOverrides,
  ])

  const gdtPreviewControls = useMemo(
    () => (hoveredGdtDraft?.draftKind === 'gdt' && hoveredGdtDraft.gdt ? [hoveredGdtDraft.gdt] : []),
    [hoveredGdtDraft],
  )
  const gdtPreviewDatums = useMemo(
    () =>
      hoveredGdtDraft?.draftKind === 'datum' && hoveredGdtDraft.datum ? [hoveredGdtDraft.datum] : [],
    [hoveredGdtDraft],
  )

  const goldenPulseFeatureIds = useMemo(() => {
    const set = new Set<string>()
    if (hoveredFeatureId) set.add(hoveredFeatureId)
    if (fourWayTarget?.featureId) set.add(fourWayTarget.featureId)
    if (hoveredGdtDraft?.featureId) set.add(hoveredGdtDraft.featureId)
    return set
  }, [hoveredFeatureId, fourWayTarget, hoveredGdtDraft])

  const goldenPulseGdtIds = useMemo(() => {
    const set = new Set<string>()
    if (fourWayTarget?.gdtId) set.add(fourWayTarget.gdtId)
    if (editingGdtId) set.add(editingGdtId)
    return set
  }, [fourWayTarget, editingGdtId])

  const handleSelectGdtCallout = useCallback(
    (gdtId: string | null) => {
      setEditingGdtId(gdtId)
      if (!gdtId) return
      const found = gdtControls.find((c) => c.id === gdtId)
      if (found) {
        setFourWayTarget({ featureId: found.featureId, gdtId: found.id })
        focusFeatureById(found.featureId)
      }
    },
    [gdtControls, focusFeatureById],
  )

  const handleClearAssemblySelection = useCallback(() => {
    setAdditivePickMode(false)
    setEditingGdtId(null)
    onClearSelection()
  }, [onClearSelection])

  return {
    feature3dAssemblyM1,
    assemblyGroups,
    partMeshes,
    assemblyFeatures,
    featureKindById,
    hiddenPartIds,
    togglePartVisibility,
    setPartsVisibility,
    additivePickMode,
    activeCameraPreset,
    applyCameraPreset,
    hoveredFeatureId,
    setHoveredFeatureId,
    selectPart,
    focusFeatureById,
    handlePickAssemblyFeature,
    selectedAssemblyItems,
    executeContextAction,
    handleClearAssemblySelection,
    aiMateDrafts,
    appliedMatesCount,
    mateDraftsFeedback,
    toggleMateDraft,
    applySelectedMateDrafts,
    // M3G GD&T & Datum state + actions
    datums,
    gdtControls,
    gdtPreviewControls,
    gdtPreviewDatums,
    gdtDisplayMode,
    setGdtDisplayMode,
    editingGdtId,
    handleSelectGdtCallout,
    focusedLoopFeatureIds,
    goldenPulseFeatureIds,
    goldenPulseGdtIds,
    fourWayTarget,
    setFourWayTarget,
    assignDatum,
    createGdtControl,
    updateGdtControl,
    deleteGdtControl,
    aiGdtDrafts,
    appliedGdtCount,
    gdtDraftsFeedback,
    toggleGdtDraft,
    applySelectedGdtDrafts,
    hoveredGdtDraft,
    setHoveredGdtDraft,
    simulationResult,
    simulationComputing,
    updateWhatIfTolerance,
  }
}
