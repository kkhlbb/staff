import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { M1InternalService } from '../main/project-agent/m1InternalService'

const root = '/Users/aston/DSH/tmp/cunlian-agent-refactor/isolated-2018-m1-binding-identity/tmp'
const caller = { projectId: 'task-machine', callerId: 'c', userId: 'u', authorizationRef: 'a', canWrite: true }
const id = caller.projectId
const operation = { type: 'createSpacerDraft', innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120000 }
const source = { type: 'userInput' as const }
const sources = { innerDiameterQ: source, outerDiameterQ: source, lengthQ: source }

async function setup(fault?: (phase: string) => void) {
  await fs.mkdir(root, { recursive: true })
  const dir = await fs.mkdtemp(path.join(root, 'task-'))
  const service = new M1InternalService(dir, fault)
  const acquire = (target: M1InternalService, epoch: number) => target.acquire(id, caller, {
    version: '0.1.0-m0', requestId: 'acquire', projectId: id, authorizationRef: 'a', expectedWriterEpoch: epoch,
  })
  const token = await acquire(service, 0)
  const ask = (input: unknown = { type: operation.type }, basis: unknown = sources) =>
    service.createSpacer(id, caller, { ...token, idempotencyKey: 'ask' }, input, basis, null)
  const file = path.join(dir, createHash('sha256').update(id).digest('hex') + '.json')
  const bytes = () => fs.readFile(file, 'utf8')
  return { service, dir, acquire, token, ask, bytes, file }
}

async function pending(fault?: (phase: string) => void) {
  const fixture = await setup(fault)
  await fixture.ask()
  const { activities: [task] } = await fixture.service.context(id, caller)
  const answer = (target = fixture.service, token = fixture.token, input: unknown = operation) =>
    target.resumeSpacer(id, caller, { ...token, idempotencyKey: 'answer' }, task.taskId, input, sources)
  return { ...fixture, task, answer }
}

async function expectAwaiting(fixture: Awaited<ReturnType<typeof setup>>) {
  const restart = new M1InternalService(fixture.dir)
  const cut = await restart.context(id, caller)
  expect(cut.snapshot).toMatchObject({ draftRevision: null, spacerDraft: null })
  expect(cut.activities).toHaveLength(1)
  expect(cut.activities[0]).toMatchObject({ status: 'awaitingInput', question: { reason: 'missing' } })
  const page = await restart.read(id, caller, 1, 100)
  expect(page.events.at(-1)).toMatchObject({ type: 'taskChanged', sequence: cut.snapshot.cursor, activity: cut.activities[0] })
}

it('persists a question and cursor without creating a draft when dimensions are missing', async () => {
  const fixture = await setup()
  await fixture.ask()
  await expectAwaiting(fixture)
})

it('persists clarification without creating a draft when a source is missing', async () => {
  const fixture = await setup()
  await fixture.ask(operation, { innerDiameterQ: source, outerDiameterQ: source })
  await expectAwaiting(fixture)
})

it('reconstructs the same task and question after restart', async () => {
  const { dir, task } = await pending()
  expect((await new M1InternalService(dir).context(id, caller)).activities).toEqual([task])
})

it('commits the resumed draft, task, steps, events and receipt together', async () => {
  const { dir, task, acquire, answer, bytes } = await pending()
  const restart = new M1InternalService(dir)
  const token = await acquire(restart, 1)
  const before = await restart.context(id, caller)
  const draft = await answer(restart, token)
  expect(draft.draftRevision).toBeTruthy()
  const cut = await restart.context(id, caller)
  expect(cut.snapshot.spacerDraft).toEqual(draft)
  expect(cut.activities).toMatchObject([{ taskId: task.taskId, status: 'succeeded', question: null, draftRevision: draft.draftRevision }])
  expect(cut.steps.filter(step => step.taskId === task.taskId).map(step => step.status))
    .toEqual(['queued', 'running', 'awaitingInput', 'running', 'succeeded'])
  expect((await restart.read(id, caller, before.snapshot.cursor, 100)).events.map(event => event.type))
    .toEqual(['contextChanged', 'taskChanged'])
  expect(JSON.parse(await bytes()).spacerReceipts).toEqual(expect.arrayContaining([
    expect.objectContaining({ operation: 'resumeSpacerDraft', result: draft }),
  ]))
})

it('replays the same answer without changing any record bytes', async () => {
  const { answer, bytes } = await pending()
  const draft = await answer()
  const before = await bytes()
  expect(await answer()).toEqual(draft)
  expect(await bytes()).toBe(before)
})

it('rejects a different answer under the same key without changing the record', async () => {
  const { answer, bytes } = await pending()
  await answer()
  const before = await bytes()
  await expect(answer(undefined, undefined, { ...operation, lengthQ: 130000 })).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  expect(await bytes()).toBe(before)
})

it('rejects a new resume from a terminal state without changing the record', async () => {
  const { answer, service, token, task, bytes } = await pending()
  await answer()
  const before = await bytes()
  await expect(service.resumeSpacer(id, caller, { ...token, idempotencyKey: 'new-answer' }, task.taskId, operation, sources))
    .rejects.toThrow('INVALID_TRANSITION')
  expect(await bytes()).toBe(before)
})

it('rejects an invalid answer without a partial write', async () => {
  const { answer, bytes } = await pending()
  const before = await bytes()
  await expect(answer(undefined, undefined, { ...operation, lengthQ: -1 })).rejects.toThrow('INVALID_REQUEST')
  expect(await bytes()).toBe(before)
})

it('rejects a revoked answer without a partial write', async () => {
  const { service, answer, bytes } = await pending()
  await service.revoke(id, caller)
  const before = await bytes()
  await expect(answer()).rejects.toThrow('AUTH_REQUIRED')
  expect(await bytes()).toBe(before)
})

it('rejects the old token after restart and accepts the same task after reacquisition', async () => {
  const { dir, answer, acquire, bytes } = await pending()
  const restart = new M1InternalService(dir)
  const before = await bytes()
  await expect(answer(restart)).rejects.toThrow('WRITER_REVOKED')
  expect(await bytes()).toBe(before)
  expect((await answer(restart, await acquire(restart, 1))).draftRevision).toBeTruthy()
})

it('rejects an invalid persisted step transition without rewriting the record', async () => {
  const { service, file, bytes } = await pending()
  const record = JSON.parse(await bytes())
  record.steps[1].status = 'succeeded'
  const corrupt = JSON.stringify(record)
  await fs.writeFile(file, corrupt)
  await expect(service.context(id, caller)).rejects.toThrow('SAVE_FAILED')
  expect(await bytes()).toBe(corrupt)
})

it('preserves the pending task and all record bytes on a pre-rename failure', async () => {
  let fail = false
  const { answer, bytes, service, task } = await pending(phase => {
    if (fail && phase === 'beforeRename') throw Error('injected failure')
  })
  const before = await bytes()
  fail = true
  await expect(answer()).rejects.toThrow('injected failure')
  expect(await bytes()).toBe(before)
  expect((await service.context(id, caller)).activities).toEqual([task])
  fail = false
  expect((await answer()).draftRevision).toBeTruthy()
})
