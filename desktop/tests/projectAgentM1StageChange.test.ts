import { createHash } from 'node:crypto'
import { promises as fs, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { LocalM1Authority } from '../main/project-agent/m1LocalAuthority'
import type { LocalM1Session, M1WriterLease } from '../main/project-agent/m1LocalAuthority'
import { M1InternalService } from '../main/project-agent/m1InternalService'
import type { M1StageChangeRequest, M1StageResult } from '../main/project-agent/m1StageContracts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})

const projectId = 'stage-test'
const approve = async () => 'approve' as const
const sender = (webContentsId: number) => ({ webContentsId, isMainFrame: true, frameUrl: null })
const fingerprint = (data: string) => createHash('sha256').update(data).digest('hex')
const sources = {
  innerDiameterQ: { type: 'userInput' }, outerDiameterQ: { type: 'userInput' }, lengthQ: { type: 'userInput' },
} as const

function request(lease: M1WriterLease, overrides: Partial<M1StageChangeRequest> = {}): M1StageChangeRequest {
  return {
    baseRevision: lease.baseRevision, expectedDraftRevision: lease.draftRevision, idempotencyKey: 'stage-1',
    operation: { type: 'createSpacerDraft', innerDiameterQ: 100, outerDiameterQ: 200, lengthQ: 300 },
    sources, ...overrides,
  }
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'm1-stage-'))
  roots.push(root)
  const target = path.join(root, 'project.cunlian')
  const journalRoot = path.join(root, 'authority')
  await fs.writeFile(target, 'v1')
  const sessions = new Map<number, LocalM1Session>([1, 2].map(windowId => [
    windowId, { sessionId: String(windowId), projectId, path: target, fingerprint: fingerprint('v1') },
  ]))
  const state = { fault: undefined as ((phase: string) => void) | undefined }
  const createAuthority = () => new LocalM1Authority({
    root: journalRoot, sessionFor: windowId => sessions.get(windowId) ?? null, confirm: approve,
    serviceFactory: dir => new M1InternalService(dir, phase => state.fault?.(phase)),
  })
  const authority = createAuthority()
  const authorize = (windowId: number, auth = authority) =>
    auth.authorize(sender(windowId), { projectId, requestId: 'read', requestGeneration: 1 })
  const binding = (windowId: number) => sessions.get(windowId)!
  const writerRequest = (windowId: number, expectedWriterEpoch = 0) =>
    ({ windowId, projectId, sessionId: binding(windowId).sessionId, expectedWriterEpoch })
  const acquire = (windowId = 1, epoch = 0) => authority.acquireWriter(writerRequest(windowId, epoch), approve)
  const caller = async (windowId: number, auth = authority) => {
    const value = await auth.resolve(sender(windowId), binding(windowId))
    if (!value) throw Error('Test window has no read grant')
    return value
  }
  const journal = async () => {
    const [key] = await fs.readdir(path.join(journalRoot, 'bindings'))
    const dir = path.join(journalRoot, 'bindings', key)
    const file = (await fs.readdir(dir)).find(name => name.endsWith('.json'))!
    const { draftRevision, events, spacerReceipts, tasks } = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'))
    return { draftRevision, events, spacerReceipts, tasks }
  }
  const events = async (windowId = 1, auth = authority) => auth.readEvents(binding(windowId), await caller(windowId, auth), 0, 100)
  await authorize(1)
  await authorize(2)
  return { target, authority, createAuthority, authorize, binding, writerRequest, acquire, caller, events, journal, sessions, state }
}

it('allows one writer when two independently authorized entries acquire the same epoch', async () => {
  const f = await fixture()
  const result = await Promise.allSettled([f.acquire(1), f.acquire(2)])
  expect(result.map(entry => entry.status).sort()).toEqual(['fulfilled', 'rejected'])
  expect(result.find(entry => entry.status === 'rejected')).toMatchObject({ reason: new Error('WRITER_HELD') })
  expect((await f.caller(1)).canWrite).toBe(false)
  expect((await f.caller(2)).canWrite).toBe(false)
  expect((await f.events()).events).toHaveLength(1)
})

it('requires trusted confirmation and rejects late requests and replays queued behind takeover', async () => {
  const f = await fixture()
  const previous = await f.acquire()
  const raw = request(previous)
  await f.authority.stageChange(previous, raw)
  await expect(f.authority.takeOverWriter(f.writerRequest(2, 1), async () => 'deny')).rejects.toThrow('AUTH_REQUIRED')
  let late: Promise<M1StageResult> | undefined
  f.state.fault = phase => {
    if (phase !== 'beforeRename') return
    f.state.fault = undefined
    late = f.authority.stageChange(previous, raw)
    void late.catch(() => {})
  }
  const next = await f.authority.takeOverWriter(f.writerRequest(2, 1), approve)
  expect(next.writerEpoch).toBe(2)
  expect(next.draftRevision).not.toBeNull()
  expect(late).toBeDefined()
  await expect(late).rejects.toThrow('WRITER_REVOKED')
  await expect(f.authority.stageChange(previous, raw)).rejects.toThrow('WRITER_REVOKED')
  await expect(f.authority.stageChange({ ...next }, request(next))).rejects.toThrow('WRITER_REVOKED')
  expect((await f.events()).events).toHaveLength(4)
})

it('discards confirmation after a window switches sessions and rejects a stale takeover epoch', async () => {
  const f = await fixture()
  const previous = await f.acquire()
  await expect(f.authority.takeOverWriter(f.writerRequest(2, 0), approve)).rejects.toThrow('WRITER_HELD')
  const cut = await f.journal()
  const revoke = vi.spyOn(f.authority, 'revokeWindow')
  await expect(f.authority.takeOverWriter(f.writerRequest(2, 1), async () => {
    f.sessions.set(2, { ...f.binding(2), sessionId: 'switched' })
    return 'approve'
  })).rejects.toThrow('AUTH_REQUIRED')
  await revoke.mock.results[0]?.value
  expect(await f.journal()).toEqual(cut)
  expect(await f.authority.resolve(sender(2), f.binding(2))).toBeNull()
  expect(await f.authority.stageChange(previous, request(previous))).toMatchObject({ draftRevision: expect.any(String) })
})

it('atomically compares both revisions and deduplicates concurrent requests before replaying their result', async () => {
  const f = await fixture()
  const lease = await f.acquire()
  const raw = request(lease)
  const before = await f.events()
  await expect(f.authority.stageChange(lease, { ...raw, baseRevision: 'obsolete' })).rejects.toThrow('STALE_BASE')
  await expect(f.authority.stageChange(lease, { ...raw, expectedDraftRevision: 'obsolete' })).rejects.toThrow('STALE_BASE')
  expect(await f.events()).toEqual(before)
  const [first, replay] = await Promise.all([f.authority.stageChange(lease, raw), f.authority.stageChange(lease, raw)])
  expect(first).toEqual(replay)
  const cut = await f.events()
  expect(cut.events).toHaveLength(3)
  expect(cut.events.slice(1)).toEqual(['contextChanged', 'taskChanged'].map((type, index) => expect.objectContaining({
    projectId, baseRevision: lease.baseRevision, draftRevision: 'draftRevision' in first ? first.draftRevision : null,
    jobId: null, sequence: index + 2, type,
  })))
  await expect(f.authority.stageChange(lease, { ...raw, operation: { ...raw.operation, lengthQ: 400 } }))
    .rejects.toThrow('IDEMPOTENCY_CONFLICT')
  await expect(f.authority.stageChange(lease, { ...raw, idempotencyKey: 'other' })).rejects.toThrow('STALE_BASE')
  await expect(f.authority.stageChange(lease, { ...raw, idempotencyKey: 'other',
    expectedDraftRevision: (await f.authority.readWriterContext(lease)).draftRevision })).rejects.toThrow('DRAFT_NOT_EMPTY')
  expect(await f.events()).toEqual(cut)
})

it('clarifies unsupported operations without taking a receipt or executing their payload', async () => {
  const f = await fixture()
  const lease = await f.acquire()
  const raw = request(lease)
  const unsupported = { type: 'commitApprovedDraft', script: 'arbitrary input' } as unknown as M1StageChangeRequest['operation']
  const before = await f.events()
  expect(await f.authority.stageChange(lease, { ...raw, operation: unsupported }))
    .toMatchObject({ kind: 'clarification', code: 'UNSUPPORTED_SCOPE', question: expect.any(String) })
  const malformed = { ...raw.operation, script: 'arbitrary input' } as unknown as M1StageChangeRequest['operation']
  await expect(f.authority.stageChange(lease, { ...raw, operation: malformed })).rejects.toThrow('INVALID_REQUEST')
  expect(await f.events()).toEqual(before)
  expect(await f.authority.stageChange(lease, raw)).toMatchObject({ draftRevision: expect.any(String) })
})

it('journals missing fields once and resumes only the owned task with an authorized source', async () => {
  const f = await fixture()
  const lease = await f.acquire()
  const incomplete = request(lease, { operation: { type: 'createSpacerDraft', innerDiameterQ: 100 }, sources: {} })
  const awaiting = await f.authority.stageChange(lease, incomplete)
  expect(awaiting).toMatchObject({ draftRevision: null, activity: { status: 'awaitingInput', question: { reason: 'missing' } } })
  expect(await f.authority.stageChange(lease, incomplete)).toEqual(awaiting)
  if (!('activity' in awaiting)) throw Error('Expected a pending spacer task')
  const content = 'authorized requirement'
  const documentRef = await f.authority.registerStageReference(lease, content)
  const input = request(lease, { idempotencyKey: 'resume',
    operation: { type: 'resumeSpacerDraft', taskId: awaiting.activity.taskId, innerDiameterQ: 100, outerDiameterQ: 200, lengthQ: 300 },
    sources: { ...sources, innerDiameterQ: { type: 'document', anchor: {
      documentRef, documentFingerprint: fingerprint(content), excerpt: content, page: 1, region: null,
    } } },
  })
  await expect(f.authority.stageChange(lease, { ...input, idempotencyKey: incomplete.idempotencyKey }))
    .rejects.toThrow('IDEMPOTENCY_CONFLICT')
  const before = await f.events()
  const wrong = input.sources.innerDiameterQ
  if (wrong?.type !== 'document') throw Error('Expected document source')
  await expect(f.authority.stageChange(lease, { ...input, sources: { ...input.sources,
    innerDiameterQ: { ...wrong, anchor: { ...wrong.anchor, documentFingerprint: fingerprint('wrong') } },
  } })).rejects.toThrow('REFERENCE_STALE')
  expect(await f.events()).toEqual(before)
  const finished = await f.authority.stageChange(lease, input)
  expect(finished).toMatchObject({ draftRevision: expect.any(String), sources: input.sources })
  expect((await f.events()).events.at(-1)).toMatchObject({
    activity: { taskId: awaiting.activity.taskId, status: 'succeeded' },
  })
})

it('keeps the writer and journal across ordinary save but requires the new file fingerprint for fresh writes', async () => {
  const f = await fixture()
  const lease = await f.acquire()
  const previous = f.binding(1)
  await f.authority.preserveBinding(previous, async advance => {
    await expect(f.authority.stageChange(lease, request(lease))).rejects.toThrow('AUTH_REQUIRED')
    await fs.writeFile(f.target, 'v2')
    const saved = { ...previous, fingerprint: fingerprint('v2') }
    f.sessions.set(1, saved)
    await advance(saved)
  })
  const current = await f.authority.readWriterContext(lease)
  expect(current.baseRevision).toBe(fingerprint('v2'))
  await expect(f.authority.stageChange(lease, request(lease))).rejects.toThrow('STALE_BASE')
  expect(await f.authority.stageChange(lease, request(lease, { baseRevision: current.baseRevision })))
    .toMatchObject({ draftRevision: expect.any(String) })
})

it.each(['io', 'navigation', 'external replacement'] as const)('rejects a pre-rename %s race without adding draft, events or receipt', async failure => {
  const f = await fixture()
  const lease = await f.acquire()
  const before = await f.journal()
  const revoke = vi.spyOn(f.authority, 'revokeWindow')
  f.state.fault = phase => {
    if (phase !== 'beforeRename') return
    f.state.fault = undefined
    if (failure === 'io') throw Error('injected failure')
    if (failure === 'navigation') void f.authority.revokeWindow(1)
    if (failure === 'external replacement') writeFileSync(f.target, 'external')
  }
  await expect(f.authority.stageChange(lease, request(lease))).rejects.toThrow(failure === 'io' ? 'SAVE_FAILED' : 'AUTH_REQUIRED')
  await revoke.mock.results[0]?.value
  expect(await f.journal()).toEqual(before)
  if (failure === 'external replacement') {
    await expect(f.authority.stageChange(lease, request(lease))).rejects.toThrow('WRITER_REVOKED')
    expect(await f.authority.resolve(sender(1), f.binding(1))).toBeNull()
    return
  }
  expect((await f.authority.readContext(f.binding(2), await f.caller(2))).snapshot.draftRevision).toBeNull()
  if (failure === 'io') {
    expect(await f.authority.stageChange(lease, request(lease, {
      operation: { type: 'createSpacerDraft', innerDiameterQ: 100, outerDiameterQ: 200, lengthQ: 400 },
    }))).toMatchObject({ lengthQ: 400 })
  }
})

it('resolves a post-rename failure and recovers the persisted draft and events after restart and reauthorization', async () => {
  const f = await fixture()
  const lease = await f.acquire()
  f.state.fault = phase => {
    if (phase === 'afterRename') throw Error('ambiguous rename')
  }
  const draft = await f.authority.stageChange(lease, request(lease))
  f.state.fault = undefined
  expect(await f.authority.stageChange(lease, request(lease))).toEqual(draft)
  const before = await f.events()
  const restarted = f.createAuthority()
  expect(await restarted.resolve(sender(1), f.binding(1))).toBeNull()
  await expect(restarted.stageChange(lease, request(lease))).rejects.toThrow('WRITER_REVOKED')
  await f.authorize(1, restarted)
  const snapshot = await restarted.readContext(f.binding(1), await f.caller(1, restarted))
  expect(snapshot.snapshot).toMatchObject({ spacerDraft: draft, writer: { occupied: false, epoch: lease.writerEpoch } })
  expect(await f.events(1, restarted)).toEqual(before)
  const fresh = await restarted.acquireWriter(f.writerRequest(1, lease.writerEpoch), approve)
  expect(fresh.writerEpoch).toBe(lease.writerEpoch + 1)
  await restarted.revokeWriter(fresh)
  await expect(restarted.stageChange(fresh, request(fresh))).rejects.toThrow('WRITER_REVOKED')
})
