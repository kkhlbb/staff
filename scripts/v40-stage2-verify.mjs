import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { evidenceViolations, serializeEvidence } from './evidence-json.ts'

const dir = 'docs/evidence/v40-stage2/logs'
await fs.mkdir(dir, { recursive: true })
const results = []
const commands = [
  ['twelve-tests', ['exec', '--', 'vitest', 'run', '--config', 'vitest.desktop.config.ts', 'desktop/tests/agentScheduler.test.ts', '--reporter=verbose']],
  ...['typecheck', 'typecheck:desktop', 'lint', 'test', 'test:desktop', 'build', 'package:desktop'].map((name) => [name, ['run', name]]),
]
for (const [name, args] of commands) {
  const startedAt = new Date().toISOString()
  const result = spawnSync('npm', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, V40_RECORD: name === 'twelve-tests' ? '1' : '0' },
  })
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  const log = path.join(dir, name.replaceAll(':', '-') + '.log')
  await fs.writeFile(log, `$ npm ${args.join(' ')}\n${output}\nexitCode=${result.status}\n`)
  results.push({ command: `npm ${args.join(' ')}`, exitCode: result.status, signal: result.signal, startedAt, finishedAt: new Date().toISOString(), log })
  console.log(`${name} exit=${result.status}\n${output.split('\n').slice(-9).join('\n')}`)
}
const tracePath = 'docs/evidence/v40-stage2/fake-session-trace.json'
const trace = await fs.readFile(tracePath, 'utf8')
const violations = evidenceViolations(trace)
if (violations.length > 0) throw new Error(`evidence guard failed: ${violations.join(',')}`)
results.push({ command: 'evidence-guard fake-session-trace.json', exitCode: 0, violations, log: tracePath })
await fs.writeFile('docs/evidence/v40-stage2/verification.json', serializeEvidence({ results }))
if (results.some((result) => result.exitCode !== 0)) process.exitCode = 1
