import { calculateChain, ENGINE_VERSION } from '../domain/calculate'
import {
  Q_PER_MM,
  type ChainDefinition,
  type ChainResult,
  type DimensionTerm,
  type Project,
} from '../domain/types'
import { validateChain, type ValidationError } from '../domain/validation'
import { draftToChain, type CellErrors, type WorkspaceDraft } from '../workspace/draft'

/** 项目 JSON 结构版本；导入只接受这一版本。 */
export const STORAGE_SCHEMA_VERSION = 1
/** 项目 JSON 中的数值单位声明：整数 q，1 q = 0.0001 mm。 */
export const PROJECT_JSON_UNIT = 'q'
/** 单个项目 JSON 的字节上限（1 MB）。 */
export const MAX_IMPORT_BYTES = 1024 * 1024
/** 文档第 7 节：组成环最多 20 项。 */
export const MAX_CHAIN_TERMS = 20
/** fake-indexeddb 测试也用它清理数据库。 */
export const PROJECT_DB_NAME = 'shaft-tolerance-chain'

const PROJECT_DB_VERSION = 1
const PROJECT_STORE_NAME = 'projects'
const DRAFT_STORE_NAME = 'drafts'

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
}

export interface UpdateProjectInput {
  name?: string
  engineVersion?: string
  working?: ChainDefinition
  baseline?: Project['baseline']
}

export interface SaveDraftResult {
  project: Project
  draft: StoredDraft
  /** 只有草稿通过 draftToChain 时才为 true；否则只写 drafts 表。 */
  modelUpdated: boolean
  cellErrors: CellErrors
}

export interface ImportProjectResult {
  project: Project
  /** 用导入后的 ChainDefinition 重新计算的结果，文件中的结果字段从不读取。 */
  result: ChainResult
  /** 文件里的项目 ID 与本地已有项目冲突时为 true。 */
  idChanged: boolean
}

/** 导出文件中的字段：只含工程输入与单位声明，不含派生结果。 */
export interface ExportedProjectJson {
  schemaVersion: 1
  unit: 'q'
  qPerMm: number
  engineVersion: string
  id: string
  name: string
  createdAt: string
  updatedAt: string
  working: ChainDefinition
  baseline: Project['baseline']
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

interface ParsedProjectJson {
  project: Project
  result: ChainResult
}

/** 只读取已知字段；文件里即使带 result 等结果字段也完全忽略。 */
function parseImportedProject(input: unknown): StorageResult<ParsedProjectJson> {
  if (!isRecord(input)) {
    return failure('invalid_import', '项目 JSON 必须是对象', [
      { path: [], code: 'invalid_project', message: '项目 JSON 必须是对象' },
    ])
  }

  if (input.schemaVersion !== STORAGE_SCHEMA_VERSION) {
    return failure(
      'unknown_schema_version',
      `只接受 schemaVersion=${STORAGE_SCHEMA_VERSION} 的项目文件`,
      [
        {
          path: ['schemaVersion'],
          code: 'unknown_schema_version',
          message: `未知版本：${String(input.schemaVersion)}`,
        },
      ],
    )
  }

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
      const definition = validateChainField(
        input.baseline.definition,
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
    // 正常情况下上面任一字段为空都会产生 issues；这里只做类型收窄兜底。
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

  return {
    ok: true,
    value: {
      project: {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        engineVersion,
        id,
        name,
        createdAt,
        updatedAt,
        working,
        baseline,
      },
      result,
    },
  }
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

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB 请求失败'))
    }
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve()
    }
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('IndexedDB 事务失败'))
    }
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('IndexedDB 事务已取消'))
    }
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(PROJECT_DB_NAME, PROJECT_DB_VERSION)
    } catch (error) {
      reject(error)
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PROJECT_STORE_NAME)) {
        db.createObjectStore(PROJECT_STORE_NAME, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(DRAFT_STORE_NAME)) {
        db.createObjectStore(DRAFT_STORE_NAME, { keyPath: 'projectId' })
      }
    }
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('无法打开项目数据库'))
    }
    request.onblocked = () => {
      reject(new Error('项目数据库被其它页面占用'))
    }
  })
}

async function withDatabase<T>(operation: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDatabase()
  try {
    return await operation(db)
  } finally {
    db.close()
  }
}

function errorName(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name
    return typeof name === 'string' ? name : undefined
  }
  return undefined
}

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
    schemaVersion: STORAGE_SCHEMA_VERSION,
    engineVersion: input.engineVersion?.trim() || ENGINE_VERSION,
    id: newProjectId(),
    name: input.name?.trim() || '未命名项目',
    createdAt: now,
    updatedAt: now,
    working: workingValidation.value,
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
    schemaVersion: STORAGE_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    id: newProjectId(),
    name: name.trim() || '未命名项目',
    createdAt: now,
    updatedAt: now,
    working: {
      terms: [],
      target: null,
      assumptions: '',
      relationConfirmed: false,
    },
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
      const transaction = db.transaction(PROJECT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction.objectStore(PROJECT_STORE_NAME).get(id),
      )
      await done
      return value as Project | undefined
    })
    return { ok: true, value: project ?? null }
  } catch (error) {
    return storageFailure(error, '读取项目失败')
  }
}

export async function listProjects(): Promise<StorageResult<Project[]>> {
  try {
    const projects = await withDatabase(async (db) => {
      const transaction = db.transaction(PROJECT_STORE_NAME, 'readonly')
      const done = transactionDone(transaction)
      const value = await requestResult(
        transaction.objectStore(PROJECT_STORE_NAME).getAll(),
      )
      await done
      return value as Project[]
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

export async function deleteProject(id: string): Promise<StorageResult<boolean>> {
  try {
    return await withDatabase(async (db) => {
      const transaction = db.transaction(
        [PROJECT_STORE_NAME, DRAFT_STORE_NAME],
        'readwrite',
      )
      const done = transactionDone(transaction)
      try {
        const projectStore = transaction.objectStore(PROJECT_STORE_NAME)
        const existing = (await requestResult(projectStore.get(id))) as Project | undefined
        projectStore.delete(id)
        transaction.objectStore(DRAFT_STORE_NAME).delete(id)
        await done
        return { ok: true, value: existing !== undefined }
      } catch (error) {
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
 * 自动保存入口：草稿永远写入独立 drafts 表，只有通过 draftToChain 时才同步更新
 * projects.working。无效草稿只更新草稿，项目模型与 updatedAt 都保持不变。
 */
export async function saveDraft(
  projectId: string,
  draft: WorkspaceDraft,
): Promise<StorageResult<SaveDraftResult>> {
  let conversion: ReturnType<typeof draftToChain>
  try {
    conversion = draftToChain(draft)
  } catch (error) {
    return storageFailure(error, '草稿结构无效')
  }

  try {
    return await withDatabase(async (db) => {
      const transaction = db.transaction(
        [PROJECT_STORE_NAME, DRAFT_STORE_NAME],
        'readwrite',
      )
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

        let project = existing
        let modelUpdated = false
        if (conversion.ok) {
          project = {
            ...existing,
            working: conversion.chain,
            updatedAt: savedAt,
          }
          projectStore.put(project)
          modelUpdated = true
        }

        await done
        return {
          ok: true,
          value: {
            project,
            draft: storedDraft,
            modelUpdated,
            cellErrors: conversion.ok ? {} : conversion.cellErrors,
          },
        }
      } catch (error) {
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

export function exportProjectJson(project: Project): string {
  const exported: ExportedProjectJson = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    unit: PROJECT_JSON_UNIT,
    qPerMm: Q_PER_MM,
    engineVersion: project.engineVersion,
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    working: project.working,
    baseline: project.baseline,
  }
  return JSON.stringify(exported, null, 2)
}

export async function exportProject(id: string): Promise<StorageResult<string>> {
  const loaded = await getProject(id)
  if (!loaded.ok) {
    return loaded
  }
  if (loaded.value === null) {
    return failure('not_found', '项目不存在')
  }
  return { ok: true, value: exportProjectJson(loaded.value) }
}

/**
 * 导入项目。校验、重新校验和重新计算都在写库之前完成；任何拒绝都不会写数据。
 * 通过 add 而不是 put 落库，ID 冲突时自动换新 ID，不覆盖已有项目。
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
      addProjectWithUniqueId(db, parsed.value.project),
    )
    return {
      ok: true,
      value: {
        project: inserted.project,
        result: parsed.value.result,
        idChanged: inserted.idChanged,
      },
    }
  } catch (error) {
    return storageFailure(error, '导入项目失败，未写入数据')
  }
}

export const importProjectJson = importProject
