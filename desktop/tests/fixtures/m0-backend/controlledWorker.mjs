import { parentPort, threadId } from 'node:worker_threads'

parentPort.on('message', ({ id, request }) => {
  if (request.kind === 'crash') throw new Error('fixture crash')
  if (request.kind === 'stall') return
  // Post the previous ID while a new task is already active.
  parentPort.postMessage({ id: id - 1, ok: true, value: 'stale' })
  parentPort.postMessage({ id, ok: true, value: { threadId, kind: request.kind } })
})
