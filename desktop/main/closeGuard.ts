import { randomUUID } from 'node:crypto'
import type {
  EditorFlushRequest,
  EditorFlushedPayload,
  IpcErrorPayload,
} from '../shared/contracts'

export interface FlushOutcome {
  ok: boolean
  error?: IpcErrorPayload
}

export interface CloseGuardOptions {
  /** 编辑屏障等待上限；超时不关闭窗口（任务卡 §3：EDITOR_TIMEOUT 不关闭窗口）。 */
  timeoutMs?: number
  newRequestId?: () => string
  /** 由 index.ts 注入，向指定 WebContents 发 editor:flush。 */
  sendFlush: (webContentsId: number, payload: EditorFlushRequest) => void
}

const DEFAULT_FLUSH_TIMEOUT_MS = 3000

/**
 * 退出保护的第一层：关闭前必须完成一次编辑屏障（editor:flush → editor:flushed）。
 *
 * A-01 只负责“不能在 renderer 还没把编辑交给 main 时销毁窗口”这个协议；
 * 未保存修改的“保存/不保存/取消”三选由 A-04 在会话层接入，这里通过
 * `beforeClose` 钩子预留位置，默认放行（当前没有活动项目会话）。
 */
export class CloseGuard {
  private readonly timeoutMs: number
  private readonly newRequestId: () => string
  private readonly sendFlush: CloseGuardOptions['sendFlush']
  private readonly pending = new Map<
    string,
    { webContentsId: number; finish: (outcome: FlushOutcome) => void; timer: NodeJS.Timeout; validate?: (payload: EditorFlushedPayload) => boolean }
  >()
  private readonly closing = new Set<number>()

  constructor(options: CloseGuardOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS
    this.newRequestId = options.newRequestId ?? (() => randomUUID())
    this.sendFlush = options.sendFlush
  }

  /** 防重入：同一窗口同时只允许一次关闭流程。 */
  beginClose(webContentsId: number): boolean {
    if (this.closing.has(webContentsId)) {
      return false
    }
    this.closing.add(webContentsId)
    return true
  }

  endClose(webContentsId: number): void {
    this.closing.delete(webContentsId)
  }

  isClosing(webContentsId: number): boolean {
    return this.closing.has(webContentsId)
  }

  /** 发起编辑屏障并等待 renderer 回复；超时返回 EDITOR_TIMEOUT。 */
  requestSessionFlush(webContentsId: number, sessionFor: (id: number) => { sessionId: string; acceptedSeq: number } | null): Promise<FlushOutcome> {
    const session = sessionFor(webContentsId)
    return this.requestFlush(webContentsId, payload => sessionFor(webContentsId) === session && (session === null
      ? payload.sessionId === undefined && payload.editSeq === undefined
      : payload.sessionId === session.sessionId && payload.editSeq === session.acceptedSeq))
  }

  requestFlush(webContentsId: number, validate?: (payload: EditorFlushedPayload) => boolean): Promise<FlushOutcome> {
    const requestId = this.newRequestId()
    return new Promise<FlushOutcome>((resolve) => {
      const finish = (outcome: FlushOutcome): void => {
        const entry = this.pending.get(requestId)
        if (entry !== undefined) {
          clearTimeout(entry.timer)
          this.pending.delete(requestId)
        }
        resolve(outcome)
      }

      const timer = setTimeout(() => {
        const entry = this.pending.get(requestId)
        if (entry === undefined) {
          return
        }
        this.pending.delete(requestId)
        resolve({
          ok: false,
          error: {
            code: 'EDITOR_TIMEOUT',
            message: '等待编辑内容提交超时，窗口未关闭',
            detail: `requestId=${requestId}`,
          },
        })
      }, this.timeoutMs)
      timer.unref?.()

      this.pending.set(requestId, { webContentsId, finish, timer, validate })

      try {
        this.sendFlush(webContentsId, { requestId })
      } catch (error) {
        finish({
          ok: false,
          error: {
            code: 'INTERNAL',
            message: '无法向渲染进程发送编辑屏障请求',
            detail: error instanceof Error ? error.message : String(error),
          },
        })
      }
    })
  }

  /**
   * 处理 renderer 的 editor:flushed 回复。
   *
   * 只接受“待处理 requestId + 同一 WebContents”；过期或伪造回复返回错误，
   * 不改变关闭流程状态（仍然等待超时或正确回复）。
   */
  acceptFlushed(
    webContentsId: number,
    payload: EditorFlushedPayload,
  ): { ok: true } | { ok: false; error: IpcErrorPayload } {
    const entry = this.pending.get(payload.requestId)
    if (entry === undefined) {
      return {
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: '没有待处理的编辑屏障请求',
          detail: `requestId=${payload.requestId}`,
        },
      }
    }
    if (entry.webContentsId !== webContentsId) {
      return {
        ok: false,
        error: {
          code: 'FORBIDDEN_SENDER',
          message: '编辑屏障回复来自非发起窗口',
        },
      }
    }
    if (payload.failed === true || (entry.validate !== undefined && !entry.validate(payload))) {
      entry.finish({ ok: false, error: { code: 'STALE_EDIT', message: '编辑未提交或屏障会话/序号已失效' } })
      return { ok: false, error: { code: 'STALE_EDIT', message: '编辑屏障失败' } }
    }
    if (payload.editSeq !== undefined) {
      if (!Number.isSafeInteger(payload.editSeq) || payload.editSeq < 0) {
        return {
          ok: false,
          error: {
            code: 'INVALID_REQUEST',
            message: '编辑屏障回复的 editSeq 必须是非负安全整数',
          },
        }
      }
    }
    entry.finish({ ok: true })
    return { ok: true }
  }

  /** 窗口销毁/renderer 失联：只取消该窗口，清理计时器与绑定。 */
  cancelWindow(webContentsId: number): void {
    for (const entry of this.pending.values()) {
      if (entry.webContentsId === webContentsId) entry.finish({ ok: false, error: { code: 'CANCELLED', message: '编辑屏障窗口已失联或取消' } })
    }
    this.closing.delete(webContentsId)
  }

  /** 只用于测试与窗口销毁清理：丢弃所有等待中的请求。 */
  dispose(): void {
    for (const [requestId, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.finish({
        ok: false,
        error: {
          code: 'CANCELLED',
          message: '关闭流程已取消',
          detail: `requestId=${requestId}`,
        },
      })
    }
    this.pending.clear()
    this.closing.clear()
  }
}
