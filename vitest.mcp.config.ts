import { defineConfig } from 'vitest/config'

/**
 * MCP 工具与协议测试：Node 环境（会读写文件、走 pdfjs legacy）。
 * 与 `npm test`（src 渲染层）、`test:desktop`（Electron 主进程）分开。
 */
export default defineConfig({
  test: {
    include: ['mcp/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
