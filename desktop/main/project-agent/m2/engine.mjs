import { randomUUID } from 'node:crypto'
import { createGeometryManager, fingerprint } from '../../../../src/core/geometry/geometryManager.mjs'

export { fingerprint }

const managers = new Map()
const sourceWorker = new URL('../../../../src/core/geometry/geometryWorker.mjs', import.meta.url)

function manager(workerUrl = sourceWorker) {
  if (!managers.has(workerUrl.href)) managers.set(workerUrl.href, createGeometryManager(workerUrl))
  return managers.get(workerUrl.href)
}

async function run(payload, { jobId = randomUUID(), attempt = 1, workerUrl, ...options }) {
  if (!jobId || !Number.isSafeInteger(attempt) || attempt < 1) throw new RangeError('Invalid M2 execution identity')
  const { report } = await manager(workerUrl).execute(payload, { jobId, attempt, ...options })
  return report
}

export function runMountingPlate(model, { drawing, deferDrawing, ...options } = {}) {
  return run({ model, drawing, deferDrawing }, options)
}

export function runMountingPlateDrawing(report, { drawing, ...options } = {}) {
  const { model, measured, references } = report
  return run({ model, measured, references, drawing, drawingOnly: true }, options)
}

export async function releaseMountingPlate(projectId, revision, workerUrl = sourceWorker) {
  await managers.get(workerUrl.href)?.release(projectId, revision)
}
