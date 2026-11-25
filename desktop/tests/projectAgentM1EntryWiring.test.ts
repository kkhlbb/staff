import { expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { installM1ReadChannels } from '../main/project-agent/m1ReadChannels'
import { SenderGuard } from '../main/senderGuard'
import type { IpcMainLike } from '../main/ipc'
import { IPC_CHANNELS } from '../shared/contracts'
import { acceptEntryReply, classifyEntryFailure, routeEntryPage } from '../shared/project-agent/m1-entry-1933.ts'

const request = { projectId: 'p', authorizationRef: 'grant', requestGeneration: 1, requestId: 'r' }
const caller = { projectId: 'p', authorizationRef: 'grant', userId: 'u', callerId: 'c' }
const context = { snapshot: { projectId: 'p', draftRevision: null, cursor: 0, connection: 'disconnected',
  authorization: { authorized: true, canWrite: false }, writer: { epoch: 0, occupied: false }, spacerDraft: null }, activities: [] }
const m0 = { version: '0.1.0-m0', type: 'contextChanged', projectId: 'p', sequence: 1,
  baseRevision: null, draftRevision: null, jobId: null }
const task = { candidate: 'm1-review-1853', type: 'taskChanged', projectId: 'p', sequence: 2,
  baseRevision: null, draftRevision: null, jobId: null, activity: {
    taskId: 't', projectId: 'p', source: 'internal', status: 'queued', baseRevision: null,
    draftRevision: null, lastStep: null, question: null, errorCode: null, updatedAtMs: 0,
  } }
const page = { events: [m0, task], nextCursor: 2, highWatermark: 2 }

function setup(inject = true) {
  const handlers = new Map<string, Parameters<IpcMainLike['handle']>[1]>()
  const ipc: IpcMainLike = { handle: (channel, handler) => { handlers.set(channel, handler) }, on: vi.fn() }
  const guard = new SenderGuard()
  const frame = { url: 'file:///desktop.html' }
  guard.register({ webContentsId: 1, isDestroyed: () => false, isAllowedFrameUrl: url => url === frame.url })
  const event = { sender: { id: 1, mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent
  let session = { sessionId: 's', projectId: 'p' }
  let grant: typeof caller | null = caller
  const readContext = vi.fn(async (): Promise<unknown> => context)
  const readEvents = vi.fn(async (): Promise<unknown> => page)
  installM1ReadChannels(ipc, { guard, sessionFor: () => session,
    ...(inject ? { resolveTrustedM1Caller: () => grant, readContext, readEvents } : {}) })
  return { event, readContext, readEvents, close: () => guard.unregister(1),
    switchProject: () => { session = { sessionId: 's2', projectId: 'q' } }, revoke: () => { grant = null },
    invoke: (channel: string, input: unknown, sender = event) => handlers.get(channel)!(sender, input) }
}
const get = () => IPC_CHANNELS.m1GetProjectContext

it('rejects unregistered senders and subframes before data access', async () => {
  const f = setup()
  const subframe = { ...f.event, senderFrame: { url: 'file:///desktop.html' } } as IpcMainInvokeEvent
  expect(await f.invoke(get(), request, subframe)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN_SENDER' } })
  f.close()
  expect(await f.invoke(get(), request)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN_SENDER' } })
  expect(f.readContext).not.toHaveBeenCalled()
})

it('rejects extra identity, permission and filesystem fields plus mismatched project and grant', async () => {
  const f = setup()
  for (const forged of [{ userId: 'u' }, { callerId: 'c' }, { canWrite: true }, { path: '/anything' }]) {
    expect(await f.invoke(get(), { ...request, ...forged })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
  }
  for (const forged of [{ authorizationRef: 'wrong' }, { projectId: 'wrong' }]) {
    expect(await f.invoke(get(), { ...request, ...forged })).toMatchObject({ ok: true, value: { ok: false, error: { code: 'AUTH_REQUIRED' } } })
  }
  expect(f.readContext).not.toHaveBeenCalled()
})

it('defaults to explicit authorization denial', async () => {
  const result = await setup(false).invoke(get(), request)
  expect(result).toMatchObject({ ok: true, value: { ok: false, error: { code: 'AUTH_REQUIRED' } } })
  if (result.ok && acceptEntryReply('getContext', request, requestScope(), result.value) && !result.value.ok) {
    expect(classifyEntryFailure(result.value.error)?.kind).toBe('m0')
  } else throw Error('Missing valid M1 denial')
})

function requestScope() {
  return { projectId: request.projectId, authorizationRef: request.authorizationRef, requestGeneration: request.requestGeneration }
}

it('validates context and full pages using the candidate and routes task events separately', async () => {
  const f = setup()
  const ctx = await f.invoke(get(), request)
  expect(ctx.ok && acceptEntryReply('getContext', request, requestScope(), ctx.value)).toBe(true)
  const read = { ...request, afterSequence: 0, limit: 2 }
  const result = await f.invoke(IPC_CHANNELS.m1ReadProjectEvents, read)
  if (!result.ok || !acceptEntryReply('readProjectEvents', read, requestScope(), result.value) || !result.value.ok) throw Error('Missing page')
  const onM0 = vi.fn(), onTask = vi.fn()
  expect(routeEntryPage('p', 0, result.value.result, onM0, onTask)).toBe(true)
  expect(onM0.mock.calls).toEqual([[m0]])
  expect(onTask.mock.calls).toEqual([[task]])
  f.readEvents.mockResolvedValueOnce({ ...page, nextCursor: 3 })
  expect(await f.invoke(IPC_CHANNELS.m1ReadProjectEvents, read)).toMatchObject({ ok: true, value: { ok: false, error: { code: 'STEP_FAILED' } } })
})

it.each(['switchProject', 'revoke', 'close'] as const)('drops a pending data reply after %s', async action => {
  const f = setup()
  let finish!: (value: unknown) => void
  f.readContext.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const pending = f.invoke(get(), request)
  await vi.waitFor(() => expect(f.readContext).toHaveBeenCalledTimes(1))
  f[action]()
  finish(context)
  expect(await pending).toMatchObject(action === 'close' ? { ok: false, error: { code: 'FORBIDDEN_SENDER' } }
    : { ok: true, value: { ok: false, error: { code: 'AUTH_REQUIRED' } } })
})

it('keeps subscription and cancellation endpoints unavailable without allocating handles', async () => {
  const f = setup()
  expect(await f.invoke(IPC_CHANNELS.m1SubscribeProjectEvents, { ...request, afterSequence: 0 }))
    .toMatchObject({ ok: true, value: { ok: false, error: { code: 'UNSUPPORTED_SCOPE' } } })
  expect(await f.invoke(IPC_CHANNELS.m1CancelProjectSubscription, { ...request, subscriptionId: 'guess' }))
    .toMatchObject({ ok: true, value: { ok: false, error: { code: 'UNSUPPORTED_SCOPE' } } })
  expect(f.readEvents).not.toHaveBeenCalled()
})

const preloadMocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  return {
    listeners,
    expose: vi.fn(),
    invoke: vi.fn(),
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      const active = listeners.get(channel) ?? new Set()
      active.add(listener)
      listeners.set(channel, active)
    }),
    remove: vi.fn((channel: string, listener: (...args: unknown[]) => void) => listeners.get(channel)?.delete(listener)),
  }
})
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: preloadMocks.expose },
  ipcRenderer: { invoke: preloadMocks.invoke, on: preloadMocks.on, removeListener: preloadMocks.remove },
}))

it('exposes named preload functions and allocates no M1 listener while delivery is disabled', async () => {
  await import('../preload/index')
  const [name, api] = preloadMocks.expose.mock.calls[0]
  expect(name).toBe('cunlian')
  for (const key of ['ipcRenderer', 'channel', 'send', 'invoke', 'registerReference', 'rotateAuthorization', 'stageM1ProjectChange']) {
    expect(api).not.toHaveProperty(key)
  }
  expect(api.getM1ReadCapabilities()).toMatchObject({
    productionApiConnected: false, formalSaveEnabled: false, subscriptionsAvailable: false,
  })
  const fixture = setup(false)
  preloadMocks.invoke.mockImplementation(fixture.invoke)
  expect(await api.getM1ProjectContext(request)).toMatchObject({ ok: true, value: { error: { code: 'AUTH_REQUIRED' } } })
  const listener = vi.fn()
  expect(await api.subscribeM1ProjectEvents({ ...request, afterSequence: 0 }, listener))
    .toMatchObject({ ok: true, value: { error: { code: 'AUTH_REQUIRED' } } })
  expect(preloadMocks.on).not.toHaveBeenCalled()
  expect(listener).not.toHaveBeenCalled()
})

it('preserves the existing payload-only subscription and removes just its own listener', async () => {
  vi.resetModules()
  await import('../preload/index')
  const [, api] = preloadMocks.expose.mock.calls[0]
  const first = vi.fn(), second = vi.fn()
  const cancelFirst = api.onAgentEvent(first)
  const cancelSecond = api.onAgentEvent(second)
  const listeners = preloadMocks.listeners.get('agent:event')!
  for (const listener of listeners) listener({ sender: 'private' }, { taskId: 't' })
  expect(first.mock.calls).toEqual([[{ taskId: 't' }]])
  expect(second.mock.calls).toEqual([[{ taskId: 't' }]])
  cancelFirst()
  expect(listeners.size).toBe(1)
  for (const listener of listeners) listener({ sender: 'private' }, { taskId: 'next' })
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenLastCalledWith({ taskId: 'next' })
  cancelSecond()
})
