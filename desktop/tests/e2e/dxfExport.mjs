#!/usr/bin/env node
/**
 * DXF 导出 v1 · 打包应用真实点击走查。
 *
 * 真实 Electron 打包产物 + 真实系统保存对话框（macOS System Events）：
 *   ① 打开内置示例 → 工程图页生成图纸
 *   ② 点「导出 DXF（R12）」→ 保存 → 回执文件名/字节数/SHA-256 与磁盘一致
 *   ③ 点「导出 DXF（2000）」→ Esc 取消 → 回执 CANCELLED，且不产生文件
 *
 * 用法：
 *   npm run package:desktop -- --arch=arm64
 *   node desktop/tests/e2e/dxfExport.mjs [appExecutable] [port]
 *
 * 输出：
 *   docs/evidence/dxf-export/screenshots/*.png
 *   docs/evidence/dxf-export/e2e-result.json（serializeEvidence）
 *
 * 依赖：执行 osascript 的会话必须有「辅助功能」权限，否则 System Events 对所有
 * 应用报 0 windows（看起来像对话框打不开）。没有权限时如实记 BLOCKED 并退出 2。
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import DxfParser from 'dxf-parser'
import { serializeEvidence } from '../../../scripts/evidence-json.ts'

const appExecutable =
  process.argv[2] ??
  path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9393)
const EVIDENCE = path.join(process.cwd(), 'docs', 'evidence', 'dxf-export')
const SHOTS = path.join(EVIDENCE, 'screenshots')
const RESULT = path.join(EVIDENCE, 'e2e-result.json')
const DOCUMENTS = path.join(os.homedir(), 'Documents')
const R12_NAME = 'dxf-r12-e2e.dxf'
const V2000_NAME = 'dxf-2000-e2e.dxf'
const APP_PROCESS = '寸链'

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}（先 npm run package:desktop -- --arch=arm64）`)
  process.exit(2)
}

await fsp.mkdir(SHOTS, { recursive: true })
for (const name of [R12_NAME, V2000_NAME]) {
  try {
    await fsp.rm(path.join(DOCUMENTS, name))
  } catch {
    // 目标本来就不存在。
  }
}

const child = spawn(appExecutable, [`--remote-debugging-port=${port}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', (chunk) => (output += chunk.toString()))
child.stderr.on('data', (chunk) => (output += chunk.toString()))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = []
const screenshots = []
function check(id, ok, detail = {}) {
  checks.push({ id, ok, ...detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${JSON.stringify(detail).slice(0, 300)}`)
}

async function findPage() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
  console.error('BLOCKED: 25 秒内没有 page target')
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
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.result?.exceptionDetails) {
    throw new Error(`evaluate failed: ${response.result.exceptionDetails.text}`)
  }
  return response.result?.result?.value
}
async function shot(name) {
  const response = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const file = path.join(SHOTS, `${name}.png`)
  await fsp.writeFile(file, Buffer.from(response.result.data, 'base64'))
  screenshots.push(path.relative(process.cwd(), file))
  return file
}
async function waitFor(predicate, label, timeoutMs = 25000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true
    await sleep(200)
  }
  throw new Error(`TIMEOUT: ${label}`)
}

function osascript(lines) {
  return execFileSync('osascript', lines.flatMap((line) => ['-e', line]), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function processScript(body) {
  return `tell application "System Events" to tell process ${JSON.stringify(APP_PROCESS)} to ${body}`
}

function accessibilityProbe() {
  try {
    const names = osascript([
      'tell application "System Events" to get name of every process whose background only is false',
    ])
    const windows = osascript([processScript('get count of windows')])
    return { available: Number(windows) > 0, detail: `processes=${names}`, windows: Number(windows) }
  } catch (error) {
    return { available: false, detail: String(error.stderr ?? error.message ?? error).slice(0, 300), windows: 0 }
  }
}

function sheetCount() {
  try {
    return Number(osascript([processScript('get count of sheets of window 1')]))
  } catch {
    return 0
  }
}

/** 在“保存为”字段里只填文件名（面板会把斜杠当文件名的一部分，不能填路径）。 */
function fillSaveName(name) {
  const candidates = [
    `tell splitter group 1 of sheet 1 of window 1 to set value of text field "保存为：" to ${JSON.stringify(name)}`,
    `tell sheet 1 of window 1 to set value of text field "保存为：" to ${JSON.stringify(name)}`,
    `tell splitter group 1 of sheet 1 of window 1 to set value of text field 1 to ${JSON.stringify(name)}`,
  ]
  let lastError = null
  for (const script of candidates) {
    try {
      osascript([processScript(script)])
      return { ok: true, script }
    } catch (error) {
      lastError = error
    }
  }
  // 兜底：默认名字是全选状态，直接键入文件名。
  try {
    osascript([processScript('keystroke "a" using {command down}')])
    osascript([processScript(`keystroke ${JSON.stringify(name)}`)])
    return { ok: true, script: 'keystroke' }
  } catch (error) {
    return { ok: false, error: String(lastError?.stderr ?? lastError?.message ?? error).slice(0, 300) }
  }
}

async function clickButton(label) {
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(label)})
    if (!button) return { ok: false, disabled: null }
    if (button.disabled) return { ok: false, disabled: true }
    button.scrollIntoView({ block: 'center' })
    button.click()
    return { ok: true, disabled: false }
  })()`)
  return clicked
}

await send('Runtime.enable')
await send('Page.enable')
await sleep(1500)

// ① 打开内置示例 → 生成图纸
const opened = await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('打开内置示例'))
  if (!button) return false
  button.click()
  return true
})()`)
check('打开内置示例', opened === true)
await waitFor(() => evaluate(`Boolean(document.querySelector('main[aria-label="寸链桌面工作台"]'))`), '工作台出现')
const generated = await clickButton('生成图纸')
check('点击「生成图纸」', generated.ok === true)
await waitFor(
  () => evaluate(`(() => {
    const value = document.querySelector('[data-drawing-fingerprint]')?.getAttribute('data-drawing-fingerprint')
    return typeof value === 'string' && value.length === 64
  })()`),
  '图纸指纹出现',
)
await evaluate(`(() => {
  const panel = document.querySelector('.spacer-drawing')
  if (panel) panel.scrollIntoView({ block: 'start' })
  return true
})()`)
await sleep(500)
const buttons = await evaluate(`[...document.querySelectorAll('.spacer-drawing__actions button')].map((item) => ({ text: item.textContent.trim(), disabled: item.disabled }))`)
check('DXF 按钮可见', Array.isArray(buttons) && buttons.some((item) => item.text === '导出 DXF（R12）') && buttons.some((item) => item.text === '导出 DXF（2000）'), { buttons })
await shot('dxf-01-buttons')

const probe = accessibilityProbe()
check('辅助功能权限探测', probe.available, probe)

let r12Result = { status: 'NOT_RUN' }
if (!probe.available) {
  // 没有辅助功能权限时仍然点一次按钮，证明打包产物真的走到系统保存对话框：
  // 按钮进入 busy（IPC 正在等待 dialog.showSaveDialog），随后应用被 SIGKILL（不产生文件）。
  const clickedR12 = await clickButton('导出 DXF（R12）')
  await sleep(2000)
  const pending = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.spacer-drawing__actions button')].find((item) => item.textContent.trim() === '导出 DXF（R12）')
    return {
      buttons: [...document.querySelectorAll('.spacer-drawing__actions button')].map((item) => ({ text: item.textContent.trim(), disabled: item.disabled })),
      notice: document.querySelector('.spacer-drawing__notice')?.textContent ?? '',
      error: document.querySelector('.spacer-drawing__error')?.textContent ?? '',
    }
  })()`)
  await shot('dxf-02-dialog-pending-no-ax')
  r12Result = {
    status: 'BLOCKED',
    reason: 'no-accessibility-permission',
    probe,
    clicked: clickedR12,
    rendererStateWhileDialogOpen: pending,
    fileOnDisk: existsSync(path.join(DOCUMENTS, R12_NAME)),
  }
  check('点击「导出 DXF（R12）」后进入系统保存对话框（IPC 挂起）', clickedR12.ok === true && pending.buttons.every((item) => item.disabled), r12Result)
} else {
  osascript([`tell application ${JSON.stringify(APP_PROCESS)} to activate`])
  const clickedR12 = await clickButton('导出 DXF（R12）')
  check('点击「导出 DXF（R12）」', clickedR12.ok === true, clickedR12)
  let sheet = 0
  await waitFor(() => {
    sheet = sheetCount()
    return sheet === 1
  }, '保存对话框出现', 15000)
  await shot('dxf-02-save-dialog')
  const filled = fillSaveName(R12_NAME)
  check('填写文件名（只填文件名，不填路径）', filled.ok === true, filled)
  await sleep(400)
  osascript([processScript('key code 36')])
  await waitFor(() => sheetCount() === 0, '保存对话框关闭', 15000)
  const notice = await waitFor(
    async () => {
      const text = await evaluate(`document.querySelector('.spacer-drawing__notice')?.textContent ?? ''`)
      return text.includes('已导出') ? text : false
    },
    '导出回执',
    20000,
  )
  const targetPath = path.join(DOCUMENTS, R12_NAME)
  const exists = existsSync(targetPath)
  const bytes = exists ? new Uint8Array(await fsp.readFile(targetPath)) : new Uint8Array()
  const sha = createHash('sha256').update(bytes).digest('hex')
  const parsed = exists ? new DxfParser().parseSync(new TextDecoder('gbk').decode(bytes)) : null
  const fileNameShown = notice.includes(R12_NAME)
  const sizeShown = notice.includes(`${bytes.byteLength} 字节`)
  const shaShown = notice.includes(sha.slice(0, 12))
  const acad = parsed ? new TextDecoder('gbk').decode(bytes).includes('$ACADVER\r\n1\r\nAC1009') : false
  check('R12 文件落盘', exists, { path: targetPath, byteSize: bytes.byteLength, sha256: sha })
  check('回执与磁盘一致（文件名/字节数/SHA-256）', fileNameShown && sizeShown && shaShown, { notice, fileNameShown, sizeShown, shaShown })
  check('dxf-parser 读回 R12', parsed !== null && acad, { entities: parsed?.entities.length ?? 0, acad })
  await shot('dxf-03-r12-exported')
  r12Result = {
    status: exists ? 'EXPORTED' : 'MISSING_FILE',
    file: `${R12_NAME}（Documents）`,
    byteSize: bytes.byteLength,
    sha256: sha,
    receipt: notice,
    entities: parsed?.entities.length ?? 0,
  }
  try {
    await fsp.rm(targetPath)
  } catch {
    // 证据目录里已记录哈希；Documents 里的临时产物删除失败不影响结论。
  }
}

// ③ 取消路径：2000 版 → Esc
let cancelResult = { status: 'NOT_RUN' }
if (!probe.available) {
  cancelResult = { status: 'BLOCKED', reason: 'no-accessibility-permission' }
  check('打包应用导出 2000 并取消', false, { blocked: true })
} else {
  osascript([`tell application ${JSON.stringify(APP_PROCESS)} to activate`])
  const clicked2000 = await clickButton('导出 DXF（2000）')
  check('点击「导出 DXF（2000）」', clicked2000.ok === true, clicked2000)
  await waitFor(() => sheetCount() === 1, '保存对话框出现（2000）', 15000)
  osascript([processScript('key code 53')])
  await waitFor(() => sheetCount() === 0, '保存对话框关闭（Esc）', 15000)
  const errorText = await waitFor(
    async () => {
      const text = await evaluate(`document.querySelector('.spacer-drawing__error')?.textContent ?? ''`)
      return text.includes('CANCELLED') ? text : false
    },
    '取消回执',
    15000,
  )
  const leftover = existsSync(path.join(DOCUMENTS, V2000_NAME))
  check('取消返回 CANCELLED 且无文件', errorText.includes('CANCELLED') && leftover === false, { errorText, leftover })
  await shot('dxf-04-cancelled')
  cancelResult = { status: 'CANCELLED', receipt: errorText, fileExists: leftover }
}

const blocked = checks.some((item) => item.blocked === true)
const failed = checks.filter((item) => item.ok === false && item.blocked !== true)
await fsp.writeFile(
  RESULT,
  serializeEvidence({
    schema: 'dxf-export-e2e-v1',
    app: path.relative(process.cwd(), appExecutable),
    port,
    checks,
    r12: r12Result,
    dxf2000: cancelResult,
    screenshots,
    blocked,
    note: blocked
      ? '系统保存对话框需要辅助功能权限；本会话探测失败，未自动点击，原因写在此处而不是谎称通过。'
      : 'R12 保存与 2000 取消均由 System Events 真实驱动系统对话框。',
  }),
)
console.log(JSON.stringify({ blocked, failed: failed.map((item) => item.id), checks: checks.length, screenshots }))

try {
  socket.close()
} catch {
  // 窗口可能已关闭
}
child.kill('SIGKILL')

if (blocked) process.exit(2)
process.exit(failed.length === 0 ? 0 : 1)
