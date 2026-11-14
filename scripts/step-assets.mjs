import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const assetDirectory = path.join(root, 'node_modules/.cache/step-kernel')
// TS manifest is the single reviewed hash source, not rewritten by preparation.
const manifestText = readFileSync(path.join(root, 'desktop/main/cad/stepAssetManifest.ts'), 'utf8')
export const hashes = Object.fromEntries([...manifestText.matchAll(/'([^']+)': '([0-9a-f]{64})'/g)].map(m => [m[1], m[2]]))
if (Object.keys(hashes).length !== 4) throw new Error('STEP_MANIFEST_INVALID')
export function verifyAssets(directory) {
  for (const [name, expected] of Object.entries(hashes)) {
    const bytes = readFileSync(path.join(directory, name))
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`STEP_ASSET_HASH: ${name}`)
  }
  const pkg = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (pkg.type !== 'module') throw new Error('STEP_ASSET_MODULE_TYPE')
  for (const name of ['LICENSE_LGPL_21.txt', 'OCCT_LGPL_EXCEPTION.txt', 'THIRD-PARTY-NOTICES.md']) {
    if (!readFileSync(path.join(directory, name), 'utf8').trim()) throw new Error(`STEP_LICENSE_MISSING: ${name}`)
  }
}
export function prepareStepAssets() {
  const pkgDir = path.join(root, 'node_modules/replicad-opencascadejs')
  if (JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version !== '1.2.1') throw new Error('STEP_KERNEL_VERSION')
  mkdirSync(assetDirectory, { recursive: true })
  for (const name of Object.keys(hashes)) {
    const source = name === 'step-worker.cjs' ? path.join(root, 'desktop/main/cad', name) : path.join(pkgDir, 'dist', name)
    if (createHash('sha256').update(readFileSync(source)).digest('hex') !== hashes[name]) throw new Error(`STEP_SOURCE_HASH: ${name}`)
    copyFileSync(source, path.join(assetDirectory, name))
  }
  writeFileSync(path.join(assetDirectory, 'package.json'), '{"type":"module","private":true}\n')
  for (const name of ['LICENSE_LGPL_21.txt', 'OCCT_LGPL_EXCEPTION.txt']) copyFileSync(path.join(root, 'desktop/main/cad/licenses', name), path.join(assetDirectory, name))
  copyFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(assetDirectory, 'THIRD-PARTY-NOTICES.md'))
  verifyAssets(assetDirectory)
  return assetDirectory
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(prepareStepAssets())
