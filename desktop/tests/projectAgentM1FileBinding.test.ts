import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile.ts'
import { encodeProjectFile } from '../../src/project-file/codec.ts'
import { ProjectService } from '../main/projectService.ts'
import { LocalM1Authority } from '../main/project-agent/m1LocalAuthority.ts'
import { M1InternalService } from '../main/project-agent/m1InternalService.ts'

const sender = { webContentsId: 1, isMainFrame: true, frameUrl: 'file:///index.desktop.html' }

async function setup() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cunlian-m1-binding-'))
  const dir = path.join(base, 'projects')
  const root = path.join(base, 'userdata')
  await fs.mkdir(dir, { recursive: true })
  await fs.mkdir(root, { recursive: true })
  const file = path.join(dir, 'test.cunlian')
  const sample = await createSampleSnapshot()
  const bytes = async (name: string) => {
    const encoded = await encodeProjectFile({ ...sample, project: { ...sample.project, name } })
    if (!encoded.ok) throw Error(encoded.error.message)
    return encoded.value.bytes
  }
  await fs.writeFile(file, await bytes('initial'))
  const services: M1InternalService[] = []
  const service: ProjectService = new ProjectService({ bindingAuthority: () => authority })
  let sessionId = ''
  async function open(target = file) {
    const result = await service.openFile(target)
    if (!result.ok) throw Error(result.error.message)
    sessionId = result.value.sessionId
  }
  await open()
  const session = () => service.getSession(sessionId)!
  const describe = () => ({ sessionId, projectId: sample.project.id, path: session().path, fingerprint: session().fingerprint })
  const confirm = vi.fn(async (): Promise<'approve' | 'cancel'> => 'approve')
  const createAuthority = () => new LocalM1Authority({ root, sessionFor: describe, confirm, serviceFactory: root => {
    const binding = new M1InternalService(root)
    services.push(binding)
    return binding
  } })
  const authority = createAuthority()
  const projectId = sample.project.id
  const req = { projectId, requestId: 'test', requestGeneration: 1 }
  const authorize = () => authority.authorize(sender, req)
  const resolve = () => authority.resolve(sender, describe())
  async function seed() {
    const caller = { projectId, callerId: 'seed', userId: 'seed', authorizationRef: 'seed', canWrite: true }
    const journal = services[0]
    const token = await journal.acquire(projectId, caller, { version: '0.1.0-m0', requestId: 'r', projectId,
      authorizationRef: 'seed', expectedWriterEpoch: 0 })
    await journal.createSpacer(projectId, caller, { ...token, idempotencyKey: 'seed' },
      { type: 'createSpacerDraft', innerDiameterQ: 100, outerDiameterQ: 200, lengthQ: 300 },
      { innerDiameterQ: { type: 'userInput' }, outerDiameterQ: { type: 'userInput' }, lengthQ: { type: 'userInput' } }, null)
  }
  async function save() {
    const editSeq = session().acceptedSeq + 1
    const snapshot = session().snapshot
    const staged = await service.stage(sessionId, editSeq, { ...snapshot,
      project: { ...snapshot.project, name: 'trusted save ' + editSeq } })
    if (!staged.ok) throw Error(staged.error.message)
    return service.save(sessionId, { editSeq, expectedFingerprint: session().fingerprint })
  }
  return { root, dir, file, open, bytes, service, session, createAuthority, describe, authorize, resolve, seed, authority, req, confirm, save }
}

it('trusts an actual ProjectService save and resumes the original journal cursor, task and draft', async () => {
  const f = await setup()
  const grant = await f.authorize()
  await f.seed()
  const caller = (await f.resolve())!
  const initial = await f.authority.readContext(f.describe(), caller)
  const version = f.describe().fingerprint
  expect(await f.save()).toMatchObject({ ok: true })
  expect(f.describe().fingerprint).not.toBe(version)
  expect((await f.resolve())?.authorizationRef).toBe(grant.authorizationRef)
  expect(await f.authority.readContext(f.describe(), caller)).toEqual(initial)
  const after = initial.snapshot.cursor
  expect(await f.authority.readEvents(f.describe(), caller, after, 10)).toEqual({ events: [], nextCursor: after, highWatermark: after })
  const restarted = f.createAuthority()
  expect(await restarted.resolve(sender, f.describe())).toBeNull()
  await restarted.authorize(sender, f.req)
  expect((await restarted.readContext(f.describe(), (await restarted.resolve(sender, f.describe()))!)).snapshot.cursor).toBe(after)
})

it.each(['external', 'copy', 'saveAs'] as const)('%s cannot inherit a same-ID grant or history', async action => {
  const f = await setup()
  await f.authorize()
  await f.seed()
  const target = action === 'external' ? f.file : path.join(f.dir, action + '.cunlian')
  if (action === 'external') {
    await fs.writeFile(target, await f.bytes('externally changed'))
    expect(await f.resolve()).toBeNull()
    expect(await f.save()).toMatchObject({ ok: false, error: { code: 'EXTERNAL_MODIFIED' } })
    await f.open(target)
  } else if (action === 'copy') {
    await fs.copyFile(f.file, target)
    await f.open(target)
  } else {
    const current = f.session()
    expect(await f.service.saveAs(current.sessionId, { targetPath: target, editSeq: current.acceptedSeq,
      expectedFingerprint: current.fingerprint, overwriteFingerprint: null })).toMatchObject({ ok: true })
  }
  expect(await f.resolve()).toBeNull()
  await f.authorize()
  expect((await f.authority.readContext(f.describe(), (await f.resolve())!)).snapshot).toMatchObject({ cursor: 0, spacerDraft: null })
  expect(await fs.readdir(path.join(f.root, 'bindings'))).toHaveLength(2)
})

it.each(['cancel', 'revoke', 'navigation'] as const)('concurrent trusted save cannot turn %s into a grant', async action => {
  const f = await setup()
  if (action !== 'cancel') await f.authorize()
  let complete!: (decision: 'approve' | 'cancel') => void
  f.confirm.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  const pending = expect(f.authorize()).rejects.toThrow('AUTH_REQUIRED')
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
  const saving = f.save()
  if (action !== 'cancel') await f.authority.revokeWindow(sender.webContentsId)
  expect(await saving).toMatchObject({ ok: true })
  complete(action === 'cancel' ? 'cancel' : 'approve')
  await pending
  expect(await f.resolve()).toBeNull()
})

it('failed pointer rename preserves the previous pointer and journal bytes', async () => {
  const f = await setup()
  await f.authorize()
  await f.seed()
  const folder = path.join(f.root, 'file-bindings')
  const pointer = path.join(folder, (await fs.readdir(folder))[0])
  const bindingRoot = path.join(f.root, 'bindings', (await fs.readdir(path.join(f.root, 'bindings')))[0])
  const journal = path.join(bindingRoot, (await fs.readdir(bindingRoot))[0])
  const before = await fs.readFile(pointer)
  const history = await fs.readFile(journal)
  const rename = fs.rename.bind(fs)
  const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (to === pointer) throw Error('injected registry rename failure')
    return rename(from, to)
  })
  try {
    const result = await f.save()
    expect(result).toMatchObject({ ok: true, value: { warnings: [expect.stringContaining('M1')] } })
  } finally {
    spy.mockRestore()
  }
  expect(await fs.readFile(pointer)).toEqual(before)
  expect(await fs.readFile(journal)).toEqual(history)
  expect(await fs.readdir(folder)).toEqual([path.basename(pointer)])
  expect(await f.resolve()).toBeNull()
})
