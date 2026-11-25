import { randomUUID } from 'node:crypto'
import type { M3ExternalProjectEvent, M3MigrationReport } from '../../../shared/project-agent/m3-lifecycle'
import type { M1StageResult } from '../m1StageContracts'
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { IPC_CHANNELS } from '../../../shared/contracts'
import type { M2Result } from '../../../shared/project-agent/m2-preview'
import { toSenderInfo } from '../../ipc'
import type { SenderGuard } from '../../senderGuard'
import type { LocalM1Authority, LocalM1Session } from '../m1LocalAuthority'
import { openM2DraftStore } from './draftStore'
import { fingerprint, runMountingPlate, runMountingPlateDrawing } from './engine.mjs'
import { M2Pipeline } from './pipeline'
import type { RequirementsSource } from './requirements'

const id = z.string().min(1).max(240)
const scope = z.object({ projectId: id }).strict()
const snapshot = scope.extend({ revision: id.nullable().optional() })
const locate = scope.extend({ revision: id.nullable(), target: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('check'), checkId: id, requirementId: id }).strict(),
  z.object({ kind: z.literal('requirement'), requirementId: id }).strict(),
  z.object({ kind: z.literal('feature'), objectId: id, featureRef: id }).strict(),
  z.object({ kind: z.literal('annotation'), annotationId: id }).strict(),
]) })
const retry = scope.extend({ revision: id, requestId: id })
const clarify = scope.extend({
  revision: id.nullable(), targetId: id, requestId: id,
  mode: z.enum(['answer', 'correct_interpretation']), content: z.string().trim().min(1).max(4000),
})
const m3Commit = scope.extend({ baseRevision: id.nullable(), draftRevision: id, checkSetFingerprint: id,
  confirmationToken: id, requestId: id })
const m3Undo = scope.extend({ draftRevision: id.nullable(), requestId: id })
const m3Open = scope.extend({ draftRevision: id.nullable().optional(), requestId: id })
const m3Messages: Record<string, string> = {
  UNAUTHORIZED: '请先授权相应项目文件',
  FINGERPRINT_MISMATCH: '草稿、产物或检查结果已变更，请刷新完成视图',
  CHECKS_BLOCKED: '必需检查尚未全部通过',
  BASE_REVISION_CONFLICT: '正式版本或当前草稿已经变更',
  DUPLICATE_REQUEST: '请求编号已用于其他内容',
  CONFIRMATION_EXPIRED: '确认已取消、过期或使用',
  NOTHING_TO_UNDO: '没有可撤销的草稿变更',
  DRAFT_NOT_FOUND: '未找到请求的草稿修订',
  WRITER_REVOKED: '当前窗口没有草稿写入权限',
  INTERNAL: '无法完成项目版本操作',
}
const messages: Record<string, string> = {
  AUTH_REQUIRED: '请先授权当前项目文件',
  INVALID_REQUEST: 'M2 请求格式无效',
  WRITER_REVOKED: '请先获得当前项目草稿写入权',
  STALE_BASE: '项目或草稿已更改',
  NOT_FOUND: '未找到所请求的证据或修订',
  REQUEST_COLLISION: '请求编号已用于不同的操作内容',
  DRAWING_FAILED: '图纸生成失败',
  DRAWING_NOT_RETRYABLE: '当前图纸无法重试',
  STALE_SOURCE: '任务书内容校验失败',
  DRAFT_READ_FAILED: '无法读取上次保存的安装板草稿',
  STEP_FAILED: '无法完成 M2 请求',
}

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<M2Result<unknown>>
interface Ports {
  guard: SenderGuard
  authority: Pick<LocalM1Authority, 'resolve' | 'workbenchCut'>
  sessionFor(windowId: number): LocalM1Session | null
  draftRoot?: string
  scopeEpoch?(windowId: number): number
  workerUrl?: URL
  eventForWindow?(windowId: number): Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'> | null
  openPeer?(windowId: number): void
  confirmM3?(windowId: number, projectId: string, revision: string, signal: AbortSignal): Promise<boolean>
  migrationReport?(windowId: number, verify: () => void): Promise<M3MigrationReport | null>
  projectName?(windowId: number): string | undefined
  openLegacy?(windowId: number): {
    formalVersions: { revision: string; committedAtLabel: string; summary: string; isCurrent: boolean }[]
    uncommittedDrafts: { draftRevision: string; baseRevision: string | null; updatedAtLabel: string; status: 'in_progress'; summary: string }[]
    restoredSourceCount: number
  } | null
  sources(windowId: number): RequirementsSource[]
}
interface State {
  windowId: number
  pipeline: M2Pipeline
  frame: NonNullable<IpcMainInvokeEvent['senderFrame']>
  live(): void
  session: LocalM1Session
  authorizationRef: string
  principal: string
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>
  bindingKey: string
  m1DraftRevision: string | null
  lastExternalDraft?: string
  confirms: Map<string, { digest: string; controller: AbortController; reply: Promise<unknown> }>
  externalStreams: Set<string>
  imported: Set<string>
  importing?: Promise<void>
  streams: Map<string, () => void>
  verify: () => void
}

export function installM2PreviewChannels(ipc: { handle(channel: string, handler: Handler): void }, ports: Ports) {
  let externalSequence = 0
  const states = new Map<number, State>()

  function invalidate(windowId: number) {
    const state = states.get(windowId)
    states.delete(windowId)
    state?.pipeline.dispose()
    for (const flight of state?.confirms.values() ?? []) flight.controller.abort()
    state?.externalStreams.clear()
    for (const stop of state?.streams.values() ?? []) stop()
  }

  async function access(event: State['event'], projectId: string) {
    const sender = toSenderInfo(event)
    const frame = event.senderFrame
    const binding = ports.sessionFor(sender.webContentsId)
    const check = () => {
      const current = ports.sessionFor(sender.webContentsId)
      if (!frame || event.senderFrame !== frame || frame.url !== sender.frameUrl ||
        !ports.guard.verify(toSenderInfo(event)).ok || !binding?.path || binding.projectId !== projectId ||
        current?.sessionId !== binding.sessionId || current.path !== binding.path || current.fingerprint !== binding.fingerprint) {
        throw Error('AUTH_REQUIRED')
      }
    }
    check()
    const caller = await ports.authority.resolve(sender, binding!)
    if (!caller) throw Error('AUTH_REQUIRED')
    const cut = await ports.authority.workbenchCut(binding!, caller)
    const verify = () => { check(); cut.seal() }
    verify()
    let state = states.get(sender.webContentsId)
    const writerEpoch = cut.snapshot.writerEpoch
    if (state && (state.frame !== frame || state.session.sessionId !== binding!.sessionId ||
      state.session.fingerprint !== binding!.fingerprint || state.authorizationRef !== caller.authorizationRef)) {
      invalidate(sender.webContentsId)
      state = undefined
    }
    if (!state) {
      const created: State = {
        windowId: sender.webContentsId,
        pipeline: new M2Pipeline(projectId, ports.scopeEpoch?.(sender.webContentsId) ?? 1, writerEpoch, {
          build: (model, options) => runMountingPlate(model, { ...options, workerUrl: ports.workerUrl }),
          draw: (report, options) => runMountingPlateDrawing(report, { ...options, workerUrl: ports.workerUrl }),
        }, () => created.live(), ports.draftRoot && cut.bindingKey
          ? openM2DraftStore(ports.draftRoot, projectId, cut.bindingKey) : undefined), frame: frame!, session: { ...binding! },
        authorizationRef: caller.authorizationRef, principal: caller.userId, event, bindingKey: cut.bindingKey,
        m1DraftRevision: null, confirms: new Map(), externalStreams: new Set(), imported: new Set(), streams: new Map(), verify,
        live() {
          if (states.get(sender.webContentsId) !== created) throw Error('AUTH_REQUIRED')
          created.verify()
        },
      }
      states.set(sender.webContentsId, created)
      state = created
    }
    state.verify = verify
    state.event = event
    state.m1DraftRevision = cut.snapshot.draftRevision ?? null
    state.pipeline.fileBaseRevision = cut.baseRevision ?? null
    state.pipeline.rebind(ports.scopeEpoch?.(sender.webContentsId) ?? 1, writerEpoch)
    return { state, verify, writable: cut.writable, writerEpoch, revisionOrder: cut.snapshot.cursor }
  }

  async function importSource(state: State, windowId: number) {
    state.importing ??= (async () => {
      const sources = ports.sources(windowId)
      const sourceKey = (source: RequirementsSource) => fingerprint([source.documentRef, source.sha256])
      const knownKeys = new Set(sources.map(sourceKey))
      state.pipeline.reconcileSources(knownKeys)
      for (const key of state.imported) if (!knownKeys.has(key)) state.imported.delete(key)
      for (const source of sources) {
        const key = sourceKey(source)
        if (state.imported.has(key)) continue
        await state.pipeline.importRequirements(source, () => {
          state.live()
          if (!ports.sources(windowId).some(candidate => candidate.documentRef === source.documentRef &&
            candidate.sha256 === source.sha256)) throw Error('STALE_SOURCE')
        })
        state.imported.add(key)
      }
    })().finally(() => { state.importing = undefined })
    await state.importing
  }

  function install(channel: string, handler: Handler) {
    ipc.handle(channel, async (event, ...args) => {
      const verdict = ports.guard.verify(toSenderInfo(event))
      if (!verdict.ok) return verdict
      try {
        return await handler(event, ...args)
      } catch (error) {
        const code = error instanceof Error && Object.hasOwn(messages, error.message) ? error.message : 'STEP_FAILED'
        return { ok: false, error: { code, message: messages[code] } }
      }
    })
  }

  function scoped<T extends { projectId: string }>(channel: string, schema: z.ZodType<T>,
    run: (state: State, request: T, token: unknown) => unknown, options: { write?: boolean; subscribe?: boolean } = {}) {
    install(channel, async (event, raw, ...extra) => {
      const request = schema.safeParse(raw)
      if (!request.success || extra.length !== Number(!!options.subscribe)) throw Error('INVALID_REQUEST')
      const { state, verify, writable } = await access(event, request.data.projectId)
      if (options.write && !writable) throw Error('WRITER_REVOKED')
      if (!options.subscribe) await importSource(state, event.sender.id)
      verify()
      state.live()
      const value = await run(state, request.data, extra[0])
      verify()
      state.live()
      return { ok: true, value }
    })
  }

  scoped(IPC_CHANNELS.getM2PreviewSnapshot, snapshot, (state, request) => state.pipeline.snapshot(request.revision))
  scoped(IPC_CHANNELS.locateM2Evidence, locate, (state, request) => state.pipeline.locate(request))
  scoped(IPC_CHANNELS.retryM2Drawing, retry, (state, request) => state.pipeline.retryDrawing(request), { write: true })
  scoped(IPC_CHANNELS.submitM2Clarification, clarify, (state, request) => state.pipeline.clarify(request), { write: true })
  scoped(IPC_CHANNELS.subscribeM2PreviewEvents, scope, (state, _request, token) => {
    if (typeof token !== 'string' || !z.uuid().safeParse(token).success || state.streams.size >= 8 ||
      state.streams.has(token)) throw Error('INVALID_REQUEST')
    const stop = state.pipeline.subscribe(value => {
      try {
        state.live()
        state.frame.send(IPC_CHANNELS.m2PreviewEvent, token, value)
      } catch {
        stop()
        state.streams.delete(token)
      }
    })
    state.streams.set(token, stop)
    void importSource(state, state.windowId).catch(() => {})
    return { subscriptionId: token }
  }, { subscribe: true })

  install(IPC_CHANNELS.unsubscribeM2PreviewEvents, async (event, token, ...extra) => {
    if (typeof token !== 'string' || !z.uuid().safeParse(token).success || extra.length) throw Error('INVALID_REQUEST')
    const state = states.get(event.sender.id)
    if (state && state.frame === event.senderFrame) {
      state.live()
      state.streams.get(token)?.()
      state.streams.delete(token)
    }
    return { ok: true, value: null }
  })
  function installM3(channel: string, handler: Handler) {
    ipc.handle(channel, async (event, ...args) => {
      const verdict = ports.guard.verify(toSenderInfo(event))
      if (!verdict.ok) return { ok: false, error: { ...verdict.error, code: 'UNAUTHORIZED' } }
      try {
        return await handler(event, ...args)
      } catch (error) {
        const reason = error instanceof Error ? error.message : ''
        const code = reason === 'AUTH_REQUIRED' ? 'UNAUTHORIZED' : reason === 'STALE_BASE'
          ? 'BASE_REVISION_CONFLICT' : Object.hasOwn(m3Messages, reason) ? reason : 'INTERNAL'
        return { ok: false, error: { code, message: m3Messages[code] } }
      }
    })
  }

  function parse<T>(schema: z.ZodType<T>, raw: unknown, extra: unknown[]) {
    const result = schema.safeParse(raw)
    if (!result.success || extra.length) throw Error('UNAUTHORIZED')
    return result.data
  }

  async function own(event: IpcMainInvokeEvent) {
    const projectId = ports.sessionFor(event.sender.id)?.projectId
    if (!projectId) throw Error('UNAUTHORIZED')
    return access(event, projectId)
  }

  async function readable(event: IpcMainInvokeEvent, projectId: string, allowPeer = false) {
    const requester = await own(event)
    if (requester.state.session.projectId === projectId) return requester
    // A peer result is exposed only through an active native-authorized, unambiguous file binding
    // belonging to the same local installation principal.
    const peers = [...states.values()].filter(state => state.session.projectId === projectId &&
      allowPeer && state.principal === requester.state.principal)
    if (!peers.length || new Set(peers.map(peer => peer.bindingKey)).size !== 1 || !peers[0].bindingKey) {
      throw Error('UNAUTHORIZED')
    }
    const target = await access(peers[0].event, projectId)
    const verify = () => { requester.verify(); target.verify(); target.state.live() }
    verify()
    return { ...target, verify, writable: false }
  }

  installM3(IPC_CHANNELS.commitM3ApprovedDraft, async (event, raw, ...extra) => {
    const request = parse(m3Commit, raw, extra)
    const { state, verify, writable } = await access(event, request.projectId)
    if (!writable) throw Error('WRITER_REVOKED')
    await importSource(state, state.windowId)
    const digest = fingerprint(request)
    const inFlight = state.confirms.get(request.requestId)
    if (inFlight && inFlight.digest !== digest) throw Error('DUPLICATE_REQUEST')
    if (inFlight) {
      const value = await inFlight.reply
      verify()
      return { ok: true, value }
    }
    const controller = new AbortController()
    const reply = state.pipeline.commit(request, async () => {
      if (state.confirms.size || !ports.confirmM3) return false
      const timer = setTimeout(() => controller.abort(), 120_000)
      try {
        return await ports.confirmM3(state.windowId, request.projectId, request.draftRevision, controller.signal) &&
          !controller.signal.aborted
      } finally {
        clearTimeout(timer)
      }
    }, verify)
    state.confirms.set(request.requestId, { digest, reply, controller })
    const value = await reply.finally(() => { state.confirms.delete(request.requestId) })
    verify()
    return { ok: true, value }
  })

  installM3(IPC_CHANNELS.undoDraftChange, async (event, raw, ...extra) => {
    const request = parse(m3Undo, raw, extra)
    const { state, verify, writable } = await access(event, request.projectId)
    if (!writable) throw Error('WRITER_REVOKED')
    await importSource(state, state.windowId)
    verify()
    const value = await state.pipeline.undo(request)
    verify()
    return { ok: true, value }
  })

  installM3(IPC_CHANNELS.getMigrationReport, async (event, raw, ...extra) => {
    const request = parse(scope, raw, extra)
    const { state, verify } = await readable(event, request.projectId)
    const value = await ports.migrationReport?.(state.windowId, verify) ?? null
    verify()
    return { ok: true, value }
  })

  installM3(IPC_CHANNELS.openExternalProjectResult, async (event, raw, ...extra) => {
    const request = parse(m3Open, raw, extra)
    const { state, verify } = await readable(event, request.projectId, true)
    await importSource(state, state.windowId)
    const latest = await state.pipeline.restore()
    const legacy = !latest.previewSnapshot.currentRevision ? ports.openLegacy?.(state.windowId) : null
    const result = legacy ? latest : request.draftRevision ? await state.pipeline.restore(request.draftRevision) : latest
    const legacyDrafts = legacy ? [...legacy.uncommittedDrafts] : []
    if (legacy && state.m1DraftRevision) legacyDrafts.unshift({ draftRevision: state.m1DraftRevision,
      baseRevision: result.baseRevision, updatedAtLabel: '', status: 'in_progress', summary: 'Agent 隔套草稿' })
    if (legacy && request.draftRevision && !legacyDrafts.some(draft => draft.draftRevision === request.draftRevision)) {
      throw Error('DRAFT_NOT_FOUND')
    }
    const migrationReport = legacy ? await ports.migrationReport?.(state.windowId, verify) ?? null : null
    verify()
    if (state.windowId !== event.sender.id) ports.openPeer?.(state.windowId)
    return { ok: true, value: { projectId: request.projectId,
      projectName: ports.projectName?.(state.windowId) ?? request.projectId, ...result,
      ...(legacy && { previewSnapshot: undefined, formalVersions: legacy.formalVersions, uncommittedDrafts: legacyDrafts,
        draftRevision: (request.draftRevision ?? legacyDrafts[0]?.draftRevision) ?? null,
        restoreStatus: { ...result.restoreStatus, restoredFromDisk: true, restoredSourceCount: legacy.restoredSourceCount,
          draftRevision: (request.draftRevision ?? legacyDrafts[0]?.draftRevision) ?? null, summary: '已打开隔套项目及其保存记录' } }),
      migrationReport } }
  })

  installM3(IPC_CHANNELS.subscribeM3ExternalProjectEvents, async (event, raw, ...extra) => {
    const token = parse(z.uuid(), raw, extra)
    const { state } = await own(event)
    if (state.externalStreams.size >= 8 || state.externalStreams.has(token)) throw Error('UNAUTHORIZED')
    state.externalStreams.add(token)
    return { ok: true, value: { subscriptionId: token } }
  })

  installM3(IPC_CHANNELS.unsubscribeM3ExternalProjectEvents, async (event, raw, ...extra) => {
    const token = parse(z.uuid(), raw, extra)
    const { state } = await own(event)
    state.externalStreams.delete(token)
    return { ok: true, value: null }
  })

  async function externalDraft(windowId: number, result: M1StageResult, writerEpoch: number) {
    if (!('draftRevision' in result) || !result.draftRevision) return
    const binding = ports.sessionFor(windowId)
    const event = ports.eventForWindow?.(windowId) ?? states.get(windowId)?.event
    if (!binding || !event) return
    const cut = await access(event, binding.projectId)
    const target = cut.state
    const recipients = [...states.values()].filter(state => state !== target && state.principal === target.principal)
      .flatMap(state => [...state.externalStreams].map(token => ({ state, token })))
    if (!recipients.length) return
    if (!target.bindingKey || cut.writerEpoch !== writerEpoch || target.m1DraftRevision !== result.draftRevision ||
      [...states.values()].some(state => state !== target && state.principal === target.principal &&
        state.session.projectId === target.session.projectId && state.bindingKey !== target.bindingKey) ||
      target.lastExternalDraft === result.draftRevision) return
    target.lastExternalDraft = result.draftRevision
    const value: M3ExternalProjectEvent = { eventId: randomUUID(), projectId: target.session.projectId,
      projectName: ports.projectName?.(target.windowId) ?? target.session.projectId, sequence: ++externalSequence,
      scopeEpoch: ports.scopeEpoch?.(target.windowId) ?? 1, writerEpoch, baseRevision: cut.state.pipeline.baseRevision,
      draftRevision: result.draftRevision, revisionOrder: cut.revisionOrder,
      fingerprint: fingerprint(result), summary: '外部客户端更新了项目草稿' }
    for (const { state, token } of recipients) {
      try {
        const current = await access(state.event, state.session.projectId)
        cut.verify()
        if (current.state === state && target.m1DraftRevision === value.draftRevision &&
          target.lastExternalDraft === value.draftRevision && state.externalStreams.has(token)) {
          state.frame.send(IPC_CHANNELS.m3ExternalProjectEvent, token, value)
        }
      } catch { /* revocation or navigation stopped delivery */ }
    }
  }

  return {
    invalidate,
    externalDraft,
    readAttachment(windowId: number, ref: string) {
      const state = states.get(windowId)
      if (!state) return null
      state.live()
      return state.pipeline.readAttachment(ref)
    },
    readSelectedObject(windowId: number, ref: string) {
      const state = states.get(windowId)
      if (!state) return null
      state.live()
      return state.pipeline.readSelectedObject(ref)
    },
    async modelChangePort(event: IpcMainInvokeEvent, projectId: string) {
      const { state, verify, writable } = await access(event, projectId)
      // M1 remains usable if the auxiliary M2 text reader cannot classify an attachment.
      try { await importSource(state, event.sender.id) } catch (error) {
        verify()
        if (!state.pipeline.snapshot().currentRevision) return null
        throw new Error('STALE_SOURCE', { cause: error })
      }
      verify()
      const revision = state.pipeline.snapshot().currentRevision
      if (!revision) return null
      return {
        revision,
        select(objectId: string) {
          verify()
          state.live()
          if (state.pipeline.snapshot().currentRevision !== revision) throw Error('REFERENCE_STALE')
          return state.pipeline.readSelectedObject(objectId)
        },
        stage(requestId: string, deltaQ: number) {
          verify()
          state.live()
          if (!writable) throw Error('WRITER_REVOKED')
          return state.pipeline.stageChange(revision, requestId, { kind: 'moveRightHoleX', deltaQ })
        },
      }
    },
    async sourceImported(windowId: number) {
      const state = states.get(windowId)
      if (!state) return
      state.live()
      await importSource(state, windowId)
    },
  }
}
