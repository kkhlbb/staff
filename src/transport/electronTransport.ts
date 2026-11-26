import type {
  M2EvidenceResult,
  M2LocateEvidenceRequest,
  M2PreviewEvent,
  M2PreviewSnapshot,
  M2Result,
  M2RetryDrawingRequest,
  M2RetryDrawingResult,
  M2ClarificationSubmitRequest,
  M2ClarificationSubmitResult,
} from '../../desktop/shared/project-agent/m2-preview'
import type {
  M3CommitApprovedDraftRequest,
  M3CommitApprovedDraftResult,
  M3ExternalProjectEvent,
  M3MigrationReport,
  M3OpenExternalProjectRequest,
  M3OpenExternalProjectResult,
  M3UndoDraftChangeRequest,
  M3UndoDraftChangeResult,
} from '../../desktop/shared/project-agent/m3-lifecycle'
import type { M1AuthorizationRequest } from '../../desktop/shared/project-agent/m1-local-authorization-2002'
import type { EntryScope } from '../../desktop/shared/project-agent/m1-entry-1933'
import {
  normalizeWorkbenchBridgeError,
  probeM1ConnectionUxBridge,
  probeM1ProjectAuthorization,
  probeM1WorkbenchBridge,
  type M1ChatSendRequest,
  type M1ChatSendResult,
  type M1ConnectionStatusSnapshot,
  type M1ConnectionUxBridgeProbe,
  type M1DetectLocalAgentsResult,
  type M1DraftTakeoverRequest,
  type M1DraftTakeoverResult,
  type M1ExternalActivityItem,
  type M1ListModelApiModelsRequest,
  type M1ListModelApiModelsResult,
  type M1LocalAgentInstallInfo,
  type M1ModelApiTestRequest,
  type M1ProjectAuthorizationProbe,
  type M1RegisterLocalAgentRequest,
  type M1RegisterLocalAgentResult,
  type M1WorkbenchBridgeProbe,
  type M1WorkbenchBridgeResult,
  type M1WorkbenchIncomingEvent,
} from '../workspace/project-agent/m1WorkbenchBridge'
import {
  probeM2WorkbenchBridge,
  type M2WorkbenchBridgeProbe,
} from '../workspace/project-agent/m2WorkbenchBridge'
import {
  probeM3WorkbenchBridge,
  type M3WorkbenchBridgeProbe,
} from '../workspace/project-agent/m3WorkbenchBridge'
import {
  FEATURE_3D_ASSEMBLY_M1,
  type AnalyzeCompliantStackupRequest,
  type AnalyzeCompliantStackupResult,
  type AnalyzeGdtStackupRequest,
  type AnalyzeGdtStackupResult,
  type FeaSidecarStatus,
  type ImportMicMatrixRequest,
  type ImportMicMatrixResult,
  type StageDatumRequest,
  type StageGdtRequest,
  type StagePhysicsRequest,
  type StagePhysicsResult,
  type GdtStageResult,
  type AttachmentUpload,
  type CheckSet,
  type CommitDraftRequest,
  type CommitDraftResult,
  type CreateProjectRequest,
  type DraftRef,
  type DrawingRequest,
  type GeometryRequest,
  type ImportProjectRequest,
  type ProjectRef,
  type ProjectSummary,
  type SimulationRequest,
  type SimulationResult,
  type Transport,
  type TransportCapabilities,
  type WriterRequest,
  type WriterState,
} from './types'
import type { M1StageChangeRequest, M1StageResult, M1WriterContext } from '../../desktop/main/project-agent/m1StageContracts'
import type { M1Activity, M1ContextFields, M1EventPageFields } from '../../desktop/shared/project-agent/m1-fields'
import type { M2ModelMeshInput } from '../../desktop/shared/project-agent/m2-preview'
import type { ProjectFileAttachmentRef } from '../project-file/types'

export interface ElectronTransportProbes {
  readonly m1: M1WorkbenchBridgeProbe
  readonly auth: M1ProjectAuthorizationProbe
  readonly connUx: M1ConnectionUxBridgeProbe
  readonly m2: M2WorkbenchBridgeProbe
  readonly m3: M3WorkbenchBridgeProbe
}

export interface CreateElectronTransportOptions {
  /** Primary preload bridge candidate. When omitted, probes `window.cunlian`. */
  readonly bridge?: unknown
  /** Optional M2 preview bridge override (defaults to `bridge`). */
  readonly m2Bridge?: unknown
  /** Optional M3 lifecycle bridge override (defaults to `bridge`). */
  readonly m3Bridge?: unknown
  /** Optional authorization bridge override (defaults to `bridge`). */
  readonly authorizationBridge?: unknown
  /** Optional connection UX bridge override (defaults to `bridge`). */
  readonly connectionUxBridge?: unknown
  /** Optional feature flag override (defaults to frozen `FEATURE_3D_ASSEMBLY_M1`). */
  readonly feature3dAssemblyM1?: boolean
}

export interface WorkbenchEventSubscriptionHandle {
  readonly subscriptionId?: string
  readonly unsubscribe?: () => void
}

/**
 * Desktop Electron implementation of the frozen `Transport` contract,
 * also surfacing narrow typed workbench probes and event subscriptions
 * so UI hooks and components never touch `window.cunlian` directly.
 */
export interface ElectronTransport extends Transport {
  readonly kind: 'electron'
  detectFeaSidecars?(): Promise<M2Result<{ available: boolean; statuses: FeaSidecarStatus[] }>>
  readonly probes: ElectronTransportProbes

  // Narrow M1 workbench methods
  getLocalAgentInstallInfo(): Promise<M1WorkbenchBridgeResult<M1LocalAgentInstallInfo>>
  sendChatMessage(request: M1ChatSendRequest): Promise<M1WorkbenchBridgeResult<M1ChatSendResult>>
  cancelChatMessage(request: {
    readonly projectId: string
    readonly requestId: string
    readonly scopeEpoch: number
  }): Promise<M1WorkbenchBridgeResult<{ readonly cancelled: boolean }>>
  reconnectSession(request: {
    readonly projectId: string
    readonly source: 'local-agent' | 'model-api'
    readonly requestId: string
    readonly scopeEpoch: number
  }): Promise<M1WorkbenchBridgeResult<M1ConnectionStatusSnapshot>>
  takeoverDraft(
    request: M1DraftTakeoverRequest,
  ): Promise<M1WorkbenchBridgeResult<M1DraftTakeoverResult>>
  subscribeWorkbenchEvents(
    request: {
      readonly projectId: string
      readonly scopeEpoch: number
      readonly afterSequence?: number
    },
    listener: (event: M1WorkbenchIncomingEvent) => void,
  ): Promise<M1WorkbenchBridgeResult<WorkbenchEventSubscriptionHandle>>

  // Narrow UX-CONN methods
  detectLocalAgents(): Promise<M1WorkbenchBridgeResult<M1DetectLocalAgentsResult>>
  registerLocalAgent(
    request: M1RegisterLocalAgentRequest,
  ): Promise<M1WorkbenchBridgeResult<M1RegisterLocalAgentResult>>

  // Narrow M1 readonly authorization method
  requestProjectAuthorization(
    request: M1AuthorizationRequest,
  ): Promise<M1WorkbenchBridgeResult<EntryScope>>

  // Narrow M2 preview methods
  getPreviewSnapshot(request: {
    readonly projectId: string
    readonly revision?: string | null
  }): Promise<M2Result<M2PreviewSnapshot>>
  locateEvidence(request: M2LocateEvidenceRequest): Promise<M2Result<M2EvidenceResult>>
  retryDrawing(request: M2RetryDrawingRequest): Promise<M2Result<M2RetryDrawingResult>>
  submitClarification(
    request: M2ClarificationSubmitRequest,
  ): Promise<M2Result<M2ClarificationSubmitResult>>
  subscribePreviewEvents(
    request: { readonly projectId: string },
    listener: (event: M2PreviewEvent) => void,
  ): Promise<M2Result<WorkbenchEventSubscriptionHandle>>

  // Narrow M3 lifecycle methods
  commitApprovedDraft(
    request: M3CommitApprovedDraftRequest,
  ): Promise<M2Result<M3CommitApprovedDraftResult>>
  undoDraftChange(
    request: M3UndoDraftChangeRequest,
  ): Promise<M2Result<M3UndoDraftChangeResult>>
  getMigrationReport(request: {
    readonly projectId: string
  }): Promise<M2Result<M3MigrationReport | null>>
  openExternalProjectResult(
    request: M3OpenExternalProjectRequest,
  ): Promise<M2Result<M3OpenExternalProjectResult>>
  subscribeExternalProjectEvents(
    listener: (event: M3ExternalProjectEvent) => void,
  ): Promise<M2Result<WorkbenchEventSubscriptionHandle>>
}

function unavailableResult<T>(methodName: string): M2Result<T> {
  return {
    ok: false,
    error: {
      code: 'BACKEND_UNAVAILABLE',
      message: `后端尚未接线/不可用（缺失方法：${methodName}）`,
    },
  }
}

function asRecord(candidate: unknown): Record<string, unknown> | null {
  if (candidate !== null && typeof candidate === 'object') {
    return candidate as Record<string, unknown>
  }
  return null
}

function readWindowCunlian(): unknown {
  if (typeof window === 'undefined') return undefined
  return (window as { cunlian?: unknown }).cunlian
}

async function invokeOptionalPreload<T>(
  record: Record<string, unknown> | null,
  methodName: string,
  args: readonly unknown[],
  fallbackError: string,
): Promise<M2Result<T>> {
  const fn = record?.[methodName]
  if (typeof fn !== 'function') {
    return unavailableResult<T>(methodName)
  }
  try {
    const res = await (fn as (...callArgs: unknown[]) => Promise<M2Result<T>>).apply(
      record,
      [...args],
    )
    return res
  } catch (err) {
    return {
      ok: false,
      error: normalizeWorkbenchBridgeError(err, fallbackError),
    }
  }
}

export function isElectronTransport(value: unknown): value is ElectronTransport {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ElectronTransport>
  return candidate.kind === 'electron' && candidate.probes !== undefined
}

/**
 * Creates an `ElectronTransport` wrapping `window.cunlian` (or injected test bridges).
 * All preload access in the desktop workbench is funneled through this factory.
 */
export function createElectronTransport(
  options: CreateElectronTransportOptions = {},
): ElectronTransport {
  const primaryCandidate = options.bridge !== undefined ? options.bridge : readWindowCunlian()
  const m2Candidate = options.m2Bridge !== undefined ? options.m2Bridge : primaryCandidate
  const m3Candidate = options.m3Bridge !== undefined ? options.m3Bridge : primaryCandidate
  const authCandidate =
    options.authorizationBridge !== undefined ? options.authorizationBridge : primaryCandidate
  const connUxCandidate =
    options.connectionUxBridge !== undefined ? options.connectionUxBridge : primaryCandidate

  const primaryRecord = asRecord(primaryCandidate)
  const feature3dFlag = options.feature3dAssemblyM1 ?? FEATURE_3D_ASSEMBLY_M1

  const probes: ElectronTransportProbes = {
    m1: probeM1WorkbenchBridge(primaryCandidate),
    auth: probeM1ProjectAuthorization(authCandidate),
    connUx: probeM1ConnectionUxBridge(connUxCandidate),
    m2: probeM2WorkbenchBridge(m2Candidate),
    m3: probeM3WorkbenchBridge(m3Candidate),
  }

  function invokeGdt<T>(method: string, request: unknown): Promise<M2Result<T>> {
    if (!feature3dFlag && (options.feature3dAssemblyM1 === false || typeof primaryRecord?.[method] !== 'function')) {
      return Promise.resolve({ ok: false, error: { code: 'FEATURE_DISABLED', message: '未启用 3D 装配功能' } })
    }
    return invokeOptionalPreload<T>(primaryRecord, method, [request], 'GD&T 操作失败')
  }

  const transport: ElectronTransport = {
    kind: 'electron',
    probes,

    // --- Frozen Transport contract methods ---
    async listProjects(): Promise<M2Result<{ projects: ProjectSummary[] }>> {
      return invokeOptionalPreload<{ projects: ProjectSummary[] }>(
        primaryRecord,
        'listProjects',
        [],
        '获取项目列表失败',
      )
    },

    async createProject(request: CreateProjectRequest): Promise<M2Result<ProjectSummary>> {
      return invokeOptionalPreload<ProjectSummary>(
        primaryRecord,
        'createProject',
        [request],
        '创建项目失败',
      )
    },

    async importProject(request: ImportProjectRequest): Promise<M2Result<ProjectSummary>> {
      return invokeOptionalPreload<ProjectSummary>(
        primaryRecord,
        'importProject',
        [request],
        '导入项目失败',
      )
    },

    async getProject(request: ProjectRef): Promise<M2Result<ProjectSummary>> {
      return invokeOptionalPreload<ProjectSummary>(
        primaryRecord,
        'getProject',
        [request],
        '获取项目详情失败',
      )
    },

    async readAttachmentBytes(
      request: ProjectRef & { attachmentId: string },
    ): Promise<M2Result<Uint8Array>> {
      return invokeOptionalPreload<Uint8Array>(
        primaryRecord,
        'readAttachmentBytes',
        [request],
        '读取附件字节失败',
      )
    },

    async capabilities(): Promise<M2Result<TransportCapabilities>> {
      if (typeof primaryRecord?.capabilities === 'function') {
        return invokeOptionalPreload<TransportCapabilities>(
          primaryRecord,
          'capabilities',
          [],
          '查询传输能力失败',
        )
      }
      let enabled = feature3dFlag
      if (options.feature3dAssemblyM1 === undefined && typeof primaryRecord?.getGdtCapability === 'function') {
        const capability = await invokeOptionalPreload<{ enabled: boolean }>(primaryRecord, 'getGdtCapability', [], '查询 3D 装配功能失败')
        if (!capability.ok) return capability
        enabled = capability.value.enabled === true
      }
      const attachments: AttachmentUpload['kind'][] = ['pdf', 'stl']
      if (enabled) {
        attachments.push('step')
      }
      const drawingFormats: DrawingRequest['format'][] = ['svg', 'dxf-r12', 'dxf-2000']
      return {
        ok: true,
        value: {
          attachments,
          drawingFormats,
          writerLeases: probes.m1.capabilities.takeover || probes.auth.available,
          modelConnection:
            probes.m1.capabilities.modelApiTest || probes.connUx.capabilities.listModelApiModels,
          FEATURE_3D_ASSEMBLY_M1: enabled,
        },
      }
    },

    stageDatum(request: StageDatumRequest) {
      return invokeGdt<GdtStageResult>('stageDatum', request)
    },

    stageGdt(request: StageGdtRequest) {
      return invokeGdt<GdtStageResult>('stageGdt', request)
    },

    analyzeGdtStackup(request: AnalyzeGdtStackupRequest) {
      return invokeGdt<AnalyzeGdtStackupResult>('analyzeGdtStackup', request)
    },

    stagePhysics(request: StagePhysicsRequest) {
      return invokeGdt<StagePhysicsResult>('stagePhysics', request)
    },

    importMicMatrix(request: ImportMicMatrixRequest) {
      return invokeGdt<ImportMicMatrixResult>('importMicMatrix', request)
    },

    analyzeCompliantStackup(request: AnalyzeCompliantStackupRequest) {
      return invokeGdt<AnalyzeCompliantStackupResult>('analyzeCompliantStackup', request)
    },

    detectFeaSidecars(): Promise<M2Result<{ available: boolean; statuses: FeaSidecarStatus[] }>> {
      return invokeOptionalPreload<{ available: boolean; statuses: FeaSidecarStatus[] }>(
        primaryRecord,
        'detectFeaSidecars',
        [],
        '探测外部 FEA 插件失败',
      )
    },

    async uploadAttachment(request: AttachmentUpload): Promise<M2Result<ProjectFileAttachmentRef>> {
      return invokeOptionalPreload<ProjectFileAttachmentRef>(
        primaryRecord,
        'uploadAttachment',
        [request],
        '上传附件失败',
      )
    },

    async buildGeometry(
      request: GeometryRequest,
    ): Promise<M2Result<DraftRef & { geometryFingerprint: string }>> {
      return invokeOptionalPreload<DraftRef & { geometryFingerprint: string }>(
        primaryRecord,
        'buildGeometry',
        [request],
        '构形失败',
      )
    },

    async triangulate(request: DraftRef): Promise<M2Result<M2ModelMeshInput>> {
      return invokeOptionalPreload<M2ModelMeshInput>(
        primaryRecord,
        'triangulate',
        [request],
        '三角化网格失败',
      )
    },

    async runChecks(request: DraftRef): Promise<M2Result<CheckSet>> {
      return invokeOptionalPreload<CheckSet>(
        primaryRecord,
        'runChecks',
        [request],
        '执行检查失败',
      )
    },

    async runSimulation(request: SimulationRequest): Promise<M2Result<SimulationResult>> {
      return invokeOptionalPreload<SimulationResult>(
        primaryRecord,
        'runSimulation',
        [request],
        '执行公差仿真失败',
      )
    },

    async getDrawing(
      request: DrawingRequest,
    ): Promise<M2Result<{ bytes: Uint8Array; fingerprint: string }>> {
      return invokeOptionalPreload<{ bytes: Uint8Array; fingerprint: string }>(
        primaryRecord,
        'getDrawing',
        [request],
        '获取工程图失败',
      )
    },

    async acquireWriter(request: WriterRequest): Promise<M2Result<WriterState>> {
      return invokeOptionalPreload<WriterState>(
        primaryRecord,
        'acquireWriter',
        [request],
        '申请写入租约失败',
      )
    },

    async takeOverWriter(request: WriterRequest): Promise<M2Result<WriterState>> {
      return invokeOptionalPreload<WriterState>(
        primaryRecord,
        'takeOverWriter',
        [request],
        '接管写入租约失败',
      )
    },

    async revokeWriter(request: ProjectRef): Promise<M2Result<{ revoked: true }>> {
      return invokeOptionalPreload<{ revoked: true }>(
        primaryRecord,
        'revokeWriter',
        [request],
        '撤销写入租约失败',
      )
    },

    async readWriterContext(
      request: ProjectRef,
    ): Promise<M2Result<M1WriterContext & { mountingPlateDraftRevision?: string }>> {
      return invokeOptionalPreload<M1WriterContext & { mountingPlateDraftRevision?: string }>(
        primaryRecord,
        'readWriterContext',
        [request],
        '读取写入上下文失败',
      )
    },

    async stageChange(
      request: ProjectRef & { change: M1StageChangeRequest },
    ): Promise<M2Result<M1StageResult>> {
      return invokeOptionalPreload<M1StageResult>(
        primaryRecord,
        'stageChange',
        [request],
        '暂存草稿变更失败',
      )
    },

    async commitDraft(request: CommitDraftRequest): Promise<M2Result<CommitDraftResult>> {
      if (probes.m3.capabilities.commitM3ApprovedDraft && probes.m3.bridge.commitM3ApprovedDraft) {
        try {
          const result = await probes.m3.bridge.commitM3ApprovedDraft({
            projectId: request.projectId,
            baseRevision: request.baseRevision,
            draftRevision: request.draftRevision,
            checkSetFingerprint: request.checksetFingerprint,
            confirmationToken: request.confirmationToken,
            requestId: request.requestId,
          })
          if (!result.ok) {
            return result
          }
          const { checkSetFingerprint, ...rest } = result.value
          return {
            ok: true,
            value: {
              ...rest,
              checksetFingerprint: checkSetFingerprint,
            },
          }
        } catch (err) {
          return {
            ok: false,
            error: normalizeWorkbenchBridgeError(err, '正式版本提交异常'),
          }
        }
      }
      return unavailableResult<CommitDraftResult>('commitM3ApprovedDraft')
    },

    async authorizeProject(
      request: ProjectRef,
    ): Promise<M2Result<ProjectRef & { authorized: true }>> {
      if (typeof primaryRecord?.authorizeProject === 'function') {
        return invokeOptionalPreload<ProjectRef & { authorized: true }>(
          primaryRecord,
          'authorizeProject',
          [request],
          '项目授权失败',
        )
      }
      if (probes.auth.available && probes.auth.requestM1ProjectAuthorization) {
        try {
          const res = await probes.auth.requestM1ProjectAuthorization({
            projectId: request.projectId,
            requestId: `transport-auth-${Date.now()}`,
            requestGeneration: 0,
            scope: 'readonly',
          } as unknown as M1AuthorizationRequest)
          if (!res.ok) return res
          return {
            ok: true,
            value: { projectId: request.projectId, authorized: true },
          }
        } catch (err) {
          return {
            ok: false,
            error: normalizeWorkbenchBridgeError(err, '项目授权失败'),
          }
        }
      }
      return unavailableResult<ProjectRef & { authorized: true }>('requestM1ProjectAuthorization')
    },

    async getContext(
      request: ProjectRef,
    ): Promise<M2Result<M1ContextFields & { baseRevision: string }>> {
      if (typeof primaryRecord?.getM1ProjectContext === 'function') {
        return invokeOptionalPreload<M1ContextFields & { baseRevision: string }>(
          primaryRecord,
          'getM1ProjectContext',
          [request],
          '获取项目上下文失败',
        )
      }
      return invokeOptionalPreload<M1ContextFields & { baseRevision: string }>(
        primaryRecord,
        'getContext',
        [request],
        '获取项目上下文失败',
      )
    },

    async getExternalActivities(
      request: ProjectRef & { readonly scopeEpoch?: number },
    ): Promise<M2Result<{ activities: M1Activity[]; draftRevision: string | null }>> {
      if (
        probes.m1.capabilities.externalActivities &&
        probes.m1.bridge.getM1ExternalActivities
      ) {
        try {
          const res = await probes.m1.bridge.getM1ExternalActivities({
            projectId: request.projectId,
            scopeEpoch: request.scopeEpoch ?? 1,
          })
          if (!res.ok) return res
          return {
            ok: true,
            value: {
              activities: [...res.value.activities] as unknown as M1Activity[],
              draftRevision: res.value.draftRevision ?? null,
            },
          }
        } catch (err) {
          return {
            ok: false,
            error: normalizeWorkbenchBridgeError(err, '刷新外部任务活动失败'),
          }
        }
      }
      return unavailableResult<{ activities: M1Activity[]; draftRevision: string | null }>(
        'getM1ExternalActivities',
      )
    },

    async readProjectEvents(
      request: ProjectRef & { afterSequence?: number; limit?: number },
    ): Promise<M2Result<M1EventPageFields>> {
      if (typeof primaryRecord?.readM1ProjectEvents === 'function') {
        return invokeOptionalPreload<M1EventPageFields>(
          primaryRecord,
          'readM1ProjectEvents',
          [request],
          '读取项目事件日志失败',
        )
      }
      return invokeOptionalPreload<M1EventPageFields>(
        primaryRecord,
        'readProjectEvents',
        [request],
        '读取项目事件日志失败',
      )
    },

    async getReview(
      request: DraftRef,
    ): Promise<M2Result<{ review: CheckSet; summary: string; baseRevision: string | null }>> {
      return invokeOptionalPreload<{
        review: CheckSet
        summary: string
        baseRevision: string | null
      }>(primaryRecord, 'getReview', [request], '获取审核摘要失败')
    },

    async getCommitStatus(
      request: DraftRef,
    ): Promise<
      M2Result<
        { state: 'awaiting-confirmation' } | { state: 'committed'; result: CommitDraftResult }
      >
    > {
      return invokeOptionalPreload<
        { state: 'awaiting-confirmation' } | { state: 'committed'; result: CommitDraftResult }
      >(primaryRecord, 'getCommitStatus', [request], '查询提交状态失败')
    },

    async getConnectionStatus(request) {
      if (!probes.m1.capabilities.connectionStatus || !probes.m1.bridge.getM1ConnectionStatus) {
        return unavailableResult<M1ConnectionStatusSnapshot>('getM1ConnectionStatus')
      }
      try {
        return await probes.m1.bridge.getM1ConnectionStatus(request)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '检测本地 Agent 状态失败'),
        }
      }
    },

    async testModelConnection(request: M1ModelApiTestRequest) {
      if (!probes.m1.capabilities.modelApiTest || !probes.m1.bridge.testM1ModelApiConnection) {
        return {
          ok: false as const,
          error: {
            code: 'BACKEND_UNAVAILABLE',
            message: '后端尚未接线/不可用（缺失方法：testM1ModelApiConnection）',
          },
        }
      }
      try {
        const res = await probes.m1.bridge.testM1ModelApiConnection(request)
        if (!res.ok) return res
        return {
          ok: true as const,
          value: {
            ...res.value,
            availableModels: [...res.value.availableModels],
          },
        }
      } catch (err) {
        return {
          ok: false as const,
          error: normalizeWorkbenchBridgeError(err, '模型 API 连接测试异常'),
        }
      }
    },

    async listModels(request: M1ListModelApiModelsRequest) {
      if (
        !probes.connUx.capabilities.listModelApiModels ||
        !probes.connUx.bridge.listM1ModelApiModels
      ) {
        return {
          ok: false as const,
          error: {
            code: 'BACKEND_UNAVAILABLE',
            message: '后端尚未接线/不可用（缺失方法：listM1ModelApiModels）',
          },
        }
      }
      try {
        const res: M1WorkbenchBridgeResult<M1ListModelApiModelsResult> =
          await probes.connUx.bridge.listM1ModelApiModels(request)
        if (!res.ok) return res
        return {
          ok: true as const,
          value: {
            ...res.value,
            models: [...res.value.models],
          },
        }
      } catch (err) {
        return {
          ok: false as const,
          error: normalizeWorkbenchBridgeError(err, '拉取模型列表失败'),
        }
      }
    },

    // --- Narrow workbench methods ---
    async getLocalAgentInstallInfo() {
      if (
        !probes.m1.capabilities.localAgentInstallInfo ||
        !probes.m1.bridge.getM1LocalAgentInstallInfo
      ) {
        return unavailableResult<M1LocalAgentInstallInfo>('getM1LocalAgentInstallInfo')
      }
      try {
        return await probes.m1.bridge.getM1LocalAgentInstallInfo()
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '读取本地 Agent 安装信息失败'),
        }
      }
    },

    async sendChatMessage(request) {
      if (!probes.m1.capabilities.builtinChat || !probes.m1.bridge.sendM1ChatMessage) {
        return unavailableResult<M1ChatSendResult>('sendM1ChatMessage')
      }
      try {
        return await probes.m1.bridge.sendM1ChatMessage(request)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '内置对话请求异常'),
        }
      }
    },

    async cancelChatMessage(request) {
      if (!probes.m1.capabilities.cancelChat || !probes.m1.bridge.cancelM1ChatMessage) {
        return unavailableResult<{ cancelled: boolean }>('cancelM1ChatMessage')
      }
      try {
        return await probes.m1.bridge.cancelM1ChatMessage(request)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '取消对话请求异常'),
        }
      }
    },

    async reconnectSession(request) {
      if (!probes.m1.capabilities.reconnect || !probes.m1.bridge.reconnectM1Session) {
        return unavailableResult<M1ConnectionStatusSnapshot>('reconnectM1Session')
      }
      try {
        return await probes.m1.bridge.reconnectM1Session(request)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '重连异常'),
        }
      }
    },

    async takeoverDraft(request) {
      if (!probes.m1.capabilities.takeover || !probes.m1.bridge.takeoverM1Draft) {
        return unavailableResult<M1DraftTakeoverResult>('takeoverM1Draft')
      }
      try {
        return await probes.m1.bridge.takeoverM1Draft(request)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '接管草稿异常'),
        }
      }
    },

    async subscribeWorkbenchEvents(request, listener) {
      if (
        !probes.m1.capabilities.eventSubscription ||
        !probes.m1.bridge.subscribeM1WorkbenchEvents
      ) {
        return unavailableResult<WorkbenchEventSubscriptionHandle>('subscribeM1WorkbenchEvents')
      }
      try {
        return await probes.m1.bridge.subscribeM1WorkbenchEvents(request, listener)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '订阅工作台事件失败'),
        }
      }
    },

    async detectLocalAgents() {
      if (
        !probes.connUx.capabilities.detectLocalAgents ||
        !probes.connUx.bridge.detectM1LocalAgents
      ) {
        return unavailableResult<M1DetectLocalAgentsResult>('detectM1LocalAgents')
      }
      try {
        return await probes.connUx.bridge.detectM1LocalAgents()
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '检测本地 Agent 客户端失败'),
        }
      }
    },

    async registerLocalAgent(request) {
      if (
        !probes.connUx.capabilities.registerLocalAgent ||
        !probes.connUx.bridge.registerM1LocalAgent
      ) {
        return unavailableResult<M1RegisterLocalAgentResult>('registerM1LocalAgent')
      }
      try {
        return await probes.connUx.bridge.registerM1LocalAgent(request)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '配置本地 Agent 连接失败'),
        }
      }
    },

    async requestProjectAuthorization(request) {
      if (!probes.auth.available || !probes.auth.requestM1ProjectAuthorization) {
        return unavailableResult<EntryScope>('requestM1ProjectAuthorization')
      }
      try {
        return await probes.auth.requestM1ProjectAuthorization(request)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '申请原生只读授权异常'),
        }
      }
    },

    async getPreviewSnapshot(request) {
      if (!probes.m2.capabilities.previewSnapshot || !probes.m2.bridge.getM2PreviewSnapshot) {
        return unavailableResult<M2PreviewSnapshot>('getM2PreviewSnapshot')
      }
      try {
        return await probes.m2.bridge.getM2PreviewSnapshot(request)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '获取预览快照失败'),
        }
      }
    },

    async locateEvidence(request) {
      if (!probes.m2.capabilities.locateM2Evidence || !probes.m2.bridge.locateM2Evidence) {
        return unavailableResult<M2EvidenceResult>('locateM2Evidence')
      }
      try {
        return await probes.m2.bridge.locateM2Evidence(request)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '来源定位请求异常'),
        }
      }
    },

    async retryDrawing(request) {
      if (!probes.m2.capabilities.retryDrawing || !probes.m2.bridge.retryM2Drawing) {
        return unavailableResult<M2RetryDrawingResult>('retryM2Drawing')
      }
      try {
        return await probes.m2.bridge.retryM2Drawing(request)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '重试图纸异常'),
        }
      }
    },

    async submitClarification(request) {
      if (
        !probes.m2.capabilities.submitClarification ||
        !probes.m2.bridge.submitM2Clarification
      ) {
        return unavailableResult<M2ClarificationSubmitResult>('submitM2Clarification')
      }
      try {
        return await probes.m2.bridge.submitM2Clarification(request)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '提交澄清回答异常'),
        }
      }
    },

    async subscribePreviewEvents(request, listener) {
      if (!probes.m2.capabilities.previewEvents || !probes.m2.bridge.subscribeM2PreviewEvents) {
        return unavailableResult<WorkbenchEventSubscriptionHandle>('subscribeM2PreviewEvents')
      }
      try {
        return await probes.m2.bridge.subscribeM2PreviewEvents(request, listener)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '订阅预览事件失败'),
        }
      }
    },

    async commitApprovedDraft(request) {
      if (
        !probes.m3.capabilities.commitM3ApprovedDraft ||
        !probes.m3.bridge.commitM3ApprovedDraft
      ) {
        return unavailableResult<M3CommitApprovedDraftResult>('commitM3ApprovedDraft')
      }
      try {
        return await probes.m3.bridge.commitM3ApprovedDraft(request)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '正式版本提交异常'),
        }
      }
    },

    async undoDraftChange(request) {
      if (!probes.m3.capabilities.undoDraftChange || !probes.m3.bridge.undoDraftChange) {
        return unavailableResult<M3UndoDraftChangeResult>('undoDraftChange')
      }
      try {
        return await probes.m3.bridge.undoDraftChange(request)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '撤销草稿修改异常'),
        }
      }
    },

    async getMigrationReport(request) {
      if (!probes.m3.capabilities.getMigrationReport || !probes.m3.bridge.getMigrationReport) {
        return unavailableResult<M3MigrationReport | null>('getMigrationReport')
      }
      try {
        return await probes.m3.bridge.getMigrationReport(request)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '读取迁移报告异常'),
        }
      }
    },

    async openExternalProjectResult(request) {
      if (
        !probes.m3.capabilities.openExternalProjectResult ||
        !probes.m3.bridge.openExternalProjectResult
      ) {
        return unavailableResult<M3OpenExternalProjectResult>('openExternalProjectResult')
      }
      try {
        return await probes.m3.bridge.openExternalProjectResult(request)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '打开外部修改项目失败'),
        }
      }
    },

    async subscribeExternalProjectEvents(listener) {
      if (
        !probes.m3.capabilities.externalProjectEvents ||
        !probes.m3.bridge.subscribeM3ExternalProjectEvents
      ) {
        return unavailableResult<WorkbenchEventSubscriptionHandle>(
          'subscribeM3ExternalProjectEvents',
        )
      }
      try {
        return await probes.m3.bridge.subscribeM3ExternalProjectEvents(listener)
      } catch (err) {
        return {
          ok: false,
          error: normalizeWorkbenchBridgeError(err, '订阅外部项目事件失败'),
        }
      }
    },
  }

  return transport
}

export interface ResolveWorkbenchTransportOptions extends CreateElectronTransportOptions {
  readonly transport?: ElectronTransport | Transport
}

/**
 * Resolves a workbench-ready `ElectronTransport` from either an explicit `transport`
 * prop or legacy `bridge` / `m2Bridge` / `m3Bridge` / `authorizationBridge` props,
 * falling back to `window.cunlian` inside `createElectronTransport`.
 */
export function resolveWorkbenchTransport(
  options: ResolveWorkbenchTransportOptions = {},
): ElectronTransport {
  if (options.transport && isElectronTransport(options.transport)) {
    return options.transport
  }
  if (options.transport) {
    // Wrap a generic Transport (e.g., HttpTransport or custom test Transport) into
    // an ElectronTransport-compatible facade delegating shared methods.
    const generic = options.transport
    const base = createElectronTransport({
      bridge: {
        getM1ConnectionStatus: generic.getConnectionStatus?.bind(generic),
        testM1ModelApiConnection: generic.testModelConnection?.bind(generic),
        listM1ModelApiModels: generic.listModels?.bind(generic),
        getM1ExternalActivities: async (req: { projectId: string; scopeEpoch: number }) =>
          generic.getExternalActivities({ projectId: req.projectId }) as Promise<
            M1WorkbenchBridgeResult<{
              readonly activities: readonly M1ExternalActivityItem[]
              readonly draftRevision?: string | null
            }>
          >,
        commitM3ApprovedDraft: async (req: M3CommitApprovedDraftRequest) => {
          const res = await generic.commitDraft({
            projectId: req.projectId,
            baseRevision: req.baseRevision,
            draftRevision: req.draftRevision,
            checksetFingerprint: req.checkSetFingerprint,
            confirmationToken: req.confirmationToken,
            requestId: req.requestId,
          })
          if (!res.ok) return res
          const { checksetFingerprint, ...rest } = res.value
          return {
            ok: true as const,
            value: {
              ...rest,
              checkSetFingerprint: checksetFingerprint,
            },
          }
        },
      },
      m2Bridge: options.m2Bridge,
      m3Bridge: options.m3Bridge,
      authorizationBridge: options.authorizationBridge,
      connectionUxBridge: options.connectionUxBridge,
      feature3dAssemblyM1: options.feature3dAssemblyM1,
    })
    return {
      ...base,
      listProjects: generic.listProjects.bind(generic),
      createProject: generic.createProject.bind(generic),
      importProject: generic.importProject.bind(generic),
      getProject: generic.getProject.bind(generic),
      readAttachmentBytes: generic.readAttachmentBytes.bind(generic),
      capabilities: generic.capabilities.bind(generic),
      uploadAttachment: generic.uploadAttachment.bind(generic),
      buildGeometry: generic.buildGeometry.bind(generic),
      triangulate: generic.triangulate.bind(generic),
      runChecks: generic.runChecks.bind(generic),
      runSimulation: generic.runSimulation.bind(generic),
      getDrawing: generic.getDrawing.bind(generic),
      acquireWriter: generic.acquireWriter.bind(generic),
      takeOverWriter: generic.takeOverWriter.bind(generic),
      revokeWriter: generic.revokeWriter.bind(generic),
      readWriterContext: generic.readWriterContext.bind(generic),
      stageChange: generic.stageChange.bind(generic),
      stageDatum: generic.stageDatum?.bind(generic),
      stageGdt: generic.stageGdt?.bind(generic),
      analyzeGdtStackup: generic.analyzeGdtStackup?.bind(generic),
      stagePhysics: generic.stagePhysics?.bind(generic),
      importMicMatrix: generic.importMicMatrix?.bind(generic),
      analyzeCompliantStackup: generic.analyzeCompliantStackup?.bind(generic),
      commitDraft: generic.commitDraft.bind(generic),
      authorizeProject: generic.authorizeProject.bind(generic),
      getContext: generic.getContext.bind(generic),
      getExternalActivities: generic.getExternalActivities.bind(generic),
      readProjectEvents: generic.readProjectEvents.bind(generic),
      getReview: generic.getReview.bind(generic),
      getCommitStatus: generic.getCommitStatus.bind(generic),
      getConnectionStatus: generic.getConnectionStatus.bind(generic),
      testModelConnection: generic.testModelConnection.bind(generic),
      listModels: generic.listModels.bind(generic),
    }
  }
  return createElectronTransport(options)
}
