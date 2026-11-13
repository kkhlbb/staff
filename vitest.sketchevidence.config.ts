import { defineConfig } from 'vitest/config'

/** 手绘草图入口证据脚本专用配置（不会混进 npm test）。 */
export default defineConfig({
  test: {
    include: ['scripts/sketch-input-evidence.ts'],
    environment: 'node',
    setupFiles: [],
    testTimeout: 120_000,
  },
})
