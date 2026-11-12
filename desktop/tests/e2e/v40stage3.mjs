#!/usr/bin/env node
/**
 * V4.0 阶段 3 打包应用真点击走查：侧栏展开、待答问题、工具失败、提交成功、960×640 折叠保留。
 *
 * 用法：
 *   node desktop/tests/e2e/v40stage3.mjs [appExecutable] [port]
 * 前置：
 *   V40S3_SEED_OUT=<abs path> npx vitest run --config vitest.v40stage3fixture.config.ts
 * 输出：
 *   docs/evidence/v40-stage3/screenshots/*.png
 *   docs/evidence/v40-stage3/e2e-result.json（serializeEvidence）
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import path from 'node:path'
import { serializeEvidence } from '../../../scripts/evidence-json.ts'

const appExecutable = process.argv[2] ?? path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9383)
const SEED = path.join(process.cwd(), 'docs', 'evidence', 'v40-stage3', 'fixtures', 'stage3-seed.cunlian')
const WORK_DIR = '/Users/aston/DSH/tmp/cunlian-v40-stage3'
const WORK = path.join(WORK_DIR, `stage3-run-${process.pid}.cunlian`)
const SHOTS = path.join(process.cwd(), 'docs', 'evidence', 'v40-stage3', 'screenshots')
const RESULT = path.join(process.cwd(), 'docs', 'evidence', 'v40-stage3', 'e2e-result.json')

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}`)
  process.exit(2)
}
if (!existsSync(SEED)) {
  console.error(`BLOCKED: 缺少走查项目 ${SEED}（先运行 V40S3_SEED_OUT=... npx vitest run --config vitest.v40stage3fixture.config.ts）`)
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
  const file = path.join(SHOTS, `${name}.png`)
  await fsp.writeFile(file, Buffer.from(response.result.data, 'base64'))
  screenshots.push(path.relative(process.cwd(), file))
  console.log(`SHOT ${file}`)
}

async function waitFor(predicate, label, timeoutMs = 20_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return
    await sleep(150)
  }
  throw new Error(`TIMEOUT: ${label}`)
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
    // Electron 的 page target 不总是暴露 Browser windowId；用设备度量模拟同一视口，
    // 截图与 window.innerWidth/Height、媒体查询都按目标尺寸生效。
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  }
  await sleep(500)
}

try {
  await launch()
  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(1200)
  await setBounds(1280, 900)
  execFileSync('open', ['-a', bundle, WORK])
  await waitFor(() => evaluate(`Boolean(document.querySelector('main[aria-label="寸链桌面工作台"]'))`), 'workspace', 30_000)

  // 侧栏展开（若上次状态是收起，则点工具栏按钮）。
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.desktop-workspace__layout-tools button')].find((item) => (item.textContent ?? '').includes('任务侧栏'))
    if (!button) throw new Error('未找到任务侧栏开关')
    if (button.getAttribute('aria-expanded') === 'false') button.click()
    return button.getAttribute('aria-expanded')
  })()`)
  await waitFor(() => evaluate(`Boolean(document.querySelector('.agent-sidebar #agent-sidebar-panel, .agent-sidebar[aria-label="Agent 任务侧栏"]'))`), 'sidebar')
  await waitFor(() => evaluate(`(document.querySelector('.agent-sidebar')?.textContent ?? '').includes('未配置')`), 'provider status')
  const projectName = await evaluate(`document.querySelector('.desktop-workspace__titlebar h1')?.textContent ?? ''`)
  checks.push({ id: 'sidebar-expanded', ok: true, projectName })

  // 正常演示 → 预览 → 确认保存（真实点击）。
  await clickByText('.agent-sidebar button', '正常改图')
  await waitFor(() => evaluate(`(() => {
    const button = [...document.querySelectorAll('.agent-sidebar button')].find((item) => item.textContent === '确认保存')
    return Boolean(button) && !button.disabled
  })()`), 'confirm button', 20_000)
  // 预览摘要在侧栏下方：滚到底部，让“预览指纹/条款/确认保存”进入截图。
  await evaluate(`(() => { const panel = document.querySelector('.agent-sidebar'); if (panel) panel.scrollTop = panel.scrollHeight; return true })()`)
  await sleep(400)
  await shot('v40-stage3-01-sidebar-expanded')

  await clickByText('.agent-sidebar button', '确认保存')
  await waitFor(() => evaluate(`(document.querySelector('[data-testid="agent-commit-result"]')?.textContent ?? '').includes('已提交（工具回执）')`), 'commit receipt', 20_000)
  const commitText = await evaluate(`document.querySelector('[data-testid="agent-commit-result"]')?.textContent ?? ''`)
  await evaluate(`(() => { const panel = document.querySelector('.agent-sidebar'); if (panel) panel.scrollTop = panel.scrollHeight; return true })()`)
  await sleep(300)
  await shot('v40-stage3-04-commit-success')
  const revisionId = commitText.match(/版本 (\S+)/)?.[1] ?? null
  checks.push({ id: 'commit-success', ok: true, receipt: commitText, revisionId })

  // 待答问题：工具回执 CONSTRAINT_VIOLATED（界面已翻成“这个参数被锁定”）+ 模型自述不进入结论位。
  await clickByText('.agent-sidebar button', '需要补充')
  await waitFor(() => evaluate(`document.querySelector('[data-testid="agent-question-reason"]')?.textContent === '这个参数被锁定'`), 'question', 20_000)
  const questionText = await evaluate(`document.querySelector('.agent-sidebar')?.textContent ?? ''`)
  await shot('v40-stage3-02-pending-question')
  checks.push({ id: 'pending-question', ok: true, code: 'CONSTRAINT_VIOLATED', containsModelClaim: questionText.includes('已完成') || questionText.includes('已保存') })

  // 工具失败：写明原因与怎么办；即使模型文本声称保存成功也不得出现结论文案。
  await clickByText('.agent-sidebar button', '工具失败')
  await waitFor(() => evaluate(`(document.querySelector('[data-testid="agent-task-state"]')?.textContent ?? '').includes('没有做成 · 数值或参数不合法')`), 'tool failure', 20_000)
  const sidebarText = await evaluate(`document.querySelector('.agent-sidebar')?.textContent ?? ''`)
  const contradiction = /已完成|已保存/.test(sidebarText)
  await shot('v40-stage3-03-tool-failure')
  checks.push({ id: 'tool-failure', ok: !contradiction, state: await evaluate(`document.querySelector('[data-testid="agent-task-state"]')?.textContent ?? ''`), contradiction })

  // 960×640：覆盖式侧栏不挤压中央画布；折叠状态跨重载保留。
  await setBounds(960, 640)
  await sleep(500)
  const layout = await evaluate(`(() => {
    const canvas = document.querySelector('.desktop-workspace__center')?.getBoundingClientRect()
    const sidebar = document.querySelector('.agent-sidebar')?.getBoundingClientRect()
    return { canvasWidth: canvas?.width ?? 0, canvasHeight: canvas?.height ?? 0, sidebarRight: sidebar?.right ?? 0, width: window.innerWidth, height: window.innerHeight }
  })()`)
  await shot('v40-stage3-05-960x640')
  checks.push({ id: 'layout-960x640', ok: layout.canvasWidth >= 400 && layout.canvasHeight >= 300 && layout.width === 960 && layout.height === 640, layout })

  await clickByText('.desktop-workspace__layout-tools button', '收起任务侧栏')
  await send('Page.reload', { ignoreCache: false })
  await sleep(800)
  await waitFor(() => evaluate(`Boolean(document.querySelector('main[aria-label="寸链桌面工作台"]'))`), 'workspace after reload', 30_000)
  await waitFor(() => evaluate(`(() => {
    const button = [...document.querySelectorAll('.desktop-workspace__layout-tools button')].find((item) => (item.textContent ?? '').includes('任务侧栏'))
    return Boolean(button) && button.getAttribute('aria-expanded') === 'false'
  })()`), 'collapsed persisted')
  const collapsed = await evaluate(`Boolean(document.querySelector('.agent-sidebar--collapsed'))`)
  checks.push({ id: 'collapse-persisted', ok: collapsed })
  await clickByText('.desktop-workspace__layout-tools button', '展开任务侧栏')

  const failed = checks.filter((item) => item.ok !== true)
  await fsp.writeFile(RESULT, serializeEvidence({
    appExecutable: path.relative(process.cwd(), appExecutable),
    seed: path.relative(process.cwd(), SEED),
    viewport: '1280x900 / 960x640',
    checks,
    screenshots,
    verdict: failed.length === 0 ? 'pass' : 'fail',
    failed: failed.map((item) => item.id),
  }))
  console.log(`RESULT ${RESULT}`)
  if (failed.length > 0) {
    console.error(`FAILED: ${failed.map((item) => item.id).join(',')}`)
    process.exitCode = 1
  }
} finally {
  try { socket?.close() } catch { /* 已关闭 */ }
  try { child?.kill('SIGKILL') } catch { /* 已退出 */ }
  await sleep(300)
}
