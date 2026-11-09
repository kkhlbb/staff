/**
 * 打印字体资源定位（V3-C）。
 *
 * 打包后 `public/` 源目录不进入 asar，但 Vite 会把 public 复制到渲染产物
 * `.vite/renderer/drawing_print/fonts/`；开发态则仍在项目 `public/fonts/`。
 * 两个位置都试，找不到就明确失败（FONT_UNAVAILABLE），不静默回退系统字体。
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'

export function printFontCandidates(appPath: string, fileName: string): string[] {
  return [
    path.join(appPath, '.vite', 'renderer', 'drawing_print', 'fonts', fileName),
    path.join(appPath, 'public', 'fonts', fileName),
  ]
}

export async function resolvePrintFontPath(
  appPath: string,
  fileName: string,
  access: (targetPath: string) => Promise<void> = (targetPath) => fsp.access(targetPath),
): Promise<string | null> {
  for (const candidate of printFontCandidates(appPath, fileName)) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // 继续下一个候选；全部不存在时返回 null。
    }
  }
  return null
}
