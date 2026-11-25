import { parentPort, threadId } from 'node:worker_threads'
import { loadKernel } from '../../../desktop/main/geometry-prototype/plate.mjs'
import { projectPlate } from '../../../desktop/main/project-agent/m2/drawing.mjs'
import { evaluate } from '../../../desktop/main/project-agent/m2/evaluate.mjs'
import { fingerprint, geometryProtocolVersion } from './geometryManager.mjs'
import { runAssemblyGeometry } from './assemblyGeometry.mjs'
import { ShapeCache } from './shapeCache.mjs'

const bundled = import.meta.url.endsWith('/m2-geometry-worker.mjs')
const cache = new ShapeCache()
const assemblies = new ShapeCache(8, {
  count: assembly => assembly.entries.length,
  dispose: assembly => assembly.scope.dispose(),
})

function clearCaches() {
  try {
    assemblies.clear()
  } finally {
    cache.clear()
  }
}

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
  return { threadId, wasmInitializations, cachedShapeBuilds, cachedShapeHandles: cache.handles + assemblies.handles,
    wasmHeapBytes: kernel?.wasmMemory?.buffer.byteLength ?? 0, rss, heapUsed, external }
}

async function execute({ kind, payload, task, projectId, revision }) {
  if (kind === 'clear') {
    clearCaches()
    return
  }
  if (kind === 'release') {
    try {
      assemblies.release(projectId, revision)
    } finally {
      cache.release(projectId, revision)
    }
    return
  }
  if (kind !== 'evaluate' || task?.version !== geometryProtocolVersion || typeof task.jobId !== 'string' || !task.jobId ||
      !Number.isSafeInteger(task.attempt) || task.attempt < 1 || task.inputFingerprint !== fingerprint(payload)) {
    throw new Error('Invalid geometry execution identity')
  }
  if (payload.operation === 'import-step' || payload.operation === 'rebuild-assembly') {
    if (projectId !== undefined && (typeof payload.revision !== 'string' || !payload.revision)) {
      throw new Error('Assembly cache requires a revision')
    }
    const oc = await load()
    const report = runAssemblyGeometry(oc, payload, projectId === undefined ? undefined : (key, build) =>
      assemblies.acquire(projectId, payload.revision, key, () => {
        const result = build()
        cachedShapeBuilds++
        return result
      }))
    return { ...report, execution: task }
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
      clearCaches()
      stats = metrics()
    }
    parentPort.postMessage({ id, ok: true, value: { report, metrics: stats }, recycle })
  } catch (error) {
    let message = String(error)
    try {
      clearCaches()
    } catch (cleanupError) {
      message += '\n' + String(cleanupError)
    } finally {
      parentPort.postMessage({ id, ok: false, error: message, recycle: true })
    }
  }
})
