import { calculateChain, ENGINE_VERSION } from '../domain/calculate'
import {
  PROJECT_SCHEMA_VERSION,
  Q_PER_MM,
  type ChainDefinition,
  type ChainResult,
  type DimensionTerm,
  type Project,
  type RelationReview,
} from '../domain/types'
import { validateChain, type ValidationError } from '../domain/validation'
import { draftToChain, type CellErrors, type WorkspaceDraft } from '../workspace/draft'
import {
  BINDING_STORE_NAME,
  DRAFT_STORE_NAME,
  EVENT_STORE_NAME,
  IMPORT_SNAPSHOT_STORE_NAME,
  MIGRATION_BACKUP_STORE_NAME,
  PROJECT_STORE_NAME,
  SOURCE_BLOB_STORE_NAME,
  SOURCE_DOCUMENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
  databaseErrorCode,
  errorName,
  requestResult,
  transactionDone,
  withDatabase,
} from './db'
import { migrateDraftV1, migrateProjectV1 } from './migrateV1'
import type { SourceBinding } from '../sources/bindings'
import type { SourceDocument, SourceRevision } from '../sources/types'

/** 项目 JSON 结构版本；导入同时接受 v1（迁移）与 v2。 */
export const STORAGE_SCHEMA_VERSION = PROJECT_SCHEMA_VERSION
/** V1 项目 JSON 的版本，只用于导入分派与本地迁移。 */
export const LEGACY_SCHEMA_VERSION = 1
/** 项目 JSON 中的数值单位声明：整数 q，1 q = 0.0001 mm。 */
export const PROJECT_JSON_UNIT = 'q'
/** 单个项目 JSON 的字节上限（1 MB）。 */
export const MAX_IMPORT_BYTES = 1024 * 1024
/** 文档第 7 节：组成环最多 20 项。 */
export const MAX_CHAIN_TERMS = 20
/** fake-indexeddb 测试也用它清理数据库。 */
export { PROJECT_DB_NAME } from './db'

export interface StorageIssue {
  path: (string | number)[]
  code: string
  message: string
}

export interface StorageError {
  code: string
  message: string
  details: StorageIssue[]
}

export type StorageFailure = { ok: false; error: StorageError }
export type StorageResult<T> = { ok: true; value: T } | StorageFailure

/** 草稿记录与 Project.working 分表保存，避免无效输入污染最后一个有效模型。 */
export interface StoredDraft {
  projectId: string
  draft: WorkspaceDraft
  savedAt: string
}

export interface CreateProjectInput {
  name?: string
  engineVersion?: string
  working: ChainDefinition
  baseline?: Project['baseline']
  /** 仅测试/迁移使用；正常新建从 0 和 null 开始。 */
  relationRevision?: number
  relationReview?: RelationReview | null
}

export interface UpdateProjectInput {
  name?: string
  engineVersion?: string
  working?: ChainDefinition
  baseline?: Project['baseline']
  relationRevision?: number
  relationReview?: RelationReview | null
}

export interface SaveDraftResult {
  project: Project
  draft: StoredDraft
  /** 只有草稿通过 draftToChain 时才为 true；否则只写 drafts 表。 */
  modelUpdated: boolean
  cellErrors: CellErrors
  /** 替换导入时写入的“操作前快照”；其他保存路径为 null。 */
  importSnapshot: ImportSnapshot | null
}

/**
 * 替换导入前的方案快照。与项目基线、V2.2 的 AnalysisSnapshot 都不是同一概念：
 * 它只记录本次替换发生时 projects.working 的完整副本，供失败排查或后续恢复使用。
 */
export interface ImportSnapshot {
  id: string
  projectId: string
  createdAt: string
  kind: 'replace-before-import'
  definition: ChainDefinition
}

export interface SaveDraftOptions {
  /** 替换全部组成环时，在同一事务内备份写入前的 working。 */
  snapshotBefore?: 'replace'
  /**
   * 关系修订号与确认凭据。提供时即使草稿非法也会写入 projects，
   * 保证“改成非法再改回”不会因为没落库而保留旧确认。
   */
  relationState?: {
    relationRevision: number
    relationReview: RelationReview | null
  }
}

export interface ImportProjectResult {
  project: Project
  /** 用导入后的 ChainDefinition 重新计算的结果，文件中的结果字段从不读取。 */
  result: ChainResult
  /** 文件里的项目 ID 与本地已有项目冲突时为 true。 */
  idChanged: boolean
  /** 导入过程中必须向用户明示的事实（清除确认、缺附件、版本迁移等）。 */
  warnings: string[]
  /** 外部导入的文件版本；与当前 schema 相同则为 null。 */
  migratedFrom: number | null
  /** 随文件导入的来源元数据与绑定数量；无来源信息时为 null。 */
  sources: {
    documents: number
    revisions: number
    bindings: number
    attachmentsMissing: boolean
  } | null
}

/** 导出文件中的来源元数据与绑定；明确不含 Blob 字节。 */
export interface ExportedProjectSources {
  documents: SourceDocument[]
  revisions: SourceRevision[]
  bindings: SourceBinding[]
  /** 固定提示：JSON 数据备份不包含来源附件。 */
  attachmentsIncluded: false
  /** 面向人的明确说明，避免把元数据误当完整备份。 */
  notice: string
}

/** 导出 JSON 里的固定提示文本。 */
export const EXPORT_SOURCES_NOTICE =
  '数据备份不含来源附件：sources 只包含来源文档/版本元数据与绑定坐标，PDF 原文件未包含在 JSON 中。'

/** 导出文件中的字段：工程输入、关系确认凭据与来源元数据，不含派生结果与附件。 */
export interface ExportedProjectJson {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  unit: 'q'
  qPerMm: number
  engineVersion: string
  id: string
  name: string
  createdAt: string
  updatedAt: string
  relationRevision: number
  relationReview: RelationReview | null
  working: ChainDefinition
  baseline: Project['baseline']
  sources: ExportedProjectSources
}

export type ProjectJsonInput = string | ArrayBuffer | Uint8Array

function failure(
  code: string,
  message: string,
  details: StorageIssue[] = [],
): StorageFailure {
  return { ok: false, error: { code, message, details } }
}

function storageFailure(error: unknown, message: string): StorageFailure {
  const detail = error instanceof Error ? error.message : String(error)
  // 数据库版本过新 / 被其它标签页阻塞要保留专用错误码，页面才能显示“刷新”
  // 或“关闭其它标签页”的具体指引，而不是笼统的存储失败。
  const databaseCode = databaseErrorCode(error)
  if (databaseCode !== undefined) {
    return failure(databaseCode, detail)
  }
  return failure('storage_failure', `${message}：${detail}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mapDomainErrorCode(code: string): string {
  switch (code) {
    case 'q_not_number':
    case 'q_not_safe_integer':
      return 'invalid_integer'
    case 'q_out_of_range':
      return 'out_of_range'
    default:
      return code
  }
}

function toStorageIssues(
  errors: ValidationError[],
  prefix: (string | number)[],
): StorageIssue[] {
  return errors.map((error) => ({
    path: [...prefix, ...error.path],
    code: mapDomainErrorCode(error.code),
    message: error.message,
  }))
}

/**
 * 给 0 项尺寸链做非数量字段校验时使用的占位环。
 *
 * validateChain 要求 2–20 项，但空项目的工作方案必须能导出再导入。导入路径
 * 对 0 项只放宽“数量”这一条规则：借用两个合法占位环让领域校验继续检查
 * target、assumptions、relationConfirmed 等其余字段，最后丢弃占位环。
 */
const EMPTY_CHAIN_PLACEHOLDER_TERMS: DimensionTerm[] = [
  {
    id: '__empty_chain_check_a__',
    symbol: '__empty_chain_check_a__',
    name: '__empty_chain_check_a__',
    nominalQ: 1,
    lowerDeviationQ: 0,
    upperDeviationQ: 0,
    sign: 1,
    sourceNote: '',
    termRevision: 1,
  },
  {
    id: '__empty_chain_check_b__',
    symbol: '__empty_chain_check_b__',
    name: '__empty_chain_check_b__',
    nominalQ: 1,
    lowerDeviationQ: 0,
    upperDeviationQ: 0,
    sign: -1,
    sourceNote: '',
    termRevision: 1,
  },
]

interface ValidateChainFieldOptions {
  /** 仅 storage 导入工作方案的 0 项项目使用；1 项和 21 项仍走常规拒收。 */
  allowEmptyTerms?: boolean
}

/**
 * 调用唯一的领域校验入口，并把结构化错误加上路径前缀。
 * 额外检查一次组成环上限，保证 >20 项有独立的 too_many_terms 错误码。
 */
function validateChainField(
  input: unknown,
  prefix: (string | number)[],
  issues: StorageIssue[],
  options: ValidateChainFieldOptions = {},
): ChainDefinition | null {
  const isEmptyChain =
    options.allowEmptyTerms === true &&
    isRecord(input) &&
    Array.isArray(input.terms) &&
    input.terms.length === 0

  if (
    isRecord(input) &&
    Array.isArray(input.terms) &&
    input.terms.length > MAX_CHAIN_TERMS
  ) {
    issues.push({
      path: [...prefix, 'terms'],
      code: 'too_many_terms',
      message: `组成环最多 ${MAX_CHAIN_TERMS} 项，当前为 ${input.terms.length} 项`,
    })
  }

  // 0 项空项目：数量规则单独放宽，其余字段仍交给 validateChain 校验。
  const validation = validateChain(
    isEmptyChain
      ? { ...input, terms: EMPTY_CHAIN_PLACEHOLDER_TERMS }
      : input,
  )
  if (!validation.ok) {
    issues.push(...toStorageIssues(validation.errors, prefix))
    return null
  }
  if (isEmptyChain) {
    return { ...validation.value, terms: [] }
  }
  return validation.value
}

const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leap ? 29 : 28
  }
  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

/** 接受带时区的 ISO 8601 时间戳；拒绝 Date.parse 会静默进位的非法日期。 */
function isValidIsoDateTime(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  const match = ISO_DATE_TIME_PATTERN.exec(value)
  if (match === null) {
    return false
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])

  if (month < 1 || month > 12) {
    return false
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return false
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return false
  }
  return !Number.isNaN(Date.parse(value))
}

function readDateField(
  value: unknown,
  path: (string | number)[],
  issues: StorageIssue[],
): string | null {
  if (!isValidIsoDateTime(value)) {
    issues.push({
      path,
      code: 'invalid_date',
      message: '日期必须是合法的 ISO 8601 时间戳',
    })
    return null
  }
  return value
}

function readStringField(
  value: unknown,
  path: (string | number)[],
  code: string,
  label: string,
  issues: StorageIssue[],
): string | null {
  if (typeof value !== 'string') {
    issues.push({ path, code, message: `${label}必须是字符串` })
    return null
  }
  return value
}

export interface ParsedProjectSources {
  documents: SourceDocument[]
  revisions: SourceRevision[]
  bindings: SourceBinding[]
}

interface ParsedProjectJson {
  project: Project
  result: ChainResult
  /** 导入时必须向用户明示的事实。 */
  warnings: string[]
  /** 文件版本；V1 文件为 1，V2 文件为 null。 */
  migratedFrom: number | null
  /** 文件中的来源元数据；V1 文件或没有来源信息时为 null。 */
  sources: ParsedProjectSources | null
}

/**
 * 读取非负整数（关系修订号）。缺失时用 0；类型或范围非法则记录错误。
 */
function readNonNegativeInteger(
  value: unknown,
  path: (string | number)[],
  label: string,
  issues: StorageIssue[],
): number | null {
  if (value === undefined) {
    return 0
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    issues.push({ path, code: 'invalid_integer', message: `${label}必须是非负安全整数` })
    return null
  }
  return value
}

function readPositiveInteger(
  value: unknown,
  path: (string | number)[],
  label: string,
  issues: StorageIssue[],
): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    issues.push({ path, code: 'invalid_integer', message: `${label}必须是大于等于 1 的整数` })
    return null
  }
  return value
}

/**
 * V1 组成环没有 termRevision：迁移时统一补 1，不伪造历史版本。
 * 其余字段原样交给统一领域校验。
 */
function withLegacyTermRevisions(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.terms)) {
    return value
  }
  return {
    ...value,
    terms: value.terms.map((term) =>
      isRecord(term) ? { ...term, termRevision: 1 } : term,
    ),
  }
}

function parseSourceMetadata(
  raw: unknown,
  working: ChainDefinition,
  issues: StorageIssue[],
): ParsedProjectSources | null {
  if (raw === undefined) {
    return null
  }
  if (!isRecord(raw)) {
    issues.push({
      path: ['sources'],
      code: 'invalid_sources',
      message: 'sources 必须是包含 documents、revisions、bindings 的对象',
    })
    return null
  }

  const rawDocuments = raw.documents ?? []
  const rawRevisions = raw.revisions ?? []
  const rawBindings = raw.bindings ?? []
  if (!Array.isArray(rawDocuments) || !Array.isArray(rawRevisions) || !Array.isArray(rawBindings)) {
    issues.push({
      path: ['sources'],
      code: 'invalid_sources',
      message: 'documents、revisions、bindings 必须是数组',
    })
    return null
  }

  const termIds = new Set(working.terms.map((term) => term.id))
  const documents: SourceDocument[] = []
  const revisions: SourceRevision[] = []
  const bindings: SourceBinding[] = []

  for (let index = 0; index < rawDocuments.length; index += 1) {
    const item = rawDocuments[index]
    const path = ['sources', 'documents', index]
    if (!isRecord(item)) {
      issues.push({ path, code: 'invalid_source_document', message: '来源文档必须是对象' })
      continue
    }
    const id = readStringField(item.id, [...path, 'id'], 'invalid_source_document', '文档 id', issues)
    const title = readStringField(item.title, [...path, 'title'], 'invalid_source_document', '文档标题', issues)
    const latestRevisionId = readStringField(
      item.latestRevisionId,
      [...path, 'latestRevisionId'],
      'invalid_source_document',
      '最新版本 id',
      issues,
    )
    if (id !== null && title !== null && latestRevisionId !== null) {
      documents.push({ id, projectId: '', title, latestRevisionId })
    }
  }

  for (let index = 0; index < rawRevisions.length; index += 1) {
    const item = rawRevisions[index]
    const path = ['sources', 'revisions', index]
    if (!isRecord(item)) {
      issues.push({ path, code: 'invalid_source_revision', message: '来源版本必须是对象' })
      continue
    }
    const id = readStringField(item.id, [...path, 'id'], 'invalid_source_revision', '版本 id', issues)
    const documentId = readStringField(
      item.documentId,
      [...path, 'documentId'],
      'invalid_source_revision',
      '所属文档 id',
      issues,
    )
    const fileName = readStringField(
      item.fileName,
      [...path, 'fileName'],
      'invalid_source_revision',
      '文件名',
      issues,
    )
    const sha256 = readStringField(
      item.sha256,
      [...path, 'sha256'],
      'invalid_source_revision',
      'SHA-256',
      issues,
    )
    const blobKey = readStringField(
      item.blobKey,
      [...path, 'blobKey'],
      'invalid_source_revision',
      'blobKey',
      issues,
    )
    const createdAt = readDateField(item.createdAt, [...path, 'createdAt'], issues)
    const byteSize = readPositiveInteger(
      item.byteSize,
      [...path, 'byteSize'],
      '字节大小',
      issues,
    )
    const pageCount = readPositiveInteger(
      item.pageCount,
      [...path, 'pageCount'],
      '页数',
      issues,
    )
    if (
      id !== null &&
      documentId !== null &&
      fileName !== null &&
      sha256 !== null &&
      blobKey !== null &&
      createdAt !== null &&
      byteSize !== null &&
      pageCount !== null
    ) {
      revisions.push({
        id,
        projectId: '',
        documentId,
        fileName,
        sha256: sha256.toLowerCase(),
        byteSize,
        pageCount,
        createdAt,
        blobKey,
      })
    }
  }

  for (let index = 0; index < rawBindings.length; index += 1) {
    const item = rawBindings[index]
    const path = ['sources', 'bindings', index]
    if (!isRecord(item)) {
      issues.push({ path, code: 'invalid_binding', message: '来源绑定必须是对象' })
      continue
    }
    const id = readStringField(item.id, [...path, 'id'], 'invalid_binding', '绑定 id', issues)
    const termId = readStringField(item.termId, [...path, 'termId'], 'invalid_binding', '组成环 id', issues)
    const revisionId = readStringField(
      item.revisionId,
      [...path, 'revisionId'],
      'invalid_binding',
      '来源版本 id',
      issues,
    )
    const documentId = readStringField(
      item.documentId,
      [...path, 'documentId'],
      'invalid_binding',
      '来源文档 id',
      issues,
    )
    const page = readPositiveInteger(item.page, [...path, 'page'], '页码', issues)
    const createdAt = readDateField(item.createdAt, [...path, 'createdAt'], issues)
    const note = typeof item.note === 'string' ? item.note : ''
    const rectPdf = item.rectPdf
    const pageBoxPdf = item.pageBoxPdf
    const validGeometry =
      Array.isArray(rectPdf) &&
      rectPdf.length === 4 &&
      rectPdf.every((value) => typeof value === 'number' && Number.isFinite(value)) &&
      Array.isArray(pageBoxPdf) &&
      pageBoxPdf.length === 4 &&
      pageBoxPdf.every((value) => typeof value === 'number' && Number.isFinite(value))
    if (!validGeometry) {
      issues.push({
        path,
        code: 'invalid_binding_geometry',
        message: '绑定区域必须是 4 个有限数值（PDF 坐标）',
      })
    }
    if (termId !== null && !termIds.has(termId)) {
      issues.push({
        path: [...path, 'termId'],
        code: 'binding_term_missing',
        message: `绑定指向的组成环 ${termId} 不在导入的尺寸链中`,
      })
    }
    if (
      id !== null &&
      termId !== null &&
      revisionId !== null &&
      documentId !== null &&
      page !== null &&
      createdAt !== null &&
      validGeometry
    ) {
      // 核对凭据必须成对且合法；不完整的凭据不采用，避免把旧文件里的
      // 残余字段当成有效核对。
      const reviewedTermRevision =
        typeof item.reviewedTermRevision === 'number' &&
        Number.isSafeInteger(item.reviewedTermRevision) &&
        item.reviewedTermRevision >= 1
          ? item.reviewedTermRevision
          : null
      const reviewedAt =
        reviewedTermRevision !== null && isValidIsoDateTime(item.reviewedAt)
          ? item.reviewedAt
          : null
      bindings.push({
        id,
        projectId: '',
        termId,
        revisionId,
        documentId,
        page,
        rectPdf: rectPdf as unknown as SourceBinding['rectPdf'],
        pageBoxPdf: pageBoxPdf as unknown as SourceBinding['pageBoxPdf'],
        note,
        createdAt,
        reviewedTermRevision: reviewedAt === null ? null : reviewedTermRevision,
        reviewedAt,
      })
    }
  }

  const documentIds = new Set(documents.map((document) => document.id))
  const revisionIds = new Set(revisions.map((revision) => revision.id))
  for (const document of documents) {
    if (!revisionIds.has(document.latestRevisionId)) {
      issues.push({
        path: ['sources', 'documents'],
        code: 'source_reference_missing',
        message: `来源文档 ${document.id} 的最新版本 ${document.latestRevisionId} 不在文件中`,
      })
    }
  }
  for (const revision of revisions) {
    if (!documentIds.has(revision.documentId)) {
      issues.push({
        path: ['sources', 'revisions'],
        code: 'source_reference_missing',
        message: `来源版本 ${revision.id} 的文档 ${revision.documentId} 不在文件中`,
      })
    }
  }
  for (const binding of bindings) {
    if (!revisionIds.has(binding.revisionId)) {
      issues.push({
        path: ['sources', 'bindings'],
        code: 'source_reference_missing',
        message: `绑定 ${binding.id} 的来源版本 ${binding.revisionId} 不在文件中`,
      })
    }
  }

  return { documents, revisions, bindings }
}

/**
 * V1 文件：保留整数 q、项目/基线/草稿数据，迁移为 v2。
 *
 * - 所有环补 termRevision=1；
 * - 旧 relationConfirmed 没有任何版本凭据，一律清除；
 * - 来源状态为“未检查”（没有来源元数据）；
 * - ID 冲突由写入层换新 ID，绝不覆盖已有项目。
 */
function parseImportedProjectV1(input: Record<string, unknown>): StorageResult<ParsedProjectJson> {
  const issues: StorageIssue[] = []

  // 兼容文档第 6 节省略单位声明的对象；一旦声明就必须是整数 q。
  if (input.unit !== undefined && input.unit !== PROJECT_JSON_UNIT) {
    issues.push({
      path: ['unit'],
      code: 'invalid_unit',
      message: `单位声明必须是 "${PROJECT_JSON_UNIT}"（整数 0.0001 mm）`,
    })
  }
  if (input.qPerMm !== undefined && input.qPerMm !== Q_PER_MM) {
    issues.push({
      path: ['qPerMm'],
      code: 'invalid_unit',
      message: `qPerMm 必须是 ${Q_PER_MM}`,
    })
  }

  const id = readStringField(input.id, ['id'], 'invalid_project_id', '项目 id', issues)
  if (id !== null && id.trim() === '') {
    issues.push({ path: ['id'], code: 'invalid_project_id', message: '项目 id 不能为空' })
  }

  const name = readStringField(input.name, ['name'], 'invalid_name', '项目名称', issues)
  const engineVersion = readStringField(
    input.engineVersion,
    ['engineVersion'],
    'invalid_engine_version',
    'engineVersion',
    issues,
  )
  if (engineVersion !== null && engineVersion.trim() === '') {
    issues.push({
      path: ['engineVersion'],
      code: 'invalid_engine_version',
      message: 'engineVersion 不能为空',
    })
  }

  const createdAt = readDateField(input.createdAt, ['createdAt'], issues)
  const updatedAt = readDateField(input.updatedAt, ['updatedAt'], issues)

  const working = validateChainField(withLegacyTermRevisions(input.working), ['working'], issues, {
    allowEmptyTerms: true,
  })

  let baseline: Project['baseline'] = null
  if (input.baseline !== undefined && input.baseline !== null) {
    if (!isRecord(input.baseline)) {
      issues.push({
        path: ['baseline'],
        code: 'invalid_baseline',
        message: 'baseline 必须是 null 或包含 savedAt、definition 的对象',
      })
    } else {
      const savedAt = readDateField(input.baseline.savedAt, ['baseline', 'savedAt'], issues)
      const definition = validateChainField(
        withLegacyTermRevisions(input.baseline.definition),
        ['baseline', 'definition'],
        issues,
      )
      if (savedAt !== null && definition !== null) {
        baseline = { savedAt, definition }
      }
    }
  }

  if (issues.length > 0) {
    return failure('invalid_import', '项目 JSON 校验失败，未导入任何数据', issues)
  }

  if (
    id === null ||
    name === null ||
    engineVersion === null ||
    createdAt === null ||
    updatedAt === null ||
    working === null
  ) {
    return failure('invalid_import', '项目 JSON 缺少必要字段，未导入任何数据', [
      { path: [], code: 'missing_field', message: '项目 JSON 缺少必要字段' },
    ])
  }

  let result: ChainResult
  try {
    result = calculateChain(working)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failure('calculation_failed', '导入项目重新计算失败，未导入任何数据', [
      { path: [], code: 'calculation_failed', message },
    ])
  }

  const hadConfirmation =
    (isRecord(input.working) && input.working.relationConfirmed === true) ||
    (isRecord(input.baseline) &&
      isRecord(input.baseline.definition) &&
      input.baseline.definition.relationConfirmed === true)

  const warnings = [
    '已从 V1 项目文件迁移到 v2；数值、方向与单位保持不变。',
  ]
  if (hadConfirmation) {
    warnings.push(
      '旧的人工确认没有版本凭据，已清除，需要重新核对尺寸关系与作用方向。',
    )
  }
  warnings.push('来源核对状态为未检查（V1 文件没有来源绑定）。')

  return {
    ok: true,
    value: {
      project: {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        engineVersion,
        id,
        name,
        createdAt,
        updatedAt,
        working,
        // 外部导入一律从“未确认”重新建立；旧布尔没有任何凭据。
        relationRevision: 1,
        relationReview: null,
        migration: null,
        baseline,
      },
      result,
      warnings,
      migratedFrom: LEGACY_SCHEMA_VERSION,
      sources: null,
    },
  }
}

/**
 * V2 文件：工程输入、关系凭据与来源元数据（不含附件）。
 *
 * - 关系确认一律清除（REV-05）；文件里的 relationReview 即使存在也不采用；
 * - 来源文档/版本/绑定保留，但 Blob 不在 JSON 中：导入后明确标记附件不可用；
 * - 引用不完整、几何非法或指向不存在环的绑定拒绝整个文件，避免半套来源。
 */
function parseImportedProjectV2(input: Record<string, unknown>): StorageResult<ParsedProjectJson> {
  const issues: StorageIssue[] = []

  if (input.unit !== undefined && input.unit !== PROJECT_JSON_UNIT) {
    issues.push({
      path: ['unit'],
      code: 'invalid_unit',
      message: `单位声明必须是 "${PROJECT_JSON_UNIT}"（整数 0.0001 mm）`,
    })
  }
  if (input.qPerMm !== undefined && input.qPerMm !== Q_PER_MM) {
    issues.push({ path: ['qPerMm'], code: 'invalid_unit', message: `qPerMm 必须是 ${Q_PER_MM}` })
  }

  const id = readStringField(input.id, ['id'], 'invalid_project_id', '项目 id', issues)
  if (id !== null && id.trim() === '') {
    issues.push({ path: ['id'], code: 'invalid_project_id', message: '项目 id 不能为空' })
  }
  const name = readStringField(input.name, ['name'], 'invalid_name', '项目名称', issues)
  const engineVersion = readStringField(
    input.engineVersion,
    ['engineVersion'],
    'invalid_engine_version',
    'engineVersion',
    issues,
  )
  if (engineVersion !== null && engineVersion.trim() === '') {
    issues.push({
      path: ['engineVersion'],
      code: 'invalid_engine_version',
      message: 'engineVersion 不能为空',
    })
  }
  const createdAt = readDateField(input.createdAt, ['createdAt'], issues)
  const updatedAt = readDateField(input.updatedAt, ['updatedAt'], issues)
  const relationRevision =
    readNonNegativeInteger(input.relationRevision, ['relationRevision'], '关系修订号', issues) ?? 0

  const working = validateChainField(input.working, ['working'], issues, {
    allowEmptyTerms: true,
  })

  let baseline: Project['baseline'] = null
  if (input.baseline !== undefined && input.baseline !== null) {
    if (!isRecord(input.baseline)) {
      issues.push({
        path: ['baseline'],
        code: 'invalid_baseline',
        message: 'baseline 必须是 null 或包含 savedAt、definition 的对象',
      })
    } else {
      const savedAt = readDateField(input.baseline.savedAt, ['baseline', 'savedAt'], issues)
      const definition = validateChainField(input.baseline.definition, ['baseline', 'definition'], issues)
      if (savedAt !== null && definition !== null) {
        baseline = { savedAt, definition }
      }
    }
  }

  let sources: ParsedProjectSources | null = null
  if (working !== null) {
    sources = parseSourceMetadata(input.sources, working, issues)
  }

  // 文件里带 relationReview 说明它曾确认过；导入后不采用，必须提示。
  const hadReview =
    isRecord(input.relationReview) ||
    (input.relationReview !== undefined && input.relationReview !== null)

  if (issues.length > 0) {
    return failure('invalid_import', '项目 JSON 校验失败，未导入任何数据', issues)
  }
  if (
    id === null ||
    name === null ||
    engineVersion === null ||
    createdAt === null ||
    updatedAt === null ||
    working === null
  ) {
    return failure('invalid_import', '项目 JSON 缺少必要字段，未导入任何数据', [
      { path: [], code: 'missing_field', message: '项目 JSON 缺少必要字段' },
    ])
  }

  let result: ChainResult
  try {
    result = calculateChain(working)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failure('calculation_failed', '导入项目重新计算失败，未导入任何数据', [
      { path: [], code: 'calculation_failed', message },
    ])
  }

  const warnings: string[] = []
  if (hadReview) {
    warnings.push(
      '文件里的人工确认没有可核对的本机凭据，已清除，需要重新核对尺寸关系与作用方向。',
    )
  }
  if (sources !== null && sources.revisions.length > 0) {
    warnings.push(
      `数据备份不含来源附件：文件中的 ${sources.revisions.length} 个来源版本在导入后标记为附件不可用，` +
        '绑定区域与页码保留，但需要重新导入对应 PDF 才能查看原文。',
    )
  }

  return {
    ok: true,
    value: {
      project: {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        engineVersion,
        id,
        name,
        createdAt,
        updatedAt,
        working,
        // 导入不继承任何确认；修订号保留文件值并 +1，确保即使文件里残留
        // relationReview 也不可能匹配（双保险，读取时已置 null）。
        relationRevision: relationRevision + 1,
        relationReview: null,
        migration: null,
        baseline,
      },
      result,
      warnings,
      migratedFrom: null,
      sources,
    },
  }
}

/** 只读取已知字段；文件里即使带 result 等结果字段也完全忽略。按版本分派。 */
function parseImportedProject(input: unknown): StorageResult<ParsedProjectJson> {
  if (!isRecord(input)) {
    return failure('invalid_import', '项目 JSON 必须是对象', [
      { path: [], code: 'invalid_project', message: '项目 JSON 必须是对象' },
    ])
  }

  if (input.schemaVersion === LEGACY_SCHEMA_VERSION) {
    return parseImportedProjectV1(input)
  }
  if (input.schemaVersion === PROJECT_SCHEMA_VERSION) {
    return parseImportedProjectV2(input)
  }

  return failure(
    'unknown_schema_version',
    `只接受 schemaVersion=${LEGACY_SCHEMA_VERSION}（V1，导入时迁移）或 ${PROJECT_SCHEMA_VERSION} 的项目文件`,
    [
      {
        path: ['schemaVersion'],
        code: 'unknown_schema_version',
        message: `未知版本：${String(input.schemaVersion)}`,
      },
    ],
  )
}

function decodeProjectJson(input: ProjectJsonInput): StorageResult<string> {
  if (typeof input === 'string') {
    const byteLength = new TextEncoder().encode(input).byteLength
    if (byteLength > MAX_IMPORT_BYTES) {
      return failure('file_too_large', '项目 JSON 不能超过 1 MB', [
        {
          path: [],
          code: 'file_too_large',
          message: `文件为 ${byteLength} 字节，上限为 ${MAX_IMPORT_BYTES} 字节`,
        },
      ])
    }
    return { ok: true, value: input }
  }

  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    return failure('file_too_large', '项目 JSON 不能超过 1 MB', [
      {
        path: [],
        code: 'file_too_large',
        message: `文件为 ${bytes.byteLength} 字节，上限为 ${MAX_IMPORT_BYTES} 字节`,
      },
    ])
  }

  try {
    return {
      ok: true,
      value: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    }
  } catch {
    return failure('invalid_json', '项目文件不是有效的 UTF-8 JSON', [
      { path: [], code: 'invalid_json', message: '项目文件不是有效的 UTF-8 JSON' },
    ])
  }
}

/* -------------------------------------------------------------------------- */
/* IndexedDB                                                                  */
/* -------------------------------------------------------------------------- */

function newProjectId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function newImportSnapshotId(projectId: string): string {
  const cryptoApi = globalThis.crypto
  const suffix =
    cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function'
      ? cryptoApi.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `import-snapshot-${projectId}-${suffix}`
}

/**
 * 用 add 而不是 put 写入新项目：即使文件里的 ID 与本地冲突，也只会触发 ConstraintError，
 * 随后换一个新 ID 重试，绝不覆盖已有项目。
 */
async function addProjectWithUniqueId(
  db: IDBDatabase,
  initial: Project,
): Promise<{ project: Project; idChanged: boolean }> {
  let candidate = initial
  let idChanged = false

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const transaction = db.transaction(PROJECT_STORE_NAME, 'readwrite')
    const done = transactionDone(transaction)
    try {
      await requestResult(transaction.objectStore(PROJECT_STORE_NAME).add(candidate))
      await done
      return { project: candidate, idChanged }
    } catch (error) {
      await done.catch(() => undefined)
      if (errorName(error) !== 'ConstraintError') {
        throw error
      }
      candidate = { ...candidate, id: newProjectId() }
      idChanged = true
    }
  }

  throw new Error('无法生成唯一的项目 ID')
}

/* -------------------------------------------------------------------------- */
/* 本地 V1 项目升级                                                           */
/* -------------------------------------------------------------------------- */

interface MigrationBackupRecord {
  id: string
  projectId: string
  createdAt: string
  fromSchemaVersion: number
  /** 原始 V1 记录（不可变副本）；恢复旧版本程序时可据此导出。 */
  raw: unknown
}

/**
 * 把本地全部 V1 项目升级到 v2。
 *
 * 同一个 readwrite 事务覆盖 projects / drafts / migrationBackups / events：
 * - 每个项目的原始记录先写备份，再改写项目与草稿；
 * - 任一步失败都 abort，所有项目保持 V1，不会留下“项目已升、备份没写”
 *   或“备份已写、项目只改了一半”的半成品；
 * - 迁移会清除 V1 的人工确认布尔（没有版本凭据），并要求界面提示重新确认。
 *
 * 返回本次实际迁移的项目 ID；没有 V1 项目时返回空数组。
 */
async function migrateLegacyProjects(db: IDBDatabase): Promise<string[]> {
  const transaction = db.transaction(
    [PROJECT_STORE_NAME, DRAFT_STORE_NAME, MIGRATION_BACKUP_STORE_NAME, EVENT_STORE_NAME],
    'readwrite',
  )
  const done = transactionDone(transaction)
  const migratedIds: string[] = []

  try {
    const projectStore = transaction.objectStore(PROJECT_STORE_NAME)
    const records = (await requestResult(projectStore.getAll())) as unknown[]
    const legacy = records.filter(
      (record): record is Record<string, unknown> =>
        isRecord(record) && record.schemaVersion === LEGACY_SCHEMA_VERSION,
    )
    if (legacy.length === 0) {
      await done
      return migratedIds
    }

    const migratedAt = nowIso()
    const draftStore = transaction.objectStore(DRAFT_STORE_NAME)
    const backupStore = transaction.objectStore(MIGRATION_BACKUP_STORE_NAME)
    const eventStore = transaction.objectStore(EVENT_STORE_NAME)

    for (const record of legacy) {
      const projectId = String(record.id)
      const backupId = `migration-backup-${projectId}-${migratedAt}`
      const migrated = migrateProjectV1(record, { migratedAt, backupId })
      if (!migrated.ok) {
        throw new Error(
          `项目 ${projectId} 无法从 V1 升级：${migrated.error.message}。` +
            '本地数据库未被修改，原始 V1 记录仍保留。',
        )
      }

      const backup: MigrationBackupRecord = {
        id: backupId,
        projectId,
        createdAt: migratedAt,
        fromSchemaVersion: LEGACY_SCHEMA_VERSION,
        raw: record,
      }
      backupStore.add(backup)
      projectStore.put(migrated.value.project)

      const storedDraft = (await requestResult(draftStore.get(projectId))) as unknown
      if (isRecord(storedDraft)) {
        const migratedDraft = migrateDraftV1(storedDraft.draft)
        if (migratedDraft !== null) {
          draftStore.put({ ...storedDraft, draft: migratedDraft, savedAt: migratedAt })
        }
      }

      // 迁移事件与项目/备份同事务；失败时一起回滚。
      eventStore.add({
        id: `schema_migrated_v1_to_v2:${projectId}`,
        projectId,
        type: 'schema_migrated_v1_to_v2',
        createdAt: migratedAt,
        message: migrated.value.clearedManualConfirmation
          ? '本地项目已从 V1 升级到 v2；旧人工确认无版本凭据，已清除，需要重新确认。'
          : '本地项目已从 V1 升级到 v2；来源核对状态为未检查。',
      })

      migratedIds.push(projectId)
    }

    await done
    return migratedIds
  } catch (error) {
    try {
      transaction.abort()
    } catch {
      // 事务可能已 abort/error，忽略二次取消异常。
    }
    await done.catch(() => undefined)
    throw error
  }
}

/* -------------------------------------------------------------------------- */
/* 迁移前预览、原始备份与恢复（V2.1 收官补）                                  */
/* -------------------------------------------------------------------------- */

/** 迁移前原始备份文件的格式标记；只有本应用能识别，避免把普通 JSON 当备份。 */
export const LEGACY_BACKUP_FORMAT = 'cunlian-legacy-backup'
export const LEGACY_BACKUP_FORMAT_VERSION = 1

export interface LegacyProjectImpact {
  id: string
  name: string
  updatedAt: string
  termCount: number
  baselineTermCount: number | null
  /** 旧记录里的“已确认”没有版本凭据，迁移时会被清除。 */
  workingConfirmationWillClear: boolean
  baselineConfirmationWillClear: boolean
  draftPresent: boolean
  /** 草稿迁移后仍不能通过输入校验（原始输入会被保留）。 */
  draftInvalid: boolean
  /** 非 null 表示这条项目会阻止整批迁移；整批回滚，不产生半迁移项目。 */
  migrationError: string | null
}

export interface LegacyImpactReport {
  /** 尚未迁移的 V1 项目；空数组表示没有待迁移项目。 */
  projects: LegacyProjectImpact[]
  draftCount: number
  /** 会导致整批迁移失败的项目数；大于 0 时界面必须禁止“开始迁移”。 */
  blocking: number
}

interface LegacyRawSnapshot {
  projects: unknown[]
  drafts: { projectId: string; draft: unknown; savedAt: unknown }[]
}

/**
 * 只读扫描本地 V1 项目与草稿，不写库、不迁移。
 *
 * 这是“迁移前先看到影响”的数据来源：项目数、环数、基线、旧确认是否会清除，
 * 以及哪些项目会让整批迁移失败。真正的迁移仍由 getProject / listProjects 或
 * 显式的 migrateLegacyProjectsNow() 触发。
 */
async function readLegacyRawSnapshot(db: IDBDatabase): Promise<LegacyRawSnapshot> {
  const transaction = db.transaction([PROJECT_STORE_NAME, DRAFT_STORE_NAME], 'readonly')
  const done = transactionDone(transaction)
  const records = (await requestResult(
    transaction.objectStore(PROJECT_STORE_NAME).getAll(),
  )) as unknown[]
  const drafts = (await requestResult(
    transaction.objectStore(DRAFT_STORE_NAME).getAll(),
  )) as unknown[]
  await done
  return {
    projects: records.filter(
      (record): record is Record<string, unknown> =>
        isRecord(record) && record.schemaVersion === LEGACY_SCHEMA_VERSION,
    ),
    drafts: drafts.filter(
      (record): record is { projectId: string; draft: unknown; savedAt: unknown } =>
        isRecord(record) && typeof record.projectId === 'string',
    ),
  }
}

/** 迁移前影响报告。打开数据库本身只补缺失 store，不会迁移任何项目记录。 */
export async function inspectLegacyProjects(): Promise<StorageResult<LegacyImpactReport>> {
  try {
    const snapshot = await withDatabase(readLegacyRawSnapshot)
    const draftsByProject = new Map(snapshot.drafts.map((draft) => [draft.projectId, draft]))
    const projects: LegacyProjectImpact[] = snapshot.projects.map((record) => {
      const projectId = String((record as Record<string, unknown>).id ?? '')
      // 复用真实迁移函数做预检：预检对象不会被写入，只用于提前暴露失败原因。
      const migrated = migrateProjectV1(record, {
        migratedAt: 'preflight',
        backupId: 'preflight',
      })
      const draftRecord = draftsByProject.get(projectId)
      let draftInvalid = false
      if (draftRecord !== undefined) {
        const migratedDraft = migrateDraftV1(draftRecord.draft)
        draftInvalid = migratedDraft !== null && !draftToChain(migratedDraft).ok
      }
      const raw = record as Record<string, unknown>
      const rawWorking = isRecord(raw.working) ? raw.working : null
      const rawBaseline = isRecord(raw.baseline) ? raw.baseline : null
      const rawBaselineDefinition =
        rawBaseline !== null && isRecord(rawBaseline.definition)
          ? rawBaseline.definition
          : null
      const workingTerms = rawWorking !== null && Array.isArray(rawWorking.terms)
        ? rawWorking.terms.length
        : 0
      const baselineTerms =
        rawBaselineDefinition !== null && Array.isArray(rawBaselineDefinition.terms)
          ? rawBaselineDefinition.terms.length
          : null
      return {
        id: projectId,
        name: typeof raw.name === 'string' ? raw.name : projectId,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
        termCount: workingTerms,
        baselineTermCount: baselineTerms,
        workingConfirmationWillClear:
          rawWorking !== null && rawWorking.relationConfirmed === true,
        baselineConfirmationWillClear:
          rawBaselineDefinition !== null &&
          rawBaselineDefinition.relationConfirmed === true,
        draftPresent: draftRecord !== undefined,
        draftInvalid,
        migrationError: migrated.ok ? null : migrated.error.message,
      }
    })
    return {
      ok: true,
      value: {
        projects,
        draftCount: snapshot.drafts.length,
        blocking: projects.filter((project) => project.migrationError !== null).length,
      },
    }
  } catch (error) {
    return storageFailure(error, '读取迁移前影响失败')
  }
}

function legacyBackupFailure(message: string): StorageFailure {
  return failure('invalid_legacy_backup', message)
}

/**
 * 导出迁移前的原始 V1 项目与草稿为一份可保存到本机的 JSON 文件。
 *
 * 内容是完全未改写的原始记录（含旧 relationConfirmed 与无效草稿输入），
 * 不是 migrationBackups 的展示副本，也不含来源 Blob（V1 没有来源）。
 * 恢复方式：界面“迁移与恢复”里的“导入迁移前原始备份”，会重新导入为新项目。
 */
export async function exportLegacyBackup(): Promise<
  StorageResult<{ json: string; projectCount: number; draftCount: number }>
> {
  try {
    const snapshot = await withDatabase(readLegacyRawSnapshot)
    if (snapshot.projects.length === 0) {
      return failure('no_legacy_projects', '当前没有待迁移的旧版项目，无需导出迁移前备份')
    }
    const exportedAt = nowIso()
    const payload = {
      format: LEGACY_BACKUP_FORMAT,
      formatVersion: LEGACY_BACKUP_FORMAT_VERSION,
      exportedAt,
      note:
        '迁移前原始备份：projects 与 drafts 均为未改写的 V1 记录。恢复时导入为新项目（新 ID），不会覆盖或降级已迁移的项目。',
      projects: snapshot.projects,
      drafts: snapshot.drafts,
    }
    return {
      ok: true,
      value: {
        json: JSON.stringify(payload, null, 2),
        projectCount: snapshot.projects.length,
        draftCount: snapshot.drafts.length,
      },
    }
  } catch (error) {
    return storageFailure(error, '导出迁移前原始备份失败')
  }
}

/** 显式触发整批本地 V1 → v2 迁移；返回本次实际迁移的项目 ID。 */
export async function migrateLegacyProjectsNow(): Promise<StorageResult<string[]>> {
  try {
    const ids = await withDatabase((db) => migrateLegacyProjects(db))
    return { ok: true, value: ids }
  } catch (error) {
    return storageFailure(
      error,
      '迁移旧版项目失败，整批已回滚，原始 V1 记录仍在；可重试',
    )
  }
}

export interface RestoredLegacyProject {
  originalId: string
  newProjectId: string
  name: string
  draftRestored: boolean
}

/**
 * 用迁移前原始备份恢复数据。
 *
 * 数据库版本不能降级，因此“恢复”不是回退数据库，而是把原始 V1 记录重新
 * 导入为新项目（新 ID），保留数值/基线/草稿输入，并要求重新确认关系。
 * 每个项目单独提交：某个项目失败不会覆盖已有项目；返回值列出成功项。
 */
export async function restoreLegacyBackup(
  input: string,
): Promise<
  StorageResult<{ restored: RestoredLegacyProject[]; failed: { id: string; message: string }[] }>
> {
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    return legacyBackupFailure('备份文件不是有效的 JSON')
  }
  if (!isRecord(parsed) || parsed.format !== LEGACY_BACKUP_FORMAT) {
    return legacyBackupFailure('不是本应用导出的迁移前原始备份文件')
  }
  if (parsed.formatVersion !== LEGACY_BACKUP_FORMAT_VERSION) {
    return legacyBackupFailure('备份文件版本不受支持')
  }
  if (!Array.isArray(parsed.projects) || parsed.projects.length === 0) {
    return legacyBackupFailure('备份文件里没有项目记录')
  }
  const drafts = Array.isArray(parsed.drafts)
    ? parsed.drafts.filter(
        (draft): draft is { projectId: string; draft: unknown } =>
          isRecord(draft) &&
          typeof draft.projectId === 'string' &&
          draft.draft !== undefined,
      )
    : []

  // 先对全部项目做纯迁移预检，避免写到一半才发现某条记录不可迁移。
  for (const record of parsed.projects) {
    if (!isRecord(record)) {
      return legacyBackupFailure('备份文件包含非对象的项目记录')
    }
    const projectId = String(record.id ?? '')
    const preflight = migrateProjectV1(record, {
      migratedAt: 'preflight',
      backupId: 'preflight',
    })
    if (!preflight.ok) {
      return legacyBackupFailure(
        `备份中的项目 ${projectId} 无法恢复：${preflight.error.message}`,
      )
    }
  }

  const restored: RestoredLegacyProject[] = []
  const failed: { id: string; message: string }[] = []
  for (const record of parsed.projects) {
    const raw = record as Record<string, unknown>
    const originalId = String(raw.id ?? '')
    const imported = await importProject(JSON.stringify(raw))
    if (!imported.ok) {
      failed.push({ id: originalId, message: imported.error.message })
      continue
    }
    const newProjectId = imported.value.project.id
    const draftRecord = drafts.find((draft) => draft.projectId === originalId)
    let draftRestored = false
    if (draftRecord !== undefined) {
      const migratedDraft = migrateDraftV1(draftRecord.draft)
      if (migratedDraft !== null) {
        const saved = await saveDraft(newProjectId, migratedDraft)
        draftRestored = saved.ok
      }
    }
    restored.push({
      originalId,
      newProjectId,
      name: imported.value.project.name,
      draftRestored,
    })
  }
  if (restored.length === 0) {
    return legacyBackupFailure(
      failed.length > 0
        ? `备份恢复失败：${failed.map((item) => `${item.id}（${item.message}）`).join('；')}`
        : '备份恢复失败，未写入任何项目',
    )
  }
  return { ok: true, value: { restored, failed } }
}

/* -------------------------------------------------------------------------- */
/* CRUD                                                                       */
/* -------------------------------------------------------------------------- */

export async function createProject(
  input: CreateProjectInput,
): Promise<StorageResult<Project>> {
  const workingValidation = validateChain(input.working)
  if (!workingValidation.ok) {
    return failure(
      'invalid_chain',
      '项目工作方案校验失败',
      toStorageIssues(workingValidation.errors, ['working']),
    )
  }

  let baseline: Project['baseline'] = null
  if (input.baseline !== undefined && input.baseline !== null) {
    if (!isValidIsoDateTime(input.baseline.savedAt)) {
      return failure('invalid_date', '基线保存时间必须是合法的 ISO 8601 时间戳', [
        {
          path: ['baseline', 'savedAt'],
          code: 'invalid_date',
          message: '基线保存时间必须是合法的 ISO 8601 时间戳',
        },
      ])
    }
    const baselineValidation = validateChain(input.baseline.definition)
    if (!baselineValidation.ok) {
      return failure(
        'invalid_chain',
        '项目基线校验失败',
        toStorageIssues(baselineValidation.errors, ['baseline', 'definition']),
      )
    }
    baseline = {
      savedAt: input.baseline.savedAt,
      definition: baselineValidation.value,
    }
  }

  const now = nowIso()
  const project: Project = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    engineVersion: input.engineVersion?.trim() || ENGINE_VERSION,
    id: newProjectId(),
    name: input.name?.trim() || '未命名项目',
    createdAt: now,
    updatedAt: now,
    working: workingValidation.value,
    relationRevision: input.relationRevision ?? 0,
    relationReview: input.relationReview ?? null,
    migration: null,
    baseline,
  }

  try {
    const inserted = await withDatabase((db) => addProjectWithUniqueId(db, project))
    return { ok: true, value: inserted.project }
  } catch (error) {
    return storageFailure(error, '创建项目失败')
  }
}

/**
 * 首次打开工作台且本地没有项目时创建一个空白项目。
 *
 * 空白方案的组成环为 0，尚不满足 validateChain 的 2–20 项要求，因此不能走
 * createProject 的常规校验路径；它只是“还没有有效模型”的初始记录。之后的
 * 自动保存通过 saveDraft 处理：无效草稿只写 drafts 表，合法草稿才更新 working。
 */
export async function createEmptyProject(
  name = '未命名项目',
): Promise<StorageResult<Project>> {
  const now = nowIso()
  const project: Project = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    id: newProjectId(),
    name: name.trim() || '未命名项目',
    createdAt: now,
    updatedAt: now,
    working: {
      terms: [],
      target: null,
      assumptions: '',
    },
    relationRevision: 0,
    relationReview: null,
    migration: null,
    baseline: null,
  }

  try {
    const inserted = await withDatabase((db) => addProjectWithUniqueId(db, project))
    return { ok: true, value: inserted.project }
  } catch (error) {
    return storageFailure(error, '创建空项目失败')
  }
}

export async function getProject(id: string): Promise<StorageResult<Project | null>> {
  try {
    const project = await withDatabase(async (db) => {
      const read = async (): Promise<unknown> => {
        const transaction = db.transaction(PROJECT_STORE_NAME, 'readonly')
        const done = transactionDone(transaction)
        const value = await requestResult(
          transaction.objectStore(PROJECT_STORE_NAME).get(id),
        )
        await done
        return value
      }

      let value = await read()
      // 本地旧库首次打开：先在同一事务里备份并升级，再返回 v2 记录。
      if (isRecord(value) && value.schemaVersion === LEGACY_SCHEMA_VERSION) {
        await migrateLegacyProjects(db)
        value = await read()
      }
      return value as Project | undefined
    })
    return { ok: true, value: project ?? null }
  } catch (error) {
    return storageFailure(error, '读取项目失败')
  }
}

export interface ListProjectsOptions {
  /**
   * 默认 true：读取时顺带迁移本地 V1 项目（工作台深链等路径）。
   * false 只读返回原始记录，供项目列表在迁移前展示影响；此时数组里可能
   * 含有 schemaVersion=1 的记录，调用方必须先按版本分支。
   */
  migrate?: boolean
}

export async function listProjects(
  options: ListProjectsOptions = {},
): Promise<StorageResult<Project[]>> {
  const migrate = options.migrate ?? true
  try {
    const projects = await withDatabase(async (db) => {
      const readAll = async (): Promise<unknown[]> => {
        const transaction = db.transaction(PROJECT_STORE_NAME, 'readonly')
        const done = transactionDone(transaction)
        const value = await requestResult(
          transaction.objectStore(PROJECT_STORE_NAME).getAll(),
        )
        await done
        return value as unknown[]
      }

      let values = await readAll()
      if (
        migrate &&
        values.some(
          (record) => isRecord(record) && record.schemaVersion === LEGACY_SCHEMA_VERSION,
        )
      ) {
        await migrateLegacyProjects(db)
        values = await readAll()
      }
      return values as Project[]
    })
    projects.sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
    )
    return { ok: true, value: projects }
  } catch (error) {
    return storageFailure(error, '读取项目列表失败')
  }
}

export async function updateProject(
  id: string,
  patch: UpdateProjectInput,
): Promise<StorageResult<Project>> {
  let name: string | undefined
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim()
    if (trimmed === '') {
      return failure('invalid_name', '项目名称不能为空', [
        { path: ['name'], code: 'invalid_name', message: '项目名称不能为空' },
      ])
    }
    name = trimmed
  }

  let engineVersion: string | undefined
  if (patch.engineVersion !== undefined) {
    const trimmed = patch.engineVersion.trim()
    if (trimmed === '') {
      return failure('invalid_engine_version', 'engineVersion 不能为空', [
        {
          path: ['engineVersion'],
          code: 'invalid_engine_version',
          message: 'engineVersion 不能为空',
        },
      ])
    }
    engineVersion = trimmed
  }

  let working: ChainDefinition | undefined
  if (patch.working !== undefined) {
    const validation = validateChain(patch.working)
    if (!validation.ok) {
      return failure(
        'invalid_chain',
        '项目工作方案校验失败',
        toStorageIssues(validation.errors, ['working']),
      )
    }
    working = validation.value
  }

  let baseline: Project['baseline'] | undefined
  if (patch.baseline !== undefined) {
    if (patch.baseline === null) {
      baseline = null
    } else {
      if (!isValidIsoDateTime(patch.baseline.savedAt)) {
        return failure('invalid_date', '基线保存时间必须是合法的 ISO 8601 时间戳', [
          {
            path: ['baseline', 'savedAt'],
            code: 'invalid_date',
            message: '基线保存时间必须是合法的 ISO 8601 时间戳',
          },
        ])
      }
      const validation = validateChain(patch.baseline.definition)
      if (!validation.ok) {
        return failure(
          'invalid_chain',
          '项目基线校验失败',
          toStorageIssues(validation.errors, ['baseline', 'definition']),
        )
      }
      baseline = {
        savedAt: patch.baseline.savedAt,
        definition: validation.value,
      }
    }
  }

  let relationRevision: number | undefined
  if (patch.relationRevision !== undefined) {
    if (!Number.isSafeInteger(patch.relationRevision) || patch.relationRevision < 0) {
      return failure('invalid_integer', '关系修订号必须是非负安全整数', [
        {
          path: ['relationRevision'],
          code: 'invalid_integer',
          message: '关系修订号必须是非负安全整数',
        },
      ])
    }
    relationRevision = patch.relationRevision
  }

  let relationReview: RelationReview | null | undefined
  if (patch.relationReview !== undefined) {
    relationReview = patch.relationReview
  }

  try {
    return await withDatabase(async (db) => {
      const transaction = db.transaction(PROJECT_STORE_NAME, 'readwrite')
      const done = transactionDone(transaction)
      try {
        const store = transaction.objectStore(PROJECT_STORE_NAME)
        const existing = (await requestResult(store.get(id))) as Project | undefined
        if (existing === undefined) {
          transaction.abort()
          await done.catch(() => undefined)
          return failure('not_found', '项目不存在')
        }

        const updated: Project = {
          ...existing,
          name: name ?? existing.name,
          engineVersion: engineVersion ?? existing.engineVersion,
          working: working ?? existing.working,
          relationRevision: relationRevision ?? existing.relationRevision,
          relationReview:
            relationReview === undefined ? existing.relationReview : relationReview,
          baseline: baseline === undefined ? existing.baseline : baseline,
          updatedAt: nowIso(),
        }
        store.put(updated)
        await done
        return { ok: true, value: updated }
      } catch (error) {
        await done.catch(() => undefined)
        throw error
      }
    })
  } catch (error) {
    return storageFailure(error, '更新项目失败')
  }
}

/**
 * 项目被删除后，来源记录（文档 / 版本 / Blob 记录 / 绑定 / 事件）不级联删除：
 * revision 是不可变的历史资料，Blob 字节也保留。但它们的 projectId 必须整体
 * 挪到一个退役作用域，否则重建同 ID 项目会看到上一个身份的来源，旧 revision
 * 还会占新项目的额度。
 *
 * 只改各表的作用域键 projectId，不改 sha256 / byteSize / blob / rectPdf /
 * createdAt；旧记录仍可按 id / blobKey 读回，只是不再属于任何现存项目。
 */
function retiredSourceScopeId(projectId: string): string {
  return `${projectId}::retired::${newProjectId()}`
}

async function retireSourceScope(
  transaction: IDBTransaction,
  projectId: string,
): Promise<void> {
  const retiredId = retiredSourceScopeId(projectId)
  const documentStore = transaction.objectStore(SOURCE_DOCUMENT_STORE_NAME)
  const documents = (await requestResult(
    documentStore.index('projectId').getAll(projectId),
  )) as { id: string; projectId: string }[]
  for (const document of documents) {
    documentStore.put({ ...document, projectId: retiredId })
  }

  const revisionStore = transaction.objectStore(SOURCE_REVISION_STORE_NAME)
  const revisions = (await requestResult(
    revisionStore.index('projectId').getAll(projectId),
  )) as { id: string; projectId: string }[]
  for (const revision of revisions) {
    revisionStore.put({ ...revision, projectId: retiredId })
  }

  const blobStore = transaction.objectStore(SOURCE_BLOB_STORE_NAME)
  const blobs = (await requestResult(
    blobStore.index('projectId').getAll(projectId),
  )) as { blobKey: string; projectId: string }[]
  for (const blob of blobs) {
    blobStore.put({ ...blob, projectId: retiredId })
  }

  const bindingStore = transaction.objectStore(BINDING_STORE_NAME)
  const bindings = (await requestResult(
    bindingStore.index('projectId').getAll(projectId),
  )) as { id: string; projectId: string }[]
  for (const binding of bindings) {
    bindingStore.put({ ...binding, projectId: retiredId })
  }

  const eventStore = transaction.objectStore(EVENT_STORE_NAME)
  const events = (await requestResult(
    eventStore.index('projectId').getAll(projectId),
  )) as { id: string; projectId: string }[]
  for (const event of events) {
    eventStore.put({ ...event, projectId: retiredId })
  }
}

export async function deleteProject(id: string): Promise<StorageResult<boolean>> {
  try {
    return await withDatabase(async (db) => {
      const transaction = db.transaction(
        [
          PROJECT_STORE_NAME,
          DRAFT_STORE_NAME,
          IMPORT_SNAPSHOT_STORE_NAME,
          SOURCE_DOCUMENT_STORE_NAME,
          SOURCE_REVISION_STORE_NAME,
          SOURCE_BLOB_STORE_NAME,
          BINDING_STORE_NAME,
          EVENT_STORE_NAME,
        ],
        'readwrite',
      )
      const done = transactionDone(transaction)
      try {
        const projectStore = transaction.objectStore(PROJECT_STORE_NAME)
        const existing = (await requestResult(projectStore.get(id))) as Project | undefined
        // 只有确实存在该项目时才退役来源作用域；重复删除不会再次改写记录。
        if (existing !== undefined) {
          await retireSourceScope(transaction, id)
        }
        projectStore.delete(id)
        transaction.objectStore(DRAFT_STORE_NAME).delete(id)
        const snapshotStore = transaction.objectStore(IMPORT_SNAPSHOT_STORE_NAME)
        if (snapshotStore.indexNames.contains('projectId')) {
          const snapshots = (await requestResult(
            snapshotStore.index('projectId').getAll(id),
          )) as ImportSnapshot[]
          for (const snapshot of snapshots) {
            snapshotStore.delete(snapshot.id)
          }
        }
        await done
        return { ok: true, value: existing !== undefined }
      } catch (error) {
        // 同步异常（例如 retireSourceScope 里某个 put 抛错）不会自动结束事务；
        // 必须显式取消，否则已排队的来源退役写入仍可能提交，留下“删除失败但
        // 部分来源已退役”的半成品。与 bindings.ts 的写入路径保持一致。
        try {
          transaction.abort()
        } catch {
          // 事务可能已经 error/abort，忽略二次取消异常。
        }
        await done.catch(() => undefined)
        throw error
      }
    })
  } catch (error) {
    return storageFailure(error, '删除项目失败')
  }
}

/* -------------------------------------------------------------------------- */
/* 草稿                                                                       */
/* -------------------------------------------------------------------------- */

export async function getDraft(
  projectId: string,
): Promise<StorageResult<StoredDraft | null>> {
  try {
    const draft = await withDatabase(async (db) => {
      const transaction = db.transaction(DRAFT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction.objectStore(DRAFT_STORE_NAME).get(projectId),
      )
      await done
      return value as StoredDraft | undefined
    })
    return { ok: true, value: draft ?? null }
  } catch (error) {
    return storageFailure(error, '读取草稿失败')
  }
}

/** 一次读取全部草稿，供项目列表按草稿推导与工作台一致的状态。 */
export async function listDrafts(): Promise<StorageResult<StoredDraft[]>> {
  try {
    const drafts = await withDatabase(async (db) => {
      const transaction = db.transaction(DRAFT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction.objectStore(DRAFT_STORE_NAME).getAll(),
      )
      await done
      return value as StoredDraft[]
    })
    return { ok: true, value: drafts }
  } catch (error) {
    return storageFailure(error, '读取草稿列表失败')
  }
}

/**
 * 读取替换导入前的方案快照。传入 projectId 时只返回该项目的快照；
 * 不传时返回全部（测试与后续恢复界面使用）。
 */
export async function listImportSnapshots(
  projectId?: string,
): Promise<StorageResult<ImportSnapshot[]>> {
  try {
    const snapshots = await withDatabase(async (db) => {
      const transaction = db.transaction(IMPORT_SNAPSHOT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const store = transaction.objectStore(IMPORT_SNAPSHOT_STORE_NAME)
      const request =
        projectId === undefined
          ? store.getAll()
          : store.index('projectId').getAll(projectId)
      const value = await requestResult(request)
      await done
      return value as ImportSnapshot[]
    })
    return { ok: true, value: snapshots }
  } catch (error) {
    return storageFailure(error, '读取替换前快照失败')
  }
}

/**
 * 自动保存入口：草稿永远写入独立 drafts 表，只有通过 draftToChain 时才同步更新
 * projects.working。无效草稿只更新草稿，项目模型与 updatedAt 都保持不变。
 */
export async function saveDraft(
  projectId: string,
  draft: WorkspaceDraft,
  options: SaveDraftOptions = {},
): Promise<StorageResult<SaveDraftResult>> {
  let conversion: ReturnType<typeof draftToChain>
  try {
    conversion = draftToChain(draft)
  } catch (error) {
    return storageFailure(error, '草稿结构无效')
  }

  try {
    return await withDatabase(async (db) => {
      const withSnapshot = options.snapshotBefore === 'replace'
      const storeNames = withSnapshot
        ? [PROJECT_STORE_NAME, DRAFT_STORE_NAME, IMPORT_SNAPSHOT_STORE_NAME, EVENT_STORE_NAME]
        : [PROJECT_STORE_NAME, DRAFT_STORE_NAME, EVENT_STORE_NAME]
      const transaction = db.transaction(storeNames, 'readwrite')
      const done = transactionDone(transaction)
      try {
        const projectStore = transaction.objectStore(PROJECT_STORE_NAME)
        const draftStore = transaction.objectStore(DRAFT_STORE_NAME)
        const existing = (await requestResult(projectStore.get(projectId))) as
          | Project
          | undefined
        if (existing === undefined) {
          transaction.abort()
          await done.catch(() => undefined)
          return failure('not_found', '项目不存在')
        }

        const savedAt = nowIso()
        const storedDraft: StoredDraft = { projectId, draft, savedAt }
        draftStore.put(storedDraft)

        // 快照必须与替换写入处于同一事务：任一步失败都会整体 abort，
        // 不会留下“快照已写、方案未换”或“方案已换、快照丢失”的半成品。
        let importSnapshot: ImportSnapshot | null = null
        if (withSnapshot) {
          importSnapshot = {
            id: newImportSnapshotId(projectId),
            projectId,
            createdAt: savedAt,
            kind: 'replace-before-import',
            definition: existing.working,
          }
          transaction
            .objectStore(IMPORT_SNAPSHOT_STORE_NAME)
            .add(importSnapshot)
        }

        let project = existing
        let modelUpdated = false
        const nextRelationRevision =
          options.relationState?.relationRevision ??
          draft.relationRevision ??
          existing.relationRevision
        const nextRelationReview =
          options.relationState !== undefined
            ? options.relationState.relationReview
            : existing.relationReview

        if (conversion.ok) {
          // 代号变化记录名称变更事件：来源数值核对保留（termRevision 不变），
          // 但关系确认已因 relationRevision 递增而失效。事件与草稿同事务。
          const previousSymbols = new Map(
            existing.working.terms.map((term) => [term.id, term.symbol]),
          )
          for (const term of conversion.chain.terms) {
            const before = previousSymbols.get(term.id)
            if (before === undefined || before === term.symbol) {
              continue
            }
            transaction.objectStore(EVENT_STORE_NAME).put({
              id: `term_symbol_changed:${projectId}:${term.id}:${draft.relationRevision}`,
              projectId,
              type: 'term_symbol_changed',
              createdAt: savedAt,
              termId: term.id,
              before,
              after: term.symbol,
              message: `组成环代号由「${before}」改为「${term.symbol}」；来源数值核对保留，关系确认需要重新核对。`,
            })
          }

          project = {
            ...existing,
            working: conversion.chain,
            relationRevision: nextRelationRevision,
            relationReview: nextRelationReview,
            updatedAt: savedAt,
          }
          projectStore.put(project)
          modelUpdated = true
        } else if (
          nextRelationRevision !== existing.relationRevision ||
          nextRelationReview !== existing.relationReview
        ) {
          // 草稿非法时仍要落关系修订号：失效不能等“合法落库”。
          project = {
            ...existing,
            relationRevision: nextRelationRevision,
            relationReview: nextRelationReview,
            updatedAt: savedAt,
          }
          projectStore.put(project)
        }

        await done
        return {
          ok: true,
          value: {
            project,
            draft: storedDraft,
            modelUpdated,
            cellErrors: conversion.ok ? {} : conversion.cellErrors,
            importSnapshot,
          },
        }
      } catch (error) {
        // 同步异常（例如写请求抛 DataError）不会自动 abort 事务；
        // 必须显式取消，保证已排队的 projects / drafts / importSnapshots 写入全部回滚。
        try {
          transaction.abort()
        } catch {
          // 事务可能已经 error/abort，忽略二次取消异常。
        }
        await done.catch(() => undefined)
        throw error
      }
    })
  } catch (error) {
    return storageFailure(error, '保存草稿失败')
  }
}

/* -------------------------------------------------------------------------- */
/* 导入导出                                                                   */
/* -------------------------------------------------------------------------- */

export function exportProjectJson(
  project: Project,
  sources: ParsedProjectSources | null = null,
): string {
  const exported: ExportedProjectJson = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    unit: PROJECT_JSON_UNIT,
    qPerMm: Q_PER_MM,
    engineVersion: project.engineVersion,
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    relationRevision: project.relationRevision,
    relationReview: project.relationReview,
    working: project.working,
    baseline: project.baseline,
    // 来源元数据与绑定随 JSON 导出，但 Blob 字节不在 JSON 中。
    sources: {
      documents: sources?.documents ?? [],
      revisions: sources?.revisions ?? [],
      bindings: sources?.bindings ?? [],
      attachmentsIncluded: false,
      notice: EXPORT_SOURCES_NOTICE,
    },
  }
  return JSON.stringify(exported, null, 2)
}

/** 读取项目的来源元数据（文档 / 版本 / 绑定），不读取 Blob 字节。 */
export async function loadProjectSources(
  projectId: string,
): Promise<StorageResult<ParsedProjectSources>> {
  try {
    const sources = await withDatabase(async (db) => {
      const transaction = db.transaction(
        [SOURCE_DOCUMENT_STORE_NAME, SOURCE_REVISION_STORE_NAME, BINDING_STORE_NAME],
        'readonly',
      )
      const done = transactionDone(transaction)
      const documents = (await requestResult(
        transaction.objectStore(SOURCE_DOCUMENT_STORE_NAME).index('projectId').getAll(projectId),
      )) as SourceDocument[]
      const revisions = (await requestResult(
        transaction.objectStore(SOURCE_REVISION_STORE_NAME).index('projectId').getAll(projectId),
      )) as SourceRevision[]
      const bindings = (await requestResult(
        transaction.objectStore(BINDING_STORE_NAME).index('projectId').getAll(projectId),
      )) as SourceBinding[]
      await done
      return { documents, revisions, bindings }
    })
    return { ok: true, value: sources }
  } catch (error) {
    return storageFailure(error, '读取项目来源元数据失败')
  }
}

export async function exportProject(id: string): Promise<StorageResult<string>> {
  const loaded = await getProject(id)
  if (!loaded.ok) {
    return loaded
  }
  if (loaded.value === null) {
    return failure('not_found', '项目不存在')
  }
  const sources = await loadProjectSources(id)
  if (!sources.ok) {
    return sources
  }
  return { ok: true, value: exportProjectJson(loaded.value, sources.value) }
}

function newImportedSourceId(prefix: string): string {
  const cryptoApi = globalThis.crypto
  const suffix =
    cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function'
      ? cryptoApi.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${suffix}`
}

/**
 * 写入导入项目与来源元数据。
 *
 * - 项目 ID 冲突时整个事务换新 ID 重试，绝不覆盖本地项目；
 * - 文档 / 版本 / 绑定 ID 冲突时生成新 ID，并同步重写所有引用
 *   （document.latestRevisionId、revision.documentId、binding.revisionId /
 *   documentId），保证关联 ID 一致；
 * - 项目、来源、导入事件在同一个事务，失败一起回滚。
 */
async function addProjectWithSources(
  db: IDBDatabase,
  initial: Project,
  sources: ParsedProjectSources | null,
): Promise<{ project: Project; idChanged: boolean }> {
  let candidate = initial
  let idChanged = false

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const transaction = db.transaction(
      [
        PROJECT_STORE_NAME,
        SOURCE_DOCUMENT_STORE_NAME,
        SOURCE_REVISION_STORE_NAME,
        BINDING_STORE_NAME,
        EVENT_STORE_NAME,
      ],
      'readwrite',
    )
    const done = transactionDone(transaction)
    try {
      const projectStore = transaction.objectStore(PROJECT_STORE_NAME)
      const existing = await requestResult(projectStore.get(candidate.id))
      if (existing !== undefined) {
        candidate = { ...candidate, id: newProjectId() }
        idChanged = true
        await done
        continue
      }

      if (sources !== null) {
        const documentStore = transaction.objectStore(SOURCE_DOCUMENT_STORE_NAME)
        const revisionStore = transaction.objectStore(SOURCE_REVISION_STORE_NAME)
        const bindingStore = transaction.objectStore(BINDING_STORE_NAME)

        const documentIdMap = new Map<string, string>()
        for (const document of sources.documents) {
          const conflict = await requestResult(documentStore.get(document.id))
          documentIdMap.set(
            document.id,
            conflict === undefined ? document.id : newImportedSourceId('source-document'),
          )
        }
        const revisionIdMap = new Map<string, string>()
        for (const revision of sources.revisions) {
          const conflict = await requestResult(revisionStore.get(revision.id))
          revisionIdMap.set(
            revision.id,
            conflict === undefined ? revision.id : newImportedSourceId('source-revision'),
          )
        }

        for (const document of sources.documents) {
          documentStore.add({
            ...document,
            id: documentIdMap.get(document.id) as string,
            projectId: candidate.id,
            latestRevisionId: revisionIdMap.get(document.latestRevisionId) as string,
          })
        }
        for (const revision of sources.revisions) {
          revisionStore.add({
            ...revision,
            id: revisionIdMap.get(revision.id) as string,
            projectId: candidate.id,
            documentId: documentIdMap.get(revision.documentId) as string,
            // JSON 不含 Blob 字节；blobKey 必须重新生成，否则会按旧键
            // 读到已退役项目留下的同名 Blob，把缺附件伪装成可用来源。
            blobKey: newImportedSourceId('source-blob'),
          })
        }
        for (const binding of sources.bindings) {
          const conflict = await requestResult(bindingStore.get(binding.id))
          bindingStore.add({
            ...binding,
            id: conflict === undefined ? binding.id : newImportedSourceId('source-binding'),
            projectId: candidate.id,
            revisionId: revisionIdMap.get(binding.revisionId) as string,
            documentId: documentIdMap.get(binding.documentId) as string,
          })
        }
      }

      projectStore.add(candidate)
      transaction.objectStore(EVENT_STORE_NAME).add({
        id: `project_imported:${candidate.id}`,
        projectId: candidate.id,
        type: 'project_imported',
        createdAt: nowIso(),
        message:
          sources === null || sources.revisions.length === 0
            ? '已导入项目 JSON（不含来源附件）。'
            : `已导入项目 JSON 与 ${sources.revisions.length} 个来源版本元数据；附件未包含在数据备份中，需重新导入 PDF。`,
      })
      await done
      return { project: candidate, idChanged }
    } catch (error) {
      try {
        transaction.abort()
      } catch {
        // 事务可能已经 error/abort，忽略二次取消异常。
      }
      await done.catch(() => undefined)
      if (errorName(error) !== 'ConstraintError') {
        throw error
      }
      candidate = { ...candidate, id: newProjectId() }
      idChanged = true
    }
  }

  throw new Error('无法生成唯一的项目 ID')
}

/**
 * 导入项目。校验、迁移和重新计算都在写库之前完成；任何拒绝都不会写数据。
 * V1 文件迁移为 v2，V2 文件保留来源元数据但清除人工确认。
 */
export async function importProject(
  input: ProjectJsonInput,
): Promise<StorageResult<ImportProjectResult>> {
  const decoded = decodeProjectJson(input)
  if (!decoded.ok) {
    return decoded
  }

  let raw: unknown
  try {
    raw = JSON.parse(decoded.value)
  } catch {
    return failure('invalid_json', '项目 JSON 格式无效，未导入任何数据', [
      { path: [], code: 'invalid_json', message: 'JSON.parse 失败' },
    ])
  }

  const parsed = parseImportedProject(raw)
  if (!parsed.ok) {
    return parsed
  }

  try {
    const inserted = await withDatabase((db) =>
      addProjectWithSources(db, parsed.value.project, parsed.value.sources),
    )
    const sourceSummary =
      parsed.value.sources === null
        ? null
        : {
            documents: parsed.value.sources.documents.length,
            revisions: parsed.value.sources.revisions.length,
            bindings: parsed.value.sources.bindings.length,
            // JSON 数据备份不带 Blob：只要文件里有来源版本，附件就不可用。
            attachmentsMissing: parsed.value.sources.revisions.length > 0,
          }
    return {
      ok: true,
      value: {
        project: inserted.project,
        result: parsed.value.result,
        idChanged: inserted.idChanged,
        warnings: parsed.value.warnings,
        migratedFrom: parsed.value.migratedFrom,
        sources: sourceSummary,
      },
    }
  } catch (error) {
    return storageFailure(error, '导入项目失败，未写入数据')
  }
}

export const importProjectJson = importProject
