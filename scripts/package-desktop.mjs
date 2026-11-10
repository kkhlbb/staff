#!/usr/bin/env node
/**
 * 打包入口：先跑 electron-forge package，成功后立即执行构建级断言
 * `scripts/assert-packaged-pdf-worker.mjs`。worker 没进 asar 时打包命令以
 * 非零退出码失败，而不是等到用户点「导入资料」才炸。
 *
 * 用法与 electron-forge package 一致，参数原样转发：
 *   npm run package:desktop -- --arch=arm64
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const forge = path.join(root, 'node_modules', '.bin', 'electron-forge')

const packaged = spawnSync(forge, ['package', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
})
if (packaged.error) throw packaged.error
if (packaged.status !== 0) {
  process.exit(packaged.status ?? 1)
}

const asserted = spawnSync(
  process.execPath,
  [path.join(root, 'scripts', 'assert-packaged-pdf-worker.mjs')],
  { cwd: root, stdio: 'inherit' },
)
if (asserted.error) throw asserted.error
process.exit(asserted.status ?? 1)
