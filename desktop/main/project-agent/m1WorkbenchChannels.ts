import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { IPC_CHANNELS } from '../../shared/contracts'
import { m1CancelChatRequest, m1ChatRequest, m1ModelConnectionRequest, m1ModelListRequest } from '../../shared/project-agent/m1-model-api'
import type { M1ModelResult } from '../../shared/project-agent/m1-model-api'
import type { M1Activity } from '../../shared/project-agent/m1-fields'
import { m1RegisterLocalAgentRequest, type M1ConnectionStatusSnapshot, type M1EntrySource, type M1ExternalActivity,
  type M1LocalAgentInstallInfo, type M1TakeoverResult, type M1WorkbenchEvent } from '../../shared/project-agent/m1-workbench'
import { toSenderInfo } from '../ipc'
import type { SenderGuard } from '../senderGuard'
import type { RealModelRuntime } from '../realModelRuntime'
import type { LocalM1Authority, LocalM1Session, M1WriterConfirmation } from './m1LocalAuthority'
import type { startM1LocalEndpoint } from './m1LocalEndpoint'
import { M1AgentRegistration } from './m1AgentRegistration'
import { listM1ModelApiModels } from './m1ModelList'
import { getExternalActivities } from './m1LocalAgent'
import { readMateDrafts } from './mateDraftTool'
import { desktopGdtEnabled, isGdtTool } from './gdtTools'
import { M1_LOCAL_ERRORS } from './m1LocalTransport'
import { M1ModelApi } from './m1ModelApi'
import type { M1ModelAttachment, M1ModelScope } from './m1ModelApi'

type Endpoint = Awaited<ReturnType<typeof startM1LocalEndpoint>>
type Caller = NonNullable<Awaited<ReturnType<LocalM1Authority['resolve']>>>
type Cut = Awaited<ReturnType<LocalM1Authority['workbenchCut']>>
type Subscription = { stop(): void }
type State = {
  frame: NonNullable<IpcMainInvokeEvent['senderFrame']>
  sameDocument(): boolean
  controller: AbortController
  windowId: number
  session: LocalM1Session
  epoch: number
  authorizationRef?: string
  source?: M1EntrySource
  model?: M1ModelApi
  cursor?: number
  subscriptions: Map<string, Subscription>
  takeoverPending?: boolean
  lastTakeover?: { request: string; value: M1TakeoverResult }
  connectionSignature?: string
  connectionUpdate?: Promise<void>
}

interface Ports {
  guard: SenderGuard
  authority: LocalM1Authority
  runtime: RealModelRuntime
  sessionFor(windowId: number): LocalM1Session | null
  projectName?(windowId: number): string | undefined
  readAttachment?(windowId: number, ref: string): M1ModelAttachment | null
  readSelectedObject?(windowId: number, ref: string): string | null
  endpoint(): Promise<Endpoint | undefined>
  installInfo(): M1LocalAgentInstallInfo | Promise<M1LocalAgentInstallInfo>
  agents?: M1AgentRegistration
  confirm(source: M1EntrySource, target: Parameters<M1WriterConfirmation>[0], signal: AbortSignal, clientName?: string): ReturnType<M1WriterConfirmation>
  m2Change?(event: IpcMainInvokeEvent, projectId: string): ReturnType<NonNullable<M1ModelScope['m2Change']>>
  pollMs?: number
}

const id = z.string().min(1).max(160)
const epoch = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const source = z.enum(['local-agent', 'model-api'])
const scope = z.object({ projectId: id, scopeEpoch: epoch }).strict()
const subscribe = scope.extend({ afterSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }).strict()
const reconnect = scope.extend({ requestId: id, source }).strict()
const takeover = z.object({ projectId: id, requestId: id, draftRevision: id.nullable(),
  previousScopeEpoch: epoch, nextScopeEpoch: epoch, targetSource: source }).strict()
const codes: Record<string, string> = {
  FORBIDDEN_SENDER: '当前调用方没有 IPC 权限',
  INVALID_REQUEST: 'M1 请求格式无效',
  AUTH_REQUIRED: '请先授权当前窗口访问项目',
  DISCONNECTED: '客户端已断开，请重新连接',
  LOCAL_ENDPOINT_UNAVAILABLE: '当前安装未提供本地客户端入口',
  REQUEST_IN_PROGRESS: '已有请求正在处理',
  STALE_BASE: '项目或草稿已更新，请刷新后重试',
  WRITER_HELD: '已有写入方，请刷新并确认接管',
  WRITER_REVOKED: '写入权限已撤销，请刷新后重试',
  CURSOR_EXPIRED: '事件游标已过期，请重新读取快照',
  INVALID_CONFIG_FILE: '客户端配置文件格式无效',
  CONFIG_CHANGED: '客户端配置已更新，请重试',
  INVALID_API_KEY: '请填写有效的模型 API 密钥',
  AUTH_FAILED: '模型供应商拒绝了凭据',
  STEP_FAILED: '无法完成 M1 请求',
}
const ok = <T>(value: T): M1ModelResult<T> => ({ ok: true, value })
class StaleScope extends Error {
  readonly currentScopeEpoch: number
  constructor(currentScopeEpoch: number) {
    super('AUTH_REQUIRED')
    this.currentScopeEpoch = currentScopeEpoch
  }
}

function failure(error: unknown): M1ModelResult<never> {
  const code = error instanceof Error && Object.hasOwn(codes, error.message) ? error.message : 'STEP_FAILED'
  return { ok: false, error: { code, message: codes[code]!,
    ...(error instanceof StaleScope ? { detail: String(error.currentScopeEpoch) } : {}) } }
}
function activityView(activity: M1Activity): M1ExternalActivity {
  return { ...activity, title: '隔套草稿' }
}

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<M1ModelResult<unknown>>
export function installM1WorkbenchChannels(ipc: { handle(channel: string, handler: Handler): void }, ports: Ports) {
  const { guard, authority } = ports
  const agents = ports.agents ?? new M1AgentRegistration()
  const states = new Map<number, State>()
  const generations = new WeakMap<State['frame'], { sessionId: string; epoch: number }>()

  function stopSubscriptions(state: State) {
    for (const stream of state.subscriptions.values()) stream.stop()
    state.subscriptions.clear()
  }

  function invalidate(windowId: number, forgetDocument = false) {
    const state = states.get(windowId)
    if (!state) return
    states.delete(windowId)
    if (forgetDocument) generations.delete(state.frame)
    else generations.set(state.frame, { sessionId: state.session.sessionId, epoch: state.epoch + 1 })
    state.controller.abort()
    stopSubscriptions(state)
    void state.model?.dispose().catch(() => {})
  }

  function current(state: State, generation: number) {
    const binding = ports.sessionFor(state.windowId)
    return states.get(state.windowId) === state && state.epoch === generation && state.sameDocument() &&
      binding?.sessionId === state.session.sessionId && binding.projectId === state.session.projectId &&
      binding.path === state.session.path &&
      (!state.authorizationRef || authority.hasAuthorization(state.windowId, state.authorizationRef))
  }

  function check(state: State, generation: number) {
    if (!current(state, generation)) throw Error('AUTH_REQUIRED')
  }

  function findState(event: IpcMainInvokeEvent, projectId: string, generation: number) {
    const sender = toSenderInfo(event)
    const frame = event.senderFrame
    const sameDocument = () => !!frame && frame === event.senderFrame &&
      frame.url === sender.frameUrl && guard.verify(toSenderInfo(event)).ok
    const binding = ports.sessionFor(sender.webContentsId)
    if (!frame || !sameDocument() || !binding || binding.projectId !== projectId) throw Error('AUTH_REQUIRED')
    let state = states.get(sender.webContentsId)
    if (state && !current(state, state.epoch)) {
      invalidate(state.windowId)
      state = undefined
    }
    if (!state) {
      const last = generations.get(frame)
      const epoch = last?.sessionId === binding.sessionId ? last.epoch : 1
      if (generation !== epoch) throw new StaleScope(epoch)
      state = { frame, sameDocument, controller: new AbortController(), windowId: sender.webContentsId,
        session: { ...binding }, epoch, subscriptions: new Map() }
      states.set(state.windowId, state)
    }
    if (state.epoch !== generation) throw new StaleScope(state.epoch)
    check(state, generation)
    return state
  }

  async function callerFor(event: IpcMainInvokeEvent, state: State, generation: number, required = true) {
    const caller = await authority.resolve(toSenderInfo(event), state.session)
    check(state, generation)
    if (!caller) {
      if (required) throw Error('AUTH_REQUIRED')
      return null
    }
    if (state.authorizationRef && state.authorizationRef !== caller.authorizationRef) throw Error('AUTH_REQUIRED')
    state.authorizationRef = caller.authorizationRef
    return caller
  }

  function modelScope(event: IpcMainInvokeEvent, state: State, generation: number, caller: Caller): M1ModelScope {
    let topology: { fingerprint: string | null; result: Awaited<ReturnType<typeof readMateDrafts>> } | undefined
    return { sender: toSenderInfo(event), sessionId: state.session.sessionId, projectId: caller.projectId,
      scopeEpoch: generation, authorizationRef: caller.authorizationRef, isCurrent: () => current(state, generation),
      m2Change: ports.m2Change ? async () => {
        check(state, generation)
        const port = await ports.m2Change!(event, caller.projectId)
        check(state, generation)
        return port
      } : undefined,
      async readAttachment(ref, signal) {
        check(state, generation)
        return signal.aborted ? null : ports.readAttachment?.(state.windowId, ref) ?? null
      },
      async readMateDrafts(signal) {
        check(state, generation)
        const session = ports.sessionFor(state.windowId)
        if (!session || session.sessionId !== state.session.sessionId || session.projectId !== state.session.projectId) {
          throw Error('REFERENCE_STALE')
        }
        if (topology?.fingerprint === session.fingerprint) return topology.result
        const result = await readMateDrafts(session, signal)
        check(state, generation)
        topology = { fingerprint: session.fingerprint, result }
        return result
      },
      async readSelectedObject(ref, signal) {
        check(state, generation)
        return signal.aborted ? null : ports.readSelectedObject?.(state.windowId, ref) ?? null
      },
    }
  }

  function modelFor(event: IpcMainInvokeEvent, state: State, generation: number, caller: Caller) {
    return state.model ??= new M1ModelApi(authority, ports.runtime, modelScope(event, state, generation, caller))
  }

  async function status(state: State, generation: number, cut?: Cut): Promise<M1ConnectionStatusSnapshot> {
    const connections = (await ports.endpoint())?.connections() ?? []
    check(state, generation)
    const selected = state.source ?? (connections.length ? 'local-agent' : state.model ? 'model-api' : 'none')
    const external = selected === 'local-agent' && connections.length === 1 ? connections[0] : undefined
    const connectionState = selected === 'model-api' ? state.model?.transportState ?? 'disconnected'
      : external?.state ?? (selected === 'local-agent' && connections.some(peer => peer.state === 'connected')
        ? 'connected' : connections.length && selected === 'local-agent' ? 'connecting' : 'disconnected')
    return { connectionState, source: selected, clientName: external?.clientName ?? null,
      projectId: state.session.projectId, projectName: ports.projectName?.(state.windowId),
      baseRevision: cut?.baseRevision ?? null, draftRevision: cut?.snapshot.draftRevision ?? null,
      authorizationState: cut ? cut.writable ? 'authorized-writable' : 'authorized-readonly' : 'unauthorized',
      writerEpoch: cut?.snapshot.writerEpoch ?? 0, writerOccupied: cut?.snapshot.writerOccupied ?? false,
      writerOwner: cut?.writerSource ?? null }
  }

  function install(channel: string, handler: Handler) {
    ipc.handle(channel, async (event, ...args) => {
      const verdict = guard.verify(toSenderInfo(event))
      if (!verdict.ok) return verdict
      try { return await handler(event, ...args) } catch (error) { return failure(error) }
    })
  }

  function scoped<T extends { projectId: string; scopeEpoch: number }>(
    channel: string, schema: z.ZodType<T>,
    run: (event: IpcMainInvokeEvent, state: State, request: T, caller: Caller | null, extra: unknown[]) =>
      Promise<M1ModelResult<unknown>>,
    options: { authorization?: boolean; extra?: boolean } = {},
  ) {
    install(channel, async (event, raw, ...extra) => {
      const parsed = schema.safeParse(raw)
      if (!parsed.success || extra.length !== (options.extra ? 1 : 0)) throw Error('INVALID_REQUEST')
      const request = parsed.data
      const state = findState(event, request.projectId, request.scopeEpoch)
      const caller = await callerFor(event, state, request.scopeEpoch, options.authorization !== false)
      const result = await run(event, state, request, caller, extra)
      check(state, request.scopeEpoch)
      if (caller) await callerFor(event, state, request.scopeEpoch)
      return result
    })
  }

  install(IPC_CHANNELS.detectM1LocalAgents, async (event, ...args) => {
    if (args.length) throw Error('INVALID_REQUEST')
    let info: M1LocalAgentInstallInfo | undefined
    try { info = await ports.installInfo() } catch (error) {
      if (!(error instanceof Error) || error.message !== 'LOCAL_ENDPOINT_UNAVAILABLE') throw error
    }
    const value = await agents.detect(info)
    if (!guard.verify(toSenderInfo(event)).ok) throw Error('FORBIDDEN_SENDER')
    return ok(value)
  })
  install(IPC_CHANNELS.registerM1LocalAgent, async (event, raw, ...extra) => {
    const parsed = m1RegisterLocalAgentRequest.safeParse(raw)
    if (!parsed.success || extra.length) throw Error('INVALID_REQUEST')
    const frame = event.senderFrame
    const url = frame?.url
    const verifySender = () => {
      if (event.senderFrame !== frame || frame?.url !== url ||
          !guard.verify(toSenderInfo(event)).ok) throw Error('FORBIDDEN_SENDER')
    }
    const value = await agents.register(parsed.data.agentId, await ports.installInfo(), verifySender)
    verifySender()
    return ok(value)
  })
  install(IPC_CHANNELS.gdt, async (event, operation, raw, ...extra) => {
    if (operation === 'capabilities' && raw === undefined && !extra.length) return ok({ enabled: desktopGdtEnabled() })
    if (!desktopGdtEnabled()) return { ok: false, error: { code: 'FEATURE_DISABLED', message: '未启用 3D 装配功能' } }
    const request = z.looseObject({ projectId: id }).safeParse(raw)
    if (extra.length || typeof operation !== 'string' || !isGdtTool(operation) || !request.success) {
      throw Error('INVALID_REQUEST')
    }
    const sender = toSenderInfo(event)
    const frame = event.senderFrame
    const checkRequest = () => {
      if (event.senderFrame !== frame || frame?.url !== sender.frameUrl ||
        !guard.verify(toSenderInfo(event)).ok) throw Error('FORBIDDEN_SENDER')
    }
    try {
      return ok(await authority.runWindowGdtTool(sender, request.data.projectId, operation, raw, checkRequest))
    } catch (error) {
      if (error instanceof Error && M1_LOCAL_ERRORS.has(error.message)) {
        return { ok: false, error: { code: error.message, message: codes[error.message] ?? error.message } }
      }
      throw error
    }
  })

  scoped(IPC_CHANNELS.listM1ModelApiModels, m1ModelListRequest, async (_event, state, request) => {
    try { return ok(await listM1ModelApiModels(request, state.controller.signal)) }
    catch (error) { return failure(error) }
  })
  install(IPC_CHANNELS.getM1LocalAgentInstallInfo, async (_event, ...args) => {
    if (args.length) throw Error('INVALID_REQUEST')
    const value = await ports.installInfo()
    if (!guard.verify(toSenderInfo(_event)).ok) throw Error('FORBIDDEN_SENDER')
    return ok(value)
  })
  scoped(IPC_CHANNELS.getM1ConnectionStatus, scope, async (_event, state, request, caller) => {
    const cut = caller ? await authority.workbenchCut(state.session, caller) : undefined
    const result = await status(state, request.scopeEpoch, cut)
    cut?.seal()
    return ok(result)
  }, { authorization: false })
  scoped(IPC_CHANNELS.getM1ExternalActivities, scope, async (_event, state, _request, caller) => {
    const result = await getExternalActivities(authority, state.windowId, state.session, caller!.authorizationRef)
    return ok({ ...result, activities: result.activities.map(activityView) })
  })
  scoped(IPC_CHANNELS.testM1ModelApiConnection, m1ModelConnectionRequest, async (event, state, request, caller) => {
    state.source = 'model-api'
    return modelFor(event, state, request.scopeEpoch, caller!).testM1ModelApiConnection(request)
  })
  scoped(IPC_CHANNELS.sendM1ChatMessage, m1ChatRequest, async (event, state, request, caller) =>
    modelFor(event, state, request.scopeEpoch, caller!).sendM1ChatMessage(request))
  scoped(IPC_CHANNELS.cancelM1ChatMessage, m1CancelChatRequest, async (event, state, request, caller) =>
    modelFor(event, state, request.scopeEpoch, caller!).cancelM1ChatMessage(request))

  async function boundPeer(state: State) {
    const endpoint = await ports.endpoint()
    if (!endpoint) throw Error('DISCONNECTED')
    return endpoint.boundPeer(state.windowId, state.session.sessionId, state.session.projectId)
  }

  scoped(IPC_CHANNELS.reconnectM1Session, reconnect, async (_event, state, request, caller) => {
    const generation = request.scopeEpoch
    const peer = request.source === 'local-agent' ? await boundPeer(state) : undefined
    if (request.source === 'model-api') {
      if (!state.model) throw Error('DISCONNECTED')
      const result = await state.model.reconnect(request.requestId)
      if (!result.ok) return result
    }
    check(state, generation)
    state.source = request.source
    const cut = await authority.workbenchCut(state.session, caller!)
    const snapshot = await status(state, generation, cut)
    cut.seal()
    peer?.checkLive()
    return ok(peer ? { ...snapshot, clientName: peer.clientName, connectionState: 'connected' } : snapshot)
  })

  install(IPC_CHANNELS.takeoverM1Draft, async (event, raw, ...extra) => {
    const parsed = takeover.safeParse(raw)
    if (!parsed.success || extra.length) throw Error('INVALID_REQUEST')
    const request = parsed.data
    const previous = request.previousScopeEpoch
    const next = previous + 1
    if (request.nextScopeEpoch !== next) throw Error('INVALID_REQUEST')
    const requestFingerprint = JSON.stringify(request)
    const live = states.get(event.sender.id)
    const replay = live?.lastTakeover
    if (live && replay?.request === requestFingerprint) {
      check(live, next)
      const caller = await callerFor(event, live, next)
      const cut = await authority.workbenchCut(live.session, caller!)
      cut.seal()
      check(live, next)
      if (cut.snapshot.writerEpoch !== replay.value.writerEpoch) throw Error('WRITER_REVOKED')
      return ok(replay.value)
    }
    const state = findState(event, request.projectId, previous)
    const caller = await callerFor(event, state, previous)
    if (state.takeoverPending) throw Error('REQUEST_IN_PROGRESS')
    state.takeoverPending = true
    try {
      const cut = await authority.workbenchCut(state.session, caller!)
      if (request.draftRevision !== cut.snapshot.draftRevision) throw Error('STALE_BASE')
      const peer = request.targetSource === 'local-agent' ? await boundPeer(state) : undefined
      const checkRequest = () => check(state, previous)
      const lease = await authority.takeOverWriter({ windowId: state.windowId, sessionId: state.session.sessionId,
        projectId: request.projectId, expectedWriterEpoch: cut.snapshot.writerEpoch },
      (target, signal) => ports.confirm(request.targetSource, target,
        signal ? AbortSignal.any([signal, state.controller.signal]) : state.controller.signal, peer?.clientName),
      peer?.scope, checkRequest, request.draftRevision)
      try {
        checkRequest()
        peer?.setLease(lease)
        const model = modelFor(event, state, previous, caller!)
        stopSubscriptions(state)
        state.epoch = next
        state.source = request.targetSource
        state.model = model.handoff(modelScope(event, state, next, caller!), peer ? undefined : lease)
      } catch (error) {
        await authority.revokeWriter(lease)
        throw error
      }
      const value: M1TakeoverResult = { projectId: request.projectId, draftRevision: lease.draftRevision,
        writerEpoch: lease.writerEpoch, scopeEpoch: next, writerOwner: peer?.clientName ?? 'model-api',
        revokedPreviousWriter: true }
      state.lastTakeover = { request: requestFingerprint, value }
      return ok(value)
    } finally {
      state.takeoverPending = false
    }
  })

  scoped(IPC_CHANNELS.subscribeM1WorkbenchEvents, subscribe, async (event, state, request, caller, extra) => {
    const token = extra[0]
    if (typeof token !== 'string' || !z.uuid().safeParse(token).success) throw Error('INVALID_REQUEST')
    const generation = request.scopeEpoch
    const frame = event.senderFrame!
    const cut = await authority.workbenchCut(state.session, caller!)
    check(state, generation)
    cut.seal()
    if (state.subscriptions.has(token) || state.subscriptions.size >= 8) throw Error('INVALID_REQUEST')
    let cursor = request.afterSequence ?? state.cursor ?? 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const stop = () => {
      stopped = true
      clearTimeout(timer)
      state.subscriptions.delete(token)
    }
    const stream = { stop }
    state.subscriptions.set(token, stream)
    function push(value: M1WorkbenchEvent, cut: Cut) {
      check(state, generation)
      cut.seal()
      if (stopped || event.senderFrame !== frame) throw Error('AUTH_REQUIRED')
      frame.send(IPC_CHANNELS.m1WorkbenchEvent, token, value)
      cursor = value.sequence
      state.cursor = Math.max(state.cursor ?? 0, cursor)
    }
    async function drain() {
      try {
        check(state, generation)
        const connection = await status(state, generation)
        const signature = JSON.stringify([connection.source, connection.connectionState, connection.clientName])
        if (state.connectionSignature !== undefined && signature !== state.connectionSignature) {
          state.connectionUpdate ??= authority.recordWorkbenchConnection(state.session, caller!,
            () => check(state, generation)).then(() => { state.connectionSignature = signature })
            .finally(() => { state.connectionUpdate = undefined })
          await state.connectionUpdate
        } else {
          state.connectionSignature = signature
        }
        const cut = await authority.workbenchCut(state.session, caller!)
        const header = { projectId: request.projectId, scopeEpoch: generation, writerEpoch: cut.snapshot.writerEpoch }
        try {
          const { page, connectionSequences } = await authority.eventPage(state.session, caller!, cursor, 100)
          if (stopped) return
          if (page.highWatermark !== cut.snapshot.cursor) {
            timer = setTimeout(() => { void drain() }, 0)
            return
          }
          for (const item of page.events) {
            if (item.sequence <= cursor) continue
            // Bound this page to its state cut. Writes after the cut belong to the next drain.
            if (item.sequence > cut.snapshot.cursor) break
            const details = { ...header, sequence: item.sequence,
              baseRevision: item.baseRevision, draftRevision: item.draftRevision, jobId: item.jobId }
            if (connectionSequences.has(item.sequence)) {
              push({ ...details, type: 'connection_changed', connectionState: connection.connectionState,
                clientName: connection.clientName }, cut)
            } else if (item.type === 'taskChanged') {
              if (item.activity.source === 'external') push({ ...details, type: 'activity_updated', activity: activityView(item.activity) }, cut)
              else cursor = item.sequence
            } else {
              push({ ...details, type: 'draft_updated' }, cut)
            }
          }
        } catch (error) {
          if (!(error instanceof Error && error.message === 'CURSOR_EXPIRED')) throw error
          const snapshot = await status(state, generation, cut)
          push({ ...header, type: 'snapshot_required', sequence: cut.snapshot.cursor, snapshot,
            baseRevision: cut.baseRevision, draftRevision: cut.snapshot.draftRevision, jobId: null,
            activities: cut.activities.filter(activity => activity.source === 'external').map(activityView) }, cut)
        }
        if (!stopped) timer = setTimeout(() => { void drain() }, cursor < cut.snapshot.cursor ? 0 : ports.pollMs ?? 200)
      } catch (error) {
        if (!stopped && error instanceof Error && ['AUTH_REQUIRED', 'STALE_BASE'].includes(error.message) &&
          current(state, generation)) timer = setTimeout(() => { void drain() }, ports.pollMs ?? 200)
        else stop()
      }
    }
    timer = setTimeout(() => { void drain() }, 0)
    return ok({ subscriptionId: token })
  }, { extra: true })

  install(IPC_CHANNELS.unsubscribeM1WorkbenchEvents, async (event, token, ...extra) => {
    if (extra.length || !z.uuid().safeParse(token).success) throw Error('INVALID_REQUEST')
    const state = states.get(event.sender.id)
    if (state && current(state, state.epoch) && event.senderFrame === event.sender.mainFrame) {
      state.subscriptions.get(token as string)?.stop()
    }
    return ok(null)
  })
  return { invalidate, scopeEpoch: (windowId: number) => states.get(windowId)?.epoch ?? 1 }
}
