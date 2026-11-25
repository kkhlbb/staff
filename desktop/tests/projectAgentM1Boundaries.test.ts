import { it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import { M1InternalService } from '../main/project-agent/m1InternalService'
const root = '/Users/aston/DSH/tmp/cunlian-agent-refactor/isolated-2018-m1-binding-identity/tmp/'
const caller = { callerId: 'reader', userId: 'u', projectId: 'synthetic-boundary', authorizationRef: 'grant', canWrite: false }
async function setup() {
  await fs.mkdir(root, { recursive: true })
  const directory = await fs.mkdtemp(root + 'boundary-')
  return { directory, service: new M1InternalService(directory) }
}
it('allows an authorized reader to read context', async () => {
  const { service } = await setup()
  expect((await service.context(caller.projectId, caller)).snapshot.cursor).toBe(0)
})
it('allows an authorized reader to read events', async () => {
  const { service } = await setup()
  expect((await service.read(caller.projectId, caller, 0, 10)).nextCursor).toBe(0)
})
it('rejects writer acquisition by a read-only caller', async () => {
  const { service } = await setup()
  await expect(service.acquire(caller.projectId, caller, {
    version: '0.1.0-m0', requestId: 'r', projectId: caller.projectId,
    authorizationRef: caller.authorizationRef, expectedWriterEpoch: 0,
  })).rejects.toThrow('AUTH_REQUIRED')
})
it('rejects malformed persisted JSON', async () => {
  const { directory, service } = await setup()
  const { createHash } = await import('node:crypto')
  const file = directory + '/' + createHash('sha256').update(caller.projectId).digest('hex') + '.json'
  await fs.writeFile(file, '{broken')
  await expect(service.context(caller.projectId, caller)).rejects.toThrow()
  expect(await fs.readFile(file, 'utf8')).toBe('{broken')
})
