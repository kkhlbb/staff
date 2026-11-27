import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindowConstructorOptions, IpcMainInvokeEvent } from 'electron'
import type { CunlianDesktopApi } from '../shared/contracts'

const electron = vi.hoisted(() => ({
  expose: vi.fn(),
  invoke: vi.fn(),
  setApplicationMenu: vi.fn(),
  buildFromTemplate: vi.fn(() => ({ macMenu: true })),
}))

vi.mock('electron', () => ({
  app: {
    setName: vi.fn(),
    getPath: () => '/tmp',
    setPath: vi.fn(),
    requestSingleInstanceLock: () => false,
    quit: vi.fn(),
  },
  BrowserWindow: class extends EventEmitter {
    readonly options: BrowserWindowConstructorOptions
    constructor(options: BrowserWindowConstructorOptions) {
      super()
      this.options = options
    }
    webContents = Object.assign(new EventEmitter(), {
      id: 42,
      mainFrame: { url: '' },
      isDestroyed: vi.fn(() => false),
      setWindowOpenHandler: vi.fn(),
    })
    isDestroyed = vi.fn(() => false)
    setMenuBarVisibility = vi.fn()
    setTitleBarOverlay = vi.fn()
    setBackgroundColor = vi.fn()
    loadFile = vi.fn(async (file: string) => {
      this.webContents.mainFrame.url = pathToFileURL(file).href
    })
  },
  Menu: electron,
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: { invoke: electron.invoke },
}))

const dark = { color: '#1b1b19', symbolColor: '#9d9a92', height: 36 }
const light = { color: '#faf9f6', symbolColor: '#625f57', height: 36 }

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function usePlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform })
}

describe('native window chrome', () => {
  it.each([
    ['win32', { titleBarStyle: 'hidden', titleBarOverlay: dark, autoHideMenuBar: true }],
    ['darwin', { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 11 } }],
    ['linux', { autoHideMenuBar: true }],
  ] as const)('configures %s menus, title bar, and theme', async (platform, options) => {
    usePlatform(platform)
    const { createWindow, setTitleBarTheme } = await import('../main/index')
    const { installApplicationMenu } = await import('../main/menu')
    installApplicationMenu({ sendAction: vi.fn() })
    const { window } = createWindow()
    expect(window).toHaveProperty('options', expect.objectContaining({
      ...options,
      backgroundColor: '#161615',
      webPreferences: expect.objectContaining({ contextIsolation: true, sandbox: true }),
    }))
    if (platform === 'darwin') {
      expect(electron.buildFromTemplate).toHaveBeenCalledOnce()
      expect(electron.setApplicationMenu).toHaveBeenCalledWith({ macMenu: true })
      expect(window.setMenuBarVisibility).not.toHaveBeenCalled()
    } else {
      expect(electron.buildFromTemplate).not.toHaveBeenCalled()
      expect(electron.setApplicationMenu).toHaveBeenCalledExactlyOnceWith(null)
      expect(window.setMenuBarVisibility).toHaveBeenCalledExactlyOnceWith(false)
    }

    const sender = window.webContents
    const event = { sender, senderFrame: sender.mainFrame } as IpcMainInvokeEvent
    expect(setTitleBarTheme(event, 'light')).toEqual({ ok: true })
    expect(setTitleBarTheme(event, 'dark')).toEqual({ ok: true })
    expect(vi.mocked(window.setBackgroundColor).mock.calls).toEqual([['#f6f4ef'], ['#161615']])
    expect(vi.mocked(window.setTitleBarOverlay).mock.calls).toEqual(platform === 'win32' ? [[light], [dark]] : [])
    window.emit('closed')
  })

  it('rejects malformed themes and senders without changing the window', async () => {
    usePlatform('win32')
    const { createWindow, setTitleBarTheme } = await import('../main/index')
    const { window } = createWindow()
    const sender = window.webContents
    const event = { sender, senderFrame: sender.mainFrame } as IpcMainInvokeEvent
    for (const args of [[], ['Dark'], [null], [1], [{ theme: 'light' }], ['dark', 'light']]) {
      expect(() => setTitleBarTheme(event, ...args)).toThrow('INVALID_ARGUMENT')
    }
    for (const senderFrame of [null, { url: sender.mainFrame.url }]) {
      expect(() => setTitleBarTheme({ ...event, senderFrame } as IpcMainInvokeEvent, 'dark'))
        .toThrow('FORBIDDEN_SENDER')
    }
    const forged = { id: sender.id, mainFrame: sender.mainFrame, isDestroyed: () => false }
    expect(() => setTitleBarTheme({ ...event, sender: forged } as IpcMainInvokeEvent, 'light'))
      .toThrow('FORBIDDEN_SENDER')
    Object.defineProperty(sender.mainFrame, 'url', { value: 'https://example.test/' })
    expect(() => setTitleBarTheme(event, 'dark')).toThrow('FORBIDDEN_SENDER')
    vi.mocked(window.isDestroyed).mockReturnValue(true)
    expect(() => setTitleBarTheme(event, 'dark')).toThrow('FORBIDDEN_SENDER')
    window.emit('closed')
    expect(() => setTitleBarTheme(event, 'dark')).toThrow('FORBIDDEN_SENDER')
    expect(window.setBackgroundColor).not.toHaveBeenCalled()
    expect(window.setTitleBarOverlay).not.toHaveBeenCalled()
  })
})

it.each([
  ['win32', 138, 0],
  ['darwin', 0, 72],
  ['linux', 0, 0],
] as const)('exposes only the read-only chrome metadata and theme method on %s', async (platform, rightInsetPx, leftInsetPx) => {
  usePlatform(platform)
  vi.resetModules()
  await import('../preload/index')
  expect(electron.expose.mock.calls.map(([name]) => name)).toEqual(['cunlian', 'cunlianDesktop'])
  const api: CunlianDesktopApi = electron.expose.mock.calls[1][1]
  expect(Object.keys(api).sort()).toEqual(['setTitleBarTheme', 'windowChrome'])
  expect(api.windowChrome).toEqual({ platform, rightInsetPx, leftInsetPx, hasCustomTitlebar: true, titlebarHeightPx: 36 })
  expect(Object.isFrozen(api.windowChrome)).toBe(true)
  electron.invoke.mockResolvedValue({ ok: true })
  await expect(api.setTitleBarTheme('light')).resolves.toEqual({ ok: true })
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith('window:setTitleBarTheme', 'light')
})
