/**
 * 项目数据库的共享打开逻辑。
 *
 * V2.0 只在同一 IndexedDB 中增加独立的 mappingTemplates store，不改变项目
 * JSON 的 schemaVersion。数据库版本从 1 升到 2 时只创建缺失的 store，
 * 已有 projects / drafts 数据保持原样。
 *
 * 替换导入需要“操作前快照”（规格 §4.2）：importSnapshots 保存被替换前的
 * 完整工作方案，且与 projects / drafts 在同一事务写入。该 store 与 V2.2 的
 * AnalysisSnapshot（snapshots）不是同一概念。数据库版本因此升到 3。
 *
 * V2.1 第一组新增本地 PDF 来源底座：sourceDocuments / sourceRevisions /
 * sourceBlobs。版本升到 4；升级逻辑始终只创建缺失 store 和索引，不重建、
 * 不清空已有数据。
 *
 * V2.1 第二组新增 bindings / events：一条组成环可有多个来源区域绑定，绑定只
 * 保存 revisionId、页码、PDF 坐标（page.view 四元组）与备注，不保存数值或
 * 确认结论；events 记录来源导入、绑定新增/解除等变更，供后续审查与删除项目
 * 时确定归属。版本升到 5。
 *
 * V2.1 第三组把项目 schema 升到 v2（termRevision、关系确认凭据），本地 V1
 * 项目首次升级前必须保留原始记录：新增 migrationBackups（keyPath=id，
 * index=projectId），与迁移后的 projects/drafts 在同一个事务写入，失败一起
 * 回滚。数据库版本升到 6。数据库版本（6）与项目 JSON schemaVersion（2）
 * 是两回事，不能混用。
 *
 * 升级只增补缺失的 store / index，绝不重建或清空。库一旦升到 v6，指定更低
 * 版本的旧前端打开会得到 VersionError；部署回滚不能只回退前端，更不能删库降级。
 */
export const PROJECT_DB_NAME = 'shaft-tolerance-chain'
export const PROJECT_DB_VERSION = 6

export const PROJECT_STORE_NAME = 'projects'
export const DRAFT_STORE_NAME = 'drafts'
export const MAPPING_TEMPLATE_STORE_NAME = 'mappingTemplates'
export const IMPORT_SNAPSHOT_STORE_NAME = 'importSnapshots'
export const SOURCE_DOCUMENT_STORE_NAME = 'sourceDocuments'
export const SOURCE_REVISION_STORE_NAME = 'sourceRevisions'
export const SOURCE_BLOB_STORE_NAME = 'sourceBlobs'
export const BINDING_STORE_NAME = 'bindings'
export const EVENT_STORE_NAME = 'events'
export const MIGRATION_BACKUP_STORE_NAME = 'migrationBackups'

interface StoreDefinition {
  name: string
  keyPath: string
  indexes: string[]
}

const STORE_DEFINITIONS: StoreDefinition[] = [
  { name: PROJECT_STORE_NAME, keyPath: 'id', indexes: [] },
  { name: DRAFT_STORE_NAME, keyPath: 'projectId', indexes: [] },
  { name: MAPPING_TEMPLATE_STORE_NAME, keyPath: 'id', indexes: [] },
  { name: IMPORT_SNAPSHOT_STORE_NAME, keyPath: 'id', indexes: ['projectId'] },
  { name: SOURCE_DOCUMENT_STORE_NAME, keyPath: 'id', indexes: ['projectId'] },
  {
    name: SOURCE_REVISION_STORE_NAME,
    keyPath: 'id',
    indexes: ['projectId', 'documentId'],
  },
  { name: SOURCE_BLOB_STORE_NAME, keyPath: 'blobKey', indexes: ['projectId'] },
  {
    name: BINDING_STORE_NAME,
    keyPath: 'id',
    indexes: ['projectId', 'termId', 'revisionId'],
  },
  {
    name: EVENT_STORE_NAME,
    keyPath: 'id',
    indexes: ['projectId', 'createdAt'],
  },
  {
    name: MIGRATION_BACKUP_STORE_NAME,
    keyPath: 'id',
    indexes: ['projectId'],
  },
]

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB 请求失败'))
    }
  })
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
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

export interface OpenDatabaseOptions {
  /** 仅供测试注入；默认使用 PROJECT_DB_NAME。 */
  name?: string
  /** 仅供测试注入；默认使用 PROJECT_DB_VERSION。 */
  version?: number
  /** 打开请求长时间没有任何事件时的兜底超时；默认 15 秒。 */
  timeoutMs?: number
}

/** 浏览器未派发 blocked 时的兜底：超过该时间仍无 success/error 就按“被占用”提示。 */
export const OPEN_DATABASE_TIMEOUT_MS = 15_000

export type DatabaseErrorCode = 'database_too_new' | 'database_blocked'

/**
 * 库的版本比当前页面程序请求的高。IndexedDB 会抛 VersionError；旧前端无法
 * 通过“回退代码”继续使用已升级的库，也不允许删库降级。
 */
export class DatabaseVersionError extends Error {
  readonly code = 'database_too_new' as const

  constructor(message: string) {
    super(message)
    this.name = 'DatabaseVersionError'
  }
}

/** 升级被其它标签页的旧连接挡住；本次打开失败，但阻塞解除后升级仍会完成。 */
export class DatabaseBlockedError extends Error {
  readonly code = 'database_blocked' as const

  constructor(message: string) {
    super(message)
    this.name = 'DatabaseBlockedError'
  }
}

/** 跨 realm 的 DOMException 不能只靠 instanceof；名称在两种情况下都保留。 */
export function databaseErrorCode(error: unknown): DatabaseErrorCode | undefined {
  if (error instanceof DatabaseVersionError) {
    return error.code
  }
  if (error instanceof DatabaseBlockedError) {
    return error.code
  }
  const name = errorName(error)
  if (name === 'DatabaseVersionError' || name === 'VersionError') {
    return 'database_too_new'
  }
  if (name === 'DatabaseBlockedError') {
    return 'database_blocked'
  }
  return undefined
}

export interface DatabaseVersionChangeInfo {
  /** 本页连接原先的版本。 */
  oldVersion: number
  /** 其它页面请求的新版本；deleteDatabase 时为 null。 */
  newVersion: number | null
}

const versionChangeListeners = new Set<
  (info: DatabaseVersionChangeInfo) => void
>()

/**
 * 订阅“其它标签页正在升级/删除数据库”。本页收到 versionchange 后会立即
 * 关闭旧连接（否则会阻塞对方），并通知 UI 明确提示刷新；旧代码没有这个
 * 处理器时只能显示浏览器原始错误，因此部署时必须同时更新所有页面。
 */
export function subscribeDatabaseVersionChange(
  listener: (info: DatabaseVersionChangeInfo) => void,
): () => void {
  versionChangeListeners.add(listener)
  return () => {
    versionChangeListeners.delete(listener)
  }
}

function notifyDatabaseVersionChange(info: DatabaseVersionChangeInfo): void {
  for (const listener of versionChangeListeners) {
    try {
      listener(info)
    } catch {
      // 单个界面回调失败不影响数据库连接处理。
    }
  }
}

export function openDatabase(
  options: OpenDatabaseOptions = {},
): Promise<IDBDatabase> {
  const name = options.name ?? PROJECT_DB_NAME
  const version = options.version ?? PROJECT_DB_VERSION
  const timeoutMs = options.timeoutMs ?? OPEN_DATABASE_TIMEOUT_MS
  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const clearTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }

    /**
     * 打开请求被 blocked 后，阻塞解除时升级仍会完成并触发 onsuccess。
     * 此时必须立刻关闭这条没人接收的连接，否则它会一直占着数据库版本，
     * 之后的升级或 deleteDatabase 都会被它 blocked。
     */
    const closeLateConnection = () => {
      try {
        request.result.close()
      } catch {
        // 请求未成功（result 不可用）或连接已关闭：无需处理。
      }
    }
    const settleError = (error: unknown) => {
      clearTimer()
      if (settled) {
        closeLateConnection()
        return
      }
      settled = true
      reject(error)
    }

    try {
      request = indexedDB.open(name, version)
    } catch (error) {
      if (databaseErrorCode(error) === 'database_too_new') {
        reject(
          new DatabaseVersionError(
            `本地数据库版本高于当前页面请求的 v${version}。请刷新页面加载最新程序；` +
              '不要删除数据库或降级，回退前端不能打开已升级的库。',
          ),
        )
        return
      }
      reject(error)
      return
    }

    // Chrome 在部分 blocked 场景不会派发 onblocked（实测：旧连接无 versionchange
    // 处理器时，打开请求一直挂起）。没有这个兜底，界面会永远停在“正在加载”。
    timer = setTimeout(() => {
      settleError(
        new DatabaseBlockedError(
          '打开本地数据库长时间没有完成，通常是被其它标签页的旧连接挡住。' +
            '请关闭或刷新其它标签页后重试；升级完成前不要继续在旧页面输入。',
        ),
      )
    }, timeoutMs)

    request.onupgradeneeded = () => {
      const db = request.result
      for (const definition of STORE_DEFINITIONS) {
        let store: IDBObjectStore
        if (!db.objectStoreNames.contains(definition.name)) {
          store = db.createObjectStore(definition.name, {
            keyPath: definition.keyPath,
          })
        } else {
          const existing = request.transaction?.objectStore(definition.name)
          if (existing === undefined) {
            continue
          }
          store = existing
        }
        for (const indexName of definition.indexes) {
          if (!store.indexNames.contains(indexName)) {
            store.createIndex(indexName, indexName)
          }
        }
      }
    }
    request.onsuccess = () => {
      clearTimer()
      if (settled) {
        closeLateConnection()
        return
      }
      const db = request.result
      // 其它标签页升级时先关闭本页旧连接，避免把对方挡住；UI 订阅后提示刷新。
      db.onversionchange = (event) => {
        const info: DatabaseVersionChangeInfo = {
          oldVersion: db.version,
          newVersion: event.newVersion ?? null,
        }
        try {
          db.close()
        } catch {
          // 连接可能已关闭。
        }
        notifyDatabaseVersionChange(info)
      }
      settled = true
      resolve(db)
    }
    request.onerror = () => {
      const error = request.error
      if (databaseErrorCode(error) === 'database_too_new') {
        settleError(
          new DatabaseVersionError(
            `本地数据库版本高于当前页面请求的 v${version}。请刷新页面加载最新程序；` +
              '不要删除数据库或降级，回退前端不能打开已升级的库。',
          ),
        )
        return
      }
      settleError(error ?? new Error('无法打开项目数据库'))
    }
    request.onblocked = () => {
      settleError(
        new DatabaseBlockedError(
          '项目数据库正被其它标签页占用，本次升级没有完成。' +
            '请关闭或刷新其它标签页后重试；阻塞解除后升级仍会继续，稍后重新打开即可。',
        ),
      )
    }
  })
}

/** 版本探测的兜底超时；探测只读，不能因为长期挂起拖住焦点切换。 */
export const DATABASE_VERSION_PROBE_TIMEOUT_MS = 3_000

type DatabasesApi = IDBFactory & {
  databases?: () => Promise<IDBDatabaseInfo[]>
}

/**
 * 不带版本号打开数据库，读到实际版本后立即关闭。
 *
 * 只用于“不知道库是否已被其它标签页升级”的探测：不运行建表/迁移逻辑，
 * 也不把打开失败当成版本过旧。数据库不存在时浏览器会建一个空的 v1 库；
 * 随后正常启动仍会按 PROJECT_DB_VERSION 升级，不会丢数据。
 */
function openAndReadVersion(
  name: string,
  timeoutMs: number,
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    let request: IDBOpenDBRequest
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (version: number | null): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      resolve(version)
    }
    const closeQuietly = (): void => {
      try {
        request.result.close()
      } catch {
        // 请求未成功（result 不可用）或连接已关闭。
      }
    }

    try {
      request = indexedDB.open(name)
    } catch {
      resolve(null)
      return
    }

    timer = setTimeout(() => {
      closeQuietly()
      finish(null)
    }, timeoutMs)

    // 数据库不存在时会走到这里；探测不创建 store，正常启动会再升级。
    request.onupgradeneeded = () => undefined
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        try {
          db.close()
        } catch {
          // 连接可能已关闭。
        }
      }
      const version = db.version
      db.close()
      finish(settled ? null : version)
    }
    request.onerror = () => finish(null)
    request.onblocked = () => finish(null)
  })
}

/**
 * 便宜地探测当前数据库的实际版本，不写任何数据。
 *
 * 优先使用 IndexedDB.databases()：它不打开连接，也不会和升级请求互相阻塞。
 * 浏览器不支持时才退回不带版本号的 open()。返回 null 表示“探测不到”，
 * 调用方不能把 null 当成“版本过旧”。
 */
export async function probeDatabaseVersion(
  options: { name?: string; timeoutMs?: number } = {},
): Promise<number | null> {
  const name = options.name ?? PROJECT_DB_NAME
  const timeoutMs = options.timeoutMs ?? DATABASE_VERSION_PROBE_TIMEOUT_MS
  const factory = indexedDB as DatabasesApi
  if (typeof factory.databases === 'function') {
    try {
      const databases = await factory.databases()
      const found = databases.find((database) => database.name === name)
      return found?.version ?? null
    } catch {
      // 隐私模式或实现限制：退回打开的探测方式。
    }
  }
  return openAndReadVersion(name, timeoutMs)
}

export async function withDatabase<T>(
  operation: (db: IDBDatabase) => Promise<T>,
): Promise<T> {
  const db = await openDatabase()
  try {
    return await operation(db)
  } finally {
    db.close()
  }
}

export function errorName(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name
    return typeof name === 'string' ? name : undefined
  }
  return undefined
}
