import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { printFontCandidates, resolvePrintFontPath } from '../main/printAssets'

describe('C 打印字体资源定位', () => {
  it('优先打包后的 renderer 产物，再回退开发期 public/fonts', () => {
    const appPath = '/Applications/寸链.app/Contents/Resources/app.asar'
    expect(printFontCandidates(appPath, 'font.woff2')).toEqual([
      path.join(appPath, '.vite', 'renderer', 'drawing_print', 'fonts', 'font.woff2'),
      path.join(appPath, 'public', 'fonts', 'font.woff2'),
    ])
  })

  it('只接受真实存在的候选；全部缺失返回 null（由调用方报 FONT_UNAVAILABLE）', async () => {
    const appPath = '/app'
    const packaged = path.join(appPath, '.vite/renderer/drawing_print/fonts/f.woff2')
    const found = await resolvePrintFontPath(appPath, 'f.woff2', async (targetPath) => {
      if (targetPath !== packaged) throw new Error('ENOENT')
    })
    expect(found).toBe(packaged)
    const missing = await resolvePrintFontPath(appPath, 'f.woff2', async () => {
      throw new Error('ENOENT')
    })
    expect(missing).toBeNull()
  })
})
