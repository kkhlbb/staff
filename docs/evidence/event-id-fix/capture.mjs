/**
 * 事件 ID 碰撞修复证据采集：
 *   1) 六条校验命令逐条执行，真实输出落 logs/，退出码与耗时写 verification.json；
 *   2) 解析 10 轮 invalidation、6 轮未修复基线、EID 用例、M17 变异的 Tests 行，写 eid-stats.json。
 * 两个 JSON 都过 serializeEvidence（相对路径、无未标记 UUID、无绝对路径）。
 * 用法：node docs/evidence/event-id-fix/capture.mjs
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { evidenceViolations, serializeEvidence } from '../../../scripts/evidence-json.ts'

const base = 'docs/evidence/event-id-fix'
const logDir = path.join(base, 'logs')
const mutationDir = path.join(base, 'mutations', 'logs')
const reproDir = path.join(base, 'repro')
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
  const tail = output.trim().split('\n').slice(-4).join('\n')
  console.log(`[${name}] exit=${result.status}\n${tail}\n`)
}

/** 从 vitest 日志里取 Test Files / Tests / Duration 与失败用例名。 */
async function readSummary(logPath) {
  const text = await fs.readFile(logPath, 'utf8')
  const clean = text.replace(/\u001b\[[0-9;]*m/gu, '')
  const squash = (line) => line.replace(/\s+/gu, ' ').trim()
  const tests = squash(clean.match(/^\s+Tests\s+.*$/mu)?.[0] ?? '')
  const files = squash(clean.match(/^\s+Test Files\s+.*$/mu)?.[0] ?? '')
  const duration = squash(clean.match(/^\s+Duration\s+.*$/mu)?.[0] ?? '')
  const failures = [...clean.matchAll(/^ FAIL\s+(\S+)\s+>\s+(.+)$/gmu)].map(
    (match) => `${match[1]} > ${match[2].trim()}`,
  )
  return { log: logPath, files, tests, duration, failures }
}

function passed(testsLine) {
  return /Tests\s+\d+ passed \(\d+\)/u.test(testsLine) && !testsLine.includes('failed')
}

async function readRounds(dir, prefix, count, label) {
  const rounds = []
  for (let index = 1; index <= count; index += 1) {
    const log = path.join(dir, `${prefix}-${String(index).padStart(2, '0')}.log`)
    const summary = await readSummary(log)
    rounds.push({ name: label, round: index, ...summary, passed: passed(summary.tests) })
  }
  return rounds
}

const invalidationRounds = await readRounds(logDir, 'round', 10, 'invalidation-fixed')
const baselineRounds = await readRounds(reproDir, 'unfixed-round', 6, 'invalidation-unfixed')
const mutationRedRounds = await readRounds(mutationDir, 'M17-red-attempt', 3, 'M17-mutation')
const mutationGreenRounds = await readRounds(mutationDir, 'M17-green-restored', 2, 'M17-restored')

const eidSummary = await readSummary(path.join(logDir, 'eid-tests.log'))
const redFailures = [...new Set(mutationRedRounds.flatMap((round) => round.failures))]

const stats = {
  task: 'EID: 变更事件 ID 毫秒碰撞',
  branch: 'agent/fix-event-id-collision',
  baseCommit: 'ae3e89e',
  fixCommit: '4bc6aba',
  invalidation: {
    fixed: { rounds: invalidationRounds, greenCount: invalidationRounds.filter((round) => round.passed).length, total: 10 },
    unfixedBaseline: { rounds: baselineRounds, redCount: baselineRounds.filter((round) => !round.passed).length, total: 6 },
  },
  eidTests: eidSummary,
  mutationM17: {
    red: { rounds: mutationRedRounds, failingCases: redFailures, total: 3 },
    restored: { rounds: mutationGreenRounds, total: 2 },
  },
}

for (const [file, value] of [
  ['verification.json', { results }],
  ['eid-stats.json', stats],
]) {
  const text = serializeEvidence(value)
  const violations = evidenceViolations(text)
  if (violations.length > 0) {
    throw new Error(`${file} 未通过证据校验: ${violations.join(', ')}`)
  }
  await fs.writeFile(path.join(base, file), text)
  console.log(`[${file}] 已写入，校验通过`)
}
