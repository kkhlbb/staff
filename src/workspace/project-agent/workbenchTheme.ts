export type WorkbenchTheme = 'light' | 'dark'

export const WORKBENCH_THEME_STORAGE_KEY = 'cunlian.workbench.theme'

export function readStoredWorkbenchTheme(fallback: WorkbenchTheme = 'light'): WorkbenchTheme {
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
