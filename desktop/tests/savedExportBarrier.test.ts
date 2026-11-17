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
  const replies: EditorFlushedPayload[] = []
  const guard = new CloseGuard({ timeoutMs: 100, sendFlush: (_id, payload) => { if (deliver) listener?.(payload) } })
  const controller = new SessionController({ projectService: h.projectService, recovery: h.recovery, recent: h.recent,
    ports: { askChoice: async () => { throw Error('must not ask to save') }, pickSaveTarget: async () => { throw Error('must not auto save') },
      flushEditor: async id => { const outcome = await guard.requestFlush(id); return outcome.ok ? { ok: true, value: null } : { ok: false, error: outcome.error! } },
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
  const service = new AgentToolService({ controller, projectService: h.projectService, recovery: h.recovery, rootDir: h.workspace,
    exportPorts: { store: new DrawingExportStore({ ops }), pickTarget: async () => { picks++; return '/exports/drawing.svg' } } })
  cleanup.push(async () => { adapter.dispose(); guard.dispose(); await h.dispose() })
  return { h, session, adapter, service, guard, files, writes, replies, picks: () => picks, disconnect: () => { deliver = false } }
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
