#!/usr/bin/env node
/**
 * 构建级断言：打包产物里 main.cjs 运行时必须能加载到 pdf worker。
 *
 * 背景：主进程（Node）里 pdfjs 用 fake worker，会动态 import 与 main.cjs 同
 * 目录的 worker 模块。worker 不进 asar 时，dev/测试都能过，打包应用一导入
 * PDF 就报 `Setting up fake worker failed: Cannot find module ...pdf.worker.mjs`。
 *
 * 本脚本只读 `app.asar`，不修改任何文件：
 * - 从 asar 取出 package.json 的 main 入口，再取出 main.cjs；
 * - 从 main.cjs 中找出运行时引用的 pdf worker 文件名（不写死）；
 * - 断言该文件确实存在于 main.cjs 所在目录（asar 内），且非空；
 * - 断言它与本机安装的 pdfjs-dist 同版本 worker 字节完全一致；
 * - 断言文件内容确实注册了 `globalThis.pdfjsWorker`（是 worker 模块而不是
 *   随便一个同名文件）。
 *
 * 用法：
 *   node scripts/assert-packaged-pdf-worker.mjs [app.asar 路径]
 * 退出码：0 = 全部通过；1 = 断言失败；2 = 找不到打包产物。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFile, listPackage, statFile } from '@electron/asar'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const evidence = {}

function pass(name, detail) {
  console.log(`PASS ${name}${detail === undefined ? '' : `: ${detail}`}`)
}

function fail(name, detail) {
  console.log(`FAIL ${name}${detail === undefined ? '' : `: ${detail}`}`)
  failures.push(name)
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function defaultAsar() {
  const outDir = path.join(root, 'out')
  if (!existsSync(outDir)) return null
  for (const entry of readdirSync(outDir)) {
    const candidate = path.join(
      outDir,
      entry,
      '寸链.app',
      'Contents',
      'Resources',
      'app.asar',
    )
    if (existsSync(candidate)) return candidate
  }
  return null
}

const arg = process.argv[2]
const asarPath = arg === undefined ? defaultAsar() : path.resolve(arg)
if (asarPath === null || !existsSync(asarPath)) {
  console.error(`BLOCKED: 找不到打包产物 app.asar${arg === undefined ? '' : `（${arg}）`}；先运行 npm run package:desktop`)
  process.exit(2)
}
evidence.asar = asarPath

const entries = listPackage(asarPath).map((entry) => entry.replace(/\\/g, '/'))
/** @electron/asar 的 extractFile/statFile 接受不带前导斜杠的包内路径。 */
const inArchive = (entry) => entry.replace(/^\//, '')
const packageEntry = '/package.json'
if (!entries.includes(packageEntry)) {
  fail('package.json 在 asar 内')
} else {
  pass('package.json 在 asar 内')
}

const packageJson = JSON.parse(extractFile(asarPath, inArchive(packageEntry)).toString('utf8'))
const main = String(packageJson.main ?? '')
evidence.main = main
if (main === '') {
  fail('package.json main 字段存在')
} else {
  pass('package.json main 字段存在', main)
}

const mainEntry = main.startsWith('/') ? main : `/${main}`
if (!entries.includes(mainEntry)) {
  fail('main.cjs 在 asar 内', mainEntry)
  console.log(JSON.stringify(evidence, null, 2))
  process.exit(1)
}
pass('main.cjs 在 asar 内', mainEntry)

const mainSource = extractFile(asarPath, inArchive(mainEntry)).toString('utf8')
const workerNames = [
  ...new Set(
    [...mainSource.matchAll(/([A-Za-z0-9_.-]*pdf\.worker[A-Za-z0-9_.-]*\.mjs)/g)].map(
      (match) => match[1],
    ),
  ),
]
evidence.workerNamesInMain = workerNames
if (workerNames.length === 0) {
  fail('main.cjs 引用了 pdf worker 文件名')
} else {
  pass('main.cjs 引用了 pdf worker 文件名', workerNames.join(', '))
}

const mainDir = path.posix.dirname(mainEntry)
const installedWorkers = [
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  'node_modules/pdfjs-dist/build/pdf.worker.mjs',
  'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
]
  .map((relative) => path.join(root, relative))
  .filter((file) => existsSync(file))
  .map((file) => ({ file, bytes: readFileSync(file) }))

for (const name of workerNames) {
  const workerEntry = path.posix.join(mainDir, name)
  const listed = entries.includes(workerEntry)
  if (!listed) {
    fail('worker 文件在 main.cjs 同目录', workerEntry)
    continue
  }
  const info = statFile(asarPath, inArchive(workerEntry))
  const bytes = extractFile(asarPath, inArchive(workerEntry))
  const digest = sha256(bytes)
  const record = {
    entry: workerEntry,
    byteSize: bytes.byteLength,
    sha256: digest,
    statSize: info.size,
    unpacked: info.unpacked === true,
  }
  evidence.worker = record
  if (bytes.byteLength === 0) {
    fail('worker 非空', workerEntry)
    continue
  }
  pass('worker 文件在 main.cjs 同目录且非空', `${workerEntry} (${bytes.byteLength} bytes)`)
  if (info.size !== bytes.byteLength) {
    fail('worker 字节数与 asar 索引一致', `${info.size} != ${bytes.byteLength}`)
  }
  const matched = installedWorkers.find((candidate) => sha256(candidate.bytes) === digest)
  if (matched === undefined) {
    fail('worker 与本机 pdfjs-dist 同版本字节一致', digest)
  } else {
    pass('worker 与本机 pdfjs-dist 同版本字节一致', path.relative(root, matched.file))
  }
  const text = bytes.toString('utf8')
  if (!text.includes('globalThis.pdfjsWorker')) {
    fail('worker 模块注册 globalThis.pdfjsWorker', workerEntry)
  } else {
    pass('worker 模块注册 globalThis.pdfjsWorker', workerEntry)
  }
}

console.log(JSON.stringify(evidence, null, 2))

if (failures.length > 0) {
  console.error(`RESULT FAIL ${failures.length} 项断言未通过`)
  process.exit(1)
}
console.log('RESULT PASS 打包产物中的 pdf worker 可被 main.cjs 运行时加载')
