#!/usr/bin/env node
/** Real packaged Electron + isolated copy of a committed project. No DOM content injection.
 * node desktop/tests/e2e/layout.mjs [appExecutable] [port]
 * LAYOUT_RESULT_NAME labels isolated mutation runs; LAYOUT_ONLY_960=1 limits mutations.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { serializeEvidence } from '../../../scripts/evidence-json.ts'
import { LAYOUT_BUDGETS, layoutBudgetForWidth } from '../../../src/components/layout/budgets.ts'

const exec = promisify(execFile)
const root = process.cwd()
const out = path.join(root, 'docs/evidence/ui-layout')
const name = process.env.LAYOUT_RESULT_NAME ?? 'layout'
const executable = path.resolve(process.argv[2] ?? 'out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链')
const bundle = path.resolve(path.dirname(executable), '../..')
const port = Number(process.argv[3] ?? 9429)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let socket, ownedPid
let counter = 0
const pending = new Map()
const results = { verdict: 'fail', checks: [], screenshots: [] }
function send(method, params = {}) {
  const id = ++counter
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result?.value
}
async function wait(predicate, label) {
  for (let n = 0; n < 160; n++) { if (await predicate()) return; await sleep(200) }
  throw new Error(`TIMEOUT: ${label}`)
}
async function click(selector, text) {
  const point = await evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(n => n.textContent.trim() === ${JSON.stringify(text)})
    if (!el || el.disabled) throw Error('Missing/enabled button: '+${JSON.stringify(text)})
    const b = el.getBoundingClientRect(); const x = b.x+b.width/2, y = b.y+b.height/2
    if (b.x<0 || b.y<0 || b.right>innerWidth || b.bottom>innerHeight || !el.contains(document.elementFromPoint(x,y))) throw Error('Not clickable in viewport: '+${JSON.stringify(text)}+' rect='+JSON.stringify(b.toJSON())+' hit='+document.elementFromPoint(x,y)?.outerHTML.slice(0,400))
    return {x,y}
  })()`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  await sleep(250)
}
try {
  await fs.mkdir(out, { recursive: true }); await fs.access(executable)
  let occupied = false
  try { await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) }); occupied = true } catch { /* free */ }
  assert(!occupied, 'Refuse occupied debug port')
  const runtime = await fs.mkdtemp(path.join(os.homedir(), '.hermes/profiles/daedalus/cache/scratch/ui-layout-'))
  const work = path.join(runtime, 'layout.cunlian')
  await fs.copyFile(path.join(root, 'docs/evidence/ingest-readings/committed.cunlian'), work)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  await exec('open', ['-n', '-a', bundle, '--args', `--user-data-dir=${path.join(runtime, 'profile')}`, `--remote-debugging-port=${port}`], { env })
  let target
  await wait(async () => {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); return Boolean(target) } catch { return false }
  }, 'packaged app')
  const pid = Number((await exec('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'])).stdout.trim())
  assert((await exec('ps', ['-p', String(pid), '-o', 'command='])).stdout.includes(`--user-data-dir=${path.join(runtime, 'profile')}`))
  ownedPid = pid
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => {
    const m = JSON.parse(event.data), req = pending.get(m.id)
    if (!req) return
    clearTimeout(req.timer); pending.delete(m.id)
    if (m.error) req.reject(new Error(JSON.stringify(m.error))); else req.resolve(m.result)
  })
  await send('Page.enable')
  // First viewport is set before opening the product: exercise real default collapsed state.
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 1, mobile: false })
  await exec('open', ['-a', bundle, work], { env })
  await wait(() => evaluate(`Boolean(document.querySelector('.desktop-workspace__center'))`), 'project workspace')
  const viewports = [...LAYOUT_BUDGETS, ...[1025, 1123, 1124, 1399, 1400].map(width => ({ ...layoutBudgetForWidth(width), width, height: 800 }))]
  for (const b of viewports.filter(b => !process.env.LAYOUT_ONLY_960 || b.width === 960)) {
    await send('Emulation.setDeviceMetricsOverride', { width: b.width, height: b.height, deviceScaleFactor: 1, mobile: false })
    await sleep(600)
    // Every actual tab is measured, including extraction/history/tables; no content hidden for the test.
    for (const tab of ['工程图', '3D', '来源 PDF', '尺寸链', '历史报告', '任务书提取']) {
      await click('[role="tab"]', tab)
      const observed = await evaluate(`(() => {
        const rect = s => { const r=document.querySelector(s).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom} }
        const center=document.querySelector('.desktop-workspace__center')
        return { viewport:[innerWidth,innerHeight], scrollWidth:document.documentElement.scrollWidth, clientWidth:document.documentElement.clientWidth,
          pageHeight:document.documentElement.scrollHeight, centerMin:parseFloat(getComputedStyle(center).minWidth),
          center:rect('.desktop-workspace__center'), sidebar:rect('#desktop-properties'), tree:rect('#desktop-tree'), bottom:rect('.desktop-workspace__review'),
          collapsed:document.querySelector('.desktop-workspace__review-toggle').getAttribute('aria-expanded') === 'false',
          bottomToken:parseFloat(getComputedStyle(document.documentElement).getPropertyValue(document.querySelector('.desktop-workspace__review-toggle').getAttribute('aria-expanded') === 'false' ? '--panel-bottom-collapsed-h' : '--panel-bottom-h')) }
      })()`)
      console.log(JSON.stringify({ viewport: b.width, tab, ...observed }))
      assert(observed.scrollWidth <= observed.clientWidth, `horizontal overflow at ${b.width}: ${observed.scrollWidth} > ${observed.clientWidth}`)
      assert(observed.center.width >= b.centerMin, `central width ${observed.center.width} < ${b.centerMin}`)
      assert(observed.centerMin >= b.centerMin, `central min-width contract missing: ${observed.centerMin} < ${b.centerMin}`)
      assert.equal(observed.sidebar.width, b.sidebar, 'sidebar budget')
      assert.equal(observed.collapsed, b.collapsed, 'bottom default collapse')
      assert.equal(observed.bottomToken, b.bottom, 'bottom token')
      assert.equal(observed.bottom.height, b.bottom, 'bottom rendered height')
      assert(observed.pageHeight <= b.height, 'page must not scroll vertically')
      for (const r of [observed.tree, observed.center, observed.sidebar, observed.bottom]) {
        assert(r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.right <= b.width && r.bottom <= b.height, 'container outside viewport')
      }
      results.checks.push({ width: b.width, tab, observed })
    }
    const splitPoint = await evaluate(`(() => { const r=document.querySelector('[aria-label="项目树宽度"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
    const treeDelta = await evaluate(`Math.max(0, Math.min(16, Number(document.querySelector('[aria-label="项目树宽度"]').getAttribute('aria-valuemax')) - 232))`)
    for (const dx of [treeDelta, -treeDelta]) {
      const p = { x: splitPoint.x + (dx < 0 ? treeDelta : 0), y: splitPoint.y }
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + dx, y: p.y, button: 'left', buttons: 1 })
      await wait(() => evaluate(`document.querySelector('#desktop-tree').getBoundingClientRect().width === ${dx > 0 ? 232 + treeDelta : 232}`), 'tree drag rendered while pointer held')
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x + dx, y: p.y, button: 'left', clickCount: 1 })
      await sleep(150)
      const width = await evaluate(`document.querySelector('#desktop-tree').getBoundingClientRect().width`)
      assert.equal(width, dx > 0 ? 232 + treeDelta : 232, 'real pointer split changes track width')
      assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'drag must not overflow')
    }
    if (!b.collapsed) {
      const bottomPoint = await evaluate(`(() => { const el=document.querySelector('[aria-label="复核区高度"]'); const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,value:Number(el.getAttribute('aria-valuenow'))} })()`)
      assert.equal(bottomPoint.value, b.bottom, 'bottom splitter starts at actual height')
      for (const dy of [-8, 8]) {
        const p = { x: bottomPoint.x, y: bottomPoint.y + (dy > 0 ? -8 : 0) }
        console.log('BOTTOM_DRAG', JSON.stringify({ viewport:b.width, dy, p, hit:await evaluate(`document.elementFromPoint(${p.x},${p.y})?.outerHTML.slice(0,500)`) }))
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p })
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 })
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y + dy, button: 'left', buttons: 1 })
        await wait(() => evaluate(`document.querySelector('.desktop-workspace__review').getBoundingClientRect().height === ${b.bottom + (dy < 0 ? 8 : 0)}`), 'bottom drag rendered while pointer held')
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y + dy, button: 'left', clickCount: 1 })
        await sleep(150)
        const height = await evaluate(`document.querySelector('.desktop-workspace__review').getBoundingClientRect().height`)
        assert.equal(height, b.bottom + (dy < 0 ? 8 : 0), 'bottom pointer drag has no initial jump')
      }
    }
    results.checks.push({ width: b.width, pointerSplit: [232, 232 + treeDelta, 232], bottomDragNoJump: b.collapsed ? 'not-applicable-collapsed' : true })
    await click('[role="tab"]', '工程图')
    await click('button', '导出 PDF ▾')
    assert(await evaluate(`Boolean(document.querySelector('#desktop-export'))`), 'real export menu opens')
    await click('button', '导出 PDF ▾')
    const before = await evaluate('window.cunlian.reattachSession()')
    assert.equal(before.ok, true)
    // Real UI draft -> preview -> submission on an isolated project copy, never bypass business gates.
    for (const text of ['建立/更新草稿', '预览变更', '确认提交（一次原子写入）']) {
      await wait(() => evaluate(`(() => { const el=[...document.querySelectorAll('.change-workbench button')].find(n=>n.textContent.trim()===${JSON.stringify(text)}); return Boolean(el && !el.disabled) })()`), `enabled ${text}`)
      await evaluate(`(() => { [...document.querySelectorAll('.change-workbench button')].find(n=>n.textContent.trim()===${JSON.stringify(text)}).scrollIntoView({block:'nearest',inline:'nearest'}); return true })()`)
      if (text.startsWith('确认提交')) {
        const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
        const file = `${name}-${b.width}x${b.height}.png`
        await fs.writeFile(path.join(out, file), Buffer.from(shot.data, 'base64')); results.screenshots.push(file)
      }
      await click('.change-workbench button', text)
    }
    const submit = await evaluate(`(() => { const el=[...document.querySelectorAll('.change-workbench button')].find(n => n.textContent.trim()==='确认提交（一次原子写入）'); const r=el.getBoundingClientRect();return {text:el.textContent,x:r.x,y:r.y,right:r.right,bottom:r.bottom} })()`)
    assert(submit.x >= 0 && submit.y >= 0 && submit.right <= b.width && submit.bottom <= b.height, 'submit bounds')
    await wait(async () => { const r = await evaluate('window.cunlian.reattachSession()'); return r.ok && r.value.snapshot.project.currentRevisionId !== before.value.snapshot.project.currentRevisionId }, 'submitted revision readback')
    const state = await evaluate('window.cunlian.reattachSession()')
    assert.equal(state.ok, true)
    results.checks.push({ width: b.width, exportClicked: true, submitClicked: true, submit, revisionId: state.value.snapshot.project.currentRevisionId })
  }
  results.verdict = 'pass'
} catch (error) {
  results.error = error.stack ?? String(error); console.error(results.error); process.exitCode = 1
  if (socket) { try { const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }); await fs.writeFile(path.join(out, `${name}-failure.png`), Buffer.from(shot.data, 'base64')) } catch { /* keep original error */ } }
}
finally {
  if (socket) { try { await send('Browser.close') } catch { /* exits */ } socket.close() }
  for (const req of pending.values()) { clearTimeout(req.timer) } pending.clear()
  if (ownedPid) { await sleep(500); try { process.kill(ownedPid, 'SIGKILL') } catch { /* already exited */ } }
  await fs.writeFile(path.join(out, `${name}-result.json`), serializeEvidence(results))
  console.log(`LAYOUT_RESULT=${results.verdict.toUpperCase()} checks=${results.checks.length}`)
}
