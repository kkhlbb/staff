// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopSessionAdapter } from '../../src/workspace/desktopAdapter'
import { createRequirementProject } from '../../src/requirements/__fixtures__/requirementFixture'
import { AgentToolService } from '../main/agentToolService'
import { SessionController } from '../main/sessionController'
import { CloseGuard } from '../main/closeGuard'
import { DrawingExportStore } from '../main/drawingExportStore'
import type { FileOps } from '../main/fileStore'
import { IPC_CHANNELS, type CunlianApi, type EditorFlushRequest, type EditorFlushedPayload } from '../shared/contracts'
import { createHarness } from './helpers/a04'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { vi.useRealTimers(); for (const dispose of cleanup.splice(0)) await dispose() })
async function setup() {
  const h = await createHarness({ debounceMs: 60_000 })
  const { snapshot } = await createRequirementProject()
  const opened = await h.openSample(snapshot)
  const session = h.projectService.getSession(opened.sessionId)!
  let listener: ((payload: EditorFlushRequest) => void) | undefined
  let deliver = true
  let onSend: ((payload: EditorFlushRequest) => void) | undefined
  const replies: EditorFlushedPayload[] = []
  const guard = new CloseGuard({ timeoutMs: 100, sendFlush: (_id, payload) => { onSend?.(payload); if (deliver) listener?.(payload) } })
  const controller = new SessionController({ projectService: h.projectService, recovery: h.recovery, recent: h.recent,
    ports: { askChoice: async () => { throw Error('must not ask to save') }, pickSaveTarget: async () => { throw Error('must not auto save') },
      flushEditor: async id => { const outcome = await guard.requestSessionFlush(id, key => controller.sessionFor(key)); return outcome.ok ? { ok: true, value: null } : { ok: false, error: outcome.error! } },
    } })
  await controller.attach(1, session.sessionId)
  const api = {
    onMenuAction: () => () => {},
    onEditorFlush: (fn: typeof listener) => { listener = fn; return () => { listener = undefined } },
    respondEditorFlush: (payload: EditorFlushedPayload) => { replies.push(payload); guard.acceptFlushed(1, payload) },
    reattachSession: () => h.invoke(IPC_CHANNELS.sessionReattach, {}),
    stageDraft: (input: unknown) => h.invoke(IPC_CHANNELS.projectStage, input),
    saveProject: (input: unknown) => h.invoke(IPC_CHANNELS.projectSave, input),
  } as unknown as CunlianApi
  const adapter = new DesktopSessionAdapter({ api }) // actual default 250ms debounce
  adapter.bind()
  await adapter.reattachSession()
  const files = new Map<string, Uint8Array>()
  const writes: string[] = []
  const ops: FileOps = {
    statKind: async file => file === '/exports' ? 'directory' : files.has(file) ? 'file' : 'missing',
    readFile: async file => { const bytes = files.get(file); if (!bytes) throw Error('missing'); return bytes.slice() },
    writeExclusive: async (file, bytes) => { if (files.has(file)) throw Error('exists'); writes.push(file); files.set(file, bytes.slice()) },
    rename: async (from, to) => { files.set(to, files.get(from)!); files.delete(from) },
    remove: async file => { files.delete(file) }, syncDirectory: async () => {},
  }
  let picks = 0
  const exportPorts = { store: new DrawingExportStore({ ops }), pickTarget: async () => { picks++; return '/exports/drawing.svg' } }
  const service = new AgentToolService({ controller, projectService: h.projectService, recovery: h.recovery, rootDir: h.workspace, exportPorts })
  cleanup.push(async () => { adapter.dispose(); guard.dispose(); await h.dispose() })
  return { h, session, controller, adapter, service, guard, files, writes, replies, exportPorts, api, picks: () => picks,
    onSend: (fn: typeof onSend) => { onSend = fn }, disconnect: () => { deliver = false } }
}

it('S05 real adapter debounce window → model service export refuses without any target writes; explicit save restores export', async () => {
  const s = await setup()
  vi.useFakeTimers()
  s.adapter.edit({ ...s.adapter.getState().snapshot!, project: { ...s.session.snapshot.project, name: 'renderer pending' } })
  expect(s.adapter.getState()).toMatchObject({ dirty: true, localSeq: 1, acceptedSeq: 0 })
  expect(s.h.controller.isDirty(s.session)).toBe(false)
  const result = await s.service.run(1, 'export', { format: 'svg' })
  expect(result).toMatchObject({ ok: false, code: 'SAVE_FAILED', message: expect.stringContaining('先保存') })
  expect(s.picks()).toBe(0)
  expect(s.writes).toEqual([])
  expect(s.files.size).toBe(0)
  expect(s.session.savedSeq).toBe(0)
  expect(s.session.acceptedSeq).toBe(1)
  expect((await s.adapter.saveProject()).ok).toBe(true)
  expect(await s.service.run(1, 'export', { format: 'svg' })).toMatchObject({ ok: true, data: { status: 'EXPORTED' } })
  expect(new TextDecoder().decode(s.files.get('/exports/drawing.svg'))).toContain('<svg')
  vi.useRealTimers()
})

it.each(['timeout', 'cancel', 'disconnected', 'stale-session', 'stale-seq', 'missing-identity', 'stage-failed'] as const)('barrier %s refuses model export with zero writes and clears pending request', async mode => {
  const s = await setup()
  vi.useFakeTimers()
  let requestId = ''
  s.disconnect()
  s.onSend(payload => {
    requestId = payload.requestId
    if (mode === 'disconnected') throw Error('renderer gone')
    if (mode === 'cancel') s.guard.cancelWindow(1)
    if (mode === 'stale-session') s.guard.acceptFlushed(1, { requestId, sessionId: 'old', editSeq: 0 })
    if (mode === 'stale-seq') s.guard.acceptFlushed(1, { requestId, sessionId: s.session.sessionId, editSeq: 7 })
    if (mode === 'missing-identity') s.guard.acceptFlushed(1, { requestId })
    if (mode === 'stage-failed') s.guard.acceptFlushed(1, { requestId, failed: true })
  })
  const pending = s.service.run(1, 'export', { format: 'svg' })
  await vi.advanceTimersByTimeAsync(101)
  expect(await pending).toMatchObject({ ok: false, message: expect.stringContaining('先保存') })
  expect(s.writes).toEqual([])
  expect(s.picks()).toBe(0)
  expect(s.guard.acceptFlushed(1, { requestId })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
})

it('isolated renderer without a bound flush listener is refused, not silently skipped', async () => {
  const s = await setup()
  s.adapter.dispose()
  vi.useFakeTimers()
  const pending = s.service.exportApprovedVersion(1, 'svg')
  await vi.advanceTimersByTimeAsync(101)
  expect(await pending).toMatchObject({ ok: false, message: expect.stringContaining('EDITOR_TIMEOUT') })
  expect(s.writes).toEqual([])
  vi.useRealTimers()
})

it('real adapter stage rejection cannot acknowledge the old clean sequence', async () => {
  const s = await setup()
  vi.useFakeTimers()
  s.api.stageDraft = async () => ({ ok: false, error: { code: 'WRITE_FAILED', message: 'injected' } })
  s.adapter.edit(s.adapter.getState().snapshot!)
  expect(await s.service.run(1, 'export', { format: 'svg' })).toMatchObject({ ok: false, message: expect.stringContaining('先保存') })
  expect(s.replies).toContainEqual({ requestId: expect.any(String), failed: true })
  expect(s.session.acceptedSeq).toBe(0)
  expect(s.writes).toEqual([])
  vi.useRealTimers()
})

it('new renderer edit during target dialog is flushed before final transaction, with zero writes', async () => {
  const s = await setup()
  vi.useFakeTimers()
  s.exportPorts.pickTarget = async () => {
    s.adapter.edit(s.adapter.getState().snapshot!)
    return '/exports/drawing.svg'
  }
  expect(await s.service.run(1, 'export', { format: 'svg' })).toMatchObject({ ok: false, code: 'CANCELLED' })
  expect(s.session.acceptedSeq).toBe(1)
  expect(s.session.savedSeq).toBe(0)
  expect(s.writes).toEqual([])
  vi.useRealTimers()
})

it('other window and late request cannot release a session barrier; switched binding fails closed', async () => {
  const s = await setup()
  let first = ''
  s.disconnect()
  s.onSend(payload => {
    first = payload.requestId
    expect(s.guard.acceptFlushed(2, { requestId: first, sessionId: s.session.sessionId, editSeq: 0 })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN_SENDER' } })
    s.guard.cancelWindow(2)
    s.guard.cancelWindow(1)
  })
  expect(await s.service.run(1, 'export', { format: 'svg' })).toMatchObject({ ok: false })
  expect(s.guard.acceptFlushed(1, { requestId: first })).toMatchObject({ ok: false })
  const old = s.session
  let current: typeof old | null = old
  s.onSend(payload => {
    current = { ...old }
    s.guard.acceptFlushed(1, { requestId: payload.requestId, sessionId: old.sessionId, editSeq: 0 })
  })
  expect(await s.guard.requestSessionFlush(1, () => current)).toMatchObject({ ok: false })
  expect(s.writes).toEqual([])
})

it('model arguments cannot inject flush reply or bypass renderer barrier', async () => {
  const s = await setup()
  s.disconnect()
  vi.useFakeTimers()
  const pending = s.service.run(1, 'export', { format: 'svg', requestId: 'model', sessionId: s.session.sessionId, editSeq: 0, dirty: false })
  await vi.advanceTimersByTimeAsync(101)
  expect(await pending).toMatchObject({ ok: false, message: expect.stringContaining('EDITOR_TIMEOUT') })
  expect(s.writes).toEqual([])
  vi.useRealTimers()
})

it('missing trusted renderer port is an explicit refusal', async () => {
  const s = await setup()
  const controller = new SessionController({ projectService: s.h.projectService, recovery: s.h.recovery, recent: s.h.recent,
    ports: { askChoice: async () => 'cancel', pickSaveTarget: async () => null, flushEditor: undefined as unknown as () => never } })
  await controller.attach(1, s.session.sessionId)
  const service = new AgentToolService({ controller, projectService: s.h.projectService, recovery: s.h.recovery, rootDir: s.h.workspace, exportPorts: s.exportPorts })
  expect(await service.run(1, 'export', { format: 'svg' })).toMatchObject({ ok: false, message: expect.stringContaining('先保存') })
  expect(s.picks()).toBe(0)
  expect(s.writes).toEqual([])
})

it('disposed adapter during in-flight stage replies failed, never clean', async () => {
  const s = await setup()
  vi.useFakeTimers()
  let release!: () => void
  const resume = new Promise<void>(r => { release = r })
  const original = s.api.stageDraft
  s.api.stageDraft = async input => { await resume; return original(input) }
  s.adapter.edit(s.adapter.getState().snapshot!)
  const pending = s.service.run(1, 'export', { format: 'svg' })
  await vi.advanceTimersByTimeAsync(0)
  s.adapter.dispose()
  release()
  expect(await pending).toMatchObject({ ok: false })
  expect(s.replies).toContainEqual({ requestId: expect.any(String), failed: true })
  expect(s.writes).toEqual([])
  vi.useRealTimers()
})

it('final pre-transaction barrier failure refuses before temporary write', async () => {
  const s = await setup()
  let sent = 0
  s.onSend(() => { if (++sent === 2) throw Error('renderer lost during dialog') })
  expect(await s.service.exportApprovedVersion(1, 'svg')).toMatchObject({ ok: false, code: 'CANCELLED' })
  expect(sent).toBe(2)
  expect(s.writes).toEqual([])
})
