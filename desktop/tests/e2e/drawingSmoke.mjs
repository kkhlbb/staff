#!/usr/bin/env node
/**
 * C 批打包应用 GUI 冒烟（真实 Electron + 打包产物）：
 * 打开内置示例 → 工程图页生成图纸 → 读预览标注 → 两种窗口尺寸截图。
 * 不触发文件对话框，因此不覆盖 PDF/SVG 的保存对话框流程；PDF 证据由 pdfHarness 提供。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const appExecutable =
  process.argv[2] ??
  path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9337)
const evidenceDir = path.join(process.cwd(), 'docs/evidence/V3-C')
mkdirSync(evidenceDir, { recursive: true })

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}`)
  process.exit(2)
}

const child = spawn(appExecutable, [`--remote-debugging-port=${port}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', (chunk) => (output += chunk.toString()))
child.stderr.on('data', (chunk) => (output += chunk.toString()))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findPage() {
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

const target = await findPage()
if (!target) {
  console.error('BLOCKED: 20 秒内没有 page target')
  console.error(output)
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
await send('Page.enable')
await sleep(1200)

const failures = []
function check(name, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name} ${detail}`)
  if (!condition) failures.push(name)
}

async function setWindow(width, height) {
  // 用视口尺寸做布局走查（无边框/标题栏干扰），不依赖 Browser.getWindowForTarget。
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await sleep(700)
}

async function screenshot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(evidenceDir, name)
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
  return file
}

// 1) 打开内置示例
await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('打开内置示例'))
  if (!button) return false
  button.click()
  return true
})()`)
await sleep(1500)
check('打开内置示例后进入工作台', await evaluate(`!!document.querySelector('main[aria-label="寸链桌面工作台"]')`))

// 2) 工程图页生成图纸（走 drawing:update-spacer）
await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '生成图纸')
  if (!button) return false
  button.click()
  return true
})()`)
await sleep(1800)
const fingerprint = await evaluate(
  `document.querySelector('[data-drawing-fingerprint]')?.getAttribute('data-drawing-fingerprint') ?? null`,
)
check('预览出现图纸指纹', typeof fingerprint === 'string' && fingerprint.length === 64, `got=${fingerprint}`)
const lengthText = await evaluate(
  `document.querySelector('[data-annotation-id="ann.length"] text')?.textContent ?? null`,
)
check('长度标注 12.00', lengthText === '12.00', `got=${lengthText}`)
const diameterText = await evaluate(
  `document.querySelector('[data-annotation-id="ann.outer-diameter"] text')?.textContent ?? null`,
)
check('外径标注 ⌀32.00', diameterText === '⌀32.00', `got=${diameterText}`)
const statusText = await evaluate(
  `document.querySelector('.spacer-drawing__status')?.textContent ?? null`,
)
check('图纸状态为待复核草稿', String(statusText).includes('待复核草稿'), `got=${statusText}`)
const hasImage = await evaluate(`!!document.querySelector('.drawing-canvas svg image')`)
check('预览无 image 截图', hasImage === false)

// 3) 点击标注定位参数
await evaluate(`document.querySelector('[data-annotation-id="ann.length"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(500)
const located = await evaluate(
  `document.querySelector('[aria-label="图纸参数详情"]')?.textContent ?? ''`,
)
check('点击标注后属性栏显示图纸参数', String(located).includes('q = 120000'), `got=${String(located).slice(0, 80)}`)

// 4) 1440×900 / 960×640 走查截图
await setWindow(1440, 900)
const geometry = await evaluate(`(() => {
  const canvas = document.querySelector('.drawing-canvas')
  const paper = document.querySelector('.drawing-canvas__paper')
  return {
    canvas: canvas?.getBoundingClientRect().toJSON(),
    paper: paper?.getBoundingClientRect().toJSON(),
    transform: paper ? getComputedStyle(paper).transform : null,
    inner: [innerWidth, innerHeight],
  }
})()`)
console.log('GEOMETRY', JSON.stringify(geometry))
const wide = await screenshot('gui-1440x900.png')
await setWindow(960, 640)
const narrow = await screenshot('gui-960x640.png')
// 窄窗需要滚动才能看到图纸：再截一张滚动后的图，证明图纸仍完整可用。
await evaluate(`(() => {
  const canvas = document.querySelector('.spacer-drawing') ?? document.querySelector('.desktop-workspace__canvas')
  if (canvas) canvas.scrollTop = canvas.scrollHeight
  return true
})()`)
await sleep(600)
const narrowDrawing = await screenshot('gui-960x640-drawing.png')
console.log(JSON.stringify({ wide, narrow, narrowDrawing, fingerprint }))

try {
  socket.close()
} catch {
  // 窗口可能已关闭
}
child.kill('SIGKILL')
console.log(failures.length === 0 ? 'DRAWING_GUI_RESULT=PASS' : `DRAWING_GUI_RESULT=FAIL(${failures.join(',')})`)
process.exit(failures.length === 0 ? 0 : 1)
