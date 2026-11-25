import { useEffect, useMemo, useRef, useState } from 'react'
import './ProjectAgentPanel.css'
import type { EntryScope } from '../../../desktop/shared/project-agent/m1-entry-1933.ts'
import type { M1ContextFields } from '../../../desktop/shared/project-agent/m1-fields.ts'
import {
  M1_READONLY_ENTRY_CAPABILITIES,
  acceptAuthorizedEntryScope,
  buildM1AuthorizationRequest,
  createBridgeReadTransport,
  isSameEntryScope,
  normalizeBridgeError,
  probeM1ReadonlyAuthBridge,
  resolveWindowM1ReadonlyAuthBridge,
  type M1LocalBridgeErrorPayload,
  type M1ReadonlyAuthBridge,
  type M1ReadonlyBridgeProbe,
} from './m1ReadonlyAuthBridge'
import {
  createM1ReadPreloadAdapter,
  type M1InnerFailureView,
  type M1ReadPreloadAdapter,
  type M1ReadTrustedScope,
  type M1RejectedReplyView,
} from './m1ReadPreloadAdapter'
import type { AcceptedM1FullEventPage } from './m1FullEventPagePresentation'
import {
  ProjectAgentM1Session,
  type LocalProjectItem,
} from './ProjectAgentM1Session'

export interface ProjectAgentM1ReadonlyEntryProps {
  /**
   * Optional bridge object for isolated synthetic tests.
   * When omitted, probes `window.cunlian` via duck-typing.
   */
  readonly bridge?: unknown
  readonly initialProjectId?: string
  readonly localProjects?: readonly LocalProjectItem[]
  readonly synthetic?: boolean
  readonly className?: string
}

interface ScopeTracker {
  mounted: boolean
  projectId: string
  scopeEpoch: number
  nextAuthGeneration: number
  requestSeq: number
  grantedScope: EntryScope | null
  latestAuthRequestId: string | null
  latestContextRequestId: string | null
  latestEventsRequestId: string | null
}

interface VisibleBridgeError {
  readonly source: 'authorize' | 'revoke' | 'getContext' | 'readProjectEvents'
  readonly code: string
  readonly message: string
}

const DEFAULT_PROJECT_ID = 'proj-local-1'
const DEFAULT_EVENTS_LIMIT = 50

function formatOperationLabel(source: VisibleBridgeError['source']): string {
  switch (source) {
    case 'authorize':
      return '申请只读授权'
    case 'revoke':
      return '撤销授权'
    case 'getContext':
      return '读取项目上下文'
    case 'readProjectEvents':
      return '读取项目事件'
  }
}

export function ProjectAgentM1ReadonlyEntry({
  bridge: bridgeProp,
  initialProjectId = DEFAULT_PROJECT_ID,
  localProjects = [],
  synthetic = false,
  className,
}: ProjectAgentM1ReadonlyEntryProps) {
  const probe: M1ReadonlyBridgeProbe = useMemo(() => {
    if (bridgeProp !== undefined) {
      return probeM1ReadonlyAuthBridge(bridgeProp)
    }
    return resolveWindowM1ReadonlyAuthBridge()
  }, [bridgeProp])

  const [activeProjectId, setActiveProjectId] = useState(initialProjectId)
  const [projectDraftInput, setProjectDraftInput] = useState(initialProjectId)
  const [grantedScope, setGrantedScope] = useState<EntryScope | null>(null)
  const [acceptedContextRaw, setAcceptedContextRaw] = useState<M1ContextFields | null>(null)
  const [acceptedEventPage, setAcceptedEventPage] = useState<AcceptedM1FullEventPage | null>(null)
  const [bridgeError, setBridgeError] = useState<VisibleBridgeError | null>(null)
  const [innerFailure, setInnerFailure] = useState<M1InnerFailureView | null>(null)
  const [lastRejection, setLastRejection] = useState<M1RejectedReplyView | null>(null)
  const [statusNotice, setStatusNotice] = useState<string | null>(null)
  const [authPending, setAuthPending] = useState(false)
  const [readPending, setReadPending] = useState(false)

  const trackerRef = useRef<ScopeTracker>({
    mounted: true,
    projectId: initialProjectId,
    scopeEpoch: 1,
    nextAuthGeneration: 0,
    requestSeq: 0,
    grantedScope: null,
    latestAuthRequestId: null,
    latestContextRequestId: null,
    latestEventsRequestId: null,
  })

  const pendingRawContextRef = useRef<Map<string, M1ContextFields>>(new Map())
  const adapterCacheRef = useRef<{
    bridge: M1ReadonlyAuthBridge
    adapter: M1ReadPreloadAdapter
  } | null>(null)

  const getOrCreateAdapter = (): M1ReadPreloadAdapter | null => {
    if (!probe.available) {
      return null
    }
    if (adapterCacheRef.current && adapterCacheRef.current.bridge === probe.bridge) {
      return adapterCacheRef.current.adapter
    }
    const transport = createBridgeReadTransport(probe.bridge, (requestId, rawContext) => {
      pendingRawContextRef.current.set(requestId, rawContext)
    })
    const created = createM1ReadPreloadAdapter({
      transport,
      getCurrentScope: (): M1ReadTrustedScope => {
        const tracker = trackerRef.current
        if (!tracker.mounted || tracker.grantedScope === null) {
          return {
            projectId: tracker.projectId,
            authorizationRef: '',
            requestGeneration: 0,
          }
        }
        return tracker.grantedScope
      },
    })
    adapterCacheRef.current = { bridge: probe.bridge, adapter: created }
    return created
  }

  // Cleanup only on unmount: invalidate scope so late auth/read/revoke replies are discarded.
  // Never initiates authorization or reads automatically.
  useEffect(() => {
    const tracker = trackerRef.current
    const rawCache = pendingRawContextRef.current
    tracker.mounted = true
    return () => {
      tracker.mounted = false
      tracker.scopeEpoch += 1
      tracker.grantedScope = null
      tracker.latestAuthRequestId = null
      tracker.latestContextRequestId = null
      tracker.latestEventsRequestId = null
      rawCache.clear()
    }
  }, [])

  const allocateRequestId = (prefix: string): string => {
    const tracker = trackerRef.current
    tracker.requestSeq += 1
    return `${prefix}-${tracker.scopeEpoch}-${tracker.requestSeq}`
  }

  const switchProject = (nextProjectIdRaw: string): void => {
    const nextProjectId = nextProjectIdRaw.trim()
    if (nextProjectId.length === 0) {
      return
    }
    const tracker = trackerRef.current
    if (nextProjectId === tracker.projectId) {
      return
    }
    tracker.projectId = nextProjectId
    tracker.scopeEpoch += 1
    tracker.nextAuthGeneration += 1
    tracker.grantedScope = null
    tracker.latestAuthRequestId = null
    tracker.latestContextRequestId = null
    tracker.latestEventsRequestId = null
    pendingRawContextRef.current.clear()

    setActiveProjectId(nextProjectId)
    setProjectDraftInput(nextProjectId)
    setGrantedScope(null)
    setAcceptedContextRaw(null)
    setAcceptedEventPage(null)
    setBridgeError(null)
    setInnerFailure(null)
    setLastRejection(null)
    setStatusNotice(`已切换目标项目至 ${nextProjectId}，请重新申请只读授权。`)
    setAuthPending(false)
    setReadPending(false)
  }

  const handleRequestAuthorization = async (): Promise<void> => {
    if (!probe.available) {
      return
    }
    const tracker = trackerRef.current
    const targetProjectId = tracker.projectId.trim()
    if (targetProjectId.length === 0) {
      return
    }

    const capturedEpoch = tracker.scopeEpoch
    tracker.nextAuthGeneration += 1
    const generation = tracker.nextAuthGeneration
    const requestId = allocateRequestId('auth')
    const request = buildM1AuthorizationRequest(targetProjectId, requestId, generation)
    if (!request) {
      return
    }

    tracker.latestAuthRequestId = requestId
    setAuthPending(true)
    setBridgeError(null)
    setStatusNotice(null)

    let result
    try {
      result = await probe.bridge.requestM1ProjectAuthorization(request)
    } catch (err) {
      const normalized = normalizeBridgeError(err, '申请只读授权异常')
      result = { ok: false as const, error: normalized }
    }

    // Discard late or superseded replies (project switch, revoke, unmount, or newer auth request).
    if (
      !tracker.mounted ||
      tracker.scopeEpoch !== capturedEpoch ||
      tracker.projectId !== targetProjectId ||
      tracker.latestAuthRequestId !== requestId
    ) {
      return
    }

    setAuthPending(false)

    if (!result.ok) {
      const err: M1LocalBridgeErrorPayload = normalizeBridgeError(
        result.error,
        '本地只读授权未通过',
      )
      setBridgeError({
        source: 'authorize',
        code: err.code,
        message: err.message,
      })
      // Keep any previously accepted valid grant intact when a new request is cancelled/rejected.
      return
    }

    const acceptedScope = acceptAuthorizedEntryScope(request, result.value)
    if (!acceptedScope) {
      setBridgeError({
        source: 'authorize',
        code: 'INVALID_REQUEST',
        message: '授权回包校验失败，未接受凭据。',
      })
      return
    }

    tracker.grantedScope = acceptedScope
    setGrantedScope(acceptedScope)
    setBridgeError(null)
    setLastRejection(null)
    setStatusNotice(
      `已获得项目 ${acceptedScope.projectId} 的本地只读授权（代数 #${acceptedScope.requestGeneration}）。`,
    )
  }

  const handleRevokeAuthorization = async (): Promise<void> => {
    if (!probe.available) {
      return
    }
    const tracker = trackerRef.current
    const previousScope = tracker.grantedScope
    const targetProjectId = previousScope?.projectId ?? tracker.projectId.trim()
    if (targetProjectId.length === 0) {
      return
    }

    // Immediately invalidate current scope and clear restricted view before awaiting IPC.
    tracker.scopeEpoch += 1
    const revokeEpoch = tracker.scopeEpoch
    tracker.nextAuthGeneration += 1
    const generation = tracker.nextAuthGeneration
    const requestId = allocateRequestId('revoke')
    tracker.grantedScope = null
    tracker.latestAuthRequestId = null
    tracker.latestContextRequestId = null
    tracker.latestEventsRequestId = null
    pendingRawContextRef.current.clear()

    setGrantedScope(null)
    setAcceptedContextRaw(null)
    setAcceptedEventPage(null)
    setBridgeError(null)
    setInnerFailure(null)
    setLastRejection(null)
    setAuthPending(false)
    setReadPending(false)
    setStatusNotice('已清空本地受限视图，正在撤销只读授权…')

    const request = buildM1AuthorizationRequest(targetProjectId, requestId, generation)
    if (!request) {
      return
    }

    let result
    try {
      result = await probe.bridge.revokeM1ProjectAuthorization(request)
    } catch (err) {
      const normalized = normalizeBridgeError(err, '撤销授权异常')
      result = { ok: false as const, error: normalized }
    }

    if (!tracker.mounted || tracker.scopeEpoch !== revokeEpoch) {
      return
    }

    if (!result.ok) {
      const err = normalizeBridgeError(result.error, '撤销授权失败')
      setBridgeError({
        source: 'revoke',
        code: err.code,
        message: err.message,
      })
      setStatusNotice(null)
      return
    }

    setStatusNotice(`已撤销项目 ${targetProjectId} 的本地只读授权。`)
  }

  const handleReadContext = async (): Promise<void> => {
    const adapter = getOrCreateAdapter()
    if (!probe.available || !adapter) {
      return
    }
    const tracker = trackerRef.current
    const scope = tracker.grantedScope
    if (!scope) {
      return
    }

    const capturedEpoch = tracker.scopeEpoch
    const requestId = allocateRequestId('ctx')
    tracker.latestContextRequestId = requestId
    setReadPending(true)
    setBridgeError(null)
    setInnerFailure(null)

    const outcome = await adapter.readContext({
      projectId: scope.projectId,
      authorizationRef: scope.authorizationRef,
      requestGeneration: scope.requestGeneration,
      requestId,
    })

    const rawContext = pendingRawContextRef.current.get(requestId) ?? null
    pendingRawContextRef.current.delete(requestId)

    if (
      !tracker.mounted ||
      tracker.scopeEpoch !== capturedEpoch ||
      !isSameEntryScope(tracker.grantedScope, scope) ||
      tracker.latestContextRequestId !== requestId
    ) {
      return
    }

    setReadPending(false)

    if (outcome.status === 'accepted' && rawContext !== null) {
      setAcceptedContextRaw(rawContext)
      setBridgeError(null)
      setInnerFailure(null)
      setLastRejection(null)
      setStatusNotice(`已读取项目 ${scope.projectId} 的只读上下文。`)
      return
    }

    if (outcome.status === 'outer_error') {
      setBridgeError({
        source: 'getContext',
        code: String(outcome.error.code),
        message: outcome.error.message,
      })
      return
    }

    if (outcome.status === 'inner_error') {
      setInnerFailure(outcome.failure)
      return
    }

    if (outcome.status === 'rejected') {
      setLastRejection(outcome.rejection)
      return
    }

    if (outcome.status === 'unavailable') {
      setBridgeError({
        source: 'getContext',
        code: 'AUTH_REQUIRED',
        message: outcome.reason,
      })
    }
  }

  const handleReadEvents = async (): Promise<void> => {
    const adapter = getOrCreateAdapter()
    if (!probe.available || !adapter) {
      return
    }
    const tracker = trackerRef.current
    const scope = tracker.grantedScope
    if (!scope) {
      return
    }

    const capturedEpoch = tracker.scopeEpoch
    const requestId = allocateRequestId('evt')
    const afterSequence = acceptedEventPage?.nextConsumerCursor ?? 0
    tracker.latestEventsRequestId = requestId
    setReadPending(true)
    setBridgeError(null)
    setInnerFailure(null)

    const outcome = await adapter.readEvents({
      projectId: scope.projectId,
      authorizationRef: scope.authorizationRef,
      requestGeneration: scope.requestGeneration,
      requestId,
      afterSequence,
      limit: DEFAULT_EVENTS_LIMIT,
    })

    if (
      !tracker.mounted ||
      tracker.scopeEpoch !== capturedEpoch ||
      !isSameEntryScope(tracker.grantedScope, scope) ||
      tracker.latestEventsRequestId !== requestId
    ) {
      return
    }

    setReadPending(false)

    if (outcome.status === 'accepted' && outcome.page.ok) {
      setAcceptedEventPage(outcome.page)
      setBridgeError(null)
      setInnerFailure(null)
      setLastRejection(null)
      setStatusNotice(
        `已读取项目 ${scope.projectId} 的只读事件页（${outcome.page.events.length} 条，游标 ${outcome.page.nextConsumerCursor}）。`,
      )
      return
    }

    if (outcome.status === 'outer_error') {
      setBridgeError({
        source: 'readProjectEvents',
        code: String(outcome.error.code),
        message: outcome.error.message,
      })
      return
    }

    if (outcome.status === 'inner_error') {
      setInnerFailure(outcome.failure)
      return
    }

    if (outcome.status === 'rejected') {
      setLastRejection(outcome.rejection)
      return
    }

    if (outcome.status === 'unavailable') {
      setBridgeError({
        source: 'readProjectEvents',
        code: 'AUTH_REQUIRED',
        message: outcome.reason,
      })
    }
  }

  const rootClassName = className ? `pa-preview ${className}` : 'pa-preview'
  const isAuthorized = grantedScope !== null

  return (
    <main className={rootClassName} aria-label="M1 本地只读授权入口">
      <header className="pa-header">
        <div className="pa-row">
          <h1 className="pa-title">M1 本地只读授权入口</h1>
          <span
            className={`pa-pill ${probe.available ? 'pa-tone-action' : 'pa-tone-danger'}`}
          >
            {probe.available ? '本地只读桥接可用' : '不可用'}
          </span>
          {synthetic ? <span className="pa-pill pa-tone-pending">模拟</span> : null}
        </div>
        <div className="pa-row">
          <span className="pa-pill pa-tone-muted">
            {M1_READONLY_ENTRY_CAPABILITIES.productionApiConnected
              ? '生产 API：已接通'
              : '生产 API：未接通'}
          </span>
          <span className="pa-pill pa-tone-muted">
            {M1_READONLY_ENTRY_CAPABILITIES.formalSaveEnabled
              ? '正式保存：启用'
              : '正式保存：禁用'}
          </span>
          <span className="pa-pill pa-tone-muted">
            写入：{M1_READONLY_ENTRY_CAPABILITIES.writeEnabled ? '已开放' : '未开放'} ·
            订阅：{M1_READONLY_ENTRY_CAPABILITIES.subscribeEnabled ? '已开放' : '未开放'} ·
            对话：{M1_READONLY_ENTRY_CAPABILITIES.conversationEnabled ? '已开放' : '未开放'}
          </span>
          <a href="#/desktop-m1-workbench" className="pa-link-btn">
            切换至 M1 双入口工作台
          </a>
        </div>
      </header>

      {!probe.available ? (
        <div className="pa-notice" role="alert">
          本地只读授权桥接不可用（缺失方法：
          <span className="pa-mono">{probe.missingMethods.join(', ')}</span>
          ）。本入口不会伪造授权凭据，也不会回退到模拟传输。
        </div>
      ) : null}

      <section className="pa-panel" aria-label="本地只读授权控制">
        <div className="pa-row">
          <label className="pa-toggle">
            目标项目
            <input
              type="text"
              aria-label="目标项目 ID"
              className="pa-select pa-mono"
              value={projectDraftInput}
              onChange={(event) => setProjectDraftInput(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="pa-btn"
            disabled={
              projectDraftInput.trim().length === 0 ||
              projectDraftInput.trim() === activeProjectId
            }
            onClick={() => switchProject(projectDraftInput)}
          >
            切换项目
          </button>
          <span className="pa-muted">
            当前项目：<span className="pa-mono">{activeProjectId}</span>
          </span>
        </div>

        <div className="pa-controls">
          <button
            type="button"
            className="pa-btn pa-btn-active"
            disabled={!probe.available || activeProjectId.trim().length === 0}
            onClick={() => {
              void handleRequestAuthorization()
            }}
          >
            申请只读授权
          </button>
          <button
            type="button"
            className="pa-btn"
            disabled={!probe.available || !isAuthorized}
            onClick={() => {
              void handleRevokeAuthorization()
            }}
          >
            撤销授权
          </button>
          <button
            type="button"
            className="pa-btn"
            disabled={!probe.available || !isAuthorized}
            onClick={() => {
              void handleReadContext()
            }}
          >
            读取项目上下文
          </button>
          <button
            type="button"
            className="pa-btn"
            disabled={!probe.available || !isAuthorized}
            onClick={() => {
              void handleReadEvents()
            }}
          >
            读取项目事件
          </button>
        </div>

        <div className="pa-row" aria-label="本地授权状态">
          <span className={`pa-pill ${isAuthorized ? 'pa-tone-action' : 'pa-tone-muted'}`}>
            {isAuthorized ? '本地只读已授权' : '本地只读未授权'}
          </span>
          {grantedScope ? (
            <span className="pa-muted">
              项目 <span className="pa-mono">{grantedScope.projectId}</span> · 代数{' '}
              <span className="pa-mono">#{grantedScope.requestGeneration}</span>
            </span>
          ) : null}
          {authPending ? <span className="pa-muted">等待授权确认…</span> : null}
          {readPending ? <span className="pa-muted">正在读取只读数据…</span> : null}
        </div>

        {statusNotice ? (
          <p className="pa-muted" role="status">
            {statusNotice}
          </p>
        ) : null}

        {bridgeError ? (
          <div className="pa-notice" role="alert">
            {formatOperationLabel(bridgeError.source)}失败（
            <span className="pa-mono">{bridgeError.code}</span>）：{bridgeError.message}
          </div>
        ) : null}

        {innerFailure ? (
          <div className="pa-notice" role="alert">
            协议错误（<span className="pa-mono">{innerFailure.error.code}</span>）：
            {innerFailure.recovery.ok
              ? innerFailure.recovery.label
              : innerFailure.incrementFailure?.ok && innerFailure.incrementFailure.message
                ? innerFailure.incrementFailure.message
                : innerFailure.error.code}
          </div>
        ) : null}

        {lastRejection ? (
          <div className="pa-notice" role="status">
            已丢弃过期或格式不符的回包（<span className="pa-mono">{lastRejection.requestId}</span>）。
          </div>
        ) : null}
      </section>

      <ProjectAgentM1Session
        context={isAuthorized && acceptedContextRaw ? acceptedContextRaw : undefined}
        synthetic={synthetic}
        localProjects={localProjects}
        onSelectProject={switchProject}
      />

      {isAuthorized && acceptedEventPage ? (
        <section className="pa-panel" aria-label="只读事件页">
          <div className="pa-header">
            <h2 className="pa-title">只读事件页</h2>
            <span className="pa-muted">
              游标 <span className="pa-mono">{acceptedEventPage.nextConsumerCursor}</span> / 高水位{' '}
              <span className="pa-mono">{acceptedEventPage.highWatermark}</span>
            </span>
          </div>
          <div className="pa-row">
            <span className="pa-pill pa-tone-muted">
              事件总数：{acceptedEventPage.events.length}
            </span>
            <span className="pa-pill pa-tone-muted">
              M0 事件：{acceptedEventPage.m0Events.length}
            </span>
            <span className="pa-pill pa-tone-muted">
              任务事件：{acceptedEventPage.taskChangedEvents.length}
            </span>
          </div>
          {acceptedEventPage.events.length === 0 ? (
            <p className="pa-muted">暂无新事件</p>
          ) : (
            <ul className="pa-list">
              {acceptedEventPage.events.map((event) => (
                <li
                  key={`${event.projectId}-${event.sequence}-${event.type}`}
                  className="pa-check"
                >
                  <span className="pa-mono">#{event.sequence}</span>
                  <span className="pa-mono">{event.type}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </main>
  )
}
