import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, writeFileSync, renameSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { prepareStepAssets, verifyAssets, legalFiles } from './step-assets.mjs'
const original = prepareStepAssets()
// Evidence runs provide isolated TMPDIR; retain each mutation for diagnosis.
const directory = mkdtempSync(path.join(os.tmpdir(), 'step-license-'))
for (const name of Object.keys(legalFiles)) {
  test(`rejects absent and altered legal asset ${name}`, () => {
    const target = path.join(directory, name.replaceAll('.', '_'))
    cpSync(original, target, { recursive: true })
    const file = path.join(target, name)
    const bytes = readFileSync(file)
    writeFileSync(file, 'placeholder')
    assert.throws(() => verifyAssets(target), /STEP_LICENSE_CHANGED/)
    renameSync(file, file + '.mutation-hidden')
    assert.throws(() => verifyAssets(target), /ENOENT/)
    writeFileSync(file, bytes)
    assert.doesNotThrow(() => verifyAssets(target))
  })
}
test('local packaging verification does not approve release', () => {
  assert.doesNotThrow(() => verifyAssets(original))
  const result = spawnSync(process.execPath, [new URL('./check-step-release.mjs', import.meta.url).pathname], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /BLOCKED_PROVENANCE_AND_LGPL_SOURCE_SUPPLY/)
  assert.match(result.stderr, /CORRESPONDING_SOURCE_AND_GENERATED_BINDINGS/)
})
