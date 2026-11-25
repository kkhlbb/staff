import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildA01, loadKernel, measureA05, readA01 } from './plate.mjs'

const require = createRequire(import.meta.url)
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const oc = await loadKernel()
const { step, blank, measured } = buildA01(oc)
const readback = readA01(await loadKernel(), step)
const report = {
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  kernel: {
    version: require('replicad-opencascadejs/package.json').version,
    wasmSha256: digest(readFileSync(require.resolve('replicad-opencascadejs/wasm'))),
    linearToleranceMm: oc.Precision.Confusion(),
  },
  fixtureSha256: digest(readFileSync(new URL('fixture.json', import.meta.url))),
  a01: { stepSha256: digest(step), blank, measured, readback, readbackBinding: 'fresh instance of the same WASM binding' },
  a05: { unrotated: measureA05(oc, 0), worldX90: measureA05(oc, 90) },
}
const directory = mkdtempSync(join(process.argv[2] ?? tmpdir(), 'cunlian-m0-geometry-'))
writeFileSync(join(directory, 'A01.step'), step, { flag: 'wx' })
writeFileSync(join(directory, 'measurements.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(directory)
