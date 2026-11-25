import { it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import { M1InternalService } from '../main/project-agent/m1InternalService'
const root = '/Users/aston/DSH/tmp/cunlian-agent-refactor/isolated-2018-m1-binding-identity/tmp/'
const c = { callerId: 'external', userId: 'u', projectId: 'synthetic', authorizationRef: 'grant', canWrite: true }
const req = { version: '0.1.0-m0', requestId: 'r', projectId: c.projectId, authorizationRef: 'grant', expectedWriterEpoch: 0 }
it('serializes competing entries, revokes epochs, shares cuts and recovers receipts', async () => {
  await fs.mkdir(root, { recursive: true }); const dir = await fs.mkdtemp(root + 'round-')
  const s = new M1InternalService(dir)
  const both = await Promise.allSettled([s.acquire(c.projectId,c,req),s.acquire(c.projectId,c,req)])
  expect(both.map(x=>x.status)).toEqual(['fulfilled','rejected'])
  const token = (both[0] as PromiseFulfilledResult<{ writerToken: string; writerEpoch: number }>).value
  const base = { version: req.version, requestId: req.requestId, projectId: req.projectId, authorizationRef: req.authorizationRef }
  const raw = { ...base, ...token, baseRevision: null, expectedDraftRevision: null, idempotencyKey: 'k', documentRef: 'doc', contentFingerprint: 'a'.repeat(64) }
  const update = { result: { draftRevision: 'd1', requirements: [], questions: [] }, tasks: [], steps: [], draftRefs: [] }
  expect(await s.write(c.projectId,c,'importRequirements',raw,update)).toEqual(update.result)
  expect(await s.write(c.projectId,c,'importRequirements',{...raw,requestId:'retry'},update)).toEqual(update.result)
  await expect(s.write(c.projectId,c,'importRequirements',{...raw,documentRef:'other'},update)).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  const cut = await s.context(c.projectId,c)
  expect(cut.snapshot.cursor).toBe(3)
  expect(await s.read(c.projectId,c,3,1)).toEqual({events:[],nextCursor:3,highWatermark:3})
  expect((await s.read(c.projectId,c,0,1)).nextCursor).toBe(1)
  await s.acquire(c.projectId,{...c,callerId:'internal'},{...req,expectedWriterEpoch:1},true)
  await expect(s.write(c.projectId,c,'importRequirements',raw,update)).rejects.toThrow('WRITER_REVOKED')
  const restarted = new M1InternalService(dir)
  const fresh = await restarted.acquire(c.projectId,c,{...req,expectedWriterEpoch:2})
  expect(await restarted.write(c.projectId,c,'importRequirements',{...raw,...fresh},update)).toEqual(update.result)
  expect((await s.context(c.projectId,{...c,canWrite:false})).snapshot.projectId).toBe(c.projectId)
  await restarted.expireHistoryForTest(c.projectId)
  await expect(restarted.read(c.projectId,c,0,1)).rejects.toThrow('CURSOR_EXPIRED')
  await expect(restarted.read(c.projectId,c,999,1)).rejects.toThrow('CURSOR_EXPIRED')
})
