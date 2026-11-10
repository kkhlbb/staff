#!/usr/bin/env node
/**
 * V3.6 体验补丁走查：打包应用 + CDP + open-file（无文件对话框）。
 *
 * 覆盖两件事，都在真实打包产物里量：
 * 1) 「任务书提取」入口角标：收起状态下显示未决数（待确认 4 · 阻塞 1），
 *    来自项目文件里的 extractionDrafts，点击前不展开面板、不触发提取；
 * 2) 复核区「条款版本历史」默认高度：能否完整显示 4 行、是否横向溢出。
 *
 * 用法：node desktop/tests/e2e/v36-ui-polish.mjs [appExecutable] [port]
 * 输出：docs/evidence/V3.6/screenshots/v36-08..11*.png
 *       docs/evidence/V3.6/ui-polish.json（DOM 尺寸与计数）
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import path from 'node:path'

const appExecutable =
  process.argv[2] ??
  path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9372)
const SEED = process.env.V36_UI_SEED ?? '/Users/aston/DSH/tmp/cunlian-v36/UI-V36.cunlian'
// 每次走查用新文件名：恢复草稿按路径索引，复用同名文件会带上一轮的决定。
const WORK = `/Users/aston/DSH/tmp/cunlian-v36/UI-V36-run-${process.pid}.cunlian`
const SHOTS = path.join(process.cwd(), 'docs', 'evidence', 'V3.6', 'screenshots')
const SUMMARY = path.join(process.cwd(), 'docs', 'evidence', 'V3.6', 'ui-polish.json')

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}，先运行 npm run package:desktop -- --arch=arm64`)
  process.exit(2)
}
if (!existsSync(SEED)) {
  console.error(`BLOCKED: 缺少证据项目 ${SEED}（先运行 V36_UI_SEED_OUT=... npx vitest run --config vitest.v36fixture.config.ts）`)
  process.exit(2)
}
await fsp.mkdir(SHOTS, { recursive: true })
await fsp.copyFile(SEED, WORK)

const bundle = path.resolve(path.dirname(appExecutable), '../..')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let child = null
let childExit = null
let socket = null
let nextId = 1
const pending = new Map()

async function launch() {
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  child = spawn(appExecutable, [`--remote-debugging-port=${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv,
  })
  childExit = null
  child.on('exit', (code, signal) => (childExit = { code, signal }))
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk.toString()))
  child.stderr.on('data', (chunk) => (output += chunk.toString()))
  let target = null
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (childExit !== null) break
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      target = targets.find((item) => item.type === 'page') ?? null
      if (target !== null) break
    } catch {
      // 端口尚未就绪
    }
    await sleep(250)
  }
  if (target === null) {
    console.error('BLOCKED: 打包应用没有在 30 秒内暴露 page target；若已有实例占用单实例锁，请先退出。')
    console.error(output)
    child.kill('SIGKILL')
    process.exit(2)
  }
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', reject)
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  })
  return target
}

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

async function waitFor(predicate, label, timeoutMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true
    await sleep(200)
  }
  throw new Error(`TIMEOUT: ${label}`)
}

async function openProject() {
  execFileSync('open', ['-a', bundle, WORK])
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('main[aria-label="寸链桌面工作台"]'))`),
    'workspace',
    30000,
  )
  await waitFor(
    async () => {
      const count = await evaluate(`(async () => {
        const current = await window.cunlian.reattachSession()
        return current.ok && current.value.sessionId ? current.value.snapshot.documents.length : -1
      })()`)
      return count >= 1
    },
    'project loaded',
    30000,
  )
}

/**
 * 设定视口：Electron 不支持 Browser.getWindowForTarget，用 CDP Emulation
 * 精确设定 CSS 视口（1440×900 / 960×640），截图与 innerWidth 都按此计算。
 */
async function setWindow(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await sleep(800)
  return evaluate(`({ innerWidth: window.innerWidth, innerHeight: window.innerHeight })`)
}

/** 测量：角标、复核区高度、历史表可见行数与横向溢出。 */
function measureExpression() {
  return `(() => {
    const rect = (node) => {
      if (!node) return null
      const box = node.getBoundingClientRect()
      return {
        x: Math.round(box.x * 10) / 10,
        y: Math.round(box.y * 10) / 10,
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
      }
    }
    const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent.includes('任务书提取'))
    const badge = document.querySelector('[data-testid="extraction-pending-badge"]')
    const center = document.querySelector('.desktop-workspace__center')
    const review = document.querySelector('.desktop-workspace__review')
    const history = document.querySelector('.requirement-history')
    const scrollBox = document.querySelector('.requirement-history__scroll')
    const table = document.querySelector('.requirement-history__table')
    const rows = [...document.querySelectorAll('.requirement-history__table tbody tr')]
    const viewportBottom = window.innerHeight
    const reviewOpen = Boolean(review && review.classList.contains('desktop-workspace__review--open'))
    const reviewBox = review ? review.getBoundingClientRect() : null
    const visibleRows = scrollBox && reviewBox
      ? rows.filter((row) => {
          const box = row.getBoundingClientRect()
          const container = scrollBox.getBoundingClientRect()
          const bottom = Math.min(container.bottom, reviewBox.bottom, viewportBottom)
          return box.top >= Math.max(container.top, reviewBox.top) - 0.5 && box.bottom <= bottom + 0.5
        }).length
      : 0
    const doc = document.documentElement
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      tabLabel: tab ? tab.textContent : null,
      tabTitle: tab ? tab.getAttribute('title') : null,
      tabDescribedBy: tab ? tab.getAttribute('aria-describedby') : null,
      badgeText: badge ? badge.textContent : null,
      panelHidden: document.getElementById('desktop-panel-5')?.hidden ?? null,
      reviewOpen,
      center: rect(center),
      review: rect(review),
      reviewScrollTop: review ? review.scrollTop : null,
      history: rect(history),
      historyScrollBox: rect(scrollBox),
      table: rect(table),
      rowCount: rows.length,
      visibleRows,
      rowHeights: rows.map((row) => Math.round(row.getBoundingClientRect().height * 10) / 10),
      documentScrollWidth: doc.scrollWidth,
      documentClientWidth: doc.clientWidth,
      horizontalOverflow: doc.scrollWidth > doc.clientWidth,
    }
  })()`
}

async function captureState(name, size) {
  const windowSize = await setWindow(size.width, size.height)
  await sleep(400)
  // 回到收起状态，保证每个尺寸量到的都是“打开项目后的默认态”。
  await evaluate(`(() => {
    const toggle = document.querySelector('.desktop-workspace__review-toggle')
    if (toggle && toggle.getAttribute('aria-expanded') === 'true') toggle.click()
    return true
  })()`)
  await sleep(300)
  let state = await evaluate(measureExpression())
  if (state.badgeText !== null) await shot(`${name}-badge`)
  // 打开复核区（默认滚动位置），再滚到条款版本历史。
  await evaluate(`(() => {
    const toggle = document.querySelector('.desktop-workspace__review-toggle')
    if (!toggle) throw new Error('找不到复核区开关')
    if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click()
    return true
  })()`)
  await sleep(400)
  await shot(`${name}-review-open`)
  await evaluate(`(() => {
    const review = document.querySelector('.desktop-workspace__review')
    const table = document.querySelector('.requirement-history__table')
    if (!review || !table) throw new Error('复核区或条款版本历史缺失')
    // 只滚复核区内部，不动页面：让历史表顶部贴近复核区可视区。
    const delta = table.getBoundingClientRect().top - review.getBoundingClientRect().top
    review.scrollTop = Math.max(0, review.scrollTop + delta - 4)
    return review.scrollTop
  })()`)
  await sleep(400)
  const opened = await evaluate(measureExpression())
  await shot(`${name}-history`)
  return { name, windowSize, collapsed: state, reviewOpen: opened }
}

const sizes = [
  { name: 'v36-08-1440x900', width: 1440, height: 900 },
  { name: 'v36-09-960x640', width: 960, height: 640 },
]

const target = await launch()
await send('Runtime.enable')
await send('Page.enable')
await sleep(1200)
await openProject()

// 打开后先核对项目文件里的草稿状态，避免带着上一轮的恢复草稿取证。
const loaded = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  if (!current.ok || !current.value.sessionId) return null
  const drafts = current.value.snapshot.project.extractionDrafts
  return {
    path: current.value.path,
    drafts: drafts.length,
    statuses: drafts.flatMap((draft) => draft.candidates.map((candidate) => candidate.status)),
    requirementRevisions: current.value.snapshot.project.requirementRevisions.length,
  }
})()`)
console.log('loaded', JSON.stringify(loaded))
if (loaded === null || !loaded.statuses.includes('pending')) {
  console.error('BLOCKED: 打开后的项目里没有待确认候选（可能命中了旧的恢复草稿），角标无法取证。')
  socket.close()
  child.kill('SIGKILL')
  process.exit(2)
}

const results = []
for (const size of sizes) {
  results.push(await captureState(size.name, size))
}

// 960×640 补充证据：默认 200px 是为了不挤画布；把复核区拖到 280px 后
// 同一张表可以完整显示 4 行（超出默认高度的代价是画布更小，由用户自己选）。
await setWindow(960, 640)
await evaluate(`(() => {
  const toggle = document.querySelector('.desktop-workspace__review-toggle')
  if (toggle && toggle.getAttribute('aria-expanded') !== 'true') toggle.click()
  return true
})()`)
await sleep(400)
await evaluate(`(() => {
  const splitter = [...document.querySelectorAll('[role="separator"]')]
    .find((node) => node.getAttribute('aria-label') === '复核区高度')
  if (!splitter) throw new Error('找不到复核区高度分隔条')
  splitter.focus()
  for (let index = 0; index < 2; index += 1) {
    splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  }
  return splitter.getAttribute('aria-valuenow')
})()`)
await sleep(500)
await evaluate(`(() => {
  const review = document.querySelector('.desktop-workspace__review')
  const table = document.querySelector('.requirement-history__table')
  if (!review || !table) throw new Error('复核区或条款版本历史缺失')
  const delta = table.getBoundingClientRect().top - review.getBoundingClientRect().top
  review.scrollTop = Math.max(0, review.scrollTop + delta - 4)
  return review.scrollTop
})()`)
await sleep(400)
const expanded960 = await evaluate(measureExpression())
await shot('v36-09b-960x640-history-expanded')
console.log('expanded960', JSON.stringify({ reviewHeight: expanded960.review?.height, visibleRows: expanded960.visibleRows, rowHeights: expanded960.rowHeights }))

// 交互证据：确认全部待确认 + 拒绝阻塞后，角标必须消失（真实 main 写入）。
await evaluate(`(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent.includes('任务书提取'))
  if (!tab) throw new Error('未找到任务书提取页')
  tab.click()
  return true
})()`)
await waitFor(
  () => evaluate(`document.querySelectorAll('.extraction-review__candidate').length === 5`),
  'extraction candidates',
  20000,
)
await evaluate(`(() => { window.__v36polish = { confirmed: 0, rejected: 0 }; return true })()`)
for (let round = 0; round < 4; round += 1) {
  const clicked = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.extraction-review__candidate')]
    const row = rows.find((item) => item.getAttribute('data-status') === 'pending')
    if (!row) return false
    const button = [...row.querySelectorAll('button')].find((item) => item.textContent === '确认')
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  if (!clicked) break
  await sleep(700)
}
// 阻塞候选只能拒绝，必须填理由。
await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.extraction-review__candidate')]
  const row = rows.find((item) => item.getAttribute('data-status') === 'blocked')
  if (!row) return false
  const open = [...row.querySelectorAll('button')].find((item) => item.textContent === '拒绝…')
  if (open) open.click()
  return true
})()`)
await sleep(400)
await evaluate(`(() => {
  const input = document.querySelector('.extraction-review__candidate input[aria-label="拒绝理由"]')
  if (!input) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '不支持运算符，改人工录入')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(300)
await evaluate(`(() => {
  const input = document.querySelector('.extraction-review__candidate input[aria-label="拒绝理由"]')
  if (!input) return false
  const row = input.closest('.extraction-review__candidate')
  const button = [...row.querySelectorAll('button')].find((item) => item.textContent === '确认拒绝')
  if (!button || button.disabled) return false
  button.click()
  return true
})()`)
await sleep(1200)
const afterDecisions = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  const drafts = current.ok && current.value.sessionId ? current.value.snapshot.project.extractionDrafts : []
  const badge = document.querySelector('[data-testid="extraction-pending-badge"]')
  return {
    statuses: drafts.flatMap((draft) => draft.candidates.map((candidate) => candidate.status)),
    badgeText: badge ? badge.textContent : null,
    badgePresent: badge !== null,
  }
})()`)
await shot('v36-10-all-decided-no-badge')
console.log('afterDecisions', JSON.stringify(afterDecisions))

const summary = { sizes: results, expanded960, afterDecisions }
await fsp.writeFile(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`)
console.log(`SUMMARY ${SUMMARY}`)
console.log('DONE')
socket.close()
child.kill('SIGKILL')
await sleep(800)
process.exit(0)
