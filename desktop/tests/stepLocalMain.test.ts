import { it, expect, vi } from 'vitest'
import { Worker } from 'node:worker_threads'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
it('captures launch consent, reads only selected bytes, isolates worker, and never bypasses packaged default guards', async () => {
  const root = mkdtempSync(path.join(process.cwd(), 'node_modules/.cache/local-main-'))
  const bytes = Buffer.from(readFileSync('node_modules/.cache/step-kernel/replicad_single.wasm'))
  bytes.set([128, 192, 0], 36547)
  for (const text of ['Open CASCADE STEP translator 8.0', 'Open CASCADE %s processor 8.0']) Buffer.from(text.replace('Open CASCADE', 'USER PATCHED')).copy(bytes, bytes.indexOf(text))
  const file = path.join(root, 'user.wasm'); writeFileSync(file, bytes)
  const sha = createHash('sha256').update(bytes).digest('hex')
  vi.stubEnv('CUNLIAN_STEP_LOCAL_OPT_IN', '1'); vi.stubEnv('CUNLIAN_STEP_LOCAL_WASM', file); vi.stubEnv('CUNLIAN_STEP_LOCAL_SHA256', sha)
  vi.resetModules()
  const { generateStep } = await import('../main/cad/stepKernel')
  // Later environment edits do not change the captured selection.
  vi.stubEnv('CUNLIAN_STEP_LOCAL_WASM', '/must/not/read')
  const resources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  const defaultApp = Object.getOwnPropertyDescriptor(process, 'defaultApp')
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: root })
  Object.defineProperty(process, 'defaultApp', { configurable: true, value: false })
  cpSync('node_modules/.cache/step-kernel', path.join(root, 'step-kernel'), { recursive: true })
  const terminate = vi.spyOn(Worker.prototype, 'terminate')
  try {
    const input = { innerDiameter: 200001, outerDiameter: 320000, length: 120000 }
    const result = await generateStep(input)
    expect(result.wasmSha256).toBe(sha); expect(result.kernelVersion).toContain('user-selected-local-wasm')
    expect(result.generatorVersion).toContain('local-wasm-opt-in-v1')
    expect(Buffer.from(result.bytes).toString()).toContain('USER PATCHED STEP translator 8.0')
    expect(terminate).toHaveBeenCalledOnce(); await expect(terminate.mock.results[0].value).resolves.toBeTypeOf('number')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      for (const mode of ['cancel', 'timeout']) {
        const controller = new AbortController()
        const job = generateStep(input, { signal: controller.signal })
        const rejected = expect(job).rejects.toThrow(mode === 'cancel' ? 'STEP_CANCELLED' : 'STEP_TIMEOUT')
        await expect(generateStep(input)).rejects.toThrow('STEP_BUSY')
        for (let turn = 0; vi.getTimerCount() === 0 && turn < 10000; turn++) await nextTurn()
        expect(vi.getTimerCount()).toBe(1)
        if (mode === 'cancel') controller.abort(); else await vi.advanceTimersByTimeAsync(30000)
        await rejected
        await expect(terminate.mock.results.at(-1)!.value).resolves.toBeTypeOf('number')
      }
    } finally { vi.useRealTimers() }
    expect(terminate).toHaveBeenCalledTimes(3)
    expect((await generateStep(input)).wasmSha256).toBe(sha)
    for (const name of ['replicad_single.wasm', 'replicad_single.cjs', 'replicad_single.js', 'step-worker.cjs']) {
      const target = path.join(root, 'step-kernel', name), original = readFileSync(target)
      writeFileSync(target, 'tampered')
      try { await expect(generateStep(input)).rejects.toThrow(`STEP_ASSET_HASH: ${name}`) }
      finally { writeFileSync(target, original) }
    }
    writeFileSync(file, 'selected file changed')
    await expect(generateStep(input)).rejects.toThrow('STEP_LOCAL_HASH')
  } finally {
    if (resources) Object.defineProperty(process, 'resourcesPath', resources); else Reflect.deleteProperty(process, 'resourcesPath')
    if (defaultApp) Object.defineProperty(process, 'defaultApp', defaultApp); else Reflect.deleteProperty(process, 'defaultApp')
    terminate.mockRestore(); vi.unstubAllEnvs(); vi.resetModules()
  }
}, 30000)
