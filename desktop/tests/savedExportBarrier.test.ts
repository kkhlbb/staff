// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopSessionAdapter } from '../../src/workspace/desktopAdapter'
import { createRequirementProject } from '../../src/requirements/__fixtures__/requirementFixture'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
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
  const otherWindows = new Map<number, (payload: EditorFlushRequest) => void>()
  const guard = new CloseGuard({ timeoutMs: 100, sendFlush: (id, payload) => { if (id !== 1) { otherWindows.get(id)?.(payload); return }; onSend?.(payload); if (deliver) listener?.(payload) } })
  const controller: SessionController = new SessionController({ projectService: h.projectService, recovery: h.recovery, recent: h.recent,
    ports: { askChoice: async () => { throw Error('must not ask to save') }, pickSaveTarget: async () => { throw Error('must not auto save') },
      flushEditor: async id => { const outcome = await guard.requestSessionFlush(id, key => controller.sessionFor(key)); return outcome.ok ? { ok: true, value: null } : { ok: false, error: outcome.error! } },
      acquireExportLease: id => guard.acquireExportLease(id, key => controller.sessionFor(key)),
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
  return { h, session, controller, adapter, service, guard, files, writes, replies, exportPorts, api, ops, otherWindows, picks: () => picks,
    onSend: (fn: typeof onSend) => { onSend = fn }, disconnect: () => { deliver = false } }
}

it.each(['write', 'read'] as const)('S05 continuous boundary: real debounce edit during suspended temp %s cannot be accepted before successful rename', async phase => {
  const s = await setup()
  vi.useFakeTimers()
  let entered!: () => void
  let release!: () => void
  const ready = new Promise<void>(r => { entered = r })
  const resume = new Promise<void>(r => { release = r })
  const originalWrite = s.ops.writeExclusive
  const originalRead = s.ops.readFile
  s.ops.writeExclusive = async (file, bytes) => {
    await originalWrite(file, bytes)
    if (phase === 'write') { entered(); await resume }
  }
  s.ops.readFile = async file => {
    if (phase === 'read' && file.endsWith('.tmp')) { entered(); await resume }
    return originalRead(file)
  }
  const pending = s.service.run(1, 'export', { format: 'svg' })
  await ready
  const edited = { ...s.adapter.getState().snapshot!, project: { ...s.session.snapshot.project, name: 'during temporary IO' } }
  s.adapter.edit(edited)
  const acceptedInRenderer = s.adapter.getState().localSeq > 0
  expect(s.session.acceptedSeq).toBe(0) // real 250ms stage has NOT fired
  release()
  const result = await pending
  expect({ successfulExportOfOldVersionAfterAcceptedEdit: result.ok && acceptedInRenderer }).toEqual({ successfulExportOfOldVersionAfterAcceptedEdit: false })
  expect(s.adapter.getState().snapshot?.project.name).toBe('during temporary IO')
  expect(s.adapter.getState().dirty).toBe(true)
  if (!result.ok) expect(s.files.has('/exports/drawing.svg')).toBe(false)
  expect([...s.files.keys()].some(file => file.endsWith('.tmp'))).toBe(false)
})

it.each(['write-failed', 'read-failed', 'exception', 'closed', 'navigation', 'timeout', 'adapter-dispose'] as const)('continuous lease %s releases queued edits without autosave or target replacement', async mode => {
  const s = await setup()
  vi.useFakeTimers()
  const sourceBefore = await s.h.projectService.readProjectBytes(s.session.path!)
  let entered!: () => void
  let release!: () => void
  const ready = new Promise<void>(r => { entered = r })
  const resume = new Promise<void>(r => { release = r })
  const write = s.ops.writeExclusive
  const read = s.ops.readFile
  const stat = s.ops.statKind
  let held = false
  s.ops.writeExclusive = async (file, bytes) => {
    entered(); await resume
    if (mode === 'write-failed') throw Error('injected write failure')
    await write(file, bytes); held = true
  }
  s.ops.readFile = async file => { if (mode === 'read-failed' && file.endsWith('.tmp')) throw Error('injected read failure'); return read(file) }
  s.ops.statKind = async file => { if (mode === 'exception' && held) throw Error('injected unexpected exception'); return stat(file) }
  const pending = s.service.run(1, 'export', { format: 'svg' }).then(value => ({ value }), error => ({ error }))
  await ready
  expect(s.adapter.getState().exportEditNotice).toContain('新编辑将短暂排队')
  const snapshot = s.adapter.getState().snapshot!
  s.adapter.edit({ ...snapshot, project: { ...snapshot.project, name: 'first queued' } })
  s.adapter.edit({ ...snapshot, project: { ...snapshot.project, name: 'second queued' } })
  expect(s.adapter.getState()).toMatchObject({ localSeq: 0, dirty: false, snapshot })
  expect(s.adapter.getState().exportEditNotice).toContain('2 次编辑已排队')
  await expect(s.adapter.saveProject()).rejects.toThrow('此操作尚未执行')
  await expect(s.adapter.openProject()).rejects.toThrow('此操作尚未执行')
  await expect(s.adapter.stageChange({} as Parameters<DesktopSessionAdapter['stageChange']>[0])).rejects.toThrow('此操作尚未执行')
  if (mode === 'closed' || mode === 'navigation') s.guard.cancelWindow(1)
  if (mode === 'adapter-dispose') s.adapter.dispose()
  if (mode === 'timeout') await vi.advanceTimersByTimeAsync(30_001)
  release()
  const outcome = await pending
  if ('value' in outcome) expect(outcome.value).toMatchObject({ ok: false })
  else expect(mode).toBe('exception')
  expect(s.files.size).toBe(0)
  expect(s.adapter.getState()).toMatchObject({ dirty: true, localSeq: 2, exportEditNotice: undefined })
  expect(s.adapter.getState().snapshot?.project.name).toBe('second queued')
  expect(await s.h.projectService.readProjectBytes(s.session.path!)).toEqual(sourceBefore)
  // Release does not stage or save automatically; accepted/saved remain clean until debounce/explicit flush.
  expect(s.session.acceptedSeq).toBe(0)
  expect(s.session.savedSeq).toBe(0)
  if (mode !== 'adapter-dispose') {
    expect((await s.adapter.saveProject()).ok).toBe(true)
    s.ops.statKind = stat
    s.ops.readFile = read
    s.ops.writeExclusive = write
    expect(await s.service.run(1, 'export', { format: 'svg' })).toMatchObject({ ok: true })
  }
})

it('lease nonce/session isolation: late release or failure receipt cannot unlock a newer lease', async () => {
  const s = await setup()
  vi.useFakeTimers()
  const first = await s.controller.acquireExportLease(1)
  expect(first.ok).toBe(true)
  if (!first.ok) throw Error('lease required')
  first.value.release()
  const second = await s.controller.acquireExportLease(1)
  if (!second.ok) throw Error('second lease required')
  const oldRelease = { requestId: first.value.requestId, exportLease: { action: 'release' as const, sessionId: s.session.sessionId, durationMs: 30_000 } }
  await s.adapter.handleEditorFlush(oldRelease)
  await s.adapter.handleEditorFlush({ ...oldRelease, requestId: second.value.requestId, exportLease: { ...oldRelease.exportLease, sessionId: 'old-session' } })
  s.guard.acceptFlushed(1, { requestId: first.value.requestId, failed: true })
  s.guard.acceptFlushed(2, { requestId: second.value.requestId, failed: true })
  s.guard.cancelWindow(2)
  first.value.release()
  expect(second.value.valid()).toBe(true)
  s.adapter.edit(s.adapter.getState().snapshot!)
  expect(s.adapter.getState().localSeq).toBe(0)
  expect(await s.controller.acquireExportLease(1)).toMatchObject({ ok: false })
  // A second binding to the SAME session is refused, rather than trusting just one renderer.
  await s.controller.attach(2, s.session.sessionId)
  expect(second.value.valid()).toBe(false)
  expect(await s.controller.acquireExportLease(2)).toMatchObject({ ok: false })
  second.value.release()
  expect(s.adapter.getState().localSeq).toBe(1)
  expect(vi.getTimerCount()).toBe(1) // only the real adapter debounce remains
})

it('two real adapters and one main guard keep separate windows/sessions isolated', async () => {
  const s = await setup()
  const opened = await s.h.projectService.openFile(s.session.path!)
  if (!opened.ok) throw Error('second project required')
  await s.controller.attach(2, opened.value.sessionId)
  const secondSession = s.controller.sessionFor(2)!
  const api: CunlianApi = { ...s.api,
    onEditorFlush: fn => { s.otherWindows.set(2, fn); return () => { s.otherWindows.delete(2) } },
    respondEditorFlush: payload => { s.guard.acceptFlushed(2, payload) },
    reattachSession: async () => ({ ok: true, value: { ...opened.value, savedSeq: 0, recovery: 'none' } }),
    stageDraft: async input => {
      const result = await s.h.projectService.stageFromDto(input.sessionId, input.editSeq, input.snapshot as Omit<ProjectFileSnapshot, 'attachments'>)
      return result.ok ? { ok: true, value: { ...result.value, recovery: 'pending' } } : result
    },
  }
  const adapter = new DesktopSessionAdapter({ api })
  adapter.bind(); await adapter.reattachSession()
  cleanup.unshift(async () => { adapter.dispose() })
  vi.useFakeTimers()
  const one = await s.controller.acquireExportLease(1)
  const two = await s.controller.acquireExportLease(2)
  if (!one.ok || !two.ok) throw Error('two independent leases required')
  s.adapter.edit(s.adapter.getState().snapshot!)
  adapter.edit(adapter.getState().snapshot!)
  s.guard.cancelWindow(1)
  expect(one.value.valid()).toBe(false)
  expect(two.value.valid()).toBe(true)
  expect(s.adapter.getState().localSeq).toBe(1)
  expect(adapter.getState().localSeq).toBe(0)
  expect(secondSession.acceptedSeq).toBe(0)
  s.guard.acceptFlushed(1, { requestId: two.value.requestId, failed: true })
  expect(two.value.valid()).toBe(true)
  two.value.release()
  expect(adapter.getState()).toMatchObject({ localSeq: 1, dirty: true })
  expect((await adapter.flushStage()).ok).toBe(true)
  expect(secondSession.acceptedSeq).toBe(1)
  expect(secondSession.savedSeq).toBe(0)
  expect(s.session.acceptedSeq).toBe(0)
})

it('a legacy ordinary flush acknowledgement cannot acquire an export lease', async () => {
  const s = await setup()
  s.disconnect()
  s.onSend(payload => {
    if (payload.exportLease?.action === 'acquire') s.guard.acceptFlushed(1, { requestId: payload.requestId, sessionId: s.session.sessionId, editSeq: 0 })
  })
  expect(await s.controller.acquireExportLease(1)).toMatchObject({ ok: false })
})

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
  s.onSend(payload => { if (payload.exportLease?.action !== 'release' && ++sent === 2) throw Error('renderer lost during dialog') })
  expect(await s.service.exportApprovedVersion(1, 'svg')).toMatchObject({ ok: false, code: 'CANCELLED' })
  expect(sent).toBe(2)
  expect(s.writes).toEqual([])
})
