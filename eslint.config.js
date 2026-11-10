import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage', '.vite', 'out']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
  {
    // Electron 主进程/preload、Forge 与 Vite 配置运行在 Node 侧；
    // 桌面渲染入口仍需要浏览器全局，因此两组全局都放进来。
    files: [
      'desktop/**/*.{ts,tsx}',
      'forge.config.ts',
      'vite.main.config.ts',
      'vite.preload.config.ts',
      'vite.renderer.config.ts',
      'vitest.desktop.config.ts',
      'desktop/tests/**/*.mjs',
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
])
