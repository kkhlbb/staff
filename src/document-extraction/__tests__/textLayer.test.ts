// @vitest-environment node
/**
 * 文本层组装与归一化单元测试（不读 PDF）：
 * - 康熙部首（U+2F00–U+2FDF）由 NFKC 归一；
 * - CJK 部首补充区（U+2E80–U+2EFF）由 UCD CJKRadicals 映射归一；
 * - 空格类 item 高度为 0 时仍应保留文本间隔，但不参与选区。
 */
import { describe, expect, it } from 'vitest'
import {
  buildPdfTextLayer,
  itemRectPdf,
  itemsForSpan,
  isRadicalCodePoint,
  normalizeExtractionText,
  type RawPdfTextPage,
} from '../textLayer'

describe('V3.6 文本归一', () => {
  it('NFKC 覆盖康熙部首：⽂件 → 文件、⼀⽤ → 一用', () => {
    expect(normalizeExtractionText('⽂件⼀⽤⾯⽑')).toBe('文件一用面毛')
  })

  it('CJK 部首补充区（NFKC 不覆盖）：⻓度 → 长度、⻚数 → 页数', () => {
    expect(normalizeExtractionText('⻓度')).toBe('长度')
    expect(normalizeExtractionText('⻚数')).toBe('页数')
    expect(normalizeExtractionText('⽅法')).toBe('方法')
  })

  it('普通文本不被改写：数字尾零、ASCII 符号、空格保持原样', () => {
    expect(normalizeExtractionText('52.20 +0.02 -0.02')).toBe('52.20 +0.02 -0.02')
    expect(normalizeExtractionText('C = H - B1 - S - B2')).toBe('C = H - B1 - S - B2')
  })

  it('部首码位判定覆盖两个区段', () => {
    expect(isRadicalCodePoint(0x2f02)).toBe(true)
    expect(isRadicalCodePoint(0x2ed3)).toBe(true)
    expect(isRadicalCodePoint(0x957f)).toBe(false)
    expect(isRadicalCodePoint(0x0041)).toBe(false)
  })
})

describe('V3.6 文本层组装', () => {
  function page(items: RawPdfTextPage['items']): RawPdfTextPage {
    return { page: 1, view: [0, 0, 612, 792], items }
  }

  it('同基线 item 按 x 排序组装成行；零高空格保留间隔但不生成选区', () => {
    const layer = buildPdfTextLayer([
      page([
        { str: 'H', transform: [1, 0, 0, 1, 16, 700], width: 7.2, height: 12 },
        { str: ' ', transform: [1, 0, 0, 1, 23.2, 700], width: 3, height: 0 },
        { str: '总长', transform: [1, 0, 0, 1, 60, 700], width: 24, height: 12 },
        { str: '下一行', transform: [1, 0, 0, 1, 16, 688], width: 36, height: 12 },
      ]),
    ])
    expect(layer.pages[0].lines).toHaveLength(2)
    expect(layer.pages[0].lines[0].normalizedText).toBe('H 总长')
    expect(layer.pages[0].lines[1].normalizedText).toBe('下一行')
    const space = layer.pages[0].items.find((item) => item.text === ' ')
    expect(space?.hasGeometry).toBe(false)
    if (!space) throw new Error('缺少空格 item')
    expect(itemRectPdf(space)).toBeNull()
    const line = layer.pages[0].lines[0]
    const covered = itemsForSpan(line, 0, 4)
    expect(covered.map((item) => item.text)).toEqual(['H', ' ', '总长'])
  })

  it('无效 page.view → pageBoxPdf 为 null，后续无法生成出处', () => {
    const layer = buildPdfTextLayer([
      { page: 1, view: [0, 0, 0, 0], items: [{ str: 'x', transform: [1, 0, 0, 1, 10, 10], width: 5, height: 10 }] },
    ])
    expect(layer.pages[0].pageBoxPdf).toBeNull()
  })
})
