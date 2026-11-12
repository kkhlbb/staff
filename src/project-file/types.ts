/**
 * `.cunlian` 项目文件容器类型（V3 批次 A-02）。
 *
 * 与 V2 `.cunlian.zip` 完整备份是独立命名空间：
 * - format = `cunlian-project`，formatVersion = 1；
 * - V3 外层 projectSchemaVersion = 3，内嵌 dimensionChain.schemaVersion 仍为 2；
 * - 既有 PROJECT_SCHEMA_VERSION=2、PROJECT_DB_VERSION=7 保持不变。
 *
 * 本模块只描述纯数据形状与常量，不导入 Electron、React 或 IndexedDB；
 * 对 V2 领域类型的引用只用 `import type`（编译后擦除）。
 */
import type { ChainDefinition, Project, RelationReview, ProjectMigration } from '../domain/types'
import type { ChangeEvent } from '../history/events'
import type { AnalysisSnapshot } from '../history/snapshots'
import type { RequirementCheck, RequirementRevision } from '../requirements/types'
import type { ExtractionDraft, UserAttestation } from '../document-extraction/types'
import type { SourceBinding } from '../sources/bindings'
import type { SourceDocument, SourceRevision } from '../sources/types'
import type { WorkspaceDraft } from '../workspace/draft'
import {
  MAX_BACKUP_ENTRIES,
  MAX_BACKUP_UNCOMPRESSED_BYTES,
} from '../backup/zip'

export const PROJECT_FILE_FORMAT = 'cunlian-project'
/** B2 起写出的格式版本：formatVersion=2，project.schemaVersion=4/5。 */
export const PROJECT_FILE_FORMAT_VERSION = 2
/**
 * 当前写端项目 schema（ADR-001 第 3 步起为 10）：
 * - 10：无任务书入口的加法字段：`sourceKind`（pdf | user-intent）、`actorId`/
 *   `sessionSeq`/`sessionLabel` 与项目级 `attestations` 集合；提取草稿新增可选
 *   `intentBindings`。schema 9 读入时 `sourceKind='pdf'`，**不重算、不改值**；
 * - 9：出处泛化为 `EvidenceRef` 联合类型（pdf-text / pdf-ocr / image-ocr / user-attestation），
 *   提取草稿的数值/候选/决定新增纯加法字段 `provenance`；尺寸链、参数、条款、判据一律未动；
 * - 8：任务书 PDF 提取草稿（候选/出处/逐条决定）随项目持久化；
 * - 7：Beta 任务书条款（RequirementRevision/RequirementCheck 与活动指针）；
 * - 6：参数绑定（parameter-binding）、单调 parameterRevision、Revision 证据引用；
 * - 5：三参数（q/有效位/来源备注）与图纸快照引用可持久化（仍可读）；
 * - 4：B2 模型版本与可视关联，parameters/drawings 必须为空（仍可读）；
 * - 3：B1 及更早（仍可读）。
 * `formatVersion` 保持 2：容器布局未变，只扩展 project.json 的 schema 与版本配对。
 */
export const PROJECT_FILE_SCHEMA_VERSION = 10
/** ADR-001 第 2 步的 schema9；仍可读，保存时显式升级为 10（读入时补 sourceKind='pdf'）。 */
export const V9_PROJECT_FILE_SCHEMA_VERSION = 9
/** V3.6 的 schema8；仍可读，保存时显式升级为 10（读入时按原 evidence 补 provenance，不重算）。 */
export const V36_PROJECT_FILE_SCHEMA_VERSION = 8
/** V3.5 的 schema7；仍可读，保存时显式升级为 10。 */
export const V35_PROJECT_FILE_SCHEMA_VERSION = 7
/** D 的 schema6；仍可读，保存时显式升级为 10。 */
export const D_PROJECT_FILE_SCHEMA_VERSION = 6
export const C_PROJECT_FILE_SCHEMA_VERSION = 5
export const B2_PROJECT_FILE_SCHEMA_VERSION = 4
/** 仍然可读的 B1 及更早格式（读时兼容，首次保存显式升级）。 */
export const LEGACY_PROJECT_FILE_FORMAT_VERSION = 1
export const LEGACY_PROJECT_FILE_SCHEMA_VERSION = 3
export const DIMENSION_CHAIN_SCHEMA_VERSION = 2
export const PROJECT_FILE_EXTENSION = '.cunlian'

/** 沿用 V2 容器安全上限：500 条目、解压后 150 MiB（含 manifest）。 */
export const PROJECT_FILE_MAX_ENTRIES = MAX_BACKUP_ENTRIES
export const PROJECT_FILE_MAX_UNCOMPRESSED_BYTES = MAX_BACKUP_UNCOMPRESSED_BYTES
/** 磁盘输入压缩后大小上限；读入前 stat，读入后再次计数。 */
export const PROJECT_FILE_MAX_SOURCE_BYTES = 150 * 1024 * 1024
/** 单个条目路径长度上限，沿用 V2 zip 规则。 */
export const PROJECT_FILE_MAX_PATH_LENGTH = 240

/** 容器错误码；与桌面 IPC 契约中的容器码字符串一致。 */
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
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_JSON'
  | 'CALCULATION_FAILED'
  | 'EMPTY_BACKUP'
  | 'PROJECT_ASSETS_TOO_LARGE'

export interface ProjectFileError {
  code: ContainerErrorCode
  message: string
  detail?: string
}

export type ProjectFileResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProjectFileError }

/** 条目角色；与任务卡 §4.1 的 role 枚举一致。 */
export type ProjectFileEntryRole =
  | 'project'
  | 'workspace'
  | 'source-meta'
  | 'attachment'
  | 'history'
  | 'revision'
  | 'legacy-archive'

export interface ProjectFileEntry {
  path: string
  role: ProjectFileEntryRole
  byteSize: number
  /** 小写 64 位十六进制 SHA-256。 */
  sha256: string
}

export interface ProjectFileWriter {
  appVersion: string
  electronVersion: string
  engineVersion: string
}

export interface ProjectFileManifestProject {
  id: string
  name: string
  /** 旧文件为 3，B2 为 4，C 为 5，D 写 6，V3.5 写 7，V3.6 写 8，ADR-001 写 9，本步写 10；读取时按伴随的 formatVersion 校验配对。 */
  projectSchemaVersion: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  dimensionChainSchemaVersion: typeof DIMENSION_CHAIN_SCHEMA_VERSION
  currentRevisionId: string
}

export interface ProjectFileCounts {
  documents: number
  revisions: number
  blobs: number
  bindings: number
  events: number
  analysisSnapshots: number
  importSnapshots: number
  migrationBackups: number
  projectRevisions: number
  models: number
  drawings: number
  legacyArchiveRecords: number
}

export type ProjectFileAttachmentKind = 'pdf' | 'model'

export interface ProjectFileAttachmentRef {
  kind: ProjectFileAttachmentKind
  /** PDF 为 SourceRevision.id，模型为 ModelRevision.modelRevisionId。 */
  revisionId: string
  blobKey: string
  path: string
  sha256: string
  byteSize: number
}

export type MissingAttachmentReason = 'legacy-json' | 'declared-missing'

export interface ProjectFileMissingAttachment {
  revisionId: string
  documentId: string
  blobKey: string
  reason: MissingAttachmentReason
}

export interface ProjectFileSnapshotReference {
  snapshotId: string
  revisionIds: string[]
  blobKeys: string[]
}

export interface ProjectFileMigrationInfo {
  sourceKind: 'v2-bundle' | 'v2-json'
  sourceSha256: string
  sourceFormatVersion: number
  sourceProjectId: string
  importedAt: string
  confirmationPolicy: 'v2-external-import'
  warnings: string[]
}

export interface ProjectFileExcludes {
  mappingTemplates: {
    included: false
    note: string
  }
}

export interface ProjectFileManifest {
  format: typeof PROJECT_FILE_FORMAT
  /** 1 = B1 及更早（可读）；2 = B2 当前写端。 */
  formatVersion: 1 | 2
  createdAt: string
  writer: ProjectFileWriter
  project: ProjectFileManifestProject
  /** 不列 manifest.json 自身；按 path 升序。 */
  entries: ProjectFileEntry[]
  /** entries.byteSize 之和。 */
  payloadBytes: number
  counts: ProjectFileCounts
  attachments: ProjectFileAttachmentRef[]
  missingAttachments: ProjectFileMissingAttachment[]
  snapshotReferences: ProjectFileSnapshotReference[]
  migration: ProjectFileMigrationInfo | null
  excludes: ProjectFileExcludes
}

/* ------------------------------------------------------------------ */
/* B2：模型、版本与可视关联                                             */
/* ------------------------------------------------------------------ */

export type ProjectFilePartKind = 'imported-mesh' | 'builtin-demo'
export type ProjectFilePartOrigin = 'stl-import' | 'builtin'

/** project.json `parts[]`：稳定 partId，项目内唯一。 */
export interface ProjectFilePart {
  partId: string
  kind: ProjectFilePartKind
  name: string
  /** 当前显示的模型版本；内置示意部件可以为 null。 */
  currentModelRevisionId: string | null
  origin: ProjectFilePartOrigin
}

export interface ProjectFileBounds {
  min: [number, number, number]
  max: [number, number, number]
}

/** project.json `modelRevisions[]`：不可变版本记录，字节在附件里。 */
export interface ProjectFileModelRevision {
  modelRevisionId: string
  partId: string
  kind: 'stl'
  /** 首版为 null；替换时指向同 part 的旧版本。 */
  parentModelRevisionId: string | null
  createdAt: string
  reason: string
  /** 仅用于显示；不参与路径构造。 */
  fileName: string
  blobKey: string
  attachmentSha256: string
  byteSize: number
  encoding: 'binary' | 'ascii'
  triangleCount: number
  bounds: ProjectFileBounds
  /** 用户备注，例如“单位：mm（推测）”；不缩放顶点、不改 q。 */
  unitNote: string
}

/**
 * B2 只实例化 `visual-reference`：组成环 ↔ 外形资料来源。
 * 它不是参数关联：没有 parameterId，不同步 nominal/偏差/方向，也不改变计算结果。
 */
export interface ProjectFileVisualReferenceTarget {
  granularity: 'model' | 'part'
  partId: string
  /** 模型粒度必须具体版本；part 粒度也记录确认时的版本（内置部件可为 null）。 */
  modelRevisionId: string | null
}

export interface ProjectFileVisualReferenceLink {
  kind: 'visual-reference'
  linkId: string
  termId: string
  target: ProjectFileVisualReferenceTarget
  reviewStatus: 'pending' | 'confirmed'
  reviewedModelRevisionId: string | null
  reviewedAt: string | null
  /** 例如 model-replaced：换版后待核对；不是审查结论。 */
  reason: string
}

/**
 * D：参数绑定（组成环 ↔ 隔套参数），只同步 nominal。
 *
 * - 它不是 B2 的 visual-reference：B2 只表示外形资料来源，没有 parameterId；
 * - 也不是“已确认”布尔：是否已核对由完整确认事件凭据派生；
 * - `syncField` 固定 'nominal'，不允许同步偏差/方向/目标。
 */
export interface ProjectFileParameterBindingLink {
  kind: 'parameter-binding'
  bindingId: string
  termId: string
  partId: string
  parameterId: string
  syncField: 'nominal'
  createdAt: string
}

export type ProjectFileDimensionLink =
  | ProjectFileVisualReferenceLink
  | ProjectFileParameterBindingLink

export function isParameterBindingLink(
  link: ProjectFileDimensionLink,
): link is ProjectFileParameterBindingLink {
  return link.kind === 'parameter-binding'
}

export function isVisualReferenceLink(
  link: ProjectFileDimensionLink,
): link is ProjectFileVisualReferenceLink {
  return link.kind === 'visual-reference'
}

/* ------------------------------------------------------------------ */
/* C：隔套三参数与图纸快照引用                                         */
/* ------------------------------------------------------------------ */

/**
 * `project.parameters[]`：隔套三参数。数值真值 valueQ 与显示元数据
 * inputDecimals 分开；sourceNote 只存用户备注，不推导。
 *
 * 这只描述参数记录，不改变 V2 尺寸链；C 参数也不自动同步链 S。
 */
export interface ProjectFileSpacerParameter {
  parameterId: string
  partId: string
  key: 'innerDiameter' | 'outerDiameter' | 'length'
  valueQ: number
  inputDecimals: number
  /**
   * D：单调递增的参数修订号（从 1 起）。只有真实工程值 valueQ 变化才递增；
   * 改 inputDecimals/sourceNote 不递增但仍使图纸/预览失效。同值往返不回退。
   */
  parameterRevision: number
  reviewStatus: 'draft' | 'pending' | 'confirmed'
  sourceNote?: string
}

/**
 * `project.drawings[]`：图纸快照**引用**，不是整份图元数组。
 *
 * 图元由参数 + 模板确定性重建；dataFingerprint 用于重建后校验一致。
 * 不嵌入截图、base64 PDF 或整份 DrawingData。
 */
export interface ProjectFileDrawingRecord {
  drawingId: string
  drawingDataVersion: 1
  templateId: 'spacer-a4-landscape'
  templateVersion: number
  partId: string
  /** 生成基准（不因草稿编辑被提升为已复核）。 */
  revisionId: string
  parameterIds: string[]
  paper: {
    format: 'A4'
    orientation: 'landscape'
    widthMm: 297
    heightMm: 210
  }
  scale: { numerator: number; denominator: number }
  frameFields: {
    partName: string
    drawingNumber: string
    version: string
    material: string
    tolerance: string
    surface: string
    drafter: string
    date: string
    /**
     * 依据栏（schema 10）。无外部来源项目固定写
     * 「依据：用户输入，无外部原文件」，使标题栏与导出物自带标记；
     * 有来源项目为空字符串，标题栏不新增任何行（图纸字节与改前一致）。
     */
    basis?: string
  }
  status: 'pending-review-draft'
  /** 由参数 + 模板重建出的 DrawingData 内容哈希。 */
  dataFingerprint: string
}

/**
 * `project/project.json`：单个活动项目。
 *
 * A-03 起，项目记录中需要跨文件保留的字段（引擎版本、创建/更新时间、关系
 * 修订号与确认凭据、V1 迁移记录、基线）随 project.json 一起保存；迁移必须
 * 原样携带这些字段，V3 新建项目使用同一形状（relationReview=null 等）。
 *
 * B2：schemaVersion=4，parts/modelRevisions/dimensionLinks 使用严格类型；
 * parameters/drawings 仍必须为空数组。sourceFormatVersion 记录本记录最初
 * 从哪种文件格式读入（1=B1 及更早，2=B2），用于“首次保存显式升级”。
 *
 * C：schemaVersion=5，parameters/drawings 使用严格类型（三参数 + 图纸引用）。
 * D：schemaVersion=6，参数绑定与单调 parameterRevision。
 * V3.5：schemaVersion=7，Beta 任务书条款。
 * V3.6：schemaVersion=8，任务书 PDF 提取草稿（候选、出处、逐条决定）。
 * ADR-001：schemaVersion=9，出处泛化为 EvidenceRef（纯加法 provenance）。
 * ADR-001 第 3 步：schemaVersion=10，无任务书入口的出处与身份（见下）。
 */
export type ProjectSourceKind = 'pdf' | 'user-intent'

export interface ProjectFileProject {
  id: string
  schemaVersion: typeof PROJECT_FILE_SCHEMA_VERSION
  name: string
  currentRevisionId: string
  dimensionChain: ChainDefinition
  engineVersion: string
  createdAt: string
  updatedAt: string
  relationRevision: number
  relationReview: RelationReview | null
  migration: ProjectMigration | null
  baseline: Project['baseline']
  sourceFormatVersion: 1 | 2
  parts: ProjectFilePart[]
  parameters: ProjectFileSpacerParameter[]
  modelRevisions: ProjectFileModelRevision[]
  dimensionLinks: ProjectFileDimensionLink[]
  drawings: ProjectFileDrawingRecord[]
  /** 确认后的不可变条款版本（可累积多个版本；只有一个活动 requirementId）。 */
  requirementRevisions: RequirementRevision[]
  /** 当前活动条款版本；null 表示无 Beta 条款。 */
  activeRequirementRevisionId: string | null
  /** 最近一次基线/正式检查证据；不存“已通过”布尔。 */
  currentRequirementCheck: RequirementCheck | null
  /**
   * V3.6：任务书 PDF 的提取草稿（可多份，按幂等键区分 PDF 版本/页范围/规则版本）。
   *
   * 候选与逐条决定是项目数据的一部分：只由 main 的提取/确认事务写入，
   * renderer 的普通 stageDraft 不能伪造（见 projectService.stageFromDto）。
   * 未确认候选不会进入尺寸链、参数、条款或计算；本字段只是审计与恢复来源。
   */
  extractionDrafts: ExtractionDraft[]

  /* ------------------------------------------------------------------ */
  /* ADR-001 第 3 步（schema 10）：无任务书入口                            */
  /* ------------------------------------------------------------------ */

  /**
   * 项目依据的种类。schema 9 及更早读入时固定为 'pdf'（不重算、不改值）；
   * 只有 `createProject` 工具建立的无任务书项目才是 'user-intent'。
   */
  sourceKind: ProjectSourceKind
  /**
   * 责任人自述（用户首次建项时手输）。不是账号体系，不做唯一性校验；
   * 只用于显示与追溯。schema 9 及更早为 null。
   */
  actorId: string | null
  /** 项目内自增的输入会话序号（1..n）；0 表示旧项目没有记录。 */
  sessionSeq: number
  /** 用户备注名（可空）。 */
  sessionLabel: string | null
  /**
   * 用户断言账本：所有由人给出的数值/条款都在这里留一条（原话逐字）。
   * 出处不可抹：只追加，不删除；撤销走 `revokeAttestation` 的追加字段。
   * 提取草稿的 provenance 引用同一批断言（内容相同）；账本用于审计与
   * “跨会话伪造”校验，提交时随版本一起冻结。
   */
  attestations: UserAttestation[]
}

/**
 * ADR-001 第 2 步的 schema9 记录：与 schema10 同字段形状，但没有
 * `sourceKind`/`actorId`/`sessionSeq`/`sessionLabel`/`attestations`（读出时补）。
 * 只用于读时兼容与旧历史原样保留。
 */
export type ProjectFileProjectV9 = Omit<
  ProjectFileProject,
  | 'schemaVersion'
  | 'sourceKind'
  | 'actorId'
  | 'sessionSeq'
  | 'sessionLabel'
  | 'attestations'
> & {
  schemaVersion: typeof V9_PROJECT_FILE_SCHEMA_VERSION
}

/**
 * V3.6 的 schema8 记录：与 schema9 同字段形状，但没有 `provenance`（读出时补）。
 * 只用于读时兼容与旧历史原样保留。
 */
export type ProjectFileProjectV8 = Omit<ProjectFileProjectV9, 'schemaVersion'> & {
  schemaVersion: typeof V36_PROJECT_FILE_SCHEMA_VERSION
}

/**
 * V3.5 的 schema7 记录：没有提取草稿字段。
 * 只用于读时兼容与旧历史原样保留。
 */
export type ProjectFileProjectV7 = Omit<
  ProjectFileProjectV9,
  | 'schemaVersion'
  | 'extractionDrafts'
> & {
  schemaVersion: typeof V35_PROJECT_FILE_SCHEMA_VERSION
}

/**
 * V3.5 的 schema6 记录（D）：没有 Beta 条款字段。
 * 只用于读时兼容与旧历史原样保留。
 */
export type ProjectFileProjectV6 = Omit<
  ProjectFileProjectV9,
  | 'schemaVersion'
  | 'requirementRevisions'
  | 'activeRequirementRevisionId'
  | 'currentRequirementCheck'
  | 'extractionDrafts'
> & {
  schemaVersion: typeof D_PROJECT_FILE_SCHEMA_VERSION
}

/**
 * C 的 schema5 记录：参数没有 parameterRevision、关联只有 visual-reference。
 * 只用于读时兼容与旧历史原样保留。
 */
export type ProjectFileProjectV5 = Omit<
  ProjectFileProjectV9,
  | 'schemaVersion'
  | 'parameters'
  | 'dimensionLinks'
  | 'requirementRevisions'
  | 'activeRequirementRevisionId'
  | 'currentRequirementCheck'
  | 'extractionDrafts'
> & {
  schemaVersion: typeof C_PROJECT_FILE_SCHEMA_VERSION
  parameters: (Omit<ProjectFileSpacerParameter, 'parameterRevision'> & {
    parameterRevision?: number
  })[]
  dimensionLinks: ProjectFileVisualReferenceLink[]
}

/** B2 的 schema4 记录：模型/关联有严格类型，parameters/drawings 必须为空。 */
export type ProjectFileProjectV2 = Omit<
  ProjectFileProjectV9,
  | 'schemaVersion'
  | 'parameters'
  | 'drawings'
  | 'dimensionLinks'
  | 'requirementRevisions'
  | 'activeRequirementRevisionId'
  | 'currentRequirementCheck'
  | 'extractionDrafts'
> & {
  schemaVersion: typeof B2_PROJECT_FILE_SCHEMA_VERSION
  parameters: unknown[]
  drawings: unknown[]
  dimensionLinks: ProjectFileVisualReferenceLink[]
}

/** 旧 schema3 项目记录：数组为空，无 sourceFormatVersion。只用于读时兼容。 */
export type ProjectFileProjectV1 = Omit<
  ProjectFileProjectV9,
  | 'schemaVersion'
  | 'sourceFormatVersion'
  | 'parts'
  | 'parameters'
  | 'modelRevisions'
  | 'dimensionLinks'
  | 'drawings'
  | 'requirementRevisions'
  | 'activeRequirementRevisionId'
  | 'currentRequirementCheck'
  | 'extractionDrafts'
> & {
  schemaVersion: typeof LEGACY_PROJECT_FILE_SCHEMA_VERSION
  parts: unknown[]
  parameters: unknown[]
  modelRevisions: unknown[]
  dimensionLinks: unknown[]
  drawings: unknown[]
}

/**
 * D：版本证据引用。只引用、不复制第二套可写结果：
 * - analysisSnapshotId 指向同次提交冻结的 AnalysisSnapshot；
 * - eventIds 指向同次提交的变更事件；
 * - sourceManifest 是来源精确版本与哈希的只读摘要（可回查）；
 * - restoredFromRevisionId 仅在“恢复旧版生成新版本”时出现。
 *
 * 旧 schema3/4/5 版本没有该字段；缺字段表示“未记录”，不补造。
 */
export interface ProjectFileRevisionEvidence {
  analysisSnapshotId: string | null
  eventIds: string[]
  sourceManifest: {
    documents: { documentId: string; latestRevisionId: string }[]
    revisions: { revisionId: string; documentId: string; sha256: string }[]
    bindings: { bindingId: string; revisionId: string; reviewedTermRevision: number | null }[]
    missingBlobKeys: string[]
  }
  restoredFromRevisionId: string | null
  /** V3.5：本版本冻结的活动条款与同次检查；旧版本没有该字段。 */
  requirementRevisionId?: string | null
  checkId?: string | null
}

/** `revisions/<encoded-id>.json`：项目文件版本基准。 */
export interface ProjectFileRevision {
  revisionId: string
  parentId: string | null
  createdAt: string
  reason: string
  /**
   * 旧归档快照保留原 schema（3/4/5/6/7/8/9）原样（不可变历史）；新快照为当前 schema 10。
   * 读取按版本化联合解析，保存时不会把旧历史改写成新内容。
   */
  project:
    | ProjectFileProject
    | ProjectFileProjectV9
    | ProjectFileProjectV8
    | ProjectFileProjectV7
    | ProjectFileProjectV6
    | ProjectFileProjectV5
    | ProjectFileProjectV2
    | ProjectFileProjectV1
  /** D 新版本带证据引用；旧版本没有该字段。 */
  evidence?: ProjectFileRevisionEvidence
}

/** `sources/blobs.json` 的元数据；字节在 attachments/ 下。 */
export interface ProjectFileBlob {
  blobKey: string
  projectId: string
  sha256: string
  byteSize: number
}

/** 编码输入里的附件字节。 */
export interface ProjectFileAttachmentInput {
  blobKey: string
  bytes: Uint8Array
}

/**
 * `history/importSnapshots.json` 与 `history/migrationBackups.json` 的记录。
 *
 * 与 V2 storage/projects.ts 的 ImportSnapshot / MigrationBackupRecord 结构兼容；
 * 这里重新声明是为了让 src/project-file 不依赖 IndexedDB 模块。
 */
export interface ProjectFileImportSnapshot {
  id: string
  projectId: string
  createdAt: string
  kind: 'replace-before-import'
  definition: ChainDefinition
}

export interface ProjectFileMigrationBackup {
  id: string
  projectId: string
  createdAt: string
  fromSchemaVersion: number
  raw: unknown
}

/**
 * V2 归档中 `::retired::` 历史作用域内容。
 *
 * A-02 只定义容器位置与只读语义；归属规则与内容生成由 A-03 迁移实现。
 */
export interface ProjectFileLegacyArchive {
  sourceProjectId: string | null
  sourceManifest: unknown
  records: unknown[]
  warnings: string[]
}

/**
 * 非附件聚合（任务卡 §3 的 SnapshotDTO 基础）：renderer 只持有这份 JSON，
 * 附件字节只以 blobKey 引用，主进程负责解析和校验。
 */
export interface ProjectFileSnapshot {
  project: ProjectFileProject
  draft: WorkspaceDraft | null
  documents: SourceDocument[]
  revisions: SourceRevision[]
  bindings: SourceBinding[]
  blobs: ProjectFileBlob[]
  events: ChangeEvent[]
  analysisSnapshots: AnalysisSnapshot[]
  importSnapshots: ProjectFileImportSnapshot[]
  migrationBackups: ProjectFileMigrationBackup[]
  legacyArchive: ProjectFileLegacyArchive | null
  fileRevisions: ProjectFileRevision[]
  /** 只在编码时使用；解码结果里为空数组，字节由 main 的 blob 存储持有。 */
  attachments: ProjectFileAttachmentInput[]
  missingAttachments: ProjectFileMissingAttachment[]
  snapshotReferences: ProjectFileSnapshotReference[]
  manifestMeta: {
    createdAt: string
    writer: ProjectFileWriter
    migration: ProjectFileMigrationInfo | null
  }
}

/** 项目基线沿用 V2 形状；单独导出便于校验。 */
export type ProjectFileBaseline = Project['baseline']

export interface ProjectFileDecoded {
  snapshot: ProjectFileSnapshot
  manifest: ProjectFileManifest
  /** 实际条目路径（不含 manifest.json），用于报告与审计。 */
  entryPaths: string[]
}

/** 容器内固定路径。 */
export const PROJECT_FILE_PATHS = {
  manifest: 'manifest.json',
  project: 'project/project.json',
  draft: 'workspace/draft.json',
  documents: 'sources/documents.json',
  revisions: 'sources/revisions.json',
  bindings: 'sources/bindings.json',
  blobs: 'sources/blobs.json',
  events: 'history/events.json',
  analysisSnapshots: 'history/analysisSnapshots.json',
  importSnapshots: 'history/importSnapshots.json',
  migrationBackups: 'history/migrationBackups.json',
  legacyArchive: 'history/legacyArchive.json',
} as const

export const ATTACHMENT_PATH_PREFIX = 'attachments/'
export const REVISION_PATH_PREFIX = 'revisions/'
export const ATTACHMENT_EXTENSION = '.bin'
export const REVISION_EXTENSION = '.json'
