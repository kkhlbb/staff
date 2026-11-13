#!/usr/bin/env node
/**
 * Packaged UI evidence for actual product-generated pending/committed containers.
 * Service transaction is exercised by scripts/ingest-readings-evidence.ts first.
 * No model/OCR fixtures, DOM text injection, screenshots of synthetic overlays,
 * arbitrary IPC access, or changed application state by direct snapshot mutation.
 * node desktop/tests/e2e/ingestReadings.mjs [appExecutable] [port]
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { serializeEvidence } from '../../../scripts/evidence-json.ts'

const root = process.cwd()
const out = path.join(root, 'docs/evidence/ingest-readings')
const shots = path.join(out, 'screenshots')
const executable = path.resolve(process.argv[2] ?? 'out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链')
const bundle = path.resolve(path.dirname(executable), '../..')
const port = Number(process.argv[3] ?? 9418)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const exec = promisify(execFile)
const results = { verdict: 'fail', checks: [], screenshots: [],
  scope: 'Product-service transaction plus packaged rendering of its real containers; UI phase does not claim a second UI-only ingestion/commit.',
  limitation: '本次不含看图能力。拒绝由真实 preload IPC 调用；截图不注入错误提示，错误码见 JSON。' }
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
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const file = path.join(shots, `${name}.png`)
  await fs.writeFile(file, Buffer.from(result.data, 'base64'))
  results.screenshots.push(path.relative(root, file))
}
async function launch(file) {
  // Refuse a pre-existing debug target: never connect to/close another user's app.
  let occupied = false
  try { await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) }); occupied = true } catch { /* free */ }
  assert(!occupied, `BLOCKED: debug port ${port} already occupied`)
  const scratch = path.join(os.homedir(), '.hermes/profiles/daedalus/cache/scratch')
  await fs.mkdir(scratch, { recursive: true })
  const runtime = await fs.mkdtemp(path.join(scratch, 'ingest-readings-ui-'))
  const work = path.join(runtime, path.basename(file))
  await fs.copyFile(file, work)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  // LaunchServices sends an actual open-file event; -n + isolated userData avoids
  // reusing a normal user's application instance. Do not use `open -a` alone.
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
async function click(text) {
  return evaluate(`(() => {
    const node = [...document.querySelectorAll('button,[role="tab"]')].find(n => (n.textContent ?? '').trim() === ${JSON.stringify(text)})
    if (!node) throw new Error('Button/tab missing: ' + ${JSON.stringify(text)})
    if (node.disabled) throw new Error('Button disabled: ' + ${JSON.stringify(text)})
    node.click(); return true
  })()`)
}
async function state() {
  const current = await evaluate('window.cunlian.reattachSession()')
  assert.equal(current.ok, true, JSON.stringify(current))
  return current.value
}
function objects(value) {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(objects)
  return [value, ...Object.values(value).flatMap(objects)]
}
try {
  await fs.access(executable)
  const service = JSON.parse(await fs.readFile(path.join(out, 'service-result.json'), 'utf8'))
  assert.equal(service.verdict, 'pass', 'Service evidence must pass before packaged screenshots')
  const ingest = JSON.parse(await fs.readFile(path.join(out, 'ingest-response.json'), 'utf8'))
  await fs.mkdir(shots, { recursive: true })
  await launch(path.join(out, 'pending.cunlian'))
  let current = await state()
  const draft = current.snapshot.project.extractionDrafts.find(d => d.candidates.some(c => objects(c).some(e => e.kind === 'agent-read')))
  assert(draft, 'Real pending container must contain agent-read candidates')
  const candidates = draft.candidates.filter(c => objects(c).some(e => e.kind === 'agent-read'))
  assert.equal(candidates.length, 3)
  assert(candidates.every(c => c.status === 'pending' && c.requiresVerification === true && c.batchConfirmable === false))
  // Prefer extraction review; intent source may render the same candidates in sidebar.
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('button,[role="tab"]')].find(n => (n.textContent ?? '').includes('任务书提取'))
    if (tab) tab.click()
    const sidebar = [...document.querySelectorAll('button')].find(n => (n.textContent ?? '').includes('任务侧栏') && n.getAttribute('aria-expanded') === 'false')
    sidebar?.click(); return true
  })()`)
  await wait(() => evaluate(`document.body.innerText.includes('读数未核对')`), 'M48: visible unverified-reading badge')
  const rendered = await evaluate('document.body.innerText')
  assert(rendered.includes('读数未核对'))
  await evaluate(`(() => { [...document.querySelectorAll('*')].find(n => n.children.length === 0 && n.textContent?.includes('读数未核对'))?.scrollIntoView({block:'center'}); return true })()`)
  await shot('01-unverified-readings')
  results.checks.push({ id: 'unverified-badge-visible', ok: true })
  const before = JSON.stringify(current.snapshot.project.extractionDrafts)
  const batch = await evaluate(`window.cunlian.confirmExtractionBatch(${JSON.stringify({ sessionId: current.sessionId, baseEditSeq: current.editSeq, draftId: draft.draftId, candidateIds: candidates.map(c => c.candidateId) })})`)
  assert.equal(batch.ok, false, 'M46: real IPC batch must reject')
  assert.equal(batch.error.code, 'EXTRACTION_BATCH_REJECTED')
  current = await state()
  assert.equal(JSON.stringify(current.snapshot.project.extractionDrafts), before, 'Rejected batch must not change draft/decisions')
  await shot('02-after-real-batch-rejection')
  results.checks.push({ id: 'batch-rejected-zero-write', ok: true, response: batch,
    screenshotNote: 'Actual UI after rejected IPC, not an injected error banner.' })
  const commit = await evaluate(`window.cunlian.commitApprovedDraft(${JSON.stringify({ approvalId: 'no-approval', draftId: draft.draftId, previewFingerprint: 'no-preview' })})`)
  assert.equal(commit.ok, false)
  results.checks.push({ id: 'direct-unapproved-commit-rejected', ok: true, response: commit })
  // Confirm exactly one row per click; never click a group/all-confirm button.
  for (const candidate of candidates) {
    await wait(() => evaluate(`(() => {
      const node = [...document.querySelectorAll('.extraction-review__candidate')].find(n => n.querySelector('input[aria-label="选择候选 ' + ${JSON.stringify(candidate.candidateId)} + '"]'))
      return Boolean(node && [...node.querySelectorAll('button')].some(b => /^(确认这条|确认)$/.test((b.textContent ?? '').trim()) && !b.disabled))
    })()`), 'single confirm becomes enabled')
    await evaluate(`(() => {
      const id = ${JSON.stringify(candidate.candidateId)}
      const node = [...document.querySelectorAll('.extraction-review__candidate,[data-candidate-id]')]
        .find(n => n.getAttribute('data-candidate-id') === id || n.querySelector('input[aria-label="选择候选 ' + id + '"]'))
      const button = node && [...node.querySelectorAll('button')].find(b => /^(确认这条|确认)$/.test((b.textContent ?? '').trim()))
      if (!button) throw new Error('No visible single-candidate confirm control for ' + id)
      if (button.disabled) throw new Error('Single confirm control is disabled')
      button.scrollIntoView({block:'center'}); button.click(); return true
    })()`)
    await wait(async () => {
      const value = await state()
      return value.snapshot.project.extractionDrafts.find(d => d.draftId === draft.draftId)?.candidates.find(c => c.candidateId === candidate.candidateId)?.status === 'confirmed'
    }, `single confirmation ${candidate.candidateId}`)
  }
  current = await state()
  const confirmed = current.snapshot.project.extractionDrafts.find(d => d.draftId === draft.draftId)
  for (const c of candidates) assert(confirmed.decisions.some(d => d.candidateId === c.candidateId && d.action === 'confirm' && !d.batchId))
  await shot('03-single-item-confirmations')
  results.checks.push({ id: 'three-real-ui-single-confirmations', ok: true, decisions: confirmed.decisions })
  await close()
  // New isolated process opens the actual service-committed container, not a redraw.
  await launch(path.join(out, 'committed.cunlian'))
  await click('工程图')
  await wait(() => evaluate(`Boolean(document.querySelector('.desktop-workspace svg'))`), 'committed engineering drawing')
  const svg = await evaluate(`document.querySelector('.desktop-workspace svg')?.textContent ?? ''`)
  assert.match(svg, /读数|agent-read|人工/u)
  assert.match(svg, new RegExp(`第\\s*${ingest.payload.source.page}\\s*页|page\\s*[:：]?\\s*${ingest.payload.source.page}`, 'iu'))
  const committed = await state()
  assert(svg.includes(String(committed.snapshot.project.actorId)), 'Drawing must identify responsible reading actor')
  await shot('04-committed-drawing-provenance')
  results.checks.push({ id: 'committed-drawing-source-visible', ok: true, text: svg })
  results.verdict = 'pass'
} catch (error) {
  results.error = error instanceof Error ? error.message : String(error)
  if (socket) try { await shot('99-failure') } catch { /* do not hide original failure */ }
  process.exitCode = 1
} finally {
  await close()
  await fs.mkdir(out, { recursive: true })
  await fs.writeFile(path.join(out, 'ui-result.json'), serializeEvidence(results))
  console.log(JSON.stringify({ verdict: results.verdict, error: results.error, screenshots: results.screenshots }))
}
