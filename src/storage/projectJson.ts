/**
 * 项目 JSON（V1/V2）的**纯解析与校验**（A-03 从 storage/projects.ts 抽出）。
 *
 * 只做：单位/版本分派、字段读取、尺寸链校验、来源元数据与几何引用校验、
 * 用既有 calculateChain 重算当前工作方案；不打开 IndexedDB、不写库。
 * - 既有导入入口 `importProject`（storage/projects.ts）复用本模块；
 * - V3 迁移（src/project-file/migrateV2.ts）复用同一套解析，不复制规则。
 *
 * 抽出时逐段保留原实现、错误码与文案；原 V1/V2 导入行为不变。
 */
import { calculateChain } from '../domain/calculate'
import {
  PROJECT_SCHEMA_VERSION,
  Q_PER_MM,
  type ChainDefinition,
  type ChainResult,
  type DimensionTerm,
  type Project,
} from '../domain/types'
import { validateChain, type ValidationError } from '../domain/validation'
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
export interface ImportSnapshot {
  id: string
  projectId: string
  createdAt: string
  kind: 'replace-before-import'
  definition: ChainDefinition
}
export type ProjectJsonInput = string | ArrayBuffer | Uint8Array
export function failure(
  code: string,
  message: string,
  details: StorageIssue[] = [],
): StorageFailure {
  return { ok: false, error: { code, message, details } }
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mapDomainErrorCode(code: string): string {
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

export function toStorageIssues(
  errors: ValidationError[],
  prefix: (string | number)[],
): StorageIssue[] {
  return errors.map((error) => ({
    path: [...prefix, ...error.path],
    code: mapDomainErrorCode(error.code),
    message: error.message,
  }))
}
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

/**
 * 解析导入文件里的历史来源接受凭据。
 * 理由/适用范围/时间/最新版本任一缺失或非法就整体丢弃为 null：
 * 不能把半截字段当成“已说明的历史来源”。
 */
function parseHistoricalAcceptance(
  value: unknown,
): SourceBinding['historicalAcceptance'] {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as Record<string, unknown>
  const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
  const scope = typeof record.scope === 'string' ? record.scope.trim() : ''
  const latestRevisionId =
    typeof record.latestRevisionId === 'string' ? record.latestRevisionId.trim() : ''
  const acceptedAt =
    typeof record.acceptedAt === 'string' && isValidIsoDateTime(record.acceptedAt)
      ? record.acceptedAt
      : null
  if (reason === '' || scope === '' || latestRevisionId === '' || acceptedAt === null) {
    return null
  }
  return { reason, scope, acceptedAt, latestRevisionId }
}

/** 接受带时区的 ISO 8601 时间戳；拒绝 Date.parse 会静默进位的非法日期。 */
export function isValidIsoDateTime(value: unknown): value is string {
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

export interface ParsedProjectJson {
  project: Project
  result: ChainResult
  /** 导入时必须向用户明示的事实。 */
  warnings: string[]
  /** 文件版本；V1 文件为 1，V2 文件为 null。 */
  migratedFrom: number | null
  /** 文件中的来源元数据；V1 文件或没有来源信息时为 null。 */
  sources: ParsedProjectSources | null
}
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
        historicalAcceptance: parseHistoricalAcceptance(item.historicalAcceptance),
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
export function parseImportedProject(input: unknown): StorageResult<ParsedProjectJson> {
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

export function decodeProjectJson(input: ProjectJsonInput): StorageResult<string> {
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
