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
test('rejects legacy or unknown executable kernel files in unified resources', () => {
  for (const name of ['replicad_single.wasm', 'replicad_single.js', 'spacer.wasm', 'spacer.cjs', 'foreign.cjs']) {
    const target = path.join(directory, 'unexpected-' + name)
    cpSync(original, target, { recursive: true })
    writeFileSync(path.join(target, name), 'unexpected kernel')
    assert.throws(() => verifyAssets(target), /STEP_UNEXPECTED_RUNTIME_ASSET/)
  }
})
test('release gate approves verified unified OCCT resources and rejects tampered binaries', () => {
  const resources = path.join(directory, 'release-resources')
  cpSync(original, path.join(resources, 'occt-unified'), { recursive: true })
  const invoke = () => spawnSync(process.execPath, [new URL('./check-step-release.mjs', import.meta.url).pathname, resources], { encoding: 'utf8' })
  const valid = invoke()
  assert.equal(valid.status, 0)
  assert.equal(JSON.parse(valid.stdout).packageVerification, 'VERIFIED')
  assert.equal(JSON.parse(valid.stdout).status, 'APPROVED_UNIFIED_OCCT_LGPL_21')
  writeFileSync(path.join(resources, 'occt-unified/cunlian_occt.wasm'), 'corrupt')
  const corrupt = invoke()
  assert.equal(corrupt.status, 1)
  assert.equal(JSON.parse(corrupt.stderr).status, 'BLOCKED_PACKAGED_ASSET_VERIFICATION')
})
test('release gate succeeds on prepared unified OCCT assets', () => {
  assert.doesNotThrow(() => verifyAssets(original))
  const result = spawnSync(process.execPath, [new URL('./check-step-release.mjs', import.meta.url).pathname], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.equal(JSON.parse(result.stdout).status, 'APPROVED_UNIFIED_OCCT_LGPL_21')
})
test('packaged SHA256SUMS only lists packaged runtime files and verifies cleanly', () => {
  const sums = readFileSync(path.join(original, 'SHA256SUMS'), 'utf8')
  assert.match(sums, /  cunlian_occt\.wasm$/m)
  assert.match(sums, /  cunlian_occt\.mjs$/m)
  assert.doesNotMatch(sums, /cunlian_occt\.d\.mts/)
  if (process.platform !== 'win32') {
    const check = spawnSync('shasum', ['-a', '256', '-c', 'SHA256SUMS'], { cwd: original, encoding: 'utf8' })
    assert.equal(check.status, 0, check.stderr || check.stdout)
  }
})
