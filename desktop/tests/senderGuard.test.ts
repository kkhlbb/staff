import { describe, expect, it } from 'vitest'
import { SenderGuard } from '../main/senderGuard'

const PROD_URL =
  'file:///Applications/%E5%AF%B8%E9%93%BE.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.desktop.html'

function registerWindow(
  guard: SenderGuard,
  overrides: {
    webContentsId?: number
    destroyed?: boolean
    allowedUrl?: string
    index?: string
  } = {},
): void {
  const id = overrides.webContentsId ?? 1
  const allowedUrl = overrides.allowedUrl ?? PROD_URL
  guard.register({
    webContentsId: id,
    isDestroyed: () => overrides.destroyed ?? false,
    isAllowedFrameUrl: (url) => url === allowedUrl,
  })
}

describe('SenderGuard', () => {
  it('接受登记窗口的主框架合法 URL', () => {
    const guard = new SenderGuard()
    registerWindow(guard)
    expect(
      guard.verify({ webContentsId: 1, frameUrl: PROD_URL, isMainFrame: true }),
    ).toEqual({ ok: true })
  })

  it('拒绝未登记 WebContents', () => {
    const guard = new SenderGuard()
    registerWindow(guard)
    const verdict = guard.verify({
      webContentsId: 99,
      frameUrl: PROD_URL,
      isMainFrame: true,
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.error.code).toBe('FORBIDDEN_SENDER')
    }
  })

  it('拒绝已销毁窗口', () => {
    const guard = new SenderGuard()
    registerWindow(guard, { destroyed: true })
    const verdict = guard.verify({
      webContentsId: 1,
      frameUrl: PROD_URL,
      isMainFrame: true,
    })
    expect(verdict.ok).toBe(false)
  })

  it('拒绝子框架调用', () => {
    const guard = new SenderGuard()
    registerWindow(guard)
    const verdict = guard.verify({
      webContentsId: 1,
      frameUrl: PROD_URL,
      isMainFrame: false,
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.error.detail).toContain('子框架')
    }
  })

  it('拒绝 null frame URL 与非法 URL', () => {
    const guard = new SenderGuard()
    registerWindow(guard)
    expect(guard.verify({ webContentsId: 1, frameUrl: null, isMainFrame: true }).ok).toBe(false)
    expect(
      guard.verify({
        webContentsId: 1,
        frameUrl: 'https://evil.example/',
        isMainFrame: true,
      }).ok,
    ).toBe(false)
    expect(
      guard.verify({
        webContentsId: 1,
        frameUrl: 'file:///Users/aston/other.html',
        isMainFrame: true,
      }).ok,
    ).toBe(false)
  })

  it('注销后立即失效', () => {
    const guard = new SenderGuard()
    registerWindow(guard)
    guard.unregister(1)
    expect(
      guard.verify({ webContentsId: 1, frameUrl: PROD_URL, isMainFrame: true }).ok,
    ).toBe(false)
  })
})
