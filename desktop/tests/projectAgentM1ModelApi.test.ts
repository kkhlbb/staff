import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { SafeStorageStore } from '../main/keychain'
import { LocalM1Authority, type M1WriterLease } from '../main/project-agent/m1LocalAuthority'
import { M1InternalService } from '../main/project-agent/m1InternalService'
import { M1ModelApi } from '../main/project-agent/m1ModelApi'
import { RealModelRuntime } from '../main/realModelRuntime'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const secret = 'stub-key-with-secret-content'
const approve = async () => 'approve' as const
const identity = { projectId: 'stub-project', scopeEpoch: 5 }
const sender = { webContentsId: 1, isMainFrame: true, frameUrl: null }
type Message = { role: string; content: string; tool_call_id?: string; tool_calls?: { id: string }[] }
type RequestBody = { model: string; messages: Message[]; tools: { function: { name: string } }[] }
type Handler = (body: RequestBody, res: ServerResponse) => void

function respond(res: ServerResponse, body: object, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}
const reply = (res: ServerResponse, content: string) => respond(res, { choices: [{ message: { content } }] })
const tool = (res: ServerResponse, id: string, name: string, args: object) => respond(res, { choices: [{ message: {
  content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
} }] })
const packet = (body: RequestBody) => body.messages.findLast(row => row.role === 'tool')
const result = (body: RequestBody) => JSON.parse(packet(body)?.content ?? '{}') as Record<string, unknown>

async function readBody(req: IncomingMessage): Promise<RequestBody> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as RequestBody
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'm1-model-'))
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }))
  const projectPath = path.join(root, 'private-project-path.cunlian')
  const document = 'private project file data'
  await fs.writeFile(projectPath, document)
  const journalRoot = path.join(root, 'authority')
  const session = { sessionId: 'native', projectId: identity.projectId, path: projectPath,
    fingerprint: createHash('sha256').update(document).digest('hex') }
  const state: {
    listStatus: number; completionStatus: number; current: boolean; models: string[];
    probe?: Handler; chat?: Handler; fault?: (phase: string) => void;
  } = { listStatus: 200, completionStatus: 200, current: true, models: ['test-model', 'other-model', secret] }
  const authority = new LocalM1Authority({
    root: journalRoot, sessionFor: window => window === 1 ? session : null, confirm: approve,
    serviceFactory: dir => new M1InternalService(dir, phase => state.fault?.(phase)),
  })
  await authority.authorize(sender, { projectId: identity.projectId, requestId: 'auth', requestGeneration: 5 })
  const caller = await authority.resolve(sender, session)
  if (!caller) throw Error('Missing fixture authorization')
  const scope = { ...identity, sender, sessionId: session.sessionId, authorizationRef: caller.authorizationRef,
    isCurrent: () => state.current,
    readAttachment: async (id: string) => id === 'doc' ? { excerpt: 'Authorized excerpt ' + secret, page: 2 } : null,
    readSelectedObject: async (id: string) => id === 'spacer' ? 'Authorized selection' : null }
  const requests: RequestBody[] = []
  const authHeaders: (string | undefined)[] = []
  const failures: unknown[] = []
  const server = createServer((req, res) => {
    authHeaders.push(req.headers.authorization)
    if (req.url === '/v1/models') {
      respond(res, state.listStatus === 200 ? { data: state.models.map(id => ({ id })) }
        : { error: { message: secret } }, state.listStatus)
      return
    }
    if (req.url !== '/v1/chat/completions') {
      respond(res, {}, 404)
      return
    }
    void readBody(req).then(body => {
      requests.push(body)
      if (state.completionStatus !== 200) {
        respond(res, { error: { message: secret } }, state.completionStatus)
        return
      }
      if (body.tools[0]?.function.name === 'm1_connection_probe') {
        if (state.probe) state.probe(body, res)
        else if (packet(body)) reply(res, String(result(body).challenge))
        else tool(res, 'provider-probe-id', 'm1_connection_probe', {})
      } else if (state.chat) state.chat(body, res)
      else if (packet(body)) reply(res, '处理完成 ' + secret)
      else tool(res, 'provider-stage-id', 'm1_stage_spacer', { innerDiameterQ: 100, outerDiameterQ: 200, lengthQ: 300 })
    }).catch(error => {
      failures.push(error)
      respond(res, {}, 500)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    expect(failures).toEqual([])
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('Stub unavailable')
  const config = { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'test-model', apiKey: secret,
    requestId: 'probe', contextPreview: true, ...identity }
  const keyFile = path.join(root, 'encrypted-keys.json')
  // Fake the OS encryption primitive only. The real repository safeStorage store writes the file.
  const keychain = () => new SafeStorageStore({ filePath: keyFile, safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value.split('').reverse().join('')),
    decryptString: value => value.toString().split('').reverse().join(''),
  } })
  const makeApi = () => new M1ModelApi(authority, new RealModelRuntime({ rootDir: root, keychain: keychain() }), scope)
  const api = makeApi()
  cleanups.push(() => api.dispose())
  const connect = () => api.testM1ModelApiConnection(config)
  const chat = (requestId: string, extra: Record<string, unknown> = {}) => api.sendM1ChatMessage({
    ...identity, writerEpoch: 1, requestId, prompt: '创建隔套', attachments: [], selectedObject: null, history: [], ...extra,
  })
  const context = () => authority.readContext(session, caller)
  const journal = async () => {
    const [binding] = await fs.readdir(path.join(journalRoot, 'bindings'))
    const dir = path.join(journalRoot, 'bindings', binding)
    const file = (await fs.readdir(dir)).find(name => name.endsWith('.json'))
    return file ? fs.readFile(path.join(dir, file), 'utf8') : ''
  }
  const writerRequest = (expectedWriterEpoch: number) => ({ windowId: 1, sessionId: session.sessionId,
    projectId: session.projectId, expectedWriterEpoch })
  return { state, authority, api, config, connect, chat, context, journal, writerRequest, requests, authHeaders, keyFile, makeApi }
}

it.each([401, 403])('maps HTTP %i on list and completion to AUTH_FAILED without returning the body', async status => {
  const f = await fixture()
  f.state.listStatus = status
  for (const endpoint of ['list', 'completion']) {
    if (endpoint === 'completion') {
      f.state.listStatus = 200
      f.state.completionStatus = status
    }
    const response = await f.connect()
    expect(response).toMatchObject({ ok: false, error: { code: 'AUTH_FAILED' } })
    expect(JSON.stringify(response)).not.toContain(secret)
  }
  expect(await f.chat('chat')).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
})

it('requires a listed model and distinguishes missing tool support from a failed round trip', async () => {
  const f = await fixture()
  expect(await f.api.testM1ModelApiConnection({ ...f.config, apiKey: '' }))
    .toMatchObject({ ok: false, error: { code: 'INVALID_API_KEY' } })
  expect(await f.api.testM1ModelApiConnection({ ...f.config, model: 'not-listed' }))
    .toMatchObject({ ok: false, error: { code: 'MODEL_UNAVAILABLE' } })
  f.state.probe = (_, res) => respond(res, { error: { message: 'function calling tools are unavailable' } }, 400)
  expect(await f.connect()).toMatchObject({ ok: false, error: { code: 'TOOL_CALL_UNSUPPORTED' } })
  f.state.probe = (_, res) => reply(res, 'plain text only')
  expect(await f.connect()).toMatchObject({ ok: false, error: { code: 'TOOL_CALL_UNSUPPORTED' } })
  f.state.probe = (body, res) => packet(body) ? reply(res, 'wrong challenge') : tool(res, 'original', 'm1_connection_probe', {})
  expect(await f.connect()).toMatchObject({ ok: false, error: { code: 'TOOL_ROUNDTRIP_FAILED' } })
  expect(await f.chat('chat')).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
})

it('rejects an invented probe ID and a stale scope before sending context', async () => {
  const f = await fixture()
  f.state.probe = (_, res) => respond(res, { choices: [{ message: { tool_calls: [
    { type: 'function', function: { name: 'm1_connection_probe', arguments: '{}' } },
  ] } }] })
  expect(await f.connect()).toMatchObject({ ok: false, error: { code: 'TOOL_ROUNDTRIP_FAILED' } })
  expect(f.requests).toHaveLength(1)
  f.state.current = false
  expect(await f.connect()).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  expect(f.requests).toHaveLength(1)
})

it('validates the nonce and preserves the original probe ID, sending only the authorized summary', async () => {
  const f = await fixture()
  const probe = await f.connect()
  expect(probe).toMatchObject({ ok: true, value: { availableModels: ['test-model', 'other-model', '[已隐藏]'],
    selectedModel: 'test-model', toolCallSupported: true, toolRoundTripPassed: true, toolRoundTripName: 'm1_connection_probe',
    sentContextSummary: '{"draftPresent":false,"spacerDimensionsQ":null}' } })
  expect(probe.ok && probe.value.toolRoundTripLatencyMs).toBeGreaterThanOrEqual(0)
  expect(f.requests[0]?.messages[1]?.content).toContain(probe.ok && probe.value.sentContextSummary)
  expect(f.requests[1]?.messages.at(-2)?.tool_calls?.[0]?.id).toBe('provider-probe-id')
  expect(f.requests[1] && packet(f.requests[1])?.tool_call_id).toBe('provider-probe-id')
  expect(f.authHeaders.every(header => header === 'Bearer ' + secret)).toBe(true)
  expect(JSON.stringify(f.requests)).not.toMatch(/stub-project|private-project-path|private project file data|stub-key-with-secret-content/u)
  expect(await fs.readFile(f.keyFile, 'utf8')).not.toContain(secret)
  const restarted = f.makeApi()
  expect(await restarted.testM1ModelApiConnection({ ...f.config, apiKey: '', contextPreview: false }))
    .toMatchObject({ ok: true })
  expect(f.requests.at(-1)?.messages[1]?.content).not.toContain('draftPresent')
  await restarted.dispose()
})

it('answers a clarification and resumes the same task via original tool IDs and trusted references', async () => {
  const f = await fixture()
  await f.connect()
  expect(await f.api.acquireWriter(0, approve)).toEqual({ ok: true, value: { writerEpoch: 1 } })
  let turn = 0
  f.state.chat = (body, res) => {
    if (packet(body)) {
      expect(body.messages.at(-2)?.tool_calls?.[0]?.id).toBe('spacer-call-' + turn)
      expect(packet(body)?.tool_call_id).toBe('spacer-call-' + turn)
      expect(result(body).status).toBe(turn === 1 ? 'awaitingInput' : 'succeeded')
      reply(res, '已处理 ' + secret)
    } else if (++turn === 1) {
      tool(res, 'spacer-call-1', 'm1_stage_spacer', { innerDiameterQ: 100, outerDiameterQ: 200, documentSources: { outerDiameterQ: 0 } })
    } else {
      expect(body.messages.at(-1)?.content).toContain('innerDiameterQ')
      tool(res, 'spacer-call-2', 'm1_stage_spacer', { lengthQ: 300 })
    }
  }
  const first = await f.chat('spacer-1', { attachments: ['doc'], selectedObject: 'spacer', prompt: '用 ' + secret + ' 创建隔套' })
  expect(first).toMatchObject({ ok: true, value: { reply: expect.stringContaining('lengthQ'),
    toolCalls: [{ name: 'm1_stage_spacer', status: 'awaitingInput', taskId: expect.any(String) }] } })
  expect((await f.context()).snapshot.draftRevision).toBeNull()
  const taskId = first.ok && first.value.toolCalls?.[0]?.taskId
  const second = await f.chat('spacer-2', { prompt: '长度 0.03 mm', history: [{ role: 'assistant', content: '请补充长度' }] })
  expect(second).toMatchObject({ ok: true, value: { reply: '已处理 [已隐藏]', draftRevision: expect.any(String),
    toolCalls: [{ name: 'm1_stage_spacer', status: 'succeeded', taskId }] } })
  const context = await f.context()
  expect(context.activities.filter(a => a.taskId === taskId)).toEqual([expect.objectContaining({ status: 'succeeded' })])
  expect(context.snapshot.spacerDraft).toMatchObject({ innerDiameterQ: 100, outerDiameterQ: 200, lengthQ: 300,
    sources: { outerDiameterQ: { type: 'document', anchor: { page: 2, excerpt: 'Authorized excerpt [已隐藏]' } } } })
  expect(JSON.stringify(f.requests)).not.toContain(secret)
  expect(await f.journal()).not.toContain(secret)
})

it('rejects injected tools, renderer file references, and extra tool arguments without a write', async () => {
  const f = await fixture()
  await f.connect()
  await f.api.acquireWriter(0, approve)
  expect(await f.chat('bad-ref', { attachments: ['/tmp/private'] })).toMatchObject({ ok: false, error: { code: 'REFERENCE_STALE' } })
  f.state.chat = (_, res) => tool(res, 'id', 'takeOverWriter', {})
  expect(await f.chat('escalation')).toMatchObject({ ok: false, error: { code: 'INVALID_TOOL_CALL' } })
  f.state.chat = (_, res) => tool(res, 'id', 'm1_stage_spacer', { innerDiameterQ: 100, taskId: 'untrusted' })
  expect(await f.chat('spoof-task')).toMatchObject({ ok: false, error: { code: 'INVALID_TOOL_CALL' } })
  expect((await f.context()).activities).toHaveLength(0)
})

it('aborts an in-flight HTTP request and ignores a late tool completion', async () => {
  const f = await fixture()
  await f.connect()
  await f.api.acquireWriter(0, approve)
  let enter!: (res: ServerResponse) => void
  const entered = new Promise<ServerResponse>(resolve => { enter = resolve })
  f.state.chat = (_, res) => enter(res)
  const pending = f.chat('cancel-network')
  const response = await entered
  const closed = new Promise<void>(resolve => { response.once('close', resolve) })
  expect(await f.api.cancelM1ChatMessage({ ...identity, requestId: 'cancel-network' })).toEqual({ ok: true, value: { cancelled: true } })
  await closed
  tool(response, 'late', 'm1_stage_spacer', { innerDiameterQ: 100, outerDiameterQ: 200, lengthQ: 300 })
  expect(await pending).toMatchObject({ ok: false, error: { code: 'CANCELLED' } })
  expect((await f.context()).snapshot.draftRevision).toBeNull()
  expect((await f.context()).activities).toHaveLength(0)
})

it('cancels at the transaction commit boundary without discarding the writer or overwriting draft state', async () => {
  const f = await fixture()
  await f.connect()
  await f.api.acquireWriter(0, approve)
  const before = await f.journal()
  f.state.fault = phase => {
    if (phase === 'beforeRename') {
      f.state.fault = undefined
      void f.api.cancelM1ChatMessage({ ...identity, requestId: 'cancel-commit' })
    }
  }
  expect(await f.chat('cancel-commit')).toMatchObject({ ok: false, error: { code: 'CANCELLED' } })
  expect(await f.journal()).toBe(before)
  expect(await f.chat('fresh')).toMatchObject({ ok: true, value: { draftRevision: expect.any(String) } })
})

it('distinguishes external writer conflict, trusted takeover, and external revocation during a chat', async () => {
  const f = await fixture()
  await f.connect()
  expect(await f.chat('no-writer')).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  const externalSignal = new AbortController()
  const external = await f.authority.authorizeExternal(1, identity.projectId, externalSignal.signal, approve)
  const acquireExternal = (epoch: number, takeover: boolean): Promise<M1WriterLease> => takeover
    ? f.authority.takeOverWriter(f.writerRequest(epoch), approve, external)
    : f.authority.acquireWriter(f.writerRequest(epoch), approve, external)
  await acquireExternal(0, false)
  expect(await f.api.acquireWriter(1, approve)).toMatchObject({ ok: false, error: { code: 'WRITER_HELD' } })
  expect(await f.chat('external-writer')).toMatchObject({ ok: false, error: { code: 'WRITER_HELD' } })
  expect(await f.api.takeOverWriter(1, async () => 'deny')).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  expect(await f.api.takeOverWriter(1, approve)).toEqual({ ok: true, value: { writerEpoch: 2 } })
  let enter!: (res: ServerResponse) => void
  const entered = new Promise<ServerResponse>(resolve => { enter = resolve })
  f.state.chat = (_, res) => enter(res)
  const pending = f.chat('revoked', { writerEpoch: 2 })
  const response = await entered
  const winning = await acquireExternal(2, true)
  tool(response, 'late-writer', 'm1_stage_spacer', { innerDiameterQ: 100, outerDiameterQ: 200, lengthQ: 300 })
  expect(await pending).toMatchObject({ ok: false, error: { code: 'WRITER_REVOKED' } })
  expect((await f.authority.readWriterContext(winning)).draftRevision).toBeNull()
  expect((await f.context()).activities).toHaveLength(0)
  await f.authority.revokeExternal(external)
})

it('keeps the committed draft when the provider disconnects before the final reply', async () => {
  const f = await fixture()
  await f.connect()
  await f.api.acquireWriter(0, approve)
  f.state.chat = (body, res) => {
    if (packet(body)) res.destroy()
    else tool(res, 'commit-then-disconnect', 'm1_stage_spacer', { innerDiameterQ: 100, outerDiameterQ: 200, lengthQ: 300 })
  }
  expect(await f.chat('disconnect')).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
  expect((await f.context()).snapshot.spacerDraft).toMatchObject({ lengthQ: 300 })
  expect(await f.chat('second')).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
})

it('keeps concurrent credential profiles in the same safeStorage file', async () => {
  const f = await fixture()
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value.split('').reverse().join('')),
    decryptString: (value: Buffer) => value.toString().split('').reverse().join(''),
  }
  const store = new SafeStorageStore({ filePath: f.keyFile, safeStorage })
  await Promise.all([store.write('first', secret), store.write('second', 'another-secret')])
  const reopened = new SafeStorageStore({ filePath: f.keyFile, safeStorage })
  expect(await reopened.read('first')).toBe(secret)
  expect(await reopened.read('second')).toBe('another-secret')
})
