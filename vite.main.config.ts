import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build, defineConfig, type ConfigEnv, type Plugin, type UserConfig } from 'vite'

/**
 * Forge 的 Vite 插件默认用入口文件名作 `[name].cjs`，而本仓库主进程入口是
 * `desktop/main/index.ts`、preload 入口是 `desktop/preload/index.ts`，两者会
 * 撞成同一个 `index.cjs`。这里显式固定主进程产物名为 `main.cjs`，与
 * package.json 的 `main` 字段和 preload 的 `preload.cjs` 区分开。
 */
interface ForgeViteEnv extends ConfigEnv {
  forgeConfigSelf: { entry: string }
}

/** 与 pdfjs-dist 同版本的 worker 源文件（精确版本见 package.json）。 */
const PDF_WORKER_SOURCE = fileURLToPath(
  new URL('./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url),
)

/**
 * 主进程（Node 环境）里 pdfjs 使用 fake worker，会动态 import worker 模块；
 * Rollup 不会把动态 import 的模块内联进 main.cjs，因此必须把 worker 作为
 * 独立文件发到 `.vite/build/`，与 main.cjs 同目录。Forge 只把 `.vite` 打进
 * asar，所以这个文件会随包进入 `app.asar/.vite/build/pdf.worker.mjs`。
 *
 * 生产解析侧（desktop/main/pdfSourceInspect.ts）用绝对 file URL 指向同目录
 * 文件，不再依赖 pdfjs 默认的相对路径 `./pdf.worker.mjs` 由谁解析。
 */
function pdfWorkerAsset(): Plugin {
  return {
    name: 'cunlian-pdf-worker-asset',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'pdf.worker.mjs',
        source: readFileSync(PDF_WORKER_SOURCE),
      })
    },
  }
}

function m2WorkerAssets(): Plugin {
  return {
    name: 'cunlian-m2-worker-assets',
    apply: 'build',
    async generateBundle() {
      const resolve = (file: string) => fileURLToPath(new URL(file, import.meta.url))
      for (const [entry, fileName] of [
        ['./src/core/geometry/geometryWorker.mjs', 'm2-geometry-worker.mjs'],
        ['./src/core/solver/solverWorker.mjs', 'solverWorker.mjs'],
      ]) {
        const worker = await build({
          configFile: false,
          publicDir: false,
          logLevel: 'error',
          build: {
            write: false, minify: false,
            ssr: resolve(entry),
            target: 'esnext',
            rolldownOptions: { output: { entryFileNames: fileName, inlineDynamicImports: true } },
          },
        })
        if (Array.isArray(worker) || !('output' in worker)) throw Error('Expected one M2 worker output')
        for (const output of worker.output) {
          this.emitFile({ type: 'asset', fileName: 'm2-worker/' + output.fileName, source: output.type === 'chunk' ? output.code : output.source })
        }
      }
      for (const [fileName, source] of [
        ['fixture.json', './desktop/main/geometry-prototype/fixture.json'],
      ]) this.emitFile({ type: 'asset', fileName: 'm2-worker/' + fileName, source: readFileSync(resolve(source)) })
    },
  }
}

export default defineConfig((env) => {
  const forgeEnv = env as ForgeViteEnv
  return {
    plugins: [pdfWorkerAsset(), m2WorkerAssets()],
    build: {
      lib: {
        entry: forgeEnv.forgeConfigSelf.entry,
        formats: ['cjs'],
        fileName: () => 'main.cjs',
      },
    },
  } satisfies UserConfig
})
