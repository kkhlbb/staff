/**
 * 最近项目索引（A-04，任务卡 §4.3）。
 *
 * 位置固定在 `<userData>/workspace/recent-projects.v1.json`；最多 20 项，
 * 按规范化路径去重（同一 projectId 的不同副本必须都能保留），main 生成
 * recentId。路径失效只标 missing，不自动清理记录，也不静默打开其它文件。
 *
 * 索引损坏时：读取返回 INDEX_READ_FAILED 而不是空列表；下一次写入前先把
 * 损坏文件改名隔离（保留原字节），再写新索引，绝不静默覆盖。
 */
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  IpcResult,
  RecentProjectItem,
  RecentProjectListValue,
} from '../shared/contracts'
import { decodeProjectFile } from '../../src/project-file/codec'
import { nodeWorkspaceOps, readJsonIndex, writeJsonIndex, isolateCorruptIndex, type WorkspaceOps } from './workspaceJson'

export const RECENT_PROJECTS_FILE = 'recent-projects.v1.json'
export const RECENT_PROJECTS_SCHEMA_VERSION = 1
export const RECENT_PROJECTS_LIMIT = 20

export interface RecentProjectRecord {
  recentId: string
  projectId: string
  name: string
  path: string
  lastOpenedAt: string
  fingerprint: string
  /** 最近一次记录时的项目依据种类；旧索引没有该字段。 */
  sourceKind?: 'pdf' | 'user-intent'
}

interface RecentIndexFile {
  schemaVersion: typeof RECENT_PROJECTS_SCHEMA_VERSION
  items: RecentProjectRecord[]
}

export interface RecentProjectsOptions {
  /** `<userData>/workspace`。 */
  rootDir: string
  ops?: WorkspaceOps
  now?: () => Date
  newId?: () => string
}

/** 规范化路径：绝对化、NFC；不解析符号链接（文件可能已不存在）。 */
export function normalizeProjectPath(input: string): string {
  return path.resolve(input).normalize('NFC')
}

function isRecord(value: unknown): value is RecentProjectRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record.recentId === 'string' &&
    record.recentId.length > 0 &&
    record.recentId.length <= 120 &&
    typeof record.projectId === 'string' &&
    record.projectId.length > 0 &&
    record.projectId.length <= 240 &&
    typeof record.name === 'string' &&
    record.name.length > 0 &&
    record.name.length <= 200 &&
    typeof record.path === 'string' &&
    record.path.length > 0 &&
    path.isAbsolute(record.path) &&
    typeof record.lastOpenedAt === 'string' &&
    record.lastOpenedAt.length > 0 &&
    typeof record.fingerprint === 'string' &&
    /^[0-9a-f]{64}$/.test(record.fingerprint) &&
    (record.sourceKind === undefined ||
      record.sourceKind === 'pdf' ||
      record.sourceKind === 'user-intent')
  )
}

function parseIndex(value: unknown):
  | { ok: true; items: RecentProjectRecord[] }
  | { ok: false; detail: string } {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, detail: '索引必须是对象' }
  }
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== RECENT_PROJECTS_SCHEMA_VERSION) {
    return { ok: false, detail: `schemaVersion 不受支持：${String(record.schemaVersion)}` }
  }
  if (!Array.isArray(record.items)) {
    return { ok: false, detail: 'items 必须是数组' }
  }
  if (record.items.length > RECENT_PROJECTS_LIMIT) {
    return { ok: false, detail: `items 超过 ${RECENT_PROJECTS_LIMIT} 项` }
  }
  const items: RecentProjectRecord[] = []
  for (const [index, item] of record.items.entries()) {
    if (!isRecord(item)) {
      return { ok: false, detail: `第 ${index + 1} 项字段不完整或不合法` }
    }
    items.push(item)
  }
  // 同路径只保留最新的一项；去重不影响同 projectId 的不同副本。
  const seen = new Set<string>()
  const deduped: RecentProjectRecord[] = []
  for (const item of items) {
    const key = normalizeProjectPath(item.path)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(item)
  }
  return { ok: true, items: deduped }
}

function failure(
  code: 'INDEX_READ_FAILED' | 'NOT_FOUND' | 'PROJECT_ID_MISMATCH' | 'WRITE_FAILED' | 'INVALID_REQUEST',
  message: string,
  detail?: string,
): IpcResult<never> {
  return detail === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, detail } }
}

export class RecentProjectsStore {
  private readonly rootDir: string
  private readonly ops: WorkspaceOps
  private readonly now: () => Date
  private readonly newId: () => string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(options: RecentProjectsOptions) {
    this.rootDir = options.rootDir
    this.ops = options.ops ?? nodeWorkspaceOps
    this.now = options.now ?? (() => new Date())
    this.newId = options.newId ?? (() => randomUUID())
  }

  get indexPath(): string {
    return path.join(this.rootDir, RECENT_PROJECTS_FILE)
  }

  /** 只读索引；不读取索引以外的任何路径。损坏时明确报错。 */
  async list(): Promise<IpcResult<RecentProjectListValue>> {
    const loaded = await this.load()
    if (!loaded.ok) {
      return loaded
    }
    const items: RecentProjectItem[] = []
    for (const record of loaded.value) {
      const missing = await this.isMissing(record.path)
      // 版本号只从磁盘上当前正式文件读取；路径失效时不尝试猜测。
      const rev = missing ? null : await this.readCurrentRevision(record.path)
      items.push({ ...record, missing, rev })
    }
    return { ok: true, value: { items } }
  }

  /**
   * 读取项目的当前正式版本标识：`project.currentRevisionId` 对应的
   * `fileRevisions[].revisionId`。
   *
   * 走与打开相同的完整容器解码（哈希、引用与数量校验），只认校验通过的文件。
   * 读取失败、不是常规文件、容器损坏或 currentRevisionId 对应不到版本记录时
   * 返回 null：列表不能因为一个坏文件整份失败，也不能拿旧值冒充当前版本。
   */
  private async readCurrentRevision(targetPath: string): Promise<string | null> {
    try {
      if ((await this.ops.statKind(targetPath)) !== 'file') {
        return null
      }
      const bytes = await this.ops.readFile(targetPath)
      const decoded = await decodeProjectFile(bytes)
      if (!decoded.ok) {
        return null
      }
      const currentId = decoded.value.snapshot.project.currentRevisionId
      const revision = decoded.value.snapshot.fileRevisions.find(
        (item) => item.revisionId === currentId,
      )
      return revision?.revisionId ?? null
    } catch {
      return null
    }
  }

  private async isMissing(targetPath: string): Promise<boolean> {
    try {
      return (await this.ops.statKind(targetPath)) !== 'file'
    } catch {
      return true
    }
  }

  /** dirty gate / relink 用：按 recentId 取原始记录（不读文件内容）。 */
  async get(recentId: string): Promise<IpcResult<RecentProjectRecord>> {
    const loaded = await this.load()
    if (!loaded.ok) {
      return loaded
    }
    const record = loaded.value.find((item) => item.recentId === recentId)
    if (record === undefined) {
      return failure('NOT_FOUND', '最近项目记录不存在')
    }
    return { ok: true, value: record }
  }

  /**
   * 记录一次成功打开/保存。索引写失败只返回错误供调用方警告，
   * 不能因此否认正式文件已保存。
   */
  async record(input: {
    projectId: string
    name: string
    path: string
    fingerprint: string
    sourceKind?: 'pdf' | 'user-intent'
  }): Promise<IpcResult<null>> {
    return this.enqueue(async () => {
      const normalizedPath = normalizeProjectPath(input.path)
      const loaded = await this.loadForWrite()
      if (!loaded.ok) {
        return loaded
      }
      const previous = loaded.value.find(
        (item) => normalizeProjectPath(item.path) === normalizedPath,
      )
      const record: RecentProjectRecord = {
        recentId: previous?.recentId ?? this.newId(),
        projectId: input.projectId,
        name: input.name,
        path: normalizedPath,
        lastOpenedAt: this.now().toISOString(),
        fingerprint: input.fingerprint,
        sourceKind: input.sourceKind ?? 'pdf',
      }
      const items = [
        record,
        ...loaded.value.filter(
          (item) => normalizeProjectPath(item.path) !== normalizedPath,
        ),
      ].slice(0, RECENT_PROJECTS_LIMIT)
      const written = await writeJsonIndex(this.ops, this.indexPath, {
        schemaVersion: RECENT_PROJECTS_SCHEMA_VERSION,
        items,
      } satisfies RecentIndexFile)
      if (!written.ok) {
        return failure('WRITE_FAILED', '最近项目索引写入失败', written.detail)
      }
      return { ok: true, value: null }
    })
  }

  /**
   * 只修索引：新路径的实际项目 ID 必须与记录一致。
   * 不打开项目、不切换当前会话，也不覆盖任何项目文件。
   */
  async relink(input: {
    recentId: string
    path: string
    projectId: string
    fingerprint: string
  }): Promise<IpcResult<{ item: RecentProjectItem }>> {
    return this.enqueue(async () => {
      const loaded = await this.loadForWrite()
      if (!loaded.ok) {
        return loaded
      }
      const index = loaded.value.findIndex((item) => item.recentId === input.recentId)
      if (index === -1) {
        return failure('NOT_FOUND', '最近项目记录不存在')
      }
      const existing = loaded.value[index]
      if (existing.projectId !== input.projectId) {
        return failure(
          'PROJECT_ID_MISMATCH',
          '所选文件的项目 ID 与最近项目记录不一致，未修改索引',
          `expected=${existing.projectId}, actual=${input.projectId}`,
        )
      }
      const normalizedPath = normalizeProjectPath(input.path)
      const duplicate = loaded.value.findIndex(
        (item, itemIndex) =>
          itemIndex !== index && normalizeProjectPath(item.path) === normalizedPath,
      )
      if (duplicate !== -1) {
        return failure('INVALID_REQUEST', '该路径已被另一条最近项目记录占用')
      }
      const item: RecentProjectRecord = {
        ...existing,
        path: normalizedPath,
        fingerprint: input.fingerprint,
      }
      const items = loaded.value.slice()
      items[index] = item
      const written = await writeJsonIndex(this.ops, this.indexPath, {
        schemaVersion: RECENT_PROJECTS_SCHEMA_VERSION,
        items,
      } satisfies RecentIndexFile)
      if (!written.ok) {
        return failure('WRITE_FAILED', '最近项目索引写入失败', written.detail)
      }
      return {
        ok: true,
        value: {
          item: {
            ...item,
            missing: false,
            rev: await this.readCurrentRevision(normalizedPath),
          },
        },
      }
    })
  }

  /** 读取索引；损坏时返回错误，不返回空列表。 */
  private async load(): Promise<
    { ok: true; value: RecentProjectRecord[] } | IpcResult<never>
  > {
    const read = await readJsonIndex(this.ops, this.indexPath)
    if (read.state === 'missing') {
      return { ok: true, value: [] }
    }
    if (read.state === 'invalid') {
      return failure('INDEX_READ_FAILED', '最近项目索引损坏，未自动覆盖', read.detail)
    }
    const parsed = parseIndex(read.value)
    if (!parsed.ok) {
      return failure('INDEX_READ_FAILED', '最近项目索引结构不合法，未自动覆盖', parsed.detail)
    }
    return { ok: true, value: parsed.items }
  }

  /** 写前读取：损坏的索引先改名隔离，再由本次写入生成新索引。 */
  private async loadForWrite(): Promise<
    { ok: true; value: RecentProjectRecord[] } | IpcResult<never>
  > {
    const read = await readJsonIndex(this.ops, this.indexPath)
    if (read.state === 'missing') {
      return { ok: true, value: [] }
    }
    if (read.state === 'invalid') {
      await this.isolateNow()
      return { ok: true, value: [] }
    }
    const parsed = parseIndex(read.value)
    if (!parsed.ok) {
      await this.isolateNow()
      return { ok: true, value: [] }
    }
    return { ok: true, value: parsed.items }
  }

  private async isolateNow(): Promise<void> {
    try {
      await isolateCorruptIndex(
        this.ops,
        this.indexPath,
        this.now().toISOString().replace(/[:.]/g, '-'),
      )
    } catch {
      // 隔离失败时仍尝试写新索引；原文件保持不动。
    }
  }

  /** 同一实例内的索引写入串行化，避免并发 record 互相覆盖。 */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task)
    this.queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
}
