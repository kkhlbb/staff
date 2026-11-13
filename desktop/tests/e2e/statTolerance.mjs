#!/usr/bin/env node
/**
 * 统计公差界面证据：打包应用里三法并列 + 假设文案。
 *
 * 打开真实容器（docs/evidence/ingest-readings/committed.cunlian 的临时拷贝），
 * 切“尺寸链”页 → 按正式链重算草稿 → 用真实键入把链改成判据组 S=12.05 的三环变体
 * （C = L3 − L1 − L2 = 32.2 − 20 − 12.05 = 0.15 mm，目标 0.10..0.30）。
 *
 * 截图就是打包应用真实渲染：极值法（判定依据）在前，RSS 与蒙特卡洛并列，
 * 交叉验证给出具体偏差百分比，固定文案写清三法假设差异。不做 DOM 注入。
 *
 * node desktop/tests/e2e/statTolerance.mjs [appExecutable] [port]
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { serializeEvidence } from '../../../scripts/evidence-json.ts'

const root = process.cwd()
const out = path.join(root, 'docs/evidence/stat-tolerance')
const shots = path.join(out, 'screenshots')
const executable = path.resolve(process.argv[2] ?? 'out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链')
const bundle = path.resolve(path.dirname(executable), '../..')
const port = Number(process.argv[3] ?? 9431)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const exec = promisify(execFile)
const results = {
  verdict: 'fail',
  checks: [],
  screenshots: [],
  scope: 'Packaged app, real container copy, real typing only (no DOM injection).',
  limitation:
    '桌面版增删环未接入，界面用正式链的三环变体（L3/L1/L2）演示；A 节数值表用的四环链（H/B1/S/B2）由证据脚本证明。',
}
let socket
let ownedPid
let counter = 0
const pending = new Map()

function send(method, params = {}) {
  const id = ++counter
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text)
  return value.result?.value
}
const log = message => console.error(`[step] ${message}`)
async function wait(predicate, label, ms = 30000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(180) }
  throw new Error(`TIMEOUT: ${label}`)
}
async function shot(name, clip) {
  const result = await send('Page.captureScreenshot', clip === undefined
    ? { format: 'png', fromSurface: true }
    : { format: 'png', fromSurface: true, captureBeyondViewport: true, clip })
  const file = path.join(shots, `${name}.png`)
  await fs.writeFile(file, Buffer.from(result.data, 'base64'))
  results.screenshots.push(path.relative(root, file))
}
async function clickTab(name) {
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find(n => (n.textContent ?? '').includes(${JSON.stringify(name)}))
    if (!tab) throw new Error('tab missing: ' + ${JSON.stringify(name)})
    tab.click(); return true
  })()`)
  await sleep(500)
}
/** 真实鼠标点击 + 真实键入（替换受控输入的值，触发 React onChange）。 */
async function typeInto(resolveSelector, value) {
  const point = await evaluate(`(() => {
    const input = (${resolveSelector})
    if (!input) throw new Error('input missing')
    const r = input.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) throw new Error('input not visible')
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  await evaluate(`document.activeElement?.select?.()`)
  await send('Input.insertText', { text: value })
  await sleep(220)
}
async function launch(file) {
  let occupied = false
  try { await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) }); occupied = true } catch { /* free */ }
  assert(!occupied, `BLOCKED: debug port ${port} already occupied`)
  const scratch = path.join(os.homedir(), '.hermes/profiles/daedalus/cache/scratch')
  await fs.mkdir(scratch, { recursive: true })
  const runtime = await fs.mkdtemp(path.join(scratch, 'stat-tolerance-ui-'))
  const work = path.join(runtime, path.basename(file))
  await fs.copyFile(file, work)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  await exec('open', ['-n', '-a', bundle, '--args', `--user-data-dir=${path.join(runtime, 'profile')}`, `--remote-debugging-port=${port}`], { env })
  let target
  await wait(async () => {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = list.find(t => t.type === 'page' && !t.url.startsWith('devtools:'))
      return Boolean(target)
    } catch { return false }
  }, 'isolated packaged app debug target')
  const pid = Number((await exec('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'])).stdout.trim())
  const command = (await exec('ps', ['-p', String(pid), '-o', 'command='])).stdout
  assert(command.includes(`--user-data-dir=${path.join(runtime, 'profile')}`), 'Refuse unrelated app process')
  ownedPid = pid
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Page.javascriptDialogOpening') {
      // “按正式重算”会弹原生 confirm；本会话没有 AX 权限，用 CDP 接受，
      // 否则原生对话框会阻塞渲染进程，后续 evaluate 全部超时。
      void send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
      return
    }
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer); pending.delete(message.id)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false })
  await sleep(1200)
  await exec('open', ['-a', bundle, work], { env })
  await wait(() => evaluate(`Boolean(document.querySelector('main[aria-label="寸链桌面工作台"]'))`), 'opened product container')
}
async function close() {
  if (!socket) return
  try { await send('Browser.close') } catch { /* browser may close before reply */ }
  socket.close(); socket = null
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Browser closed')) }
  pending.clear()
  await sleep(1200)
  if (ownedPid) { try { process.kill(ownedPid, 'SIGKILL') } catch { /* already exited */ } ownedPid = undefined }
}

try {
  await fs.access(executable)
  await fs.mkdir(shots, { recursive: true })
  await launch(path.join(root, 'docs/evidence/ingest-readings/committed.cunlian'))
  log('launched')
  await clickTab('尺寸链')
  log('tab clicked')
  await wait(() => evaluate(`Boolean(document.querySelector('[data-testid="statistical-reference"]'))`), 'statistical reference panel')
  log('panel visible')

  // 草稿与正式链不一致时，先“按正式重算”换成项目正式链（L3/L1/L2 三环）。
  const recalc = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(n => (n.textContent ?? '').trim() === '按正式重算')
    if (!button) return false
    button.click(); return true
  })()`)
  if (recalc) await sleep(700)
  results.checks.push({ id: 'draft-recalculated-to-official-chain', ok: recalc })

  // 判据组 S=12.05 的三环变体：L3 32.2(+0.02/-0.02)，L1 20(-0.01/+0.01)，L2 12.05(-0.01/+0.01)。
  const rows = ['L3', 'L1', 'L2']
  const values = [['32.2000', '-0.0200', '0.0200'], ['20.0000', '-0.0100', '0.0100'], ['12.0500', '-0.0100', '0.0100']]
  for (let index = 0; index < rows.length; index += 1) {
    const labels = ['基本尺寸', '下偏差', '上偏差']
    for (let field = 0; field < 3; field += 1) {
      const aria = `第 ${index + 1} 行 ${rows[index]} ${labels[field]}`
      await typeInto(
        `[...document.querySelectorAll('input')].find(n => n.getAttribute('aria-label') === ${JSON.stringify(aria)})`,
        values[index][field],
      )
    }
  }
  await typeInto(
    `(() => {
      const labels = [...document.querySelectorAll('.desktop-workspace__target label')]
      const label = labels.find(n => (n.textContent ?? '').includes('目标下限'))
      return label?.querySelector('input') ?? null
    })()`,
    '0.1000',
  )
  await typeInto(
    `(() => {
      const labels = [...document.querySelectorAll('.desktop-workspace__target label')]
      const label = labels.find(n => (n.textContent ?? '').includes('目标上限'))
      return label?.querySelector('input') ?? null
    })()`,
    '0.3000',
  )
  await sleep(600)

  const observed = await evaluate(`(() => {
    const panel = document.querySelector('[data-testid="statistical-reference"]')
    const order = ['stat-extreme', 'stat-rss', 'stat-monte-carlo'].map(id => {
      const el = panel.querySelector('[data-testid="' + id + '"]')
      return el ? el.textContent : null
    })
    const extremeFirst = (() => {
      const a = panel.querySelector('[data-testid="stat-extreme"]')
      const b = panel.querySelector('[data-testid="stat-rss"]')
      return Boolean(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING))
    })()
    const resultBlock = [...document.querySelectorAll('section[aria-label="当前计算结果"]')][0]
    return {
      order,
      extremeFirst,
      crossCheck: panel.querySelector('[data-testid="stat-cross-check"]')?.textContent ?? '',
      assumption: panel.querySelector('[data-testid="stat-assumption"]')?.textContent ?? '',
      monteCarlo: panel.querySelector('[data-testid="stat-monte-carlo"]')?.textContent ?? '',
      resultText: resultBlock?.textContent ?? '',
      termInputs: [...document.querySelectorAll('input[aria-label*="行 "]')].map(n => [n.getAttribute('aria-label'), n.value]),
      targetInputs: [...document.querySelectorAll('.desktop-workspace__target input')].map(n => n.value),
    }
  })()`)

  // 数值必须真的落到界面与统计里（不是 0.0000 的占位）。
  log(`result=${JSON.stringify(observed.resultText)}`)
  log(`extreme=${JSON.stringify(observed.order[0])}`)
  assert.equal(observed.extremeFirst, true, '极值法必须排在 RSS 之前')
  for (const text of observed.order) assert.ok(text && text.length > 0, '每行方法都必须渲染')
  assert.equal(observed.order[0].includes('判定依据'), true, '极值行必须标“判定依据”')
  assert.match(observed.order[0], /0\.1100 mm ~ 0\.1900 mm/u)
  assert.match(observed.resultText, /0\.150 mm/u, '封闭环基本尺寸应为 0.150 mm')
  assert.match(observed.resultText, /满足目标/u)
  assert.match(observed.monteCarlo, /种子 20261113/u)
  assert.match(observed.monteCarlo, /100,000 样本/u)
  assert.match(observed.crossCheck, /相对偏差/u)
  assert.match(observed.crossCheck, /\d+\.\d{2}%/u)
  assert.match(observed.assumption, /仍是条款判定的唯一依据/u)
  assert.match(observed.assumption, /不代表装配更容易合格/u)
  assert.match(observed.resultText, /极值范围/u, '极值法结果不得被隐藏')
  results.checks.push({ id: 'three-methods-visible', observed })

  // 滚动到统计参考，截整页（三法并列 + 判定结果同屏）。
  await evaluate(`(() => {
    const panel = document.querySelector('[data-testid="statistical-reference"]')
    panel.scrollIntoView({ block: 'center' })
    let node = panel.parentElement
    while (node) {
      if (node.scrollHeight > node.clientHeight + 4) {
        const targetRect = panel.getBoundingClientRect()
        const nodeRect = node.getBoundingClientRect()
        node.scrollTop += targetRect.top - nodeRect.top - 220
      }
      node = node.parentElement
    }
    return true
  })()`)
  await sleep(400)
  await shot('01-three-methods')

  // 统计参考区域：贴顶裁切。
  await evaluate(`(() => {
    const panel = document.querySelector('[data-testid="statistical-reference"]')
    panel.scrollIntoView({ block: 'start' })
    return true
  })()`)
  await sleep(400)
  const clip = await evaluate(`(() => {
    const panel = document.querySelector('[data-testid="statistical-reference"]')
    const r = panel.getBoundingClientRect()
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, innerHeight - Math.max(0, r.y)), scale: 1 }
  })()`)
  await shot('02-stat-reference', clip)

  results.verdict = 'pass'
  results.note =
    '截图来自打包应用真实渲染：先用“按正式重算”换成项目正式链，再用真实键入改成判据组 S=12.05 的三环变体（C₀=0.1500 mm）。' +
    '极值法（判定依据）在 RSS / 蒙特卡洛之前，交叉验证与假设文案同屏。'
  await fs.writeFile(path.join(out, 'ui-result.json'), serializeEvidence(results))
  console.log('UI_RESULT', JSON.stringify({ verdict: results.verdict, screenshots: results.screenshots }))
} catch (error) {
  results.error = String(error?.stack ?? error)
  await fs.writeFile(path.join(out, 'ui-result.json'), serializeEvidence(results))
  console.error('UI_RESULT_FAIL', results.error)
  process.exitCode = 1
} finally {
  await close()
}
