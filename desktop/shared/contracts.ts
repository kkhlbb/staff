/**
 * 桌面端 IPC 契约（批次 A 公共部分）。
 *
 * 这里的通道名是批次 A 的完整白名单：主进程只会为白名单内的通道注册
 * `ipcMain.handle`/`ipcMain.on`，preload 只把已实现的具体函数暴露到
 * `window.cunlian`，不暴露 `ipcRenderer`、`invoke`、`send` 等通用能力。
 *
 * 批次划分：
 * - A-01（本卡）：通道常量、结果包络、错误码、菜单/编辑屏障事件、窗口关闭。
 * - A-02：`src/project-file` 提供 SnapshotDTO 与容器校验，项目读写 DTO 在后续卡
 *   接入时补充；未实现的通道不会注册处理器，调用会被 Electron 拒绝。
 * - A-03：迁移通道参数与返回。
 * - A-04：项目会话、保存、最近项目、恢复草稿通道。
 */
import type { ProjectFileSnapshot } from '../../src/project-file/types'

/** 批次 A 全部 IPC 通道（与任务卡 §3 表格逐项对应）。 */
export const IPC_CHANNELS = {
  projectNew: 'project:new',
  projectOpen: 'project:open',
  migrationInspect: 'migration:inspect',
  migrationCommit: 'migration:commit',
  projectStage: 'project:stage',
  projectSave: 'project:save',
  projectSaveAs: 'project:save-as',
  recentList: 'recent:list',
  recentRelink: 'recent:relink',
  recoveryList: 'recovery:list',
  recoveryRestore: 'recovery:restore',
  sourceRead: 'source:read',
  projectReveal: 'project:reveal',
  windowRequestClose: 'window:request-close',
} as const

export type IpcChannelName = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

/** 主进程 → 渲染进程事件。 */
export const IPC_EVENTS = {
  menuAction: 'menu:action',
  editorFlush: 'editor:flush',
  editorFlushed: 'editor:flushed',
} as const

export type MenuAction = 'new' | 'open' | 'save' | 'saveAs' | 'importV2' | 'close'

export interface MenuActionPayload {
  action: MenuAction
}

export interface EditorFlushRequest {
  /** main 生成的请求 ID；renderer 必须在 flushed 里原样带回。 */
  requestId: string
}

export interface EditorFlushedPayload {
  requestId: string
  sessionId?: string
  editSeq?: number
}

/** 容器错误码（任务卡 §3 “容器码”）。 */
export type ContainerErrorCode =
  | 'INVALID_ZIP'
  | 'TOO_MANY_ENTRIES'
  | 'TOO_LARGE'
  | 'UNSAFE_PATH'
  | 'DUPLICATE_ENTRY'
  | 'INVALID_MANIFEST'
  | 'HASH_MISMATCH'
  | 'MISSING_REFERENCE'
  | 'INVALID_RECORD'
  | 'EMPTY_BACKUP'

/** 保存错误码（任务卡 §3 “保存码”）。 */
export type SaveErrorCode =
  | 'PERMISSION_DENIED'
  | 'NO_SPACE'
  | 'WRITE_FAILED'
  | 'VERIFY_FAILED'
  | 'RENAME_FAILED'
  | 'EXTERNAL_MODIFIED'
  | 'BUSY'
  | 'SAVE_FAILED'

/** 公共错误码。 */
export type CommonErrorCode =
  | 'FORBIDDEN_SENDER'
  | 'INVALID_REQUEST'
  | 'STALE_SESSION'
  | 'STALE_EDIT'
  | 'CANCELLED'
  | 'NOT_FOUND'
  | 'READ_FAILED'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_JSON'
  | 'STALE_IMPORT'
  | 'CALCULATION_FAILED'
  | 'PROJECT_ID_MISMATCH'
  | 'INDEX_READ_FAILED'
  | 'RECOVERY_READ_FAILED'
  | 'ATTACHMENT_MISSING'
  | 'REVEAL_FAILED'
  | 'EDITOR_TIMEOUT'
  | 'INTERNAL'

export type IpcErrorCode =
  | ContainerErrorCode
  | SaveErrorCode
  | CommonErrorCode

export interface IpcErrorPayload {
  code: IpcErrorCode
  message: string
  detail?: string
}

/** 所有 IPC 调用的统一结果：成功值或结构化错误，不用裸异常跨进程。 */
export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: IpcErrorPayload }

export interface RequestCloseResult {
  closed: true
}

/** 迁移预检（A-03）：只读输入、10 分钟 token、候选项目。 */
export interface MigrationPreviewProject {
  id: string
  name: string
  attachmentCount: number
  missingItems: number
}

export interface MigrationInspectValue {
  importToken: string
  projects: MigrationPreviewProject[]
  warnings: string[]
}

export interface MigrationCommitValue {
  sessionId: string
  editSeq: 0
  snapshot: Omit<ProjectFileSnapshot, 'attachments'>
  path: string | null
  fingerprint: string | null
  warnings: string[]
}

/**
 * preload 暴露到 `window.cunlian` 的 API。
 *
 * 只列具体函数；A-02/A-03/A-04 扩展项目会话方法时同步扩展本接口，并由主进程
 * 注册对应通道。这里不出现 `invoke`/`send`/`on` 这类通用转义口。
 */
export interface CunlianApi {
  /** 请求关闭当前窗口；main 先发编辑屏障，超时或保存失败不会关闭。 */
  requestClose(): Promise<IpcResult<RequestCloseResult>>
  /** V2 迁移：只读预检，返回 10 分钟有效的 importToken 与候选项目。 */
  inspectV2(request: { kind: 'bundle' | 'json' }): Promise<IpcResult<MigrationInspectValue>>
  /** V2 迁移：dirty gate → 另存新 .cunlian → 原子提交成功后才返回项目会话。 */
  commitV2(request: {
    importToken: string
    projectId: string
  }): Promise<IpcResult<MigrationCommitValue>>
  /** 订阅系统菜单动作；返回取消订阅函数。 */
  onMenuAction(listener: (payload: MenuActionPayload) => void): () => void
  /** 订阅编辑屏障请求；返回取消订阅函数。 */
  onEditorFlush(listener: (payload: EditorFlushRequest) => void): () => void
  /** 回复编辑屏障；main 校验 requestId 与编辑序号后才会放行关闭。 */
  respondEditorFlush(payload: EditorFlushedPayload): void
}

/** 应用与 IPC 协议的稳定标识，测试与契约文档共用。 */
export const DESKTOP_APP_NAME = '寸链'
export const DESKTOP_APP_BUNDLE_ID = 'com.kkhlbb.cunlian'
