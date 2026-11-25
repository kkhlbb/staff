import { it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import { M1InternalService } from '../main/project-agent/m1InternalService'
const root = '/Users/aston/DSH/tmp/cunlian-agent-refactor/isolated-2018-m1-binding-identity/tmp/'
const c = { callerId: 'c', userId: 'u', projectId: 'synthetic-gap', authorizationRef: 'a', canWrite: true }
const request = { version: '0.1.0-m0', requestId: 'r', projectId: c.projectId, authorizationRef: 'a', expectedWriterEpoch: 0 }
async function setup(fault?: (phase: string) => void) {
  await fs.mkdir(root, { recursive: true })
  const dir = await fs.mkdtemp(root + 'gap-')
  const service = new M1InternalService(dir, fault)
  return { dir, service, token: await service.acquire(c.projectId, c, request) }
}
it('creates one real revision and preserves it on conflict, then revokes views and late responses', async () => {
  const { service, token } = await setup()
  const source = { type: 'userInput' as const }
  const draft = await service.createSpacer(c.projectId, c, { ...token, idempotencyKey: 'create' },
    { type: 'createSpacerDraft', innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120000 },
    { innerDiameterQ: source, outerDiameterQ: source, lengthQ: source }, null)
  expect(draft?.draftRevision).toBeTruthy()
  await expect(service.createSpacer(c.projectId, c, { ...token, idempotencyKey: 'other' }, {}, {} as Parameters<M1InternalService['createSpacer']>[4], null)).rejects.toThrow('DRAFT_NOT_EMPTY')
  expect((await service.context(c.projectId, c)).snapshot.spacerDraft).toEqual(draft)
  const sub = await service.subscribe(c)
  expect(await service.acceptLate(sub, await service.context(c.projectId, c))).toBe(true)
  await service.revoke(c.projectId, c)
  expect(sub.view).toBeNull()
  expect(await service.acceptLate(sub, draft)).toBe(false)
  await expect(service.read(c.projectId, c, 0, 10)).rejects.toThrow('AUTH_REQUIRED')
  await expect(service.subscribe(c)).rejects.toThrow('AUTH_REQUIRED')
  const next = { ...c, authorizationRef: 'fresh' }
  await service.rotateAuthorization(c, next)
  const switched = await service.subscribe(next)
  const late = await service.context(c.projectId, next)
  await service.switchProject(switched)
  expect(await service.acceptLate(switched, late)).toBe(false)
})
it('recovers last complete record before rename and resolves ambiguous committed rename', async () => {
  let phase = ''
  const { service } = await setup(p => { if (p === phase) throw Error('injected') })
  phase = 'beforeRename'
  await expect(service.acquire(c.projectId, c, { ...request, expectedWriterEpoch: 1 }, true)).rejects.toThrow('injected')
  expect((await service.context(c.projectId, c)).snapshot.writerEpoch).toBe(1)
  phase = 'afterRename'
  const token = await service.acquire(c.projectId, c, { ...request, expectedWriterEpoch: 1 }, true)
  expect(token.writerEpoch).toBe(2)
})
