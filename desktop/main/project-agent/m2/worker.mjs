import { parentPort, workerData } from 'node:worker_threads'
import { loadKernel } from '../../geometry-prototype/plate.mjs'
import { probeVersion } from '../../geometry-prototype/probe.mjs'
import { fingerprint } from './engine.mjs'
import { projectPlate } from './drawing.mjs'
import { evaluate } from './evaluate.mjs'

const { task, payload } = workerData
if (task?.version !== probeVersion || typeof task.jobId !== 'string' || !task.jobId ||
    !Number.isSafeInteger(task.attempt) || task.attempt < 1 || task.inputFingerprint !== fingerprint(payload)) {
  throw new Error('Invalid M2 execution identity')
}
const report = payload.drawingOnly
  ? projectPlate(payload.model, payload.measured, payload.references, payload.drawing)
  : evaluate(await loadKernel({ print: () => {} }, import.meta.url.endsWith('/m2-geometry-worker.mjs')), payload.model, payload.drawing,
  [task.jobId, task.attempt, task.inputFingerprint].join('/'), payload.deferDrawing)
parentPort.postMessage({ task, report: { ...report, execution: task } })
