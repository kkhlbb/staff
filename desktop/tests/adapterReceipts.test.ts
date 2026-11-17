// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopSessionAdapter } from '../../src/workspace/desktopAdapter'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import { toSnapshotDto } from '../../src/project-file/codec'
import type { CunlianApi, ProjectOpenValue, ProjectSaveValue, IpcResult } from '../shared/contracts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
const adapters: DesktopSessionAdapter[] = []
afterEach(() => { for (const a of adapters.splice(0)) a.dispose(); vi.useRealTimers() })
async function setup() {
  const snapshot = toSnapshotDto(await createSampleSnapshot())
  const open: ProjectOpenValue = { sessionId: 'one', editSeq: 0, snapshot, path: '/one.cunlian', fingerprint: 'a'.repeat(64), warnings: [] }
  const receipt = { ok: true as const, value: { ...open, editSeq: 0 as number, savedSeq: 0 as number, recovery: 'none' as const } }
  const api = {
    reattachSession: vi.fn(async () => receipt),
    openProject: vi.fn(async () => ({ ok: true as const, value: open })),
    stageDraft: vi.fn(async (r: { editSeq: number }) => ({ ok: true as const, value: { acceptedSeq: r.editSeq, recovery: 'pending' as const } })),
    saveProject: vi.fn(async () => ({ ok: true as const, value: { path: '/saved.cunlian', fingerprint: 'b'.repeat(64), savedSeq: 0, warnings: [] } })),
    onMenuAction: () => () => {}, onEditorFlush: () => () => {}, respondEditorFlush: vi.fn(),
  }
  const a = new DesktopSessionAdapter({ api: api as unknown as CunlianApi })
  adapters.push(a); a.bind(); await a.reattachSession()
  const edit = () => a.edit({ ...a.getEditingSnapshot()!, project: { ...a.getEditingSnapshot()!.project, name: 'QUEUED_EDIT' } })
  return { a, api, open, receipt, edit }
}

it.each(['release', 'timeout'] as const)('old real adapter reattach after %s cannot erase replay before 250ms stage', async mode => {
  const { a, api, receipt, edit } = await setup()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const d = deferred<typeof receipt>(); api.reattachSession.mockReturnValueOnce(d.promise)
  const pending = a.reattachSession()
  await a.handleEditorFlush({ requestId: 'lease', exportLease: { action: 'acquire', sessionId: 'one', durationMs: 100 } })
  edit()
  if (mode === 'release') await a.handleEditorFlush({ requestId: 'lease', exportLease: { action: 'release', sessionId: 'one', durationMs: 100 } })
  else await vi.advanceTimersByTimeAsync(101)
  expect(a.getState()).toMatchObject({ localSeq: 1, acceptedSeq: 0, dirty: true })
  expect(api.stageDraft).not.toHaveBeenCalled()
  d.resolve(receipt); await pending
  expect(a.getState()).toMatchObject({ localSeq: 1, acceptedSeq: 0, dirty: true, snapshot: { project: { name: 'QUEUED_EDIT' } } })
  await a.flushStage()
  expect(api.stageDraft.mock.calls[0][0]).toMatchObject({ editSeq: 1, snapshot: { project: { name: 'QUEUED_EDIT' } } })
})

it.each(['same', 'cross'] as const)('latest reset request wins out of order %s session', async mode => {
  const { a, api, receipt } = await setup()
  const d = deferred<typeof receipt>(); api.reattachSession.mockReturnValueOnce(d.promise)
  const old = a.reattachSession()
  const newer = { ...receipt, value: { ...receipt.value, sessionId: mode === 'same' ? 'one' : 'two', snapshot: { ...receipt.value.snapshot, project: { ...receipt.value.snapshot.project, name: 'NEW' } } } }
  api.reattachSession.mockResolvedValueOnce(newer); await a.reattachSession()
  d.resolve(receipt); await old
  expect(a.getState().snapshot?.project.name).toBe('NEW')
})

it('dispose/rebind invalidates old response without invalidating a new request', async () => {
  const { a, api, receipt } = await setup()
  const d = deferred<typeof receipt>(); api.reattachSession.mockReturnValueOnce(d.promise)
  const old = a.reattachSession(); a.dispose(); a.bind()
  const current = a.getState(); d.resolve(receipt); await old
  expect(a.getState()).toBe(current)
  expect((await a.reattachSession()).ok).toBe(true)
})

it('authoritative mutation invalidates old reattach but accepts a genuinely new aggregate', async () => {
  const { a, api, receipt } = await setup()
  const d = deferred<typeof receipt>(); api.reattachSession.mockReturnValueOnce(d.promise)
  const old = a.reattachSession()
  const snapshot = { ...receipt.value.snapshot, project: { ...receipt.value.snapshot.project, name: 'COMMITTED' } }
  await a.applyModelMutation({ acceptedSeq: 1, snapshot, recovery: 'pending' })
  d.resolve(receipt); await old
  expect(a.getState()).toMatchObject({ localSeq: 1, acceptedSeq: 1, recovery: 'pending', snapshot })
  api.reattachSession.mockResolvedValueOnce({ ...receipt, value: { ...receipt.value, snapshot, editSeq: 2, savedSeq: 2 } })
  expect((await a.reattachSession()).ok).toBe(true)
  expect(a.getState()).toMatchObject({ localSeq: 2, savedSeq: 2, dirty: false })
})

it('explicit open new session is legal, but edit during pending open is retained with error', async () => {
  const { a, api, open, edit } = await setup()
  const next = { ...open, sessionId: 'two', path: '/two.cunlian' }
  api.openProject.mockResolvedValueOnce({ ok: true, value: next })
  expect((await a.openProject()).ok).toBe(true); expect(a.getState().sessionId).toBe('two')
  const d = deferred<IpcResult<ProjectOpenValue>>()
  api.openProject.mockReturnValueOnce(d.promise as ReturnType<typeof api.openProject>)
  const pending = a.openProject(); edit(); d.resolve({ ok: true, value: open })
  expect((await pending).ok).toBe(false)
  expect(a.getState()).toMatchObject({ sessionId: 'two', dirty: true, snapshot: { project: { name: 'QUEUED_EDIT' } } })
})

it('open permits its own dirty-gate stage, while passive reattach protects pending edits', async () => {
  const { a, api, open, receipt, edit } = await setup()
  edit()
  expect((await a.reattachSession()).ok).toBe(false)
  expect(a.getState().snapshot?.project.name).toBe('QUEUED_EDIT')
  const d = deferred<IpcResult<ProjectOpenValue>>()
  api.openProject.mockReturnValueOnce(d.promise as ReturnType<typeof api.openProject>)
  const opening = a.openProject()
  await a.flushStage() // real dirty-gate flush belongs to the open intent, not an intervening edit
  d.resolve({ ok: true, value: { ...open, sessionId: 'two' } })
  expect((await opening).ok).toBe(true)
  expect(a.getState()).toMatchObject({ sessionId: 'two', dirty: false, localSeq: 0 })
  api.reattachSession.mockResolvedValueOnce({ ...receipt, value: { ...receipt.value, sessionId: 'two', editSeq: 9, savedSeq: 9 } })
  expect((await a.reattachSession()).ok).toBe(true) // authorized main aggregate need not equal old renderer seq
  expect(a.getState().savedSeq).toBe(9)
})

it.each(['same', 'cross', 'dispose'] as const)('late stage and waiting save do not mutate a replaced %s identity', async mode => {
  const { a, api, open, edit } = await setup()
  edit()
  const d = deferred<Awaited<ReturnType<typeof api.stageDraft>>>()
  api.stageDraft.mockReturnValueOnce(d.promise)
  const saving = a.saveProject()
  if (mode === 'dispose') { a.dispose(); a.bind() }
  else {
    api.openProject.mockResolvedValueOnce({ ok: true, value: { ...open, sessionId: mode === 'same' ? 'one' : 'two' } })
    await a.openProject()
  }
  const state = a.getState()
  d.resolve({ ok: true, value: { acceptedSeq: 1, recovery: 'pending' } })
  expect((await saving).ok).toBe(false)
  expect(a.getState()).toBe(state)
  expect(api.saveProject).not.toHaveBeenCalled()
})

it('authorized newer aggregate from an already pending mutation survives a preceding save receipt', async () => {
  const { a, api, open } = await setup()
  const save = deferred<IpcResult<ProjectSaveValue>>()
  api.saveProject.mockReturnValueOnce(save.promise as ReturnType<typeof api.saveProject>)
  const saving = a.saveProject(); await Promise.resolve()
  const mutation = deferred<Awaited<ReturnType<DesktopSessionAdapter['applyChange']>>>()
  ;(api as unknown as CunlianApi).applyChange = vi.fn(() => mutation.promise)
  const applying = a.applyChange({} as Parameters<DesktopSessionAdapter['applyChange']>[0])
  save.resolve({ ok: true, value: { path: '/saved.cunlian', fingerprint: 'b'.repeat(64), savedSeq: 0, warnings: [] } }); await saving
  const value = { snapshot: { ...open.snapshot, project: { ...open.snapshot.project, name: 'NEW AGGREGATE' } }, acceptedSeq: 1, savedSeq: 1, path: '/saved.cunlian', fingerprint: 'c'.repeat(64), warnings: [] }
  mutation.resolve({ ok: true, value } as Awaited<ReturnType<DesktopSessionAdapter['applyChange']>>)
  expect((await applying).ok).toBe(true)
  expect(a.getState()).toMatchObject({ snapshot: value.snapshot, acceptedSeq: 1, savedSeq: 1, fingerprint: value.fingerprint, dirty: false })
})

it('explicit main-authorized open survives a preceding authoritative model receipt', async () => {
  const { a, api, open } = await setup()
  const d = deferred<IpcResult<ProjectOpenValue>>()
  api.openProject.mockReturnValueOnce(d.promise as ReturnType<typeof api.openProject>)
  const pending = a.openProject()
  await a.applyModelMutation({ snapshot: open.snapshot, acceptedSeq: 1, recovery: 'pending' })
  d.resolve({ ok: true, value: { ...open, sessionId: 'two' } })
  expect((await pending).ok).toBe(true)
  expect(a.getState()).toMatchObject({ sessionId: 'two', localSeq: 0, dirty: false })
})

it('save receipt preserves edits made after dispatch and cannot contaminate another session', async () => {
  const { a, api, open, edit } = await setup()
  const d = deferred<IpcResult<ProjectSaveValue>>()
  api.saveProject.mockReturnValueOnce(d.promise as ReturnType<typeof api.saveProject>)
  const pending = a.saveProject(); await Promise.resolve(); edit()
  d.resolve({ ok: true, value: { path: '/saved.cunlian', fingerprint: 'b'.repeat(64), savedSeq: 0, warnings: [] } }); await pending
  expect(a.getState()).toMatchObject({ dirty: true, localSeq: 1, savedSeq: 0 })
  await a.flushStage()
  const d2 = deferred<IpcResult<ProjectSaveValue>>()
  api.saveProject.mockReturnValueOnce(d2.promise as ReturnType<typeof api.saveProject>)
  const old = a.saveProject(); await Promise.resolve()
  api.openProject.mockResolvedValueOnce({ ok: true, value: { ...open, sessionId: 'two', path: '/two.cunlian' } }); await a.openProject()
  d2.resolve({ ok: true, value: { path: '/OLD.cunlian', fingerprint: 'c'.repeat(64), savedSeq: 1, warnings: [] } }); await old
  expect(a.getState()).toMatchObject({ sessionId: 'two', path: '/two.cunlian', savedSeq: 0 })
})
