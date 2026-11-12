#!/usr/bin/env node
/**
 * ADR-001 第 3 步：无任务书入口的打包应用真点击走查。
 *
 * 一条链路（全部真实点击，离线假模型只把用户原话里的数字写成草稿）：
 *   打开无任务书项目 → 侧栏“对话建件（离线演示）”→ 逐条确认候选 → 生成工程草稿
 *   → 算一遍（条款重算）→ 勾选“这些尺寸由我提供” → 保存为新版本
 *   → 工程图标题栏出现“依据：用户输入，无外部原文件”
 *   → 重启应用：最近项目列表出现“无外部来源”徽标
 *
 * 用法：
 *   npm run package:desktop -- --arch=arm64
 *   INTENT_SEED_OUT=... npx vitest run --config vitest.intentfixture.config.ts
 *   node desktop/tests/e2e/intentProject.mjs [appExecutable] [port]
 *
 * 输出：
 *   docs/evidence/intent-project/screenshots/*.png
 *   docs/evidence/intent-project/e2e-result.json（serializeEvidence）
 *
 * 已知限制（如实）：DXF/SVG/PDF 导出的系统保存对话框需要 macOS 辅助功能权限；
 * 本会话无该权限，导出文件名/文件头改由 desktop/tests/intentExport.test.ts
 * 在真实导出代码路径上验证（注入路径选择端口，不弹原生对话框）。
 */
import { spawn } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import path from 'node:path'
import { serializeEvidence } from '../../../scripts/evidence-json.ts'

const appExecutable = process.argv[2] ?? path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9397)
const SEED = path.join(process.cwd(), 'docs', 'evidence', 'intent-project', 'fixtures', 'intent-seed.cunlian')
const WORK_DIR = '/Users/aston/DSH/tmp/cunlian-intent'
const WORK = path.join(WORK_DIR, `intent-run-${process.pid}.cunlian`)
const SHOTS = path.join(process.cwd(), 'docs', 'evidence', 'intent-project', 'screenshots')
const RESULT = path.join(process.cwd(), 'docs', 'evidence', 'intent-project', 'e2e-result.json')

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

/** 区域截图（页面坐标）：用于把图纸标题栏按原始分辨率截出来。 */
async function shotClip(name, clip, scale = 2) {
  const response = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { ...clip, scale },
  })
  const file = path.join(SHOTS, `${name}.png`)
  await fsp.writeFile(file, Buffer.from(response.result.data, 'base64'))
  screenshots.push(path.relative(process.cwd(), file))
  console.log(`SHOT ${file}`)
}

async function waitFor(predicate, label, timeoutMs = 25_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return
    await sleep(150)
  }
  throw new Error(`TIMEOUT: ${label}`)
}

function clickByText(selector, text) {
  return evaluate(`(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => (item.textContent ?? '') === ${JSON.stringify(text)})
      ?? [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => (item.textContent ?? '').includes(${JSON.stringify(text)}))
    if (!node) throw new Error('未找到按钮: ' + ${JSON.stringify(text)})
    node.click()
    return true
  })()`)
}

function setInput(selector, value) {
  return evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)})
    if (!node) throw new Error('未找到输入框: ' + ${JSON.stringify(selector)})
    const proto = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(node, ${JSON.stringify(value)})
    node.dispatchEvent(new Event('input', { bubbles: true }))
    return node.value
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
  await sleep(400)
}

async function waitWorkspace() {
  await waitFor(() => evaluate(`Boolean(document.querySelector('main[aria-label="寸链桌面工作台"]'))`), 'workspace', 40_000)
}

async function openSidebar() {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.desktop-workspace__layout-tools button')].find((item) => (item.textContent ?? '').includes('任务侧栏'))
    if (!button) throw new Error('未找到任务侧栏开关')
    if (button.getAttribute('aria-expanded') === 'false') button.click()
    return true
  })()`)
  await waitFor(() => evaluate(`Boolean(document.querySelector('.agent-sidebar'))`), 'sidebar')
}

try {
  await launch()
  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(1200)
  await setBounds(1280, 900)
  spawn('open', ['-a', bundle, WORK], { stdio: 'ignore' })
  await waitWorkspace()

  // 标题栏：无外部来源标记。
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="project-source-note"]'))`), 'project source note')
  const sourceNote = await evaluate(`document.querySelector('[data-testid="project-source-note"]')?.textContent ?? ''`)
  checks.push({ id: 'project-source-note', ok: sourceNote === '依据：用户输入，无外部原文件', note: sourceNote })

  await openSidebar()
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="intent-draft"], .agent-sidebar'))`), 'sidebar panel')

  // 无任务书建项区：填责任人 → 用离线演示把原话里的数字写成草稿。
  await waitFor(() => evaluate(`Boolean(document.querySelector('input[aria-label="责任人称呼"]'))`), 'actor input')
  await setInput('input[aria-label="责任人称呼"]', '老王')
  await sleep(200)
  await clickByText('.agent-sidebar button', '对话建件（离线演示）')
  await waitFor(() => evaluate(`/待确认 [1-9]/.test(document.querySelector('[data-testid="intent-counts"]')?.textContent ?? '')`), 'intent candidates', 40_000)
  const pendingCount = await evaluate(`(() => {
    const text = document.querySelector('[data-testid="intent-counts"]')?.textContent ?? ''
    return Number((text.split('待确认 ')[1] ?? '').split(' ')[0] ?? 0)
  })()`)
  checks.push({ id: 'draft-candidate-count', ok: pendingCount === 7, pendingCount })
  const draftText = await evaluate(`document.querySelector('[data-testid="intent-draft"]')?.textContent ?? ''`)
  checks.push({
    id: 'intent-draft-written',
    ok: draftText.includes('组成环 H') && draftText.includes('条款区间') && draftText.includes('依据：用户输入，无外部原文件'),
    text: draftText.slice(0, 400),
  })
  await evaluate(`(() => { const panel = document.querySelector('.agent-sidebar'); if (panel) panel.scrollTop = panel.scrollHeight * 0.45; return true })()`)
  await sleep(300)
  await shot('intent-01-draft-from-conversation')

  // 逐条确认（不是全批）：每条都点“确认这条”，直到待确认归零。
  for (let index = 0; index < 12; index += 1) {
    const remaining = await evaluate(`[...document.querySelectorAll('.agent-sidebar button')].filter((item) => item.textContent === '确认这条').length`)
    if (remaining === 0) break
    await clickByText('.agent-sidebar button', '确认这条')
    await sleep(250)
  }
  await waitFor(() => evaluate(`(document.querySelector('[data-testid="intent-counts"]')?.textContent ?? '').includes('待确认 0')`), 'all confirmed')
  checks.push({ id: 'candidates-confirmed-one-by-one', ok: true })

  // 生成工程草稿 → 算一遍（条款重算）。
  await clickByText('.agent-sidebar button', '生成工程草稿')
  await waitFor(() => evaluate(`(document.querySelector('[data-testid="intent-note"]')?.textContent ?? '').includes('生成工程草稿')`), 'apply note')
  await clickByText('.agent-sidebar button', '算一遍（重算条款）')
  await waitFor(() => evaluate(`(document.querySelector('[data-testid="intent-note"]')?.textContent ?? '').includes('已算完')`), 'preview note', 30_000)
  const previewText = await evaluate(`document.querySelector('.agent-sidebar')?.textContent ?? ''`)
  checks.push({ id: 'requirement-checked', ok: previewText.includes('满足要求'), containsStatus: previewText.includes('满足要求') })
  await evaluate(`(() => { const panel = document.querySelector('.agent-sidebar'); if (panel) panel.scrollTop = panel.scrollHeight; return true })()`)
  await sleep(300)
  await shot('intent-02-preview-and-attestation')
  // 另一张：滚到确认勾选框与逐条候选，证明“勾了才签”。
  await evaluate(`(() => {
    const ack = document.querySelector('.agent-sidebar__ack')
    const panel = document.querySelector('.agent-sidebar')
    if (panel && ack) panel.scrollTop = Math.max(0, ack.offsetTop - 260)
    return true
  })()`)
  await sleep(300)
  await shot('intent-02b-attestation-checkbox')

  // 勾选“这些尺寸由我提供，无原文件可核对”→ 保存为新版本。
  await evaluate(`(() => {
    const box = document.querySelector('input[aria-label="这些尺寸由我提供"]')
    if (!box) throw new Error('未找到确认勾选框')
    box.click()
    return box.checked
  })()`)
  await sleep(200)
  await clickByText('.agent-sidebar button', '确认并保存为新版本')
  await waitFor(() => evaluate(`(document.querySelector('[data-testid="intent-commit-result"]')?.textContent ?? '').includes('已保存为新版本')`), 'commit', 40_000)
  const commitText = await evaluate(`document.querySelector('[data-testid="intent-commit-result"]')?.textContent ?? ''`)
  checks.push({ id: 'commit-with-attestation', ok: true, receipt: commitText })
  await evaluate(`(() => { const panel = document.querySelector('.agent-sidebar'); if (panel) panel.scrollTop = panel.scrollHeight; return true })()`)
  await sleep(300)
  await shot('intent-03-commit-receipt')

  // 工程图：标题栏出现“依据：用户输入，无外部原文件”。
  await clickByText('.desktop-workspace__tabs button', '工程图')
  await waitFor(() => evaluate(`(() => {
    const svg = document.querySelector('.desktop-workspace svg')
    return Boolean(svg) && (svg.textContent ?? '').includes('用户输入，无外部原文件')
  })()`), 'drawing title block', 30_000)
  const svgText = await evaluate(`document.querySelector('.desktop-workspace svg')?.textContent ?? ''`)
  checks.push({ id: 'drawing-title-block', ok: svgText.includes('依据') && svgText.includes('用户输入，无外部原文件') })
  const svgInfo = await evaluate(`(() => {
    const svg = document.querySelector('.desktop-workspace svg')
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const ancestors = []
    let node = svg.parentElement
    while (node) {
      if (node.scrollHeight > node.clientHeight + 4) ancestors.push({ cls: String(node.className), sh: node.scrollHeight, ch: node.clientHeight, st: node.scrollTop })
      node = node.parentElement
    }
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, hiddenAncestor: svg.closest('[hidden]') !== null, ancestors }
  })()`)
  console.log('SVG_INFO', JSON.stringify(svgInfo))
  // 复核面板展开时会把图纸区压到 48px 高。这里只为截图临时放大图纸容器
  // （只改 CSS 高度，不改任何数据/图纸内容），并滚到标题栏所在的下部。
  await evaluate(`(() => {
    const toggle = [...document.querySelectorAll('button')].find((item) => (item.textContent ?? '').includes('复核与变更') && item.getAttribute('aria-expanded') === 'true')
    if (toggle) toggle.click()
    const zoom = [...document.querySelectorAll('button')].find((item) => (item.textContent ?? '').trim() === '50%')
    if (zoom) zoom.click()
    for (const selector of ['.spacer-drawing__canvas', '.drawing-canvas']) {
      const node = document.querySelector(selector)
      if (node) {
        node.style.height = '460px'
        node.style.maxHeight = '460px'
      }
    }
    return true
  })()`)
  await sleep(600)
  await evaluate(`(() => {
    const collapse = [...document.querySelectorAll('.agent-sidebar button')].find((item) => (item.textContent ?? '').trim() === '收起')
    if (collapse) collapse.click()
    return true
  })()`)
  await sleep(400)
  await evaluate(`(() => {
    const canvas = document.querySelector('.drawing-canvas')
    if (canvas) {
      canvas.scrollTop = 0
      canvas.scrollLeft = 0
    }
    return true
  })()`)
  await sleep(500)
  const svgAfter = await evaluate(`(() => { const svg = document.querySelector('.desktop-workspace svg'); const r = svg?.getBoundingClientRect(); return r === undefined ? null : { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
  console.log('SVG_AFTER_EXPAND', JSON.stringify(svgAfter))
  // 把图纸卷到视口中央，截图里能直接读到标题栏那一行。
  await evaluate(`(() => {
    const svg = document.querySelector('.desktop-workspace svg')
    if (!svg) throw new Error('未找到图纸 SVG')
    let node = svg.parentElement
    while (node) {
      if (node.scrollHeight > node.clientHeight + 4) {
        const svgRect = svg.getBoundingClientRect()
        const nodeRect = node.getBoundingClientRect()
        node.scrollTop += (svgRect.top - nodeRect.top) - 16
      }
      node = node.parentElement
    }
    return true
  })()`)
  await sleep(500)
  await shot('intent-04-drawing-title-block')
  // 工作台把图纸区压得很矮（48px）。为了把标题栏按可读尺寸截下来，
  // 把**同一个已渲染的 SVG**（不是重画的图）临时放进全屏覆盖层截图，截完移除。
  const titleClip = await evaluate(`(() => {
    const svg = document.querySelector('.desktop-workspace svg')
    if (!svg) return null
    const overlay = document.createElement('div')
    overlay.id = 'evidence-drawing-overlay'
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#ffffff;display:flex;align-items:center;justify-content:center'
    const clone = svg.cloneNode(true)
    clone.removeAttribute('style')
    clone.style.width = '1200px'
    clone.style.height = 'auto'
    overlay.appendChild(clone)
    document.body.appendChild(overlay)
    const rect = clone.getBoundingClientRect()
    return {
      x: rect.x + (170 / 297) * rect.width,
      y: rect.y + (160 / 210) * rect.height,
      width: (117 / 297) * rect.width,
      height: (40 / 210) * rect.height,
    }
  })()`)
  if (titleClip !== null) {
    await sleep(300)
    await shot('intent-04b-drawing-full')
    await shotClip('intent-04c-title-block-crop', titleClip, 4)
  }
  await evaluate(`(() => { document.getElementById('evidence-drawing-overlay')?.remove(); return true })()`)

  // 重启应用（不打开文件）：最近项目列表出现“无外部来源”徽标。
  try { child.kill('SIGKILL') } catch { /* 已退出 */ }
  try { socket.close() } catch { /* 已关闭 */ }
  await sleep(1200)
  socket = null
  target = null
  pending.clear()
  await launch()
  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(1200)
  await setBounds(1280, 900)
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="recent-no-external-source"]'))`), 'recent badge', 40_000)
  const badge = await evaluate(`document.querySelector('[data-testid="recent-no-external-source"]')?.textContent ?? ''`)
  checks.push({ id: 'recent-list-badge', ok: badge === '无外部来源', badge })
  await evaluate(`(() => {
    const node = document.querySelector('[data-testid="recent-no-external-source"]')
    if (node) node.scrollIntoView({ block: 'center' })
    return true
  })()`)
  await sleep(500)
  await shot('intent-05-recent-list-badge')

  const failed = checks.filter((item) => item.ok !== true)
  await fsp.writeFile(RESULT, serializeEvidence({
    appExecutable: path.relative(process.cwd(), appExecutable),
    seed: path.relative(process.cwd(), SEED),
    workFile: WORK,
    viewport: '1280x900',
    checks,
    screenshots,
    limitation: '原生保存对话框需要辅助功能权限；导出文件名/文件头由 desktop/tests/intentExport.test.ts 在真实导出路径上验证。',
    verdict: failed.length === 0 ? 'pass' : 'fail',
    failed: failed.map((item) => item.id),
  }))
  console.log(`RESULT ${RESULT}`)
  if (failed.length > 0) {
    console.error(`FAILED: ${failed.map((item) => item.id).join(',')}`)
    process.exitCode = 1
  }
} catch (error) {
  try { await shot('intent-99-failure') } catch { /* 截图失败不掩盖原因 */ }
  try {
    const text = await evaluate(`document.querySelector('.agent-sidebar')?.textContent ?? ''`)
    console.error('SIDEBAR_TEXT:', text.slice(0, 2500))
    const notes = await evaluate(`[...document.querySelectorAll('[data-testid^="intent-"], [data-testid^="agent-"]')].map(n => n.getAttribute('data-testid') + ':' + (n.textContent ?? '')).join('\\n')`)
    console.error('TESTIDS:', notes)
  } catch { /* 页面可能已关闭 */ }
  throw error
} finally {
  try { socket?.close() } catch { /* 已关闭 */ }
  try { child?.kill('SIGKILL') } catch { /* 已退出 */ }
  await sleep(300)
}
