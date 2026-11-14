import { describe, it, expect } from 'vitest'
import { Worker } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { STEP_ASSET_HASHES } from '../main/cad/stepAssetManifest'
const assetDirectory = path.join(process.cwd(), 'node_modules/.cache/step-kernel')
const good = { innerDiameter: 200001, outerDiameter: 320000, length: 120000 }
async function run(bytes: Uint8Array) {
  const worker = new Worker(path.join(assetDirectory, 'step-worker.cjs'), {
    workerData: { input: good, assetDirectory, hashes: STEP_ASSET_HASHES, localWasm: { bytes, sha256: createHash('sha256').update(bytes).digest('hex') } },
    execArgv: [], env: {}, resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
  })
  try { return await new Promise<{ bytes?: Uint8Array; error?: string }>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); worker.once('exit', code => reject(new Error(`exit ${code}`))) }) }
  finally { await worker.terminate() }
}
describe('local WASM remains inside pinned worker/glue', () => {
  it('runs a behavior-modified data section with reduced real memory maximum', async () => {
    const bytes = Buffer.from(readFileSync(path.join(assetDirectory, 'replicad_single.wasm')))
    // Fixture offsets are safe only for this strictly pinned reference WASM.
    expect([...bytes.subarray(36543, 36550)]).toEqual([1, 1, 192, 12, 128, 128, 4])
    bytes.set([128, 192, 0], 36547)
    for (const text of ['Open CASCADE STEP translator 8.0', 'Open CASCADE %s processor 8.0']) {
      const offset = bytes.indexOf(text); expect(offset).toBeGreaterThan(0)
      Buffer.from(text.replace('Open CASCADE', 'USER PATCHED')).copy(bytes, offset)
    }
    const result = await run(bytes)
    expect(result.error).toBeUndefined()
    const text = Buffer.from(result.bytes!).toString('ascii')
    expect(text).toContain('USER PATCHED STEP translator 8.0')
    expect(text).toContain('MANIFOLD_SOLID_BREP')
    expect(text).toContain('AUTOMOTIVE_DESIGN')
  }, 30000)
  it('rejects invalid binary, wrong ABI, and excessive memory instead of default fallback', async () => {
    const excessiveTable = Buffer.from(readFileSync(path.join(assetDirectory, 'replicad_single.wasm')))
    excessiveTable.set([128, 192, 0], 36547)
    excessiveTable.set([255, 255, 127], 36538)
    expect(WebAssembly.validate(excessiveTable)).toBe(true)
    const sharedMemory = Buffer.from(readFileSync(path.join(assetDirectory, 'replicad_single.wasm')))
    sharedMemory[36544] = 3
    expect(WebAssembly.validate(sharedMemory)).toBe(true)
    for (const [bytes, reason] of [
      [excessiveTable, 'STEP_LOCAL_TABLE'],
      [sharedMemory, 'STEP_LOCAL_MEMORY'],
      [Buffer.from('not wasm'), 'STEP_LOCAL_COMPILE'],
      [Buffer.from([0,97,115,109,1,0,0,0]), 'STEP_LOCAL_ABI'],
      [readFileSync(path.join(assetDirectory, 'replicad_single.wasm')), 'STEP_LOCAL_MEMORY'],
    ] as const) expect((await run(bytes)).error).toContain(reason)
  }, 30000)
})
