/**
 * 失效事件矩阵（规格 §6.2）的唯一声明。
 *
 * 表驱动的纯数据 + 判定函数，供：
 * - 领域命令实现时对照（saveDraft / 绑定命令 / 导入 / 恢复）；
 * - 测试逐行断言实际行为与声明一致；
 * - 审查侧栏解释“为什么这一项失效了”。
 *
 * 声明本身不执行失效；真正的失效由 workspaceReducer、绑定命令和事务写入完成。
 * 任何实现与这里不一致都应当视为缺陷，而不是修改本表来迁就实现。
 */
import type { ChangeEventType } from '../history/events'

export type InvalidationKind =
  | 'term-numeric'
  | 'term-structure'
  | 'target'
  | 'term-symbol'
  | 'term-text'
  | 'term-reorder'
  | 'binding-region'
  | 'binding-rebind'
  | 'source-new-version'
  | 'local-refresh'
  | 'external-import'
  | 'baseline-restore'
  | 'snapshot-restore'

/** 关系确认在事件后的状态。 */
export type RelationEffect = 'kept' | 'invalidated' | 'rebuilt'

/** 来源数值核对在事件后的状态。 */
export type TermReviewEffect =
  | 'kept'
  | 'invalidated-affected-terms'
  | 'invalidated-this-binding'
  | 'pending-new-version'
  | 'rebuilt'

export interface InvalidationEffects {
  /** 是否需要重新计算数值。 */
  recalculates: boolean
  relation: RelationEffect
  termValueReview: TermReviewEffect
  /** 工作版本变化是否使既有 AnalysisSnapshot 变为历史（第二组）。 */
  marksSnapshotsHistorical: boolean
  /** 必须记录的变更事件（旧事件缺字段时显示“未记录”）。 */
  recordsEvents: readonly ChangeEventType[]
  /** 规格原文摘要，供界面解释。 */
  note: string
}

/** 逐行对应规格 §6.2 的九类事件（数值与结构拆成两行，便于实现区分）。 */
export const INVALIDATION_MATRIX: Record<InvalidationKind, InvalidationEffects> = {
  'term-numeric': {
    recalculates: true,
    relation: 'invalidated',
    termValueReview: 'invalidated-affected-terms',
    marksSnapshotsHistorical: true,
    recordsEvents: ['term_numeric_changed'],
    note: '修改基本尺寸/上下偏差：重算；关系确认失效；只有受影响环的来源数值核对失效。',
  },
  'term-structure': {
    recalculates: true,
    relation: 'invalidated',
    termValueReview: 'kept',
    marksSnapshotsHistorical: true,
    recordsEvents: [],
    note: '增删组成环或改方向：重算并递增关系修订；删除后再加入不复活旧凭据。',
  },
  target: {
    recalculates: true,
    relation: 'kept',
    termValueReview: 'kept',
    marksSnapshotsHistorical: true,
    recordsEvents: ['target_changed'],
    note: '修改目标：重新判定；来源核对与关系确认保留；旧分析快照变为历史。',
  },
  'term-symbol': {
    recalculates: true,
    relation: 'invalidated',
    termValueReview: 'kept',
    marksSnapshotsHistorical: true,
    recordsEvents: ['term_symbol_changed'],
    note: '修改代号：更新表达式；关系确认失效；来源数值核对保留，记录名称变化。',
  },
  'term-text': {
    recalculates: false,
    relation: 'kept',
    termValueReview: 'kept',
    marksSnapshotsHistorical: true,
    recordsEvents: ['term_name_changed', 'term_note_changed'],
    note: '修改名称/备注：记录变更；不清除数值核对与关系确认；旧快照内容不变。',
  },
  'term-reorder': {
    recalculates: false,
    relation: 'kept',
    termValueReview: 'kept',
    marksSnapshotsHistorical: true,
    recordsEvents: ['term_reordered'],
    note: '调整行顺序：记录变更；关系指纹与数值核对均保留。',
  },
  'binding-region': {
    recalculates: false,
    relation: 'kept',
    termValueReview: 'invalidated-this-binding',
    marksSnapshotsHistorical: true,
    recordsEvents: ['source_binding_region_changed'],
    note: '修改绑定区域：只清该绑定的核对；不改数值，不影响其他绑定。',
  },
  'binding-rebind': {
    recalculates: false,
    relation: 'kept',
    termValueReview: 'invalidated-this-binding',
    marksSnapshotsHistorical: true,
    recordsEvents: ['source_binding_rebound'],
    note: '更换关联来源：只清该绑定核对与旧版接受；不改数值。',
  },
  'source-new-version': {
    recalculates: false,
    relation: 'kept',
    termValueReview: 'pending-new-version',
    marksSnapshotsHistorical: true,
    recordsEvents: ['source_import'],
    note: '同文档导入新版：旧版本不可变；引用旧版的当前绑定待版本处置，不自动迁移坐标或数值。',
  },
  'local-refresh': {
    recalculates: false,
    relation: 'kept',
    termValueReview: 'kept',
    marksSnapshotsHistorical: false,
    recordsEvents: [],
    note: '本地刷新：当前数据与有效确认保留；不能每次刷新重复清确认。',
  },
  'external-import': {
    recalculates: true,
    relation: 'rebuilt',
    termValueReview: 'rebuilt',
    marksSnapshotsHistorical: false,
    recordsEvents: ['project_imported'],
    note: '外部 JSON/ZIP 导入：重新校验重算；所有当前人工确认重建，不信外部已确认字段。',
  },
  'baseline-restore': {
    recalculates: true,
    relation: 'rebuilt',
    termValueReview: 'rebuilt',
    marksSnapshotsHistorical: true,
    recordsEvents: ['baseline_restored'],
    note: '恢复基线：作为新工作版本；历史原样保留；当前人工确认重建，版本不回退。',
  },
  'snapshot-restore': {
    recalculates: true,
    relation: 'rebuilt',
    termValueReview: 'rebuilt',
    marksSnapshotsHistorical: true,
    recordsEvents: ['analysis_snapshot_created'],
    note: '从历史恢复：只生成新工作版本，不覆盖旧快照；当前人工确认重建。',
  },
}

export function effectsOf(kind: InvalidationKind): InvalidationEffects {
  return INVALIDATION_MATRIX[kind]
}

/** 该事件是否使指定的来源数值核对失效。 */
export function invalidatesTermReview(
  kind: InvalidationKind,
  termId: string,
  affectedTermIds: readonly string[],
): boolean {
  const effect = INVALIDATION_MATRIX[kind].termValueReview
  if (effect === 'invalidated-affected-terms') {
    return affectedTermIds.includes(termId)
  }
  return effect === 'rebuilt'
}
