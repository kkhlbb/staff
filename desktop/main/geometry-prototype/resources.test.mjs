import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, test } from 'node:test'
import { prepareGeometryResources, smokeGeometryWorker, verifyGeometryResources } from './resources.mjs'

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
let stagedResources
before(async () => {
  const parent = mkdtempSync(join(tmpdir(), 'cunlian geometry staging '))
  stagedResources = await prepareGeometryResources(parent)
})

test('verifies the staged CJS, ESM, WASM, package metadata, license, fixture and worker', () => {
  const { directory, manifestSha256 } = stagedResources
  verifyGeometryResources(directory, manifestSha256)
  const readJson = (name) => JSON.parse(readFileSync(join(directory, name)))
  assert.deepEqual(Object.keys(readJson('geometry-assets.json').sha256).sort(), [
    'fixture.json', 'replicad-opencascadejs/LICENSE',
    'replicad-opencascadejs/dist/replicad_single.cjs', 'replicad-opencascadejs/dist/replicad_single.js',
    'replicad-opencascadejs/dist/replicad_single.wasm', 'replicad-opencascadejs/package.json', 'worker.mjs',
  ])
  const metadata = readJson('replicad-opencascadejs/package.json')
  assert.equal(metadata.type, 'module')
  assert.equal(metadata.version, '1.2.1')
  assert.equal(stagedResources.scope, 'development staging only')
  assert.equal(stagedResources.upstreamNotice.declaredLicense, 'LGPL-2.1-only')
  assert.match(stagedResources.upstreamNotice.distributionReview, /^pending /)
})

test('executes staged WASM in a Node worker from a path containing spaces', async () => {
  const report = await smokeGeometryWorker(stagedResources.directory, stagedResources.manifestSha256)
  for (const plate of [report.a01.measured, report.a01.readback]) {
    assert.equal(plate.valid, true)
    assert.equal(plate.solids, 1)
    assert.deepEqual(plate.bounds.max, [80, 50, 8])
    assert.ok(Math.abs(plate.volumeMm3 - (32000 - 400 * Math.PI)) <= 1e-3)
    assert.deepEqual(plate.cylinders.map(({ origin, radius }) => [origin[0], origin[1], radius]), [
      [20, 25, 5], [60, 25, 5],
    ])
  }
  for (const pose of [report.a05.unrotated, report.a05.worldX90]) {
    for (const [key, expected] of [['nominal', 2], ['min', 1.7], ['max', 2.3]]) {
      assert.ok(Math.abs(pose[key].signedGapMm - expected) <= 1e-6)
    }
  }
})

test('rejects an unexpected manifest before starting the worker', async () => {
  await assert.rejects(smokeGeometryWorker(stagedResources.directory, '0'.repeat(64)), /manifest SHA-256 mismatch/)
})

test('rejects a tampered ESM asset even if a replacement manifest hashes it', async () => {
  const staged = await prepareGeometryResources(tmpdir())
  const name = 'replicad-opencascadejs/dist/replicad_single.js'
  const modified = '// replaced geometry ESM\n'
  writeFileSync(join(staged.directory, name), modified)
  await assert.rejects(smokeGeometryWorker(staged.directory, staged.manifestSha256), /asset SHA-256 mismatch/)

  const path = join(staged.directory, 'geometry-assets.json')
  const manifest = JSON.parse(readFileSync(path))
  manifest.sha256[name] = digest(modified)
  const replacement = JSON.stringify(manifest)
  writeFileSync(path, replacement)
  assert.throws(() => verifyGeometryResources(staged.directory, digest(replacement)), /Unexpected Replicad SHA-256/)
})

function rewriteManifest(directory, mutate) {
  const path = join(directory, 'geometry-assets.json')
  const manifest = JSON.parse(readFileSync(path))
  mutate(manifest)
  const bytes = JSON.stringify(manifest)
  writeFileSync(path, bytes)
  return digest(bytes)
}

test('development staging rejects a missing WASM asset', async () => {
  const staged = await prepareGeometryResources(tmpdir())
  const wasm = join(staged.directory, 'replicad-opencascadejs/dist/replicad_single.wasm')
  renameSync(wasm, join(staged.directory, 'hidden.wasm'))
  assert.throws(() => verifyGeometryResources(staged.directory, staged.manifestSha256), { code: 'ENOENT' })
})

test('development staging rejects a replacement package version and traversal key', async () => {
  const staged = await prepareGeometryResources(tmpdir())
  const versionDigest = rewriteManifest(staged.directory, (manifest) => { manifest.version = '1.2.2' })
  assert.throws(() => verifyGeometryResources(staged.directory, versionDigest), /Unexpected geometry asset manifest/)
  const traversalDigest = rewriteManifest(staged.directory, (manifest) => {
    manifest.version = '1.2.1'
    manifest.sha256['../worker.mjs'] = manifest.sha256['worker.mjs']
    delete manifest.sha256['worker.mjs']
  })
  assert.throws(() => verifyGeometryResources(staged.directory, traversalDigest), /Unexpected geometry asset manifest/)
})

test('development staging rejects symlinked worker bytes and kernel directories even with matching hashes', async () => {
  const staged = await prepareGeometryResources(tmpdir())
  const outside = mkdtempSync(join(tmpdir(), 'cunlian geometry external '))
  const worker = join(staged.directory, 'worker.mjs')
  renameSync(worker, join(outside, 'worker.mjs'))
  symlinkSync(join(outside, 'worker.mjs'), worker)
  assert.throws(() => verifyGeometryResources(staged.directory, staged.manifestSha256), /Invalid geometry asset file/)
  const kernel = join(staged.directory, 'replicad-opencascadejs')
  renameSync(kernel, join(outside, 'kernel'))
  symlinkSync(join(outside, 'kernel'), kernel)
  assert.throws(() => verifyGeometryResources(staged.directory, staged.manifestSha256), /Invalid geometry asset directory/)
})

test('development staging binds generated worker and fixture to the separate build receipt', async () => {
  const staged = await prepareGeometryResources(tmpdir())
  writeFileSync(join(staged.directory, 'worker.mjs'), 'throw new Error("untrusted worker")')
  writeFileSync(join(staged.directory, 'fixture.json'), '{}')
  rewriteManifest(staged.directory, (manifest) => {
    for (const asset of ['worker.mjs', 'fixture.json']) {
      manifest.sha256[asset] = digest(readFileSync(join(staged.directory, asset)))
    }
  })
  await assert.rejects(smokeGeometryWorker(staged.directory, staged.manifestSha256), /manifest SHA-256 mismatch/)
})

test('development staging rejects undisclosed files', async () => {
  const staged = await prepareGeometryResources(tmpdir())
  writeFileSync(join(staged.directory, 'unexpected.cjs'), '')
  assert.throws(() => verifyGeometryResources(staged.directory, staged.manifestSha256), /Unexpected geometry resource inventory/)
})
