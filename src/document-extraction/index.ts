/**
 * V3.6 阶段 1 公共入口：领域提取器 + 候选模型 + 人工确认契约。
 *
 * 使用顺序（第 2 阶段由 main/IPC 接线，本阶段只有纯函数）：
 *   buildExtractionDraft(request) → 待确认草稿
 *   confirmCandidate / rejectCandidate / editCandidateField → 逐条决定
 *   planApplication → 只生成映射计划（applied:false），不写项目
 *
 * 本模块不写盘、不提交、不调用计算。
 */
export {
  EXTRACTOR_VERSION,
  MAX_EXTRACTION_CANDIDATES,
  MAX_EXTRACTION_ISSUES,
  MAX_EXTRACTION_PAGES,
  candidateNumericFields,
  candidateValueSnapshot,
  evidenceKey,
  extractionFailure,
  extractionSuccess,
  isEvidenceComplete,
  uniqueEvidence,
  type CandidateStatus,
  type DecisionAction,
  type ExtractionCandidate,
  type ExtractionDecision,
  type ExtractionDraft,
  type ExtractionErrorCode,
  type ExtractionEvidence,
  type ExtractionIssue,
  type ExtractionIssueCode,
  type ExtractionKind,
  type ExtractionPageRange,
  type ExtractionReasonCode,
  type ExtractionResult,
  type ExtractionSourceIdentity,
  type FormulaCandidateData,
  type FormulaOperand,
  type IntervalCandidateData,
  type PartDimensionData,
  type QuantityValue,
  type RingCandidateData,
} from './types'
export { buildExtractionDraft, evidenceFromSpan, matchTextOf, type ExtractionRequest } from './parse'
export {
  buildPdfTextLayer,
  isRadicalCodePoint,
  itemRectPdf,
  normalizeExtractionText,
  type PdfTextItem,
  type PdfTextLayer,
  type PdfTextLine,
  type PdfTextPage,
  type RawPdfTextItem,
  type RawPdfTextPage,
  type TextLineSpan,
} from './textLayer'
export {
  confirmCandidate,
  editCandidateField,
  findCandidate,
  mergeExtractionDraft,
  planApplication,
  rejectCandidate,
  type ApplicationPlan,
  type ApplicationPlanItem,
  type ConfirmRequest,
  type EditableField,
  type EditRequest,
  type PlanRequest,
  type RejectRequest,
} from './draft'
export { stableHash, stableId } from './ids'
