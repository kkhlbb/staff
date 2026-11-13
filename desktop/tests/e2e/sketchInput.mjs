#!/usr/bin/env node
/**
 * 手绘草图入口：打包应用 UI 证据。
 *
 * 打开服务证据真实产出的 pending / committed 容器（不是重画）：
 * 1) 草图读数页：图片 + 已提交框选位置（只读回显）+ 红线文案；
 * 2) 真实鼠标在画布上拖框（CDP 输入），界面显示换算后的原图像素 rect；
 * 3) 任务书提取页：读数未核对（来源：图片，第 N 个框选）；
 * 4) 工程图页：标题栏来源是图片。
 *
 * 合成夹具，非真实手绘照片。不做 OCR、不做图像识别、不按像素量取。
 * node desktop/tests/e2e/sketchInput.mjs [appExecutable] [port]
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { serializeEvidence } from '../../../scripts/evidence-json.ts'

const root = process.cwd()
const out = path.join(root, 'docs/evidence/sketch-input')
const shots = path.join(out, 'screenshots')
const executable = path.resolve(process.argv[2] ?? 'out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链')
const bundle = path.resolve(path.dirname(executable), '../..')
const port = Number(process.argv[3] ?? 9428)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const exec = promisify(execFile)
const results = { verdict: 'fail', checks: [], screenshots: [],
  scope: 'Packaged UI opens real service-evidence containers; no DOM injection, no synthetic overlay.',
  limitation: '合成夹具，非真实手绘照片。未做 OCR、未做比例标定；HEIC 不支持（main 明确拒绝）。' }
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
async function launch(file) {
  let occupied = false
  try { await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) }); occupied = true } catch { /* free */ }
  assert(!occupied, `BLOCKED: debug port ${port} already occupied`)
  const scratch = path.join(os.homedir(), '.hermes/profiles/daedalus/cache/scratch')
  await fs.mkdir(scratch, { recursive: true })
  const runtime = await fs.mkdtemp(path.join(scratch, 'sketch-input-ui-'))
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
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer); pending.delete(message.id)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
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
async function clickTab(name) {
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find(n => (n.textContent ?? '').includes(${JSON.stringify(name)}))
    if (!tab) throw new Error('tab missing: ' + ${JSON.stringify(name)})
    tab.click(); return true
  })()`)
  await sleep(500)
}
async function scrollTo(expression) {
  return evaluate(`(() => {
    const target = ${expression}
    if (!target) throw new Error('scroll target missing')
    target.scrollIntoView({ block: 'center' })
    let node = target.parentElement
    while (node) {
      if (node.scrollHeight > node.clientHeight + 4) {
        const targetRect = target.getBoundingClientRect()
        const nodeRect = node.getBoundingClientRect()
        node.scrollTop += targetRect.top - nodeRect.top - 120
      }
      node = node.parentElement
    }
    return target.getBoundingClientRect().toJSON()
  })()`)
}
async function dragOnStage(startRatio, endRatio) {
  const box = await evaluate(`(() => {
    const stage = document.querySelector('.sketch-panel__stage')
    if (!stage) throw new Error('stage missing')
    const r = stage.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })()`)
  const at = (ratio) => ({ x: box.x + box.width * ratio[0], y: box.y + box.height * ratio[1] })
  const start = at(startRatio)
  const end = at(endRatio)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: end.x, y: end.y, button: 'left' })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 })
  await sleep(400)
}
try {
  await fs.access(executable)
  const service = JSON.parse(await fs.readFile(path.join(out, 'service-result.json'), 'utf8'))
  assert.equal(service.verdict, 'pass', 'Service evidence must pass before packaged screenshots')
  await fs.mkdir(shots, { recursive: true })

  // 1) pending 容器：框选界面 + 未核对标记 + 真实拖框。
  await launch(path.join(out, 'pending.cunlian'))
  await clickTab('草图读数')
  await wait(() => evaluate(`Boolean(document.querySelector('.sketch-panel__stage canvas'))`), 'sketch canvas')
  await wait(() => evaluate(`document.querySelectorAll('.sketch-panel__box--saved').length === 3`), 'three saved boxes')
  const notice = await evaluate(`document.querySelector('.sketch-panel__notice')?.textContent ?? ''`)
  assert.match(notice, /图上不测量，尺寸由你输入；框选只用来记住位置/u)
  const savedLabels = await evaluate(`[...document.querySelectorAll('.sketch-panel__box--saved span')].map(n => n.textContent ?? '')`)
  assert.deepEqual(savedLabels.sort(), ['第 1 个框选 · L1', '第 2 个框选 · L2', '第 3 个框选 · L3'])
  await shot('01-sketch-selection')
  results.checks.push({ id: 'sketch-selection-visible', notice, savedLabels })

  // 真实鼠标拖框：显示换算后的原图像素 rect。
  await dragOnStage([0.35, 0.62], [0.48, 0.72])
  await wait(() => evaluate(`document.querySelector('[aria-label="框选结果"]')?.textContent?.includes('原图像素框') ?? false`), 'drag result text')
  const dragText = await evaluate(`document.querySelector('[aria-label="框选结果"]')?.textContent ?? ''`)
  assert.match(dragText, /原图像素框 \[\d+, \d+, \d+, \d+\]/u)
  await shot('02-drag-box-pixel-rect')
  results.checks.push({ id: 'real-drag-box', text: dragText })

  await clickTab('任务书提取')
  await wait(() => evaluate(`document.body.innerText.includes('读数未核对')`), 'unverified reading badge')
  const badge = await evaluate(`document.body.innerText`)
  assert.match(badge, /读数未核对（来源：图片，第 \d 个框选/u)
  // 滚动到实际标记处，截图必须能直接读到，而不是只在 DOM innerText 里。
  await evaluate(`(() => {
    const node = [...document.querySelectorAll('body *')]
      .filter(n => n.children.length === 0 && (n.textContent ?? '').includes('读数未核对')).pop()
    if (!node) throw new Error('badge not rendered')
    node.scrollIntoView({ block: 'center' }); return true
  })()`)
  await sleep(300)
  await shot('03-unverified-readings')
  results.checks.push({ id: 'unverified-badge-visible', sample: badge.match(/读数未核对（来源：图片，第 \d 个框选[^）]*）/u)?.[0] ?? null })
  await close()

  // 2) committed 容器：工程图标题栏来源。
  await launch(path.join(out, 'committed.cunlian'))
  await clickTab('工程图')
  await wait(() => evaluate(`Boolean(document.querySelector('.desktop-workspace svg'))`), 'committed drawing')
  const svgText = await evaluate(`document.querySelector('.desktop-workspace svg')?.textContent ?? ''`)
  assert.match(svgText, /读数来源：图片/u)
  assert.match(svgText, /第\s*\d\s*个框选/u)
  const drawingRect = await scrollTo(`document.querySelector('.desktop-workspace svg')`)
  await sleep(400)
  await shot('04-drawing-tab')
  results.checks.push({ id: 'committed-drawing-source-visible',
    sample: svgText.match(/读数来源：[^<]{0,80}/u)?.[0] ?? null,
    drawingRect: { x: Math.round(drawingRect.x), y: Math.round(drawingRect.y),
      width: Math.round(drawingRect.width), height: Math.round(drawingRect.height) },
    note: '此视口下工程图画布被上方表单压扁（既有布局），标题栏放大证据见 06：同一份真实导出 SVG 的渲染。' })

  await clickTab('草图读数')
  await wait(() => evaluate(`document.querySelectorAll('.sketch-panel__box--saved').length === 3`), 'committed saved boxes')
  await shot('05-committed-selection')

  // 06：真实导出 SVG（服务证据产物）在内存里渲染成图片，截标题栏来源。
  const svgFile = path.join(out, '隔套-图纸-1_1.svg')
  const svgSource = await fs.readFile(svgFile, 'utf8')
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(
    `<!doctype html><html><body style="margin:0;background:#fff">` +
    `<img id="sheet" style="width:1440px;display:block" src="data:image/svg+xml;base64,${Buffer.from(svgSource).toString('base64')}">` +
    `</body></html>`)
  await send('Page.navigate', { url: dataUrl })
  await wait(() => evaluate(`(() => { const img = document.getElementById('sheet'); return Boolean(img && img.complete && img.naturalWidth > 0) })()`), 'svg rendered')
  await sleep(600)
  await shot('06-exported-svg-title-block')
  results.checks.push({ id: 'exported-svg-title-block',
    source: 'docs/evidence/sketch-input/隔套-图纸-1_1.svg',
    note: '真实导出物渲染；不是重画，也不是 OCR。' })
  results.verdict = 'pass'
} catch (error) {
  results.error = error instanceof Error ? error.message : String(error)
  if (socket) try { await shot('99-failure') } catch { /* keep original failure */ }
  process.exitCode = 1
} finally {
  await close()
  await fs.mkdir(out, { recursive: true })
  await fs.writeFile(path.join(out, 'ui-result.json'), serializeEvidence(results))
  console.log(JSON.stringify({ verdict: results.verdict, error: results.error, screenshots: results.screenshots }))
}
