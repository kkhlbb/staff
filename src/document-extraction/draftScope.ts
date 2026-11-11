/**
 * V3.6 多草稿：同一 PDF 版本 + 同一页范围有多个规则版本时，谁是“当前草稿”。
 *
 * 规则（任务卡「多草稿」1+3 方案）：
 * 1. 作用域 = documentId + revisionId + 页范围。只有同一作用域内的草稿才能比较新旧；
 *    不同页范围各自是独立草稿，不互相取代（扩大页范围会产生新草稿）。
 * 2. 当前草稿 = 作用域内 extractorVersion 最高者；同版本取数组中较后出现的一份
 *    （提取追加顺序即创建顺序；同一版本重复的 draftId 实际由幂等键决定，不会重复）。
 * 3. “被取代”只认严格更高的版本：同版本重复草稿都算当前，不冒充旧版；
 *    删除也只允许删严格更低版本的草稿——最新草稿永远不能删（见 deleteDraft）。
 *
 * 本模块是纯函数，不写盘、不改草稿；UI 与 main 共用同一判断，避免界面说旧、
 * 写入口却按新来处理。
 */
import type { ExtractionDraft } from './types'

/** 版本号末尾的整数；无法解析时返回 null（不猜、不按字符串大小冒充版本）。 */
export function extractorVersionNumber(version: string): number | null {
  const match = /(\d+)\s*$/.exec(version.trim())
  if (match === null) return null
  const value = Number(match[1])
  return Number.isSafeInteger(value) ? value : null
}

/** 高位版本更大的返回正数；相等返回 0；任一侧无法解析时按字符串比较（确定性）。 */
export function compareExtractorVersions(left: string, right: string): number {
  const a = extractorVersionNumber(left)
  const b = extractorVersionNumber(right)
  if (a !== null && b !== null) {
    if (a === b) return 0
    return a > b ? 1 : -1
  }
  if (left === right) return 0
  return left > right ? 1 : -1
}

/** 展示用短版本：`document-extractor-2` → `v2`；解析不出数字时原样显示。 */
export function extractorVersionLabel(version: string): string {
  const value = extractorVersionNumber(version)
  return value === null ? version : `v${value}`
}

export function draftScopeKey(draft: ExtractionDraft): string {
  return [
    draft.sourceIdentity.documentId,
    draft.sourceIdentity.revisionId,
    draft.pageRange.from,
    draft.pageRange.to,
  ].join('|')
}

function sameScope(left: ExtractionDraft, right: ExtractionDraft): boolean {
  return draftScopeKey(left) === draftScopeKey(right)
}

export interface ExtractionDraftScope {
  readonly key: string
  /** 该作用域内的全部草稿，保持项目文件里的顺序。 */
  readonly drafts: readonly ExtractionDraft[]
  /** 默认展示/可操作的草稿：版本最高（同版本取较后）。 */
  readonly current: ExtractionDraft
  /** 其余草稿：只读展示，可删除（严格低版本时）。 */
  readonly superseded: readonly ExtractionDraft[]
}

/** 按作用域分组，作用域顺序 = 该作用域第一份草稿在数组里的出现顺序。 */
export function groupExtractionDrafts(
  drafts: readonly ExtractionDraft[],
): ExtractionDraftScope[] {
  const buckets = new Map<string, ExtractionDraft[]>()
  const order: string[] = []
  for (const draft of drafts) {
    const key = draftScopeKey(draft)
    const bucket = buckets.get(key)
    if (bucket === undefined) {
      buckets.set(key, [draft])
      order.push(key)
    } else {
      bucket.push(draft)
    }
  }
  const scopes: ExtractionDraftScope[] = []
  for (const key of order) {
    const list = buckets.get(key)
    if (list === undefined) continue
    let currentIndex = 0
    for (let index = 1; index < list.length; index += 1) {
      const candidate = list[index]
      const current = list[currentIndex]
      if (candidate === undefined || current === undefined) continue
      // >= ：同版本取数组中较后的一份。
      if (compareExtractorVersions(candidate.extractorVersion, current.extractorVersion) >= 0) {
        currentIndex = index
      }
    }
    const current = list[currentIndex]
    if (current === undefined) continue
    scopes.push({
      key,
      drafts: list,
      current,
      superseded: list.filter((_, index) => index !== currentIndex),
    })
  }
  return scopes
}

/** 默认选中：第一个作用域的当前草稿；没有任何草稿时返回 null。 */
export function selectDefaultDraft(
  drafts: readonly ExtractionDraft[],
): ExtractionDraft | null {
  return groupExtractionDrafts(drafts)[0]?.current ?? null
}

/** 严格更低版本才叫“被取代”：同版本重复草稿不算旧版，不会被折叠成旧规则行。 */
export function isDraftSuperseded(
  draft: ExtractionDraft,
  drafts: readonly ExtractionDraft[],
): boolean {
  return drafts.some(
    (other) =>
      other.draftId !== draft.draftId &&
      sameScope(other, draft) &&
      compareExtractorVersions(other.extractorVersion, draft.extractorVersion) > 0,
  )
}

/** 只有被取代的草稿可删：等于“该作用域里存在严格更高版本”。 */
export function canDeleteDraft(
  draft: ExtractionDraft,
  drafts: readonly ExtractionDraft[],
): boolean {
  return isDraftSuperseded(draft, drafts)
}

/** 仍有效的确认决定数（编辑/撤销会置 invalidatedByEditRevision，不计入）。 */
export function activeConfirmedDecisionCount(draft: ExtractionDraft): number {
  return draft.decisions.filter(
    (decision) =>
      decision.action === 'confirm' && decision.invalidatedByEditRevision === null,
  ).length
}
