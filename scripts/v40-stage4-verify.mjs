#!/usr/bin/env node
/**
 * V4.0 阶段 4 验证流水线：六条命令 + 打包 + 真实模型 A40 + 密钥零泄漏扫描 + 证据守卫。
 *
 * 用法（真实模型需要运行时密钥，脚本只透传环境变量，不打印、不落盘）：
 *   set -a; . ~/.hermes/.env; set +a
 *   node scripts/v40-stage4-verify.mjs
 *
 * 输出：
 *   docs/evidence/v40-stage4/logs/*.log
 *   docs/evidence/v40-stage4/verification.json（serializeEvidence）
 */
import fs from 'node:fs/promises'
import { inspectEvidence } from './evidence-status.mjs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { evidenceViolations, serializeEvidence } from './evidence-json.ts'

const dir = 'docs/evidence/v40-stage4/logs'
await fs.mkdir(dir, { recursive: true })
const results = []
const guards = []

const commands = [
  ['typecheck', ['run', 'typecheck']],
  ['typecheck-desktop', ['run', 'typecheck:desktop']],
  ['lint', ['run', 'lint']],
  ['test', ['run', 'test']],
  ['test-desktop', ['run', 'test:desktop']],
  ['build', ['run', 'build']],
  ['export-artifact', ['run', 'artifact:export']],
  ['package-desktop', ['run', 'package:desktop']],
  ['check-package-pdf-worker', ['run', 'check:package:pdf-worker']],
]

for (const [name, args] of commands) {
  const startedAt = new Date().toISOString()
  const result = spawnSync('npm', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, env: { ...process.env } })
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  const log = path.join(dir, `${name}.log`)
  await fs.writeFile(log, `$ npm ${args.join(' ')}\n${output}\nexitCode=${result.status}\n`)
  results.push({ step: name, command: `npm ${args.join(' ')}`, exitCode: result.status, startedAt, finishedAt: new Date().toISOString(), log })
  console.log(`${name} exit=${result.status}`)
  console.log(output.split('\n').filter((line) => /Tests|Test Files|error|warning|built in|packaged|✓/.test(line)).slice(-4).join('\n'))
}

// 真实模型 A40 验收（有运行时密钥才跑；没有则如实记为未测）。
const hasKey = typeof process.env.DEEPSEEK_API_KEY === 'string' && process.env.DEEPSEEK_API_KEY.trim() !== ''
if (hasKey) {
  const startedAt = new Date().toISOString()
  const real = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.desktop.config.ts', 'desktop/tests/realModelA40.test.ts', '--reporter=verbose', '--testTimeout=900000'], {
    encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, env: { ...process.env, V40_REAL_MODEL: '1' },
  })
  const log = path.join(dir, 'real-model-a40.log')
  await fs.writeFile(log, `$ V40_REAL_MODEL=1 npx vitest run --config vitest.desktop.config.ts desktop/tests/realModelA40.test.ts\n${real.stdout}${real.stderr}\nexitCode=${real.status}\n`)
  results.push({ step: 'real-model-a40', command: 'V40_REAL_MODEL=1 npx vitest run --config vitest.desktop.config.ts desktop/tests/realModelA40.test.ts', exitCode: real.status, startedAt, finishedAt: new Date().toISOString(), log })
  console.log(`real-model-a40 exit=${real.status}`)
} else {
  results.push({ step: 'real-model-a40', command: 'skipped', exitCode: 2, skippedReason: '运行时没有 DEEPSEEK_API_KEY', log: null })
  console.log('real-model-a40 SKIPPED (no runtime key)')
}

// 打包走查（会驱动真实系统保存对话框；需要打包产物）。
const e2e = spawnSync('node', ['desktop/tests/e2e/v40stage4.mjs'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env } })
await fs.writeFile(path.join(dir, 'e2e-packaged.log'), `$ node desktop/tests/e2e/v40stage4.mjs\n${e2e.stdout}${e2e.stderr}\nexitCode=${e2e.status}\n`)
results.push({ step: 'e2e-packaged', command: 'node desktop/tests/e2e/v40stage4.mjs', exitCode: e2e.status, log: path.join(dir, 'e2e-packaged.log') })
console.log(`e2e-packaged exit=${e2e.status}`)
console.log((e2e.stdout ?? '').split('\n').slice(-6).join('\n'))

// 密钥零泄漏扫描：只报计数与文件名，绝不打印密钥或片段。
const secret = hasKey ? process.env.DEEPSEEK_API_KEY.trim() : ''
const prefix = secret.slice(0, 12)
const listed = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const untracked = spawnSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const files = [...new Set([
  ...listed.stdout.split('\u0000'),
  ...untracked.stdout.split('\u0000'),
])].filter((name) => name !== '')
const scan = { filesScanned: 0, exactHits: [], prefixHits: [], keyLength: secret.length, prefixLength: prefix.length, note: '只统计命中文件，不输出密钥内容' }
if (hasKey) {
  for (const file of files) {
    let bytes
    try { bytes = await fs.readFile(file) } catch { continue }
    scan.filesScanned += 1
    const text = bytes.toString('latin1')
    if (text.includes(secret)) scan.exactHits.push(file)
    if (prefix.length >= 8 && text.includes(prefix)) scan.prefixHits.push(file)
  }
}
const evidenceFiles = [
  'docs/evidence/v40-stage4/a40-real-results.json',
  'docs/evidence/v40-stage4/e2e-result.json',
  'docs/evidence/v40-stage4/export-artifact.json',
]
for (const [index, file] of evidenceFiles.entries()) {
  guards.push(await inspectEvidence(file, ['a40', 'e2e', 'export'][index], fs.readFile, evidenceViolations, secret))
}
const keyScanOk = hasKey ? scan.exactHits.length === 0 && scan.prefixHits.length === 0 : false
// 应用自己的配置也必须不含密钥（非仓库文件，单独扫）。
const appConfig = path.join(process.env.HOME ?? '', 'Library', 'Application Support', '寸链', 'workspace', 'model-config.json')
try {
  const text = await fs.readFile(appConfig, 'utf8')
  scan.appConfig = { path: 'model-config.json (app data)', exists: true, keyLeak: hasKey ? text.includes(secret) : false }
} catch {
  scan.appConfig = { path: 'model-config.json (app data)', exists: false, keyLeak: false }
}
const appConfigOk = scan.appConfig.keyLeak === false
results.push({ step: 'key-scan', command: 'scan tracked files for runtime key', exitCode: keyScanOk ? 0 : 2, skippedReason: hasKey ? null : '没有运行时密钥，无法扫描具体值', hits: { exact: scan.exactHits.length, prefix: scan.prefixHits.length } })

const screenshotDir = 'docs/evidence/v40-stage4/screenshots'
const screenshots = (await fs.readdir(screenshotDir).catch(() => [])).filter((name) => name.endsWith('.png')).sort()

await fs.writeFile('docs/evidence/v40-stage4/verification.json', serializeEvidence({
  baseline: 'dc78a5e',
  branch: 'agent/v40-stage4',
  results,
  guards,
  keyScan: scan,
  screenshots,
}))
const failed = results.some((result) => result.exitCode !== 0)
const guarded = guards.some((guard) => guard.status !== 'PASS' || guard.violations.length > 0 || guard.keyLeak)
if (failed || guarded || !keyScanOk || !appConfigOk) process.exitCode = 1
