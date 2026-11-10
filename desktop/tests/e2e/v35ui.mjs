#!/usr/bin/env node
/**
 * V3.5 打包应用 UI 证据：真实 .app + CDP 操作 + 系统文件对话框（AppleScript）。
 *
 * 步骤：新建 P35-A → 导入合成两页任务书 → 保存项目 → 打开条款向导 →
 * 第 2 页框选 → 粘贴原文/上下限 → 确认条款 → 复核区/定位截图。
 *
 * 用法：node desktop/tests/e2e/v35ui.mjs [appExecutable] [port]
 * 依赖：macOS 辅助功能权限（osascript 控制 “寸链” 的文件对话框）。
 * 截图写入 docs/evidence/V3.5/screenshots/。
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import path from 'node:path'

const appExecutable =
  process.argv[2] ??
  path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9365)
const SEED = '/Users/aston/DSH/tmp/cunlian-v35/P35-imported.cunlian'
const SHOTS = path.join(process.cwd(), 'docs', 'evidence', 'V3.5', 'screenshots')

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}，先运行 npm run package:desktop`)
  process.exit(2)
}
await fsp.mkdir(SHOTS, { recursive: true })
if (!existsSync(SEED)) {
  console.error(`BLOCKED: 缺少证据项目 ${SEED}（先运行 V35_SEED_OUT=... npx vitest run desktop/tests/v35Seed.test.ts）`)
  process.exit(2)
}

const childEnv = { ...process.env }
delete childEnv.ELECTRON_RUN_AS_NODE
const child = spawn(appExecutable, [`--remote-debugging-port=${port}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: childEnv,
})
let appOutput = ''
child.stdout.on('data', (chunk) => (appOutput += chunk.toString()))
child.stderr.on('data', (chunk) => (appOutput += chunk.toString()))
let childExit = null
child.on('exit', (code, signal) => (childExit = { code, signal }))
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
  console.error('BLOCKED: 打包应用没有在 25 秒内暴露 page target；若已有实例占用单实例锁，请先退出。')
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
async function shot(name) {
  const response = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const file = path.join(SHOTS, `${name}.png`)
  await fsp.writeFile(file, Buffer.from(response.result.data, 'base64'))
  console.log(`SHOT ${file}`)
}
async function waitFor(predicate, label, timeoutMs = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true
    await sleep(200)
  }
  throw new Error(`TIMEOUT: ${label}`)
}

await send('Runtime.enable')
await send('Page.enable')
await sleep(1200)

// 1) 通过 LaunchServices open-file 打开已含任务书附件的 P35-A（无文件对话框）。
const bundle = path.resolve(path.dirname(appExecutable), '../..')
execFileSync('open', ['-a', bundle, SEED])
await waitFor(
  () => evaluate(`Boolean(document.querySelector('main[aria-label="寸链桌面工作台"]'))`),
  'workspace after open-file',
  25000,
)
await waitFor(
  async () => {
    const count = await evaluate(`(async () => {
      const current = await window.cunlian.reattachSession()
      return current.ok && current.value.sessionId ? current.value.snapshot.documents.length : -1
    })()`)
    return count >= 1
  },
  'PDF present in opened project',
  25000,
)
await shot('v35-00-workspace')

const revision = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  const snap = current.value.snapshot
  const imported = snap.revisions.find((item) => item.fileName.includes('taskbook-2p')) ?? snap.revisions[snap.revisions.length - 1]
  return { documentId: imported.documentId, revisionId: imported.id, pageCount: imported.pageCount, sha256: imported.sha256, path: current.value.path }
})()`)
console.log('opened', JSON.stringify(revision))
await evaluate(`(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent === '来源 PDF')
  tab.click()
  return true
})()`)
await sleep(300)
await evaluate(`(() => {
  const select = document.querySelector('[aria-label="来源版本"]')
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  setter.call(select, ${JSON.stringify(revision.revisionId)})
  select.dispatchEvent(new Event('change', { bubbles: true }))
  return select.value
})()`)
await sleep(2000)
await shot('v35-01-import')

// 3) 项目已保存到磁盘：条款确认不会再弹保存对话框。
console.log('saved', revision.path)

// 4) 打开“绑定任务书要求”向导。
await evaluate(`(() => {
  const toggle = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('复核与变更'))
  toggle.click()
  return true
})()`)
await sleep(400)
await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('绑定任务书要求'))
  if (!button) throw new Error('未找到绑定任务书要求入口')
  button.click()
  return true
})()`)
await waitFor(
  () => evaluate(`Boolean(document.querySelector('[role="dialog"][aria-label="绑定任务书要求"]'))`),
  'requirement wizard',
)
await sleep(600)
await evaluate(`(() => {
  const select = document.querySelector('[aria-label="任务书文档"]')
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  setter.call(select, ${JSON.stringify(revision.documentId)})
  select.dispatchEvent(new Event('change', { bubbles: true }))
  return select.value
})()`)
await sleep(1200)

// 5) 页码 2 + 在 PDF 页面上框选。
await evaluate(`(() => {
  const input = document.querySelector('[aria-label="条款页码"]')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '2')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return input.value
})()`)
await waitFor(
  () => evaluate(`Boolean(document.querySelector('.requirement-wizard canvas'))`),
  'page 2 canvas',
  15000,
)
await sleep(1200)
const box = await evaluate(`(() => {
  const canvas = document.querySelector('.requirement-wizard canvas')
  const rect = canvas.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
})()`)
const x1 = box.x + box.width * 0.12
const y1 = box.y + box.height * 0.18
const x2 = box.x + box.width * 0.86
const y2 = box.y + box.height * 0.34
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 })
for (let step = 1; step <= 8; step += 1) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: x1 + ((x2 - x1) * step) / 8,
    y: y1 + ((y2 - y1) * step) / 8,
    button: 'left',
  })
  await sleep(30)
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 })
await sleep(400)
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.requirement-wizard button')].find((item) => item.textContent.includes('使用此选区'))
  if (!button) throw new Error('未找到使用此选区按钮')
  button.click()
  return true
})()`)
await waitFor(
  () => evaluate(`document.body.innerText.includes('已选第 2 页区域')`),
  'region selected',
)

// 6) 原文 + 上下限 + 显式确认。
const setValue = (selector, value) => `(() => {
  const input = document.querySelector(${JSON.stringify(selector)})
  const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return input.value
})()`
await evaluate(setValue('[aria-label="条款原文"]', '轴向装配间隙 C 应为 0.1000～0.3000 mm，含两端'))
await evaluate(setValue('[aria-label="条款下限"]', '0.1000'))
await evaluate(setValue('[aria-label="条款上限"]', '0.3000'))
await sleep(900)
await evaluate(`(() => {
  const checkbox = document.querySelector('.requirement-wizard__confirm input[type="checkbox"]')
  checkbox.click()
  return checkbox.checked
})()`)
await sleep(1000)
await shot('v35-02-wizard')
await evaluate(`(() => {
  const wizard = document.querySelector('.requirement-wizard')
  wizard.scrollTop = wizard.scrollHeight
  return wizard.scrollTop
})()`)
await sleep(400)
await shot('v35-02b-wizard-compare')
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.requirement-wizard button')].find((item) => item.textContent.includes('确认并保存条款'))
  if (!button || button.disabled) throw new Error('确认按钮不可用')
  button.click()
  return true
})()`)
await waitFor(
  async () => {
    const active = await evaluate(`(async () => {
      const current = await window.cunlian.reattachSession()
      return current.ok && current.value.sessionId ? current.value.snapshot.project.activeRequirementRevisionId : null
    })()`)
    return typeof active === 'string' && active.startsWith('reqrev-')
  },
  'requirement revision persisted',
  20000,
)
const requirement = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  const project = current.value.snapshot.project
  const active = project.requirementRevisions.find((item) => item.revisionId === project.activeRequirementRevisionId)
  return {
    requirementId: active.requirementId,
    revisionId: active.revisionId,
    lowerQ: active.lowerQ,
    upperQ: active.upperQ,
    source: active.source,
    checkStatus: project.currentRequirementCheck.status,
    revisionCount: project.requirementRevisions.length,
    path: current.value.path,
  }
})()`)
console.log('requirement', JSON.stringify(requirement))
await evaluate(`(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent === '工程图')
  tab.click()
  return true
})()`)
await sleep(800)
await evaluate(`(() => {
  const section = document.querySelector('section[aria-label="任务书要求"]')
  section?.scrollIntoView({ block: 'center' })
  return Boolean(section)
})()`)
await sleep(400)
await shot('v35-03-confirmed-review')

// 7) 定位任务书：应打开旧/确切版本并高亮选区。
await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent === '定位任务书')
  if (!button) throw new Error('未找到定位任务书')
  button.click()
  return true
})()`)
await sleep(2500)
await shot('v35-04-locate')

// 8) 自动预览：改 S=12.04，观察双范围/裕量（不点预览按钮）。
await evaluate(`(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent === '工程图')
  tab.click()
  return true
})()`)
await sleep(600)
await evaluate(setValue('[aria-label="长度（mm）"]', '12.04'))
await sleep(3000)
await shot('v35-05-auto-preview')
const hasPanel = await evaluate(`(() => {
  const panel = document.querySelector('.requirement-panel')
  panel?.scrollIntoView({ block: 'center' })
  return Boolean(panel)
})()`)
await sleep(500)
if (hasPanel) await shot('v35-06-requirement-panel')

console.log('DONE')
socket.close()
child.kill('SIGTERM')
await sleep(1200)
if (childExit === null) child.kill('SIGKILL')
process.exit(0)
