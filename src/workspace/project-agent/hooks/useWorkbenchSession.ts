import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { cloneTemplateToDraft, type BuiltinTemplateId } from '../../../templates/registry'
import type { ElectronTransport } from '../../../transport/electronTransport'
import {
  applyAuthoritativeScopeEpochSync,
  buildLocalAgentConfigSnippet,
  canAutoFetchModelApiModels,
  canUseBuiltinModelApiChat,
  classifyModelApiFailure,
  computeModelApiConfigFingerprint,
  DEFAULT_M1_MODEL_API_PROVIDER_ID,
  formatSelectedObjectReference,
  getModelApiProviderPreset,
  isEventAcceptedForScope,
  isReplyAcceptedForScope,
  isScopedArtifactEventAccepted,
  MAX_M1_CHAT_ATTACHMENTS,
  normalizeWorkbenchBridgeError,
  selectPreferredModelFromList,
  shouldAcceptWorkbenchEventSequence,
  sortDetectedLocalAgents,
  trimM1ChatAttachments,
  trimM1ChatHistory,
  type M1ClientConnectionState,
  type M1ConnectionSource,
  type M1ConnectionStatusSnapshot,
  type M1DetectedLocalAgent,
  type M1ExternalActivityItem,
  type M1LocalAgentId,
  type M1LocalAgentInstallInfo,
  type M1ModelApiProviderPresetId,
  type M1ModelApiTestResult,
  type M1OutgoingContextSummary,
  type M1ProjectAuthorizationState,
  type M1SelectedObjectRef,
  type M1TaskbookReference,
  type M1WorkbenchErrorPayload,
  type M1WorkbenchIncomingEvent,
} from '../m1WorkbenchBridge'
import {
  acceptAuthorizedEntryScope,
  buildM1AuthorizationRequest,
} from '../m1ReadonlyAuthBridge'
import {
  createInitialM2CanvasState,
  formatRevisionDisplay,
  reduceM2PreviewEvent,
  type M2PreviewEvent,
  type M2PreviewSnapshot,
  type M2SidebarSection,
  type M2ViewMode,
} from '../m2WorkbenchBridge'
import { focusRecoveryElement } from '../focusRecovery'
import {
  persistWorkbenchTheme,
  readStoredWorkbenchTheme,
  type WorkbenchTheme,
} from '../workbenchTheme'
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
  type M3BoundConfirmation,
  type M3ExternalNotificationWatermarks,
  type M3ExternalProjectEvent,
  type M3FormalVersionItem,
  type M3MigrationReport,
  type M3ReopenRestoreStatus,
  type M3UncommittedDraftItem,
} from '../m3WorkbenchBridge'
import {
  copyText,
  DEFAULT_TASKBOOKS,
  deriveTaskbooksFromRequirements,
  formatSourceLabel,
  type OnboardingChoice,
  type SidebarTab,
  type WorkbenchChatMessage,
  type WorkbenchLocalProject,
  type WorkbenchTracker,
} from '../workbenchHelpers'
import type {
  LocalAgentRegisterFeedback,
  ModelApiFailureNotice,
} from '../components/OnboardingWizard'
import { useAssemblyViewport } from './useAssemblyViewport'

export type DesktopProjectOpenForAuthResult =
  | { readonly ok: true; readonly projectId: string; readonly sessionId: string }
  | { readonly ok: false; readonly cancelled: true }
  | { readonly ok: false; readonly cancelled?: false; readonly message: string }

export interface UseWorkbenchSessionOptions {
  readonly transport: ElectronTransport
  readonly initialProjectId: string
  readonly initialProjectName: string
  readonly initialBaseRevision: string | null
  readonly initialDraftRevision: string | null
  readonly desktopBoundProjectId?: string | null
  readonly onRequestDesktopProjectForReadonlyAuth?: (
    requestedProjectId: string,
  ) => Promise<DesktopProjectOpenForAuthResult>
  readonly autoRequestReadonlyAuth?: boolean
  readonly onAutoReadonlyAuthConsumed?: () => void
  readonly availableObjectsProp?: readonly M1SelectedObjectRef[]
  readonly availableTaskbooksProp?: readonly M1TaskbookReference[]
  readonly initialConnectionSnapshot?: Partial<M1ConnectionStatusSnapshot>
  readonly initialActivities: readonly M1ExternalActivityItem[]
  readonly initialMessages: readonly WorkbenchChatMessage[]
  readonly initialShowOnboarding: boolean
  readonly initialPreviewSnapshot?: Partial<M2PreviewSnapshot>
  readonly initialViewMode?: M2ViewMode
  readonly initialSidebarSection: M2SidebarSection
  readonly initialShowCompletionView: boolean
  readonly initialFormalVersions?: readonly M3FormalVersionItem[]
  readonly initialUncommittedDrafts?: readonly M3UncommittedDraftItem[]
  readonly initialRestoreStatus: M3ReopenRestoreStatus | null
  readonly initialMigrationReport: M3MigrationReport | null
  readonly forceNarrowViewport?: boolean
  readonly clipboardWriter?: (text: string) => Promise<void> | void
}

/**
 * Orchestrates the workbench session lifecycle:
 * - Connection state, project/draft/authorization/takeover/commit/chat/undo/migration
 * - External project notifications & watermarks
 * - Zero-manual-config Local Agent auto-detection & Model API provider/model auto-fetch
 * - All backend I/O is routed strictly through `ElectronTransport` (no direct preload global access).
 */
export function useWorkbenchSession({
  transport,
  initialProjectId,
  initialProjectName,
  initialBaseRevision,
  initialDraftRevision,
  desktopBoundProjectId,
  onRequestDesktopProjectForReadonlyAuth,
  autoRequestReadonlyAuth = false,
  onAutoReadonlyAuthConsumed,
  availableObjectsProp,
  availableTaskbooksProp,
  initialConnectionSnapshot,
  initialActivities,
  initialMessages,
  initialShowOnboarding,
  initialPreviewSnapshot,
  initialViewMode,
  initialSidebarSection,
  initialShowCompletionView,
  initialFormalVersions,
  initialUncommittedDrafts,
  initialRestoreStatus,
  initialMigrationReport,
  forceNarrowViewport,
  clipboardWriter,
}: UseWorkbenchSessionOptions) {
  const probe = transport.probes.m1
  const authProbe = transport.probes.auth
  const connUxProbe = transport.probes.connUx
  const m3Probe = transport.probes.m3

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
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [connectionPopoverOpen, setConnectionPopoverOpen] = useState(false)
  const [attachPopoverOpen, setAttachPopoverOpen] = useState(false)

  const hasRealChatBridge = probe.capabilities.builtinChat
  const [hasRealRequirementsContext, setHasRealRequirementsContext] = useState<boolean>(
    () => initialPreviewSnapshot?.requirements !== undefined,
  )
  const [discardedStaleCount, setDiscardedStaleCount] = useState(0)

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

  const allocateRequestId = useCallback((prefix: string): string => {
    const tracker = trackerRef.current
    tracker.requestSeq += 1
    return `${prefix}-e${tracker.scopeEpoch}-r${tracker.requestSeq}`
  }, [])

  const incrementDiscardedStale = useCallback(() => {
    setDiscardedStaleCount((c) => c + 1)
  }, [])

  const markHasRealRequirementsContext = useCallback(() => {
    setHasRealRequirementsContext(true)
  }, [])

  const viewport = useAssemblyViewport({
    transport,
    trackerRef,
    projectId,
    initialBaseRevision: resolvedInitialBaseRevision,
    initialDraftRevision: resolvedInitialDraftRevision,
    initialPreviewSnapshot,
    initialViewMode,
    availableObjectsProp,
    forceNarrowViewport,
    scopeEpoch,
    subscriptionRetryNonce,
    allocateRequestId,
    onDraftRevisionUpdated: setDraftRevision,
    onHasRealRequirementsContext: markHasRealRequirementsContext,
    onDiscardedStale: incrementDiscardedStale,
    onSwitchSidebarSection: setSidebarSection,
  })

  const {
    canvasState,
    setCanvasState,
    selectedObject,
    structureOpen,
    setStructureOpen,
    setContextActionFeedback,
    resetViewportForProjectSwitch,
  } = viewport

  const objectListRegionRef = useRef<HTMLElement | null>(null)
  const canvasRegionRef = useRef<HTMLElement | null>(null)
  const sidebarRegionRef = useRef<HTMLElement | null>(null)
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const reconnectButtonRef = useRef<HTMLButtonElement | null>(null)
  const retryDrawingButtonRef = useRef<HTMLButtonElement | null>(null)
  const testModelApiButtonRef = useRef<HTMLButtonElement | null>(null)
  const retryChatButtonRef = useRef<HTMLButtonElement | null>(null)
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
  const [registerFeedback, setRegisterFeedback] = useState<LocalAgentRegisterFeedback | null>(null)

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
  const [modelApiFailure, setModelApiFailure] = useState<ModelApiFailureNotice | null>(null)

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

  useEffect(() => {
    trackerRef.current.draftRevision = draftRevision
  }, [draftRevision])

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

  // Load local agent install info via Transport
  useEffect(() => {
    const tracker = trackerRef.current
    tracker.mounted = true
    if (!probe.capabilities.localAgentInstallInfo) {
      return () => {
        tracker.mounted = false
      }
    }
    let cancelled = false
    void transport
      .getLocalAgentInstallInfo()
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
  }, [probe.capabilities.localAgentInstallInfo, transport])

  // Subscribe to M1 workbench events via Transport
  useEffect(() => {
    void subscriptionRetryNonce
    if (!probe.capabilities.eventSubscription) {
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

    void transport
      .subscribeWorkbenchEvents(subscribeRequest, handleIncomingEvent)
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
    probe.capabilities.eventSubscription,
    transport,
    projectId,
    scopeEpoch,
    subscriptionRetryNonce,
    applyConnectionSnapshot,
    syncScopeEpochFromAuthError,
  ])

  // Subscribe to M3 external project modification events via Transport
  useEffect(() => {
    if (!m3Probe.capabilities.externalProjectEvents) {
      return
    }
    let active = true
    let unsubscribe: (() => void) | undefined

    const handleExternalProjectEvent = (event: M3ExternalProjectEvent) => {
      const tracker = trackerRef.current
      if (!active || !tracker.mounted) return

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

    void transport
      .subscribeExternalProjectEvents(handleExternalProjectEvent)
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
  }, [m3Probe.capabilities.externalProjectEvents, transport, projectId, scopeEpoch, subscriptionRetryNonce, setCanvasState])

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

  // Error-focus recovery effects
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
    if (viewport.retryDrawingPending) return
    const nextKey = `${canvasState.drawingFailureGeneration}:${viewport.retryDrawingFailureSeq}:${canvasState.drawingFailure.failedRevision}`
    if (prevDrawingFailureKeyRef.current !== nextKey) {
      prevDrawingFailureKeyRef.current = nextKey
      focusRecoveryElement(retryDrawingButtonRef.current)
    }
  }, [
    canvasState.drawingFailure,
    canvasState.drawingFailureGeneration,
    viewport.retryDrawingFailureSeq,
    viewport.retryDrawingPending,
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
    if (!probe.capabilities.connectionStatus) {
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
      result = await transport.getConnectionStatus({
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

    if (!connUxProbe.capabilities.detectLocalAgents) {
      setDetectingLocalAgents(false)
      setLocalAgentDetectCompleted(false)
      setDetectedLocalAgents([])
      return
    }

    setDetectingLocalAgents(true)
    let result
    try {
      result = await transport.detectLocalAgents()
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
  }, [connUxProbe.capabilities.detectLocalAgents, transport])

  useEffect(() => {
    if (
      !showOnboarding ||
      onboardingChoice !== 'local-agent' ||
      !connUxProbe.capabilities.detectLocalAgents
    ) {
      return
    }
    const tracker = trackerRef.current
    tracker.detectLocalAgentsEpoch += 1
    const capturedEpoch = tracker.detectLocalAgentsEpoch
    let cancelled = false

    void transport
      .detectLocalAgents()
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
  }, [showOnboarding, onboardingChoice, connUxProbe.capabilities.detectLocalAgents, transport])

  const handleRegisterLocalAgent = useCallback(
    async (agent: M1DetectedLocalAgent): Promise<void> => {
      setRegisterFeedback(null)
      if (!connUxProbe.capabilities.registerLocalAgent) {
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
        result = await transport.registerLocalAgent({ agentId: agent.id })
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
    [connUxProbe.capabilities.registerLocalAgent, transport],
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

      if (!connUxProbe.capabilities.listModelApiModels) {
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
        result = await transport.listModels({
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
    [
      allocateRequestId,
      clearPendingModelListDebounce,
      connUxProbe.capabilities.listModelApiModels,
      resetModelApiUnlock,
      transport,
    ],
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
    connUxProbe.capabilities.listModelApiModels,
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

    if (!probe.capabilities.modelApiTest) {
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
      result = await transport.testModelConnection({
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

    resetViewportForProjectSwitch({
      nextProjectId: params.nextProjectId,
      nextBaseRevision: params.nextBaseRevision,
      nextDraftRevision: params.nextDraftRevision,
      nextPreviewSnapshot: params.nextPreviewSnapshot,
    })
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

  const handleOpenBuiltinTemplate = (templateId: BuiltinTemplateId) => {
    const cloned = cloneTemplateToDraft(templateId)
    const tracker = trackerRef.current
    tracker.projectId = cloned.projectId
    tracker.draftRevision = cloned.draftRevision
    tracker.scopeEpoch += 1
    tracker.modelApiTestEpoch += 1
    tracker.commitRequestEpoch += 1
    tracker.switchProjectEpoch += 1
    tracker.takeoverRequestEpoch += 1
    tracker.readonlyAuthRequestEpoch += 1
    tracker.retryDrawingEpoch += 1
    tracker.undoRequestEpoch += 1
    tracker.migrationRequestEpoch += 1
    tracker.strictEpochGuard = false
    tracker.activeChatRequestId = null
    tracker.activeTestRequestId = null
    tracker.lastEventSequence = 0

    setScopeEpoch(tracker.scopeEpoch)
    setSkippedConnection(connectionSource === 'none')
    setShowOnboarding(false)
    resetProjectScopedStateForSwitch({
      nextProjectId: cloned.projectId,
      nextProjectName: cloned.projectName,
      nextBaseRevision: cloned.baseRevision,
      nextDraftRevision: cloned.draftRevision,
      nextPreviewSnapshot: cloned.previewSnapshot,
    })
    setTakeoverNotice(`已从只读模板创建独立草稿：${cloned.projectName}（${cloned.projectId}）。`)
  }

  const handleRefreshExternalActivities = async (): Promise<void> => {
    setActivitiesNotice(null)
    if (!probe.capabilities.externalActivities) {
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
      result = await transport.getExternalActivities({
        projectId: captured.projectId,
        scopeEpoch: captured.scopeEpoch,
      } as { projectId: string; scopeEpoch: number })
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
    const incomingActivities = result.value.activities as unknown as readonly M1ExternalActivityItem[]
    setActivities(incomingActivities)
    if (result.value.draftRevision !== undefined) {
      setDraftRevision(result.value.draftRevision)
    }
    setActivitiesNotice(`已更新外部任务活动（${incomingActivities.length} 条）。`)
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
    if (!probe.capabilities.builtinChat) {
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
      result = await transport.sendChatMessage({
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

    tracker.activeChatRequestId = null
    setChatPending(false)
    setChatNotice('已停止当前对话生成，已忽略后续迟到响应。')

    if (probe.capabilities.cancelChat) {
      try {
        await transport.cancelChatMessage({
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
    if (!probe.capabilities.reconnect) {
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
      result = await transport.reconnectSession({
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
    setTakeoverNotice(
      `已重新连接至 ${snap.clientName ?? formatSourceLabel(snap.source, snap.clientName, apiModel, false)}。`,
    )
  }

  const handleRequestReadonlyAuthorization = async (): Promise<void> => {
    setReadonlyAuthError(null)
    setReadonlyAuthNotice(null)
    if (!authProbe.available) {
      setReadonlyAuthError(
        '后端尚未接线/不可用（缺失方法：requestM1ProjectAuthorization），无法申请原生只读授权。',
      )
      return
    }
    const tracker = trackerRef.current
    const capturedProjectId = tracker.projectId
    const capturedSwitchEpoch = tracker.switchProjectEpoch
    if (
      onRequestDesktopProjectForReadonlyAuth &&
      desktopBoundProjectId !== capturedProjectId
    ) {
      tracker.readonlyAuthRequestEpoch += 1
      const capturedAuthEpoch = tracker.readonlyAuthRequestEpoch
      setReadonlyAuthPending(true)
      let openResult: DesktopProjectOpenForAuthResult
      try {
        openResult = await onRequestDesktopProjectForReadonlyAuth(capturedProjectId)
      } catch (err) {
        const normalized = normalizeWorkbenchBridgeError(err, '打开本地项目文件失败')
        openResult = { ok: false, message: normalized.message }
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
        return
      }
      setReadonlyAuthPending(false)
      if (!openResult.ok) {
        if (openResult.cancelled) {
          setReadonlyAuthNotice('已取消选择本地 .cunlian 项目文件，未发起原生只读授权。')
        } else {
          setReadonlyAuthError(`打开本地项目文件失败：${openResult.message}`)
        }
      }
      return
    }
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
      result = await transport.requestProjectAuthorization(issued)
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
    setSubscriptionRetryNonce((nonce) => nonce + 1)
    setReadonlyAuthNotice(
      `已完成项目 ${acceptedScope.projectId} 的原生只读授权，现在可继续申请原生写入或接管草稿。`,
    )
  }

  const autoReadonlyAuthTriggeredRef = useRef(false)
  const handleRequestReadonlyAuthorizationRef = useRef(handleRequestReadonlyAuthorization)
  useEffect(() => {
    handleRequestReadonlyAuthorizationRef.current = handleRequestReadonlyAuthorization
  })
  useEffect(() => {
    if (!autoRequestReadonlyAuth) {
      autoReadonlyAuthTriggeredRef.current = false
      return
    }
    if (autoReadonlyAuthTriggeredRef.current) {
      return
    }
    autoReadonlyAuthTriggeredRef.current = true
    onAutoReadonlyAuthConsumed?.()
    void handleRequestReadonlyAuthorizationRef.current()
  }, [autoRequestReadonlyAuth, onAutoReadonlyAuthConsumed])

  const handleTakeoverDraft = async (
    explicitTargetSource?: 'local-agent' | 'model-api',
  ): Promise<void> => {
    setTakeoverError(null)
    setTakeoverNotice(null)
    if (authorizationState === 'unauthorized') {
      setTakeoverError('须先完成原生只读授权，再申请写入或接管。')
      return
    }
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
    if (!probe.capabilities.takeover) {
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
      result = await transport.takeoverDraft({
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
    if (!m3Probe.capabilities.commitM3ApprovedDraft) {
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
      result = await transport.commitApprovedDraft({
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
    if (!m3Probe.capabilities.undoDraftChange) {
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
      result = await transport.undoDraftChange({
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
    if (!m3Probe.capabilities.getMigrationReport) {
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
      result = await transport.getMigrationReport({
        projectId: capturedProjectId,
      })
    } catch (err) {
      result = {
        ok: false as const,
        error: normalizeM3BridgeError(err, '读取迁移报告异常'),
      }
    }
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
    if (!m3Probe.capabilities.openExternalProjectResult) {
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
      result = await transport.openExternalProjectResult({
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

  return {
    probe,
    connUxProbe,
    viewport,
    // Project & theme
    projectId,
    projectName,
    baseRevision,
    draftRevision,
    theme,
    handleToggleTheme,
    // Connection & auth
    connectionState,
    connectionSource,
    clientName,
    authorizationState,
    writerEpoch,
    scopeEpoch,
    writerOwner,
    workflowStep,
    compactConnectionLabel,
    showDisconnectBanner,
    // UI chrome state
    showOnboarding,
    setShowOnboarding,
    onboardingChoice,
    setOnboardingChoice,
    skippedConnection,
    setSkippedConnection,
    sidebarSection,
    setSidebarSection,
    sidebarTab,
    setSidebarTab,
    moreMenuOpen,
    setMoreMenuOpen,
    connectionPopoverOpen,
    setConnectionPopoverOpen,
    attachPopoverOpen,
    setAttachPopoverOpen,
    // Refs
    objectListRegionRef,
    canvasRegionRef,
    sidebarRegionRef,
    chatInputRef,
    reconnectButtonRef,
    retryDrawingButtonRef,
    testModelApiButtonRef,
    retryChatButtonRef,
    // Local Agent
    localAgentConfig,
    localAgentNotice,
    localAgentCopyFeedback,
    objectRefCopyFeedback,
    statusChecking,
    detectingLocalAgents,
    localAgentDetectCompleted,
    localAgentDetectError,
    sortedDetectedLocalAgents,
    registeringAgentId,
    registerFeedback,
    handleDetectLocalAgents,
    handleRegisterLocalAgent,
    handleCopy,
    handleRefreshConnectionStatus,
    // Model API
    apiProviderId,
    currentProviderPreset,
    apiBaseUrl,
    setApiBaseUrl,
    apiKey,
    setApiKey,
    apiModel,
    setApiModel,
    availableApiModels,
    setAvailableApiModels,
    modelListLoading,
    setModelListNotice,
    effectiveModelListNotice,
    manualModelInputMode,
    setManualModelInputMode,
    outgoingContextSummary,
    modelApiFailure,
    modelApiTestResult,
    builtinUnlocked,
    apiTesting,
    resetModelApiUnlock,
    handleProviderChange,
    fetchModelApiModels,
    handleTestModelApi,
    // Projects & templates
    handleOpenLocalProject,
    handleOpenBuiltinTemplate,
    // Activities & chat
    activities,
    activitiesNotice,
    previewMessage,
    setPreviewMessage,
    messages,
    chatInput,
    setChatInput,
    chatPending,
    chatNotice,
    lastFailedTurn,
    attachedTaskbooks,
    availableTaskbooks,
    attachedRefIds,
    includeSelectedInChat,
    setIncludeSelectedInChat,
    toggleTaskbookAttachment,
    handleRefreshExternalActivities,
    handleSendChat,
    handleStopChat,
    handleRetryChat,
    handleBringIntoNextPrompt,
    handleCopyToExternalSession,
    // Takeover & readonly auth
    takeoverNotice,
    takeoverError,
    takeoverPending,
    readonlyAuthPending,
    readonlyAuthNotice,
    readonlyAuthError,
    selectedTakeoverTarget,
    setSelectedTakeoverTarget,
    discardedStaleCount,
    handleReconnect,
    handleRequestReadonlyAuthorization,
    handleTakeoverDraft,
    // Completion, commit, undo, migration, external notifications
    showCompletionView,
    setShowCompletionView,
    partName,
    hasSaveableResult,
    checkSetFingerprint,
    completionReadiness,
    activePendingConfirmation,
    effectiveInvalidatedConfirmationNotice,
    commitPending,
    commitFeedback,
    setCommitFeedback,
    setPendingConfirmation,
    canUndoBlockedDraft,
    canUndoInCompletionView,
    undoPending,
    undoFeedback,
    formalVersions,
    uncommittedDrafts,
    restoreStatus,
    migrationReport,
    migrationDrawerOpen,
    setMigrationDrawerOpen,
    migrationLoading,
    migrationNotice,
    externalNotifications,
    externalOpenPendingId,
    externalOpenFeedback,
    handleStartOneTimeConfirm,
    handleCancelOneTimeConfirm,
    handleConfirmCommitFormal,
    handleUndoBlockedDraft,
    handleLoadMigrationReport,
    handleOpenExternalProjectResult,
    handleDismissExternalNotification,
    // Keyboard
    handleWorkbenchKeyDown,
  }
}
