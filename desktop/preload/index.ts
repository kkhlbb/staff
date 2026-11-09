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
  type ProjectOpenValue,
  type ProjectSaveValue,
  type ProjectStageValue,
  type RecentProjectItem,
  type RecentProjectListValue,
  type RecoveryListValue,
  type RequestCloseResult,
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
}

contextBridge.exposeInMainWorld('cunlian', api)
