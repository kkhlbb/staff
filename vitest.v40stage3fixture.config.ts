import { defineConfig } from 'vitest/config'

/** V4.0 阶段 3 打包走查夹具生成器专用配置（显式命令时运行）。 */
export default defineConfig({
  test: {
    include: ['scripts/v40-stage3-seed.ts'],
    environment: 'node',
    setupFiles: [],
  },
})
