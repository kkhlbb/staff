// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useDesktopSession } from './useDesktopSession'
import { DesktopSessionAdapter } from './desktopAdapter'
import { createSampleSnapshot } from '../project-file/__fixtures__/sampleProjectFile'
import { toSnapshotDto } from '../project-file/codec'
import { resolveDraft } from './draftSync'
import { workspaceReducer, type WorkspaceAction } from './draft'
import type { CunlianApi, EditorFlushRequest } from '../../desktop/shared/contracts'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

async function setup() {
  const snapshot = toSnapshotDto(await createSampleSnapshot())
  let listener!: (request: EditorFlushRequest) => void
  const api = {
    reattachSession: vi.fn(async () => ({ ok: true, value: { sessionId: 'one', editSeq: 0, savedSeq: 0, snapshot, path: '/project.cunlian', fingerprint: 'a'.repeat(64), recovery: 'none' } })),
    listRecent: vi.fn(async () => ({ ok: true, value: { items: [] } })),
    listRecovery: vi.fn(async () => ({ ok: true, value: { items: [] } })),
    onMenuAction: () => () => {},
    onEditorFlush: (fn: typeof listener) => { listener = fn; return () => {} },
    respondEditorFlush: vi.fn(),
    stageDraft: vi.fn(async (request: { editSeq: number }) => ({ ok: true, value: { acceptedSeq: request.editSeq, recovery: 'pending' } })),
    saveProject: vi.fn(),
  }
  const spy = vi.spyOn(DesktopSessionAdapter.prototype, 'reattachSession')
  vi.stubGlobal('cunlian', api as unknown as CunlianApi)
  const hook = renderHook(() => useDesktopSession())
  await act(async () => {})
  const adapter = spy.mock.contexts[0] as DesktopSessionAdapter
  const lease = { requestId: 'nonce', exportLease: { action: 'acquire' as const, sessionId: 'one', durationMs: 30_000 } }
  await act(async () => { listener(lease) })
  return { ...hook, adapter, api, snapshot, release: async () => { await act(async () => { listener({ ...lease, exportLease: { ...lease.exportLease, action: 'release' } }) }) } }
}

const modes = ['normal', 'timeout', 'failed-flush'] as const
it.each(modes)('real hook independent assumptions + target accumulate across %s release', async mode => {
  vi.useFakeTimers()
  const s = await setup()
  const initial = resolveDraft(s.snapshot)
  const actions: WorkspaceAction[] = [
    { type: 'setAssumptions', assumptions: 'FIRST EDIT MUST SURVIVE' },
    { type: 'setTarget', targetMin: '1', targetMax: '2' },
  ]
  await act(async () => { for (const action of actions) s.result.current.edit(action) })
  expect(s.adapter.getState()).toMatchObject({ localSeq: 0, acceptedSeq: 0, savedSeq: 0, dirty: false, snapshot: s.snapshot })
  expect(s.api.stageDraft).not.toHaveBeenCalled()
  if (mode === 'failed-flush') {
    // Same release protocol used by main finally after an export failure.
    await act(async () => { await s.adapter.handleEditorFlush({ requestId: 'ordinary-during-lease' }) })
    expect(s.api.respondEditorFlush).toHaveBeenLastCalledWith({ requestId: 'ordinary-during-lease', failed: true })
  }
  if (mode === 'timeout') await act(async () => { await vi.advanceTimersByTimeAsync(30_001) })
  else await s.release()
  const expected = actions.reduce(workspaceReducer, { ...initial.draft, basisRelationRevision: initial.basis })
  expect(s.adapter.getState().snapshot?.draft).toEqual(expected)
  expect(s.adapter.getState()).toMatchObject({ localSeq: 2, acceptedSeq: 0, savedSeq: 0, dirty: true, exportEditNotice: undefined })
  expect(s.api.stageDraft).not.toHaveBeenCalled()
  expect(s.api.saveProject).not.toHaveBeenCalled()
  await s.release() // duplicate release must not stage or count again
  await act(async () => { await s.adapter.flushStage() })
  expect(s.api.stageDraft).toHaveBeenCalledTimes(1)
  expect(s.api.stageDraft.mock.calls[0][0]).toMatchObject({ editSeq: 2, snapshot: { draft: expected } })
  expect(s.adapter.getState()).toMatchObject({ localSeq: 2, acceptedSeq: 2, savedSeq: 0, dirty: true })
})

it('real hook edits to two independent terms retain values, revisions and invalid raw text', async () => {
  const s = await setup()
  const initial = resolveDraft(s.snapshot)
  expect(initial.draft.terms.length).toBeGreaterThanOrEqual(2)
  const actions: WorkspaceAction[] = [
    { type: 'updateField', termId: initial.draft.terms[0].id, field: 'nominal', value: 'invalid raw first edit' },
    { type: 'updateField', termId: initial.draft.terms[1].id, field: 'lower', value: '-0.0123' },
  ]
  await act(async () => { for (const action of actions) s.result.current.edit(action) })
  await s.release()
  expect(s.adapter.getState().snapshot?.draft).toEqual(actions.reduce(workspaceReducer, { ...initial.draft, basisRelationRevision: initial.basis }))
})

it('project snapshot edit followed by two real hook draft edits retains the complete project and draft', async () => {
  const s = await setup()
  const renamed = { ...s.snapshot, project: { ...s.snapshot.project, name: 'INDEPENDENT PROJECT EDIT' } }
  await act(async () => { s.adapter.edit(renamed) })
  await act(async () => { s.result.current.edit({ type: 'setAssumptions', assumptions: 'FIRST EDIT MUST SURVIVE' }) })
  await act(async () => { s.result.current.edit({ type: 'setTarget', targetMin: '1', targetMax: '2' }) })
  await s.release()
  expect(s.adapter.getState().snapshot?.project).toEqual(renamed.project)
  expect(s.adapter.getState().snapshot?.draft).toMatchObject({ assumptions: 'FIRST EDIT MUST SURVIVE', targetMin: '1', targetMax: '2' })
  expect(s.adapter.getState().localSeq).toBe(3)
})
