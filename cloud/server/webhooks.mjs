import { createHmac } from 'node:crypto'

export function startWebhooks(storage, config, log, { deliver = fetch, pollMs = 1000, retryMs = 1000 } = {}) {
  if (!config.webhookSecret) return () => {}
  let running = false
  const timer = setInterval(async () => {
    if (running) return
    running = true
    try {
      for (const id of await storage.ids()) {
        const { outbox } = await storage.read(id)
        for (const event of outbox.filter(row => row.attempts < 6 && row.next <= Date.now())) {
          const body = JSON.stringify({ type: 'project_revision_committed', ...event.result })
          const timestamp = String(Math.floor(Date.now() / 1000))
          const signature = createHmac('sha256', config.webhookSecret).update(timestamp + '.' + body).digest('hex')
          let delivered = false
          try {
            const response = await deliver(config.webhookUrl(event.url), {
              method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(4000),
              headers: { 'content-type': 'application/json', 'x-cunlian-timestamp': timestamp,
                'x-cunlian-signature': 'sha256=' + signature },
            })
            delivered = response.ok
            await response.body?.cancel()
          } catch {
            // The outbox remains on disk for the next attempt.
          }
          await storage.transact(id, undefined, state => {
            const index = state.outbox.findIndex(row => row.result.committedRevision === event.result.committedRevision)
            if (index < 0) return
            if (delivered) state.outbox.splice(index, 1)
            else Object.assign(state.outbox[index], { attempts: event.attempts + 1, next: Date.now() + retryMs * 2 ** event.attempts })
          })
          log({ type: 'webhook', projectId: id, revision: event.result.committedRevision, delivered, attempt: event.attempts + 1 })
        }
      }
    } catch (error) {
      log({ type: 'webhook_outbox_error', code: error.code ?? error.name })
    } finally {
      running = false
    }
  }, pollMs)
  timer.unref()
  return () => clearInterval(timer)
}
