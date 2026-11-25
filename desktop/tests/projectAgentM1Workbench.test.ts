import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { SafeStorageStore } from '../main/keychain'
import { LocalM1Authority } from '../main/project-agent/m1LocalAuthority'
import { M1InternalService } from '../main/project-agent/m1InternalService'
import { M1AgentRegistration } from '../main/project-agent/m1AgentRegistration'
import { getLocalAgentInstallInfo } from '../main/project-agent/m1LocalAgent'
import { startM1LocalEndpoint } from '../main/project-agent/m1LocalEndpoint'
import { localM1Socket } from '../main/project-agent/m1LocalTransport'
import { installM1WorkbenchChannels } from '../main/project-agent/m1WorkbenchChannels'
import { RealModelRuntime } from '../main/realModelRuntime'
import { SenderGuard } from '../main/senderGuard'
import { IPC_CHANNELS as ipc } from '../shared/contracts'
import type { M1ModelResult } from '../shared/project-agent/m1-model-api'
import type { M1WorkbenchEvent } from '../shared/project-agent/m1-workbench'

const cleanup: (() => unknown)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})
const project = { projectId: 'one-file' }
const initial = { ...project, scopeEpoch: 1 }
const approve = async () => 'approve' as const
const fingerprint = createHash('sha256').update('formal').digest('hex')
const authorizing = { ...project, requestId: 'native-read', requestGeneration: 1 }
const providerKey = 'fixture-secret-model-key'
type Endpoint = Awaited<ReturnType<typeof startM1LocalEndpoint>>

async function fixture(packaged = true) {
  const root = await mkdtemp('/private/tmp/dsh-m1-workbench-')
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'Project with spaces.cunlian')
  await writeFile(file, 'formal')
  let session = { ...project, sessionId: 'session', fingerprint, path: file }
  const sessionFor = (id: number) => id === 1 ? session : null
  const events: Array<{ id: string; value: M1WorkbenchEvent }> = []
  const frame = { url: 'file:///desktop.html',
    send: (channel: string, id: string, value: M1WorkbenchEvent) => {
      expect(channel).toBe(ipc.m1WorkbenchEvent)
      events.push({ id, value })
    } }
  const webContents = { id: 1, mainFrame: frame }
  const event = { sender: webContents, senderFrame: frame } as unknown as IpcMainInvokeEvent
  const guard = new SenderGuard()
  guard.register({ webContentsId: 1, isDestroyed: () => false, isAllowedFrameUrl: url => url === frame.url })
  const sender = { webContentsId: 1, isMainFrame: true, frameUrl: frame.url }
  let service!: M1InternalService
  const authority = new LocalM1Authority({ root: path.join(root, 'journal'), sessionFor, confirm: approve,
    onGrantInvalidated: id => invalidate(id),
    serviceFactory: dir => (service = new M1InternalService(dir)) })
  const runtime = new RealModelRuntime({ rootDir: root, keychain: new SafeStorageStore({
    filePath: path.join(root, 'keys.json'),
    safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value),
      decryptString: value => value.toString() },
  }) })
  const executable = path.join(root, '寸链.app/Contents/MacOS/寸链')
  const confirm = vi.fn<Parameters<typeof installM1WorkbenchChannels>[1]['confirm']>(approve)
  let endpoint: Endpoint | undefined
  type Handler = Parameters<Parameters<typeof installM1WorkbenchChannels>[0]['handle']>[1]
  const handlers = new Map<string, Handler>()
  const { invalidate } = installM1WorkbenchChannels({ handle: (key, handler) => { handlers.set(key, handler) } }, {
    guard, sessionFor, authority, runtime, confirm, endpoint: async () => endpoint,
    agents: new M1AgentRegistration({ home: root, platform: 'darwin', env: {} }),
    installInfo() {
      if (!packaged) throw Error('LOCAL_ENDPOINT_UNAVAILABLE')
      return getLocalAgentInstallInfo(executable, path.resolve(executable, '../../Resources'))
    },
    pollMs: 20,
  })
  cleanup.push(() => authority.revokeWindow(1))
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!(event, ...args)
  const subscribe = async (request: { projectId: string; scopeEpoch: number; afterSequence?: number }) => {
    const id = randomUUID()
    expect(await invoke(ipc.subscribeM1WorkbenchEvents, request, id)).toEqual({ ok: true, value: { subscriptionId: id } })
    return { rows: () => events.filter(entry => entry.id === id).map(entry => entry.value),
      unsubscribe: () => invoke(ipc.unsubscribeM1WorkbenchEvents, id) }
  }
  return { events, file, root, event, handlers, authority, sessionFor, confirm, invoke, subscribe, executable,
    authorize: () => authority.authorize(sender, authorizing),
    expire: () => service.expireHistoryForTest(project.projectId),
    context: async () => authority.readContext(session, (await authority.resolve(sender, session))!),
    revoke: () => authority.revokeRequested(sender, authorizing),
    navigate: () => { webContents.mainFrame = { ...frame }; return authority.revokeWindow(1) },
    changeSession: () => { session = { ...session, sessionId: 'replacement' }; return authority.revokeWindow(1) },
    setEndpoint: (value: Endpoint) => { endpoint = value; cleanup.push(endpoint.close) },
  }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
function value<T>(reply: M1ModelResult<unknown>): T {
  if (!reply.ok) throw Error(JSON.stringify(reply.error))
  return reply.value as T
}

async function stubModel() {
  let waitForProbe: (() => void) | undefined
  let held: 'probe' | 'chat' | undefined
  function suspend(res: import('node:http').ServerResponse) {
    res.on('close', () => probeClosed?.())
    waitForProbe?.()
  }
  let probeClosed: (() => void) | undefined
  const server = createServer(async (req, res) => {
    const reply = (json: object) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(json))
    if (req.url === '/v1/models') {
      if (held === 'probe') { suspend(res); return }
      reply({ data: [{ id: 'workbench-stub' }] })
      return
    }
    let raw = ''
    for await (const chunk of req) raw += String(chunk)
    const body = JSON.parse(raw) as { messages: { role: string; content: string; tool_call_id?: string }[];
      tools: { function: { name: string } }[] }
    const name = body.tools[0]!.function.name
    if (name === 'm1_stage_spacer' && held === 'chat') { suspend(res); return }
    const exchange = body.messages.findLast(row => row.role === 'tool')
    const message = exchange
      ? { content: name === 'm1_connection_probe' ? JSON.parse(exchange.content).challenge : '长度已更新。' }
      : { content: null, tool_calls: [{ id: 'stub-' + name, type: 'function',
        function: { name, arguments: JSON.stringify(name === 'm1_connection_probe' ? {} : { lengthQ: 450 }) } }] }
    reply({ choices: [{ message }] })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const addr = server.address() as { port: number }
  return { config: { ...initial, requestId: 'probe', baseUrl: `http://127.0.0.1:${addr.port}/v1`,
    model: 'workbench-stub', apiKey: providerKey, contextPreview: true },
  hold(kind: 'probe' | 'chat' = 'probe') {
    held = kind
    return { entered: new Promise<void>(resolve => { waitForProbe = resolve }),
      closed: new Promise<void>(resolve => { probeClosed = resolve }) }
  } }
}

it('registers all workbench transports and rejects renderer identity, generation and file spoofing', async () => {
  const f = await fixture()
  const channels = [ipc.detectM1LocalAgents, ipc.registerM1LocalAgent, ipc.listM1ModelApiModels,
    ipc.getM1LocalAgentInstallInfo, ipc.getM1ConnectionStatus, ipc.testM1ModelApiConnection,
    ipc.sendM1ChatMessage, ipc.cancelM1ChatMessage, ipc.getM1ExternalActivities, ipc.subscribeM1WorkbenchEvents,
    ipc.reconnectM1Session, ipc.takeoverM1Draft]
  for (const channel of channels) {
    const invoke = f.handlers.get(channel)!
    const subframe = { ...f.event, senderFrame: {} } as IpcMainInvokeEvent
    expect(await invoke(subframe)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN_SENDER' } })
  }
  expect(await f.invoke(ipc.getM1LocalAgentInstallInfo)).toMatchObject({ ok: true, value: {
    installPath: expect.stringContaining('寸链.app'), bridgeCommand: expect.stringContaining('cunlian-mcp'),
  } })
  expect(await f.invoke(ipc.getM1ConnectionStatus, initial)).toMatchObject({ ok: true,
    value: { connectionState: 'disconnected', authorizationState: 'unauthorized', draftRevision: null } })
  expect(await f.invoke(ipc.getM1ExternalActivities, initial)).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  await f.authorize()
  for (const patch of [{ path: f.file }, { authorizationRef: 'forged' }, { sender: 1 }]) {
    expect(await f.invoke(ipc.getM1ConnectionStatus, { ...initial, ...patch }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
  }
  for (const patch of [{ projectId: 'other' }, { scopeEpoch: 99 }]) {
    expect(await f.invoke(ipc.getM1ConnectionStatus, { ...initial, ...patch }))
      .toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  }
  await writeFile(f.file, 'file replaced')
  expect(await f.invoke(ipc.getM1ExternalActivities, initial)).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
})

it('registers local clients through the guarded IPC and reports unavailable unpackaged bridges', async () => {
  const unpackaged = await fixture(false)
  const request = { agentId: 'windsurf' }
  expect(await unpackaged.invoke(ipc.detectM1LocalAgents)).toMatchObject({ ok: true, value: { agents: expect.any(Array) } })
  expect(await unpackaged.invoke(ipc.registerM1LocalAgent, request))
    .toMatchObject({ ok: false, error: { code: 'LOCAL_ENDPOINT_UNAVAILABLE' } })

  const f = await fixture()
  expect(await f.invoke(ipc.registerM1LocalAgent, { ...request, bridgeCommand: '/forged' }))
    .toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
  expect(await f.invoke(ipc.registerM1LocalAgent, request))
    .toMatchObject({ ok: true, value: { ...request, configured: true, backupPath: null } })
  const detected = value<{ agents: { id: string; configured: boolean }[] }>(await f.invoke(ipc.detectM1LocalAgents))
  expect(detected.agents.find(agent => agent.id === request.agentId)).toMatchObject({ configured: true })
})

it('validates the project generation and lists models without probing or storing credentials', async () => {
  const f = await fixture()
  const { config } = await stubModel()
  const request = { ...initial, requestId: 'models', baseUrl: config.baseUrl, apiKey: '' }
  expect(await f.invoke(ipc.listM1ModelApiModels, request)).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  await f.authorize()
  for (const patch of [{ projectId: 'other' }, { scopeEpoch: 2 }]) {
    expect(await f.invoke(ipc.listM1ModelApiModels, { ...request, ...patch }))
      .toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  }
  expect(await f.invoke(ipc.listM1ModelApiModels, { ...request, apiKey: providerKey })).toEqual({
    ok: true, value: { models: ['workbench-stub'], defaultModel: 'workbench-stub' },
  })
  await expect(readFile(path.join(f.root, 'keys.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await f.invoke(ipc.getM1ConnectionStatus, initial)).toMatchObject({ ok: true,
    value: { connectionState: 'disconnected', source: 'none' } })
})

it.each(['revoke', 'navigate', 'changeSession'] as const)('drops subscriptions and aborts HTTP after %s', async action => {
  const f = await fixture()
  const model = await stubModel()
  await f.authorize()
  const stream = await f.subscribe({ ...initial, afterSequence: 0 })
  const hold = model.hold()
  const pending = f.invoke(ipc.testM1ModelApiConnection, model.config)
  await hold.entered
  await f[action]()
  await hold.closed
  expect(await pending).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  expect(stream.rows()).toEqual([])
})


it('keeps a revoked scope stale after the same document is reauthorized', async () => {
  const f = await fixture()
  await f.authorize()
  expect(await f.invoke(ipc.getM1ExternalActivities, initial)).toMatchObject({ ok: true })
  await f.revoke()
  await f.authorize()
  expect(await f.invoke(ipc.getM1ExternalActivities, initial))
    .toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED', detail: '2' } })
  expect(await f.invoke(ipc.getM1ExternalActivities, { ...initial, scopeEpoch: 2 })).toMatchObject({ ok: true })
})

it('cancels only a matching model request in the same scope', async () => {
  const f = await fixture()
  const model = await stubModel()
  await f.authorize()
  expect(await f.invoke(ipc.testM1ModelApiConnection, model.config)).toMatchObject({ ok: true })
  const hold = model.hold('chat')
  const pending = f.invoke(ipc.sendM1ChatMessage, { ...initial, requestId: 'chat',
    writerEpoch: 0, prompt: '创建隔套', attachments: [], selectedObject: null, history: [] })
  await hold.entered
  expect(await f.invoke(ipc.cancelM1ChatMessage, { ...initial, requestId: 'chat' }))
    .toEqual({ ok: true, value: { cancelled: true } })
  await hold.closed
  expect(await pending).toMatchObject({ ok: false, error: { code: 'CANCELLED' } })
})

async function stdioAgent(f: Fixture) {
  const resources = path.join(f.root, 'agent-resource')
  execFileSync(process.execPath, ['--input-type=module', '-e',
    "import { buildLocalAgent } from './scripts/build-local-agent.mjs'; await buildLocalAgent(process.arch, process.argv[1])", resources])
  await mkdir(path.dirname(f.executable), { recursive: true })
  await writeFile(f.executable, '')
  const endpoint = await startM1LocalEndpoint({ authority: f.authority, socketPath: localM1Socket(f.executable),
    peerHelper: path.join(resources, 'm1-peer'), selectWindow: () => 1, confirm: approve })
  f.setEndpoint(endpoint)
  async function connect() {
    const child = spawn(process.execPath, [path.join(resources, 'local-bridge.mjs'), f.executable], { stdio: ['pipe', 'pipe', 'inherit'] })
    const close = () => {
      if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
      const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()) })
      child.stdin.end()
      return exited
    }
    cleanup.push(close)
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
    let next = 0
    async function rpc(method: string, params: object) {
      const id = ++next
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      const line = await lines.next()
      if (line.done) throw Error('Local bridge closed its stdout')
      const response = JSON.parse(line.value)
      expect(response.id).toBe(id)
      return response.result as { isError?: boolean; structuredContent?: Record<string, unknown>; content: { text: string }[] }
    }
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Stdio fixture', version: '1' } })
    child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
    await rpc('tools/list', {})
    return { close, call: (name: string, args: object) => rpc('tools/call', { name, arguments: args }) }
  }
  return connect
}

it.skipIf(process.platform !== 'darwin' || process.getuid?.() === 0)(
  'replays the real MCP stdio → IPC takeover → HTTP stub chain on one authorized file', async () => {
    const f = await fixture()
    const model = await stubModel()
    const connect = await stdioAgent(f)
    const { call, close } = await connect()
    expect(await f.invoke(ipc.getM1ConnectionStatus, initial)).toMatchObject({ ok: true,
      value: { connectionState: 'connected', authorizationState: 'unauthorized', clientName: 'Stdio fixture' } })
    await f.authorize()
    expect(await f.invoke(ipc.reconnectM1Session, { ...initial, source: 'local-agent', requestId: 'unbound' }))
      .toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
    expect((await call('authorizeProject', project)).isError).not.toBe(true)
    expect((await call('acquireWriter', { ...project, expectedWriterEpoch: 0 })).structuredContent?.writerEpoch).toBe(1)
    const change = { baseRevision: fingerprint, expectedDraftRevision: null, idempotencyKey: 'external-create',
      operation: { type: 'createSpacerDraft', innerDiameterQ: 100, outerDiameterQ: 200, lengthQ: 300 },
      sources: Object.fromEntries(['innerDiameterQ', 'outerDiameterQ', 'lengthQ'].map(key => [key, { type: 'userInput' }])) }
    let confirmStarted!: () => void
    let approveLater!: (decision: 'approve') => void
    const entered = new Promise<void>(resolve => { confirmStarted = resolve })
    f.confirm.mockImplementationOnce(() => {
      confirmStarted()
      return new Promise(resolve => { approveLater = resolve })
    })
    const pendingTakeover = f.invoke(ipc.takeoverM1Draft, { ...project, requestId: 'during-edit',
      draftRevision: null, previousScopeEpoch: 1, nextScopeEpoch: 2, targetSource: 'model-api' })
    await entered
    const first = (await call('stageChange', { ...project, change })).structuredContent!
    approveLater('approve')
    expect(await pendingTakeover).toMatchObject({ ok: false, error: { code: 'STALE_BASE' } })
    expect(first.draftRevision).toEqual(expect.any(String))
    expect((await call('stageChange', { ...project, change })).structuredContent).toEqual(first)
    const stream = await f.subscribe({ ...initial, afterSequence: 0 })
    await vi.waitFor(() => expect(stream.rows().map(row => row.sequence)).toEqual([1, 2, 3]))
    expect(await f.invoke(ipc.getM1ExternalActivities, initial)).toMatchObject({ ok: true,
      value: { draftRevision: first.draftRevision, activities: [{ projectId: project.projectId, status: 'succeeded', title: '隔套草稿' }] } })
    expect(await f.invoke(ipc.reconnectM1Session, { ...initial, source: 'local-agent', requestId: 'reconnect-a' }))
      .toMatchObject({ ok: true, value: { draftRevision: first.draftRevision, writerEpoch: 1 } })
    expect(await f.invoke(ipc.testM1ModelApiConnection, model.config)).toMatchObject({ ok: true,
      value: { selectedModel: 'workbench-stub', toolRoundTripPassed: true } })
    const takeover = { ...project, requestId: 'handoff', draftRevision: first.draftRevision, previousScopeEpoch: 1,
      nextScopeEpoch: 2, targetSource: 'model-api' }
    f.confirm.mockResolvedValueOnce('deny')
    expect(await f.invoke(ipc.takeoverM1Draft, takeover)).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
    expect(await f.invoke(ipc.takeoverM1Draft, { ...takeover, draftRevision: 'wrong' }))
      .toMatchObject({ ok: false, error: { code: 'STALE_BASE' } })
    expect(await f.invoke(ipc.takeoverM1Draft, takeover)).toMatchObject({ ok: true, value: { ...project,
      draftRevision: first.draftRevision, writerEpoch: 2, scopeEpoch: 2, writerOwner: 'model-api', revokedPreviousWriter: true } })
    expect(await f.invoke(ipc.takeoverM1Draft, takeover)).toMatchObject({ ok: true, value: { scopeEpoch: 2, writerEpoch: 2 } })
    const streamCut = stream.rows().length
    expect(JSON.parse((await call('stageChange', { ...project, change })).content[0]!.text).error.code).toBe('WRITER_REVOKED')
    expect(await f.invoke(ipc.getM1ConnectionStatus, initial)).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
    const next = { ...project, scopeEpoch: 2 }
    const resumed = await f.subscribe({ ...next, afterSequence: stream.rows().at(-1)!.sequence })
    const chat = value<{ draftRevision: string }>(await f.invoke(ipc.sendM1ChatMessage, { ...next, requestId: 'update-length',
      writerEpoch: 2, prompt: '把隔套长度改为 0.045 毫米。', attachments: [], selectedObject: null, history: [] }))
    expect(chat.draftRevision).not.toBe(first.draftRevision)
    await vi.waitFor(() => expect(resumed.rows().some(row => row.draftRevision === chat.draftRevision)).toBe(true))
    expect(stream.rows()).toHaveLength(streamCut)
    const sequences = resumed.rows().map(row => row.sequence)
    expect(sequences).toEqual([...new Set(sequences)].sort((a, b) => a - b))
    expect((await f.context()).snapshot.spacerDraft).toMatchObject({ ...first, lengthQ: 450, draftRevision: chat.draftRevision })
    expect(await f.invoke(ipc.reconnectM1Session, { ...next, source: 'model-api', requestId: 'reconnect-b' }))
      .toMatchObject({ ok: true, value: { baseRevision: fingerprint, draftRevision: chat.draftRevision, writerEpoch: 2 } })
    await f.expire()
    const expired = await f.subscribe({ ...next, afterSequence: 0 })
    await vi.waitFor(() => expect(expired.rows()[0]).toMatchObject({ type: 'snapshot_required',
      draftRevision: chat.draftRevision, writerEpoch: 2, snapshot: { draftRevision: chat.draftRevision },
      activities: [{ draftRevision: first.draftRevision }] }))
    const secondChat = value<{ draftRevision: string }>(await f.invoke(ipc.sendM1ChatMessage, {
      ...next, requestId: 'post-snapshot', writerEpoch: 2, prompt: '确认新的长度', attachments: [], selectedObject: null, history: [],
    }))
    await vi.waitFor(() => expect(expired.rows().at(-1)).toMatchObject({ type: 'draft_updated',
      draftRevision: secondChat.draftRevision }))
    expect(expired.rows().at(-1)!.sequence).toBeGreaterThan(expired.rows()[0]!.sequence)
    await expired.unsubscribe()
    const back = await f.invoke(ipc.takeoverM1Draft, { ...project, requestId: 'return-to-agent',
      draftRevision: secondChat.draftRevision, previousScopeEpoch: 2, nextScopeEpoch: 3, targetSource: 'local-agent' })
    expect(back).toMatchObject({ ok: true, value: { scopeEpoch: 3, writerEpoch: 3, writerOwner: 'Stdio fixture' } })
    expect((await call('readWriterContext', project)).structuredContent)
      .toMatchObject({ baseRevision: fingerprint, draftRevision: secondChat.draftRevision })
    const localScope = { ...project, scopeEpoch: 3 }
    const beforeDisconnect = (await f.context()).snapshot.cursor
    const disconnectEvents = await f.subscribe({ ...localScope, afterSequence: beforeDisconnect })
    await vi.waitFor(async () => {
      expect(await f.invoke(ipc.getM1ConnectionStatus, localScope)).toMatchObject({ ok: true, value: { writerEpoch: 3 } })
    })
    await close()
    const localReconnect = { ...localScope, source: 'local-agent', requestId: 'local-reconnect' }
    await vi.waitFor(async () => expect(await f.invoke(ipc.reconnectM1Session, localReconnect))
      .toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } }))
    await vi.waitFor(() => expect(disconnectEvents.rows().some(row =>
      row.type === 'connection_changed' && row.connectionState === 'disconnected')).toBe(true))
    const reconnected = await connect()
    expect((await reconnected.call('authorizeProject', project)).isError).not.toBe(true)
    expect(await f.invoke(ipc.reconnectM1Session, localReconnect)).toMatchObject({ ok: true, value: {
      baseRevision: fingerprint, connectionState: 'connected', authorizationState: 'authorized-readonly',
      writerEpoch: 4, draftRevision: secondChat.draftRevision,
    } })
    await vi.waitFor(() => expect(disconnectEvents.rows().at(-1)).toMatchObject({
      type: 'connection_changed', connectionState: 'connected', clientName: 'Stdio fixture',
    }))
    await disconnectEvents.unsubscribe()
    expect(await readFile(f.file, 'utf8')).toBe('formal')
  }, 20_000,
)
