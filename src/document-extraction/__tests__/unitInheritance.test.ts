// @vitest-environment node
/**
 * P0 单位继承（document-extractor-3）：U-01～U-08。
 *
 * 夹具 `unit-inherit-sample.pdf` 是合成样本（scripts/make-unit-inherit-sample.cjs，Chromium
 * printToPDF 生成），12 页一页一个场景；测试按页范围分别取用，因此“文档级声明”的作用域
 * 就是该范围第一页——与实现里的定义一致，不靠测试放宽。
 *
 * 八条硬性期望（对应任务卡第 3 节）：
 * - U-01 表头写单位 → 单元格继承，且出处指向表头文本项；
 * - U-02 第 1 页「单位：mm」→ 后续各页无单位数字全部继承，出处指向该声明；
 * - U-03 单元格自带 in → 保留 in（不被覆盖），报 UNSUPPORTED_UNIT；
 * - U-04 表头 mm + 正文英寸 → UNIT_CONFLICT，只阻塞、不二选一；
 * - U-05 完全没有线索 → 仍 UNKNOWN_UNIT 阻塞（回归保护）；
 * - U-06 跨页表格 → 只认同一表格；取不到就阻塞，不跨页猜；
 * - U-07 图注「间隙（mm）」→ 继承，出处指向图注；
 * - U-08 继承来的单位不影响量级判定：精度/量级越界仍报既有错误，英制不换算。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { buildExtractionDraft } from '../parse'
import { buildPdfTextLayer, type PdfTextLayer } from '../textLayer'
import {
  candidateNumericFields,
  isEvidenceComplete,
  type ExtractionCandidate,
  type ExtractionDraft,
  type ExtractionEvidence,
  type ExtractionSourceIdentity,
  type QuantityValue,
} from '../types'
import { fixtureSha256, readPdfTextPages } from './helpers/pdfFixture'

const FIXTURE = 'unit-inherit-sample.pdf'

let layer: PdfTextLayer
let source: ExtractionSourceIdentity
let pageCount: number

beforeAll(async () => {
  const result = await readPdfTextPages(FIXTURE)
  layer = buildPdfTextLayer(result.pages)
  pageCount = result.pageCount
  source = {
    documentId: 'doc-unit-inherit',
    revisionId: 'rev-unit-inherit',
    sha256: fixtureSha256(FIXTURE),
    blobKey: 'blob-unit-inherit',
    pageCount,
  }
})

function draftFor(from: number, to: number): ExtractionDraft {
  return buildExtractionDraft({
    projectId: 'project-unit-inherit',
    baseToken: 'base-1',
    source,
    pageRange: { from, to },
    layer,
  })
}

type RingCandidate = ExtractionCandidate & { kind: 'ring' }

function rings(draft: ExtractionDraft): RingCandidate[] {
  return draft.candidates.filter((candidate): candidate is RingCandidate => candidate.kind === 'ring')
}

function ringOf(draft: ExtractionDraft, symbol: string): RingCandidate {
  const found = rings(draft).filter((candidate) => candidate.data.symbol === symbol)
  if (found.length !== 1) {
    throw new Error(`期望符号 ${symbol} 恰好一条候选，实际 ${found.length} 条`)
  }
  return found[0]
}

type QuantityField = 'nominal' | 'upperDeviation' | 'lowerDeviation'

function field(candidate: ExtractionCandidate, name: QuantityField): QuantityValue {
  if (candidate.kind !== 'ring') throw new Error('仅支持组成环候选')
  const value = candidate.data[name]
  if (!value) throw new Error(`候选缺少字段 ${name}`)
  return value
}

/** 出处里能指回某段显式文字的那一条（按归一化片段匹配，避免康熙部首影响）。 */
function evidenceCiting(
  candidate: ExtractionDraft['candidates'][number],
  snippet: string,
): ExtractionEvidence | undefined {
  return candidate.evidence.find((item) => item.normalizedSnippet.includes(snippet))
}

describe('U-01 表头写「基本尺寸/mm」，单元格只有数字', () => {
  let draft: ExtractionDraft
  beforeAll(() => {
    draft = draftFor(4, 4)
  })

  it('两条组成环都继承表头 mm，数值精确、状态 pending', () => {
    expect(draft.candidates).toHaveLength(2)
    for (const candidate of rings(draft)) {
      expect(candidate.status).toBe('pending')
      expect(candidate.reasonCodes).toEqual([])
      const nominal = field(candidate, 'nominal')
      expect(nominal.unit).toBe('mm')
      expect(nominal.unitText).toBe('mm')
      expect(field(candidate, 'upperDeviation').unit).toBe('mm')
      expect(field(candidate, 'lowerDeviation').unit).toBe('mm')
    }
    const h = ringOf(draft, 'H')
    expect(field(h, 'nominal').text).toBe('52.20')
    expect(field(h, 'nominal').valueQ).toBe(522000)
    expect(field(h, 'upperDeviation').valueQ).toBe(200)
    expect(field(h, 'lowerDeviation').valueQ).toBe(-200)
  })

  it('出处指回表头那一行文本项（不只在数字单元格上）', () => {
    const h = ringOf(draft, 'H')
    const header = evidenceCiting(h, '基本尺寸/mm')
    expect(header).toBeDefined()
    expect(header?.page).toBe(4)
    const nominal = field(h, 'nominal')
    // 表头在数据行上方（PDF 坐标 y 向上）：表头选区整体高于数值选区。
    expect(header!.rectPdf[1]).toBeGreaterThan(nominal.evidence[0].rectPdf[3])
    expect(nominal.evidence.some((item) => item.page === 4 && item.textSnippet.includes('mm'))).toBe(true)
    expect(h.confidenceBasis).toContain('RULE_UNIT_INHERITED_TABLE')
  })
})

describe('U-02 第 1 页写「单位：mm」，正文多处数字无单位', () => {
  let draft: ExtractionDraft
  beforeAll(() => {
    draft = draftFor(1, 3)
  })

  it('第 2 页三条赋值与第 3 页表格行全部继承 mm，且都待确认', () => {
    expect(draft.candidates.length).toBeGreaterThanOrEqual(4)
    for (const candidate of rings(draft)) {
      expect(candidate.status).toBe('pending')
      expect(field(candidate, 'nominal').unit).toBe('mm')
      expect(field(candidate, 'nominal').unitText).toBe('mm')
    }
    expect(field(ringOf(draft, 'H'), 'nominal').valueQ).toBe(522000)
    expect(field(ringOf(draft, 'B1'), 'nominal').valueQ).toBe(200000)
    expect(field(ringOf(draft, 'S'), 'nominal').valueQ).toBe(120000)
    expect(field(ringOf(draft, 'B2'), 'nominal').valueQ).toBe(200000)
  })

  it('每条候选的出处都指回第 1 页那句「单位：mm」', () => {
    for (const symbol of ['H', 'B1', 'S', 'B2']) {
      const candidate = ringOf(draft, symbol)
      const declaration = evidenceCiting(candidate, '单位:')
      expect(declaration, `符号 ${symbol} 缺少单位声明出处`).toBeDefined()
      expect(declaration?.page).toBe(1)
      expect(declaration?.normalizedSnippet).toContain('mm')
      expect(candidate.confidenceBasis).toContain('RULE_UNIT_INHERITED_DOCUMENT')
    }
  })

  it('第 3 页表头本身没有单位，靠文档级声明才对（不是表头继承）', () => {
    const b2 = ringOf(draft, 'B2')
    expect(b2.page).toBe(3)
    expect(b2.confidenceBasis).toContain('RULE_UNIT_INHERITED_DOCUMENT')
    expect(b2.confidenceBasis).not.toContain('RULE_UNIT_INHERITED_TABLE')
  })
})

describe('U-03 表头 mm，但单元格自带 in', () => {
  let draft: ExtractionDraft
  let h: RingCandidate
  beforeAll(() => {
    draft = draftFor(5, 5)
    h = ringOf(draft, 'H')
  })

  it('单元格保留 in，不被表头 mm 覆盖，报 UNSUPPORTED_UNIT', () => {
    expect(h.status).toBe('blocked')
    expect(h.reasonCodes).toContain('UNSUPPORTED_UNIT')
    expect(h.reasonCodes).not.toContain('UNIT_CONFLICT')
    const nominal = field(h, 'nominal')
    expect(nominal.text).toBe('2.05')
    expect(nominal.unitText).toBe('in')
    expect(nominal.unit).toBeNull()
    expect(nominal.valueQ).toBeNull()
  })

  it('同一行的上下偏差没有自带单位，仍按表头继承 mm（继承只补空缺）', () => {
    expect(field(h, 'upperDeviation').unit).toBe('mm')
    expect(field(h, 'upperDeviation').valueQ).toBe(200)
    expect(field(h, 'lowerDeviation').unit).toBe('mm')
    expect(field(h, 'lowerDeviation').valueQ).toBe(-200)
  })

  it('出处里既有单元格自带单位（2.05 in），也有被继承的表头', () => {
    expect(h.evidence.some((item) => item.normalizedSnippet.includes('2.05'))).toBe(true)
    const header = evidenceCiting(h, '基本尺寸/mm')
    expect(header).toBeDefined()
    // 显式单位优先：名义值本身的出处只覆盖「2.05 in」这个单元格。
    expect(field(h, 'nominal').evidence[0].normalizedSnippet).toContain('2.05')
  })
})

describe('U-04 表格 mm、正文另处说「单位为英寸」', () => {
  let draft: ExtractionDraft
  beforeAll(() => {
    draft = draftFor(6, 6)
  })

  it('UNIT_CONFLICT：只出一条阻塞候选，不产出“选了 mm / 选了英寸”的两条', () => {
    const candidates = rings(draft)
    expect(candidates).toHaveLength(1)
    const h = candidates[0]!
    expect(h.status).toBe('blocked')
    expect(h.reasonCodes).toContain('UNIT_CONFLICT')
    expect(h.reasonCodes).not.toContain('UNSUPPORTED_UNIT')
    for (const name of ['nominal', 'upperDeviation', 'lowerDeviation'] as const) {
      const value = field(h, name)
      expect(value.unit).toBeNull()
      expect(value.valueQ).toBeNull()
      // 原文数字照抄，没被换算成任何单位下的值。
      expect(value.text.length).toBeGreaterThan(0)
    }
    expect(field(h, 'nominal').text).toBe('52.20')
  })

  it('issue 级也标 UNIT_CONFLICT，并把两条互相矛盾的声明一起给出处', () => {
    const issue = draft.issues.find((item) => item.code === 'UNIT_CONFLICT')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('blocked')
    expect(issue?.candidateIds).toHaveLength(1)
    expect(issue?.candidateIds).toEqual([rings(draft)[0]!.candidateId])
    expect(issue?.evidence.some((item) => item.normalizedSnippet.includes('英寸'))).toBe(true)
    expect(issue?.evidence.some((item) => item.normalizedSnippet.includes('基本尺寸/mm'))).toBe(true)
    expect(issue?.message).toContain('未择优')
  })
})

describe('U-05 完全没有任何单位线索（回归保护）', () => {
  let draft: ExtractionDraft
  beforeAll(() => {
    draft = draftFor(7, 7)
  })

  it('表头行与行内赋值都仍按 UNKNOWN_UNIT 阻塞，不默认 mm', () => {
    expect(draft.candidates).toHaveLength(2)
    for (const candidate of rings(draft)) {
      expect(candidate.status).toBe('blocked')
      expect(candidate.reasonCodes).toEqual(['UNKNOWN_UNIT'])
      expect(field(candidate, 'nominal').unit).toBeNull()
      expect(field(candidate, 'nominal').valueQ).toBeNull()
      expect(candidate.confidenceBasis.some((basis) => basis.startsWith('RULE_UNIT_INHERITED_'))).toBe(
        false,
      )
    }
    expect(draft.issues.some((item) => item.code === 'UNIT_CONFLICT')).toBe(false)
  })
})

describe('U-06 单位声明在表格上一页（跨页表格）', () => {
  let draft: ExtractionDraft
  beforeAll(() => {
    draft = draftFor(8, 9)
  })

  it('本页有表头的表格正常继承；续表行因为没有表头而不构成候选', () => {
    const h = ringOf(draft, 'H')
    expect(h.page).toBe(8)
    expect(h.status).toBe('pending')
    expect(h.confidenceBasis).toContain('RULE_UNIT_INHERITED_TABLE')
    // 第 9 页的续表行（B1 …）没有表头，不产生组成环候选；本页只有那条无单位赋值。
    const page9 = rings(draft).filter((candidate) => candidate.page === 9)
    expect(page9.map((candidate) => candidate.data.symbol)).toEqual(['K'])
  })

  it('第 9 页的无单位赋值不许跨页继承第 8 页表头，仍 UNKNOWN_UNIT', () => {
    const k = ringOf(draft, 'K')
    expect(k.page).toBe(9)
    expect(k.status).toBe('blocked')
    expect(k.reasonCodes).toEqual(['UNKNOWN_UNIT'])
    expect(field(k, 'nominal').unit).toBeNull()
    expect(k.evidence.every((item) => item.page === 9)).toBe(true)
  })
})

describe('U-07 图注「间隙（mm）」+ 图内标注数字', () => {
  let draft: ExtractionDraft
  beforeAll(() => {
    draft = draftFor(10, 10)
  })

  it('两个标注数字都继承图注的 mm，出处指向图注文本项', () => {
    const c = ringOf(draft, 'C')
    const c2 = ringOf(draft, 'C2')
    for (const candidate of [c, c2]) {
      expect(candidate.status).toBe('pending')
      expect(field(candidate, 'nominal').unit).toBe('mm')
      expect(candidate.confidenceBasis).toContain('RULE_UNIT_INHERITED_CAPTION')
      const caption = candidate.evidence.find(
        (item) => item.normalizedSnippet.includes('间隙') && item.normalizedSnippet.includes('mm'),
      )
      expect(caption).toBeDefined()
      expect(caption?.page).toBe(10)
    }
    expect(field(c, 'nominal').valueQ).toBe(1500)
    expect(field(c2, 'nominal').valueQ).toBe(2000)
  })
})

describe('U-08 继承来的单位不破坏量级判据', () => {
  it('继承 mm 时，超精度与超量级仍报既有错误，不四舍五入、不截断', () => {
    const draft = draftFor(11, 11)
    const a = ringOf(draft, 'A')
    const b = ringOf(draft, 'B')
    expect(a.status).toBe('blocked')
    expect(a.reasonCodes).toEqual(['PRECISION_UNSUPPORTED'])
    expect(field(a, 'nominal').text).toBe('12.34567')
    expect(field(a, 'nominal').valueQ).toBeNull()
    expect(b.status).toBe('blocked')
    expect(b.reasonCodes).toEqual(['NUMBER_UNSUPPORTED'])
    expect(field(b, 'nominal').text).toBe('12345678')
    expect(field(b, 'nominal').valueQ).toBeNull()
    // 单位确实继承到了（出处里有「单位：mm」），但量级判据没有因此放松。
    expect(a.evidence.some((item) => item.normalizedSnippet.includes('单位:'))).toBe(true)
    expect(b.evidence.some((item) => item.normalizedSnippet.includes('单位:'))).toBe(true)
  })

  it('继承到英制单位时仍 UNSUPPORTED_UNIT，不把 0.15 in 换算成 0.15 mm', () => {
    const draft = draftFor(12, 12)
    const d = ringOf(draft, 'D')
    expect(d.status).toBe('blocked')
    expect(d.reasonCodes).toEqual(['UNSUPPORTED_UNIT'])
    expect(field(d, 'nominal').text).toBe('0.15')
    expect(field(d, 'nominal').unitText).toBe('英寸')
    expect(field(d, 'nominal').unit).toBeNull()
    expect(field(d, 'nominal').valueQ).toBeNull()
    expect(d.confidenceBasis).toContain('RULE_UNIT_INHERITED_DOCUMENT')

    // 同样写 0.15 但继承到 mm 的一处：1500 q。两者量级完全不同，说明没有互换。
    const mmDraft = draftFor(10, 10)
    expect(field(ringOf(mmDraft, 'C'), 'nominal').valueQ).toBe(1500)
  })
})

describe('证据完整性（继承不豁免出处要求）', () => {
  it('U-01～U-08 全场景的每个数值字段都带完整出处，且声明出处也在页框内', () => {
    const ranges: [number, number][] = [
      [1, 3],
      [4, 4],
      [5, 5],
      [6, 6],
      [7, 7],
      [8, 9],
      [10, 10],
      [11, 11],
      [12, 12],
    ]
    for (const [from, to] of ranges) {
      const draft = draftFor(from, to)
      expect(draft.candidates.length, `页 ${from}-${to} 应产出候选`).toBeGreaterThan(0)
      for (const candidate of draft.candidates) {
        for (const { field: name, value } of candidateNumericFields(candidate)) {
          expect(value.evidence.length, `${candidate.candidateId}.${name}`).toBeGreaterThan(0)
          for (const evidence of value.evidence) {
            expect(isEvidenceComplete(evidence), `${candidate.candidateId}.${name}`).toBe(true)
            expect(evidence.page).toBeGreaterThanOrEqual(from)
            expect(evidence.page).toBeLessThanOrEqual(to)
          }
        }
        for (const evidence of candidate.evidence) {
          expect(isEvidenceComplete(evidence)).toBe(true)
        }
      }
    }
  })
})
