import {
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent,
} from 'electron'
import {
  IPC_CHANNELS,
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
  type DrawingUpdateValue,
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
  type RequirementEditValue,
  type RequirementConfirmValue,
  type ExtractionRunValue,
  type ExtractionDecideValue,
  type ExtractionCancelValue,
  type ExtractionDeleteDraftValue,
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

const api: CunlianApi = {
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
}

contextBridge.exposeInMainWorld('cunlian', api)
