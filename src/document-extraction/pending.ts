/**
 * V3.6 体验补丁：项目文件中未决提取候选的汇总。
 *
 * 只读 `project.extractionDrafts`（随项目文件持久化，schema8），不读会话内存、
 * 不看面板状态；计数不触发任何提取/确认动作，也不展开任何面板。
 *
 * 语义：一条草稿内 pending / blocked 都是“未决”；confirmed / rejected / stale
 * 已处理完，不计入。多份草稿（不同页范围）逐份累加，因为入口角标面向整个项目。
 */
import type { ExtractionDraft } from './types'

export interface ExtractionPendingCounts {
  readonly pending: number
  readonly blocked: number
  /** pending + blocked；0 表示没有未决候选。 */
  readonly total: number
}

export function countPendingExtractionCandidates(
  drafts: readonly ExtractionDraft[],
): ExtractionPendingCounts {
  let pending = 0
  let blocked = 0
  for (const draft of drafts) {
    for (const candidate of draft.candidates) {
      if (candidate.status === 'pending') pending += 1
      else if (candidate.status === 'blocked') blocked += 1
    }
  }
  return { pending, blocked, total: pending + blocked }
}

/** 入口角标短文本（与提取页计数行同序）；没有未决项时返回 null，不显示 0 或空徽标。 */
export function pendingExtractionBadgeLabel(counts: ExtractionPendingCounts): string | null {
  const out: string[] = []
  if (counts.pending > 0) out.push(`待确认 ${counts.pending}`)
  if (counts.blocked > 0) out.push(`阻塞 ${counts.blocked}`)
  return out.length === 0 ? null : out.join(' · ')
}

/** 一句话说明，用于 title / aria-describedby。 */
export function pendingExtractionBadgeTitle(counts: ExtractionPendingCounts): string | null {
  const out: string[] = []
  if (counts.pending > 0) out.push(`${counts.pending} 待确认`)
  if (counts.blocked > 0) out.push(`${counts.blocked} 阻塞`)
  return out.length === 0
    ? null
    : `有 ${counts.total} 项提取候选待处理（${out.join('、')}）`
}
