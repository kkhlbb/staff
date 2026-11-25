import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import './ProjectAgentPanel.css'
import {
  applyAuthoritativeScopeEpochSync,
  buildLocalAgentConfigSnippet,
  canUseBuiltinModelApiChat,
  classifyModelApiFailure,
  computeModelApiConfigFingerprint,
  formatChatToolCallItem,
  formatSelectedObjectReference,
  isEventAcceptedForScope,
  isReplyAcceptedForScope,
  isScopedArtifactEventAccepted,
  MAX_M1_CHAT_ATTACHMENTS,
  normalizeWorkbenchBridgeError,
  probeM1ProjectAuthorization,
  probeM1WorkbenchBridge,
  resolveWindowM1ProjectAuthorization,
  resolveWindowM1WorkbenchBridge,
  shouldAcceptWorkbenchEventSequence,
  trimM1ChatAttachments,
  trimM1ChatHistory,
  type M1ChatToolCallItem,
  type M1ClientConnectionState,
  type M1ConnectionSource,
  type M1ConnectionStatusSnapshot,
  type M1ExternalActivityItem,
  type M1LocalAgentInstallInfo,
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
import { M2CenterCanvas } from './M2CenterCanvas'
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

  // Local Agent config state
  const [installInfo, setInstallInfo] = useState<M1LocalAgentInstallInfo | null>(null)
  const [localAgentNotice, setLocalAgentNotice] = useState<string | null>(null)
  const [localAgentCopyFeedback, setLocalAgentCopyFeedback] = useState<string | null>(null)
  const [objectRefCopyFeedback, setObjectRefCopyFeedback] = useState<string | null>(null)
  const [statusChecking, setStatusChecking] = useState(false)

  // Model API form & test state
  const [apiBaseUrl, setApiBaseUrl] = useState('https://api.openai.com/v1')
  const [apiModel, setApiModel] = useState('gpt-4.1')
  const [apiKey, setApiKey] = useState('')
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

  const handleWorkbenchKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const regions = [
      objectListRegionRef.current,
      canvasRegionRef.current,
      sidebarRegionRef.current,
    ]
    if (event.key === 'F6') {
      event.preventDefault()
      const active = document.activeElement
      const currentIdx = regions.findIndex(
        (region) => region !== null && (region === active || region.contains(active)),
      )
      const delta = event.shiftKey ? -1 : 1
      const nextIdx =
        currentIdx === -1
          ? event.shiftKey
            ? regions.length - 1
            : 0
          : (currentIdx + delta + regions.length) % regions.length
      regions[nextIdx]?.focus()
      return
    }
    if (event.altKey && event.key === '1') {
      event.preventDefault()
      objectListRegionRef.current?.focus()
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

  const resetModelApiUnlock = () => {
    const tracker = trackerRef.current
    // F03: Immediately invalidate any in-flight model API test request generation
    // so a late success reply for previous form values cannot unlock the edited form.
    tracker.modelApiTestEpoch += 1
    tracker.activeTestRequestId = null
    setApiTesting(false)
    setModelApiTestResult(null)
    setTestedModelApiConfigFingerprint(null)
    setModelApiFailure(null)
  }

  const handleTestModelApi = async (): Promise<void> => {
    setModelApiFailure(null)
    setModelApiTestResult(null)
    setTestedModelApiConfigFingerprint(null)

    if (!apiBaseUrl.trim() || !apiModel.trim() || !apiKey.trim()) {
      setModelApiFailure({
        title: '配置不完整',
        detail: '请填写服务地址、模型名与密钥后再测试连接。',
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

  const rootClassName = className ? `pa-workbench ${className}` : 'pa-workbench'

  return (
    <main
      className={rootClassName}
      data-theme={theme}
      aria-label="寸链 M1 双入口工作台"
      onKeyDown={handleWorkbenchKeyDown}
    >
      {/* Single-Row 48px Top Status Bar */}
      <header className="pa-workbench-topbar" aria-label="顶部连接状态栏">
        <div className="pa-topbar-left">
          <span className="pa-brand-mini" aria-hidden="true">
            <span className="pa-brand-mini-icon">寸</span>
            <span>寸链</span>
          </span>
          <h1 className="pa-title pa-project-title">{projectName}</h1>
          <span className="pa-project-id-tag pa-mono">{projectId}</span>
          <span className="pa-rev-capsule pa-mono" aria-label="修订版本状态">
            正式版 {baseRevision ?? '无'} · 草稿 {draftRevision ?? '无'}
          </span>
        </div>

        <div className="pa-topbar-right">
          <span className="pa-conn-capsule" aria-label="当前连接来源">
            <span
              className={
                connectionState === 'connected'
                  ? 'pa-conn-dot'
                  : connectionState === 'disconnected'
                    ? 'pa-conn-dot pa-conn-dot-offline'
                    : 'pa-conn-dot pa-conn-dot-idle'
              }
              aria-hidden="true"
            />
            连接来源：{formatSourceLabel(connectionSource, clientName, apiModel, skippedConnection)}
          </span>
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
          {authorizationState === 'unauthorized' && !showOnboarding && !showDisconnectBanner ? (
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
          ) : null}
          {authorizationState !== 'authorized-writable' &&
          draftRevision === null &&
          !showOnboarding ? (
            <>
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
                  authorizationState === 'unauthorized' ||
                  (connectionSource === 'none' && !selectedTakeoverTarget)
                }
                title={
                  authorizationState === 'unauthorized'
                    ? '须先完成原生只读授权，再申请写入或接管'
                    : connectionSource === 'none' && !selectedTakeoverTarget
                      ? '请先选择写入目标入口（本地 Agent 或模型 API）'
                      : undefined
                }
                onClick={() => {
                  void handleTakeoverDraft()
                }}
              >
                {takeoverPending ? '申请写入中…' : '申请原生写入'}
              </button>
            </>
          ) : null}

          <div className="pa-segmented" role="group" aria-label="顶部入口快捷切换">
            <button
              type="button"
              aria-pressed={sidebarSection === 'conversation' && sidebarTab === 'builtin'}
              className={
                sidebarSection === 'conversation' && sidebarTab === 'builtin'
                  ? 'pa-btn-active'
                  : undefined
              }
              onClick={() => {
                setSidebarSection('conversation')
                setSidebarTab('builtin')
              }}
            >
              内置对话
            </button>
            <button
              type="button"
              aria-pressed={sidebarSection === 'conversation' && sidebarTab === 'external'}
              className={
                sidebarSection === 'conversation' && sidebarTab === 'external'
                  ? 'pa-btn-active'
                  : undefined
              }
              onClick={() => {
                setSidebarSection('conversation')
                setSidebarTab('external')
              }}
            >
              外置活动
            </button>
          </div>

          <button
            type="button"
            className="pa-btn pa-btn-sm"
            onClick={() => setShowOnboarding((prev) => !prev)}
          >
            切换连接
          </button>

          <button
            type="button"
            className="pa-btn pa-theme-btn"
            data-testid="theme-toggle-btn"
            aria-label="切换浅色/深色主题"
            aria-pressed={theme === 'dark'}
            title={theme === 'light' ? '切换至 Dark CAD 深色工程台' : '切换至 Light Studio 浅色制图台'}
            onClick={handleToggleTheme}
          >
            {theme === 'light' ? '☀ Light Studio' : '☾ Dark CAD'}
          </button>

          {hasSaveableResult ? (
            <button
              type="button"
              className={
                showCompletionView ? 'pa-btn pa-btn-primary pa-btn-sm' : 'pa-btn pa-btn-primary pa-btn-sm'
              }
              aria-expanded={showCompletionView}
              onClick={() => {
                setCommitFeedback(null)
                setShowCompletionView((prev) => !prev)
              }}
            >
              保存此版本 / 完成视图
            </button>
          ) : null}

          <a href="#/desktop-m1-readonly" className="pa-link-btn pa-link-ghost">
            只读授权视图
          </a>
          <a href="#/desktop-legacy" className="pa-link-btn pa-link-ghost">
            返回旧工作台
          </a>
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

      {/* Disconnect & Takeover Banner */}
      {showDisconnectBanner ? (
        <section
          className="pa-notice pa-disconnect-banner"
          role="alert"
          aria-label="断线与接管状态"
        >
          <div className="pa-header">
            <div>
              <strong>连接已断开</strong> · 项目{' '}
              <span className="pa-mono">{projectName}</span>（
              <span className="pa-mono">{projectId}</span>） · 当前版本：正式版{' '}
              <span className="pa-mono">{baseRevision ?? '无'}</span> / 草稿{' '}
              <span className="pa-mono">{draftRevision ?? '无'}</span>
            </div>
            <div className="pa-controls">
              <button
                ref={reconnectButtonRef}
                type="button"
                className="pa-btn"
                disabled={takeoverPending}
                onClick={() => {
                  void handleReconnect()
                }}
              >
                重连
              </button>
              <button
                type="button"
                className="pa-btn"
                onClick={() => setShowOnboarding(true)}
              >
                切换入口
              </button>
              {authorizationState === 'unauthorized' ? (
                <button
                  type="button"
                  className="pa-btn pa-btn-active"
                  disabled={readonlyAuthPending}
                  onClick={() => {
                    void handleRequestReadonlyAuthorization()
                  }}
                >
                  {readonlyAuthPending ? '申请只读授权中…' : '申请原生只读授权'}
                </button>
              ) : null}
              {connectionSource === 'none' ? (
                <select
                  aria-label="接管目标入口"
                  className="pa-input"
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
                className="pa-btn pa-btn-active"
                disabled={
                  takeoverPending ||
                  authorizationState === 'unauthorized' ||
                  (connectionSource === 'none' && !selectedTakeoverTarget)
                }
                title={
                  authorizationState === 'unauthorized'
                    ? '须先完成原生只读授权，再申请写入或接管'
                    : connectionSource === 'none' && !selectedTakeoverTarget
                      ? '请先选择接管目标入口（本地 Agent 或模型 API）'
                      : undefined
                }
                onClick={() => {
                  void handleTakeoverDraft()
                }}
              >
                接管当前草稿
              </button>
            </div>
          </div>
          {authorizationState === 'unauthorized' ? (
            <p className="pa-muted" role="note">
              须先完成原生只读授权，再申请写入或接管。
            </p>
          ) : null}
          {connectionSource === 'none' && authorizationState !== 'unauthorized' ? (
            <p className="pa-muted" role="note">
              当前未建立连接来源，请先明确选择目标入口（本地 Agent 或模型 API）后再发起写入或接管。
            </p>
          ) : null}
          <p className="pa-muted">
            已保留当前项目结果、任务活动与对话上下文，断线不等于清空或取消。当前本地代际{' '}
            <span className="pa-mono">#{scopeEpoch}</span> / 写入代际{' '}
            <span className="pa-mono">#{writerEpoch}</span>。
          </p>
        </section>
      ) : null}

      {readonlyAuthNotice ? (
        <div className="pa-pass-box" role="status">
          <span>{readonlyAuthNotice}</span>
        </div>
      ) : null}

      {readonlyAuthError ? (
        <div className="pa-danger-box" role="alert">
          <span>{readonlyAuthError}</span>
        </div>
      ) : null}

      {takeoverNotice ? (
        <div className="pa-pass-box" role="status">
          <span>{takeoverNotice}</span>
        </div>
      ) : null}

      {takeoverError ? (
        <div className="pa-danger-box" role="alert">
          <span>{takeoverError}</span>
        </div>
      ) : null}

      {discardedStaleCount > 0 ? (
        <div className="pa-notice" role="status">
          已丢弃来自旧代际/先前客户端的迟到响应或事件（共{' '}
          <span className="pa-mono">{discardedStaleCount}</span> 条）。
        </div>
      ) : null}

      {/* Onboarding / Connection Selector */}
      {showOnboarding ? (
        <div className="pa-onboarding-shell">
          <section className="pa-panel pa-onboarding-container" aria-label="首次启动与连接向导">
            <div className="pa-header pa-onboarding-hero">
              <div className="pa-row">
                <span className="pa-brand-mini-icon" aria-hidden="true">
                  寸
                </span>
                <h2 className="pa-title">连接方式与入口向导</h2>
                <span className="pa-pill pa-tone-muted">随时可通过顶部“切换连接”重选</span>
              </div>
              <button
                type="button"
                className="pa-btn pa-btn-sm"
                onClick={() => setShowOnboarding(false)}
              >
                收起向导
              </button>
            </div>

          <div className="pa-onboarding-options" role="group" aria-label="连接入口选项">
            <button
              type="button"
              className={`pa-option-card ${onboardingChoice === 'local-agent' ? 'pa-option-card-active' : ''}`}
              aria-pressed={onboardingChoice === 'local-agent'}
              onClick={() => setOnboardingChoice('local-agent')}
            >
              <div className="pa-row">
                <strong>连接本地 Agent</strong>
                <span className="pa-pill pa-tone-action">首选</span>
              </div>
              <span className="pa-muted">
                在常用的本地 Agent 中说“连接寸链”或复制本机 MCP 配置接入。
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
                <span className="pa-pill pa-tone-muted">第二项</span>
              </div>
              <span className="pa-muted">
                配置服务地址、模型名与密钥，通过真实工具往返后启用内置建模对话。
              </span>
            </button>

            <button
              type="button"
              className={`pa-option-card ${onboardingChoice === 'skip-local' ? 'pa-option-card-active' : ''}`}
              aria-pressed={onboardingChoice === 'skip-local'}
              onClick={() => {
                setOnboardingChoice('skip-local')
                setSkippedConnection(true)
              }}
            >
              <div className="pa-row">
                <strong>跳过（查看本地项目与示例）</strong>
              </div>
              <span className="pa-muted">
                暂不连接外部 Agent 或模型 API，先查看本机项目与示例任务。
              </span>
            </button>
          </div>

          {/* Local Agent Config Panel */}
          {onboardingChoice === 'local-agent' ? (
            <section className="pa-card" aria-label="连接本地 Agent 配置">
              <div className="pa-header">
                <h3 className="pa-title">连接本地 Agent</h3>
                <div className="pa-controls">
                  <button
                    type="button"
                    className="pa-btn"
                    disabled={statusChecking}
                    onClick={() => {
                      void handleRefreshConnectionStatus()
                    }}
                  >
                    {statusChecking ? '检测中…' : '检测连接状态'}
                  </button>
                  <button
                    type="button"
                    className="pa-btn pa-btn-active"
                    onClick={() => {
                      setSidebarSection('conversation')
                      setSidebarTab('external')
                      setShowOnboarding(false)
                    }}
                  >
                    进入外置任务活动
                  </button>
                </div>
              </div>

              {!probe.capabilities.localAgentInstallInfo || !probe.capabilities.connectionStatus ? (
                <div className="pa-notice" role="alert">
                  后端尚未接线/不可用（缺失方法：
                  <span className="pa-mono">
                    {[
                      !probe.capabilities.localAgentInstallInfo ? 'getM1LocalAgentInstallInfo' : null,
                      !probe.capabilities.connectionStatus ? 'getM1ConnectionStatus' : null,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                  ）。下方展示基于默认安装位置生成的配置模板，不会伪造已连接状态。
                </div>
              ) : null}

              <div className="pa-grid">
                <section className="pa-card pa-status-box" aria-label="客户端连接状态">
                  <span className="pa-card-label">客户端连接状态（握手与能力发现）</span>
                  <div className="pa-row">
                    <span className={`pa-pill ${getClientConnectionTone(connectionState)}`}>
                      {formatClientConnectionLabel(connectionState, clientName)}
                    </span>
                    <span className="pa-muted">
                      客户端名称：<span className="pa-mono">{clientName ?? '未识别'}</span>
                    </span>
                  </div>
                </section>

                <section className="pa-card pa-status-box" aria-label="项目授权状态">
                  <span className="pa-card-label">项目授权状态（独立于客户端握手）</span>
                  <div className="pa-row">
                    <span className={`pa-pill ${getAuthorizationTone(authorizationState)}`}>
                      {formatAuthorizationLabel(authorizationState)}
                    </span>
                    <span className="pa-muted">
                      写入方：<span className="pa-mono">{writerOwner ?? '无'}</span>
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
                        {readonlyAuthPending ? '正在申请只读授权…' : '申请原生只读授权'}
                      </button>
                    ) : null}
                    {authorizationState !== 'authorized-writable' ? (
                      <button
                        type="button"
                        className="pa-btn pa-btn-sm pa-btn-active"
                        disabled={takeoverPending || authorizationState === 'unauthorized'}
                        title={
                          authorizationState === 'unauthorized'
                            ? '须先完成原生只读授权，再申请写入或接管'
                            : undefined
                        }
                        onClick={() => {
                          void handleTakeoverDraft('local-agent')
                        }}
                      >
                        {takeoverPending
                          ? '正在申请写入…'
                          : draftRevision === null
                            ? '申请原生写入权限'
                            : '申请原生写入 / 接管草稿'}
                      </button>
                    ) : null}
                  </div>
                  {authorizationState === 'unauthorized' ? (
                    <p className="pa-muted">须先完成原生只读授权，再申请写入或接管。</p>
                  ) : null}
                </section>
              </div>

              <div className="pa-row">
                <span className="pa-muted">
                  当前安装位置：<span className="pa-mono">{localAgentConfig.installPath}</span>
                  {localAgentConfig.fromBackend ? '（来自本机服务）' : '（默认安装路径）'}
                </span>
              </div>

              <div className="pa-card pa-code-block-wrap">
                <div className="pa-header pa-code-block-header">
                  <span className="pa-card-label">自然语言连接说明</span>
                  <button
                    type="button"
                    className="pa-btn pa-btn-sm"
                    onClick={() => {
                      void handleCopy(localAgentConfig.connectPrompt, '连接说明', 'local-agent')
                    }}
                  >
                    复制连接说明
                  </button>
                </div>
                <pre className="pa-code-block pa-mono">{localAgentConfig.connectPrompt}</pre>
              </div>

              <div className="pa-card pa-code-block-wrap">
                <div className="pa-header pa-code-block-header">
                  <span className="pa-card-label">MCP 客户端配置片段（JSON）</span>
                  <button
                    type="button"
                    className="pa-btn pa-btn-sm"
                    onClick={() => {
                      void handleCopy(localAgentConfig.mcpConfigJson, 'MCP 配置', 'local-agent')
                    }}
                  >
                    复制 MCP 配置
                  </button>
                </div>
                <pre className="pa-code-block pa-mono">{localAgentConfig.mcpConfigJson}</pre>
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
            </section>
          ) : null}

          {/* Model API Config Panel */}
          {onboardingChoice === 'model-api' ? (
            <section className="pa-card" aria-label="使用模型 API 配置">
              <div className="pa-header">
                <h3 className="pa-title">使用模型 API</h3>
                <span
                  className={`pa-pill ${builtinUnlocked ? 'pa-tone-pass' : 'pa-tone-pending'}`}
                >
                  {builtinUnlocked ? '工具往返已通过 · 内置对话已解锁' : '内置对话未解锁'}
                </span>
              </div>

              {!probe.capabilities.modelApiTest ? (
                <div className="pa-notice" role="alert">
                  后端尚未接线/不可用（缺失方法：
                  <span className="pa-mono">testM1ModelApiConnection</span>
                  ）。无法执行真实工具往返测试，内置建模对话保持锁定。
                </div>
              ) : null}

              <div className="pa-form-grid">
                <label className="pa-field">
                  服务地址
                  <input
                    type="text"
                    aria-label="服务地址"
                    className="pa-input pa-mono"
                    value={apiBaseUrl}
                    onChange={(event) => {
                      setApiBaseUrl(event.target.value)
                      resetModelApiUnlock()
                    }}
                  />
                </label>
                <label className="pa-field">
                  模型名
                  <input
                    type="text"
                    aria-label="模型名"
                    className="pa-input pa-mono"
                    value={apiModel}
                    onChange={(event) => {
                      setApiModel(event.target.value)
                      resetModelApiUnlock()
                    }}
                  />
                </label>
                <label className="pa-field">
                  密钥
                  <input
                    type="password"
                    aria-label="密钥"
                    className="pa-input pa-mono"
                    placeholder="sk-..."
                    value={apiKey}
                    onChange={(event) => {
                      setApiKey(event.target.value)
                      resetModelApiUnlock()
                    }}
                  />
                </label>
              </div>

              {/* Outgoing document excerpts & project summary */}
              <section
                className="pa-card pa-disclosure-box"
                aria-label="本次需发送的文档片段与项目摘要"
              >
                <span className="pa-card-label">本次需发送的文档片段与项目摘要</span>
                <div className="pa-row">
                  <span>
                    项目：<span className="pa-mono">{outgoingContextSummary.projectName}</span>（
                    <span className="pa-mono">{outgoingContextSummary.projectId}</span>）
                  </span>
                  <span>
                    当前草稿：
                    <span className="pa-mono">
                      {outgoingContextSummary.draftRevision ?? '无'}
                    </span>
                  </span>
                  {outgoingContextSummary.selectedObject ? (
                    <span>
                      选中对象：{outgoingContextSummary.selectedObject.breadcrumb}
                    </span>
                  ) : null}
                </div>
                {outgoingContextSummary.documentExcerpts.length === 0 ? (
                  <p className="pa-muted">当前未附加任务书片段，仅发送项目基础摘要与最小工具探测请求。</p>
                ) : (
                  <ul className="pa-list">
                    {outgoingContextSummary.documentExcerpts.map((doc) => (
                      <li key={doc.refId} className="pa-check">
                        <span>
                          <strong className="pa-mono">
                            {doc.documentName} · P{doc.page}
                          </strong>
                          ：{doc.excerpt}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="pa-controls">
                <button
                  ref={testModelApiButtonRef}
                  type="button"
                  className="pa-btn pa-btn-active"
                  disabled={apiTesting}
                  onClick={() => {
                    void handleTestModelApi()
                  }}
                >
                  {apiTesting ? '正在测试连接与工具往返…' : '测试连接'}
                </button>
                <button
                  type="button"
                  className="pa-btn"
                  disabled={!builtinUnlocked}
                  onClick={() => {
                    setSidebarSection('conversation')
                    setSidebarTab('builtin')
                    setShowOnboarding(false)
                  }}
                >
                  进入内置建模对话
                </button>
              </div>

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
            </section>
          ) : null}

          {/* Skip / Local Projects & Samples Panel */}
          {onboardingChoice === 'skip-local' ? (
            <section className="pa-card" aria-label="本地项目与示例">
              <h3 className="pa-title">本地项目与示例</h3>
              <p className="pa-muted">
                无需先连接外部 Agent 或模型 API，可直接打开以下本地项目或示例进行浏览。
              </p>
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
                        className="pa-btn"
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
          </section>
        </div>
      ) : null}

      {/* Main Split Area: Center Dual-View Canvas + 4-Tab Sidebar */}
      <div className="pa-workbench-body">
        <M2CenterCanvas
          projectName={projectName}
          baseRevision={baseRevision}
          draftRevision={draftRevision}
          scopeEpoch={scopeEpoch}
          writerEpoch={writerEpoch}
          viewMode={canvasState.viewMode}
          lastSingleTab={canvasState.lastSingleTab}
          isNarrow={isNarrow}
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
          retryDrawingPending={retryDrawingPending}
          retryDrawingFeedback={retryDrawingFeedback}
          contextActionFeedback={contextActionFeedback}
          previewMessage={previewMessage}
          theme={theme}
          canvasRegionRef={canvasRegionRef}
          objectListRegionRef={objectListRegionRef}
          retryDrawingButtonRef={retryDrawingButtonRef}
          onChangeViewMode={handleChangeViewMode}
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

        {/* Right: 4-Tab Sidebar (对话/活动 · 要求 · 检查 · 历史) */}
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
              对话/活动
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
              aria-selected={sidebarSection === 'checks'}
              className={
                sidebarSection === 'checks'
                  ? 'pa-sidebar-tab pa-sidebar-tab-active'
                  : 'pa-sidebar-tab'
              }
              onClick={() => setSidebarSection('checks')}
            >
              检查
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

          {sidebarSection === 'conversation' ? (
            <div className="pa-mode-subbar">
              <div className="pa-segmented" role="tablist" aria-label="侧栏入口切换">
                <button
                  type="button"
                  role="tab"
                  aria-selected={sidebarTab === 'external'}
                  className={sidebarTab === 'external' ? 'pa-btn pa-btn-active' : 'pa-btn'}
                  onClick={() => setSidebarTab('external')}
                >
                  外置任务活动
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sidebarTab === 'builtin'}
                  className={sidebarTab === 'builtin' ? 'pa-btn pa-btn-active' : 'pa-btn'}
                  onClick={() => setSidebarTab('builtin')}
                >
                  内置建模对话
                </button>
              </div>
            </div>
          ) : null}

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

          {/* External Mode Sidebar */}
          {sidebarSection === 'conversation' && sidebarTab === 'external' ? (
            <section className="pa-list" aria-label="外置模式任务活动侧栏">
              <div className="pa-controls">
                <button
                  type="button"
                  className="pa-btn"
                  disabled={!selectedObject}
                  onClick={() => {
                    if (!selectedObject) return
                    void handleCopy(
                      formatSelectedObjectReference(selectedObject),
                      '对象引用',
                      'object-ref',
                    )
                  }}
                >
                  复制当前选中对象引用
                </button>
                <button
                  type="button"
                  className="pa-btn"
                  onClick={() => {
                    void handleRefreshExternalActivities()
                  }}
                >
                  刷新外部活动
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
                <p className="pa-muted">暂无外部 Agent 任务活动。</p>
              ) : (
                <ul className="pa-list" aria-label="外部 Agent 任务活动流">
                  {activities.map((item) => {
                    const badge = formatActivityStatusLabel(item.status)
                    return (
                      <li key={item.taskId} className="pa-card">
                        <div className="pa-header">
                          <div className="pa-row">
                            <strong>{item.title}</strong>
                            <span className="pa-mono pa-muted">{item.taskId}</span>
                          </div>
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
                            className="pa-btn"
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
                            className="pa-btn"
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

          {/* Built-in Mode Sidebar */}
          {sidebarSection === 'conversation' && sidebarTab === 'builtin' ? (
            <section className="pa-list" aria-label="内置模式多轮对话侧栏">
              {!builtinUnlocked ? (
                <div className="pa-notice" role="alert">
                  <p>
                    内置建模对话尚未解锁：需先在「使用模型 API」中完成配置并通过一次真实工具往返测试。
                  </p>
                  <div className="pa-controls">
                    <button
                      type="button"
                      className="pa-btn pa-btn-active"
                      onClick={() => {
                        setOnboardingChoice('model-api')
                        setShowOnboarding(true)
                      }}
                    >
                      前往配置模型 API
                    </button>
                  </div>
                </div>
              ) : null}

              {builtinUnlocked && !probe.capabilities.builtinChat ? (
                <div className="pa-notice" role="alert">
                  后端尚未接线/不可用（缺失方法：
                  <span className="pa-mono">sendM1ChatMessage</span>）。
                </div>
              ) : null}

              {/* Taskbook references & selected object context controls */}
              <div className="pa-card" aria-label="对话上下文附加">
                <span className="pa-card-label">
                  附加任务书引用（已选 {attachedTaskbooks.length}/{MAX_M1_CHAT_ATTACHMENTS}）
                </span>
                {availableTaskbooks.length === 0 ? (
                  <p className="pa-muted">
                    当前项目上下文暂无可附加的真实任务书引用，将仅发送空引用列表。
                  </p>
                ) : (
                  <div className="pa-controls">
                    {availableTaskbooks.map((tb) => {
                      const active = attachedRefIds.includes(tb.refId)
                      return (
                        <button
                          key={tb.refId}
                          type="button"
                          className={active ? 'pa-btn pa-btn-active' : 'pa-btn'}
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
                  {selectedObject ? `（${selectedObject.breadcrumb}）` : '（当前未选中对象）'}
                </label>
              </div>

              {/* Chat transcript */}
              <ul className="pa-chat-list" aria-label="内置对话记录">
                {messages.length === 0 ? (
                  <li className="pa-muted">暂无对话记录，可输入修改需求并附加任务书或选中对象。</li>
                ) : (
                  messages.map((msg) => (
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
                  ))
                )}
              </ul>

              {chatNotice ? (
                <div className="pa-notice" role="status">
                  {chatNotice}
                </div>
              ) : null}

              {/* Input & send/stop/retry */}
              <div className="pa-card">
                <label className="pa-field">
                  对话指令
                  <textarea
                    ref={chatInputRef}
                    aria-label="内置对话输入框"
                    className="pa-textarea"
                    placeholder="例如：把这个孔向右移 1 mm，并复核边距要求"
                    value={chatInput}
                    disabled={!builtinUnlocked || chatPending}
                    onChange={(event) => setChatInput(event.target.value)}
                  />
                </label>
                <div className="pa-controls">
                  <button
                    type="button"
                    className="pa-btn pa-btn-active"
                    disabled={!builtinUnlocked || chatPending || chatInput.trim().length === 0}
                    onClick={() => {
                      void handleSendChat()
                    }}
                  >
                    发送
                  </button>
                  {chatPending ? (
                    <button
                      type="button"
                      className="pa-btn"
                      onClick={() => {
                        void handleStopChat()
                      }}
                    >
                      停止
                    </button>
                  ) : null}
                  {lastFailedTurn && !chatPending ? (
                    <button
                      ref={retryChatButtonRef}
                      type="button"
                      className="pa-btn"
                      onClick={() => {
                        void handleRetryChat()
                      }}
                    >
                      重试
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}
          </div>
        </aside>
      </div>
    </main>
  )
}
