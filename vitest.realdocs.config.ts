import { defineConfig } from 'vitest/config'

/**
 * 真实文档基线回归测试专用配置（`npm run test:real-docs`）。
 *
 * 与 vite.config.ts（默认 npm test，只跑 src/**）分开：
 * - 该套件需要本机自备 6 份真实 PDF（REAL_DOC_CORPUS），仓库不提交语料；
 * - CI 上没有语料时它会以 CORPUS_MISSING 失败（有意如此，不静默跳过），
 *   因此默认套件不包含它，避免无关改动因缺语料变红。
 *
 * 判据见 docs/evidence/real-doc-baseline/README.md。
 */
export default defineConfig({
  test: {
    include: ['scripts/real-docs/**/*.test.ts'],
    environment: 'node',
    setupFiles: [],
    // 6 份 PDF 全篇提取（含 170 页标准）在慢机上也要留足时间
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
})
