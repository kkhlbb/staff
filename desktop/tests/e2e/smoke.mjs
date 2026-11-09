#!/usr/bin/env node
/**
 * A-01 桌面壳冒烟测试（真实 Electron + 打包产物）。
 *
 * 通过 Chromium DevTools Protocol 连接由 `npm run package:desktop` 产出的 .app：
 * - 生产入口从本地 file:// 加载，无远程资源；
 * - renderer 没有 require/process/ipcRenderer，window.cunlian 只有具体函数；
 * - 子框架拿不到 preload 桥；
 * - 编辑屏障协议可完成，requestClose 返回 ok 后窗口销毁。
 *
 * 用法：
 *   node desktop/tests/e2e/smoke.mjs [appExecutablePath] [port]
 * 默认路径 out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const appExecutable =
  process.argv[2] ??
  path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9333)

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}，先运行 npm run package:desktop -- --arch=arm64`)
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

const child = spawn(appExecutable, [`--remote-debugging-port=${port}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
let appOutput = ''
child.stdout.on('data', (chunk) => (appOutput += chunk.toString()))
child.stderr.on('data', (chunk) => (appOutput += chunk.toString()))
let childExit = null
child.on('exit', (code, signal) => {
  childExit = { code, signal }
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findPageTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (childExit !== null) {
      // 单实例锁被占（例如上一次测试实例未退出）时应用会立刻以 0 退出。
      return null
    }
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
  console.error('BLOCKED: 打包应用没有在 20 秒内暴露 page target')
  if (childExit !== null) {
    console.error(
      `应用提前退出 code=${childExit.code} signal=${childExit.signal}；` +
        '若本机已有“寸链”实例在运行（单实例锁），先退出该实例再重跑。',
    )
  }
  console.error(appOutput)
  child.kill('SIGKILL')
  process.exit(2)
}

const socket = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
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
    throw new Error(`evaluate failed: ${response.result.exceptionDetails.text}`)
  }
  return response.result?.result?.value
}

await send('Runtime.enable')
await sleep(1200)

const title = await evaluate('document.title')
check('窗口标题为 寸链', title === '寸链', `got=${title}`)

const bodyText = await evaluate('document.body.innerText')
check('渲染出桌面壳内容', String(bodyText).includes('打开项目，继续设计'), `got=${String(bodyText).slice(0, 80)}`)

const apiKeys = await evaluate('Object.keys(window.cunlian).sort()')
const expectedKeys = [
  'newProject', 'openProject', 'stageDraft', 'saveProject', 'saveProjectAs',
  'listRecent', 'relinkRecent', 'listRecovery', 'restoreRecovery', 'reattachSession',
  'readAttachment', 'revealProject', 'requestClose', 'inspectV2', 'commitV2',
  'onMenuAction', 'onEditorFlush', 'respondEditorFlush',
  'pickModel', 'readModel', 'commitModel', 'releaseModel', 'linkModel',
  'updateSpacerDrawing', 'exportDrawingPdf', 'exportDrawingSvg',
].sort()
check(
  'window.cunlian 只暴露具体函数',
  JSON.stringify(apiKeys) === JSON.stringify(expectedKeys),
  `got=${JSON.stringify(apiKeys)}`,
)

const genericEscape = await evaluate(
  "['invoke','send','on','ipcRenderer','require','process'].filter((k) => typeof window[k] !== 'undefined' || (window.cunlian && typeof window.cunlian[k] !== 'undefined'))",
)
check('没有通用 IPC 转义口 / Node 全局', Array.isArray(genericEscape) && genericEscape.length === 0, `got=${JSON.stringify(genericEscape)}`)

const resourceUrls = await evaluate(
  'performance.getEntriesByType("resource").map((entry) => entry.name)',
)
const remoteResources = (resourceUrls ?? []).filter((url) => !String(url).startsWith('file:'))
check('页面没有远程资源请求', remoteResources.length === 0, `remote=${JSON.stringify(remoteResources)}`)

const frameBridge = await evaluate(`(() => {
  const frame = document.createElement('iframe')
  frame.srcdoc = '<!doctype html><html><body>frame</body></html>'
  document.body.appendChild(frame)
  const result = typeof frame.contentWindow.cunlian
  frame.remove()
  return result
})()`)
check('子框架拿不到 preload 桥', frameBridge === 'undefined', `got=${frameBridge}`)

// 编辑屏障 + 关闭：renderer 收到 editor:flush 后回复，requestClose 返回 ok 后窗口销毁。
const flushSeen = await evaluate(`(async () => {
  window.__flushRequestId = null
  window.cunlian.onEditorFlush((payload) => {
    window.__flushRequestId = payload.requestId
    window.cunlian.respondEditorFlush({ requestId: payload.requestId, editSeq: 0 })
  })
  const result = await window.cunlian.requestClose()
  return { result, flushRequestId: window.__flushRequestId }
})()`)
check(
  'requestClose 经编辑屏障后返回 closed',
  flushSeen?.result?.ok === true && flushSeen?.result?.value?.closed === true,
  `got=${JSON.stringify(flushSeen?.result)}`,
)
check('renderer 实际收到 editor:flush', typeof flushSeen?.flushRequestId === 'string', `got=${flushSeen?.flushRequestId}`)

// 窗口应在回复后销毁：page target 消失。
let targetGone = false
for (let attempt = 0; attempt < 40; attempt += 1) {
  await sleep(150)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`)
    const targets = await response.json()
    if (!targets.some((entry) => entry.type === 'page')) {
      targetGone = true
      break
    }
  } catch {
    targetGone = true
    break
  }
}
check('关闭流程结束后窗口销毁', targetGone)

try {
  socket.close()
} catch {
  // 窗口已销毁时连接可能已断开
}
// 用 SIGKILL 收尾：避免被测进程在退出流程里残留并占用单实例锁，影响下一次运行。
child.kill('SIGKILL')

console.log(failures.length === 0 ? 'E2E_RESULT=PASS' : `E2E_RESULT=FAIL(${failures.join(',')})`)
process.exit(failures.length === 0 ? 0 : 1)
