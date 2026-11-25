import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { LocalM1Authority } from '../main/project-agent/m1LocalAuthority.ts'
import { isM1ContextFields } from '../shared/project-agent/m1-fields.ts'
import { isM1FullEventPage } from '../shared/project-agent/m1-protocol-1915.ts'

const root = '/Users/aston/DSH/tmp/cunlian-agent-refactor/isolated-2018-m1-binding-identity/tmp/'
const req = { projectId: 'p', requestId: 'r', requestGeneration: 1 }
const sender = { webContentsId: 1, frameUrl: 'file:///desktop.html', isMainFrame: true }
async function setup(decision: 'approve' | 'deny' | 'cancel' = 'approve') {
  await fs.mkdir(root, { recursive: true })
  const dir = await fs.mkdtemp(root + 'identity-')
  const file = path.join(dir, 'project.cunlian')
  await fs.writeFile(file, 'synthetic project')
  let session = { sessionId: 's', projectId: 'p', path: file, fingerprint: createHash('sha256').update('synthetic project').digest('hex') }
  const confirm = vi.fn(async () => decision)
  const authority = new LocalM1Authority({ root: path.join(dir, 'state'), sessionFor: () => session, confirm })
  return { authority, dir, file, confirm, binding: () => ({ ...session }),
    switch: () => { session = { ...session, sessionId: 's2' } } }
}

it.each(['deny', 'cancel'] as const)('opening is not authorization and %s grants nothing', async choice => {
  const f = await setup(choice)
  expect(await f.authority.resolve(sender, f.binding())).toBeNull()
  await expect(f.authority.authorize(sender, req)).rejects.toThrow('AUTH_REQUIRED')
  expect(await f.authority.resolve(sender, f.binding())).toBeNull()
})
it('rejects renderer identity, path, generation and approved claims before confirmation', async () => {
  const f = await setup()
  for (const extra of [{ userId: 'u' }, { callerId: 'c' }, { path: f.file }, { authorizationRef: 'a' }, { approved: true }]) {
    await expect(f.authority.authorize(sender, { ...req, ...extra })).rejects.toThrow('INVALID_REQUEST')
  }
  expect(f.confirm).not.toHaveBeenCalled()
})
it('confirmed reads use the real service and pass the frozen context/full-page validators', async () => {
  const f = await setup()
  const scope = await f.authority.authorize(sender, req)
  const caller = await f.authority.resolve(sender, f.binding())
  expect(caller?.authorizationRef).toBe(scope.authorizationRef)
  if (!caller) throw Error('missing caller')
  expect(isM1ContextFields(await f.authority.readContext(f.binding(), caller))).toBe(true)
  expect(isM1FullEventPage('p', 0)(await f.authority.readEvents(f.binding(), caller, 0, 10))).toBe(true)
  const records = await fs.readdir(path.join(f.dir, 'state', 'bindings'))
  expect(records).toHaveLength(1)
  expect((await fs.readdir(path.join(f.dir, 'state', 'bindings', records[0]))).some(x => x.endsWith('.json'))).toBe(true)
})
it('does not share grants across windows or same-id copied files', async () => {
  const f = await setup()
  await f.authority.authorize(sender, req)
  expect(await f.authority.resolve({ ...sender, webContentsId: 2 }, f.binding())).toBeNull()
  await fs.copyFile(f.file, path.join(f.dir, 'copy.cunlian'))
  expect(await f.authority.resolve(sender, { ...f.binding(), path: path.join(f.dir, 'copy.cunlian') })).toBeNull()
  expect(await f.authority.resolve(sender, f.binding())).toBeNull()
})
it('revocation and switching invalidate old callers and in-flight confirmation', async () => {
  const f = await setup()
  await f.authority.authorize(sender, req)
  const old = await f.authority.resolve(sender, f.binding())
  await f.authority.revokeWindow(1)
  expect(await f.authority.resolve(sender, f.binding())).toBeNull()
  await expect(f.authority.readContext(f.binding(), old!)).rejects.toThrow('AUTH_REQUIRED')
  let finish!: (value: 'approve') => void
  f.confirm.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = f.authority.authorize(sender, req)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  f.switch()
  finish('approve')
  await expect(pending).rejects.toThrow('AUTH_REQUIRED')
})
it('restores installation identity but no grant, caller or peer authority after restart', async () => {
  const f = await setup()
  await f.authority.authorize(sender, req)
  const id = await f.authority.installationId()
  const restarted = new LocalM1Authority({ root: path.join(f.dir, 'state'), sessionFor: () => f.binding(), confirm: async () => 'cancel' })
  expect(await restarted.installationId()).toBe(id)
  expect(await restarted.resolve(sender, f.binding())).toBeNull()
  expect(await restarted.resolvePeer()).toBeNull()
})

// These tests exercise real service transactions behind simulated trusted IPC senders.
import type { IpcMainInvokeEvent } from 'electron'
import { SenderGuard } from '../main/senderGuard.ts'
import type { IpcMainLike } from '../main/ipc.ts'
import { installM1AuthorizationChannels } from '../main/project-agent/m1AuthorizationChannels.ts'
import { installM1ReadChannels } from '../main/project-agent/m1ReadChannels.ts'
import { IPC_CHANNELS } from '../shared/contracts.ts'
import { M1InternalService } from '../main/project-agent/m1InternalService.ts'
import { acceptEntryReply } from '../shared/project-agent/m1-entry-1933.ts'

async function wiring() {
  const f = await setup()
  let service!: M1InternalService
  const authority = new LocalM1Authority({ root: path.join(f.dir, 'wired'), sessionFor: () => f.binding(),
    confirm: f.confirm, serviceFactory: root => (service = new M1InternalService(root)) })
  const guard = new SenderGuard()
  const frame = { url: 'file:///desktop.html' }
  guard.register({ webContentsId: 1, isDestroyed: () => false, isAllowedFrameUrl: url => url === frame.url })
  const event = { sender: { id: 1, mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent
  const handlers = new Map<string, Parameters<IpcMainLike['handle']>[1]>()
  const ipc: IpcMainLike = { handle: (key, handler) => { handlers.set(key, handler) }, on: vi.fn() }
  installM1AuthorizationChannels(ipc, guard, authority)
  installM1ReadChannels(ipc, { guard, sessionFor: f.binding,
    resolveTrustedM1Caller: (sender, binding) => authority.resolve(sender, binding),
    readContext: (binding, caller) => authority.readContext(binding, caller),
    readEvents: (binding, caller, after, limit) => authority.readEvents(binding, caller, after, limit) })
  return { ...f, authority, guard, event, service: () => service,
    invoke: (channel: string, value: unknown, e = event) => handlers.get(channel)!(e, value) }
}

it('native consent IPC rejects untrusted and forged requests and returns no grant on cancel', async () => {
  const f = await wiring()
  expect(await f.invoke(IPC_CHANNELS.m1RequestAuthorization, { ...req, approved: true }))
    .toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
  expect(await f.invoke(IPC_CHANNELS.m1RequestAuthorization, { ...req, projectId: 'other' }))
    .toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  f.confirm.mockResolvedValueOnce('cancel')
  expect(await f.invoke(IPC_CHANNELS.m1RequestAuthorization, req))
    .toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  f.guard.unregister(1)
  expect(await f.invoke(IPC_CHANNELS.m1RequestAuthorization, req))
    .toMatchObject({ ok: false, error: { code: 'FORBIDDEN_SENDER' } })
})
it('consent IPC feeds real context and nonempty events through frozen reply validators', async () => {
  const f = await wiring()
  const result = await f.invoke(IPC_CHANNELS.m1RequestAuthorization, req)
  if (!result.ok) throw Error('missing grant')
  const scope = result.value as { projectId: string; authorizationRef: string; requestGeneration: number }
  const request = { ...scope, requestId: 'read' }
  const caller = { projectId: 'p', userId: 'trusted-test', callerId: 'seed', authorizationRef: 'seed', canWrite: true }
  // Test-only trusted writer; no production write IPC is installed.
  const credentials = await f.service().acquire('p', caller, { version: '0.1.0-m0', requestId: 'acq',
    projectId: 'p', authorizationRef: 'seed', expectedWriterEpoch: 0 })
  await f.service().createSpacer('p', caller, { ...credentials, idempotencyKey: 'seed' },
    { type: 'createSpacerDraft', innerDiameterQ: 100, outerDiameterQ: 200, lengthQ: 300 },
    { innerDiameterQ: { type: 'userInput' }, outerDiameterQ: { type: 'userInput' }, lengthQ: { type: 'userInput' } }, null)
  const context = await f.invoke(IPC_CHANNELS.m1GetProjectContext, request)
  expect(context.ok && acceptEntryReply('getContext', request, scope, context.value)).toBe(true)
  const read = { ...request, afterSequence: 0, limit: 100 }
  const page = await f.invoke(IPC_CHANNELS.m1ReadProjectEvents, read)
  expect(page.ok && acceptEntryReply('readProjectEvents', read, scope, page.value)).toBe(true)
  expect(page).toMatchObject({ ok: true, value: { ok: true, result: { events: expect.arrayContaining([
    expect.objectContaining({ candidate: 'm1-review-1853', type: 'taskChanged' }),
  ]) } } })
})
it.each(['revoke', 'switch'] as const)('rejects old generation and a real in-flight service read after %s', async action => {
  const f = await wiring()
  const grant = await f.invoke(IPC_CHANNELS.m1RequestAuthorization, req)
  if (!grant.ok) throw Error('missing grant')
  const request = { ...(grant.value as { projectId: string; authorizationRef: string; requestGeneration: number }), requestId: 'read' }
  const service = f.service()
  const original = service.context.bind(service)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let started = false
  vi.spyOn(service, 'context').mockImplementationOnce(async (...args) => {
    const cut = await original(...args)
    started = true
    await gate
    return cut
  })
  const pending = f.invoke(IPC_CHANNELS.m1GetProjectContext, request)
  await vi.waitFor(() => expect(started).toBe(true))
  if (action === 'revoke') await f.authority.revokeWindow(1)
  else f.switch()
  release()
  expect(await pending).toMatchObject({ ok: true, value: { ok: false, error: { code: 'AUTH_REQUIRED' } } })
  expect(await f.invoke(IPC_CHANNELS.m1GetProjectContext, request))
    .toMatchObject({ ok: true, value: { ok: false, error: { code: 'AUTH_REQUIRED' } } })
})
it('read consent cannot acquire writer credentials, and revoked generations cannot be promoted by a forged caller', async () => {
  const f = await wiring()
  await f.authority.authorize(sender, req)
  const caller = await f.authority.resolve(sender, f.binding())
  if (!caller) throw Error('missing caller')
  const raw = { version: '0.1.0-m0', requestId: 'r', projectId: 'p', authorizationRef: caller.authorizationRef, expectedWriterEpoch: 0 }
  await expect(f.service().acquire('p', caller, raw)).rejects.toThrow('AUTH_REQUIRED')
  await f.authority.revokeWindow(1)
  await expect(f.service().acquire('p', { ...caller, canWrite: true }, raw)).rejects.toThrow('AUTH_REQUIRED')
})
it('reconfirmation issues a fresh caller and generation while preserving same-file service history', async () => {
  const f = await wiring()
  const first = await f.authority.authorize(sender, req)
  const old = await f.authority.resolve(sender, f.binding())
  const next = await f.authority.authorize(sender, req)
  expect(next.authorizationRef).not.toBe(first.authorizationRef)
  expect((await f.authority.resolve(sender, f.binding()))?.callerId).not.toBe(old?.callerId)
  await expect(f.authority.readContext(f.binding(), old!)).rejects.toThrow('AUTH_REQUIRED')
})

it('confirmed copy bindings isolate actual draft and event history despite identical project ids', async () => {
  const f = await setup()
  let active = f.binding()
  let service!: M1InternalService
  const authority = new LocalM1Authority({ root: path.join(f.dir, 'copies'), sessionFor: () => active,
    confirm: async () => 'approve', serviceFactory: root => (service = new M1InternalService(root)) })
  await authority.authorize(sender, req)
  const seed = { projectId: 'p', userId: 'seed', callerId: 'seed', authorizationRef: 'seed', canWrite: true }
  await service.acquire('p', seed, { version: '0.1.0-m0', requestId: 'a', projectId: 'p', authorizationRef: 'seed', expectedWriterEpoch: 0 })
  const copy = path.join(f.dir, 'same-id-copy.cunlian')
  await fs.copyFile(f.file, copy)
  active = { ...active, path: copy, sessionId: 'copy' }
  expect(await authority.resolve(sender, active)).toBeNull()
  await authority.authorize(sender, req)
  const caller = await authority.resolve(sender, active)
  const cut = await authority.readContext(active, caller!)
  expect(cut.snapshot.cursor).toBe(0)
  expect(cut.snapshot.spacerDraft).toBeNull()
  expect(cut.activities).toEqual([])
})
it('restart requires fresh consent but recovers the same binding journal and rejects old writer tokens', async () => {
  const f = await setup()
  let service!: M1InternalService
  const options = { root: path.join(f.dir, 'restart'), sessionFor: () => f.binding(), confirm: async () => 'approve' as const,
    serviceFactory: (root: string) => (service = new M1InternalService(root)) }
  const authority = new LocalM1Authority(options)
  await authority.authorize(sender, req)
  const seed = { projectId: 'p', userId: 'seed', callerId: 'seed', authorizationRef: 'seed', canWrite: true }
  const credential = await service.acquire('p', seed, { version: '0.1.0-m0', requestId: 'a', projectId: 'p', authorizationRef: 'seed', expectedWriterEpoch: 0 })
  const restarted = new LocalM1Authority(options)
  expect(await restarted.resolve(sender, f.binding())).toBeNull()
  await restarted.authorize(sender, req)
  const caller = await restarted.resolve(sender, f.binding())
  expect((await restarted.readContext(f.binding(), caller!)).snapshot.cursor).toBe(1)
  await expect(service.createSpacer('p', seed, { ...credential, idempotencyKey: 'old' },
    { type: 'createSpacerDraft', innerDiameterQ: 100, outerDiameterQ: 200, lengthQ: 300 },
    { innerDiameterQ: { type: 'userInput' }, outerDiameterQ: { type: 'userInput' }, lengthQ: { type: 'userInput' } }, null)).rejects.toThrow('WRITER_REVOKED')
})
const preload = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: preload.expose }, ipcRenderer: preload }))
it('preload authorization uses only named fixed methods and preserves explicit failure results', async () => {
  await import('../preload/index.ts')
  const [, api] = preload.expose.mock.calls[0]
  expect(api).not.toHaveProperty('ipcRenderer')
  expect(api).not.toHaveProperty('invoke')
  expect(api).not.toHaveProperty('channel')
  const denied = { ok: false, error: { code: 'AUTH_REQUIRED', message: 'cancelled' } }
  preload.invoke.mockResolvedValue(denied)
  expect(await api.requestM1ProjectAuthorization(req)).toEqual(denied)
  expect(preload.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.m1RequestAuthorization, req)
  expect(await api.revokeM1ProjectAuthorization(req)).toEqual(denied)
  expect(preload.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.m1RevokeAuthorization, req)
  expect(api.getM1ReadCapabilities()).toMatchObject({ localIdentityAvailable: true, nativeReadConsentAvailable: true,
    productionApiConnected: false, subscriptionsAvailable: false, externalMcpAvailable: false, formalSaveEnabled: false })
})
it('opened but unconfirmed windows cannot use the registered read IPC channels', async () => {
  const f = await wiring()
  const request = { ...req, authorizationRef: 'guessed' }
  expect(await f.invoke(IPC_CHANNELS.m1GetProjectContext, request))
    .toMatchObject({ ok: true, value: { ok: false, error: { code: 'AUTH_REQUIRED' } } })
  expect(await f.invoke(IPC_CHANNELS.m1ReadProjectEvents, { ...request, afterSequence: 0, limit: 10 }))
    .toMatchObject({ ok: true, value: { ok: false, error: { code: 'AUTH_REQUIRED' } } })
  expect(f.confirm).not.toHaveBeenCalled()
})
