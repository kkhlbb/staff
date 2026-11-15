import { describe, it, expect } from 'vitest'
import { Worker } from 'node:worker_threads'
import { behaviorModifiedWasm, sectionChanged } from './narrowWasmFixture'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { STEP_ASSET_HASHES } from '../main/cad/stepAssetManifest'
const assetDirectory = path.join(process.cwd(), 'node_modules/.cache/step-narrow-v1')
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
    const bytes = behaviorModifiedWasm()
    const result = await run(bytes)
    expect(result.error).toBeUndefined()
    const text = Buffer.from(result.bytes!).toString('ascii')
    expect(text).toContain('USER PATCHED STEP translator 8.0')
    expect(text).toContain('MANIFOLD_SOLID_BREP')
    expect(text).toContain('AUTOMOTIVE_DESIGN')
  }, 30000)
  it('rejects invalid binary, wrong ABI, and excessive memory instead of default fallback', async () => {
    const excessiveTable = sectionChanged(4, [1, 0x70, 1, 1, 0xff, 0xff, 0x7f])
    const sharedMemory = sectionChanged(5, [1, 3, 0x80, 2, 0x80, 0x40])
    const excessiveMemory = sectionChanged(5, [1, 1, 0x80, 2, 0x80, 0x80, 1])
    const unboundedMemory = sectionChanged(5, [1, 0, 0x80, 2])
    for (const bytes of [excessiveTable, sharedMemory, excessiveMemory, unboundedMemory]) expect(WebAssembly.validate(bytes)).toBe(true)
    for (const [bytes, reason] of [
      [excessiveTable, 'STEP_LOCAL_TABLE'],
      [sharedMemory, 'STEP_LOCAL_MEMORY'],
      [Buffer.from('not wasm'), 'STEP_LOCAL_COMPILE'],
      [Buffer.from([0,97,115,109,1,0,0,0]), 'STEP_LOCAL_ABI'],
      [excessiveMemory, 'STEP_LOCAL_MEMORY'],
      [unboundedMemory, 'STEP_LOCAL_MEMORY'],
    ] as const) expect((await run(bytes)).error).toContain(reason)
  }, 30000)
})
