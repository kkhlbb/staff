/**
 * 工具 `read_taskbook`：读本地 PDF 文本层，输出候选与阻塞项（只读）。
 *
 * 复用产品同一条提取链：`pdfTextExtract`（pdfjs legacy）→ `buildPdfTextLayer`
 * → `buildExtractionDraft`（document-extractor-6）。出处是否完整只由
 * `isProvenanceCompleteness` 判定；本文件不另写校验、不猜页码/选区。
 *
 * 不写文件、不确认候选、不建项目——只是把“机器读到了什么、卡在哪”原样交出去。
 */
import { readFile, stat } from 'node:fs/promises'
import { buildExtractionDraft } from '../../src/document-extraction/parse'
import { buildPdfTextLayer, type RawPdfTextPage } from '../../src/document-extraction/textLayer'
import {
  MAX_EXTRACTION_PAGES,
  candidateNumericFields,
  candidateProvenance,
  evidenceRefKind,
  isProvenanceCompleteness,
  valueProvenance,
  type EvidenceRef,
  type ExtractionCandidate,
} from '../../src/document-extraction/types'
import { inspectSourcePdf } from '../../desktop/main/pdfSourceInspect'
import { extractPdfTextPages } from '../../desktop/main/pdfTextExtract'
import {
  asObject,
  readInteger,
  readString,
  requireAbsolutePath,
  ToolInputError,
} from '../lib/args'
import { mm, sha256, success } from '../lib/format'

const MAX_PAGES_READ = 1000
const PAGE_LIMIT = 200

export const readTaskbookDefinition = {
  name: 'read_taskbook',
  title: '读任务书 PDF（候选 + 阻塞项）',
  description:
    '读本地带文本层 PDF 的指定页范围，输出候选（kind/符号/数值 q/单位/出处{页,选区,原文}）与阻塞项（原因码 + 人话）。只读：不写文件、不确认候选、不建项目。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      pdfPath: { type: 'string', description: 'PDF 绝对路径（只支持文本层，不做 OCR）。' },
      pageFrom: { type: 'integer', minimum: 1, maximum: MAX_PAGES_READ },
      pageTo: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_PAGES_READ,
        description: `可选；缺省为 pageFrom 起最多 ${MAX_EXTRACTION_PAGES} 页（提取器单块上限，超过自动切块）。`,
      },
    },
    required: ['pdfPath'],
  },
} as const

function symbolOf(candidate: ExtractionCandidate): string | null {
  switch (candidate.kind) {
    case 'ring':
      return candidate.data.symbol
    case 'interval':
      return candidate.data.outputSymbol
    case 'formula':
      return candidate.data.outputSymbol
    case 'part-dimension':
      return candidate.data.partName
  }
}

function provenanceView(ref: EvidenceRef): Record<string, unknown> {
  const kind = evidenceRefKind(ref)
  const complete = isProvenanceCompleteness(ref)
  if (kind === 'user-attestation') {
    const attestation = ref as Extract<EvidenceRef, { kind: 'user-attestation' }>
    return {
      kind,
      complete,
      actorId: attestation.actorId,
      at: attestation.at,
      sessionSeq: attestation.sessionSeq,
      sessionLabel: attestation.sessionLabel,
      fieldPath: attestation.fieldPath,
      statement: attestation.statement,
    }
  }
  if (kind === 'image-ocr') {
    const image = ref as Extract<EvidenceRef, { kind: 'image-ocr' }>
    return {
      kind,
      complete,
      imageId: image.imageId,
      sha256: image.sha256,
      fileName: image.fileName,
      rectPdf: image.rectPdf,
      confidence: image.confidence,
      recognizedText: image.recognizedText.slice(0, 160),
    }
  }
  const anchored = ref as Extract<EvidenceRef, { page: number }>
  return {
    kind,
    complete,
    documentId: anchored.documentId,
    revisionId: anchored.revisionId,
    sha256: anchored.sha256,
    blobKey: anchored.blobKey,
    page: anchored.page,
    rectPdf: anchored.rectPdf,
    pageBoxPdf: anchored.pageBoxPdf,
    textSnippet: anchored.textSnippet.slice(0, 160),
  }
}

function candidateView(candidate: ExtractionCandidate): Record<string, unknown> {
  const values = candidateNumericFields(candidate).map(({ field, value }) => {
    const provenance = valueProvenance(value)
    return {
      field,
      text: value.text,
      decimals: value.decimals,
      valueQ: value.valueQ,
      valueMm: value.valueQ === null ? null : mm(value.valueQ),
      unitText: value.unitText,
      unit: value.unit,
      provenance: provenance.map(provenanceView),
      provenanceComplete: provenance.length > 0 && provenance.every(isProvenanceCompleteness),
    }
  })
  return {
    candidateId: candidate.candidateId,
    kind: candidate.kind,
    symbol: symbolOf(candidate),
    page: candidate.page,
    status: candidate.status,
    reasonCodes: [...candidate.reasonCodes],
    confidence: candidate.confidence,
    rawText: candidate.rawText.slice(0, 240),
    values,
    provenance: candidateProvenance(candidate).map(provenanceView),
  }
}

export async function runReadTaskbook(rawArguments: unknown): Promise<Record<string, unknown>> {
  const args = asObject(rawArguments ?? {}, 'arguments')
  const pdfPath = requireAbsolutePath(
    readString(args, 'pdfPath', { required: true, maxLength: 1000 })!,
    'pdfPath',
  )
  const pageFrom = readInteger(args, 'pageFrom', { min: 1, max: MAX_PAGES_READ }) ?? 1
  const pageTo = readInteger(args, 'pageTo', { min: 1, max: MAX_PAGES_READ })

  const info = await stat(pdfPath).catch(() => null)
  if (info === null || !info.isFile()) {
    throw new ToolInputError('NOT_FOUND', 'PDF 不存在或不是普通文件', pdfPath)
  }
  const bytes = new Uint8Array(await readFile(pdfPath))
  if (bytes.byteLength === 0) {
    throw new ToolInputError('INVALID_ARGUMENTS', 'PDF 为空（0 字节）', pdfPath)
  }
  const digest = await sha256(bytes)

  const inspection = await inspectSourcePdf(bytes, { maxPages: MAX_PAGES_READ }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    throw new ToolInputError('TOOL_FAILED', `PDF 无法读取：${message}`, pdfPath)
  })
  const pageCount = inspection.pageCount
  if (pageFrom > pageCount) {
    throw new ToolInputError('INVALID_ARGUMENTS', `pageFrom 超出 PDF 页数 ${pageCount}`)
  }
  const to = pageTo ?? Math.min(pageCount, pageFrom + MAX_EXTRACTION_PAGES - 1)
  if (to < pageFrom) {
    throw new ToolInputError('INVALID_ARGUMENTS', 'pageTo 不能小于 pageFrom')
  }
  if (to > pageCount) {
    throw new ToolInputError('INVALID_ARGUMENTS', `pageTo 超出 PDF 页数 ${pageCount}`)
  }
  if (to - pageFrom + 1 > PAGE_LIMIT) {
    throw new ToolInputError(
      'INVALID_ARGUMENTS',
      `一次最多读 ${PAGE_LIMIT} 页；请缩小页范围`,
      `${pageFrom}..${to}`,
    )
  }

  let rawPages: RawPdfTextPage[]
  try {
    rawPages = await extractPdfTextPages(bytes, { from: pageFrom, to })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // 无文本层也照样往下走：候选为 0、阻塞项说明原因，不伪造候选。
    return success('read_taskbook', {
      file: { path: pdfPath, byteSize: bytes.byteLength, sha256: digest },
      pageCount,
      pageRange: { from: pageFrom, to },
      extractorVersion: null,
      draft: null,
      candidates: [],
      blockers: [{ code: 'SOURCE_UNREADABLE', severity: 'blocked', message }],
      readOnly: true,
    })
  }

  const layer = buildPdfTextLayer(rawPages)
  const source = {
    documentId: `mcp-doc-${digest.slice(0, 16)}`,
    revisionId: `mcp-rev-${digest.slice(0, 16)}`,
    sha256: digest,
    blobKey: `mcp-blob-${digest}`,
    pageCount,
  }
  const draft = buildExtractionDraft({
    projectId: 'project-mcp-readonly',
    baseToken: 'mcp-readonly',
    source,
    pageRange: { from: pageFrom, to },
    layer,
  })

  const candidates = draft.candidates.map(candidateView)
  const blockers: {
    code: string
    severity: string
    message: string
    page: number | null
  }[] = draft.issues.map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    page: issue.page,
  }))
  for (const candidate of draft.candidates) {
    const incomplete = candidateNumericFields(candidate).filter(({ value }) => {
      const provenance = valueProvenance(value)
      return provenance.length === 0 || !provenance.every(isProvenanceCompleteness)
    })
    if (incomplete.length > 0) {
      blockers.push({
        code: 'PROVENANCE_INCOMPLETE',
        severity: 'blocked',
        message: `候选 ${String(symbolOf(candidate) ?? candidate.candidateId)} 的 ${incomplete
          .map(({ field }) => field)
          .join('、')} 出处不完整，不能作为确认依据。`,
        page: candidate.page,
      })
    }
  }

  return success('read_taskbook', {
    file: { path: pdfPath, byteSize: bytes.byteLength, sha256: digest },
    pageCount,
    pageRange: { from: pageFrom, to },
    extractorVersion: draft.extractorVersion,
    draft: {
      draftId: draft.draftId,
      idempotencyKey: draft.idempotencyKey,
      status: draft.status,
    },
    counts: {
      candidates: candidates.length,
      blockers: blockers.length,
    },
    candidates,
    blockers,
    readOnly: true,
  })
}
