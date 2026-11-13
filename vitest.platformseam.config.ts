import { defineConfig } from 'vitest/config'

/** 平台防腐层证据生成器（显式运行，不进入常规测试套件）。 */
export default defineConfig({
  test: {
    include: ['scripts/platform-seam-redaction-evidence.ts'],
    environment: 'node',
    setupFiles: [],
    testTimeout: 60_000,
  },
})
