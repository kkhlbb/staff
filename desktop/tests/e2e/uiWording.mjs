#!/usr/bin/env node
/**
 * 侧栏文案走查：打包应用里真点一遍，抓“改前 / 改后”侧栏对照。
 *
 * 用法：
 *   node desktop/tests/e2e/uiWording.mjs before [port]   # 只取证，不断言（基线）
 *   node desktop/tests/e2e/uiWording.mjs after  [port]   # 取证 + 守卫断言
 * 前置：
 *   V40S3_SEED_OUT=<abs path> npx vitest run --config vitest.v40stage3fixture.config.ts
 * 输出：
 *   docs/evidence/ui-wording/screenshots/<label>-*.png
 *   docs/evidence/ui-wording/<label>-observed.json
 *
 * 只读取侧栏文本与截图，不写产品数据、不改原有证据目录。
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import path from 'node:path'
import { serializeEvidence } from '../../../scripts/evidence-json.ts'

const label = process.argv[2] ?? 'after'
if (!['before', 'after'].includes(label)) {
  console.error('BLOCKED: 第一个参数只能是 before 或 after')
  process.exit(2)
}
const appExecutable = process.env.UI_WORDING_APP
  ?? path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9387)
const SEED = path.join(process.cwd(), 'docs', 'evidence', 'v40-stage3', 'fixtures', 'stage3-seed.cunlian')
const WORK_DIR = '/Users/aston/DSH/tmp/cunlian-ui-wording'
const WORK = path.join(WORK_DIR, `ui-wording-${label}-${process.pid}.cunlian`)
const OUT = path.join(process.cwd(), 'docs', 'evidence', 'ui-wording')
const SHOTS = path.join(OUT, 'screenshots')
const RESULT = path.join(OUT, `${label}-observed.json`)

/** 侧栏里不该出现的内部名（用户可见文本 + 提示气泡都算）。 */
const BANNED = [
  'stage', 'preview', 'apply', 'confirmed', 'context', 'export', 'model',
  'CHUNK_FAILED', 'INVALID_INPUT', 'CONSTRAINT_VIOLATED', 'satisfied', 'unsatisfied',
  'ready-to-commit', 'awaiting-input', 'failed', 'tool:req',
]

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}`)
  process.exit(2)
}
if (!existsSync(SEED)) {
  console.error(`BLOCKED: 缺少走查项目 ${SEED}`)
  process.exit(2)
}
await fsp.mkdir(SHOTS, { recursive: true })
await fsp.mkdir(WORK_DIR, { recursive: true })
await fsp.copyFile(SEED, WORK)

const bundle = path.resolve(path.dirname(appExecutable), '../..')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const screenshots = []
const checks = []

let child = null
let childExit = null
let socket = null
let target = null
let nextId = 1
const pending = new Map()

/**
 * 直接起打包应用（清掉 ELECTRON_RUN_AS_NODE，否则 electron 会退化成 node），
 * 文档随后用 `open -a` 投给这个实例（应用内是单实例锁，第二个进程会自己退出）。
 */
async function launch() {
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  child = spawn(appExecutable, [`--remote-debugging-port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv })
  childExit = null
  child.on('exit', (code, signal) => { childExit = { code, signal } })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (childExit !== null) break
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      target = targets.find((item) => item.type === 'page') ?? null
      if (target !== null) break
    } catch { /* 端口尚未就绪 */ }
    await sleep(250)
  }
  if (target === null) {
    console.error('BLOCKED: 打包应用没有在 30 秒内暴露 page target')
    console.error(output)
    console.error(childExit === null ? '进程仍在运行但没有 DevTools 端口' : `进程已退出：${JSON.stringify(childExit)}（多半是另一个实例占着单实例锁）`)
    child?.kill('SIGKILL')
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
}

function send(method, params = {}) {
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.result?.exceptionDetails) throw new Error(`evaluate failed: ${response.result.exceptionDetails.text}`)
  return response.result?.result?.value
}

async function shot(name) {
  const response = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const file = path.join(SHOTS, `${label}-${name}.png`)
  await fsp.writeFile(file, Buffer.from(response.result.data, 'base64'))
  screenshots.push(path.relative(process.cwd(), file))
  console.log(`SHOT ${file}`)
}

async function waitFor(predicate, name, timeoutMs = 20_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return
    await sleep(150)
  }
  throw new Error(`TIMEOUT: ${name}`)
}

function clickByText(selector, text) {
  return evaluate(`(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => (item.textContent ?? '').includes(${JSON.stringify(text)}))
    if (!node) throw new Error('未找到按钮: ' + ${JSON.stringify(text)})
    node.click()
    return true
  })()`)
}

async function setBounds(width, height) {
  const windowInfo = await send('Browser.getWindowForTarget', { targetId: target.id })
  const windowId = windowInfo.result?.windowId
  if (windowId !== undefined && windowInfo.error === undefined) {
    await send('Browser.setWindowBounds', { windowId, bounds: { width, height, windowState: 'normal' } })
  } else {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  }
  await sleep(500)
}

function sidebarText() {
  return evaluate(`document.querySelector('.agent-sidebar')?.textContent ?? ''`)
}

/** 等侧栏文本从点击前那一版变成新版；比写死某一句更能同时跑改前/改后两个版本。 */
async function waitForTextChanged(previous, name, timeoutMs = 25_000) {
  await waitFor(async () => (await sidebarText()) !== previous, name, timeoutMs)
  await sleep(600)
}

/** 屏幕上的文本 + 按钮提示气泡一起查（不再只查 textContent）。 */
function sidebarVisible() {
  return evaluate(`(() => {
    const panel = document.querySelector('.agent-sidebar')
    if (!panel) return { text: '', titles: [] }
    return {
      text: panel.textContent ?? '',
      titles: [...panel.querySelectorAll('[title]')].map((node) => node.getAttribute('title') ?? ''),
    }
  })()`)
}

function bannedHits(text, titles = []) {
  const hits = []
  for (const name of BANNED) {
    const pattern = name.includes(':') ? new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : new RegExp(`(^|[^A-Za-z])${name}([^A-Za-z]|$)`, 'i')
    if (pattern.test(text)) hits.push({ name, where: 'text' })
    if (titles.some((title) => pattern.test(title))) hits.push({ name, where: 'title' })
  }
  return hits
}

try {
  await launch()
  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(1200)
  await setBounds(1280, 900)
  execFileSync('open', ['-a', bundle, WORK])
  await waitFor(() => evaluate(`Boolean(document.querySelector('main[aria-label="寸链桌面工作台"]'))`), 'workspace', 30_000)

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.desktop-workspace__layout-tools button')].find((item) => (item.textContent ?? '').includes('任务侧栏'))
    if (!button) throw new Error('未找到任务侧栏开关')
    if (button.getAttribute('aria-expanded') === 'false') button.click()
    return button.getAttribute('aria-expanded')
  })()`)
  await waitFor(() => evaluate(`Boolean(document.querySelector('.agent-sidebar #agent-sidebar-panel, .agent-sidebar[aria-label="Agent 任务侧栏"]'))`), 'sidebar')

  // 正常演示：改参数 → 算一遍 → 等你确认。
  const beforeNormal = await sidebarText()
  await clickByText('.agent-sidebar button', '正常改图')
  await waitFor(() => evaluate(`(() => {
    const button = [...document.querySelectorAll('.agent-sidebar button')].find((item) => item.textContent === '确认保存')
    return Boolean(button) && !button.disabled
  })()`), 'confirm button', 20_000)
  await waitForTextChanged(beforeNormal, 'normal steps')
  await evaluate(`(() => { const panel = document.querySelector('.agent-sidebar'); if (panel) panel.scrollTop = 0; return true })()`)
  await sleep(250)
  const normalTop = await sidebarVisible()
  await shot('01-sidebar-normal-top')
  await evaluate(`(() => { const panel = document.querySelector('.agent-sidebar'); if (panel) panel.scrollTop = panel.scrollHeight; return true })()`)
  await sleep(400)
  const normalBottom = await sidebarVisible()
  await shot('02-sidebar-normal-bottom')
  checks.push({
    id: 'normal-scenario',
    banned: bannedHits(`${normalTop.text}\n${normalBottom.text}`, [...normalTop.titles, ...normalBottom.titles]),
    hasHumanStep: /已经?算完|已改|改参数/.test(`${normalTop.text}${normalBottom.text}`),
    text: normalBottom.text.slice(-900),
  })

  // 需要补充：参数被锁定。两个版本分别显示原因码或人话，等待按“文本变了”判定。
  const beforeQuestion = await sidebarText()
  await clickByText('.agent-sidebar button', '需要补充')
  await waitForTextChanged(beforeQuestion, 'question')
  const question = await sidebarVisible()
  const questionReason = await evaluate(`document.querySelector('.agent-sidebar__questions strong')?.textContent ?? ''`)
  await shot('03-pending-question')
  checks.push({
    id: 'pending-question',
    banned: bannedHits(question.text, question.titles),
    reason: questionReason,
    text: question.text.slice(-700),
  })

  // 工具失败：写明为什么失败 + 怎么办。
  const beforeFailure = await sidebarText()
  await clickByText('.agent-sidebar button', '工具失败')
  await waitForTextChanged(beforeFailure, 'failure state')
  const failure = await sidebarVisible()
  const why = await evaluate(`document.querySelector('[data-testid="agent-task-why"]')?.textContent ?? ''`)
  await shot('04-tool-failure')
  checks.push({
    id: 'tool-failure',
    banned: bannedHits(failure.text, failure.titles),
    hasWhy: why.includes('怎么办'),
    text: failure.text.slice(-900),
  })

  const allBanned = checks.flatMap((check) => (check.banned ?? []).map((hit) => ({ check: check.id, ...hit })))
  const failed = []
  if (label === 'after') {
    if (allBanned.length > 0) failed.push('banned-internal-names')
    if (!normalBottom.text.includes('确认保存')) failed.push('confirm-button-text-missing')
    if (checks.find((check) => check.id === 'normal-scenario')?.hasHumanStep !== true) failed.push('normal-step-not-humanized')
    if (checks.find((check) => check.id === 'pending-question')?.reason !== '这个参数被锁定') failed.push('question-not-humanized')
    if (checks.find((check) => check.id === 'tool-failure')?.hasWhy !== true) failed.push('failure-why-missing')
  }

  await fsp.writeFile(RESULT, serializeEvidence({
    label,
    appExecutable: path.relative(process.cwd(), appExecutable),
    seed: path.relative(process.cwd(), SEED),
    viewport: '1280x900',
    guard: { banned: BANNED, hits: allBanned },
    checks,
    screenshots,
    verdict: failed.length === 0 ? (label === 'before' ? 'baseline-recorded' : 'pass') : 'fail',
    failed,
  }))
  console.log(`RESULT ${RESULT}`)
  console.log(`BANNED-HITS ${JSON.stringify(allBanned)}`)
  if (failed.length > 0) {
    console.error(`FAILED: ${failed.join(',')}`)
    process.exitCode = 1
  }
} finally {
  try { await Promise.race([send('Browser.close'), sleep(1500)]) } catch { /* 已关闭 */ }
  try { socket?.close() } catch { /* 已关闭 */ }
  try { child?.kill('SIGKILL') } catch { /* 未由本进程启动 */ }
  await sleep(300)
}
