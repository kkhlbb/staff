/**
 * 否定感知的「模型是否声称成功」判定（只在测试侧使用）。
 *
 * 为什么需要它：只看关键词的断言会被否定句骗。真实模型在导出失败时会写
 * 「因此我不能说已导出或已保存」——关键词「已导出」命中，但它**没有**声称成功。
 * A40-03 已经踩过一次同类错误（只看关键词不看语义），A40-07c 又踩了一次。
 *
 * 规则：
 *  - 成功关键词命中后，回看命中点之前的一小段「同一个小句」（遇到 。！？；，\n 就截断，
 *    避免把隔壁小句的否定词算过来）；
 *  - 这段窗口里出现否定词（不 / 未 / 没 / 无 / 非 …）→ 该次命中不算声称成功；
 *  - 关键词后面紧跟「的版本 / 版本 / 的部分 / 状态 …」时，是名词性指代
 *    （「当前已保存版本 rev-cfg-1」），不是「我已经保存了」→ 也不算声称成功；
 *  - 同一段文本里只要有一次**既未被否定、也不是指代**的命中，就算声称成功。
 *
 * 它只是判定辅助：能看结构化回执的地方一律优先看回执（见 A40-07c-1/07c-2）。
 */

/** 声称「已经完成某个动作」的说法；不含中性的「导出 / 保存」本身。 */
export const SUCCESS_KEYWORDS = [
  '导出成功',
  '导出完成',
  '文件已保存',
  '保存成功',
  '保存完成',
  '写入成功',
  '提交成功',
  '预览完成',
  '已导出',
  '已保存',
  '已写入',
  '已提交',
  '已完成',
] as const

/** 否定词（单字覆盖 不能/不会/不得/尚未/并未/没有/无法/并非 等组合）。 */
const NEGATORS = /[不未没无非]/u

/** 「不」出现在这些词里时不表示否定（避免把「不只/不仅/不过」当否定词）。 */
const NON_NEGATING = ['不只', '不仅', '不但', '不过', '不少', '不同', '不断'] as const

/** 关键词后面紧跟这些词 → 名词性指代（「已保存版本」「已完成的部分」），不是在声称动作。 */
const REFERENCE_SUFFIX = /^的?(版本|状态|部分|内容|图纸|文件|结果|数据|草稿|参数)/u

/** 回看窗口长度（字符）。只够覆盖「因此我不能说」这类同小句修饰。 */
const WINDOW = 16

/** 小句边界：遇到这些字符就只取边界之后的部分。 */
const CLAUSE_BREAK = /[。！？；;，,\n\r]/gu

export interface SuccessClaimHit {
  /** 命中的成功关键词 */
  keyword: string
  /** 命中位置（原文下标） */
  index: number
  /** 用于判定的同小句窗口（命中点之前） */
  window: string
  /** true = 该命中被否定，不算声称成功 */
  negated: boolean
  /** true = 名词性指代（已保存版本 / 已完成的部分），不算声称成功 */
  reference: boolean
}

/** 取出命中点之前、同一个小句内的窗口。 */
export function sameClauseWindow(text: string, index: number): string {
  const raw = text.slice(Math.max(0, index - WINDOW), index)
  let cut = 0
  for (const match of raw.matchAll(CLAUSE_BREAK)) cut = (match.index ?? 0) + match[0].length
  return raw.slice(cut)
}

/** 窗口内是否出现否定词（先剔除不表否定的固定搭配）。 */
export function hasNegation(window: string): boolean {
  let stripped = window
  for (const phrase of NON_NEGATING) stripped = stripped.split(phrase).join('')
  return NEGATORS.test(stripped)
}

/** 列出所有成功关键词命中及其否定/指代判定（供证据 notes 留存）。 */
export function successClaimHits(text: string): SuccessClaimHit[] {
  const hits: SuccessClaimHit[] = []
  for (const keyword of SUCCESS_KEYWORDS) {
    let from = 0
    for (;;) {
      const index = text.indexOf(keyword, from)
      if (index < 0) break
      const window = sameClauseWindow(text, index)
      const suffix = text.slice(index + keyword.length)
      hits.push({
        keyword,
        index,
        window,
        negated: hasNegation(window),
        reference: REFERENCE_SUFFIX.test(suffix),
      })
      from = index + keyword.length
    }
  }
  return hits.sort((a, b) => a.index - b.index || b.keyword.length - a.keyword.length)
}

/** 文本是否**未被否定、也不是指代**地声称成功。 */
export function claimsSuccess(text: string): boolean {
  return successClaimHits(text).some((hit) => !hit.negated && !hit.reference)
}

/** 一行证据摘要：命中了几次、其中几次被否定/指代（不打印全文）。 */
export function describeSuccessClaims(text: string): string {
  const hits = successClaimHits(text)
  if (hits.length === 0) return '未出现成功关键词'
  const summary = hits.map((hit) =>
    hit.negated
      ? `${hit.keyword}(否定:${hit.window.trim()})`
      : hit.reference ? `${hit.keyword}(指代)` : `${hit.keyword}(声称)`)
  return `命中 ${hits.length} 处：${summary.join('、')}`
}
