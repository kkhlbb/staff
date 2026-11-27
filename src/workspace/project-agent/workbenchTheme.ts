export type WorkbenchTheme = 'light' | 'dark'

export const WORKBENCH_THEME_STORAGE_KEY = 'cunlian.workbench.theme'
export const WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY = 'cunlian.workbench.sidebarWidth'
export const SIDEBAR_WIDTH_MIN = 300
export const SIDEBAR_WIDTH_MAX = 560
export const SIDEBAR_WIDTH_DEFAULT = 388

export interface WindowChromeInfo {
  readonly platform: 'win32' | 'darwin' | 'linux'
  readonly hasCustomTitlebar: boolean
  readonly titlebarHeightPx: 36
  readonly rightInsetPx: number
  readonly leftInsetPx: number
}

interface CunlianDesktopChromeBridge {
  readonly windowChrome?: WindowChromeInfo
  readonly setTitleBarTheme?: (theme: WorkbenchTheme) => Promise<{ readonly ok: true }> | void
}

function getDesktopBridge(): CunlianDesktopChromeBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as Window & { readonly cunlianDesktop?: CunlianDesktopChromeBridge }).cunlianDesktop
}

export function readWindowChromeInfo(): WindowChromeInfo | null {
  try {
    const chrome = getDesktopBridge()?.windowChrome
    if (!chrome || typeof chrome !== 'object') return null
    return chrome
  } catch {
    return null
  }
}

export function syncWindowTitleBarTheme(theme: WorkbenchTheme): void {
  try {
    const res = getDesktopBridge()?.setTitleBarTheme?.(theme)
    if (res && typeof (res as Promise<unknown>).catch === 'function') {
      void (res as Promise<unknown>).catch(() => undefined)
    }
  } catch {
    // Non-desktop or restricted host environment: no-op
  }
}

export function readStoredWorkbenchTheme(fallback: WorkbenchTheme = 'dark'): WorkbenchTheme {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return fallback
    }
    const stored = window.localStorage.getItem(WORKBENCH_THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') {
      return stored
    }
    return fallback
  } catch {
    return fallback
  }
}

export function persistWorkbenchTheme(theme: WorkbenchTheme): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false
    }
    window.localStorage.setItem(WORKBENCH_THEME_STORAGE_KEY, theme)
    return true
  } catch {
    return false
  }
}

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, Math.round(width)))
}

export function readStoredSidebarWidth(fallback: number = SIDEBAR_WIDTH_DEFAULT): number {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return clampSidebarWidth(fallback)
    }
    const raw = window.localStorage.getItem(WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY)
    if (raw === null) return clampSidebarWidth(fallback)
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : clampSidebarWidth(fallback)
  } catch {
    return clampSidebarWidth(fallback)
  }
}

export function persistSidebarWidth(width: number): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false
    }
    window.localStorage.setItem(WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)))
    return true
  } catch {
    return false
  }
}
