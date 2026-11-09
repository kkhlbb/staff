// 在已启动的寸链 main 进程（--inspect=9229）里执行表达式。
import WebSocket from '/Users/aston/DSH/wt/dsh-v3-A/node_modules/ws/index.js'

const expression = process.argv[2]
const list = await (await fetch('http://127.0.0.1:9229/json/list')).json()
const ws = new WebSocket(list[0].webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const current = ++id
    pending.set(current, { resolve, reject })
    ws.send(JSON.stringify({ id: current, method, params }))
  })
ws.on('message', (raw) => {
  const message = JSON.parse(raw)
  if (!message.id || !pending.has(message.id)) return
  const { resolve, reject } = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) reject(new Error(JSON.stringify(message.error)))
  else resolve(message.result)
})
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})
const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
console.log(JSON.stringify(result.result?.value ?? result, null, 1))
ws.close()
