import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { test } from 'node:test'
import { BroadcastChannel } from 'node:worker_threads'
import { runGeometryProbe } from './probe.mjs'

const task = { jobId: 'fixture-job', attempt: 2, inputFingerprint: 'a'.repeat(64) }
function entry(code) {
  return new URL('data:text/javascript,' + encodeURIComponent(
    "import { BroadcastChannel, parentPort, workerData } from 'node:worker_threads'\n" + code,
  ))
}

for (const [key, stale] of Object.entries({
  jobId: 'other-job', attempt: 1, version: 0, inputFingerprint: 'b'.repeat(64),
})) {
  test('development worker rejects a result with mismatched ' + key, async () => {
    const changed = JSON.stringify({ [key]: stale })
    await assert.rejects(runGeometryProbe(entry(`
      parentPort.postMessage({ task: { ...workerData, ...${changed} }, report: 'stale' })
    `), task), /without a valid report/)
  })
}

test('development worker ignores delayed output from a prior attempt before accepting the current one', async () => {
  const report = await runGeometryProbe(entry(`
    setTimeout(() => parentPort.postMessage({
      task: { ...workerData, attempt: 1 }, report: 'late',
    }), 5)
    setTimeout(() => parentPort.postMessage({ task: workerData, report: 'current' }), 10)
  `), task)
  assert.equal(report, 'current')
})

test('development worker times out and terminates instead of accepting a buffered report from a hanging worker', async () => {
  await assert.rejects(runGeometryProbe(entry(`
    parentPort.postMessage({ task: workerData, report: 'incomplete' })
    setInterval(() => {}, 100)
  `), task, { timeoutMs: 250 }), /timed out/)
})

test('development worker cancellation discards buffered output while a successor completes', async () => {
  const controller = new AbortController()
  const channelName = randomUUID()
  const channel = new BroadcastChannel(channelName)
  const cancelled = runGeometryProbe(entry(`
    parentPort.postMessage({ task: workerData, report: 'cancelled' })
    const channel = new BroadcastChannel(${JSON.stringify(channelName)})
    channel.postMessage('reported')
    setInterval(() => parentPort.postMessage({
      task: { ...workerData, attempt: 1 }, report: 'late',
    }), 10)
  `), { ...task, attempt: 1 }, { signal: controller.signal })
  try {
    await Promise.race([once(channel, 'message'), cancelled])
    controller.abort(new Error('Cancelled by test'))
    const current = runGeometryProbe(entry(`
      parentPort.postMessage({ task: workerData, report: 'successor' })
    `), task)
    await assert.rejects(cancelled, /Cancelled by test/)
    assert.equal(await current, 'successor')
  } finally {
    channel.close()
  }
})

test('development worker rejects a pre-aborted task before opening its entry', async () => {
  await assert.rejects(runGeometryProbe('/missing/worker.mjs', task, {
    signal: AbortSignal.abort(new Error('Already cancelled')),
  }), /Already cancelled/)
})
