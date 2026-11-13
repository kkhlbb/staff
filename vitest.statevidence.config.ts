import { defineConfig } from 'vitest/config'

/** 统计公差与历史版本重出证据生成器（显式运行，不进入常规测试套件）。 */
export default defineConfig({
  test: {
    include: [
      'scripts/stat-tolerance-evidence.ts',
      'scripts/drawing-redraw-evidence.ts',
    ],
    environment: 'node',
    setupFiles: [],
    testTimeout: 120_000,
  },
})
