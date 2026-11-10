/**
 * 恢复草稿存储（A-04，任务卡 §4.3）。
 *
 * 位置固定在 `<userData>/workspace/recovery/<recoveryId>.cunlian`，配套
 * `recovery-index.v1.json`。草稿是完整自包含容器（含附件字节），不是只存
 * 非附件 JSON：不能把丢失附件的记录冒充成可恢复项目。
 *
 * 语义边界：
 * - `stage()` 只在内存接受编辑，并安排 1 秒防抖写入；接受与落盘分开报告；
 * - `flush()` 立即写入并等待真实 rename 完成；切换/关闭前必须调用；
 * - 写失败返回 failed + warning，不谎报 written；
 * - 草稿写入同样走“临时文件 → 完整容器校验 → rename”；索引更新失败时
 *   草稿已在磁盘，但明确警告“重启后可能列不出该草稿”。
 *
 * 不负责：dirty gate、项目会话、IPC、对话框。
 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { decodeProjectFile, encodeProjectFile } from '../../src/project-file/codec'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import type {
  IpcErrorCode,
  IpcResult,
  RecoveryItem,
  RecoveryListValue,
  RecoveryWriteState,
} from '../shared/contracts'
import { sha256Bytes } from './fileStore'
import {
  isolateCorruptIndex,
  nodeWorkspaceOps,
  readJsonIndex,
  writeJsonIndex,
  type WorkspaceOps,
} from './workspaceJson'

export const RECOVERY_DIR = 'recovery'
export const RECOVERY_INDEX_FILE = 'recovery-index.v1.json'
export const RECOVERY_INDEX_SCHEMA_VERSION = 1
export const RECOVERY_DEBOUNCE_MS = 1000
export const RECOVERY_MAX_RECORDS = 50
const RECOVERY_ID_PATTERN = /^[0-9A-Za-z-]{1,120}$/

interface RecoveryIndexEntry {
  recoveryId: string
  projectId: string
  name: string
  basePath: string | null
  baseFingerprint: string | null
  savedAt: string
  editSeq: number
}

interface RecoveryIndexFile {
  schemaVersion: typeof RECOVERY_INDEX_SCHEMA_VERSION
  items: RecoveryIndexEntry[]
}

export interface RecoveryMeta {
  projectId: string
  name: string
  basePath: string | null
  baseFingerprint: string | null
}

export interface RecoveryWriteOutcome {
  state: RecoveryWriteState
  warning?: string
}

export interface RecoveryOptions {
  /** `<userData>/workspace`。 */
  rootDir: string
  ops?: WorkspaceOps
  debounceMs?: number
  now?: () => Date
  newId?: () => string
}

interface SessionState {
  recoveryId: string
  meta: RecoveryMeta
  pending: { snapshot: ProjectFileSnapshot; editSeq: number } | null
  timer: NodeJS.Timeout | null
  lastWrittenSeq: number
  lastDigest: string | null
  lastState: RecoveryWriteState
  lastWarning?: string
  writing: Promise<RecoveryWriteOutcome> | null
}

function fail<T>(
  code: IpcErrorCode,
  message: string,
  detail?: string,
): IpcResult<T> {
  return detail === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, detail } }
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function parseIndex(value: unknown):
  | { ok: true; items: RecoveryIndexEntry[] }
  | { ok: false; detail: string } {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, detail: '索引必须是对象' }
  }
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== RECOVERY_INDEX_SCHEMA_VERSION) {
    return { ok: false, detail: `schemaVersion 不受支持：${String(record.schemaVersion)}` }
  }
  if (!Array.isArray(record.items)) {
    return { ok: false, detail: 'items 必须是数组' }
  }
  if (record.items.length > RECOVERY_MAX_RECORDS) {
    return { ok: false, detail: `items 超过 ${RECOVERY_MAX_RECORDS} 项` }
  }
  const items: RecoveryIndexEntry[] = []
  for (const [index, item] of record.items.entries()) {
    if (typeof item !== 'object' || item === null) {
      return { ok: false, detail: `第 ${index + 1} 项不是对象` }
    }
    const entry = item as Record<string, unknown>
    if (
      typeof entry.recoveryId !== 'string' ||
      !RECOVERY_ID_PATTERN.test(entry.recoveryId) ||
      typeof entry.projectId !== 'string' ||
      entry.projectId.length === 0 ||
      typeof entry.name !== 'string' ||
      entry.name.length === 0 ||
      (entry.basePath !== null && typeof entry.basePath !== 'string') ||
      (entry.baseFingerprint !== null && !isSha256(entry.baseFingerprint)) ||
      typeof entry.savedAt !== 'string' ||
      entry.savedAt.length === 0 ||
      typeof entry.editSeq !== 'number' ||
      !Number.isSafeInteger(entry.editSeq) ||
      entry.editSeq < 0
    ) {
      return { ok: false, detail: `第 ${index + 1} 项字段不完整或不合法` }
    }
    items.push(entry as unknown as RecoveryIndexEntry)
  }
  return { ok: true, items }
}

export class RecoveryStore {
  private readonly rootDir: string
  private readonly ops: WorkspaceOps
  private readonly debounceMs: number
  private readonly now: () => Date
  private readonly newId: () => string
  private readonly sessions = new Map<string, SessionState>()
  private indexQueue: Promise<unknown> = Promise.resolve()

  constructor(options: RecoveryOptions) {
    this.rootDir = options.rootDir
    this.ops = options.ops ?? nodeWorkspaceOps
    this.debounceMs = options.debounceMs ?? RECOVERY_DEBOUNCE_MS
    this.now = options.now ?? (() => new Date())
    this.newId = options.newId ?? (() => randomUUID())
  }

  get directory(): string {
    return path.join(this.rootDir, RECOVERY_DIR)
  }

  get indexPath(): string {
    return path.join(this.rootDir, RECOVERY_INDEX_FILE)
  }

  draftPath(recoveryId: string): string {
    if (!RECOVERY_ID_PATTERN.test(recoveryId)) {
      throw new Error('恢复草稿 ID 不合法')
    }
    return path.join(this.directory, `${recoveryId}.cunlian`)
  }

  /**
   * 内存接受一次编辑并安排防抖写入。
   * 返回 pending（尚未落盘）、unchanged（磁盘内容已相同）或 failed（上次写失败仍在重试）。
   */
  async stage(
    sessionId: string,
    snapshot: ProjectFileSnapshot,
    editSeq: number,
    meta: RecoveryMeta,
  ): Promise<RecoveryWriteOutcome> {
    const state = await this.stateFor(sessionId, meta)
    if (state.writing !== null) {
      // 正在进行上一次写入：把新快照排在后面，由后续防抖/flush 继续。
      state.pending = { snapshot, editSeq }
      state.lastState = 'pending'
      this.schedule(sessionId, state)
      return { state: 'pending' }
    }
    const digest = await this.digestOf(snapshot)
    if (digest === state.lastDigest) {
      state.lastState = 'unchanged'
      state.lastWarning = undefined
      return { state: 'unchanged' }
    }
    state.pending = { snapshot, editSeq }
    state.lastState = 'pending'
    state.lastWarning = undefined
    this.schedule(sessionId, state)
    return { state: 'pending' }
  }

  /** 立即写入当前待处理快照；用于切换、关闭与显式 flush。 */
  async flush(sessionId: string): Promise<RecoveryWriteOutcome> {
    const state = this.sessions.get(sessionId)
    if (state === undefined) {
      return { state: 'unchanged' }
    }
    // 显式 flush 取消尚未触发的防抖定时器，避免同一快照被并发写两次。
    if (state.timer !== null) {
      clearTimeout(state.timer)
      state.timer = null
    }
    if (state.writing !== null) {
      // 等待进行中的写入，然后针对最新 pending 再写一次。
      await state.writing
    }
    while (state.pending !== null) {
      const outcome = await this.writeLatest(state)
      if (outcome.state === 'failed') {
        return outcome
      }
    }
    return state.lastState === 'failed'
      ? { state: 'failed', warning: state.lastWarning }
      : { state: state.lastState, warning: state.lastWarning }
  }

  /** 读回 stage 之后是否还有未落盘编辑（供关闭前 dt 诊断）。 */
  hasPending(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.pending !== null
  }

  /**
   * 只读当前跟踪的草稿状态，供 session:reattach 报告；不触发写入、不改变
   * pending 或定时器。main 未跟踪该会话时返回 `none`。
   */
  stateOf(sessionId: string): RecoveryWriteState | 'none' {
    return this.sessions.get(sessionId)?.lastState ?? 'none'
  }

  /** 草稿被正式保存或用户明确放弃后清理；清理失败不否认主操作。 */
  async discard(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId)
    if (state === undefined) {
      return
    }
    if (state.timer !== null) {
      clearTimeout(state.timer)
      state.timer = null
    }
    state.pending = null
    this.sessions.delete(sessionId)
    await this.removeIndexEntry(state.recoveryId)
    try {
      await this.ops.remove(this.draftPath(state.recoveryId))
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) {
        // 草稿删除失败不影响正式文件；调用方已经完成保存或用户已放弃。
      }
    }
  }

  /** 固定目录内的草稿列表；损坏草稿带 error，不当作空项目。 */
  async list(): Promise<IpcResult<RecoveryListValue>> {
    const loaded = await this.loadIndex()
    if (!loaded.ok) {
      return loaded
    }
    const items: RecoveryItem[] = []
    for (const entry of loaded.value) {
      const base: RecoveryItem = { ...entry }
      const kind = await this.ops.statKind(this.draftPath(entry.recoveryId))
      if (kind === 'missing') {
        items.push({ ...base, error: '草稿文件不存在' })
        continue
      }
      if (kind !== 'file') {
        items.push({ ...base, error: '草稿不是常规文件' })
        continue
      }
      const read = await this.readDraft(entry.recoveryId)
      if (!read.ok) {
        items.push({ ...base, error: `${read.error.code}: ${read.error.message}` })
        continue
      }
      items.push(base)
    }
    return { ok: true, value: { items } }
  }

  /** 读取并完整校验一个草稿；返回原始字节供 openBytes 复用。 */
  async readDraft(recoveryId: string): Promise<
    IpcResult<{ entry: RecoveryIndexEntry; bytes: Uint8Array; snapshot: ProjectFileSnapshot }>
  > {
    const loaded = await this.loadIndex()
    if (!loaded.ok) {
      return loaded
    }
    const entry = loaded.value.find((item) => item.recoveryId === recoveryId)
    if (entry === undefined) {
      return fail('NOT_FOUND', '恢复草稿记录不存在')
    }
    const draftPath = this.draftPath(recoveryId)
    const kind = await this.ops.statKind(draftPath)
    if (kind !== 'file') {
      return fail('NOT_FOUND', '恢复草稿文件不可用', kind)
    }
    let bytes: Uint8Array
    try {
      bytes = await this.ops.readFile(draftPath)
    } catch (error) {
      return fail('RECOVERY_READ_FAILED', '读取恢复草稿失败', errnoOf(error))
    }
    const decoded = await decodeProjectFile(bytes)
    if (!decoded.ok) {
      return fail(decoded.error.code, decoded.error.message, decoded.error.detail)
    }
    return {
      ok: true,
      value: { entry, bytes, snapshot: decoded.value.snapshot },
    }
  }

  /** 关闭恢复流程后（用户已导入为副本）可显式移除；不在恢复时自动删除。 */
  async remove(recoveryId: string): Promise<IpcResult<null>> {
    if (!RECOVERY_ID_PATTERN.test(recoveryId)) {
      return fail('INVALID_REQUEST', '恢复草稿 ID 不合法')
    }
    for (const [sessionId, state] of this.sessions) {
      if (state.recoveryId === recoveryId) {
        await this.discard(sessionId)
        return { ok: true, value: null }
      }
    }
    const removed = await this.removeIndexEntry(recoveryId)
    if (!removed.ok) {
      return removed
    }
    try {
      await this.ops.remove(this.draftPath(recoveryId))
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) {
        return fail('WRITE_FAILED', '删除恢复草稿失败', errnoOf(error))
      }
    }
    return { ok: true, value: null }
  }

  private async stateFor(sessionId: string, meta: RecoveryMeta): Promise<SessionState> {
    const existing = this.sessions.get(sessionId)
    if (existing !== undefined) {
      return existing
    }
    const recoveryId = await this.recoveryIdFor(meta)
    const state: SessionState = {
      recoveryId,
      meta,
      pending: null,
      timer: null,
      lastWrittenSeq: 0,
      lastDigest: null,
      lastState: 'unchanged',
      writing: null,
    }
    this.sessions.set(sessionId, state)
    return state
  }

  /** 同一项目 + 同一基准路径复用一条草稿，避免每次打开都堆新文件。 */
  private async recoveryIdFor(meta: RecoveryMeta): Promise<string> {
    const loaded = await this.loadIndex()
    if (loaded.ok) {
      const match = loaded.value.find(
        (entry) =>
          entry.projectId === meta.projectId &&
          normalizeBasePath(entry.basePath) === normalizeBasePath(meta.basePath),
      )
      if (match !== undefined) {
        return match.recoveryId
      }
    }
    return this.newId()
  }

  private schedule(sessionId: string, state: SessionState): void {
    if (state.timer !== null) {
      clearTimeout(state.timer)
    }
    const timer = setTimeout(() => {
      state.timer = null
      void this.flush(sessionId)
    }, this.debounceMs)
    timer.unref?.()
    state.timer = timer
  }

  private async writeLatest(state: SessionState): Promise<RecoveryWriteOutcome> {
    if (state.writing !== null) {
      return state.writing
    }
    const next = state.pending
    if (next === null) {
      return { state: state.lastState, warning: state.lastWarning }
    }
    state.pending = null
    const writing = this.writeDraft(state, next.snapshot, next.editSeq).finally(() => {
      state.writing = null
    })
    state.writing = writing
    const outcome = await writing
    if (outcome.state === 'failed') {
      // 保留最新快照供下一次 flush 重试；不要静默丢弃内存编辑。
      if (state.pending === null) {
        state.pending = next
      }
    }
    state.lastState = outcome.state
    state.lastWarning = outcome.warning
    return outcome
  }

  private async writeDraft(
    state: SessionState,
    snapshot: ProjectFileSnapshot,
    editSeq: number,
  ): Promise<RecoveryWriteOutcome> {
    const encoded = await encodeProjectFile(snapshot)
    if (!encoded.ok) {
      return {
        state: 'failed',
        warning: `恢复草稿无法生成合法容器：${encoded.error.code} ${encoded.error.message}`,
      }
    }
    const draftPath = this.draftPath(state.recoveryId)
    try {
      await this.ops.ensureDirectory(this.directory)
    } catch (error) {
      return { state: 'failed', warning: `无法创建恢复目录：${errnoOf(error)}` }
    }
    const tempPath = `${draftPath}.${this.newId()}.tmp`
    let tempWritten = false
    try {
      try {
        await this.ops.writeExclusive(tempPath, encoded.value.bytes)
        tempWritten = true
      } catch (error) {
        return { state: 'failed', warning: `恢复草稿写入失败：${errnoOf(error)}` }
      }
      try {
        const back = await this.ops.readFile(tempPath)
        if ((await sha256Bytes(back)) !== (await sha256Bytes(encoded.value.bytes))) {
          return { state: 'failed', warning: '恢复草稿回读哈希与写入内容不一致' }
        }
        const decoded = await decodeProjectFile(back)
        if (!decoded.ok) {
          return {
            state: 'failed',
            warning: `恢复草稿自校验失败：${decoded.error.code} ${decoded.error.message}`,
          }
        }
      } catch (error) {
        return { state: 'failed', warning: `恢复草稿回读校验失败：${errnoOf(error)}` }
      }
      try {
        await this.ops.rename(tempPath, draftPath)
        tempWritten = false
      } catch (error) {
        return { state: 'failed', warning: `恢复草稿替换失败：${errnoOf(error)}` }
      }
      try {
        await this.ops.syncDirectory(this.directory)
      } catch {
        // 目录同步失败只影响耐久性；草稿内容已提交。
      }
    } finally {
      if (tempWritten) {
        try {
          await this.ops.remove(tempPath)
        } catch {
          // 清理失败由随机临时名避免冲突。
        }
      }
    }

    state.lastWrittenSeq = editSeq
    state.lastDigest = await this.digestOf(snapshot)
    const indexed = await this.upsertIndex({
      recoveryId: state.recoveryId,
      projectId: state.meta.projectId,
      name: state.meta.name,
      basePath: state.meta.basePath,
      baseFingerprint: state.meta.baseFingerprint,
      savedAt: this.now().toISOString(),
      editSeq,
    })
    if (!indexed.ok) {
      return {
        state: 'written',
        warning: `草稿已写入磁盘，但恢复索引更新失败：${indexed.error.message}（重启后可能列不出该草稿）`,
      }
    }
    return { state: 'written' }
  }

  private async loadIndex(): Promise<
    { ok: true; value: RecoveryIndexEntry[] } | IpcResult<never>
  > {
    const read = await readJsonIndex(this.ops, this.indexPath)
    if (read.state === 'missing') {
      return { ok: true, value: [] }
    }
    if (read.state === 'invalid') {
      return fail('RECOVERY_READ_FAILED', '恢复索引损坏，未自动覆盖', read.detail)
    }
    const parsed = parseIndex(read.value)
    if (!parsed.ok) {
      return fail('RECOVERY_READ_FAILED', '恢复索引结构不合法，未自动覆盖', parsed.detail)
    }
    return { ok: true, value: parsed.items }
  }

  /** 写前忽略损坏索引并隔离，避免后续草稿完全无法登记。 */
  private async loadIndexForWrite(): Promise<
    { ok: true; value: RecoveryIndexEntry[] } | IpcResult<never>
  > {
    const read = await readJsonIndex(this.ops, this.indexPath)
    if (read.state === 'missing') {
      return { ok: true, value: [] }
    }
    if (read.state === 'invalid') {
      await this.isolateIndex()
      return { ok: true, value: [] }
    }
    const parsed = parseIndex(read.value)
    if (!parsed.ok) {
      await this.isolateIndex()
      return { ok: true, value: [] }
    }
    return { ok: true, value: parsed.items }
  }

  private async isolateIndex(): Promise<void> {
    try {
      await isolateCorruptIndex(
        this.ops,
        this.indexPath,
        this.now().toISOString().replace(/[:.]/g, '-'),
      )
    } catch {
      // 隔离失败时仍尝试写新索引。
    }
  }

  private async upsertIndex(entry: RecoveryIndexEntry): Promise<IpcResult<null>> {
    return this.enqueueIndex(async () => {
      const loaded = await this.loadIndexForWrite()
      if (!loaded.ok) {
        return loaded
      }
      const items = [
        entry,
        ...loaded.value.filter((item) => item.recoveryId !== entry.recoveryId),
      ].slice(0, RECOVERY_MAX_RECORDS)
      const written = await writeJsonIndex(this.ops, this.indexPath, {
        schemaVersion: RECOVERY_INDEX_SCHEMA_VERSION,
        items,
      } satisfies RecoveryIndexFile)
      if (!written.ok) {
        return fail('WRITE_FAILED', '恢复索引写入失败', written.detail)
      }
      return { ok: true, value: null }
    })
  }

  private async removeIndexEntry(recoveryId: string): Promise<IpcResult<null>> {
    return this.enqueueIndex(async () => {
      const loaded = await this.loadIndex()
      if (!loaded.ok) {
        return loaded
      }
      const items = loaded.value.filter((item) => item.recoveryId !== recoveryId)
      const written = await writeJsonIndex(this.ops, this.indexPath, {
        schemaVersion: RECOVERY_INDEX_SCHEMA_VERSION,
        items,
      } satisfies RecoveryIndexFile)
      if (!written.ok) {
        return fail('WRITE_FAILED', '恢复索引写入失败', written.detail)
      }
      return { ok: true, value: null }
    })
  }

  private enqueueIndex<T>(task: () => Promise<T>): Promise<T> {
    const next = this.indexQueue.then(task, task)
    this.indexQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async digestOf(snapshot: ProjectFileSnapshot): Promise<string> {
    // 附件字节在一次会话内不会经 renderer 改变；只对非附件部分做内容判等，
    // 避免把上百 MB 的 Uint8Array 序列化成字符串。
    const { attachments: _attachments, ...rest } = snapshot
    void _attachments
    return sha256Bytes(new TextEncoder().encode(JSON.stringify(rest)))
  }

  /** 测试与诊断：当前跟踪的草稿数量。 */
  activeSessionCount(): number {
    return this.sessions.size
  }
}

function normalizeBasePath(input: string | null): string {
  return input === null ? '' : path.resolve(input).normalize('NFC')
}

function errnoOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') {
      return code
    }
  }
  return error instanceof Error ? error.message : String(error)
}

function isErrno(error: unknown, code: string): boolean {
  return errnoOf(error) === code
}
