import { defineConfig } from 'vitest/config'

/**
 * V3.6 阶段 1 证据生成器专用配置（只在显式命令时运行，不属于任何常规测试套件）。
 *
 *   npx vitest run --config vitest.v36evidence.config.ts
 *
 * 产出：docs/evidence/V3.6/1110-extraction.json、bad-samples.json。
 * 常规 npm test / test:desktop 不包含本目录。
 */
export default defineConfig({
  test: {
    include: ['scripts/v36-evidence.ts'],
    environment: 'node',
    setupFiles: [],
  },
})
