// @vitest-environment node
/**
 * P1 表达式末尾单位与多等号数值解析（`document-extractor-4`）：E-01～E-07。
 *
 * 夹具 `expression-unit-sample.pdf` 是合成样本（scripts/make-expression-unit-sample.cjs，
 * Chromium printToPDF 生成），7 页一页一个场景，测试按页范围分别取用。
 * 页内“结果值 / 单位”被拆成独立文本项，所以出处能精确指到末尾那段单位文字。
 *
 * 七条硬性期望（对应任务卡第 2 节）：
 * - E-01 `A0max = 1753.1 − 759.38 − 765.31 = 228.41 mm` → 取 228.41 mm，出处指向末尾单位，
 *        中间表达式原样保留（不计算、不替换）；
 * - E-02 `A = 230 ± 0.3 mm` → 230 / +0.3 / −0.3，单位 mm；
 * - E-03 `T0 = +0.3 − (−0.3) = 0.6 mm` → 只取 0.6 mm，括号负数不当两个值；
 * - E-04 `A = 10 = 12 mm` → `INCONSISTENT_REDUNDANT_VALUE` 阻塞，不挑一个；
 * - E-05 无单位表达式 → 仍 `UNKNOWN_UNIT`；
 * - E-06 无单位但页内「单位：mm」→ 走 P0 继承（回归保护）；
 * - E-07 `i = 0` / `i = 1` → 不当尺寸候选（回归保护）。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { matchExpressionAssignment } from '../expressionUnits'
import { buildExtractionDraft } from '../parse'
import { buildPdfTextLayer, type PdfTextLayer } from '../textLayer'
import {
  EXTRACTOR_VERSION,
  candidateNumericFields,
  isEvidenceComplete,
  type ExtractionCandidate,
  type ExtractionDraft,
  type ExtractionSourceIdentity,
  type QuantityValue,
} from '../types'
import { fixtureSha256, readPdfTextPages } from './helpers/pdfFixture'

const FIXTURE = 'expression-unit-sample.pdf'

let layer: PdfTextLayer
let source: ExtractionSourceIdentity
let pageCount: number

beforeAll(async () => {
  const result = await readPdfTextPages(FIXTURE)
  layer = buildPdfTextLayer(result.pages)
  pageCount = result.pageCount
  source = {
    documentId: 'doc-expression-unit',
    revisionId: 'rev-expression-unit',
    sha256: fixtureSha256(FIXTURE),
    blobKey: 'blob-expression-unit',
    pageCount,
  }
})

function draftFor(from: number, to: number): ExtractionDraft {
  return buildExtractionDraft({
    projectId: 'project-expression-unit',
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

function onlyRing(draft: ExtractionDraft): RingCandidate {
  const list = rings(draft)
  if (list.length !== 1) {
    throw new Error(`期望恰好一条组成环候选，实际 ${list.length} 条`)
  }
  return list[0]
}

function field(candidate: ExtractionCandidate, name: 'nominal' | 'upperDeviation' | 'lowerDeviation'): QuantityValue {
  if (candidate.kind !== 'ring') throw new Error('仅支持组成环候选')
  const value = candidate.data[name]
  if (!value) throw new Error(`候选缺少字段 ${name}`)
  return value
}

/** 出处里能指回某段显式文字的那一条（按归一化片段匹配，避免康熙部首影响）。 */
function evidenceCiting(candidate: ExtractionCandidate, snippet: string) {
  return candidate.evidence.find((item) =>
    item.normalizedSnippet.includes(snippet),
  )
}

describe('形态匹配（纯函数，区间偏移必须落在原文上）', () => {
  it('逗号分隔的第二段：偏移按整行计算，切出来的原文不能串位', () => {
    const line = 'Take B2=32.5±0.03mm, and take B3=488.88±0.05mm.'
    const comma = line.indexOf(',')
    const second = matchExpressionAssignment(line, comma + 1, line.length)
    expect(second?.form).toBe('deviation')
    expect(second?.symbol.text).toBe('B3')
    expect(second?.nominal.text).toBe('488.88')
    expect(second?.unit.text).toBe('mm')
    expect(second?.deviation?.text).toBe('±0.05')
    // 区间确实指向原文：用 start/end 重新切片应等于 text。
    for (const span of [second!.symbol, second!.nominal, second!.unit, second!.deviation!]) {
      expect(line.slice(span.start, span.end)).toBe(span.text)
    }
  })

  it('多个等号结果不一致：标 inconsistent 并列出两个结果值原文', () => {
    const line = 'A = 10 = 12 mm'
    const match = matchExpressionAssignment(line, 0, line.length)
    expect(match?.form).toBe('redundant')
    expect(match?.inconsistent).toBe(true)
    expect(match?.redundantValues.map((item) => item.text)).toEqual(['10', '12'])
  })

  it('末段没有单位 / 不是 ± 形态：一律返回 null（交回既有解析）', () => {
    for (const line of [
      'A0max = 1753.1 − 759.38 − 765.31',
      'L2 =100+0.2mm',
      'T = T / m= 0.2 / 3 =0.115',
      'A = B = 10 = 12 mm',
    ]) {
      expect(matchExpressionAssignment(line, 0, line.length)).toBeNull()
    }
  })
})

describe('P1 表达式末尾单位：E-01～E-07', () => {
  it('规则版本升到 document-extractor-6（P2 语义变了必须升版）', () => {
    expect(EXTRACTOR_VERSION).toBe('document-extractor-6')
    expect(draftFor(1, 1).extractorVersion).toBe('document-extractor-6')
  })

  it('E-01 末尾等号后的结果值 + 末尾单位：取 228.41 mm，表达式原样保留', () => {
    const draft = draftFor(1, 1)
    const candidate = onlyRing(draft)
    expect(candidate.data.symbol).toBe('A0max')
    expect(candidate.status).toBe('pending')
    expect(candidate.reasonCodes).toEqual([])
    const nominal = field(candidate, 'nominal')
    expect(nominal.text).toBe('228.41')
    expect(nominal.decimals).toBe(2)
    expect(nominal.unitText).toBe('mm')
    expect(nominal.unit).toBe('mm')
    expect(nominal.valueQ).toBe(2284100)
    // 不做算术求值：中间表达式只作原文字符串保留，且没有被算出的数替换。
    expect(candidate.rawText).toContain('1753.1')
    expect(candidate.rawText).toContain('759.38')
    expect(candidate.rawText).toContain('765.31')
    expect(candidate.rawText).toContain('228.41')
    expect(nominal.text).not.toBe('228.409999')

    // 单位归属写进出处：末尾那段单位文字自己的文本项，位置在被采用的数值右侧。
    const unitEvidence = evidenceCiting(candidate, 'mm')
    expect(unitEvidence).toBeDefined()
    expect(unitEvidence?.page).toBe(1)
    expect(unitEvidence?.normalizedSnippet.trim()).toBe('mm')
    const nominalEvidence = evidenceCiting(candidate, '228.41')
    expect(nominalEvidence).toBeDefined()
    expect(unitEvidence!.rectPdf[0]).toBeGreaterThan(nominalEvidence!.rectPdf[0])
    expect(unitEvidence!.textItemIndexes).not.toEqual(nominalEvidence!.textItemIndexes)
    expect(candidate.confidenceBasis).toContain('RULE_UNIT_EXPRESSION_TAIL')
  })

  it('E-02 `A = 230 ± 0.3 mm`：基本尺寸 230、上下偏差 ±0.3、单位 mm', () => {
    const draft = draftFor(2, 2)
    const candidate = onlyRing(draft)
    expect(candidate.data.symbol).toBe('A')
    expect(candidate.status).toBe('pending')
    expect(candidate.reasonCodes).toEqual([])
    const nominal = field(candidate, 'nominal')
    expect(nominal.text).toBe('230')
    expect(nominal.valueQ).toBe(2300000)
    expect(nominal.unit).toBe('mm')
    const upper = field(candidate, 'upperDeviation')
    const lower = field(candidate, 'lowerDeviation')
    expect(upper.text).toBe('+0.3')
    expect(upper.valueQ).toBe(3000)
    expect(lower.text).toBe('-0.3')
    expect(lower.valueQ).toBe(-3000)
    // 偏差出处覆盖同一枚显式记号 `±0.3`。
    expect(upper.evidence.map((item) => item.normalizedSnippet).join('|')).toContain('±')
    expect(evidenceCiting(candidate, 'mm')?.page).toBe(2)
    expect(candidate.confidenceBasis).toContain('RULE_ASSIGNMENT_PM_DEVIATION')
  })

  it('E-03 `T0 = +0.3 − (−0.3) = 0.6 mm`：取 0.6 mm，括号负数不当两个值', () => {
    const draft = draftFor(3, 3)
    const candidate = onlyRing(draft)
    expect(candidate.data.symbol).toBe('T0')
    expect(candidate.status).toBe('pending')
    expect(candidate.reasonCodes).toEqual([])
    const nominal = field(candidate, 'nominal')
    expect(nominal.text).toBe('0.6')
    expect(nominal.valueQ).toBe(6000)
    expect(nominal.unit).toBe('mm')
    // 括号里的 −0.3 没有变成一个偏差值，也没有多出一条候选。
    expect(candidate.data.upperDeviation).toBeNull()
    expect(candidate.data.lowerDeviation).toBeNull()
    expect(rings(draft)).toHaveLength(1)
    expect(evidenceCiting(candidate, 'mm')?.page).toBe(3)
  })

  it('E-04 `A = 10 = 12 mm`：INCONSISTENT_REDUNDANT_VALUE 阻塞，不挑一个', () => {
    const draft = draftFor(4, 4)
    const candidate = onlyRing(draft)
    expect(candidate.status).toBe('blocked')
    expect(candidate.reasonCodes).toContain('INCONSISTENT_REDUNDANT_VALUE')
    const nominal = field(candidate, 'nominal')
    expect(nominal.unit).toBeNull()
    expect(nominal.valueQ).toBeNull()
    const issue = draft.issues.find((item) => item.code === 'INCONSISTENT_REDUNDANT_VALUE')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('blocked')
    expect(issue?.message).toContain('10')
    expect(issue?.message).toContain('12')
    expect(issue?.message).toContain('未挑其中一个值')
    expect(issue?.candidateIds).toContain(candidate.candidateId)
    expect(draft.candidates.some((item) => item.status === 'pending')).toBe(false)
  })

  it('E-05 无单位表达式：仍 UNKNOWN_UNIT（不因新规则放宽）', () => {
    const draft = draftFor(5, 5)
    const candidate = onlyRing(draft)
    expect(candidate.status).toBe('blocked')
    expect(candidate.reasonCodes).toEqual(['UNKNOWN_UNIT'])
    const nominal = field(candidate, 'nominal')
    expect(nominal.unit).toBeNull()
    expect(nominal.valueQ).toBeNull()
    expect(candidate.confidenceBasis).not.toContain('RULE_UNIT_EXPRESSION_TAIL')
  })

  it('E-06 无单位但页内「单位：mm」：走 P0 继承（回归保护）', () => {
    const draft = draftFor(6, 6)
    const candidate = onlyRing(draft)
    expect(candidate.status).toBe('pending')
    expect(candidate.reasonCodes).toEqual([])
    const nominal = field(candidate, 'nominal')
    expect(nominal.text).toBe('230')
    expect(nominal.unit).toBe('mm')
    expect(nominal.valueQ).toBe(2300000)
    expect(
      candidate.confidenceBasis.some((basis) => basis.startsWith('RULE_UNIT_INHERITED_')),
    ).toBe(true)
    expect(evidenceCiting(candidate, '单位:mm')?.page).toBe(6)
  })

  it('E-07 `i = 0` / `i = 1` 下标片段：不当尺寸候选（回归保护）', () => {
    const draft = draftFor(7, 7)
    expect(draft.candidates).toHaveLength(0)
    expect(draft.candidates.some((candidate) => candidate.kind === 'ring' && candidate.data.symbol === 'i')).toBe(
      false,
    )
  })

  it('每个数值字段的每条出处都过 isEvidenceComplete，且页码落在请求范围内（1–7 页逐页）', () => {
    for (let page = 1; page <= 7; page += 1) {
      const draft = draftFor(page, page)
      for (const candidate of draft.candidates) {
        const fields = candidateNumericFields(candidate)
        expect(fields.length).toBeGreaterThan(0)
        for (const { value } of fields) {
          expect(value.evidence.length).toBeGreaterThan(0)
          for (const evidence of value.evidence) {
            expect(isEvidenceComplete(evidence)).toBe(true)
            expect(evidence.page).toBe(page)
          }
        }
        for (const evidence of candidate.evidence) {
          expect(isEvidenceComplete(evidence)).toBe(true)
          expect(evidence.page).toBe(page)
        }
      }
    }
    expect(pageCount).toBe(7)
  })
})
