/**
 * V4.0 阶段 3：一次性用户授权记录（§6、§10）。
 *
 * 边界：
 * - 只由主进程在“界面确认保存”动作里签发；模型参数里没有、也不接受任何
 *   `approved` / `token` 字段。
 * - 记录只存应用工作区 `workspace/approvals/`，绝不写入 `.cunlian` 项目文件。
 * - 消费策略：**校验与重算全部通过后、原子提交之前**落库 `consumedAt`（见 README
 *   “令牌策略”）。这样即使提交写入失败，同一授权也不能被重放；项目写入自身仍是
 *   原子 rename，失败不会半提交。
 * - 并发双击：`reserve` 在第一次 await 之前就占用内存 claim，第二个调用立即失败；
 *   所以同一 approvalId 最多走到一次提交。
 */
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ApprovalRecord, ToolErrorCode } from '../shared/contracts'
import { readJsonIndex, writeJsonIndex, nodeWorkspaceOps, type WorkspaceOps } from './workspaceJson'

export const APPROVAL_TTL_MS = 10 * 60 * 1000

export interface ApprovalFailure {
  ok: false
  code: ToolErrorCode
  message: string
  causeCode?: string
}

export type ApprovalLookup = { ok: true; record: ApprovalRecord } | ApprovalFailure

export interface ApprovalStoreDeps {
  rootDir: string
  ops?: WorkspaceOps
  now?: () => number
  newId?: () => string
  ttlMs?: number
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

function isRecord(value: unknown): value is ApprovalRecord {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.approvalId === 'string' && record.approvalId.length > 0 &&
    Number.isSafeInteger(record.windowId) &&
    typeof record.projectId === 'string' &&
    typeof record.draftId === 'string' &&
    Number.isSafeInteger(record.draftRevision) &&
    (record.requirementRevisionId === null || typeof record.requirementRevisionId === 'string') &&
    typeof record.previewFingerprint === 'string' && record.previewFingerprint.length > 0 &&
    typeof record.baseRevisionId === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.expiresAt === 'string' &&
    (record.consumedAt === null || typeof record.consumedAt === 'string')
  )
}

export class ApprovalStore {
  private readonly rootDir: string
  private readonly ops: WorkspaceOps
  private readonly nowMs: () => number
  private readonly newId: () => string
  private readonly ttlMs: number
  /** 本次进程内已读取/签发的记录；消费状态以它为准，写盘后再回填。 */
  private readonly cache = new Map<string, ApprovalRecord>()
  /** 已在处理中的 approvalId：在第一个 await 之前占用，防止并发双提交。 */
  private readonly claims = new Set<string>()

  constructor(deps: ApprovalStoreDeps) {
    this.rootDir = deps.rootDir
    this.ops = deps.ops ?? nodeWorkspaceOps
    this.nowMs = deps.now ?? (() => Date.now())
    this.newId = deps.newId ?? randomUUID
    this.ttlMs = deps.ttlMs ?? APPROVAL_TTL_MS
  }

  directory(): string {
    return path.join(this.rootDir, 'approvals')
  }

  filePath(approvalId: string): string {
    return path.join(this.directory(), `${sha256(approvalId)}.json`)
  }

  private iso(ms = this.nowMs()): string {
    return new Date(ms).toISOString()
  }

  /** 主进程签发；调用点必须是界面确认动作的 IPC handler。 */
  async issue(input: {
    windowId: number
    projectId: string
    draftId: string
    draftRevision: number
    requirementRevisionId: string | null
    previewFingerprint: string
    baseRevisionId: string
    userAttestationAcknowledged?: boolean
  }): Promise<ApprovalLookup> {
    const createdAtMs = this.nowMs()
    const record: ApprovalRecord = {
      approvalId: this.newId(),
      windowId: input.windowId,
      projectId: input.projectId,
      draftId: input.draftId,
      draftRevision: input.draftRevision,
      requirementRevisionId: input.requirementRevisionId,
      previewFingerprint: input.previewFingerprint,
      baseRevisionId: input.baseRevisionId,
      userAttestationAcknowledged: input.userAttestationAcknowledged === true,
      createdAt: this.iso(createdAtMs),
      expiresAt: this.iso(createdAtMs + this.ttlMs),
      consumedAt: null,
    }
    const written = await writeJsonIndex(this.ops, this.filePath(record.approvalId), { schemaVersion: 1, record })
    if (!written.ok) {
      return { ok: false, code: 'SAVE_FAILED', message: '授权记录未保存，不能提交', causeCode: 'APPROVAL_WRITE_FAILED' }
    }
    this.cache.set(record.approvalId, record)
    return { ok: true, record }
  }

  private async load(approvalId: string): Promise<ApprovalLookup> {
    const read = await readJsonIndex(this.ops, this.filePath(approvalId))
    if (read.state !== 'ok') {
      return { ok: false, code: 'INVALID_INPUT', message: '授权不存在或记录损坏', causeCode: 'UNKNOWN_APPROVAL' }
    }
    const payload = read.value as { schemaVersion?: unknown; record?: unknown }
    if (payload.schemaVersion !== 1 || !isRecord(payload.record) || payload.record.approvalId !== approvalId) {
      return { ok: false, code: 'INVALID_INPUT', message: '授权记录身份不符', causeCode: 'INVALID_APPROVAL' }
    }
    this.cache.set(approvalId, payload.record)
    return { ok: true, record: payload.record }
  }

  /**
   * 占用一次授权。同步占用 claim，后续任何失败都释放；成功返回记录。
   * 错误码口径：不存在/已消费/并发重复 → INVALID_INPUT；过期/窗口不符 → NOT_CONFIRMED。
   */
  async reserve(approvalId: string, windowId: number): Promise<ApprovalLookup> {
    const cached = this.cache.get(approvalId)
    if (cached !== undefined && cached.consumedAt !== null) {
      return { ok: false, code: 'INVALID_INPUT', message: '授权已使用，不能重复提交', causeCode: 'APPROVAL_CONSUMED' }
    }
    if (this.claims.has(approvalId)) {
      return { ok: false, code: 'INVALID_INPUT', message: '授权正在使用中，不能重复提交', causeCode: 'APPROVAL_IN_USE' }
    }
    this.claims.add(approvalId)
    let loaded: ApprovalLookup
    try {
      loaded = cached === undefined ? await this.load(approvalId) : { ok: true, record: cached }
    } catch {
      this.claims.delete(approvalId)
      return { ok: false, code: 'INVALID_INPUT', message: '授权记录无法读取', causeCode: 'UNKNOWN_APPROVAL' }
    }
    if (!loaded.ok) {
      this.claims.delete(approvalId)
      return loaded
    }
    const record = loaded.record
    if (record.consumedAt !== null) {
      this.claims.delete(approvalId)
      return { ok: false, code: 'INVALID_INPUT', message: '授权已使用，不能重复提交', causeCode: 'APPROVAL_CONSUMED' }
    }
    if (record.windowId !== windowId) {
      this.claims.delete(approvalId)
      return { ok: false, code: 'NOT_CONFIRMED', message: '授权不属于当前窗口', causeCode: 'WINDOW_MISMATCH' }
    }
    const expires = Date.parse(record.expiresAt)
    if (!Number.isFinite(expires) || expires <= this.nowMs()) {
      this.claims.delete(approvalId)
      return { ok: false, code: 'NOT_CONFIRMED', message: '授权已过期，请重新预览并确认', causeCode: 'APPROVAL_EXPIRED' }
    }
    return { ok: true, record }
  }

  /** 释放占用（校验或写盘失败、且没有提交时）。 */
  release(approvalId: string): void {
    this.claims.delete(approvalId)
  }

  /**
   * 消费授权：先持久化 consumedAt，再返回。写盘失败则本次失败，调用方不得提交。
   * 一次性只由 reserve 判定（claims + consumedAt）；这里不重复拒绝，便于
   * 审计时看到最后一次消费时间，也避免出现“已提交但消费记录没更新”的半态。
   */
  async consume(approvalId: string): Promise<{ ok: true; record: ApprovalRecord } | ApprovalFailure> {
    const record = this.cache.get(approvalId)
    if (record === undefined) {
      this.claims.delete(approvalId)
      return { ok: false, code: 'INVALID_INPUT', message: '授权记录不在当前进程内', causeCode: 'UNKNOWN_APPROVAL' }
    }
    const consumed: ApprovalRecord = { ...record, consumedAt: this.iso() }
    const written = await writeJsonIndex(this.ops, this.filePath(approvalId), { schemaVersion: 1, record: consumed })
    if (!written.ok) {
      this.claims.delete(approvalId)
      return { ok: false, code: 'SAVE_FAILED', message: '授权消费未落库，提交已取消', causeCode: 'APPROVAL_WRITE_FAILED' }
    }
    this.cache.set(approvalId, consumed)
    // 已消费记录由 cache 的 consumedAt 继续拦截；释放 claim，避免长会话内存累积。
    this.claims.delete(approvalId)
    return { ok: true, record: consumed }
  }

  /** 只读查询，供测试/审计；不返回给模型。 */
  peek(approvalId: string): ApprovalRecord | null {
    const record = this.cache.get(approvalId)
    return record === undefined ? null : structuredClone(record)
  }
}
