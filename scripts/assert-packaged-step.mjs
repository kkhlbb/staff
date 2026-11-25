import path from 'node:path'
import { statSync, readFileSync, readdirSync } from 'node:fs'
import { listPackage, statFile } from '@electron/asar'
import { verifyAssets, hashes } from './step-assets.mjs'

// Pass an actual Resources (macOS) / resources (Windows/Linux) directory.
const resources = process.argv[2]
if (!resources) throw new Error('Usage: node scripts/assert-packaged-step.mjs <packaged-resources-directory>')
const directory = path.resolve(resources, 'step-narrow-v1')
if (!statSync(path.join(path.resolve(resources), 'app.asar')).isFile()) throw new Error('STEP_NOT_PACKAGED: app.asar absent')
verifyAssets(directory)
// Audit actual package members as well as the selected runtime directory.
const members = listPackage(path.join(path.resolve(resources), 'app.asar'), {})
const m2Worker = '/.vite/build/m2-worker/'
const m2Assets = new Map([
  ['fixture.json', '../desktop/main/geometry-prototype/fixture.json'],
  ['m2-replicad.cjs', '../node_modules/replicad-opencascadejs/dist/replicad_single.cjs'],
  ['replicad_single.js', '../node_modules/replicad-opencascadejs/dist/replicad_single.js'],
  ['replicad_single.wasm', '../node_modules/replicad-opencascadejs/dist/replicad_single.wasm'],
  ['m2-replicad-LICENSE', '../node_modules/replicad-opencascadejs/LICENSE'],
])
if (members.some(name => /replicad[_-](?:single|opencascadejs)|[/\\]step-kernel(?:[/\\]|$)/.test(name) &&
  !(name.startsWith(m2Worker) && m2Assets.has(name.slice(m2Worker.length))))) {
  throw new Error('STEP_LEGACY_KERNEL_PACKAGED')
}
const asar = path.resolve(resources, 'app.asar')
for (const name of [...m2Assets.keys(), 'm2-geometry-worker.mjs']) {
  const member = (m2Worker + name).slice(1)
  const entry = statFile(asar, member, false)
  const unpacked = path.join(asar + '.unpacked', member)
  if (!('size' in entry) || !entry.unpacked || !statSync(unpacked).isFile()) {
    throw new Error(`M2_WORKER_ASSET_NOT_UNPACKED: ${name}`)
  }
  const source = m2Assets.get(name)
  if (source && !readFileSync(new URL(source, import.meta.url)).equals(readFileSync(unpacked))) {
    throw new Error(`M2_WORKER_ASSET_CHANGED: ${name}`)
  }
}
console.log('M2_WORKER_ASSETS_VERIFIED')
if (readdirSync(path.resolve(resources)).includes('step-kernel')) throw new Error('STEP_LEGACY_KERNEL_PACKAGED')
// Require exact texts, not placeholder notices, in the packaged external resources.
for (const name of ['LICENSE_LGPL_21.txt', 'OCCT_LGPL_EXCEPTION.txt']) {
  const source = new URL(`../desktop/main/cad/licenses/${name}`, import.meta.url)
  if (!readFileSync(source).equals(readFileSync(path.join(directory, name)))) throw new Error(`STEP_LICENSE_CHANGED: ${name}`)
}
console.log(JSON.stringify({ status: 'PACKAGED_STEP_ASSETS_VERIFIED', directory, hashes, runtimeExecution: 'NOT_TESTED_BY_THIS_SCRIPT', distributionApproval: 'BLOCKED_PROVENANCE_AND_LGPL_SOURCE_SUPPLY' }, null, 2))
