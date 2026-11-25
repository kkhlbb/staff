// One request at a time. A synchronous native call can only be interrupted by
// terminating its thread, so do not dispatch the next request until exit.
import { Worker } from 'node:worker_threads'

export class WorkerQueue {
  #entry
  #worker
  #active
  #queue = []
  #sequence = 0
  #stopping
  #closed = false

  constructor(entry) {
    this.#entry = entry
  }

  async run(request, { timeoutMs = 30_000, signal } = {}) {
    signal?.throwIfAborted()
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2 ** 31 - 1) {
      throw new RangeError('Invalid worker timeout')
    }
    if (this.#closed) throw new Error('Worker queue closed')
    return new Promise((resolve, reject) => {
      const job = { id: ++this.#sequence, request: structuredClone(request), timeoutMs, signal, resolve, reject }
      job.abort = () => {
        if (job === this.#active) this.#stop(this.#worker, signal.reason)
        else {
          const index = this.#queue.indexOf(job)
          if (index < 0) return
          this.#queue.splice(index, 1)
          this.#finish(job, false, signal.reason)
        }
      }
      signal?.addEventListener('abort', job.abort, { once: true })
      this.#queue.push(job)
      this.#dispatch()
    })
  }

  #finish(job, ok, value) {
    clearTimeout(job.timer)
    job.signal?.removeEventListener('abort', job.abort)
    if (ok) job.resolve(value)
    else job.reject(value)
  }

  #start() {
    const worker = new Worker(this.#entry, { execArgv: [] })
    worker.on('message', message => {
      const job = this.#active
      if (worker !== this.#worker || !job || message?.id !== job.id) return
      this.#active = undefined
      this.#finish(job, message.ok, message.ok ? message.value : new Error(message.error))
      if (message.recycle) this.#stop(worker)
      else this.#dispatch()
    })
    worker.on('messageerror', error => this.#stop(worker, error))
    worker.on('error', error => this.#stop(worker, error))
    worker.once('exit', code => this.#stop(worker, new Error('Worker exited: ' + code)))
    return worker
  }

  #dispatch() {
    if (this.#closed || this.#active || this.#stopping) return
    while (this.#queue.length) {
      const job = this.#queue.shift()
      try {
        const worker = this.#worker ??= this.#start()
        worker.ref()
        this.#active = job
        job.timer = setTimeout(() => this.#stop(worker, new Error('Worker task timed out')), job.timeoutMs)
        worker.postMessage({ id: job.id, request: job.request })
        return
      } catch (error) {
        if (this.#active) {
          this.#stop(this.#worker, error)
          return
        }
        this.#finish(job, false, error)
      }
    }
    this.#worker?.unref()
  }

  #stop(worker, error) {
    if (!worker || worker !== this.#worker) return
    this.#worker = undefined
    const job = this.#active
    this.#active = undefined
    this.#stopping = worker.terminate().finally(() => {
      this.#stopping = undefined
      this.#dispatch()
    })
    // The error/exit listeners still belong to the old generation.
    void this.#stopping.catch(() => {})
    if (job) this.#finish(job, false, error)
  }

  async close() {
    this.#closed = true
    const error = new Error('Worker queue closed')
    for (const job of this.#queue.splice(0)) this.#finish(job, false, error)
    this.#stop(this.#worker, error)
    await this.#stopping
  }
}
