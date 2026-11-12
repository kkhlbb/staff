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
import type {
  ProjectFileParameterBindingLink,
  ProjectFileSpacerParameter,
} from '../../src/project-file/types'
import type { ChainDefinition, ChainResult } from '../../src/domain/types'
import type { DrawingData } from '../../src/drawing/types'
import type { ReviewSummary } from '../../src/review/rules'
import type { ReviewGroups } from '../../src/revisions/status'
import type {
  BindingDiffRow,
  ParameterDiffRow,
} from '../../src/revisions/types'
import type { DrawingCompareValue } from '../../src/revisions/compare'
import type {
  RequirementCheck,
  RequirementEvaluation,
  RequirementEditDraft,
  RequirementRevision,
} from '../../src/requirements/types'
import type { PdfPageBox, PdfRect } from '../../src/sources/pdfCoordinates'

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
  /** C：隔套参数 + 图纸草稿（原子事务）与矢量导出。 */
  drawingUpdateSpacer: 'drawing:update-spacer',
  drawingExportPdf: 'drawing:export-pdf',
  drawingExportSvg: 'drawing:export-svg',
  /** DXF 导出 v1：R12（默认）/ 2000。 */
  drawingExportDxfR12: 'drawing:export-dxf-r12',
  drawingExportDxf2000: 'drawing:export-dxf-2000',
  /** 内置 DXF 看图（只读）：系统对话框选 .dxf 与启动参数排队文件。 */
  dxfOpen: 'dxf:open',
  dxfPending: 'dxf:pending',
  /** D：参数联动（草稿/预览/确认/绑定/对比/恢复）。 */
  changeStage: 'change:stage',
  changePreview: 'change:preview',
  changeApply: 'change:apply',
  changeBind: 'change:bind',
  changeUnbind: 'change:unbind',
  changeCompare: 'change:compare',
  changeRestore: 'change:restore',
  /** V3.5：桌面 PDF 导入/换版与任务书条款。 */
  sourceImport: 'source:import',
  requirementEdit: 'requirement:edit',
  requirementConfirm: 'requirement:confirm',
  /** V3.6：任务书 PDF 提取（main 精确版本读取、页范围/预算/取消）与逐条决定。 */
  extractionRun: 'extraction:run',
  extractionDecide: 'extraction:decide',
  extractionCancel: 'extraction:cancel',
  /** V3.6 多草稿：删除被取代（旧规则版本）的草稿。 */
  extractionDeleteDraft: 'extraction:delete-draft',
  agentContext: 'agent:context',
  agentConfirmedInputs: 'agent:confirmed-inputs',
  agentApplyConfirmed: 'agent:apply-confirmed',
  /** V4.0 阶段 3：任务侧栏、一次性授权、重算提交与来源定位。 */
  agentStart: 'agent:start',
  agentCancel: 'agent:cancel',
  agentResume: 'agent:resume',
  agentTaskState: 'agent:task-state',
  agentProviderStatus: 'agent:provider-status',
  agentPreviewSummary: 'agent:preview-summary',
  agentIssueApproval: 'agent:issue-approval',
  agentCommitApprovedDraft: 'agent:commit-approved-draft',
  agentLocateEvidence: 'agent:locate-evidence',
  /** ADR-001 第 3 步：无任务书入口（对话建件）；全部由用户界面触发。 */
  intentCreate: 'intent:create',
  intentState: 'intent:state',
  intentApply: 'intent:apply',
  intentPreview: 'intent:preview',
  intentIssueApproval: 'intent:issue-approval',
  intentConfirm: 'intent:confirm',
  /** V4.0 阶段 4：真实供应商配置、连接测试与受控导出。 */
  agentProviderSave: 'agent:provider-save',
  agentProviderTest: 'agent:provider-test',
  agentProviderClearKey: 'agent:provider-clear-key',
  agentExportApprovedVersion: 'agent:export-approved-version',
} as const

export type IpcChannelName = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

/** 主进程 → 渲染进程事件。 */
export const IPC_EVENTS = {
  menuAction: 'menu:action',
  editorFlush: 'editor:flush',
  editorFlushed: 'editor:flushed',
  /** 主进程推送任务/步骤快照；侧栏据此显示工具回执。 */
  agentEvent: 'agent:event',
} as const

export type MenuAction = 'new' | 'open' | 'save' | 'saveAs' | 'importV2' | 'close' | 'openDxf'

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
  | 'BACKUP_FAILED'
  | 'BACKUP_VERIFY_FAILED'
  | 'BACKUP_SOURCE_UNREADABLE'
  | 'BACKUP_SOURCE_CHANGED'
  | 'STALE_REQUIREMENT'
  | 'REQUIREMENT_NOT_SATISFIED'
  | 'REQUIREMENT_PENDING_CONFIRMATION'
  | 'REQUIREMENT_UNCHECKED'
  | 'REQUIREMENT_LIMIT_EXCEEDED'
  | 'INVALID_REQUIREMENT_INPUT'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_UNREADABLE'
  | 'PAGE_OUT_OF_RANGE'
  | 'INVALID_REGION'
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
  /** C：隔套图纸与矢量导出。 */
  | 'INVALID_PARAMETER'
  | 'DRAWING_NOT_FOUND'
  | 'STALE_DRAWING'
  | 'DRAWING_OVERFLOW'
  | 'INVALID_DRAWING'
  | 'FONT_UNAVAILABLE'
  | 'PRINT_TIMEOUT'
  | 'PDF_EXPORT_FAILED'
  | 'SVG_EXPORT_FAILED'
  /** D：参数联动。 */
  | 'STALE_BASE'
  | 'STALE_DRAFT'
  | 'STALE_PREVIEW'
  | 'INVALID_BINDING'
  | 'NO_DRAWING'
  | 'UNSUPPORTED_TEMPLATE'
  | 'COMPARE_UNAVAILABLE'
  /** V3.6：任务书提取。 */
  | 'EXTRACTION_BUSY'
  | 'EXTRACTION_CANCELLED'
  | 'EXTRACTION_TIMEOUT'
  | 'EXTRACTION_BUDGET'
  | 'EXTRACTION_CONFIRMATION_REQUIRED'
  | 'EXTRACTION_EVIDENCE_REQUIRED'
  | 'EXTRACTION_CANDIDATE_BLOCKED'
  | 'EXTRACTION_CANDIDATE_REJECTED'
  | 'EXTRACTION_GROUP_CONFLICT'
  | 'EXTRACTION_STALE_DECISION'
  | 'EXTRACTION_REASON_REQUIRED'
  | 'EXTRACTION_VERSION_MISMATCH'
  /** V3.6 多草稿：旧规则版本草稿只读；最新草稿不许删。 */
  | 'EXTRACTION_DRAFT_SUPERSEDED'
  | 'EXTRACTION_DRAFT_LATEST'

export type IpcErrorCode =
  | ContainerErrorCode
  | SaveErrorCode
  | CommonErrorCode

export interface IpcErrorPayload {
  code: IpcErrorCode
  message: string
  detail?: string
  /** 条款类错误的明确原因码（与 message 并列，不只有文案）。 */
  reasonCodes?: string[]
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
  /** ADR-001 第 3 步：项目依据种类；旧索引没有该字段，按 'pdf' 显示。 */
  sourceKind?: 'pdf' | 'user-intent'
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

/**
 * 内置 DXF 看图的只读文件内容：main 选文件并读字节，renderer 只拿到字节与文件名。
 * 不接受 renderer 传路径；大文件在这里按上限拒绝。
 */
export interface DxfOpenValue {
  fileName: string
  byteSize: number
  bytes: Uint8Array
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
 * C：隔套图纸。
 *
 * 请求只带十进制字符串与登记比例；main 重新解析 q、重建 DrawingData 并原子
 * 接纳参数与图纸引用。renderer 不能传路径、SVG/bitmap、打印选项或图元数组。
 */
export interface SpacerDrawingInputs {
  innerDiameter: string
  outerDiameter: string
  length: string
}

export interface SpacerFrameFieldsRequest {
  partName: string
  drawingNumber: string
  version: string
  material: string
  tolerance: string
  surface: string
  drafter: string
  date: string
}

export interface DrawingUpdateRequest {
  sessionId: string
  baseEditSeq: number
  partId: string
  inputs: SpacerDrawingInputs
  scale: { numerator: number; denominator: number }
  frameFields: SpacerFrameFieldsRequest
}

export interface DrawingUpdateValue {
  acceptedSeq: number
  drawingId: string
  drawingFingerprint: string
  /** main 重建的权威 DrawingData（纯数据）；预览只用它。 */
  drawingData: import('../../src/drawing/types').DrawingData
  snapshot: SnapshotDto
  recovery: RecoveryWriteState
  warning?: string
}

export interface DrawingExportRequest {
  sessionId: string
  baseEditSeq: number
  drawingId: string
  drawingFingerprint: string
}

export interface DrawingExportValue {
  fileName: string
  byteSize: number
  sha256: string
  drawingId: string
  drawingFingerprint: string
}

/* ------------------------------------------------------------------ */
/* D：参数联动草稿 / 预览 / 确认                                        */
/* ------------------------------------------------------------------ */

export interface ChangeBindingInput {
  termId: string
  partId: string
  parameterId: string
}

export interface ChangeStageRequest {
  sessionId: string
  /** renderer 看到的 main acceptedSeq；不一致即拒绝，不静默合并。 */
  baseEditSeq: number
  inputs: SpacerDrawingInputs
  sourceNotes?: {
    innerDiameter?: string
    outerDiameter?: string
    length?: string
  }
  /** 不传表示沿用当前正式绑定；传空数组表示解除全部参数绑定。 */
  bindings?: ChangeBindingInput[]
  reason: string
}

export interface ChangeDraftValue {
  draftId: string
  draftRevision: number
  baseToken: string
  draftToken: string
  parameters: ProjectFileSpacerParameter[]
  bindings: ProjectFileParameterBindingLink[]
  /** 恢复旧版/重建草稿时为 true：当前确认已清零，必须重新预览确认。 */
  confirmationCleared: boolean
  notice?: string
}

export interface ChangePreviewRequest {
  sessionId: string
  baseToken: string
  draftToken: string
}

export interface ChangePreviewValue {
  previewId: string
  previewToken: string
  baseToken: string
  draftToken: string
  revisionId: string
  parameters: ProjectFileSpacerParameter[]
  previousChain: ChainDefinition
  chain: ChainDefinition
  previousResult: ChainResult
  result: ChainResult
  parameterDiffs: ParameterDiffRow[]
  termDiffs: BindingDiffRow[]
  affectedTermIds: string[]
  unboundTermIds: string[]
  drawing: {
    record: import('../../src/project-file/types').ProjectFileDrawingRecord
    left: DrawingData | null
    right: DrawingData
    leftProblem: string | null
  }
  review: ReviewSummary
  groups: ReviewGroups
  /** 预览阶段已知的阻断项（悬空引用/半同步等）；非空时确认按钮禁用。 */
  blockers: string[]
  /**
   * V3.5：本次预览的条款检查（main 权威）。无条款时为 null；原项目 target
   * 的独立结果在 originalTargetResult 中，二者并列展示、互不覆盖。
   */
  requirement: RequirementPreviewValue | null
}

export interface RequirementPreviewValue {
  check: RequirementCheck
  evaluation: RequirementEvaluation
  /** 当前活动条款版本；无条款为 null。 */
  revision: RequirementRevision | null
  /** 原项目 target 的独立计算结果（chain.target 未被条款覆盖）。 */
  originalTargetResult: ChainResult | null
  /** 条款区间数值结果（与 check.resultInterval 同源）。 */
  requirementResult: ChainResult | null
}

export interface ChangeApplyRequest {
  sessionId: string
  baseToken: string
  draftToken: string
  previewId: string
  previewToken: string
  /** 幂等键：重复点击最多产生一个版本/一组事件/一个快照。 */
  requestId: string
  reason: string
}

export interface ChangeApplyValue {
  revisionId: string
  acceptedSeq: number
  savedSeq: number
  snapshot: SnapshotDto
  path: string
  fingerprint: string
  analysisSnapshotId: string
  recovery: RecoveryWriteState | 'none'
  warnings: string[]
}

export interface ChangeBindRequest {
  sessionId: string
  baseEditSeq: number
  termId: string
  partId: string
  parameterId: string
  /** 替换同环已有绑定时必须回传旧 bindingId；否则拒绝追加第二参数。 */
  replaceBindingId?: string
  reason: string
}

export interface ChangeUnbindRequest {
  sessionId: string
  baseEditSeq: number
  bindingId: string
  reason: string
}

export type ChangeDraftValueResponse = ChangeDraftValue

export interface ChangeCompareRequest {
  sessionId: string
  /** 左图版本；不传时用当前正式版本。 */
  leftRevisionId?: string
  /** 右侧为当前草稿（需要 draftToken）或当前正式图纸。 */
  rightDraftToken?: string
  drawingId?: string
}

export type ChangeCompareValueResponse = DrawingCompareValue

export interface ChangeRestoreRequest {
  sessionId: string
  baseToken: string
  sourceRevisionId: string
  reason: string
}

export interface ChangeRestoreValue {
  draftId: string
  draftRevision: number
  baseToken: string
  draftToken: string
  restoredFromRevisionId: string
  parameters: ProjectFileSpacerParameter[]
  bindings: ProjectFileParameterBindingLink[]
  confirmationCleared: true
  notice: string
}

/* ------------------------------------------------------------------ */
/* V3.5：桌面 PDF 导入 / 任务书条款                                    */
/* ------------------------------------------------------------------ */

/** main 解析出的 PDF 页面几何（未旋转 PDF 空间；页码从 1 起）。 */
export interface SourcePdfPageInfo {
  page: number
  pageBoxPdf: PdfPageBox
  widthPt: number
  heightPt: number
  rotate: number
}

export interface SourceImportRequest {
  sessionId: string
  baseEditSeq: number
  /** 传入既有 documentId 表示同一文档换版；不传/为 null 新建文档。 */
  documentId?: string | null
}

export interface SourceImportValue {
  acceptedSeq: number
  documentId: string
  revisionId: string
  blobKey: string
  fileName: string
  sha256: string
  byteSize: number
  pageCount: number
  /** 供框选页身份校验；字节仍只由 readAttachment 按 revisionId 读取。 */
  pages: SourcePdfPageInfo[]
  snapshot: SnapshotDto
  recovery: RecoveryWriteState | 'none'
  warning?: string
}

/** 条款编辑中的未确认表单（只存在 main 内存；不写正式条款）。 */
export interface RequirementEditRequest {
  sessionId: string
  baseEditSeq: number
  /** null 表示取消编辑，回到原活动条款。 */
  edit: RequirementEditDraft | null
}

export interface RequirementEditValue {
  baseToken: string
  acceptedSeq: number
  activeRequirementRevisionId: string | null
  hasPendingEdit: boolean
}

export interface RequirementConfirmSource {
  documentId: string
  revisionId: string
  page: number
  rectPdf: PdfRect
  pageBoxPdf: PdfPageBox
}

export interface RequirementConfirmRequest {
  sessionId: string
  baseToken: string
  expectedActiveRequirementRevisionId: string | null
  /** 更新既有条款时的 requirementId；首版为 null。 */
  requirementId: string | null
  source: RequirementConfirmSource
  confirmedText: string
  lowerText: string
  upperText: string
  changeReason: string
  /** 必须是显式确认；false/缺省一律拒绝。 */
  confirmed: true
}

export interface RequirementConfirmValue {
  requirementId: string
  requirementRevisionId: string
  configRevisionId: string
  baselineCheck: RequirementCheck
  acceptedSeq: number
  savedSeq: number
  path: string
  fingerprint: string
  snapshot: SnapshotDto
  recovery: 'none'
  warnings: string[]
}


/* ------------------------------------------------------------------ */
/* V3.6：任务书 PDF 提取（隔离草稿 + 逐条人工决定）                     */
/* ------------------------------------------------------------------ */

/**
 * 提取请求。
 *
 * renderer 只传“确切 revision + 页范围 + 请求号”：
 * - revisionId 必须是当前会话快照里存在的版本，main 不会自动追随 latest；
 * - 不传路径、blobKey、sha256 或字节；main 从版本记录解析并自算哈希；
 * - requestId 供 `extraction:cancel` 取消同一次提取。
 */
export interface ExtractionRunRequest {
  sessionId: string
  baseEditSeq: number
  revisionId: string
  /** 1-based 闭合页范围。 */
  pageFrom: number
  pageTo: number
  requestId: string
}

export interface ExtractionRunValue {
  acceptedSeq: number
  draftId: string
  extractorVersion: string
  candidateCount: number
  /** 本次新增的候选数；同一版本/页范围/规则重提时为 0。 */
  addedCandidateCount: number
  /** true 表示重提完全命中已有草稿，未产生新候选/issue，也未推进编辑序号。 */
  unchanged: boolean
  snapshot: SnapshotDto
  recovery: RecoveryWriteState | 'none'
  warning?: string
}

export type ExtractionDecisionAction = 'confirm' | 'reject' | 'edit' | 'revoke'

/**
 * 逐条决定请求。
 *
 * - 确认必须显式 `confirmed: true`；main 仍会校验候选状态、编辑代数、出处与决定快照；
 * - 拒绝必须给理由；
 * - 撤销（action='revoke'）只对仍有效的已确认候选开放，撤销后回到待确认；
 * - 同一符号（ring group）只允许一条有效确认：确认第二条返回 EXTRACTION_GROUP_CONFLICT；
 * - 编辑只接受 mm 文本，且改后文本必须出现在该字段原有原文片段里（不伪造出处）；
 * - actor/decidedAt 由 main 生成，renderer 不能填写。
 */
export interface ExtractionDecideRequest {
  sessionId: string
  baseEditSeq: number
  draftId: string
  candidateId: string
  /** 界面看到的候选编辑代数；不匹配即拒绝。 */
  editRevision: number
  action: ExtractionDecisionAction
  /** action=confirm 时必须为字面量 true。 */
  confirmed?: true
  /** action=reject 时必填。 */
  reason?: string
  /** action=edit 时必填：字段名与 mm 十进制文本。 */
  field?: 'nominal' | 'upperDeviation' | 'lowerDeviation' | 'lower' | 'upper' | 'innerDiameter' | 'outerDiameter' | 'length'
  text?: string
}

export interface ExtractionDecideValue {
  /** Main-issued after UI confirmation has been persisted; never accepted from Agent input. */
  planToken?: string
  acceptedSeq: number
  draftId: string
  candidateId: string
  status: 'pending' | 'blocked' | 'confirmed' | 'rejected' | 'stale'
  decisionId: string | null
  snapshot: SnapshotDto
  recovery: RecoveryWriteState | 'none'
  warning?: string
}

export interface ExtractionCancelRequest {
  sessionId: string
  requestId: string
}

export interface ExtractionCancelValue {
  cancelled: boolean
}

/**
 * 删除一份被取代的草稿（多草稿方案 3）。
 *
 * - 只允许删“同一 PDF 版本 + 同一页范围下存在严格更高 extractorVersion”的草稿；
 *   最新草稿一律拒绝（EXTRACTION_DRAFT_LATEST）——删除最新等于删掉唯一可用结果，
 *   用户真正需要的是重提，而不是把提取页清空。
 * - 只删这一份 `extractionDrafts` 条目；来源 PDF、条款、绑定、图纸、其它草稿都不动。
 * - 原子：先按 schema8 编码自校验、再写恢复草稿，两步都成功才切换会话快照；
 *   任一步失败返回错误且内存/磁盘都不变。
 */
export interface ExtractionDeleteDraftRequest {
  sessionId: string
  baseEditSeq: number
  draftId: string
}

export interface ExtractionDeleteDraftValue {
  acceptedSeq: number
  /** 已删除的草稿 id（便于界面确认删的是哪一份）。 */
  draftId: string
  remainingDraftCount: number
  snapshot: SnapshotDto
  recovery: RecoveryWriteState | 'none'
  warning?: string
}

/**
 * preload 暴露到 `window.cunlian` 的 API。
 *
 * 只列具体函数；A-02/A-03/A-04 扩展项目会话方法时同步扩展本接口，并由主进程
 * 注册对应通道。这里不出现 `invoke`/`send`/`on` 这类通用转义口。
 */
export type ToolErrorCode =
  | 'INVALID_INPUT' | 'NEEDS_CLARIFICATION' | 'UNSUPPORTED_SCOPE' | 'SOURCE_CHANGED'
  | 'NOT_CONFIRMED' | 'CONSTRAINT_VIOLATED' | 'STALE_BASE' | 'STALE_PREVIEW'
  | 'CANCELLED' | 'TIMEOUT' | 'TOOL_FAILED' | 'SAVE_FAILED'
  /** 无任务书项目：条款区间只能来自用户原话（模型代填/引用标准等级一律拒绝）。 */
  | 'REQUIREMENT_MUST_BE_USER_GIVEN'
  /** 无任务书项目：工具给出的数值必须出现在本轮用户原话里。 */
  | 'VALUE_MUST_BE_USER_GIVEN'
  /** 无任务书项目：出处原话必须能在本轮用户输入里逐字找到。 */
  | 'STATEMENT_NOT_USER_GIVEN'

export type ToolResult<T> =
  | { ok: true; data: T; requestId: string; objectVersion: string }
  | { ok: false; code: ToolErrorCode; message: string; requestId: string; objectVersion?: string; details?: unknown }

export interface ApplyConfirmedInputsRequest {
  planToken: string
  baseRevisionId: string
  candidateIds: string[]
  mapping: import('../../src/agent-tools/mapConfirmed').MappingIntent
}

export interface AgentDraftValue extends importAgentMappedInputs {
  draftId: string
  draftRevision: number
  baseRevisionId: string
  checkStatus: 'pending-confirmation'
  requirementPreview: { status: 'pending-confirmation' | 'unchecked'; reasonCodes: string[]; result: ChainResult | null }
  stale: boolean
  evidenceRefs: import('../../src/document-extraction').ExtractionEvidence[]
  issues: { code: ToolErrorCode; missing: { field: string; purpose: string }[] }[]
  geometry: { innerDiameterQ: number; outerDiameterQ: number; lengthQ: number }
  diff: { before: ChainDefinition; after: ChainDefinition; parameters: ParameterDiffRow[] }
  /** previewAndCheck 才返回：主进程侧的预览身份与指纹（确认提交的唯一依据）。 */
  previewId?: string
  previewFingerprint?: string
}
type importAgentMappedInputs = import('../../src/agent-tools/mapConfirmed').MappedInputs

export interface ConfirmedCandidateView {
  candidateId: string
  kind: 'ring' | 'interval' | 'formula' | 'part-dimension'
  status: string
  /** 提取器给出的原因码（例如 FORMULA_UNRESOLVED_OPERAND）；模型据此说明缺什么。 */
  reasonCodes: string[]
  editRevision: number
  page: number
  /** 原文片段，截到 160 字，只用于让模型核对，不构成授权。 */
  rawText: string
  summary: Record<string, string | null>
}

/**
 * `confirmed` 工具的模型视图：只给映射需要的候选字段，不带选区几何与全文，
 * 避免把整份草稿塞进上下文。完整草稿仍只在主进程内使用。
 */
export interface ConfirmedInputsView {
  draftId: string
  draftRevision: number
  pageRange: { from: number; to: number }
  extractorVersion: string
  issues: { code: string; severity: string; message: string }[]
  candidates: ConfirmedCandidateView[]
  sourceExcerpt: { pages: { page: number; text: string }[]; truncated: boolean } | null
}

/** 模型视图的工程草稿：去掉图纸/差分等大字段，只留复核与映射需要的内容。 */
export interface AgentDraftView {
  draftId: string
  draftRevision: number
  baseRevisionId: string
  stale: boolean
  parameters: { key: string; valueQ: number; valueMm?: string; inputDecimals: number; reviewStatus: string }[]
  geometry: { innerDiameterQ: number; outerDiameterQ: number; lengthQ: number }
  issues: { code: string; missing: { field: string; purpose: string }[] }[]
  requirementPreview: { status: string; reasonCodes: string[] }
  result: ChainResult | null
  chainTerms: { symbol: string; nominalQ: number; lowerDeviationQ: number; upperDeviationQ: number; sign: number }[]
}

export interface AgentContextValue {
  projectId: string
  revisionId: string
  draft: AgentDraftView | null
  parameters: (ProjectFileSpacerParameter & { valueMm?: string })[]
  bindings: ProjectFileSnapshot['project']['dimensionLinks']
  requirements: RequirementRevision[]
  check: RequirementCheck | null
  /** 最近保存的版本（含当时参数），供“上次改了什么”这类续问使用；不含模型自述。 */
  recentRevisions?: {
    revisionId: string
    createdAt: string
    reason: string
    parameters: { key: string; valueQ: number; valueMm?: string; inputDecimals: number }[]
  }[]
}

export interface AgentParameterChangeRequest {
  toolMode: 'agent'
  draftId: string
  baseRevisionId: string
  parameter: 'innerDiameter' | 'outerDiameter' | 'length'
  valueMm?: string
  deltaMm?: string
  lockedKeys: ('innerDiameter' | 'outerDiameter' | 'length')[]
}
export interface AgentPreviewRequest {
  toolMode: 'agent'
  draftId: string
  baseRevisionId: string
}

/* ---- V4.0 阶段 3：一次性授权、重算提交、来源定位与任务侧栏 ---------- */

/**
 * 主进程签发的一次性授权。只存应用工作区，不写项目文件、不下发模型。
 * `baseRevisionId` 是阶段 3 为 STALE_BASE 判定增加的审计字段。
 */
export interface ApprovalRecord {
  approvalId: string
  windowId: number
  projectId: string
  draftId: string
  draftRevision: number
  requirementRevisionId: string | null
  previewFingerprint: string
  baseRevisionId: string
  /** 用户是否勾选了“这些尺寸由我提供，无原文件可核对”（无任务书项目必需）。 */
  userAttestationAcknowledged?: boolean
  createdAt: string
  expiresAt: string
  consumedAt: string | null
}

/** 侧栏演示场景；全部由阶段 2 的 FakeModelAdapter 驱动，不联网。 */
export type AgentDemoScenario = 'normal' | 'ask' | 'failure' | 'intent'

/** 侧栏模式：demo 由阶段 2 假模型驱动；real 走已配置的真实供应商。 */
export type AgentRunMode = 'demo' | 'real'

/** 无任务书入口：建项请求（责任人由用户手输，不由模型提供）。 */
export interface IntentCreateRequest {
  name: string
  actorId: string
  sessionLabel?: string | null
}

export interface IntentCreateValue {
  projectId: string
  draftId: string
  actorId: string
  sessionSeq: number
  sessionLabel: string | null
}

export interface IntentDraftCandidateView {
  candidateId: string
  kind: 'ring' | 'interval' | 'formula' | 'part-dimension'
  status: string
  editRevision: number
  summary: Record<string, string | null>
  /** 这条值出自哪句用户原话（逐字）与第几次输入。 */
  statement: string | null
  sessionSeq: number | null
  sessionLabel: string | null
}

export interface IntentDraftView {
  projectId: string
  draftId: string
  draftRevision: number
  sourceKind: 'pdf' | 'user-intent'
  actorId: string | null
  sessionSeq: number
  sessionLabel: string | null
  candidates: IntentDraftCandidateView[]
  pendingCount: number
  confirmedCount: number
  hasInterval: boolean
  bindings: { parameter: string; symbol: string; text: string }[]
  chainReady: boolean
  hasFormula: boolean
}

export interface AgentStartRequest {
  goal: string
  /** 兼容阶段 3：demo 模式的具体场景。 */
  demo: AgentDemoScenario
  /** 缺省为 demo（保持阶段 3 行为）。 */
  mode?: AgentRunMode
  /** real 模式建项：界面已确认提取候选后拿到的计划凭据。 */
  planToken?: string
  /** real 模式建项：来源提取草稿 ID。 */
  extractionDraftId?: string
  /**
   * 无任务书入口：责任人自述由用户界面手输，main 绑定到本轮任务。
   * 模型拿不到也改不了它；工具调用只能使用这里注入的身份。
   */
  intent?: { actorId: string; sessionLabel?: string | null }
}

export interface AgentStartValue {
  taskId: string
  demo: AgentDemoScenario
  modelId: string
}

/** 待答问题只从工具回执派生，不取模型的自然语言。 */
export interface AgentQuestionView {
  code: string
  tool: string
  message: string
}

export interface AgentTaskView {
  task: import('../../src/agent/types').AgentTaskRecord
  steps: import('../../src/agent/types').AgentStepRecord[]
  questions: AgentQuestionView[]
  /** 模型自然语言回复（多轮用换行连接）；只读展示，不参与任何结论位。 */
  assistantText?: string
}

export interface AgentProviderStatusValue {
  /** 真实模型（阶段 4）。configured 只表示配置与密钥齐备，不代表连接可用。 */
  real: {
    configured: boolean
    provider: string | null
    adapterId?: string | null
    model?: string | null
    host?: string | null
    keyPresent?: boolean
    keySource?: 'keychain' | 'keychain-or-env'
    keyEnvVar?: string
    /** 非敏感配置回显，用于设置表单预填；不含密钥。 */
    baseUrl?: string | null
  }
  /** 显式标注的离线演示：阶段 2 的 fake-1。 */
  demo: { available: true; modelId: 'fake-1'; label: string }
}

/** 保存配置：只把 apiKey 写进钥匙串，不落盘、不回显。 */
export interface AgentProviderSaveRequest {
  baseUrl: string
  model: string
  apiKey?: string
  keySource?: 'keychain' | 'keychain-or-env'
  keyEnvVar?: string
}

export interface AgentProviderTestValue {
  ok: boolean
  code: string | null
  model: string | null
  latencyMs: number
  message: string
}

/** §6 exportApprovedVersion：经系统对话框导出已保存版本，返回真实文件事实。 */
export interface AgentExportRequest {
  format: 'pdf' | 'svg'
}

export interface AgentExportValue {
  /** 用户取消系统对话框时为 CANCELLED，不产生文件、不返回假路径。 */
  status: 'EXPORTED' | 'CANCELLED'
  fileName: string | null
  byteSize: number | null
  sha256: string | null
  revisionId: string | null
}

export interface AgentPreviewSummary {
  previewId: string
  previewFingerprint: string
  draftId: string
  draftRevision: number
  baseRevisionId: string
  requirementRevisionId: string | null
  parameters: { key: string; valueQ: number; inputDecimals: number }[]
  result: { minQ: number; maxQ: number; minMm?: string; maxMm?: string; status: string }
  requirement: {
    status: string
    reasonCodes: string[]
    resultInterval: { minQ: number; maxQ: number } | null
    margins: { lowerQ: number; upperQ: number; lowerMm?: string; upperMm?: string } | null
  } | null
  /** Agent 草稿里的条款提案未确认；它不参与本次提交门禁。 */
  requirementProposalPending: boolean
  expiresAt: string
}

export interface AgentIssueApprovalRequest {
  previewId: string
  /** 无任务书项目：提交前必须勾选“这些尺寸由我提供，无原文件可核对”。 */
  userAttestationAcknowledged?: boolean
}

export interface AgentIssueApprovalValue {
  approvalId: string
  expiresAt: string
}

export interface CommitApprovedDraftRequest {
  approvalId: string
  draftId: string
  previewFingerprint: string
}

export interface CommitApprovedDraftValue {
  revisionId: string
  acceptedSeq: number
  path: string
  fingerprint: string
  analysisSnapshotId: string
  requirementStatus: string | null
  warnings: string[]
}

export interface LocateEvidenceRequest {
  /** 三者恰一；全部缺失或传入多个 → INVALID_INPUT。 */
  requirementRevisionId?: string
  checkId?: string
  parameterId?: string
}

export type LocateEvidenceValue =
  | {
      kind: 'requirement-source'
      requirementRevisionId: string
      checkId: string | null
      revisionId: string
      page: number
      rectPdf: import('../../src/sources/pdfCoordinates').PdfRect
      pageBoxPdf: import('../../src/sources/pdfCoordinates').PdfPageBox
      label: string
      sourceFileName: string | null
    }
  | {
      kind: 'parameter'
      parameterId: string
      key: string
      valueQ: number
      termIds: string[]
      annotationIds: string[]
      drawingId: string | null
    }

export interface CunlianApi {
  getProjectContext(): Promise<ToolResult<AgentContextValue>>
  getConfirmedInputs(request: { draftId: string }): Promise<ToolResult<ConfirmedInputsView>>
  applyConfirmedInputs(request: ApplyConfirmedInputsRequest): Promise<ToolResult<AgentDraftValue>>
  stageParameterChange(request: AgentParameterChangeRequest): Promise<ToolResult<AgentDraftValue>>
  previewAndCheck(request: AgentPreviewRequest): Promise<ToolResult<AgentDraftValue>>
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

  /* ---- C：隔套图纸（新增，旧函数不变） ------------------------------- */
  /** 解析三参数、重建图纸并原子更新；失败不改变任何一项。 */
  updateSpacerDrawing(
    request: DrawingUpdateRequest,
  ): Promise<IpcResult<DrawingUpdateValue>>
  /** 用 main 权威 DrawingData 走 printToPDF；renderer 不传路径/选项/位图。 */
  exportDrawingPdf(
    request: DrawingExportRequest,
  ): Promise<IpcResult<DrawingExportValue>>
  /** 用同一权威 DrawingData 序列化 SVG；同一冻结指纹。 */
  exportDrawingSvg(
    request: DrawingExportRequest,
  ): Promise<IpcResult<DrawingExportValue>>
  /** 同一权威 DrawingData → DXF R12（AC1009，切割/检具/老设备默认）。 */
  exportDrawingDxfR12(
    request: DrawingExportRequest,
  ): Promise<IpcResult<DrawingExportValue>>
  /** 同一权威 DrawingData → DXF 2000（AC1015）。 */
  exportDrawingDxf2000(
    request: DrawingExportRequest,
  ): Promise<IpcResult<DrawingExportValue>>

  /* ---- 内置 DXF 看图（新增，旧函数不变） ------------------------------ */
  /** 系统对话框选一个 .dxf，main 读字节返回；renderer 不传路径。 */
  openDxf(): Promise<IpcResult<DxfOpenValue>>
  /** 取启动参数 `--open-dxf=<path>` 排队的文件；没有则返回 null（只读，消费一次）。 */
  takePendingDxf(): Promise<IpcResult<DxfOpenValue | null>>

  /* ---- D：参数联动（新增，旧函数不变） ------------------------------- */
  /** 建立/更新参数草稿；不写正式链/参数/图纸。 */
  stageChangeDraft(request: ChangeStageRequest): Promise<IpcResult<ChangeDraftValue>>
  /** 预览：返回精确 token、参数/标注/环 diff、旧新计算、复核清单与双图数据。 */
  previewChange(request: ChangePreviewRequest): Promise<IpcResult<ChangePreviewValue>>
  /** 确认：校验基准/草稿/预览 token，对当前草稿重算并一次原子写入全聚合。 */
  applyChange(request: ChangeApplyRequest): Promise<IpcResult<ChangeApplyValue>>
  /** 绑定参数到环（草稿意图）；同环第二参数必须显式替换。 */
  bindParameter(request: ChangeBindRequest): Promise<IpcResult<ChangeDraftValue>>
  /** 解除绑定：保留环现值/来源/历史，不反向改参数。 */
  unbindParameter(request: ChangeUnbindRequest): Promise<IpcResult<ChangeDraftValue>>
  /** 稳定 ID 字段级双图比较；缺旧图/坏指纹给可解释状态。 */
  compareDrawings(request: ChangeCompareRequest): Promise<IpcResult<ChangeCompareValueResponse>>
  /** 从旧版建立新草稿：继承绑定记录、不继承当前确认，正式指针不变。 */
  restoreRevisionDraft(request: ChangeRestoreRequest): Promise<IpcResult<ChangeRestoreValue>>

  /* ---- V3.5：桌面 PDF 与任务书条款（新增，旧函数不变） ----------------- */
  /** 系统对话框选 PDF；main 读字节、算 SHA-256、解析页数/页框并原子接纳。 */
  importSource(request: SourceImportRequest): Promise<IpcResult<SourceImportValue>>
  /** 登记/更新未确认条款表单；任何变化递增代数并使旧预览失效。 */
  stageRequirementEdit(
    request: RequirementEditRequest,
  ): Promise<IpcResult<RequirementEditValue>>
  /** 显式确认：新建不可变条款版本并原子写入配置版本与基线检查。 */
  confirmRequirement(
    request: RequirementConfirmRequest,
  ): Promise<IpcResult<RequirementConfirmValue>>

  /* ---- V3.6：任务书 PDF 提取（新增，旧函数不变） ---------------------- */
  /** 从确切 PDF 版本提取页范围候选；失败零写入，不留半截草稿。 */
  runExtraction(request: ExtractionRunRequest): Promise<IpcResult<ExtractionRunValue>>
  /** 逐条确认/拒绝/编辑候选；未确认候选不进入项目计算或条款。 */
  decideExtraction(request: ExtractionDecideRequest): Promise<IpcResult<ExtractionDecideValue>>
  /** 取消同一会话中正在进行的提取（按 requestId）。 */
  cancelExtraction(request: ExtractionCancelRequest): Promise<IpcResult<ExtractionCancelValue>>
  /** 删除一份被取代的旧规则版本草稿；最新草稿拒绝，失败零写入。 */
  deleteExtractionDraft(
    request: ExtractionDeleteDraftRequest,
  ): Promise<IpcResult<ExtractionDeleteDraftValue>>

  /* ---- V4.0 阶段 3：任务侧栏与授权提交（可选，旧 preload 不提供时 UI 显示未装配） */
  agentStart?(request: AgentStartRequest): Promise<ToolResult<AgentStartValue>>
  agentCancel?(request: { taskId: string }): Promise<ToolResult<{ cancelled: boolean }>>
  agentResume?(request: { taskId: string }): Promise<ToolResult<{ resumed: boolean }>>
  agentTaskState?(request: { taskId: string }): Promise<ToolResult<AgentTaskView>>
  agentProviderStatus?(): Promise<ToolResult<AgentProviderStatusValue>>
  agentPreviewSummary?(): Promise<ToolResult<AgentPreviewSummary | null>>
  issueAgentApproval?(
    request: AgentIssueApprovalRequest,
  ): Promise<ToolResult<AgentIssueApprovalValue>>
  commitApprovedDraft?(
    request: CommitApprovedDraftRequest,
  ): Promise<ToolResult<CommitApprovedDraftValue>>
  locateEvidence?(request: LocateEvidenceRequest): Promise<ToolResult<LocateEvidenceValue>>
  /** ADR-001 第 3 步：无任务书入口（用户界面触发，模型只写草稿）。 */
  intentCreateProject?(request: IntentCreateRequest): Promise<ToolResult<IntentCreateValue>>
  intentState?(): Promise<ToolResult<IntentDraftView | null>>
  intentApply?(): Promise<ToolResult<AgentDraftValue>>
  intentPreview?(): Promise<ToolResult<AgentDraftValue>>
  intentConfirmCandidate?(request: {
    candidateId: string
    editRevision: number
  }): Promise<ToolResult<IntentDraftView>>
  intentIssueApproval?(
    request: AgentIssueApprovalRequest,
  ): Promise<ToolResult<AgentIssueApprovalValue>>
  /* ---- V4.0 阶段 4：真实供应商配置与导出（可选） ---- */
  saveAgentProvider?(request: AgentProviderSaveRequest): Promise<ToolResult<AgentProviderStatusValue>>
  testAgentProvider?(): Promise<ToolResult<AgentProviderTestValue>>
  clearAgentProviderKey?(): Promise<ToolResult<AgentProviderStatusValue>>
  exportApprovedVersion?(request: AgentExportRequest): Promise<ToolResult<AgentExportValue>>
  /** 订阅任务/步骤快照；返回取消订阅函数。 */
  onAgentEvent?(listener: (payload: AgentTaskView) => void): () => void
}

/** 应用与 IPC 协议的稳定标识，测试与契约文档共用。 */
export const DESKTOP_APP_NAME = '寸链'
export const DESKTOP_APP_BUNDLE_ID = 'com.kkhlbb.cunlian'
