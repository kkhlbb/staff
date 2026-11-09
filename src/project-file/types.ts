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
import type { SourceBinding } from '../sources/bindings'
import type { SourceDocument, SourceRevision } from '../sources/types'
import type { WorkspaceDraft } from '../workspace/draft'
import {
  MAX_BACKUP_ENTRIES,
  MAX_BACKUP_UNCOMPRESSED_BYTES,
} from '../backup/zip'

export const PROJECT_FILE_FORMAT = 'cunlian-project'
export const PROJECT_FILE_FORMAT_VERSION = 1
export const PROJECT_FILE_SCHEMA_VERSION = 3
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
  projectSchemaVersion: typeof PROJECT_FILE_SCHEMA_VERSION
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
  formatVersion: typeof PROJECT_FILE_FORMAT_VERSION
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

/**
 * `project/project.json`：单个活动项目。
 *
 * A-03 起，项目记录中需要跨文件保留的字段（引擎版本、创建/更新时间、关系
 * 修订号与确认凭据、V1 迁移记录、基线）随 project.json 一起保存；迁移必须
 * 原样携带这些字段，V3 新建项目使用同一形状（relationReview=null 等）。
 *
 * A 阶段 parts/parameters/modelRevisions/dimensionLinks/drawings 必须为空数组；
 * 格式先占位，不为未来 3D/图纸伪造内容。
 */
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
  parts: unknown[]
  parameters: unknown[]
  modelRevisions: unknown[]
  dimensionLinks: unknown[]
  drawings: unknown[]
}

/** `revisions/<encoded-id>.json`：A 阶段的项目文件版本基准。 */
export interface ProjectFileRevision {
  revisionId: string
  parentId: string | null
  createdAt: string
  reason: string
  project: ProjectFileProject
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
