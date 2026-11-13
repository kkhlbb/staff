// @vitest-environment node
/**
 * P2 公式行里的显式末尾值（`document-extractor-5`）：F-01～F-07。
 *
 * 背景（诊断见 docs/evidence/extract-formula/README.md）：真实语料里 45 条
 * `FORMULA_UNSUPPORTED` 中，有 16 行原文已经写出「符号 = 表达式 = 数值 单位」的结果值，
 * 却先被 `parseFormulaLine` 当成“无法解析的公式”拦下。本任务只做两件事：
 * 1. 形态 1 的中间式不再限定“纯加减”（允许字母/乘除/括号），被采用的仍是末尾**显式**值；
 * 2. 带显式末尾值的行按赋值行解析，不再被公式分支抢先。
 *
 * 七条硬性期望：
 * - F-01 `B1 = B1 + B1under = 135 + 250/2 = 260 mm` → 取 260 mm，中间式原样保留（不求值）；
 * - F-02 `Zmax=5.2+0.1-4.9=0.4mm)` → 取 0.4 mm（行内有右括号也不再被公式分支拦下）；
 * - F-03 `Δ0=[0.1+(−0.1)]/2=0mm` → 希腊字母符号 + 括号负数，取 0 mm；
 * - F-04 `EI0=…−0.07mm.It can be seen B1=260±0.07mm` → 中间夹着第二处赋值，**仍阻塞**；
 * - F-05 `A = B = 10 = 12 mm` → 符号链，形态匹配仍返回 null（交回既有解析）；
 * - F-06 `ES2=Δ2+T2/2=0+0.06/2=0.03` → 末尾没有单位，**仍 FORMULA_UNSUPPORTED**；
 * - F-07 `B1=…=238.1mm, B2=…=32.5mm` → 一个逗号行两条赋值，各自取显式值。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { lineMatchesAssignmentForm, matchExpressionAssignment } from '../expressionUnits'
import { buildExtractionDraft } from '../parse'
import { buildPdfTextLayer, type PdfTextLayer } from '../textLayer'
import {
  EXTRACTOR_VERSION,
  candidateNumericFields,
  isEvidenceComplete,
  type ExtractionCandidate,
  type ExtractionDraft,
  type ExtractionSourceIdentity,
} from '../types'
import { fixtureSha256, readPdfTextPages } from './helpers/pdfFixture'

const FIXTURE = 'formula-form-sample.pdf'

let layer: PdfTextLayer
let source: ExtractionSourceIdentity
let pageCount: number

beforeAll(async () => {
  const result = await readPdfTextPages(FIXTURE)
  layer = buildPdfTextLayer(result.pages)
  pageCount = result.pageCount
  source = {
    documentId: 'doc-formula-form',
    revisionId: 'rev-formula-form',
    sha256: fixtureSha256(FIXTURE),
    blobKey: 'blob-formula-form',
    pageCount,
  }
})

function draftFor(from: number, to: number): ExtractionDraft {
  return buildExtractionDraft({
    projectId: 'project-formula-form',
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

function ringBySymbol(draft: ExtractionDraft, symbol: string): RingCandidate {
  const list = rings(draft).filter((candidate) => candidate.data.symbol === symbol)
  if (list.length !== 1) throw new Error(`期望符号 ${symbol} 恰好一条组成环候选，实际 ${list.length} 条`)
  return list[0]
}

function evidenceCiting(candidate: ExtractionCandidate, snippet: string) {
  return candidate.evidence.find((item) => item.normalizedSnippet.includes(snippet))
}

describe('形态匹配（纯函数）', () => {
  it('F-01 中间式含字母与除号：取末尾显式值，表达式区间覆盖原文', () => {
    const line = 'B1=B1+B1under=135+250/2=260 mm'
    const match = matchExpressionAssignment(line, 0, line.length)
    expect(match?.form).toBe('redundant')
    expect(match?.symbol.text).toBe('B1')
    expect(match?.nominal.text).toBe('260')
    expect(match?.unit.text).toBe('mm')
    expect(match?.inconsistent).toBe(false)
    // 中间式原样保留（含 `=`），且区间切片必须落回原文，不能串位。
    expect(match?.expression?.text).toBe('B1+B1under=135+250/2')
    for (const span of [match!.symbol, match!.nominal, match!.unit, match!.expression!]) {
      expect(line.slice(span.start, span.end)).toBe(span.text)
    }
  })

  it('F-03 希腊字母符号：`Δ0` 与 `B1` 一样是符号位', () => {
    const line = 'Δ0=[0.1+(−0.1)]/2=0mm'
    const match = matchExpressionAssignment(line, 0, line.length)
    expect(match?.form).toBe('redundant')
    expect(match?.symbol.text).toBe('Δ0')
    expect(match?.nominal.text).toBe('0')
    expect(match?.unit.text).toBe('mm')
  })

  it('F-05 符号链 `A = B = 10 = 12 mm`：仍返回 null，交回既有解析', () => {
    const line = 'A = B = 10 = 12 mm'
    expect(matchExpressionAssignment(line, 0, line.length)).toBeNull()
  })

  it('F-04 中间夹着第二处赋值（中间块出现单位）：返回 null，不把末尾值挂到前一个符号上', () => {
    for (const line of [
      'EI0=Δ0-T0/2=0-0.135/2=-0.07mm.It can be seen B1=260±0.07mm',
      'EI0=Δ0-T0/2=0-0.135/2=-0.07米',
    ]) {
      expect(matchExpressionAssignment(line, 0, line.length)).toBeNull()
    }
  })

  it('F-06 末尾不是「数值+单位」：返回 null（不放宽成可以取值）', () => {
    for (const line of ['ES2=Δ2+T2/2=0+0.06/2=0.03', 'T = T / m= 0.2 / 3 =0.115']) {
      expect(matchExpressionAssignment(line, 0, line.length)).toBeNull()
    }
  })

  it('lineMatchesAssignmentForm：只认“有显式单位尾巴”的赋值行，纯符号式不认', () => {
    expect(lineMatchesAssignmentForm('Zmax=5.2+0.1-4.9=0.4mm)')).toBe(true)
    expect(lineMatchesAssignmentForm('B1=(125×COS10°+230/2)=238.1mm, B2=32.5mm')).toBe(true)
    expect(lineMatchesAssignmentForm('x = ( rp+ lrp) sin - asin ( za ) + ( rrp+ lrrp) ×')).toBe(false)
    expect(lineMatchesAssignmentForm('0=+0.3-(-0.3)=0.6mm')).toBe(false)
  })
})

describe('P2 公式行显式末尾值：F-01～F-07', () => {
  it('规则版本升到 document-extractor-8（语义变了必须升版）', () => {
    expect(EXTRACTOR_VERSION).toBe('document-extractor-8')
    expect(draftFor(1, 1).extractorVersion).toBe('document-extractor-8')
  })

  it('F-01 中间式含字母/除号：取 260 mm，中间式原样保留（不计算）', () => {
    const draft = draftFor(1, 1)
    const candidate = ringBySymbol(draft, 'B1')
    expect(candidate.status).toBe('pending')
    expect(candidate.reasonCodes).toEqual([])
    const nominal = candidate.data.nominal!
    expect(nominal.text).toBe('260')
    expect(nominal.unit).toBe('mm')
    expect(nominal.valueQ).toBe(2600000)
    // 不做算术求值：中间式里的数字与运算符原样留在 rawText 与出处里。
    expect(candidate.rawText).toContain('135 + 250/2')
    expect(candidate.rawText).toContain('B1under')
    expect(candidate.confidenceBasis).toContain('RULE_UNIT_EXPRESSION_TAIL')
    const unitEvidence = evidenceCiting(candidate, 'mm')
    const nominalEvidence = evidenceCiting(candidate, '260')
    expect(unitEvidence?.page).toBe(1)
    expect(nominalEvidence?.page).toBe(1)
    expect(unitEvidence!.rectPdf[0]).toBeGreaterThan(nominalEvidence!.rectPdf[0])
    expect(unitEvidence!.textItemIndexes).not.toEqual(nominalEvidence!.textItemIndexes)
    expect(draft.candidates.some((item) => item.kind === 'formula')).toBe(false)
  })

  it('F-02 行内有右括号：不再被公式分支抢先，取 0.4 mm', () => {
    const draft = draftFor(2, 2)
    const candidate = ringBySymbol(draft, 'Zmax')
    expect(candidate.status).toBe('pending')
    expect(candidate.reasonCodes).toEqual([])
    expect(candidate.data.nominal?.text).toBe('0.4')
    expect(candidate.data.nominal?.valueQ).toBe(4000)
    expect(candidate.rawText).toContain('5.2+0.1-4.9')
    // 关键回归：这条以前是 blocked + FORMULA_UNSUPPORTED。
    expect(draft.candidates.some((item) => item.reasonCodes.includes('FORMULA_UNSUPPORTED'))).toBe(false)
  })

  it('F-03 希腊字母符号：Δ0 = 0 mm 且符号保留原样', () => {
    const draft = draftFor(3, 3)
    const candidate = ringBySymbol(draft, 'Δ0')
    expect(candidate.status).toBe('pending')
    expect(candidate.data.nominal?.text).toBe('0')
    expect(candidate.data.nominal?.valueQ).toBe(0)
    expect(candidate.data.nominal?.unit).toBe('mm')
    expect(evidenceCiting(candidate, 'Δ0')?.page).toBe(3)
  })

  it('F-04 中间夹着第二处赋值：整行仍阻塞，260 不会挂到 EI0 头上', () => {
    const draft = draftFor(4, 4)
    expect(rings(draft)).toHaveLength(0)
    const formulas = draft.candidates.filter((item) => item.kind === 'formula')
    expect(formulas).toHaveLength(1)
    expect(formulas[0].status).toBe('blocked')
    expect(formulas[0].reasonCodes).toEqual(['FORMULA_UNSUPPORTED'])
    expect(draft.candidates.some((item) => item.status === 'pending')).toBe(false)
  })

  it('F-05 符号链：逐符号按既有解析取值，形态匹配不接管', () => {
    const draft = draftFor(5, 5)
    expect(rings(draft).map((candidate) => candidate.data.symbol).sort()).toEqual(['A', 'B'])
    for (const candidate of rings(draft)) expect(candidate.data.symbol).not.toBe('Δ0')
  })

  it('F-06 末尾没有单位：仍 FORMULA_UNSUPPORTED（不放宽）', () => {
    const draft = draftFor(6, 6)
    expect(rings(draft)).toHaveLength(0)
    expect(draft.candidates).toHaveLength(1)
    expect(draft.candidates[0].kind).toBe('formula')
    expect(draft.candidates[0].reasonCodes).toEqual(['FORMULA_UNSUPPORTED'])
    expect(draft.candidates[0].status).toBe('blocked')
  })

  it('F-07 一个逗号行两条赋值：B1 / B2 各自取显式值', () => {
    const draft = draftFor(7, 7)
    expect(rings(draft)).toHaveLength(2)
    const b1 = ringBySymbol(draft, 'B1')
    const b2 = ringBySymbol(draft, 'B2')
    expect(b1.data.nominal?.text).toBe('238.1')
    expect(b1.data.nominal?.valueQ).toBe(2381000)
    expect(b2.data.nominal?.text).toBe('32.5')
    expect(b2.data.nominal?.valueQ).toBe(325000)
    expect([b1.status, b2.status]).toEqual(['pending', 'pending'])
  })

  it('每个数值字段的每条出处都过 isEvidenceComplete，且页码落在请求范围内（1–7 页逐页）', () => {
    for (let page = 1; page <= 7; page += 1) {
      const draft = draftFor(page, page)
      for (const candidate of draft.candidates) {
        const fields = candidateNumericFields(candidate)
        for (const { value } of fields) {
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
