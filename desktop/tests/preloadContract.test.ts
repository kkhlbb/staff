import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS as ipc } from '../shared/contracts'
import type { CunlianApi } from '../shared/contracts'

const electron = vi.hoisted(() => {
  let api!: CunlianApi
  const live = new Set<(...args: unknown[]) => void>()
  return { getApi: () => api, live, invoke: vi.fn(),
    exposeInMainWorld: (_key: string, bridge: CunlianApi) => { api = bridge },
    on: (_channel: string, listener: (...args: unknown[]) => void) => live.add(listener),
    removeListener: (_channel: string, listener: (...args: unknown[]) => void) => live.delete(listener) }
})
vi.mock('electron', () => ({ contextBridge: electron, ipcRenderer: electron }))

/**
 * 旧桥回归：window.cunlian 原有 18 个函数必须存在；B2 只允许新增。
 * 这里做静态源码检查，补足“签名由类型系统保证、行为由既有测试保证”的缺口。
 */
const PRELOAD = fileURLToPath(new URL('../preload/index.ts', import.meta.url))

const LEGACY_FUNCTIONS = [
  'newProject',
  'openProject',
  'stageDraft',
  'saveProject',
  'saveProjectAs',
  'listRecent',
  'relinkRecent',
  'listRecovery',
  'restoreRecovery',
  'reattachSession',
  'readAttachment',
  'revealProject',
  'requestClose',
  'inspectV2',
  'commitV2',
  'onMenuAction',
  'onEditorFlush',
  'respondEditorFlush',
] as const

const ADDED_FUNCTIONS = [
  'detectM1LocalAgents',
  'registerM1LocalAgent',
  'listM1ModelApiModels',
  'getM1LocalAgentInstallInfo',
  'getM1ConnectionStatus',
  'testM1ModelApiConnection',
  'sendM1ChatMessage',
  'cancelM1ChatMessage',
  'getM1ExternalActivities',
  'commitM3ApprovedDraft',
  'getGdtCapability', 'stageDatum', 'stageGdt', 'analyzeGdtStackup',
  'stagePhysics', 'importMicMatrix', 'analyzeCompliantStackup', 'detectFeaSidecars',
  'undoDraftChange',
  'getMigrationReport',
  'openExternalProjectResult',
  'subscribeM3ExternalProjectEvents',
  'getM2PreviewSnapshot',
  'locateM2Evidence',
  'retryM2Drawing',
  'submitM2Clarification',
  'subscribeM2PreviewEvents',
  'subscribeM1WorkbenchEvents',
  'reconnectM1Session',
  'takeoverM1Draft',

  'requestM1ProjectAuthorization', 'revokeM1ProjectAuthorization',
  'getM1ProjectContext', 'readM1ProjectEvents', 'subscribeM1ProjectEvents',
  'cancelM1ProjectSubscription', 'getM1ReadCapabilities',
  'stepExport', 'stepCancel',
  'pickModel',
  'readModel',
  'commitModel',
  'releaseModel',
  'linkModel',
  // C：图纸更新与两种矢量导出（仍只增不改旧函数）。
  'updateSpacerDrawing',
  'exportDrawingPdf',
  'exportDrawingSvg',
  // D：参数联动草稿/预览/确认/绑定/对比/恢复。
  'stageChangeDraft',
  'previewChange',
  'applyChange',
  'bindParameter',
  'unbindParameter',
  'compareDrawings',
  'restoreRevisionDraft',
  // V3.5：桌面 PDF 与任务书条款。
  'importSource',
  'stageRequirementEdit',
  'confirmRequirement',
  // V3.6：任务书 PDF 提取与逐条决定（仍只增不改旧函数）。
  'runExtraction',
  'decideExtraction',
  'cancelExtraction',
  // V3.6 多草稿：删除被取代的旧规则版本草稿（仍只增不改旧函数）。
  'deleteExtractionDraft',
  // L2 确认效率：同组批量确认 / 批量补单位 / 撤销补单位（仍只增不改旧函数）。
  'confirmExtractionBatch', 'attestExtractionUnits', 'revokeExtractionUnits',
  // V4 stage 1: only specific tool functions, no generic invoke escape.
  'getProjectContext', 'getConfirmedInputs', 'applyConfirmedInputs',
  'stageParameterChange', 'previewAndCheck',
  // V4 stage 3: 任务侧栏、授权提交与来源定位（仍只增不改旧函数）。
  'agentStart', 'agentCancel', 'agentResume', 'agentTaskState', 'agentProviderStatus',
  'agentPreviewSummary', 'issueAgentApproval', 'commitApprovedDraft', 'locateEvidence',
  // V4 stage 4: 真实供应商配置（只写 Keychain）、连接测试与受控导出（仍只增不改）。
  'saveAgentProvider', 'testAgentProvider', 'clearAgentProviderKey', 'exportApprovedVersion',
  'onAgentEvent',
  // DXF 导出 v1：R12 / 2000（仍只增不改旧函数）。
  'exportDrawingDxfR12', 'exportDrawingDxf2000',
  // 内置 DXF 看图（只读）：对话框选文件与启动参数排队文件（仍只增不改旧函数）。
  'openDxf', 'takePendingDxf',
  // ADR-001 第 3 步：无任务书入口（用户界面触发；仍只增不改旧函数）。
  'intentCreateProject', 'intentState', 'intentApply', 'intentPreview',
  'intentConfirmCandidate', 'intentIssueApproval',
  // 手绘草图入口：图片导入 + 图上框选读数（仍只增不改旧函数）。
  'importSketchImage', 'ingestSketchReadings',
] as const

describe('B2/C preload 契约', () => {
  const source = readFileSync(PRELOAD, 'utf8')

  it('原有 18 个函数仍在 api 对象中，B2/C 只允许新增具体函数', () => {
    for (const name of [...LEGACY_FUNCTIONS, ...ADDED_FUNCTIONS]) {
      expect(source).toContain(`\n  ${name}:`)
    }
    // 除上述具体函数外，不得暴露通用 invoke/send/on 转义口。
    const apiBlock = source.slice(source.indexOf('const api: CunlianApi = {'), source.indexOf('contextBridge.exposeInMainWorld'))
    const keys = [...apiBlock.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):/gm)].map((match) => match[1])
    expect(keys.sort()).toEqual([...LEGACY_FUNCTIONS, ...ADDED_FUNCTIONS].sort())
    expect(apiBlock).not.toMatch(/^ {2}(invoke|send|on):/m)
  })

  it('5 个模型通道各有独立 channel 常量，不复用 source:read', () => {
    expect(source).toContain('IPC_CHANNELS.modelPick')
    expect(source).toContain('IPC_CHANNELS.modelRead')
    expect(source).toContain('IPC_CHANNELS.modelCommit')
    expect(source).toContain('IPC_CHANNELS.modelRelease')
    expect(source).toContain('IPC_CHANNELS.modelLink')
    // source:read 仍只服务 readAttachment 一处，模型读取走 modelRead。
    expect(source.match(/IPC_CHANNELS\.sourceRead/g) ?? []).toHaveLength(1)
  })

  it('STEP uses dedicated export/cancel channels, not current drawing export', () => {
    expect(source).toMatch(/stepExport:.*IPC_CHANNELS\.stepExport, request/)
    expect(source).toMatch(/stepCancel:.*IPC_CHANNELS\.stepCancel, request/)
  })
})

it('transports all workbench methods and strips Electron events from subscription callbacks', async () => {
  await import('../preload/index')
  const api = electron.getApi()
  const methods = ['registerM1LocalAgent', 'listM1ModelApiModels', 'getM1ConnectionStatus', 'testM1ModelApiConnection', 'sendM1ChatMessage', 'cancelM1ChatMessage',
    'getM1ExternalActivities', 'reconnectM1Session', 'takeoverM1Draft'] as const
  const request = { projectId: 'p', scopeEpoch: 1 }
  electron.invoke.mockResolvedValue({ ok: true, value: null })
  await api.detectM1LocalAgents()
  expect(electron.invoke).toHaveBeenLastCalledWith(ipc.detectM1LocalAgents)
  await api.getM1LocalAgentInstallInfo()
  expect(electron.invoke).toHaveBeenLastCalledWith(ipc.getM1LocalAgentInstallInfo)
  for (const method of methods) {
    await api[method](request as never)
    expect(electron.invoke).toHaveBeenLastCalledWith(ipc[method], request)
  }
  const listener = vi.fn()
  const value = { ...request, writerEpoch: 0, sequence: 1, type: 'draft_updated', draftRevision: null }
  electron.invoke.mockImplementation(async (key, _request, id) => {
    if (key === ipc.subscribeM1WorkbenchEvents) {
      for (const callback of electron.live) {
        callback({ sender: 'secret' }, 'other-subscription', value)
        callback({ sender: 'secret' }, id, value)
      }
      return { ok: true, value: { subscriptionId: id } }
    }
    return { ok: true, value: null }
  })
  const handle = await api.subscribeM1WorkbenchEvents(request, listener)
  if (!handle.ok) throw Error('missing subscription')
  expect(listener).toHaveBeenCalledExactlyOnceWith(value)
  handle.value.unsubscribe()
  expect(electron.invoke).toHaveBeenLastCalledWith(ipc.unsubscribeM1WorkbenchEvents, handle.value.subscriptionId)
  expect(electron.live.size).toBe(0)
  const calls = electron.invoke.mock.calls.length
  handle.value.unsubscribe()
  expect(electron.invoke.mock.calls).toHaveLength(calls)
  electron.invoke.mockRejectedValueOnce(Error('disconnected'))
  expect(await api.subscribeM1WorkbenchEvents(request, listener)).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
  expect(electron.live.size).toBe(0)
})

it('uses only the five M2 preview methods and scopes the subscription by token and project', async () => {
  await import('../preload/index')
  const api = electron.getApi()
  const methods = ['getM2PreviewSnapshot', 'locateM2Evidence', 'retryM2Drawing', 'submitM2Clarification'] as const
  const request = { projectId: 'plate' }
  const failure = { ok: false, error: { code: 'STALE_BASE', message: 'stale', detail: 'draft-2' } }
  electron.invoke.mockResolvedValue(failure)
  for (const method of methods) {
    expect(await api[method](request as never)).toEqual(failure)
    expect(electron.invoke).toHaveBeenLastCalledWith(ipc[method], request)
  }
  const listener = vi.fn()
  const value = { ...request, revision: 'draft-2', revisionOrder: 2, sequence: 1,
    isDraft: true, fingerprint: 'fp', scopeEpoch: 3, writerEpoch: 4, type: 'model_ready', taskCompleted: false }
  electron.invoke.mockImplementation(async (key, _request, id) => {
    if (key === ipc.subscribeM2PreviewEvents) {
      for (const callback of electron.live) {
        callback({ sender: 'secret' }, 'wrong-token', value)
        callback({ sender: 'secret' }, id, { ...value, projectId: 'wrong-project' })
        callback({ sender: 'secret' }, id, value)
      }
      return { ok: true, value: { subscriptionId: id } }
    }
    return { ok: true, value: null }
  })
  const result = await api.subscribeM2PreviewEvents(request, listener)
  if (!result.ok) throw Error('missing subscription')
  expect(listener).toHaveBeenCalledExactlyOnceWith(value)
  result.value.unsubscribe()
  expect(electron.live.size).toBe(0)
  expect(electron.invoke).toHaveBeenLastCalledWith(ipc.unsubscribeM2PreviewEvents, result.value.subscriptionId)
})

it('wires the five M3 preload methods and fences events queued after unsubscribe', async () => {
  await import('../preload/index')
  const api = electron.getApi()
  const methods = ['commitM3ApprovedDraft', 'undoDraftChange', 'getMigrationReport', 'openExternalProjectResult'] as const
  const request = { projectId: 'plate', requestId: 'm3-request' }
  const failure = { ok: false, error: { code: 'UNAUTHORIZED', message: 'needs grant', detail: 'project' } }
  electron.invoke.mockResolvedValue(failure)
  for (const method of methods) {
    expect(await api[method](request as never)).toEqual(failure)
    expect(electron.invoke).toHaveBeenLastCalledWith(ipc[method], request)
  }
  const listener = vi.fn()
  const notification = { eventId: 'event', projectId: 'peer-project', projectName: '安装板',
    sequence: 10, scopeEpoch: 3, writerEpoch: 4, draftRevision: 'draft-3', revisionOrder: 3, summary: '有草稿' }
  let queued: ((...args: unknown[]) => void) | undefined
  electron.invoke.mockImplementation(async (key, token) => {
    if (key === ipc.subscribeM3ExternalProjectEvents) {
      queued = [...electron.live][0]
      queued?.({ sender: 'secret' }, 'other-token', notification)
      queued?.({ sender: 'secret' }, token, notification)
      return { ok: true, value: { subscriptionId: token } }
    }
    return { ok: true, value: null }
  })
  const subscription = await api.subscribeM3ExternalProjectEvents(listener)
  if (!subscription.ok) throw Error('missing subscription')
  expect(listener).toHaveBeenCalledExactlyOnceWith(notification)
  subscription.value.unsubscribe?.()
  queued?.({}, subscription.value.subscriptionId, notification)
  expect(listener).toHaveBeenCalledTimes(1)
  expect(electron.live.size).toBe(0)
  expect(electron.invoke).toHaveBeenLastCalledWith(ipc.unsubscribeM3ExternalProjectEvents, subscription.value.subscriptionId)
})

it('routes GD&T through the actual preload and preserves the host flag and writer errors', async () => {
  await import('../preload/index')
  const { createElectronTransport } = await import('../../src/transport/electronTransport')
  const api = electron.getApi()
  const transport = createElectronTransport({ bridge: api })
  electron.invoke.mockResolvedValueOnce({ ok: true, value: { enabled: false } })
  await expect(transport.capabilities()).resolves.toMatchObject({ ok: true, value: { FEATURE_3D_ASSEMBLY_M1: false } })
  expect(electron.invoke).toHaveBeenLastCalledWith(ipc.gdt, 'capabilities')
  electron.invoke.mockResolvedValueOnce({ ok: true, value: { enabled: true } })
  await expect(transport.capabilities()).resolves.toMatchObject({ ok: true, value: { FEATURE_3D_ASSEMBLY_M1: true } })
  const stage = { projectId: 'assembly', expectedWriterEpoch: 3, baseRevision: 'base', expectedDraftRevision: null,
    idempotencyKey: 'stage', items: [] }
  const staged = { ok: true, value: { projectId: stage.projectId, draftRevision: 'draft', warnings: [] } }
  electron.invoke.mockResolvedValueOnce(staged)
  await expect(transport.stageDatum!(stage)).resolves.toEqual(staged)
  expect(electron.invoke).toHaveBeenLastCalledWith(ipc.gdt, 'stage_datum', stage)
  electron.invoke.mockResolvedValueOnce(staged)
  await expect(transport.stageGdt!(stage)).resolves.toEqual(staged)
  expect(electron.invoke).toHaveBeenLastCalledWith(ipc.gdt, 'stage_gdt', stage)
  const analysis = { projectId: stage.projectId, draftRevision: 'draft', expectedWriterEpoch: 3,
    monteCarlo: { samples: 1, seed: 42, distribution: 'normal' as const } }
  const revoked = { ok: false, error: { code: 'WRITER_REVOKED', message: 'Writer revoked' } }
  electron.invoke.mockResolvedValueOnce(revoked)
  await expect(transport.analyzeGdtStackup!(analysis)).resolves.toEqual(revoked)
  expect(electron.invoke).toHaveBeenLastCalledWith(ipc.gdt, 'analyze_gdt_stackup', analysis)
  electron.invoke.mockRejectedValueOnce(Error('Disconnected'))
  await expect(api.analyzeGdtStackup(analysis)).resolves.toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })

  const physicsReq = {
    projectId: stage.projectId, expectedWriterEpoch: 3, baseRevision: 'base', expectedDraftRevision: null,
    idempotencyKey: 'phys', physics: { enabled: true }, evidenceByField: { '/enabled': [] },
  }
  const physicsRes = { ok: true, value: { projectId: stage.projectId, draftRevision: 'draft-p', physics: { enabled: true } } }
  electron.invoke.mockResolvedValueOnce(physicsRes)
  await expect(transport.stagePhysics!(physicsReq)).resolves.toEqual(physicsRes)
  expect(electron.invoke).toHaveBeenLastCalledWith(ipc.gdt, 'stage_physics', physicsReq)

  const micReq = {
    projectId: stage.projectId, expectedWriterEpoch: 3, baseRevision: 'base', expectedDraftRevision: 'draft-p',
    idempotencyKey: 'mic', fileName: 'part.mic.json',
    payload: {
      schemaVersion: 1 as const, partId: 'p1', units: 'mm' as const, forceUnits: 'N' as const,
      controlPointsMm: [[0, 0, 0] as [number, number, number]],
      measurePointsMm: [[1, 0, 0] as [number, number, number]],
      sensitivityMatrix: [[0.002]],
    },
    evidence: [],
  }
  const micRes = {
    ok: true,
    value: {
      projectId: stage.projectId, draftRevision: 'draft-m',
      attachment: {
        kind: 'mic-matrix' as const, revisionId: 'mic-1', blobKey: 'mic-1',
        path: 'attachments/mic-1.bin', sha256: 'c'.repeat(64), byteSize: 96,
      },
    },
  }
  electron.invoke.mockResolvedValueOnce(micRes)
  await expect(transport.importMicMatrix!(micReq)).resolves.toEqual(micRes)
  expect(electron.invoke).toHaveBeenLastCalledWith(ipc.gdt, 'import_mic_matrix', micReq)

  electron.invoke.mockResolvedValueOnce(revoked)
  await expect(transport.analyzeCompliantStackup!(analysis)).resolves.toEqual(revoked)
  expect(electron.invoke).toHaveBeenLastCalledWith(ipc.gdt, 'analyze_compliant_stackup', analysis)

  const feaRes = { ok: true, value: { available: false, statuses: [{ solver: 'calculix', available: false }] } }
  electron.invoke.mockResolvedValueOnce(feaRes)
  await expect(transport.detectFeaSidecars!()).resolves.toEqual(feaRes)
  expect(electron.invoke).toHaveBeenLastCalledWith(ipc.gdt, 'detect_fea_sidecars')
})
