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
export const legalFiles = {
  'LICENSE_LGPL_21.txt': 'desktop/main/cad/licenses/LICENSE_LGPL_21.txt',
  'OCCT_LGPL_EXCEPTION.txt': 'desktop/main/cad/licenses/OCCT_LGPL_EXCEPTION.txt',
  'REPLICAD_OCJS_LICENSE.txt': 'desktop/main/cad/licenses/REPLICAD_OCJS_LICENSE.txt',
  'THIRD-PARTY-NOTICES.md': 'THIRD-PARTY-NOTICES.md',
  NOTICE: 'NOTICE',
  'STEP-SBOM.cdx.json': 'STEP-SBOM.cdx.json',
  'STEP-CANDIDATE-LICENSES.txt': 'licenses/STEP-CANDIDATE-LICENSES.txt',
  'step-license-provenance.md': 'docs/step-license-provenance.md',
  'step-kernel-replacement.md': 'docs/step-kernel-replacement.md',
}
export function verifyAssets(directory) {
  for (const [name, expected] of Object.entries(hashes)) {
    const bytes = readFileSync(path.join(directory, name))
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`STEP_ASSET_HASH: ${name}`)
  }
  const pkg = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (pkg.type !== 'module') throw new Error('STEP_ASSET_MODULE_TYPE')
  for (const [name, source] of Object.entries(legalFiles)) {
    const actual = readFileSync(path.join(directory, name))
    if (!actual.length || !actual.equals(readFileSync(path.join(root, source)))) throw new Error(`STEP_LICENSE_CHANGED: ${name}`)
  }
  const bom = JSON.parse(readFileSync(path.join(directory, 'STEP-SBOM.cdx.json'), 'utf8'))
  const properties = Object.fromEntries(bom.metadata.properties.map(p => [p.name, p.value]))
  if (bom.bomFormat !== 'CycloneDX' || properties['cunlian:completeness'] !== 'INCOMPLETE' || properties['cunlian:distributionApproval'] !== 'BLOCKED_PROVENANCE_AND_LGPL_SOURCE_SUPPLY') throw new Error('STEP_LICENSE_GATE_INVALID')
  for (const [name, expected] of Object.entries(hashes)) {
    const component = bom.components.find(c => c['bom-ref'] === `asset:${name}`)
    if (component?.hashes?.find(h => h.alg === 'SHA-256')?.content !== expected) throw new Error(`STEP_SBOM_HASH: ${name}`)
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
  for (const [name, source] of Object.entries(legalFiles)) copyFileSync(path.join(root, source), path.join(assetDirectory, name))
  verifyAssets(assetDirectory)
  return assetDirectory
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(prepareStepAssets())
