import { createHash, randomUUID } from 'node:crypto'
import { runGeometryProbe } from '../../geometry-prototype/probe.mjs'

export function fingerprint(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export async function runMountingPlate(model, { signal, timeoutMs, jobId = randomUUID(), attempt = 1, drawing, deferDrawing, workerUrl } = {}) {
  const payload = { model, drawing, deferDrawing }
  if (!jobId || !Number.isSafeInteger(attempt) || attempt < 1) throw new RangeError('Invalid M2 execution identity')
  return runGeometryProbe(workerUrl ?? new URL('./worker.mjs', import.meta.url),
    { jobId, attempt, inputFingerprint: fingerprint(payload) }, { timeoutMs, signal, payload })
}

export async function runMountingPlateDrawing(report, { signal, timeoutMs, jobId = randomUUID(), attempt = 1, drawing, workerUrl } = {}) {
  const { model, measured, references } = report
  const payload = { model, measured, references, drawing, drawingOnly: true }
  return runGeometryProbe(workerUrl ?? new URL('./worker.mjs', import.meta.url),
    { jobId, attempt, inputFingerprint: fingerprint(payload) }, { timeoutMs, signal, payload })
}
