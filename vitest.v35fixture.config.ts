import { defineConfig } from 'vitest/config'

/**
 * V3.5 证据生成器专用配置（只在显式命令时运行，不属于任何常规测试套件）。
 *
 *   V35_SEED_OUT=/abs/path/P35-imported-seed.cunlian \
 *     npx vitest run --config vitest.v35fixture.config.ts
 *
 * 目的：把合成任务书 PDF 通过真实 main `source:import` 通道写进项目文件，
 * 供打包应用 open-file 打开并截图。常规 npm test / test:desktop 不包含本目录。
 */
export default defineConfig({
  test: {
    include: ['scripts/v35-seed.ts'],
    environment: 'node',
    setupFiles: [],
  },
})
