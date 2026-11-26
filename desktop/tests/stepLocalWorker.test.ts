import { describe, it, expect } from 'vitest'
import { Worker } from 'node:worker_threads'
import { behaviorModifiedWasm, sectionChanged, signatureMismatchWasm } from './narrowWasmFixture'
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { STEP_ASSET_HASHES } from '../main/cad/stepAssetManifest'
const assetDirectory = path.join(process.cwd(), 'node_modules/.cache/occt-unified')
const good = { innerDiameter: 200001, outerDiameter: 320000, length: 120000 }
async function run(bytes: Uint8Array, defaults?: { directory: string; hashes: Record<string, string> }) {
  const worker = new Worker(path.join(defaults?.directory ?? assetDirectory, 'step-worker.cjs'), {
    workerData: { input: good, assetDirectory: defaults?.directory ?? assetDirectory, hashes: defaults?.hashes ?? STEP_ASSET_HASHES, ...(defaults ? {} : { localWasm: { bytes, sha256: createHash('sha256').update(bytes).digest('hex') } }) },
    execArgv: [], env: {}, resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
  })
  try { return await new Promise<{ bytes?: Uint8Array; error?: string }>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); worker.once('exit', code => reject(new Error(`exit ${code}`))) }) }
  finally { await worker.terminate() }
}
describe('local WASM remains inside pinned worker/glue', () => {
  it('rejects matching export names with an incompatible function signature before execution', async () => {
    const bytes = signatureMismatchWasm()
    expect(WebAssembly.validate(bytes)).toBe(true)
    expect((await run(bytes)).error).toContain('STEP_LOCAL_ABI')
  }, 30000)
  it('enforces real memory and table declarations on the default branch too', async () => {
    // Isolated worker fixtures have their own explicit pins; never relax main pins.
    for (const [bytes, reason] of [[sectionChanged(5, [1, 1, 0x80, 2, 0x80, 0x80, 4]), 'STEP_MEMORY'], [sectionChanged(4, [1, 0x70, 1, 1, 0xff, 0xff, 0x7f]), 'STEP_TABLE']] as const) {
      const directory = mkdtempSync(path.join(process.cwd(), 'node_modules/.cache/narrow-limits-'))
      cpSync(assetDirectory, directory, { recursive: true })
      writeFileSync(path.join(directory, 'cunlian_occt.wasm'), bytes)
      const hashes = { ...STEP_ASSET_HASHES, 'cunlian_occt.wasm': createHash('sha256').update(bytes).digest('hex') }
      expect((await run(bytes, { directory, hashes })).error).toContain(reason)
    }
  }, 30000)

  it('runs a behavior-modified data section with reduced real memory maximum', async () => {
    const bytes = behaviorModifiedWasm()
    const result = await run(bytes)
    expect(result.error).toBeUndefined()
    const text = Buffer.from(result.bytes!).toString('ascii')
    expect(text).toContain('USER PATCHED STEP translator 7.8')
    expect(text).toContain('MANIFOLD_SOLID_BREP')
    expect(text).toContain('AUTOMOTIVE_DESIGN')
  }, 30000)
  it('rejects invalid binary, wrong ABI, and excessive memory instead of default fallback', async () => {
    const excessiveTable = sectionChanged(4, [1, 0x70, 1, 1, 0xff, 0xff, 0x7f])
    const sharedMemory = sectionChanged(5, [1, 3, 0x80, 2, 0x80, 0x40])
    const excessiveMemory = sectionChanged(5, [1, 1, 0x80, 2, 0x80, 0x80, 4])
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
