// @vitest-environment node
/**
 * V3.6 阶段 1 固定样例：完整版 TB-2026-1110（2 页，文本层含康熙部首与 CJK 部首补充区码位）。
 *
 * 期望值来自 PDF 原文，不来自 HTML 或项目默认值：
 * - 组成环 H/B1/B2/S：52.20 ±0.02、20.00 ±0.01、20.00 ±0.01、12.00 ±0.01
 * - 隔套部件：内径 20.00、外径 32.00、长度 12.00
 * - 区间：C 0.1000～0.3000 mm 含两端
 * - 公式：C = H − B1 − S − B2
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { buildExtractionDraft } from '../parse'
import { buildPdfTextLayer, isRadicalCodePoint } from '../textLayer'
import type { PdfTextLayer } from '../textLayer'
import {
  candidateNumericFields,
  isEvidenceComplete,
  type ExtractionCandidate,
  type ExtractionDraft,
  type ExtractionPageRange,
  type ExtractionSourceIdentity,
  type QuantityValue,
} from '../types'
import { fixtureSha256, readPdfTextPages } from './helpers/pdfFixture'

const FIXTURE = 'taskbook-TB-2026-1110.pdf'

let layer: PdfTextLayer
let source: ExtractionSourceIdentity
let draft: ExtractionDraft

beforeAll(async () => {
  const { pageCount, pages } = await readPdfTextPages(FIXTURE)
  layer = buildPdfTextLayer(pages)
  source = {
    documentId: 'doc-1110',
    revisionId: 'rev-1110',
    sha256: fixtureSha256(FIXTURE),
    blobKey: 'blob-1110',
    pageCount,
  }
  draft = buildExtractionDraft({
    projectId: 'project-1110',
    baseToken: 'base-1',
    source,
    pageRange: { from: 1, to: 2 },
    layer,
  })
})

function buildWith(range: ExtractionPageRange): ExtractionDraft {
  return buildExtractionDraft({
    projectId: 'project-1110',
    baseToken: 'base-1',
    source,
    pageRange: range,
    layer,
  })
}

function ring(symbol: string) {
  const found = draft.candidates.find(
    (candidate): candidate is ExtractionCandidate & { kind: 'ring' } =>
      candidate.kind === 'ring' && candidate.data.symbol === symbol,
  )
  if (!found) throw new Error(`找不到组成环候选 ${symbol}`)
  return found
}

function quantityField(candidate: ExtractionCandidate, field: string): QuantityValue {
  const entry = candidateNumericFields(candidate).find((item) => item.field === field)
  if (!entry) throw new Error(`候选缺少字段 ${field}`)
  return entry.value
}

describe('V3.6 固定样例 TB-2026-1110：候选与出处', () => {
  it('生成 7 个候选：4 组成环 + 1 部件尺寸 + 1 区间 + 1 公式，全部待确认', () => {
    expect(draft.candidates).toHaveLength(7)
    expect(draft.candidates.every((candidate) => candidate.status === 'pending')).toBe(true)
    expect(draft.candidates.every((candidate) => candidate.editRevision === 0)).toBe(true)
    const kinds = draft.candidates.map((candidate) => candidate.kind)
    expect(kinds.filter((kind) => kind === 'ring')).toHaveLength(4)
    expect(kinds.filter((kind) => kind === 'part-dimension')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'interval')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'formula')).toHaveLength(1)
    expect(new Set(draft.candidates.map((candidate) => candidate.candidateId)).size).toBe(7)
    expect(draft.decisions).toEqual([])
    expect(draft.issues).toEqual([])
  })

  it('组成环数值与上下偏差逐项精确（保留尾零与符号）', () => {
    expect(ring('H').data).toMatchObject({
      symbol: 'H',
      name: '总长',
      nominal: { text: '52.20', decimals: 2, valueQ: 522000, unitText: 'mm', unit: 'mm' },
      upperDeviation: { text: '+0.02', valueQ: 200 },
      lowerDeviation: { text: '-0.02', valueQ: -200 },
    })
    expect(ring('B1').data).toMatchObject({
      name: '左轴承',
      nominal: { text: '20.00', valueQ: 200000 },
      upperDeviation: { text: '+0.01', valueQ: 100 },
      lowerDeviation: { text: '-0.01', valueQ: -100 },
    })
    expect(ring('B2').data).toMatchObject({
      name: '右轴承',
      nominal: { text: '20.00', valueQ: 200000 },
    })
    expect(ring('S').data).toMatchObject({
      name: '隔套',
      nominal: { text: '12.00', valueQ: 120000 },
      upperDeviation: { text: '+0.01', valueQ: 100 },
      lowerDeviation: { text: '-0.01', valueQ: -100 },
    })
    expect(ring('H').page).toBe(1)
  })

  it('隔套部件尺寸：内径 20.00 / 外径 32.00 / 长度 12.00，作为部件尺寸而非轴向环', () => {
    const part = draft.candidates.find((candidate) => candidate.kind === 'part-dimension')
    expect(part).toBeDefined()
    if (!part || part.kind !== 'part-dimension') throw new Error('缺少部件尺寸候选')
    expect(part.page).toBe(1)
    expect(part.data.partName).toBe('隔套')
    expect(part.data.innerDiameter).toMatchObject({ text: '20.00', valueQ: 200000, unit: 'mm' })
    expect(part.data.outerDiameter).toMatchObject({ text: '32.00', valueQ: 320000, unit: 'mm' })
    expect(part.data.length).toMatchObject({ text: '12.00', valueQ: 120000, unit: 'mm' })
    expect(part.status).toBe('pending')
  })

  it('区间：C 0.1000～0.3000 mm，两端包含，端点有独立出处', () => {
    const interval = draft.candidates.find((candidate) => candidate.kind === 'interval')
    if (!interval || interval.kind !== 'interval') throw new Error('缺少区间候选')
    expect(interval.page).toBe(2)
    expect(interval.data.outputSymbol).toBe('C')
    expect(interval.data.lower).toMatchObject({ text: '0.1000', decimals: 4, valueQ: 1000 })
    expect(interval.data.upper).toMatchObject({ text: '0.3000', decimals: 4, valueQ: 3000 })
    expect(interval.data.lowerInclusive).toBe(true)
    expect(interval.data.upperInclusive).toBe(true)
    expect(interval.data.endpointEvidence).toHaveLength(1)
    expect(interval.data.endpointEvidence[0].textSnippet).toContain('含两端')
    expect(interval.rawText).toContain('含两端')
    expect(interval.rawText).toContain('～')
    expect(interval.reasonCodes).toEqual([])
  })

  it('公式：C = H − B1 − S − B2，线性加减，符合区间（不报冲突）', () => {
    const formula = draft.candidates.find((candidate) => candidate.kind === 'formula')
    if (!formula || formula.kind !== 'formula') throw new Error('缺少公式候选')
    expect(formula.page).toBe(2)
    expect(formula.rawText).toBe('C = H - B1 - S - B2')
    expect(formula.data.outputSymbol).toBe('C')
    expect(formula.data.operands).toEqual([
      { symbol: 'H', sign: 1 },
      { symbol: 'B1', sign: -1 },
      { symbol: 'S', sign: -1 },
      { symbol: 'B2', sign: -1 },
    ])
    expect(formula.data.unsupported).toBe(false)
    expect(formula.data.conflict).toBe(false)
    expect(formula.status).toBe('pending')
  })

  it('每个数值字段都带完整出处：版本/页/选区/原文/页框，且落在页框内', () => {
    for (const candidate of draft.candidates) {
      for (const { field, value } of candidateNumericFields(candidate)) {
        expect(value.evidence.length, `${candidate.candidateId}.${field}`).toBeGreaterThan(0)
        for (const evidence of value.evidence) {
          expect(isEvidenceComplete(evidence), `${candidate.candidateId}.${field}`).toBe(true)
          expect(evidence.documentId).toBe(source.documentId)
          expect(evidence.revisionId).toBe(source.revisionId)
          expect(evidence.sha256).toBe(source.sha256)
          expect(evidence.blobKey).toBe(source.blobKey)
          expect(evidence.page).toBeGreaterThanOrEqual(1)
          expect(evidence.page).toBeLessThanOrEqual(2)
          expect(evidence.textSnippet.trim()).not.toBe('')
          const [x0, y0, x1, y1] = evidence.rectPdf
          const [bx0, by0, bx1, by1] = evidence.pageBoxPdf
          expect(x0).toBeGreaterThanOrEqual(bx0)
          expect(y0).toBeGreaterThanOrEqual(by0)
          expect(x1).toBeLessThanOrEqual(bx1)
          expect(y1).toBeLessThanOrEqual(by1)
          expect(x1).toBeGreaterThan(x0)
          expect(y1).toBeGreaterThan(y0)
        }
      }
    }
    const h = ring('H')
    const nominal = quantityField(h, 'nominal')
    expect(nominal.evidence[0].textSnippet).toBe('52.20')
    expect(nominal.evidence[0].page).toBe(1)
    expect(nominal.evidence[0].textItemIndexes.length).toBeGreaterThan(0)
  })
})

describe('V3.6 文本层归一：康熙部首与 CJK 部首补充区', () => {
  it('原文 24 处部首码位，NFKC + UCD 映射后一处不剩', () => {
    const rawChars = layer.pages
      .flatMap((page) => page.items.map((item) => item.text))
      .flatMap((text) => [...text])
      .filter((character) => {
        const codePoint = character.codePointAt(0)
        return codePoint !== undefined && isRadicalCodePoint(codePoint)
      })
    expect(rawChars).toHaveLength(24)
    expect([...new Set(rawChars)].sort()).toEqual(
      ['⽂', '⻚', '⽤', '⼀', '⼨', '⻓', '⾯', '⽑', '⽅'].sort(),
    )

    const leftover = layer.pages
      .flatMap((page) => page.items.map((item) => item.normalizedText))
      .flatMap((text) => [...text])
      .filter((character) => {
        const codePoint = character.codePointAt(0)
        return codePoint !== undefined && isRadicalCodePoint(codePoint)
      })
    expect(leftover).toEqual([])
  })

  it('归一后能匹配“文件编号/零件尺寸/长度/页数”，原文片段仍保留原码位', () => {
    const page1Text = layer.pages[0].lines.map((line) => line.normalizedText).join('\n')
    expect(page1Text).toContain('文件编号')
    expect(page1Text).toContain('零件尺寸')
    expect(page1Text).toContain('长度 12.00 mm')
    expect(page1Text).toContain('页数')
    expect(page1Text).toContain('总长')

    const rawPage1 = layer.pages[0].lines.map((line) => line.rawText).join('\n')
    expect(rawPage1).toContain('⽂件编号')
    expect(rawPage1).toContain('⻓度')

    const part = draft.candidates.find((candidate) => candidate.kind === 'part-dimension')
    if (!part || part.kind !== 'part-dimension') throw new Error('缺少部件尺寸候选')
    const lengthEvidence = part.data.length?.evidence[0]
    expect(lengthEvidence?.textSnippet).toContain('12.00')
    // 原文片段不改写；匹配片段是归一后的文本。
    expect(lengthEvidence?.normalizedSnippet).toBe(lengthEvidence?.textSnippet)
  })
})

describe('V3.6 幂等与页范围', () => {
  it('同一 PDF 版本重复提取：候选 ID、数量与草稿 ID 完全一致', () => {
    const again = buildWith({ from: 1, to: 2 })
    expect(again.draftId).toBe(draft.draftId)
    expect(again.idempotencyKey).toBe(draft.idempotencyKey)
    expect(again.candidates.map((candidate) => candidate.candidateId)).toEqual(
      draft.candidates.map((candidate) => candidate.candidateId),
    )
    expect(JSON.stringify(again)).toBe(JSON.stringify(draft))
  })

  it('仅选第 2 页：不回填第 1 页的内外径，S 因缺值而不生成数值候选', () => {
    const pageTwo = buildWith({ from: 2, to: 2 })
    expect(pageTwo.candidates.some((candidate) => candidate.kind === 'part-dimension')).toBe(false)
    expect(
      pageTwo.candidates.some(
        (candidate) => candidate.kind === 'ring' && candidate.data.symbol === 'S',
      ),
    ).toBe(false)
    for (const candidate of pageTwo.candidates) {
      expect(candidate.page).toBe(2)
      for (const evidence of candidate.evidence) expect(evidence.page).toBe(2)
    }
    const formula = pageTwo.candidates.find((candidate) => candidate.kind === 'formula')
    if (!formula || formula.kind !== 'formula') throw new Error('缺少公式候选')
    // 第 2 页没有 S 的数值 → 公式无法解析全部操作数，必须阻塞而不是猜。
    expect(formula.status).toBe('blocked')
    expect(formula.reasonCodes).toContain('FORMULA_UNRESOLVED_OPERAND')
  })

  it('页范围越界 → 明确 issue，不返回候选', () => {
    const out = buildWith({ from: 1, to: 3 })
    expect(out.candidates).toEqual([])
    expect(out.issues.map((item) => item.code)).toContain('SOURCE_PAGE_OUT_OF_RANGE')
  })
})
