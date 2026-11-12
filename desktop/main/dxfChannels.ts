/**
 * 内置 DXF 看图 · 只读文件通道（dxf:open / dxf:pending）。
 *
 * 边界：
 * - renderer **不能传路径**：dialog 由 main 弹，或启动参数 `--open-dxf=<path>` 排队；
 * - 读文件前检查常规文件（拒绝符号链接/目录）与大小上限；
 * - 只读：不写文件、不改名、不移动。
 */
import { z } from 'zod'
import type { DxfOpenValue, IpcErrorCode } from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'
import { IpcFailure, installChannel, type IpcDeps, type IpcMainLike } from './ipc'
import type { SenderGuard } from './senderGuard'

/** 单文件上限：比一份 A0 DXF 宽松，但不让主进程被一个几百 MB 文件拖死。 */
export const DXF_VIEW_MAX_BYTES = 64 * 1024 * 1024

const emptySchema = z.object({}).strict()

export interface DxfChannelDeps {
  guard: SenderGuard
  /** 系统打开对话框；取消返回 null。路径只由 main 决定。 */
  pickDxfPath: (windowId: number) => Promise<string | null>
  /** 读取并校验候选文件；非普通文件/超限抛 IpcFailure。 */
  readDxfFile: (targetPath: string) => Promise<DxfOpenValue>
  /** 消费启动参数排队路径；没有则 null。 */
  takePendingPath: () => string | null
  log?: IpcDeps['log']
}

function reject(code: IpcErrorCode, message: string, detail?: string): never {
  throw new IpcFailure(code, message, detail)
}

export function registerDxfChannels(ipc: IpcMainLike, deps: DxfChannelDeps): void {
  const ipcDeps: IpcDeps = { guard: deps.guard, log: deps.log }

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.dxfOpen,
      schema: emptySchema,
      handle: async ({ sender }): Promise<DxfOpenValue> => {
        const target = await deps.pickDxfPath(sender.webContentsId)
        if (target === null) reject('CANCELLED', '已取消选择 DXF 文件')
        return deps.readDxfFile(target)
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.dxfPending,
      schema: emptySchema,
      handle: async (): Promise<DxfOpenValue | null> => {
        const target = deps.takePendingPath()
        if (target === null) return null
        return deps.readDxfFile(target)
      },
    },
    ipcDeps,
  )
}
