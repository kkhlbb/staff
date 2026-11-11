import { defineConfig } from 'vitest/config'

/** V4.0 阶段 4 打包走查夹具生成（显式运行，不进入常规测试）。 */
export default defineConfig({
  test: {
    include: ['scripts/v40-stage4-seed.ts'],
    environment: 'node',
    setupFiles: [],
  },
})
