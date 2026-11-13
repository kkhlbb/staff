#!/usr/bin/env node
/**
 * L2 确认效率证据采集：跑门禁命令并把退出码/耗时写进 verification.json。
 *
 *   node docs/evidence/confirm-efficiency/capture.mjs
 *
 * - 六条命令 + 额外门禁（typecheck:desktop / test:mcp / build / 打包产物校验）逐条真实执行，
 *   stdout/stderr 落到 logs/，不手写退出码；
 * - 打包 `npm run package:desktop` 耗时数分钟，本脚本**不重跑**：读取 logs/10-package-desktop.log
 *   里上一次真实运行的 EXIT 行并标注来源（不伪造）。
 * - 结果经 scripts/evidence-json.ts 的 serializeEvidence 归一化（机器路径/UUID）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, promises as fsp, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serializeEvidence } from '../../../scripts/evidence-json.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')
const logs = path.join(here, 'logs')
await fsp.mkdir(logs, { recursive: true })

const commands = [
  { id: 'typecheck', script: 'typecheck', log: '01-typecheck.log' },
  { id: 'typecheck:desktop', script: 'typecheck:desktop', log: '02-typecheck-desktop.log' },
  { id: 'lint', script: 'lint', log: '03-lint.log' },
  { id: 'test', script: 'test', log: '04-test.log' },
  { id: 'test:desktop', script: 'test:desktop', log: '05-test-desktop.log' },
  { id: 'test:mcp', script: 'test:mcp', log: '06-test-mcp.log' },
  { id: 'test:real-docs', script: 'test:real-docs', log: '07-test-real-docs.log' },
  {
    id: 'metrics:real-docs',
    script: 'metrics:real-docs',
    log: '08-metrics-real-docs.log',
    env: { REAL_DOC_CORPUS: `${process.env.HOME}/DSH/tmp/cunlian-v36/real-docs` },
  },
  { id: 'build', script: 'build', log: '09-build.log' },
  { id: 'check:package:pdf-worker', script: 'check:package:pdf-worker', log: '12-check-package-pdf-worker.log' },
]

const results = []
for (const command of commands) {
  const started = Date.now()
  const run = spawnSync('npm', ['run', command.script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(command.env ?? {}) },
    maxBuffer: 64 * 1024 * 1024,
  })
  const durationMs = Date.now() - started
  const output = `$ npm run ${command.script}\n${run.stdout ?? ''}${run.stderr ?? ''}\nEXIT=${run.status ?? 'null'}\n`
  await fsp.writeFile(path.join(logs, command.log), output)
  const summary = (run.stdout ?? '')
    .split('\n')
    .filter((line) => /Tests\s+\d+|Test Files\s+\d+|BASELINE MATCH|RESULT PASS|error TS|✖/.test(line))
    .slice(-4)
    .join(' | ')
  results.push({ id: command.id, exitCode: run.status, durationMs, log: `logs/${command.log}`, summary })
  console.log(`${command.id}: exit=${run.status} ${durationMs}ms ${summary}`)
}

// 打包：不重跑，读取真实运行留下的日志（来源写明）。
const packageLog = path.join(logs, '10-package-desktop.log')
const packageText = existsSync(packageLog) ? readFileSync(packageLog, 'utf8') : ''
const packageExit = /EXIT=(\d+)/.exec(packageText)?.[1]
const artifact = path.join(repoRoot, 'out/寸链-darwin-arm64/寸链.app/Contents/Resources/app.asar')
results.push({
  id: 'package:desktop',
  invoked: false,
  exitCode: packageExit === undefined ? null : Number(packageExit),
  log: 'logs/10-package-desktop.log',
  note: '未在本脚本重跑（耗时数分钟）；EXIT 取自该日志中真实运行的记录',
  artifact: existsSync(artifact)
    ? { path: 'out/寸链-darwin-arm64/寸链.app/Contents/Resources/app.asar', bytes: (await fsp.stat(artifact)).size }
    : null,
  summary: /RESULT PASS[^\n]*/.exec(packageText)?.[0] ?? '',
})

const payload = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  commands: results,
  allPassed: results.every((item) => item.exitCode === 0),
}
const output = path.join(here, 'verification.json')
await fsp.writeFile(output, serializeEvidence(payload))
console.log(`WROTE ${path.relative(repoRoot, output)} allPassed=${payload.allPassed}`)
