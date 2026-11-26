// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createElectronTransport,
  isElectronTransport,
  resolveWorkbenchTransport,
} from './electronTransport'
import type { Transport } from './types'

describe('ElectronTransport', () => {
  afterEach(() => {
    delete (window as { cunlian?: unknown }).cunlian
  })

  it('probes window.cunlian when no bridge option is provided and reports capabilities', async () => {
    const getM1ConnectionStatus = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        connectionState: 'connected',
        source: 'local-agent',
        clientName: 'Cursor',
        authorizationState: 'authorized-writable',
        projectId: 'proj-plate-01',
        draftRevision: 'draft-2',
        writerEpoch: 3,
      },
    })
    const testM1ModelApiConnection = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        selectedModel: 'deepseek-chat',
        availableModels: ['deepseek-chat'],
        toolCallSupported: true,
        toolRoundTripPassed: true,
      },
    })
    const listM1ModelApiModels = vi.fn().mockResolvedValue({
      ok: true,
      value: { models: ['deepseek-chat'], defaultModel: 'deepseek-chat' },
    })
    const takeoverM1Draft = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        projectId: 'proj-plate-01',
        draftRevision: 'draft-3',
        scopeEpoch: 2,
        writerEpoch: 4,
        writerOwner: 'Cursor',
      },
    })

    ;(window as { cunlian?: unknown }).cunlian = {
      getM1ConnectionStatus,
      testM1ModelApiConnection,
      listM1ModelApiModels,
      takeoverM1Draft,
    }

    const transport = createElectronTransport()
    expect(isElectronTransport(transport)).toBe(true)
    expect(transport.probes.m1.capabilities.connectionStatus).toBe(true)
    expect(transport.probes.m1.capabilities.modelApiTest).toBe(true)
    expect(transport.probes.connUx.capabilities.listModelApiModels).toBe(true)

    const caps = await transport.capabilities()
    expect(caps.ok).toBe(true)
    if (caps.ok) {
      expect(caps.value.attachments).toEqual(['pdf', 'stl'])
      expect(caps.value.drawingFormats).toEqual(['svg', 'dxf-r12', 'dxf-2000'])
      expect(caps.value.writerLeases).toBe(true)
      expect(caps.value.modelConnection).toBe(true)
      expect(caps.value.FEATURE_3D_ASSEMBLY_M1).toBe(false)
    }

    const status = await transport.getConnectionStatus({ projectId: 'proj-plate-01', scopeEpoch: 1 })
    expect(status.ok).toBe(true)
    expect(getM1ConnectionStatus).toHaveBeenCalledWith({
      projectId: 'proj-plate-01',
      scopeEpoch: 1,
    })

    const models = await transport.listModels({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      projectId: 'proj-plate-01',
      requestId: 'req-1',
      scopeEpoch: 1,
    })
    expect(models.ok).toBe(true)
    expect(listM1ModelApiModels).toHaveBeenCalledTimes(1)
  })

  it('returns fail-closed BACKEND_UNAVAILABLE errors when preload methods are missing', async () => {
    const transport = createElectronTransport({ bridge: {} })

    const results = await Promise.all([
      transport.listProjects(),
      transport.createProject({ name: 'P', template: 'builtin-mounting-plate' }),
      transport.importProject({ kind: 'step', fileName: 'a.step', bytes: new Uint8Array([1]) }),
      transport.getProject({ projectId: 'p1' }),
      transport.readAttachmentBytes({ projectId: 'p1', attachmentId: 'att-1' }),
      transport.uploadAttachment({
        projectId: 'p1',
        kind: 'pdf',
        fileName: 'spec.pdf',
        bytes: new Uint8Array([2]),
      }),
      transport.buildGeometry({ projectId: 'p1', draftRevision: 'draft-1' }),
      transport.triangulate({ projectId: 'p1', draftRevision: 'draft-1' }),
      transport.runChecks({ projectId: 'p1', draftRevision: 'draft-1' }),
      transport.getDrawing({ projectId: 'p1', draftRevision: 'draft-1', format: 'svg' }),
      transport.acquireWriter({ projectId: 'p1', expectedWriterEpoch: 1 }),
      transport.takeOverWriter({ projectId: 'p1', expectedWriterEpoch: 1 }),
      transport.revokeWriter({ projectId: 'p1' }),
      transport.readWriterContext({ projectId: 'p1' }),
      transport.commitDraft({
        projectId: 'p1',
        baseRevision: 'v1',
        draftRevision: 'draft-1',
        checksetFingerprint: 'fp-1',
        confirmationToken: 'tok-1',
        requestId: 'req-1',
      }),
      transport.authorizeProject({ projectId: 'p1' }),
      transport.getContext({ projectId: 'p1' }),
      transport.getExternalActivities({ projectId: 'p1' }),
      transport.readProjectEvents({ projectId: 'p1' }),
      transport.getReview({ projectId: 'p1', draftRevision: 'draft-1' }),
      transport.getCommitStatus({ projectId: 'p1', draftRevision: 'draft-1' }),
      transport.getLocalAgentInstallInfo(),
      transport.detectLocalAgents(),
      transport.registerLocalAgent({ agentId: 'cursor' }),
      transport.getPreviewSnapshot({ projectId: 'p1' }),
      transport.locateEvidence({
        projectId: 'p1',
        revision: 'draft-1',
        target: { kind: 'requirement', requirementId: 'req-1' },
      }),
      transport.retryDrawing({ projectId: 'p1', revision: 'draft-1', requestId: 'r-1' }),
      transport.submitClarification({
        projectId: 'p1',
        revision: 'draft-1',
        targetId: 'req-1',
        mode: 'answer',
        content: '8 mm',
        requestId: 'c-1',
      }),
      transport.undoDraftChange({ projectId: 'p1', draftRevision: 'draft-1', requestId: 'u-1' }),
      transport.getMigrationReport({ projectId: 'p1' }),
      transport.openExternalProjectResult({
        projectId: 'p1',
        draftRevision: 'draft-1',
        requestId: 'o-1',
      }),
    ])

    for (const res of results) {
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('BACKEND_UNAVAILABLE')
      }
    }
  })

  it('delegates commitDraft to commitM3ApprovedDraft with checksetFingerprint mapping', async () => {
    const commitM3ApprovedDraft = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        projectId: 'proj-plate-01',
        committedRevision: 'v2',
        previousBaseRevision: 'v1',
        committedDraftRevision: 'draft-2',
        checkSetFingerprint: 'fp-abc',
        nextDraftRevision: null,
      },
    })

    const transport = createElectronTransport({
      bridge: {},
      m3Bridge: { commitM3ApprovedDraft },
    })

    const result = await transport.commitDraft({
      projectId: 'proj-plate-01',
      baseRevision: 'v1',
      draftRevision: 'draft-2',
      checksetFingerprint: 'fp-abc',
      confirmationToken: 'tok-99',
      requestId: 'req-99',
    })

    expect(commitM3ApprovedDraft).toHaveBeenCalledWith({
      projectId: 'proj-plate-01',
      baseRevision: 'v1',
      draftRevision: 'draft-2',
      checkSetFingerprint: 'fp-abc',
      confirmationToken: 'tok-99',
      requestId: 'req-99',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.committedRevision).toBe('v2')
      expect(result.value.checksetFingerprint).toBe('fp-abc')
    }
  })

  it('subscribes and cleans up M1/M2/M3 event listeners via injected bridges', async () => {
    const unsubM1 = vi.fn()
    const unsubM2 = vi.fn()
    const unsubM3 = vi.fn()

    const transport = createElectronTransport({
      bridge: {
        subscribeM1WorkbenchEvents: vi.fn().mockResolvedValue({
          ok: true,
          value: { subscriptionId: 'sub-1', unsubscribe: unsubM1 },
        }),
      },
      m2Bridge: {
        subscribeM2PreviewEvents: vi.fn().mockResolvedValue({
          ok: true,
          value: { subscriptionId: 'sub-2', unsubscribe: unsubM2 },
        }),
      },
      m3Bridge: {
        subscribeM3ExternalProjectEvents: vi.fn().mockResolvedValue({
          ok: true,
          value: { subscriptionId: 'sub-3', unsubscribe: unsubM3 },
        }),
      },
    })

    const r1 = await transport.subscribeWorkbenchEvents(
      { projectId: 'p1', scopeEpoch: 1 },
      () => {},
    )
    const r2 = await transport.subscribePreviewEvents({ projectId: 'p1' }, () => {})
    const r3 = await transport.subscribeExternalProjectEvents(() => {})

    expect(r1.ok && r2.ok && r3.ok).toBe(true)
    if (r1.ok) r1.value.unsubscribe?.()
    if (r2.ok) r2.value.unsubscribe?.()
    if (r3.ok) r3.value.unsubscribe?.()

    expect(unsubM1).toHaveBeenCalledTimes(1)
    expect(unsubM2).toHaveBeenCalledTimes(1)
    expect(unsubM3).toHaveBeenCalledTimes(1)
  })

  it('normalizes thrown preload errors into structured M2Result error envelopes', async () => {
    const transport = createElectronTransport({
      bridge: {
        getM1ConnectionStatus: vi.fn().mockRejectedValue(new Error('IPC channel closed')),
      },
    })

    const res = await transport.getConnectionStatus({ projectId: 'p1', scopeEpoch: 1 })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('INTERNAL')
      expect(res.error.message).toContain('IPC channel closed')
    }
  })

  it('wraps a custom generic Transport via resolveWorkbenchTransport', async () => {
    const mockGetConnectionStatus = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        connectionState: 'connected',
        source: 'model-api',
        clientName: 'gpt-4o',
        authorizationState: 'authorized-writable',
        projectId: 'p-remote',
        draftRevision: 'draft-1',
        writerEpoch: 1,
      },
    })
    const mockListProjects = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        projects: [{ projectId: 'p-remote', name: '云端项目', baseRevision: 'v1', draftRevision: 'draft-1' }],
      },
    })

    const customTransport: Transport = {
      listProjects: mockListProjects,
      createProject: vi.fn(),
      importProject: vi.fn(),
      getProject: vi.fn(),
      readAttachmentBytes: vi.fn(),
      capabilities: vi.fn(),
      uploadAttachment: vi.fn(),
      buildGeometry: vi.fn(),
      triangulate: vi.fn(),
      runChecks: vi.fn(),
      runSimulation: vi.fn(),
      getDrawing: vi.fn(),
      acquireWriter: vi.fn(),
      takeOverWriter: vi.fn(),
      revokeWriter: vi.fn(),
      readWriterContext: vi.fn(),
      stageChange: vi.fn(),
      commitDraft: vi.fn(),
      authorizeProject: vi.fn(),
      getContext: vi.fn(),
      getExternalActivities: vi.fn(),
      readProjectEvents: vi.fn(),
      getReview: vi.fn(),
      getCommitStatus: vi.fn(),
      getConnectionStatus: mockGetConnectionStatus,
      testModelConnection: vi.fn(),
      listModels: vi.fn(),
    }

    const resolved = resolveWorkbenchTransport({ transport: customTransport })
    expect(isElectronTransport(resolved)).toBe(true)

    const projects = await resolved.listProjects()
    expect(projects.ok).toBe(true)
    expect(mockListProjects).toHaveBeenCalledTimes(1)

    const conn = await resolved.getConnectionStatus({ projectId: 'p-remote', scopeEpoch: 1 })
    expect(conn.ok).toBe(true)
    expect(mockGetConnectionStatus).toHaveBeenCalledTimes(1)
  })
})

it('passes each GD&T operation to the enabled preload and gates explicitly disabled calls', async () => {
  const draft = { projectId: 'project', draftRevision: 'draft' }
  const request = { projectId: draft.projectId, expectedWriterEpoch: 2,
    baseRevision: 'base', expectedDraftRevision: null, idempotencyKey: 'stage', items: [] }
  const stage = { ok: true, value: { ...draft, warnings: [] } }
  const denied = { ok: false, error: { code: 'WRITER_REVOKED', message: 'lease revoked' } }
  const bridge = {
    stageDatum: vi.fn().mockResolvedValue(stage),
    stageGdt: vi.fn().mockResolvedValue(stage),
    analyzeGdtStackup: vi.fn().mockResolvedValue(denied),
  }
  const analysis = { ...draft, expectedWriterEpoch: 2,
    monteCarlo: { seed: 50, samples: 10000, distribution: 'uniform' as const } }
  const off = createElectronTransport({ bridge, feature3dAssemblyM1: false })
  await expect(off.stageDatum!(request)).resolves.toMatchObject({ ok: false, error: { code: 'FEATURE_DISABLED' } })
  expect(bridge.stageDatum).not.toHaveBeenCalled()
  const on = createElectronTransport({ bridge, feature3dAssemblyM1: true })
  await expect(on.stageDatum!(request)).resolves.toEqual(stage)
  await expect(on.stageGdt!(request)).resolves.toEqual(stage)
  await expect(on.analyzeGdtStackup!(analysis)).resolves.toEqual(denied)
  expect(bridge.stageDatum).toHaveBeenCalledExactlyOnceWith(request)
  expect(bridge.stageGdt).toHaveBeenCalledExactlyOnceWith(request)
  expect(bridge.analyzeGdtStackup).toHaveBeenCalledExactlyOnceWith(analysis)
})

it('passes compliant physics, MIC, stackup, and FEA sidecar operations to preload with feature gating', async () => {
  const draft = { projectId: 'project', draftRevision: 'draft' }
  const physicsReq = {
    projectId: draft.projectId, expectedWriterEpoch: 2, baseRevision: 'base',
    expectedDraftRevision: null, idempotencyKey: 'phys-1',
    physics: { enabled: true }, evidenceByField: { '/enabled': [] },
  }
  const micReq = {
    projectId: draft.projectId, expectedWriterEpoch: 2, baseRevision: 'base',
    expectedDraftRevision: 'draft', idempotencyKey: 'mic-1',
    fileName: 'cover.mic.json',
    payload: {
      schemaVersion: 1 as const, partId: 'cover', units: 'mm' as const, forceUnits: 'N' as const,
      controlPointsMm: [[0, 0, 0] as [number, number, number]],
      measurePointsMm: [[10, 0, 0] as [number, number, number]],
      sensitivityMatrix: [[0.001]],
    },
    evidence: [],
  }
  const analyzeReq = {
    ...draft, expectedWriterEpoch: 2,
    monteCarlo: { seed: 42, samples: 1000, distribution: 'normal' as const },
  }
  const physicsRes = { ok: true, value: { ...draft, physics: { enabled: true } } }
  const micRes = {
    ok: true,
    value: {
      ...draft,
      attachment: {
        kind: 'mic-matrix' as const, revisionId: 'mic-1', blobKey: 'mic-1',
        path: 'attachments/mic-1.bin', sha256: 'a'.repeat(64), byteSize: 128,
      },
    },
  }
  const denied = { ok: false, error: { code: 'WRITER_REVOKED', message: 'lease revoked' } }
  const feaRes = { ok: true, value: { available: false, statuses: [{ solver: 'calculix', available: false }] } }
  const reportReq = { projectId: draft.projectId, format: 'html' as const, seed: 42 }
  const reportRes = {
    ok: true,
    value: {
      fileName: 'simulation-project-draft.html',
      mimeType: 'text/html' as const,
      sha256: 'c'.repeat(64),
      revision: 'draft',
      checksetFingerprint: 'fp-1',
      content: '<!doctype html>',
    },
  }
  const bridge = {
    stagePhysics: vi.fn().mockResolvedValue(physicsRes),
    importMicMatrix: vi.fn().mockResolvedValue(micRes),
    analyzeCompliantStackup: vi.fn().mockResolvedValue(denied),
    detectFeaSidecars: vi.fn().mockResolvedValue(feaRes),
    exportSimulationReport: vi.fn().mockResolvedValue(reportRes),
  }
  const off = createElectronTransport({ bridge, feature3dAssemblyM1: false })
  await expect(off.stagePhysics!(physicsReq)).resolves.toMatchObject({ ok: false, error: { code: 'FEATURE_DISABLED' } })
  await expect(off.importMicMatrix!(micReq)).resolves.toMatchObject({ ok: false, error: { code: 'FEATURE_DISABLED' } })
  await expect(off.analyzeCompliantStackup!(analyzeReq)).resolves.toMatchObject({ ok: false, error: { code: 'FEATURE_DISABLED' } })
  await expect(off.exportSimulationReport!(reportReq)).resolves.toMatchObject({ ok: false, error: { code: 'FEATURE_DISABLED' } })
  expect(bridge.stagePhysics).not.toHaveBeenCalled()
  expect(bridge.exportSimulationReport).not.toHaveBeenCalled()

  const on = createElectronTransport({ bridge, feature3dAssemblyM1: true })
  await expect(on.stagePhysics!(physicsReq)).resolves.toEqual(physicsRes)
  await expect(on.importMicMatrix!(micReq)).resolves.toEqual(micRes)
  await expect(on.analyzeCompliantStackup!(analyzeReq)).resolves.toEqual(denied)
  await expect(on.detectFeaSidecars!()).resolves.toEqual(feaRes)
  await expect(on.exportSimulationReport!(reportReq)).resolves.toEqual(reportRes)
  expect(bridge.stagePhysics).toHaveBeenCalledExactlyOnceWith(physicsReq)
  expect(bridge.importMicMatrix).toHaveBeenCalledExactlyOnceWith(micReq)
  expect(bridge.analyzeCompliantStackup).toHaveBeenCalledExactlyOnceWith(analyzeReq)
  expect(bridge.detectFeaSidecars).toHaveBeenCalledTimes(1)
  expect(bridge.exportSimulationReport).toHaveBeenCalledExactlyOnceWith(reportReq)
})
