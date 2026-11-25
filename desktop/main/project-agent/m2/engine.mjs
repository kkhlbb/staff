import { randomUUID } from 'node:crypto'
import { createGeometryManager, fingerprint } from '../../../../src/core/geometry/geometryManager.mjs'

export { fingerprint }

const managers = new Map()

// Packaged main supplies the unpacked worker URL. Only source callers need the manager's default.
const workerKey = workerUrl => workerUrl?.href

function manager(workerUrl) {
  const key = workerKey(workerUrl)
  if (!managers.has(key)) managers.set(key, createGeometryManager(workerUrl))
  return managers.get(key)
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

export async function releaseMountingPlate(projectId, revision, workerUrl) {
  await managers.get(workerKey(workerUrl))?.release(projectId, revision)
}
