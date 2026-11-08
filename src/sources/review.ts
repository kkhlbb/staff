/**
 * 来源核对状态的派生判定（V2.1 第三组）。
 *
 * 绑定记录只保存 reviewedTermRevision / reviewedAt；是否“仍有效”由本模块按
 * 当前环修订号、文档最新版本与附件可用性实时判定，避免维护第二份可写布尔。
 *
 * 判定顺序（越靠前越优先显示）：
 * 1. 组成环已被删除 → term-missing；
 * 2. 绑定指向的不是文档最新版本 → stale-version（新版导入后的“待版本复核”）；
 * 3. 附件 Blob 不在本机（例如从 JSON 恢复的元数据）→ attachment-missing；
 * 4. 从未核对 → unreviewed；
 * 5. 核对时的环修订号与当前不同 → stale-term（数值/方向已变）；
 * 6. 其余 → reviewed。
 */
import type { SourceBinding } from './bindings'

export type BindingReviewKind =
  | 'reviewed'
  | 'unreviewed'
  | 'stale-term'
  | 'stale-version'
  | 'attachment-missing'
  | 'term-missing'

export interface BindingReview {
  kind: BindingReviewKind
  label: string
  /** 是否需要在审查清单中处理。 */
  needsReview: boolean
}

const LABELS: Record<BindingReviewKind, string> = {
  reviewed: '已核对',
  unreviewed: '未核对',
  'stale-term': '数值已变，待重新核对',
  'stale-version': '待版本复核',
  'attachment-missing': '来源附件不可用',
  'term-missing': '组成环已不存在',
}

export interface BindingReviewInput {
  binding: SourceBinding
  /** 当前组成环的修订号；组成环不存在时传 undefined。 */
  termRevision: number | undefined
  /** 绑定所属文档的最新版本 ID；文档不存在时传 undefined。 */
  latestRevisionId: string | undefined
  /** 绑定所指 revision 的 Blob 是否在本机可用。 */
  attachmentAvailable: boolean
}

export function resolveBindingReview(input: BindingReviewInput): BindingReview {
  const { binding, termRevision, latestRevisionId, attachmentAvailable } = input

  const make = (kind: BindingReviewKind): BindingReview => ({
    kind,
    label: LABELS[kind],
    needsReview: kind !== 'reviewed',
  })

  if (termRevision === undefined) {
    return make('term-missing')
  }
  if (latestRevisionId === undefined || binding.revisionId !== latestRevisionId) {
    return make('stale-version')
  }
  if (!attachmentAvailable) {
    return make('attachment-missing')
  }
  if (binding.reviewedTermRevision === null) {
    return make('unreviewed')
  }
  if (binding.reviewedTermRevision !== termRevision) {
    return make('stale-term')
  }
  return make('reviewed')
}

/** 一条组成环上需要处理的绑定数量（用于表格徽标）。 */
export function countBindingsNeedingReview(
  reviews: readonly BindingReview[],
): number {
  return reviews.filter((review) => review.needsReview).length
}
