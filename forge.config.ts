import type { ForgeConfig } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { prepareStepAssets } from './scripts/step-assets.mjs'
import { copyPlatformRuntimeNotices } from './scripts/platform-runtime-notices.mjs'

/**
 * 离线打包：本机网络不可用时，@electron/get 仍会去取 SHASUMS256.txt 而失败。
 * 设置 ELECTRON_ZIP_DIR 指向本地缓存目录（含 electron-v<版本>-<平台>-<架构>.zip）
 * 可完全跳过下载；不设置时行为与原来一致（官方下载 + 校验）。
 */
const electronZipDir = process.env.ELECTRON_ZIP_DIR

const config: ForgeConfig = {
  packagerConfig: {
    name: '寸链',
    appBundleId: 'com.kkhlbb.cunlian',
    asar: true,
    // Preserve Vite's package allowlist: no node_modules (old npm/cache) or vendor.
    ignore: file => Boolean(file) && !file.startsWith('/.vite'),
    extraResource: [prepareStepAssets()],
    ...(electronZipDir === undefined ? {} : { electronZipDir }),
  },
  hooks: {
    postPackage: async (_config, result) => {
      for (const output of result.outputPaths) copyPlatformRuntimeNotices(output, result.platform, result.arch)
    },
  },
  rebuildConfig: {},
  makers: [],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'desktop/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'desktop/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
        {
          name: 'drawing_print',
          config: 'vite.print.config.ts',
        },
      ],
    }),
  ],
}

export default config
