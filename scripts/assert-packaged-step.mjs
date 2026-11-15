import path from 'node:path'
import { statSync, readFileSync, readdirSync } from 'node:fs'
import { listPackage } from '@electron/asar'
import { verifyAssets, hashes } from './step-assets.mjs'

// Pass an actual Resources (macOS) / resources (Windows/Linux) directory.
const resources = process.argv[2]
if (!resources) throw new Error('Usage: node scripts/assert-packaged-step.mjs <packaged-resources-directory>')
const directory = path.resolve(resources, 'step-narrow-v1')
if (!statSync(path.join(path.resolve(resources), 'app.asar')).isFile()) throw new Error('STEP_NOT_PACKAGED: app.asar absent')
verifyAssets(directory)
// Audit actual package members as well as the selected runtime directory.
const members = listPackage(path.join(path.resolve(resources), 'app.asar'), {})
if (members.some(name => /replicad[_-](?:single|opencascadejs)|[/\\]step-kernel(?:[/\\]|$)/.test(name))) throw new Error('STEP_LEGACY_KERNEL_PACKAGED')
if (readdirSync(path.resolve(resources)).includes('step-kernel')) throw new Error('STEP_LEGACY_KERNEL_PACKAGED')
// Require exact texts, not placeholder notices, in the packaged external resources.
for (const name of ['LICENSE_LGPL_21.txt', 'OCCT_LGPL_EXCEPTION.txt']) {
  const source = new URL(`../desktop/main/cad/licenses/${name}`, import.meta.url)
  if (!readFileSync(source).equals(readFileSync(path.join(directory, name)))) throw new Error(`STEP_LICENSE_CHANGED: ${name}`)
}
console.log(JSON.stringify({ status: 'PACKAGED_STEP_ASSETS_VERIFIED', directory, hashes, runtimeExecution: 'NOT_TESTED_BY_THIS_SCRIPT', distributionApproval: 'BLOCKED_PROVENANCE_AND_LGPL_SOURCE_SUPPLY' }, null, 2))
