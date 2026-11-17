import type { IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import type { IpcErrorCode, IpcResult } from '../shared/contracts'
import type { SenderGuard, SenderInfo } from './senderGuard'

/**
 * IPC 安装器。
 *
 * 所有通道走同一层：sender 白名单 → 参数 schema → handler → 统一结果包络。
 * 未注册的 channel 不会被 `ipcMain.handle` 注册，Electron 会以 reject 回应，
 * 不写“永远成功的导出 stub”。
 */
export interface IpcMainLike {
  handle: (
    channel: string,
    listener: (
      event: IpcMainInvokeEvent,
      ...args: unknown[]
    ) => Promise<IpcResult<unknown>>,
  ) => void
  on: (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => void,
  ) => void
}

export interface IpcDeps {
  sessionTransactions?: { transaction<T>(key: string, task: () => Promise<T>): Promise<T> }
  guard: SenderGuard
  /** 记录阶段/码/匿名信息；不记录业务内容、堆栈或 PDF 字节。 */
  log?: (entry: { channel: string; code: IpcErrorCode; detail?: string }) => void
}

export interface ChannelSpec<P, T> {
  channel: string
  schema: z.ZodType<P>
  handle: (context: { sender: SenderInfo }, params: P) => Promise<T>
}

export interface SenderEventSpec<P> {
  channel: string
  schema: z.ZodType<P>
  handle: (context: { sender: SenderInfo }, params: P) => void
}

/** handler 主动抛出的业务错误；只有它能带出具体 code 与可展示 detail。 */
export class IpcFailure extends Error {
  readonly code: IpcErrorCode
  readonly detail?: string

  constructor(code: IpcErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'IpcFailure'
    this.code = code
    this.detail = detail
  }
}

/** 从 Electron 事件提取安全校验所需字段；senderFrame 为 null 时按不可信处理。 */
export function toSenderInfo(event: IpcMainInvokeEvent): SenderInfo {
  const sender = event.sender
  const frame = event.senderFrame
  return {
    webContentsId: sender.id,
    frameUrl: frame === null || frame === undefined ? null : frame.url,
    isMainFrame: frame !== null && frame !== undefined && frame === sender.mainFrame,
  }
}

function failure(
  code: IpcErrorCode,
  message: string,
  detail?: string,
): IpcResult<never> {
  return detail === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, detail } }
}

function describeIssues(error: z.ZodError): string {
  const first = error.issues[0]
  if (first === undefined) {
    return '参数结构不匹配'
  }
  const path = first.path.length === 0 ? '<root>' : first.path.join('.')
  return `${path}: ${first.message}`
}

export function installChannel<P, T>(
  ipc: IpcMainLike,
  spec: ChannelSpec<P, T>,
  deps: IpcDeps,
): void {
  ipc.handle(spec.channel, async (event, ...args) => {
    const sender = toSenderInfo(event)
    const verdict = deps.guard.verify(sender)
    if (!verdict.ok) {
      deps.log?.({ channel: spec.channel, code: verdict.error.code, detail: verdict.error.detail })
      return { ok: false, error: verdict.error }
    }

    const parsed = spec.schema.safeParse(args[0] ?? {})
    if (!parsed.success) {
      deps.log?.({ channel: spec.channel, code: 'INVALID_REQUEST', detail: describeIssues(parsed.error) })
      return failure(
        'INVALID_REQUEST',
        'IPC 参数校验未通过',
        describeIssues(parsed.error),
      )
    }

    try {
      const params = parsed.data as { sessionId?: unknown }
      const task = () => spec.handle({ sender }, parsed.data)
      const value = await (deps.sessionTransactions !== undefined && typeof params?.sessionId === 'string'
        ? deps.sessionTransactions.transaction(params.sessionId, task) : task())
      return { ok: true, value }
    } catch (error) {
      if (error instanceof IpcFailure) {
        deps.log?.({ channel: spec.channel, code: error.code, detail: error.detail })
        return failure(error.code, error.message, error.detail)
      }
      // 未知异常只回兜底码，堆栈与底层信息留在主进程日志。
      deps.log?.({
        channel: spec.channel,
        code: 'INTERNAL',
        detail: error instanceof Error ? error.message : String(error),
      })
      return failure('INTERNAL', '主进程处理请求失败')
    }
  })
}

/** 主 → 渲染之外的渲染 → 主单向消息（编辑屏障回复等），同样先校验 sender。 */
export function installSenderChannel<P>(
  ipc: IpcMainLike,
  spec: SenderEventSpec<P>,
  deps: IpcDeps,
): void {
  ipc.on(spec.channel, (event, ...args) => {
    const sender = toSenderInfo(event)
    const verdict = deps.guard.verify(sender)
    if (!verdict.ok) {
      deps.log?.({ channel: spec.channel, code: verdict.error.code, detail: verdict.error.detail })
      return
    }
    const parsed = spec.schema.safeParse(args[0] ?? {})
    if (!parsed.success) {
      deps.log?.({ channel: spec.channel, code: 'INVALID_REQUEST', detail: describeIssues(parsed.error) })
      return
    }
    try {
      spec.handle({ sender }, parsed.data)
    } catch (error) {
      deps.log?.({
        channel: spec.channel,
        code: error instanceof IpcFailure ? error.code : 'INTERNAL',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  })
}
