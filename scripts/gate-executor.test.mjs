import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { executeGate } from './gate-executor.mjs'
import { gateThemes } from './gate-themes.mjs'
test('S11 all historical entrypoints use the shared executor', async () => {
  for (const name of ['verify-display-3dp', 'v40-stage2-verify', 'gt-expand-gates', 'ui-layout-gates', 'ui-id-verify']) assert.match(await readFile(`scripts/${name}.mjs`, 'utf8'), /from '.\/gate-executor.mjs'/u)
})
test('real child exit/stdout/stderr, failure, missing executable and timeout are not fabricated', async () => {
  const root = path.resolve('../slop-cleanup-evidence/gate-children')
  await mkdir(root, { recursive: true })
  const output = await mkdtemp(path.join(root, 'run-'))
  const fixture = path.resolve('scripts/test-fixtures/gate-child.mjs')
  for (const [mode, expected] of [['ok', 0], ['fail', 7]]) {
    const row = await executeGate({ name: mode, command: process.execPath, args: [fixture, mode], output })
    assert.equal(row.exitCode, expected)
    assert.equal(await readFile(row.stdoutLog, 'utf8'), 'actual stdout\n')
    assert.equal(await readFile(row.stderrLog, 'utf8'), 'actual stderr\n')
  }
  const missing = await executeGate({ name: 'missing', command: path.join(output, 'not-installed'), output })
  assert.equal(missing.exitCode, null)
  assert.match(missing.error, /ENOENT/u)
  const timeout = await executeGate({ name: 'timeout', command: process.execPath, args: [fixture, 'wait'], output, timeoutMs: 100 })
  assert.equal(timeout.timedOut, true)
  assert.notEqual(timeout.exitCode, 0)
  console.log(`Actual child evidence: ${output}`)
})
test('dedicated topic steps are retained', () => {
  assert.ok(gateThemes['v40-stage2'].some(s => s.name === 'twelve-tests' && s.env.V40_RECORD === '1'))
  assert.ok(gateThemes['ground-truth'].some(s => s.name === 'metrics'))
  assert.ok(gateThemes['ground-truth'].some(s => s.name === 'test-real-docs'))
  assert.ok(gateThemes['ui-layout'].some(s => s.args.includes('test:desktop:layout')))
  assert.ok(gateThemes['ui-id'].some(s => s.args.includes('--arch=arm64')))
})
