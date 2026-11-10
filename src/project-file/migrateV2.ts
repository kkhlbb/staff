/**
 * V2 → V3 迁移（A-03）：`.cunlian.zip` 完整备份与旧项目 JSON 两条输入。
 *
 * 纯转换：只读字节、调用既有纯校验管道（backup/restoreParser.ts、
 * storage/projectJson.ts）、在内存构造 V3 聚合；不打开 IndexedDB、不清库、
 * 不调用 restoreBackup、不写任何文件。落盘与文件会话切换由主进程
 * migrationService 在完整编码校验成功后执行。
 *
 * 保留规则（任务卡 §5）：
 * - working/target/assumptions、基线、整数 q、termRevision、草稿原始输入；
 * - 来源文档/版本/绑定与 PDF 文件字节、哈希、pageCount、blobKey；
 * - 事件、AnalysisSnapshot（含冻结 result/review/sourceManifest/comparison）、
 *   importSnapshots、migrationBackups 原记录；历史不补算、不覆写；
 * - 当前确认清零：Project.relationReview=null，每个 binding 的
 *   reviewedTermRevision/reviewedAt/historicalAcceptance=null；历史快照不递归清。
 *
 * 两条旧路径的 relationRevision 故意不同：
 * - ZIP：沿用 restoreBackup 的既有值（不清零、不 +1）；
 * - JSON：v2 = 原值 + 1，v1 = 1（沿用 storage/projectJson.ts 的外部导入语义）。
 */
import { calculateChain, ENGINE_VERSION } from '../domain/calculate'
import type { ChainDefinition, ChainResult } from '../domain/types'
import type { StoredDraft } from '../storage/projects'
import { decodeProjectJson, parseImportedProject } from '../storage/projectJson'
import { sha256Hex } from '../sources/hash'
import { sameChain } from '../backup/restoreParser'
import { parseBackup, type ParsedBackup } from '../backup/restoreParser'
import {
  PROJECT_FILE_SCHEMA_VERSION,
  type ProjectFileError,
  type ProjectFileLegacyArchive,
  type ProjectFileMissingAttachment,
  type ProjectFileProject,
  type ProjectFileResult,
  type ProjectFileSnapshot,
  type ProjectFileSnapshotReference,
} from './types'
import { fail, ok, validateSnapshotReferences } from './validation'

/** 退役作用域后缀；与 storage/projects.ts 的 retiredSourceScopeId 一致。 */
const RETIRED_MARKER = '::retired::'

export interface V2BundleProjectSummary {
  id: string
  name: string
  attachmentCount: number
  missingItems: number
  revisionCount: number
  bindingCount: number
  eventCount: number
  snapshotCount: number
  retiredRecordCount: number
  orphanRetiredRecordCount: number
}

export interface V2BundleInspection {
  sourceKind: 'v2-bundle'
  sourceSha256: string
  formatVersion: number
  createdAt: string
  projects: V2BundleProjectSummary[]
  warnings: string[]
}

export interface V2JsonProjectSummary {
  id: string
  name: string
  attachmentCount: 0
  missingItems: number
  revisionCount: number
  bindingCount: number
  eventCount: 0
  snapshotCount: 0
  retiredRecordCount: 0
  orphanRetiredRecordCount: 0
}

export interface V2JsonInspection {
  sourceKind: 'v2-json'
  sourceSha256: string
  formatVersion: number
  createdAt: string
  projects: V2JsonProjectSummary[]
  warnings: string[]
}

export type V2Inspection = V2BundleInspection | V2JsonInspection

export interface MigrateV2Options {
  now?: string
  appVersion?: string
  /** 目标 Electron 版本；未知时写 'unknown'，不伪造已实测版本。 */
  electronVersion?: string
  /** 测试注入；默认随机 UUID。 */
  newRevisionId?: () => string
  /** 测试注入；默认按 revision 生成新的 JSON 附件 blobKey。 */
  newBlobKey?: (revisionId: string) => string
}

export interface MigratedV2 {
  snapshot: ProjectFileSnapshot
  warnings: string[]
  /** 编码后的候选容器尚未落盘；main 负责原子保存与自校验。 */
  sourceSha256: string
}

function nowIso(options: MigrateV2Options): string {
  return options.now ?? new Date().toISOString()
}

function newId(prefix: string): string {
  const suffix =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${suffix}`
}

function mapRestoreError(error: {
  code: string
  message: string
  detail?: string
}): ProjectFileResult<never> {
  const map: Record<string, ProjectFileError['code']> = {
    invalid_zip: 'INVALID_ZIP',
    too_many_entries: 'TOO_MANY_ENTRIES',
    too_large: 'TOO_LARGE',
    unsafe_path: 'UNSAFE_PATH',
    duplicate_entry: 'DUPLICATE_ENTRY',
    invalid_manifest: 'INVALID_MANIFEST',
    hash_mismatch: 'HASH_MISMATCH',
    missing_reference: 'MISSING_REFERENCE',
    invalid_record: 'INVALID_RECORD',
    empty_backup: 'EMPTY_BACKUP',
    database_not_empty: 'INVALID_RECORD',
    write_failed: 'INVALID_RECORD',
    storage_failure: 'INVALID_RECORD',
  }
  return fail(map[error.code] ?? 'INVALID_RECORD', error.message, error.detail)
}

function mapStorageError(error: {
  code: string
  message: string
  details: { path: (string | number)[]; message: string }[]
}): ProjectFileResult<never> {
  const code: ProjectFileError['code'] =
    error.code === 'file_too_large'
      ? 'TOO_LARGE'
      : error.code === 'invalid_json'
        ? 'INVALID_JSON'
        : error.code === 'unknown_schema_version'
          ? 'UNSUPPORTED_VERSION'
          : error.code === 'calculation_failed'
            ? 'CALCULATION_FAILED'
            : 'INVALID_RECORD'
  const detail =
    error.details.length === 0
      ? undefined
      : error.details
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.') || '(根)'} ${issue.message}`)
          .join('；')
  return fail(code, error.message, detail)
}

function retiredBase(projectId: string): string | null {
  const index = projectId.indexOf(RETIRED_MARKER)
  return index > 0 ? projectId.slice(0, index) : null
}

function resultNumbers(result: ChainResult): (number | null | string)[] {
  return [
    result.nominalQ,
    result.minQ,
    result.maxQ,
    result.lowerDeviationQ,
    result.upperDeviationQ,
    result.toleranceQ,
    result.status,
    result.lowerMarginQ,
    result.upperMarginQ,
    ...result.contributions.map((item) => `${item.termId}:${item.toleranceQ}`),
  ]
}

function sameResult(left: ChainResult, right: ChainResult): boolean {
  return JSON.stringify(resultNumbers(left)) === JSON.stringify(resultNumbers(right))
}

/** 当前工作方案用既有 calculateChain 重算；与旧端冻结的同输入结果比对。 */
function recomputeWorking(
  working: ChainDefinition,
  frozen: { result: ChainResult; definition: ChainDefinition }[],
): ProjectFileResult<ChainResult> {
  let result: ChainResult
  try {
    result = calculateChain(working)
  } catch (error) {
    return fail(
      'CALCULATION_FAILED',
      '当前工作方案重新计算失败，迁移已拒绝',
      error instanceof Error ? error.message : String(error),
    )
  }
  for (const snapshot of frozen) {
    if (!sameChain(snapshot.definition, working)) {
      continue
    }
    if (!sameResult(result, snapshot.result)) {
      return fail(
        'CALCULATION_FAILED',
        '当前工作方案的整数结果与旧端冻结结果不一致，迁移已拒绝',
        `旧端 nominalQ/minQ/maxQ=${snapshot.result.nominalQ}/${snapshot.result.minQ}/${snapshot.result.maxQ}，重算=${result.nominalQ}/${result.minQ}/${result.maxQ}`,
      )
    }
  }
  return ok(result)
}

function collectArchive(
  parsed: ParsedBackup,
  selectedProjectId: string,
): { archive: ProjectFileLegacyArchive | null; selectedRetired: number; orphans: number } {
  const knownProjects = new Set(parsed.projects.map((project) => project.id))
  const records: unknown[] = []
  let selectedRetired = 0
  let orphans = 0

  const add = (kind: string, record: { projectId: string }): void => {
    const base = retiredBase(record.projectId)
    if (base === null) {
      return
    }
    const isSelected = base === selectedProjectId
    const isOrphan = !knownProjects.has(base)
    if (!isSelected && !isOrphan) {
      // 其它仍可选项目的退役历史不并入本文件，保持各自可迁移。
      return
    }
    records.push({ kind, projectId: record.projectId, record })
    if (isSelected) {
      selectedRetired += 1
    } else {
      orphans += 1
    }
  }

  for (const document of parsed.documents) add('document', document)
  for (const revision of parsed.revisions) add('revision', revision)
  for (const blob of parsed.blobs) {
    const blobRecord = {
      blobKey: blob.blobKey,
      projectId: blob.projectId,
      sha256: blob.sha256,
      byteSize: blob.byteSize,
    }
    add('blob', blobRecord)
  }
  for (const binding of parsed.bindings) add('binding', binding)
  for (const event of parsed.events) add('event', event)

  const warnings: string[] = []
  if (selectedRetired > 0) {
    warnings.push(
      `已把所选项目的 ${selectedRetired} 条退役历史记录放入只读 legacyArchive；不并入当前来源，也不泄露为当前绑定。`,
    )
  }
  if (orphans > 0) {
    warnings.push(
      `另有 ${orphans} 条无法证明归属的孤立退役记录已放入只读归档（不静默丢弃）；迁移后只可查看，不能作为当前来源。`,
    )
  }
  if (records.length > 0) {
    warnings.push('退役归档只保留记录与哈希，不携带已退役项目的附件字节。')
  }

  if (records.length === 0) {
    return { archive: null, selectedRetired, orphans }
  }
  return {
    archive: {
      sourceProjectId: selectedProjectId,
      sourceManifest: {
        format: parsed.manifest.format,
        formatVersion: parsed.manifest.formatVersion,
        createdAt: parsed.manifest.createdAt,
        projects: parsed.manifest.projects,
        selectedProjectId,
      },
      records,
      warnings,
    },
    selectedRetired,
    orphans,
  }
}

function countMissingForScope(
  parsed: ParsedBackup,
  inScopeRevisionIds: ReadonlySet<string>,
): number {
  return parsed.manifest.missingAttachments.filter((item) =>
    inScopeRevisionIds.has(item.revisionId),
  ).length
}

export async function inspectV2Bundle(
  bytes: Uint8Array,
): Promise<ProjectFileResult<V2BundleInspection>> {
  const parsed = await parseBackup(bytes)
  if (!parsed.ok) {
    return mapRestoreError(parsed.error)
  }
  const backup = parsed.value
  const sourceSha256 = await sha256Hex(bytes)
  const warnings: string[] = []
  if (backup.manifest.missingAttachments.length > 0) {
    warnings.push(
      `源包声明 ${backup.manifest.missingAttachments.length} 个缺失附件；合法缺附件只带警告保留，不会伪造 PDF。`,
    )
  }
  warnings.push('完整备份包含多个项目时，一次只迁移一个项目；其余项目仍可在后续迁移中选择。')

  const projects: V2BundleProjectSummary[] = backup.projects.map((project) => {
    const revisions = backup.revisions.filter((item) => item.projectId === project.id)
    const revisionIds = new Set(revisions.map((item) => item.id))
    const archive = collectArchive(backup, project.id)
    return {
      id: project.id,
      name: project.name,
      attachmentCount: backup.blobs.filter((item) => item.projectId === project.id).length,
      missingItems: countMissingForScope(backup, revisionIds),
      revisionCount: revisions.length,
      bindingCount: backup.bindings.filter((item) => item.projectId === project.id).length,
      eventCount: backup.events.filter((item) => item.projectId === project.id).length,
      snapshotCount: backup.snapshots.filter((item) => item.projectId === project.id).length,
      retiredRecordCount: archive.selectedRetired,
      orphanRetiredRecordCount: archive.orphans,
    }
  })
  for (const project of projects) {
    if (project.orphanRetiredRecordCount > 0) {
      warnings.push(
        `项目 ${project.name} 的迁移会同时归档 ${project.orphanRetiredRecordCount} 条归属不明的孤立退役记录。`,
      )
    }
  }
  return ok({
    sourceKind: 'v2-bundle',
    sourceSha256,
    formatVersion: backup.manifest.formatVersion,
    createdAt: backup.manifest.createdAt,
    projects,
    warnings,
  })
}

function jsonRawVersion(text: string): number | null {
  try {
    const value = JSON.parse(text) as unknown
    if (typeof value !== 'object' || value === null) {
      return null
    }
    const version = (value as Record<string, unknown>).schemaVersion
    return typeof version === 'number' ? version : null
  } catch {
    return null
  }
}

export async function inspectV2Json(
  bytes: Uint8Array,
): Promise<ProjectFileResult<V2JsonInspection>> {
  const decoded = decodeProjectJson(bytes)
  if (!decoded.ok) {
    return mapStorageError(decoded.error)
  }
  let raw: unknown
  try {
    raw = JSON.parse(decoded.value)
  } catch {
    return fail('INVALID_JSON', '项目 JSON 格式无效')
  }
  const parsed = parseImportedProject(raw)
  if (!parsed.ok) {
    return mapStorageError(parsed.error)
  }
  const value = parsed.value
  const revisions = value.sources?.revisions.length ?? 0
  const warnings = [...value.warnings]
  warnings.push('该输入是旧 JSON：不含附件原字节、事件历史与分析快照，无法恢复历史报告；迁移后会明确标记附件不可用。')
  return ok({
    sourceKind: 'v2-json',
    sourceSha256: await sha256Hex(bytes),
    formatVersion: jsonRawVersion(decoded.value) ?? 0,
    createdAt: value.project.createdAt,
    projects: [
      {
        id: value.project.id,
        name: value.project.name,
        attachmentCount: 0,
        missingItems: revisions,
        revisionCount: revisions,
        bindingCount: value.sources?.bindings.length ?? 0,
        eventCount: 0,
        snapshotCount: 0,
        retiredRecordCount: 0,
        orphanRetiredRecordCount: 0,
      },
    ],
    warnings,
  })
}

function initialProjectRevision(
  project: ProjectFileProject,
): ProjectFileSnapshot['fileRevisions'][number] {
  return {
    revisionId: project.currentRevisionId,
    parentId: null,
    createdAt: project.createdAt,
    reason: 'V2 迁移生成的初始文件版本',
    project,
  }
}

function migrationEvent(
  projectId: string,
  createdAt: string,
  sourceKind: 'v2-bundle' | 'v2-json',
): ProjectFileSnapshot['events'][number] {
  return {
    id: `project_migrated_from_v2:${projectId}:${createdAt}`,
    projectId,
    type: 'project_migrated_from_v2',
    createdAt,
    message:
      sourceKind === 'v2-bundle'
        ? '已从 .cunlian.zip 完整备份迁移为单个 .cunlian 项目文件；保留数值、来源与历史，当前人工确认已清零。'
        : '已从 V2 项目 JSON 迁移为 .cunlian 项目文件；保留工程输入与来源元数据，附件与历史报告不包含在该输入中，当前人工确认已清零。',
  }
}

export interface MigrateV2BundleInput {
  bytes: Uint8Array
  projectId: string
}

export async function migrateV2Bundle(
  input: MigrateV2BundleInput,
  options: MigrateV2Options = {},
): Promise<ProjectFileResult<MigratedV2>> {
  const parsed = await parseBackup(input.bytes)
  if (!parsed.ok) {
    return mapRestoreError(parsed.error)
  }
  const backup = parsed.value
  const project = backup.projects.find((item) => item.id === input.projectId)
  if (project === undefined) {
    return fail('INVALID_RECORD', '所选项目不在该备份中', input.projectId)
  }

  // 当前来源只含所选项目本身的作用域；退役作用域只进只读归档，不能冒充当前来源。
  const documents = backup.documents.filter((item) => item.projectId === project.id)
  const revisions = backup.revisions.filter((item) => item.projectId === project.id)
  const blobs = backup.blobs.filter((item) => item.projectId === project.id)
  const bindings = backup.bindings.filter((item) => item.projectId === project.id)
  const events = backup.events.filter((item) => item.projectId === project.id)
  const snapshots = backup.snapshots.filter((item) => item.projectId === project.id)
  const importSnapshots = backup.importSnapshots.filter(
    (item) => item.projectId === project.id,
  )
  const migrationBackups = backup.migrationBackups.filter(
    (item) => item.projectId === project.id,
  )
  const storedDraft = backup.drafts.find((item) => item.projectId === project.id) as
    | StoredDraft
    | undefined

  // 孤立附件元数据不能静默丢弃，也不能生成无版本的附件条目：明确拒绝。
  const referencedBlobKeys = new Set(revisions.map((item) => item.blobKey))
  for (const blob of blobs) {
    if (!referencedBlobKeys.has(blob.blobKey)) {
      return fail(
        'INVALID_RECORD',
        '备份中存在没有对应来源版本的附件元数据，迁移已拒绝',
        blob.blobKey,
      )
    }
  }

  const recomputed = recomputeWorking(project.working, snapshots)
  if (!recomputed.ok) {
    return recomputed
  }

  const revisionById = new Map(revisions.map((item) => [item.id, item]))
  const blobByKey = new Map(blobs.map((item) => [item.blobKey, item]))
  const missingByRevision = new Map<string, { blobKey: string; documentId: string }>()
  for (const missing of backup.manifest.missingAttachments) {
    if (!revisionById.has(missing.revisionId)) {
      continue
    }
    const revision = revisionById.get(missing.revisionId)
    if (revision === undefined) {
      continue
    }
    missingByRevision.set(missing.revisionId, {
      blobKey: missing.blobKey,
      documentId: missing.documentId,
    })
  }

  const missingAttachments: ProjectFileMissingAttachment[] = []
  for (const revision of revisions) {
    if (blobByKey.has(revision.blobKey)) {
      continue
    }
    const missing = missingByRevision.get(revision.id)
    if (missing === undefined) {
      return fail(
        'MISSING_REFERENCE',
        `版本 ${revision.id} 既没有附件字节也没有缺失声明`,
        revision.blobKey,
      )
    }
    missingAttachments.push({
      revisionId: revision.id,
      documentId: revision.documentId,
      blobKey: revision.blobKey,
      reason: 'declared-missing',
    })
  }

  // 历史快照的冻结来源必须能在本文件内解析；否则拒绝迁移而不是静默丢引用。
  const snapshotReferences: ProjectFileSnapshotReference[] = []
  const snapshotIds = new Set<string>()
  for (const snapshot of snapshots) {
    if (snapshotIds.has(snapshot.id)) {
      return fail('INVALID_RECORD', `分析快照 ID 重复：${snapshot.id}`)
    }
    snapshotIds.add(snapshot.id)
    const revisionIds: string[] = []
    const blobKeys: string[] = []
    for (const frozen of snapshot.sourceManifest.revisions) {
      if (!revisionById.has(frozen.id)) {
        return fail(
          'MISSING_REFERENCE',
          `历史快照 ${snapshot.id} 引用的来源版本不在所选项目闭包内`,
          frozen.id,
        )
      }
      revisionIds.push(frozen.id)
      if (blobByKey.has(frozen.blobKey)) {
        blobKeys.push(frozen.blobKey)
      }
    }
    snapshotReferences.push({ snapshotId: snapshot.id, revisionIds, blobKeys })
  }

  const createdAt = nowIso(options)
  const revisionId = options.newRevisionId?.() ?? newId('project-revision')
  const projectRecord: ProjectFileProject = {
    id: project.id,
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    name: project.name,
    currentRevisionId: revisionId,
    dimensionChain: project.working,
    engineVersion: project.engineVersion,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    // ZIP 路径：沿用 restoreBackup 的既有值（不清零、不 +1）。
    relationRevision: project.relationRevision,
    // 当前确认清零；历史快照内的凭据保持原样。
    relationReview: null,
    migration: project.migration,
    baseline: project.baseline,
    // 迁移产物由 B2 写端生成：本身即格式 2 / schema 4。
    sourceFormatVersion: 2,
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

  const archive = collectArchive(backup, project.id)
  const warnings: string[] = []
  if (missingAttachments.length > 0) {
    warnings.push(
      `有 ${missingAttachments.length} 个来源版本在源包中合法声明缺少附件；迁移后保留元数据并标记附件不可用。`,
    )
  }
  warnings.push(
    '当前关系确认与绑定的来源核对已清零，需按 review/rules.ts 重新派生待办并人工复核；历史快照内冻结的确认与结论原样保留。',
  )
  if (archive.archive !== null) {
    warnings.push(...archive.archive.warnings)
  }

  const snapshot: ProjectFileSnapshot = {
    project: projectRecord,
    draft: storedDraft?.draft ?? null,
    documents,
    revisions,
    blobs: blobs.map((blob) => ({
      blobKey: blob.blobKey,
      projectId: project.id,
      sha256: blob.sha256,
      byteSize: blob.byteSize,
    })),
    bindings: bindings.map((binding) => ({
      ...binding,
      reviewedTermRevision: null,
      reviewedAt: null,
      historicalAcceptance: null,
    })),
    events: [...events, migrationEvent(project.id, createdAt, 'v2-bundle')],
    analysisSnapshots: snapshots,
    importSnapshots,
    migrationBackups: migrationBackups as unknown as ProjectFileSnapshot['migrationBackups'],
    legacyArchive: archive.archive,
    fileRevisions: [initialProjectRevision(projectRecord)],
    attachments: blobs.map((blob) => ({ blobKey: blob.blobKey, bytes: blob.bytes })),
    missingAttachments,
    snapshotReferences,
    manifestMeta: {
      createdAt,
      writer: {
        appVersion: options.appVersion ?? 'unknown',
        electronVersion: options.electronVersion ?? 'unknown',
        engineVersion: ENGINE_VERSION,
      },
      migration: {
        sourceKind: 'v2-bundle',
        sourceSha256: await sha256Hex(input.bytes),
        sourceFormatVersion: backup.manifest.formatVersion,
        sourceProjectId: project.id,
        importedAt: createdAt,
        confirmationPolicy: 'v2-external-import',
        warnings,
      },
    },
  }

  const references = validateSnapshotReferences(snapshot)
  if (!references.ok) {
    return fail(references.error.code, references.error.message, references.error.detail)
  }

  return ok({ snapshot, warnings, sourceSha256: snapshot.manifestMeta.migration?.sourceSha256 ?? '' })
}

export async function migrateV2Json(
  bytes: Uint8Array,
  options: MigrateV2Options = {},
): Promise<ProjectFileResult<MigratedV2>> {
  const decoded = decodeProjectJson(bytes)
  if (!decoded.ok) {
    return mapStorageError(decoded.error)
  }
  let raw: unknown
  try {
    raw = JSON.parse(decoded.value)
  } catch {
    return fail('INVALID_JSON', '项目 JSON 格式无效')
  }
  const schemaVersion = jsonRawVersion(decoded.value)
  if (schemaVersion === 2) {
    const rawRevision = (raw as Record<string, unknown>).relationRevision
    if (
      typeof rawRevision === 'number' &&
      Number.isSafeInteger(rawRevision) &&
      rawRevision >= Number.MAX_SAFE_INTEGER
    ) {
      return fail(
        'INVALID_RECORD',
        'relationRevision 在原值基础上加一会溢出，迁移已拒绝',
        String(rawRevision),
      )
    }
  }

  const parsed = parseImportedProject(raw)
  if (!parsed.ok) {
    return mapStorageError(parsed.error)
  }
  const value = parsed.value
  const project = value.project

  const recomputed = recomputeWorking(project.working, [])
  if (!recomputed.ok) {
    return recomputed
  }
  if (!sameResult(recomputed.value, value.result)) {
    return fail(
      'CALCULATION_FAILED',
      '当前工作方案的整数结果与旧端导入结果不一致，迁移已拒绝',
    )
  }

  const newBlobKey =
    options.newBlobKey ??
    ((revisionId: string) => newId(`legacy-json-${revisionId.slice(0, 12)}`))
  const sources = value.sources
  const revisions = (sources?.revisions ?? []).map((revision) => ({
    ...revision,
    projectId: project.id,
    blobKey: newBlobKey(revision.id),
  }))
  const documents = (sources?.documents ?? []).map((document) => ({
    ...document,
    projectId: project.id,
  }))
  const bindings = (sources?.bindings ?? []).map((binding) => ({
    ...binding,
    projectId: project.id,
    reviewedTermRevision: null,
    reviewedAt: null,
    historicalAcceptance: null,
  }))
  const missingAttachments: ProjectFileMissingAttachment[] = revisions.map((revision) => ({
    revisionId: revision.id,
    documentId: revision.documentId,
    blobKey: revision.blobKey,
    reason: 'legacy-json',
  }))

  const createdAt = nowIso(options)
  const revisionId = options.newRevisionId?.() ?? newId('project-revision')
  const projectRecord: ProjectFileProject = {
    id: project.id,
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    name: project.name,
    currentRevisionId: revisionId,
    dimensionChain: project.working,
    engineVersion: project.engineVersion,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    // JSON 路径：v2 = 原值 + 1，v1 = 1（两者由 projectJson.ts 分派保证不同）。
    relationRevision: project.relationRevision,
    relationReview: null,
    migration: null,
    baseline: project.baseline,
    // 迁移产物由 B2 写端生成：本身即格式 2 / schema 4。
    sourceFormatVersion: 2,
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

  const warnings = [...value.warnings]
  if (revisions.length > 0) {
    warnings.push(
      '该输入不含 PDF 原字节：迁移后每个来源版本都标记为附件不可用，绑定页码与区域保留但需重新导入 PDF 才能查看原文。',
    )
  }
  warnings.push('当前关系确认与绑定核对已清零；JSON 输入不含历史报告与事件，不能宣称与完整备份等价。')

  const snapshot: ProjectFileSnapshot = {
    project: projectRecord,
    draft: null,
    documents,
    revisions,
    blobs: [],
    bindings,
    events: [migrationEvent(project.id, createdAt, 'v2-json')],
    analysisSnapshots: [],
    importSnapshots: [],
    migrationBackups: [],
    legacyArchive: null,
    fileRevisions: [initialProjectRevision(projectRecord)],
    attachments: [],
    missingAttachments,
    snapshotReferences: [],
    manifestMeta: {
      createdAt,
      writer: {
        appVersion: options.appVersion ?? 'unknown',
        electronVersion: options.electronVersion ?? 'unknown',
        engineVersion: ENGINE_VERSION,
      },
      migration: {
        sourceKind: 'v2-json',
        sourceSha256: await sha256Hex(bytes),
        sourceFormatVersion: schemaVersion ?? 0,
        sourceProjectId: project.id,
        importedAt: createdAt,
        confirmationPolicy: 'v2-external-import',
        warnings,
      },
    },
  }

  const references = validateSnapshotReferences(snapshot)
  if (!references.ok) {
    return fail(references.error.code, references.error.message, references.error.detail)
  }

  return ok({ snapshot, warnings, sourceSha256: snapshot.manifestMeta.migration?.sourceSha256 ?? '' })
}
