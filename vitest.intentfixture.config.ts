import { defineConfig } from 'vitest/config'

/** ADR-001 第 3 步打包走查夹具生成器专用配置（显式命令时运行）。 */
export default defineConfig({
  test: {
    include: ['scripts/intent-seed.ts'],
    environment: 'node',
    setupFiles: [],
  },
})
