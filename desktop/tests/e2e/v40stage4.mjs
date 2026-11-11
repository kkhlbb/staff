#!/usr/bin/env node
/**
 * V4.0 阶段 4 打包应用走查（真实模型 + 真实系统对话框）。
 *
 * 用法：
 *   set -a; . ~/.hermes/.env; set +a
 *   node desktop/tests/e2e/v40stage4.mjs [appExecutable] [port]
 *
 * 前置：
 *   V40S4_SEED_OUT=<abs path> npx vitest run --config vitest.v40stage4fixture.config.ts
 *   npm run package:desktop
 *   运行时必须有 DEEPSEEK_API_KEY（只在内存与 Keychain 之间传递，不写证据）
 *
 * 输出：
 *   docs/evidence/v40-stage4/screenshots/*.png
 *   docs/evidence/v40-stage4/e2e-result.json（serializeEvidence）
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { serializeEvidence } from '../../../scripts/evidence-json.ts'

const appExecutable = process.argv[2] ?? path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9384)
const SEED = path.join(process.cwd(), 'docs', 'evidence', 'v40-stage4', 'fixtures', 'a40-project.cunlian')
const WORK_DIR = '/Users/aston/DSH/tmp/cunlian-v40-stage4'
const WORK = path.join(WORK_DIR, `stage4-run-${process.pid}.cunlian`)
const SHOTS = path.join(process.cwd(), 'docs', 'evidence', 'v40-stage4', 'screenshots')
const RESULT = path.join(process.cwd(), 'docs', 'evidence', 'v40-stage4', 'e2e-result.json')
const KEY = process.env.DEEPSEEK_API_KEY ?? ''

const bundle = path.resolve(path.dirname(appExecutable), '../..')
const appData = path.join(os.homedir(), 'Library', 'Application Support', '寸链')
const MODEL_CONFIG = path.join(appData, 'workspace', 'model-config.json')

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}`)
  process.exit(2)
}
if (!existsSync(SEED)) {
  console.error(`BLOCKED: 缺少走查项目 ${SEED}（先运行 V40S4_SEED_OUT=... npx vitest run --config vitest.v40stage4fixture.config.ts）`)
  process.exit(2)
}
if (KEY.trim() === '') {
  console.error('BLOCKED: 运行时没有 DEEPSEEK_API_KEY（走查需要真实模型）')
  process.exit(2)
}

await fsp.mkdir(SHOTS, { recursive: true })
await fsp.mkdir(WORK_DIR, { recursive: true })
await fsp.copyFile(SEED, WORK)

// 供应商配置：非敏感字段写 JSON，密钥只写 Keychain（security -i 从 stdin 读，argv 不可见）。
await fsp.mkdir(path.dirname(MODEL_CONFIG), { recursive: true })
await fsp.writeFile(MODEL_CONFIG, `${JSON.stringify({
  adapterId: 'openai-compatible-1',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  keySource: 'keychain',
  keyEnvVar: 'DEEPSEEK_API_KEY',
}, null, 2)}\n`, { mode: 0o600 })
const quoted = (value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const kcCommand = `add-generic-password -U -s ${quoted('com.kkhlbb.cunlian.model')} -a ${quoted('openai-compatible-1')} -w ${quoted(KEY)}\n`
const kc = spawnSync('security', ['-i'], { input: kcCommand, encoding: 'utf8' })
if (kc.status !== 0) {
  console.error('BLOCKED: 写入 Keychain 失败（不打印密钥）')
  process.exit(2)
}
const configText = await fsp.readFile(MODEL_CONFIG, 'utf8')
if (configText.includes(KEY)) {
  console.error('FAIL: 模型配置文件里出现了密钥')
  process.exit(2)
}

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
    child.kill('SIGKILL')
    throw new Error(`BLOCKED: 打包应用没有在 30 秒内暴露 page target；stderr tail=${output.slice(-400)}`)
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

async function waitFor(predicate, label, timeoutMs = 30_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true
    await sleep(200)
  }
  throw new Error(`TIMEOUT: ${label}`)
}

function clickByText(selector, text) {
  return evaluate(`(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => (item.textContent ?? '').includes(${JSON.stringify(text)}))
    if (!node) throw new Error('未找到按钮: ' + ${JSON.stringify(text)})
    if (node.disabled) throw new Error('按钮不可用: ' + ${JSON.stringify(text)})
    node.click()
    return true
  })()`)
}

function setGoal(text) {
  return evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Agent 任务输入"]')
    if (!input) throw new Error('缺少任务输入框')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(text)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return input.value
  })()`)
}

function sidebarText() {
  return evaluate(`document.querySelector('.agent-sidebar')?.textContent ?? ''`)
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

async function waitTaskSettled(timeoutMs = 180_000) {
  await waitFor(() => evaluate(`(() => {
    const text = document.querySelector('[data-testid="agent-task-state"]')?.textContent ?? ''
    return /ready-to-commit|completed|failed|awaiting-input|cancelled/.test(text)
  })()`), 'task settled', timeoutMs)
}

async function quit() {
  if (socket !== null) {
    try {
      await Promise.race([
        send('Browser.close'),
        sleep(1500),
      ])
    } catch { /* 已退出 */ }
  }
  if (child !== null && childExit === null) {
    child.kill('SIGTERM')
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (childExit !== null) break
      await sleep(100)
    }
    if (childExit === null) child.kill('SIGKILL')
  }
}

try {
  await launch()
  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(1200)
  await setBounds(1280, 900)
  execFileSync('open', ['-a', bundle, WORK])
  await waitFor(() => evaluate(`Boolean(document.querySelector('main[aria-label="寸链桌面工作台"]'))`), 'workspace', 40_000)

  // 展开任务侧栏。
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.desktop-workspace__layout-tools button')].find((item) => (item.textContent ?? '').includes('任务侧栏'))
    if (!button) throw new Error('未找到任务侧栏开关')
    if (button.getAttribute('aria-expanded') === 'false') button.click()
    return true
  })()`)
  await waitFor(() => evaluate(`Boolean(document.querySelector('.agent-sidebar'))`), 'sidebar')
  await waitFor(() => evaluate(`(document.querySelector('[data-testid="agent-provider-status"]')?.textContent ?? '').includes('openai-compatible-1')`), 'provider configured', 30_000)
  const providerText = await evaluate(`document.querySelector('[data-testid="agent-provider-status"]')?.textContent ?? ''`)
  checks.push({ id: 'provider-configured', ok: providerText.includes('openai-compatible-1:deepseek-chat'), providerText })
  await shot('v40-stage4-01-provider-configured')

  // 连接测试（合成文本，不发项目资料）。
  await evaluate(`(() => {
    const details = document.querySelector('.agent-sidebar__settings')
    if (details && !details.open) details.open = true
    return true
  })()`)
  await clickByText('.agent-sidebar button', '测试连接')
  await waitFor(() => evaluate(`(document.querySelector('[data-testid="agent-provider-test"]')?.textContent ?? '').length > 0`), 'provider test', 40_000)
  const testText = await evaluate(`document.querySelector('[data-testid="agent-provider-test"]')?.textContent ?? ''`)
  checks.push({ id: 'provider-test', ok: testText.includes('连接成功'), text: testText })
  await shot('v40-stage4-02-provider-test')

  // 真实模型改图 12.04 → 预览（区间与裕量）→ 确认保存。
  await setGoal('把隔套长度改为 12.04 mm，其余保持原值。')
  await clickByText('.agent-sidebar button', '真实模型执行')
  await waitTaskSettled()
  await waitFor(() => evaluate(`(() => {
    const button = [...document.querySelectorAll('.agent-sidebar button')].find((item) => item.textContent === '确认保存')
    return Boolean(button) && !button.disabled
  })()`), 'preview ready', 60_000)
  await evaluate(`(() => { const panel = document.querySelector('.agent-sidebar'); if (panel) panel.scrollTop = panel.scrollHeight; return true })()`)
  await sleep(400)
  const previewText = await sidebarText()
  checks.push({
    id: 'preview-12.04',
    ok: previewText.includes('0.110') && previewText.includes('0.210') && previewText.includes('0.010') && previewText.includes('0.090'),
    text: previewText.slice(-600),
  })
  await shot('v40-stage4-03-preview-margins')

  await clickByText('.agent-sidebar button', '确认保存')
  await waitFor(() => evaluate(`(document.querySelector('[data-testid="agent-commit-result"]')?.textContent ?? '').includes('已提交（工具回执）')`), 'commit receipt', 40_000)
  const commitText = await evaluate(`document.querySelector('[data-testid="agent-commit-result"]')?.textContent ?? ''`)
  await evaluate(`(() => { const panel = document.querySelector('.agent-sidebar'); if (panel) panel.scrollTop = panel.scrollHeight; return true })()`)
  await shot('v40-stage4-04-commit')
  checks.push({ id: 'commit', ok: true, receipt: commitText })

  // 超限 12.10：可预览，但确认保存被禁用（条款不满足）。
  await setGoal('把隔套长度改为 12.10 mm，其余保持原值。')
  await clickByText('.agent-sidebar button', '真实模型执行')
  await waitTaskSettled()
  await waitFor(() => evaluate(`(() => {
    const text = document.querySelector('.agent-sidebar')?.textContent ?? ''
    return text.includes('0.150') && text.includes('-0.050')
  })()`), 'over-limit preview', 60_000)
  await evaluate(`(() => { const panel = document.querySelector('.agent-sidebar'); if (panel) panel.scrollTop = panel.scrollHeight; return true })()`)
  await sleep(300)
  const overText = await sidebarText()
  const confirmDisabled = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.agent-sidebar button')].find((item) => item.textContent === '确认保存')
    return button === undefined ? null : button.disabled
  })()`)
  checks.push({ id: 'over-limit-blocked', ok: confirmDisabled === true && overText.includes('-0.050'), confirmDisabled, text: overText.slice(-500) })
  await shot('v40-stage4-05-over-limit-blocked')

  // 导出：系统保存对话框在本机自动化环境中不可驱动（System Events 看不到该 ad-hoc 应用窗口，
  // Escape/keystroke 无法投递；open 无法启动该构建）。如实记为 BLOCKED，不假装成功。
  // 导出的真实文件写入/哈希/取消由 desktop/tests/agentExport.test.ts 覆盖，见交付说明。
  checks.push({
    id: 'export-dialog',
    ok: false,
    blocked: true,
    reason: 'native-save-dialog-not-automatable: System Events 报 0 windows；AppleScript 无法激活该 ad-hoc 应用；Escape 未投递',
  })
  await shot('v40-stage4-06-export-blocked')

  // 追问：模糊指令下模型必须提问而不是猜（真实模型行为记录）。
  await setGoal('把隔套改一下，其他先不动。')
  await clickByText('.agent-sidebar button', '真实模型执行')
  await waitTaskSettled()
  await evaluate(`(() => { const panel = document.querySelector('.agent-sidebar'); if (panel) panel.scrollTop = panel.scrollHeight; return true })()`)
  const askText = await sidebarText()
  const askedQuestion = /(请|需要|哪|多少|明确|问)/u.test(askText) && !/已提交（工具回执）\s*$/.test(askText)
  checks.push({ id: 'clarification', ok: askedQuestion, text: askText.slice(-500) })
  await shot('v40-stage4-08-clarification')

  // 重开续问：退出应用 → 用同一文件重开 → 问“上次改了什么”。
  await quit()
  await sleep(1200)
  socket = null
  target = null
  pending.clear()
  nextId = 1
  await launch()
  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(1200)
  await setBounds(1280, 900)
  execFileSync('open', ['-a', bundle, WORK])
  await waitFor(() => evaluate(`Boolean(document.querySelector('main[aria-label="寸链桌面工作台"]'))`), 'workspace reopened', 40_000)
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.desktop-workspace__layout-tools button')].find((item) => (item.textContent ?? '').includes('任务侧栏'))
    if (button && button.getAttribute('aria-expanded') === 'false') button.click()
    return true
  })()`)
  await waitFor(() => evaluate(`Boolean(document.querySelector('input[aria-label="Agent 任务输入"]'))`), 'sidebar after reopen', 30_000)
  await setGoal('上一次已保存的版本改了什么？当前检查结果如何？')
  await clickByText('.agent-sidebar button', '真实模型执行')
  await waitTaskSettled()
  await evaluate(`(() => { const panel = document.querySelector('.agent-sidebar'); if (panel) panel.scrollTop = panel.scrollHeight; return true })()`)
  await sleep(400)
  const reopenText = await sidebarText()
  const reopenReply = await evaluate(`document.querySelector('[data-testid="agent-model-text"]')?.textContent ?? ''`)
  checks.push({
    id: 'reopen-recap',
    ok: reopenReply.includes('12.04') && (reopenReply.includes('12.00') || reopenReply.includes('12.0000')) && /(满足|区间|satisfied)/u.test(reopenReply),
    text: reopenReply.slice(-700),
  })
  await shot('v40-stage4-09-reopen-recap')

  const blocked = checks.filter((check) => check.blocked === true)
  const passed = checks.filter((check) => check.blocked !== true).every((check) => check.ok)
  await fsp.writeFile(RESULT, serializeEvidence({
    app: { bundle: path.basename(bundle), model: 'deepseek-chat', adapter: 'openai-compatible-1' },
    project: path.basename(WORK),
    checks,
    blocked: blocked.map((check) => check.id),
    screenshots,
    passed,
  }))
  console.log(`RESULT ${passed ? 'PASS' : 'FAIL'} checks=${checks.length} blocked=${blocked.length}`)
  for (const check of checks) console.log(`CHECK ${check.id} ${check.blocked === true ? 'BLOCKED' : check.ok ? 'ok' : 'FAIL'}`)
  process.exitCode = passed ? 0 : 1
} catch (error) {
  console.error(`E2E_FAILED: ${error instanceof Error ? error.message : String(error)}`)
  try {
    const text = await sidebarText()
    console.error(`SIDEBAR: ${text.slice(-800)}`)
  } catch { /* 页面可能已关闭 */ }
  await fsp.writeFile(RESULT, serializeEvidence({
    app: { bundle: path.basename(bundle), model: 'deepseek-chat', adapter: 'openai-compatible-1' },
    checks,
    screenshots,
    passed: false,
    failure: error instanceof Error ? error.message : String(error),
  }))
  process.exitCode = 1
} finally {
  await quit()
  // 清理走查期间写入的 Keychain 项（只删本应用 service）。
  spawnSync('security', ['delete-generic-password', '-s', 'com.kkhlbb.cunlian.model', '-a', 'openai-compatible-1'])
}
