import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { serializeEvidence } from './evidence-json.ts'
const dir = 'docs/evidence/v40-stage1/logs'
await fs.mkdir(dir, { recursive: true })
const results = []
const commands = [ ['nine-tests', ['exec', '--', 'vitest', 'run', '--config', 'vitest.desktop.config.ts', 'desktop/tests/agentTools.test.ts', '--reporter=verbose']], ...['typecheck', 'typecheck:desktop', 'lint', 'test', 'test:desktop', 'build', 'package:desktop'].map(name => [name, ['run', name]]) ]
for (const [name, args] of commands) {
  const startedAt = new Date().toISOString()
  const r = spawnSync('npm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, V40_RECORD: name === 'nine-tests' ? '1' : '0' } })
  const output = (r.stdout ?? '') + (r.stderr ?? '')
  const log = path.join(dir, name.replaceAll(':', '-') + '.log')
  await fs.writeFile(log, `$ npm ${args.join(' ')}\n${output}\nexitCode=${r.status}\n`)
  results.push({ command: `npm ${args.join(' ')}`, exitCode: r.status, signal: r.signal, startedAt, finishedAt: new Date().toISOString(), log })
  console.log(`${name} exit=${r.status}\n${output.split('\n').slice(-9).join('\n')}`)
}
await fs.writeFile('docs/evidence/v40-stage1/verification.json', serializeEvidence({ results }))
if (results.some(r => r.exitCode !== 0)) process.exitCode = 1
