import { describe, it, expect, vi } from 'vitest'
import { Worker } from 'node:worker_threads'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { generateStep } from '../main/cad/stepKernel'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const good = { innerDiameter: 200000, outerDiameter: 320000, length: 120000 }
describe('fixed low-level STEP worker', () => {
  it('rejects malformed and unsupported geometry without normalization', async () => {
    for (const input of [null, {}, { ...good, extra: 1 }, { ...good, length: NaN }, { ...good, length: 1.5 }, { ...good, innerDiameter: 0 }, { ...good, outerDiameter: 200000 }, { ...good, length: 1 }, { ...good, length: 10000000001 }]) {
      await expect(generateStep(input as typeof good)).rejects.toThrow(/STEP_INVALID|STEP_UNSUPPORTED/)
    }
  })
  it('honours an already aborted request', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(generateStep(good, { signal: controller.signal })).rejects.toThrow('STEP_CANCELLED')
  })
  it('terminates a running worker on cancellation and then recovers', async () => {
    const controller = new AbortController()
    const terminate = vi.spyOn(Worker.prototype, 'terminate')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const job = generateStep(good, { signal: controller.signal })
      const assertion = expect(job).rejects.toThrow('STEP_CANCELLED')
      for (let turn = 0; vi.getTimerCount() === 0 && turn < 10000; turn++) await nextTurn()
      expect(vi.getTimerCount()).toBe(1)
      controller.abort()
      await assertion
      expect(terminate).toHaveBeenCalledOnce()
      await expect(terminate.mock.results[0].value).resolves.toBeTypeOf('number')
    } finally { vi.useRealTimers(); terminate.mockRestore() }
    const result = await generateStep(good)
    expect(result.bytes.length).toBeGreaterThan(8000)
  }, 30000)
  it('rejects overlapping jobs, terminates the actual worker on timeout, and recovers', async () => {
    const terminate = vi.spyOn(Worker.prototype, 'terminate')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const job = generateStep(good)
      const assertion = expect(job).rejects.toThrow('STEP_TIMEOUT')
      await expect(generateStep(good)).rejects.toThrow('STEP_BUSY')
      for (let turn = 0; vi.getTimerCount() === 0 && turn < 10000; turn++) await nextTurn()
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(30000)
      await assertion
      expect(terminate).toHaveBeenCalledOnce()
      // terminate() returned a resolved exit promise, not a pretend cancellation flag.
      await expect(terminate.mock.results[0].value).resolves.toBeTypeOf('number')
    } finally { vi.useRealTimers(); terminate.mockRestore() }
    expect((await generateStep(good)).bytes.length).toBeGreaterThan(8000)
  }, 30000)
  it('uses external packaged resources exclusively; rejects missing and tampered assets', async () => {
    const root = mkdtempSync(path.join(process.cwd(), 'node_modules/.cache/step-test-'))
    const original = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    const originalDefaultApp = Object.getOwnPropertyDescriptor(process, 'defaultApp')
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: root })
    Object.defineProperty(process, 'defaultApp', { configurable: true, value: false })
    try {
      await expect(generateStep(good)).rejects.toThrow('STEP_ASSET_MISSING')
      cpSync(path.join(process.cwd(), 'node_modules/.cache/step-kernel'), path.join(root, 'step-kernel'), { recursive: true })
      expect((await generateStep(good)).bytes.length).toBeGreaterThan(8000)
      for (const name of ['replicad_single.cjs', 'replicad_single.js', 'replicad_single.wasm', 'step-worker.cjs']) {
        writeFileSync(path.join(root, 'step-kernel', name), 'tampered')
        await expect(generateStep(good)).rejects.toThrow(`STEP_ASSET_HASH: ${name}`)
        cpSync(path.join(process.cwd(), 'node_modules/.cache/step-kernel', name), path.join(root, 'step-kernel', name))
      }
    } finally {
      if (original) Object.defineProperty(process, 'resourcesPath', original)
      else Reflect.deleteProperty(process, 'resourcesPath')
      if (originalDefaultApp) Object.defineProperty(process, 'defaultApp', originalDefaultApp)
      else Reflect.deleteProperty(process, 'defaultApp')
      rmSync(root, { recursive: true, force: true })
    }
  }, 30000)
  it.each([200000, 200001])('exports an actual AP214IS mm hollow solid (inner q=%i)', async innerDiameter => {
    const result = await generateStep({ ...good, innerDiameter })
    const text = Buffer.from(result.bytes).toString('ascii')
    expect(text).toContain('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }')
    expect(text).toMatch(/SI_UNIT\(\.MILLI\.,\.METRE\.\)/)
    expect(text).toContain('MANIFOLD_SOLID_BREP')
    expect(text).not.toContain('B_SPLINE_SURFACE')
    expect(result.wasmSha256).toBe('a9335919fa64bfeaee3e241d3139ad134022682429c6688e20d8ca12093d33d9')
    expect(result.kernelVersion).toBe('replicad-opencascadejs@1.2.1 / OCCT 8.0')
    expect(result.generatorVersion).toMatch(/^spacer-ap214is-v1/)
  }, 30000)
})
