import type { IpcErrorPayload } from '../shared/contracts'

/** 一个已登记窗口的渲染入口信息；由 window.ts 在创建后立即登记。 */
export interface RegisteredRenderer {
  webContentsId: number
  isDestroyed: () => boolean
  /**
   * 该 frame URL 是否属于本窗口允许的渲染入口。
   * 生产只允许打包后的 `file://.../index.desktop.html`；开发只允许受控本地
   * Vite URL；不做“前缀匹配任意 http”这种宽松判断。
   */
  isAllowedFrameUrl: (url: string) => boolean
}

export interface SenderInfo {
  webContentsId: number
  frameUrl: string | null
  isMainFrame: boolean
}

export type SenderVerdict =
  | { ok: true }
  | { ok: false; error: IpcErrorPayload }

/**
 * IPC 发送方白名单。
 *
 * 只有同时满足下列条件的调用才被接受：
 * 1. `event.sender` 是本应用登记的窗口（不是任意 WebContents）；
 * 2. 窗口尚未销毁；
 * 3. `event.senderFrame` 是该 WebContents 的主框架（禁止子框架调用）；
 * 4. 主框架 URL 精确属于该窗口允许的渲染入口。
 */
export class SenderGuard {
  private readonly renderers = new Map<number, RegisteredRenderer>()

  register(renderer: RegisteredRenderer): void {
    this.renderers.set(renderer.webContentsId, renderer)
  }

  unregister(webContentsId: number): void {
    this.renderers.delete(webContentsId)
  }

  clear(): void {
    this.renderers.clear()
  }

  verify(sender: SenderInfo): SenderVerdict {
    const renderer = this.renderers.get(sender.webContentsId)
    if (renderer === undefined) {
      return forbidden('调用方不是本应用登记的窗口')
    }
    if (renderer.isDestroyed()) {
      return forbidden('窗口已销毁')
    }
    if (!sender.isMainFrame) {
      return forbidden('拒绝子框架调用')
    }
    if (sender.frameUrl === null || !renderer.isAllowedFrameUrl(sender.frameUrl)) {
      return forbidden('frame URL 不属于已授权的渲染入口')
    }
    return { ok: true }
  }
}

export function forbidden(detail: string): SenderVerdict {
  return {
    ok: false,
    error: {
      code: 'FORBIDDEN_SENDER',
      message: '当前调用方没有 IPC 权限',
      detail,
    },
  }
}
