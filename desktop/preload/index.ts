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
