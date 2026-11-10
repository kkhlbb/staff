import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * 专用图纸打印入口（V3-C）：独立 HTML 与独立 bundle，绝不加载工作台页面。
 * 输出到 `.vite/renderer/drawing_print/`，main 用隐藏 BrowserWindow 加载。
 */
export default defineConfig({
  // file:// 加载的专用入口：资源必须相对，不能用站点根 /assets。
  base: './',
  build: {
    rollupOptions: {
      input: fileURLToPath(new URL('./index.print.html', import.meta.url)),
    },
  },
})
