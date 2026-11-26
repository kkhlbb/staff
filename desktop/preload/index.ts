import type { M3ExternalProjectEvent } from '../shared/project-agent/m3-lifecycle'
import type { M2PreviewEvent, M2Result } from '../shared/project-agent/m2-preview'
import type { M1ModelResult } from '../shared/project-agent/m1-model-api'
import type { M1WorkbenchEvent } from '../shared/project-agent/m1-workbench'
import {
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent,
} from 'electron'
import {
  IPC_CHANNELS,
  M1_READ_CAPABILITIES,
  IPC_EVENTS,
  type CunlianApi,
  type EditorFlushRequest,
  type EditorFlushedPayload,
  type IpcResult,
  type MenuActionPayload,
  type MigrationCommitValue,
  type MigrationInspectValue,
  type ModelCommitValue,
  type ModelLinkValue,
  type ModelPickValue,
  type ModelReadValue,
  type DrawingExportValue,
  type StepExportValue,
  type DrawingUpdateValue,
  type DxfOpenValue,
  type ChangeApplyValue,
  type ChangeCompareValueResponse,
  type ChangeDraftValue,
  type ChangePreviewValue,
  type ChangeRestoreValue,
  type ProjectOpenValue,
  type ProjectRevealValue,
  type ProjectSaveValue,
  type ProjectStageValue,
  type RecentProjectItem,
  type RecentProjectListValue,
  type RecoveryListValue,
  type RequestCloseResult,
  type SessionReattachValue,
  type SourceReadValue,
  type SourceImportValue,
  type SketchImageImportValue,
  type SketchIngestValue,
  type RequirementEditValue,
  type RequirementConfirmValue,
  type ExtractionRunValue,
  type ExtractionDecideValue,
  type ExtractionCancelValue,
  type ExtractionDeleteDraftValue,
  type ExtractionAttestUnitsValue,
  type ExtractionBatchValue,
  type AgentStartRequest,
  type AgentStartValue,
  type AgentTaskView,
  type AgentProviderStatusValue,
  type AgentPreviewSummary,
  type AgentIssueApprovalRequest,
  type AgentIssueApprovalValue,
  type CommitApprovedDraftRequest,
  type CommitApprovedDraftValue,
  type LocateEvidenceRequest,
  type LocateEvidenceValue,
  type AgentProviderSaveRequest,
  type AgentProviderTestValue,
  type AgentExportRequest,
  type AgentExportValue,
  type IntentCreateValue,
  type IntentDraftView,
  type AgentDraftValue,
  type ToolResult,
} from '../shared/contracts'

/**
 * 只暴露具体函数：
 * - 不暴露 `ipcRenderer`、`send`、`invoke` 或任意 channel 字符串；
 * - 订阅时剥离 Electron 的 event 对象，返回取消订阅函数；
 * - 入参由 renderer 侧尽量收紧，主进程仍会独立校验 schema 与 sender。
 */
function subscribe<T>(
  channel: string,
  listener: (payload: T) => void,
): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T): void => {
    listener(payload)
  }
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

async function invokeM1<T>(channel: string, ...args: unknown[]): Promise<M1ModelResult<T>> {
  try {
    return await ipcRenderer.invoke(channel, ...args)
  } catch {
    return { ok: false, error: { code: 'DISCONNECTED', message: 'M1 工作台连接已断开' } }
  }
}

async function invokeM3<T>(channel: string, request: unknown): Promise<M2Result<T>> {
  try {
    return await ipcRenderer.invoke(channel, request)
  } catch {
    return { ok: false, error: { code: 'BACKEND_UNAVAILABLE', message: '项目连接已断开' } }
  }
}

async function invokeM2<T>(channel: string, request: unknown): Promise<M2Result<T>> {
  try {
    return await ipcRenderer.invoke(channel, request)
  } catch {
    return { ok: false, error: { code: 'DISCONNECTED', message: 'M2 预览连接已断开' } }
  }
}

const api: CunlianApi = {
  getGdtCapability: () => invokeM1(IPC_CHANNELS.gdt, 'capabilities'),
  stageDatum: request => invokeM1(IPC_CHANNELS.gdt, 'stage_datum', request),
  stageGdt: request => invokeM1(IPC_CHANNELS.gdt, 'stage_gdt', request),
  analyzeGdtStackup: request => invokeM1(IPC_CHANNELS.gdt, 'analyze_gdt_stackup', request),
  detectM1LocalAgents: () => invokeM1(IPC_CHANNELS.detectM1LocalAgents),
  registerM1LocalAgent: request => invokeM1(IPC_CHANNELS.registerM1LocalAgent, request),
  listM1ModelApiModels: request => invokeM1(IPC_CHANNELS.listM1ModelApiModels, request),
  getM1LocalAgentInstallInfo: () => invokeM1(IPC_CHANNELS.getM1LocalAgentInstallInfo),
  getM1ConnectionStatus: request => invokeM1(IPC_CHANNELS.getM1ConnectionStatus, request),
  testM1ModelApiConnection: request => invokeM1(IPC_CHANNELS.testM1ModelApiConnection, request),
  sendM1ChatMessage: request => invokeM1(IPC_CHANNELS.sendM1ChatMessage, request),
  cancelM1ChatMessage: request => invokeM1(IPC_CHANNELS.cancelM1ChatMessage, request),
  getM1ExternalActivities: request => invokeM1(IPC_CHANNELS.getM1ExternalActivities, request),
  reconnectM1Session: request => invokeM1(IPC_CHANNELS.reconnectM1Session, request),
  takeoverM1Draft: request => invokeM1(IPC_CHANNELS.takeoverM1Draft, request),
  commitM3ApprovedDraft: request => invokeM3(IPC_CHANNELS.commitM3ApprovedDraft, request),
  undoDraftChange: request => invokeM3(IPC_CHANNELS.undoDraftChange, request),
  getMigrationReport: request => invokeM3(IPC_CHANNELS.getMigrationReport, request),
  openExternalProjectResult: request => invokeM3(IPC_CHANNELS.openExternalProjectResult, request),
  subscribeM3ExternalProjectEvents: async listener => {
    const token = globalThis.crypto.randomUUID()
    let active = true
    const receive = (_event: unknown, id: string, value: M3ExternalProjectEvent) => {
      if (active && id === token) listener(value)
    }
    ipcRenderer.on(IPC_CHANNELS.m3ExternalProjectEvent, receive)
    const stop = () => {
      active = false
      ipcRenderer.removeListener(IPC_CHANNELS.m3ExternalProjectEvent, receive)
    }
    const result = await invokeM3<{ subscriptionId: string }>(IPC_CHANNELS.subscribeM3ExternalProjectEvents, token)
    if (!result.ok) {
      stop()
      return result
    }
    return { ok: true, value: { ...result.value, unsubscribe() {
      stop()
      void ipcRenderer.invoke(IPC_CHANNELS.unsubscribeM3ExternalProjectEvents, token).catch(() => {})
    } } }
  },
  getM2PreviewSnapshot: request => invokeM2(IPC_CHANNELS.getM2PreviewSnapshot, request),
  locateM2Evidence: request => invokeM2(IPC_CHANNELS.locateM2Evidence, request),
  retryM2Drawing: request => invokeM2(IPC_CHANNELS.retryM2Drawing, request),
  submitM2Clarification: request => invokeM2(IPC_CHANNELS.submitM2Clarification, request),
  subscribeM2PreviewEvents: async (request, listener) => {
    const subscriptionId = crypto.randomUUID()
    const receive = (_event: unknown, id: string, value: M2PreviewEvent) => {
      if (id === subscriptionId && value.projectId === request.projectId) listener(value)
    }
    const remove = () => ipcRenderer.removeListener(IPC_CHANNELS.m2PreviewEvent, receive)
    ipcRenderer.on(IPC_CHANNELS.m2PreviewEvent, receive)
    try {
      const result = await ipcRenderer.invoke(IPC_CHANNELS.subscribeM2PreviewEvents, request, subscriptionId)
      if (!result.ok) {
        remove()
        return result
      }
      let active = true
      return { ok: true, value: { subscriptionId, unsubscribe() {
        if (!active) return
        active = false
        remove()
        void ipcRenderer.invoke(IPC_CHANNELS.unsubscribeM2PreviewEvents, subscriptionId).catch(() => {})
      } } }
    } catch {
      remove()
      return { ok: false, error: { code: 'DISCONNECTED', message: '订阅连接已断开' } }
    }
  },
  subscribeM1WorkbenchEvents: async (request, listener) => {
    const subscriptionId = crypto.randomUUID()
    const receive = (_event: unknown, id: string, value: M1WorkbenchEvent) => {
      if (id === subscriptionId) listener(value)
    }
    const remove = () => ipcRenderer.removeListener(IPC_CHANNELS.m1WorkbenchEvent, receive)
    ipcRenderer.on(IPC_CHANNELS.m1WorkbenchEvent, receive)
    try {
      const result = await ipcRenderer.invoke(IPC_CHANNELS.subscribeM1WorkbenchEvents, request, subscriptionId)
      if (!result.ok) {
        remove()
        return result
      }
      let active = true
      return { ok: true, value: { subscriptionId, unsubscribe() {
        if (!active) return
        active = false
        remove()
        void ipcRenderer.invoke(IPC_CHANNELS.unsubscribeM1WorkbenchEvents, subscriptionId).catch(() => {})
      } } }
    } catch {
      remove()
      return { ok: false, error: { code: 'DISCONNECTED', message: '订阅连接已断开' } }
    }
  },
  requestM1ProjectAuthorization: request => ipcRenderer.invoke(IPC_CHANNELS.m1RequestAuthorization, request),
  revokeM1ProjectAuthorization: request => ipcRenderer.invoke(IPC_CHANNELS.m1RevokeAuthorization, request),
  getM1ProjectContext: request => ipcRenderer.invoke(IPC_CHANNELS.m1GetProjectContext, request),
  readM1ProjectEvents: request => ipcRenderer.invoke(IPC_CHANNELS.m1ReadProjectEvents, request),
  // No listener is registered until subscription delivery is implemented.
  subscribeM1ProjectEvents: request => ipcRenderer.invoke(IPC_CHANNELS.m1SubscribeProjectEvents, request),
  cancelM1ProjectSubscription: request => ipcRenderer.invoke(IPC_CHANNELS.m1CancelProjectSubscription, request),
  getM1ReadCapabilities: () => M1_READ_CAPABILITIES,
  stepExport: (request) => ipcRenderer.invoke(IPC_CHANNELS.stepExport, request) as Promise<IpcResult<StepExportValue>>,
  stepCancel: (request) => ipcRenderer.invoke(IPC_CHANNELS.stepCancel, request) as Promise<IpcResult<{ cancelled: boolean }>>,
  newProject: (request) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.projectNew,
      request,
    ) as Promise<IpcResult<ProjectOpenValue>>,
  openProject: (request) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.projectOpen,
      request ?? {},
    ) as Promise<IpcResult<ProjectOpenValue>>,
  stageDraft: (request) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.projectStage,
      request,
    ) as Promise<IpcResult<ProjectStageValue>>,
  saveProject: (request) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.projectSave,
      request,
    ) as Promise<IpcResult<ProjectSaveValue>>,
  saveProjectAs: (request) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.projectSaveAs,
      request,
    ) as Promise<IpcResult<ProjectSaveValue>>,
  listRecent: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.recentList,
      {},
    ) as Promise<IpcResult<RecentProjectListValue>>,
  relinkRecent: (request) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.recentRelink,
      request,
    ) as Promise<IpcResult<{ item: RecentProjectItem }>>,
  listRecovery: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.recoveryList,
      {},
    ) as Promise<IpcResult<RecoveryListValue>>,
  restoreRecovery: (request) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.recoveryRestore,
      request,
    ) as Promise<IpcResult<ProjectOpenValue>>,
  reattachSession: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.sessionReattach,
      {},
    ) as Promise<IpcResult<SessionReattachValue>>,
  readAttachment: (request) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.sourceRead,
      request,
    ) as Promise<IpcResult<SourceReadValue>>,
  revealProject: (request) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.projectReveal,
      request,
    ) as Promise<IpcResult<ProjectRevealValue>>,
  requestClose: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.windowRequestClose,
      {},
    ) as Promise<IpcResult<RequestCloseResult>>,
  inspectV2: (request) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.migrationInspect,
      request,
    ) as Promise<IpcResult<MigrationInspectValue>>,
  commitV2: (request) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.migrationCommit,
      request,
    ) as Promise<IpcResult<MigrationCommitValue>>,
  onMenuAction: (listener) =>
    subscribe<MenuActionPayload>(IPC_EVENTS.menuAction, listener),
  onEditorFlush: (listener) =>
    subscribe<EditorFlushRequest>(IPC_EVENTS.editorFlush, listener),
  respondEditorFlush: (payload: EditorFlushedPayload) => {
    ipcRenderer.send(IPC_EVENTS.editorFlushed, payload)
  },
  pickModel: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.modelPick, request) as Promise<IpcResult<ModelPickValue>>,
  readModel: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.modelRead, request) as Promise<IpcResult<ModelReadValue>>,
  commitModel: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.modelCommit, request) as Promise<IpcResult<ModelCommitValue>>,
  releaseModel: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.modelRelease, request) as Promise<
      IpcResult<{ released: boolean }>
    >,
  linkModel: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.modelLink, request) as Promise<IpcResult<ModelLinkValue>>,
  updateSpacerDrawing: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.drawingUpdateSpacer, request) as Promise<
      IpcResult<DrawingUpdateValue>
    >,
  exportDrawingPdf: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.drawingExportPdf, request) as Promise<
      IpcResult<DrawingExportValue>
    >,
  exportDrawingSvg: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.drawingExportSvg, request) as Promise<
      IpcResult<DrawingExportValue>
    >,
  exportDrawingDxfR12: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.drawingExportDxfR12, request) as Promise<
      IpcResult<DrawingExportValue>
    >,
  exportDrawingDxf2000: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.drawingExportDxf2000, request) as Promise<
      IpcResult<DrawingExportValue>
    >,
  openDxf: () =>
    ipcRenderer.invoke(IPC_CHANNELS.dxfOpen, {}) as Promise<IpcResult<DxfOpenValue>>,
  takePendingDxf: () =>
    ipcRenderer.invoke(IPC_CHANNELS.dxfPending, {}) as Promise<
      IpcResult<DxfOpenValue | null>
    >,
  stageChangeDraft: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.changeStage, request) as Promise<
      IpcResult<ChangeDraftValue>
    >,
  previewChange: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.changePreview, request) as Promise<
      IpcResult<ChangePreviewValue>
    >,
  applyChange: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.changeApply, request) as Promise<
      IpcResult<ChangeApplyValue>
    >,
  bindParameter: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.changeBind, request) as Promise<
      IpcResult<ChangeDraftValue>
    >,
  unbindParameter: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.changeUnbind, request) as Promise<
      IpcResult<ChangeDraftValue>
    >,
  compareDrawings: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.changeCompare, request) as Promise<
      IpcResult<ChangeCompareValueResponse>
    >,
  restoreRevisionDraft: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.changeRestore, request) as Promise<
      IpcResult<ChangeRestoreValue>
    >,
  importSource: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.sourceImport, request) as Promise<
      IpcResult<SourceImportValue>
    >,
  importSketchImage: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.sketchImageImport, request) as Promise<
      IpcResult<SketchImageImportValue>
    >,
  ingestSketchReadings: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.sketchIngestReadings, request) as Promise<
      IpcResult<SketchIngestValue>
    >,
  stageRequirementEdit: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.requirementEdit, request) as Promise<
      IpcResult<RequirementEditValue>
    >,
  confirmRequirement: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.requirementConfirm, request) as Promise<
      IpcResult<RequirementConfirmValue>
    >,
  runExtraction: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.extractionRun, request) as Promise<
      IpcResult<ExtractionRunValue>
    >,
  decideExtraction: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.extractionDecide, request) as Promise<
      IpcResult<ExtractionDecideValue>
    >,
  cancelExtraction: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.extractionCancel, request) as Promise<
      IpcResult<ExtractionCancelValue>
    >,
  getProjectContext: () => ipcRenderer.invoke(IPC_CHANNELS.agentContext),
  getConfirmedInputs: (request) => ipcRenderer.invoke(IPC_CHANNELS.agentConfirmedInputs, request),
  applyConfirmedInputs: (request) => ipcRenderer.invoke(IPC_CHANNELS.agentApplyConfirmed, request),
  stageParameterChange: (request) => ipcRenderer.invoke(IPC_CHANNELS.changeStage, request),
  previewAndCheck: (request) => ipcRenderer.invoke(IPC_CHANNELS.changePreview, request),
  deleteExtractionDraft: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.extractionDeleteDraft, request) as Promise<
      IpcResult<ExtractionDeleteDraftValue>
    >,
  confirmExtractionBatch: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.extractionConfirmBatch, request) as Promise<
      IpcResult<ExtractionBatchValue>
    >,
  attestExtractionUnits: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.extractionAttestUnits, request) as Promise<
      IpcResult<ExtractionAttestUnitsValue>
    >,
  revokeExtractionUnits: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.extractionRevokeUnits, request) as Promise<
      IpcResult<ExtractionBatchValue>
    >,
  agentStart: (request: AgentStartRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentStart, request) as Promise<ToolResult<AgentStartValue>>,
  agentCancel: (request: { taskId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentCancel, request) as Promise<ToolResult<{ cancelled: boolean }>>,
  agentResume: (request: { taskId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentResume, request) as Promise<ToolResult<{ resumed: boolean }>>,
  agentTaskState: (request: { taskId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentTaskState, request) as Promise<ToolResult<AgentTaskView>>,
  agentProviderStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.agentProviderStatus, {}) as Promise<ToolResult<AgentProviderStatusValue>>,
  agentPreviewSummary: () =>
    ipcRenderer.invoke(IPC_CHANNELS.agentPreviewSummary, {}) as Promise<ToolResult<AgentPreviewSummary | null>>,
  issueAgentApproval: (request: AgentIssueApprovalRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentIssueApproval, request) as Promise<ToolResult<AgentIssueApprovalValue>>,
  commitApprovedDraft: (request: CommitApprovedDraftRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentCommitApprovedDraft, request) as Promise<ToolResult<CommitApprovedDraftValue>>,
  locateEvidence: (request: LocateEvidenceRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentLocateEvidence, request) as Promise<ToolResult<LocateEvidenceValue>>,
  saveAgentProvider: (request: AgentProviderSaveRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentProviderSave, request) as Promise<ToolResult<AgentProviderStatusValue>>,
  testAgentProvider: () =>
    ipcRenderer.invoke(IPC_CHANNELS.agentProviderTest, {}) as Promise<ToolResult<AgentProviderTestValue>>,
  clearAgentProviderKey: () =>
    ipcRenderer.invoke(IPC_CHANNELS.agentProviderClearKey, {}) as Promise<ToolResult<AgentProviderStatusValue>>,
  exportApprovedVersion: (request: AgentExportRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentExportApprovedVersion, request) as Promise<ToolResult<AgentExportValue>>,
  onAgentEvent: (listener) => subscribe<AgentTaskView>(IPC_EVENTS.agentEvent, listener),
  intentCreateProject: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.intentCreate, request) as Promise<ToolResult<IntentCreateValue>>,
  intentState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.intentState, {}) as Promise<ToolResult<IntentDraftView | null>>,
  intentApply: () =>
    ipcRenderer.invoke(IPC_CHANNELS.intentApply, {}) as Promise<ToolResult<AgentDraftValue>>,
  intentPreview: () =>
    ipcRenderer.invoke(IPC_CHANNELS.intentPreview, {}) as Promise<ToolResult<AgentDraftValue>>,
  intentConfirmCandidate: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.intentConfirm, request) as Promise<ToolResult<IntentDraftView>>,
  intentIssueApproval: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.intentIssueApproval, request) as Promise<ToolResult<AgentIssueApprovalValue>>,
}

contextBridge.exposeInMainWorld('cunlian', api)
