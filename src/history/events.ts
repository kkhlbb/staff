/**
 * 项目变更事件（V2.1 第二组最小实现，V2.2 第一组扩展）。
 *
 * 事件只记录“发生了什么”，不复制工程数值以外的派生结论，也不参与计算。
 * 用途：
 * - 证明来源导入、绑定新增/解除、版本处置、确认与恢复确实提交；
 * - 删除项目时与来源记录一起按项目作用域迁移，保留可追溯性；
 * - 审查侧栏与变更记录展示依据；旧事件缺字段时显示“未记录”，不补造。
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
  | 'source_binding_historical_accepted'
  | 'project_sources_retired'
  | 'project_imported'
  | 'schema_migrated_v1_to_v2'
  | 'term_symbol_changed'
  | 'term_name_changed'
  | 'term_note_changed'
  | 'term_reordered'
  | 'term_numeric_changed'
  | 'target_changed'
  | 'assumptions_changed'
  | 'project_name_changed'
  | 'relation_confirmed'
  | 'relation_confirmation_cleared'
  | 'baseline_saved'
  | 'baseline_restored'
  | 'analysis_snapshot_created'
  | 'project_restored_from_bundle'

/** 组成环数值字段的强类型变更；q 为单位 0.0001 mm 的整数。 */
export type NumericChangeField = 'nominal' | 'lower' | 'upper'

export interface NumericChange {
  field: NumericChangeField
  beforeQ: number
  afterQ: number
}

/**
 * 变更事件。
 *
 * before/after 是面向人的文本快照（例如代号、目标文本）；数值变更另用 numeric
 * 保存整数 q，避免精度损失。旧事件缺少 reason/scope/numeric 时读取方必须显示
 * “未记录”，不得推测。本记录是本地用户自述的操作痕迹，不是防篡改审计。
 */
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
  /** 数值字段变化时的强类型整数 q 前后值。 */
  numeric?: NumericChange
  /** 用户或系统给出的变更理由；旧事件没有该字段。 */
  reason?: string
  /** 历史来源接受的适用范围；只对 historical acceptance 事件有意义。 */
  scope?: string
  /** 面向人的简短说明；不包含数值结论。 */
  message?: string
}

/** 读取旧事件时字段缺失的统一显示，不做补造。 */
export const MISSING_EVENT_FIELD = '未记录'

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

/** 在调用方现有事务内写入/覆盖事件（用于同一业务键的幂等事件）。 */
export function putChangeEvent(
  transaction: IDBTransaction,
  event: ChangeEvent,
): IDBRequest<IDBValidKey> {
  return transaction.objectStore(EVENT_STORE_NAME).put(event)
}

/** 按时间排序的稳定比较，供变更列表与测试复用。 */
export function compareChangeEvents(left: ChangeEvent, right: ChangeEvent): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}
