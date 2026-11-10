import { defineConfig } from 'vite'

/**
 * preload 必须是与 sandbox=true 兼容的 CJS 单文件；Forge 插件默认输出
 * `[name].cjs`，这里固定为 `preload.cjs`，避免与主进程产物同名覆盖。
 */
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'preload.cjs',
        chunkFileNames: 'preload.cjs',
        codeSplitting: false,
      },
    },
  },
})
