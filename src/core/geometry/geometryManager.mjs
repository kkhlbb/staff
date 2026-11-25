import { createHash } from 'node:crypto'
import { WorkerQueue } from './workerQueue.mjs'

export const geometryProtocolVersion = 1

export function fingerprint(payload) {
  if (payload?.operation === 'import-step' || payload?.operation === 'rebuild-assembly') {
    payload = { ...payload, attachments: payload.attachments?.map(({ bytes, ...attachment }) => ({
      ...attachment, byteDigest: bytes instanceof Uint8Array ? createHash('sha256').update(bytes).digest('hex') : null,
    })) }
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function createGeometryManager(workerUrl = new URL('./geometryWorker.mjs', import.meta.url), { memoryLimitBytes } = {}) {
  const queue = new WorkerQueue(workerUrl)
  let used = false
  let closing
  const manager = {
    importStep(attachment, options) {
      const { revision, drawing, ...execution } = options
      return manager.execute({ operation: 'import-step', attachments: [attachment], attachmentId: attachment.id, revision, drawing }, execution)
    },
    rebuildAssembly(model, options) {
      const { revision, attachments, drawing, ...execution } = options
      return manager.execute({ operation: 'rebuild-assembly', model, attachments, revision, drawing }, execution)
    },
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
  return manager
}
