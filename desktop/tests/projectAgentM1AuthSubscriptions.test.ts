import { promises as fs } from 'node:fs'
import { expect, it } from 'vitest'
import { M1InternalService } from '../main/project-agent/m1InternalService'

const root = '/Users/aston/DSH/tmp/cunlian-agent-refactor/isolated-2018-m1-binding-identity/tmp/'
const c = { projectId: 'p', userId: 'u', callerId: 'a', authorizationRef: 'first', canWrite: true }
const other = { ...c, callerId: 'b', canWrite: false }
const fresh = { ...c, authorizationRef: 'second' }
const input = { type: 'createSpacerDraft', innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120000 }
const source = { type: 'userInput' }
const sources = { innerDiameterQ: source, outerDiameterQ: source, lengthQ: source }
async function setup() {
  await fs.mkdir(root, { recursive: true })
  const dir = await fs.mkdtemp(root + 'auth-')
  const service = new M1InternalService(dir)
  const acquire = (caller = c, epoch = 0, takeover = false) => service.acquire('p', caller, {
    version: '0.1.0-m0', requestId: 'r', projectId: 'p', authorizationRef: caller.authorizationRef,
    expectedWriterEpoch: epoch,
  }, takeover)
  const token = await acquire()
  const create = (caller = c, credentials = token, key = 'create') =>
    service.createSpacer('p', caller, { ...credentials, idempotencyKey: key }, input, sources, null)
  const pending = async () => {
    await service.createSpacer('p', c, { ...token, idempotencyKey: 'ask' }, { type: input.type }, sources, null)
    return (await service.context('p', c)).activities[0].taskId
  }
  return { service, dir, acquire, token, create, pending }
}

it('does not replay a receipt across callers with the same idempotency key', async () => {
  const { acquire, create } = await setup()
  await create()
  const caller = { ...other, canWrite: true }
  await expect(create(caller, await acquire(caller, 1, true))).rejects.toThrow('DRAFT_NOT_EMPTY')
})

it('binds a writer token to its user as well as its caller', async () => {
  const { create } = await setup()
  await expect(create({ ...c, userId: 'different' })).rejects.toThrow('WRITER_REVOKED')
})

it('rejects reads under the rotated generation across restart', async () => {
  const { service, dir } = await setup()
  await service.rotateAuthorization(c, fresh)
  const restart = new M1InternalService(dir)
  await expect(restart.context('p', c)).rejects.toThrow('AUTH_REQUIRED')
  await expect(restart.read('p', c, 0, 5)).rejects.toThrow('AUTH_REQUIRED')
  expect((await restart.context('p', fresh)).snapshot.projectId).toBe('p')
})

it('rejects old generation writes and receipt replays after rotation', async () => {
  const { service, create } = await setup()
  await create()
  await service.rotateAuthorization(c, fresh)
  await expect(create()).rejects.toThrow('AUTH_REQUIRED')
  await expect(create(c, undefined, 'new')).rejects.toThrow('AUTH_REQUIRED')
})

it('unregisters the rotated subscription and discards late context and events', async () => {
  const { service } = await setup()
  const sub = await service.subscribe(c)
  const context = await service.context('p', c)
  const events = await service.read('p', c, 0, 10)
  await service.rotateAuthorization(c, fresh)
  expect(sub.active).toBe(false)
  expect(sub.view).toBeNull()
  expect(await service.acceptLate(sub, context)).toBe(false)
  expect(await service.acceptLate(sub, events)).toBe(false)
  await expect(service.subscribe(c)).rejects.toThrow('AUTH_REQUIRED')
})

it('revokes late delivery and subsequent reads and writes without affecting a different caller sharing the ref', async () => {
  const { service, create } = await setup()
  const sub = await service.subscribe(c)
  const reader = await service.subscribe(other)
  await service.revoke('p', c)
  expect(sub.active).toBe(false)
  expect(await service.acceptLate(sub, {})).toBe(false)
  await expect(service.context('p', c)).rejects.toThrow('AUTH_REQUIRED')
  await expect(create()).rejects.toThrow('AUTH_REQUIRED')
  expect(await service.acceptLate(reader, await service.context('p', other))).toBe(true)
})

it('switches the selected authorization session without invalidating another caller', async () => {
  const { service, create } = await setup()
  const sub = await service.subscribe(c)
  const reader = await service.subscribe(other)
  const late = await service.context('p', c)
  await service.switchProject(sub)
  expect(await service.acceptLate(sub, late)).toBe(false)
  await expect(service.context('p', c)).rejects.toThrow('AUTH_REQUIRED')
  await expect(create()).rejects.toThrow('AUTH_REQUIRED')
  expect(await service.acceptLate(reader, await service.read('p', other, 0, 10))).toBe(true)
})

it('rejects an old epoch on both write paths and preserves read subscriptions', async () => {
  const { service, acquire, token, create, pending } = await setup()
  const taskId = await pending()
  const reader = await service.subscribe(other)
  await acquire(c, 1, true)
  await expect(create()).rejects.toThrow('WRITER_REVOKED')
  await expect(service.resumeSpacer('p', c, { ...token, idempotencyKey: 'resume' }, taskId, input, sources))
    .rejects.toThrow('WRITER_REVOKED')
  expect(await service.acceptLate(reader, await service.read('p', other, 0, 10))).toBe(true)
})

it('allows read-only reads but rejects acquisition, takeover and writing', async () => {
  const { service, acquire, create } = await setup()
  expect((await service.context('p', other)).snapshot.projectId).toBe('p')
  expect((await service.read('p', other, 0, 10)).nextCursor).toBe(1)
  await expect(acquire(other, 1)).rejects.toThrow('AUTH_REQUIRED')
  await expect(acquire(other, 1, true)).rejects.toThrow('AUTH_REQUIRED')
  await expect(create(other)).rejects.toThrow('AUTH_REQUIRED')
})

it('reauthorizes a revoked caller and resumes the same awaiting task', async () => {
  const { service, acquire, pending } = await setup()
  const taskId = await pending()
  await service.revoke('p', c)
  await service.rotateAuthorization(c, fresh)
  const view = await service.context('p', fresh)
  const token = await acquire(fresh, view.snapshot.writerEpoch)
  const draft = await service.resumeSpacer('p', fresh, { ...token, idempotencyKey: 'resume' }, taskId, input, sources)
  expect((await service.context('p', fresh)).activities).toMatchObject([
    { taskId, status: 'succeeded', draftRevision: draft.draftRevision },
  ])
})

it('persists the first read-only generation and rejects an unregistered replacement', async () => {
  const { service, dir } = await setup()
  await service.context('p', other)
  await expect(new M1InternalService(dir).context('p', { ...other, authorizationRef: 'unregistered' }))
    .rejects.toThrow('AUTH_REQUIRED')
})

it('rejects another caller’s responses and handles that the service did not issue', async () => {
  const { service } = await setup()
  const reader = await service.subscribe(other)
  const view = await service.context('p', c)
  expect(await service.acceptLate(reader, view)).toBe(false)
  expect(await service.acceptLate({ active: true, view: null }, await service.context('p', other))).toBe(false)
  expect(reader.view).toBeNull()
})
