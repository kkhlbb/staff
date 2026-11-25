import { parentPort, threadId } from 'node:worker_threads'
import { loadKernel } from '../../../desktop/main/geometry-prototype/plate.mjs'
import { projectPlate } from '../../../desktop/main/project-agent/m2/drawing.mjs'
import { evaluate } from '../../../desktop/main/project-agent/m2/evaluate.mjs'
import { fingerprint, geometryProtocolVersion } from './geometryManager.mjs'
import { ShapeCache } from './shapeCache.mjs'

const bundled = import.meta.url.endsWith('/m2-geometry-worker.mjs')
const cache = new ShapeCache()
const defaultMemoryLimit = 512 * 1024 ** 2
let kernel
let wasmInitializations = 0
let cachedShapeBuilds = 0

async function load() {
  if (!kernel) {
    kernel = await loadKernel({ print: () => {} }, bundled)
    wasmInitializations++
  }
  return kernel
}

function metrics() {
  const { rss, heapUsed, external } = process.memoryUsage()
  return { threadId, wasmInitializations, cachedShapeBuilds, cachedShapeHandles: cache.handles,
    wasmHeapBytes: kernel?.wasmMemory?.buffer.byteLength ?? 0, rss, heapUsed, external }
}

async function execute({ kind, payload, task, projectId, revision }) {
  if (kind === 'clear') {
    cache.clear()
    return
  }
  if (kind === 'release') {
    cache.release(projectId, revision)
    return
  }
  if (kind !== 'evaluate' || task?.version !== geometryProtocolVersion || typeof task.jobId !== 'string' || !task.jobId ||
      !Number.isSafeInteger(task.attempt) || task.attempt < 1 || task.inputFingerprint !== fingerprint(payload)) {
    throw new Error('Invalid geometry execution identity')
  }
  const { model, measured, references, drawing, drawingOnly, deferDrawing } = payload
  const report = drawingOnly ? projectPlate(model, measured, references, drawing)
    : evaluate(await load(), model, drawing, [task.jobId, task.attempt, task.inputFingerprint].join('/'), deferDrawing,
      projectId === undefined ? undefined : build => cache.acquire(projectId, model.revision, fingerprint(model), () => {
        const shapes = build()
        cachedShapeBuilds++
        return shapes
      }))
  if (report.error && projectId !== undefined) cache.release(projectId, model.revision)
  return { ...report, execution: task }
}

parentPort.on('message', async ({ id, request }) => {
  try {
    const report = await execute(request)
    let stats = metrics()
    // RSS is process-wide. Use the WASM heap and worker JS heap for recycling.
    const recycle = Math.max(stats.wasmHeapBytes, stats.external) + stats.heapUsed > (request.memoryLimitBytes ?? defaultMemoryLimit)
    if (recycle) {
      cache.clear()
      stats = metrics()
    }
    parentPort.postMessage({ id, ok: true, value: { report, metrics: stats }, recycle })
  } catch (error) {
    cache.clear()
    parentPort.postMessage({ id, ok: false, error: String(error), recycle: true })
  }
})
