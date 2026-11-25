import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { chmod, lstat, mkdir, mkdtemp, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { LocalM1Client } from '../../mcp/localClient'
import { LocalM1Authority } from '../main/project-agent/m1LocalAuthority'
import { getExternalActivities, getLocalAgentInstallInfo } from '../main/project-agent/m1LocalAgent'
import { startM1LocalEndpoint } from '../main/project-agent/m1LocalEndpoint'
import { M1InternalService } from '../main/project-agent/m1InternalService'
import { M1_LAUNCH_ARGUMENT } from '../main/project-agent/m1LocalTransport'

const cleanup: (() => void | Promise<void>)[] = []
const approve = async () => 'approve' as const
const project = { projectId: 'spacer-project' }
const sender = { webContentsId: 1, isMainFrame: true, frameUrl: null }
const fingerprint = createHash('sha256').update('project-v1').digest('hex')

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => { resolve = finish })
  return { promise, resolve }
}

afterEach(async () => {
  for (const clean of cleanup.splice(0).reverse()) await clean()
})

describe.skipIf(process.platform !== 'darwin' || process.getuid?.() === 0)('macOS external MCP endpoint', () => {
  let helper: string
  beforeAll(async () => {
    const root = path.join(process.cwd(), 'out')
    await mkdir(root, { recursive: true })
    const folder = await mkdtemp(path.join(root, 'test-m1-native-'))
    helper = path.join(folder, 'm1-peer')
    const source = path.resolve('desktop/main/project-agent/native/m1-peer.c')
    execFileSync('/usr/bin/clang', [source, '-o', helper])
    return () => rm(folder, { recursive: true, force: true })
  })

  async function fixture(options: { start?: boolean; fault?: (phase: string) => void } = {}) {
    const root = await mkdtemp('/private/tmp/m1-test-')
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const socketPath = path.join(root, 'agent.sock')
    const target = path.join(root, 'spacer project.cunlian')
    await writeFile(target, 'project-v1')
    const session = { ...project, sessionId: 'session-A', path: target, fingerprint }
    const state = { session, fault: options.fault }
    const authority = new LocalM1Authority({
      root: path.join(root, 'journal'),
      sessionFor: id => id === 1 ? state.session : null,
      confirm: approve,
      serviceFactory: dir => new M1InternalService(dir, phase => state.fault?.(phase)),
    })
    const confirm = vi.fn<Parameters<typeof startM1LocalEndpoint>[0]['confirm']>().mockImplementation(approve)
    const start = async () => {
      const endpoint = await startM1LocalEndpoint({
        socketPath, peerHelper: helper, authority, confirm,
        selectWindow: id => id === project.projectId ? 1 : null,
      })
      cleanup.push(endpoint.close)
      return endpoint
    }
    const executable = path.join(root, 'Apps With Spaces/寸链.app/Contents/MacOS/寸链')
    const client = (name = 'Fixture Agent', overrides: Partial<ConstructorParameters<typeof LocalM1Client>[0]> = {}) => {
      const peer = new LocalM1Client({ executable, socketPath, peerHelper: helper, startupTimeoutMs: 1000, ...overrides })
      peer.initialize(name)
      cleanup.push(() => peer.close())
      return peer
    }
    return { socketPath, executable, authority, state, confirm, session, client, start,
      endpoint: options.start === false ? undefined : await start() }
  }

  it('holds the socket lock, reports actual handshake and client name, then removes the endpoint', async () => {
    const f = await fixture()
    expect((await stat(path.dirname(f.socketPath))).mode & 0o777).toBe(0o700)
    expect((await lstat(f.socketPath)).mode & 0o777).toBe(0o600)
    await expect(f.start()).rejects.toThrow('LOCAL_ENDPOINT_BUSY')

    const raw = net.createConnection(f.socketPath)
    cleanup.push(() => { raw.destroy() })
    await once(raw, 'connect')
    raw.write(JSON.stringify({ id: 1, method: 'hello', params: { version: 1, clientName: '原生客户端' } }) + '\n')
    await once(raw, 'data')
    expect(f.endpoint?.connections()).toEqual([{ clientName: '原生客户端', state: 'connecting' }])
    raw.write(JSON.stringify({ id: 2, method: 'capabilities', params: {} }) + '\n')
    const [response] = await once(raw, 'data')
    expect(JSON.parse(response.toString())).toMatchObject({ id: 2, ok: true })
    expect(f.endpoint?.connections()).toEqual([{ clientName: '原生客户端', state: 'connected' }])
    expect(f.confirm).not.toHaveBeenCalled()
    await f.endpoint?.close()
    expect(f.endpoint?.connections()).toEqual([])
    await expect(lstat(f.socketPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await f.start()
  })

  it('recovers an owned stale socket and rejects symlinks and unsafe socket permissions', async () => {
    const f = await fixture({ start: false })
    const child = spawn(process.execPath, ['-e', `
      process.umask(0o177)
      require('node:net').createServer().listen(process.argv[1], () => process.stdout.write('ready'))
    `, f.socketPath], { stdio: ['ignore', 'pipe', 'inherit'] })
    try { await once(child.stdout, 'data') } finally {
      child.kill('SIGKILL')
      await once(child, 'exit')
    }
    await chmod(f.socketPath, 0o666)
    await expect(f.start()).rejects.toThrow('UNSAFE_ENDPOINT')
    await chmod(f.socketPath, 0o600)
    const endpoint = await f.start()
    await endpoint.close()
    await symlink(f.session.path, f.socketPath)
    await expect(f.start()).rejects.toThrow('UNSAFE_ENDPOINT')
    expect((await lstat(f.socketPath)).isSymbolicLink()).toBe(true)
  })

  it('cold-launches the absolute executable with separate args, and emits a reusable client config', async () => {
    const f = await fixture({ start: false })
    const launch = vi.fn(async () => { await f.start() })
    const client = f.client('Agent Name', { launch })
    await expect(client.call('capabilities', {})).resolves.toMatchObject({ protocol: 1 })
    expect(launch).toHaveBeenCalledExactlyOnceWith(f.executable, [M1_LAUNCH_ARGUMENT], expect.any(AbortSignal))
    const resources = path.resolve(f.executable, '../../Resources')
    const info = getLocalAgentInstallInfo(f.executable, resources)
    expect(info).toMatchObject({
      installPath: path.resolve(f.executable, '../../..'), bridgeCommand: path.join(resources, 'cunlian-agent/cunlian-mcp'),
      bridgeArgs: [], mcpServerName: 'cunlian-local',
    })
    expect(JSON.parse(info.mcpConfigJson)).toEqual({ mcpServers: { 'cunlian-local': { command: info.bridgeCommand, args: [] } } })
  })

  it('bounds a launcher that never reports readiness', async () => {
    const f = await fixture({ start: false })
    const launch = vi.fn(() => new Promise<void>(() => {}))
    await expect(f.client('Timeout Agent', { launch, startupTimeoutMs: 100 }).ready()).rejects.toThrow('DESKTOP_TIMEOUT')
    expect(launch).toHaveBeenCalledOnce()
  })

  it('asks the desktop for project scope and filters every project read', async () => {
    const f = await fixture()
    const client = f.client()
    for (const operation of ['getContext', 'getExternalActivities', 'readWriterContext']) {
      await expect(client.call(operation, project)).rejects.toThrow('AUTH_REQUIRED')
    }
    await expect(client.call('authorizeProject', { projectId: 'other' })).rejects.toThrow('AUTH_REQUIRED')
    expect(f.confirm).not.toHaveBeenCalled()
    f.confirm.mockResolvedValueOnce('deny')
    await expect(client.call('authorizeProject', project)).rejects.toThrow('AUTH_REQUIRED')
    await client.call('authorizeProject', project)
    expect(f.confirm).toHaveBeenLastCalledWith({ windowId: 1, ...project, takeover: false,
      projectPath: await realpath(f.session.path) }, 'Fixture Agent', 'read', expect.any(AbortSignal))
    await expect(client.call('getContext', { projectId: 'other' })).rejects.toThrow('AUTH_REQUIRED')
    await expect(client.call('getContext', { ...project, path: f.session.path })).rejects.toThrow('INVALID_REQUEST')
    await expect(client.call('getContext', project)).resolves.toMatchObject({
      baseRevision: fingerprint, snapshot: { authorization: { authorized: true, canWrite: false } },
    })
    f.state.session = { ...f.state.session, sessionId: 'session-B' }
    await expect(client.call('getExternalActivities', project)).rejects.toThrow('AUTH_REQUIRED')
  })

  it('shares writer state and persists one clarification and resumed draft without leaking credentials', async () => {
    const f = await fixture()
    const client = f.client()
    const local = await f.authority.authorize(sender, { ...project, requestId: 'local', requestGeneration: 1 })
    await client.call('authorizeProject', project)
    const acquired = await client.call('acquireWriter', { ...project, expectedWriterEpoch: 0 })
    expect(acquired).toEqual({ writerEpoch: 1, baseRevision: fingerprint, draftRevision: null })
    await expect(f.authority.acquireWriter({ ...project, windowId: 1, sessionId: f.session.sessionId, expectedWriterEpoch: 1 }, approve))
      .rejects.toThrow('WRITER_HELD')
    const source = { type: 'userInput' }
    const envelope = { baseRevision: fingerprint, expectedDraftRevision: null }
    const ask = { ...project, change: { ...envelope, idempotencyKey: 'ask-1', operation: { type: 'createSpacerDraft' }, sources: {} } }
    const clarification = await client.call('stageChange', ask)
    expect(clarification).toMatchObject({ draftRevision: null, activity: { source: 'external', status: 'awaitingInput' } })
    expect(await client.call('stageChange', ask)).toEqual(clarification)
    const activity = clarification.activity as { taskId: string }
    const resume = { ...project, change: { ...envelope, idempotencyKey: 'resume-1',
      operation: { type: 'resumeSpacerDraft', taskId: activity.taskId, innerDiameterQ: 100, outerDiameterQ: 200, lengthQ: 300 },
      sources: { innerDiameterQ: source, outerDiameterQ: source, lengthQ: source } } }
    const draft = await client.call('stageChange', resume)
    expect(await client.call('readWriterContext', project)).toEqual({
      baseRevision: fingerprint, draftRevision: draft.draftRevision, cursor: expect.any(Number), spacerDraft: draft,
    })
    const activities = { draftRevision: draft.draftRevision, activities: [
      expect.objectContaining({ ...project, source: 'external', status: 'succeeded', taskId: activity.taskId }),
    ] }
    expect(await client.call('getExternalActivities', project)).toEqual(activities)
    expect(await getExternalActivities(f.authority, 1, f.session, local.authorizationRef)).toEqual(activities)
    await expect(getExternalActivities(f.authority, 1, f.session, 'wrong')).rejects.toThrow('AUTH_REQUIRED')
    expect(await client.call('revokeWriter', project)).toEqual({ revoked: true })
    await expect(client.call('stageChange', resume)).rejects.toThrow('WRITER_REVOKED')
  })

  it('targets a single writer across connections and revalidates the binding after file replacement', async () => {
    const f = await fixture()
    const previous = f.client('Previous Agent')
    const next = f.client('Next Agent')
    await previous.call('authorizeProject', project)
    await next.call('authorizeProject', project)
    await previous.call('acquireWriter', { ...project, expectedWriterEpoch: 0 })
    f.confirm.mockResolvedValueOnce('deny')
    await expect(next.call('takeOverWriter', { ...project, expectedWriterEpoch: 1 })).rejects.toThrow('AUTH_REQUIRED')
    await expect(previous.call('readWriterContext', project)).resolves.toMatchObject({ baseRevision: fingerprint })
    expect(await next.call('takeOverWriter', { ...project, expectedWriterEpoch: 1 })).toMatchObject({ writerEpoch: 2 })
    await expect(previous.call('readWriterContext', project)).rejects.toThrow('WRITER_REVOKED')

    const replacement = f.session.path + '.replacement'
    await writeFile(replacement, 'project-v1')
    await rename(replacement, f.session.path)
    await expect(next.call('getContext', project)).rejects.toThrow('AUTH_REQUIRED')
    await expect(next.call('readWriterContext', project)).rejects.toThrow('WRITER_REVOKED')
  })

  it('cancels a confirmation on trusted navigation even when the socket stays open', async () => {
    const f = await fixture()
    const client = f.client()
    const reached = deferred<AbortSignal>()
    const decision = deferred<'approve'>()
    f.confirm.mockImplementationOnce(async (_target, _name, _kind, signal) => {
      reached.resolve(signal)
      return decision.promise
    })
    const pending = client.call('authorizeProject', project)
    const rejected = expect(pending).rejects.toThrow('AUTH_REQUIRED')
    const signal = await reached.promise
    await f.authority.revokeWindow(1)
    expect(signal.aborted).toBe(true)
    decision.resolve('approve')
    await rejected
    await expect(client.call('getContext', project)).rejects.toThrow('AUTH_REQUIRED')
  })

  it('rejects late read or writer confirmations after disconnect and requires fresh authorization', async () => {
    const f = await fixture()
    const client = f.client()
    const newer = f.client('Replacement Agent')
    for (const method of ['authorizeProject', 'acquireWriter']) {
      const peer = method === 'authorizeProject' ? client : newer
      if (method === 'acquireWriter') await newer.call('authorizeProject', project)
      const reached = deferred<AbortSignal>()
      const decision = deferred<'approve'>()
      f.confirm.mockImplementationOnce(async (_target, _name, _kind, signal) => {
        reached.resolve(signal)
        return decision.promise
      })
      const slow = peer.call(method, method === 'authorizeProject' ? project : { ...project, expectedWriterEpoch: 0 })
      const rejected = expect(slow).rejects.toThrow('DESKTOP_DISCONNECTED')
      const signal = await reached.promise
      peer.close()
      await rejected
      await vi.waitFor(() => expect(signal.aborted).toBe(true))
      decision.resolve('approve')
    }
    const other = f.client('Third Agent')
    await expect(other.call('getContext', project)).rejects.toThrow('AUTH_REQUIRED')
    await other.call('authorizeProject', project)
    expect(await other.call('acquireWriter', { ...project, expectedWriterEpoch: 0 })).toMatchObject({ writerEpoch: 1 })
  })

  it('rejects a stage transaction interrupted before publication and retires the lease', async () => {
    const f = await fixture()
    const client = f.client()
    const next = f.client('Another Agent')
    await client.call('authorizeProject', project)
    await client.call('acquireWriter', { ...project, expectedWriterEpoch: 0 })
    f.state.fault = phase => {
      if (phase === 'beforeRename') {
        f.state.fault = undefined
        void f.endpoint?.close()
      }
    }
    await expect(client.call('stageChange', { ...project, change: { baseRevision: fingerprint,
      expectedDraftRevision: null, idempotencyKey: 'late', operation: { type: 'createSpacerDraft' }, sources: {} } }))
      .rejects.toThrow('DESKTOP_DISCONNECTED')
    await f.endpoint?.close()
    await f.start()
    await next.call('authorizeProject', project)
    expect(await next.call('getExternalActivities', project)).toEqual({ activities: [], draftRevision: null })
    expect(await next.call('acquireWriter', { ...project, expectedWriterEpoch: 2 })).toMatchObject({ writerEpoch: 3 })
  })
})
