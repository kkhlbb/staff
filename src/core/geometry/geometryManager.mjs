import { createHash } from 'node:crypto'
import { WorkerQueue } from './workerQueue.mjs'

export const geometryProtocolVersion = 1

export function fingerprint(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function createGeometryManager(workerUrl = new URL('./geometryWorker.mjs', import.meta.url), { memoryLimitBytes } = {}) {
  const queue = new WorkerQueue(workerUrl)
  let used = false
  let closing
  return {
    async execute(payload, { jobId, attempt, projectId, ...options }) {
      if (closing) throw new Error('Geometry manager closed')
      const task = { jobId, attempt, version: geometryProtocolVersion, inputFingerprint: fingerprint(payload) }
      used = true
      const response = await queue.run({ kind: 'evaluate', task, payload, projectId, memoryLimitBytes }, options)
      if (!Object.keys(task).every(key => response?.report?.execution?.[key] === task[key])) {
        throw new Error('Invalid geometry execution identity')
      }
      return response
    },
    release(projectId, revision) {
      if (closing) throw new Error('Geometry manager closed')
      return queue.run({ kind: 'release', projectId, revision })
    },
    close() {
      return closing ??= used ? queue.run({ kind: 'clear' }).finally(() => queue.close()) : queue.close()
    },
  }
}
