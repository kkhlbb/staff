import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { IpcResult } from '../shared/contracts'
import {
  IpcFailure,
  installChannel,
  installSenderChannel,
  type IpcMainLike,
} from '../main/ipc'
import { SenderGuard } from '../main/senderGuard'

const PROD_URL =
  'file:///Applications/%E5%AF%B8%E9%93%BE.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.desktop.html'

type Handler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => Promise<IpcResult<unknown>>

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => void

class FakeIpc implements IpcMainLike {
  readonly handlers = new Map<string, Handler>()
  readonly listeners = new Map<string, Listener>()

  handle(channel: string, listener: Handler): void {
    this.handlers.set(channel, listener)
  }

  on(channel: string, listener: Listener): void {
    this.listeners.set(channel, listener)
  }

  async invoke(channel: string, event: IpcMainInvokeEvent, params?: unknown): Promise<IpcResult<unknown>> {
    const handler = this.handlers.get(channel)
    if (handler === undefined) {
      // 与 Electron 行为一致：未注册 handle 的 channel 直接 reject。
      throw new Error(`No handler registered for '${channel}'`)
    }
    return handler(event, params)
  }

  emit(channel: string, event: IpcMainInvokeEvent, params?: unknown): void {
    const listener = this.listeners.get(channel)
    if (listener === undefined) {
      throw new Error(`No listener registered for '${channel}'`)
    }
    listener(event, params)
  }
}

function makeEvent(options: {
  webContentsId: number
  url?: string
  subFrame?: boolean
}): IpcMainInvokeEvent {
  const mainFrame = { url: options.url ?? PROD_URL }
  const senderFrame = options.subFrame
    ? { url: options.url ?? PROD_URL }
    : mainFrame
  return {
    sender: { id: options.webContentsId, mainFrame },
    senderFrame,
  } as unknown as IpcMainInvokeEvent
}

function makeGuard(): SenderGuard {
  const guard = new SenderGuard()
  guard.register({
    webContentsId: 1,
    isDestroyed: () => false,
    isAllowedFrameUrl: (url) => url === PROD_URL,
  })
  return guard
}

describe('installChannel', () => {
  it('未注册的 channel 不会被注册，调用直接 reject', async () => {
    const ipc = new FakeIpc()
    installChannel(
      ipc,
      {
        channel: 'project:open',
        schema: z.object({}).strict(),
        handle: async () => ({ ok: true }),
      },
      { guard: makeGuard() },
    )
    expect(ipc.handlers.has('project:open')).toBe(true)
    expect(ipc.handlers.has('project:evil')).toBe(false)
    await expect(
      ipc.invoke('project:evil', makeEvent({ webContentsId: 1 })),
    ).rejects.toThrow(/No handler registered/)
  })

  it('伪造 sender 被拒绝，handler 不被调用', async () => {
    const ipc = new FakeIpc()
    const handler = vi.fn(async () => ({ ok: true }))
    installChannel(
      ipc,
      { channel: 'project:stage', schema: z.object({}).strict(), handle: handler },
      { guard: makeGuard() },
    )
    const result = await ipc.invoke(
      'project:stage',
      makeEvent({ webContentsId: 42 }),
      {},
    )
    expect(handler).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN_SENDER')
    }
  })

  it('子框架调用被拒绝', async () => {
    const ipc = new FakeIpc()
    const handler = vi.fn(async () => ({ ok: true }))
    installChannel(
      ipc,
      { channel: 'project:save', schema: z.object({}).strict(), handle: handler },
      { guard: makeGuard() },
    )
    const result = await ipc.invoke(
      'project:save',
      makeEvent({ webContentsId: 1, subFrame: true }),
      {},
    )
    expect(handler).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
  })

  it('frame URL 不匹配时拒绝', async () => {
    const ipc = new FakeIpc()
    const handler = vi.fn(async () => ({ ok: true }))
    installChannel(
      ipc,
      { channel: 'project:save', schema: z.object({}).strict(), handle: handler },
      { guard: makeGuard() },
    )
    const result = await ipc.invoke(
      'project:save',
      makeEvent({ webContentsId: 1, url: 'file:///tmp/evil.html' }),
      {},
    )
    expect(handler).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
  })

  it('参数不符合 schema 时返回 INVALID_REQUEST，且不回显原始值', async () => {
    const ipc = new FakeIpc()
    const handler = vi.fn(async () => ({ ok: true }))
    installChannel(
      ipc,
      {
        channel: 'project:stage',
        schema: z.object({ editSeq: z.number().int().nonnegative() }).strict(),
        handle: handler,
      },
      { guard: makeGuard() },
    )
    const result = await ipc.invoke(
      'project:stage',
      makeEvent({ webContentsId: 1 }),
      { editSeq: -5, secret: 'should-not-be-echoed' },
    )
    expect(handler).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_REQUEST')
      expect(result.error.detail ?? '').not.toContain('should-not-be-echoed')
    }
  })

  it('IpcFailure 保留业务错误码，未知异常统一为 INTERNAL 且不泄露堆栈', async () => {
    const ipc = new FakeIpc()
    installChannel(
      ipc,
      {
        channel: 'project:save',
        schema: z.object({}).strict(),
        handle: async () => {
          throw new IpcFailure('EXTERNAL_MODIFIED', '磁盘文件已在外部修改')
        },
      },
      { guard: makeGuard() },
    )
    const business = await ipc.invoke(
      'project:save',
      makeEvent({ webContentsId: 1 }),
      {},
    )
    expect(business).toEqual({
      ok: false,
      error: { code: 'EXTERNAL_MODIFIED', message: '磁盘文件已在外部修改' },
    })

    installChannel(
      ipc,
      {
        channel: 'project:stage',
        schema: z.object({}).strict(),
        handle: async () => {
          throw new Error('secret stack /Users/aston/private')
        },
      },
      { guard: makeGuard() },
    )
    const unexpected = await ipc.invoke(
      'project:stage',
      makeEvent({ webContentsId: 1 }),
      {},
    )
    expect(unexpected.ok).toBe(false)
    if (!unexpected.ok) {
      expect(unexpected.error.code).toBe('INTERNAL')
      expect(unexpected.error.message).not.toContain('secret')
      expect(unexpected.error.detail).toBeUndefined()
    }
  })

  it('成功时使用统一 ok/value 包络', async () => {
    const ipc = new FakeIpc()
    installChannel(
      ipc,
      {
        channel: 'recent:list',
        schema: z.object({}).strict(),
        handle: async () => ({ items: [] }),
      },
      { guard: makeGuard() },
    )
    const result = await ipc.invoke(
      'recent:list',
      makeEvent({ webContentsId: 1 }),
      {},
    )
    expect(result).toEqual({ ok: true, value: { items: [] } })
  })
})

describe('installSenderChannel', () => {
  it('拒绝伪造 sender 与非法 payload，合法回复才进入 handler', () => {
    const ipc = new FakeIpc()
    const handler = vi.fn()
    installSenderChannel(
      ipc,
      {
        channel: 'editor:flushed',
        schema: z.object({ requestId: z.string().uuid() }).strict(),
        handle: handler,
      },
      { guard: makeGuard() },
    )

    ipc.emit(
      'editor:flushed',
      makeEvent({ webContentsId: 42 }),
      { requestId: '00000000-0000-4000-8000-000000000000' },
    )
    expect(handler).not.toHaveBeenCalled()

    ipc.emit('editor:flushed', makeEvent({ webContentsId: 1 }), { requestId: 'bogus' })
    expect(handler).not.toHaveBeenCalled()

    ipc.emit(
      'editor:flushed',
      makeEvent({ webContentsId: 1 }),
      { requestId: '00000000-0000-4000-8000-000000000000' },
    )
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
