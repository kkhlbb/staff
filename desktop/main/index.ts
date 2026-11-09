import {
  BrowserWindow,
  Menu,
  app,
  ipcMain,
  session,
  webContents,
} from 'electron'
import path from 'node:path'
import { z } from 'zod'
import {
  DESKTOP_APP_NAME,
  IPC_CHANNELS,
  IPC_EVENTS,
  type IpcResult,
  type MenuAction,
  type RequestCloseResult,
} from '../shared/contracts'
import { CloseGuard } from './closeGuard'
import {
  IpcFailure,
  installChannel,
  installSenderChannel,
  type IpcMainLike,
} from './ipc'
import { buildApplicationMenu } from './menu'
import { SenderGuard } from './senderGuard'
import { createMainWindow, type MainWindowHandle } from './window'

// 应用名与 userData 目录必须在任何路径读取前固定，避免 staff → 寸链 改名漂移。
app.setName(DESKTOP_APP_NAME)
app.setPath('userData', path.join(app.getPath('appData'), DESKTOP_APP_NAME))

const guard = new SenderGuard()
const windows = new Map<number, MainWindowHandle>()
/** macOS 在 ready 之前可能投递 open-file；先排队，A-04 接项目会话后消费。 */
const pendingOpenFiles: string[] = []
let allowQuit = false
let quitInFlight = false

function logStage(entry: { channel: string; code: string; detail?: string }): void {
  const suffix = entry.detail === undefined ? '' : ` ${entry.detail}`
  console.warn(`[cunlian] ${entry.channel} ${entry.code}${suffix}`)
}

const closeGuard = new CloseGuard({
  sendFlush: (webContentsId, payload) => {
    const target = webContents.fromId(webContentsId)
    if (target !== undefined && !target.isDestroyed()) {
      target.send(IPC_EVENTS.editorFlush, payload)
    }
  },
})

/** 关闭/退出前必须完成的编辑屏障。只有拿到 renderer 的 flushed 回复才返回成功。 */
async function runEditBarrier(window: BrowserWindow): Promise<IpcResult<null>> {
  const webContentsId = window.webContents.id
  if (!closeGuard.beginClose(webContentsId)) {
    return {
      ok: false,
      error: { code: 'BUSY', message: '窗口正在关闭或等待编辑内容提交' },
    }
  }
  const outcome = await closeGuard.requestFlush(webContentsId)
  closeGuard.endClose(webContentsId)
  if (!outcome.ok) {
    return { ok: false, error: outcome.error ?? { code: 'SAVE_FAILED', message: '关闭失败' } }
  }
  return { ok: true, value: null }
}

function closeNow(handle: MainWindowHandle): void {
  if (handle.window.isDestroyed()) {
    return
  }
  handle.forceClose = true
  handle.window.close()
}

function createWindow(): MainWindowHandle {
  const handle = createMainWindow({
    guard,
    onClosed: (webContentsId) => {
      windows.delete(webContentsId)
    },
  })
  const webContentsId = handle.window.webContents.id
  windows.set(webContentsId, handle)

  handle.window.on('close', (event) => {
    if (handle.forceClose) {
      handle.forceClose = false
      return
    }
    // 用户点红点 / ⌘W / app.quit 都走同一屏障；未拿到 flushed 就不销毁窗口。
    event.preventDefault()
    void runEditBarrier(handle.window).then((result) => {
      if (result.ok) {
        closeNow(handle)
      } else {
        logStage({
          channel: IPC_CHANNELS.windowRequestClose,
          code: result.error.code,
          detail: result.error.detail,
        })
      }
    })
  })

  return handle
}

function sendMenuAction(action: MenuAction): void {
  const target =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (target === undefined || target.isDestroyed()) {
    return
  }
  target.webContents.send(IPC_EVENTS.menuAction, { action })
}

function installIpcHandlers(): void {
  const ipc: IpcMainLike = ipcMain
  const deps = { guard, log: logStage }

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.windowRequestClose,
      schema: z
        .object({ sessionId: z.string().min(1).max(200).optional() })
        .strict(),
      handle: async ({ sender }) => {
        const handle = windows.get(sender.webContentsId)
        if (handle === undefined || handle.window.isDestroyed()) {
          throw new IpcFailure('NOT_FOUND', '窗口已不存在')
        }
        const barrier = await runEditBarrier(handle.window)
        if (!barrier.ok) {
          throw new IpcFailure(barrier.error.code, barrier.error.message, barrier.error.detail)
        }
        // 先让 invoke 结果回到 renderer，再销毁窗口；renderer 不能依赖销毁后的响应。
        setImmediate(() => {
          closeNow(handle)
        })
        const value: RequestCloseResult = { closed: true }
        return value
      },
    },
    deps,
  )

  installSenderChannel(
    ipc,
    {
      channel: IPC_EVENTS.editorFlushed,
      schema: z
        .object({
          requestId: z.string().min(1).max(200),
          sessionId: z.string().min(1).max(200).optional(),
          editSeq: z.number().int().nonnegative().optional(),
        })
        .strict(),
      handle: ({ sender }, payload) => {
        const verdict = closeGuard.acceptFlushed(sender.webContentsId, payload)
        if (!verdict.ok) {
          logStage({
            channel: IPC_EVENTS.editorFlushed,
            code: verdict.error.code,
            detail: verdict.error.detail,
          })
        }
      },
    },
    deps,
  )
}

function applySessionSecurity(): void {
  const defaultSession = session.defaultSession
  defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  defaultSession.setPermissionCheckHandler(() => false)
}

function bootstrap(): void {
  app.on('second-instance', () => {
    const existing = BrowserWindow.getAllWindows()[0]
    if (existing !== undefined) {
      if (existing.isMinimized()) {
        existing.restore()
      }
      existing.focus()
    }
  })

  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    pendingOpenFiles.push(filePath)
    const existing = BrowserWindow.getAllWindows()[0]
    if (existing !== undefined) {
      existing.focus()
    }
  })

  app.on('before-quit', (event) => {
    if (allowQuit) {
      return
    }
    const allWindows = BrowserWindow.getAllWindows()
    if (allWindows.length === 0) {
      allowQuit = true
      return
    }
    event.preventDefault()
    if (quitInFlight) {
      return
    }
    quitInFlight = true
    void Promise.all(
      allWindows.map(async (window) => {
        const barrier = await runEditBarrier(window)
        if (!barrier.ok) {
          logStage({
            channel: IPC_CHANNELS.windowRequestClose,
            code: barrier.error.code,
            detail: barrier.error.detail,
          })
          return false
        }
        const handle = windows.get(window.webContents.id)
        if (handle !== undefined) {
          closeNow(handle)
        }
        return true
      }),
    ).then((results) => {
      quitInFlight = false
      if (results.every((value) => value)) {
        allowQuit = true
        app.quit()
      }
    })
  })

  void app.whenReady().then(() => {
    applySessionSecurity()
    installIpcHandlers()
    // 任意 WebContents（包括未来误加的 webview/子窗口）统一禁止导航与新窗口。
    app.on('web-contents-created', (_event, contents) => {
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    })
    Menu.setApplicationMenu(buildApplicationMenu({ sendAction: sendMenuAction }))
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

// 需要在 ready 之前占用单实例锁；第二个实例只唤起已有窗口。
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  bootstrap()
}

// pendingOpenFiles 由 A-04 的会话层消费；A-01 只负责排队，不读取项目内容。
export { pendingOpenFiles }
