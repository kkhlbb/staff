import { defineConfig } from 'vite'

/**
 * 取证脚本构建（V3-C）：把 e2e/pdfHarness 打成 CJS，用本机 Electron 运行。
 * 不进入产品 bundle；只用于真实 printToPDF 与 PDF 结构取证。
 */
export default defineConfig({
  build: {
    ssr: 'desktop/tests/e2e/pdfHarness.ts',
    outDir: '.vite/harness',
    target: 'node20',
    emptyOutDir: true,
    rollupOptions: {
      external: ['electron', 'node:fs', 'node:path', 'node:url', 'node:zlib', 'node:crypto'],
      output: {
        format: 'cjs',
        entryFileNames: 'pdf-harness.cjs',
        chunkFileNames: '[name].cjs',
      },
    },
  },
})
