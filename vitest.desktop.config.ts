import { defineConfig } from 'vitest/config'

/**
 * 桌面主进程/preload 的单元测试配置。
 *
 * 与浏览器入口的 vite.config.ts（include 只有 src 下的 *.test.{ts,tsx}）分开：
 * desktop/tests 需要 Node 环境与 fs，不会污染现有 npm test。
 */
export default defineConfig({
  test: {
    include: ['desktop/tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: [],
  },
})
