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
 * 不清空已有数据。bindings / events 等绑定与事件 store 在实现对应功能时再
 * 追加，不在本组提前建空表。
 */
export const PROJECT_DB_NAME = 'shaft-tolerance-chain'
export const PROJECT_DB_VERSION = 4

export const PROJECT_STORE_NAME = 'projects'
export const DRAFT_STORE_NAME = 'drafts'
export const MAPPING_TEMPLATE_STORE_NAME = 'mappingTemplates'
export const IMPORT_SNAPSHOT_STORE_NAME = 'importSnapshots'
export const SOURCE_DOCUMENT_STORE_NAME = 'sourceDocuments'
export const SOURCE_REVISION_STORE_NAME = 'sourceRevisions'
export const SOURCE_BLOB_STORE_NAME = 'sourceBlobs'

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

export function openDatabase(): Promise<IDBDatabase> {
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
