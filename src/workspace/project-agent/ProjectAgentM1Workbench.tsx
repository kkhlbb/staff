import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import './ProjectAgentPanel.css'
import {
  applyAuthoritativeScopeEpochSync,
  buildLocalAgentConfigSnippet,
  canAutoFetchModelApiModels,
  canUseBuiltinModelApiChat,
  classifyModelApiFailure,
  computeModelApiConfigFingerprint,
  DEFAULT_M1_MODEL_API_PROVIDER_ID,
  formatChatToolCallItem,
  formatSelectedObjectReference,
  getModelApiProviderPreset,
  isEventAcceptedForScope,
  isReplyAcceptedForScope,
  isScopedArtifactEventAccepted,
  M1_MODEL_API_PROVIDER_PRESETS,
  MAX_M1_CHAT_ATTACHMENTS,
  normalizeWorkbenchBridgeError,
  probeM1ConnectionUxBridge,
  probeM1ProjectAuthorization,
  probeM1WorkbenchBridge,
  resolveWindowM1ConnectionUxBridge,
  resolveWindowM1ProjectAuthorization,
  resolveWindowM1WorkbenchBridge,
  selectPreferredModelFromList,
  shouldAcceptWorkbenchEventSequence,
  sortDetectedLocalAgents,
  trimM1ChatAttachments,
  trimM1ChatHistory,
  type M1ChatToolCallItem,
  type M1ClientConnectionState,
  type M1ConnectionSource,
  type M1ConnectionStatusSnapshot,
  type M1ConnectionUxBridgeProbe,
  type M1DetectedLocalAgent,
  type M1ExternalActivityItem,
  type M1LocalAgentId,
  type M1LocalAgentInstallInfo,
  type M1ModelApiProviderPresetId,
  type M1ModelApiTestResult,
  type M1OutgoingContextSummary,
  type M1ProjectAuthorizationProbe,
  type M1ProjectAuthorizationState,
  type M1SelectedObjectRef,
  type M1TaskbookReference,
  type M1WorkbenchBridgeProbe,
  type M1WorkbenchErrorPayload,
  type M1WorkbenchIncomingEvent,
} from './m1WorkbenchBridge'
import {
  acceptAuthorizedEntryScope,
  buildM1AuthorizationRequest,
} from './m1ReadonlyAuthBridge'
import {
  applyM2DrawingRetryResultWithStatus,
  computeNaturalCompletionSummary,
  createInitialM2CanvasState,
  DEFAULT_M2_FEATURES,
  formatRevisionDisplay,
  normalizeM2BridgeError,
  probeM2WorkbenchBridge,
  reduceM2PreviewEvent,
  resolveEffectiveViewMode,
  resolveWindowM2WorkbenchBridge,
  type M2CheckItem,
  type M2DrawingAnnotationItem,
  type M2EvidenceResult,
  type M2ModelFeatureItem,
  type M2PreviewEvent,
  type M2PreviewSnapshot,
  type M2RequirementItem,
  type M2SidebarSection,
  type M2ViewMode,
  type M2WorkbenchBridgeProbe,
} from './m2WorkbenchBridge'
import { getArtifactStatusMeta, M2CenterCanvas } from './M2CenterCanvas'
import { M2SidebarPanels } from './M2SidebarPanels'
import { M3CompletionView } from './M3CompletionView'
import { M3MigrationBanner } from './M3MigrationBanner'
import { focusRecoveryElement } from './focusRecovery'
import {
  persistWorkbenchTheme,
  readStoredWorkbenchTheme,
  type WorkbenchTheme,
} from './workbenchTheme'
import {
  computeCheckSetFingerprint,
  computeNextExternalNotificationWatermark,
  createBoundConfirmation,
  evaluateCompletionReadiness,
  isBoundConfirmationValid,
  isCompletionIntentPrompt,
  isExternalNotificationNewerThanWatermark,
  mergeExternalProjectNotification,
  normalizeM3BridgeError,
  probeM3WorkbenchBridge,
  resolveWindowM3WorkbenchBridge,
  type M3BoundConfirmation,
  type M3ExternalNotificationWatermarks,
  type M3ExternalProjectEvent,
  type M3FormalVersionItem,
  type M3MigrationReport,
  type M3ReopenRestoreStatus,
  type M3UncommittedDraftItem,
  type M3WorkbenchBridgeProbe,
} from './m3WorkbenchBridge'

export interface WorkbenchLocalProject {
  readonly projectId: string
  readonly projectName: string
  readonly baseRevision: string | null
  readonly draftRevision: string | null
  readonly isSample?: boolean
  readonly summary?: string
}

export interface WorkbenchChatMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly attachments?: readonly M1TaskbookReference[]
  readonly selectedObject?: M1SelectedObjectRef | null
  readonly toolCalls?: readonly M1ChatToolCallItem[]
  readonly draftRevision?: string | null
  readonly status?: 'sent' | 'failed' | 'cancelled'
  readonly errorMessage?: string
}

export interface ProjectAgentM1WorkbenchProps {
  readonly bridge?: unknown
  readonly initialProjectId?: string
  readonly initialProjectName?: string
  readonly initialBaseRevision?: string | null
  readonly initialDraftRevision?: string | null
  readonly localProjects?: readonly WorkbenchLocalProject[]
  readonly availableObjects?: readonly M1SelectedObjectRef[]
  readonly availableTaskbooks?: readonly M1TaskbookReference[]
  readonly initialConnectionSnapshot?: Partial<M1ConnectionStatusSnapshot>
  readonly initialActivities?: readonly M1ExternalActivityItem[]
  readonly initialMessages?: readonly WorkbenchChatMessage[]
  readonly initialShowOnboarding?: boolean
  readonly initialPreviewSnapshot?: Partial<M2PreviewSnapshot>
  readonly initialViewMode?: M2ViewMode
  readonly initialSidebarSection?: M2SidebarSection
  readonly initialShowCompletionView?: boolean
  readonly initialFormalVersions?: readonly M3FormalVersionItem[]
  readonly initialUncommittedDrafts?: readonly M3UncommittedDraftItem[]
  readonly initialRestoreStatus?: M3ReopenRestoreStatus | null
  readonly initialMigrationReport?: M3MigrationReport | null
  readonly forceNarrowViewport?: boolean
  readonly clipboardWriter?: (text: string) => Promise<void> | void
  readonly className?: string
}

type OnboardingChoice = 'local-agent' | 'model-api' | 'skip-local'
type SidebarTab = 'external' | 'builtin'

const DEFAULT_LOCAL_PROJECTS: readonly WorkbenchLocalProject[] = [
  {
    projectId: 'proj-plate-01',
    projectName: '安装板项目',
    baseRevision: 'v1',
    draftRevision: 'draft-2',
    summary: '80 × 50 × 8 mm 安装板与双通孔边距检查',
  },
  {
    projectId: 'sample-spacer-01',
    projectName: '隔套兼容示例',
    baseRevision: 'v3',
    draftRevision: null,
    isSample: true,
    summary: '一维尺寸链与历史隔套回归示例',
  },
]

const DEFAULT_TASKBOOKS: readonly M1TaskbookReference[] = [
  {
    refId: 'tb-plate-p1',
    documentName: '安装板任务书.pdf',
    page: 1,
    excerpt: '长方形安装板 80 × 50 × 8 mm，两只直径 10 mm 通孔中心 (20,25) 与 (60,25) mm。',
  },
  {
    refId: 'tb-plate-p2',
    documentName: '安装板任务书.pdf',
    page: 2,
    excerpt: '右孔至右端面剩余材料在全部允许变化下至少 13 mm；参考盖板间隙至少 1.5 mm。',
  },
]

function formatClientConnectionLabel(
  state: M1ClientConnectionState,
  clientName: string | null,
): string {
  if (state === 'connected') {
    return clientName ? `已连接（${clientName}）` : '已连接'
  }
  if (state === 'connecting') {
    return '连接中'
  }
  return '未连接'
}

function getClientConnectionTone(state: M1ClientConnectionState): string {
  if (state === 'connected') return 'pa-tone-pass'
  if (state === 'connecting') return 'pa-tone-pending'
  return 'pa-tone-muted'
}

function formatAuthorizationLabel(state: M1ProjectAuthorizationState): string {
  if (state === 'authorized-writable') return '已授权（可写）'
  if (state === 'authorized-readonly') return '已授权（只读）'
  return '未授权'
}

function getAuthorizationTone(state: M1ProjectAuthorizationState): string {
  if (state === 'authorized-writable') return 'pa-tone-pass'
  if (state === 'authorized-readonly') return 'pa-tone-action'
  return 'pa-tone-muted'
}

function formatSourceLabel(
  source: M1ConnectionSource,
  clientName: string | null,
  modelName: string,
  skipped: boolean,
): string {
  if (source === 'local-agent') {
    return clientName ? `本地 Agent · ${clientName}` : '本地 Agent'
  }
  if (source === 'model-api') {
    return modelName.trim() ? `模型 API · ${modelName.trim()}` : '模型 API'
  }
  if (skipped) {
    return '本地浏览（跳过连接）'
  }
  return '未选择连接'
}

function formatActivityStatusLabel(status: M1ExternalActivityItem['status']): {
  label: string
  tone: string
} {
  switch (status) {
    case 'succeeded':
      return { label: '已成功', tone: 'pa-tone-pass' }
    case 'running':
      return { label: '运行中', tone: 'pa-tone-action' }
    case 'queued':
      return { label: '排队中', tone: 'pa-tone-pending' }
    case 'awaitingInput':
      return { label: '待回答', tone: 'pa-tone-pending' }
    case 'interrupted':
      return { label: '已中断', tone: 'pa-tone-pending' }
    case 'failed':
      return { label: '已失败', tone: 'pa-tone-danger' }
    case 'cancelled':
      return { label: '已取消', tone: 'pa-tone-muted' }
  }
}

function formatQuestionReason(reason: 'missing' | 'conflict' | 'ambiguousReference'): string {
  switch (reason) {
    case 'missing':
      return '缺项'
    case 'conflict':
      return '来源冲突'
    case 'ambiguousReference':
      return '引用歧义'
  }
}

async function copyText(
  text: string,
  customWriter?: (value: string) => Promise<void> | void,
): Promise<boolean> {
  try {
    if (customWriter) {
      await customWriter(text)
      return true
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
    return false
  } catch {
    return false
  }
}

function deriveTaskbooksFromRequirements(
  requirements: readonly M2RequirementItem[],
): readonly M1TaskbookReference[] {
  const seen = new Set<string>()
  const result: M1TaskbookReference[] = []
  for (const req of requirements) {
    const refId = req.anchor?.documentRef?.trim()
    if (!refId || seen.has(refId)) continue
    seen.add(refId)
    result.push({
      refId,
      documentName: req.anchor.documentName,
      page: req.anchor.page,
      excerpt: req.anchor.excerpt,
    })
  }
  return result
}

interface WorkbenchTracker {
  projectId: string
  draftRevision: string | null
  scopeEpoch: number
  writerEpoch: number
  strictEpochGuard: boolean
  strictEpochGuardByProject: Record<string, boolean>
  mounted: boolean
  requestSeq: number
  modelApiTestEpoch: number
  detectLocalAgentsEpoch: number
  registerLocalAgentEpoch: number
  modelListFetchEpoch: number
  commitRequestEpoch: number
  switchProjectEpoch: number
  takeoverRequestEpoch: number
  readonlyAuthGeneration: number
  readonlyAuthRequestEpoch: number
  retryDrawingEpoch: number
  drawingFailureGeneration: number
  drawingStateGeneration: number
  undoRequestEpoch: number
  migrationRequestEpoch: number
  activeChatRequestId: string | null
  activeTestRequestId: string | null
  lastEventSequence: number
}

export function ProjectAgentM1Workbench({
  bridge: bridgeProp,
  initialProjectId = 'proj-plate-01',
  initialProjectName = '安装板项目',
  initialBaseRevision = 'v1',
  initialDraftRevision = null,
  localProjects = DEFAULT_LOCAL_PROJECTS,
  availableObjects: availableObjectsProp,
  availableTaskbooks: availableTaskbooksProp,
  initialConnectionSnapshot,
  initialActivities = [],
  initialMessages = [],
  initialShowOnboarding = true,
  initialPreviewSnapshot,
  initialViewMode,
  initialSidebarSection = 'conversation',
  initialShowCompletionView = false,
  initialFormalVersions,
  initialUncommittedDrafts,
  initialRestoreStatus = null,
  initialMigrationReport = null,
  forceNarrowViewport,
  clipboardWriter,
  className,
}: ProjectAgentM1WorkbenchProps) {
  const probe: M1WorkbenchBridgeProbe = useMemo(() => {
    if (bridgeProp !== undefined) {
      return probeM1WorkbenchBridge(bridgeProp)
    }
    return resolveWindowM1WorkbenchBridge()
  }, [bridgeProp])

  const authProbe: M1ProjectAuthorizationProbe = useMemo(() => {
    if (bridgeProp !== undefined) {
      return probeM1ProjectAuthorization(bridgeProp)
    }
    return resolveWindowM1ProjectAuthorization()
  }, [bridgeProp])

  const connUxProbe: M1ConnectionUxBridgeProbe = useMemo(() => {
    if (bridgeProp !== undefined) {
      return probeM1ConnectionUxBridge(bridgeProp)
    }
    return resolveWindowM1ConnectionUxBridge()
  }, [bridgeProp])

  const m2Probe: M2WorkbenchBridgeProbe = useMemo(() => {
    if (bridgeProp !== undefined) {
      return probeM2WorkbenchBridge(bridgeProp)
    }
    return resolveWindowM2WorkbenchBridge()
  }, [bridgeProp])

  const m3Probe: M3WorkbenchBridgeProbe = useMemo(() => {
    if (bridgeProp !== undefined) {
      return probeM3WorkbenchBridge(bridgeProp)
    }
    return resolveWindowM3WorkbenchBridge()
  }, [bridgeProp])

  const resolvedInitialProjectId = initialConnectionSnapshot?.projectId ?? initialProjectId
  const resolvedInitialProjectName = initialConnectionSnapshot?.projectName ?? initialProjectName
  const resolvedInitialBaseRevision =
    initialConnectionSnapshot?.baseRevision !== undefined
      ? initialConnectionSnapshot.baseRevision
      : initialBaseRevision
  const resolvedInitialDraftRevision =
    initialConnectionSnapshot?.draftRevision !== undefined
      ? initialConnectionSnapshot.draftRevision
      : initialDraftRevision

  const [projectId, setProjectId] = useState(resolvedInitialProjectId)
  const [projectName, setProjectName] = useState(resolvedInitialProjectName)
  const [baseRevision, setBaseRevision] = useState<string | null>(resolvedInitialBaseRevision)
  const [draftRevision, setDraftRevision] = useState<string | null>(resolvedInitialDraftRevision)
  const [theme, setTheme] = useState<WorkbenchTheme>(() => readStoredWorkbenchTheme('light'))

  const handleToggleTheme = () => {
    setTheme((prev) => {
      const next: WorkbenchTheme = prev === 'light' ? 'dark' : 'light'
      persistWorkbenchTheme(next)
      return next
    })
  }

  const [connectionState, setConnectionState] = useState<M1ClientConnectionState>(
    initialConnectionSnapshot?.connectionState ?? 'disconnected',
  )
  const [connectionSource, setConnectionSource] = useState<M1ConnectionSource>(
    initialConnectionSnapshot?.source ?? 'none',
  )
  const [clientName, setClientName] = useState<string | null>(
    initialConnectionSnapshot?.clientName ?? null,
  )
  const [authorizationState, setAuthorizationState] = useState<M1ProjectAuthorizationState>(
    initialConnectionSnapshot?.authorizationState ?? 'unauthorized',
  )
  const [writerEpoch, setWriterEpoch] = useState<number>(
    initialConnectionSnapshot?.writerEpoch ?? 1,
  )
  const [scopeEpoch, setScopeEpoch] = useState<number>(1)
  const [subscriptionRetryNonce, setSubscriptionRetryNonce] = useState<number>(0)
  const [writerOwner, setWriterOwner] = useState<string | null>(
    initialConnectionSnapshot?.writerOwner ?? null,
  )

  const [showOnboarding, setShowOnboarding] = useState(initialShowOnboarding)
  const [onboardingChoice, setOnboardingChoice] = useState<OnboardingChoice>('local-agent')
  const [skippedConnection, setSkippedConnection] = useState(false)
  const [sidebarSection, setSidebarSection] = useState<M2SidebarSection>(initialSidebarSection)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('external')
  const [structureOpen, setStructureOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [connectionPopoverOpen, setConnectionPopoverOpen] = useState(false)
  const [attachPopoverOpen, setAttachPopoverOpen] = useState(false)

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

  // P1-2: Distinguish demo mode / explicit injected fixtures from real chat bridge mode.
  const hasRealChatBridge = probe.capabilities.builtinChat
  const [hasRealRequirementsContext, setHasRealRequirementsContext] = useState<boolean>(
    () => initialPreviewSnapshot?.requirements !== undefined,
  )

  // M2 Dual-View Canvas, Selection Context, Checks & Evidence state
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
      projectId: resolvedInitialProjectId,
      initialDraftRevision: resolvedInitialDraftRevision,
      initialBaseRevision: resolvedInitialBaseRevision,
      initialPreviewSnapshot: {
        ...initialPreviewSnapshot,
        features: resolvedInitialFeatures,
      },
      initialViewMode,
    }),
  )

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
  const [clarificationPendingId, setClarificationPendingId] = useState<string | null>(null)
  const [clarificationFeedback, setClarificationFeedback] = useState<
    Record<string, { readonly ok: boolean; readonly message: string }>
  >({})
  const [contextActionFeedback, setContextActionFeedback] = useState<string | null>(null)

  const objectListRegionRef = useRef<HTMLElement | null>(null)
  const canvasRegionRef = useRef<HTMLElement | null>(null)
  const sidebarRegionRef = useRef<HTMLElement | null>(null)
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const reconnectButtonRef = useRef<HTMLButtonElement | null>(null)
  const retryDrawingButtonRef = useRef<HTMLButtonElement | null>(null)
  const testModelApiButtonRef = useRef<HTMLButtonElement | null>(null)
  const retryChatButtonRef = useRef<HTMLButtonElement | null>(null)
  const [retryDrawingFailureSeq, setRetryDrawingFailureSeq] = useState(0)
  const [modelApiFailureSeq, setModelApiFailureSeq] = useState(0)

  // Local Agent config & auto-detection state
  const [installInfo, setInstallInfo] = useState<M1LocalAgentInstallInfo | null>(null)
  const [localAgentNotice, setLocalAgentNotice] = useState<string | null>(null)
  const [localAgentCopyFeedback, setLocalAgentCopyFeedback] = useState<string | null>(null)
  const [objectRefCopyFeedback, setObjectRefCopyFeedback] = useState<string | null>(null)
  const [statusChecking, setStatusChecking] = useState(false)
  const [detectedLocalAgents, setDetectedLocalAgents] = useState<readonly M1DetectedLocalAgent[]>(
    [],
  )
  const [detectingLocalAgents, setDetectingLocalAgents] = useState(false)
  const [localAgentDetectCompleted, setLocalAgentDetectCompleted] = useState(false)
  const [localAgentDetectError, setLocalAgentDetectError] = useState<string | null>(null)
  const [registeringAgentId, setRegisteringAgentId] = useState<M1LocalAgentId | null>(null)
  const [registerFeedback, setRegisterFeedback] = useState<{
    readonly ok: boolean
    readonly agentId: M1LocalAgentId
    readonly agentName: string
    readonly message: string
    readonly configPath?: string | null
    readonly backupPath?: string | null
    readonly requiresRestart?: boolean
  } | null>(null)

  // Model API form, provider preset, auto-fetched model list & test state
  const defaultProviderPreset = getModelApiProviderPreset(DEFAULT_M1_MODEL_API_PROVIDER_ID)
  const [apiProviderId, setApiProviderId] = useState<M1ModelApiProviderPresetId>(
    DEFAULT_M1_MODEL_API_PROVIDER_ID,
  )
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultProviderPreset.baseUrl)
  const [apiModel, setApiModel] = useState(defaultProviderPreset.defaultModel)
  const [apiKey, setApiKey] = useState('')
  const [availableApiModels, setAvailableApiModels] = useState<readonly string[]>([])
  const [modelListLoading, setModelListLoading] = useState(false)
  const [modelListNotice, setModelListNotice] = useState<string | null>(null)
  const [manualModelInputMode, setManualModelInputMode] = useState(false)
  const modelListDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apiModelRef = useRef(apiModel)
  useEffect(() => {
    apiModelRef.current = apiModel
  }, [apiModel])
  const [apiTesting, setApiTesting] = useState(false)
  const [modelApiTestResult, setModelApiTestResult] = useState<M1ModelApiTestResult | null>(null)
  const [testedModelApiConfigFingerprint, setTestedModelApiConfigFingerprint] = useState<
    string | null
  >(null)
  const [modelApiFailure, setModelApiFailure] = useState<{
    readonly title: string
    readonly detail: string
    readonly code?: string
  } | null>(null)

  // P1-2: Resolve available taskbooks strictly from explicit props, real project requirement anchors,
  // or demo defaults only when real chat bridge is unavailable.
  const availableTaskbooks: readonly M1TaskbookReference[] = useMemo(() => {
    if (availableTaskbooksProp !== undefined) {
      return availableTaskbooksProp
    }
    if (hasRealRequirementsContext) {
      return deriveTaskbooksFromRequirements(canvasState.requirements)
    }
    if (!hasRealChatBridge) {
      return DEFAULT_TASKBOOKS
    }
    return []
  }, [availableTaskbooksProp, hasRealRequirementsContext, canvasState.requirements, hasRealChatBridge])

  // Selection & taskbook context (synchronized with M2 canvas state)
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
  const [attachedRefIds, setAttachedRefIds] = useState<readonly string[]>(() => {
    const initialRefs =
      availableTaskbooksProp !== undefined
        ? availableTaskbooksProp
        : initialPreviewSnapshot?.requirements !== undefined
          ? deriveTaskbooksFromRequirements(initialPreviewSnapshot.requirements)
          : !hasRealChatBridge
            ? DEFAULT_TASKBOOKS
            : []
    return initialRefs.length > 0 ? [initialRefs[0].refId] : []
  })
  const [includeSelectedInChat, setIncludeSelectedInChat] = useState(true)

  // External activities & preview state
  const [activities, setActivities] = useState<readonly M1ExternalActivityItem[]>(initialActivities)
  const [activitiesNotice, setActivitiesNotice] = useState<string | null>(null)
  const [previewMessage, setPreviewMessage] = useState<string | null>(null)

  // Built-in chat state
  const [messages, setMessages] = useState<readonly WorkbenchChatMessage[]>(initialMessages)
  const [chatInput, setChatInput] = useState('')
  const [chatPending, setChatPending] = useState(false)
  const [chatNotice, setChatNotice] = useState<string | null>(null)
  const [lastFailedTurn, setLastFailedTurn] = useState<{
    readonly prompt: string
    readonly attachments: readonly M1TaskbookReference[]
    readonly selectedObject: M1SelectedObjectRef | null
  } | null>(null)

  // Disconnect / takeover & native read-only authorization pre-chain state (P1-5)
  const [takeoverNotice, setTakeoverNotice] = useState<string | null>(null)
  const [takeoverError, setTakeoverError] = useState<string | null>(null)
  const [takeoverPending, setTakeoverPending] = useState(false)
  const [readonlyAuthPending, setReadonlyAuthPending] = useState(false)
  const [readonlyAuthNotice, setReadonlyAuthNotice] = useState<string | null>(null)
  const [readonlyAuthError, setReadonlyAuthError] = useState<string | null>(null)
  const [selectedTakeoverTarget, setSelectedTakeoverTarget] = useState<
    'local-agent' | 'model-api' | ''
  >('')
  const [discardedStaleCount, setDiscardedStaleCount] = useState(0)

  // M3 Completion View, Bound Confirmation, External Notifications, History Restore & Migration state
  const [showCompletionView, setShowCompletionView] = useState<boolean>(initialShowCompletionView)
  const [pendingConfirmation, setPendingConfirmation] = useState<M3BoundConfirmation | null>(null)
  const [invalidatedConfirmationNotice, setInvalidatedConfirmationNotice] = useState<string | null>(
    null,
  )
  const [commitPending, setCommitPending] = useState(false)
  const [commitFeedback, setCommitFeedback] = useState<{
    readonly ok: boolean
    readonly message: string
  } | null>(null)
  const [undoPending, setUndoPending] = useState(false)
  const [undoFeedback, setUndoFeedback] = useState<string | null>(null)
  const [formalVersions, setFormalVersions] = useState<readonly M3FormalVersionItem[]>(() => {
    if (initialFormalVersions !== undefined) return initialFormalVersions
    if (!resolvedInitialBaseRevision) return []
    return [
      {
        revision: resolvedInitialBaseRevision,
        committedAtLabel: '已保存基线',
        summary: `${resolvedInitialProjectName} 正式基线版本`,
        isCurrent: true,
      },
    ]
  })
  const [uncommittedDrafts, setUncommittedDrafts] = useState<readonly M3UncommittedDraftItem[]>(
    () => {
      if (initialUncommittedDrafts !== undefined) return initialUncommittedDrafts
      if (!resolvedInitialDraftRevision) return []
      return [
        {
          draftRevision: resolvedInitialDraftRevision,
          baseRevision: resolvedInitialBaseRevision,
          updatedAtLabel: '当前工作草稿',
          status: 'in_progress',
          summary: '尚未提交的独立草稿修订',
          canUndo: true,
        },
      ]
    },
  )
  const [restoreStatus, setRestoreStatus] = useState<M3ReopenRestoreStatus | null>(
    initialRestoreStatus,
  )
  const [migrationReport, setMigrationReport] = useState<M3MigrationReport | null>(
    initialMigrationReport,
  )
  const [migrationDrawerOpen, setMigrationDrawerOpen] = useState(false)
  const [migrationLoading, setMigrationLoading] = useState(false)
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null)
  const [externalNotifications, setExternalNotifications] = useState<
    readonly M3ExternalProjectEvent[]
  >([])
  const [externalOpenPendingId, setExternalOpenPendingId] = useState<string | null>(null)
  const [externalOpenFeedback, setExternalOpenFeedback] = useState<string | null>(null)
  const externalNotificationWatermarksRef = useRef<M3ExternalNotificationWatermarks>({})
  const confirmSeqRef = useRef(0)

  const trackerRef = useRef<WorkbenchTracker>({
    mounted: true,
    projectId: resolvedInitialProjectId,
    draftRevision: resolvedInitialDraftRevision,
    scopeEpoch: 1,
    writerEpoch: initialConnectionSnapshot?.writerEpoch ?? 1,
    strictEpochGuard: false,
    strictEpochGuardByProject: {},
    requestSeq: 0,
    modelApiTestEpoch: 0,
    detectLocalAgentsEpoch: 0,
    registerLocalAgentEpoch: 0,
    modelListFetchEpoch: 0,
    commitRequestEpoch: 0,
    switchProjectEpoch: 0,
    takeoverRequestEpoch: 0,
    readonlyAuthGeneration: 0,
    readonlyAuthRequestEpoch: 0,
    retryDrawingEpoch: 0,
    drawingFailureGeneration: initialPreviewSnapshot?.drawingFailure ? 1 : 0,
    drawingStateGeneration:
      initialPreviewSnapshot?.drawingFailure || initialPreviewSnapshot?.drawing?.status === 'ready'
        ? 1
        : 0,
    undoRequestEpoch: 0,
    migrationRequestEpoch: 0,
    activeChatRequestId: null,
    activeTestRequestId: null,
    lastEventSequence: 0,
  })

  useEffect(() => {
    trackerRef.current.draftRevision = draftRevision
  }, [draftRevision])

  const canvasStateRef = useRef(canvasState)

  useEffect(() => {
    canvasStateRef.current = canvasState
    trackerRef.current.drawingFailureGeneration = canvasState.drawingFailureGeneration
    trackerRef.current.drawingStateGeneration = canvasState.drawingStateGeneration
  }, [canvasState])

  const applyConnectionSnapshot = useCallback((snap: M1ConnectionStatusSnapshot) => {
    setConnectionState(snap.connectionState)
    setConnectionSource(snap.source)
    setClientName(snap.clientName)
    setAuthorizationState(snap.authorizationState)
    setDraftRevision(snap.draftRevision)
    if (snap.baseRevision !== undefined) setBaseRevision(snap.baseRevision)
    if (snap.projectName) setProjectName(snap.projectName)
    setWriterEpoch(snap.writerEpoch)
    trackerRef.current.writerEpoch = snap.writerEpoch
    setWriterOwner(snap.writerOwner ?? null)
  }, [])

  // P1-1: Synchronize authoritative scopeEpoch from AUTH_REQUIRED.detail and reset writerEpoch
  // baseline to 0 so the subsequent authoritative snapshot_required frame can establish the new writerEpoch.
  const syncScopeEpochFromAuthError = useCallback((error: M1WorkbenchErrorPayload): number | null => {
    const tracker = trackerRef.current
    const sync = applyAuthoritativeScopeEpochSync(tracker, error)
    if (!sync.changed) return null
    tracker.scopeEpoch = sync.next.scopeEpoch
    tracker.writerEpoch = sync.next.writerEpoch
    setScopeEpoch(sync.next.scopeEpoch)
    setWriterEpoch(sync.next.writerEpoch)
    return sync.next.scopeEpoch
  }, [])

  const allocateRequestId = (prefix: string): string => {
    const tracker = trackerRef.current
    tracker.requestSeq += 1
    return `${prefix}-e${tracker.scopeEpoch}-r${tracker.requestSeq}`
  }

  // Load local agent install info if wired
  useEffect(() => {
    const tracker = trackerRef.current
    tracker.mounted = true
    if (!probe.capabilities.localAgentInstallInfo || !probe.bridge.getM1LocalAgentInstallInfo) {
      return () => {
        tracker.mounted = false
      }
    }
    let cancelled = false
    void probe.bridge
      .getM1LocalAgentInstallInfo()
      .then((res) => {
        if (cancelled || !tracker.mounted) return
        if (res.ok) {
          setInstallInfo(res.value)
        }
      })
      .catch(() => {
        // Keep honest fallback display
      })
    return () => {
      cancelled = true
      tracker.mounted = false
    }
  }, [probe])

  // Subscribe to workbench events if wired; discard events from older scopeEpoch/writerEpoch
  // and handle M1-BE-02D `afterSequence` + `snapshot_required` cursor reset frames.
  // R-A: `subscriptionRetryNonce` triggers re-subscription immediately after native read-only
  // authorization succeeds when initial subscribe returned AUTH_REQUIRED without a detail epoch.
  useEffect(() => {
    void subscriptionRetryNonce
    if (!probe.capabilities.eventSubscription || !probe.bridge.subscribeM1WorkbenchEvents) {
      return
    }
    let active = true
    let unsubscribe: (() => void) | undefined

    const handleIncomingEvent = (event: M1WorkbenchIncomingEvent) => {
      const tracker = trackerRef.current
      if (!active || !tracker.mounted) return
      if (!isEventAcceptedForScope(tracker, event)) {
        setDiscardedStaleCount((count) => count + 1)
        return
      }
      const seqDecision = shouldAcceptWorkbenchEventSequence(tracker.lastEventSequence, event)
      if (!seqDecision.accepted) {
        return
      }
      tracker.lastEventSequence = seqDecision.nextLastSequence

      if (event.type === 'snapshot_required') {
        if (event.snapshot) {
          applyConnectionSnapshot(event.snapshot)
        } else {
          if (event.baseRevision !== undefined) setBaseRevision(event.baseRevision)
          if (event.draftRevision !== undefined) setDraftRevision(event.draftRevision)
          tracker.writerEpoch = event.writerEpoch
          setWriterEpoch(event.writerEpoch)
        }
        if (event.activities) {
          setActivities(event.activities)
        }
        return
      }

      if (event.type === 'connection_changed' && event.connectionState) {
        setConnectionState(event.connectionState)
        if (event.clientName !== undefined) {
          setClientName(event.clientName)
        }
      } else if (event.type === 'draft_updated' && event.draftRevision !== undefined) {
        setDraftRevision(event.draftRevision)
      } else if (event.type === 'activity_updated' && event.activity) {
        const incoming = event.activity
        setActivities((prev) => {
          const idx = prev.findIndex((item) => item.taskId === incoming.taskId)
          if (idx === -1) return [incoming, ...prev]
          const next = [...prev]
          next[idx] = incoming
          return next
        })
      } else if (event.type === 'chat_reply' && event.chatMessage) {
        const { messageId, reply } = event.chatMessage
        setMessages((prev) => [
          ...prev,
          { id: messageId, role: 'assistant', content: reply, status: 'sent' },
        ])
      }
    }

    const subscribeRequest =
      trackerRef.current.lastEventSequence > 0
        ? { projectId, scopeEpoch, afterSequence: trackerRef.current.lastEventSequence }
        : { projectId, scopeEpoch }

    void probe.bridge
      .subscribeM1WorkbenchEvents(subscribeRequest, handleIncomingEvent)
      .then((res) => {
        if (!res.ok) {
          if (active && trackerRef.current.mounted) {
            syncScopeEpochFromAuthError(res.error)
          }
          return
        }
        if (res.value.unsubscribe) {
          if (!active) {
            res.value.unsubscribe()
          } else {
            unsubscribe = res.value.unsubscribe
          }
        }
      })
      .catch(() => {
        // Ignore subscription error; status stays honest
      })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [
    probe,
    projectId,
    scopeEpoch,
    subscriptionRetryNonce,
    applyConnectionSnapshot,
    syncScopeEpochFromAuthError,
  ])

  // Subscribe to M2 preview/artifact/check events if wired (with out-of-order / late event guard)
  useEffect(() => {
    if (!m2Probe.capabilities.previewEvents || !m2Probe.bridge.subscribeM2PreviewEvents) {
      return
    }
    let active = true
    let unsubscribe: (() => void) | undefined

    const handlePreviewEvent = (event: M2PreviewEvent) => {
      const tracker = trackerRef.current
      if (!active || !tracker.mounted) return
      if (!isScopedArtifactEventAccepted(tracker, event)) {
        setDiscardedStaleCount((count) => count + 1)
        return
      }
      if (event.requirements !== undefined) {
        setHasRealRequirementsContext(true)
      }
      setCanvasState((prev) => {
        const next = reduceM2PreviewEvent(prev, event)
        tracker.drawingFailureGeneration = next.drawingFailureGeneration
        tracker.drawingStateGeneration = next.drawingStateGeneration
        if (next.currentRevision && next.currentRevision !== prev.currentRevision) {
          if (/^draft/i.test(next.currentRevision)) {
            setDraftRevision(next.currentRevision)
          }
        }
        return next
      })
    }

    void m2Probe.bridge
      .subscribeM2PreviewEvents({ projectId }, handlePreviewEvent)
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
  }, [m2Probe, projectId, scopeEpoch, subscriptionRetryNonce])

  // Subscribe to M3 external project modification events (current project auto-refresh,
  // non-current project non-disruptive notification)
  useEffect(() => {
    if (
      !m3Probe.capabilities.externalProjectEvents ||
      !m3Probe.bridge.subscribeM3ExternalProjectEvents
    ) {
      return
    }
    let active = true
    let unsubscribe: (() => void) | undefined

    const handleExternalProjectEvent = (event: M3ExternalProjectEvent) => {
      const tracker = trackerRef.current
      if (!active || !tracker.mounted) return

      // Target project is the currently open foreground project -> auto-refresh preview
      // protected by M2 out-of-order / late event guard and F04 takeover epoch guard.
      if (event.projectId === tracker.projectId) {
        const effectiveScopeEpoch =
          event.previewEvent?.scopeEpoch !== undefined
            ? event.previewEvent.scopeEpoch
            : event.scopeEpoch
        const effectiveWriterEpoch =
          event.previewEvent?.writerEpoch !== undefined
            ? event.previewEvent.writerEpoch
            : event.writerEpoch
        if (
          !isScopedArtifactEventAccepted(tracker, {
            projectId: event.projectId,
            scopeEpoch: effectiveScopeEpoch,
            writerEpoch: effectiveWriterEpoch,
          })
        ) {
          setDiscardedStaleCount((count) => count + 1)
          return
        }
        const previewEvent: M2PreviewEvent = event.previewEvent ?? {
          projectId: event.projectId,
          sequence: event.sequence,
          revision: event.draftRevision,
          revisionOrder: event.revisionOrder,
          isDraft: true,
          fingerprint: event.fingerprint ?? undefined,
          scopeEpoch: effectiveScopeEpoch,
          writerEpoch: effectiveWriterEpoch,
          type: 'revision_refreshed',
          summary: event.summary,
        }
        setCanvasState((prev) => {
          const next = reduceM2PreviewEvent(prev, previewEvent)
          tracker.drawingFailureGeneration = next.drawingFailureGeneration
          tracker.drawingStateGeneration = next.drawingStateGeneration
          if (next.currentRevision && next.currentRevision !== prev.currentRevision) {
            if (/^draft/i.test(next.currentRevision)) {
              setDraftRevision(next.currentRevision)
            }
          }
          return next
        })
        return
      }

      // Target project is NOT the foreground project -> do NOT disrupt foreground canvas/chat;
      // show non-intrusive notification with "打开查看" (F12 + E6 + N4 persistent per-project watermarks).
      if (
        !isExternalNotificationNewerThanWatermark(
          externalNotificationWatermarksRef.current[event.projectId],
          event,
        )
      ) {
        return
      }
      externalNotificationWatermarksRef.current = {
        ...externalNotificationWatermarksRef.current,
        [event.projectId]: computeNextExternalNotificationWatermark(
          externalNotificationWatermarksRef.current[event.projectId],
          event,
        ),
      }
      setExternalNotifications((prev) => mergeExternalProjectNotification(prev, event))
    }

    void m3Probe.bridge
      .subscribeM3ExternalProjectEvents(handleExternalProjectEvent)
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
  }, [m3Probe, projectId, scopeEpoch, subscriptionRetryNonce])

  // Bidirectional highlight sets (feature <-> annotation + evidence localization)
  const highlightedFeatureIds = useMemo(() => {
    const ids = new Set<string>()
    if (canvasState.selectedObjectId) {
      ids.add(canvasState.selectedObjectId)
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
    canvasState.selectedObjectId,
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

  const handleChangeViewMode = (mode: M2ViewMode) => {
    setCanvasState((prev) => ({
      ...prev,
      viewMode: mode,
      lastSingleTab: mode === 'model' || mode === 'drawing' ? mode : prev.lastSingleTab,
    }))
  }

  const handleSelectFeature = (feature: M2ModelFeatureItem) => {
    setEvidenceHighlightFeatures([])
    setEvidenceHighlightAnnotations([])
    setContextActionFeedback(null)
    setCanvasState((prev) => ({
      ...prev,
      selectedObjectId: feature.objectId,
      selectedAnnotationId: null,
      selectionInvalidated: false,
      invalidatedObjectLabel: null,
    }))
  }

  const handleSelectAnnotation = (annotation: M2DrawingAnnotationItem) => {
    setEvidenceHighlightFeatures([])
    setEvidenceHighlightAnnotations([])
    setContextActionFeedback(null)
    setCanvasState((prev) => ({
      ...prev,
      selectedAnnotationId: annotation.annotationId,
      selectedObjectId: annotation.linkedFeatureIds[0] ?? prev.selectedObjectId,
      selectionInvalidated: false,
      invalidatedObjectLabel: null,
    }))
  }

  const handleClearSelection = () => {
    setEvidenceHighlightFeatures([])
    setEvidenceHighlightAnnotations([])
    setActiveCheckId(null)
    setContextActionFeedback('已取消当前几何对象选择。')
    setCanvasState((prev) => ({
      ...prev,
      selectedObjectId: null,
      selectedAnnotationId: null,
      selectionInvalidated: false,
      invalidatedObjectLabel: null,
    }))
  }

  const handleBringIntoNextPrompt = () => {
    if (!selectedObject) return
    setIncludeSelectedInChat(true)
    const mention = `针对「${selectedObject.breadcrumb}」：`
    setChatInput((prev) => (prev.includes(selectedObject.breadcrumb) ? prev : `${mention}${prev}`))
    setSidebarSection('conversation')
    setSidebarTab('builtin')
    setContextActionFeedback(`已将「${selectedObject.breadcrumb}」带入下一句话上下文。`)
    queueMicrotask(() => {
      chatInputRef.current?.focus()
    })
  }

  const handleCopyToExternalSession = () => {
    if (!selectedObject) return
    void copyText(formatSelectedObjectReference(selectedObject), clipboardWriter).then((ok) => {
      const msg = ok
        ? `已复制到外部会话：${formatSelectedObjectReference(selectedObject)}`
        : '复制到外部会话失败，请手动复制对象引用'
      setContextActionFeedback(msg)
      setObjectRefCopyFeedback(msg)
    })
  }

  const handleRetryDrawing = async (): Promise<void> => {
    const failedRev = canvasState.drawingFailure?.failedRevision ?? canvasState.currentRevision
    if (!failedRev) return
    setRetryDrawingFeedback(null)
    if (!m2Probe.capabilities.retryDrawing || !m2Probe.bridge.retryM2Drawing) {
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
      result = await m2Probe.bridge.retryM2Drawing({
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
    // S2: Verify projectId, switchProjectEpoch, scopeEpoch & retryDrawingEpoch on async return.
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
      setDiscardedStaleCount((c) => c + 1)
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
      setDiscardedStaleCount((c) => c + 1)
      return
    }
    // S5 / N2 / P1-4 / R-C: Update drawing slot, annotations & history directly WITHOUT advancing
    // server sequence watermarks, strictly verify expectedDrawingFailureGeneration &
    // expectedDrawingStateGeneration, and NEVER report false success when the reducer rejects
    // an older-revision retry (e.g. model advanced from draft-8 to draft-9 while retry was pending).
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
      setDiscardedStaleCount((c) => c + 1)
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
          setDiscardedStaleCount((c) => c + 1)
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
      setCanvasState((prev) => ({
        ...prev,
        selectedObjectId: params.linkedFeatureIds[0],
        selectedAnnotationId: params.linkedAnnotationIds[0] ?? null,
        selectionInvalidated: false,
      }))
    }
    setEvidenceNotice(null)

    if (!m2Probe.capabilities.locateM2Evidence || !m2Probe.bridge.locateM2Evidence) {
      setActiveEvidence(null)
      setEvidenceNotice(
        '后端尚未接线/不可用（缺失方法：locateM2Evidence），无法向后端请求最新原文页与选区定位；已按本地映射同步高亮模型特征与图纸标注。',
      )
      return
    }

    setEvidenceLoading(true)
    let result
    try {
      result = await m2Probe.bridge.locateM2Evidence({
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
    setSidebarSection('checks')
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
    if (!m2Probe.capabilities.submitClarification || !m2Probe.bridge.submitM2Clarification) {
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
      result = await m2Probe.bridge.submitM2Clarification({
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

  const focusObjectListRegion = () => {
    if (!structureOpen) {
      flushSync(() => {
        setStructureOpen(true)
      })
    }
    objectListRegionRef.current?.focus()
  }

  const handleWorkbenchKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      if (moreMenuOpen) setMoreMenuOpen(false)
      if (connectionPopoverOpen) setConnectionPopoverOpen(false)
      if (attachPopoverOpen) setAttachPopoverOpen(false)
      return
    }
    if (event.key === 'F6') {
      event.preventDefault()
      const active = document.activeElement
      const regionSlots = [
        objectListRegionRef.current,
        canvasRegionRef.current,
        sidebarRegionRef.current,
      ]
      const currentIdx = regionSlots.findIndex(
        (region) => region !== null && (region === active || region.contains(active)),
      )
      const delta = event.shiftKey ? -1 : 1
      const nextIdx =
        currentIdx === -1
          ? event.shiftKey
            ? 2
            : 0
          : (currentIdx + delta + 3) % 3
      if (nextIdx === 0) {
        focusObjectListRegion()
      } else if (nextIdx === 1) {
        canvasRegionRef.current?.focus()
      } else {
        sidebarRegionRef.current?.focus()
      }
      return
    }
    if (event.altKey && event.key === '1') {
      event.preventDefault()
      focusObjectListRegion()
    } else if (event.altKey && event.key === '2') {
      event.preventDefault()
      canvasRegionRef.current?.focus()
    } else if (event.altKey && event.key === '3') {
      event.preventDefault()
      sidebarRegionRef.current?.focus()
    }
  }

  const localAgentConfig = useMemo(
    () => buildLocalAgentConfigSnippet(installInfo),
    [installInfo],
  )

  const attachedTaskbooks = useMemo(
    () => availableTaskbooks.filter((item) => attachedRefIds.includes(item.refId)),
    [availableTaskbooks, attachedRefIds],
  )

  const outgoingContextSummary: M1OutgoingContextSummary = useMemo(
    () => ({
      projectId,
      projectName,
      draftRevision,
      selectedObject: includeSelectedInChat ? selectedObject : null,
      documentExcerpts: attachedTaskbooks,
    }),
    [projectId, projectName, draftRevision, includeSelectedInChat, selectedObject, attachedTaskbooks],
  )

  const currentModelApiConfigFingerprint = useMemo(
    () =>
      computeModelApiConfigFingerprint({
        baseUrl: apiBaseUrl,
        model: apiModel,
        apiKey,
      }),
    [apiBaseUrl, apiModel, apiKey],
  )

  const builtinUnlocked = canUseBuiltinModelApiChat({
    testResult: modelApiTestResult,
    testedConfigFingerprint: testedModelApiConfigFingerprint,
    currentConfigFingerprint: currentModelApiConfigFingerprint,
    connectionState,
    connectionSource,
  })

  const showDisconnectBanner =
    connectionState === 'disconnected' &&
    (connectionSource !== 'none' ||
      draftRevision !== null ||
      activities.length > 0 ||
      messages.length > 0 ||
      initialConnectionSnapshot?.connectionState === 'disconnected')

  // Part 1 §3 Error-focus recovery: automatically land focus on primary recovery
  // buttons when entering an error state, without stealing focus from editable inputs.
  const prevShowDisconnectRef = useRef(false)
  useEffect(() => {
    if (showDisconnectBanner && !prevShowDisconnectRef.current && !takeoverPending) {
      focusRecoveryElement(reconnectButtonRef.current)
    }
    prevShowDisconnectRef.current = showDisconnectBanner
  }, [showDisconnectBanner, takeoverPending])

  const prevDrawingFailureKeyRef = useRef<string>('')
  useEffect(() => {
    if (!canvasState.drawingFailure) {
      prevDrawingFailureKeyRef.current = ''
      return
    }
    if (retryDrawingPending) return
    const nextKey = `${canvasState.drawingFailureGeneration}:${retryDrawingFailureSeq}:${canvasState.drawingFailure.failedRevision}`
    if (prevDrawingFailureKeyRef.current !== nextKey) {
      prevDrawingFailureKeyRef.current = nextKey
      focusRecoveryElement(retryDrawingButtonRef.current)
    }
  }, [
    canvasState.drawingFailure,
    canvasState.drawingFailureGeneration,
    retryDrawingFailureSeq,
    retryDrawingPending,
  ])

  const prevModelApiFailureSeqRef = useRef(0)
  useEffect(() => {
    if (!modelApiFailure || apiTesting) return
    if (prevModelApiFailureSeqRef.current !== modelApiFailureSeq) {
      prevModelApiFailureSeqRef.current = modelApiFailureSeq
      focusRecoveryElement(testModelApiButtonRef.current)
    }
  }, [modelApiFailure, modelApiFailureSeq, apiTesting])

  const prevFailedTurnRef = useRef<typeof lastFailedTurn>(null)
  useEffect(() => {
    if (!lastFailedTurn) {
      prevFailedTurnRef.current = null
      return
    }
    if (chatPending) return
    if (prevFailedTurnRef.current !== lastFailedTurn) {
      prevFailedTurnRef.current = lastFailedTurn
      focusRecoveryElement(retryChatButtonRef.current)
    }
  }, [lastFailedTurn, chatPending])

  const handleCopy = useCallback(
    async (text: string, label: string, target: 'local-agent' | 'object-ref') => {
      const ok = await copyText(text, clipboardWriter)
      const spacer = /^[A-Za-z0-9]/.test(label) ? ' ' : ''
      const message = ok
        ? `已复制${spacer}${label}`
        : `复制${spacer}${label}失败，请手动复制`
      if (target === 'local-agent') {
        setLocalAgentCopyFeedback(message)
      } else {
        setObjectRefCopyFeedback(message)
      }
    },
    [clipboardWriter],
  )

  const handleRefreshConnectionStatus = async (): Promise<void> => {
    setLocalAgentNotice(null)
    if (!probe.capabilities.connectionStatus || !probe.bridge.getM1ConnectionStatus) {
      setLocalAgentNotice('后端尚未接线/不可用（缺失方法：getM1ConnectionStatus），无法检测本地 Agent 状态。')
      return
    }
    const tracker = trackerRef.current
    const captured = {
      projectId: tracker.projectId,
      scopeEpoch: tracker.scopeEpoch,
      writerEpoch: tracker.writerEpoch,
    }
    setStatusChecking(true)
    let result
    try {
      result = await probe.bridge.getM1ConnectionStatus({
        projectId: captured.projectId,
        scopeEpoch: captured.scopeEpoch,
      })
    } catch (err) {
      result = {
        ok: false as const,
        error: normalizeWorkbenchBridgeError(err, '检测本地 Agent 状态失败'),
      }
    }
    if (!tracker.mounted || !isReplyAcceptedForScope(tracker, captured)) {
      setDiscardedStaleCount((c) => c + 1)
      return
    }
    setStatusChecking(false)
    if (!result.ok) {
      syncScopeEpochFromAuthError(result.error)
      setLocalAgentNotice(`检测失败（${result.error.code}）：${result.error.message}`)
      return
    }
    const snap = result.value
    applyConnectionSnapshot(snap)
    setLocalAgentNotice(
      snap.connectionState === 'connected'
        ? `已检测到客户端 ${snap.clientName ?? '本地 Agent'} 握手成功。`
        : '当前尚未检测到已握手的本地 Agent 客户端。',
    )
  }

  const currentProviderPreset = useMemo(
    () => getModelApiProviderPreset(apiProviderId),
    [apiProviderId],
  )

  const sortedDetectedLocalAgents = useMemo(
    () => sortDetectedLocalAgents(detectedLocalAgents),
    [detectedLocalAgents],
  )

  const clearPendingModelListDebounce = useCallback(() => {
    if (modelListDebounceTimerRef.current !== null) {
      clearTimeout(modelListDebounceTimerRef.current)
      modelListDebounceTimerRef.current = null
    }
  }, [])

  const invalidateModelListFetch = useCallback(() => {
    clearPendingModelListDebounce()
    trackerRef.current.modelListFetchEpoch += 1
    setModelListLoading(false)
  }, [clearPendingModelListDebounce])

  const resetModelApiUnlock = useCallback(() => {
    const tracker = trackerRef.current
    // F03: Immediately invalidate any in-flight model API test request generation
    // so a late success reply for previous form values cannot unlock the edited form.
    tracker.modelApiTestEpoch += 1
    tracker.activeTestRequestId = null
    setApiTesting(false)
    setModelApiTestResult(null)
    setTestedModelApiConfigFingerprint(null)
    setModelApiFailure(null)
  }, [])

  const handleDetectLocalAgents = useCallback(async (): Promise<void> => {
    const tracker = trackerRef.current
    tracker.detectLocalAgentsEpoch += 1
    const capturedEpoch = tracker.detectLocalAgentsEpoch
    setLocalAgentDetectError(null)

    if (!connUxProbe.capabilities.detectLocalAgents || !connUxProbe.bridge.detectM1LocalAgents) {
      setDetectingLocalAgents(false)
      setLocalAgentDetectCompleted(false)
      setDetectedLocalAgents([])
      return
    }

    setDetectingLocalAgents(true)
    let result
    try {
      result = await connUxProbe.bridge.detectM1LocalAgents()
    } catch (err) {
      result = {
        ok: false as const,
        error: normalizeWorkbenchBridgeError(err, '检测本地 Agent 客户端失败'),
      }
    }

    if (!tracker.mounted || tracker.detectLocalAgentsEpoch !== capturedEpoch) {
      return
    }

    setDetectingLocalAgents(false)
    setLocalAgentDetectCompleted(true)
    if (!result.ok) {
      setLocalAgentDetectError(`检测失败（${result.error.code}）：${result.error.message}`)
      return
    }
    setDetectedLocalAgents(result.value.agents)
  }, [connUxProbe])

  useEffect(() => {
    if (
      !showOnboarding ||
      onboardingChoice !== 'local-agent' ||
      !connUxProbe.capabilities.detectLocalAgents ||
      !connUxProbe.bridge.detectM1LocalAgents
    ) {
      return
    }
    const tracker = trackerRef.current
    tracker.detectLocalAgentsEpoch += 1
    const capturedEpoch = tracker.detectLocalAgentsEpoch
    let cancelled = false

    void connUxProbe.bridge
      .detectM1LocalAgents()
      .then((result) => {
        if (cancelled || !tracker.mounted || tracker.detectLocalAgentsEpoch !== capturedEpoch) {
          return
        }
        setDetectingLocalAgents(false)
        setLocalAgentDetectCompleted(true)
        if (!result.ok) {
          setLocalAgentDetectError(`检测失败（${result.error.code}）：${result.error.message}`)
          return
        }
        setLocalAgentDetectError(null)
        setDetectedLocalAgents(result.value.agents)
      })
      .catch((err) => {
        if (cancelled || !tracker.mounted || tracker.detectLocalAgentsEpoch !== capturedEpoch) {
          return
        }
        const normalized = normalizeWorkbenchBridgeError(err, '检测本地 Agent 客户端失败')
        setDetectingLocalAgents(false)
        setLocalAgentDetectCompleted(true)
        setLocalAgentDetectError(`检测失败（${normalized.code}）：${normalized.message}`)
      })

    return () => {
      cancelled = true
      tracker.detectLocalAgentsEpoch += 1
    }
  }, [showOnboarding, onboardingChoice, connUxProbe])

  const handleRegisterLocalAgent = useCallback(
    async (agent: M1DetectedLocalAgent): Promise<void> => {
      setRegisterFeedback(null)
      if (
        !connUxProbe.capabilities.registerLocalAgent ||
        !connUxProbe.bridge.registerM1LocalAgent
      ) {
        setRegisterFeedback({
          ok: false,
          agentId: agent.id,
          agentName: agent.name,
          message:
            '后端尚未接线/不可用（缺失方法：registerM1LocalAgent），请展开下方手动复制 MCP 配置。',
        })
        return
      }

      const tracker = trackerRef.current
      tracker.registerLocalAgentEpoch += 1
      const capturedEpoch = tracker.registerLocalAgentEpoch
      setRegisteringAgentId(agent.id)

      let result
      try {
        result = await connUxProbe.bridge.registerM1LocalAgent({ agentId: agent.id })
      } catch (err) {
        result = {
          ok: false as const,
          error: normalizeWorkbenchBridgeError(err, `配置 ${agent.name} 连接失败`),
        }
      }

      if (!tracker.mounted || tracker.registerLocalAgentEpoch !== capturedEpoch) {
        return
      }

      setRegisteringAgentId(null)
      if (!result.ok) {
        setRegisterFeedback({
          ok: false,
          agentId: agent.id,
          agentName: agent.name,
          message: `配置 ${agent.name} 失败（${result.error.code}）：${result.error.message}`,
        })
        return
      }

      const registered = result.value
      setDetectedLocalAgents((prev) =>
        prev.map((item) =>
          item.id === registered.agentId
            ? {
                ...item,
                configured: true,
                configPath: registered.configPath ?? item.configPath,
              }
            : item,
        ),
      )
      setRegisterFeedback({
        ok: true,
        agentId: registered.agentId,
        agentName: registered.name,
        message: registered.message || `已为 ${registered.name} 配置寸链连接`,
        configPath: registered.configPath,
        backupPath: registered.backupPath,
        requiresRestart: registered.requiresRestart,
      })
    },
    [connUxProbe],
  )

  const fetchModelApiModels = useCallback(
    async (params: {
      readonly baseUrl: string
      readonly apiKey: string
      readonly providerId: M1ModelApiProviderPresetId
      readonly explicit?: boolean
    }): Promise<void> => {
      clearPendingModelListDebounce()
      const tracker = trackerRef.current
      tracker.modelListFetchEpoch += 1
      const capturedFetchEpoch = tracker.modelListFetchEpoch
      const capturedProjectId = tracker.projectId
      const capturedScopeEpoch = tracker.scopeEpoch

      if (!canAutoFetchModelApiModels(params)) {
        setModelListLoading(false)
        if (params.explicit) {
          const preset = getModelApiProviderPreset(params.providerId)
          setModelListNotice(
            preset.apiKeyOptional
              ? '请先填写有效的服务地址（http:// 或 https://）后再刷新模型列表。'
              : '请先填写有效的服务地址与密钥后再刷新模型列表。',
          )
        }
        return
      }

      if (
        !connUxProbe.capabilities.listModelApiModels ||
        !connUxProbe.bridge.listM1ModelApiModels
      ) {
        setAvailableApiModels([])
        setModelListLoading(false)
        setModelListNotice('当前环境未接线自动拉取模型列表，请直接输入模型名。')
        return
      }

      const requestId = allocateRequestId('model-list')
      setModelListLoading(true)
      setModelListNotice(null)

      let result
      try {
        result = await connUxProbe.bridge.listM1ModelApiModels({
          baseUrl: params.baseUrl.trim(),
          apiKey: params.apiKey.trim(),
          projectId: capturedProjectId,
          requestId,
          scopeEpoch: capturedScopeEpoch,
        })
      } catch (err) {
        result = {
          ok: false as const,
          error: normalizeWorkbenchBridgeError(err, '拉取模型列表失败'),
        }
      }

      if (
        !tracker.mounted ||
        tracker.modelListFetchEpoch !== capturedFetchEpoch ||
        tracker.projectId !== capturedProjectId ||
        tracker.scopeEpoch !== capturedScopeEpoch
      ) {
        return
      }

      setModelListLoading(false)
      if (!result.ok) {
        setAvailableApiModels([])
        setModelListNotice(
          `自动拉取模型列表失败（${result.error.code}）：${result.error.message}，请手动输入模型名继续测试。`,
        )
        return
      }

      const cleanedModels: string[] = []
      const seen = new Set<string>()
      for (const raw of result.value.models) {
        const trimmed = raw.trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        cleanedModels.push(trimmed)
      }

      if (cleanedModels.length === 0) {
        setAvailableApiModels([])
        setModelListNotice('服务商未返回可用模型列表，请手动输入模型名继续测试。')
        return
      }

      const preset = getModelApiProviderPreset(params.providerId)
      const preferred = selectPreferredModelFromList({
        models: cleanedModels,
        defaultModel: result.value.defaultModel,
        presetDefaultModel: preset.defaultModel,
      })

      setAvailableApiModels(cleanedModels)
      setManualModelInputMode(false)
      setModelListNotice(null)
      if (preferred && preferred !== apiModelRef.current) {
        setApiModel(preferred)
        resetModelApiUnlock()
      }
    },
    [clearPendingModelListDebounce, connUxProbe, resetModelApiUnlock],
  )

  const effectiveModelListNotice = useMemo(() => {
    if (modelListNotice) return modelListNotice
    if (
      showOnboarding &&
      onboardingChoice === 'model-api' &&
      !connUxProbe.capabilities.listModelApiModels &&
      canAutoFetchModelApiModels({
        baseUrl: apiBaseUrl,
        apiKey,
        providerId: apiProviderId,
      })
    ) {
      return '当前环境未接线自动拉取模型列表，请直接输入模型名。'
    }
    return null
  }, [
    modelListNotice,
    showOnboarding,
    onboardingChoice,
    connUxProbe.capabilities.listModelApiModels,
    apiBaseUrl,
    apiKey,
    apiProviderId,
  ])

  useEffect(() => {
    clearPendingModelListDebounce()
    const tracker = trackerRef.current
    tracker.modelListFetchEpoch += 1

    if (!showOnboarding || onboardingChoice !== 'model-api') {
      return
    }

    if (
      !canAutoFetchModelApiModels({
        baseUrl: apiBaseUrl,
        apiKey,
        providerId: apiProviderId,
      })
    ) {
      return
    }

    if (!connUxProbe.capabilities.listModelApiModels) {
      return
    }

    modelListDebounceTimerRef.current = setTimeout(() => {
      modelListDebounceTimerRef.current = null
      void fetchModelApiModels({
        baseUrl: apiBaseUrl,
        apiKey,
        providerId: apiProviderId,
      })
    }, 400)

    return () => {
      clearPendingModelListDebounce()
      tracker.modelListFetchEpoch += 1
    }
  }, [
    showOnboarding,
    onboardingChoice,
    apiProviderId,
    apiBaseUrl,
    apiKey,
    projectId,
    connUxProbe,
    clearPendingModelListDebounce,
    fetchModelApiModels,
  ])

  const handleProviderChange = (nextProviderId: M1ModelApiProviderPresetId): void => {
    const nextPreset = getModelApiProviderPreset(nextProviderId)
    invalidateModelListFetch()
    resetModelApiUnlock()
    setApiProviderId(nextProviderId)
    setApiBaseUrl(nextPreset.baseUrl)
    setApiModel(nextPreset.defaultModel)
    setAvailableApiModels([])
    setModelListNotice(null)
    setManualModelInputMode(false)
  }

  const handleTestModelApi = async (): Promise<void> => {
    setModelApiFailure(null)
    setModelApiTestResult(null)
    setTestedModelApiConfigFingerprint(null)

    const needsApiKey = !currentProviderPreset.apiKeyOptional
    if (!apiBaseUrl.trim() || !apiModel.trim() || (needsApiKey && !apiKey.trim())) {
      setModelApiFailure({
        title: '配置不完整',
        detail: needsApiKey
          ? '请填写服务地址、模型名与密钥后再测试连接。'
          : '请填写服务地址与模型名后再测试连接。',
      })
      setModelApiFailureSeq((seq) => seq + 1)
      return
    }

    if (!probe.capabilities.modelApiTest || !probe.bridge.testM1ModelApiConnection) {
      setModelApiFailure({
        title: '后端尚未接线/不可用',
        detail: '缺失方法：testM1ModelApiConnection。未通过真实工具往返前不会解锁内置建模对话。',
        code: 'BACKEND_UNAVAILABLE',
      })
      setModelApiFailureSeq((seq) => seq + 1)
      return
    }

    const tracker = trackerRef.current
    const captured = {
      projectId: tracker.projectId,
      scopeEpoch: tracker.scopeEpoch,
      writerEpoch: tracker.writerEpoch,
    }
    tracker.modelApiTestEpoch += 1
    const capturedTestEpoch = tracker.modelApiTestEpoch
    const capturedConfigFingerprint = computeModelApiConfigFingerprint({
      baseUrl: apiBaseUrl,
      model: apiModel,
      apiKey,
    })
    const requestId = allocateRequestId('api-test')
    tracker.activeTestRequestId = requestId
    setApiTesting(true)

    let result
    try {
      result = await probe.bridge.testM1ModelApiConnection({
        baseUrl: apiBaseUrl.trim(),
        model: apiModel.trim(),
        apiKey: apiKey.trim(),
        projectId: captured.projectId,
        requestId,
        scopeEpoch: captured.scopeEpoch,
        contextPreview: true,
      })
    } catch (err) {
      result = {
        ok: false as const,
        error: normalizeWorkbenchBridgeError(err, '模型 API 连接测试异常'),
      }
    }

    if (
      !tracker.mounted ||
      tracker.activeTestRequestId !== requestId ||
      tracker.modelApiTestEpoch !== capturedTestEpoch ||
      !isReplyAcceptedForScope(tracker, captured)
    ) {
      // S1: Release apiTesting if this request is still the active test (never clobber a newer test).
      if (tracker.mounted && tracker.activeTestRequestId === requestId) {
        tracker.activeTestRequestId = null
        setApiTesting(false)
      }
      setDiscardedStaleCount((c) => c + 1)
      return
    }

    tracker.activeTestRequestId = null
    setApiTesting(false)

    if (!result.ok) {
      syncScopeEpochFromAuthError(result.error)
      const classified = classifyModelApiFailure(result.error, null)
      setModelApiFailure({
        title: classified?.title ?? '连接测试失败',
        detail: classified?.detail ?? result.error.message,
        code: result.error.code,
      })
      setModelApiFailureSeq((seq) => seq + 1)
      return
    }

    setModelApiTestResult(result.value)
    const classified = classifyModelApiFailure(null, result.value)
    if (classified) {
      setModelApiFailure({
        title: classified.title,
        detail: classified.detail,
      })
      setModelApiFailureSeq((seq) => seq + 1)
      return
    }

    // Only unlock after real tool round-trip succeeded for this exact form fingerprint
    setTestedModelApiConfigFingerprint(capturedConfigFingerprint)
    setConnectionSource('model-api')
    setConnectionState('connected')
    setClientName(result.value.selectedModel)
    setSkippedConnection(false)
  }

  const resetProjectScopedStateForSwitch = (params: {
    readonly nextProjectId: string
    readonly nextProjectName: string
    readonly nextBaseRevision: string | null
    readonly nextDraftRevision: string | null
    readonly nextPreviewSnapshot?: Partial<M2PreviewSnapshot>
    readonly nextFormalVersions?: readonly M3FormalVersionItem[]
    readonly nextUncommittedDrafts?: readonly M3UncommittedDraftItem[]
    readonly nextRestoreStatus?: M3ReopenRestoreStatus | null
    readonly nextMigrationReport?: M3MigrationReport | null
  }) => {
    setProjectId(params.nextProjectId)
    setProjectName(params.nextProjectName)
    setBaseRevision(params.nextBaseRevision)
    setDraftRevision(params.nextDraftRevision)

    // F12 + S1 + S4: Thoroughly reset all project-scoped state so zero data or stuck pending flags leak.
    invalidateModelListFetch()
    setAvailableApiModels([])
    setModelListNotice(null)
    setAuthorizationState('unauthorized')
    setWriterOwner(null)
    setApiTesting(false)
    setAttachedRefIds([])
    setMessages([])
    setChatInput('')
    setChatPending(false)
    setChatNotice(null)
    setLastFailedTurn(null)
    setActivities([])
    setActivitiesNotice(null)
    setShowCompletionView(false)
    setPendingConfirmation(null)
    setInvalidatedConfirmationNotice(null)
    setCommitPending(false)
    setCommitFeedback(null)
    setUndoPending(false)
    setUndoFeedback(null)
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
    setObjectRefCopyFeedback(null)
    setTakeoverPending(false)
    setTakeoverError(null)
    setReadonlyAuthPending(false)
    setReadonlyAuthError(null)
    setReadonlyAuthNotice(null)
    setSelectedTakeoverTarget('')
    setHasRealRequirementsContext(params.nextPreviewSnapshot?.requirements !== undefined)
    setMigrationDrawerOpen(false)
    setMigrationLoading(false)
    setMigrationNotice(null)

    setFormalVersions(
      params.nextFormalVersions ??
        (params.nextBaseRevision
          ? [
              {
                revision: params.nextBaseRevision,
                committedAtLabel: '已保存基线',
                summary: `${params.nextProjectName} 正式基线版本`,
                isCurrent: true,
              },
            ]
          : []),
    )
    setUncommittedDrafts(
      params.nextUncommittedDrafts ??
        (params.nextDraftRevision
          ? [
              {
                draftRevision: params.nextDraftRevision,
                baseRevision: params.nextBaseRevision,
                updatedAtLabel: '当前工作草稿',
                status: 'in_progress',
                summary: '尚未提交的独立草稿修订',
                canUndo: true,
              },
            ]
          : []),
    )
    setRestoreStatus(params.nextRestoreStatus ?? null)
    setMigrationReport(params.nextMigrationReport ?? null)

    trackerRef.current.drawingFailureGeneration = params.nextPreviewSnapshot?.drawingFailure ? 1 : 0
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
  }

  const handleOpenLocalProject = (item: WorkbenchLocalProject) => {
    const tracker = trackerRef.current
    tracker.projectId = item.projectId
    tracker.draftRevision = item.draftRevision
    tracker.scopeEpoch += 1
    tracker.modelApiTestEpoch += 1
    tracker.commitRequestEpoch += 1
    tracker.switchProjectEpoch += 1
    tracker.takeoverRequestEpoch += 1
    tracker.readonlyAuthRequestEpoch += 1
    tracker.retryDrawingEpoch += 1
    tracker.undoRequestEpoch += 1
    tracker.migrationRequestEpoch += 1
    // S2: Preserve per-project strictEpochGuard when returning to a previously taken-over project.
    tracker.strictEpochGuard = Boolean(tracker.strictEpochGuardByProject[item.projectId])
    tracker.activeChatRequestId = null
    tracker.activeTestRequestId = null
    tracker.lastEventSequence = 0

    setScopeEpoch(tracker.scopeEpoch)
    setSkippedConnection(connectionSource === 'none')
    setShowOnboarding(false)
    resetProjectScopedStateForSwitch({
      nextProjectId: item.projectId,
      nextProjectName: item.projectName,
      nextBaseRevision: item.baseRevision,
      nextDraftRevision: item.draftRevision,
    })
    setTakeoverNotice(`已打开本地项目：${item.projectName}（${item.projectId}）。`)
  }

  const handleRefreshExternalActivities = async (): Promise<void> => {
    setActivitiesNotice(null)
    if (!probe.capabilities.externalActivities || !probe.bridge.getM1ExternalActivities) {
      setActivitiesNotice('后端尚未接线/不可用（缺失方法：getM1ExternalActivities）。')
      return
    }
    const tracker = trackerRef.current
    const captured = {
      projectId: tracker.projectId,
      scopeEpoch: tracker.scopeEpoch,
      writerEpoch: tracker.writerEpoch,
    }
    let result
    try {
      result = await probe.bridge.getM1ExternalActivities({
        projectId: captured.projectId,
        scopeEpoch: captured.scopeEpoch,
      })
    } catch (err) {
      result = {
        ok: false as const,
        error: normalizeWorkbenchBridgeError(err, '刷新外部任务活动失败'),
      }
    }
    if (!tracker.mounted || !isReplyAcceptedForScope(tracker, captured)) {
      setDiscardedStaleCount((c) => c + 1)
      return
    }
    if (!result.ok) {
      syncScopeEpochFromAuthError(result.error)
      setActivitiesNotice(`刷新失败（${result.error.code}）：${result.error.message}`)
      return
    }
    setActivities(result.value.activities)
    if (result.value.draftRevision !== undefined) {
      setDraftRevision(result.value.draftRevision)
    }
    setActivitiesNotice(`已更新外部任务活动（${result.value.activities.length} 条）。`)
  }

  const dispatchChatTurn = async (params: {
    readonly prompt: string
    readonly attachments: readonly M1TaskbookReference[]
    readonly selectedObject: M1SelectedObjectRef | null
  }): Promise<void> => {
    setChatNotice(null)
    if (!builtinUnlocked) {
      setChatNotice('内置建模对话尚未解锁，请先通过模型 API 真实工具往返测试。')
      return
    }
    if (!probe.capabilities.builtinChat || !probe.bridge.sendM1ChatMessage) {
      setChatNotice('后端尚未接线/不可用（缺失方法：sendM1ChatMessage）。')
      return
    }

    const tracker = trackerRef.current
    const captured = {
      projectId: tracker.projectId,
      scopeEpoch: tracker.scopeEpoch,
      writerEpoch: tracker.writerEpoch,
    }
    const requestId = allocateRequestId('chat')
    tracker.activeChatRequestId = requestId

    // P1-2 & P1-3: Only send real current-project reference IDs (never hardcoded demo IDs when real chat bridge is active),
    // and strictly clamp history (<= 32) and attachments (<= 8) to align with backend Zod schema limits.
    const validTaskbookIds = new Set(availableTaskbooks.map((tb) => tb.refId))
    const validFeatureIds = new Set(canvasState.features.map((feat) => feat.objectId))
    const filteredAttachments = params.attachments.filter((att) => validTaskbookIds.has(att.refId))
    const { attachments: trimmedAttachmentIds, truncatedCount } = trimM1ChatAttachments(
      filteredAttachments.map((att) => att.refId),
    )
    const trimmedAttachmentRefs = filteredAttachments.filter((att) =>
      trimmedAttachmentIds.includes(att.refId),
    )
    const safeSelectedObject =
      params.selectedObject && validFeatureIds.has(params.selectedObject.objectId)
        ? params.selectedObject
        : null

    if (truncatedCount > 0) {
      setChatNotice(
        `附加任务书引用超出上限（最多 ${MAX_M1_CHAT_ATTACHMENTS} 条），已自动截断超出部分（${truncatedCount} 条）。`,
      )
    }

    const userMsg: WorkbenchChatMessage = {
      id: `user-${requestId}`,
      role: 'user',
      content: params.prompt,
      attachments: trimmedAttachmentRefs,
      selectedObject: safeSelectedObject,
      status: 'sent',
    }
    setMessages((prev) => [...prev, userMsg])
    setChatPending(true)
    setLastFailedTurn(null)

    const history = trimM1ChatHistory(
      messages
        .filter((m) => m.status !== 'failed' && m.status !== 'cancelled')
        .map((m) => ({ role: m.role, content: m.content })),
    )

    let result
    try {
      result = await probe.bridge.sendM1ChatMessage({
        projectId: captured.projectId,
        requestId,
        scopeEpoch: captured.scopeEpoch,
        writerEpoch: captured.writerEpoch,
        prompt: params.prompt,
        attachments: trimmedAttachmentIds,
        selectedObject: safeSelectedObject ? safeSelectedObject.objectId : null,
        history,
      })
    } catch (err) {
      result = {
        ok: false as const,
        error: normalizeWorkbenchBridgeError(err, '内置对话请求异常'),
      }
    }

    const replyScopeForGuard =
      result.ok &&
      (tracker.strictEpochGuard ||
        result.value.scopeEpoch !== undefined ||
        result.value.writerEpoch !== undefined)
        ? { scopeEpoch: result.value.scopeEpoch, writerEpoch: result.value.writerEpoch }
        : undefined

    if (
      !tracker.mounted ||
      tracker.activeChatRequestId !== requestId ||
      !isReplyAcceptedForScope(tracker, captured, replyScopeForGuard)
    ) {
      // S2: Release chatPending if this active chat turn was discarded due to missing/old epoch.
      if (tracker.mounted && tracker.activeChatRequestId === requestId) {
        tracker.activeChatRequestId = null
        setChatPending(false)
        setChatNotice('收到缺失或旧代际的聊天响应，已安全丢弃。')
      }
      setDiscardedStaleCount((c) => c + 1)
      return
    }

    tracker.activeChatRequestId = null
    setChatPending(false)

    if (!result.ok) {
      syncScopeEpochFromAuthError(result.error)
      setLastFailedTurn(params)
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${requestId}`,
          role: 'assistant',
          content: `执行失败（${result.error.code}）：${result.error.message}`,
          status: 'failed',
          errorMessage: result.error.message,
        },
      ])
      if (result.error.code === 'DISCONNECTED') {
        setConnectionState('disconnected')
      }
      return
    }

    if (result.value.draftRevision !== undefined && result.value.draftRevision !== null) {
      setDraftRevision(result.value.draftRevision)
    }
    setMessages((prev) => [
      ...prev,
      {
        id: result.value.messageId,
        role: 'assistant',
        content: result.value.reply,
        toolCalls: result.value.toolCalls,
        draftRevision: result.value.draftRevision,
        status: 'sent',
      },
    ])
  }

  const handleSendChat = async (): Promise<void> => {
    const prompt = chatInput.trim()
    if (!prompt || chatPending) return
    // M3 A11: completion intent in normal chat MUST ONLY trigger review and open
    // the completion view; it MUST NEVER bypass human confirmation to commit directly.
    if (isCompletionIntentPrompt(prompt)) {
      setChatInput('')
      setShowCompletionView(true)
      setCommitFeedback(null)
      const intentId = allocateRequestId('chat-complete')
      setMessages((prev) => [
        ...prev,
        {
          id: `user-${intentId}`,
          role: 'user',
          content: prompt,
          status: 'sent',
        },
        {
          id: `assistant-${intentId}`,
          role: 'assistant',
          content:
            '已触发复核并打开当前草稿的完成视图。普通对话中的完成意图不会绕过人工确认直接提交正式版本，请在完成视图中核对检查结果并完成一次性人工确认。',
          draftRevision,
          status: 'sent',
        },
      ])
      return
    }
    setChatInput('')
    await dispatchChatTurn({
      prompt,
      attachments: attachedTaskbooks,
      selectedObject: includeSelectedInChat ? selectedObject : null,
    })
  }

  const handleStopChat = async (): Promise<void> => {
    const tracker = trackerRef.current
    const activeId = tracker.activeChatRequestId
    if (!activeId) return

    // Immediately invalidate active chat request so late responses cannot apply.
    tracker.activeChatRequestId = null
    setChatPending(false)
    setChatNotice('已停止当前对话生成，已忽略后续迟到响应。')

    if (probe.capabilities.cancelChat && probe.bridge.cancelM1ChatMessage) {
      try {
        await probe.bridge.cancelM1ChatMessage({
          projectId: tracker.projectId,
          requestId: activeId,
          scopeEpoch: tracker.scopeEpoch,
        })
      } catch {
        // Local cancellation already took effect
      }
    }
  }

  const handleRetryChat = async (): Promise<void> => {
    if (!lastFailedTurn || chatPending) return
    await dispatchChatTurn(lastFailedTurn)
  }

  const handleReconnect = async (): Promise<void> => {
    setTakeoverError(null)
    setTakeoverNotice(null)
    if (!probe.capabilities.reconnect || !probe.bridge.reconnectM1Session) {
      setTakeoverError('后端尚未接线/不可用（缺失方法：reconnectM1Session），无法自动重连。')
      return
    }
    const tracker = trackerRef.current
    const captured = {
      projectId: tracker.projectId,
      scopeEpoch: tracker.scopeEpoch,
      writerEpoch: tracker.writerEpoch,
    }
    const capturedSwitchEpoch = tracker.switchProjectEpoch
    tracker.takeoverRequestEpoch += 1
    const capturedTakeoverEpoch = tracker.takeoverRequestEpoch
    const requestId = allocateRequestId('reconnect')
    const targetSource = connectionSource === 'model-api' ? 'model-api' : 'local-agent'
    setTakeoverPending(true)

    let result
    try {
      result = await probe.bridge.reconnectM1Session({
        projectId: captured.projectId,
        source: targetSource,
        requestId,
        scopeEpoch: captured.scopeEpoch,
      })
    } catch (err) {
      result = {
        ok: false as const,
        error: normalizeWorkbenchBridgeError(err, '重连异常'),
      }
    }

    if (
      !tracker.mounted ||
      tracker.switchProjectEpoch !== capturedSwitchEpoch ||
      tracker.takeoverRequestEpoch !== capturedTakeoverEpoch ||
      !isReplyAcceptedForScope(tracker, captured)
    ) {
      if (tracker.mounted && tracker.takeoverRequestEpoch === capturedTakeoverEpoch) {
        setTakeoverPending(false)
      }
      setDiscardedStaleCount((c) => c + 1)
      return
    }
    setTakeoverPending(false)

    if (!result.ok) {
      syncScopeEpochFromAuthError(result.error)
      setTakeoverError(`重连失败（${result.error.code}）：${result.error.message}`)
      return
    }
    const snap = result.value
    applyConnectionSnapshot(snap)
    setTakeoverNotice(`已重新连接至 ${snap.clientName ?? formatSourceLabel(snap.source, snap.clientName, apiModel, false)}。`)
  }

  const handleRequestReadonlyAuthorization = async (): Promise<void> => {
    setReadonlyAuthError(null)
    setReadonlyAuthNotice(null)
    if (!authProbe.available || !authProbe.requestM1ProjectAuthorization) {
      setReadonlyAuthError(
        '后端尚未接线/不可用（缺失方法：requestM1ProjectAuthorization），无法申请原生只读授权。',
      )
      return
    }
    const tracker = trackerRef.current
    const capturedProjectId = tracker.projectId
    const capturedSwitchEpoch = tracker.switchProjectEpoch
    tracker.readonlyAuthRequestEpoch += 1
    const capturedAuthEpoch = tracker.readonlyAuthRequestEpoch
    const requestGeneration = tracker.readonlyAuthGeneration
    tracker.readonlyAuthGeneration += 1
    const requestId = allocateRequestId('auth-readonly')
    const issued = buildM1AuthorizationRequest(capturedProjectId, requestId, requestGeneration)
    if (!issued) {
      setReadonlyAuthError('项目标识或请求参数无效，无法发起原生只读授权请求。')
      return
    }

    setReadonlyAuthPending(true)
    let result
    try {
      result = await authProbe.requestM1ProjectAuthorization(issued)
    } catch (err) {
      result = {
        ok: false as const,
        error: normalizeWorkbenchBridgeError(err, '申请原生只读授权异常'),
      }
    }

    if (
      !tracker.mounted ||
      tracker.projectId !== capturedProjectId ||
      tracker.switchProjectEpoch !== capturedSwitchEpoch ||
      tracker.readonlyAuthRequestEpoch !== capturedAuthEpoch
    ) {
      if (tracker.mounted && tracker.readonlyAuthRequestEpoch === capturedAuthEpoch) {
        setReadonlyAuthPending(false)
      }
      setDiscardedStaleCount((c) => c + 1)
      return
    }
    setReadonlyAuthPending(false)

    if (!result.ok) {
      syncScopeEpochFromAuthError(result.error)
      setReadonlyAuthError(
        `申请原生只读授权失败（${result.error.code}）：${result.error.message}`,
      )
      return
    }

    const acceptedScope = acceptAuthorizedEntryScope(issued, result.value)
    if (!acceptedScope) {
      setReadonlyAuthError(
        '申请原生只读授权失败（INVALID_SCOPE）：返回的授权凭据与当前项目或请求代际不匹配，未授予授权。',
      )
      return
    }

    setAuthorizationState((prev) =>
      prev === 'authorized-writable' ? prev : 'authorized-readonly',
    )
    // R-A: Trigger automatic event subscription recovery after native read-only authorization
    // succeeds, even when initial AUTH_REQUIRED carried no detail epoch.
    setSubscriptionRetryNonce((nonce) => nonce + 1)
    setReadonlyAuthNotice(
      `已完成项目 ${acceptedScope.projectId} 的原生只读授权，现在可继续申请原生写入或接管草稿。`,
    )
  }

  const handleTakeoverDraft = async (
    explicitTargetSource?: 'local-agent' | 'model-api',
  ): Promise<void> => {
    setTakeoverError(null)
    setTakeoverNotice(null)
    // P1-5: Never invoke takeoverM1Draft before native read-only authorization is granted.
    if (authorizationState === 'unauthorized') {
      setTakeoverError('须先完成原生只读授权，再申请写入或接管。')
      return
    }
    // P1-5: When connectionSource is 'none', never blindly default to 'local-agent';
    // require an explicit target source selection.
    const resolvedTargetSource: 'local-agent' | 'model-api' | null =
      explicitTargetSource ??
      (connectionSource === 'local-agent' || connectionSource === 'model-api'
        ? connectionSource
        : selectedTakeoverTarget || null)
    if (!resolvedTargetSource) {
      setTakeoverError(
        '当前尚未建立连接来源，请先明确选择写入/接管目标入口（本地 Agent 或模型 API）后再发起操作。',
      )
      return
    }
    if (!probe.capabilities.takeover || !probe.bridge.takeoverM1Draft) {
      setTakeoverError('后端尚未接线/不可用（缺失方法：takeoverM1Draft），无法接管当前草稿。')
      return
    }
    const tracker = trackerRef.current
    const capturedProjectId = tracker.projectId
    const capturedScopeEpoch = tracker.scopeEpoch
    const capturedSwitchEpoch = tracker.switchProjectEpoch
    const capturedDraftRevision = draftRevision
    tracker.takeoverRequestEpoch += 1
    const capturedTakeoverEpoch = tracker.takeoverRequestEpoch
    const previousScopeEpoch = capturedScopeEpoch
    const nextScopeEpoch = previousScopeEpoch + 1
    const requestId = allocateRequestId('takeover')
    const targetSource = resolvedTargetSource
    setTakeoverPending(true)

    let result
    try {
      result = await probe.bridge.takeoverM1Draft({
        projectId: capturedProjectId,
        draftRevision: capturedDraftRevision,
        requestId,
        previousScopeEpoch,
        nextScopeEpoch,
        targetSource,
      })
    } catch (err) {
      result = {
        ok: false as const,
        error: normalizeWorkbenchBridgeError(err, '接管草稿异常'),
      }
    }

    // N6: Verify projectId, capturedScopeEpoch, switchProjectEpoch & takeoverRequestEpoch
    // to prevent A->B->A stale takeover projection without clobbering a newer takeover's pending state.
    if (
      !tracker.mounted ||
      tracker.projectId !== capturedProjectId ||
      tracker.scopeEpoch !== capturedScopeEpoch ||
      tracker.switchProjectEpoch !== capturedSwitchEpoch ||
      tracker.takeoverRequestEpoch !== capturedTakeoverEpoch
    ) {
      if (tracker.mounted && tracker.takeoverRequestEpoch === capturedTakeoverEpoch) {
        setTakeoverPending(false)
      }
      setDiscardedStaleCount((c) => c + 1)
      return
    }
    setTakeoverPending(false)

    if (!result.ok) {
      syncScopeEpochFromAuthError(result.error)
      setTakeoverError(`接管当前草稿失败（${result.error.code}）：${result.error.message}`)
      return
    }

    if (result.value.projectId !== tracker.projectId) {
      setDiscardedStaleCount((c) => c + 1)
      return
    }

    // Advance local scope & writer generation; enable fail-closed strict epoch guard (S2 per-project persistent).
    const acceptedScopeEpoch = Math.max(nextScopeEpoch, result.value.scopeEpoch)
    const acceptedWriterEpoch = Math.max(tracker.writerEpoch + 1, result.value.writerEpoch)
    tracker.scopeEpoch = acceptedScopeEpoch
    tracker.writerEpoch = acceptedWriterEpoch
    tracker.strictEpochGuardByProject[tracker.projectId] = true
    tracker.strictEpochGuard = true
    tracker.modelApiTestEpoch += 1
    tracker.commitRequestEpoch += 1
    tracker.activeChatRequestId = null
    tracker.activeTestRequestId = null

    setScopeEpoch(acceptedScopeEpoch)
    setWriterEpoch(acceptedWriterEpoch)
    setWriterOwner(result.value.writerOwner)
    setDraftRevision(result.value.draftRevision)
    setAuthorizationState('authorized-writable')
    setConnectionState('connected')
    setChatPending(false)
    setApiTesting(false)
    // N7: Reset commitPending when commitRequestEpoch advances on same-project takeover.
    setCommitPending(false)
    setTakeoverNotice(
      capturedDraftRevision === null
        ? `已获得原生写入授权并接管项目（代际 #${acceptedScopeEpoch} · 写入代际 #${acceptedWriterEpoch}），已撤销先前客户端写入凭据，迟到响应与事件将被丢弃。`
        : `已接管当前草稿（代际 #${acceptedScopeEpoch} · 写入代际 #${acceptedWriterEpoch}），已撤销先前客户端写入凭据，迟到响应与事件将被丢弃。`,
    )
  }

  const toggleTaskbookAttachment = (refId: string) => {
    if (attachedRefIds.includes(refId)) {
      setAttachedRefIds((prev) => prev.filter((id) => id !== refId))
      setChatNotice(null)
      return
    }
    if (attachedRefIds.length >= MAX_M1_CHAT_ATTACHMENTS) {
      setChatNotice(
        `最多可附加 ${MAX_M1_CHAT_ATTACHMENTS} 份任务书引用，已达到上限，请先取消部分引用后再添加。`,
      )
      return
    }
    setChatNotice(null)
    setAttachedRefIds((prev) => [...prev, refId])
  }

  // M3 computed completion readiness & bound one-time confirmation validity
  const checkSetFingerprint = useMemo(
    () =>
      computeCheckSetFingerprint({
        projectId,
        baseRevision,
        draftRevision,
        modelFingerprint: canvasState.model.fingerprint,
        drawingFingerprint: canvasState.drawing.fingerprint,
        checks: canvasState.checks,
      }),
    [
      projectId,
      baseRevision,
      draftRevision,
      canvasState.model.fingerprint,
      canvasState.drawing.fingerprint,
      canvasState.checks,
    ],
  )

  const completionReadiness = useMemo(
    () =>
      evaluateCompletionReadiness({
        draftRevision,
        model: canvasState.model,
        drawing: canvasState.drawing,
        drawingFailure: canvasState.drawingFailure,
        requirements: canvasState.requirements,
        checks: canvasState.checks,
        checksInProgress: canvasState.checksInProgress,
        features: canvasState.features,
      }),
    [
      draftRevision,
      canvasState.model,
      canvasState.drawing,
      canvasState.drawingFailure,
      canvasState.requirements,
      canvasState.checks,
      canvasState.checksInProgress,
      canvasState.features,
    ],
  )

  const naturalCompletionSummary = useMemo(
    () => computeNaturalCompletionSummary(canvasState),
    [canvasState],
  )

  const partName = canvasState.features[0]?.partName || projectName
  const hasSaveableResult =
    draftRevision !== null ||
    canvasState.model.status === 'ready' ||
    canvasState.drawing.status === 'ready'

  const confirmationStillValid =
    completionReadiness.canSaveFormal &&
    isBoundConfirmationValid(pendingConfirmation, {
      projectId,
      baseRevision,
      draftRevision,
      checkSetFingerprint,
    })

  // F09: Immediately destroy pendingConfirmation via setState(null) on any invalidation
  // so reverting to previous revision/fingerprint values can NEVER resurrect an old confirmation.
  if (pendingConfirmation && !confirmationStillValid) {
    setPendingConfirmation(null)
    setInvalidatedConfirmationNotice(
      '草稿修订、就绪状态或检查集指纹已变化，原一次性人工确认已自动失效，请重新复核后再确认提交。',
    )
  }

  const activePendingConfirmation = confirmationStillValid ? pendingConfirmation : null
  const effectiveInvalidatedConfirmationNotice =
    pendingConfirmation && !confirmationStillValid
      ? '草稿修订、就绪状态或检查集指纹已变化，原一次性人工确认已自动失效，请重新复核后再确认提交。'
      : invalidatedConfirmationNotice

  const canUndoBlockedDraft =
    completionReadiness.blockingChecks.length > 0 ||
    completionReadiness.blockingRequirements.length > 0 ||
    uncommittedDrafts.some((d) => d.status === 'blocked' || d.canUndo)

  const currentUncommittedDraft = draftRevision
    ? uncommittedDrafts.find((d) => d.draftRevision === draftRevision)
    : undefined
  const canUndoInCompletionView =
    draftRevision !== null &&
    (currentUncommittedDraft ? currentUncommittedDraft.canUndo !== false : true)

  const handleStartOneTimeConfirm = () => {
    if (!completionReadiness.canSaveFormal || !draftRevision) return
    confirmSeqRef.current += 1
    const bound = createBoundConfirmation({
      projectId,
      baseRevision,
      draftRevision,
      checkSetFingerprint,
      seq: confirmSeqRef.current,
    })
    setPendingConfirmation(bound)
    setInvalidatedConfirmationNotice(null)
    setCommitFeedback(null)
  }

  const handleCancelOneTimeConfirm = () => {
    setPendingConfirmation(null)
    setInvalidatedConfirmationNotice(null)
  }

  const handleConfirmCommitFormal = async (): Promise<void> => {
    // F09 + E3: Re-evaluate readiness & bound fingerprint in real time on secondary confirmation click.
    const liveReadiness = evaluateCompletionReadiness({
      draftRevision,
      model: canvasState.model,
      drawing: canvasState.drawing,
      drawingFailure: canvasState.drawingFailure,
      requirements: canvasState.requirements,
      checks: canvasState.checks,
      checksInProgress: canvasState.checksInProgress,
      features: canvasState.features,
    })
    const liveFingerprint = computeCheckSetFingerprint({
      projectId,
      baseRevision,
      draftRevision,
      modelFingerprint: canvasState.model.fingerprint,
      drawingFingerprint: canvasState.drawing.fingerprint,
      checks: canvasState.checks,
    })

    if (
      !activePendingConfirmation ||
      !liveReadiness.canSaveFormal ||
      !isBoundConfirmationValid(activePendingConfirmation, {
        projectId,
        baseRevision,
        draftRevision,
        checkSetFingerprint: liveFingerprint,
      })
    ) {
      setInvalidatedConfirmationNotice(
        '草稿修订、就绪状态或检查集指纹已变化，原一次性人工确认已自动失效，请重新复核后再确认提交。',
      )
      setPendingConfirmation(null)
      return
    }
    if (!m3Probe.capabilities.commitM3ApprovedDraft || !m3Probe.bridge.commitM3ApprovedDraft) {
      setCommitFeedback({
        ok: false,
        message: '后端尚未接线/不可用（缺失方法：commitM3ApprovedDraft），无法提交正式版本。',
      })
      return
    }

    const tracker = trackerRef.current
    tracker.commitRequestEpoch += 1
    const capturedCommitEpoch = tracker.commitRequestEpoch
    const capturedProjectId = activePendingConfirmation.projectId
    const capturedBaseRevision = activePendingConfirmation.baseRevision
    const capturedDraftRevision = activePendingConfirmation.draftRevision
    const capturedCheckSetFingerprint = activePendingConfirmation.checkSetFingerprint
    const capturedScopeEpoch = tracker.scopeEpoch

    const requestId = allocateRequestId('commit-formal')
    setCommitPending(true)
    setCommitFeedback(null)

    let result
    try {
      result = await m3Probe.bridge.commitM3ApprovedDraft({
        projectId: activePendingConfirmation.projectId,
        baseRevision: activePendingConfirmation.baseRevision,
        draftRevision: activePendingConfirmation.draftRevision,
        checkSetFingerprint: activePendingConfirmation.checkSetFingerprint,
        confirmationToken: activePendingConfirmation.confirmationToken,
        requestId,
      })
    } catch (err) {
      result = {
        ok: false as const,
        error: normalizeM3BridgeError(err, '正式版本提交异常'),
      }
    }

    // F09 + S3: Strictly verify projectId, draftRevision, scopeEpoch & commitRequestEpoch on async return
    // to prevent late commit projection from Project A contaminating Project B, while releasing commitPending
    // if draftRevision advanced within the same project (without clobbering any newer commit).
    if (
      !tracker.mounted ||
      tracker.commitRequestEpoch !== capturedCommitEpoch ||
      tracker.projectId !== capturedProjectId ||
      tracker.scopeEpoch !== capturedScopeEpoch ||
      tracker.draftRevision !== capturedDraftRevision
    ) {
      if (tracker.mounted && tracker.commitRequestEpoch === capturedCommitEpoch) {
        setCommitPending(false)
      }
      setDiscardedStaleCount((c) => c + 1)
      return
    }
    setCommitPending(false)

    if (!result.ok) {
      setCommitFeedback({
        ok: false,
        message: `正式版本提交失败（${result.error.code}）：${result.error.message}`,
      })
      if (
        result.error.code === 'CONFIRMATION_EXPIRED' ||
        result.error.code === 'FINGERPRINT_MISMATCH'
      ) {
        setPendingConfirmation(null)
        setInvalidatedConfirmationNotice(
          `原确认已失效（${result.error.code}），请重新复核后再确认提交。`,
        )
      }
      return
    }

    const committed = result.value
    if (
      committed.projectId !== tracker.projectId ||
      committed.committedDraftRevision !== capturedDraftRevision
    ) {
      setDiscardedStaleCount((c) => c + 1)
      return
    }
    // S3: Strictly verify returned checkSetFingerprint & previousBaseRevision against bound confirmation.
    if (
      committed.checkSetFingerprint !== capturedCheckSetFingerprint ||
      (committed.previousBaseRevision ?? null) !== (capturedBaseRevision ?? null)
    ) {
      setPendingConfirmation(null)
      setCommitFeedback({
        ok: false,
        message: `正式版本提交绑定校验失败：返回指纹（${committed.checkSetFingerprint}）或基线版本（${committed.previousBaseRevision ?? '无'}）与确认绑定不一致，已拒绝投影。`,
      })
      setDiscardedStaleCount((c) => c + 1)
      return
    }
    setPendingConfirmation(null)
    setInvalidatedConfirmationNotice(null)
    setBaseRevision(committed.committedRevision)
    setDraftRevision(committed.nextDraftRevision ?? null)
    setFormalVersions((prev) => [
      {
        revision: committed.committedRevision,
        committedAtLabel: committed.committedAtLabel ?? '刚刚提交',
        summary:
          committed.summary ??
          `由 ${formatRevisionDisplay(committed.committedDraftRevision)} 经人工确认提交`,
        checkSummary: `检查集指纹 ${committed.checkSetFingerprint}`,
        isCurrent: true,
      },
      ...prev.map((item) => ({ ...item, isCurrent: false })),
    ])
    setUncommittedDrafts((prev) =>
      prev.filter((d) => d.draftRevision !== committed.committedDraftRevision),
    )
    setCanvasState((prev) => ({
      ...prev,
      currentRevision: committed.committedRevision,
      history: [
        {
          id: `hist-commit-${requestId}`,
          sequence: prev.lastEventSequence + 1,
          revision: committed.committedRevision,
          kind: 'revision',
          status: 'ready',
          title: `已提交正式版本 ${formatRevisionDisplay(committed.committedRevision)}`,
          detail: `由 ${formatRevisionDisplay(committed.committedDraftRevision)} 提交（检查集指纹 ${committed.checkSetFingerprint}）。`,
        },
        ...prev.history,
      ],
    }))
    setCommitFeedback({
      ok: true,
      message: `已正式保存版本 ${formatRevisionDisplay(committed.committedRevision)}（${committed.committedRevision}）。`,
    })
  }

  const handleUndoBlockedDraft = async (): Promise<void> => {
    setUndoFeedback(null)
    if (!m3Probe.capabilities.undoDraftChange || !m3Probe.bridge.undoDraftChange) {
      setUndoFeedback('后端尚未接线/不可用（缺失方法：undoDraftChange），无法撤销草稿修改。')
      return
    }
    const tracker = trackerRef.current
    const capturedProjectId = tracker.projectId
    const capturedSwitchEpoch = tracker.switchProjectEpoch
    const capturedScopeEpoch = tracker.scopeEpoch
    tracker.undoRequestEpoch += 1
    const capturedUndoEpoch = tracker.undoRequestEpoch
    const requestId = allocateRequestId('undo-draft')
    setUndoPending(true)
    let result
    try {
      result = await m3Probe.bridge.undoDraftChange({
        projectId: capturedProjectId,
        draftRevision,
        requestId,
      })
    } catch (err) {
      result = {
        ok: false as const,
        error: normalizeM3BridgeError(err, '撤销草稿修改异常'),
      }
    }
    // S4: Verify projectId, switchProjectEpoch, scopeEpoch & undoRequestEpoch on async return.
    if (
      !tracker.mounted ||
      tracker.projectId !== capturedProjectId ||
      tracker.switchProjectEpoch !== capturedSwitchEpoch ||
      tracker.scopeEpoch !== capturedScopeEpoch ||
      tracker.undoRequestEpoch !== capturedUndoEpoch
    ) {
      if (tracker.mounted && tracker.undoRequestEpoch === capturedUndoEpoch) {
        setUndoPending(false)
      }
      setDiscardedStaleCount((c) => c + 1)
      return
    }
    setUndoPending(false)
    if (!result.ok) {
      setUndoFeedback(`撤销失败（${result.error.code}）：${result.error.message}`)
      return
    }

    const undone = result.value
    if (undone.projectId !== tracker.projectId) {
      setDiscardedStaleCount((c) => c + 1)
      return
    }
    setDraftRevision(undone.restoredDraftRevision)
    setPendingConfirmation(null)
    setUncommittedDrafts((prev) => {
      const filtered = prev.filter((d) => d.draftRevision !== undone.previousDraftRevision)
      if (!undone.restoredDraftRevision) return filtered
      const existing = filtered.find((d) => d.draftRevision === undone.restoredDraftRevision)
      if (existing) {
        return filtered.map((d) =>
          d.draftRevision === undone.restoredDraftRevision
            ? { ...d, status: 'passed', summary: undone.summary }
            : d,
        )
      }
      return [
        {
          draftRevision: undone.restoredDraftRevision,
          baseRevision,
          updatedAtLabel: '撤销后恢复',
          status: 'passed',
          summary: undone.summary,
          canUndo: false,
        },
        ...filtered,
      ]
    })
    setCanvasState((prev) => {
      const snap = undone.previewSnapshot
      const nextState = snap
        ? createInitialM2CanvasState({
            projectId: prev.projectId,
            initialDraftRevision: undone.restoredDraftRevision,
            initialBaseRevision: baseRevision,
            initialPreviewSnapshot: {
              ...snap,
              history: prev.history,
            },
            initialViewMode: prev.viewMode,
          })
        : {
            ...prev,
            currentRevision: undone.restoredDraftRevision ?? baseRevision,
          }
      trackerRef.current.drawingFailureGeneration = nextState.drawingFailureGeneration
      trackerRef.current.drawingStateGeneration = nextState.drawingStateGeneration
      return {
        ...nextState,
        history: [
          {
            id: `hist-undo-${requestId}`,
            sequence: prev.lastEventSequence + 1,
            revision: undone.restoredDraftRevision,
            kind: 'revision',
            status: 'ready',
            title: `已撤销被阻塞草稿修改，恢复至 ${formatRevisionDisplay(undone.restoredDraftRevision)}`,
            detail: undone.summary,
          },
          ...prev.history,
        ],
      }
    })
    setUndoFeedback(
      `已撤销被阻塞的草稿修改，恢复至 ${formatRevisionDisplay(undone.restoredDraftRevision)}：${undone.summary}`,
    )
  }

  const handleLoadMigrationReport = async (): Promise<void> => {
    setMigrationNotice(null)
    if (!m3Probe.capabilities.getMigrationReport || !m3Probe.bridge.getMigrationReport) {
      setMigrationNotice(
        '后端尚未接线/不可用（缺失方法：getMigrationReport），无法读取旧项目迁移差异报告。',
      )
      return
    }
    const tracker = trackerRef.current
    const capturedProjectId = tracker.projectId
    const capturedSwitchEpoch = tracker.switchProjectEpoch
    const capturedScopeEpoch = tracker.scopeEpoch
    tracker.migrationRequestEpoch += 1
    const capturedMigrationEpoch = tracker.migrationRequestEpoch
    setMigrationLoading(true)
    let result
    try {
      result = await m3Probe.bridge.getMigrationReport({
        projectId: capturedProjectId,
      })
    } catch (err) {
      result = {
        ok: false as const,
        error: normalizeM3BridgeError(err, '读取迁移报告异常'),
      }
    }
    // S4: Verify projectId, switchProjectEpoch, scopeEpoch & migrationRequestEpoch on async return.
    if (
      !tracker.mounted ||
      tracker.projectId !== capturedProjectId ||
      tracker.switchProjectEpoch !== capturedSwitchEpoch ||
      tracker.scopeEpoch !== capturedScopeEpoch ||
      tracker.migrationRequestEpoch !== capturedMigrationEpoch
    ) {
      if (tracker.mounted && tracker.migrationRequestEpoch === capturedMigrationEpoch) {
        setMigrationLoading(false)
      }
      setDiscardedStaleCount((c) => c + 1)
      return
    }
    setMigrationLoading(false)
    if (!result.ok) {
      setMigrationNotice(`读取迁移报告失败（${result.error.code}）：${result.error.message}`)
      return
    }
    if (!result.value) {
      setMigrationNotice('当前项目无旧格式迁移差异记录。')
      return
    }
    if (result.value.projectId !== tracker.projectId) {
      setDiscardedStaleCount((c) => c + 1)
      return
    }
    setMigrationReport(result.value)
    setMigrationDrawerOpen(true)
    setMigrationNotice(`已加载 ${result.value.sourceFormat} 迁移差异报告。`)
  }

  const handleOpenExternalProjectResult = async (
    notification: M3ExternalProjectEvent,
  ): Promise<void> => {
    setExternalOpenFeedback(null)
    if (
      !m3Probe.capabilities.openExternalProjectResult ||
      !m3Probe.bridge.openExternalProjectResult
    ) {
      setExternalOpenFeedback(
        '后端尚未接线/不可用（缺失方法：openExternalProjectResult），无法切换并恢复目标项目最新产物。',
      )
      return
    }
    const tracker = trackerRef.current
    tracker.switchProjectEpoch += 1
    const capturedSwitchEpoch = tracker.switchProjectEpoch
    const requestId = allocateRequestId('open-external')
    setExternalOpenPendingId(notification.eventId)
    let result
    try {
      result = await m3Probe.bridge.openExternalProjectResult({
        projectId: notification.projectId,
        draftRevision: notification.draftRevision,
        requestId,
      })
    } catch (err) {
      result = {
        ok: false as const,
        error: normalizeM3BridgeError(err, '打开外部修改项目失败'),
      }
    }
    // F12: Discard out-of-order late switch responses if a newer switch started.
    if (!tracker.mounted || tracker.switchProjectEpoch !== capturedSwitchEpoch) {
      setDiscardedStaleCount((c) => c + 1)
      return
    }
    setExternalOpenPendingId(null)
    if (!result.ok) {
      setExternalOpenFeedback(
        `打开项目 ${notification.projectName} 失败（${result.error.code}）：${result.error.message}`,
      )
      return
    }

    const opened = result.value
    tracker.projectId = opened.projectId
    tracker.draftRevision = opened.draftRevision
    tracker.scopeEpoch += 1
    tracker.modelApiTestEpoch += 1
    tracker.commitRequestEpoch += 1
    tracker.takeoverRequestEpoch += 1
    tracker.readonlyAuthRequestEpoch += 1
    tracker.retryDrawingEpoch += 1
    tracker.undoRequestEpoch += 1
    tracker.migrationRequestEpoch += 1
    // S2: Preserve per-project strictEpochGuard when returning to a previously taken-over project.
    tracker.strictEpochGuard = Boolean(tracker.strictEpochGuardByProject[opened.projectId])
    tracker.activeChatRequestId = null
    tracker.activeTestRequestId = null
    tracker.lastEventSequence = 0

    setScopeEpoch(tracker.scopeEpoch)
    resetProjectScopedStateForSwitch({
      nextProjectId: opened.projectId,
      nextProjectName: opened.projectName,
      nextBaseRevision: opened.baseRevision,
      nextDraftRevision: opened.draftRevision,
      nextPreviewSnapshot: opened.previewSnapshot,
      nextFormalVersions: opened.formalVersions,
      nextUncommittedDrafts: opened.uncommittedDrafts,
      nextRestoreStatus: opened.restoreStatus ?? null,
      nextMigrationReport: opened.migrationReport ?? null,
    })
    setExternalNotifications((prev) =>
      prev.filter((item) => item.eventId !== notification.eventId),
    )
    setPreviewMessage(
      opened.summary ??
        `已切换到项目「${opened.projectName}」并恢复最新产物（${formatRevisionDisplay(opened.draftRevision ?? opened.baseRevision)}）。`,
    )
  }

  const handleDismissExternalNotification = (eventId: string) => {
    setExternalNotifications((prev) => prev.filter((item) => item.eventId !== eventId))
  }

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

  const workflowStep: 1 | 2 | 3 = showOnboarding
    ? 1
    : showCompletionView || hasSaveableResult
      ? 3
      : connectionState === 'connected' || builtinUnlocked || skippedConnection
        ? 2
        : 1

  const compactConnectionLabel =
    connectionSource === 'local-agent'
      ? clientName
        ? `本地 Agent · ${clientName}`
        : '本地 Agent'
      : connectionSource === 'model-api'
        ? apiModel.trim()
          ? `模型 API · ${apiModel.trim()}`
          : '模型 API'
        : skippedConnection
          ? '本地浏览'
          : '未连接'

  const starterPrompts = [
    '生成 80×50×8 安装板',
    '向右移动选中孔 1 mm',
    '完成并复核',
  ] as const

  const rootClassName = className ? `pa-workbench ${className}` : 'pa-workbench'

  return (
    <main
      className={rootClassName}
      data-theme={theme}
      aria-label="寸链 M1 双入口工作台"
      onKeyDown={handleWorkbenchKeyDown}
    >
      {/* Single-Row 48px Minimal Top Bar (Left: pure info, Center: unique view switch, Right: <= 3 controls) */}
      <header className="pa-workbench-topbar" aria-label="顶部连接状态栏">
        <div className="pa-topbar-left">
          <span className="pa-brand-mini" aria-hidden="true">
            <span className="pa-brand-mini-icon">寸</span>
            <span>寸链</span>
          </span>
          <h1 className="pa-title pa-project-title">{projectName}</h1>
          <span className="pa-rev-capsule pa-mono" aria-label="修订版本状态">
            正式版 {baseRevision ?? '无'} · 草稿 {draftRevision ?? '无'}
          </span>
          <span className="pa-workflow-steps" aria-label="三步工作流进度">
            <span className={workflowStep >= 1 ? 'pa-step pa-step-done' : 'pa-step'}>
              ① 连接
            </span>
            <span className="pa-step-sep" aria-hidden="true">
              ›
            </span>
            <span
              className={
                workflowStep === 2
                  ? 'pa-step pa-step-active'
                  : workflowStep > 2
                    ? 'pa-step pa-step-done'
                    : 'pa-step'
              }
            >
              ② 改图
            </span>
            <span className="pa-step-sep" aria-hidden="true">
              ›
            </span>
            <span className={workflowStep === 3 ? 'pa-step pa-step-active' : 'pa-step'}>
              ③ 保存
            </span>
          </span>
        </div>

        {/* Center: Single Source of Truth for View Switching (Not duplicated in canvas) */}
        <div className="pa-topbar-center">
          {!showOnboarding ? (
            <div className="pa-segmented" role="tablist" aria-label="中央画布视图切换">
              <button
                type="button"
                role="tab"
                aria-selected={effectiveViewMode === 'model'}
                data-artifact-status={modelStatusMeta.stateKey}
                title={modelStatusMeta.text}
                className={effectiveViewMode === 'model' ? 'pa-btn-active' : undefined}
                onClick={() => handleChangeViewMode('model')}
              >
                模型
                {isNarrow ? <span aria-hidden="true"> {modelStatusMeta.symbol}</span> : null}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={effectiveViewMode === 'drawing'}
                data-artifact-status={drawingStatusMeta.stateKey}
                title={drawingStatusMeta.text}
                className={effectiveViewMode === 'drawing' ? 'pa-btn-active' : undefined}
                onClick={() => handleChangeViewMode('drawing')}
              >
                图纸
                {isNarrow ? <span aria-hidden="true"> {drawingStatusMeta.symbol}</span> : null}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={effectiveViewMode === 'split'}
                disabled={isNarrow}
                title={isNarrow ? '窗口较窄时自动退化为模型/图纸标签页' : '模型与图纸并排联动'}
                className={effectiveViewMode === 'split' ? 'pa-btn-active' : undefined}
                onClick={() => handleChangeViewMode('split')}
              >
                并排
              </button>
            </div>
          ) : null}
        </div>

        {/* Right: Strictly <= 3 interactive controls (Connection Capsule + Complete & Save CTA + More Menu) */}
        <div className="pa-topbar-right">
          {/* 1. Connection Status Capsule (opens Connection & Auth popover) */}
          <div className="pa-popover-anchor">
            <button
              type="button"
              data-testid="connection-capsule-btn"
              className="pa-conn-capsule-btn"
              aria-label="当前连接来源"
              aria-haspopup="dialog"
              aria-expanded={connectionPopoverOpen}
              onClick={() => {
                setMoreMenuOpen(false)
                setConnectionPopoverOpen((prev) => !prev)
              }}
            >
              <span
                className={
                  connectionState === 'connected'
                    ? 'pa-conn-dot'
                    : connectionState === 'disconnected' && connectionSource !== 'none'
                      ? 'pa-conn-dot pa-conn-dot-offline'
                      : 'pa-conn-dot pa-conn-dot-idle'
                }
                aria-hidden="true"
              />
              <span>{compactConnectionLabel}</span>
            </button>

            {connectionPopoverOpen ? (
              <div
                className="pa-popover pa-conn-popover"
                role="dialog"
                aria-label="连接与授权详情"
              >
                <div className="pa-header">
                  <strong className="pa-title">连接与授权</strong>
                  <button
                    type="button"
                    className="pa-icon-btn"
                    aria-label="关闭连接与授权详情"
                    onClick={() => setConnectionPopoverOpen(false)}
                  >
                    ×
                  </button>
                </div>
                <div className="pa-popover-meta">
                  <span className="pa-muted">
                    来源：{formatSourceLabel(connectionSource, clientName, apiModel, skippedConnection)}
                  </span>
                  <div className="pa-row">
                    <span
                      className={`pa-pill ${getClientConnectionTone(connectionState)}`}
                      aria-label="顶部客户端连接状态"
                    >
                      客户端：{formatClientConnectionLabel(connectionState, clientName)}
                    </span>
                    <span
                      className={`pa-pill ${getAuthorizationTone(authorizationState)}`}
                      aria-label="顶部项目授权状态"
                    >
                      项目授权：{formatAuthorizationLabel(authorizationState)}
                    </span>
                  </div>
                </div>

                {/* Contextual Single Next-Step Auth Action */}
                {authorizationState === 'unauthorized' ? (
                  <button
                    type="button"
                    className="pa-btn pa-btn-primary pa-btn-sm"
                    disabled={readonlyAuthPending}
                    onClick={() => {
                      void handleRequestReadonlyAuthorization()
                    }}
                  >
                    {readonlyAuthPending ? '申请只读授权中…' : '申请原生只读授权'}
                  </button>
                ) : authorizationState !== 'authorized-writable' && draftRevision === null ? (
                  <div className="pa-list">
                    {connectionSource === 'none' ? (
                      <select
                        aria-label="写入目标入口"
                        className="pa-select"
                        value={selectedTakeoverTarget}
                        onChange={(event) =>
                          setSelectedTakeoverTarget(
                            event.target.value as 'local-agent' | 'model-api' | '',
                          )
                        }
                      >
                        <option value="">请选择写入目标入口</option>
                        <option value="local-agent">本地 Agent</option>
                        <option value="model-api">模型 API</option>
                      </select>
                    ) : null}
                    <button
                      type="button"
                      className="pa-btn pa-btn-primary pa-btn-sm"
                      disabled={
                        takeoverPending ||
                        (connectionSource === 'none' && !selectedTakeoverTarget)
                      }
                      onClick={() => {
                        void handleTakeoverDraft()
                      }}
                    >
                      {takeoverPending ? '申请写入中…' : '申请原生写入'}
                    </button>
                  </div>
                ) : null}

                <div className="pa-popover-footer">
                  <button
                    type="button"
                    className="pa-btn pa-btn-sm"
                    onClick={() => {
                      setConnectionPopoverOpen(false)
                      setShowOnboarding((prev) => !prev)
                    }}
                  >
                    切换连接
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* 2. Primary Workflow CTA: Complete & Save (only lit when saveable result exists) */}
          {hasSaveableResult && !showOnboarding ? (
            <button
              type="button"
              data-testid="complete-and-save-btn"
              className="pa-btn pa-btn-primary pa-btn-sm"
              aria-expanded={showCompletionView}
              onClick={() => {
                setCommitFeedback(null)
                setShowCompletionView((prev) => !prev)
              }}
            >
              完成并保存
            </button>
          ) : null}

          {/* 3. "More ⋯" Menu: All low-frequency controls tucked away cleanly */}
          <div className="pa-popover-anchor">
            <button
              type="button"
              data-testid="more-menu-btn"
              className="pa-btn pa-btn-ghost pa-more-btn"
              aria-label="更多操作"
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen}
              onClick={() => {
                setConnectionPopoverOpen(false)
                setMoreMenuOpen((prev) => !prev)
              }}
            >
              ⋯
            </button>

            {moreMenuOpen ? (
              <div
                className="pa-dropdown-menu"
                role="menu"
                aria-label="更多操作菜单"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="pa-menu-item"
                  onClick={() => {
                    setSidebarSection('conversation')
                    setSidebarTab((prev) => (prev === 'builtin' ? 'external' : 'builtin'))
                    setMoreMenuOpen(false)
                  }}
                >
                  <span>
                    {sidebarTab === 'builtin' ? '切换到外置 Agent 活动' : '切换到内置模型对话'}
                  </span>
                  <span className="pa-muted">
                    {sidebarTab === 'builtin' ? '当前：内置' : '当前：外置'}
                  </span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  data-testid="theme-toggle-btn"
                  aria-label="切换浅色/深色主题"
                  aria-pressed={theme === 'dark'}
                  className="pa-menu-item"
                  onClick={() => {
                    handleToggleTheme()
                    setMoreMenuOpen(false)
                  }}
                >
                  <span>主题外观</span>
                  <span className="pa-muted">
                    {theme === 'light' ? '☀ Light Studio' : '☾ Dark CAD'}
                  </span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="pa-menu-item"
                  onClick={() => {
                    setOnboardingChoice('skip-local')
                    setShowOnboarding(true)
                    setMoreMenuOpen(false)
                  }}
                >
                  <span>切换本地项目</span>
                  <span className="pa-muted pa-mono">{projectId}</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="pa-menu-item"
                  onClick={() => {
                    setMoreMenuOpen(false)
                    if (migrationReport) {
                      setMigrationDrawerOpen(true)
                    } else {
                      setSidebarSection('history')
                      void handleLoadMigrationReport()
                    }
                  }}
                >
                  <span>查看旧项目迁移差异报告</span>
                </button>

                <div className="pa-menu-divider" role="separator" />

                <a
                  href="#/desktop-m1-readonly"
                  role="menuitem"
                  className="pa-menu-item pa-menu-link"
                  onClick={() => setMoreMenuOpen(false)}
                >
                  <span>只读授权视图</span>
                </a>
                <a
                  href="#/desktop-legacy"
                  role="menuitem"
                  className="pa-menu-item pa-menu-link"
                  onClick={() => setMoreMenuOpen(false)}
                >
                  <span>返回旧工作台</span>
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {/* Non-disruptive External Project Modification Notifications (Part 1 §3) */}
      {externalNotifications.length > 0 ? (
        <section
          className="pa-external-notification"
          role="status"
          aria-label="外部项目修改结果通知"
        >
          {externalNotifications.map((item) => (
            <div key={item.eventId} className="pa-header">
              <div className="pa-row">
                <span className="pa-pill pa-tone-action">外部 Agent 修改完成</span>
                <strong>{item.projectName}</strong>
                <span className="pa-pill pa-tone-muted pa-mono">
                  {formatRevisionDisplay(item.draftRevision)}（{item.draftRevision}）
                </span>
                <span className="pa-muted">{item.summary}</span>
              </div>
              <div className="pa-controls">
                <button
                  type="button"
                  className="pa-btn pa-btn-active pa-btn-sm"
                  disabled={externalOpenPendingId === item.eventId}
                  onClick={() => {
                    void handleOpenExternalProjectResult(item)
                  }}
                >
                  {externalOpenPendingId === item.eventId ? '正在打开…' : '打开查看'}
                </button>
                <button
                  type="button"
                  className="pa-btn pa-btn-sm"
                  onClick={() => handleDismissExternalNotification(item.eventId)}
                >
                  稍后查看
                </button>
              </div>
            </div>
          ))}
          {externalOpenFeedback ? (
            <p className="pa-muted" role="alert">
              {externalOpenFeedback}
            </p>
          ) : null}
        </section>
      ) : externalOpenFeedback ? (
        <div className="pa-notice" role="alert">
          {externalOpenFeedback}
        </div>
      ) : null}

      {/* Legacy .cunlian Migration Diff Banner / Drawer (A10) */}
      {migrationReport ? (
        <M3MigrationBanner
          report={migrationReport}
          drawerOpen={migrationDrawerOpen}
          onToggleDrawer={() => setMigrationDrawerOpen((prev) => !prev)}
        />
      ) : null}

      {/* Completion View & Bound One-Time Formal Commit (A11 / A04) */}
      {showCompletionView ? (
        <div className="pa-completion-shell">
          <M3CompletionView
            partName={partName}
            projectName={projectName}
            baseRevision={baseRevision}
            draftRevision={draftRevision}
            model={canvasState.model}
            drawing={canvasState.drawing}
            checkSetFingerprint={checkSetFingerprint}
            readiness={completionReadiness}
            pendingConfirmation={activePendingConfirmation}
            invalidatedConfirmationNotice={effectiveInvalidatedConfirmationNotice}
            commitPending={commitPending}
            commitFeedback={commitFeedback}
            canUndoBlockedDraft={canUndoInCompletionView}
            undoPending={undoPending}
            undoFeedback={undoFeedback}
            onClose={() => setShowCompletionView(false)}
            onKeepDraft={() => {
              setPendingConfirmation(null)
              setShowCompletionView(false)
              setPreviewMessage(
                `已保留当前工作草稿（${formatRevisionDisplay(draftRevision)}），正式版保持 ${baseRevision ?? '无'}。`,
              )
            }}
            onUndoBlockedDraft={() => {
              void handleUndoBlockedDraft()
            }}
            onLocateCheckSource={(check) => {
              setSidebarSection('checks')
              handleSelectCheck(check)
            }}
            onStartOneTimeConfirm={handleStartOneTimeConfirm}
            onCancelOneTimeConfirm={handleCancelOneTimeConfirm}
            onConfirmCommitFormal={() => {
              void handleConfirmCommitFormal()
            }}
          />
        </div>
      ) : null}

      {/* Contextual Disconnect & Takeover Banner: appears ONLY when disconnected */}
      {showDisconnectBanner ? (
        <section
          className="pa-notice pa-disconnect-banner"
          role="alert"
          aria-label="断线与接管状态"
        >
          <div className="pa-header">
            <div className="pa-row">
              <strong>连接已断开</strong>
              <span>
                · 保留草稿 <span className="pa-mono">{draftRevision ?? '无'}</span>（正式版{' '}
                <span className="pa-mono">{baseRevision ?? '无'}</span> · 代际{' '}
                <span className="pa-mono">#{scopeEpoch}/{writerEpoch}</span>）
              </span>
            </div>
            <div className="pa-controls">
              <button
                ref={reconnectButtonRef}
                type="button"
                className="pa-btn pa-btn-primary pa-btn-sm"
                disabled={takeoverPending}
                onClick={() => {
                  void handleReconnect()
                }}
              >
                重连
              </button>
              {authorizationState === 'unauthorized' ? (
                <button
                  type="button"
                  className="pa-btn pa-btn-sm"
                  disabled={readonlyAuthPending}
                  onClick={() => {
                    void handleRequestReadonlyAuthorization()
                  }}
                >
                  {readonlyAuthPending ? '申请只读授权中…' : '申请原生只读授权'}
                </button>
              ) : (
                <>
                  {connectionSource === 'none' ? (
                    <select
                      aria-label="接管目标入口"
                      className="pa-select"
                      value={selectedTakeoverTarget}
                      onChange={(event) =>
                        setSelectedTakeoverTarget(
                          event.target.value as 'local-agent' | 'model-api' | '',
                        )
                      }
                    >
                      <option value="">请选择接管目标入口</option>
                      <option value="local-agent">本地 Agent</option>
                      <option value="model-api">模型 API</option>
                    </select>
                  ) : null}
                  <button
                    type="button"
                    className="pa-btn pa-btn-sm"
                    disabled={
                      takeoverPending ||
                      (connectionSource === 'none' && !selectedTakeoverTarget)
                    }
                    title={
                      connectionSource === 'none' && !selectedTakeoverTarget
                        ? '请先选择接管目标入口（本地 Agent 或模型 API）'
                        : undefined
                    }
                    onClick={() => {
                      void handleTakeoverDraft()
                    }}
                  >
                    接管当前草稿
                  </button>
                </>
              )}
              <button
                type="button"
                className="pa-btn pa-btn-ghost pa-btn-sm"
                onClick={() => setShowOnboarding(true)}
              >
                切换连接
              </button>
            </div>
          </div>
          {authorizationState === 'unauthorized' ? (
            <p className="pa-muted" role="note">
              已保留当前项目结果与上下文；须先完成原生只读授权，再申请写入或接管。
            </p>
          ) : connectionSource === 'none' ? (
            <p className="pa-muted" role="note">
              已保留当前项目结果与上下文；请先明确选择接管目标入口（本地 Agent 或模型 API）。
            </p>
          ) : null}
        </section>
      ) : null}

      {readonlyAuthNotice ? (
        <div className="pa-pass-box pa-inline-status-strip" role="status">
          <span>{readonlyAuthNotice}</span>
        </div>
      ) : null}

      {readonlyAuthError ? (
        <div className="pa-danger-box pa-inline-status-strip" role="alert">
          <span>{readonlyAuthError}</span>
        </div>
      ) : null}

      {takeoverNotice ? (
        <div className="pa-pass-box pa-inline-status-strip" role="status">
          <span>{takeoverNotice}</span>
        </div>
      ) : null}

      {takeoverError ? (
        <div className="pa-danger-box pa-inline-status-strip" role="alert">
          <span>{takeoverError}</span>
        </div>
      ) : null}

      {discardedStaleCount > 0 ? (
        <div className="pa-notice pa-inline-status-strip" role="status">
          已丢弃来自旧代际/先前客户端的迟到响应或事件（共{' '}
          <span className="pa-mono">{discardedStaleCount}</span> 条）。
        </div>
      ) : null}

      {/* Scene 1: Focused Single-Column Onboarding (Exclusive focus — hides workbench clutter) */}
      {showOnboarding ? (
        <div className="pa-onboarding-shell pa-onboarding-focused">
          <section className="pa-panel pa-onboarding-container" aria-label="首次启动与连接向导">
            <div className="pa-header pa-onboarding-hero">
              <div>
                <h2 className="pa-onboarding-title">选择一种方式连接 AI，开始建模</h2>
                <p className="pa-muted">
                  3 步完成一次设计：① 连上 AI → ② 看图对话改图 → ③ 核查并确认保存
                </p>
              </div>
              <button
                type="button"
                className="pa-icon-btn"
                aria-label="收起向导"
                title="收起向导"
                onClick={() => setShowOnboarding(false)}
              >
                ×
              </button>
            </div>

            {/* 2 Primary Choice Cards */}
            <div className="pa-onboarding-options-two" role="group" aria-label="连接入口选项">
              <button
                type="button"
                className={`pa-option-card ${onboardingChoice === 'local-agent' ? 'pa-option-card-active' : ''}`}
                aria-pressed={onboardingChoice === 'local-agent'}
                onClick={() => setOnboardingChoice('local-agent')}
              >
                <div className="pa-row">
                  <strong>连接本地 Agent</strong>
                  <span className="pa-pill pa-tone-action">推荐</span>
                </div>
                <span className="pa-muted">
                  复制 MCP 配置接入 Claude Desktop / Cursor 等本地客户端，零密钥外发。
                </span>
              </button>

              <button
                type="button"
                className={`pa-option-card ${onboardingChoice === 'model-api' ? 'pa-option-card-active' : ''}`}
                aria-pressed={onboardingChoice === 'model-api'}
                onClick={() => setOnboardingChoice('model-api')}
              >
                <div className="pa-row">
                  <strong>使用模型 API</strong>
                </div>
                <span className="pa-muted">
                  填入兼容 OpenAI 的地址、模型名与密钥，直接在寸链内对话建模。
                </span>
              </button>
            </div>

            {/* Expanded Step for Selected Card ONLY */}
            {onboardingChoice === 'local-agent' ? (
              <section className="pa-card pa-onboarding-step-card" aria-label="连接本地 Agent 配置">
                {!probe.capabilities.localAgentInstallInfo ||
                !probe.capabilities.connectionStatus ? (
                  <div className="pa-notice" role="alert">
                    后端尚未接线/不可用（缺失方法：
                    <span className="pa-mono">
                      {[
                        !probe.capabilities.localAgentInstallInfo
                          ? 'getM1LocalAgentInstallInfo'
                          : null,
                        !probe.capabilities.connectionStatus ? 'getM1ConnectionStatus' : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                    ）。下方展示默认配置模板，不会伪造已连接状态。
                  </div>
                ) : null}

                {/* Step 1: One-click Local Agent Auto-Detection & Registration */}
                <div className="pa-step-block">
                  <div className="pa-header">
                    <span className="pa-card-label">第 1 步 · 一键配置本地 Agent 客户端</span>
                    <button
                      type="button"
                      className="pa-btn pa-btn-ghost pa-btn-sm"
                      disabled={detectingLocalAgents || !connUxProbe.capabilities.detectLocalAgents}
                      onClick={() => {
                        void handleDetectLocalAgents()
                      }}
                    >
                      {detectingLocalAgents ? '检测中…' : '刷新检测'}
                    </button>
                  </div>

                  {!connUxProbe.capabilities.detectLocalAgents ? (
                    <div className="pa-notice" role="status">
                      本地 Agent 自动检测尚未接线/不可用，请展开下方「其他客户端 / 手动复制 MCP 配置」完成配置。
                    </div>
                  ) : detectingLocalAgents && !localAgentDetectCompleted ? (
                    <p className="pa-muted" role="status">
                      正在检测本机已安装的 Agent 客户端…
                    </p>
                  ) : localAgentDetectError ? (
                    <div className="pa-danger-box" role="alert">
                      <span>{localAgentDetectError}</span>
                    </div>
                  ) : (
                    <>
                      {sortedDetectedLocalAgents.detected.length > 0 ? (
                        <ul className="pa-agent-list" aria-label="已检测到的本地 Agent 列表">
                          {sortedDetectedLocalAgents.detected.map((agent) => (
                            <li key={agent.id} className="pa-agent-item">
                              <div className="pa-agent-item-info">
                                <div className="pa-row">
                                  <span className="pa-agent-item-name">{agent.name}</span>
                                  <span className="pa-muted">
                                    {agent.method === 'cli' ? 'CLI' : '配置文件'}
                                  </span>
                                </div>
                                {agent.detail || agent.configPath ? (
                                  <span className="pa-agent-item-meta pa-mono">
                                    {agent.detail ?? agent.configPath}
                                  </span>
                                ) : null}
                              </div>
                              {agent.configured ? (
                                <span className="pa-pill pa-tone-pass">已配置 ✓</span>
                              ) : (
                                <button
                                  type="button"
                                  className="pa-btn pa-btn-primary pa-btn-sm"
                                  disabled={registeringAgentId === agent.id}
                                  aria-label={`一键配置连接 ${agent.name}`}
                                  onClick={() => {
                                    void handleRegisterLocalAgent(agent)
                                  }}
                                >
                                  {registeringAgentId === agent.id ? '配置中…' : '一键配置连接'}
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="pa-muted" role="status">
                          暂未在本机检测到支持的 Agent 客户端，请展开下方手动复制 MCP 配置。
                        </p>
                      )}

                      {sortedDetectedLocalAgents.undetected.length > 0 ? (
                        <details className="pa-inline-details">
                          <summary className="pa-muted">
                            未检测到的其他支持客户端（{sortedDetectedLocalAgents.undetected.length}）
                          </summary>
                          <div className="pa-details-body">
                            <ul className="pa-agent-list" aria-label="未检测到的本地 Agent 列表">
                              {sortedDetectedLocalAgents.undetected.map((agent) => (
                                <li key={agent.id} className="pa-agent-item pa-agent-item-muted">
                                  <div className="pa-agent-item-info">
                                    <span className="pa-agent-item-name">{agent.name}</span>
                                    {agent.detail ? (
                                      <span className="pa-agent-item-meta">{agent.detail}</span>
                                    ) : null}
                                  </div>
                                  <span className="pa-pill pa-tone-muted">未检测到</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </details>
                      ) : null}
                    </>
                  )}

                  {registerFeedback ? (
                    <div
                      className={registerFeedback.ok ? 'pa-pass-box' : 'pa-danger-box'}
                      role={registerFeedback.ok ? 'status' : 'alert'}
                    >
                      <strong>{registerFeedback.message}</strong>
                      {registerFeedback.ok && registerFeedback.requiresRestart ? (
                        <span>请重启 {registerFeedback.agentName} 以加载新配置。</span>
                      ) : null}
                      {registerFeedback.ok && registerFeedback.configPath ? (
                        <span className="pa-mono">配置文件：{registerFeedback.configPath}</span>
                      ) : null}
                      {registerFeedback.ok && registerFeedback.backupPath ? (
                        <span className="pa-mono">原配置备份：{registerFeedback.backupPath}</span>
                      ) : null}
                    </div>
                  ) : null}

                  <details className="pa-inline-details pa-manual-mcp-details">
                    <summary className="pa-muted">其他客户端 / 手动复制 MCP 配置</summary>
                    <div className="pa-details-body">
                      <div className="pa-header">
                        <span className="pa-muted">手动复制 MCP JSON 配置片段</span>
                        <div className="pa-controls">
                          <button
                            type="button"
                            className="pa-btn pa-btn-sm"
                            onClick={() => {
                              void handleCopy(
                                localAgentConfig.mcpConfigJson,
                                'MCP 配置',
                                'local-agent',
                              )
                            }}
                          >
                            复制 MCP 配置
                          </button>
                        </div>
                      </div>
                      <pre className="pa-code-block pa-mono">{localAgentConfig.mcpConfigJson}</pre>
                      <details className="pa-inline-details">
                        <summary className="pa-muted">
                          查看自然语言连接说明与安装路径（{localAgentConfig.installPath}）
                        </summary>
                        <div className="pa-details-body">
                          <pre className="pa-code-block pa-mono">
                            {localAgentConfig.connectPrompt}
                          </pre>
                          <button
                            type="button"
                            className="pa-btn pa-btn-sm"
                            onClick={() => {
                              void handleCopy(
                                localAgentConfig.connectPrompt,
                                '连接说明',
                                'local-agent',
                              )
                            }}
                          >
                            复制连接说明
                          </button>
                        </div>
                      </details>
                    </div>
                  </details>
                </div>

                {/* Step 2: Clearly Separated Client Connection & Project Authorization */}
                <div className="pa-step-block">
                  <div className="pa-header">
                    <span className="pa-card-label">第 2 步 · 确认连接与项目授权</span>
                    <button
                      type="button"
                      className="pa-btn pa-btn-ghost pa-btn-sm"
                      disabled={statusChecking}
                      onClick={() => {
                        void handleRefreshConnectionStatus()
                      }}
                    >
                      {statusChecking ? '检测中…' : '检测连接状态'}
                    </button>
                  </div>

                  <div className="pa-grid">
                    <section className="pa-status-box" aria-label="客户端连接状态">
                      <span className="pa-card-label">客户端连接状态</span>
                      <div className="pa-row">
                        <span className={`pa-pill ${getClientConnectionTone(connectionState)}`}>
                          {formatClientConnectionLabel(connectionState, clientName)}
                        </span>
                        <span className="pa-muted pa-mono">{clientName ?? '未识别'}</span>
                      </div>
                    </section>

                    <section className="pa-status-box" aria-label="项目授权状态">
                      <span className="pa-card-label">项目授权状态</span>
                      <div className="pa-row">
                        <span className={`pa-pill ${getAuthorizationTone(authorizationState)}`}>
                          {formatAuthorizationLabel(authorizationState)}
                        </span>
                        {authorizationState === 'unauthorized' ? (
                          <button
                            type="button"
                            className="pa-btn pa-btn-sm pa-btn-active"
                            disabled={readonlyAuthPending}
                            onClick={() => {
                              void handleRequestReadonlyAuthorization()
                            }}
                          >
                            {readonlyAuthPending ? '正在申请…' : '申请原生只读授权'}
                          </button>
                        ) : authorizationState === 'authorized-readonly' ? (
                          <button
                            type="button"
                            className="pa-btn pa-btn-sm pa-btn-active"
                            disabled={takeoverPending}
                            onClick={() => {
                              void handleTakeoverDraft('local-agent')
                            }}
                          >
                            {takeoverPending
                              ? '正在申请…'
                              : draftRevision === null
                                ? '申请原生写入权限'
                                : '申请原生写入 / 接管草稿'}
                          </button>
                        ) : (
                          <span className="pa-muted pa-mono">写入方：{writerOwner ?? '已就绪'}</span>
                        )}
                      </div>
                    </section>
                  </div>
                </div>

                {localAgentCopyFeedback ? (
                  <p className="pa-muted" role="status">
                    {localAgentCopyFeedback}
                  </p>
                ) : null}
                {localAgentNotice ? (
                  <div className="pa-notice" role="status">
                    {localAgentNotice}
                  </div>
                ) : null}

                <div className="pa-onboarding-cta-row">
                  <button
                    type="button"
                    className="pa-btn pa-btn-primary"
                    onClick={() => {
                      setSidebarSection('conversation')
                      setSidebarTab('external')
                      setShowOnboarding(false)
                    }}
                  >
                    进入工作台
                  </button>
                </div>
              </section>
            ) : null}

            {onboardingChoice === 'model-api' ? (
              <section className="pa-card pa-onboarding-step-card" aria-label="使用模型 API 配置">
                {!probe.capabilities.modelApiTest ? (
                  <div className="pa-notice" role="alert">
                    后端尚未接线/不可用（缺失方法：
                    <span className="pa-mono">testM1ModelApiConnection</span>
                    ）。无法执行真实工具往返测试，内置建模对话保持锁定。
                  </div>
                ) : null}

                <div className="pa-form-stack">
                  <label className="pa-field">
                    服务商
                    <select
                      aria-label="服务商"
                      className="pa-input"
                      value={apiProviderId}
                      onChange={(event) => {
                        handleProviderChange(event.target.value as M1ModelApiProviderPresetId)
                      }}
                    >
                      {M1_MODEL_API_PROVIDER_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                    {!currentProviderPreset.isCustom ? (
                      <span className="pa-provider-url-hint pa-mono">
                        {currentProviderPreset.baseUrl}
                      </span>
                    ) : null}
                  </label>

                  {currentProviderPreset.isCustom ? (
                    <label className="pa-field">
                      服务地址
                      <input
                        type="text"
                        aria-label="服务地址"
                        className="pa-input pa-mono"
                        placeholder="https://api.example.com/v1"
                        value={apiBaseUrl}
                        onChange={(event) => {
                          setApiBaseUrl(event.target.value)
                          setAvailableApiModels([])
                          setModelListNotice(null)
                          resetModelApiUnlock()
                        }}
                      />
                    </label>
                  ) : null}

                  <div className="pa-form-grid-two">
                    <label className="pa-field">
                      <span>
                        密钥
                        {currentProviderPreset.apiKeyOptional ? '（可选）' : ''}
                      </span>
                      <input
                        type="password"
                        aria-label="密钥"
                        className="pa-input pa-mono"
                        placeholder={
                          currentProviderPreset.apiKeyOptional
                            ? '本地服务通常无需密钥（密钥可选）'
                            : 'sk-...'
                        }
                        value={apiKey}
                        onChange={(event) => {
                          setApiKey(event.target.value)
                          resetModelApiUnlock()
                        }}
                      />
                    </label>

                    <div className="pa-field">
                      <div className="pa-model-field-meta">
                        <span>模型名</span>
                        {availableApiModels.length > 0 ? (
                          <button
                            type="button"
                            className="pa-link-subtle"
                            onClick={() => setManualModelInputMode((prev) => !prev)}
                          >
                            {manualModelInputMode ? '选择列表' : '手动输入'}
                          </button>
                        ) : null}
                      </div>
                      <div className="pa-input-inline-row">
                        {availableApiModels.length > 0 && !manualModelInputMode ? (
                          <select
                            aria-label="模型名"
                            className="pa-input pa-mono"
                            value={apiModel}
                            onChange={(event) => {
                              setApiModel(event.target.value)
                              resetModelApiUnlock()
                            }}
                          >
                            {availableApiModels.map((modelName) => (
                              <option key={modelName} value={modelName}>
                                {modelName}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            aria-label="模型名"
                            className="pa-input pa-mono"
                            placeholder="例如 deepseek-chat / gpt-4o"
                            value={apiModel}
                            onChange={(event) => {
                              setApiModel(event.target.value)
                              resetModelApiUnlock()
                            }}
                          />
                        )}
                        <button
                          type="button"
                          className="pa-btn pa-btn-sm"
                          aria-label="刷新模型列表"
                          title="刷新模型列表"
                          disabled={modelListLoading}
                          onClick={() => {
                            void fetchModelApiModels({
                              baseUrl: apiBaseUrl,
                              apiKey,
                              providerId: apiProviderId,
                              explicit: true,
                            })
                          }}
                        >
                          ↻
                        </button>
                      </div>
                      {modelListLoading ? (
                        <span className="pa-provider-url-hint" role="status">
                          正在拉取可用模型…
                        </span>
                      ) : effectiveModelListNotice ? (
                        <span className="pa-provider-url-hint" role="status">
                          {effectiveModelListNotice}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Compact Outgoing Context Summary */}
                <section
                  className="pa-disclosure-box"
                  aria-label="本次需发送的文档片段与项目摘要"
                >
                  <div className="pa-row">
                    <span className="pa-card-label">外发上下文摘要</span>
                    <span className="pa-muted pa-mono">
                      {outgoingContextSummary.projectName}（{outgoingContextSummary.projectId}）· 草稿{' '}
                      {outgoingContextSummary.draftRevision ?? '无'}
                    </span>
                    {outgoingContextSummary.selectedObject ? (
                      <span className="pa-muted">
                        · 选中：{outgoingContextSummary.selectedObject.breadcrumb}
                      </span>
                    ) : null}
                  </div>
                  {outgoingContextSummary.documentExcerpts.length === 0 ? (
                    <p className="pa-muted">当前未附加任务书片段，仅发送项目基础摘要与最小工具探测请求。</p>
                  ) : (
                    <ul className="pa-list">
                      {outgoingContextSummary.documentExcerpts.map((doc) => (
                        <li key={doc.refId} className="pa-muted">
                          <strong className="pa-mono">
                            {doc.documentName} · P{doc.page}
                          </strong>
                          ：{doc.excerpt}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {modelApiFailure ? (
                  <div className="pa-danger-box" role="alert">
                    <strong>
                      {modelApiFailure.title}
                      {modelApiFailure.code ? `（${modelApiFailure.code}）` : ''}
                    </strong>
                    <span>{modelApiFailure.detail}</span>
                  </div>
                ) : null}

                {modelApiTestResult ? (
                  <section
                    className={builtinUnlocked ? 'pa-pass-box' : 'pa-notice'}
                    aria-label="模型 API 测试结果"
                  >
                    <div className="pa-row">
                      <strong>
                        {builtinUnlocked ? '连接与真实工具往返通过' : '连接结果未满足解锁条件'}
                      </strong>
                      <span className="pa-mono">当前模型：{modelApiTestResult.selectedModel}</span>
                    </div>
                    <div className="pa-row">
                      <span>
                        工具调用能力：{modelApiTestResult.toolCallSupported ? '支持' : '不支持'}
                      </span>
                      <span>
                        真实工具往返：
                        {modelApiTestResult.toolRoundTripPassed
                          ? `通过${modelApiTestResult.toolRoundTripName ? `（${modelApiTestResult.toolRoundTripName}）` : ''}`
                          : '未通过'}
                      </span>
                    </div>
                    <div className="pa-row">
                      <span>
                        可用模型：
                        <span className="pa-mono">
                          {modelApiTestResult.availableModels.length > 0
                            ? modelApiTestResult.availableModels.join(', ')
                            : '无'}
                        </span>
                      </span>
                    </div>
                    {modelApiTestResult.sentContextSummary ? (
                      <div className="pa-row" aria-label="实际发送上下文摘要">
                        <span>
                          实际发送上下文摘要：
                          <span className="pa-mono">{modelApiTestResult.sentContextSummary}</span>
                        </span>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                <div className="pa-onboarding-cta-row">
                  <button
                    ref={testModelApiButtonRef}
                    type="button"
                    className={builtinUnlocked ? 'pa-btn' : 'pa-btn pa-btn-primary'}
                    disabled={apiTesting}
                    onClick={() => {
                      void handleTestModelApi()
                    }}
                  >
                    {apiTesting ? '正在测试连接与工具往返…' : '测试连接'}
                  </button>
                  <button
                    type="button"
                    className={builtinUnlocked ? 'pa-btn pa-btn-primary' : 'pa-btn'}
                    disabled={!builtinUnlocked}
                    onClick={() => {
                      setSidebarSection('conversation')
                      setSidebarTab('builtin')
                      setShowOnboarding(false)
                    }}
                  >
                    开始建模
                  </button>
                </div>
              </section>
            ) : null}

            {onboardingChoice === 'skip-local' ? (
              <section className="pa-card pa-onboarding-step-card" aria-label="本地项目与示例">
                <div className="pa-header">
                  <h3 className="pa-title">选择本地项目或示例直接体验</h3>
                  <button
                    type="button"
                    className="pa-btn pa-btn-sm"
                    onClick={() => {
                      setSkippedConnection(true)
                      setShowOnboarding(false)
                    }}
                  >
                    直接进入当前工作台
                  </button>
                </div>
                {localProjects.length === 0 ? (
                  <p className="pa-muted">暂无本地项目与示例</p>
                ) : (
                  <ul className="pa-list">
                    {localProjects.map((item) => (
                      <li key={item.projectId} className="pa-check">
                        <div>
                          <div className="pa-row">
                            <strong>{item.projectName}</strong>
                            <span className="pa-mono pa-muted">{item.projectId}</span>
                            {item.isSample ? (
                              <span className="pa-pill pa-tone-action">示例</span>
                            ) : null}
                            <span className="pa-muted pa-mono">
                              正式版 {item.baseRevision ?? '无'} · 草稿 {item.draftRevision ?? '无'}
                            </span>
                          </div>
                          {item.summary ? <p className="pa-muted">{item.summary}</p> : null}
                        </div>
                        <button
                          type="button"
                          className="pa-btn pa-btn-sm"
                          aria-label={`打开项目 ${item.projectName}`}
                          onClick={() => handleOpenLocalProject(item)}
                        >
                          打开项目
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            {/* Single Subtle Skip Link at Bottom */}
            {onboardingChoice !== 'skip-local' ? (
              <div className="pa-onboarding-skip-row">
                <button
                  type="button"
                  className="pa-link-subtle"
                  onClick={() => {
                    setOnboardingChoice('skip-local')
                    setSkippedConnection(true)
                  }}
                >
                  先跳过，直接体验工作台
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : (
        /* Main Split Area: Pure Center Canvas + Unified Right Collaboration Dock */
        <div className="pa-workbench-body">
          <M2CenterCanvas
            viewMode={canvasState.viewMode}
            lastSingleTab={canvasState.lastSingleTab}
            isNarrow={isNarrow}
            sidebarMode={sidebarTab}
            model={canvasState.model}
            drawing={canvasState.drawing}
            drawingFailure={canvasState.drawingFailure}
            checksInProgress={canvasState.checksInProgress}
            naturalCompletionSummary={naturalCompletionSummary}
            features={canvasState.features}
            annotations={canvasState.annotations}
            modelMesh={canvasState.modelMesh}
            drawingVector={canvasState.drawingVector}
            selectedObjectId={canvasState.selectedObjectId}
            selectedAnnotationId={canvasState.selectedAnnotationId}
            highlightedFeatureIds={highlightedFeatureIds}
            highlightedAnnotationIds={highlightedAnnotationIds}
            selectionInvalidated={canvasState.selectionInvalidated}
            invalidatedObjectLabel={canvasState.invalidatedObjectLabel}
            camera={canvasState.camera}
            drawingViewport={canvasState.drawingViewport}
            structureOpen={structureOpen}
            retryDrawingPending={retryDrawingPending}
            retryDrawingFeedback={retryDrawingFeedback}
            contextActionFeedback={contextActionFeedback}
            previewMessage={previewMessage}
            theme={theme}
            canvasRegionRef={canvasRegionRef}
            objectListRegionRef={objectListRegionRef}
            retryDrawingButtonRef={retryDrawingButtonRef}
            onToggleStructure={() => setStructureOpen((prev) => !prev)}
            onCloseStructure={() => setStructureOpen(false)}
            onSelectFeature={handleSelectFeature}
            onSelectAnnotation={handleSelectAnnotation}
            onClearSelection={handleClearSelection}
            onBringIntoNextPrompt={handleBringIntoNextPrompt}
            onCopyToExternalSession={handleCopyToExternalSession}
            onRetryDrawing={() => {
              void handleRetryDrawing()
            }}
            onOpenCompletionView={() => {
              setCommitFeedback(null)
              setShowCompletionView(true)
            }}
            onUpdateCamera={(updater) =>
              setCanvasState((prev) => ({ ...prev, camera: updater(prev.camera) }))
            }
            onUpdateDrawingViewport={(updater) =>
              setCanvasState((prev) => ({
                ...prev,
                drawingViewport: updater(prev.drawingViewport),
              }))
            }
          />

          {/* Right: Minimal Underline-Tab Collaboration Sidebar */}
          <aside
            ref={sidebarRegionRef}
            tabIndex={-1}
            className="pa-panel pa-sidebar-column pa-focus-region"
            aria-label="主工作台侧栏"
          >
            <div className="pa-sidebar-tabs" role="tablist" aria-label="侧栏功能切换">
              <button
                type="button"
                role="tab"
                aria-selected={sidebarSection === 'conversation'}
                className={
                  sidebarSection === 'conversation'
                    ? 'pa-sidebar-tab pa-sidebar-tab-active'
                    : 'pa-sidebar-tab'
                }
                onClick={() => setSidebarSection('conversation')}
              >
                {sidebarTab === 'builtin' ? '对话' : '活动'}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sidebarSection === 'checks'}
                className={
                  sidebarSection === 'checks'
                    ? 'pa-sidebar-tab pa-sidebar-tab-active'
                    : 'pa-sidebar-tab'
                }
                onClick={() => setSidebarSection('checks')}
              >
                检查
                {checksSummaryCounts.total > 0 ? (
                  <span
                    className={`pa-tab-badge ${
                      checksSummaryCounts.failed > 0
                        ? 'pa-tab-badge-fail'
                        : checksSummaryCounts.pending > 0
                          ? 'pa-tab-badge-warn'
                          : 'pa-tab-badge-pass'
                    }`}
                    aria-hidden="true"
                  >
                    {checksSummaryCounts.passed}/{checksSummaryCounts.total}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sidebarSection === 'requirements'}
                className={
                  sidebarSection === 'requirements'
                    ? 'pa-sidebar-tab pa-sidebar-tab-active'
                    : 'pa-sidebar-tab'
                }
                onClick={() => setSidebarSection('requirements')}
              >
                要求
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sidebarSection === 'history'}
                className={
                  sidebarSection === 'history'
                    ? 'pa-sidebar-tab pa-sidebar-tab-active'
                    : 'pa-sidebar-tab'
                }
                onClick={() => setSidebarSection('history')}
              >
                历史
              </button>
            </div>

            <div className="pa-sidebar-content">
              {sidebarSection !== 'conversation' ? (
                <M2SidebarPanels
                  section={sidebarSection}
                  requirements={canvasState.requirements}
                  checks={canvasState.checks}
                  checksInProgress={canvasState.checksInProgress}
                  history={canvasState.history}
                  formalVersions={formalVersions}
                  uncommittedDrafts={uncommittedDrafts}
                  restoreStatus={restoreStatus}
                  migrationReport={migrationReport}
                  migrationLoading={migrationLoading}
                  migrationNotice={migrationNotice}
                  canUndoBlockedDraft={canUndoBlockedDraft}
                  undoPending={undoPending}
                  undoFeedback={undoFeedback}
                  activeCheckId={activeCheckId}
                  activeEvidence={activeEvidence}
                  evidenceLoading={evidenceLoading}
                  evidenceNotice={evidenceNotice}
                  clarificationFeedback={clarificationFeedback}
                  clarificationPendingId={clarificationPendingId}
                  onSelectCheck={handleSelectCheck}
                  onSelectRequirement={handleSelectRequirement}
                  onSubmitClarification={(params) => {
                    void handleSubmitClarification(params)
                  }}
                  onUndoBlockedDraft={() => {
                    void handleUndoBlockedDraft()
                  }}
                  onLoadMigrationReport={() => {
                    void handleLoadMigrationReport()
                  }}
                  onOpenMigrationDrawer={() => setMigrationDrawerOpen(true)}
                />
              ) : null}

              {/* External Mode Sidebar (Clean activity stream) */}
              {sidebarSection === 'conversation' && sidebarTab === 'external' ? (
                <section className="pa-list" aria-label="外置模式任务活动侧栏">
                  <div className="pa-header">
                    <span className="pa-card-label">外部 Agent 活动</span>
                    <button
                      type="button"
                      className="pa-btn pa-btn-ghost pa-btn-sm"
                      aria-label="刷新外部活动"
                      onClick={() => {
                        void handleRefreshExternalActivities()
                      }}
                    >
                      ↻ 刷新
                    </button>
                  </div>

                  {objectRefCopyFeedback ? (
                    <p className="pa-muted" role="status">
                      {objectRefCopyFeedback}
                    </p>
                  ) : null}

                  {activitiesNotice ? (
                    <div className="pa-notice" role="status">
                      {activitiesNotice}
                    </div>
                  ) : null}

                  {activities.length === 0 ? (
                    <div className="pa-empty-guide">
                      <p className="pa-muted">
                        暂无外部 Agent 任务活动。在本地客户端下达建模指令后，进度与结果会实时同步到这里。
                      </p>
                    </div>
                  ) : (
                    <ul className="pa-list" aria-label="外部 Agent 任务活动流">
                      {activities.map((item) => {
                        const badge = formatActivityStatusLabel(item.status)
                        return (
                          <li key={item.taskId} className="pa-card">
                            <div className="pa-header">
                              <strong>{item.title}</strong>
                              <span className={`pa-pill ${badge.tone}`}>{badge.label}</span>
                            </div>
                            {item.lastStep ? <p className="pa-muted">{item.lastStep}</p> : null}
                            {item.draftRevision ? (
                              <span className="pa-muted pa-mono">
                                关联草稿：{item.draftRevision}
                              </span>
                            ) : null}
                            {item.question ? (
                              <div className="pa-notice" aria-label="待回答问题">
                                <span className="pa-pill pa-tone-pending">
                                  {formatQuestionReason(item.question.reason)}
                                </span>{' '}
                                <span>{item.question.prompt}</span>
                                {item.question.sourceExcerpt ? (
                                  <p className="pa-muted">依据：{item.question.sourceExcerpt}</p>
                                ) : null}
                              </div>
                            ) : null}
                            <div className="pa-controls">
                              <button
                                type="button"
                                className="pa-btn pa-btn-sm"
                                onClick={() =>
                                  setPreviewMessage(
                                    `正在预览外部任务 ${item.taskId} 的产物（草稿 ${item.draftRevision ?? draftRevision ?? '无'}）${item.previewSummary ? `：${item.previewSummary}` : ''}。`,
                                  )
                                }
                              >
                                预览结果
                              </button>
                              <button
                                type="button"
                                className="pa-btn pa-btn-ghost pa-btn-sm"
                                onClick={() =>
                                  setPreviewMessage(
                                    `已打开任务 ${item.taskId} 的复核确认视图（草稿 ${item.draftRevision ?? draftRevision ?? '无'}，正式保存需服务端复核确认）。`,
                                  )
                                }
                              >
                                复核与确认
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              ) : null}

              {/* Built-in Mode Sidebar (Cursor/Linear-grade clean chat + single composer) */}
              {sidebarSection === 'conversation' && sidebarTab === 'builtin' ? (
                <section className="pa-chat-shell" aria-label="内置模式多轮对话侧栏">
                  {!builtinUnlocked ? (
                    <div className="pa-notice" role="alert">
                      <p>
                        内置对话尚未解锁：需先在「使用模型 API」中完成配置并通过真实工具往返测试。
                      </p>
                      <button
                        type="button"
                        className="pa-btn pa-btn-primary pa-btn-sm"
                        onClick={() => {
                          setOnboardingChoice('model-api')
                          setShowOnboarding(true)
                        }}
                      >
                        前往配置模型 API
                      </button>
                    </div>
                  ) : null}

                  {builtinUnlocked && !probe.capabilities.builtinChat ? (
                    <div className="pa-notice" role="alert">
                      后端尚未接线/不可用（缺失方法：
                      <span className="pa-mono">sendM1ChatMessage</span>）。
                    </div>
                  ) : null}

                  {/* Chat transcript or starter prompts */}
                  <div className="pa-chat-scroll">
                    {messages.length === 0 ? (
                      <div className="pa-empty-guide" aria-label="新手引导示例">
                        <p className="pa-muted">试试直接描述你的设计或修改需求：</p>
                        <div className="pa-starter-list">
                          {starterPrompts.map((promptText) => (
                            <button
                              key={promptText}
                              type="button"
                              className="pa-starter-chip"
                              disabled={!builtinUnlocked}
                              onClick={() => {
                                setChatInput(promptText)
                                chatInputRef.current?.focus()
                              }}
                            >
                              {promptText}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <ul className="pa-chat-list" aria-label="内置对话记录">
                        {messages.map((msg) => (
                          <li
                            key={msg.id}
                            className={`pa-chat-bubble ${msg.role === 'user' ? 'pa-chat-user' : 'pa-chat-assistant'}`}
                          >
                            <div className="pa-header">
                              <strong>{msg.role === 'user' ? '设计师' : '寸链助手'}</strong>
                              {msg.draftRevision ? (
                                <span className="pa-pill pa-tone-action pa-mono">
                                  草稿 {msg.draftRevision}
                                </span>
                              ) : null}
                            </div>
                            <p>{msg.content}</p>
                            {msg.attachments && msg.attachments.length > 0 ? (
                              <div className="pa-row">
                                {msg.attachments.map((att) => (
                                  <span key={att.refId} className="pa-pill pa-tone-muted pa-mono">
                                    引用：{att.documentName} · P{att.page}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {msg.selectedObject ? (
                              <span className="pa-pill pa-tone-action">
                                对象：{msg.selectedObject.breadcrumb}
                              </span>
                            ) : null}
                            {msg.toolCalls && msg.toolCalls.length > 0 ? (
                              <div className="pa-row">
                                {msg.toolCalls.map((tc, index) => {
                                  const display = formatChatToolCallItem(tc)
                                  return (
                                    <span
                                      key={`${msg.id}-tool-${index}`}
                                      className={`pa-pill ${display.tone}`}
                                    >
                                      {display.label}
                                    </span>
                                  )
                                })}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}

                    {lastFailedTurn && !chatPending ? (
                      <div className="pa-retry-row">
                        <button
                          ref={retryChatButtonRef}
                          type="button"
                          className="pa-btn pa-btn-sm"
                          onClick={() => {
                            void handleRetryChat()
                          }}
                        >
                          重试
                        </button>
                      </div>
                    ) : null}

                    {chatNotice ? (
                      <div className="pa-notice" role="status">
                        {chatNotice}
                      </div>
                    ) : null}
                  </div>

                  {/* Modern Unified Composer: Selected Tags + Clean Textarea + "+ 引用" Popover + Single Send/Stop */}
                  <div className="pa-composer">
                    {/* Lightweight inline tags for currently attached taskbooks / selected object */}
                    {attachedTaskbooks.length > 0 || (includeSelectedInChat && selectedObject) ? (
                      <div className="pa-composer-tags">
                        {includeSelectedInChat && selectedObject ? (
                          <span className="pa-composer-tag pa-composer-tag-obj">
                            {selectedObject.breadcrumb}
                          </span>
                        ) : null}
                        {attachedTaskbooks.map((tb) => (
                          <span key={tb.refId} className="pa-composer-tag pa-mono">
                            {tb.documentName} · P{tb.page}
                            <button
                              type="button"
                              className="pa-tag-remove"
                              aria-label={`移除引用 ${tb.documentName} P${tb.page}`}
                              onClick={() => toggleTaskbookAttachment(tb.refId)}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <textarea
                      ref={chatInputRef}
                      aria-label="内置对话输入框"
                      className="pa-composer-input"
                      placeholder="描述你想创建或修改的零件特征…"
                      value={chatInput}
                      disabled={!builtinUnlocked || chatPending}
                      onChange={(event) => setChatInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault()
                          if (builtinUnlocked && !chatPending && chatInput.trim().length > 0) {
                            void handleSendChat()
                          }
                        }
                      }}
                    />

                    <div className="pa-composer-footer">
                      <div className="pa-popover-anchor">
                        <button
                          type="button"
                          data-testid="attach-ref-btn"
                          className="pa-btn pa-btn-ghost pa-btn-sm"
                          aria-label="附加任务书引用"
                          aria-expanded={attachPopoverOpen}
                          onClick={() => setAttachPopoverOpen((prev) => !prev)}
                        >
                          + 引用
                          {attachedTaskbooks.length > 0 ? ` (${attachedTaskbooks.length})` : ''}
                        </button>

                        {attachPopoverOpen ? (
                          <div
                            className="pa-popover pa-attach-popover"
                            role="dialog"
                            aria-label="对话上下文附加"
                          >
                            <div className="pa-header">
                              <span className="pa-card-label">
                                附加任务书引用（{attachedTaskbooks.length}/{MAX_M1_CHAT_ATTACHMENTS}）
                              </span>
                              <button
                                type="button"
                                className="pa-icon-btn"
                                aria-label="关闭引用选择"
                                onClick={() => setAttachPopoverOpen(false)}
                              >
                                ×
                              </button>
                            </div>
                            {availableTaskbooks.length === 0 ? (
                              <p className="pa-muted">
                                当前项目上下文暂无可附加的真实任务书引用。
                              </p>
                            ) : (
                              <div className="pa-list">
                                {availableTaskbooks.map((tb) => {
                                  const active = attachedRefIds.includes(tb.refId)
                                  return (
                                    <button
                                      key={tb.refId}
                                      type="button"
                                      className={
                                        active
                                          ? 'pa-btn pa-btn-active pa-btn-sm'
                                          : 'pa-btn pa-btn-sm'
                                      }
                                      aria-pressed={active}
                                      onClick={() => toggleTaskbookAttachment(tb.refId)}
                                    >
                                      {active ? '✓ ' : '+ '}
                                      {tb.documentName} · P{tb.page}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                            <label className="pa-toggle">
                              <input
                                type="checkbox"
                                checked={includeSelectedInChat}
                                onChange={(event) => setIncludeSelectedInChat(event.target.checked)}
                              />
                              带入当前选中对象上下文
                            </label>
                          </div>
                        ) : null}
                      </div>

                      {chatPending ? (
                        <button
                          type="button"
                          className="pa-btn pa-btn-sm"
                          onClick={() => {
                            void handleStopChat()
                          }}
                        >
                          停止
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="pa-btn pa-btn-primary pa-btn-sm"
                          disabled={!builtinUnlocked || chatInput.trim().length === 0}
                          onClick={() => {
                            void handleSendChat()
                          }}
                        >
                          发送
                        </button>
                      )}
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          </aside>
        </div>
      )}
    </main>
  )
}
