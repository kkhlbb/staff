/**
 * 来源相关的强类型变更事件（V2.1 第二组最小实现）。
 *
 * 事件只记录“发生了什么”，不复制工程数值，也不参与计算。用途：
 * - 证明来源导入、绑定新增/解除确实提交；
 * - 删除项目时与来源记录一起按项目作用域迁移，保留可追溯性；
 * - 为后续审查中心提供数据，但本批不提供完整历史 UI。
 *
 * 事件与对应的业务写入必须处于同一个 IndexedDB 事务：写入失败时两者一起回滚。
 */
import { EVENT_STORE_NAME } from '../storage/db'

export type ChangeEventType =
  | 'source_import'
  | 'source_binding_added'
  | 'source_binding_removed'
  | 'source_binding_reviewed'
  | 'source_binding_region_changed'
  | 'source_binding_rebound'
  | 'project_sources_retired'
  | 'project_imported'
  | 'schema_migrated_v1_to_v2'
  | 'term_symbol_changed'

export interface ChangeEvent {
  id: string
  projectId: string
  type: ChangeEventType
  /** ISO 8601 时间戳。 */
  createdAt: string
  documentId?: string
  revisionId?: string
  bindingId?: string
  termId?: string
  /** 文本字段变化时的前后值（例如组成环代号）；不复制工程数值。 */
  before?: string
  after?: string
  /** 面向人的简短说明；不包含数值结论。 */
  message?: string
}

/**
 * 事件 ID 由类型和业务主键推导，复用调用方已经生成的 ID，避免多消耗一个
 * 注入的 ID 序列。业务主键本身全局唯一，因此事件 ID 也唯一。
 */
export function changeEventId(type: ChangeEventType, subjectId: string): string {
  return `${type}:${subjectId}`
}

/** 在调用方现有事务内追加事件；调用方负责 await 事务完成。 */
export function addChangeEvent(
  transaction: IDBTransaction,
  event: ChangeEvent,
): IDBRequest<IDBValidKey> {
  return transaction.objectStore(EVENT_STORE_NAME).add(event)
}
