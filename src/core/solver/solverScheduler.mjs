import { WorkerQueue } from '../geometry/workerQueue.mjs'

export function createSolverScheduler(workerUrl = new URL('./solverWorker.mjs', import.meta.url)) {
  const queue = new WorkerQueue(workerUrl)
  return {
    run: (request, options) => queue.run({ ...request, version: 1 }, options),
    close: () => queue.close(),
  }
}
