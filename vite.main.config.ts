import { defineConfig, type ConfigEnv, type UserConfig } from 'vite'

/**
 * Forge 的 Vite 插件默认用入口文件名作 `[name].cjs`，而本仓库主进程入口是
 * `desktop/main/index.ts`、preload 入口是 `desktop/preload/index.ts`，两者会
 * 撞成同一个 `index.cjs`。这里显式固定主进程产物名为 `main.cjs`，与
 * package.json 的 `main` 字段和 preload 的 `preload.cjs` 区分开。
 */
interface ForgeViteEnv extends ConfigEnv {
  forgeConfigSelf: { entry: string }
}

export default defineConfig((env) => {
  const forgeEnv = env as ForgeViteEnv
  return {
    build: {
      lib: {
        entry: forgeEnv.forgeConfigSelf.entry,
        formats: ['cjs'],
        fileName: () => 'main.cjs',
      },
    },
  } satisfies UserConfig
})
