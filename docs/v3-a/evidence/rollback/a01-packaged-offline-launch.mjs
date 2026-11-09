#!/usr/bin/env node
/**
 * 任务卡 §8「桌面生产离线资源」回退实验的验收脚本。
 *
 * 在“无 Vite dev server + 离线条件模拟”下启动打包产物，通过 CDP 断言：
 * - 打包应用的入口必须是本地 file://，而不是开发 URL；
 * - 页面必须渲染出本地桌面壳（找不到本地 UI 即失败）；
 * - 页面不得有 http(s) 远程资源请求或远程请求错误。
 *
 * 离线模拟（不改系统网络设置，无需 sudo）：
 *   --proxy-server=127.0.0.1:9      所有 HTTP(S) 走不存在的代理；
 *   --proxy-bypass-list=<-loopback> 取消 localhost 直连例外；
 * 同时运行前已确认 5173 端口无监听（Vite dev server 已停）。
 * file:// 资源不经过代理。
 *
 * 用法：
 *   node a01-packaged-offline-launch.mjs [appExecutable] [port]
 * 环境：
 *   CUNLIAN_SCREENSHOT=/path/to.png 额外保存页面截图
 *   CUNLIAN_WINDOW_WIDTH / CUNLIAN_WINDOW_HEIGHT 启动后把真实窗口改成指定尺寸
 *   （renderer 侧 window.resizeTo，日志记录 outer/inner 尺寸；用于让不同次运行
 *     的截图可区分，不改变页面内容）
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const appExecutable =
  process.argv[2] ??
  path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9444)

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}`)
  process.exit(2)
}

const failures = []
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`PASS ${name}`)
  } else {
    console.log(`FAIL ${name} ${detail}`)
    failures.push(name)
  }
}

const child = spawn(
  appExecutable,
  [
    `--remote-debugging-port=${port}`,
    '--proxy-server=127.0.0.1:9',
    '--proxy-bypass-list=<-loopback>',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)
let appOutput = ''
child.stdout.on('data', (chunk) => (appOutput += chunk.toString()))
child.stderr.on('data', (chunk) => (appOutput += chunk.toString()))
const launchArgs = [
  `--remote-debugging-port=${port}`,
  '--proxy-server=127.0.0.1:9',
  '--proxy-bypass-list=<-loopback>',
]
console.log(`INFO run_at=${new Date().toISOString()}`)
console.log(`INFO pid=${child.pid}`)
console.log(`INFO command=${JSON.stringify([appExecutable, ...launchArgs])}`)
let childExit = null
child.on('exit', (code, signal) => {
  childExit = { code, signal }
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findPageTarget() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (childExit !== null) return null
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
  console.error('FAIL 打包应用没有在 25 秒内暴露 page target')
  if (childExit !== null) {
    console.error(`应用提前退出 code=${childExit.code} signal=${childExit.signal}`)
  }
  console.error(appOutput)
  child.kill('SIGKILL')
  process.exit(1)
}
check('打包应用启动并暴露 page target', true)

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
  if (response.result?.exceptionDetails) {
    return { error: response.result.exceptionDetails.text ?? 'evaluate failed' }
  }
  return { value: response.result?.result?.value }
}

await send('Runtime.enable')
await send('Page.enable')
await send('Log.enable')
await send('Network.enable')

const windowWidth = Number(process.env.CUNLIAN_WINDOW_WIDTH ?? 0)
const windowHeight = Number(process.env.CUNLIAN_WINDOW_HEIGHT ?? 0)
if (windowWidth > 0 && windowHeight > 0) {
  await evaluate(`window.resizeTo(${windowWidth},${windowHeight})`)
  await sleep(1000)
}
const windowMetrics = await evaluate(
  '[innerWidth, innerHeight, outerWidth, outerHeight].join("x")',
)
console.log(`INFO window_inner_x_outer=${JSON.stringify(windowMetrics.value)}`)

// 重新加载一次，确保 Network/Log 事件覆盖真实启动加载过程（而不是只看到缓存后的状态）。
events.length = 0
await send('Page.reload', { ignoreCache: true })
await sleep(2500)

const locationResult = await evaluate('location.href')
const titleResult = await evaluate('document.title')
const bodyResult = await evaluate('document.body ? document.body.innerText : ""')
const resourcesResult = await evaluate(
  'performance.getEntriesByType("resource").map((entry) => entry.name)',
)

const location = String(locationResult.value ?? '')
let protocol = ''
try {
  protocol = new URL(location).protocol
} catch {
  protocol = ''
}
const title = String(titleResult.value ?? '')
const body = String(bodyResult.value ?? '')
const resources = Array.isArray(resourcesResult.value) ? resourcesResult.value : []
const remoteResources = resources.filter((url) => !String(url).startsWith('file:'))

check('生产入口为本地 file://', protocol === 'file:', `got=${location || locationResult.error}`)
check(
  '加载出本地桌面壳（找不到本地 UI 即失败）',
  body.includes('桌面壳'),
  `body=${JSON.stringify(body.slice(0, 80))}`,
)
check(
  '页面没有远程资源请求',
  remoteResources.length === 0,
  `remote=${JSON.stringify(remoteResources)}`,
)

const remoteFailures = events
  .filter((entry) => entry.method === 'Network.loadingFailed')
  .map((entry) => entry.params?.errorText ?? 'unknown')
  .filter(Boolean)
const requestedUrls = events
  .filter((entry) => entry.method === 'Network.requestWillBeSent')
  .map((entry) => entry.params?.request?.url)
  .filter((url) => typeof url === 'string')
const remoteRequests = requestedUrls.filter((url) => /^https?:/i.test(url))
const documentRequest = events.find(
  (entry) => entry.method === 'Network.requestWillBeSent' && entry.params?.type === 'Document',
)?.params?.request?.url
const consoleErrors = events
  .filter((entry) => entry.method === 'Log.entryAdded' && entry.params?.entry?.level === 'error')
  .map((entry) => `${entry.params.entry.source}: ${entry.params.entry.text}`)
  .filter((text) => /https?:|ERR_|net::/i.test(text))

check('控制台没有远程请求错误', remoteFailures.length === 0, `failures=${JSON.stringify(remoteFailures)}`)
check(
  '没有 http(s) 文档/资源请求（生产包不得回退开发 URL）',
  remoteRequests.length === 0,
  `remoteRequests=${JSON.stringify(remoteRequests)}`,
)

console.log(`INFO location=${location || '(empty)'}`)
console.log(`INFO documentRequest=${documentRequest ? String(documentRequest) : '(none)'}`)
console.log(`INFO remoteRequests=${JSON.stringify(remoteRequests)}`)
console.log(`INFO title=${JSON.stringify(title)}`)
console.log(`INFO body=${JSON.stringify(body.slice(0, 120))}`)
console.log(`INFO resourceEntries=${resources.length} remote=${JSON.stringify(remoteResources)}`)
console.log(`INFO consoleErrors=${JSON.stringify(consoleErrors)}`)

const screenshot = process.env.CUNLIAN_SCREENSHOT
if (screenshot) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const data = shot.result?.data
  if (typeof data === 'string' && data.length > 0) {
    mkdirSync(path.dirname(screenshot), { recursive: true })
    writeFileSync(screenshot, Buffer.from(data, 'base64'))
    console.log(`INFO screenshot=${screenshot}`)
  } else {
    console.log('INFO screenshot=FAILED')
  }
}

try {
  socket.close()
} catch {
  // 窗口销毁时连接可能已断开
}
child.kill('SIGKILL')

console.log(
  failures.length === 0
    ? 'OFFLINE_LAUNCH_RESULT=PASS'
    : `OFFLINE_LAUNCH_RESULT=FAIL(${failures.join(',')})`,
)
process.exit(failures.length === 0 ? 0 : 1)
