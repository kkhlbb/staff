import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { M1InternalService } from '../main/project-agent/m1InternalService'
const root = '/Users/aston/DSH/tmp/cunlian-agent-refactor/isolated-2018-m1-binding-identity/tmp/'
const caller = { projectId: 'p', callerId: 'c', userId: 'u', authorizationRef: 'a', canWrite: true }
const input = { type: 'createSpacerDraft', innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120000 }
async function setup() {
  await fs.mkdir(root, { recursive: true })
  const dir = await fs.mkdtemp(root + 'ref-')
  let fail = false
  const service = new M1InternalService(dir, phase => { if (fail && phase === 'beforeRename') throw Error('injected') })
  const acquire = async (s = service, c = caller) => {
    const context = await s.context('p', c)
    return s.acquire('p', c, { version: '0.1.0-m0', requestId: 'r', projectId: 'p',
      authorizationRef: c.authorizationRef, expectedWriterEpoch: context.snapshot.writerEpoch })
  }
  const token = await acquire()
  const ref = await service.registerReference('p', caller, 'authorized immutable text')
  const fingerprint = createHash('sha256').update('authorized immutable text').digest('hex')
  const source = { type: 'document', anchor: { documentRef: ref, documentFingerprint: fingerprint, page: 1, region: null, excerpt: 'text' } }
  const sources = { innerDiameterQ: source, outerDiameterQ: source, lengthQ: source }
  const create = (s = service, c = caller, t = token, basis = sources) =>
    s.createSpacer('p', c, { ...t, idempotencyKey: 'k' }, input, basis, null)
  const file = dir + '/' + createHash('sha256').update('p').digest('hex') + '.json'
  const bytes = () => fs.readFile(file, 'utf8')
  return { service, dir, ref, create, sources, acquire, bytes, file, setFail: () => { fail = true } }
}
it('invalidates pending content after revoke', async () => {
  const f = await setup()
  await f.service.revoke('p', caller)
  await expect(f.create()).rejects.toThrow('AUTH_REQUIRED')
})
it('invalidates pending content after authorization rotation', async () => {
  const f = await setup()
  const next = { ...caller, authorizationRef: 'b' }
  await f.service.rotateAuthorization(caller, next)
  await expect(f.create(f.service, next, await f.acquire(f.service, next))).rejects.toThrow('REFERENCE_STALE')
})
it('rejects another caller and project reference and unknown content reads', async () => {
  const f = await setup()
  await expect(f.service.readReference('p', { ...caller, callerId: 'other' }, f.ref)).rejects.toThrow('REFERENCE_STALE')
  await expect(f.service.readReference('other', { ...caller, projectId: 'other' }, f.ref)).rejects.toThrow('REFERENCE_STALE')
  await expect(f.service.readReference('p', caller, 'guessed')).rejects.toThrow('REFERENCE_STALE')
})
it('rejects a source digest mismatch without changing disk', async () => {
  const f = await setup()
  const before = await f.bytes()
  const source = { ...f.sources.lengthQ, anchor: { ...f.sources.lengthQ.anchor, documentFingerprint: 'a'.repeat(64) } }
  await expect(f.create(undefined, undefined, undefined, { ...f.sources, lengthQ: source })).rejects.toThrow('REFERENCE_STALE')
  expect(await f.bytes()).toBe(before)
})
it('keeps the old transaction intact on pre-rename failure', async () => {
  const f = await setup()
  const before = await f.bytes()
  f.setFail()
  await expect(f.create()).rejects.toThrow('injected')
  expect(await f.bytes()).toBe(before)
})
it('reads committed content after restart and rotation and replays its receipt', async () => {
  const f = await setup()
  const draft = await f.create()
  const next = { ...caller, authorizationRef: 'b' }
  await f.service.rotateAuthorization(caller, next)
  const restart = new M1InternalService(f.dir)
  expect((await restart.readReference('p', next, f.ref)).content).toBe('authorized immutable text')
  const token = await f.acquire(restart, next)
  const before = await f.bytes()
  expect(await f.create(restart, next, token)).toEqual(draft)
  expect(await f.bytes()).toBe(before)
})
for (const kind of ['unknown field', 'invalid id', 'duplicate id', 'hash', 'cursor', 'task step', 'receipt reference']) {
  it('rejects dirty disk without rewriting: ' + kind, async () => {
    const f = await setup()
    await f.create()
    const record = JSON.parse(await f.bytes())
    switch (kind) {
      case 'unknown field': record.unexpected = true; break
      case 'invalid id': record.references[0].ref = ''; break
      case 'duplicate id': record.references.push(record.references[0]); break
      case 'hash': record.references[0].content = 'tampered'; break
      case 'cursor': record.cursor++; break
      case 'task step': record.steps[0].taskId = 'missing'; break
      case 'receipt reference': record.spacerReceipts[0].referenceIds = ['missing']; break
    }
    const corrupt = JSON.stringify(record)
    await fs.writeFile(f.file, corrupt)
    await expect(f.service.context('p', caller)).rejects.toThrow('SAVE_FAILED')
    expect(await f.bytes()).toBe(corrupt)
  })
}

it('refuses committed content disclosure to another caller or project', async () => {
  const f = await setup()
  await f.create()
  await expect(f.service.readReference('p', { ...caller, callerId: 'other' }, f.ref)).rejects.toThrow('REFERENCE_STALE')
  await expect(f.service.readReference('other', { ...caller, projectId: 'other' }, f.ref)).rejects.toThrow('REFERENCE_STALE')
})
it('does not retain prepared content across restart', async () => {
  const f = await setup()
  const restart = new M1InternalService(f.dir)
  await expect(f.create(restart, caller, await f.acquire(restart))).rejects.toThrow('REFERENCE_STALE')
})
it('rejects mismatched reference ownership inside a receipt without rewriting', async () => {
  const f = await setup()
  await f.create()
  const record = JSON.parse(await f.bytes())
  record.references[0].userId = 'different-user'
  const corrupt = JSON.stringify(record)
  await fs.writeFile(f.file, corrupt)
  await expect(f.service.context('p', caller)).rejects.toThrow('SAVE_FAILED')
  expect(await f.bytes()).toBe(corrupt)
})
