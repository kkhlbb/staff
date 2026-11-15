import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { verifyAssets } from './step-assets.mjs'
// Release decision, not a packaging smoke test. No override flag.
const target = process.argv[2]
let bom, packageVerification = 'RESOURCE_TARGET_REQUIRED'
try {
  if (target) {
    const directory = path.resolve(target, 'step-narrow-v1')
    verifyAssets(directory)
    bom = JSON.parse(readFileSync(path.join(directory, 'STEP-SBOM.cdx.json'), 'utf8'))
    packageVerification = 'VERIFIED'
  } else bom = JSON.parse(readFileSync(fileURLToPath(new URL('../STEP-NARROW-SBOM.cdx.json', import.meta.url)), 'utf8'))
  const properties = Object.fromEntries(bom.metadata.properties.map(p => [p.name, p.value]))
  console.error(JSON.stringify({ status: properties['cunlian:distributionApproval'], completeness: properties['cunlian:completeness'], packageVerification, blockers: [...(target ? [] : ['PACKAGED_RESOURCE_TARGET_REQUIRED']), ...properties['cunlian:blockers'].split(';')], legalCertification: false }, null, 2))
} catch {
  console.error(JSON.stringify({ status: 'BLOCKED_PACKAGED_ASSET_VERIFICATION', packageVerification: 'FAILED', legalCertification: false }, null, 2))
}
// Evidence-backed review and code change required; never an environment waiver.
process.exitCode = 1
