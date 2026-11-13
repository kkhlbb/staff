import { defineConfig } from 'vitest/config'

/**
 * V3.6 第 2 阶段证据生成器专用配置（只在显式命令时运行）。
 *
 *   V36_SEED_OUT=/abs/path/E2E-V36.cunlian \
 *     npx vitest run --config vitest.v36fixture.config.ts
 */
export default defineConfig({
  test: {
    include: [
      'scripts/v36-seed.ts',
      'scripts/v36-ui-seed.ts',
      'scripts/v36-ambiguous-seed.ts',
      'scripts/v36-drafts-seed.ts',
      'scripts/confirm-efficiency-seed.ts',
    ],
    environment: 'node',
    setupFiles: [],
  },
})
