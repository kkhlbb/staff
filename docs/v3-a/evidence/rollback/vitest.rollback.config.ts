import { defineConfig } from 'vitest/config'

/**
 * 回退实验专用配置（不改动仓库既有 npm test / test:desktop 的 include）。
 *
 * 只把 docs/v3-a/evidence/rollback 下的校验用例纳入，便于原样保留红/绿证据。
 */
export default defineConfig({
  test: {
    include: ['docs/v3-a/evidence/rollback/**/*.test.ts'],
    environment: 'node',
    setupFiles: [],
  },
})
