#!/usr/bin/env node
/**
 * V3.5 补缺证据：打包应用内定位**历史条款版本**的来源 PDF 与选区。
 *
 * 使用 F4 项目（~/DSH/tmp/cunlian-v35/fixtures/F4-base.cunlian）：
 * - 旧版本 reqrev-3a782e84… 应打开 sr-taskbook-1 第 2 页并高亮其保存选区；
 * - 新版本 reqrev-0ca101fe… 应打开 sr-89d9193b 第 1 页并高亮另一块选区；
 * - 两次定位前后，活动条款与项目版本不得变化（只读）。
 *
 * 真实 .app + CDP；截图写入 docs/evidence/V3.5/screenshots/。
 * 用法：node desktop/tests/e2e/v35history.mjs [appExecutable] [port]
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, promises as fsp } from 'node:fs'
import path from 'node:path'

const appExecutable =
  process.argv[2] ??
  path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9371)
const SEED = '/Users/aston/DSH/tmp/cunlian-v35/fixtures/F4-base.cunlian'
const SHOTS = path.join(process.cwd(), 'docs', 'evidence', 'V3.5', 'screenshots')
const OLD_ID = 'reqrev-3a782e84-6394-40e3-8a3f-2be64001d4bb'
const NEW_ID = 'reqrev-0ca101fe-d861-4fef-98ab-820d73b33c37'

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}，先运行 npm run package:desktop`)
  process.exit(2)
}
if (!existsSync(SEED)) {
  console.error(`BLOCKED: 缺少证据项目 ${SEED}`)
  process.exit(2)
}
mkdirSync(SHOTS, { recursive: true })

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
process.on('exit', () => {
  try {
    child.kill('SIGKILL')
  } catch {
    // 已退出
  }
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const failures = []
function check(name, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : `: ${detail}`}`)
  if (!condition) failures.push(`${name} ${detail}`)
}

async function findPageTarget() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
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
  console.error('BLOCKED: 打包应用没有在 30 秒内暴露 page target；若已有实例占用单实例锁，请先退出。')
  console.error(appOutput)
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
  return file
}
async function waitFor(predicate, label, timeoutMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true
    await sleep(200)
  }
  throw new Error(`TIMEOUT: ${label}`)
}
const projectState = () => evaluate(`(async () => {
  const result = await window.cunlian.reattachSession()
  if (!result.ok || !result.value.snapshot) return null
  const project = result.value.snapshot.project
  return {
    active: project.activeRequirementRevisionId,
    current: project.currentRevisionId,
    revisions: project.requirementRevisions.length,
  }
})()`)
const sourceState = () => evaluate(`(() => {
  const select = document.querySelector('select[aria-label="来源版本"]')
  const page = document.querySelector('input[aria-label="页码跳转"]')
  const file = document.querySelector('.pdf-viewer__file')
  const summary = document.querySelector('[data-testid="requirement-locate-summary"]')
  const highlight = document.querySelector('.pdf-surface .pdf-highlight--active')
  return {
    revisionId: select ? select.value : null,
    page: page ? Number(page.value) : null,
    fileText: file ? file.textContent : null,
    summary: summary ? summary.textContent : null,
    highlight: highlight
      ? {
          title: highlight.getAttribute('title'),
          left: Number(highlight.getAttribute('data-rect-left')),
          top: Number(highlight.getAttribute('data-rect-top')),
          width: Number(highlight.getAttribute('data-rect-width')),
          height: Number(highlight.getAttribute('data-rect-height')),
        }
      : null,
  }
})()`)
const rowText = (id) => evaluate(`(() => {
  const row = document.querySelector('[data-testid="requirement-history-row-${id}"]')
  return row ? row.textContent : null
})()`)

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1400,
  deviceScaleFactor: 1,
  mobile: false,
})
await sleep(1000)

const bundle = path.resolve(path.dirname(appExecutable), '../..')
execFileSync('open', ['-a', bundle, SEED])
await waitFor(
  () => evaluate(`Boolean(document.querySelector('main[aria-label="寸链桌面工作台"]'))`),
  'workspace after open-file',
  30000,
)
await waitFor(
  async () => {
    const state = await projectState()
    return state !== null && state.revisions >= 3
  },
  'F4 project with three requirement revisions',
  30000,
)

const before = await projectState()
check('F4 打开且活动条款为新版本', before?.active === NEW_ID, JSON.stringify(before))

await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent.includes('复核与变更'))
  if (!button) throw new Error('复核与变更按钮不存在')
  button.click()
})()`)
await waitFor(
  () => evaluate(`Boolean(document.querySelector('[data-testid="requirement-history-section"]'))`),
  'requirement history section',
)

// 证据视图：把复核区拉高，让历史表与来源页同屏可见（只改临时布局，不改数据）。
await evaluate(`document.querySelector('main').style.setProperty('--review-height', '660px')`)
await sleep(300)
await shot('v35history-00-history-list')

const oldRow = await rowText(OLD_ID)
const newRow = await rowText(NEW_ID)
check('历史列表包含旧版本 reqrev-3a782e84', typeof oldRow === 'string' && oldRow.includes('sr-taskbook-1') && oldRow.includes('第 2 页'), oldRow?.slice(0, 160))
check('历史列表包含活动版本 reqrev-0ca101fe', typeof newRow === 'string' && newRow.includes('sr-89d9193b') && newRow.includes('第 1 页') && newRow.includes('当前活动'), newRow?.slice(0, 160))

await evaluate(`document.querySelector('[data-testid="locate-revision-requirement-history-${OLD_ID}"]').click()`)
await waitFor(
  async () => {
    const state = await sourceState()
    return state.revisionId === 'sr-taskbook-1' && state.page === 2 && state.highlight !== null
  },
  'old requirement source rendered',
  30000,
)
const oldSource = await sourceState()
check('旧版本打开 sr-taskbook-1 第 2 页', oldSource.revisionId === 'sr-taskbook-1' && oldSource.page === 2, JSON.stringify({ revisionId: oldSource.revisionId, page: oldSource.page }))
check('旧版本高亮使用其保存的选区', Math.abs(oldSource.highlight.left - 60) < 0.5 && Math.abs(oldSource.highlight.width - 460) < 0.5 && Math.abs(oldSource.highlight.height - 60) < 0.5, JSON.stringify(oldSource.highlight))
check('旧版本定位摘要含 reqrev-3a782e84 与 PDF 点', oldSource.summary?.includes(OLD_ID) === true && oldSource.summary?.includes('[60, 200, 520, 260]') === true, oldSource.summary ?? '')
check('来源页文件行显示精确版本', oldSource.fileText?.includes('taskbook-2p.pdf') === true && oldSource.fileText?.includes('fec9afafcb04') === true && oldSource.fileText?.includes('sr-taskb') === true, oldSource.fileText ?? '')
await shot('v35history-01-old-version')

await evaluate(`document.querySelector('[data-testid="locate-revision-requirement-history-${NEW_ID}"]').click()`)
await waitFor(
  async () => {
    const state = await sourceState()
    return state.revisionId === 'sr-89d9193b-57f1-419f-9fbe-0e22d0af00fb' && state.page === 1 && state.highlight !== null
  },
  'new requirement source rendered',
  30000,
)
const newSource = await sourceState()
check('活动版本打开 sr-89d9193b 第 1 页', newSource.revisionId === 'sr-89d9193b-57f1-419f-9fbe-0e22d0af00fb' && newSource.page === 1, JSON.stringify({ revisionId: newSource.revisionId, page: newSource.page }))
check('两个版本的选区高亮不同', newSource.highlight !== null && (Math.abs(newSource.highlight.left - oldSource.highlight.left) > 1 || Math.abs(newSource.highlight.height - oldSource.highlight.height) > 1), JSON.stringify({ old: oldSource.highlight, new: newSource.highlight }))
check('活动版本摘要含 reqrev-0ca101fe', newSource.summary?.includes(NEW_ID) === true, newSource.summary ?? '')
await shot('v35history-02-active-version')

const after = await projectState()
check('定位前后活动条款未改变', JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }))

socket.close()
child.kill('SIGKILL')
console.log(`RESULT ${failures.length === 0 ? 'ALL_PASS' : 'FAIL'}`)
if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
process.exit(0)
