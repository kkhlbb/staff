// @vitest-environment node
/**
 * V3.6 阶段 1 坏样例与不确定分支：任何情况都不许硬猜。
 *
 * ①②③ 用真实 PDF（Chromium printToPDF，含文本层/无文本层），
 * 其余用合成文本层覆盖单位缺失、精度超限、同符号多值、页框无效、端点语义缺失。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { buildExtractionDraft } from '../parse'
import { buildPdfTextLayer, type RawPdfTextPage } from '../textLayer'
import {
  candidateNumericFields,
  type ExtractionDraft,
  type ExtractionSourceIdentity,
} from '../types'
import { readPdfTextPages } from './helpers/pdfFixture'

function draftFromPages(pages: RawPdfTextPage[], name: string): ExtractionDraft {
  const layer = buildPdfTextLayer(pages)
  const source: ExtractionSourceIdentity = {
    documentId: `doc-${name}`,
    revisionId: `rev-${name}`,
    sha256: 'a'.repeat(64),
    blobKey: `blob-${name}`,
    pageCount: pages.length,
  }
  return buildExtractionDraft({
    projectId: 'project-bad',
    baseToken: 'base-1',
    source,
    pageRange: { from: 1, to: pages.length },
    layer,
  })
}

/** 合成一页文本层：每行一个 item，行距 14pt。 */
function syntheticPage(lines: readonly string[], options: { view?: number[] } = {}): RawPdfTextPage {
  let y = 760
  const items = lines.map((line) => {
    const item = {
      str: line,
      transform: [1, 0, 0, 1, 16, y] as number[],
      width: Math.min(line.length * 6, 560),
      height: 12,
    }
    y -= 14
    return item
  })
  return { page: 1, view: options.view ?? [0, 0, 595, 842], items }
}

let noText: ExtractionDraft
let formulaConflict: ExtractionDraft
let inch: ExtractionDraft

beforeAll(async () => {
  const noTextPdf = await readPdfTextPages('bad-no-text-layer.pdf')
  noText = draftFromPages(noTextPdf.pages, 'bad-no-text-layer')
  const conflictPdf = await readPdfTextPages('bad-formula-conflict.pdf')
  formulaConflict = draftFromPages(conflictPdf.pages, 'bad-formula-conflict')
  const inchPdf = await readPdfTextPages('bad-inch-unit.pdf')
  inch = draftFromPages(inchPdf.pages, 'bad-inch-unit')
})

describe('坏样例一：无文本层扫描件', () => {
  it('没有文本层 → 候选为空，明确 NO_TEXT_LAYER，不调用 OCR、不填默认值', () => {
    expect(noText.candidates).toEqual([])
    const issue = noText.issues.find((item) => item.code === 'NO_TEXT_LAYER')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('blocked')
    expect(issue?.message).toContain('不做 OCR')
  })
})

describe('坏样例二：公式与数值矛盾', () => {
  it('两条互相矛盾的公式全部阻塞，关联区间同组阻塞，环数值不被修正', () => {
    const formulas = formulaConflict.candidates.filter(
      (candidate) => candidate.kind === 'formula',
    )
    expect(formulas).toHaveLength(2)
    for (const formula of formulas) {
      expect(formula.status).toBe('blocked')
      expect(formula.reasonCodes).toContain('FORMULA_CONFLICT')
    }
    const interval = formulaConflict.candidates.find((candidate) => candidate.kind === 'interval')
    expect(interval?.status).toBe('blocked')
    expect(interval?.reasonCodes).toContain('CONFLICT_GROUP_MEMBER')

    const issueCodes = formulaConflict.issues.map((item) => item.code)
    expect(issueCodes).toContain('FORMULA_CONFLICT')
    expect(issueCodes).toContain('FORMULA_VALUE_CONFLICT')

    const ringH = formulaConflict.candidates.find(
      (candidate) => candidate.kind === 'ring' && candidate.data.symbol === 'H',
    )
    expect(ringH?.status).toBe('pending')
    if (!ringH || ringH.kind !== 'ring') throw new Error('缺少 H 候选')
    expect(ringH.data.nominal?.text).toBe('52.20')
    expect(ringH.data.nominal?.valueQ).toBe(522000)
  })
})

describe('坏样例三：单位写成 inch', () => {
  it('保留原文与单位，全部阻塞 UNSUPPORTED_UNIT，不换算、不产出 mm 数值', () => {
    const rings = inch.candidates.filter((candidate) => candidate.kind === 'ring')
    expect(rings).toHaveLength(4)
    for (const candidate of rings) {
      expect(candidate.status).toBe('blocked')
      expect(candidate.reasonCodes).toContain('UNSUPPORTED_UNIT')
      for (const { value } of candidateNumericFields(candidate)) {
        expect(value.unitText).toBe('in')
        expect(value.unit).toBeNull()
        expect(value.valueQ).toBeNull()
      }
    }
    const interval = inch.candidates.find((candidate) => candidate.kind === 'interval')
    expect(interval?.status).toBe('blocked')
    expect(interval?.reasonCodes).toContain('UNSUPPORTED_UNIT')
    const formula = inch.candidates.find((candidate) => candidate.kind === 'formula')
    expect(formula?.status).toBe('blocked')
    expect(formula?.reasonCodes).toContain('UNSUPPORTED_UNIT')
    // 任何候选都不能把 inch 换算成 mm 数值。
    for (const candidate of inch.candidates) {
      for (const { value } of candidateNumericFields(candidate)) {
        expect(value.valueQ).toBeNull()
      }
    }
  })
})

describe('不确定分支：合成文本层', () => {
  it('表头没有单位 → 组成环 blocked/UNKNOWN_UNIT，不默认 mm', () => {
    const draft = draftFromPages(
      [
        syntheticPage([
          '位号 名称 基本尺寸 上偏差 下偏差',
          'H 总长 52.20 +0.02 -0.02',
        ]),
      ],
      'no-unit',
    )
    const ring = draft.candidates.find((candidate) => candidate.kind === 'ring')
    expect(ring?.status).toBe('blocked')
    expect(ring?.reasonCodes).toContain('UNKNOWN_UNIT')
    if (!ring || ring.kind !== 'ring') throw new Error('缺少候选')
    expect(ring.data.nominal?.unit).toBeNull()
    expect(ring.data.nominal?.valueQ).toBeNull()
  })

  it('超过四位小数 → blocked/PRECISION_UNSUPPORTED，不舍入、不截断', () => {
    const draft = draftFromPages(
      [
        syntheticPage([
          '位号 名称 基本尺寸(mm) 上偏差(mm) 下偏差(mm)',
          'H 总长 52.20001 +0.02 -0.02',
        ]),
      ],
      'precision',
    )
    const ring = draft.candidates.find((candidate) => candidate.kind === 'ring')
    expect(ring?.status).toBe('blocked')
    expect(ring?.reasonCodes).toContain('PRECISION_UNSUPPORTED')
    if (!ring || ring.kind !== 'ring') throw new Error('缺少候选')
    expect(ring.data.nominal?.text).toBe('52.20001')
    expect(ring.data.nominal?.valueQ).toBeNull()
  })

  it('同符号出现两组不同数值 → 两个候选都 blocked/AMBIGUOUS_ASSIGNMENT，不按先后择优', () => {
    const draft = draftFromPages(
      [
        syntheticPage([
          '位号 名称 基本尺寸(mm) 上偏差(mm) 下偏差(mm)',
          'H 总长 52.20 +0.02 -0.02',
          '',
          'H = 50.00 mm',
        ]),
      ],
      'ambiguous',
    )
    const rings = draft.candidates.filter(
      (candidate) => candidate.kind === 'ring' && candidate.data.symbol === 'H',
    )
    expect(rings).toHaveLength(2)
    expect(rings.map((candidate) => candidate.status)).toEqual(['blocked', 'blocked'])
    for (const candidate of rings) {
      expect(candidate.reasonCodes).toContain('AMBIGUOUS_ASSIGNMENT')
    }
    expect(draft.issues.map((item) => item.code)).toContain('AMBIGUOUS_ASSIGNMENT')
    const texts = rings.map((candidate) =>
      candidate.kind === 'ring' ? candidate.data.nominal?.text : null,
    )
    expect(texts.sort()).toEqual(['50.00', '52.20'])
  })

  it('页面边界框无效 → 无法生成选区，数值不进候选，只留 SOURCE_UNRESOLVED', () => {
    const draft = draftFromPages(
      [
        syntheticPage(
          [
            '位号 名称 基本尺寸(mm) 上偏差(mm) 下偏差(mm)',
            'H 总长 52.20 +0.02 -0.02',
          ],
          { view: [0, 0, 0, 0] },
        ),
      ],
      'bad-pagebox',
    )
    expect(draft.candidates).toEqual([])
    const issue = draft.issues.find((item) => item.code === 'SOURCE_UNRESOLVED')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('blocked')
  })

  it('区间缺端点语义 → blocked/ENDPOINT_SEMANTICS_MISSING，不默认闭区间', () => {
    const draft = draftFromPages(
      [syntheticPage(['轴向装配间隙 C 应为 0.1000~0.3000 mm'])],
      'no-endpoint',
    )
    const interval = draft.candidates.find((candidate) => candidate.kind === 'interval')
    expect(interval?.status).toBe('blocked')
    expect(interval?.reasonCodes).toContain('ENDPOINT_SEMANTICS_MISSING')
    if (!interval || interval.kind !== 'interval') throw new Error('缺少区间候选')
    expect(interval.data.lowerInclusive).toBeNull()
    expect(interval.data.upperInclusive).toBeNull()
  })

  it('区间上下限颠倒 → blocked/RANGE_CONFLICT，不自动交换', () => {
    const draft = draftFromPages(
      [syntheticPage(['轴向装配间隙 C 应为 0.3000~0.1000 mm，含两端。'])],
      'reversed',
    )
    const interval = draft.candidates.find((candidate) => candidate.kind === 'interval')
    expect(interval?.status).toBe('blocked')
    expect(interval?.reasonCodes).toContain('RANGE_CONFLICT')
    if (!interval || interval.kind !== 'interval') throw new Error('缺少区间候选')
    expect(interval.data.lower?.text).toBe('0.3000')
    expect(interval.data.upper?.text).toBe('0.1000')
  })
})
