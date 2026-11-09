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
