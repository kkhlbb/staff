import { defineConfig } from 'vitest/config'

/** DXF 导出 v1 证据生成器（显式运行，不进入常规测试套件）。 */
export default defineConfig({
  test: {
    include: ['scripts/dxf-export-evidence.ts'],
    environment: 'node',
    setupFiles: [],
  },
})
