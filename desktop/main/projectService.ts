/**
 * 项目文件会话服务（A-02 纯部分）。
 *
 * 只负责：
 * - 打开 `.cunlian`：读取字节 → 完整解码校验 → 建立 main 侧会话（持有附件字节）；
 * - stage：接受 renderer 的编辑序号与聚合副本，序号必须严格递增；
 * - save / saveAs：与序号对齐后用 fileStore 原子保存，成功后更新路径/指纹。
 *
 * 不负责（A-04）：dirty gate 三选、恢复草稿、最近项目、IPC 注册、对话框。
 * 附件字节永远留在 main；返回给 renderer 的是去掉 attachments 的 DTO。
 */
import { randomUUID } from 'node:crypto'
import { decodeProjectFile, encodeProjectFile, toSnapshotDto } from '../../src/project-file/codec'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import type { IpcErrorCode, IpcErrorPayload, IpcResult } from '../shared/contracts'
import { FileStore, type SaveError } from './fileStore'

export type SnapshotDto = ReturnType<typeof toSnapshotDto>

export interface ProjectSession {
  sessionId: string
  /** renderer 已提交的最高编辑序号。 */
  acceptedSeq: number
  /** 已成功落盘的编辑序号；dirty 由 A-04 根据它与 acceptedSeq 判定。 */
  savedSeq: number
  path: string | null
  fingerprint: string | null
  snapshot: ProjectFileSnapshot
}

export interface OpenResult {
  sessionId: string
  editSeq: 0
  snapshot: SnapshotDto
  path: string | null
  fingerprint: string | null
}

export interface SaveValue {
  path: string
  fingerprint: string
  savedSeq: number
  warnings: string[]
}

export interface SaveRequest {
  editSeq: number
  expectedFingerprint: string | null
}

export interface SaveAsRequest extends SaveRequest {
  targetPath: string
  /** 覆盖已存在目标必须给出其当前指纹（A-04 对话框确认后传入）。 */
  overwriteFingerprint?: string | null
}

export interface ProjectServiceOptions {
  store?: FileStore
  newSessionId?: () => string
}

function ipcFailure(code: IpcErrorCode, message: string, detail?: string): IpcResult<never> {
  const error: IpcErrorPayload =
    detail === undefined ? { code, message } : { code, message, detail }
  return { ok: false, error }
}

function fromSaveError(error: SaveError): IpcResult<never> {
  return { ok: false, error: { code: error.code, message: error.message, detail: error.detail } }
}

export class ProjectService {
  private readonly store: FileStore
  private readonly newSessionId: () => string
  private readonly sessions = new Map<string, ProjectSession>()
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(options: ProjectServiceOptions = {}) {
    this.store = options.store ?? new FileStore()
    this.newSessionId = options.newSessionId ?? (() => randomUUID())
  }

  getSession(sessionId: string): ProjectSession | null {
    return this.sessions.get(sessionId) ?? null
  }

  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.queues.delete(sessionId)
  }

  /** dirty gate 用：存在已接受但未成功落盘的编辑即视为有未保存工作。 */
  dirtySessionCount(): number {
    let count = 0
    for (const session of this.sessions.values()) {
      if (session.acceptedSeq > session.savedSeq) {
        count += 1
      }
    }
    return count
  }

  /** 打开并完整校验项目文件；失败不创建会话。 */
  async openFile(targetPath: string): Promise<IpcResult<OpenResult>> {
    const read = await this.store.readProjectFile(targetPath)
    if (!read.ok) {
      return fromSaveError(read.error)
    }
    return this.openBytes(read.value.bytes, targetPath, read.value.fingerprint)
  }

  /** 用已读入的字节建立会话（供测试与后续迁移复用）。 */
  async openBytes(
    bytes: Uint8Array,
    targetPath: string | null,
    fingerprint: string | null,
  ): Promise<IpcResult<OpenResult>> {
    const decoded = await decodeProjectFile(bytes)
    if (!decoded.ok) {
      return ipcFailure(decoded.error.code, decoded.error.message, decoded.error.detail)
    }
    const sessionId = this.newSessionId()
    const session: ProjectSession = {
      sessionId,
      acceptedSeq: 0,
      savedSeq: 0,
      path: null,
      fingerprint: null,
      snapshot: decoded.value.snapshot,
    }
    if (targetPath !== null && fingerprint !== null) {
      session.path = targetPath
      session.fingerprint = fingerprint
    }
    this.sessions.set(sessionId, session)
    return {
      ok: true,
      value: {
        sessionId,
        editSeq: 0,
        snapshot: toSnapshotDto(session.snapshot),
        path: session.path,
        fingerprint: session.fingerprint,
      },
    }
  }

  /**
   * 接受 renderer 的编辑副本。
   *
   * 序号必须严格大于已接受序号；草稿字段可以含无效数值字符串，但结构、引用
   * 与附件元数据必须自洽（允许缺字节声明）。main 这里不做落盘。
   */
  stage(
    sessionId: string,
    editSeq: number,
    snapshot: ProjectFileSnapshot,
  ): IpcResult<{ acceptedSeq: number }> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) {
      return ipcFailure('STALE_SESSION', '会话已失效，请重新打开项目')
    }
    if (!Number.isSafeInteger(editSeq) || editSeq < 0) {
      return ipcFailure('INVALID_REQUEST', 'editSeq 必须是非负安全整数')
    }
    if (editSeq <= session.acceptedSeq) {
      return ipcFailure(
        'STALE_EDIT',
        '编辑序号未递增，已拒绝',
        `acceptedSeq=${session.acceptedSeq}, editSeq=${editSeq}`,
      )
    }
    if (snapshot.project.id !== session.snapshot.project.id) {
      return ipcFailure('INVALID_REQUEST', '提交的聚合属于其它项目')
    }
    session.snapshot = snapshot
    session.acceptedSeq = editSeq
    return { ok: true, value: { acceptedSeq: editSeq } }
  }

  /** 保存到会话已有路径；没有路径时必须走 saveAs。 */
  async save(sessionId: string, request: SaveRequest): Promise<IpcResult<SaveValue>> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) {
      return ipcFailure('STALE_SESSION', '会话已失效，请重新打开项目')
    }
    if (session.path === null) {
      return ipcFailure('INVALID_REQUEST', '当前项目尚未保存过，请使用另存为')
    }
    return this.enqueue(sessionId, async () => {
      const checked = this.checkSaveRequest(session, request, true)
      if (!checked.ok) {
        return checked
      }
      return this.writeSnapshot(session, session.path as string, request, session.fingerprint)
    })
  }

  /** 另存为：目标必须显式给出；覆盖已有文件必须带其当前指纹。 */
  async saveAs(sessionId: string, request: SaveAsRequest): Promise<IpcResult<SaveValue>> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) {
      return ipcFailure('STALE_SESSION', '会话已失效，请重新打开项目')
    }
    return this.enqueue(sessionId, async () => {
      const checked = this.checkSaveRequest(session, request, false)
      if (!checked.ok) {
        return checked
      }
      const existing = await this.store.fingerprint(request.targetPath)
      if (existing !== null && existing !== request.overwriteFingerprint) {
        return ipcFailure(
          'EXTERNAL_MODIFIED',
          '目标文件已存在，需要确认覆盖',
          `targetFingerprint=${existing}`,
        )
      }
      return this.writeSnapshot(
        session,
        request.targetPath,
        request,
        existing,
      )
    })
  }

  private checkSaveRequest(
    session: ProjectSession,
    request: SaveRequest,
    requireSessionFingerprint: boolean,
  ): IpcResult<null> {
    if (!Number.isSafeInteger(request.editSeq) || request.editSeq < 0) {
      return ipcFailure('INVALID_REQUEST', 'editSeq 必须是非负安全整数')
    }
    if (request.editSeq !== session.acceptedSeq) {
      return ipcFailure(
        'STALE_EDIT',
        '保存的编辑序号与已接受序号不一致',
        `acceptedSeq=${session.acceptedSeq}, editSeq=${request.editSeq}`,
      )
    }
    // 另存为写入的是新目标，不要求与当前会话磁盘指纹一致；覆盖确认由
    // saveAs 的目标指纹逻辑负责。
    if (requireSessionFingerprint && request.expectedFingerprint !== session.fingerprint) {
      return ipcFailure(
        'EXTERNAL_MODIFIED',
        '磁盘指纹与打开时不一致，请重新打开或另存为',
        `expected=${request.expectedFingerprint ?? 'null'}, session=${
          session.fingerprint ?? 'null'
        }`,
      )
    }
    return { ok: true, value: null }
  }

  private async writeSnapshot(
    session: ProjectSession,
    targetPath: string,
    request: SaveRequest,
    overwriteFingerprint: string | null,
  ): Promise<IpcResult<SaveValue>> {
    const encoded = await encodeProjectFile(session.snapshot)
    if (!encoded.ok) {
      return ipcFailure(
        encoded.error.code,
        `无法生成合法的项目文件：${encoded.error.message}`,
        encoded.error.detail,
      )
    }

    const saved = await this.store.saveAtomic({
      targetPath,
      bytes: encoded.value.bytes,
      expectedFingerprint: overwriteFingerprint,
      verify: async (bytes) => {
        const decoded = await decodeProjectFile(bytes)
        if (!decoded.ok) {
          return {
            ok: false,
            code: decoded.error.code,
            message: decoded.error.message,
            detail: decoded.error.detail,
          }
        }
        if (decoded.value.snapshot.project.id !== session.snapshot.project.id) {
          return {
            ok: false,
            code: 'INVALID_RECORD',
            message: '自校验读到的项目 ID 与当前会话不一致',
          }
        }
        return { ok: true }
      },
    })
    if (!saved.ok) {
      return fromSaveError(saved.error)
    }

    session.path = saved.value.path
    session.fingerprint = saved.value.fingerprint
    session.savedSeq = request.editSeq
    return {
      ok: true,
      value: {
        path: saved.value.path,
        fingerprint: saved.value.fingerprint,
        savedSeq: request.editSeq,
        warnings: saved.value.warnings,
      },
    }
  }

  /** 同一会话的保存串行化；排队等待不返回 BUSY。 */
  private enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.queues.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }
}
