import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { safeRelative, verifySupply } from './verify-step-supply.mjs'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'supply-test-'))
  const directory = path.join(root, 'distribution'), resources = path.join(root, 'Resources')
  mkdirSync(directory); mkdirSync(resources)
  const resourceFiles = {}, manifest = {}
  const put = (base, rel, data, index) => {
    mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); writeFileSync(path.join(base, rel), data)
    index[rel] = { bytes: Buffer.byteLength(data), sha256: sha(data) }
  }
  // Synthetic unit fixtures only; never used as delivery evidence.
  for (const rel of ['app.asar', 'step-narrow-v1/spacer.wasm', 'step-narrow-v1/spacer.cjs', 'step-narrow-v1/step-worker.cjs', 'step-narrow-v1/SOURCE-SUPPLY.zh-CN.md']) put(resources, rel, 'unit fixture', resourceFiles)
  for (const rel of ['source/core-supply-product.tar.gz', 'source/final-build-evidence.tar.gz', 'source/product-integration-source-final.tar.gz', 'source/tool-materials/TOOLS.json', 'closeout-source.tar.gz']) put(directory, rel, 'unit fixture', manifest)
  const binding = { schema: 'cunlian-local-source-supply-v1', legalCertification: false, releaseApproval: 'BLOCKED', sourceCommit: 'test-only', resourceFiles }
  const seal = () => {
    put(directory, 'PRODUCT-BINDING.json', JSON.stringify(binding), manifest)
    writeFileSync(path.join(directory, 'MANIFEST.json'), JSON.stringify(manifest))
  }
  seal()
  return { directory, resources, manifest, binding, seal }
}
test('relative paths reject traversal, absolute paths and alternate separators', () => {
  for (const rel of ['../a', '/a', 'a/../b', 'a//b', 'a/./b', 'C:/a', 'a\\b', '', 'a\0b']) assert.throws(() => safeRelative(rel), /SUPPLY_UNSAFE_PATH/)
  assert.equal(safeRelative('source/a.tar.gz'), 'source/a.tar.gz')
})
test('complete offline unit fixture verifies but never grants release', () => {
  const f = fixture(); const result = verifySupply(f.directory, f.resources)
  assert.equal(result.status, 'LOCAL_MATERIALS_VERIFIED'); assert.equal(result.releaseApproval, 'BLOCKED'); assert.equal(result.legalCertification, false)
})
test('missing explicit resource target is caller error', () => assert.throws(() => verifySupply('x'), /SUPPLY_AND_RESOURCE_TARGET_REQUIRED/))
test('corrupted supply input is rejected', () => {
  const f = fixture(); writeFileSync(path.join(f.directory, 'source/core-supply-product.tar.gz'), 'bad')
  assert.throws(() => verifySupply(f.directory, f.resources), /SUPPLY_HASH_MISMATCH/)
})
test('different product Resources cannot borrow supply binding', () => {
  const f = fixture(); writeFileSync(path.join(f.resources, 'step-narrow-v1/spacer.wasm'), 'changed product')
  assert.throws(() => verifySupply(f.directory, f.resources), /SUPPLY_HASH_MISMATCH/)
})
test('unindexed supply file is rejected', () => {
  const f = fixture(); writeFileSync(path.join(f.directory, 'extra'), 'unexpected')
  assert.throws(() => verifySupply(f.directory, f.resources), /SUPPLY_UNINDEXED_FILE/)
})
test('parent symlink in a manifest path is rejected', () => {
  const f = fixture(); symlinkSync(f.resources, path.join(f.directory, 'alias'))
  const b = readFileSync(path.join(f.resources, 'app.asar'))
  f.manifest['alias/app.asar'] = { sha256: sha(b), bytes: b.length }; f.seal()
  assert.throws(() => verifySupply(f.directory, f.resources), /SUPPLY_SYMLINK/)
})
test('unsafe manifest key is rejected even if hash matches', () => {
  const f = fixture(); f.manifest['../outside'] = { sha256: sha('x'), bytes: 1 }; f.seal()
  assert.throws(() => verifySupply(f.directory, f.resources), /SUPPLY_UNSAFE_PATH/)
})
