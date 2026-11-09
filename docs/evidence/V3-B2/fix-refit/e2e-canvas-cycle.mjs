// 修复后再跑一遍“连续替换”：确认 canvas 生命周期修复未回退（canvas 恒为 1、状态 3D 就绪）。
// 用法：app 以 --inspect=9229 --remote-debugging-port=9336 启动，且已处于导入模型后的 3D 标签。
import { writeFileSync } from 'node:fs'
import WebSocket from '/Users/aston/DSH/wt/dsh-v3-A/node_modules/ws/index.js'

const OUT = process.env.OUT_DIR ?? '/Users/aston/DSH/wt/dsh-v3-A/docs/evidence/V3-B2/fix-refit'
const DIR = '/Users/aston/DSH/tmp/cunlian-v3/stl-samples'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function connect(url) {
  const ws = new WebSocket(url)
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
  return { ws, send, ready: new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  }) }
}

const page = (await (await fetch('http://127.0.0.1:9336/json/list')).json()).find((t) => t.type === 'page')
const mainTarget = (await (await fetch('http://127.0.0.1:9229/json/list')).json())[0]
const renderer = connect(page.webSocketDebuggerUrl)
const main = connect(mainTarget.webSocketDebuggerUrl)
await Promise.all([renderer.ready, main.ready])

async function ev(expression) {
  const result = await renderer.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
async function mainEval(expression) {
  const result = await main.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
async function waitFor(expression, label, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await ev(expression)) return
    await sleep(300)
  }
  throw new Error(`TIMEOUT: ${label}`)
}
const click = (text) => ev(`(() => {const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)}); if(!b) return 'MISS'; b.click(); return 'ok'})()`)
const probe = () => ev(`(() => JSON.stringify({
  canvasCount: document.querySelectorAll('canvas').length,
  status: (document.body.innerText.match(/3D (就绪|暂不可用)[^\\n]{0,24}/) ?? [null])[0],
  banner: (document.body.innerText.match(/导入模型 · ([^\\n]{0,40})/) ?? [null, null])[1],
}))()`)

const files = ['pr2-head-pan-binary.stl', 'slotted-disk-ascii.stl', 'nasa-wrench.stl', 'pr2-head-pan-binary.stl', 'slotted-disk-ascii.stl']
const results = [JSON.parse(await probe())]
for (const file of files) {
  await mainEval(`globalThis.__e2eStub.modelPath = ${JSON.stringify(`${DIR}/${file}`)}`)
  if (await click('替换模型…') !== 'ok') throw new Error('找不到替换模型…')
  await waitFor(`(() => !!document.querySelector('[role=dialog][aria-label="确认导入模型"]'))()`, '确认对话框')
  await ev(`(() => {const d=document.querySelector('[role=dialog][aria-label="确认导入模型"]'); const b=[...d.querySelectorAll('button')].find(x=>x.textContent.trim()==='导入为不可变版本'); b.click(); return 'ok'})()`)
  await waitFor(`(() => document.querySelectorAll('.model-viewport__stage canvas').length===1 && /3D 就绪/.test(document.body.innerText))()`, `替换 ${file} 就绪`)
  await sleep(2500)
  results.push({ file, ...JSON.parse(await probe()) })
}
const shot = await renderer.send('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${OUT}/after-05-canvas-cycle.png`, Buffer.from(shot.data, 'base64'))
const report = { results, verdict: results.every((item) => item.canvasCount === 1 && /3D 就绪/.test(item.status ?? '')) ? 'PASS' : 'FAIL' }
writeFileSync(`${OUT}/canvas-cycle-report.json`, JSON.stringify(report, null, 1))
console.log(JSON.stringify(report, null, 1))
renderer.ws.close()
main.ws.close()
process.exit(0)
