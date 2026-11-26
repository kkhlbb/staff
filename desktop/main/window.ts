import { BrowserWindow } from 'electron'
import path from 'node:path'
import {
  isDevServerFrameUrl,
  isProductionRendererUrl,
  normalizeDevServerUrl,
} from './rendererUrl'
import type { SenderGuard } from './senderGuard'

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined

/** 生产渲染入口：Forge Vite 插件输出到 `.vite/renderer/main_window/`。 */
export function resolveRendererIndexPath(): string {
  // 打包后 __dirname = app.asar/.vite/build；开发构建同样是 .vite/build。
  return path.join(__dirname, '../renderer/main_window/index.desktop.html')
}

export interface MainWindowHandle {
  window: BrowserWindow
  rendererIndexPath: string
  devServerUrl: string | null
  /** 关闭流程通过后置位，窗口 close 事件据此放行一次。 */
  forceClose: boolean
}

export interface CreateMainWindowOptions {
  guard: SenderGuard
  onClosed: (webContentsId: number) => void
  onLoadError?: (stage: string, error: unknown) => void
}

/**
 * 创建唯一主窗口。
 *
 * 安全参数按任务卡 §2.1 固定：contextIsolation=true、nodeIntegration=false、
 * sandbox=true、webSecurity=true；禁用 webview、阻止任意导航与新窗口，也不
 * 把外链交给系统浏览器（A-01 不提供 openExternal）。
 */
export function createMainWindow(options: CreateMainWindowOptions): MainWindowHandle {
  const rendererIndexPath = resolveRendererIndexPath()
  const devServerUrl = normalizeDevServerUrl(
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string'
      ? MAIN_WINDOW_VITE_DEV_SERVER_URL
      : undefined,
  )

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: '寸链',
    backgroundColor: '#F5F7FA',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      // 生产包关闭 DevTools；开发构建（有受控 Vite URL）保留便于排错。
      devTools: devServerUrl !== null,
    },
  })

  const handle: MainWindowHandle = {
    window,
    rendererIndexPath,
    devServerUrl,
    forceClose: false,
  }

  const webContentsId = window.webContents.id
  options.guard.register({
    webContentsId,
    isDestroyed: () => window.isDestroyed() || window.webContents.isDestroyed(),
    isAllowedFrameUrl: (url) => {
      if (devServerUrl !== null) {
        return isDevServerFrameUrl(url, devServerUrl)
      }
      return isProductionRendererUrl(url, rendererIndexPath)
    },
  })

  // 单页应用：任何导航都拒绝，避免被 file:// 或远程页面替换。
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  window.on('closed', () => {
    options.guard.unregister(webContentsId)
    options.onClosed(webContentsId)
  })

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    options.onLoadError?.(
      'window.did-fail-load',
      new Error(`加载主界面失败 (${errorCode}): ${errorDescription} [${validatedURL}]`),
    )
  })

  if (devServerUrl !== null) {
    void window.loadURL(devServerUrl).catch((error: unknown) => {
      options.onLoadError?.('window.loadURL', error)
    })
  } else {
    void window.loadFile(rendererIndexPath).catch((error: unknown) => {
      options.onLoadError?.('window.loadFile', error)
    })
  }

  return handle
}
