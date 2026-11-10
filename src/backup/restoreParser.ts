/**
 * 完整备份 `.cunlian.zip` 的**纯解析与校验**管道（A-03 从 restore.ts 抽出）。
 *
 * 这里只做 ZIP 安全、manifest 结构、条目哈希、记录结构、项目作用域与引用
 * 完整性校验，不导入 IndexedDB、不写库、不要求目标库为空：
 * - 旧入口 `restoreBackup`（restore.ts）在空库事务里复用本管道；
 * - V3 迁移（src/project-file/migrateV2.ts）也复用它，但不调用恢复写入端。
 *
 * 抽出时逐段保留原实现与错误码/文案，V2 恢复行为不变。
 */
import { z } from 'zod'
import { PROJECT_SCHEMA_VERSION, type ChainDefinition, type Project } from '../domain/types'
import { validateChain } from '../domain/validation'
import { draftToChain, type WorkspaceDraft } from '../workspace/draft'
import type { AnalysisSnapshot } from '../history/snapshots'
import type { ChangeEvent } from '../history/events'
import { REVIEW_SEVERITY_LABEL, type ReviewFinding } from '../review/rules'
import type { SourceBinding } from '../sources/bindings'
import type { SourceDocument, SourceRevision } from '../sources/types'
import { sha256Hex } from '../sources/hash'
import type { ImportSnapshot, StoredDraft } from '../storage/projects'
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  MANIFEST_PATH,
  MAPPING_TEMPLATES_EXCLUDED_NOTE,
  backupPath,
} from './backupFormat'
import type { BackupManifest } from './projectBundle'
import {
  MAX_BACKUP_UNCOMPRESSED_BYTES,
  readZipEntries,
  type ZipSafetyError,
} from './zip'

export type RestoreErrorCode =
  | 'invalid_zip'
  | 'too_many_entries'
  | 'too_large'
  | 'unsafe_path'
  | 'duplicate_entry'
  | 'invalid_manifest'
  | 'hash_mismatch'
  | 'missing_reference'
  | 'invalid_record'
  | 'empty_backup'
  | 'database_not_empty'
  | 'write_failed'
  | 'storage_failure'

export interface RestoreError {
  code: RestoreErrorCode
  message: string
  detail?: string
}

export type RestoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RestoreError }

export interface BackupInspection {
  manifest: BackupManifest
  projectSummaries: { id: string; name: string; updatedAt: string }[]
  counts: BackupManifest['counts']
  createdAt: string
  totalUncompressedBytes: number
}

export interface RestoreSummary {
  projects: { id: string; name: string }[]
  counts: BackupManifest['counts']
  confirmationsCleared: true
  restoredAt: string
}

export interface ParsedBackup {
  manifest: BackupManifest
  projects: Project[]
  drafts: StoredDraft[]
  documents: SourceDocument[]
  revisions: SourceRevision[]
  blobs: {
    blobKey: string
    projectId: string
    sha256: string
    byteSize: number
    bytes: Uint8Array
  }[]
  bindings: SourceBinding[]
  events: ChangeEvent[]
  snapshots: AnalysisSnapshot[]
  importSnapshots: ImportSnapshot[]
  migrationBackups: { id: string; projectId: string }[]
}

export function failure(
  code: RestoreErrorCode,
  message: string,
  detail?: string,
): { ok: false; error: RestoreError } {
  return { ok: false, error: { code, message, ...(detail ? { detail } : {}) } }
}

function mapZipError(error: ZipSafetyError): RestoreError {
  return {
    code:
      error.code === 'too_many_entries' ||
      error.code === 'too_large' ||
      error.code === 'unsafe_path' ||
      error.code === 'duplicate_entry'
        ? error.code
        : 'invalid_zip',
    message: error.message,
    ...(error.detail ? { detail: error.detail } : {}),
  }
}

/* -------------------------------------------------------------------------- */
/* Zod 结构校验                                                               */
/* -------------------------------------------------------------------------- */

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const isoString = z.string().min(1)

const manifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  createdAt: isoString,
  note: z.string(),
  app: z.object({
    databaseVersion: z.number().int().positive(),
    projectSchemaVersion: z.number().int().positive(),
  }),
  counts: z.object({
    projects: z.number().int().nonnegative(),
    drafts: z.number().int().nonnegative(),
    documents: z.number().int().nonnegative(),
    revisions: z.number().int().nonnegative(),
    blobs: z.number().int().nonnegative(),
    bindings: z.number().int().nonnegative(),
    events: z.number().int().nonnegative(),
    snapshots: z.number().int().nonnegative(),
    importSnapshots: z.number().int().nonnegative(),
    migrationBackups: z.number().int().nonnegative(),
  }),
  projects: z.array(
    z.object({ id: isoString, name: z.string(), updatedAt: isoString }),
  ),
  // 旧版完整备份没有该字段；缺省视为“没有声明缺失附件”。
  missingAttachments: z
    .array(
      z.object({
        revisionId: z.string().min(1),
        documentId: z.string().min(1),
        blobKey: z.string().min(1),
      }),
    )
    .default([]),
  excludes: z.object({
    mappingTemplates: z.object({
      included: z.literal(false),
      count: z.number().int().nonnegative(),
      note: z.string(),
    }),
  }),
  entries: z.array(
    z.object({
      path: isoString,
      sha256: sha256Schema,
      byteSize: z.number().int().nonnegative(),
    }),
  ),
  totalUncompressedBytes: z.number().int().nonnegative(),
})

const projectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  engineVersion: z.string().min(1),
  id: z.string().min(1),
  name: z.string(),
  createdAt: isoString,
  updatedAt: isoString,
  working: z.unknown(),
  relationRevision: z.number().int().nonnegative(),
  relationReview: z
    .object({
      relationRevision: z.number().int().nonnegative(),
      fingerprint: z.string().min(1),
      confirmedAt: isoString,
    })
    .nullable(),
  migration: z.unknown().nullable(),
  baseline: z
    .object({ savedAt: isoString, definition: z.unknown() })
    .nullable(),
})

const draftTermSchema = z.object({
  id: z.string().min(1),
  symbol: z.string(),
  name: z.string(),
  nominal: z.string(),
  lower: z.string(),
  upper: z.string(),
  sign: z.union([z.literal(1), z.literal(-1)]),
  sourceNote: z.string(),
  termRevision: z.number().int().positive(),
})

const draftSchema = z.object({
  terms: z.array(draftTermSchema),
  targetMin: z.string(),
  targetMax: z.string(),
  assumptions: z.string(),
  relationRevision: z.number().int().nonnegative(),
})

const storedDraftSchema = z.object({
  projectId: z.string().min(1),
  draft: draftSchema,
  savedAt: isoString,
})

const documentSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string(),
  latestRevisionId: z.string().min(1),
})

const revisionSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  documentId: z.string().min(1),
  fileName: z.string().min(1),
  sha256: sha256Schema,
  byteSize: z.number().int().nonnegative(),
  pageCount: z.number().int().positive(),
  createdAt: isoString,
  blobKey: z.string().min(1),
})

const blobMetaSchema = z.object({
  blobKey: z.string().min(1),
  projectId: z.string().min(1),
  sha256: sha256Schema,
  byteSize: z.number().int().nonnegative(),
})

const historicalAcceptanceSchema = z.object({
  reason: z.string().min(1),
  scope: z.string().min(1),
  acceptedAt: isoString,
  latestRevisionId: z.string().min(1),
})

const bindingSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  termId: z.string().min(1),
  revisionId: z.string().min(1),
  documentId: z.string().min(1),
  page: z.number().int().positive(),
  rectPdf: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  pageBoxPdf: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  note: z.string(),
  createdAt: isoString,
  reviewedTermRevision: z.number().int().positive().nullable(),
  reviewedAt: isoString.nullable(),
  historicalAcceptance: historicalAcceptanceSchema.nullable().optional(),
})

const eventSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    type: z.string().min(1),
    createdAt: isoString,
  })
  .passthrough()

const resultSchema = z.object({
  nominalQ: z.number(),
  minQ: z.number(),
  maxQ: z.number(),
  lowerDeviationQ: z.number(),
  upperDeviationQ: z.number(),
  toleranceQ: z.number(),
  status: z.enum(['within', 'outside', 'no-target']),
  lowerMarginQ: z.number().nullable(),
  upperMarginQ: z.number().nullable(),
  contributions: z.array(
    z.object({ termId: z.string(), toleranceQ: z.number() }),
  ),
})

const reviewStatusSchema = z.enum([
  'passed',
  'failed',
  'unchecked',
  'needs-human',
  'not-applicable',
])
const reviewRuleIdSchema = z.enum([
  'INPUT_VALID',
  'SOURCE_PRESENT',
  'SOURCE_AVAILABLE',
  'SOURCE_CURRENT',
  'SOURCE_VALUE_REVIEWED',
  'RELATION_CONFIRMED',
  'CALC_VALID',
  'TARGET_WITHIN',
])
const reviewScopeSchema = z.enum(['chain', 'term', 'binding'])
const reviewSeveritySchema = z.enum(['blocking', 'warning', 'info'])

const reviewTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chain') }),
  z.object({ kind: z.literal('relation') }),
  z.object({ kind: z.literal('target') }),
  z.object({
    kind: z.literal('term'),
    termId: z.string().min(1),
    field: z
      .enum(['nominal', 'lower', 'upper', 'symbol', 'name', 'sourceNote'])
      .optional(),
  }),
  z.object({
    kind: z.literal('binding'),
    bindingId: z.string().min(1),
    termId: z.string().min(1),
    documentId: z.string().min(1),
    revisionId: z.string().min(1),
    page: z.number().int().positive(),
  }),
])

const reviewSubjectSchema = z.object({
  kind: z.enum(['chain', 'term', 'binding', 'target']),
  id: z.string().min(1),
  label: z.string(),
  termId: z.string().min(1).optional(),
  bindingId: z.string().min(1).optional(),
  documentId: z.string().min(1).optional(),
  revisionId: z.string().min(1).optional(),
  page: z.number().int().positive().optional(),
})

const reviewFindingSchema = z.object({
  ruleId: reviewRuleIdSchema,
  ruleVersion: z.string().min(1),
  scope: reviewScopeSchema,
  subject: reviewSubjectSchema,
  status: reviewStatusSchema,
  basis: z.string(),
  action: z.string().nullable(),
  severity: reviewSeveritySchema,
  needsAction: z.boolean(),
  target: reviewTargetSchema,
})

const calculationOutcomeSchema = z.object({
  status: z.enum(['within', 'outside', 'no-target', 'no-result']),
  label: z.string().min(1),
  satisfied: z.boolean().nullable(),
})

const reviewGroupSchema = z.object({
  severity: reviewSeveritySchema,
  label: z.string().min(1),
  findings: z.array(reviewFindingSchema),
})

const reviewSummarySchema = z.object({
  rulesVersion: z.string().min(1),
  findings: z.array(reviewFindingSchema),
  calculation: calculationOutcomeSchema,
  reviewComplete: z.boolean(),
  pending: z.array(reviewFindingSchema),
  canCreateReport: z.boolean(),
  hasAnyBinding: z.boolean(),
  byStatus: z.object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    unchecked: z.number().int().nonnegative(),
    'needs-human': z.number().int().nonnegative(),
    'not-applicable': z.number().int().nonnegative(),
  }),
  groups: z.array(reviewGroupSchema),
})

const deltaSchema = z.object({
  before: z.number().nullable(),
  after: z.number().nullable(),
  delta: z.number().nullable(),
})

const termFieldChangeSchema = z.discriminatedUnion('field', [
  z.object({
    termId: z.string().min(1),
    field: z.enum(['symbol', 'name', 'sourceNote']),
    before: z.string(),
    after: z.string(),
  }),
  z.object({
    termId: z.string().min(1),
    field: z.enum(['nominalQ', 'lowerDeviationQ', 'upperDeviationQ']),
    before: z.number(),
    after: z.number(),
  }),
  z.object({
    termId: z.string().min(1),
    field: z.literal('sign'),
    before: z.union([z.literal(1), z.literal(-1)]),
    after: z.union([z.literal(1), z.literal(-1)]),
  }),
])

const diffSchema = z.object({
  addedTermIds: z.array(z.string().min(1)),
  removedTermIds: z.array(z.string().min(1)),
  orderChanged: z.boolean(),
  termChanges: z.array(termFieldChangeSchema),
  targetChanged: z.boolean(),
  minQ: deltaSchema,
  maxQ: deltaSchema,
  toleranceQ: deltaSchema,
  lowerMarginQ: deltaSchema,
  upperMarginQ: deltaSchema,
  statusBefore: z.enum(['within', 'outside', 'no-target']),
  statusAfter: z.enum(['within', 'outside', 'no-target']),
})

const snapshotComparisonSchema = z.object({
  baselineResult: resultSchema,
  diff: diffSchema,
})

const snapshotBindingStatusSchema = z.object({
  available: reviewStatusSchema,
  current: reviewStatusSchema,
  valueReviewed: reviewStatusSchema,
})

const snapshotBindingEntrySchema = z.object({
  bindingId: z.string().min(1),
  termId: z.string().min(1),
  termLabel: z.string().nullable(),
  termRevision: z.number().int().positive().nullable(),
  documentId: z.string().min(1),
  documentTitle: z.string().nullable(),
  revisionId: z.string().min(1),
  fileName: z.string().nullable(),
  revisionSha256: sha256Schema.nullable(),
  revisionByteSize: z.number().int().nonnegative().nullable(),
  revisionPageCount: z.number().int().positive().nullable(),
  page: z.number().int().positive(),
  rectPdf: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  pageBoxPdf: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  note: z.string(),
  reviewedTermRevision: z.number().int().positive().nullable(),
  reviewedAt: isoString.nullable(),
  historicalAcceptance: historicalAcceptanceSchema.nullable(),
  blobAvailable: z.boolean(),
  status: snapshotBindingStatusSchema,
})

const snapshotSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  projectName: z.string(),
  createdAt: isoString,
  engineVersion: z.string().min(1),
  reviewRulesVersion: z.string().min(1),
  inputFingerprint: z.string().min(1),
  definition: z.unknown(),
  draft: draftSchema,
  result: resultSchema,
  review: reviewSummarySchema,
  sourceManifest: z.object({
    bindings: z.array(snapshotBindingEntrySchema),
    documents: z.array(documentSchema),
    revisions: z.array(revisionSchema),
    unboundTermIds: z.array(z.string().min(1)),
    availability: z.enum(['complete', 'partial']),
  }),
  baseline: z
    .object({ savedAt: isoString, definition: z.unknown() })
    .nullable(),
  // 旧版快照没有 comparison 字段（有基线时也没有冻结对比）。恢复必须接受，
  // 且不补算、不伪造；报告按“未冻结”显示。
  comparison: snapshotComparisonSchema.nullish(),
  status: z.enum(['complete', 'pending']),
  pendingCount: z.number().int().nonnegative(),
})

const importSnapshotSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  createdAt: isoString,
  kind: z.literal('replace-before-import'),
  definition: z.unknown(),
})

const migrationBackupSchema = z
  .object({ id: z.string().min(1), projectId: z.string().min(1) })
  .passthrough()

function decodeJson(bytes: Uint8Array, path: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch (error) {
    throw new BackupRecordError(
      `备份条目 ${path} 不是有效 JSON：${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

class BackupRecordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupRecordError'
  }
}

function parseRecord<T>(
  schema: z.ZodType<T>,
  value: unknown,
  path: string,
): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new BackupRecordError(
      `备份条目 ${path} 结构无效：${
        issue === undefined ? '未知错误' : `${issue.path.join('.') || '(根)'} ${issue.message}`
      }`,
    )
  }
  return parsed.data
}

function validateChainOrThrow(value: unknown, path: string): ChainDefinition {
  const validation = validateChain(value)
  if (!validation.ok) {
    throw new BackupRecordError(
      `备份条目 ${path} 的尺寸链无效：${validation.errors[0]?.message ?? '未知错误'}`,
    )
  }
  return validation.value
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameDocumentIdentity(
  left: SourceDocument,
  right: SourceDocument,
): boolean {
  // 只比较真正的不变量：文档身份与项目作用域。
  //
  // latestRevisionId 是“当前”指针：快照冻结的是创建时的版本（例如 v1），
  // 而来源文档之后升级到 v2 是完全合法的历史状态；title 同样是可编辑的
  // 当前元数据。二者都不能作为历史快照的校验条件。
  // 冻结指针本身仍由清单内部一致性保证：manifest.documents 的
  // latestRevisionId 必须指向 manifest.revisions 中的版本。
  return left.id === right.id && left.projectId === right.projectId
}

function sameRevision(left: SourceRevision, right: SourceRevision): boolean {
  return (
    left.id === right.id &&
    left.projectId === right.projectId &&
    left.documentId === right.documentId &&
    left.fileName === right.fileName &&
    left.sha256 === right.sha256 &&
    left.byteSize === right.byteSize &&
    left.pageCount === right.pageCount &&
    left.createdAt === right.createdAt &&
    left.blobKey === right.blobKey
  )
}

export function sameChain(left: ChainDefinition, right: ChainDefinition): boolean {
  if (left.assumptions !== right.assumptions) {
    return false
  }
  if (!sameJson(left.target, right.target)) {
    return false
  }
  if (left.terms.length !== right.terms.length) {
    return false
  }
  return left.terms.every((term, index) => {
    const other = right.terms[index]
    return (
      term.id === other.id &&
      term.symbol === other.symbol &&
      term.name === other.name &&
      term.nominalQ === other.nominalQ &&
      term.lowerDeviationQ === other.lowerDeviationQ &&
      term.upperDeviationQ === other.upperDeviationQ &&
      term.sign === other.sign &&
      term.sourceNote === other.sourceNote &&
      term.termRevision === other.termRevision
    )
  })
}

const RULE_SCOPES: Record<string, 'chain' | 'term' | 'binding'> = {
  INPUT_VALID: 'chain',
  CALC_VALID: 'chain',
  RELATION_CONFIRMED: 'chain',
  TARGET_WITHIN: 'chain',
  SOURCE_PRESENT: 'term',
  SOURCE_AVAILABLE: 'binding',
  SOURCE_CURRENT: 'binding',
  SOURCE_VALUE_REVIEWED: 'binding',
}

function findingKey(finding: ReviewFinding): string {
  return [
    finding.ruleId,
    finding.scope,
    finding.subject.kind,
    finding.subject.id,
    finding.status,
    finding.severity,
    finding.needsAction ? 'needs-action' : 'done',
  ].join('|')
}

const REVIEW_SEVERITIES = ['blocking', 'warning', 'info'] as const

function validateResultRecord(
  definition: ChainDefinition,
  result: AnalysisSnapshot['result'],
  snapshotId: string,
): string | null {
  const prefix = `分析快照 ${snapshotId} 的结果`
  if (result.minQ > result.maxQ) {
    return `${prefix}最小值大于最大值`
  }
  if (result.toleranceQ !== result.maxQ - result.minQ) {
    return `${prefix}公差与区间不一致`
  }
  if (result.lowerDeviationQ !== result.minQ - result.nominalQ) {
    return `${prefix}下偏差与基本尺寸不一致`
  }
  if (result.upperDeviationQ !== result.maxQ - result.nominalQ) {
    return `${prefix}上偏差与基本尺寸不一致`
  }
  const termIds = definition.terms.map((term) => term.id)
  if (!sameJson(result.contributions.map((item) => item.termId), termIds)) {
    return `${prefix}的贡献项与组成环不一致`
  }
  if (definition.target === null) {
    if (result.status !== 'no-target') {
      return `${prefix}没有目标却记录了目标判定`
    }
    if (result.lowerMarginQ !== null || result.upperMarginQ !== null) {
      return `${prefix}没有目标却有裕量`
    }
  } else {
    if (result.status === 'no-target') {
      return `${prefix}有目标却标为未判定`
    }
    if (
      result.lowerMarginQ !== result.minQ - definition.target.minQ ||
      result.upperMarginQ !== definition.target.maxQ - result.maxQ
    ) {
      return `${prefix}的裕量与目标区间不一致`
    }
  }
  return null
}

function validateReviewRecord(snapshot: AnalysisSnapshot): string | null {
  const review = snapshot.review
  const prefix = `分析快照 ${snapshot.id} 的审查结果`
  if (review.rulesVersion !== snapshot.reviewRulesVersion) {
    return `${prefix}规则版本与快照记录不一致`
  }
  if (review.canCreateReport !== true) {
    return `${prefix}必须记录为可创建报告（快照本身已有有效计算）`
  }
  if (review.hasAnyBinding !== (snapshot.sourceManifest.bindings.length > 0)) {
    return `${prefix}的 hasAnyBinding 与来源清单不一致`
  }
  if (snapshot.pendingCount !== review.pending.length) {
    return `${prefix}的 pendingCount 与待办数量不一致`
  }
  if (snapshot.status !== (review.reviewComplete ? 'complete' : 'pending')) {
    return `${prefix}的冻结状态与 reviewComplete 不一致`
  }
  if (review.reviewComplete !== (review.pending.length === 0)) {
    return `${prefix}的 reviewComplete 与待办数量不一致`
  }

  const counted: Record<string, number> = {
    passed: 0,
    failed: 0,
    unchecked: 0,
    'needs-human': 0,
    'not-applicable': 0,
  }
  for (const finding of review.findings) {
    counted[finding.status] += 1
    if (finding.ruleVersion !== review.rulesVersion) {
      return `${prefix}中 ${finding.ruleId} 的规则版本不一致`
    }
    const expectedScope = RULE_SCOPES[finding.ruleId]
    if (expectedScope === undefined || finding.scope !== expectedScope) {
      return `${prefix}中 ${finding.ruleId} 的作用域无效`
    }
    if (finding.status === 'passed' && finding.needsAction) {
      return `${prefix}中 ${finding.ruleId} 已通过却要求人工动作`
    }
    const subject = finding.subject
    if (finding.scope === 'chain') {
      if (subject.kind !== 'chain' || subject.id !== 'chain') {
        return `${prefix}中 ${finding.ruleId} 的链级对象无效`
      }
      if (
        finding.target.kind !== 'chain' &&
        finding.target.kind !== 'relation' &&
        finding.target.kind !== 'target'
      ) {
        return `${prefix}中 ${finding.ruleId} 的定位目标无效`
      }
    } else if (finding.scope === 'term') {
      if (
        subject.kind !== 'term' ||
        subject.termId === undefined ||
        subject.id !== subject.termId ||
        finding.target.kind !== 'term' ||
        finding.target.termId !== subject.termId
      ) {
        return `${prefix}中 ${finding.ruleId} 的组成环对象无效`
      }
    } else {
      if (
        subject.kind !== 'binding' ||
        subject.bindingId === undefined ||
        subject.id !== subject.bindingId ||
        subject.termId === undefined ||
        subject.documentId === undefined ||
        subject.revisionId === undefined ||
        subject.page === undefined
      ) {
        return `${prefix}中 ${finding.ruleId} 的绑定对象无效`
      }
      if (
        finding.target.kind !== 'binding' ||
        finding.target.bindingId !== subject.bindingId ||
        finding.target.termId !== subject.termId ||
        finding.target.documentId !== subject.documentId ||
        finding.target.revisionId !== subject.revisionId ||
        finding.target.page !== subject.page
      ) {
        return `${prefix}中 ${finding.ruleId} 的定位目标与绑定对象不一致`
      }
    }
  }
  if (!sameJson(counted, review.byStatus)) {
    return `${prefix}的 byStatus 与实际结果不一致`
  }

  const expectedPending = review.findings
    .filter((finding) => finding.needsAction)
    .map(findingKey)
    .sort()
  const actualPending = review.pending.map(findingKey).sort()
  if (!sameJson(actualPending, expectedPending)) {
    return `${prefix}的 pending 与 needsAction 结果不一致`
  }

  const expectedGroups = REVIEW_SEVERITIES.map((severity) => ({
    severity,
    label: REVIEW_SEVERITY_LABEL[severity],
    findings: review.pending.filter((finding) => finding.severity === severity),
  })).filter((group) => group.findings.length > 0)
  if (review.groups.length !== expectedGroups.length) {
    return `${prefix}的 groups 与 pending 不一致`
  }
  for (let index = 0; index < expectedGroups.length; index += 1) {
    const expected = expectedGroups[index]
    const actual = review.groups[index]
    if (
      actual.severity !== expected.severity ||
      actual.label !== expected.label ||
      !sameJson(
        actual.findings.map(findingKey),
        expected.findings.map(findingKey),
      )
    ) {
      return `${prefix}的 groups 与 pending 不一致`
    }
  }

  const expectedSatisfied =
    snapshot.result.status === 'within'
      ? true
      : snapshot.result.status === 'outside'
        ? false
        : null
  if (
    review.calculation.status !== snapshot.result.status ||
    review.calculation.satisfied !== expectedSatisfied
  ) {
    return `${prefix}的计算结论与冻结结果不一致`
  }
  return null
}

function validateSourceManifestRecord(
  snapshot: AnalysisSnapshot,
  backupDocuments: ReadonlyMap<string, SourceDocument>,
  backupRevisions: ReadonlyMap<string, SourceRevision>,
  backupBlobKeys: ReadonlySet<string>,
): string | null {
  const prefix = `分析快照 ${snapshot.id} 的来源清单`
  const manifest = snapshot.sourceManifest
  const documentById = new Map<string, SourceDocument>()
  for (const document of manifest.documents) {
    if (documentById.has(document.id)) {
      return `${prefix}包含重复的来源文档 ${document.id}`
    }
    if (document.projectId !== snapshot.projectId) {
      return `${prefix}的来源文档 ${document.id} 属于其它项目`
    }
    if (!backupDocuments.has(document.id)) {
      return `${prefix}的来源文档 ${document.id} 在备份中不存在`
    }
    documentById.set(document.id, document)
  }
  const revisionById = new Map<string, SourceRevision>()
  for (const revision of manifest.revisions) {
    if (revisionById.has(revision.id)) {
      return `${prefix}包含重复的来源版本 ${revision.id}`
    }
    if (revision.projectId !== snapshot.projectId) {
      return `${prefix}的来源版本 ${revision.id} 属于其它项目`
    }
    const document = documentById.get(revision.documentId)
    if (document === undefined) {
      return `${prefix}的来源版本 ${revision.id} 的文档不存在`
    }
    const backupRevision = backupRevisions.get(revision.id)
    if (backupRevision === undefined || !sameRevision(revision, backupRevision)) {
      return `${prefix}的来源版本 ${revision.id} 与备份记录不一致`
    }
    const backupDocument = backupDocuments.get(document.id)
    if (backupDocument === undefined || !sameDocumentIdentity(document, backupDocument)) {
      return `${prefix}的来源文档 ${document.id} 与备份记录不一致`
    }
    revisionById.set(revision.id, revision)
  }
  for (const document of manifest.documents) {
    if (!revisionById.has(document.latestRevisionId)) {
      return `${prefix}的来源文档 ${document.id} 最新版本不在清单内`
    }
  }

  const termById = new Map(snapshot.definition.terms.map((term) => [term.id, term]))
  const bindingIds = new Set<string>()
  for (const entry of manifest.bindings) {
    if (bindingIds.has(entry.bindingId)) {
      return `${prefix}包含重复的绑定 ${entry.bindingId}`
    }
    bindingIds.add(entry.bindingId)
    const revision = revisionById.get(entry.revisionId)
    const document = documentById.get(entry.documentId)
    if (revision === undefined) {
      return `${prefix}的绑定 ${entry.bindingId} 引用的版本不在清单内`
    }
    if (document === undefined) {
      return `${prefix}的绑定 ${entry.bindingId} 引用的文档不在清单内`
    }
    if (
      revision.documentId !== document.id ||
      entry.fileName !== revision.fileName ||
      entry.revisionSha256 !== revision.sha256 ||
      entry.revisionByteSize !== revision.byteSize ||
      entry.revisionPageCount !== revision.pageCount ||
      entry.documentTitle !== document.title
    ) {
      return `${prefix}的绑定 ${entry.bindingId} 与版本/文档元数据不一致`
    }
    if (entry.page > revision.pageCount) {
      return `${prefix}的绑定 ${entry.bindingId} 页码超出页数`
    }
    if (entry.blobAvailable && !backupBlobKeys.has(revision.blobKey)) {
      return `${prefix}的绑定 ${entry.bindingId} 声称附件可用，但备份中没有该附件`
    }
    const term = termById.get(entry.termId)
    if (term === undefined) {
      if (entry.termLabel !== null || entry.termRevision !== null) {
        return `${prefix}的绑定 ${entry.bindingId} 指向已删除组成环却保留了环信息`
      }
    } else {
      const label =
        term.symbol.trim() !== ''
          ? term.symbol.trim()
          : term.name.trim() !== ''
            ? term.name.trim()
            : term.id
      if (entry.termLabel !== label || entry.termRevision !== term.termRevision) {
        return `${prefix}的绑定 ${entry.bindingId} 的环信息与冻结定义不一致`
      }
    }
  }

  const expectedUnbound = snapshot.definition.terms
    .filter(
      (term) => !manifest.bindings.some((entry) => entry.termId === term.id),
    )
    .map((term) => term.id)
  if (!sameJson(manifest.unboundTermIds, expectedUnbound)) {
    return `${prefix}的未绑定组成环与实际绑定不一致`
  }
  const expectedAvailability =
    manifest.bindings.length > 0 &&
    manifest.bindings.some((entry) => !entry.blobAvailable)
      ? 'partial'
      : 'complete'
  if (manifest.availability !== expectedAvailability) {
    return `${prefix}的附件可用性与绑定状态不一致`
  }
  return null
}

function validateComparisonRecord(snapshot: AnalysisSnapshot): string | null {
  const comparison = snapshot.comparison
  if (comparison === null || comparison === undefined) {
    // 兼容旧快照：允许“有基线但没有冻结对比结果”。恢复只原样保留，不补算、
    // 不伪造冻结值；报告按“未冻结”显示。仍拒绝反向不一致：没有基线却带
    // 冻结对比结果（下面处理）。
    return null
  }
  if (snapshot.baseline === null) {
    return `分析快照 ${snapshot.id} 有冻结对比结果却没有基线`
  }
  const { baselineResult, diff } = comparison
  const prefix = `分析快照 ${snapshot.id} 的冻结基线对比`
  if (
    baselineResult.minQ !== diff.minQ.before ||
    baselineResult.maxQ !== diff.maxQ.before ||
    baselineResult.toleranceQ !== diff.toleranceQ.before ||
    baselineResult.lowerMarginQ !== diff.lowerMarginQ.before ||
    baselineResult.upperMarginQ !== diff.upperMarginQ.before ||
    baselineResult.status !== diff.statusBefore
  ) {
    return `${prefix}的基线结果与前后值不一致`
  }
  if (
    snapshot.result.minQ !== diff.minQ.after ||
    snapshot.result.maxQ !== diff.maxQ.after ||
    snapshot.result.toleranceQ !== diff.toleranceQ.after ||
    snapshot.result.lowerMarginQ !== diff.lowerMarginQ.after ||
    snapshot.result.upperMarginQ !== diff.upperMarginQ.after ||
    snapshot.result.status !== diff.statusAfter
  ) {
    return `${prefix}的工作结果与前后值不一致`
  }
  return null
}

function validateSnapshotDeep(
  snapshot: AnalysisSnapshot,
  backupDocuments: ReadonlyMap<string, SourceDocument>,
  backupRevisions: ReadonlyMap<string, SourceRevision>,
  backupBlobKeys: ReadonlySet<string>,
): string | null {
  const conversion = draftToChain(snapshot.draft as WorkspaceDraft)
  if (!conversion.ok) {
    return `分析快照 ${snapshot.id} 的草稿无法转换为尺寸链`
  }
  if (!sameChain(conversion.chain, snapshot.definition)) {
    return `分析快照 ${snapshot.id} 的草稿与冻结定义不一致`
  }
  const resultIssue = validateResultRecord(
    snapshot.definition,
    snapshot.result,
    snapshot.id,
  )
  if (resultIssue !== null) {
    return resultIssue
  }
  const reviewIssue = validateReviewRecord(snapshot)
  if (reviewIssue !== null) {
    return reviewIssue
  }
  const manifestIssue = validateSourceManifestRecord(
    snapshot,
    backupDocuments,
    backupRevisions,
    backupBlobKeys,
  )
  if (manifestIssue !== null) {
    return manifestIssue
  }
  return validateComparisonRecord(snapshot)
}

function decodeIdFromPath(path: string, prefix: string, extension: string): string {
  const base = path.slice(prefix.length)
  if (!base.endsWith(extension)) {
    throw new BackupRecordError(`备份条目 ${path} 扩展名不符合约定`)
  }
  const raw = base.slice(0, -extension.length)
  try {
    return decodeURIComponent(raw)
  } catch {
    throw new BackupRecordError(`备份条目 ${path} 的编码 ID 无效`)
  }
}

function isRetiredProjectId(projectId: string): boolean {
  return projectId.includes('::retired::')
}

/* -------------------------------------------------------------------------- */
/* 读取与校验                                                                 */
/* -------------------------------------------------------------------------- */

export async function parseBackup(bytes: Uint8Array): Promise<RestoreResult<ParsedBackup>> {
  const read = await readZipEntries(bytes)
  if (!read.ok) {
    return { ok: false, error: mapZipError(read.error) }
  }
  const files = read.value

  const manifestBytes = files.get(MANIFEST_PATH)
  if (manifestBytes === undefined) {
    return failure('invalid_manifest', 'ZIP 缺少 manifest.json。')
  }

  let manifest: BackupManifest
  try {
    manifest = parseRecord(
      manifestSchema,
      decodeJson(manifestBytes, MANIFEST_PATH),
      MANIFEST_PATH,
    ) as BackupManifest
  } catch (error) {
    return failure(
      'invalid_manifest',
      error instanceof Error ? error.message : String(error),
    )
  }

  if (
    manifest.excludes.mappingTemplates.included !== false ||
    !manifest.excludes.mappingTemplates.note.includes('不包含全局映射模板') ||
    manifest.excludes.mappingTemplates.note !== MAPPING_TEMPLATES_EXCLUDED_NOTE
  ) {
    return failure(
      'invalid_manifest',
      'manifest 必须明示“不包含全局映射模板”，且口径与当前版本一致。',
    )
  }

  // manifest 列出的条目必须与 ZIP 实际内容完全一致（除 manifest.json）。
  const listed = new Set<string>()
  let declaredTotal = 0
  for (const entry of manifest.entries) {
    if (listed.has(entry.path)) {
      return failure('invalid_manifest', `manifest 重复列出条目：${entry.path}`)
    }
    listed.add(entry.path)
    declaredTotal += entry.byteSize
    if (declaredTotal > MAX_BACKUP_UNCOMPRESSED_BYTES) {
      return failure('too_large', 'manifest 声明的解压后总大小超过 150 MiB。')
    }
  }
  if (declaredTotal !== manifest.totalUncompressedBytes) {
    return failure(
      'invalid_manifest',
      'manifest.totalUncompressedBytes 与条目大小之和不一致。',
    )
  }

  const actualPayload = new Set(
    [...files.keys()].filter((path) => path !== MANIFEST_PATH),
  )
  for (const entry of manifest.entries) {
    if (!actualPayload.has(entry.path)) {
      return failure('invalid_manifest', `manifest 列出的条目不存在：${entry.path}`)
    }
  }
  for (const path of actualPayload) {
    if (!listed.has(path)) {
      return failure('invalid_manifest', `ZIP 包含 manifest 未列出的条目：${path}`)
    }
  }

  // 哈希与大小逐项核对。
  for (const entry of manifest.entries) {
    const data = files.get(entry.path)
    if (data === undefined) {
      return failure('invalid_manifest', `缺少条目：${entry.path}`)
    }
    if (data.byteLength !== entry.byteSize) {
      return failure(
        'hash_mismatch',
        `条目大小与 manifest 不一致：${entry.path}`,
        `manifest ${entry.byteSize} 字节，实际 ${data.byteLength} 字节`,
      )
    }
    const digest = await sha256Hex(data)
    if (digest !== entry.sha256) {
      return failure(
        'hash_mismatch',
        `条目哈希与 manifest 不一致：${entry.path}`,
      )
    }
  }

  const parsed: ParsedBackup = {
    manifest,
    projects: [],
    drafts: [],
    documents: [],
    revisions: [],
    blobs: [],
    bindings: [],
    events: [],
    snapshots: [],
    importSnapshots: [],
    migrationBackups: [],
  }

  try {
    for (const [path, data] of files) {
      if (path === MANIFEST_PATH) {
        continue
      }
      // 附件字节不是 JSON：只校验扩展名，具体哈希与版本引用在 sourceBlobs 分支处理。
      if (path.startsWith('sourceFiles/')) {
        if (!path.endsWith('.bin')) {
          throw new BackupRecordError(`来源附件条目必须以 .bin 结尾：${path}`)
        }
        continue
      }
      const value = decodeJson(data, path)
      if (path.startsWith('projects/')) {
        const id = decodeIdFromPath(path, 'projects/', '.json')
        const record = parseRecord(projectSchema, value, path)
        if (record.id !== id) {
          throw new BackupRecordError(`项目文件名与记录 ID 不一致：${path}`)
        }
        const working = validateChainOrThrow(record.working, `${path}.working`)
        const baseline =
          record.baseline === null
            ? null
            : {
                savedAt: record.baseline.savedAt,
                definition: validateChainOrThrow(
                  record.baseline.definition,
                  `${path}.baseline.definition`,
                ),
              }
        parsed.projects.push({
          ...record,
          working,
          baseline,
          migration: (record.migration as Project['migration']) ?? null,
        })
      } else if (path.startsWith('drafts/')) {
        const id = decodeIdFromPath(path, 'drafts/', '.json')
        const record = parseRecord(storedDraftSchema, value, path)
        if (record.projectId !== id) {
          throw new BackupRecordError(`草稿文件名与 projectId 不一致：${path}`)
        }
        parsed.drafts.push(record as StoredDraft)
      } else if (path.startsWith('sourceDocuments/')) {
        const id = decodeIdFromPath(path, 'sourceDocuments/', '.json')
        const record = parseRecord(documentSchema, value, path)
        if (record.id !== id) {
          throw new BackupRecordError(`来源文档文件名与 ID 不一致：${path}`)
        }
        parsed.documents.push(record)
      } else if (path.startsWith('sourceRevisions/')) {
        const id = decodeIdFromPath(path, 'sourceRevisions/', '.json')
        const record = parseRecord(revisionSchema, value, path)
        if (record.id !== id) {
          throw new BackupRecordError(`来源版本文件名与 ID 不一致：${path}`)
        }
        parsed.revisions.push(record)
      } else if (path.startsWith('sourceBlobs/')) {
        const id = decodeIdFromPath(path, 'sourceBlobs/', '.json')
        const record = parseRecord(blobMetaSchema, value, path)
        if (record.blobKey !== id) {
          throw new BackupRecordError(`来源附件元数据文件名与 blobKey 不一致：${path}`)
        }
        const filePath = backupPath('files', record.blobKey, 'bin')
        const fileBytes = files.get(filePath)
        if (fileBytes === undefined) {
          throw new BackupRecordError(`来源附件缺少文件字节：${filePath}`)
        }
        if (fileBytes.byteLength !== record.byteSize) {
          throw new BackupRecordError(
            `来源附件大小与元数据不一致：${record.blobKey}`,
          )
        }
        const digest = await sha256Hex(fileBytes)
        if (digest !== record.sha256) {
          throw new BackupRecordError(
            `来源附件哈希与元数据不一致：${record.blobKey}`,
          )
        }
        parsed.blobs.push({ ...record, bytes: fileBytes })
      } else if (path.startsWith('sourceFiles/')) {
        // 由 sourceBlobs 元数据分支消费；单独出现时在引用校验里报缺失元数据。
      } else if (path.startsWith('bindings/')) {
        const id = decodeIdFromPath(path, 'bindings/', '.json')
        const record = parseRecord(bindingSchema, value, path)
        if (record.id !== id) {
          throw new BackupRecordError(`绑定文件名与 ID 不一致：${path}`)
        }
        parsed.bindings.push({
          ...record,
          historicalAcceptance: record.historicalAcceptance ?? null,
        })
      } else if (path.startsWith('events/')) {
        const id = decodeIdFromPath(path, 'events/', '.json')
        const record = parseRecord(eventSchema, value, path)
        if (record.id !== id) {
          throw new BackupRecordError(`事件文件名与 ID 不一致：${path}`)
        }
        parsed.events.push(record as ChangeEvent)
      } else if (path.startsWith('snapshots/')) {
        const id = decodeIdFromPath(path, 'snapshots/', '.json')
        const record = parseRecord(snapshotSchema, value, path)
        if (record.id !== id) {
          throw new BackupRecordError(`快照文件名与 ID 不一致：${path}`)
        }
        const definition = validateChainOrThrow(
          record.definition,
          `${path}.definition`,
        )
        const baseline =
          record.baseline === null
            ? null
            : {
                savedAt: record.baseline.savedAt,
                definition: validateChainOrThrow(
                  record.baseline.definition,
                  `${path}.baseline.definition`,
                ),
              }
        parsed.snapshots.push({
          ...(record as unknown as AnalysisSnapshot),
          definition,
          baseline,
        })
      } else if (path.startsWith('importSnapshots/')) {
        const id = decodeIdFromPath(path, 'importSnapshots/', '.json')
        const record = parseRecord(importSnapshotSchema, value, path)
        if (record.id !== id) {
          throw new BackupRecordError(`替换前快照文件名与 ID 不一致：${path}`)
        }
        parsed.importSnapshots.push({
          ...record,
          definition: validateChainOrThrow(
            record.definition,
            `${path}.definition`,
          ),
        } as ImportSnapshot)
      } else if (path.startsWith('migrationBackups/')) {
        const id = decodeIdFromPath(path, 'migrationBackups/', '.json')
        const record = parseRecord(migrationBackupSchema, value, path)
        if (record.id !== id) {
          throw new BackupRecordError(`迁移备份文件名与 ID 不一致：${path}`)
        }
        parsed.migrationBackups.push(record)
      } else {
        throw new BackupRecordError(`备份包含未知条目：${path}`)
      }
    }
  } catch (error) {
    if (error instanceof BackupRecordError) {
      const code: RestoreErrorCode = error.message.includes('哈希')
        ? 'hash_mismatch'
        : 'invalid_record'
      return failure(code, error.message)
    }
    return failure(
      'invalid_record',
      '解析备份记录失败。',
      error instanceof Error ? error.message : String(error),
    )
  }

  // 结构校验通过不等于业务记录可写库：快照的 review / result / sourceManifest /
  // comparison 还要做领域一致性检查，坏包在打开写事务之前拒绝。
  const backupDocuments = new Map(parsed.documents.map((item) => [item.id, item]))
  const backupRevisions = new Map(parsed.revisions.map((item) => [item.id, item]))
  const backupBlobKeys = new Set(parsed.blobs.map((item) => item.blobKey))
  for (const snapshot of parsed.snapshots) {
    const issue = validateSnapshotDeep(
      snapshot,
      backupDocuments,
      backupRevisions,
      backupBlobKeys,
    )
    if (issue !== null) {
      return failure('invalid_record', issue)
    }
  }

  // 每个附件字节文件都必须有对应元数据；不允许携带 manifest 未解释的二进制。
  const blobKeys = new Set(parsed.blobs.map((blob) => blob.blobKey))
  for (const path of files.keys()) {
    if (!path.startsWith('sourceFiles/')) {
      continue
    }
    const key = decodeIdFromPath(path, 'sourceFiles/', '.bin')
    if (!blobKeys.has(key)) {
      return failure(
        'invalid_record',
        `来源附件字节缺少对应元数据：${path}`,
      )
    }
  }

  // 计数核对：manifest 是声明，实际解析结果必须一致。
  const actualCounts = {
    projects: parsed.projects.length,
    drafts: parsed.drafts.length,
    documents: parsed.documents.length,
    revisions: parsed.revisions.length,
    blobs: parsed.blobs.length,
    bindings: parsed.bindings.length,
    events: parsed.events.length,
    snapshots: parsed.snapshots.length,
    importSnapshots: parsed.importSnapshots.length,
    migrationBackups: parsed.migrationBackups.length,
  }
  for (const key of Object.keys(actualCounts) as (keyof typeof actualCounts)[]) {
    if (manifest.counts[key] !== actualCounts[key]) {
      return failure(
        'invalid_manifest',
        `manifest 计数与内容不一致：${key} 声明 ${manifest.counts[key]}，实际 ${actualCounts[key]}。`,
      )
    }
  }

  if (parsed.projects.length === 0) {
    return failure('empty_backup', '备份里没有项目记录，无法恢复。')
  }

  const referenceError = validateReferences(parsed)
  if (referenceError !== null) {
    return failure('missing_reference', referenceError)
  }

  return { ok: true, value: parsed }
}

function validateReferences(backup: ParsedBackup): string | null {
  const projectIds = new Set(backup.projects.map((project) => project.id))
  if (projectIds.size !== backup.projects.length) {
    return '备份包含重复的项目 ID。'
  }
  const knownScope = (projectId: string): boolean =>
    projectIds.has(projectId) || isRetiredProjectId(projectId)

  const documentById = new Map(backup.documents.map((item) => [item.id, item]))
  const revisionById = new Map(backup.revisions.map((item) => [item.id, item]))
  const blobByKey = new Map(backup.blobs.map((item) => [item.blobKey, item]))

  const missingByRevision = new Map<string, { blobKey: string; documentId: string }>()
  for (const missing of backup.manifest.missingAttachments) {
    const revision = revisionById.get(missing.revisionId)
    if (revision === undefined) {
      return `manifest 声明的缺失附件版本不存在：${missing.revisionId}`
    }
    if (
      revision.blobKey !== missing.blobKey ||
      revision.documentId !== missing.documentId
    ) {
      return `manifest 声明的缺失附件 ${missing.revisionId} 与版本记录不一致`
    }
    if (missingByRevision.has(missing.revisionId)) {
      return `manifest 重复声明缺失附件：${missing.revisionId}`
    }
    if (blobByKey.has(missing.blobKey)) {
      return `manifest 声明附件缺失，但备份中存在附件：${missing.blobKey}`
    }
    missingByRevision.set(missing.revisionId, missing)
  }

  for (const draft of backup.drafts) {
    if (!projectIds.has(draft.projectId)) {
      return `草稿引用的项目不存在：${draft.projectId}`
    }
  }

  for (const document of backup.documents) {
    if (!knownScope(document.projectId)) {
      return `来源文档引用的项目既不存在也不是已退役作用域：${document.projectId}`
    }
    const latest = revisionById.get(document.latestRevisionId)
    if (latest === undefined) {
      return `来源文档 ${document.id} 的最新版本不存在：${document.latestRevisionId}`
    }
    if (latest.documentId !== document.id) {
      return `来源文档 ${document.id} 的最新版本属于其它文档：${latest.id}`
    }
  }

  for (const revision of backup.revisions) {
    const document = documentById.get(revision.documentId)
    if (document === undefined) {
      return `来源版本 ${revision.id} 引用的文档不存在：${revision.documentId}`
    }
    if (document.projectId !== revision.projectId) {
      return `来源版本 ${revision.id} 与文档 ${document.id} 的项目作用域不一致`
    }
    const blob = blobByKey.get(revision.blobKey)
    const missing = missingByRevision.has(revision.id)
    if (blob === undefined) {
      // 合法缺附件：只有 manifest 明确声明、且 revision 元数据一致时才接受。
      // 恢复后该版本保持“附件不可用”，绝不伪造 Blob。
      if (!missing) {
        return `来源版本 ${revision.id} 的附件不存在，且 manifest 未声明缺失：${revision.blobKey}`
      }
      continue
    }
    if (missing) {
      return `来源版本 ${revision.id} 在 manifest 中声明附件缺失，但备份中存在附件`
    }
    if (blob.projectId !== revision.projectId) {
      return `来源版本 ${revision.id} 与附件 ${revision.blobKey} 的项目作用域不一致（拒绝跨项目附件引用）`
    }
    if (blob.sha256 !== revision.sha256 || blob.byteSize !== revision.byteSize) {
      return `来源版本 ${revision.id} 与附件 ${revision.blobKey} 的哈希或大小不一致`
    }
  }

  for (const blob of backup.blobs) {
    if (!knownScope(blob.projectId)) {
      return `来源附件引用的项目既不存在也不是已退役作用域：${blob.projectId}`
    }
  }

  for (const binding of backup.bindings) {
    if (!knownScope(binding.projectId)) {
      return `绑定引用的项目既不存在也不是已退役作用域：${binding.projectId}`
    }
    const document = documentById.get(binding.documentId)
    if (document === undefined) {
      return `绑定 ${binding.id} 引用的来源文档不存在：${binding.documentId}`
    }
    const revision = revisionById.get(binding.revisionId)
    if (revision === undefined) {
      return `绑定 ${binding.id} 引用的来源版本不存在：${binding.revisionId}`
    }
    if (revision.documentId !== binding.documentId) {
      return `绑定 ${binding.id} 的版本与文档不匹配`
    }
    if (document.projectId !== binding.projectId) {
      return `绑定 ${binding.id} 与来源文档的项目作用域不一致`
    }
    if (binding.page > revision.pageCount) {
      return `绑定 ${binding.id} 的页码 ${binding.page} 超出 ${revision.pageCount} 页`
    }
  }

  for (const event of backup.events) {
    if (!knownScope(event.projectId)) {
      return `事件引用的项目既不存在也不是已退役作用域：${event.projectId}`
    }
  }

  for (const snapshot of backup.snapshots) {
    if (!projectIds.has(snapshot.projectId)) {
      return `分析快照引用的项目不存在：${snapshot.projectId}`
    }
  }

  for (const snapshot of backup.importSnapshots) {
    if (!projectIds.has(snapshot.projectId)) {
      return `替换前快照引用的项目不存在：${snapshot.projectId}`
    }
  }

  return null
}
