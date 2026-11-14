import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { STEP_ASSET_HASHES, STEP_GENERATOR_VERSION, STEP_KERNEL_VERSION } from './stepAssetManifest'

export interface StepInput { innerDiameter: number; outerDiameter: number; length: number }
export interface StepResult { bytes: Uint8Array; kernelVersion: string; wasmSha256: string; generatorVersion: string }
export const STEP_TIMEOUT_MS = 30_000
// Keep memory bounded: reject concurrency rather than queue unbounded WASM heaps.
let active = false

function validate(input: StepInput): void {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'innerDiameter,length,outerDiameter' ||
      !Object.values(input).every(q => typeof q === 'number' && Number.isSafeInteger(q) && q > 0 && q <= 10000000000) ||
      input.outerDiameter <= input.innerDiameter) throw new Error('STEP_INVALID_INPUT')
  const { innerDiameter: d, outerDiameter: D, length: L } = input
  if (Math.min(d, D, L) < 100 || Math.max(d, D, L) > 100000000 || D - d < 200 ||
      Math.max(D, L) / Math.min(d / 2, (D - d) / 2, L) > 10000) throw new Error('STEP_UNSUPPORTED_GEOMETRY')
}

/** q integers, NOT mm. Main/Node only. No renderer execution or asset fallback. */
export async function generateStep(input: StepInput, options: { signal?: AbortSignal } = {}): Promise<StepResult> {
  validate(input)
  const snapshot = { ...input }
  if (options.signal?.aborted) throw new Error('STEP_CANCELLED')
  if (active) throw new Error('STEP_BUSY')
  active = true
  try {
    // In packaged Electron resourcesPath is the external Resources directory.
    // process.defaultApp identifies development Electron; plain Node uses this worktree.
    const runtime = process as NodeJS.Process & { resourcesPath?: string; defaultApp?: boolean }
    const assetDirectory = runtime.resourcesPath && !runtime.defaultApp
      ? path.join(runtime.resourcesPath, 'step-kernel')
      : typeof __dirname === 'string'
        ? path.resolve(__dirname, path.basename(__dirname) === 'cad' ? '../../..' : '../..', 'node_modules/.cache/step-kernel')
        : fileURLToPath(new URL('../../../node_modules/.cache/step-kernel/', import.meta.url))
    for (const [name, expected] of Object.entries(STEP_ASSET_HASHES)) {
      let bytes: Buffer
      try { bytes = await readFile(path.join(assetDirectory, name)) }
      catch { throw new Error(`STEP_ASSET_MISSING: ${name}`) }
      if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`STEP_ASSET_HASH: ${name}`)
    }
    if (options.signal?.aborted) throw new Error('STEP_CANCELLED')
    return await new Promise<StepResult>((resolve, reject) => {
      const worker = new Worker(path.join(assetDirectory, 'step-worker.cjs'), {
        workerData: { input: snapshot, assetDirectory, hashes: STEP_ASSET_HASHES },
      })
      let settled = false
      const finish = (error?: Error, bytes?: Uint8Array) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', cancel)
        // Do not resolve/reject until the worker has actually exited and its heap is released.
        void worker.terminate().then(() => {
          if (error) reject(error)
          else resolve({ bytes: bytes!, kernelVersion: STEP_KERNEL_VERSION, wasmSha256: STEP_ASSET_HASHES['replicad_single.wasm'],
            generatorVersion: `${STEP_GENERATOR_VERSION};worker-sha256=${STEP_ASSET_HASHES['step-worker.cjs']}` })
        }, reject)
      }
      const cancel = () => finish(new Error('STEP_CANCELLED'))
      const timer = setTimeout(() => finish(new Error('STEP_TIMEOUT')), STEP_TIMEOUT_MS)
      options.signal?.addEventListener('abort', cancel, { once: true })
      worker.once('error', error => finish(new Error(`STEP_WORKER_FAILED: ${error.message}`)))
      worker.once('exit', code => { if (!settled) finish(new Error(`STEP_WORKER_EXIT: ${code}`)) })
      worker.once('message', (message: { error?: string; bytes?: Uint8Array }) => {
        if (message.error) finish(new Error(message.error))
        else if (!(message.bytes instanceof Uint8Array) || !message.bytes.length) finish(new Error('STEP_WORKER_INVALID_RESULT'))
        else finish(undefined, message.bytes)
      })
      if (options.signal?.aborted) cancel()
    })
  } finally { active = false }
}
