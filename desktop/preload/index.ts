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
}

contextBridge.exposeInMainWorld('cunlian', api)
