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

const option = (name, fallback) => {
  const args = process.argv.slice(2)
  const inline = args.find(a => a.startsWith(`--${name}=`))
  const i = args.indexOf(`--${name}`)
  return inline ? inline.slice(name.length + 3) : i >= 0 ? args[i + 1] : fallback
}
const platform = option('platform', process.platform)
const arch = option('arch', process.arch)
const output = path.join(root, 'out', `寸链-${platform}-${arch}`)
const resources = platform === 'darwin' ? path.join(output, '寸链.app/Contents/Resources') : path.join(output, 'resources')
for (const [script, target] of [
  ['assert-packaged-pdf-worker.mjs', path.join(resources, 'app.asar')],
  ['assert-packaged-step.mjs', resources],
]) {
  const asserted = spawnSync(process.execPath, [path.join(root, 'scripts', script), target], { cwd: root, stdio: 'inherit' })
  if (asserted.error) throw asserted.error
  if (asserted.status !== 0) process.exit(asserted.status ?? 1)
}
process.exit(0)
