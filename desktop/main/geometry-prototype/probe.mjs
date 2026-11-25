import { Worker } from 'node:worker_threads'

export const probeVersion = 1

// One development fixture per worker. The only output is an in-memory report.
export async function runGeometryProbe(entry, identity, { timeoutMs = 30_000, signal, payload } = {}) {
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2 ** 31 - 1) {
    throw new RangeError('Invalid geometry probe timeout')
  }
  const task = { ...identity, version: probeVersion }
  const worker = new Worker(entry, { execArgv: [], workerData: payload === undefined ? task : { task, payload } })
  return new Promise((resolve, reject) => {
    let report
    let closed = false
    const timer = setTimeout(() => stop(new Error('Geometry probe timed out')), timeoutMs)

    function close() {
      if (closed) return false
      closed = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      return true
    }

    function stop(error) {
      if (close()) void worker.terminate().then(() => reject(error), reject)
    }

    function abort() {
      stop(signal.reason)
    }

    worker.on('message', (message) => {
      if (closed || !Object.keys(task).every((key) => message?.task?.[key] === task[key])) return
      if (report !== undefined) {
        stop(new Error('Duplicate geometry probe report'))
        return
      }
      report = message.report
    })
    worker.once('error', stop)
    worker.once('exit', (code) => {
      if (!close()) return
      if (code !== 0 || report === undefined) reject(new Error('Geometry probe exited without a valid report: ' + code))
      else resolve(report)
    })
    signal?.addEventListener('abort', abort, { once: true })
  })
}
