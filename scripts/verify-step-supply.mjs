import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.includes(':') || path.posix.isAbsolute(value) || value.split('/').some(p => p === '..' || p === '.' || !p)) throw new Error('SUPPLY_UNSAFE_PATH')
  return value
}
function inventory(base, prefix = '') {
  const result = []
  for (const item of readdirSync(path.join(base, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${item.name}` : item.name
    if (item.isSymbolicLink()) throw new Error('SUPPLY_SYMLINK')
    if (item.isDirectory()) result.push(...inventory(base, rel))
    else if (item.isFile()) result.push(rel)
    else throw new Error('SUPPLY_SPECIAL_FILE')
  }
  return result.sort()
}
function verifyFiles(base, manifest, excluded = []) {
  if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object' || !Object.keys(manifest).length) throw new Error('SUPPLY_MANIFEST_INVALID')
  const root = realpathSync(base)
  for (const [rel, record] of Object.entries(manifest)) {
    safeRelative(rel)
    const file = path.join(root, rel)
    if (!/^([a-f0-9]{64})$/.test(record.sha256) || !Number.isSafeInteger(record.bytes) || record.bytes < 0) throw new Error('SUPPLY_RECORD_INVALID')
    // Reject links in every parent, not only at the final component.
    let current = root
    for (const part of rel.split('/')) {
      current = path.join(current, part)
      if (lstatSync(current).isSymbolicLink()) throw new Error('SUPPLY_SYMLINK')
    }
    const bytes = readFileSync(file)
    if (bytes.length !== record.bytes || sha(bytes) !== record.sha256) throw new Error(`SUPPLY_HASH_MISMATCH: ${rel}`)
  }
  const actual = inventory(root).filter(p => !excluded.includes(p))
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(manifest).sort())) throw new Error('SUPPLY_UNINDEXED_FILE')
}
export function verifySupply(directory, resources) {
  if (!directory || !resources) throw new Error('SUPPLY_AND_RESOURCE_TARGET_REQUIRED')
  const manifest = JSON.parse(readFileSync(path.join(directory, 'MANIFEST.json'), 'utf8'))
  verifyFiles(directory, manifest, ['MANIFEST.json'])
  const binding = JSON.parse(readFileSync(path.join(directory, 'PRODUCT-BINDING.json'), 'utf8'))
  if (binding.schema !== 'cunlian-local-source-supply-v1' || binding.legalCertification !== false || binding.releaseApproval !== 'BLOCKED' || !binding.sourceCommit) throw new Error('SUPPLY_BINDING_INVALID')
  verifyFiles(resources, binding.resourceFiles)
  const sourceInputs = ['source/core-supply-product.tar.gz', 'source/final-build-evidence.tar.gz', 'source/product-integration-source-final.tar.gz', 'source/tool-materials/TOOLS.json', 'closeout-source.tar.gz']
  for (const rel of sourceInputs) if (!manifest[rel]) throw new Error(`SUPPLY_REQUIRED_INPUT_MISSING: ${rel}`)
  for (const rel of ['app.asar', 'step-narrow-v1/spacer.wasm', 'step-narrow-v1/spacer.cjs', 'step-narrow-v1/step-worker.cjs', 'step-narrow-v1/SOURCE-SUPPLY.zh-CN.md']) if (!binding.resourceFiles[rel]) throw new Error(`SUPPLY_REQUIRED_RESOURCE_MISSING: ${rel}`)
  return { status: 'LOCAL_MATERIALS_VERIFIED', supplyFiles: Object.keys(manifest).length, resourceFiles: Object.keys(binding.resourceFiles).length, sourceCommit: binding.sourceCommit, releaseApproval: 'BLOCKED', legalCertification: false }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(verifySupply(process.argv[2], process.argv[3]), null, 2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
