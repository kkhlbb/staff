/**
 * V3.6 UI 夹具：不读 PDF 的合成任务书文本层 → 真实提取草稿。
 *
 * 用途：renderer 层（jsdom）与证据种子需要“项目文件里已有提取草稿”的场景，
 * 但不必在 jsdom 里跑 pdfjs。这里仍然走真实领域路径：
 * buildPdfTextLayer → buildExtractionDraft（与产品同一条解析规则），
 * 得到 4 条待确认组成环 + 1 条阻塞公式（不支持运算符），不手写候选字段。
 *
 * 合成页只用于测试/证据，不冒充真实任务书样本覆盖范围。
 */
import { buildExtractionDraft } from '../parse'
import { buildPdfTextLayer, type RawPdfTextItem, type RawPdfTextPage } from '../textLayer'
import type { ExtractionDraft, ExtractionSourceIdentity } from '../types'

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792

function line(text: string, y: number): RawPdfTextItem {
  return { str: text, transform: [1, 0, 0, 1, 16, y], width: text.length * 6, height: 12 }
}

/** 一页合成文本：表头 + 4 行组成环（待确认）+ 一条不支持运算符的公式（阻塞）。 */
export function syntheticTaskbookPage(): RawPdfTextPage {
  return {
    page: 1,
    view: [0, 0, PAGE_WIDTH, PAGE_HEIGHT],
    items: [
      line('位号 名称 基本尺寸(mm) 上偏差 下偏差', 700),
      line('H 总长 52.20 +0.02 -0.02', 684),
      line('B1 左轴承 20.00 +0.01 -0.01', 668),
      line('B2 右轴承 20.00 +0.01 -0.01', 652),
      line('S 隔套 12.00 +0.01 -0.01', 636),
      line('C = H × B1', 620),
    ],
  }
}

/** 用合成文本层构建一份真实提取草稿（4 pending + 1 blocked）。 */
export function buildSyntheticExtractionDraft(input: {
  projectId: string
  baseToken: string
  source: ExtractionSourceIdentity
}): ExtractionDraft {
  return buildExtractionDraft({
    projectId: input.projectId,
    baseToken: input.baseToken,
    source: input.source,
    pageRange: { from: 1, to: 1 },
    layer: buildPdfTextLayer([syntheticTaskbookPage()]),
  })
}

export const SYNTHETIC_DRAFT_SOURCE: ExtractionSourceIdentity = {
  documentId: 'doc-1',
  revisionId: 'sr-1',
  sha256: 'a'.repeat(64),
  blobKey: 'blob-1',
  pageCount: 1,
}
