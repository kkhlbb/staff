/**
 * V3.6 阶段 1：PDF 文本层 → 行/片段 → 出处矩形（纯函数，不读文件、不碰 pdfjs）。
 *
 * 为什么不直接字符串匹配每条 TextItem：真实任务书的文本层是逐字/逐词拆碎的
 * （本仓库固定样例里 "52.20"、"+0.02"、"总"/"长" 都是独立 item），必须先按
 * 基线 y 组装成行、按 x 排序，才能稳定匹配“符号 名称 基本尺寸 上偏差 下偏差”。
 *
 * 康熙部首坑：Chromium/PingFang 生成的 PDF，ToUnicode 会把部分汉字映射到康熙部首
 * 码位（⽂/⻚/⽤/⼀/⼨/⻓/⾯/⽑）。这里对每个 item 做 Unicode NFKC 归一，而不是
 * 硬编码替换某几个字：NFKC 覆盖全部康熙部首（U+2F00–U+2FDF）与 CJK 部首补充区
 * （U+2E80–U+2EFF）。原文（归一前）始终原样保留，用于出处片段与审计。
 */
import {
  normalizePdfPageBox,
  type PdfPageBox,
  type PdfRect,
} from '../sources/pdfCoordinates'
import { CJK_RADICAL_TO_IDEOGRAPH } from './cjkRadicals'

const RADICAL_CODE_POINTS = Object.keys(CJK_RADICAL_TO_IDEOGRAPH).map((key) => Number(key))
const RADICAL_TEST_PATTERN = new RegExp(
  `[${RADICAL_CODE_POINTS.map((codePoint) => String.fromCodePoint(codePoint)).join('')}]`,
  'u',
)
const RADICAL_REPLACE_PATTERN = new RegExp(
  `[${RADICAL_CODE_POINTS.map((codePoint) => String.fromCodePoint(codePoint)).join('')}]`,
  'gu',
)

/** pdfjs TextItem 里本层需要的字段；不依赖 pdfjs 类型，便于纯数据测试。 */
export interface RawPdfTextItem {
  readonly str: string
  readonly transform: readonly number[]
  readonly width: number
  readonly height: number
  readonly hasEOL?: boolean
}

export interface RawPdfTextPage {
  readonly page: number
  /** page.view（未旋转 PDF 点），允许非零/负原点。 */
  readonly view: readonly number[]
  readonly items: readonly RawPdfTextItem[]
}

export interface PdfTextItem {
  readonly text: string
  readonly normalizedText: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly itemIndex: number
  /** transform/宽高是否可用于生成选区；false 时该 item 不能作为出处。 */
  readonly hasGeometry: boolean
}

export interface TextLineSpan {
  readonly start: number
  readonly end: number
  readonly itemIndex: number
}

export interface PdfTextLine {
  readonly page: number
  readonly y: number
  readonly rawText: string
  readonly normalizedText: string
  readonly items: readonly PdfTextItem[]
  /** normalizedText 中每个 item 占的区间，用于把正则命中映射回具体 item。 */
  readonly spans: readonly TextLineSpan[]
  readonly rectPdf: PdfRect | null
}

export interface PdfTextPage {
  readonly page: number
  readonly pageBoxPdf: PdfPageBox | null
  readonly items: readonly PdfTextItem[]
  readonly lines: readonly PdfTextLine[]
}

export interface PdfTextLayer {
  readonly pages: readonly PdfTextPage[]
}

/** 同一行基线的判定容差（PDF 点）。 */
export const LINE_Y_TOLERANCE = 1.5
/** 选中矩形的下沿相对基线的保守外扩比例（取字形下伸部）。 */
const DESCENT_RATIO = 0.25
/** 选中矩形的上沿相对基线的保守外扩比例（取整字高）。 */
const ASCENT_RATIO = 1

/**
 * 归一化：Unicode NFKC + CJK 部首补充区（U+2E80–U+2EFF）官方映射。
 *
 * 为什么不能只做 NFKC：NFKC 的兼容分解只覆盖康熙部首区（U+2F00–U+2FDF），
 * U+2ED3 ⻓ / U+2EDA ⻚ 这类“CJK 部首补充区”字符 NFKC 后原样保留。真实任务书
 * 文本层（Chromium + PingFang）正会产出这些码位。这里按 UCD CJKRadicals.txt
 * 全量映射该区段，而不是按文件硬编码某几个字。
 *
 * 不做别的替换（不删空格、不改数字、不猜字符）。
 */
export function normalizeExtractionText(text: string): string {
  const nfkc = text.normalize('NFKC')
  if (!RADICAL_TEST_PATTERN.test(nfkc)) return nfkc
  return nfkc.replace(RADICAL_REPLACE_PATTERN, (character) => {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined) return character
    return CJK_RADICAL_TO_IDEOGRAPH[codePoint] ?? character
  })
}

/** 是否为康熙部首 / CJK 部首补充区码位（用于单一断言：归一后必须消失）。 */
export function isRadicalCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x2eff) ||
    (codePoint >= 0x2f00 && codePoint <= 0x2fdf)
  )
}

function toItem(raw: RawPdfTextItem, itemIndex: number): PdfTextItem {
  const transform = raw.transform
  const x = transform.length >= 6 ? transform[4] : Number.NaN
  const y = transform.length >= 6 ? transform[5] : Number.NaN
  const hasGeometry =
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(raw.width) &&
    Number.isFinite(raw.height) &&
    raw.width >= 0 &&
    raw.height > 0
  return {
    text: raw.str,
    normalizedText: normalizeExtractionText(raw.str),
    x,
    y,
    width: raw.width,
    height: raw.height,
    itemIndex,
    hasGeometry,
  }
}

/** 单个 item 的保守包围盒：横向 [x, x+width]，纵向 [基线-下伸, 基线+整字高]。 */
export function itemRectPdf(item: PdfTextItem): PdfRect | null {
  if (!item.hasGeometry) return null
  const x0 = item.x
  const y0 = item.y - item.height * DESCENT_RATIO
  const x1 = item.x + item.width
  const y1 = item.y + item.height * ASCENT_RATIO
  if (!(x1 > x0) || !(y1 > y0)) return null
  return [x0, y0, x1, y1]
}

/** 多个矩形的保守并集（只在同一页内使用，不伪造跨页框）。 */
export function unionRectPdf(rects: readonly PdfRect[]): PdfRect | null {
  if (rects.length === 0) return null
  let [x0, y0, x1, y1] = rects[0]
  for (const rect of rects.slice(1)) {
    x0 = Math.min(x0, rect[0])
    y0 = Math.min(y0, rect[1])
    x1 = Math.max(x1, rect[2])
    y1 = Math.max(y1, rect[3])
  }
  if (!(x1 > x0) || !(y1 > y0)) return null
  return [x0, y0, x1, y1]
}

interface LineDraft {
  y: number
  items: PdfTextItem[]
}

function buildLines(page: number, items: readonly PdfTextItem[]): PdfTextLine[] {
  // 空格类 item 常常 height=0（无字形高度），但仍占位置、影响文本拼接，
  // 因此按“有有限坐标”入行，而不是按“可作为选区”过滤。
  const placeable = items.filter(
    (item) =>
      Number.isFinite(item.x) &&
      Number.isFinite(item.y) &&
      item.text !== '',
  )
  const ordered = [...placeable].sort((a, b) => {
    if (Math.abs(a.y - b.y) > LINE_Y_TOLERANCE) return b.y - a.y
    return a.x - b.x
  })

  const drafts: LineDraft[] = []
  for (const item of ordered) {
    const current = drafts[drafts.length - 1]
    if (current && Math.abs(current.y - item.y) <= LINE_Y_TOLERANCE) {
      current.items.push(item)
      continue
    }
    drafts.push({ y: item.y, items: [item] })
  }

  const lines: PdfTextLine[] = []
  for (const draft of drafts) {
    const lineItems = [...draft.items].sort((a, b) => a.x - b.x)
    const rawText = lineItems.map((item) => item.text).join('')
    if (rawText.trim() === '') continue
    const spans: TextLineSpan[] = []
    let cursor = 0
    let normalizedText = ''
    for (const item of lineItems) {
      const start = cursor
      normalizedText += item.normalizedText
      cursor += item.normalizedText.length
      spans.push({ start, end: cursor, itemIndex: item.itemIndex })
    }
    const rects: PdfRect[] = []
    for (const item of lineItems) {
      const rect = itemRectPdf(item)
      if (rect) rects.push(rect)
    }
    lines.push({
      page,
      y: draft.y,
      rawText,
      normalizedText,
      items: lineItems,
      spans,
      rectPdf: unionRectPdf(rects),
    })
  }
  return lines
}

/** 由 pdfjs 已取出的逐页 TextContent 组装文本层；不读文件、不启动 worker。 */
export function buildPdfTextLayer(pages: readonly RawPdfTextPage[]): PdfTextLayer {
  const built: PdfTextPage[] = []
  for (const page of pages) {
    const items = page.items.map((raw, index) => toItem(raw, index))
    built.push({
      page: page.page,
      pageBoxPdf: normalizePdfPageBox(page.view),
      items,
      lines: buildLines(page.page, items),
    })
  }
  built.sort((a, b) => a.page - b.page)
  return { pages: built }
}

/** 行内某段归一化文本覆盖的 item 列表（按 span 精确重叠，不按相邻关系猜值）。 */
export function itemsForSpan(
  line: PdfTextLine,
  start: number,
  end: number,
): PdfTextItem[] {
  const covered: PdfTextItem[] = []
  for (const span of line.spans) {
    if (span.end <= start || span.start >= end) continue
    const item = line.items.find((candidate) => candidate.itemIndex === span.itemIndex)
    if (item) covered.push(item)
  }
  return covered
}

/** 行内归一化偏移 → 原文片段（用于人工核对，保留康熙部首等原样字符）。 */
export function rawSnippetForSpan(
  line: PdfTextLine,
  start: number,
  end: number,
): string {
  return itemsForSpan(line, start, end)
    .map((item) => item.text)
    .join('')
}

export function normalizedSnippetForSpan(
  line: PdfTextLine,
  start: number,
  end: number,
): string {
  return itemsForSpan(line, start, end)
    .map((item) => item.normalizedText)
    .join('')
}
