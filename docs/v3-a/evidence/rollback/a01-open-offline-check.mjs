#!/usr/bin/env node
/**
 * A-MAC-1 预检：对用 `open` 命令启动的打包应用做离线状态检查与截图。
 *
 * 前提：
 *   - Vite dev server 已停止（5173 无监听）；
 *   - 应用以 --proxy-server=127.0.0.1:9 --proxy-bypass-list=<-loopback>
 *     启动，所有 HTTP(S) 走不存在的代理（离线条件模拟，未改系统网络设置）；
 *   - 本脚本只连接 CDP，不负责启动应用。
 *
 * 用法：node a01-open-offline-check.mjs [port] [screenshotPath]
 * 环境：
 *   CUNLIAN_WINDOW_WIDTH / CUNLIAN_WINDOW_HEIGHT 通过 renderer window.resizeTo
 *   把真实窗口改成指定尺寸，并打印 outer/inner 尺寸，便于区分不同次运行的截图。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const port = Number(process.argv[2] ?? 9445)
const screenshot =
  process.argv[3] ?? path.join(process.cwd(), 'docs', 'v3-a', 'evidence', 'a01-offline-launch.png')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findPageTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page')
      if (page) return page
    } catch {
      // 端口尚未就绪
    }
    await sleep(250)
  }
  return null
}

const target = await findPageTarget()
if (!target) {
  console.error('FAIL 通过 open 启动的打包应用没有暴露 page target')
  process.exit(1)
}

const socket = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
const events = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  } else if (message.method) {
    events.push(message)
  }
})
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve)
  socket.addEventListener('error', reject)
})

function send(method, params = {}) {
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  return response.result?.result?.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Log.enable')
await send('Network.enable')

console.log(`INFO run_at=${new Date().toISOString()}`)

const windowWidth = Number(process.env.CUNLIAN_WINDOW_WIDTH ?? 0)
const windowHeight = Number(process.env.CUNLIAN_WINDOW_HEIGHT ?? 0)
if (windowWidth > 0 && windowHeight > 0) {
  await evaluate(`window.resizeTo(${windowWidth},${windowHeight})`)
  await sleep(1000)
}
const windowMetrics = await evaluate(
  '[innerWidth, innerHeight, outerWidth, outerHeight].join("x")',
)
console.log(`INFO window_inner_x_outer=${JSON.stringify(windowMetrics)}`)

// 重新加载以捕获真实加载过程中的网络/控制台事件。
events.length = 0
await send('Page.reload', { ignoreCache: true })
await sleep(2500)

const location = String((await evaluate('location.href')) ?? '')
const title = String((await evaluate('document.title')) ?? '')
const body = String((await evaluate('document.body ? document.body.innerText : ""')) ?? '')
const resources = (await evaluate(
  'performance.getEntriesByType("resource").map((entry) => entry.name)',
)) ?? []

const remoteRequests = events
  .filter((entry) => entry.method === 'Network.requestWillBeSent')
  .map((entry) => entry.params?.request?.url)
  .filter((url) => typeof url === 'string' && /^https?:/i.test(url))
const remoteFailures = events
  .filter((entry) => entry.method === 'Network.loadingFailed')
  .map((entry) => entry.params?.errorText ?? 'unknown')
const consoleErrors = events
  .filter((entry) => entry.method === 'Log.entryAdded' && entry.params?.entry?.level === 'error')
  .map((entry) => `${entry.params.entry.source}: ${entry.params.entry.text}`)
  .filter((text) => /https?:|ERR_|net::/i.test(text))
const remoteResources = resources.filter((url) => !String(url).startsWith('file:'))

const shot = await send('Page.captureScreenshot', { format: 'png' })
mkdirSync(path.dirname(screenshot), { recursive: true })
if (typeof shot.result?.data === 'string' && shot.result.data.length > 0) {
  writeFileSync(screenshot, Buffer.from(shot.result.data, 'base64'))
}

console.log(`INFO location=${location || '(empty)'}`)
console.log(`INFO title=${JSON.stringify(title)}`)
console.log(`INFO body=${JSON.stringify(body.slice(0, 120))}`)
console.log(`INFO remoteRequests=${JSON.stringify(remoteRequests)}`)
console.log(`INFO remoteFailures=${JSON.stringify(remoteFailures)}`)
console.log(`INFO remoteResources=${JSON.stringify(remoteResources)}`)
console.log(`INFO consoleErrors=${JSON.stringify(consoleErrors)}`)
console.log(`INFO screenshot=${screenshot}`)

const ok =
  location.startsWith('file:') &&
  title === '寸链' &&
  body.includes('桌面壳') &&
  remoteRequests.length === 0 &&
  remoteFailures.length === 0 &&
  remoteResources.length === 0

try {
  socket.close()
} catch {
  // ignore
}

console.log(ok ? 'OPEN_OFFLINE_CHECK=PASS' : 'OPEN_OFFLINE_CHECK=FAIL')
process.exit(ok ? 0 : 1)
