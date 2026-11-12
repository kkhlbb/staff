import { defineConfig } from 'vitest/config'

/** V4.0 阶段 4 导出产物证据（显式运行，不进入常规测试）。 */
export default defineConfig({
  test: {
    include: ['scripts/v40-stage4-export-artifact.ts'],
    environment: 'node',
    setupFiles: [],
  },
})
