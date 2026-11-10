/**
 * 渲染入口 URL 判定（与 Electron 无关，便于单元测试）。
 *
 * 判定刻意收紧：生产只认打包后的那一个 index.desktop.html；开发只认同源
 * 本地 Vite 地址。不做“前缀包含 localhost”这类可被路径/端口绕过的判断。
 */

export function isProductionRendererUrl(url: string, rendererIndexPath: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'file:') {
    return false
  }
  let pathname: string
  try {
    pathname = decodeURIComponent(parsed.pathname)
  } catch {
    return false
  }
  return pathname === rendererIndexPath
}

export function isDevServerFrameUrl(url: string, devServerUrl: string): boolean {
  let frame: URL
  let dev: URL
  try {
    frame = new URL(url)
    dev = new URL(devServerUrl)
  } catch {
    return false
  }
  if (dev.protocol !== 'http:') {
    return false
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (!loopbackHosts.has(dev.hostname)) {
    return false
  }
  return frame.origin === dev.origin
}

/** Forge 注入的 Vite 地址只在 loopback http 下被接受。 */
export function normalizeDevServerUrl(raw: string | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (parsed.protocol !== 'http:' || !loopbackHosts.has(parsed.hostname)) {
    return null
  }
  return parsed.toString()
}
