#!/usr/bin/env node
/**
 * 平台防腐层证据（win32 打包体检）：只读检查 `electron-forge package --platform=win32` 的产物。
 *
 * 检查项：
 * 1. 产物目录与可执行文件存在、是 PE 可执行；
 * 2. `app.asar` 里的 pdf worker 能被 main.cjs 运行时加载（复用
 *    scripts/assert-packaged-pdf-worker.mjs 的断言，不另写一套）；
 * 3. asar 里没有 macOS 专属资源（.icns/.dylib/.app/Info.plist/entitlements 等）；
 * 4. `resources/` 里没有 mac 专属附加资源。
 *
 * 用法：node scripts/platform-seam-win32-evidence.mjs
 * 前置：npx electron-forge package --platform=win32 --arch=x64（日志见 logs/win32-package.log）
 * 输出：docs/evidence/platform-seam/win32-package.json（serializeEvidence）
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { listPackage } from '@electron/asar'

const repoRoot = process.cwd()
const packageDir = path.join(repoRoot, 'out', '寸链-win32-x64')
const asarPath = path.join(packageDir, 'resources', 'app.asar')
const probeDir = path.join(repoRoot, 'out', 'platform-seam-win32-probe')

await fsp.mkdir(probeDir, { recursive: true })
const tsc = spawnSync(
  path.join(repoRoot, 'node_modules', '.bin', 'tsc'),
  ['scripts/evidence-json.ts', '--outDir', probeDir, '--module', 'commonjs', '--target', 'es2022', '--moduleResolution', 'node', '--skipLibCheck', '--esModuleInterop', '--types', 'node'],
  { encoding: 'utf8' },
)
if (tsc.status !== 0) {
  console.error(`EVIDENCE_JSON_COMPILE_FAILED\n${tsc.stdout}${tsc.stderr}`)
  process.exit(1)
}
await fsp.rename(path.join(probeDir, 'evidence-json.js'), path.join(probeDir, 'evidence-json.cjs'))
const { serializeEvidence } = createRequire(import.meta.url)(path.join(probeDir, 'evidence-json.cjs'))

const exists = async (target) => {
  try {
    await fsp.stat(target)
    return true
  } catch {
    return false
  }
}

const report = { generator: 'platform-seam-win32-package-1', command: 'npx electron-forge package --platform=win32 --arch=x64' }

report.packageDirExists = await exists(packageDir)
if (!report.packageDirExists) {
  report.verdict = 'missing-package'
  await fsp.mkdir(path.join(repoRoot, 'docs', 'evidence', 'platform-seam'), { recursive: true })
  await fsp.writeFile(path.join(repoRoot, 'docs', 'evidence', 'platform-seam', 'win32-package.json'), serializeEvidence(report))
  console.error('PACKAGE_MISSING: 先跑 npx electron-forge package --platform=win32 --arch=x64')
  process.exit(2)
}

const entries = (await fsp.readdir(packageDir, { withFileTypes: true })).map((entry) => entry.name).sort()
const exe = entries.find((name) => name.endsWith('.exe'))
report.executable = exe === undefined ? null : { name: exe, bytes: (await fsp.stat(path.join(packageDir, exe))).size }
const fileKind = exe === undefined ? { status: 1, stdout: '' } : spawnSync('file', ['-b', path.join(packageDir, exe)], { encoding: 'utf8' })
report.executableKind = String(fileKind.stdout ?? '').trim()

report.resources = (await fsp.readdir(path.join(packageDir, 'resources'))).sort()
const asarBytes = await fsp.readFile(asarPath)
report.asar = {
  bytes: asarBytes.byteLength,
  sha256: createHash('sha256').update(asarBytes).digest('hex'),
}

const files = listPackage(asarPath)
const macLike = files.filter((file) => /\.(icns|dylib|pkg)$|\.app\/|entitlements|Info\.plist|PkgInfo|MacOS\//iu.test(file))
report.asarFiles = files.length
report.macSpecificEntries = macLike
report.macSpecificCount = macLike.length

// 复用既有断言：pdf worker 真的能被 main.cjs 运行时加载。
const workerCheck = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'assert-packaged-pdf-worker.mjs'), asarPath], { encoding: 'utf8' })
const workerOut = `${workerCheck.stdout}${workerCheck.stderr}`
report.pdfWorker = { exit: workerCheck.status, pass: workerCheck.status === 0 && workerOut.includes('RESULT PASS') }
report.pdfWorkerChecks = workerOut
  .split('\n')
  .filter((line) => line.startsWith('PASS ') || line.startsWith('FAIL '))
  .map((line) => line.trim())
const workerJson = workerOut.slice(workerOut.indexOf('{'), workerOut.lastIndexOf('}') + 1)
try {
  const parsed = JSON.parse(workerJson)
  report.pdfWorkerEntry = parsed.worker?.entry ?? null
  report.pdfWorkerBytes = parsed.worker?.byteSize ?? null
  report.pdfWorkerSha256 = parsed.worker?.sha256 ?? null
} catch {
  report.pdfWorkerEntry = null
}

const packageLog = await fsp.readFile(path.join(repoRoot, 'docs', 'evidence', 'platform-seam', 'logs', 'win32-package.log'), 'utf8').catch(() => '')
report.forgeExit = Number(packageLog.match(/EXIT_CODE=(\d+)/u)?.[1] ?? -1)
report.forgeStages = packageLog
  .split('\n')
  .filter((line) => /^(✔|❯)/u.test(line.trim()))
  .map((line) => line.trim())
  .slice(-6)

report.verdict =
  report.executable !== null &&
  report.executableKind.includes('PE32') &&
  report.pdfWorker.pass === true &&
  report.macSpecificCount === 0 &&
  report.resources.length === 1 &&
  report.resources[0] === 'app.asar'
    ? 'pass'
    : 'fail'

await fsp.mkdir(path.join(repoRoot, 'docs', 'evidence', 'platform-seam'), { recursive: true })
await fsp.writeFile(path.join(repoRoot, 'docs', 'evidence', 'platform-seam', 'win32-package.json'), serializeEvidence(report))
console.log(JSON.stringify(report, null, 2))
process.exit(report.verdict === 'pass' ? 0 : 1)
