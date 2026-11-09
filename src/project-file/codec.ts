/**
 * `.cunlian` 容器编解码（A-02 纯部分）。
 *
 * 编码：聚合 → 各 JSON 部分 + 附件字节 → manifest → ZIP（复用 V2 backup/zip.ts
 * 的路径/大小/重名防护）。
 * 解码：ZIP → 结构/版本 → 记录 → 引用完整性 → 条目大小/哈希 → 附件哈希。
 *
 * 保存端与打开端共用 `assembleSnapshot` 与 `validateContainerEntries`；编码时
 * 会把刚生成的字节重新按“打开路径”解析一遍，避免写出自己都读不回来的文件。
 */
import type { ZipSafetyError } from '../backup/zip'
import { readZipEntries, writeZipEntries } from '../backup/zip'
import { sha256Hex } from '../sources/hash'
import {
  ATTACHMENT_EXTENSION,
  ATTACHMENT_PATH_PREFIX,
  DIMENSION_CHAIN_SCHEMA_VERSION,
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_FORMAT_VERSION,
  PROJECT_FILE_MAX_SOURCE_BYTES,
  PROJECT_FILE_MAX_UNCOMPRESSED_BYTES,
  PROJECT_FILE_PATHS,
  PROJECT_FILE_SCHEMA_VERSION,
  REVISION_EXTENSION,
  REVISION_PATH_PREFIX,
  type ProjectFileDecoded,
  type ProjectFileError,
  type ProjectFileManifest,
  type ProjectFileRevision,
  type ProjectFileResult,
  type ProjectFileSnapshot,
} from './types'
import {
  assembleSnapshot,
  attachmentEntryPath,
  computeCounts,
  expectedAttachmentRefs,
  expectedEntryRoles,
  fail,
  ok,
  parseManifest,
  parseRevisionFile,
  revisionEntryPath,
  validateAttachmentBytes,
  validateContainerEntries,
  type ActualEntry,
} from './validation'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`)
}

function parseJson(bytes: Uint8Array, label: string): ProjectFileResult<unknown> {
  let text: string
  try {
    text = decoder.decode(bytes)
  } catch {
    return fail('INVALID_RECORD', `${label} 不是合法 UTF-8`)
  }
  try {
    return ok(JSON.parse(text) as unknown)
  } catch {
    return fail('INVALID_RECORD', `${label} 不是合法 JSON`)
  }
}

function mapZipError(error: ZipSafetyError): ProjectFileError {
  const codeByZip: Record<string, ProjectFileError['code']> = {
    invalid_zip: 'INVALID_ZIP',
    too_many_entries: 'TOO_MANY_ENTRIES',
    too_large: 'TOO_LARGE',
    unsafe_path: 'UNSAFE_PATH',
    duplicate_entry: 'DUPLICATE_ENTRY',
  }
  return {
    code: codeByZip[error.code] ?? 'INVALID_ZIP',
    message: error.message,
    detail: error.detail,
  }
}

function decodeSegment(path: string, prefix: string, extension: string): string | null {
  if (!path.startsWith(prefix) || !path.endsWith(extension)) {
    return null
  }
  const segment = path.slice(prefix.length, path.length - extension.length)
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export interface EncodeResult {
  bytes: Uint8Array
  manifest: ProjectFileManifest
  entryPaths: string[]
}

/**
 * 把聚合编码为 `.cunlian` 字节。
 *
 * 先按打开路径自解析一遍（结构、引用、哈希），再写 ZIP；任何不一致都在
 * 落盘前失败。
 */
export async function encodeProjectFile(
  snapshot: ProjectFileSnapshot,
): Promise<ProjectFileResult<EncodeResult>> {
  const attachments = await validateAttachmentBytes(snapshot, sha256Hex)
  if (!attachments.ok) {
    return fail(attachments.error.code, attachments.error.message, attachments.error.detail)
  }

  const parts = new Map<string, Uint8Array>()
  parts.set(PROJECT_FILE_PATHS.project, jsonBytes(snapshot.project))
  parts.set(PROJECT_FILE_PATHS.draft, jsonBytes(snapshot.draft))
  parts.set(PROJECT_FILE_PATHS.documents, jsonBytes(snapshot.documents))
  parts.set(PROJECT_FILE_PATHS.revisions, jsonBytes(snapshot.revisions))
  parts.set(PROJECT_FILE_PATHS.bindings, jsonBytes(snapshot.bindings))
  parts.set(PROJECT_FILE_PATHS.blobs, jsonBytes(snapshot.blobs))
  parts.set(PROJECT_FILE_PATHS.events, jsonBytes(snapshot.events))
  parts.set(PROJECT_FILE_PATHS.analysisSnapshots, jsonBytes(snapshot.analysisSnapshots))
  parts.set(PROJECT_FILE_PATHS.importSnapshots, jsonBytes(snapshot.importSnapshots))
  parts.set(PROJECT_FILE_PATHS.migrationBackups, jsonBytes(snapshot.migrationBackups))
  if (snapshot.legacyArchive !== null) {
    parts.set(PROJECT_FILE_PATHS.legacyArchive, jsonBytes(snapshot.legacyArchive))
  }
  for (const revision of snapshot.fileRevisions) {
    parts.set(revisionEntryPath(revision.revisionId), jsonBytes(revision))
  }
  for (const attachment of snapshot.attachments) {
    parts.set(attachmentEntryPath(attachment.blobKey), attachment.bytes)
  }

  // 自校验：按打开端相同顺序解析刚构造的部分（附件是二进制，不按 JSON 解析）。
  const parsedParts: Record<string, unknown> = {}
  for (const [path, bytes] of parts) {
    if (path.startsWith(ATTACHMENT_PATH_PREFIX)) {
      continue
    }
    const parsed = parseJson(bytes, path)
    if (!parsed.ok) {
      return fail(parsed.error.code, parsed.error.message, parsed.error.detail)
    }
    parsedParts[path] = parsed.value
  }

  const fileRevisions: ProjectFileRevision[] = []
  for (const revision of snapshot.fileRevisions) {
    const parsed = parseRevisionFile(parsedParts[revisionEntryPath(revision.revisionId)])
    if (!parsed.ok) {
      return fail(parsed.error.code, parsed.error.message, parsed.error.detail)
    }
    fileRevisions.push(parsed.value)
  }

  const assembled = assembleSnapshot({
    project: parsedParts[PROJECT_FILE_PATHS.project],
    draft: parsedParts[PROJECT_FILE_PATHS.draft],
    documents: parsedParts[PROJECT_FILE_PATHS.documents],
    revisions: parsedParts[PROJECT_FILE_PATHS.revisions],
    bindings: parsedParts[PROJECT_FILE_PATHS.bindings],
    blobs: parsedParts[PROJECT_FILE_PATHS.blobs],
    events: parsedParts[PROJECT_FILE_PATHS.events],
    analysisSnapshots: parsedParts[PROJECT_FILE_PATHS.analysisSnapshots],
    importSnapshots: parsedParts[PROJECT_FILE_PATHS.importSnapshots],
    migrationBackups: parsedParts[PROJECT_FILE_PATHS.migrationBackups],
    legacyArchive: parsedParts[PROJECT_FILE_PATHS.legacyArchive] ?? null,
    fileRevisions,
    attachments: snapshot.attachments,
    missingAttachments: snapshot.missingAttachments,
    snapshotReferences: snapshot.snapshotReferences,
    manifestMeta: snapshot.manifestMeta,
  })
  if (!assembled.ok) {
    return fail(assembled.error.code, assembled.error.message, assembled.error.detail)
  }
  const checked = assembled.value

  const actualEntries: ActualEntry[] = []
  for (const [path, bytes] of parts) {
    actualEntries.push({ path, byteSize: bytes.byteLength, sha256: await sha256Hex(bytes) })
  }
  actualEntries.sort((left, right) => comparePaths(left.path, right.path))

  const roles = new Map(expectedEntryRoles(checked).map((entry) => [entry.path, entry.role]))
  const entries = actualEntries.map((entry) => {
    const role = roles.get(entry.path)
    if (role === undefined) {
      throw new Error(`内部错误：缺少条目角色 ${entry.path}`)
    }
    return { path: entry.path, role, byteSize: entry.byteSize, sha256: entry.sha256 }
  })

  const payloadBytes = entries.reduce((total, entry) => total + entry.byteSize, 0)
  const manifest: ProjectFileManifest = {
    format: PROJECT_FILE_FORMAT,
    formatVersion: PROJECT_FILE_FORMAT_VERSION,
    createdAt: checked.manifestMeta.createdAt,
    writer: checked.manifestMeta.writer,
    project: {
      id: checked.project.id,
      name: checked.project.name,
      projectSchemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      dimensionChainSchemaVersion: DIMENSION_CHAIN_SCHEMA_VERSION,
      currentRevisionId: checked.project.currentRevisionId,
    },
    entries,
    payloadBytes,
    counts: computeCounts(checked),
    attachments: expectedAttachmentRefs(checked),
    missingAttachments: checked.missingAttachments,
    snapshotReferences: checked.snapshotReferences,
    migration: checked.manifestMeta.migration,
    excludes: {
      mappingTemplates: {
        included: false,
        note: '映射模板是用户机器设置，不随项目文件携带。',
      },
    },
  }

  const containerCheck = validateContainerEntries(
    manifest,
    checked,
    actualEntries,
    payloadBytes,
  )
  if (!containerCheck.ok) {
    return fail(
      containerCheck.error.code,
      containerCheck.error.message,
      containerCheck.error.detail,
    )
  }

  const zipEntries = [
    ...Array.from(parts, ([path, bytes]) => ({
      path,
      bytes,
      // PDF 等已压缩数据不再 deflate，JSON 用小压缩级别；不改变可读性。
      level: path.startsWith(ATTACHMENT_PATH_PREFIX) ? 0 : 6,
    })),
    { path: PROJECT_FILE_PATHS.manifest, bytes: jsonBytes(manifest), level: 6 },
  ]

  const written = await writeZipEntries(zipEntries)
  if (!written.ok) {
    return { ok: false, error: mapZipError(written.error) }
  }
  if (written.value.byteLength > PROJECT_FILE_MAX_UNCOMPRESSED_BYTES) {
    return fail('TOO_LARGE', '生成的容器超过 150 MiB 上限')
  }
  return ok({ bytes: written.value, manifest, entryPaths: entries.map((entry) => entry.path) })
}

/**
 * 解码并完整校验 `.cunlian` 字节。
 *
 * 返回的 snapshot.attachments 保留字节（main 持有），renderer 只拿非附件 DTO。
 */
export async function decodeProjectFile(
  bytes: Uint8Array,
): Promise<ProjectFileResult<ProjectFileDecoded>> {
  if (bytes.byteLength === 0) {
    return fail('EMPTY_BACKUP', '文件为空')
  }
  if (bytes.byteLength > PROJECT_FILE_MAX_SOURCE_BYTES) {
    return fail('TOO_LARGE', '文件超过 150 MiB 输入上限')
  }

  const zip = await readZipEntries(bytes)
  if (!zip.ok) {
    return { ok: false, error: mapZipError(zip.error) }
  }
  const files = zip.value
  if (files.size === 0) {
    return fail('EMPTY_BACKUP', 'ZIP 不包含任何条目')
  }

  const manifestBytes = files.get(PROJECT_FILE_PATHS.manifest)
  if (manifestBytes === undefined) {
    return fail('INVALID_MANIFEST', '缺少 manifest.json')
  }
  const manifestJson = parseJson(manifestBytes, PROJECT_FILE_PATHS.manifest)
  if (!manifestJson.ok) {
    return fail(manifestJson.error.code, manifestJson.error.message, manifestJson.error.detail)
  }
  const rawManifest = manifestJson.value
  if (typeof rawManifest !== 'object' || rawManifest === null) {
    return fail('INVALID_MANIFEST', 'manifest.json 必须是对象')
  }
  const rawRecord = rawManifest as Record<string, unknown>
  if (rawRecord.format !== PROJECT_FILE_FORMAT) {
    return fail(
      'INVALID_MANIFEST',
      '不是寸链项目文件（format 不匹配）',
      String(rawRecord.format),
    )
  }
  if (rawRecord.formatVersion !== PROJECT_FILE_FORMAT_VERSION) {
    return fail(
      'UNSUPPORTED_VERSION',
      '项目文件格式版本不受支持',
      `formatVersion=${String(rawRecord.formatVersion)}`,
    )
  }
  const rawProject = rawRecord.project
  if (typeof rawProject === 'object' && rawProject !== null) {
    const projectRecord = rawProject as Record<string, unknown>
    if (
      projectRecord.projectSchemaVersion !== undefined &&
      projectRecord.projectSchemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    ) {
      return fail(
        'UNSUPPORTED_VERSION',
        '项目 schema 版本不受支持',
        `projectSchemaVersion=${String(projectRecord.projectSchemaVersion)}`,
      )
    }
  }

  const manifest = parseManifest(rawManifest)
  if (!manifest.ok) {
    return fail(manifest.error.code, manifest.error.message, manifest.error.detail)
  }

  const entryPaths = [...files.keys()].filter((path) => path !== PROJECT_FILE_PATHS.manifest)
  const readPart = (path: string, required: boolean): ProjectFileResult<unknown> => {
    const partBytes = files.get(path)
    if (partBytes === undefined) {
      return required
        ? fail('INVALID_RECORD', `缺少必需条目：${path}`)
        : ok(null)
    }
    return parseJson(partBytes, path)
  }

  const projectPart = readPart(PROJECT_FILE_PATHS.project, true)
  if (!projectPart.ok) return projectPart
  const draftPart = readPart(PROJECT_FILE_PATHS.draft, true)
  if (!draftPart.ok) return draftPart
  const documentsPart = readPart(PROJECT_FILE_PATHS.documents, true)
  if (!documentsPart.ok) return documentsPart
  const revisionsPart = readPart(PROJECT_FILE_PATHS.revisions, true)
  if (!revisionsPart.ok) return revisionsPart
  const bindingsPart = readPart(PROJECT_FILE_PATHS.bindings, true)
  if (!bindingsPart.ok) return bindingsPart
  const blobsPart = readPart(PROJECT_FILE_PATHS.blobs, true)
  if (!blobsPart.ok) return blobsPart
  const eventsPart = readPart(PROJECT_FILE_PATHS.events, true)
  if (!eventsPart.ok) return eventsPart
  const analysisPart = readPart(PROJECT_FILE_PATHS.analysisSnapshots, true)
  if (!analysisPart.ok) return analysisPart
  const importPart = readPart(PROJECT_FILE_PATHS.importSnapshots, true)
  if (!importPart.ok) return importPart
  const migrationPart = readPart(PROJECT_FILE_PATHS.migrationBackups, true)
  if (!migrationPart.ok) return migrationPart
  const legacyPart = readPart(PROJECT_FILE_PATHS.legacyArchive, false)
  if (!legacyPart.ok) return legacyPart

  const fileRevisions: ProjectFileRevision[] = []
  for (const path of entryPaths) {
    if (!path.startsWith(REVISION_PATH_PREFIX) || !path.endsWith(REVISION_EXTENSION)) {
      continue
    }
    const revisionId = decodeSegment(path, REVISION_PATH_PREFIX, REVISION_EXTENSION)
    if (revisionId === null || revisionId.length === 0) {
      return fail('UNSAFE_PATH', `文件版本条目名无法解码：${path}`)
    }
    const part = readPart(path, true)
    if (!part.ok) return part
    const parsed = parseRevisionFile(part.value)
    if (!parsed.ok) {
      return fail(parsed.error.code, parsed.error.message, parsed.error.detail)
    }
    if (parsed.value.revisionId !== revisionId) {
      return fail(
        'INVALID_RECORD',
        '文件版本条目名与记录 ID 不一致',
        `${path} != ${parsed.value.revisionId}`,
      )
    }
    fileRevisions.push(parsed.value)
  }

  const attachments: { blobKey: string; bytes: Uint8Array }[] = []
  for (const path of entryPaths) {
    if (!path.startsWith(ATTACHMENT_PATH_PREFIX) || !path.endsWith(ATTACHMENT_EXTENSION)) {
      continue
    }
    const blobKey = decodeSegment(path, ATTACHMENT_PATH_PREFIX, ATTACHMENT_EXTENSION)
    const attachmentBytes = files.get(path)
    if (blobKey === null || blobKey.length === 0 || attachmentBytes === undefined) {
      return fail('UNSAFE_PATH', `附件条目名无法解码：${path}`)
    }
    attachments.push({ blobKey, bytes: attachmentBytes })
  }

  const assembled = assembleSnapshot({
    project: projectPart.value,
    draft: draftPart.value,
    documents: documentsPart.value,
    revisions: revisionsPart.value,
    bindings: bindingsPart.value,
    blobs: blobsPart.value,
    events: eventsPart.value,
    analysisSnapshots: analysisPart.value,
    importSnapshots: importPart.value,
    migrationBackups: migrationPart.value,
    legacyArchive: legacyPart.value,
    fileRevisions,
    attachments,
    missingAttachments: manifest.value.missingAttachments,
    snapshotReferences: manifest.value.snapshotReferences,
    manifestMeta: {
      createdAt: manifest.value.createdAt,
      writer: manifest.value.writer,
      migration: manifest.value.migration,
    },
  })
  if (!assembled.ok) {
    return fail(assembled.error.code, assembled.error.message, assembled.error.detail)
  }

  const actual: ActualEntry[] = []
  let actualPayloadBytes = 0
  for (const path of entryPaths) {
    const partBytes = files.get(path)
    if (partBytes === undefined) {
      continue
    }
    actualPayloadBytes += partBytes.byteLength
    actual.push({
      path,
      byteSize: partBytes.byteLength,
      sha256: await sha256Hex(partBytes),
    })
  }

  const containerCheck = validateContainerEntries(
    manifest.value,
    assembled.value,
    actual,
    actualPayloadBytes,
  )
  if (!containerCheck.ok) {
    return fail(
      containerCheck.error.code,
      containerCheck.error.message,
      containerCheck.error.detail,
    )
  }

  const attachmentCheck = await validateAttachmentBytes(assembled.value, sha256Hex)
  if (!attachmentCheck.ok) {
    return fail(
      attachmentCheck.error.code,
      attachmentCheck.error.message,
      attachmentCheck.error.detail,
    )
  }

  return ok({
    snapshot: assembled.value,
    manifest: manifest.value,
    entryPaths: entryPaths.sort(comparePaths),
  })
}

/** 非附件 DTO：renderer 只拿到这份，不接触路径或字节。 */
export function toSnapshotDto(
  snapshot: ProjectFileSnapshot,
): Omit<ProjectFileSnapshot, 'attachments'> {
  const { attachments: _attachments, ...rest } = snapshot
  void _attachments
  return rest
}
