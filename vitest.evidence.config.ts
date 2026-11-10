import { defineConfig } from 'vitest/config'

/**
 * 证据生成脚本专用配置（只在 `npm run evidence:record` 时使用）。
 *
 * 与 vite.config.ts（npm test，include src/**）和 vitest.desktop.config.ts
 * （test:desktop，include desktop/tests/**）分开：证据生成器不会混进任何
 * 常规测试套件，避免每次测试重写仓库里的已提交证据。
 */
export default defineConfig({
  test: {
    include: ['scripts/evidence-record.ts'],
    environment: 'node',
    setupFiles: [],
  },
})
