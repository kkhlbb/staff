import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// This is a release decision gate, NOT a packaging smoke test. No override flag.
const bom = JSON.parse(readFileSync(fileURLToPath(new URL('../STEP-SBOM.cdx.json', import.meta.url)), 'utf8'))
const properties = Object.fromEntries(bom.metadata.properties.map(p => [p.name, p.value]))
console.error(JSON.stringify({status: properties['cunlian:distributionApproval'], completeness: properties['cunlian:completeness'], blockers: properties['cunlian:blockers'].split(';'), legalCertification: false}, null, 2))
// These findings require evidence-backed review and code change, never an env waiver.
process.exitCode = 1
