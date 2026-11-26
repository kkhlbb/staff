import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { createLocalBridgeServer } from '../lib/localServer'
import { LocalM1Client } from '../localClient'
import { LocalM1Authority } from '../../desktop/main/project-agent/m1LocalAuthority'
import { startM1LocalEndpoint } from '../../desktop/main/project-agent/m1LocalEndpoint'
import { createNewProjectSnapshot } from '../../desktop/main/newProject'
import { encodeProjectFile } from '../../src/project-file/codec'
import { axis, face, model, part } from '../../src/core/solver/test/fixture'
import { gdtTools } from '../lib/gdt'

const approve = async () => 'approve' as const

afterEach(() => vi.unstubAllEnvs())

it.skipIf(process.platform !== 'darwin' || process.getuid?.() === 0)(
  'uses native local MCP authorization and writer leases for all GD&T tools while keeping official bytes', async () => {
    const root = await mkdtemp('/private/tmp/gdt-mcp-')
    const native = await mkdtemp(join(tmpdir(), 'gdt-native-'))
    const peerHelper = join(native, 'm1-peer')
    const socketPath = join(root, 'agent.sock')
    const projectPath = join(root, 'archive.cunlian')
    const client = new LocalM1Client({ executable: process.execPath, socketPath, peerHelper })
    const peer = new LocalM1Client({ executable: process.execPath, socketPath, peerHelper })
    const bridge = createLocalBridgeServer(client, async () => 'test')
    let endpoint: Awaited<ReturnType<typeof startM1LocalEndpoint>> | undefined
    try {
      execFileSync('/usr/bin/clang', ['desktop/main/project-agent/native/m1-peer.c', '-o', peerHelper])
      const snapshot = createNewProjectSnapshot({ name: 'GD&T', template: 'empty', appVersion: 'test', electronVersion: 'test' })
      const projectId = snapshot.project.id
      const assembly = model([part('base')], [
        face('plane', 'base', [0, 0, 0], [0, 0, 1]), axis('hole', 'base', [0, 0, 0], [0, 0, 1], 200),
      ])
      const step = Buffer.from('ISO-10303-21;\nEND-ISO-10303-21;')
      const sha256 = createHash('sha256').update(step).digest('hex')
      snapshot.project.assembly3d = assembly
      snapshot.project.stepAttachments = [{ id: 'step-a', fileName: 'fixture.step', blobKey: 'step' }]
      snapshot.attachments.push({ blobKey: 'step', bytes: step })
      snapshot.blobs.push({ projectId, blobKey: 'step', sha256, byteSize: step.length })
      const encoded = await encodeProjectFile(snapshot)
      if (!encoded.ok) throw Error(JSON.stringify(encoded.error))
      const bytes = Buffer.from(encoded.value.bytes)
      const baseRevision = createHash('sha256').update(bytes).digest('hex')
      await writeFile(projectPath, bytes)
      const authority = new LocalM1Authority({
        root: join(root, 'journal'), confirm: approve,
        sessionFor: id => id === 1 ? { projectId, sessionId: 'session', path: projectPath, fingerprint: baseRevision } : null,
      })
      endpoint = await startM1LocalEndpoint({ socketPath, peerHelper, authority, confirm: approve, selectWindow: () => 1 })
      const rpc = async (method: string, params?: object) => JSON.parse((await bridge.handleFrame(JSON.stringify({
        jsonrpc: '2.0', id: 1, method, params,
      })))!).result
      const call = (name: string, args: object) => rpc('tools/call', { name, arguments: args })
      await rpc('initialize', { clientInfo: { name: 'local test MCP' } })
      peer.initialize('second peer')
      vi.stubEnv('FEATURE_3D_ASSEMBLY_M1', 'false')
      expect((await rpc('tools/list')).tools.map((item: { name: string }) => item.name)).not.toContain('stage_datum')
      expect((await call('stage_datum', { projectId })).isError).toBe(true)
      // Establish a new client handshake when advertising a different host configuration.
      const enabledClient = new LocalM1Client({ executable: process.execPath, socketPath, peerHelper })
      const enabled = createLocalBridgeServer(enabledClient, async () => 'test')
      const enabledRpc = async (method: string, params?: object) => JSON.parse((await enabled.handleFrame(JSON.stringify({
        jsonrpc: '2.0', id: 2, method, params,
      })))!).result
      const invoke = (name: string, args: object) => enabledRpc('tools/call', { name, arguments: args })
      try {
        vi.stubEnv('FEATURE_3D_ASSEMBLY_M1', 'true')
        await enabledRpc('initialize', { clientInfo: { name: 'enabled test MCP' } })
        const listed = (await enabledRpc('tools/list')).tools
        for (const spec of gdtTools) expect(listed).toContainEqual({ ...spec, title: spec.name })
        expect((await invoke('stage_datum', { projectId })).isError).toBe(true)
        await invoke('authorizeProject', { projectId })
        const acquired = await invoke('acquireWriter', { projectId, expectedWriterEpoch: 0 })
        const writerEpoch = acquired.structuredContent.writerEpoch
        await peer.call('authorizeProject', { projectId })
        await expect(peer.call('acquireWriter', { projectId, expectedWriterEpoch: writerEpoch })).rejects.toThrow('WRITER_HELD')
        const citation = { kind: 'user-attestation', actorId: 'operator', at: '2026-11-25T00:00:00Z',
          sessionSeq: 1, sessionLabel: null, statement: 'Datum plane', fieldPath: 'datums.A' }
        const stage = { projectId, baseRevision, expectedDraftRevision: null, expectedWriterEpoch: writerEpoch,
          idempotencyKey: 'datum', items: [{ value: { id: 'A', label: 'A', featureId: 'plane' }, evidence: [citation] }] }
        expect((await invoke('stage_datum', { ...stage, items: [] })).isError).toBe(true)
        const datum = (await invoke('stage_datum', stage)).structuredContent
        expect(datum.draftRevision).toBeTruthy()
        expect((await invoke('stage_datum', stage)).structuredContent).toEqual(datum)
        const control = { ...stage, expectedDraftRevision: datum.draftRevision, idempotencyKey: 'control',
          items: [{ value: { id: 'P', kind: 'position', featureId: 'hole', toleranceQ: 100, datumIds: ['A'] }, evidence: [citation] }] }
        expect((await invoke('stage_gdt', { ...control, expectedDraftRevision: 'stale' })).isError).toBe(true)
        const gdt = (await invoke('stage_gdt', control)).structuredContent
        const analyzed = (await invoke('analyze_gdt_stackup', { projectId, draftRevision: gdt.draftRevision, expectedWriterEpoch: writerEpoch,
          monteCarlo: { seed: 5, samples: 10_000, distribution: 'uniform' }, edits: [{ gdtId: 'P', toleranceQ: 10 }] })).structuredContent
        expect(analyzed.baseline.contributions).toMatchObject([{ gdtId: 'P' }])
        expect(analyzed.whatIf.ppm).toBeGreaterThan(analyzed.baseline.ppm)
        await invoke('revokeWriter', { projectId })
        expect((await invoke('analyze_gdt_stackup', { projectId, draftRevision: gdt.draftRevision, expectedWriterEpoch: writerEpoch })).isError).toBe(true)
        expect(await readFile(projectPath)).toEqual(bytes)
      } finally {
        enabledClient.close()
      }
    } finally {
      client.close()
      peer.close()
      await endpoint?.close()
      await rm(root, { recursive: true, force: true })
      await rm(native, { recursive: true, force: true })
    }
  })

it('runs built-in GD&T with an approved PDF read and rejects manufactured evidence', async () => {
  const { createSampleSnapshot } = await import('../../src/project-file/__fixtures__/sampleProjectFile')
  const { MemoryKeychainStore } = await import('../../desktop/main/keychain')
  const { RealModelRuntime } = await import('../../desktop/main/realModelRuntime')
  const { M1ModelApi } = await import('../../desktop/main/project-agent/m1ModelApi')
  const { installM1WorkbenchChannels } = await import('../../desktop/main/project-agent/m1WorkbenchChannels')
  const { SenderGuard } = await import('../../desktop/main/senderGuard')
  const { createElectronTransport } = await import('../../src/transport/electronTransport')
  const root = await mkdtemp(join(tmpdir(), 'gdt-builtin-'))
  const file = join(root, 'project.cunlian')
  const snapshot = await createSampleSnapshot()
  const { id: projectId } = snapshot.project
  const project = { ...snapshot.project, assembly3d: model([{
    id: 'base', kind: 'parametric-primitive' as const, baseKind: 'plate' as const,
    nominalTransform: part('base').nominalTransform, displayName: 'Base', color: '#808080',
    sizeQ: { lengthQ: 20000, widthQ: 10000, thicknessQ: 4000 }, modifiers: [],
  }], [face('plane', 'base', [0, 0, 0], [0, 0, 1]), axis('hole', 'base', [0, 0, 0], [0, 0, 1], 500)]) }
  const encoded = await encodeProjectFile({ ...snapshot, project })
  if (!encoded.ok) throw Error(JSON.stringify(encoded.error))
  const bytes = Buffer.from(encoded.value.bytes)
  const session = { projectId, path: file, sessionId: 'session',
    fingerprint: createHash('sha256').update(bytes).digest('hex') }
  await writeFile(file, bytes)
  const authority = new LocalM1Authority({ root, confirm: approve, sessionFor: () => session })
  const sender = { webContentsId: 1, isMainFrame: true, frameUrl: null }
  await authority.authorize(sender, { projectId, requestId: 'authorize', requestGeneration: 1 })
  const caller = await authority.resolve(sender, session)
  if (!caller) throw Error('Missing authorization')
  type ModelBody = {
    tools: { function: { name: string } }[]
    messages: { role: string; content: string }[]
  }
  let nextTool = 'stage_datum'
  let forged = false
  let advertised: string[] = []
  let toolResult: Record<string, unknown> | undefined
  const fetchImpl: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'mock-model' }] })
    const body = JSON.parse(String(init?.body)) as ModelBody
    const value = (message: object) => Response.json({ choices: [{ message }] })
    const call = (name: string, args: object) => value({ content: null,
      tool_calls: [{ type: 'function', id: name, function: { name, arguments: JSON.stringify(args) } }] })
    const last = body.messages.at(-1)
    if (body.tools[0].function.name === 'm1_connection_probe') {
      return last?.role === 'tool' ? value({ content: JSON.parse(last.content).challenge }) : call('m1_connection_probe', {})
    }
    advertised = body.tools.map(entry => entry.function.name)
    if (last?.role === 'tool') {
      toolResult = JSON.parse(last.content)
      return value({ content: '已处理当前草稿。' })
    }
    if (!advertised.includes(nextTool)) return value({ content: '无可用工具。' })
    const message = JSON.parse(last!.content)
    const { draftRevision, ...context } = message.gdtWriterContext
    if (nextTool === 'analyze_gdt_stackup') return call(nextTool, { projectId, draftRevision,
      expectedWriterEpoch: context.expectedWriterEpoch, monteCarlo: { seed: 5, distribution: 'normal', samples: 1 } })
    const evidence = message.attachments[0].evidence
    return call(nextTool, { ...context, expectedDraftRevision: draftRevision, idempotencyKey: forged ? 'forged' : nextTool,
      items: [{ value: nextTool === 'stage_datum' ? { id: 'A', label: 'A', featureId: 'plane' }
        : { id: 'P', kind: 'position', toleranceQ: 200, featureId: 'hole', datumIds: ['A'] },
      evidence: [forged ? { ...evidence, statement: 'manufactured' } : evidence] }] })
  }
  const pdf = snapshot.revisions[0]
  const runtime = new RealModelRuntime({ rootDir: root, keychain: new MemoryKeychainStore(), fetchImpl })
  const api = new M1ModelApi(authority, runtime, { sender, projectId, sessionId: session.sessionId, scopeEpoch: 1, authorizationRef: caller.authorizationRef,
      isCurrent: () => true, readAttachment: async () => ({ excerpt: 'Fixture position control', page: 1,
        pdfSource: { kind: 'pdf-page', revisionId: pdf.id, sha256: pdf.sha256, page: 1 } }) })
  const frame = { url: 'file:///gdt-fixture' }
  const event = { sender: { id: 1, mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent
  const guard = new SenderGuard()
  guard.register({ webContentsId: 1, isDestroyed: () => false, isAllowedFrameUrl: url => url === frame.url })
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>()
  installM1WorkbenchChannels({ handle: (channel, handler) => handlers.set(channel, handler) }, {
    guard, authority, runtime, sessionFor: () => session, confirm: approve, endpoint: async () => undefined,
    installInfo() { throw Error('Unneeded fixture port') },
  })
  const invoke = (operation: string, request?: unknown) => handlers.get('cunlian:gdt')!(event, operation, request)
  const transport = createElectronTransport({ bridge: {
    getGdtCapability: () => invoke('capabilities'),
    stageDatum: (request: unknown) => invoke('stage_datum', request),
    stageGdt: (request: unknown) => invoke('stage_gdt', request),
    analyzeGdtStackup: (request: unknown) => invoke('analyze_gdt_stackup', request),
  } })
  try {
    expect(await api.testM1ModelApiConnection({ projectId, scopeEpoch: 1, requestId: 'probe',
      baseUrl: 'https://example.test/v1', model: 'mock-model', apiKey: 'test-key', contextPreview: false })).toMatchObject({ ok: true })
    const lease = await api.acquireWriter(0, approve)
    if (!lease.ok) throw Error(JSON.stringify(lease.error))
    const chat = (requestId: string) => api.sendM1ChatMessage({ projectId, scopeEpoch: 1,
      writerEpoch: lease.value.writerEpoch, requestId, prompt: 'GD&T fixture', attachments: ['document'], selectedObject: null, history: [] })
    vi.stubEnv('FEATURE_3D_ASSEMBLY_M1', 'false')
    expect(await transport.capabilities()).toMatchObject({ ok: true, value: { FEATURE_3D_ASSEMBLY_M1: false } })
    expect(await invoke('stage_datum', { projectId })).toMatchObject({ ok: false, error: { code: 'FEATURE_DISABLED' } })
    expect(await chat('off')).toMatchObject({ ok: true })
    expect(advertised).not.toContain(nextTool)
    vi.stubEnv('FEATURE_3D_ASSEMBLY_M1', 'true')
    forged = true
    expect(await chat('forged')).toMatchObject({ ok: false, error: { code: 'REFERENCE_STALE' } })
    expect((await authority.readContext(session, caller)).snapshot.draftRevision).toBeNull()
    forged = false
    for (const spec of gdtTools) {
      nextTool = spec.name
      expect(await chat(spec.name)).toMatchObject({ ok: true, value: { toolCalls: [{ name: spec.name, status: 'succeeded' }] } })
    }
    expect(toolResult).toMatchObject({ baseline: { contributions: [{ gdtId: 'P' }] } })
    expect(await transport.capabilities()).toMatchObject({ ok: true, value: { FEATURE_3D_ASSEMBLY_M1: true } })
    const request = { projectId, draftRevision: String(toolResult?.draftRevision), expectedWriterEpoch: lease.value.writerEpoch,
      monteCarlo: { seed: 12, samples: 10_000, distribution: 'uniform' as const } }
    await expect(transport.analyzeGdtStackup!(request)).resolves.toMatchObject({ ok: true,
      value: { baseline: { contributions: [{ gdtId: 'P' }] } } })
    await expect(transport.analyzeGdtStackup!({ ...request, expectedWriterEpoch: 0 })).resolves.toMatchObject({
      ok: false, error: { code: 'WRITER_REVOKED' },
    })
    await expect(transport.stageDatum!({ projectId, expectedWriterEpoch: lease.value.writerEpoch, baseRevision: session.fingerprint,
      expectedDraftRevision: null, idempotencyKey: 'ipc', items: [] })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(await readFile(file)).toEqual(bytes)
  } finally {
    await api.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
