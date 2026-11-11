#!/usr/bin/env node
/**
 * V4.0 阶段 3 验证流水线：状态级/UI 测试、六条命令、打包走查与证据守卫。
 *
 * 输出：docs/evidence/v40-stage3/logs/*.log 与 verification.json（serializeEvidence）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { evidenceViolations, serializeEvidence } from './evidence-json.ts'

const dir = 'docs/evidence/v40-stage3/logs'
await fs.mkdir(dir, { recursive: true })
const results = []
const commands = [
  ['s3-tests', ['exec', '--', 'vitest', 'run', '--config', 'vitest.desktop.config.ts', 'desktop/tests/agentApproval.test.ts', '--reporter=verbose']],
  ['s3-ui-tests', ['exec', '--', 'vitest', 'run', 'src/components/AgentSidebar.test.tsx', '--reporter=verbose']],
  ['typecheck', ['run', 'typecheck']],
  ['typecheck-desktop', ['run', 'typecheck:desktop']],
  ['lint', ['run', 'lint']],
  ['test', ['run', 'test']],
  ['test-desktop', ['run', 'test:desktop']],
  ['build', ['run', 'build']],
  ['package-desktop', ['run', 'package:desktop']],
]
for (const [name, args] of commands) {
  const startedAt = new Date().toISOString()
  const result = spawnSync('npm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env } })
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  const log = path.join(dir, `${name}.log`)
  await fs.writeFile(log, `$ npm ${args.join(' ')}\n${output}\nexitCode=${result.status}\n`)
  results.push({ step: name, command: `npm ${args.join(' ')}`, exitCode: result.status, startedAt, finishedAt: new Date().toISOString(), log })
  console.log(`${name} exit=${result.status}\n${output.split('\n').slice(-6).join('\n')}`)
}

// 打包走查夹具（显式生成，不进入常规测试）。
const seedPath = path.resolve('docs/evidence/v40-stage3/fixtures/stage3-seed.cunlian')
const seed = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.v40stage3fixture.config.ts', '--reporter=verbose'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, V40S3_SEED_OUT: seedPath },
})
await fs.writeFile(path.join(dir, 'seed.log'), `$ V40S3_SEED_OUT=${seedPath} npx vitest run --config vitest.v40stage3fixture.config.ts\n${seed.stdout}${seed.stderr}\nexitCode=${seed.status}\n`)
results.push({ step: 'seed', command: 'npx vitest run --config vitest.v40stage3fixture.config.ts', exitCode: seed.status, log: path.join(dir, 'seed.log') })
console.log(`seed exit=${seed.status}`)

const e2e = spawnSync('node', ['desktop/tests/e2e/v40stage3.mjs'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env } })
await fs.writeFile(path.join(dir, 'e2e-packaged.log'), `$ node desktop/tests/e2e/v40stage3.mjs\n${e2e.stdout}${e2e.stderr}\nexitCode=${e2e.status}\n`)
results.push({ step: 'e2e-packaged', command: 'node desktop/tests/e2e/v40stage3.mjs', exitCode: e2e.status, log: path.join(dir, 'e2e-packaged.log') })
console.log(`e2e-packaged exit=${e2e.status}\n${(e2e.stdout ?? '').split('\n').slice(-8).join('\n')}`)

const evidenceFiles = ['docs/evidence/v40-stage3/e2e-result.json']
const guards = []
for (const file of evidenceFiles) {
  try {
    const text = await fs.readFile(file, 'utf8')
    const violations = evidenceViolations(text)
    guards.push({ file, violations })
    if (violations.length > 0) results.push({ step: 'evidence-guard', command: `guard ${file}`, exitCode: 1, log: file })
  } catch (error) {
    guards.push({ file, violations: [String(error)] })
    results.push({ step: 'evidence-guard', command: `guard ${file}`, exitCode: 1, log: file })
  }
}

await fs.writeFile('docs/evidence/v40-stage3/verification.json', serializeEvidence({
  baseline: 'b4f2a53',
  branch: 'agent/v40-stage3',
  results,
  guards,
  screenshots: (await fs.readdir('docs/evidence/v40-stage3/screenshots').catch(() => [])).filter(name => name.endsWith('.png')).sort(),
}))
if (results.some((result) => result.exitCode !== 0) || guards.some((guard) => guard.violations.length > 0)) process.exitCode = 1
