import { createSpacerSnapshot } from '../../src/project-file/__fixtures__/spacerProjectFile'
import { downgradeToSchema6 } from './helpers/legacyArchive'
import { readWorkbenchAttachment, readWorkbenchSelectedObject } from '../main/project-agent/workbenchReferences'
import { M1ModelApi } from '../main/project-agent/m1ModelApi'
import type { RealModelRuntime } from '../main/realModelRuntime'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { createRequirementProject } from '../../src/requirements/__fixtures__/requirementFixture'
import { decodeProjectFile, encodeProjectFile } from '../../src/project-file/codec'
import { chainToDraft } from '../../src/workspace/draft'
import { installM2PreviewChannels } from '../main/project-agent/m2/channels'
import { openM2DraftStore } from '../main/project-agent/m2/draftStore'
import { M2Pipeline } from '../main/project-agent/m2/pipeline'
import { runMountingPlate, runMountingPlateDrawing } from '../main/project-agent/m2/engine.mjs'
import { LocalM1Authority } from '../main/project-agent/m1LocalAuthority'
import { migrateLegacySpacer } from '../main/project-agent/m3Migration'
import { ProjectService } from '../main/projectService'
import { SenderGuard } from '../main/senderGuard'
import { IPC_CHANNELS } from '../shared/contracts'
import { computeCheckSetFingerprint, type M3OpenExternalProjectResult } from '../shared/project-agent/m3-lifecycle'
import type { M2Result } from '../shared/project-agent/m2-preview'

const projectId = 'mounting-plate'
const roots: string[] = []
async function root() {
  const directory = await mkdtemp(path.join(tmpdir(), 'cunlian-m3-'))
  roots.push(directory)
  return directory
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function pdf() {
  const bytes = await readFile(new URL('./fixtures/agent-refactor/mounting-plate-taskbook.pdf', import.meta.url))
  return { documentRef: 'real-pdf-revision', documentName: 'mounting-plate-taskbook.pdf',
    bytes, pageCount: 2, sha256: createHash('sha256').update(bytes).digest('hex') }
}

function completed(pipeline: M2Pipeline) {
  return vi.waitFor(() => {
    const preview = pipeline.snapshot()
    expect(preview.drawing).toMatchObject({ status: 'ready', revision: preview.currentRevision })
    return preview
  }, { timeout: 12_000 })
}

function payload(pipeline: M2Pipeline, requestId: string, confirmationToken = 'renderer-local-nonce') {
  const snapshot = pipeline.snapshot()
  const baseRevision = pipeline.baseRevision
  const draftRevision = snapshot.currentRevision!
  return { projectId, requestId, confirmationToken, baseRevision, draftRevision, checkSetFingerprint: computeCheckSetFingerprint({
    projectId, baseRevision, draftRevision, checks: snapshot.checks,
    modelFingerprint: snapshot.model.fingerprint, drawingFingerprint: snapshot.drawing.fingerprint,
  }) }
}

it('A04 / A11 blocks failed, incomplete and mismatched results, undoes X62 to X61, and requires native confirmation', async () => {
  const store = openM2DraftStore(await root(), projectId, 'test-binding')
  let release!: () => void
  const slowDrawing = new Promise<void>(resolve => { release = resolve })
  const draw: typeof runMountingPlateDrawing = async (report, options) => {
    if (report.revision === 'draft-1') await slowDrawing
    return runMountingPlateDrawing(report, options)
  }
  const pipeline = new M2Pipeline(projectId, 1, 1, { build: runMountingPlate, draw }, () => {}, store)
  const confirm = vi.fn(async () => true)
  await pipeline.importRequirements(await pdf())
  try {
    await expect(pipeline.commit(payload(pipeline, 'incomplete'), confirm, () => {})).rejects.toThrow('FINGERPRINT_MISMATCH')
  } finally { release() }
  await completed(pipeline)
  await expect(pipeline.undo({ projectId, draftRevision: 'draft-1', requestId: 'nothing' })).rejects.toThrow('NOTHING_TO_UNDO')
  const change = { kind: 'moveRightHoleX', deltaQ: 10_000 } as const
  pipeline.stageChange('draft-1', 'to-x61', change)
  pipeline.stageChange('draft-2', 'to-x62', change)
  const blocked = await completed(pipeline)
  expect(blocked.checks).toEqual(expect.arrayContaining([expect.objectContaining({
    checkId: 'MP-03', status: 'fail', summary: '[12.75, 13.25] mm', linkedFeatureIds: expect.arrayContaining(['hole-2']),
  })]))
  await expect(pipeline.commit(payload(pipeline, 'blocked'), confirm, () => {})).rejects.toThrow('CHECKS_BLOCKED')
  expect(confirm).not.toHaveBeenCalled()
  expect(store.read()?.versions).toEqual([])
  const undo = { projectId, draftRevision: 'draft-3', requestId: 'undo-x62' }
  const restored = await pipeline.undo(undo)
  expect(restored).toMatchObject({ previousDraftRevision: 'draft-3', restoredDraftRevision: 'draft-4', previewSnapshot: {
    model: { revision: 'draft-4' }, drawing: { revision: 'draft-4' },
    checks: expect.arrayContaining([expect.objectContaining({ checkId: 'MP-03', status: 'pass', summary: '[13.75, 14.25] mm' })]),
  } })
  expect(await pipeline.undo(undo)).toEqual(restored)
  const request = payload(pipeline, 'commit')
  await expect(pipeline.commit({ ...request, checkSetFingerprint: 'csfp-false' }, confirm, () => {}))
    .rejects.toThrow('FINGERPRINT_MISMATCH')
  await expect(pipeline.commit({ ...request, baseRevision: 'different' }, confirm, () => {}))
    .rejects.toThrow('BASE_REVISION_CONFLICT')
  await expect(pipeline.commit(request, async () => false, () => {})).rejects.toThrow('CONFIRMATION_EXPIRED')
  const value = await pipeline.commit(request, confirm, () => {})
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(await pipeline.commit(request, confirm, () => {})).toEqual(value)
  expect(confirm).toHaveBeenCalledTimes(1)
  await expect(pipeline.commit({ ...request, confirmationToken: 'different' }, confirm, () => {})).rejects.toThrow('DUPLICATE_REQUEST')
  await expect(pipeline.commit({ ...request, requestId: 'different' }, confirm, () => {})).rejects.toThrow('CONFIRMATION_EXPIRED')
  expect(store.read()?.versions).toEqual([expect.objectContaining({
    draftRevision: 'draft-4', revision: value.committedRevision, solverRules: expect.objectContaining({ checks: expect.any(Array), rulesVersion: expect.any(String) }),
    artifactHashes: { model: expect.stringMatching(/^[a-f0-9]{64}$/), drawing: expect.stringMatching(/^[a-f0-9]{64}$/) },
    preview: { ...restored.previewSnapshot, model: expect.objectContaining({ isDraft: false }), drawing: expect.objectContaining({ isDraft: false }) },
  })])
}, 30_000)

it('A09 restores committed evidence, independently staged inputs, and request receipts after reconstructing the pipeline', async () => {
  const store = openM2DraftStore(await root(), projectId, 'test-binding')
  const make = () => new M2Pipeline(projectId, 1, 1, undefined, () => {}, store)
  const source = await pdf()
  const first = make()
  await first.importRequirements(source)
  await completed(first)
  const request = payload(first, 'persisted-commit')
  const saved = await first.commit(request, async () => true, () => {})
  const change = { kind: 'moveRightHoleX', deltaQ: 10_000 } as const
  const staged = first.stageChange('draft-1', 'persisted-change', change)
  first.dispose()
  const restart = make()
  await restart.importRequirements(source)
  const restored = await restart.restore()
  expect(restored).toMatchObject({ baseRevision: saved.committedRevision, draftRevision: 'draft-2',
    restoreStatus: { restoredFromDisk: true, restoredSourceCount: 1, viewsConsistentWithSnapshot: true },
    formalVersions: [{ revision: saved.committedRevision }], uncommittedDrafts: [{ draftRevision: 'draft-2', canUndo: true }],
    previewSnapshot: { requirements: expect.arrayContaining([expect.objectContaining({ anchor: { documentRef: source.documentRef,
      documentName: source.documentName, excerpt: expect.any(String), page: 1 } })]) } })
  expect((await restart.restore(saved.committedRevision)).previewSnapshot.model.isDraft).toBe(false)
  expect(restart.stageChange('draft-1', 'persisted-change', change)).toEqual(staged)
  const noPrompt = vi.fn(async () => false)
  expect(await restart.commit(request, noPrompt, () => {})).toEqual(saved)
  expect(noPrompt).not.toHaveBeenCalled()
}, 30_000)

it('A10 saves a distinct spacer copy preserving the original, sources, history and independent draft', async () => {
  const directory = await root()
  const snapshot = await createSpacerSnapshot({ confirmed: true })
  const draft = chainToDraft(snapshot.project.dimensionChain)
  draft.terms[0].nominal = '52.21'
  const encoded = await encodeProjectFile({ ...snapshot, draft })
  if (!encoded.ok) throw Error(encoded.error.message)
  const original = path.join(directory, 'spacer.cunlian')
  const oldBytes = await downgradeToSchema6(encoded.value.bytes)
  await writeFile(original, oldBytes)
  const service = new ProjectService()
  const opened = await service.openFile(original)
  if (!opened.ok) throw Error(opened.error.message)
  const session = service.getSession(opened.value.sessionId)!
  const verify = vi.fn()
  const report = await migrateLegacySpacer(session, directory, verify)
  expect(report).toMatchObject({ originalFilePreserved: true, originalFilePath: original, sourceFormat: 'cunlian/schema-6',
    legacyChainCompatibility: { compatible: true, samples: [
      { lengthMm: '12.00', verdict: 'pass', detail: '[0.1500, 0.2500] mm' },
      { lengthMm: '12.04', verdict: 'pass', detail: '[0.1100, 0.2100] mm' },
      { lengthMm: '12.10', verdict: 'fail', detail: '[0.0500, 0.1500] mm' },
      { lengthMm: '12.05', verdict: 'boundary_pass', detail: '[0.1000, 0.2000] mm' },
    ] } })
  expect(report?.migratedFilePath).not.toEqual(original)
  expect(await readFile(original)).toEqual(Buffer.from(oldBytes))
  const copy = await decodeProjectFile(await readFile(report!.migratedFilePath!))
  expect(copy.ok).toBe(true)
  if (!copy.ok) throw Error(copy.error.message)
  expect(copy.value.snapshot.draft).toEqual(draft)
  expect(copy.value.snapshot.fileRevisions).toEqual(session.snapshot.fileRevisions)
  expect(copy.value.snapshot.revisions).toEqual(session.snapshot.revisions)
  expect(verify).toHaveBeenCalled()
})

it('guards five IPCs and only delivers peer notifications backed by live, trusted file grants', async () => {
  const directory = await root()
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<M2Result<unknown>>>()
  const guard = new SenderGuard()
  const sessions = new Map()
  const events = new Map<number, IpcMainInvokeEvent>()
  for (const id of [1, 2]) {
    const file = path.join(directory, id + '.cunlian')
    const data = 'Project ' + id
    await writeFile(file, data)
    sessions.set(id, { sessionId: 'session-' + id, projectId: 'project-' + id, path: file,
      fingerprint: createHash('sha256').update(data).digest('hex') })
    const frame = { url: 'file:///workspace', send: vi.fn() }
    events.set(id, { sender: { id, mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent)
    guard.register({ webContentsId: id, isDestroyed: () => false, isAllowedFrameUrl: url => url === frame.url })
  }
  const authority = new LocalM1Authority({ root: directory, sessionFor: id => sessions.get(id) ?? null, confirm: async () => 'approve' })
  const openPeer = vi.fn()
  const channels = installM2PreviewChannels({ handle: (channel, handler) => handlers.set(channel, handler) }, {
    guard, authority, sources: () => [], sessionFor: id => sessions.get(id) ?? null, draftRoot: directory,
    eventForWindow: id => events.get(id) ?? null, openPeer,
  })
  const event = events.get(1)!
  const methods = ['commitM3ApprovedDraft', 'undoDraftChange', 'getMigrationReport', 'openExternalProjectResult', 'subscribeM3ExternalProjectEvents'] as const
  expect(new Set(methods.map(method => IPC_CHANNELS[method])).size).toBe(5)
  for (const method of methods) {
    const handler = handlers.get(IPC_CHANNELS[method])!
    expect(await handler({ ...event, senderFrame: null }, {})).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED', detail: expect.any(String) } })
  }
  const token = randomUUID()
  const subscribe = handlers.get(IPC_CHANNELS.subscribeM3ExternalProjectEvents)!
  const open = handlers.get(IPC_CHANNELS.openExternalProjectResult)!
  expect(await subscribe(event, token)).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } })
  for (const id of [1, 2]) await authority.authorize({ webContentsId: id, frameUrl: 'file:///workspace', isMainFrame: true },
    { projectId: 'project-' + id, requestId: 'authorize', requestGeneration: 1 })
  expect(await subscribe(event, token)).toEqual({ ok: true, value: { subscriptionId: token } })
  const lease = await authority.acquireWriter({ windowId: 2, projectId: 'project-2', sessionId: 'session-2', expectedWriterEpoch: 0 },
    async () => 'approve')
  const staged = await authority.stageChange(lease, { baseRevision: lease.baseRevision, expectedDraftRevision: null,
    idempotencyKey: 'external-stage', operation: { type: 'createSpacerDraft', lengthQ: 120_400, innerDiameterQ: 200_000, outerDiameterQ: 320_000 },
    sources: { lengthQ: { type: 'userInput' }, innerDiameterQ: { type: 'userInput' }, outerDiameterQ: { type: 'userInput' } } })
  await channels.externalDraft(2, staged, lease.writerEpoch)
  const send = event.senderFrame!.send
  expect(send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.m3ExternalProjectEvent, token, expect.objectContaining({
    eventId: expect.any(String), projectId: 'project-2', sequence: 1, writerEpoch: lease.writerEpoch, scopeEpoch: 1,
    fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
  }))
  expect(openPeer).not.toHaveBeenCalled()
  expect(await open(event, { projectId: 'project-2', requestId: 'open' })).toMatchObject({ ok: true, value: { projectId: 'project-2' } })
  expect(openPeer).toHaveBeenCalledExactlyOnceWith(2)
  const unsubscribe = handlers.get(IPC_CHANNELS.unsubscribeM3ExternalProjectEvents)!
  expect(await unsubscribe(event, token)).toEqual({ ok: true, value: null })
  await channels.externalDraft(2, staged, lease.writerEpoch)
  expect(send).toHaveBeenCalledTimes(1)
  channels.invalidate(2)
  expect(await open(event, { projectId: 'project-2', requestId: 'open' })).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } })
})

it('R-B sends current PDF and hole/plate references through B chat and rejects stale or cross-project IDs', async () => {
  const directory = await root()
  const projectPath = path.join(directory, 'result.cunlian')
  const { snapshot } = await createRequirementProject()
  const source = await pdf()
  const originalRevision = snapshot.revisions[0]
  const document = snapshot.documents.find(item => item.id === originalRevision.documentId)!
  // Keep the M1 fixture intact and add a second, current PDF revision for M2.
  const m2Document = { ...document, id: 'mounting-plate-taskbook', latestRevisionId: source.documentRef }
  snapshot.documents.push(m2Document)
  snapshot.revisions.push({ ...originalRevision, id: source.documentRef, documentId: m2Document.id, sha256: source.sha256,
    fileName: source.documentName, pageCount: source.pageCount })
  await writeFile(projectPath, 'authorized B test file')
  const binding = { sessionId: 'chat-session', projectId: snapshot.project.id, path: projectPath,
    fingerprint: createHash('sha256').update('authorized B test file').digest('hex') }
  const authority = new LocalM1Authority({ root: directory, sessionFor: () => binding, confirm: async () => 'approve' })
  const sender = { webContentsId: 3, isMainFrame: true, frameUrl: 'file:///workspace' }
  await authority.authorize(sender, { projectId: binding.projectId, requestId: 'auth', requestGeneration: 1 })
  const caller = (await authority.resolve(sender, binding))!
  const pipeline = new M2Pipeline(binding.projectId, 1, 0)
  await pipeline.importRequirements(source)
  await completed(pipeline)
  const sent: unknown[] = []
  const runtime = {
    async createM1Connection() {
      return {
        redact: (text: string) => text, containsKey: () => false, persistKey: async () => {},
        createAdapter: () => ({
          listModels: async () => ['local-fixture'],
          async generate({ messages, tools }: { messages: { role: string; content: string }[]; tools: { name: string }[] }) {
            if (tools[0].name === 'm1_connection_probe') {
              const result = messages.findLast(message => message.role === 'tool')
              if (result) return { text: JSON.parse(result.content).challenge, toolCalls: [] }
              return { text: '', toolCalls: [{ id: 'probe-call', name: 'm1_connection_probe', argumentsJson: '{}' }] }
            }
            sent.push(JSON.parse(messages.at(-1)!.content))
            return { text: '已读引用。', toolCalls: [] }
          },
        }),
      }
    },
  } as unknown as RealModelRuntime
  const api = new M1ModelApi(authority, runtime, { sender, sessionId: binding.sessionId, projectId: binding.projectId,
    scopeEpoch: 1, authorizationRef: caller.authorizationRef, isCurrent: () => true,
    m2Change: async () => ({ revision: pipeline.snapshot().currentRevision!, select: ref => pipeline.readSelectedObject(ref),
      stage: () => { throw Error('The fixture never issues a tool write') } }),
    readAttachment: async ref => readWorkbenchAttachment(snapshot, ref, id => pipeline.readAttachment(id)),
    readSelectedObject: async ref => readWorkbenchSelectedObject(snapshot, ref, id => pipeline.readSelectedObject(id)),
  })
  const scope = { projectId: binding.projectId, scopeEpoch: 1 }
  expect(await api.testM1ModelApiConnection({ ...scope, requestId: 'probe', model: 'local-fixture',
    apiKey: 'fixture-key', contextPreview: false, baseUrl: 'http://127.0.0.1/v1' })).toMatchObject({ ok: true })
  const chat = (requestId: string, ref: string, objectId: string) => api.sendM1ChatMessage({
    ...scope, requestId, writerEpoch: 0, prompt: '检查该对象和任务书', attachments: [ref], selectedObject: objectId, history: [],
  })
  for (const objectId of ['hole-2', 'plate-1']) {
    expect(await chat(objectId, source.documentRef, objectId)).toMatchObject({ ok: true })
    expect(sent.at(-1)).toMatchObject({ attachments: [{ excerpt: expect.any(String), page: 1 }],
      selection: expect.stringContaining(`"objectId":"${objectId}"`), mountingPlateDraftRevision: 'draft-1' })
  }
  const term = snapshot.project.dimensionChain.terms[0]
  expect(await chat('m1-ref', snapshot.project.activeRequirementRevisionId!, term.id)).toMatchObject({ ok: true })
  expect(sent.at(-1)).toMatchObject({ attachments: [{ excerpt: expect.any(String), page: 2 }], selection: expect.stringContaining(term.name) })
  m2Document.latestRevisionId = 'superseding-revision'
  const stale = { ok: false, error: { code: 'REFERENCE_STALE' } }
  expect(await chat('old-pdf', source.documentRef, 'hole-2')).toMatchObject(stale)
  expect(await chat('cross-pdf', 'other-project-revision', 'plate-1')).toMatchObject(stale)
  expect(await chat('cross-feature', snapshot.project.activeRequirementRevisionId!, 'hole-other-project')).toMatchObject(stale)
  expect(sent).toHaveLength(3)
  await api.dispose()
})

it('publishes exactly one commit and receipt for simultaneous main IPC replays and rejects a revoked pre-rename cut', async () => {
  const directory = await root()
  const source = await pdf()
  const frame = { url: 'file:///workspace', send: vi.fn() }
  const event = { sender: { id: 8, mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent
  const guard = new SenderGuard()
  guard.register({ webContentsId: 8, isDestroyed: () => false, isAllowedFrameUrl: url => url === frame.url })
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<M2Result<unknown>>>()
  const session = { sessionId: 'race-session', projectId, path: '/trusted-project', fingerprint: 'authorized-base' }
  let live = true
  let finish!: (answer: boolean) => void
  const confirm = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  installM2PreviewChannels({ handle: (channel, handler) => handlers.set(channel, handler) }, {
    guard, sessionFor: () => session, draftRoot: directory, sources: () => [source], confirmM3: confirm,
    authority: { resolve: async () => ({ authorizationRef: 'grant' }), workbenchCut: async () => ({
      baseRevision: session.fingerprint, bindingKey: 'trusted-binding', snapshot: { writerEpoch: 1 }, writable: true,
      seal() { if (!live) throw Error('AUTH_REQUIRED') },
    }) } as never,
  })
  const open = await handlers.get(IPC_CHANNELS.openExternalProjectResult)!(event, { projectId, requestId: 'open' })
  expect(open.ok).toBe(true)
  if (!open.ok) return
  const { baseRevision, draftRevision, previewSnapshot } = open.value as M3OpenExternalProjectResult
  const request = { projectId, baseRevision, draftRevision, confirmationToken: 'renderer-nonce', requestId: 'same-request',
    checkSetFingerprint: computeCheckSetFingerprint({ projectId, baseRevision, draftRevision,
      modelFingerprint: previewSnapshot!.model!.fingerprint, drawingFingerprint: previewSnapshot!.drawing!.fingerprint,
      checks: previewSnapshot!.checks! }) }
  const commit = handlers.get(IPC_CHANNELS.commitM3ApprovedDraft)!
  const first = commit(event, request)
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
  const second = commit(event, request)
  expect(await commit(event, { ...request, confirmationToken: 'same-ID-other-payload' }))
    .toMatchObject({ ok: false, error: { code: 'DUPLICATE_REQUEST' } })
  live = false
  finish(true)
  for (const attempt of [first, second]) {
    expect(await attempt).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } })
  }
  const store = openM2DraftStore(directory, projectId, 'trusted-binding')
  expect(store.read()).toBeUndefined()
  live = true
  const retry = commit(event, request)
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
  const retryReplay = commit(event, request)
  finish(true)
  const saved = await retry
  expect(saved).toMatchObject({ ok: true, value: { committedDraftRevision: draftRevision, previousBaseRevision: baseRevision } })
  expect(await retryReplay).toEqual(saved)
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(store.read()?.versions).toHaveLength(1)
  expect(store.read()?.receipts).toHaveLength(1)
}, 20_000)
