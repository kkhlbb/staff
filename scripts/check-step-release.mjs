import { readFileSync } from 'node:fs'
import path from 'node:path'
import { prepareStepAssets, verifyAssets } from './step-assets.mjs'

// Release gate for unified OCCT 7.8.1 WASM provenance, LGPL 2.1 + OCCT Exception, and relinking supply.
const target = process.argv[2]
try {
  const directory = target ? path.resolve(target, 'occt-unified') : prepareStepAssets()
  verifyAssets(directory)
  const bom = JSON.parse(readFileSync(path.join(directory, 'STEP-SBOM.cdx.json'), 'utf8'))
  const properties = Object.fromEntries(bom.metadata.properties.map(p => [p.name, p.value]))
  const blockers = (properties['cunlian:blockers'] || '').split(';').filter(Boolean)
  const approved = properties['cunlian:distributionApproval'] === 'APPROVED_UNIFIED_OCCT_LGPL_21' &&
    properties['cunlian:completeness'] === 'COMPLETE' &&
    blockers.length === 0
  const report = {
    status: properties['cunlian:distributionApproval'],
    completeness: properties['cunlian:completeness'],
    packageVerification: 'VERIFIED',
    sourceSupply: properties['cunlian:sourceSupply'],
    replacement: properties['cunlian:replacement'],
    blockers,
  }
  if (approved) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.error(JSON.stringify(report, null, 2))
    process.exitCode = 1
  }
} catch (error) {
  console.error(JSON.stringify({
    status: 'BLOCKED_PACKAGED_ASSET_VERIFICATION',
    packageVerification: 'FAILED',
    error: error instanceof Error ? error.message : String(error),
  }, null, 2))
  process.exitCode = 1
}
