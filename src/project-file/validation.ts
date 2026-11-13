/**
 * `.cunlian` 容器的结构与引用完整性校验（A-02 纯部分）。
 *
 * 校验分三层：
 * 1. 结构：manifest、project、draft、来源/历史记录逐字段解析（zod）；
 * 2. 引用：文档→版本→附件哈希、绑定→版本/页码/几何、快照引用、文件版本父链；
 * 3. 容器：条目集合与 manifest.entries 完全一致、大小与哈希、计数、路径白名单。
 *
 * 保存端与打开端调用同一套函数，避免“能写不能读”的两套规则。
 */
import { z } from 'zod'
import { validateEntryPath } from '../backup/zip'
import { validateChain } from '../domain/validation'
import {
  normalizePdfPageBox,
  validatePdfRect,
  type PdfPageBox,
  type PdfRect,
} from '../sources/pdfCoordinates'
import {
  ATTACHMENT_EXTENSION,
  ATTACHMENT_PATH_PREFIX,
  B2_PROJECT_FILE_SCHEMA_VERSION,
  C_PROJECT_FILE_SCHEMA_VERSION,
  D_PROJECT_FILE_SCHEMA_VERSION,
  DIMENSION_CHAIN_SCHEMA_VERSION,
  LEGACY_PROJECT_FILE_SCHEMA_VERSION,
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_MAX_PATH_LENGTH,
  PROJECT_FILE_PATHS,
  PROJECT_FILE_SCHEMA_VERSION,
  REVISION_EXTENSION,
  V35_PROJECT_FILE_SCHEMA_VERSION,
  V36_PROJECT_FILE_SCHEMA_VERSION,
  V9_PROJECT_FILE_SCHEMA_VERSION,
  REVISION_PATH_PREFIX,
  type ProjectFileAttachmentInput,
  type ProjectFileAttachmentRef,
  type ProjectFileCounts,
  type ProjectFileEntry,
  type ProjectFileEntryRole,
  type ProjectFileError,
  type ProjectFileManifest,
  type ProjectFileMissingAttachment,
  type ProjectFileProject,
  type ProjectFileProjectV1,
  type ProjectFileProjectV2,
  type ProjectFileProjectV5,
  type ProjectFileProjectV6,
  type ProjectFileProjectV7,
  type ProjectFileProjectV8,
  type ProjectFileProjectV9,
  type ProjectFileResult,
  type ProjectFileRevision,
  type ProjectFileSnapshot,
} from './types'
import {
  REQUIREMENT_CHECK_STATUSES,
  REQUIREMENT_REASON_CODES,
} from '../requirements/types'
import { PROJECT_ASSETS_MAX_BYTES, sumUniqueBlobBytes } from '../parts/stlLimits'
import { buildSpacerDrawing, DrawingBuildError } from '../drawing/spacerDrawing'
import { SPACER_PART_ID } from '../drawing/types'
import { validateSpacerParameterSnapshot } from '../parts/spacerParameters'
import {
  CONFIDENCE_LEVELS,
  EXTRACTION_ISSUE_CODES,
  EXTRACTION_REASON_CODES,
  candidateNumericFields,
  candidateValueSnapshot,
  isProvenanceCompleteness,
  valueProvenance,
  type ExtractionCandidate,
  type ExtractionDecision,
  type ExtractionDraft,
  type ExtractionEvidence,
  type QuantityValue,
} from '../document-extraction/types'

const SHA256_PATTERN = /^[0-9a-f]{64}$/

export function isSha256Hex(value: string): boolean {
  return SHA256_PATTERN.test(value)
}

export function ok<T>(value: T): ProjectFileResult<T> {
  return { ok: true, value }
}

export function fail<T>(
  code: ProjectFileError['code'],
  message: string,
  detail?: string,
): ProjectFileResult<T> {
  return detail === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, detail } }
}

export function attachmentEntryPath(blobKey: string): string {
  return `${ATTACHMENT_PATH_PREFIX}${encodeURIComponent(blobKey)}${ATTACHMENT_EXTENSION}`
}

export function revisionEntryPath(revisionId: string): string {
  return `${REVISION_PATH_PREFIX}${encodeURIComponent(revisionId)}${REVISION_EXTENSION}`
}

/** 与 sources/bindings.ts 的 validateBindingRegion 等价；这里只用纯 pdfCoordinates。 */
export function validateBindingRegion(
  pageBoxPdf: PdfPageBox,
  rectPdf: PdfRect,
): string | null {
  if (normalizePdfPageBox(pageBoxPdf) === null) {
    return '页面边界无效'
  }
  if (rectPdf.length !== 4) {
    return '矩形坐标必须是 4 个有限数值'
  }
  return validatePdfRect(rectPdf, pageBoxPdf)
}

/* ------------------------------------------------------------------ */
/* zod 结构 schema                                                      */
/* ------------------------------------------------------------------ */

const idSchema = z.string().min(1).max(240)
const sha256Schema = z.string().regex(SHA256_PATTERN)
const coords4Schema = z.tuple([z.number(), z.number(), z.number(), z.number()])
const nonNegativeInt = z.number().int().nonnegative()

const boundsSchema = z
  .tuple([z.number(), z.number(), z.number()])
  .refine((values) => values.every((value) => Number.isFinite(value)), { message: '包围盒必须是有限数值' })

const partSchema = z
  .object({
    partId: idSchema,
    kind: z.enum(['imported-mesh', 'builtin-demo']),
    name: z.string().min(1).max(200),
    currentModelRevisionId: idSchema.nullable(),
    origin: z.enum(['stl-import', 'builtin']),
  })
  .strict()

const modelRevisionSchema = z
  .object({
    modelRevisionId: idSchema,
    partId: idSchema,
    kind: z.literal('stl'),
    parentModelRevisionId: idSchema.nullable(),
    createdAt: z.string().min(1),
    reason: z.string().max(200),
    fileName: z.string().min(1).max(400),
    blobKey: idSchema,
    attachmentSha256: sha256Schema,
    byteSize: nonNegativeInt,
    encoding: z.enum(['binary', 'ascii']),
    triangleCount: z.number().int().positive(),
    bounds: z
      .object({ min: boundsSchema, max: boundsSchema })
      .strict()
      .refine(
        (bounds) =>
          [0, 1, 2].every((axis) => bounds.min[axis] <= bounds.max[axis]),
        { message: '包围盒 min 必须不大于 max' },
      ),
    unitNote: z.string().max(200),
  })
  .strict()

const visualReferenceSchema = z
  .object({
    kind: z.literal('visual-reference'),
    linkId: idSchema,
    termId: idSchema,
    target: z
      .object({
        granularity: z.enum(['model', 'part']),
        partId: idSchema,
        modelRevisionId: idSchema.nullable(),
      })
      .strict(),
    reviewStatus: z.enum(['pending', 'confirmed']),
    reviewedModelRevisionId: idSchema.nullable(),
    reviewedAt: z.string().min(1).nullable(),
    reason: z.string().max(200),
  })
  .strict()
  .refine(
    (link) =>
      link.reviewStatus !== 'confirmed' ||
      (link.reviewedModelRevisionId !== null && link.reviewedAt !== null),
    { message: '已确认的关联必须带确认版本与时间' },
  )

/** D：参数绑定；syncField 固定 nominal，没有“已确认”布尔。 */
const parameterBindingSchema = z
  .object({
    kind: z.literal('parameter-binding'),
    bindingId: idSchema,
    termId: idSchema,
    partId: idSchema,
    parameterId: idSchema,
    syncField: z.literal('nominal'),
    createdAt: z.string().min(1),
  })
  .strict()

const projectCommonShape = {
  id: idSchema,
  name: z.string().min(1).max(200),
  currentRevisionId: idSchema,
  dimensionChain: z.unknown(),
  engineVersion: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  relationRevision: nonNegativeInt,
  relationReview: z
    .object({
      relationRevision: nonNegativeInt,
      fingerprint: z.string().min(1),
      confirmedAt: z.string().min(1),
    })
    .strict()
    .nullable(),
  migration: z.unknown().nullable(),
  baseline: z
    .object({ savedAt: z.string().min(1), definition: z.unknown() })
    .strict()
    .nullable(),
} as const

/** B1 及更早：schema3，五个预留数组必须为空。 */
const projectV1Schema = z
  .object({
    ...projectCommonShape,
    schemaVersion: z.literal(LEGACY_PROJECT_FILE_SCHEMA_VERSION),
    parts: z.array(z.unknown()).max(0),
    parameters: z.array(z.unknown()).max(0),
    modelRevisions: z.array(z.unknown()).max(0),
    dimensionLinks: z.array(z.unknown()).max(0),
    drawings: z.array(z.unknown()).max(0),
  })
  .strict()

/** B2：schema4，模型/版本/可视关联使用严格类型；参数与图纸仍必须为空。 */
const projectV2Schema = z
  .object({
    ...projectCommonShape,
    schemaVersion: z.literal(B2_PROJECT_FILE_SCHEMA_VERSION),
    sourceFormatVersion: z.union([z.literal(1), z.literal(2)]),
    parts: z.array(partSchema),
    parameters: z.array(z.unknown()).max(0),
    modelRevisions: z.array(modelRevisionSchema),
    dimensionLinks: z.array(visualReferenceSchema),
    drawings: z.array(z.unknown()).max(0),
  })
  .strict()

/** C：schema5 的隔套参数；q 为正安全整数，有效位 0..4。 */
const spacerParameterV5Schema = z
  .object({
    parameterId: idSchema,
    partId: idSchema,
    key: z.enum(['innerDiameter', 'outerDiameter', 'length']),
    valueQ: z.number().int().positive(),
    inputDecimals: z.number().int().min(0).max(4),
    reviewStatus: z.enum(['draft', 'pending', 'confirmed']),
    sourceNote: z.string().max(2000).optional(),
    provenance: z.lazy(() => z.array(provenanceRefSchema).min(1).max(64)).optional(),
  })
  .strict()

/** D：schema6 参数带单调 parameterRevision（从 1 起）。 */
const spacerParameterSchema = spacerParameterV5Schema
  .extend({ parameterRevision: z.number().int().positive() })
  .strict()

const drawingFrameFieldsSchema = z
  .object({
    partName: z.string().max(200),
    drawingNumber: z.string().max(200),
    version: z.string().max(200),
    drawingDate: z.string().max(200).optional(),
    material: z.string().max(200),
    tolerance: z.string().max(200),
    surface: z.string().max(200),
    drafter: z.string().max(200),
    date: z.string().max(200),
    /** schema 10：依据栏；有来源项目为空/缺省，不新增标题栏行。 */
    basis: z.string().max(200).optional(),
  })
  .strict()

/** C：schema5 的图纸快照引用；不存整份图元数组。 */
const drawingRecordSchema = z
  .object({
    drawingId: idSchema,
    drawingDataVersion: z.literal(1),
    templateId: z.literal('spacer-a4-landscape'),
    templateVersion: z.number().int().positive(),
    partId: idSchema,
    revisionId: idSchema,
    parameterIds: z.array(idSchema).length(3),
    paper: z
      .object({
        format: z.literal('A4'),
        orientation: z.literal('landscape'),
        widthMm: z.literal(297),
        heightMm: z.literal(210),
      })
      .strict(),
    scale: z
      .object({
        numerator: z.number().int().positive(),
        denominator: z.number().int().positive(),
      })
      .strict()
      .refine(
        (scale) =>
          [
            '2:1',
            '1:1',
            '1:2',
            '1:5',
            '1:10',
          ].includes(`${scale.numerator}:${scale.denominator}`),
        { message: '比例不在 C 首版登记集合内' },
      ),
    frameFields: drawingFrameFieldsSchema,
    status: z.literal('pending-review-draft'),
    dataFingerprint: sha256Schema,
  })
  .strict()

/** V3.5：条款固定链引用、来源版本与区域、确认时的绑定依据。 */
const requirementChainRefSchema = z
  .object({
    projectId: idSchema,
    kind: z.literal('project-dimension-chain'),
  })
  .strict()

const requirementSourceRefSchema = z
  .object({
    kind: z.literal('pdf').optional(),
    documentId: idSchema,
    revisionId: idSchema,
    sha256: sha256Schema,
    blobKey: idSchema,
    page: z.number().int().min(1),
    rectPdf: coords4Schema,
    pageBoxPdf: coords4Schema,
  })
  .strict()

const requirementBindingBasisSchema = z
  .object({
    parameters: z.array(
      z
        .object({
          parameterId: idSchema,
          key: z.enum(['innerDiameter', 'outerDiameter', 'length']),
          valueQ: z.number().int(),
          parameterRevision: z.number().int().positive(),
        })
        .strict(),
    ),
    terms: z.array(
      z
        .object({
          termId: idSchema,
          nominalQ: z.number().int(),
          termRevision: z.number().int().positive(),
        })
        .strict(),
    ),
    bindings: z.array(
      z
        .object({
          bindingId: idSchema,
          termId: idSchema,
          parameterId: idSchema,
        })
        .strict(),
    ),
    digest: z.string().min(1).max(80),
  })
  .strict()

const requirementRevisionObject = z
  .object({
    requirementId: idSchema,
    revisionId: idSchema,
    parentRevisionId: idSchema.nullable(),
    projectId: idSchema,
    chainRef: requirementChainRefSchema,
    source: requirementSourceRefSchema,
    confirmedText: z.string().min(1).max(20000),
    confirmedAt: z.string().min(1),
    confirmedAgainstLatestRevisionId: idSchema,
    ruleType: z.literal('closed-interval-mm'),
    lowerQ: z.number().int(),
    upperQ: z.number().int(),
    changeReason: z.string().max(2000),
    bindingBasis: requirementBindingBasisSchema,
  })
  .strict()

const requirementRevisionSchema = requirementRevisionObject.refine(
  (value) => value.lowerQ <= value.upperQ,
  { message: '条款下限必须不大于上限' },
)

const requirementCheckBasisSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('draft'),
      baseRevisionId: idSchema,
      draftId: idSchema,
      draftRevision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('project-revision'),
      projectRevisionId: idSchema,
      parentRevisionId: idSchema.nullable(),
    })
    .strict(),
])

const requirementEvidenceRefFields = {
  requirementId: idSchema,
  requirementRevisionId: idSchema,
  requirementRulesVersion: z.string().min(1),
  source: requirementSourceRefSchema,
  bindingBasisDigest: z.string().min(1).max(80),
  analysisSnapshotId: idSchema.nullable(),
  projectRevisionId: idSchema.nullable(),
  drawingFingerprint: z.string().min(1).nullable(),
} as const

const requirementEvidenceRefSchema = z.object(requirementEvidenceRefFields).strict()

const requirementCheckFields = {
  checkId: idSchema,
  projectId: idSchema,
  requirementRevisionId: idSchema.nullable(),
  chainRef: requirementChainRefSchema,
  basis: requirementCheckBasisSchema,
  engineVersion: z.string().min(1),
  requirementRulesVersion: z.string().min(1),
  inputFingerprint: z.string().min(1),
  checkedAt: z.string().min(1),
  status: z.enum(REQUIREMENT_CHECK_STATUSES),
  reasonCodes: z.array(z.enum(REQUIREMENT_REASON_CODES)),
  resultInterval: z
    .object({ minQ: z.number().int(), maxQ: z.number().int() })
    .strict()
    .nullable(),
  margins: z
    .object({ lowerQ: z.number().int(), upperQ: z.number().int() })
    .strict()
    .nullable(),
  evidenceRef: requirementEvidenceRefSchema.nullable(),
  provenance: z.enum(['candidate', 'committed']),
} as const

const requirementCheckSchema = z
  .object(requirementCheckFields)
  .strict()
  .refine(
    (check) =>
      check.status === 'unchecked'
        ? check.resultInterval === null && check.margins === null
        : true,
    { message: '未检查不得携带当前有效结果区间/裕量' },
  )
  .refine(
    (check) => (check.requirementRevisionId === null ? check.evidenceRef === null : true),
    { message: '无条款的检查不得带条款证据引用' },
  )

/* ---- V3.6：任务书提取草稿（schema8）；ADR-001：schema9 增加出处联合类型 ---- */

const extractionEvidenceFields = {
  documentId: idSchema,
  revisionId: idSchema,
  sha256: sha256Schema,
  blobKey: idSchema,
  page: z.number().int().min(1),
  rectPdf: coords4Schema,
  pageBoxPdf: coords4Schema,
  textSnippet: z.string().min(1).max(4000),
  normalizedSnippet: z.string().max(4000),
  textItemIndexes: z.array(nonNegativeInt).max(64),
} as const

const extractionEvidenceSchema = z
  .object(extractionEvidenceFields)
  .strict()
  .refine(
    (evidence) =>
      evidence.rectPdf.every((value) => Number.isFinite(value)) &&
      evidence.pageBoxPdf.every((value) => Number.isFinite(value)),
    { message: '提取出处的选区/页框必须是有限数值' },
  )

/** ADR-001：扫描件 OCR 出处（仍锚在 PDF 版本 + 页 + 选区，必须带置信度）。 */
const pdfOcrEvidenceSchema = z
  .object({
    ...extractionEvidenceFields,
    kind: z.literal('pdf-ocr'),
    confidence: z.number().min(0).max(1),
  })
  .strict()
  .refine(
    (evidence) =>
      evidence.rectPdf.every((value) => Number.isFinite(value)) &&
      evidence.pageBoxPdf.every((value) => Number.isFinite(value)),
    { message: 'OCR 出处的选区/页框必须是有限数值' },
  )

/** ADR-001：图片 OCR 出处（锚在图片本身，不挂 PDF 版本）。 */
const imageOcrEvidenceSchema = z
  .object({
    kind: z.literal('image-ocr'),
    imageId: idSchema,
    sha256: sha256Schema,
    fileName: z.string().min(1).max(400),
    rectPdf: coords4Schema,
    recognizedText: z.string().min(1).max(4000),
    confidence: z.number().min(0).max(1),
  })
  .strict()

/**
 * ADR-001：用户断言出处。按 §11 用 actorId + sessionSeq + sessionLabel（不用 UUID）。
 * 撤销只追加留痕字段；出处本身不被删除。
 */
const userAttestationSchema = z
  .object({
    kind: z.literal('user-attestation'),
    actorId: z.string().min(1).max(200),
    at: z.string().min(1).max(64),
    sessionSeq: z.number().int().min(1),
    sessionLabel: z.string().max(200).nullable(),
    statement: z.string().min(1).max(4000),
    fieldPath: z.string().min(1).max(400),
    turnId: z.string().min(1).max(240).nullable().optional(),
    revokedAt: z.string().min(1).max(64).nullable().optional(),
    revokedBy: z.string().min(1).max(200).nullable().optional(),
    revokedStatement: z.string().min(1).max(2000).nullable().optional(),
  })
  .strict()

/**
 * schema 10：条款来源可以是用户断言（无任务书项目）。
 * 不伪造页码/选区，也没有 PDF 可核对；完整性与撤销复用 attestation 判据。
 */
const attestedRequirementSourceRefSchema = z
  .object({
    kind: z.literal('user-attestation'),
    attestation: userAttestationSchema,
  })
  .strict()

/** schema 10：来源允许 PDF 或用户断言（版本、检查与证据引用三处一致）。 */
const requirementSourceRefV10Schema = z.union([
  requirementSourceRefSchema,
  attestedRequirementSourceRefSchema,
])

const requirementRevisionV10Schema = requirementRevisionObject
  .extend({ source: requirementSourceRefV10Schema })
  .refine((value) => value.lowerQ <= value.upperQ, {
    message: '条款下限必须不大于上限',
  })

const requirementEvidenceRefV10Schema = z
  .object({ ...requirementEvidenceRefFields, source: requirementSourceRefV10Schema })
  .strict()

const requirementCheckV10Schema = z
  .object({ ...requirementCheckFields, evidenceRef: requirementEvidenceRefV10Schema.nullable() })
  .strict()
  .refine(
    (check) =>
      check.status === 'unchecked'
        ? check.resultInterval === null && check.margins === null
        : true,
    { message: '未检查不得携带当前有效结果区间/裕量' },
  )
  .refine(
    (check) => (check.requirementRevisionId === null ? check.evidenceRef === null : true),
    { message: '无条款的检查不得带条款证据引用' },
  )

/** pdf-text 出处：与 evidence 同形状，另接受显式 `kind: 'pdf-text'`（解析器不写）。 */
const pdfTextProvenanceSchema = z
  .object({ ...extractionEvidenceFields, kind: z.literal('pdf-text').optional() })
  .strict()
  .refine(
    (evidence) =>
      evidence.rectPdf.every((value) => Number.isFinite(value)) &&
      evidence.pageBoxPdf.every((value) => Number.isFinite(value)),
    { message: '提取出处的选区/页框必须是有限数值' },
  )

/** 出处联合：pdf-text（旧 evidence 形状或无 kind）或带 kind 的其它三类。 */
const provenanceRefSchema = z.union([
  z.object({
    kind: z.literal('agent-read'), actorId: z.string().min(1).max(200),
    at: z.iso.datetime(), sessionSeq: z.number().int().min(1),
    turnId: z.string().min(1).max(240), modelId: z.string().min(1).max(240).nullable(),
    statement: z.string().min(1).max(4000),
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('pdf-page'), revisionId: idSchema, sha256: sha256Schema, page: z.number().int().min(1) }).strict(),
      z.object({ kind: z.literal('image'), imageId: idSchema, sha256: sha256Schema,
        /** 草图入口：第 N 个框选的原图像素矩形；null = 用户未框选。 */
        region: z.object({
          index: z.number().int().min(1),
          rect: z.tuple([
            z.number().int().min(0), z.number().int().min(0),
            z.number().int().min(1), z.number().int().min(1),
          ]).nullable(),
        }).strict().optional() }).strict(),
    ]),
  }).strict(),
  pdfTextProvenanceSchema,
  pdfOcrEvidenceSchema,
  imageOcrEvidenceSchema,
  userAttestationSchema,
])

const extractionQuantitySchema = z
  .object({
    text: z.string().min(1).max(64),
    decimals: z.number().int().min(0).max(12),
    valueQ: z.number().int().nullable(),
    unitText: z.string().max(32).nullable(),
    unit: z.literal('mm').nullable(),
    evidence: z.array(extractionEvidenceSchema).max(16),
    /** ADR-001（schema9，纯加法）：数值出处集合；读旧 schema8 时缺省。 */
    provenance: z.array(provenanceRefSchema).max(16).optional(),
  })
  .strict()

const ringCandidateDataSchema = z
  .object({
    symbol: z.string().max(32).nullable(),
    name: z.string().max(200).nullable(),
    nominal: extractionQuantitySchema.nullable(),
    upperDeviation: extractionQuantitySchema.nullable(),
    lowerDeviation: extractionQuantitySchema.nullable(),
  })
  .strict()

const intervalCandidateDataSchema = z
  .object({
    outputSymbol: z.string().max(32).nullable(),
    lower: extractionQuantitySchema.nullable(),
    upper: extractionQuantitySchema.nullable(),
    lowerInclusive: z.boolean().nullable(),
    upperInclusive: z.boolean().nullable(),
    endpointEvidence: z.array(extractionEvidenceSchema).max(8),
  })
  .strict()

const formulaCandidateDataSchema = z
  .object({
    outputSymbol: z.string().max(32).nullable(),
    rawExpression: z.string().min(1).max(2000),
    expression: z.string().min(1).max(2000),
    operands: z
      .array(
        z
          .object({
            symbol: z.string().min(1).max(32),
            sign: z.union([z.literal(1), z.literal(-1)]),
          })
          .strict(),
      )
      .max(32),
    unsupported: z.boolean(),
    conflict: z.boolean(),
  })
  .strict()

const partDimensionDataSchema = z
  .object({
    partName: z.string().max(200).nullable(),
    innerDiameter: extractionQuantitySchema.nullable(),
    outerDiameter: extractionQuantitySchema.nullable(),
    length: extractionQuantitySchema.nullable(),
  })
  .strict()

const extractionCandidateBaseShape = {
  requiresVerification: z.boolean().optional(),
  batchConfirmable: z.boolean().optional(),
  candidateId: idSchema,
  groupId: idSchema.nullable(),
  rawText: z.string().max(4000),
  page: z.number().int().min(1),
  status: z.enum(['pending', 'blocked', 'confirmed', 'rejected', 'stale']),
  confidence: z.enum(CONFIDENCE_LEVELS),
  confidenceBasis: z.array(z.string().min(1).max(200)).max(16),
  reasonCodes: z.array(z.enum(EXTRACTION_REASON_CODES)).max(32),
  evidence: z.array(extractionEvidenceSchema).max(32),
  /** ADR-001（schema9，纯加法）：候选级出处集合；读旧 schema8 时缺省。 */
  provenance: z.array(provenanceRefSchema).max(32).optional(),
  editRevision: nonNegativeInt,
  /**
   * 同一符号多处赋值时的位置标记（V3.6 体验修订新增）。
   * 可选：旧 schema8 草稿没有该字段，读时保持兼容；写时由解析器补齐。
   */
  occurrence: z
    .object({
      index: z.number().int().min(1),
      total: z.number().int().min(1),
    })
    .strict()
    .nullable()
    .optional(),
} as const

const extractionCandidateSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...extractionCandidateBaseShape,
      kind: z.literal('ring'),
      data: ringCandidateDataSchema,
    })
    .strict(),
  z
    .object({
      ...extractionCandidateBaseShape,
      kind: z.literal('interval'),
      data: intervalCandidateDataSchema,
    })
    .strict(),
  z
    .object({
      ...extractionCandidateBaseShape,
      kind: z.literal('formula'),
      data: formulaCandidateDataSchema,
    })
    .strict(),
  z
    .object({
      ...extractionCandidateBaseShape,
      kind: z.literal('part-dimension'),
      data: partDimensionDataSchema,
    })
    .strict(),
])

const extractionDecisionSchema = z
  .object({
    confirmationMode: z.enum(['individual', 'batch']).optional(),
    decisionId: idSchema,
    candidateId: idSchema,
    action: z.enum(['confirm', 'reject', 'edit', 'revoke', 'attest-unit']),
    candidateEditRevision: nonNegativeInt,
    decidedAt: z.string().min(1),
    actor: z.string().min(1).max(200),
    reason: z.string().max(2000).nullable(),
    valueSnapshot: z.string().max(8000),
    evidence: z.array(extractionEvidenceSchema).max(64),
    /** ADR-001（schema9，纯加法）：决定时的出处集合；读旧 schema8 时缺省。 */
    provenance: z.array(provenanceRefSchema).max(64).optional(),
    /**
     * L2 批量补单位的批次号（纯加法，读旧决定时缺省）。
     * 同一批的决定共享它，界面「整批撤销」按它定位。
     */
    batchId: z.string().min(1).max(200).nullable().optional(),
    invalidatedByEditRevision: nonNegativeInt.nullable(),
  })
  .strict()

const extractionIssueSchema = z
  .object({
    issueId: idSchema,
    code: z.enum(EXTRACTION_ISSUE_CODES),
    severity: z.enum(['blocked', 'warning']),
    message: z.string().min(1).max(2000),
    page: z.number().int().min(1).nullable(),
    candidateIds: z.array(idSchema).max(64),
    evidence: z.array(extractionEvidenceSchema).max(64),
    /**
     * 大文档切块的块标记（`document-extractor-6` 新增，纯加法）。
     * 可选：旧草稿没有该字段，读时保持兼容；只有切块产生的 issue 才写。
     */
    chunk: z
      .object({
        index: z.number().int().min(1),
        from: z.number().int().min(1),
        to: z.number().int().min(1),
      })
      .strict()
      .refine((chunk) => chunk.to >= chunk.from, { message: '块页范围上限必须不小于下限' })
      .nullable()
      .optional(),
  })
  .strict()

const extractionSourceIdentitySchema = z
  .object({
    documentId: idSchema,
    revisionId: idSchema,
    sha256: sha256Schema,
    blobKey: idSchema,
    pageCount: z.number().int().min(1),
  })
  .strict()

const extractionDraftSchema = z
  .object({
    draftId: idSchema,
    draftRevision: z.number().int().positive(),
    status: z.literal('draft'),
    projectId: idSchema,
    baseToken: z.string().min(1).max(200),
    sourceIdentity: extractionSourceIdentitySchema,
    pageRange: z
      .object({
        from: z.number().int().min(1),
        to: z.number().int().min(1),
      })
      .strict()
      .refine((range) => range.to >= range.from, { message: '页范围上限必须不小于下限' }),
    extractorVersion: z.string().min(1).max(120),
    idempotencyKey: z.string().min(1).max(2000),
    candidates: z.array(extractionCandidateSchema).max(200),
    issues: z.array(extractionIssueSchema).max(200),
    decisions: z.array(extractionDecisionSchema).max(5000),
    /**
     * schema 10：无任务书草稿的参数 ↔ 组成环绑定意图（参数取自用户给出的
     * 基本尺寸）。有来源的 PDF 草稿不写该字段；缺省表示没有绑定意图。
     */
    intentBindings: z
      .array(
        z
          .object({
            parameter: z.enum(['innerDiameter', 'outerDiameter', 'length']),
            symbol: z.string().min(1).max(40),
            valueQ: z.number().int(),
            text: z.string().min(1).max(64),
          })
          .strict(),
      )
      .max(3)
      .optional(),
  })
  .strict()

/** C：schema5，三参数与图纸引用使用严格类型（无 parameterRevision）。 */
const projectV3Schema = z
  .object({
    ...projectCommonShape,
    schemaVersion: z.literal(C_PROJECT_FILE_SCHEMA_VERSION),
    sourceFormatVersion: z.union([z.literal(1), z.literal(2)]),
    parts: z.array(partSchema),
    parameters: z.array(spacerParameterV5Schema).max(3),
    modelRevisions: z.array(modelRevisionSchema),
    dimensionLinks: z.array(visualReferenceSchema),
    drawings: z.array(drawingRecordSchema).max(1),
  })
  .strict()

/** D：schema6，参数绑定与参数修订号；容器布局与链 schema 不变，无 Beta 条款字段。 */
const projectV4Schema = z
  .object({
    ...projectCommonShape,
    schemaVersion: z.literal(D_PROJECT_FILE_SCHEMA_VERSION),
    sourceFormatVersion: z.union([z.literal(1), z.literal(2)]),
    parts: z.array(partSchema),
    parameters: z.array(spacerParameterSchema).max(3),
    modelRevisions: z.array(modelRevisionSchema),
    dimensionLinks: z.array(
      z.discriminatedUnion('kind', [visualReferenceSchema, parameterBindingSchema]),
    ),
    drawings: z.array(drawingRecordSchema).max(1),
  })
  .strict()

/** V3.5：schema7，在 schema6 之上增加 Beta 条款版本/活动指针/当前检查（无提取草稿）。 */
const projectV5Schema = z
  .object({
    ...projectCommonShape,
    schemaVersion: z.literal(V35_PROJECT_FILE_SCHEMA_VERSION),
    sourceFormatVersion: z.union([z.literal(1), z.literal(2)]),
    parts: z.array(partSchema),
    parameters: z.array(spacerParameterSchema).max(3),
    modelRevisions: z.array(modelRevisionSchema),
    dimensionLinks: z.array(
      z.discriminatedUnion('kind', [visualReferenceSchema, parameterBindingSchema]),
    ),
    drawings: z.array(drawingRecordSchema).max(1),
    requirementRevisions: z.array(requirementRevisionSchema),
    activeRequirementRevisionId: idSchema.nullable(),
    currentRequirementCheck: requirementCheckSchema.nullable(),
  })
  .strict()

/**
 * V3.6：schema8，在 schema7 之上只增加提取草稿。
 * 旧 schema7 记录没有该字段，按严格 schema 会被拒绝；读取时经 adaptProjectV7
 * 补空数组，保存时才写 9。
 */
const projectV6Schema = projectV5Schema
  .extend({
    schemaVersion: z.literal(V36_PROJECT_FILE_SCHEMA_VERSION),
    extractionDrafts: z.array(extractionDraftSchema).max(8),
  })
  .strict()

/**
 * ADR-001：schema9，在 schema8 之上给提取草稿的数值/候选/决定加纯加法字段
 * `provenance`（出处联合类型）。旧 schema8 记录没有该字段，读取时经 adaptProjectV8
 * 按原 evidence 逐条补 pdf-text 出处（不重算、不改值），保存时才写 10。
 */
const projectV8Schema = projectV6Schema
  .extend({ schemaVersion: z.literal(V9_PROJECT_FILE_SCHEMA_VERSION) })
  .strict()

/**
 * schema10：无任务书入口的加法字段。旧 schema9 记录没有这些字段，读取时经
 * adaptProjectV9 补 `sourceKind='pdf'` 与空账本（不重算、不改值）。
 */
const projectV9Schema = projectV8Schema
  .extend({
    schemaVersion: z.literal(PROJECT_FILE_SCHEMA_VERSION),
    sourceKind: z.enum(['pdf', 'user-intent']),
    actorId: z.string().min(1).max(200).nullable(),
    sessionSeq: z.number().int().min(0),
    sessionLabel: z.string().max(200).nullable(),
    attestations: z.array(userAttestationSchema).max(5000),
    requirementRevisions: z.array(requirementRevisionV10Schema),
    currentRequirementCheck: requirementCheckV10Schema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sourceKind !== 'user-intent') return
    if (value.actorId === null || value.sessionSeq < 1) {
      context.addIssue({
        code: 'custom',
        path: ['actorId'],
        message: '无任务书项目必须有责任人自述与已发生的输入会话序号',
      })
      return
    }
    for (const [index, attestation] of value.attestations.entries()) {
      if (attestation.actorId !== value.actorId) {
        context.addIssue({
          code: 'custom',
          path: ['attestations', index, 'actorId'],
          message: '断言的责任人与项目责任人不一致',
        })
      }
      if (attestation.sessionSeq < 1 || attestation.sessionSeq > value.sessionSeq) {
        context.addIssue({
          code: 'custom',
          path: ['attestations', index, 'sessionSeq'],
          message: '断言的会话序号不在项目已发生的输入范围内',
        })
      }
    }
  })

const draftSchema = z
  .object({
    basisRelationRevision: nonNegativeInt.optional(),
    terms: z.array(z.record(z.string(), z.unknown())).max(200),
    targetMin: z.string(),
    targetMax: z.string(),
    assumptions: z.string(),
    relationRevision: nonNegativeInt,
  })
  .passthrough()

const documentSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    title: z.string().min(1).max(400),
    latestRevisionId: idSchema,
  })
  .strict()

const revisionSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    documentId: idSchema,
    fileName: z.string().min(1).max(400),
    sha256: sha256Schema,
    byteSize: nonNegativeInt,
    pageCount: z.number().int().min(1),
    createdAt: z.string().min(1),
    blobKey: idSchema,
  })
  .strict()

const bindingSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    termId: idSchema,
    revisionId: idSchema,
    documentId: idSchema,
    page: z.number().int().min(1),
    rectPdf: coords4Schema,
    pageBoxPdf: coords4Schema,
    note: z.string(),
    createdAt: z.string().min(1),
    reviewedTermRevision: z.number().int().positive().nullable(),
    reviewedAt: z.string().nullable(),
    historicalAcceptance: z
      .object({
        reason: z.string().min(1),
        scope: z.string().min(1),
        acceptedAt: z.string().min(1),
        latestRevisionId: idSchema,
      })
      .nullable(),
  })
  .passthrough()

const blobSchema = z
  .object({
    blobKey: idSchema,
    projectId: idSchema,
    sha256: sha256Schema,
    byteSize: nonNegativeInt,
  })
  .strict()

const eventSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    type: z.string().min(1),
    createdAt: z.string().min(1),
  })
  .passthrough()

const analysisSnapshotSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    createdAt: z.string().min(1),
    engineVersion: z.string().min(1),
    reviewRulesVersion: z.string().min(1),
    definition: z.unknown(),
    result: z.unknown(),
    review: z.unknown(),
  })
  .passthrough()

const importSnapshotSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    createdAt: z.string().min(1),
    kind: z.literal('replace-before-import'),
    definition: z.unknown(),
  })
  .passthrough()

const migrationBackupSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    createdAt: z.string().min(1),
    fromSchemaVersion: z.number().int(),
    raw: z.unknown(),
  })
  .passthrough()

const fileDigestSchema = z
  .object({ sha256: sha256Schema, byteSize: nonNegativeInt })
  .strict()

const fileRevisionSchema = z
  .object({
    revisionId: idSchema,
    parentId: idSchema.nullable(),
    createdAt: z.string().min(1),
    reason: z.string(),
    project: z.unknown(),
    evidence: z
      .object({
        analysisSnapshotId: idSchema.nullable(),
        eventIds: z.array(idSchema),
        sourceManifest: z
          .object({
            documents: z.array(
              z.object({ documentId: idSchema, latestRevisionId: idSchema }).strict(),
            ),
            revisions: z.array(
              z
                .object({
                  revisionId: idSchema,
                  documentId: idSchema,
                  sha256: sha256Schema,
                })
                .strict(),
            ),
            bindings: z.array(
              z
                .object({
                  bindingId: idSchema,
                  revisionId: idSchema,
                  reviewedTermRevision: z.number().int().positive().nullable(),
                })
                .strict(),
            ),
            missingBlobKeys: z.array(idSchema),
          })
          .strict(),
        restoredFromRevisionId: idSchema.nullable(),
        requirementRevisionId: idSchema.nullable().optional(),
        checkId: idSchema.nullable().optional(),
        /** 版本创建时的 SVG / DXF 2000 字节摘要；旧版本缺省（纯加法）。 */
        drawingExports: z
          .object({
            generatorVersion: z.string().min(1).max(120),
            templateId: z.literal('spacer-a4-landscape'),
            templateVersion: z.number().int().positive(),
            svg: fileDigestSchema,
            dxf2000: fileDigestSchema,
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const legacyArchiveSchema = z
  .object({
    sourceProjectId: idSchema.nullable(),
    sourceManifest: z.unknown(),
    records: z.array(z.unknown()),
    warnings: z.array(z.string()),
  })
  .passthrough()

const attachmentRefSchema = z
  .object({
    kind: z.enum(['pdf', 'model']),
    revisionId: idSchema,
    blobKey: idSchema,
    path: z.string().min(1).max(PROJECT_FILE_MAX_PATH_LENGTH),
    sha256: sha256Schema,
    byteSize: nonNegativeInt,
  })
  .strict()

const missingAttachmentSchema = z
  .object({
    revisionId: idSchema,
    documentId: idSchema,
    blobKey: idSchema,
    reason: z.enum(['legacy-json', 'declared-missing']),
  })
  .strict()

const snapshotReferenceSchema = z
  .object({
    snapshotId: idSchema,
    revisionIds: z.array(idSchema),
    blobKeys: z.array(idSchema),
  })
  .strict()

const countsSchema = z
  .object({
    documents: nonNegativeInt,
    revisions: nonNegativeInt,
    blobs: nonNegativeInt,
    bindings: nonNegativeInt,
    events: nonNegativeInt,
    analysisSnapshots: nonNegativeInt,
    importSnapshots: nonNegativeInt,
    migrationBackups: nonNegativeInt,
    projectRevisions: nonNegativeInt,
    models: nonNegativeInt,
    drawings: nonNegativeInt,
    legacyArchiveRecords: nonNegativeInt,
  })
  .strict()

const migrationSchema = z
  .object({
    sourceKind: z.enum(['v2-bundle', 'v2-json']),
    sourceSha256: sha256Schema,
    sourceFormatVersion: z.number().int(),
    sourceProjectId: idSchema,
    importedAt: z.string().min(1),
    confirmationPolicy: z.literal('v2-external-import'),
    warnings: z.array(z.string()),
  })
  .strict()

const entrySchema = z
  .object({
    path: z.string().min(1).max(PROJECT_FILE_MAX_PATH_LENGTH),
    role: z.enum([
      'project',
      'workspace',
      'source-meta',
      'attachment',
      'history',
      'revision',
      'legacy-archive',
    ]),
    byteSize: nonNegativeInt,
    sha256: sha256Schema,
  })
  .strict()

const manifestCommonShape = {
  format: z.literal(PROJECT_FILE_FORMAT),
  createdAt: z.string().min(1),
  writer: z
    .object({
      appVersion: z.string().min(1),
      electronVersion: z.string().min(1),
      engineVersion: z.string().min(1),
    })
    .strict(),
  entries: z.array(entrySchema),
  payloadBytes: nonNegativeInt,
  counts: countsSchema,
  attachments: z.array(attachmentRefSchema),
  missingAttachments: z.array(missingAttachmentSchema),
  snapshotReferences: z.array(snapshotReferenceSchema),
  migration: migrationSchema.nullable(),
  excludes: z
    .object({
      mappingTemplates: z
        .object({ included: z.literal(false), note: z.string().min(1) })
        .strict(),
    })
    .strict(),
} as const

const manifestProjectV1Schema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(200),
    projectSchemaVersion: z.literal(LEGACY_PROJECT_FILE_SCHEMA_VERSION),
    dimensionChainSchemaVersion: z.literal(DIMENSION_CHAIN_SCHEMA_VERSION),
    currentRevisionId: idSchema,
  })
  .strict()

const manifestProjectV2Schema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(200),
    // formatVersion 2 既可能来自 B2（schema4），也可能是 C（5）/D（6）/V3.5（7）/V3.6（8）。
    projectSchemaVersion: z.union([
      z.literal(B2_PROJECT_FILE_SCHEMA_VERSION),
      z.literal(C_PROJECT_FILE_SCHEMA_VERSION),
      z.literal(D_PROJECT_FILE_SCHEMA_VERSION),
      z.literal(V35_PROJECT_FILE_SCHEMA_VERSION),
      z.literal(V36_PROJECT_FILE_SCHEMA_VERSION),
      z.literal(V9_PROJECT_FILE_SCHEMA_VERSION),
      z.literal(PROJECT_FILE_SCHEMA_VERSION),
    ]),
    dimensionChainSchemaVersion: z.literal(DIMENSION_CHAIN_SCHEMA_VERSION),
    currentRevisionId: idSchema,
  })
  .strict()

const manifestV1Schema = z
  .object({
    ...manifestCommonShape,
    formatVersion: z.literal(1),
    project: manifestProjectV1Schema,
  })
  .strict()

const manifestV2Schema = z
  .object({
    ...manifestCommonShape,
    formatVersion: z.literal(2),
    project: manifestProjectV2Schema,
  })
  .strict()

/** 按 formatVersion 分支解析；未知版本明确拒绝，不 strip/default。 */
const manifestSchema = z.discriminatedUnion('formatVersion', [
  manifestV1Schema,
  manifestV2Schema,
])

/* ------------------------------------------------------------------ */
/* 解析                                                                 */
/* ------------------------------------------------------------------ */

function describeZodError(error: z.ZodError): string {
  const first = error.issues[0]
  if (first === undefined) {
    return '结构不匹配'
  }
  const path = first.path.length === 0 ? '<root>' : first.path.join('.')
  return `${path}: ${first.message}`
}

export function parseManifest(
  input: unknown,
): ProjectFileResult<ProjectFileManifest> {
  const parsed = manifestSchema.safeParse(input)
  if (!parsed.success) {
    return fail('INVALID_MANIFEST', 'manifest 结构或版本不合法', describeZodError(parsed.error))
  }
  return ok(parsed.data as ProjectFileManifest)
}

export type VersionedProject =
  | { version: 1; project: ProjectFileProjectV1 }
  | { version: 2; project: ProjectFileProjectV2 }
  | { version: 3; project: ProjectFileProjectV5 }
  | { version: 4; project: ProjectFileProjectV6 }
  | { version: 5; project: ProjectFileProjectV7 }
  | { version: 6; project: ProjectFileProjectV8 }
  | { version: 7; project: ProjectFileProjectV9 }
  | { version: 8; project: ProjectFileProject }

/** 校验工作链与基线链；两个 schema 版本共用。 */
function validateProjectChains(
  data: { dimensionChain: unknown; baseline: { savedAt: string; definition: unknown } | null },
): ProjectFileResult<{ dimensionChain: ProjectFileProject['dimensionChain']; baseline: ProjectFileProject['baseline'] }> {
  const chain = validateChain(data.dimensionChain)
  if (!chain.ok) {
    const first = chain.errors[0]
    return fail(
      'INVALID_RECORD',
      'project.json 的尺寸链不合法',
      first === undefined ? undefined : `${first.code}: ${first.message}`,
    )
  }
  let baseline: ProjectFileProject['baseline'] = null
  if (data.baseline !== null) {
    const baselineChain = validateChain(data.baseline.definition)
    if (!baselineChain.ok) {
      const first = baselineChain.errors[0]
      return fail(
        'INVALID_RECORD',
        'project.json 的基线尺寸链不合法',
        first === undefined ? undefined : `${first.code}: ${first.message}`,
      )
    }
    baseline = { savedAt: data.baseline.savedAt, definition: baselineChain.value }
  }
  return ok({ dimensionChain: chain.value, baseline })
}

/**
 * 按 schemaVersion 分支解析项目记录：
 * - 3（B1 及更早）：原版严格规则，五个预留数组必须为空；
 * - 4（B2）：严格模型/版本/关联类型，参数与图纸必须为空；
 * - 5（C）：三参数与图纸快照引用严格类型；
 * - 其他：UNSUPPORTED_VERSION，不 strip、不默认。
 */
export function parseProjectVersioned(input: unknown): ProjectFileResult<VersionedProject> {
  const raw = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : null
  const version = raw?.schemaVersion
  if (version === LEGACY_PROJECT_FILE_SCHEMA_VERSION) {
    const parsed = projectV1Schema.safeParse(input)
    if (!parsed.success) {
      return fail('INVALID_RECORD', 'project.json 结构不合法（schema 3）', describeZodError(parsed.error))
    }
    const chains = validateProjectChains(parsed.data)
    if (!chains.ok) return chains
    return ok({ version: 1, project: parsed.data as ProjectFileProjectV1 })
  }
  if (version === B2_PROJECT_FILE_SCHEMA_VERSION) {
    const parsed = projectV2Schema.safeParse(input)
    if (!parsed.success) {
      return fail('INVALID_RECORD', 'project.json 结构不合法（schema 4）', describeZodError(parsed.error))
    }
    const chains = validateProjectChains(parsed.data)
    if (!chains.ok) return chains
    return ok({
      version: 2,
      project: {
        ...(parsed.data as unknown as ProjectFileProjectV2),
        dimensionChain: chains.value.dimensionChain,
        baseline: chains.value.baseline,
      },
    })
  }
  if (version === C_PROJECT_FILE_SCHEMA_VERSION) {
    const parsed = projectV3Schema.safeParse(input)
    if (!parsed.success) {
      return fail('INVALID_RECORD', 'project.json 结构不合法（schema 5）', describeZodError(parsed.error))
    }
    const chains = validateProjectChains(parsed.data)
    if (!chains.ok) return chains
    return ok({
      version: 3,
      project: {
        ...(parsed.data as unknown as ProjectFileProjectV5),
        dimensionChain: chains.value.dimensionChain,
        baseline: chains.value.baseline,
      },
    })
  }
  if (version === D_PROJECT_FILE_SCHEMA_VERSION) {
    const parsed = projectV4Schema.safeParse(input)
    if (!parsed.success) {
      return fail('INVALID_RECORD', 'project.json 结构不合法（schema 6）', describeZodError(parsed.error))
    }
    const chains = validateProjectChains(parsed.data)
    if (!chains.ok) return chains
    return ok({
      version: 4,
      project: {
        ...(parsed.data as unknown as ProjectFileProjectV6),
        dimensionChain: chains.value.dimensionChain,
        baseline: chains.value.baseline,
      },
    })
  }
  if (version === V35_PROJECT_FILE_SCHEMA_VERSION) {
    const parsed = projectV5Schema.safeParse(input)
    if (!parsed.success) {
      return fail('INVALID_RECORD', 'project.json 结构不合法（schema 7）', describeZodError(parsed.error))
    }
    const chains = validateProjectChains(parsed.data)
    if (!chains.ok) return chains
    return ok({
      version: 5,
      project: {
        ...(parsed.data as unknown as ProjectFileProjectV7),
        dimensionChain: chains.value.dimensionChain,
        baseline: chains.value.baseline,
      },
    })
  }
  if (version === V36_PROJECT_FILE_SCHEMA_VERSION) {
    const parsed = projectV6Schema.safeParse(input)
    if (!parsed.success) {
      return fail('INVALID_RECORD', 'project.json 结构不合法（schema 8）', describeZodError(parsed.error))
    }
    const chains = validateProjectChains(parsed.data)
    if (!chains.ok) return chains
    return ok({
      version: 6,
      project: {
        ...(parsed.data as unknown as ProjectFileProjectV8),
        dimensionChain: chains.value.dimensionChain,
        baseline: chains.value.baseline,
      },
    })
  }
  if (version === V9_PROJECT_FILE_SCHEMA_VERSION) {
    const parsed = projectV8Schema.safeParse(input)
    if (!parsed.success) {
      return fail('INVALID_RECORD', 'project.json 结构不合法（schema 9）', describeZodError(parsed.error))
    }
    const chains = validateProjectChains(parsed.data)
    if (!chains.ok) return chains
    return ok({
      version: 7,
      project: {
        ...(parsed.data as unknown as ProjectFileProjectV9),
        dimensionChain: chains.value.dimensionChain,
        baseline: chains.value.baseline,
      },
    })
  }
  if (version === PROJECT_FILE_SCHEMA_VERSION) {
    const parsed = projectV9Schema.safeParse(input)
    if (!parsed.success) {
      return fail('INVALID_RECORD', 'project.json 结构不合法（schema 10）', describeZodError(parsed.error))
    }
    const chains = validateProjectChains(parsed.data)
    if (!chains.ok) return chains
    return ok({
      version: 8,
      project: {
        ...(parsed.data as unknown as ProjectFileProject),
        dimensionChain: chains.value.dimensionChain,
        baseline: chains.value.baseline,
      },
    })
  }
  return fail(
    'UNSUPPORTED_VERSION',
    '项目记录 schemaVersion 不受支持',
    `schemaVersion=${String(version)}`,
  )
}

/** schema 10 之前的记录没有来源种类/身份/断言账本：读入时按“有来源 PDF”补齐，不重算、不改值。 */
const legacySourceFields = {
  sourceKind: 'pdf',
  actorId: null,
  sessionSeq: 0,
  sessionLabel: null,
  attestations: [] as ProjectFileProject['attestations'],
} satisfies Pick<
  ProjectFileProject,
  'sourceKind' | 'actorId' | 'sessionSeq' | 'sessionLabel' | 'attestations'
>

/**
 * 读时兼容：把 schema3 记录适配成当前工作形状（内存中，不改磁盘）。
 * 不制造模型，也不凭空确认任何关系；sourceFormatVersion=1 供首次保存升级使用。
 */
export function adaptProjectV1(project: ProjectFileProjectV1): ProjectFileProject {
  return {
    ...project,
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    sourceFormatVersion: 1,
    ...legacySourceFields,
    parts: [],
    parameters: [],
    modelRevisions: [],
    dimensionLinks: [],
    drawings: [],
    requirementRevisions: [],
    activeRequirementRevisionId: null,
    currentRequirementCheck: null,
    extractionDrafts: [],
  }
}

/** schema4 → 当前工作形状：数组本就必须为空，只提升版本号，来源格式保持 2。 */
export function adaptProjectV2(project: ProjectFileProjectV2): ProjectFileProject {
  return {
    ...project,
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    ...legacySourceFields,
    parameters: [],
    drawings: [],
    requirementRevisions: [],
    activeRequirementRevisionId: null,
    currentRequirementCheck: null,
    extractionDrafts: [],
  }
}

/** schema5 → 当前工作形状：补 parameterRevision=1，其余字段原样。 */
export function adaptProjectV3(project: ProjectFileProjectV5): ProjectFileProject {
  return {
    ...project,
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    ...legacySourceFields,
    parameters: project.parameters.map((parameter) => ({
      ...parameter,
      // C 没有参数修订号；首次读入按 1 起算。这是显式、可追溯的升级，
      // 不伪造“已确认”，也不改写历史版本记录。
      parameterRevision: parameter.parameterRevision ?? 1,
    })),
    dimensionLinks: project.dimensionLinks,
    requirementRevisions: [],
    activeRequirementRevisionId: null,
    currentRequirementCheck: null,
    extractionDrafts: [],
  }
}

/**
 * schema6 → 当前工作形状（schema 8）：老项目默认“无 Beta 条款、无提取草稿”。
 * 不补造旧检查或旧确认；旧历史 Revision 原样保留。
 */
export function adaptProjectV6(project: ProjectFileProjectV6): ProjectFileProject {
  return {
    ...project,
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    ...legacySourceFields,
    requirementRevisions: [],
    activeRequirementRevisionId: null,
    currentRequirementCheck: null,
    extractionDrafts: [],
  }
}

/**
 * schema7 → 当前工作形状（schema 9）：老项目默认“无提取草稿”。
 * 不补造候选或决定；旧历史 Revision 原样保留。
 */
export function adaptProjectV7(project: ProjectFileProjectV7): ProjectFileProject {
  return {
    ...project,
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    ...legacySourceFields,
    extractionDrafts: [],
  }
}

/** 旧 schema8 的数值：按其原 evidence 逐条补 pdf-text 出处；不重算、不改值。 */
function withQuantityProvenance(value: QuantityValue | null): QuantityValue | null {
  if (value === null || value.provenance !== undefined) return value
  return { ...value, provenance: value.evidence }
}

function withCandidateProvenance(candidate: ExtractionCandidate): ExtractionCandidate {
  const provenance = candidate.provenance ?? candidate.evidence
  switch (candidate.kind) {
    case 'ring':
      return {
        ...candidate,
        provenance,
        data: {
          ...candidate.data,
          nominal: withQuantityProvenance(candidate.data.nominal),
          upperDeviation: withQuantityProvenance(candidate.data.upperDeviation),
          lowerDeviation: withQuantityProvenance(candidate.data.lowerDeviation),
        },
      }
    case 'interval':
      return {
        ...candidate,
        provenance,
        data: {
          ...candidate.data,
          lower: withQuantityProvenance(candidate.data.lower),
          upper: withQuantityProvenance(candidate.data.upper),
        },
      }
    case 'part-dimension':
      return {
        ...candidate,
        provenance,
        data: {
          ...candidate.data,
          innerDiameter: withQuantityProvenance(candidate.data.innerDiameter),
          outerDiameter: withQuantityProvenance(candidate.data.outerDiameter),
          length: withQuantityProvenance(candidate.data.length),
        },
      }
    case 'formula':
      return { ...candidate, provenance }
  }
}

/**
 * schema8 → 当前工作形状（schema 9）：按原 evidence 逐条补 pdf-text 出处。
 * 只加 provenance 字段：候选身份、数值、q、判据、决定与快照一律不重算、不改值。
 */
export function adaptProjectV8(project: ProjectFileProjectV8): ProjectFileProject {
  return {
    ...project,
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    ...legacySourceFields,
    extractionDrafts: project.extractionDrafts.map((draft) => ({
      ...draft,
      candidates: draft.candidates.map(withCandidateProvenance),
      decisions: draft.decisions.map((decision) => ({
        ...decision,
        provenance: decision.provenance ?? decision.evidence,
      })),
    })),
  }
}

/**
 * schema9 → 当前工作形状（schema 10）：只补来源种类与空账本。
 * 出处、候选、数值、判据与旧历史一律不重算、不改值。
 */
export function adaptProjectV9(project: ProjectFileProjectV9): ProjectFileProject {
  return {
    ...project,
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    ...legacySourceFields,
  }
}

/** 严格解析 project/project.json（接受 schema3/4/5/6/7/8/9，统一返回当前工作形状）。 */
export function parseProject(
  input: unknown,
): ProjectFileResult<ProjectFileProject> {
  const parsed = parseProjectVersioned(input)
  if (!parsed.ok) return parsed
  if (parsed.value.version === 1) return ok(adaptProjectV1(parsed.value.project))
  if (parsed.value.version === 2) return ok(adaptProjectV2(parsed.value.project))
  if (parsed.value.version === 3) return ok(adaptProjectV3(parsed.value.project))
  if (parsed.value.version === 4) return ok(adaptProjectV6(parsed.value.project))
  if (parsed.value.version === 5) return ok(adaptProjectV7(parsed.value.project))
  if (parsed.value.version === 6) return ok(adaptProjectV8(parsed.value.project))
  if (parsed.value.version === 7) return ok(adaptProjectV9(parsed.value.project))
  return ok(parsed.value.project)
}

export function parseDraft(
  input: unknown,
): ProjectFileResult<ProjectFileSnapshot['draft']> {
  if (input === null) {
    return ok(null)
  }
  const parsed = draftSchema.safeParse(input)
  if (!parsed.success) {
    return fail('INVALID_RECORD', 'draft.json 结构不合法', describeZodError(parsed.error))
  }
  return ok(
    parsed.data as unknown as ProjectFileSnapshot['draft'],
  )
}

function parseRecords<T>(
  schema: z.ZodType<T>,
  input: unknown,
  label: string,
): ProjectFileResult<T[]> {
  if (!Array.isArray(input)) {
    return fail('INVALID_RECORD', `${label} 必须是数组`)
  }
  const values: T[] = []
  for (const [index, item] of input.entries()) {
    const parsed = schema.safeParse(item)
    if (!parsed.success) {
      return fail(
        'INVALID_RECORD',
        `${label} 第 ${index + 1} 条记录结构不合法`,
        describeZodError(parsed.error),
      )
    }
    values.push(parsed.data)
  }
  return ok(values)
}

export function parseRevisionFile(
  input: unknown,
): ProjectFileResult<ProjectFileRevision> {
  const parsed = fileRevisionSchema.safeParse(input)
  if (!parsed.success) {
    return fail('INVALID_RECORD', '项目文件版本记录结构不合法', describeZodError(parsed.error))
  }
  // 旧历史快照保留 schema3 原样（不可变）；新快照为 schema4。
  const project = parseProjectVersioned(parsed.data.project)
  if (!project.ok) {
    return fail(
      'INVALID_RECORD',
      '项目文件版本内的项目记录不合法',
      project.error.detail ?? project.error.message,
    )
  }
  return ok({ ...parsed.data, project: project.value.project })
}

/* ------------------------------------------------------------------ */
/* 引用完整性                                                           */
/* ------------------------------------------------------------------ */

export function computeCounts(snapshot: ProjectFileSnapshot): ProjectFileCounts {
  return {
    documents: snapshot.documents.length,
    revisions: snapshot.revisions.length,
    blobs: snapshot.blobs.length,
    bindings: snapshot.bindings.length,
    events: snapshot.events.length,
    analysisSnapshots: snapshot.analysisSnapshots.length,
    importSnapshots: snapshot.importSnapshots.length,
    migrationBackups: snapshot.migrationBackups.length,
    projectRevisions: snapshot.fileRevisions.length,
    models: snapshot.project.modelRevisions.length,
    drawings: snapshot.project.drawings.length,
    legacyArchiveRecords: snapshot.legacyArchive?.records.length ?? 0,
  }
}

export function expectedAttachmentRefs(
  snapshot: ProjectFileSnapshot,
): ProjectFileAttachmentRef[] {
  const refs: ProjectFileAttachmentRef[] = []
  for (const blob of snapshot.blobs) {
    const pdfRevisions = snapshot.revisions.filter((item) => item.blobKey === blob.blobKey)
    const modelRevisions = snapshot.project.modelRevisions.filter(
      (item) => item.blobKey === blob.blobKey,
    )
    for (const revision of pdfRevisions) {
      refs.push({
        kind: 'pdf',
        revisionId: revision.id,
        blobKey: blob.blobKey,
        path: attachmentEntryPath(blob.blobKey),
        sha256: blob.sha256,
        byteSize: blob.byteSize,
      })
    }
    for (const revision of modelRevisions) {
      refs.push({
        kind: 'model',
        revisionId: revision.modelRevisionId,
        blobKey: blob.blobKey,
        path: attachmentEntryPath(blob.blobKey),
        sha256: blob.sha256,
        byteSize: blob.byteSize,
      })
    }
    if (pdfRevisions.length === 0 && modelRevisions.length === 0) {
      // 保存端与打开端共用本函数；没有版本引用的孤立 blob 不应出现，
      // 仍保留旧行为给出空 revisionId，由引用校验拒绝。
      refs.push({
        kind: 'pdf',
        revisionId: '',
        blobKey: blob.blobKey,
        path: attachmentEntryPath(blob.blobKey),
        sha256: blob.sha256,
        byteSize: blob.byteSize,
      })
    }
  }
  return refs.sort((left, right) => {
    if (left.path !== right.path) return left.path < right.path ? -1 : 1
    if (left.kind !== right.kind) return left.kind === 'pdf' ? -1 : 1
    return left.revisionId < right.revisionId ? -1 : left.revisionId > right.revisionId ? 1 : 0
  })
}

/** 容器内应有的全部条目（不含 manifest.json）及其角色。 */
export function expectedEntryRoles(
  snapshot: ProjectFileSnapshot,
): { path: string; role: ProjectFileEntryRole }[] {
  const entries: { path: string; role: ProjectFileEntryRole }[] = [
    { path: PROJECT_FILE_PATHS.project, role: 'project' },
    { path: PROJECT_FILE_PATHS.draft, role: 'workspace' },
    { path: PROJECT_FILE_PATHS.documents, role: 'source-meta' },
    { path: PROJECT_FILE_PATHS.revisions, role: 'source-meta' },
    { path: PROJECT_FILE_PATHS.bindings, role: 'source-meta' },
    { path: PROJECT_FILE_PATHS.blobs, role: 'source-meta' },
    { path: PROJECT_FILE_PATHS.events, role: 'history' },
    { path: PROJECT_FILE_PATHS.analysisSnapshots, role: 'history' },
    { path: PROJECT_FILE_PATHS.importSnapshots, role: 'history' },
    { path: PROJECT_FILE_PATHS.migrationBackups, role: 'history' },
  ]
  if (snapshot.legacyArchive !== null) {
    entries.push({ path: PROJECT_FILE_PATHS.legacyArchive, role: 'legacy-archive' })
  }
  for (const revision of snapshot.fileRevisions) {
    entries.push({ path: revisionEntryPath(revision.revisionId), role: 'revision' })
  }
  for (const blob of snapshot.blobs) {
    entries.push({ path: attachmentEntryPath(blob.blobKey), role: 'attachment' })
  }
  return entries.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )
}

function linkKindId(link: { kind: string; linkId?: string; bindingId?: string }): string {
  return link.kind === 'parameter-binding' ? (link.bindingId ?? '') : (link.linkId ?? '')
}

/** linkId 与 bindingId 是两个命名空间，各自查重。 */
function duplicateLinkIds(
  links: readonly { kind: string; linkId?: string; bindingId?: string }[],
): string | null {
  for (const kind of ['visual-reference', 'parameter-binding'] as const) {
    const seen = new Set<string>()
    for (const link of links) {
      if (link.kind !== kind) continue
      const id = linkKindId(link)
      if (seen.has(id)) return id
      seen.add(id)
    }
  }
  return null
}

function duplicateIds<T>(records: readonly T[], key: keyof T & string): string | null {
  const seen = new Set<string>()
  for (const record of records) {
    const value = String((record as Record<string, unknown>)[key])
    if (seen.has(value)) {
      return value
    }
    seen.add(value)
  }
  return null
}

/** 拼接并解析全部非附件部分，随后做引用完整性校验。 */
export function assembleSnapshot(parts: {
  project: unknown
  draft: unknown
  documents: unknown
  revisions: unknown
  bindings: unknown
  blobs: unknown
  events: unknown
  analysisSnapshots: unknown
  importSnapshots: unknown
  migrationBackups: unknown
  legacyArchive: unknown
  fileRevisions: ProjectFileRevision[]
  attachments: ProjectFileAttachmentInput[]
  missingAttachments: ProjectFileMissingAttachment[]
  snapshotReferences: ProjectFileSnapshot['snapshotReferences']
  manifestMeta: ProjectFileSnapshot['manifestMeta']
}): ProjectFileResult<ProjectFileSnapshot> {
  const project = parseProject(parts.project)
  if (!project.ok) {
    return fail(project.error.code, project.error.message, project.error.detail)
  }
  const draft = parseDraft(parts.draft)
  if (!draft.ok) {
    return fail(draft.error.code, draft.error.message, draft.error.detail)
  }
  const documents = parseRecords(documentSchema, parts.documents, 'documents')
  if (!documents.ok) return documents
  const revisions = parseRecords(revisionSchema, parts.revisions, 'revisions')
  if (!revisions.ok) return revisions
  const bindings = parseRecords(bindingSchema, parts.bindings, 'bindings')
  if (!bindings.ok) return bindings
  const blobs = parseRecords(blobSchema, parts.blobs, 'blobs')
  if (!blobs.ok) return blobs
  const events = parseRecords(eventSchema, parts.events, 'events')
  if (!events.ok) return events
  const analysisSnapshots = parseRecords(
    analysisSnapshotSchema,
    parts.analysisSnapshots,
    'analysisSnapshots',
  )
  if (!analysisSnapshots.ok) return analysisSnapshots
  const importSnapshots = parseRecords(
    importSnapshotSchema,
    parts.importSnapshots,
    'importSnapshots',
  )
  if (!importSnapshots.ok) return importSnapshots
  const migrationBackups = parseRecords(
    migrationBackupSchema,
    parts.migrationBackups,
    'migrationBackups',
  )
  if (!migrationBackups.ok) return migrationBackups

  let legacyArchive: ProjectFileSnapshot['legacyArchive'] = null
  if (parts.legacyArchive !== null && parts.legacyArchive !== undefined) {
    const parsed = legacyArchiveSchema.safeParse(parts.legacyArchive)
    if (!parsed.success) {
      return fail('INVALID_RECORD', 'legacyArchive 结构不合法', describeZodError(parsed.error))
    }
    legacyArchive = parsed.data as unknown as ProjectFileSnapshot['legacyArchive']
  }

  const snapshot: ProjectFileSnapshot = {
    project: project.value,
    draft: draft.value,
    documents: documents.value,
    revisions: revisions.value,
    bindings: bindings.value,
    blobs: blobs.value,
    events: events.value as unknown as ProjectFileSnapshot['events'],
    analysisSnapshots:
      analysisSnapshots.value as unknown as ProjectFileSnapshot['analysisSnapshots'],
    importSnapshots:
      importSnapshots.value as unknown as ProjectFileSnapshot['importSnapshots'],
    migrationBackups:
      migrationBackups.value as unknown as ProjectFileSnapshot['migrationBackups'],
    legacyArchive,
    fileRevisions: parts.fileRevisions,
    attachments: parts.attachments,
    missingAttachments: parts.missingAttachments,
    snapshotReferences: parts.snapshotReferences,
    manifestMeta: parts.manifestMeta,
  }

  const references = validateSnapshotReferences(snapshot)
  if (!references.ok) {
    return fail(references.error.code, references.error.message, references.error.detail)
  }
  return ok(snapshot)
}


/**
 * 提取草稿的引用与决定一致性（V3.6）。
 *
 * 只读校验，不修数据：
 * - 草稿的 PDF 版本身份必须指向本项目里确切存在的 revision，且 sha256/blobKey 一致；
 * - 页范围/页码必须落在该版本页数内；
 * - 每个数值字段的出处必须完整，并且确实引用同一 PDF 版本；
 * - confirmed/rejected 状态必须有对应的、未被编辑失效的决定；
 * - “已确认”的值快照必须与当前候选数值一致（防止事后改值冒充已确认）。
 */
export function validateExtractionDraftReferences(
  snapshot: ProjectFileSnapshot,
): ProjectFileResult<void> {
  const projectId = snapshot.project.id
  const revisionById = new Map(snapshot.revisions.map((item) => [item.id, item]))
  const documentIds = new Set(snapshot.documents.map((item) => item.id))
  const draftIds = new Set<string>()
  const idempotencyKeys = new Set<string>()

  const evidenceMatchesSource = (
    evidence: ExtractionEvidence,
    draft: ExtractionDraft,
  ): boolean => {
    const revision = revisionById.get(evidence.revisionId)
    if (revision === undefined) return false
    if (revision.documentId !== evidence.documentId) return false
    if (revision.sha256 !== evidence.sha256) return false
    if (revision.blobKey !== evidence.blobKey) return false
    if (
      evidence.revisionId !== draft.sourceIdentity.revisionId ||
      evidence.sha256 !== draft.sourceIdentity.sha256
    ) {
      return false
    }
    return evidence.page >= draft.pageRange.from && evidence.page <= draft.pageRange.to
  }

  /**
   * 出处是否仍指向草稿的 PDF 版本（I3）：
   * - pdf-text / pdf-ocr：revisionId + sha256 + blobKey 全等（行为与改前一致）；
   * - image-ocr：锚在图片自身，项目文件层无图片库可核对，只要求完整（下一步接图片存储）；
   * - user-attestation：不因文件变化失效。**已显式撤销的断言仍允许留在出处里**
   *   （I4：出处不可抹，撤销只追加 revokedAt/revokedBy 留痕）；它能不能当依据由
   *   planApplication 判（PROVENANCE_REVOKED），不是这里判“指向别的版本”。
   */
  const provenanceMatchesDraft = (
    ref: ExtractionEvidence | { readonly kind: 'pdf-ocr' | 'image-ocr' | 'user-attestation' } | { readonly kind?: 'pdf-text' } | import('../document-extraction/types').AgentReadEvidence,
    draft: ExtractionDraft,
  ): boolean => {
    const kind = (ref as { readonly kind?: string }).kind
    if ('kind' in ref && ref.kind === 'agent-read') {
      const source = ref.source
      if (source.kind === 'image') return true
      const revision = revisionById.get(source.revisionId)
      return revision !== undefined && revision.sha256 === source.sha256 && source.page <= revision.pageCount
    }
    if (kind === 'image-ocr') return true
    if (kind === 'user-attestation') return true
    return evidenceMatchesSource(ref as ExtractionEvidence, draft)
  }

  for (const draft of snapshot.project.extractionDrafts) {
    if (draft.projectId !== projectId) {
      return fail('MISSING_REFERENCE', `提取草稿 ${draft.draftId} 不属于当前项目`)
    }
    if (draftIds.has(draft.draftId)) {
      return fail('INVALID_RECORD', `提取草稿 ID 重复：${draft.draftId}`)
    }
    draftIds.add(draft.draftId)
    if (idempotencyKeys.has(draft.idempotencyKey)) {
      return fail('INVALID_RECORD', `提取幂等键重复：${draft.idempotencyKey}`)
    }
    idempotencyKeys.add(draft.idempotencyKey)

    const intentDraft = snapshot.project.sourceKind === 'user-intent'
    if (!intentDraft) {
      const source = draft.sourceIdentity
      const revision = revisionById.get(source.revisionId)
      if (revision === undefined || !documentIds.has(source.documentId)) {
        return fail(
          'MISSING_REFERENCE',
          `提取草稿 ${draft.draftId} 引用的 PDF 版本不存在`,
          source.revisionId,
        )
      }
      if (revision.documentId !== source.documentId) {
        return fail('MISSING_REFERENCE', `提取草稿 ${draft.draftId} 的文档与版本不一致`)
      }
      if (revision.sha256 !== source.sha256 || revision.blobKey !== source.blobKey) {
        return fail('HASH_MISMATCH', `提取草稿 ${draft.draftId} 的版本哈希/blobKey 与来源不一致`)
      }
      if (source.pageCount !== revision.pageCount) {
        return fail('INVALID_RECORD', `提取草稿 ${draft.draftId} 的页数与来源版本不一致`)
      }
      if (draft.pageRange.to > revision.pageCount) {
        return fail(
          'INVALID_RECORD',
          `提取草稿 ${draft.draftId} 的页范围越界`,
          `to=${draft.pageRange.to}, pageCount=${revision.pageCount}`,
        )
      }
    }

    const candidateById = new Map<string, ExtractionCandidate>()
    const decisionIds = new Set<string>()
    for (const candidate of draft.candidates) {
      if (candidateById.has(candidate.candidateId)) {
        return fail('INVALID_RECORD', `提取候选 ID 重复：${candidate.candidateId}`)
      }
      candidateById.set(candidate.candidateId, candidate)
      if (!(candidate.provenance ?? []).some((ref) => ref.kind === 'agent-read') &&
        (candidate.page < draft.pageRange.from || candidate.page > draft.pageRange.to)) {
        return fail(
          'INVALID_RECORD',
          `提取候选 ${candidate.candidateId} 的页码不在提取页范围内`,
        )
      }
      for (const evidence of candidate.evidence) {
        if (!evidenceMatchesSource(evidence, draft)) {
          return fail(
            'MISSING_REFERENCE',
            `提取候选 ${candidate.candidateId} 的出处与草稿来源不一致`,
            evidence.revisionId,
          )
        }
      }
      for (const { field, value } of candidateNumericFields(candidate)) {
        const refs = valueProvenance(value)
        if (refs.length === 0) {
          return fail(
            'INVALID_RECORD',
            `提取候选 ${candidate.candidateId} 的 ${field} 缺少出处`,
          )
        }
        for (const ref of refs) {
          if (!isProvenanceCompleteness(ref)) {
            return fail(
              'INVALID_RECORD',
              `提取候选 ${candidate.candidateId} 的 ${field} 出处不完整`,
            )
          }
          if (!provenanceMatchesDraft(ref, draft)) {
            return fail(
              'MISSING_REFERENCE',
              `提取候选 ${candidate.candidateId} 的 ${field} 出处指向其它版本`,
            )
          }
        }
      }
    }

    const activeDecisions = new Map<string, ExtractionDecision[]>()
    for (const decision of draft.decisions) {
      if (decisionIds.has(decision.decisionId)) {
        return fail('INVALID_RECORD', `提取决定 ID 重复：${decision.decisionId}`)
      }
      decisionIds.add(decision.decisionId)
      const candidate = candidateById.get(decision.candidateId)
      if (candidate === undefined) {
        return fail(
          'MISSING_REFERENCE',
          `提取决定 ${decision.decisionId} 引用了不存在的候选`,
          decision.candidateId,
        )
      }
      if (decision.candidateEditRevision > candidate.editRevision) {
        return fail(
          'INVALID_RECORD',
          `提取决定 ${decision.decisionId} 的代数为未来代数`,
        )
      }
      if (decision.invalidatedByEditRevision === null) {
        const list = activeDecisions.get(decision.candidateId) ?? []
        list.push(decision)
        activeDecisions.set(decision.candidateId, list)
      }
    }

    for (const candidate of draft.candidates) {
      const decisions = (activeDecisions.get(candidate.candidateId) ?? []).filter(
        (decision) => decision.candidateEditRevision === candidate.editRevision,
      )
      const confirm = decisions.find((decision) => decision.action === 'confirm')
      const reject = decisions.find((decision) => decision.action === 'reject')
      if (candidate.status === 'confirmed') {
        if (confirm === undefined) {
          return fail(
            'INVALID_RECORD',
            `候选 ${candidate.candidateId} 标记为已确认，但没有当前代数的确认决定`,
          )
        }
        if (confirm.valueSnapshot !== candidateValueSnapshot(candidate)) {
          return fail(
            'INVALID_RECORD',
            `候选 ${candidate.candidateId} 的数值与确认时的快照不一致`,
          )
        }
      }
      if (candidate.status === 'rejected' && reject === undefined) {
        return fail(
          'INVALID_RECORD',
          `候选 ${candidate.candidateId} 标记为已拒绝，但没有当前代数的拒绝决定`,
        )
      }
      if (candidate.status !== 'confirmed' && confirm !== undefined) {
        return fail(
          'INVALID_RECORD',
          `候选 ${candidate.candidateId} 存在确认决定，但状态不是已确认`,
        )
      }
    }
  }
  return ok(undefined)
}

/** 结构与引用完整性（不含字节哈希，字节在 codec 中核对）。 */
export function validateSnapshotReferences(
  snapshot: ProjectFileSnapshot,
): ProjectFileResult<void> {
  const projectId = snapshot.project.id

  const allScoped: { label: string; records: readonly { projectId: string }[] }[] = [
    { label: 'documents', records: snapshot.documents },
    { label: 'revisions', records: snapshot.revisions },
    { label: 'blobs', records: snapshot.blobs },
    { label: 'bindings', records: snapshot.bindings },
    { label: 'events', records: snapshot.events },
    { label: 'analysisSnapshots', records: snapshot.analysisSnapshots },
    { label: 'importSnapshots', records: snapshot.importSnapshots },
    { label: 'migrationBackups', records: snapshot.migrationBackups },
  ]
  for (const group of allScoped) {
    for (const record of group.records) {
      if (record.projectId !== projectId) {
        return fail(
          'MISSING_REFERENCE',
          `${group.label} 存在不属于当前项目的记录`,
          `projectId=${record.projectId}，当前项目=${projectId}`,
        )
      }
    }
  }

  const duplicate =
    duplicateIds(snapshot.documents, 'id') ??
    duplicateIds(snapshot.revisions, 'id') ??
    duplicateIds(snapshot.bindings, 'id') ??
    duplicateIds(snapshot.events, 'id') ??
    duplicateIds(snapshot.analysisSnapshots, 'id') ??
    duplicateIds(snapshot.importSnapshots, 'id') ??
    duplicateIds(snapshot.migrationBackups, 'id') ??
    duplicateIds(snapshot.fileRevisions, 'revisionId')
  if (duplicate !== null) {
    return fail('INVALID_RECORD', `稳定 ID 重复：${duplicate}`)
  }

  const blobKeyDuplicate = duplicateIds(snapshot.blobs, 'blobKey')
  if (blobKeyDuplicate !== null) {
    return fail('INVALID_RECORD', `blobKey 重复：${blobKeyDuplicate}`)
  }

  const partDuplicate = duplicateIds(snapshot.project.parts, 'partId')
  if (partDuplicate !== null) {
    return fail('INVALID_RECORD', `partId 重复：${partDuplicate}`)
  }
  const modelDuplicate = duplicateIds(snapshot.project.modelRevisions, 'modelRevisionId')
  if (modelDuplicate !== null) {
    return fail('INVALID_RECORD', `modelRevisionId 重复：${modelDuplicate}`)
  }
  const linkDuplicate = duplicateLinkIds(snapshot.project.dimensionLinks)
  if (linkDuplicate !== null) {
    return fail('INVALID_RECORD', `维度关联 ID 重复：${linkDuplicate}`)
  }
  // 模型版本与来源版本使用不同命名空间：同一个 ID 不能同时出现在两边。
  const sourceRevisionIds = new Set(snapshot.revisions.map((item) => item.id))
  for (const model of snapshot.project.modelRevisions) {
    if (sourceRevisionIds.has(model.modelRevisionId)) {
      return fail(
        'INVALID_RECORD',
        '模型版本 ID 与来源版本 ID 碰撞',
        model.modelRevisionId,
      )
    }
  }

  const documentById = new Map(snapshot.documents.map((item) => [item.id, item]))
  const revisionById = new Map(snapshot.revisions.map((item) => [item.id, item]))
  const blobByKey = new Map(snapshot.blobs.map((item) => [item.blobKey, item]))
  const missingByRevision = new Map(
    snapshot.missingAttachments.map((item) => [item.revisionId, item]),
  )
  const termIds = new Set(snapshot.project.dimensionChain.terms.map((term) => term.id))

  for (const document of snapshot.documents) {
    const latest = revisionById.get(document.latestRevisionId)
    if (latest === undefined) {
      return fail(
        'MISSING_REFERENCE',
        `文档 ${document.id} 的 latestRevisionId 无对应版本`,
        document.latestRevisionId,
      )
    }
    if (latest.documentId !== document.id) {
      return fail(
        'MISSING_REFERENCE',
        `文档 ${document.id} 的最新版本属于其它文档`,
        latest.documentId,
      )
    }
  }

  for (const revision of snapshot.revisions) {
    const document = documentById.get(revision.documentId)
    if (document === undefined) {
      return fail('MISSING_REFERENCE', `版本 ${revision.id} 引用了不存在的文档`, revision.documentId)
    }
    const blob = blobByKey.get(revision.blobKey)
    if (blob === undefined) {
      // 合法缺附件：必须由 missingAttachments 逐条声明；不能静默当可用。
      if (missingByRevision.has(revision.id)) {
        continue
      }
      return fail('MISSING_REFERENCE', `版本 ${revision.id} 缺少 blob 元数据`, revision.blobKey)
    }
    if (missingByRevision.has(revision.id)) {
      return fail('INVALID_RECORD', `版本 ${revision.id} 既声明缺失又存在 blob 元数据`)
    }
    if (blob.sha256 !== revision.sha256 || blob.byteSize !== revision.byteSize) {
      return fail(
        'HASH_MISMATCH',
        `版本 ${revision.id} 与 blob 元数据的大小/哈希不一致`,
      )
    }
  }

  const attachmentByKey = new Map(
    snapshot.attachments.map((item) => [item.blobKey, item]),
  )

  // ---- B2：部件 / 模型版本 / 字节引用 --------------------------------
  const partById = new Map(snapshot.project.parts.map((item) => [item.partId, item]))
  const modelById = new Map(
    snapshot.project.modelRevisions.map((item) => [item.modelRevisionId, item]),
  )
  for (const part of snapshot.project.parts) {
    if (part.currentModelRevisionId === null) continue
    const current = modelById.get(part.currentModelRevisionId)
    if (current === undefined) {
      return fail(
        'MISSING_REFERENCE',
        `部件 ${part.partId} 的当前模型版本不存在`,
        part.currentModelRevisionId,
      )
    }
    if (current.partId !== part.partId) {
      return fail(
        'MISSING_REFERENCE',
        `部件 ${part.partId} 的当前模型版本属于其它部件`,
        current.partId,
      )
    }
  }
  for (const model of snapshot.project.modelRevisions) {
    if (!partById.has(model.partId)) {
      return fail('MISSING_REFERENCE', `模型版本 ${model.modelRevisionId} 引用了不存在的部件`, model.partId)
    }
    if (model.parentModelRevisionId !== null) {
      const parent = modelById.get(model.parentModelRevisionId)
      if (parent === undefined) {
        return fail(
          'MISSING_REFERENCE',
          `模型版本 ${model.modelRevisionId} 的父版本不存在`,
          model.parentModelRevisionId,
        )
      }
      if (parent.partId !== model.partId) {
        return fail(
          'MISSING_REFERENCE',
          `模型版本 ${model.modelRevisionId} 的父版本属于其它部件`,
          parent.partId,
        )
      }
    }
    const blob = blobByKey.get(model.blobKey)
    if (blob === undefined) {
      return fail('MISSING_REFERENCE', `模型版本 ${model.modelRevisionId} 缺少 blob 元数据`, model.blobKey)
    }
    if (blob.sha256 !== model.attachmentSha256 || blob.byteSize !== model.byteSize) {
      return fail(
        'HASH_MISMATCH',
        `模型版本 ${model.modelRevisionId} 与 blob 元数据的大小/哈希不一致`,
      )
    }
    if (!attachmentByKey.has(model.blobKey)) {
      return fail(
        'MISSING_REFERENCE',
        `模型版本 ${model.modelRevisionId} 的字节缺失（模型版本不允许缺附件声明）`,
        model.blobKey,
      )
    }
  }
  // 模型版本父链无环。
  for (const model of snapshot.project.modelRevisions) {
    const visited = new Set<string>([model.modelRevisionId])
    let cursor = model.parentModelRevisionId
    while (cursor !== null) {
      if (visited.has(cursor)) {
        return fail('INVALID_RECORD', `模型版本父链存在环：${model.modelRevisionId}`)
      }
      visited.add(cursor)
      cursor = modelById.get(cursor)?.parentModelRevisionId ?? null
    }
  }
  // 每个 blob 至少要有一个版本引用；不允许无来源的孤立字节。
  for (const blob of snapshot.blobs) {
    const referenced =
      snapshot.revisions.some((item) => item.blobKey === blob.blobKey) ||
      snapshot.project.modelRevisions.some((item) => item.blobKey === blob.blobKey)
    if (!referenced) {
      return fail('MISSING_REFERENCE', 'blob 没有被任何来源或模型版本引用', blob.blobKey)
    }
    if (!attachmentByKey.has(blob.blobKey)) {
      const missing = snapshot.missingAttachments.some((item) => item.blobKey === blob.blobKey)
      if (!missing) {
        return fail('MISSING_REFERENCE', 'blob 元数据存在但既无字节也无缺附件声明', blob.blobKey)
      }
    }
  }

  // ---- B2/D：维度关联（外形资料来源 或 参数绑定） ----------------------
  const bindingTerms = new Set<string>()
  for (const link of snapshot.project.dimensionLinks) {
    if (!termIds.has(link.termId)) {
      return fail('MISSING_REFERENCE', `关联 ${linkKindId(link)} 引用了不存在的组成环`, link.termId)
    }
    if (link.kind === 'visual-reference') {
      if (!partById.has(link.target.partId)) {
        return fail('MISSING_REFERENCE', `关联 ${link.linkId} 引用了不存在的部件`, link.target.partId)
      }
      if (link.target.granularity === 'model' && link.target.modelRevisionId === null) {
        return fail('INVALID_RECORD', `关联 ${link.linkId} 使用模型粒度但没有具体版本`)
      }
      for (const [label, revisionId] of [
        ['目标版本', link.target.modelRevisionId],
        ['确认版本', link.reviewedModelRevisionId],
      ] as const) {
        if (revisionId === null) continue
        const model = modelById.get(revisionId)
        if (model === undefined) {
          return fail('MISSING_REFERENCE', `关联 ${link.linkId} 的${label}不存在`, revisionId)
        }
        if (model.partId !== link.target.partId) {
          return fail(
            'MISSING_REFERENCE',
            `关联 ${link.linkId} 的${label}属于其它部件`,
            `${model.partId} != ${link.target.partId}`,
          )
        }
      }
      continue
    }
    // D：参数绑定——一参一环，引用必须指向现存参数且 partId 一致。
    if (bindingTerms.has(link.termId)) {
      return fail(
        'INVALID_RECORD',
        `组成环 ${link.termId} 存在第二个参数绑定`,
        link.bindingId,
      )
    }
    bindingTerms.add(link.termId)
    if (link.partId !== SPACER_PART_ID && !partById.has(link.partId)) {
      return fail('MISSING_REFERENCE', `参数绑定 ${link.bindingId} 引用了不存在的部件`, link.partId)
    }
    const parameter = snapshot.project.parameters.find(
      (item) => item.parameterId === link.parameterId,
    )
    if (parameter === undefined) {
      return fail(
        'MISSING_REFERENCE',
        `参数绑定 ${link.bindingId} 引用了不存在的参数`,
        link.parameterId,
      )
    }
    if (parameter.partId !== link.partId) {
      return fail(
        'MISSING_REFERENCE',
        `参数绑定 ${link.bindingId} 的部件与参数不一致`,
        `${link.partId} != ${parameter.partId}`,
      )
    }
    if (parameter.partId !== SPACER_PART_ID) {
      return fail('MISSING_REFERENCE', `参数绑定 ${link.bindingId} 指向不支持的部件`)
    }
  }

  // ---- V3.5：Beta 任务书条款与检查证据 --------------------------------
  const fileRevisionIds = new Set(snapshot.fileRevisions.map((item) => item.revisionId))
  const requirementRevisionIds = new Set<string>()
  const requirementIds = new Set<string>()
  for (const requirement of snapshot.project.requirementRevisions) {
    if (requirementRevisionIds.has(requirement.revisionId)) {
      return fail('INVALID_RECORD', `条款版本 ID 重复：${requirement.revisionId}`)
    }
    requirementRevisionIds.add(requirement.revisionId)
    if (requirementIds.has(requirement.requirementId) === false) {
      requirementIds.add(requirement.requirementId)
    }
    if (requirement.projectId !== projectId) {
      return fail(
        'MISSING_REFERENCE',
        `条款 ${requirement.revisionId} 不属于当前项目`,
        requirement.projectId,
      )
    }
    if (
      requirement.chainRef.kind !== 'project-dimension-chain' ||
      requirement.chainRef.projectId !== projectId
    ) {
      return fail('MISSING_REFERENCE', `条款 ${requirement.revisionId} 的链引用不合法`)
    }
    if (!Number.isSafeInteger(requirement.lowerQ) || !Number.isSafeInteger(requirement.upperQ)) {
      return fail('INVALID_RECORD', `条款 ${requirement.revisionId} 的上下限必须是整数 q`)
    }
    if (requirement.lowerQ > requirement.upperQ) {
      return fail('INVALID_RECORD', `条款 ${requirement.revisionId} 的下限大于上限`)
    }
    if (requirement.parentRevisionId !== null) {
      const parent = snapshot.project.requirementRevisions.find(
        (item) => item.revisionId === requirement.parentRevisionId,
      )
      if (parent === undefined) {
        return fail(
          'MISSING_REFERENCE',
          `条款 ${requirement.revisionId} 的父版本不存在`,
          requirement.parentRevisionId,
        )
      }
      if (parent.requirementId !== requirement.requirementId) {
        return fail(
          'INVALID_RECORD',
          `条款 ${requirement.revisionId} 的父版本属于其它条款`,
        )
      }
    }
    // 用户断言来源没有 PDF 可核：完整性由 attestation 判据与项目账本负责。
    if (requirement.source.kind === 'user-attestation') {
      if (!isProvenanceCompleteness(requirement.source.attestation)) {
        return fail(
          'INVALID_RECORD',
          `条款 ${requirement.revisionId} 的用户断言出处不完整`,
        )
      }
    } else {
      const sourceDocument = documentById.get(requirement.source.documentId)
      const sourceRevision = revisionById.get(requirement.source.revisionId)
      if (sourceDocument === undefined || sourceRevision === undefined) {
        return fail(
          'MISSING_REFERENCE',
          `条款 ${requirement.revisionId} 引用的任务书版本不存在`,
        )
      }
      if (sourceRevision.documentId !== sourceDocument.id) {
        return fail(
          'MISSING_REFERENCE',
          `条款 ${requirement.revisionId} 的文档与版本不一致`,
        )
      }
      if (sourceRevision.sha256 !== requirement.source.sha256) {
        return fail(
          'HASH_MISMATCH',
          `条款 ${requirement.revisionId} 的 PDF 哈希与来源版本不一致`,
        )
      }
      if (requirement.source.page > sourceRevision.pageCount) {
        return fail(
          'INVALID_RECORD',
          `条款 ${requirement.revisionId} 的页码越界`,
          `page=${requirement.source.page}, pageCount=${sourceRevision.pageCount}`,
        )
      }
      const regionError = validateBindingRegion(
        requirement.source.pageBoxPdf,
        requirement.source.rectPdf,
      )
      if (regionError !== null) {
        return fail(
          'INVALID_RECORD',
          `条款 ${requirement.revisionId} 的选区不合法`,
          regionError,
        )
      }
    }
  }
  // Beta 只允许一个活动 requirementId，且活动版本必须存在。
  if (requirementIds.size > 1) {
    return fail(
      'INVALID_RECORD',
      'Beta 一条尺寸链最多允许一个活动条款身份',
      [...requirementIds].join('；'),
    )
  }
  const activeRequirementRevisionId = snapshot.project.activeRequirementRevisionId
  if (activeRequirementRevisionId !== null && !requirementRevisionIds.has(activeRequirementRevisionId)) {
    return fail(
      'MISSING_REFERENCE',
      '活动条款版本不存在',
      activeRequirementRevisionId,
    )
  }
  const currentCheck = snapshot.project.currentRequirementCheck
  if (currentCheck !== null) {
    if (currentCheck.projectId !== projectId) {
      return fail('MISSING_REFERENCE', '当前条款检查不属于当前项目')
    }
    if (
      currentCheck.chainRef.kind !== 'project-dimension-chain' ||
      currentCheck.chainRef.projectId !== projectId
    ) {
      return fail('MISSING_REFERENCE', '当前条款检查的链引用不合法')
    }
    if (
      currentCheck.requirementRevisionId !== null &&
      !requirementRevisionIds.has(currentCheck.requirementRevisionId)
    ) {
      return fail(
        'MISSING_REFERENCE',
        '当前条款检查引用的条款版本不存在',
        currentCheck.requirementRevisionId,
      )
    }
    if (currentCheck.requirementRevisionId === null && currentCheck.status !== 'unchecked') {
      return fail('INVALID_RECORD', '无条款的检查只能是未检查状态')
    }
    if (currentCheck.basis.kind === 'project-revision') {
      const basisRevision = fileRevisionIds.has(currentCheck.basis.projectRevisionId)
      if (!basisRevision) {
        return fail(
          'MISSING_REFERENCE',
          '当前条款检查的正式版本基准不存在',
          currentCheck.basis.projectRevisionId,
        )
      }
    }
    if (
      currentCheck.status === 'unchecked' &&
      (currentCheck.resultInterval !== null || currentCheck.margins !== null)
    ) {
      return fail('INVALID_RECORD', '未检查的条款不得携带当前有效结果区间/裕量')
    }
  }

  // ---- V3.6：提取草稿的引用与决定一致性 -------------------------------
  const extractionCheck = validateExtractionDraftReferences(snapshot)
  if (!extractionCheck.ok) return extractionCheck

  // ---- C：隔套参数与图纸快照引用 --------------------------------------
  const parameterIds = new Set<string>()
  const parameterKeys = new Set<string>()
  for (const parameter of snapshot.project.parameters) {
    if (parameterIds.has(parameter.parameterId)) {
      return fail('INVALID_RECORD', `隔套参数 ID 重复：${parameter.parameterId}`)
    }
    if (parameterKeys.has(parameter.key)) {
      return fail('INVALID_RECORD', `隔套参数键重复：${parameter.key}`)
    }
    parameterIds.add(parameter.parameterId)
    parameterKeys.add(parameter.key)
    if (!Number.isSafeInteger(parameter.parameterRevision) || parameter.parameterRevision < 1) {
      return fail(
        'INVALID_RECORD',
        `隔套参数修订号必须是 ≥1 的整数：${parameter.parameterId}`,
      )
    }
    if (parameter.partId !== SPACER_PART_ID) {
      return fail('MISSING_REFERENCE', `隔套参数引用了不支持的部件：${parameter.partId}`)
    }
  }
  let validatedParameters: ReturnType<typeof validateSpacerParameterSnapshot> | null = null
  if (snapshot.project.parameters.length > 0) {
    validatedParameters = validateSpacerParameterSnapshot(snapshot.project.parameters)
    if (!validatedParameters.ok) {
      return fail('INVALID_RECORD', `隔套参数不合法：${validatedParameters.message}`)
    }
  }
  const drawingIds = new Set<string>()
  for (const drawing of snapshot.project.drawings) {
    if (drawingIds.has(drawing.drawingId)) {
      return fail('INVALID_RECORD', `图纸 ID 重复：${drawing.drawingId}`)
    }
    drawingIds.add(drawing.drawingId)
    if (drawing.partId !== SPACER_PART_ID) {
      return fail('MISSING_REFERENCE', `图纸引用了不支持的部件：${drawing.partId}`)
    }
    if (!fileRevisionIds.has(drawing.revisionId)) {
      return fail('MISSING_REFERENCE', `图纸 ${drawing.drawingId} 的生成基准版本不存在`, drawing.revisionId)
    }
    if (validatedParameters === null || !validatedParameters.ok) {
      return fail('MISSING_REFERENCE', `图纸 ${drawing.drawingId} 缺少隔套参数`)
    }
    const referenced = new Set(drawing.parameterIds)
    if (referenced.size !== drawing.parameterIds.length) {
      return fail('INVALID_RECORD', `图纸 ${drawing.drawingId} 的参数引用重复`)
    }
    for (const parameter of validatedParameters.parameters) {
      if (!referenced.has(parameter.parameterId)) {
        return fail(
          'MISSING_REFERENCE',
          `图纸 ${drawing.drawingId} 缺少参数引用`,
          parameter.parameterId,
        )
      }
    }
    if (referenced.size !== validatedParameters.parameters.length) {
      return fail('MISSING_REFERENCE', `图纸 ${drawing.drawingId} 引用了多余的参数`)
    }
    // 不信任保存的指纹：用参数 + 模板 + 图框确定性重建后比对。
    let rebuilt
    try {
      rebuilt = buildSpacerDrawing({
        projectId: snapshot.project.id,
        revisionId: drawing.revisionId,
        drawingId: drawing.drawingId,
        parameters: validatedParameters.parameters,
        scale: drawing.scale,
        frameFields: drawing.frameFields,
      })
    } catch (error) {
      if (error instanceof DrawingBuildError) {
        return fail(
          'INVALID_RECORD',
          `图纸 ${drawing.drawingId} 无法按保存的参数重建：${error.message}`,
          error.detail,
        )
      }
      throw error
    }
    if (rebuilt.fingerprint !== drawing.dataFingerprint) {
      return fail(
        'INVALID_RECORD',
        `图纸 ${drawing.drawingId} 的重建指纹与保存的 dataFingerprint 不一致`,
        `saved=${drawing.dataFingerprint}, rebuilt=${rebuilt.fingerprint}`,
      )
    }
  }

  for (const missing of snapshot.missingAttachments) {
    const revision = revisionById.get(missing.revisionId)
    if (revision === undefined) {
      return fail('MISSING_REFERENCE', '缺附件声明引用了不存在的版本', missing.revisionId)
    }
    if (revision.blobKey !== missing.blobKey || revision.documentId !== missing.documentId) {
      return fail('MISSING_REFERENCE', '缺附件声明与版本元数据不一致', missing.revisionId)
    }
    if (attachmentByKey.has(missing.blobKey)) {
      return fail(
        'INVALID_RECORD',
        '同一附件既声明缺失又提供了字节',
        missing.blobKey,
      )
    }
  }
  for (const revision of snapshot.revisions) {
    if (!attachmentByKey.has(revision.blobKey) && !missingByRevision.has(revision.id)) {
      return fail(
        'MISSING_REFERENCE',
        `版本 ${revision.id} 既没有附件字节也没有缺附件声明`,
      )
    }
  }

  // 附件只允许来自本项目的 blob；不允许指向任意磁盘文件。
  for (const attachment of snapshot.attachments) {
    if (!blobByKey.has(attachment.blobKey)) {
      return fail('MISSING_REFERENCE', '附件字节没有对应的 blob 元数据', attachment.blobKey)
    }
  }

  for (const binding of snapshot.bindings) {
    const revision = revisionById.get(binding.revisionId)
    if (revision === undefined) {
      return fail('MISSING_REFERENCE', `绑定 ${binding.id} 引用了不存在的版本`, binding.revisionId)
    }
    if (revision.documentId !== binding.documentId) {
      return fail('MISSING_REFERENCE', `绑定 ${binding.id} 的文档与版本不一致`)
    }
    if (binding.page > revision.pageCount) {
      return fail(
        'INVALID_RECORD',
        `绑定 ${binding.id} 的页码越界`,
        `page=${binding.page}, pageCount=${revision.pageCount}`,
      )
    }
    if (!termIds.has(binding.termId)) {
      return fail(
        'MISSING_REFERENCE',
        `绑定 ${binding.id} 引用了当前方案中不存在的组成环`,
        binding.termId,
      )
    }
    const regionError = validateBindingRegion(binding.pageBoxPdf, binding.rectPdf)
    if (regionError !== null) {
      return fail('INVALID_RECORD', `绑定 ${binding.id} 的区域不合法`, regionError)
    }
    if (binding.historicalAcceptance !== null) {
      if (!revisionById.has(binding.historicalAcceptance.latestRevisionId)) {
        return fail(
          'MISSING_REFERENCE',
          `绑定 ${binding.id} 的历史接受凭据引用了不存在的版本`,
        )
      }
    }
  }

  const snapshotById = new Map(
    snapshot.analysisSnapshots.map((item) => [item.id, item]),
  )
  for (const reference of snapshot.snapshotReferences) {
    if (!snapshotById.has(reference.snapshotId)) {
      return fail(
        'MISSING_REFERENCE',
        '快照引用指向不存在的分析快照',
        reference.snapshotId,
      )
    }
    for (const revisionId of reference.revisionIds) {
      if (!revisionById.has(revisionId)) {
        return fail('MISSING_REFERENCE', '快照引用包含不存在的版本', revisionId)
      }
    }
    for (const blobKey of reference.blobKeys) {
      if (!blobByKey.has(blobKey)) {
        return fail('MISSING_REFERENCE', '快照引用包含不存在的 blob', blobKey)
      }
    }
  }

  const revisionFileById = new Map(
    snapshot.fileRevisions.map((item) => [item.revisionId, item]),
  )
  if (!revisionFileById.has(snapshot.project.currentRevisionId)) {
    return fail(
      'MISSING_REFERENCE',
      '项目 currentRevisionId 在文件版本中不存在',
      snapshot.project.currentRevisionId,
    )
  }
  for (const revision of snapshot.fileRevisions) {
    if (revision.project.id !== projectId) {
      return fail('INVALID_RECORD', `文件版本 ${revision.revisionId} 属于其它项目`)
    }
    if (revision.parentId !== null && !revisionFileById.has(revision.parentId)) {
      return fail(
        'MISSING_REFERENCE',
        `文件版本 ${revision.revisionId} 的父版本不存在`,
        revision.parentId,
      )
    }
  }
  // 父链无环。
  for (const revision of snapshot.fileRevisions) {
    const visited = new Set<string>([revision.revisionId])
    let cursor = revision.parentId
    while (cursor !== null) {
      if (visited.has(cursor)) {
        return fail('INVALID_RECORD', `文件版本父链存在环：${revision.revisionId}`)
      }
      visited.add(cursor)
      cursor = revisionFileById.get(cursor)?.parentId ?? null
    }
  }

  // D：版本证据只允许引用本次聚合里真实存在的快照/事件/来源版本。
  const eventById = new Map(snapshot.events.map((event) => [event.id, event]))
  for (const revision of snapshot.fileRevisions) {
    if (revision.evidence === undefined) continue
    const evidence = revision.evidence
    if (
      evidence.analysisSnapshotId !== null &&
      !snapshotById.has(evidence.analysisSnapshotId)
    ) {
      return fail(
        'MISSING_REFERENCE',
        `版本 ${revision.revisionId} 的证据引用了不存在的分析快照`,
        evidence.analysisSnapshotId,
      )
    }
    for (const eventId of evidence.eventIds) {
      if (!eventById.has(eventId)) {
        return fail(
          'MISSING_REFERENCE',
          `版本 ${revision.revisionId} 的证据引用了不存在的事件`,
          eventId,
        )
      }
    }
    for (const item of evidence.sourceManifest.revisions) {
      if (!revisionById.has(item.revisionId)) {
        return fail(
          'MISSING_REFERENCE',
          `版本 ${revision.revisionId} 的来源清单引用了不存在的来源版本`,
          item.revisionId,
        )
      }
    }
    if (
      evidence.restoredFromRevisionId !== null &&
      !revisionFileById.has(evidence.restoredFromRevisionId)
    ) {
      return fail(
        'MISSING_REFERENCE',
        `版本 ${revision.revisionId} 的恢复来源不存在`,
        evidence.restoredFromRevisionId,
      )
    }
  }

  return ok(undefined)
}

/* ------------------------------------------------------------------ */
/* 容器层                                                               */
/* ------------------------------------------------------------------ */

export interface ActualEntry {
  path: string
  byteSize: number
  sha256: string
}

function roleForPath(path: string): ProjectFileEntryRole | null {
  if (path === PROJECT_FILE_PATHS.project) return 'project'
  if (path === PROJECT_FILE_PATHS.draft) return 'workspace'
  if (
    path === PROJECT_FILE_PATHS.documents ||
    path === PROJECT_FILE_PATHS.revisions ||
    path === PROJECT_FILE_PATHS.bindings ||
    path === PROJECT_FILE_PATHS.blobs
  ) {
    return 'source-meta'
  }
  if (
    path === PROJECT_FILE_PATHS.events ||
    path === PROJECT_FILE_PATHS.analysisSnapshots ||
    path === PROJECT_FILE_PATHS.importSnapshots ||
    path === PROJECT_FILE_PATHS.migrationBackups
  ) {
    return 'history'
  }
  if (path === PROJECT_FILE_PATHS.legacyArchive) return 'legacy-archive'
  if (path.startsWith(ATTACHMENT_PATH_PREFIX) && path.endsWith(ATTACHMENT_EXTENSION)) {
    return 'attachment'
  }
  if (path.startsWith(REVISION_PATH_PREFIX) && path.endsWith(REVISION_EXTENSION)) {
    return 'revision'
  }
  return null
}

/**
 * 条目集合、路径白名单、角色、大小、哈希与计数。
 *
 * `actual` 来自 ZIP 实际解压结果；manifest 声明的 entries 必须与实际完全一致。
 */
export function validateContainerEntries(
  manifest: ProjectFileManifest,
  snapshot: ProjectFileSnapshot,
  actual: readonly ActualEntry[],
  actualPayloadBytes: number,
): ProjectFileResult<void> {
  const expectedRoles = expectedEntryRoles(snapshot)
  const expectedPaths = new Set(expectedRoles.map((entry) => entry.path))
  const actualPaths = new Set(actual.map((entry) => entry.path))

  if (actualPaths.size !== actual.length) {
    return fail('DUPLICATE_ENTRY', 'ZIP 中存在重复条目')
  }
  for (const entry of actual) {
    if (!expectedPaths.has(entry.path)) {
      return fail('UNSAFE_PATH', `ZIP 包含未授权的条目：${entry.path}`)
    }
    const pathError = validateEntryPath(entry.path)
    if (pathError !== null) {
      return fail('UNSAFE_PATH', `条目路径不安全：${entry.path}`, pathError)
    }
  }
  for (const path of expectedPaths) {
    if (!actualPaths.has(path)) {
      return fail('MISSING_REFERENCE', `ZIP 缺少必需条目：${path}`)
    }
  }

  const declaredByPath = new Map(manifest.entries.map((entry) => [entry.path, entry]))
  if (declaredByPath.size !== manifest.entries.length) {
    return fail('INVALID_MANIFEST', 'manifest.entries 存在重复路径')
  }
  const sorted = [...manifest.entries].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index]?.path !== manifest.entries[index]?.path) {
      return fail('INVALID_MANIFEST', 'manifest.entries 未按 path 升序排列')
    }
  }

  const expectedRoleByPath = new Map(expectedRoles.map((entry) => [entry.path, entry.role]))
  let declaredPayload = 0
  for (const entry of manifest.entries) {
    const expectedRole = expectedRoleByPath.get(entry.path)
    if (expectedRole === undefined) {
      return fail('INVALID_MANIFEST', `manifest 声明了未授权条目：${entry.path}`)
    }
    if (entry.role !== expectedRole) {
      return fail(
        'INVALID_MANIFEST',
        `条目角色不匹配：${entry.path}`,
        `声明 ${entry.role}，应为 ${expectedRole}`,
      )
    }
    const actualEntry = actual.find((item) => item.path === entry.path)
    if (actualEntry === undefined) {
      return fail('MISSING_REFERENCE', `manifest 声明的条目缺失：${entry.path}`)
    }
    if (actualEntry.byteSize !== entry.byteSize) {
      return fail(
        'HASH_MISMATCH',
        `条目大小不一致：${entry.path}`,
        `声明 ${entry.byteSize}，实际 ${actualEntry.byteSize}`,
      )
    }
    if (actualEntry.sha256 !== entry.sha256) {
      return fail('HASH_MISMATCH', `条目哈希不一致：${entry.path}`)
    }
    declaredPayload += entry.byteSize
    if (!Number.isSafeInteger(declaredPayload)) {
      return fail('INVALID_MANIFEST', '条目大小合计溢出')
    }
  }
  if (declaredPayload !== manifest.payloadBytes) {
    return fail(
      'INVALID_MANIFEST',
      'manifest.payloadBytes 与条目大小合计不一致',
      `声明 ${manifest.payloadBytes}，实际 ${declaredPayload}`,
    )
  }
  if (declaredPayload !== actualPayloadBytes) {
    return fail('HASH_MISMATCH', '实际解压载荷大小与 manifest 不一致')
  }

  const counts = computeCounts(snapshot)
  for (const key of Object.keys(counts) as (keyof ProjectFileCounts)[]) {
    if (manifest.counts[key] !== counts[key]) {
      return fail(
        'INVALID_MANIFEST',
        `manifest.counts.${key} 与实际不一致`,
        `声明 ${manifest.counts[key]}，实际 ${counts[key]}`,
      )
    }
  }

  if (manifest.project.id !== snapshot.project.id) {
    return fail('INVALID_MANIFEST', 'manifest.project.id 与 project.json 不一致')
  }
  if (manifest.project.name !== snapshot.project.name) {
    return fail('INVALID_MANIFEST', 'manifest.project.name 与 project.json 不一致')
  }
  if (manifest.project.currentRevisionId !== snapshot.project.currentRevisionId) {
    return fail('INVALID_MANIFEST', 'manifest.currentRevisionId 与 project.json 不一致')
  }

  const expectedRefs = expectedAttachmentRefs(snapshot)
  if (JSON.stringify(manifest.attachments) !== JSON.stringify(expectedRefs)) {
    return fail('INVALID_MANIFEST', 'manifest.attachments 与来源版本/附件不一致')
  }
  if (
    !sameReferenceSet(manifest.missingAttachments, snapshot.missingAttachments) ||
    JSON.stringify(manifest.missingAttachments) !== JSON.stringify(snapshot.missingAttachments)
  ) {
    return fail('INVALID_MANIFEST', 'manifest.missingAttachments 与实际缺附件不一致')
  }
  if (JSON.stringify(manifest.snapshotReferences) !== JSON.stringify(snapshot.snapshotReferences)) {
    return fail('INVALID_MANIFEST', 'manifest.snapshotReferences 与实际快照引用不一致')
  }
  if (JSON.stringify(manifest.migration) !== JSON.stringify(snapshot.manifestMeta.migration)) {
    return fail('INVALID_MANIFEST', 'manifest.migration 与聚合元数据不一致')
  }

  return ok(undefined)
}

function sameReferenceSet(
  left: ProjectFileMissingAttachment[],
  right: ProjectFileMissingAttachment[],
): boolean {
  const key = (item: ProjectFileMissingAttachment): string =>
    `${item.revisionId}|${item.documentId}|${item.blobKey}|${item.reason}`
  const leftSet = new Set(left.map(key))
  const rightSet = new Set(right.map(key))
  if (leftSet.size !== rightSet.size) {
    return false
  }
  for (const value of leftSet) {
    if (!rightSet.has(value)) {
      return false
    }
  }
  return true
}

/** 附件字节哈希核对（打开与保存自校验共用）；共享 blob 只核对一次。 */
export async function validateAttachmentBytes(
  snapshot: ProjectFileSnapshot,
  hash: (bytes: Uint8Array) => Promise<string>,
): Promise<ProjectFileResult<void>> {
  const blobByKey = new Map(snapshot.blobs.map((blob) => [blob.blobKey, blob]))
  const attachmentByKey = new Map<string, ProjectFileAttachmentInput>()
  for (const attachment of snapshot.attachments) {
    const existing = attachmentByKey.get(attachment.blobKey)
    if (existing !== undefined && existing.bytes !== attachment.bytes) {
      return fail('INVALID_RECORD', '同一 blobKey 出现了两份不同字节', attachment.blobKey)
    }
    attachmentByKey.set(attachment.blobKey, attachment)
  }
  for (const [blobKey, attachment] of attachmentByKey) {
    const blob = blobByKey.get(blobKey)
    if (blob === undefined) {
      return fail('MISSING_REFERENCE', '附件缺少 blob 元数据', blobKey)
    }
    if (attachment.bytes.byteLength !== blob.byteSize) {
      return fail(
        'HASH_MISMATCH',
        `附件大小不一致：${blobKey}`,
        `声明 ${blob.byteSize}，实际 ${attachment.bytes.byteLength}`,
      )
    }
    const digest = await hash(attachment.bytes)
    if (digest !== blob.sha256) {
      return fail('HASH_MISMATCH', `附件哈希不一致：${blobKey}`)
    }
  }
  return ok(undefined)
}

/**
 * 项目附件额度（B2：PDF + 模型唯一 blob 总字节，100 MiB）。
 * 打开旧文件不在这里拒绝（旧内容按原规则展示）；保存/接纳候选时检查。
 */
export function projectAssetBytes(snapshot: ProjectFileSnapshot): number {
  return sumUniqueBlobBytes(snapshot.blobs)
}

export function validateProjectAssetBudget(
  snapshot: ProjectFileSnapshot,
  addedBytes = 0,
  maxBytes: number = PROJECT_ASSETS_MAX_BYTES,
): ProjectFileResult<{ usedBytes: number; addedBytes: number; maxBytes: number }> {
  const usedBytes = projectAssetBytes(snapshot)
  const total = usedBytes + addedBytes
  if (!Number.isSafeInteger(total) || total > maxBytes) {
    return fail(
      'PROJECT_ASSETS_TOO_LARGE',
      `保留附件将超过 ${maxBytes} 字节（100 MiB）附件额度；此次未导入，旧视图和项目未改变`,
      `当前 ${usedBytes} 字节，新增 ${addedBytes} 字节，上限 ${maxBytes} 字节`,
    )
  }
  return ok({ usedBytes, addedBytes, maxBytes })
}

/** 从 manifest 声明的条目构造带角色的映射，供 codec 记录审计用。 */
export function entryRoleMap(manifest: ProjectFileManifest): Map<string, ProjectFileEntryRole> {
  return new Map(manifest.entries.map((entry) => [entry.path, entry.role]))
}

/** 供测试断言：路径角色映射必须与路径前缀规则一致。 */
export function pathRole(path: string): ProjectFileEntryRole | null {
  return roleForPath(path)
}

export type { ProjectFileEntry }
