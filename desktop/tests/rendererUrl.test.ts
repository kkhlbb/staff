import { describe, expect, it } from 'vitest'
import {
  isDevServerFrameUrl,
  isProductionRendererUrl,
  normalizeDevServerUrl,
} from '../main/rendererUrl'

const RENDERER_PATH =
  '/Applications/寸链.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.desktop.html'

describe('isProductionRendererUrl', () => {
  it('接受与打包入口完全一致的 file URL（含百分号编码）', () => {
    const encoded =
      'file:///Applications/%E5%AF%B8%E9%93%BE.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.desktop.html'
    expect(isProductionRendererUrl(encoded, RENDERER_PATH)).toBe(true)
  })

  it('拒绝其它本地文件、http 与 data URL', () => {
    expect(isProductionRendererUrl('file:///tmp/evil.html', RENDERER_PATH)).toBe(false)
    expect(isProductionRendererUrl('https://evil.example/', RENDERER_PATH)).toBe(false)
    expect(isProductionRendererUrl('data:text/html,<h1>x</h1>', RENDERER_PATH)).toBe(false)
    expect(isProductionRendererUrl('not a url', RENDERER_PATH)).toBe(false)
  })

  it('不接受同目录的其它 html', () => {
    const other =
      'file:///Applications/%E5%AF%B8%E9%93%BE.app/Contents/Resources/app.asar/.vite/renderer/main_window/other.html'
    expect(isProductionRendererUrl(other, RENDERER_PATH)).toBe(false)
  })

  it('拒绝 POSIX 路径带非空 hostname 的 file URL', () => {
    const spoofed =
      'file://attacker/Applications/%E5%AF%B8%E9%93%BE.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.desktop.html'
    expect(isProductionRendererUrl(spoofed, RENDERER_PATH)).toBe(false)
  })

  it('Windows：接受带盘符、反斜杠、中文目录与大小写差异的 file:///C:/... URL', () => {
    const winPath =
      'C:\\Users\\Alice\\AppData\\Local\\Programs\\寸链\\resources\\app.asar\\.vite\\renderer\\main_window\\index.desktop.html'
    const encoded =
      'file:///C:/Users/Alice/AppData/Local/Programs/%E5%AF%B8%E9%93%BE/resources/app.asar/.vite/renderer/main_window/index.desktop.html'
    const lowerDriveAndHash =
      'file:///c:/users/alice/appdata/local/programs/%E5%AF%B8%E9%93%BE/resources/app.asar/.vite/renderer/main_window/index.desktop.html#/desktop-legacy'
    const extendedWinPath = `\\\\?\\${winPath}`
    const spacedWinPath =
      'D:\\My Apps\\寸链 1.0\\resources\\app.asar\\.vite\\renderer\\main_window\\index.desktop.html'
    const spacedUrl =
      'file:///D:/My%20Apps/%E5%AF%B8%E9%93%BE%201.0/resources/app.asar/.vite/renderer/main_window/index.desktop.html'

    expect(isProductionRendererUrl(encoded, winPath)).toBe(true)
    expect(isProductionRendererUrl(lowerDriveAndHash, winPath)).toBe(true)
    expect(isProductionRendererUrl(encoded, extendedWinPath)).toBe(true)
    expect(isProductionRendererUrl(spacedUrl, spacedWinPath)).toBe(true)
  })

  it('Windows：接受 UNC 共享路径并拒绝错误盘符/主机/文件', () => {
    const uncPath =
      '\\\\fileserver\\share\\寸链\\resources\\app.asar\\.vite\\renderer\\main_window\\index.desktop.html'
    const uncUrl =
      'file://fileserver/share/%E5%AF%B8%E9%93%BE/resources/app.asar/.vite/renderer/main_window/index.desktop.html'
    expect(isProductionRendererUrl(uncUrl, uncPath)).toBe(true)

    const winPath =
      'C:\\Users\\Alice\\Programs\\寸链\\resources\\app.asar\\.vite\\renderer\\main_window\\index.desktop.html'
    expect(
      isProductionRendererUrl(
        'file:///D:/Users/Alice/Programs/%E5%AF%B8%E9%93%BE/resources/app.asar/.vite/renderer/main_window/index.desktop.html',
        winPath,
      ),
    ).toBe(false)
    expect(
      isProductionRendererUrl(
        'file://evil-host/C:/Users/Alice/Programs/%E5%AF%B8%E9%93%BE/resources/app.asar/.vite/renderer/main_window/index.desktop.html',
        winPath,
      ),
    ).toBe(false)
    expect(
      isProductionRendererUrl(
        'file:///C:/Users/Alice/Programs/%E5%AF%B8%E9%93%BE/resources/app.asar/.vite/renderer/main_window/other.html',
        winPath,
      ),
    ).toBe(false)
  })
})

describe('isDevServerFrameUrl', () => {
  it('只接受同源地址', () => {
    expect(
      isDevServerFrameUrl('http://localhost:5173/', 'http://localhost:5173/'),
    ).toBe(true)
    expect(
      isDevServerFrameUrl('http://localhost:5173/index.html', 'http://localhost:5173/'),
    ).toBe(true)
    expect(
      isDevServerFrameUrl('http://localhost:9999/', 'http://localhost:5173/'),
    ).toBe(false)
    expect(
      isDevServerFrameUrl('https://localhost:5173/', 'http://localhost:5173/'),
    ).toBe(false)
  })

  it('拒绝非 loopback 的开发地址', () => {
    expect(isDevServerFrameUrl('http://10.0.0.5:5173/', 'http://10.0.0.5:5173/')).toBe(false)
  })
})

describe('normalizeDevServerUrl', () => {
  it('接受 loopback http，拒绝 https 与远程主机', () => {
    expect(normalizeDevServerUrl('http://localhost:5173/')).toBe('http://localhost:5173/')
    expect(normalizeDevServerUrl('http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173/')
    expect(normalizeDevServerUrl('https://localhost:5173/')).toBeNull()
    expect(normalizeDevServerUrl('http://192.168.1.20:5173/')).toBeNull()
    expect(normalizeDevServerUrl(undefined)).toBeNull()
    expect(normalizeDevServerUrl('')).toBeNull()
  })
})
