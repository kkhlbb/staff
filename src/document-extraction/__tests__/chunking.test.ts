// @vitest-environment node
/**
 * L1-a 大文档切块（`document-extractor-6`）：C-01～C-07。
 *
 * 背景（诊断与度量见 docs/evidence/extract-chunking/README.md）：
 * `MAX_EXTRACTION_PAGES = 100`，超过就整份返回 `PAGE_LIMIT` + 0 候选；真实语料 r4
 * （170 页）因此“等于不存在”。本任务把它改成按上限顺序切块、逐块跑同一套逐页扫描
 * 后合并，并且：
 *
 * - 组成环条目跨块合并后统一 resolve，`occurrence` 按**全局出现顺序**编号（1/2、2/2）；
 * - 单块抛错只标 `CHUNK_FAILED` + 页范围，其余块结果保留（不连坐）；
 * - 无文本层的页只在该页标 `NO_TEXT_LAYER`，其余页照常出候选；
 * - 候选/问题排序与两次运行结果完全一致（幂等）；`sourceIdentity` 不因切块变化；
 * - 页跨度不超过上限时只有一块，且不写 CHUNK_* issue（旧行为、旧数字不变）。
 *
 * 这里用**纯数据合成文本层**（不依赖 PDF 夹具）：切块只关心页数组边界，
 * 出处的几何仍由真实的 buildPdfTextLayer / evidenceFromSpan 生成。
 */
import { describe, expect, it } from 'vitest'
import { buildExtractionDraft, type ExtractionRequest } from '../parse'
import {
  buildPdfTextLayer,
  type PdfTextItem,
  type PdfTextLayer,
  type PdfTextPage,
  type RawPdfTextPage,
} from '../textLayer'
import {
  EXTRACTOR_VERSION,
  MAX_EXTRACTION_PAGES,
  isEvidenceComplete,
  type ExtractionCandidate,
  type ExtractionDraft,
  type ExtractionIssue,
  type ExtractionSourceIdentity,
} from '../types'

function makePage(page: number, lines: readonly string[]): RawPdfTextPage {
  return {
    page,
    view: [0, 0, 595, 842],
    items: lines.map((line, index) => ({
      str: line,
      transform: [1, 0, 0, 1, 60, 780 - index * 24],
      width: 320,
      height: 12,
      hasEOL: true,
    })),
  }
}

/** 每页一个独占符号的赋值行（`A001 = 10 mm`）：块内/跨块都不合并，便于数候选。 */
function symbolFor(page: number): string {
  return `A${String(page).padStart(3, '0')}`
}

function assignmentPage(page: number): RawPdfTextPage {
  return makePage(page, [`${symbolFor(page)} = 10 mm`])
}

function layerOf(pages: readonly RawPdfTextPage[]): PdfTextLayer {
  return buildPdfTextLayer(pages)
}

function sourceFor(pageCount: number): ExtractionSourceIdentity {
  return {
    documentId: 'doc-chunk-synthetic',
    revisionId: `rev-chunk-synthetic-${pageCount}`,
    sha256: 'c'.repeat(64),
    blobKey: `blob-chunk-synthetic-${pageCount}`,
    pageCount,
  }
}

function requestOf(
  layer: PdfTextLayer,
  source: ExtractionSourceIdentity,
  from: number,
  to: number,
): ExtractionRequest {
  return {
    projectId: 'project-chunk',
    baseToken: 'base-chunk-1',
    source,
    pageRange: { from, to },
    layer,
  }
}

function build(
  layer: PdfTextLayer,
  source: ExtractionSourceIdentity,
  from: number,
  to: number,
): ExtractionDraft {
  return buildExtractionDraft(requestOf(layer, source, from, to))
}

function chunkIssues(draft: ExtractionDraft): ExtractionIssue[] {
  return draft.issues.filter(
    (item) => item.code === 'CHUNK_PROCESSED' || item.code === 'CHUNK_FAILED',
  )
}

type RingCandidate = ExtractionCandidate & { readonly kind: 'ring' }

function ringCandidates(draft: ExtractionDraft): RingCandidate[] {
  return draft.candidates.filter((candidate): candidate is RingCandidate => candidate.kind === 'ring')
}

describe('L1-a 大文档切块', () => {
  it('C-01 170 页 → 两块合并：候选数 = 两块之和，ID 不撞，块踪迹齐全', () => {
    const pages = Array.from({ length: 170 }, (_, index) => assignmentPage(index + 1))
    const layer = layerOf(pages)
    const source = sourceFor(170)

    const whole = build(layer, source, 1, 170)
    const first = build(layer, source, 1, MAX_EXTRACTION_PAGES)
    const second = build(layer, source, MAX_EXTRACTION_PAGES + 1, 170)

    // 上限仍是 100，但不再整份拒绝。
    expect(MAX_EXTRACTION_PAGES).toBe(100)
    expect(whole.issues.some((item) => item.code === 'PAGE_LIMIT')).toBe(false)
    expect(whole.candidates.length).toBe(170)
    expect(whole.candidates.length).toBe(first.candidates.length + second.candidates.length)
    expect(whole.candidates.every((candidate) => candidate.status === 'pending')).toBe(true)

    // 候选 ID 全局唯一；页码升序（排序稳定）。
    const ids = whole.candidates.map((candidate) => candidate.candidateId)
    expect(new Set(ids).size).toBe(ids.length)
    const pageNumbers = whole.candidates.map((candidate) => candidate.page)
    expect([...pageNumbers].sort((left, right) => left - right)).toEqual(pageNumbers)

    // 每一块都留痕：CHUNK_PROCESSED 带 1-based 页范围。
    const traces = chunkIssues(whole)
    expect(traces.map((item) => item.code)).toEqual(['CHUNK_PROCESSED', 'CHUNK_PROCESSED'])
    expect(traces.map((item) => item.chunk)).toEqual([
      { index: 1, from: 1, to: 100 },
      { index: 2, from: 101, to: 170 },
    ])
    expect(traces.every((item) => item.severity === 'warning')).toBe(true)
    expect(traces[0]?.message).toContain('页 1-100')
    expect(traces[1]?.message).toContain('页 101-170')

    // 切块不改来源身份：仍是原 PDF 的 revisionId + sha256，页范围也仍是请求范围。
    expect(whole.sourceIdentity).toEqual(source)
    expect(whole.pageRange).toEqual({ from: 1, to: 170 })
    expect(whole.extractorVersion).toBe(EXTRACTOR_VERSION)
  })

  it('C-02 中间块抛错 → CHUNK_FAILED 标页范围，其它两块结果照常保留（不连坐）', () => {
    const pages = Array.from({ length: 250 }, (_, index) => assignmentPage(index + 1))
    const cleanLayer = layerOf(pages)
    const corrupted: PdfTextPage[] = cleanLayer.pages.map((page) => {
      if (page.page !== 150) return page
      // 模拟“该页数据损坏”：读 items 时抛错（真实链路里对应 pdfjs 读到坏页）。
      return Object.defineProperty(
        { page: page.page, pageBoxPdf: page.pageBoxPdf, lines: page.lines },
        'items',
        {
          get(): readonly PdfTextItem[] {
            throw new Error('第 150 页文本项损坏（测试注入）')
          },
          enumerable: true,
        },
      ) as PdfTextPage
    })
    const layer: PdfTextLayer = { pages: corrupted }
    const source = sourceFor(250)

    const draft = build(layer, source, 1, 250)

    const failed = draft.issues.filter((item) => item.code === 'CHUNK_FAILED')
    expect(failed).toHaveLength(1)
    expect(failed[0]?.severity).toBe('blocked')
    expect(failed[0]?.chunk).toEqual({ index: 2, from: 101, to: 200 })
    expect(failed[0]?.page).toBe(101)
    expect(failed[0]?.message).toContain('页 101-200')
    expect(failed[0]?.message).toContain('第 150 页文本项损坏')

    // 第 1、3 块照常完成（有 CHUNK_PROCESSED），第 2 块没有完成记录。
    const processed = draft.issues.filter((item) => item.code === 'CHUNK_PROCESSED')
    expect(processed.map((item) => item.chunk)).toEqual([
      { index: 1, from: 1, to: 100 },
      { index: 3, from: 201, to: 250 },
    ])

    // 失败块不留半截结果：候选 = 100 + 50，且没有一条落在 101-200 页。
    expect(draft.candidates).toHaveLength(150)
    expect(
      draft.candidates.every((candidate) => candidate.page < 101 || candidate.page > 200),
    ).toBe(true)
    expect(draft.candidates.some((candidate) => candidate.page === 39)).toBe(true)
    expect(draft.candidates.some((candidate) => candidate.page === 250)).toBe(true)
  })

  it('C-03 某页无文本层 → 只标该页 NO_TEXT_LAYER，其余页照常出候选', () => {
    const pages = Array.from({ length: 150 }, (_, index) =>
      index + 1 === 40 ? makePage(40, []) : assignmentPage(index + 1),
    )
    const draft = build(layerOf(pages), sourceFor(150), 1, 150)

    const noText = draft.issues.filter((item) => item.code === 'NO_TEXT_LAYER')
    expect(noText).toHaveLength(1)
    expect(noText[0]?.page).toBe(40)

    // 40 页两侧的页都正常出候选（跨块边界 100/101 两侧也一样）。
    expect(draft.candidates).toHaveLength(149)
    for (const page of [39, 41, 100, 101, 150]) {
      expect(draft.candidates.some((candidate) => candidate.page === page)).toBe(true)
    }
    // 该页确实没有候选。
    expect(draft.candidates.some((candidate) => candidate.page === 40)).toBe(false)
  })

  it('C-04 同一符号在两块各出现一次 → 全局编号 1/2、2/2，各自带正确页码出处', () => {
    const pages = Array.from({ length: 120 }, (_, index) => {
      const page = index + 1
      if (page === 1) return makePage(page, ['B1 = 130 mm'])
      if (page === 110) return makePage(page, ['B1 = 135 mm'])
      return assignmentPage(page)
    })
    const draft = build(layerOf(pages), sourceFor(120), 1, 120)

    const b1 = ringCandidates(draft).filter(
      (candidate) => candidate.kind === 'ring' && candidate.data.symbol === 'B1',
    )
    expect(b1).toHaveLength(2)
    // 全局出现顺序（不是块内顺序）：第 1 页是 1/2，第 110 页（第二块）是 2/2。
    expect(b1.map((candidate) => ({ page: candidate.page, occurrence: candidate.occurrence }))).toEqual([
      { page: 1, occurrence: { index: 1, total: 2 } },
      { page: 110, occurrence: { index: 2, total: 2 } },
    ])
    // 各自出处指向自己的页，不串位。
    expect(b1[0]?.evidence.every((item) => item.page === 1)).toBe(true)
    expect(b1[1]?.evidence.every((item) => item.page === 110)).toBe(true)
    expect(b1[0]?.data.nominal?.text).toBe('130')
    expect(b1[1]?.data.nominal?.text).toBe('135')
    expect(b1[0]?.candidateId).not.toBe(b1[1]?.candidateId)
    // 同符号多值仍按既有语义逐处候选 + 一条 warning，不择优。
    const ambiguous = draft.issues.find((item) => item.code === 'AMBIGUOUS_ASSIGNMENT')
    expect(ambiguous?.page).toBe(1)
    expect(ambiguous?.candidateIds).toHaveLength(2)
  })

  it('C-05 同一输入连跑两次 → 字节一致（幂等），来源身份不变', () => {
    const build170 = (): ExtractionDraft =>
      build(
        layerOf(Array.from({ length: 170 }, (_, index) => assignmentPage(index + 1))),
        sourceFor(170),
        1,
        170,
      )
    const first = build170()
    const second = build170()

    // 先钉住“确实建了 170 条”，否则两次都整份失败也会“字节一致”。
    expect(first.candidates).toHaveLength(170)
    expect(first.issues.filter((item) => item.code === 'CHUNK_PROCESSED')).toHaveLength(2)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(second.draftId).toBe(first.draftId)
    expect(second.idempotencyKey).toBe(first.idempotencyKey)
    expect(second.sourceIdentity).toEqual(first.sourceIdentity)
    expect(first.sourceIdentity.revisionId).toBe('rev-chunk-synthetic-170')
    expect(first.sourceIdentity.sha256).toBe('c'.repeat(64))
  })

  it('C-06 用户显式页范围优先：81 页只跑一块，不写 CHUNK_*，页范围照旧', () => {
    const pages = Array.from({ length: 170 }, (_, index) => assignmentPage(index + 1))
    const draft = build(layerOf(pages), sourceFor(170), 60, 140)

    expect(draft.pageRange).toEqual({ from: 60, to: 140 })
    expect(draft.candidates).toHaveLength(81)
    expect(chunkIssues(draft)).toHaveLength(0)
    expect(draft.issues.some((item) => item.code === 'PAGE_LIMIT')).toBe(false)
    expect(draft.candidates.every((candidate) => candidate.page >= 60 && candidate.page <= 140)).toBe(
      true,
    )
  })

  it('C-07 切块不等于放宽：块内判据/单位/出处完整性照旧', () => {
    // 无单位行（`D001 = 10`）在切块路径里仍然是 UNKNOWN_UNIT 阻塞，不被“切块”救活。
    const pages = Array.from({ length: 170 }, (_, index) => {
      const page = index + 1
      if (page === 120) return makePage(page, ['D001 = 10'])
      return assignmentPage(page)
    })
    const draft = build(layerOf(pages), sourceFor(170), 1, 170)

    const blocked = ringCandidates(draft).filter(
      (candidate) => candidate.kind === 'ring' && candidate.data.symbol === 'D001',
    )
    expect(blocked).toHaveLength(1)
    expect(blocked[0]?.status).toBe('blocked')
    expect(blocked[0]?.reasonCodes).toContain('UNKNOWN_UNIT')
    expect(blocked[0]?.data.nominal?.unit).toBe(null)
    expect(blocked[0]?.data.nominal?.valueQ).toBe(null)

    // 每个数值字段的每条出处都完整，且页码落在请求范围内（跨块也不越过范围）。
    for (const candidate of draft.candidates) {
      for (const evidence of candidate.evidence) {
        expect(isEvidenceComplete(evidence)).toBe(true)
        expect(evidence.page).toBeGreaterThanOrEqual(1)
        expect(evidence.page).toBeLessThanOrEqual(170)
      }
    }
  })
})
