/**
 * flake 修复证据采集：
 *   1) 六条命令逐条执行，真实输出落 logs/，退出码与耗时写 verification.json；
 *   2) 解析 10 轮 / 高负载 3 轮 / 极端 2 轮 / 复现日志的 Tests 行，写 flake-stats.json。
 * 两个 JSON 都过 serializeEvidence（相对路径、无未标记 UUID）。
 * 用法：node docs/evidence/flake-fix/capture.mjs
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { evidenceViolations, serializeEvidence } from '../../../scripts/evidence-json.ts'

const base = 'docs/evidence/flake-fix'
const logDir = path.join(base, 'logs')
await fs.mkdir(logDir, { recursive: true })

const commands = ['typecheck', 'typecheck:desktop', 'lint', 'test', 'test:desktop', 'build']
const results = []
for (const name of commands) {
  const startedAt = new Date().toISOString()
  const result = spawnSync('npm', ['run', name], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  const log = path.join(logDir, `${name.replaceAll(':', '-')}.log`)
  await fs.writeFile(log, `$ npm run ${name}\n${output}\nexitCode=${result.status}\n`)
  results.push({
    command: `npm run ${name}`,
    exitCode: result.status,
    signal: result.signal,
    startedAt,
    finishedAt: new Date().toISOString(),
    log,
  })
  const tail = output.trim().split('\n').slice(-6).join('\n')
  console.log(`[${name}] exit=${result.status}\n${tail}\n`)
}

/** 从 vitest 日志里取 Test Files / Tests / Duration 三行。 */
async function readSummary(logPath) {
  const text = await fs.readFile(logPath, 'utf8')
  const pick = (re) => (text.match(re)?.[0] ?? '').replace(/\s+/gu, ' ').trim()
  const color = /\u001b\[[0-9;]*m/gu
  const clean = text.replace(color, '')
  const tests = (clean.match(/^\s+Tests\s+.*$/mu)?.[0] ?? '').replace(/\s+/gu, ' ').trim()
  const files = (clean.match(/^\s+Test Files\s+.*$/mu)?.[0] ?? '').replace(/\s+/gu, ' ').trim()
  const duration = (clean.match(/^\s+Duration\s+.*$/mu)?.[0] ?? '').replace(/\s+/gu, ' ').trim()
  const failures = [...clean.matchAll(/^ FAIL\s+(\S+)\s+>\s+(.+)$/gmu)].map((m) => `${m[1]} > ${m[2].trim()}`)
  const timedOut = /Test timed out in (\d+)ms/u.exec(clean)?.[1] ?? null
  return { log: logPath, files, tests, duration, timedOutMs: timedOut ? Number(timedOut) : null, failures, pick: pick(/RUN\s+v[\d.]+/u) }
}

async function readRounds(prefix, count, dir = logDir) {
  const rounds = []
  for (let i = 1; i <= count; i += 1) {
    const log = path.join(dir, `${prefix}-${String(i).padStart(2, '0')}.log`)
    const summary = await readSummary(log)
    rounds.push({ round: i, ...summary, passed: summary.tests.includes('0 failed') || /Tests\s+\d+ passed/u.test(summary.tests) })
  }
  return rounds
}

const stats = {
  fixCommitBase: 'b4f2a53',
  machine: { cpus: 10, note: '并行负载用 yes > /dev/null 抢占核心；8 workers + 8/16 抢占进程' },
  standardRounds: await readRounds('round', 10),
  loadRounds: await readRounds('load', 3),
  extremeRounds: await readRounds('extreme', 2),
  repro: {
    baselineNoStress: await readRounds('load8-attempt', 10, path.join(base, 'repro')),
    stressedFirstAttempt: await readSummary(path.join(base, 'repro/burn8-attempt-01.log')),
    unfixedTiming: await readSummary(path.join(base, 'repro/unfixed-full-verbose.log')),
    fixedTiming: await readSummary(path.join(base, 'repro/fixed-full-verbose.log')),
    degradationProbe: await readSummary(path.join(base, 'repro/probe-attempt-02.log')),
  },
  mutationM16: {
    red: await Promise.all([1, 2, 3].map((n) => readSummary(path.join(base, `mutations/logs/M16-red-attempt-0${n}.log`)))),
    greenRestored: await Promise.all([1, 2].map((n) => readSummary(path.join(base, `mutations/logs/M16-green-restored-0${n}.log`)))),
  },
}
stats.verdict = {
  standard: `${stats.standardRounds.filter((r) => r.passed).length}/10`,
  load: `${stats.loadRounds.filter((r) => r.passed).length}/3`,
  extreme: `${stats.extremeRounds.filter((r) => r.passed).length}/2`,
  m16: `变异红 ${stats.mutationM16.red.filter((r) => r.failures.length > 0 || r.timedOutMs !== null).length}/3，恢复绿 ${stats.mutationM16.greenRestored.filter((r) => r.failures.length === 0 && r.timedOutMs === null).length}/2`,
}

const statsText = serializeEvidence(stats)
const statsViolations = evidenceViolations(statsText)
if (statsViolations.length > 0) throw new Error(`stats evidence guard failed: ${statsViolations.join(',')}`)
await fs.writeFile(path.join(base, 'flake-stats.json'), statsText)

const verifyText = serializeEvidence({ results })
const verifyViolations = evidenceViolations(verifyText)
if (verifyViolations.length > 0) throw new Error(`verification evidence guard failed: ${verifyViolations.join(',')}`)
await fs.writeFile(path.join(base, 'verification.json'), verifyText)

console.log('verdict', JSON.stringify(stats.verdict, null, 2))
if (results.some((r) => r.exitCode !== 0)) process.exitCode = 1
