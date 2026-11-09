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
  DIMENSION_CHAIN_SCHEMA_VERSION,
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_FORMAT_VERSION,
  PROJECT_FILE_MAX_PATH_LENGTH,
  PROJECT_FILE_PATHS,
  PROJECT_FILE_SCHEMA_VERSION,
  REVISION_EXTENSION,
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
  type ProjectFileResult,
  type ProjectFileRevision,
  type ProjectFileSnapshot,
} from './types'

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

const projectSchema = z
  .object({
    id: idSchema,
    schemaVersion: z.literal(PROJECT_FILE_SCHEMA_VERSION),
    name: z.string().min(1).max(200),
    currentRevisionId: idSchema,
    dimensionChain: z.unknown(),
    parts: z.array(z.unknown()).max(0),
    parameters: z.array(z.unknown()).max(0),
    modelRevisions: z.array(z.unknown()).max(0),
    dimensionLinks: z.array(z.unknown()).max(0),
    drawings: z.array(z.unknown()).max(0),
  })
  .strict()

const draftSchema = z
  .object({
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

const fileRevisionSchema = z
  .object({
    revisionId: idSchema,
    parentId: idSchema.nullable(),
    createdAt: z.string().min(1),
    reason: z.string(),
    project: projectSchema,
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

const manifestSchema = z
  .object({
    format: z.literal(PROJECT_FILE_FORMAT),
    formatVersion: z.literal(PROJECT_FILE_FORMAT_VERSION),
    createdAt: z.string().min(1),
    writer: z
      .object({
        appVersion: z.string().min(1),
        electronVersion: z.string().min(1),
        engineVersion: z.string().min(1),
      })
      .strict(),
    project: z
      .object({
        id: idSchema,
        name: z.string().min(1).max(200),
        projectSchemaVersion: z.literal(PROJECT_FILE_SCHEMA_VERSION),
        dimensionChainSchemaVersion: z.literal(DIMENSION_CHAIN_SCHEMA_VERSION),
        currentRevisionId: idSchema,
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
  })
  .strict()

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
  return ok(parsed.data)
}

/** 严格解析 project/project.json，并用领域 validateChain 复核尺寸链。 */
export function parseProject(
  input: unknown,
): ProjectFileResult<ProjectFileProject> {
  const parsed = projectSchema.safeParse(input)
  if (!parsed.success) {
    return fail('INVALID_RECORD', 'project.json 结构不合法', describeZodError(parsed.error))
  }
  const chain = validateChain(parsed.data.dimensionChain)
  if (!chain.ok) {
    const first = chain.errors[0]
    return fail(
      'INVALID_RECORD',
      'project.json 的尺寸链不合法',
      first === undefined ? undefined : `${first.code}: ${first.message}`,
    )
  }
  return ok({ ...parsed.data, dimensionChain: chain.value })
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
  const chain = validateChain(parsed.data.project.dimensionChain)
  if (!chain.ok) {
    const first = chain.errors[0]
    return fail(
      'INVALID_RECORD',
      '项目文件版本内的尺寸链不合法',
      first === undefined ? undefined : `${first.code}: ${first.message}`,
    )
  }
  return ok({ ...parsed.data, project: { ...parsed.data.project, dimensionChain: chain.value } })
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
  return snapshot.blobs
    .map((blob) => {
      const revision = snapshot.revisions.find((item) => item.blobKey === blob.blobKey)
      return {
        kind: 'pdf' as const,
        revisionId: revision?.id ?? '',
        blobKey: blob.blobKey,
        path: attachmentEntryPath(blob.blobKey),
        sha256: blob.sha256,
        byteSize: blob.byteSize,
      }
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
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

  const documentById = new Map(snapshot.documents.map((item) => [item.id, item]))
  const revisionById = new Map(snapshot.revisions.map((item) => [item.id, item]))
  const blobByKey = new Map(snapshot.blobs.map((item) => [item.blobKey, item]))
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
      return fail('MISSING_REFERENCE', `版本 ${revision.id} 缺少 blob 元数据`, revision.blobKey)
    }
    if (blob.sha256 !== revision.sha256 || blob.byteSize !== revision.byteSize) {
      return fail(
        'HASH_MISMATCH',
        `版本 ${revision.id} 与 blob 元数据的大小/哈希不一致`,
      )
    }
  }

  const missingByRevision = new Map(
    snapshot.missingAttachments.map((item) => [item.revisionId, item]),
  )
  const attachmentByKey = new Map(
    snapshot.attachments.map((item) => [item.blobKey, item]),
  )
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

/** 附件字节哈希核对（打开与保存自校验共用）。 */
export async function validateAttachmentBytes(
  snapshot: ProjectFileSnapshot,
  hash: (bytes: Uint8Array) => Promise<string>,
): Promise<ProjectFileResult<void>> {
  const blobByKey = new Map(snapshot.blobs.map((blob) => [blob.blobKey, blob]))
  for (const attachment of snapshot.attachments) {
    const blob = blobByKey.get(attachment.blobKey)
    if (blob === undefined) {
      return fail('MISSING_REFERENCE', '附件缺少 blob 元数据', attachment.blobKey)
    }
    if (attachment.bytes.byteLength !== blob.byteSize) {
      return fail(
        'HASH_MISMATCH',
        `附件大小不一致：${attachment.blobKey}`,
        `声明 ${blob.byteSize}，实际 ${attachment.bytes.byteLength}`,
      )
    }
    const digest = await hash(attachment.bytes)
    if (digest !== blob.sha256) {
      return fail('HASH_MISMATCH', `附件哈希不一致：${attachment.blobKey}`)
    }
  }
  return ok(undefined)
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
