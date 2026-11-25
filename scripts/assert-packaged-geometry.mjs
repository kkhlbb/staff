import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { constants, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { extractFile, statFile } from '@electron/asar'
import { runGeometryProbe } from '../desktop/main/geometry-prototype/probe.mjs'

const [resourcesPath, trustedDigest, ...extra] = process.argv.slice(2)
assert(resourcesPath && /^[a-f0-9]{64}$/.test(trustedDigest) && !extra.length,
  'Usage: node scripts/assert-packaged-geometry.mjs <app Contents/Resources> <manifest SHA-256 from separate preparation receipt>')
const resources = resolve(resourcesPath)
assert.equal(basename(resources), 'Resources')
assert.equal(realpathSync(resources), resources, 'Package path must be canonical')
const asar = join(resources, 'app.asar')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

function readRegular(path) {
  assert(lstatSync(path).isFile(), 'Expected a regular packaged file: ' + path)
  return readFileSync(path, { flag: constants.O_RDONLY | constants.O_NOFOLLOW })
}

const asarSha256 = hash(readRegular(asar))
function readMember(name) {
  const entry = statFile(asar, name, false)
  assert('offset' in entry && !entry.unpacked, 'Expected an actual ASAR member: ' + name)
  return extractFile(asar, name, false)
}
const { main } = JSON.parse(readMember('package.json'))
assert.equal(main, '.vite/build/main.cjs')
const mainSha256 = hash(readMember(main))

const root = join(resources, 'geometry-prototype')
const kernel = join(root, 'replicad-opencascadejs')
const dist = join(kernel, 'dist')
function verifyDirectory(path, names) {
  assert(lstatSync(path).isDirectory(), 'Expected a packaged directory: ' + path)
  assert.deepEqual(readdirSync(path).sort(), names.sort(), 'Unexpected inventory: ' + path)
}
verifyDirectory(root, ['geometry-assets.json', 'worker.mjs', 'fixture.json', 'replicad-opencascadejs'])
verifyDirectory(kernel, ['LICENSE', 'package.json', 'dist'])
const distFiles = ['replicad_single.cjs', 'replicad_single.js', 'replicad_single.wasm']
verifyDirectory(dist, distFiles)

const manifestBytes = readRegular(join(root, 'geometry-assets.json'))
assert.equal(hash(manifestBytes), trustedDigest, 'Packaged geometry manifest SHA-256 mismatch')
const manifest = JSON.parse(manifestBytes)
assert.deepEqual(Object.keys(manifest).sort(), ['package', 'sha256', 'version'])
assert.equal(manifest.package, 'replicad-opencascadejs')
assert.equal(manifest.version, '1.2.1')
const files = [
  'worker.mjs',
  'fixture.json',
  'replicad-opencascadejs/LICENSE',
  'replicad-opencascadejs/package.json',
  ...distFiles.map(name => 'replicad-opencascadejs/dist/' + name),
]
const actual = Object.fromEntries(files.map(name => [name, hash(readRegular(join(root, name)))]))
assert.deepEqual(actual, manifest.sha256, 'Packaged geometry asset SHA-256 mismatch')
const report = await runGeometryProbe(join(root, 'worker.mjs'), {
  jobId: randomUUID(), attempt: 1, inputFingerprint: actual['fixture.json'],
})
console.log(JSON.stringify({
  resources, asarSha256, main, mainSha256, manifestSha256: trustedDigest, assets: actual, report,
  scope: 'Packaged Resources worker and ASAR member audit; Node/headless execution is not full App acceptance',
}, null, 2))
