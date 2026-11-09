/**
 * 本地打印视图 → printToPDF（V3-C-04/C-05）。
 *
 * 独立隐藏 BrowserWindow 加载专用打印入口（`drawing_print` 构建产物），不加载
 * 工作台页面、没有 preload、没有通用 IPC。传入的是已校验 DrawingData 经唯一
 * SVG 序列化器得到的 SVG 与内嵌字体 data URL；打印页不读工作区像素或 3D 场景。
 *
 * 固定选项：A4 landscape、四边 0、printBackground、scale 1、preferCSSPageSize、
 * 无页眉页脚。字体加载有 15 秒上限，任何失败都不产生 PDF。
 */
import { BrowserWindow, session, type PrintToPDFOptions } from 'electron'
import { IpcFailure } from './ipc'

export interface PrintDrawingOptions {
  svg: string
  /** OFL 子集：Noto Sans SC（中文/数字）+ Noto Sans Math（⌀ ±）。 */
  fonts: { family: string; dataUrl: string }[]
  drawingId: string
  fingerprint: string
  /** `file://.../index.print.html` 或开发环境的 loopback URL。 */
  printEntryUrl: string
}

const FONT_TIMEOUT_MS = 15_000
const PRINT_PARTITION = 'cunlian-drawing-print'
const PROBE_TEXT = '⌀±待复核草稿12.00隔套第三角投影待补充'

function escapeForScript(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export const PRINT_PDF_OPTIONS: PrintToPDFOptions = {
  pageSize: 'A4',
  landscape: true,
  margins: { top: 0, bottom: 0, left: 0, right: 0 },
  printBackground: true,
  scale: 1,
  displayHeaderFooter: false,
  preferCSSPageSize: true,
  pageRanges: '',
}

interface PrintReadyStatus {
  drawingId: string
  fingerprint: string
  svgFingerprint: string | null
  fontsReady: boolean
  glyphsOk: boolean
  svgMounted: boolean
  viewportWidthPx: number
  viewportHeightPx: number
  bbox: { x: number; y: number; width: number; height: number } | null
  errors: string[]
}

function applyIsolatedSession(): Electron.Session {
  const printSession = session.fromPartition(PRINT_PARTITION)
  printSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  printSession.setPermissionCheckHandler(() => false)
  printSession.webRequest.onBeforeRequest((details, callback) => {
    // 只允许本地入口、data: 内嵌字体与 devtools；任何 http(s)/ws 请求都拒绝。
    const allowed =
      details.url.startsWith('file:') ||
      details.url.startsWith('data:') ||
      details.url.startsWith('devtools:')
    callback({ cancel: !allowed })
  })
  return printSession
}

export async function printDrawingToPdf(options: PrintDrawingOptions): Promise<Uint8Array> {
  applyIsolatedSession()
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      partition: PRINT_PARTITION,
      // 明确不加载任何 preload。
      preload: undefined,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  try {
    await win.loadURL(options.printEntryUrl)
    const payload = escapeForScript(
      JSON.stringify({
        svg: options.svg,
        fonts: options.fonts,
        drawingId: options.drawingId,
        fingerprint: options.fingerprint,
        probeText: PROBE_TEXT,
      }),
    )
    const entryReady = await win.webContents.executeJavaScript(
      'typeof window.__cunlianPrint',
      true,
    )
    if (entryReady !== 'function') {
      throw new IpcFailure(
        'PDF_EXPORT_FAILED',
        `打印入口脚本未加载（window.__cunlianPrint=${String(entryReady)}）`,
      )
    }
    const ready = await Promise.race([
      win.webContents.executeJavaScript(
        `window.__cunlianPrint(${payload})`,
        true,
      ) as Promise<PrintReadyStatus>,
      new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new IpcFailure('PRINT_TIMEOUT', '打印视图在 15 秒内未就绪'))
        }, FONT_TIMEOUT_MS)
        timer.unref?.()
      }),
    ])

    if (ready === null || typeof ready !== 'object') {
      throw new IpcFailure('PDF_EXPORT_FAILED', '打印视图没有返回就绪状态')
    }
    if (ready.drawingId !== options.drawingId || ready.fingerprint !== options.fingerprint) {
      throw new IpcFailure('STALE_DRAWING', '打印视图收到的图纸与请求不一致')
    }
    if (ready.svgFingerprint !== options.fingerprint) {
      throw new IpcFailure('INVALID_DRAWING', '打印页 SVG 指纹与请求不一致')
    }
    if (!ready.svgMounted) {
      throw new IpcFailure('PDF_EXPORT_FAILED', '打印页没有挂载 SVG')
    }
    if (!ready.fontsReady || !ready.glyphsOk) {
      throw new IpcFailure(
        'FONT_UNAVAILABLE',
        '打印所需字体或字形不可用，已拒绝导出',
        ready.errors.join('；'),
      )
    }
    if (ready.errors.length > 0) {
      throw new IpcFailure('PRINT_TIMEOUT', '打印视图报告错误', ready.errors.join('；'))
    }

    let pdf: Buffer
    try {
      pdf = await win.webContents.printToPDF(PRINT_PDF_OPTIONS)
    } catch (error) {
      throw new IpcFailure(
        'PDF_EXPORT_FAILED',
        'printToPDF 调用失败',
        error instanceof Error ? error.message : String(error),
      )
    }
    if (pdf.byteLength === 0) {
      throw new IpcFailure('PDF_EXPORT_FAILED', 'printToPDF 返回空字节')
    }
    return new Uint8Array(pdf)
  } finally {
    if (!win.isDestroyed()) {
      win.destroy()
    }
  }
}
