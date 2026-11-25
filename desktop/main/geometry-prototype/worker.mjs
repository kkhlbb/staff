import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parentPort, workerData } from 'node:worker_threads'
import { buildA01, measureA05, readA01 } from './plate.mjs'

import { probeVersion } from './probe.mjs'

const fixtureSha256 = createHash('sha256').update(readFileSync(new URL('fixture.json', import.meta.url))).digest('hex')
if (workerData?.version !== probeVersion || typeof workerData.jobId !== 'string' || !workerData.jobId ||
    !Number.isSafeInteger(workerData.attempt) || workerData.attempt < 1 || workerData.inputFingerprint !== fixtureSha256) {
  throw new Error('Invalid geometry probe task or fixture input')
}

const require = createRequire(import.meta.url)
const kernel = new URL('./replicad-opencascadejs/dist/', import.meta.url)
const initialize = require(fileURLToPath(new URL('replicad_single.cjs', kernel)))
const load = () => initialize({
  print: console.error,
  printErr: console.error,
  locateFile(name) {
    if (name !== 'replicad_single.wasm') throw new Error('Unexpected geometry runtime asset: ' + name)
    return fileURLToPath(new URL(name, kernel))
  },
})

const oc = await load()
const { step, blank, measured } = buildA01(oc)
const readback = readA01(await load(), step)
const report = {
  runtime: { node: process.version, platform: process.platform, arch: process.arch, electron: process.versions.electron ?? null },
  fixtureSha256,
  linearToleranceMm: oc.Precision.Confusion(),
  a01: { blank, measured, readback, readbackBinding: 'fresh instance of the same WASM binding' },
  a05: { unrotated: measureA05(oc, 0), worldX90: measureA05(oc, 90) },
}
parentPort.postMessage({ task: workerData, report })
