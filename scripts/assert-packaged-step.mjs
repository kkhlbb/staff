import path from 'node:path'
import { statSync, readFileSync, readdirSync } from 'node:fs'
import { listPackage, statFile } from '@electron/asar'
import { verifyAssets, hashes } from './step-assets.mjs'

// Pass an actual Resources (macOS) / resources (Windows/Linux) directory.
const resources = process.argv[2]
if (!resources) throw new Error('Usage: node scripts/assert-packaged-step.mjs <packaged-resources-directory>')
const resolvedResources = path.resolve(resources)
const directory = path.resolve(resolvedResources, 'occt-unified')
if (!statSync(path.join(resolvedResources, 'app.asar')).isFile()) throw new Error('STEP_NOT_PACKAGED: app.asar absent')
verifyAssets(directory)
// Audit actual package members as well as the selected runtime directory.
const members = listPackage(path.join(resolvedResources, 'app.asar'), {})
const m2Worker = '/.vite/build/m2-worker/'
const m2Assets = new Map([
  ['fixture.json', '../desktop/main/geometry-prototype/fixture.json'],
])
if (members.some(name => /replicad[_-](?:single|opencascadejs)|spacer\.(?:wasm|cjs)|[/\\](?:step-kernel|step-narrow-v1)(?:[/\\]|$)/.test(name))) {
  throw new Error('STEP_LEGACY_KERNEL_PACKAGED')
}
const asar = path.resolve(resolvedResources, 'app.asar')
for (const name of [...m2Assets.keys(), 'm2-geometry-worker.mjs', 'solverWorker.mjs']) {
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
const resourceEntries = readdirSync(resolvedResources)
if (resourceEntries.includes('step-kernel') || resourceEntries.includes('step-narrow-v1')) {
  throw new Error('STEP_LEGACY_KERNEL_PACKAGED')
}
// Require exact texts, not placeholder notices, in the packaged external resources.
for (const name of ['LICENSE_LGPL_21.txt', 'OCCT_LGPL_EXCEPTION.txt', 'SOURCE.md', 'SHA256SUMS']) {
  const source = new URL(`../vendor/occt-unified/${name}`, import.meta.url)
  if (!readFileSync(source).equals(readFileSync(path.join(directory, name)))) throw new Error(`STEP_LICENSE_CHANGED: ${name}`)
}
console.log(JSON.stringify({ status: 'PACKAGED_UNIFIED_OCCT_ASSETS_VERIFIED', directory, hashes, distributionApproval: 'APPROVED_UNIFIED_OCCT_LGPL_21' }, null, 2))
