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
  | 'parameter_changed'
  | 'parameter_binding_added'
  | 'parameter_binding_removed'
  | 'parameter_binding_confirmed'
  | 'project_revision_committed'
  | 'project_restored_from_revision'
  | 'requirement_confirmed'
  | 'analysis_snapshot_created'
  | 'project_restored_from_bundle'
  | 'project_migrated_from_v2'

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
  /* ---- D：参数绑定确认凭据（只对相应事件类型有意义） ---------------- */
  parameterId?: string
  parameterRevision?: number
  termRevision?: number
  drawingId?: string
  drawingFingerprint?: string
  /** 来源基准摘要（来源清单稳定指纹 + 参数来源备注）；来源变化即失配。 */
  sourceBasis?: string
  /** 提交版本 ID；由同次原子提交写入，便于回查。 */
  revisionIdAtCommit?: string
  /* ---- V3.5：任务书条款确认事件（只对 requirement_confirmed 有意义） -- */
  requirementId?: string
  requirementRevisionId?: string
  parentRevisionId?: string | null
  lowerQ?: number
  upperQ?: number
  /** 原文的稳定摘要；事件不复制整段原文。 */
  confirmedTextDigest?: string
  sourceRevisionId?: string
  sourceSha256?: string
  checkId?: string
  checkStatus?: string
}

/** 读取旧事件时字段缺失的统一显示，不做补造。 */
export const MISSING_EVENT_FIELD = '未记录'

/**
 * 事件业务键：由类型和业务主键推导，复用调用方已经生成的 ID。
 *
 * 它只保证「同一业务键得到同一个键」，用于幂等写入（`putChangeEvent`）与排障阅读；
 * **不保证唯一**：调用方常把毫秒级时间戳拼进 subject（如 `${bindingId}:${reviewedAt}`），
 * 同一实体在同一毫秒内发生两次操作会得到同一个键。需要「每次写入都必须独立成条」
 * 的地方一律走 `addChangeEvent`，由它在业务键后追加写入序号。
 */
export function changeEventId(type: ChangeEventType, subjectId: string): string {
  return `${type}:${subjectId}`
}

/**
 * 写入序号空间：本模块实例（一个页面/一个标签页/一个测试文件）持有一段独立序号，
 * 避免两个 JS 上下文在同一毫秒分配到同一个 ID。
 */
const EVENT_ID_SESSION_TAG = Math.floor(Math.random() * 36 ** 4)
  .toString(36)
  .padStart(4, '0')
let eventIdSequence = 0

/**
 * 追加写入专用 ID = 业务键 + `#` + 会话段(4) + 单调序号(8，十进制零填充)。
 *
 * - 同一业务键在同一毫秒内写两次 → 序号不同 → 两条事件都成功写入；
 * - 序号零填充定长，同一 `createdAt` 下仍按写入顺序稳定排序（`compareChangeEvents`）；
 * - 幂等 put 路径不使用本函数，覆盖语义不受影响。
 */
export function uniqueChangeEventId(baseId: string): string {
  eventIdSequence += 1
  return `${baseId}#${EVENT_ID_SESSION_TAG}${String(eventIdSequence).padStart(8, '0')}`
}

/**
 * 在调用方现有事务内**追加**事件；每次调用都分配独立 ID，同一业务键重复追加不会撞主键。
 * 调用方负责 await 事务完成。
 */
export function addChangeEvent(
  transaction: IDBTransaction,
  event: ChangeEvent,
): IDBRequest<IDBValidKey> {
  return transaction
    .objectStore(EVENT_STORE_NAME)
    .add({ ...event, id: uniqueChangeEventId(event.id) })
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
