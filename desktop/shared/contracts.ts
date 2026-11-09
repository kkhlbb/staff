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
  /** 渲染器整页重载后重新挂接 main 已有的活动会话（A-04d）。 */
  sessionReattach: 'session:reattach',
  sourceRead: 'source:read',
  projectReveal: 'project:reveal',
  windowRequestClose: 'window:request-close',
  /** B2：STL 模型候选/版本（旧 window.cunlian 只增不改）。 */
  modelPick: 'model:pick',
  modelRead: 'model:read',
  modelCommit: 'model:commit',
  modelRelease: 'model:release',
  modelLink: 'model:link',
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
  | 'PROJECT_ASSETS_TOO_LARGE'

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
  | 'CANDIDATE_EXPIRED'
  | 'FILE_CHANGED'
  | 'STL_EMPTY'
  | 'STL_TOO_LARGE'
  | 'STL_TOO_MANY_TRIANGLES'
  | 'STL_BINARY_LENGTH_MISMATCH'
  | 'STL_INVALID_ASCII'
  | 'STL_NON_FINITE'
  | 'STL_DEGENERATE_TRIANGLE'
  | 'STL_GEOMETRY_RANGE'
  | 'STL_INVALID_FORMAT'
  | 'STL_GEOMETRY_MISMATCH'
  | 'STL_RENDER_PREPARE_FAILED'

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

/** 非附件聚合 DTO：renderer 只持这份 JSON，附件字节永远留在 main。 */
export type SnapshotDto = Omit<ProjectFileSnapshot, 'attachments'>

/**
 * 草稿落盘状态（A-04）。
 *
 * `acceptedSeq` 只表示 main 已在内存接受该编辑；`recovery` 单独表示草稿是否
 * 已落到 userData 下的恢复文件。两者不能互相冒充：
 * - written：该编辑已通过临时文件 → 完整校验 → rename 落到恢复目录；
 * - unchanged：磁盘草稿与本次内容一致，无需重写；
 * - pending：内存已接受，1 秒防抖写入尚未完成（窗口未持久化）；
 * - failed：写入失败，warning 给出原因；内存编辑仍然保留。
 *
 * 任务卡 §3 原文只列 written/unchanged/failed。A-04 之所以增加 `pending`：
 * 任务卡同时要求“已接受编辑后防抖 1 秒写”和“必须展示尚未持久化窗口”，
 * 三值枚举无法诚实表达“内存已接受、草稿还没落盘”，用 unchanged 冒充会
 * 谎报。该扩展只增语义，不改变任何既有取值。
 */
export type RecoveryWriteState = 'written' | 'unchanged' | 'pending' | 'failed'

export interface ProjectOpenValue {
  sessionId: string
  editSeq: 0
  snapshot: SnapshotDto
  path: string | null
  fingerprint: string | null
  warnings: string[]
}

export interface ProjectStageValue {
  /** main 已接受的最新编辑序号。 */
  acceptedSeq: number
  /** 草稿持久化状态；与 acceptedSeq 分开报告。 */
  recovery: RecoveryWriteState
  warning?: string
}

export interface ProjectSaveValue {
  path: string
  fingerprint: string
  savedSeq: number
  warnings: string[]
}

/**
 * 来源附件读取（source:read）。
 *
 * 字节由 main 从会话内存聚合解析出的 blobKey 取得；renderer 只能传会话与
 * revision ID，不能传路径、URL 或 blobKey。Uint8Array 走结构化克隆，不转 base64。
 */
export interface SourceReadValue {
  bytes: Uint8Array
  sha256: string
  fileName: string
}

/** 在系统文件管理器中显示当前会话已落盘的项目文件。 */
export interface ProjectRevealValue {
  shown: true
}

/** 重新挂接时 main 对该会话恢复草稿的只读状态；`none` 表示 main 未跟踪草稿。 */
export type SessionRecoveryState = RecoveryWriteState | 'none'

/**
 * `session:reattach` 命中的会话。
 *
 * `editSeq` 是 main 已接受的最新编辑序号（不是 renderer 重载后丢失的本地序号）；
 * `savedSeq` 是 main 内存里最后成功落盘的编辑序号，从未保存过为 0。
 * 两者关系：`editSeq > savedSeq` 即 dirty（有已接受但未落盘的编辑），
 * `editSeq === savedSeq` 即为已保存。该字段只供 renderer 判断「正式保存状态」，
 * 是否 dirty 仍只由 main 用 `acceptedSeq > savedSeq` 判定，本 DTO 不带 dirty 字段，
 * renderer 也无法用它改写 main 状态。
 */
export interface ReattachedSession {
  sessionId: string
  editSeq: number
  /** main 内存里最后成功保存的序号；从未保存过为 0。 */
  savedSeq: number
  snapshot: SnapshotDto
  path: string | null
  fingerprint: string | null
  recovery: SessionRecoveryState
}

/**
 * `session:reattach` 的返回值：main 内存里有活动会话时返回会话字段本身
 * （无外层 `session` 键），没有时返回 `{session:null}`。
 *
 * 未命中不会新建会话，也不会触发 dirty gate 或草稿写入。
 */
export type SessionReattachValue = ReattachedSession | { session: null }

export interface RecentProjectItem {
  recentId: string
  projectId: string
  name: string
  path: string
  lastOpenedAt: string
  /** 索引里记录的文件已不存在、不是常规文件或不可读时为 true。 */
  missing: boolean
  /**
   * 磁盘上该项目的当前正式版本标识（`project.currentRevisionId` 对应的
   * `fileRevisions[].revisionId`）。
   *
   * 路径失效、文件不可读、容器校验失败或 `currentRevisionId` 对应不到版本记录
   * 时一律为 null，不猜测、不复用索引里的旧值。
   *
   * main 的 `recent:list`/`recent:relink` 总是返回该字段；类型上保留可选仅为
   * 兼容本卡不得修改的旧 renderer mock（`src/pages/DesktopWorkspace.test.tsx`
   * 的 listRecent 假值尚未带 rev）。缺少字段不等于“版本未知”，renderer 应把
   * `undefined` 与 `null` 都按不可用处理。
   */
  rev?: string | null
}

export interface RecentProjectListValue {
  items: RecentProjectItem[]
}

export interface RecoveryItem {
  recoveryId: string
  projectId: string
  name: string
  basePath: string | null
  baseFingerprint: string | null
  savedAt: string
  editSeq: number
  /** 草稿文件损坏/超限时给出原因，不能当成空项目。 */
  error?: string
}

export interface RecoveryListValue {
  items: RecoveryItem[]
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
 * B2 模型版本（STL）。
 * - 候选字节只存在 main 内存，token 绑定窗口/会话且 5 分钟过期；
 * - commit 由 main 重新解析并计算面数/包围盒，不信任 renderer 传来的几何参数；
 * - 旧 18 个函数的签名与行为不变，这 5 个是新增。
 */
export interface ModelPickValue {
  candidateToken: string
  fileName: string
  byteSize: number
  sha256: string
}

export type ModelRevisionRef =
  | { kind: 'candidate'; token: string }
  | { kind: 'revision'; modelRevisionId: string }

export interface ModelReadValue {
  bytes: Uint8Array
  sha256: string
  fileName: string
  byteSize: number
}

export interface ModelCommitValue {
  acceptedSeq: number
  modelRevisionId: string
  snapshot: SnapshotDto
  recovery: RecoveryWriteState
  warning?: string
}

export interface ModelLinkValue {
  acceptedSeq: number
  snapshot: SnapshotDto
  recovery: RecoveryWriteState
  warning?: string
}

/**
 * preload 暴露到 `window.cunlian` 的 API。
 *
 * 只列具体函数；A-02/A-03/A-04 扩展项目会话方法时同步扩展本接口，并由主进程
 * 注册对应通道。这里不出现 `invoke`/`send`/`on` 这类通用转义口。
 */
export interface CunlianApi {
  /** 新建项目（A-04）：dirty gate → main 构造默认聚合 → editSeq 从 0 开始。 */
  newProject(request: {
    name: string
    template: 'empty' | 'chain-demo'
  }): Promise<IpcResult<ProjectOpenValue>>
  /** 打开项目：无 recentId 时用 main 对话框；有 ID 只解析本机索引。 */
  openProject(request?: { recentId?: string }): Promise<IpcResult<ProjectOpenValue>>
  /** 提交编辑副本；acceptedSeq 与 recovery 分开报告。 */
  stageDraft(request: {
    sessionId: string
    editSeq: number
    snapshot: SnapshotDto
  }): Promise<IpcResult<ProjectStageValue>>
  /** 保存到会话已有路径；没有路径时 main 弹另存对话框。 */
  saveProject(request: {
    sessionId: string
    editSeq: number
    expectedFingerprint: string | null
  }): Promise<IpcResult<ProjectSaveValue>>
  /** 另存为：目标由 main 对话框取得。 */
  saveProjectAs(request: {
    sessionId: string
    editSeq: number
  }): Promise<IpcResult<ProjectSaveValue>>
  /** 最近项目索引（≤20 项，路径失效标 missing）。 */
  listRecent(): Promise<IpcResult<RecentProjectListValue>>
  /** 只修复索引里的路径，不打开项目、不覆盖当前会话。 */
  relinkRecent(request: { recentId: string }): Promise<IpcResult<{ item: RecentProjectItem }>>
  /** 恢复草稿列表；损坏草稿带 error 原因。 */
  listRecovery(): Promise<IpcResult<RecoveryListValue>>
  /** 恢复为 path=null 的未保存副本；dirty gate 后原子切换。 */
  restoreRecovery(request: { recoveryId: string }): Promise<IpcResult<ProjectOpenValue>>
  /**
   * 重新挂接当前窗口在 main 里的活动会话（整页重载后使用）。
   * 没有活动会话时返回 `{session:null}`；不新建会话、不跑 dirty gate。
   */
  reattachSession(): Promise<IpcResult<SessionReattachValue>>
  /** 读取当前会话或其历史归档里某个来源版本的附件字节；不接受路径/blobKey。 */
  readAttachment(request: {
    sessionId: string
    revisionId: string
  }): Promise<IpcResult<SourceReadValue>>
  /** 在访达中显示当前会话已落盘的项目文件；路径只能来自 main 会话。 */
  revealProject(request: { sessionId: string }): Promise<IpcResult<ProjectRevealValue>>
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

  /* ---- B2：STL 模型（新增，旧函数不变） ------------------------------ */
  /** 系统对话框选单个 STL；main 检查常规文件、非符号链接、≤10 MiB。 */
  pickModel(request: {
    sessionId: string
    baseEditSeq: number
    replacePartId?: string
  }): Promise<IpcResult<ModelPickValue>>
  /** 读取候选或当前/历史模型版本字节；不接受路径或 blobKey。 */
  readModel(request: {
    sessionId: string
    ref: ModelRevisionRef
  }): Promise<IpcResult<ModelReadValue>>
  /** 原子接纳：main 解析/校验/容量检查后创建新不可变版本。 */
  commitModel(request: {
    sessionId: string
    baseEditSeq: number
    candidateToken: string
    expectedCurrentModelRevisionId: string | null
    partName: string
    unitNote: string
  }): Promise<IpcResult<ModelCommitValue>>
  /** 只释放本窗口本会话的候选；不删除磁盘源文件或项目版本。 */
  releaseModel(request: {
    sessionId: string
    candidateToken: string
  }): Promise<IpcResult<{ released: boolean }>>
  /** 创建/确认“外形资料来源”关联；不改变尺寸链数值、不自动同步。 */
  linkModel(request: {
    sessionId: string
    baseEditSeq: number
    operation: 'bind' | 'confirm-new'
    linkId?: string
    termId: string
    target: {
      granularity: 'model' | 'part'
      partId: string
      modelRevisionId: string | null
    }
    expectedCurrentModelRevisionId: string | null
  }): Promise<IpcResult<ModelLinkValue>>
}

/** 应用与 IPC 协议的稳定标识，测试与契约文档共用。 */
export const DESKTOP_APP_NAME = '寸链'
export const DESKTOP_APP_BUNDLE_ID = 'com.kkhlbb.cunlian'
