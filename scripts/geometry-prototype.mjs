import { resolve } from 'node:path'
import { prepareGeometryResources, smokeGeometryWorker } from '../desktop/main/geometry-prototype/resources.mjs'

const [command, directory, trustedManifestSha256, ...extra] = process.argv.slice(2)
if (!directory || extra.length || !(
  (command === 'prepare' && trustedManifestSha256 === undefined) ||
  (command === 'smoke' && /^[a-f0-9]{64}$/.test(trustedManifestSha256))
)) {
  throw new Error('Usage: node scripts/geometry-prototype.mjs prepare <existing-parent> | smoke <staged-directory> <sha256-from-separate-prepare-receipt>')
}
const result = command === 'prepare'
  ? await prepareGeometryResources(resolve(directory))
  : await smokeGeometryWorker(resolve(directory), trustedManifestSha256)
console.log(JSON.stringify(result, null, 2))
