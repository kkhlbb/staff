import { spawnSync } from 'node:child_process'
import { readFile, writeFile, mkdir, appendFile, open } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { serializeEvidence } from './evidence-json.ts'

const source = 'src/pages/DesktopWorkspace.tsx'
const out = 'docs/evidence/ui-layout'
await mkdir(`${out}/logs`, { recursive: true })
const original = await readFile(source, 'utf8')
const results = []
async function run(label, command, args, env = {}) {
  const log = `${out}/logs/${label}.log`
  const h = await open(log, 'w')
  const r = spawnSync(command, args, { stdio: ['ignore', h.fd, h.fd], timeout: 240000, env: { ...process.env, ...env } })
  await h.close(); await appendFile(log, `\nEXIT_CODE=${r.status}\n`)
  console.log(`${label}: exit=${r.status}`)
  return { exitCode: r.status, text: await readFile(log, 'utf8'), log }
}
try {
  for (const [id, from, to, expected] of [
    ['M49', 'aria-label="中央工作区" minWidth="var(--panel-center-min)"', 'aria-label="中央工作区"', /central min-width contract missing: 0 < 360/],
    ['M50', "rightWidth === null ? 'var(--panel-sidebar-w)'", "rightWidth === null ? '424px'", /horizontal overflow at 960: 1028 > 960/],
  ]) {
    assert.equal(original.split(from).length, 2, `${id} exact mutation target`)
    await writeFile(source, original.replace(from, to))
    await writeFile(`${out}/${id}.patch`, `--- a/${source}\n+++ b/${source}\n@@\n-${from}\n+${to}\n`)
    try {
      const build = await run(`${id}-package`, 'npm', ['run', 'package:desktop'])
      assert.equal(build.exitCode, 0, `${id}: build failure is NOT a kill`)
      const red = await run(`${id}-red`, 'node', ['desktop/tests/e2e/layout.mjs'], { LAYOUT_RESULT_NAME: id, LAYOUT_ONLY_960: '1' })
      assert.notEqual(red.exitCode, 0, `${id} survived`)
      assert.match(red.text, /AssertionError/)
      assert.match(red.text, expected)
      results.push({ id, killed: true, exitCode: red.exitCode, assertion: red.text.match(expected)[0], log: red.log })
    } finally { await writeFile(source, original) }
  }
} finally {
  await writeFile(source, original)
  const build = await run('restored-package', 'npm', ['run', 'package:desktop'])
  assert.equal(build.exitCode, 0)
  const green = await run('restored-green', 'node', ['desktop/tests/e2e/layout.mjs'])
  results.push({ id: 'restored', exitCode: green.exitCode, log: green.log })
  await writeFile(`${out}/mutations.json`, serializeEvidence(results))
  assert.equal(green.exitCode, 0, 'restoration must pass all three viewports')
}
console.log('M49/M50 killed; restored layout green')
