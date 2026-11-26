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
import { compliantTools } from '../lib/compliant'
import reportCatalog from '../../cloud/contracts/mcp-report-tools.json' with { type: 'json' }

const reportTool = reportCatalog.tools[0]!

const approve = async () => 'approve' as const

afterEach(() => vi.unstubAllEnvs())

it.skipIf(process.platform !== 'darwin' || process.getuid?.() === 0)(
  'wires stage_physics, import_mic_matrix, and analyze_compliant_stackup through native local MCP with writer leases and unmodified archive',
  async () => {
    const root = await mkdtemp('/private/tmp/comp-mcp-')
    const native = await mkdtemp(join(tmpdir(), 'comp-native-'))
    const peerHelper = join(native, 'm1-peer')
    const socketPath = join(root, 'agent.sock')
    const projectPath = join(root, 'archive.cunlian')
    const client = new LocalM1Client({ executable: process.execPath, socketPath, peerHelper })
    const bridge = createLocalBridgeServer(client, async () => 'test')
    let endpoint: Awaited<ReturnType<typeof startM1LocalEndpoint>> | undefined
    try {
      execFileSync('/usr/bin/clang', ['desktop/main/project-agent/native/m1-peer.c', '-o', peerHelper])
      const snapshot = createNewProjectSnapshot({
        name: 'Compliant MCP', template: 'empty', appVersion: 'test', electronVersion: 'test',
      })
      const projectId = snapshot.project.id
      const assembly = model([part('cover')], [
        face('surface', 'cover', [0, 0, 0], [0, 0, 1]),
        axis('clamp-1', 'cover', [10000, 10000, 0], [0, 0, 1], 200),
        axis('clamp-2', 'cover', [70000, 10000, 0], [0, 0, 1], 200),
      ])
      const step = Buffer.from('ISO-10303-21;\nEND-ISO-10303-21;')
      const stepSha = createHash('sha256').update(step).digest('hex')
      snapshot.project.assembly3d = assembly
      snapshot.project.stepAttachments = [{ id: 'step-a', fileName: 'fixture.step', blobKey: 'step' }]
      snapshot.attachments.push({ blobKey: 'step', bytes: step })
      snapshot.blobs.push({ projectId, blobKey: 'step', sha256: stepSha, byteSize: step.length })
      const encoded = await encodeProjectFile(snapshot)
      if (!encoded.ok) throw Error(JSON.stringify(encoded.error))
      const bytes = Buffer.from(encoded.value.bytes)
      const baseRevision = createHash('sha256').update(bytes).digest('hex')
      await writeFile(projectPath, bytes)
      const authority = new LocalM1Authority({
        root: join(root, 'journal'),
        confirm: approve,
        sessionFor: id =>
          id === 1 ? { projectId, sessionId: 'session', path: projectPath, fingerprint: baseRevision } : null,
      })
      endpoint = await startM1LocalEndpoint({
        socketPath, peerHelper, authority, confirm: approve, selectWindow: () => 1,
      })
      const rpc = async (method: string, params?: object) =>
        JSON.parse((await bridge.handleFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })))!).result
      const call = (name: string, args: object) => rpc('tools/call', { name, arguments: args })
      await rpc('initialize', { clientInfo: { name: 'local compliant MCP' } })

      // Feature flag off -> hidden and rejected
      vi.stubEnv('FEATURE_3D_ASSEMBLY_M1', 'false')
      const offNames = (await rpc('tools/list')).tools.map((item: { name: string }) => item.name)
      for (const spec of compliantTools) expect(offNames).not.toContain(spec.name)
      expect(offNames).not.toContain(reportTool.name)
      expect((await call('stage_physics', { projectId })).isError).toBe(true)
      expect((await call('export_simulation_report', { projectId, format: 'json' })).isError).toBe(true)

      // Feature flag on -> advertised and executable with lease + evidence
      const enabledClient = new LocalM1Client({ executable: process.execPath, socketPath, peerHelper })
      const enabled = createLocalBridgeServer(enabledClient, async () => 'test')
      const enabledRpc = async (method: string, params?: object) =>
        JSON.parse((await enabled.handleFrame(JSON.stringify({ jsonrpc: '2.0', id: 2, method, params })))!).result
      const invoke = (name: string, args: object) => enabledRpc('tools/call', { name, arguments: args })
      try {
        vi.stubEnv('FEATURE_3D_ASSEMBLY_M1', 'true')
        await enabledRpc('initialize', { clientInfo: { name: 'enabled compliant MCP' } })
        const listed = (await enabledRpc('tools/list')).tools
        for (const spec of compliantTools) expect(listed).toContainEqual({ ...spec, title: spec.name })
        expect(listed).toContainEqual({ ...reportTool, title: reportTool.name })

        await invoke('authorizeProject', { projectId })
        const acquired = await invoke('acquireWriter', { projectId, expectedWriterEpoch: 0 })
        const writerEpoch = acquired.structuredContent.writerEpoch

        const citation = {
          kind: 'user-attestation', actorId: 'engineer', at: '2026-11-26T00:00:00Z',
          sessionSeq: 1, sessionLabel: null, statement: '6061-T6 1.5mm cover warpage', fieldPath: 'physics',
        }
        const physicsReq = {
          projectId,
          expectedWriterEpoch: writerEpoch,
          baseRevision,
          expectedDraftRevision: null,
          idempotencyKey: 'phys-1',
          physics: {
            enabled: true,
            materials: [{
              partId: 'cover', presetId: 'al-6061', name: '6061-T6',
              youngsModulusMpa: 68900, poissonRatio: 0.33,
              thermalExpansionPerK: 23.6e-6, deltaTemperatureK: 0,
            }],
            compliantModels: [{
              id: 'clamp-1', kind: 'plate-clamping', partId: 'cover',
              surfaceFeatureId: 'surface', thicknessQ: 15000, initialWarpPeakQ: 2800,
              clampFeatureIds: ['clamp-1', 'clamp-2'], clampForceN: 450,
            }],
          },
          evidenceByField: {
            '/materials': [citation],
            '/compliantModels': [citation],
          },
        }
        // Missing evidence for compliantModels must fail
        expect(
          (await invoke('stage_physics', { ...physicsReq, evidenceByField: { '/materials': [citation] } })).isError,
        ).toBe(true)

        const stagedPhysics = (await invoke('stage_physics', physicsReq)).structuredContent
        expect(stagedPhysics.draftRevision).toBeTruthy()
        expect(stagedPhysics.physics.enabled).toBe(true)
        // Idempotent replay
        expect((await invoke('stage_physics', physicsReq)).structuredContent).toEqual(stagedPhysics)

        // Import MIC matrix onto the same draft chain
        const micReq = {
          projectId,
          expectedWriterEpoch: writerEpoch,
          baseRevision,
          expectedDraftRevision: stagedPhysics.draftRevision,
          idempotencyKey: 'mic-1',
          fileName: 'cover.mic.json',
          payload: {
            schemaVersion: 1,
            partId: 'cover',
            units: 'mm',
            forceUnits: 'N',
            controlPointsMm: [[10, 10, 0], [70, 10, 0]],
            measurePointsMm: [[40, 25, 0]],
            sensitivityMatrix: [[0.0004, 0.0004]],
            sourceMeta: { solverName: 'calculix', meshNodes: 1200 },
          },
          evidence: [citation],
        }
        const stagedMic = (await invoke('import_mic_matrix', micReq)).structuredContent
        expect(stagedMic.draftRevision).toBeTruthy()
        expect(stagedMic.attachment.kind).toBe('mic-matrix')
        expect(stagedMic.attachment.sha256).toMatch(/^[a-f0-9]{64}$/)

        // Analyze compliant stackup (baseline + whatIf)
        const analyzed = (await invoke('analyze_compliant_stackup', {
          projectId,
          draftRevision: stagedMic.draftRevision,
          expectedWriterEpoch: writerEpoch,
          monteCarlo: { seed: 7, samples: 1000, distribution: 'normal' },
          whatIf: { enabled: true },
        })).structuredContent
        expect(analyzed.projectId).toBe(projectId)
        expect(analyzed.draftRevision).toBe(stagedMic.draftRevision)
        expect(analyzed.summary.flexContributionItems.length).toBeGreaterThanOrEqual(1)
        expect(analyzed.displacementFields.length).toBeGreaterThanOrEqual(1)

        // Revoking writer blocks analysis
        await invoke('revokeWriter', { projectId })
        expect((await invoke('analyze_compliant_stackup', {
          projectId, draftRevision: stagedMic.draftRevision, expectedWriterEpoch: writerEpoch,
          monteCarlo: { seed: 7, samples: 1000, distribution: 'normal' },
        })).isError).toBe(true)

        // Read-only report export works on authorized project even after writer revocation
        for (const format of ['html', 'csv', 'json'] as const) {
          const exported = (await invoke('export_simulation_report', { projectId, format, seed: 19 })).structuredContent
          expect(exported.revision).toBe(stagedMic.draftRevision)
          expect(exported.checksetFingerprint).toMatch(/^[a-f0-9]{64}$/)
          expect(exported.sha256).toBe(createHash('sha256').update(exported.content).digest('hex'))
          if (format === 'html') {
            expect(exported.content).toContain(projectId)
            expect(exported.content).toContain('6061-T6')
            expect(exported.content).not.toMatch(/<(?:img|script|link)\b[^>]*(?:src|href)=["']https?:/i)
          }
          if (format === 'json') {
            expect(JSON.parse(exported.content).seed).toBe(19)
          }
        }

        // Official .cunlian file bytes on disk remain 100% untouched
        expect(await readFile(projectPath)).toEqual(bytes)
      } finally {
        enabledClient.close()
      }
    } finally {
      client.close()
      await endpoint?.close()
      await rm(root, { recursive: true, force: true })
      await rm(native, { recursive: true, force: true })
    }
  },
)

it('runs built-in compliant tools via M1ModelApi and exposes detectFeaSidecars on IPC', async () => {
  const { createSampleSnapshot } = await import('../../src/project-file/__fixtures__/sampleProjectFile')
  const { MemoryKeychainStore } = await import('../../desktop/main/keychain')
  const { RealModelRuntime } = await import('../../desktop/main/realModelRuntime')
  const { M1ModelApi } = await import('../../desktop/main/project-agent/m1ModelApi')
  const { installM1WorkbenchChannels } = await import('../../desktop/main/project-agent/m1WorkbenchChannels')
  const { SenderGuard } = await import('../../desktop/main/senderGuard')
  const { createElectronTransport } = await import('../../src/transport/electronTransport')

  const root = await mkdtemp(join(tmpdir(), 'compliant-builtin-'))
  const file = join(root, 'project.cunlian')
  const snapshot = await createSampleSnapshot()
  const { id: projectId } = snapshot.project
  const project = {
    ...snapshot.project,
    assembly3d: model(
      [{
        id: 'cover', kind: 'parametric-primitive' as const, baseKind: 'plate' as const,
        nominalTransform: part('cover').nominalTransform, displayName: 'Cover', color: '#72b7b2',
        sizeQ: { lengthQ: 800000, widthQ: 500000, thicknessQ: 15000 }, modifiers: [],
      }],
      [
        face('surface', 'cover', [400000, 250000, 0], [0, 0, 1]),
        axis('clamp-1', 'cover', [80000, 80000, 0], [0, 0, 1], 22500),
        axis('clamp-2', 'cover', [720000, 80000, 0], [0, 0, 1], 22500),
      ],
    ),
  }
  const encoded = await encodeProjectFile({ ...snapshot, project })
  if (!encoded.ok) throw Error(JSON.stringify(encoded.error))
  const bytes = Buffer.from(encoded.value.bytes)
  const session = {
    projectId, path: file, sessionId: 'session',
    fingerprint: createHash('sha256').update(bytes).digest('hex'),
  }
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
  let nextTool = 'stage_physics'
  let forged = false
  let toolResult: Record<string, unknown> | undefined
  const fetchImpl: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'mock-model' }] })
    const body = JSON.parse(String(init?.body)) as ModelBody
    const value = (message: object) => Response.json({ choices: [{ message }] })
    const call = (name: string, args: object) => value({
      content: null,
      tool_calls: [{ type: 'function', id: name, function: { name, arguments: JSON.stringify(args) } }],
    })
    const last = body.messages.at(-1)
    if (body.tools[0].function.name === 'm1_connection_probe') {
      return last?.role === 'tool'
        ? value({ content: JSON.parse(last.content).challenge })
        : call('m1_connection_probe', {})
    }
    if (last?.role === 'tool') {
      toolResult = JSON.parse(last.content)
      return value({ content: '已处理柔性草稿。' })
    }
    const message = JSON.parse(last!.content)
    const { draftRevision, ...context } = message.gdtWriterContext
    if (nextTool === 'analyze_compliant_stackup') {
      return call(nextTool, {
        projectId, draftRevision, expectedWriterEpoch: context.expectedWriterEpoch,
        monteCarlo: { seed: 5, distribution: 'normal', samples: 100 },
      })
    }
    const evidence = message.attachments[0].evidence
    const usedEvidence = forged ? { ...evidence, statement: 'manufactured' } : evidence
    if (nextTool === 'import_mic_matrix') {
      return call(nextTool, {
        ...context, expectedDraftRevision: draftRevision, idempotencyKey: 'mic-ai',
        fileName: 'cover.mic.json',
        payload: {
          schemaVersion: 1, partId: 'cover', units: 'mm', forceUnits: 'N',
          controlPointsMm: [[8, 8, 0]], measurePointsMm: [[40, 25, 0]], sensitivityMatrix: [[0.001]],
        },
        evidence: [usedEvidence],
      })
    }
    return call(nextTool, {
      ...context, expectedDraftRevision: draftRevision, idempotencyKey: forged ? 'forged' : 'phys-ai',
      physics: { enabled: true },
      evidenceByField: { '/enabled': [usedEvidence] },
    })
  }

  const pdf = snapshot.revisions[0]
  const runtime = new RealModelRuntime({ rootDir: root, keychain: new MemoryKeychainStore(), fetchImpl })
  const api = new M1ModelApi(authority, runtime, {
    sender, projectId, sessionId: session.sessionId, scopeEpoch: 1, authorizationRef: caller.authorizationRef,
    isCurrent: () => true,
    readAttachment: async () => ({
      excerpt: 'Cover warpage spec', page: 1,
      pdfSource: { kind: 'pdf-page', revisionId: pdf.id, sha256: pdf.sha256, page: 1 },
    }),
  })
  const frame = { url: 'file:///compliant-fixture' }
  const event = { sender: { id: 1, mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent
  const guard = new SenderGuard()
  guard.register({ webContentsId: 1, isDestroyed: () => false, isAllowedFrameUrl: url => url === frame.url })
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>()
  installM1WorkbenchChannels({ handle: (channel, handler) => handlers.set(channel, handler) }, {
    guard, authority, runtime, sessionFor: () => session, confirm: approve, endpoint: async () => undefined,
    installInfo() { throw Error('Unneeded fixture port') },
  })
  const invoke = (operation: string, request?: unknown) => handlers.get('cunlian:gdt')!(event, operation, request)
  const transport = createElectronTransport({
    bridge: {
      getGdtCapability: () => invoke('capabilities'),
      stagePhysics: (request: unknown) => invoke('stage_physics', request),
      importMicMatrix: (request: unknown) => invoke('import_mic_matrix', request),
      analyzeCompliantStackup: (request: unknown) => invoke('analyze_compliant_stackup', request),
      detectFeaSidecars: () => invoke('detect_fea_sidecars'),
    },
  })

  try {
    expect(await api.testM1ModelApiConnection({
      projectId, scopeEpoch: 1, requestId: 'probe',
      baseUrl: 'https://example.test/v1', model: 'mock-model', apiKey: 'test-key', contextPreview: false,
    })).toMatchObject({ ok: true })
    const lease = await api.acquireWriter(0, approve)
    if (!lease.ok) throw Error(JSON.stringify(lease.error))
    const chat = (requestId: string) => api.sendM1ChatMessage({
      projectId, scopeEpoch: 1, writerEpoch: lease.value.writerEpoch, requestId,
      prompt: 'Compliant fixture', attachments: ['document'], selectedObject: null, history: [],
    })

    vi.stubEnv('FEATURE_3D_ASSEMBLY_M1', 'true')
    forged = true
    expect(await chat('forged')).toMatchObject({ ok: false, error: { code: 'REFERENCE_STALE' } })
    forged = false

    for (const spec of compliantTools) {
      nextTool = spec.name
      expect(await chat(spec.name)).toMatchObject({
        ok: true, value: { toolCalls: [{ name: spec.name, status: 'succeeded' }] },
      })
    }
    expect(toolResult).toMatchObject({ projectId, summary: { flexContributionItems: expect.any(Array) } })

    const feaRes = await transport.detectFeaSidecars!()
    expect(feaRes.ok).toBe(true)
    if (feaRes.ok) {
      expect(Array.isArray(feaRes.value.statuses)).toBe(true)
      expect(feaRes.value.statuses.map(s => s.solver)).toEqual(['calculix', 'gmsh'])
    }
    expect(await readFile(file)).toEqual(bytes)
  } finally {
    await api.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
