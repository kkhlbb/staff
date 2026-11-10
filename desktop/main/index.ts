import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  ipcMain,
  session,
  shell,
  webContents,
} from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promises as fsp } from 'node:fs'
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
import {
  MIGRATION_BUNDLE_MAX_BYTES,
  MIGRATION_JSON_MAX_BYTES,
  MigrationService,
  type MigrationInput,
  type MigrationKind,
} from './migrationService'
import { ProjectService } from './projectService'
import { RecentProjectsStore } from './recentProjects'
import { RecoveryStore } from './recovery'
import { registerProjectChannels } from './channels'
import { registerModelChannels } from './modelChannels'
import { createModelFileIo } from './modelIo'
import { registerDrawingChannels } from './drawingChannels'
import { registerChangeChannels } from './changeChannels'
import { ChangeService } from './changeService'
import { DrawingExportStore, type DrawingExportKind } from './drawingExportStore'
import { printDrawingToPdf } from './drawingPdf'
import { resolvePrintFontPath } from './printAssets'
import { renderDrawingSvg } from '../../src/drawing/renderDrawingSvg'
import type { DrawingData } from '../../src/drawing/types'
import { SessionController, runCloseGate, type GateChoice } from './sessionController'
import { SenderGuard } from './senderGuard'
import { createMainWindow, type MainWindowHandle } from './window'

// 应用名与 userData 目录必须在任何路径读取前固定，避免 staff → 寸链 改名漂移。
app.setName(DESKTOP_APP_NAME)
app.setPath('userData', path.join(app.getPath('appData'), DESKTOP_APP_NAME))

const WORKSPACE_ROOT = path.join(app.getPath('userData'), 'workspace')

const guard = new SenderGuard()
const windows = new Map<number, MainWindowHandle>()
/** macOS 在 ready 之前可能投递 open-file；排队后由 openProject 消费。 */
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

/** 编辑屏障：只有拿到 renderer 的 flushed 回复才返回成功。 */
async function flushEditor(window: BrowserWindow): Promise<IpcResult<null>> {
  const outcome = await closeGuard.requestFlush(window.webContents.id)
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
    // 红点 / ⌘W / app.quit 都走同一个 dirty gate；失败或取消不销毁窗口。
    event.preventDefault()
    void withCloseGate(webContentsId, 'close').then((result) => {
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

/** 读取迁移输入：拒绝符号链接/非普通文件，读前按 stat 限制大小，读后再核对。 */
async function readMigrationInput(kind: MigrationKind): Promise<MigrationInput | null> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options = {
    title: kind === 'bundle' ? '选择 V2 完整备份（.cunlian.zip）' : '选择 V2 项目 JSON',
    properties: ['openFile' as const],
    filters:
      kind === 'bundle'
        ? [{ name: 'V2 完整备份', extensions: ['zip'] }]
        : [{ name: '项目 JSON', extensions: ['json'] }],
  }
  const picked =
    owner === undefined
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(owner, options)
  if (picked.canceled || picked.filePaths.length === 0) {
    return null
  }
  const sourcePath = picked.filePaths[0]
  let info: Awaited<ReturnType<typeof fsp.lstat>>
  try {
    info = await fsp.lstat(sourcePath)
  } catch (error) {
    throw new IpcFailure(
      'READ_FAILED',
      '无法访问迁移输入文件',
      error instanceof Error ? error.message : String(error),
    )
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new IpcFailure('INVALID_REQUEST', '迁移输入必须是常规文件（不允许符号链接或目录）')
  }
  const limit = kind === 'bundle' ? MIGRATION_BUNDLE_MAX_BYTES : MIGRATION_JSON_MAX_BYTES
  if (info.size > limit) {
    throw new IpcFailure('TOO_LARGE', '迁移输入超过大小上限', `${info.size} 字节`)
  }
  const buffer = await fsp.readFile(sourcePath)
  if (buffer.byteLength !== info.size || buffer.byteLength > limit) {
    throw new IpcFailure('READ_FAILED', '读取迁移输入时文件大小发生变化，请重试')
  }
  return { path: sourcePath, bytes: new Uint8Array(buffer) }
}

async function pickMigrationTarget(suggestedName: string): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options = {
    title: '迁移为新的 .cunlian 项目文件',
    defaultPath: path.join(app.getPath('documents'), suggestedName),
    filters: [{ name: '寸链项目文件', extensions: ['cunlian'] }],
  }
  const saved =
    owner === undefined
      ? await dialog.showSaveDialog(options)
      : await dialog.showSaveDialog(owner, options)
  if (saved.canceled || saved.filePath === undefined) {
    return null
  }
  return saved.filePath
}

function sanitizeFileName(name: string): string {
  const cleaned = [...name]
    .map((character) =>
      character.charCodeAt(0) < 32 || '/\\:*?"<>|'.includes(character) ? '_' : character,
    )
    .join('')
    .trim()
  const base = cleaned === '' ? '未命名项目' : cleaned.slice(0, 120)
  return base.endsWith('.cunlian') ? base : `${base}.cunlian`
}

async function pickProjectPath(title: string): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options = {
    title,
    properties: ['openFile' as const],
    filters: [{ name: '寸链项目文件', extensions: ['cunlian'] }],
  }
  const picked =
    owner === undefined
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(owner, options)
  if (picked.canceled || picked.filePaths.length === 0) {
    return null
  }
  return picked.filePaths[0]
}

/** Finder 双击排队的路径只消费一次；其余情况必须走主进程对话框。 */
async function takePendingOrPick(title: string): Promise<string | null> {
  const queued = pendingOpenFiles.shift()
  if (queued !== undefined) {
    return queued
  }
  return pickProjectPath(title)
}

async function askDirtyChoice(prompt: {
  projectName: string
  path: string | null
  purpose: string
}): Promise<GateChoice> {
  const reason =
    prompt.purpose === 'quit' || prompt.purpose === 'close'
      ? '退出/关闭前需要处理未保存编辑。'
      : '切换项目前需要处理未保存编辑。'
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options = {
    type: 'warning' as const,
    message: `“${prompt.projectName}”有未保存的编辑`,
    detail: `${reason}选择“保存”会先写入磁盘；保存失败或取消都不会切换/退出。`,
    buttons: ['保存', '不保存', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }
  const choice =
    owner === undefined
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(owner, options)
  if (choice.response === 0) {
    return 'save'
  }
  if (choice.response === 1) {
    return 'discard'
  }
  return 'cancel'
}

async function pickSaveTargetFor(suggestedName: string): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options = {
    title: '保存寸链项目',
    defaultPath: path.join(app.getPath('documents'), suggestedName),
    filters: [{ name: '寸链项目文件', extensions: ['cunlian'] }],
  }
  const saved =
    owner === undefined
      ? await dialog.showSaveDialog(options)
      : await dialog.showSaveDialog(owner, options)
  if (saved.canceled || saved.filePath === undefined) {
    return null
  }
  return saved.filePath
}

async function pickModelFileFor(windowId: number): Promise<string | null> {
  const owner = BrowserWindow.fromId(windowId) ?? BrowserWindow.getFocusedWindow()
  const options = {
    title: '导入 STL 模型',
    properties: ['openFile' as const],
    filters: [{ name: 'STL 模型', extensions: ['stl', 'STL'] }],
  }
  const picked =
    owner === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(owner, options)
  if (picked.canceled || picked.filePaths.length !== 1) {
    return null
  }
  return picked.filePaths[0] ?? null
}

/** C：导出对话框只允许对应后缀；路径只来自系统对话框。 */
async function pickDrawingExportPath(
  windowId: number,
  kind: DrawingExportKind,
  suggestedName: string,
): Promise<string | null> {
  const owner = BrowserWindow.fromId(windowId) ?? BrowserWindow.getFocusedWindow()
  const options = {
    title: kind === 'pdf' ? '导出图纸 PDF' : '导出图纸 SVG',
    defaultPath: path.join(app.getPath('documents'), suggestedName),
    filters:
      kind === 'pdf'
        ? [{ name: 'PDF 图纸', extensions: ['pdf'] }]
        : [{ name: 'SVG 矢量图纸', extensions: ['svg'] }],
  }
  const saved =
    owner === null
      ? await dialog.showSaveDialog(options)
      : await dialog.showSaveDialog(owner, options)
  if (saved.canceled || saved.filePath === undefined) {
    return null
  }
  return saved.filePath
}

async function confirmDrawingOverwrite(windowId: number, targetPath: string): Promise<boolean> {
  const owner = BrowserWindow.fromId(windowId) ?? BrowserWindow.getFocusedWindow()
  const options = {
    type: 'warning' as const,
    message: '目标文件已存在',
    detail: `${path.basename(targetPath)} 将被替换。提交前会再次核对磁盘指纹，原文件在替换前不会被截断。`,
    buttons: ['替换', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const choice =
    owner === null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(owner, options)
  return choice.response === 0
}

async function confirmProjectOverwrite(targetPath: string): Promise<boolean> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options = {
    type: 'warning' as const,
    message: '目标位置已有项目文件',
    detail: `${path.basename(targetPath)} 将在原子替换后成为新版本。提交前会再次核对磁盘指纹，原文件在替换前不会被截断。`,
    buttons: ['替换', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const choice =
    owner === undefined ? await dialog.showMessageBox(options) : await dialog.showMessageBox(owner, options)
  return choice.response === 0
}

/** 字体从打包资源读取并转 data URL；打印页与网络完全隔离。 */
async function bundledPrintFonts(): Promise<{ family: string; dataUrl: string }[]> {
  const assets = [
    { family: 'Noto Sans SC Cunlian', file: 'NotoSansSC-Cunlian-subset.woff2' },
    { family: 'Noto Sans Math Cunlian', file: 'NotoSansMath-Cunlian-symbols.woff2' },
  ]
  return Promise.all(
    assets.map(async (asset) => {
      const resolved = await resolvePrintFontPath(app.getAppPath(), asset.file)
      if (resolved === null) {
        throw new IpcFailure(
          'FONT_UNAVAILABLE',
          '随包字体缺失，已拒绝导出',
          asset.file,
        )
      }
      const bytes = await fsp.readFile(resolved)
      return {
        family: asset.family,
        dataUrl: `data:font/woff2;base64,${Buffer.from(bytes).toString('base64')}`,
      }
    }),
  )
}

function drawingPrintEntryUrl(): string {
  const devServer = process.env.DRAWING_PRINT_VITE_DEV_SERVER_URL
  if (devServer !== undefined && devServer !== '') {
    return new URL('index.print.html', devServer).toString()
  }
  const name = process.env.DRAWING_PRINT_VITE_NAME ?? 'drawing_print'
  return pathToFileURL(path.join(__dirname, `../renderer/${name}/index.print.html`)).toString()
}

async function printDrawingPdf(data: DrawingData): Promise<Uint8Array> {
  return printDrawingToPdf({
    svg: renderDrawingSvg(data),
    fonts: await bundledPrintFonts(),
    drawingId: data.drawingId,
    fingerprint: data.fingerprint,
    printEntryUrl: drawingPrintEntryUrl(),
  })
}

function installIpcHandlers(): void {
  const ipc: IpcMainLike = ipcMain
  const deps = { guard, log: logStage }
  const projectService = new ProjectService()
  const recovery = new RecoveryStore({ rootDir: WORKSPACE_ROOT })
  const recent = new RecentProjectsStore({ rootDir: WORKSPACE_ROOT })

  const controller = new SessionController({
    projectService,
    recovery,
    recent,
    ports: {
      askChoice: askDirtyChoice,
      pickSaveTarget: pickSaveTargetFor,
      flushEditor: async (windowId) => {
        const handle = windows.get(windowId)
        if (handle === undefined || handle.window.isDestroyed()) {
          return { ok: false, error: { code: 'NOT_FOUND', message: '窗口已不存在' } }
        }
        return flushEditor(handle.window)
      },
      log: (entry) => logStage({ channel: 'session', ...entry }),
    },
  })
  controllerForClose = controller

  registerProjectChannels(ipc, {
    guard,
    projectService,
    recovery,
    recent,
    controller,
    pickOpenPath: () => takePendingOrPick('打开寸链项目'),
    pickRelinkPath: () => pickProjectPath('重新定位最近项目'),
    pickSaveTarget: async (session) =>
      pickSaveTargetFor(sanitizeFileName(session.snapshot.project.name)),
    // handler 已确认路径来自当前会话且为常规文件；这里只调用 Finder 定位，
    // 不接受任何 shell 命令或 renderer 传入的路径。
    revealPath: async (targetPath) => {
      shell.showItemInFolder(targetPath)
    },
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
    log: logStage,
  })

  registerModelChannels(ipc, {
    guard,
    controller,
    projectService,
    recovery,
    pickModelPath: pickModelFileFor,
    io: createModelFileIo(),
    log: logStage,
  })

  registerDrawingChannels(ipc, {
    guard,
    controller,
    projectService,
    recovery,
    exportStore: new DrawingExportStore(),
    pickExportPath: pickDrawingExportPath,
    confirmOverwrite: confirmDrawingOverwrite,
    printPdf: printDrawingPdf,
    log: logStage,
  })

  const changeService = new ChangeService({
    projectService,
    recovery,
    controller,
    pickSaveTarget: (suggestedName) => pickSaveTargetFor(sanitizeFileName(suggestedName)),
    confirmOverwrite: confirmProjectOverwrite,
  })
  registerChangeChannels(ipc, {
    guard,
    controller,
    changeService,
    log: logStage,
  })

  const migrationService = new MigrationService({
    projectService,
    pickInput: readMigrationInput,
    pickTarget: pickMigrationTarget,
    // 迁移提交前走与打开/新建相同的三选；保存失败或取消都停止迁移。
    dirtyGateDetailed: async (windowId) => {
      const result = await controller.withGate(windowId, 'migrate', async () => ({
        ok: true as const,
        value: null,
      }))
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    },
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
  })

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.migrationInspect,
      schema: z.object({ kind: z.enum(['bundle', 'json']) }).strict(),
      handle: async ({ sender }, params) =>
        migrationService.inspect(sender.webContentsId, params),
    },
    deps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.migrationCommit,
      schema: z
        .object({
          importToken: z.string().min(1).max(200),
          projectId: z.string().min(1).max(240),
        })
        .strict(),
      handle: async ({ sender }, params) => {
        const value = await migrationService.commit(sender.webContentsId, params)
        // 落盘并回读成功后才切换活动会话；迁移失败时旧会话保持不变。
        await controller.attach(sender.webContentsId, value.sessionId)
        return value
      },
    },
    deps,
  )

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
        const result = await withCloseGate(sender.webContentsId, 'close')
        if (!result.ok) {
          throw new IpcFailure(result.error.code, result.error.message, result.error.detail)
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
        const session = controller.sessionFor(sender.webContentsId)
        if (session !== null) {
          // 屏障回复必须对应活动会话与已接受序号，否则不释放关闭流程。
          if (
            payload.sessionId !== undefined &&
            payload.sessionId !== session.sessionId
          ) {
            logStage({
              channel: IPC_EVENTS.editorFlushed,
              code: 'STALE_SESSION',
              detail: '编辑屏障回复的会话与活动会话不一致',
            })
            return
          }
          if (payload.editSeq !== undefined && payload.editSeq !== session.acceptedSeq) {
            logStage({
              channel: IPC_EVENTS.editorFlushed,
              code: 'STALE_EDIT',
              detail: `acceptedSeq=${session.acceptedSeq}, flushedSeq=${payload.editSeq}`,
            })
            return
          }
        }
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

/**
 * 关闭流程的单一入口：先 dirty gate（内含编辑屏障），再关闭会话。
 * 返回 ok 后由调用方决定是否销毁窗口；任何失败都保持窗口与会话。
 */
async function withCloseGate(
  webContentsId: number,
  purpose: 'close' | 'quit',
): Promise<IpcResult<null>> {
  return runCloseGate(controllerForClose, webContentsId, purpose)
}

/**
 * 关闭流程需要访问同一个 SessionController 实例；installIpcHandlers 会赋值。
 * A-01 在 IPC 安装前不会触发关闭流程。
 */
let controllerForClose: SessionController = undefined as unknown as SessionController

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
      if (!existing.webContents.isLoading()) {
        existing.webContents.send(IPC_EVENTS.menuAction, { action: 'open' })
      }
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
    void (async () => {
      let allOk = true
      for (const window of allWindows) {
        if (window.isDestroyed()) {
          continue
        }
        const id = window.webContents.id
        // ⌘Q 与红点走同一个 withCloseGate；保存失败/取消时 quit 中止。
        const result = await withCloseGate(id, 'quit')
        if (!result.ok) {
          allOk = false
          logStage({
            channel: IPC_CHANNELS.windowRequestClose,
            code: result.error.code,
            detail: result.error.detail,
          })
          break
        }
        const handle = windows.get(id)
        if (handle !== undefined) {
          closeNow(handle)
        }
      }
      quitInFlight = false
      if (allOk) {
        allowQuit = true
        app.quit()
      }
    })()
  })

  void app.whenReady().then(() => {
    applySessionSecurity()
    installIpcHandlers()
    // 任意 WebContents（包括未来误加的 webview/子窗口）统一禁止导航与新窗口。
    app.on('web-contents-created', (_event, contents) => {
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    })
    Menu.setApplicationMenu(buildApplicationMenu({ sendAction: sendMenuAction }))
    const handle = createWindow()
    handle.window.webContents.once('did-finish-load', () => {
      // 启动前排队的 Finder 打开请求：由 renderer 走正常 openProject/gate。
      if (pendingOpenFiles.length > 0) {
        handle.window.webContents.send(IPC_EVENTS.menuAction, { action: 'open' })
      }
    })

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

// pendingOpenFiles 只由 openProject 消费；A-01 不读取项目内容。
export { pendingOpenFiles }
