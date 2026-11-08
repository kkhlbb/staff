/**
 * 完整备份 .cunlian.zip 的导入校验与恢复（V2.2 D 组，规格 §8）。
 *
 * 导入顺序（全部通过才写库）：
 * 1. ZIP 结构安全：条目数 ≤ 500、解压总量 ≤ 150 MiB、路径穿越/重复条目；
 * 2. manifest.json 结构与版本；
 * 3. 文件集合、大小、SHA-256 逐项核对；
 * 4. 业务记录结构、项目/草稿/来源/绑定/历史引用一致性；
 * 5. 目标库必须为空（逐 store 计数）；
 * 6. 单个 IndexedDB 事务写入全部 store；任一步失败整体回滚，零写入。
 *
 * 恢复时按规格 BAK-01 清除人工确认：项目 relationReview 置空，绑定
 * reviewedTermRevision / reviewedAt / historicalAcceptance 置空；数值、
 * 文件哈希、绑定坐标、事件、草稿与分析快照原样保留。清理逻辑只发生在
 * 校验全部通过之后，失败不会产生半恢复数据。
 */
import { z } from 'zod'
import { PROJECT_SCHEMA_VERSION, type ChainDefinition, type Project } from '../domain/types'
import { validateChain } from '../domain/validation'
import type { AnalysisSnapshot } from '../history/snapshots'
import type { ChangeEvent } from '../history/events'
import type { SourceBinding } from '../sources/bindings'
import type {
  SourceDocument,
  SourceRevision,
} from '../sources/types'
import { sha256Hex } from '../sources/hash'
import {
  BINDING_STORE_NAME,
  DRAFT_STORE_NAME,
  EVENT_STORE_NAME,
  IMPORT_SNAPSHOT_STORE_NAME,
  MIGRATION_BACKUP_STORE_NAME,
  PROJECT_STORE_NAME,
  SNAPSHOT_STORE_NAME,
  SOURCE_BLOB_STORE_NAME,
  SOURCE_DOCUMENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
  requestResult,
  transactionDone,
  withDatabase,
} from '../storage/db'
import type { ImportSnapshot, StoredDraft } from '../storage/projects'
import { addChangeEvent, changeEventId } from '../history/events'
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  MANIFEST_PATH,
  MAPPING_TEMPLATES_EXCLUDED_NOTE,
  backupPath,
  type BackupManifest,
} from './projectBundle'
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

interface ParsedBackup {
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

function failure(
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

const reviewSummarySchema = z
  .object({
    rulesVersion: z.string().min(1),
    findings: z.array(z.unknown()),
    pending: z.array(z.unknown()),
    byStatus: z.record(z.string(), z.number()),
    canCreateReport: z.boolean(),
    hasAnyBinding: z.boolean(),
    reviewComplete: z.boolean(),
  })
  .passthrough()

const snapshotSchema = z
  .object({
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
    sourceManifest: z
      .object({
        bindings: z.array(z.unknown()),
        documents: z.array(z.unknown()),
        revisions: z.array(z.unknown()),
        unboundTermIds: z.array(z.string()),
        availability: z.enum(['complete', 'partial']),
      })
      .passthrough(),
    baseline: z
      .object({ savedAt: isoString, definition: z.unknown() })
      .nullable(),
    status: z.enum(['complete', 'pending']),
    pendingCount: z.number().int().nonnegative(),
  })
  .passthrough()

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

async function parseBackup(bytes: Uint8Array): Promise<RestoreResult<ParsedBackup>> {
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
    if (blob === undefined) {
      return `来源版本 ${revision.id} 的附件不存在：${revision.blobKey}`
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

/* -------------------------------------------------------------------------- */
/* 对外接口                                                                   */
/* -------------------------------------------------------------------------- */

/** 只校验并返回摘要，不写数据库；UI 用它显示恢复前确认。 */
export async function inspectBackup(
  bytes: Uint8Array,
): Promise<RestoreResult<BackupInspection>> {
  const parsed = await parseBackup(bytes)
  if (!parsed.ok) {
    return parsed
  }
  return {
    ok: true,
    value: {
      manifest: parsed.value.manifest,
      projectSummaries: parsed.value.manifest.projects,
      counts: parsed.value.manifest.counts,
      createdAt: parsed.value.manifest.createdAt,
      totalUncompressedBytes: parsed.value.manifest.totalUncompressedBytes,
    },
  }
}

const RESTORE_STORES = [
  PROJECT_STORE_NAME,
  DRAFT_STORE_NAME,
  SOURCE_DOCUMENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
  SOURCE_BLOB_STORE_NAME,
  BINDING_STORE_NAME,
  EVENT_STORE_NAME,
  SNAPSHOT_STORE_NAME,
  IMPORT_SNAPSHOT_STORE_NAME,
  MIGRATION_BACKUP_STORE_NAME,
] as const

/**
 * 恢复完整备份到空数据库。
 *
 * 目标库任一业务 store 非空都拒绝，避免覆盖现有项目或与退役历史冲突。
 * 所有校验通过后才开启写事务；失败时事务 abort，任何 store 都不会变化。
 */
export async function restoreBackup(
  bytes: Uint8Array,
  options: { now?: string } = {},
): Promise<RestoreResult<RestoreSummary>> {
  const parsed = await parseBackup(bytes)
  if (!parsed.ok) {
    return parsed
  }
  const backup = parsed.value
  const restoredAt = options.now ?? new Date().toISOString()

  try {
    return await withDatabase(async (db) => {
      const transaction = db.transaction([...RESTORE_STORES], 'readwrite')
      const done = transactionDone(transaction)
      try {
        const counts: Record<string, number> = {}
        for (const storeName of RESTORE_STORES) {
          counts[storeName] = await requestResult(
            transaction.objectStore(storeName).count(),
          )
        }
        const nonEmpty = Object.entries(counts).filter(([, count]) => count > 0)
        if (nonEmpty.length > 0) {
          await done
          return failure(
            'database_not_empty',
            '目标数据库不是空库，恢复已取消，未写入任何数据。请先清空或换一个空浏览器配置再恢复。',
            nonEmpty.map(([store, count]) => `${store}=${count}`).join('；'),
          )
        }

        // 恢复时清除人工确认：数值、坐标、哈希与历史不变。
        for (const project of backup.projects) {
          transaction.objectStore(PROJECT_STORE_NAME).add({
            ...project,
            relationReview: null,
          } satisfies Project)
        }
        for (const draft of backup.drafts) {
          transaction.objectStore(DRAFT_STORE_NAME).add(draft)
        }
        for (const document of backup.documents) {
          transaction.objectStore(SOURCE_DOCUMENT_STORE_NAME).add(document)
        }
        for (const revision of backup.revisions) {
          transaction.objectStore(SOURCE_REVISION_STORE_NAME).add(revision)
        }
        for (const blob of backup.blobs) {
          transaction.objectStore(SOURCE_BLOB_STORE_NAME).add({
            blobKey: blob.blobKey,
            projectId: blob.projectId,
            sha256: blob.sha256,
            byteSize: blob.byteSize,
            blob: new Blob([new Uint8Array(blob.bytes)], {
              type: 'application/pdf',
            }),
          })
        }
        for (const binding of backup.bindings) {
          transaction.objectStore(BINDING_STORE_NAME).add({
            ...binding,
            reviewedTermRevision: null,
            reviewedAt: null,
            historicalAcceptance: null,
          } satisfies SourceBinding)
        }
        for (const event of backup.events) {
          transaction.objectStore(EVENT_STORE_NAME).add(event)
        }
        for (const snapshot of backup.snapshots) {
          transaction.objectStore(SNAPSHOT_STORE_NAME).add(snapshot)
        }
        for (const snapshot of backup.importSnapshots) {
          transaction.objectStore(IMPORT_SNAPSHOT_STORE_NAME).add(snapshot)
        }
        for (const migration of backup.migrationBackups) {
          transaction.objectStore(MIGRATION_BACKUP_STORE_NAME).add(migration)
        }
        // 恢复本身是一条历史事件；与数据同事务，失败不会留下孤立事件。
        for (const project of backup.projects) {
          addChangeEvent(transaction, {
            id: `${changeEventId(
              'project_restored_from_bundle',
              project.id,
            )}:${restoredAt}`,
            projectId: project.id,
            type: 'project_restored_from_bundle',
            createdAt: restoredAt,
            message:
              '已从 .cunlian.zip 完整备份恢复；数值、来源文件、绑定坐标与历史保留，人工确认已清除。',
          })
        }

        await done
        return {
          ok: true as const,
          value: {
            projects: backup.projects.map((project) => ({
              id: project.id,
              name: project.name,
            })),
            counts: backup.manifest.counts,
            confirmationsCleared: true as const,
            restoredAt,
          },
        }
      } catch (error) {
        try {
          transaction.abort()
        } catch {
          // 事务可能已结束。
        }
        await done.catch(() => undefined)
        return failure(
          'write_failed',
          '写入恢复数据失败，事务已回滚，数据库未改变。',
          error instanceof Error ? error.message : String(error),
        )
      }
    })
  } catch (error) {
    return failure(
      'storage_failure',
      '打开本地数据库失败，恢复未开始。',
      error instanceof Error ? error.message : String(error),
    )
  }
}
