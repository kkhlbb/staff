import { writeFile } from 'node:fs/promises'
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
export async function connect(port, type) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target = targets.find(target => target.type === type)
  if (!target) throw new Error('No target')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let id = 0
  const pending = new Map()
  socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id) } }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const current = ++id
    pending.set(current, response => response.error ? reject(new Error(JSON.stringify(response.error))) : resolve(response.result))
    socket.send(JSON.stringify({ id: current, method, params }))
  })
  return { send, close: () => socket.close(), eval: async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result?.value
  }, shot: async path => { await sleep(350); const result = await send('Page.captureScreenshot'); await writeFile(path, Buffer.from(result.data, 'base64')) } }
}
