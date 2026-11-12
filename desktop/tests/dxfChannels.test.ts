/**
 * 内置 DXF 看图 · 只读 IPC 通道。
 *
 * 重点证明：renderer 传不了路径（strict schema + main 自己选文件）、取消有明确码、
 * 启动参数排队文件只消费一次、未知异常不泄露成“成功”。
 */
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import type { DxfOpenValue, IpcResult } from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'
import { SenderGuard } from '../main/senderGuard'
import { IpcFailure, type IpcMainLike } from '../main/ipc'
import { DXF_VIEW_MAX_BYTES, registerDxfChannels } from '../main/dxfChannels'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<IpcResult<unknown>>

class FakeIpc implements IpcMainLike {
  readonly handlers = new Map<string, Handler>()
  handle(channel: string, listener: Handler): void {
    this.handlers.set(channel, listener)
  }
  on(): void {
    // 本组只有 invoke 通道。
  }
}

const FRAME_URL = 'file:///index.desktop.html'
const frame = { url: FRAME_URL }
const event = { sender: { id: 7, mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent

function value(fileName: string): DxfOpenValue {
  return { fileName, byteSize: 3, bytes: new Uint8Array([1, 2, 3]) }
}

function createHarness(options: {
  picked?: string | null
  pending?: string[]
  read?: (path: string) => Promise<DxfOpenValue>
}) {
  const guard = new SenderGuard()
  guard.register({ webContentsId: 7, isDestroyed: () => false, isAllowedFrameUrl: (url) => url === FRAME_URL })
  const ipc = new FakeIpc()
  const picks: number[] = []
  const pending = [...(options.pending ?? [])]
  const reads: string[] = []
  registerDxfChannels(ipc, {
    guard,
    pickDxfPath: async (windowId) => {
      picks.push(windowId)
      return options.picked ?? null
    },
    readDxfFile: async (targetPath) => {
      reads.push(targetPath)
      if (options.read !== undefined) return options.read(targetPath)
      return value(targetPath.split('/').pop() ?? targetPath)
    },
    takePendingPath: () => pending.shift() ?? null,
  })
  return { ipc, picks, reads, pending }
}

async function invoke(
  harness: ReturnType<typeof createHarness>,
  channel: string,
  params: unknown = {},
): Promise<IpcResult<unknown>> {
  const handler = harness.ipc.handlers.get(channel)
  if (handler === undefined) throw new Error(`通道 ${channel} 未注册`)
  return handler(event, params)
}

describe('dxf:open / dxf:pending（只读）', () => {
  it('对话框选中文件后返回字节与文件名；renderer 不能自带路径', async () => {
    const harness = createHarness({ picked: '/tmp/外部图纸.dxf' })
    const result = await invoke(harness, IPC_CHANNELS.dxfOpen)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const file = result.value as DxfOpenValue
      expect(file.fileName).toBe('外部图纸.dxf')
      expect(file.byteSize).toBe(3)
      expect(Array.from(file.bytes)).toEqual([1, 2, 3])
    }
    expect(harness.picks).toEqual([7])
    expect(harness.reads).toEqual(['/tmp/外部图纸.dxf'])

    // 带路径的请求被 strict schema 拒绝，不会触到文件系统。
    const rejected = await invoke(harness, IPC_CHANNELS.dxfOpen, { path: '/etc/passwd' })
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.error.code).toBe('INVALID_REQUEST')
    expect(harness.reads).toHaveLength(1)
  })

  it('取消对话框返回 CANCELLED，不读任何文件', async () => {
    const harness = createHarness({ picked: null })
    const result = await invoke(harness, IPC_CHANNELS.dxfOpen)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CANCELLED')
    expect(harness.reads).toEqual([])
  })

  it('启动参数排队文件只消费一次，之后返回 null', async () => {
    const harness = createHarness({ pending: ['/tmp/命令行.dxf'] })
    const first = await invoke(harness, IPC_CHANNELS.dxfPending)
    expect(first.ok).toBe(true)
    if (first.ok) expect((first.value as DxfOpenValue).fileName).toBe('命令行.dxf')
    const second = await invoke(harness, IPC_CHANNELS.dxfPending)
    expect(second).toEqual({ ok: true, value: null })
    expect(harness.reads).toEqual(['/tmp/命令行.dxf'])
  })

  it('读取失败按业务错误码返回，不伪装成空文件', async () => {
    const harness = createHarness({
      pending: ['/tmp/坏.dxf'],
      read: async () => {
        throw new IpcFailure('READ_FAILED', '无法访问 DXF 文件', 'EACCES')
      },
    })
    const result = await invoke(harness, IPC_CHANNELS.dxfPending)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('READ_FAILED')
      expect(result.error.detail).toBe('EACCES')
    }
  })

  it('大小上限是 64 MiB，且通道不暴露写入口', () => {
    expect(DXF_VIEW_MAX_BYTES).toBe(64 * 1024 * 1024)
    const harness = createHarness({})
    expect([...harness.ipc.handlers.keys()].sort()).toEqual([
      IPC_CHANNELS.dxfOpen,
      IPC_CHANNELS.dxfPending,
    ])
  })
})
