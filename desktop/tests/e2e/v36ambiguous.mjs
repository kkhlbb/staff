#!/usr/bin/env node
/**
 * V3.6 体验修订：打包应用走查「同一符号多处赋值」。
 *
 * 步骤：打开含 ambiguous-assignment.pdf 与逐处候选的 schema8 项目 →
 * 任务书提取页（A0 三处 / B0 合并 / C0 两处 + issue）→ 截图 →
 * 确认 A0 第 1 处 → 断言第 2/3 处确认按钮禁用 + 提示 → 直连 IPC 再确认第 2 处
 * 必须返回 EXTRACTION_GROUP_CONFLICT → 撤销第 1 处 → 第 2 处恢复可选 → 截图。
 *
 * 用法：node desktop/tests/e2e/v36ambiguous.mjs [appExecutable] [port]
 * 截图：docs/evidence/V3.6/screenshots/v36-11*.png
 * 摘要：docs/evidence/V3.6/ambiguous-e2e.json
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import path from 'node:path'

const appExecutable =
  process.argv[2] ??
  path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9373)
const SEED = '/Users/aston/DSH/tmp/cunlian-v36/AMB-V36.cunlian'
const WORK = '/Users/aston/DSH/tmp/cunlian-v36/AMB-V36-run.cunlian'
const SHOTS = path.join(process.cwd(), 'docs', 'evidence', 'V3.6', 'screenshots')
const SUMMARY = path.join(process.cwd(), 'docs', 'evidence', 'V3.6', 'ambiguous-e2e.json')

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}，先运行 npm run package:desktop -- --arch=arm64`)
  process.exit(2)
}
if (!existsSync(SEED)) {
  console.error(`BLOCKED: 缺少证据项目 ${SEED}（先运行 V36_AMB_SEED_OUT=... npx vitest run --config vitest.v36fixture.config.ts）`)
  process.exit(2)
}
await fsp.mkdir(SHOTS, { recursive: true })
await fsp.copyFile(SEED, WORK)

const bundle = path.resolve(path.dirname(appExecutable), '../..')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let child = null
let childExit = null
let socket = null
let nextId = 1
const pending = new Map()

async function launch() {
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  child = spawn(appExecutable, [`--remote-debugging-port=${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv,
  })
  childExit = null
  child.on('exit', (code, signal) => (childExit = { code, signal }))
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk.toString()))
  child.stderr.on('data', (chunk) => (output += chunk.toString()))
  let target = null
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (childExit !== null) break
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      target = targets.find((item) => item.type === 'page') ?? null
      if (target !== null) break
    } catch {
      // 端口尚未就绪
    }
    await sleep(250)
  }
  if (target === null) {
    console.error('BLOCKED: 打包应用没有在 30 秒内暴露 page target；若已有实例占用单实例锁，请先退出。')
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
}

async function waitFor(predicate, label, timeoutMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true
    await sleep(200)
  }
  throw new Error(`TIMEOUT: ${label}`)
}

function rowByOccurrence(index) {
  return `[...document.querySelectorAll('.extraction-review__candidate')].find((item) => {
    const badge = item.querySelector('.extraction-review__occurrence')
    return badge && badge.textContent.includes('第 ${index}/3 处')
  })`
}

await launch()
await send('Runtime.enable')
await send('Page.enable')
await sleep(1200)
execFileSync('open', ['-a', bundle, WORK])
await waitFor(
  () => evaluate(`Boolean(document.querySelector('main[aria-label="寸链桌面工作台"]'))`),
  'workspace',
  30000,
)
await waitFor(
  () => evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent.includes('任务书提取'))
    if (!tab) return false
    tab.click()
    return true
  })()`),
  'extraction tab',
  30000,
)
await waitFor(
  () => evaluate(`document.querySelectorAll('.extraction-review__candidate').length === 6`),
  '6 candidates',
  30000,
)
await sleep(600)

const initial = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.extraction-review__candidate')]
  return rows.map((row) => ({
    title: row.querySelector('strong')?.textContent,
    status: row.getAttribute('data-status'),
    occurrence: row.querySelector('.extraction-review__occurrence')?.textContent?.trim() ?? null,
    hint: row.querySelector('.extraction-review__group-hint')?.textContent?.trim() ?? null,
    values: row.querySelector('.extraction-review__values')?.textContent?.trim(),
  }))
})()`)
console.log('initial', JSON.stringify(initial, null, 2))

await evaluate(`(() => { ${rowByOccurrence(1)}.scrollIntoView({ block: 'center' }); return true })()`)
await sleep(400)
await shot('v36-11-ambiguous-candidates')

// 确认 A0 第 1/3 处
await evaluate(`(() => {
  const row = ${rowByOccurrence(1)}
  const button = [...row.querySelectorAll('button')].find((item) => item.textContent === '确认')
  if (button.disabled) throw new Error('第 1 处确认按钮被禁用')
  button.click()
  return true
})()`)
await waitFor(
  () => evaluate(`${rowByOccurrence(1)}?.getAttribute('data-status') === 'confirmed'`),
  'A0 #1 confirmed',
)
await sleep(500)

const afterConfirm = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.extraction-review__candidate')]
    .filter((row) => row.textContent.includes('组成环 · A0'))
  return rows.map((row) => {
    const button = [...row.querySelectorAll('button')].find((item) => item.textContent === '确认')
    return {
      occurrence: row.querySelector('.extraction-review__occurrence')?.textContent?.trim() ?? null,
      status: row.getAttribute('data-status'),
      confirmDisabled: button?.disabled ?? null,
      confirmTitle: button?.title ?? null,
      hint: row.querySelector('.extraction-review__group-hint')?.textContent?.trim() ?? null,
      hasRevoke: [...row.querySelectorAll('button')].some((item) => item.textContent === '撤销确认'),
    }
  })
})()`)
console.log('afterConfirm', JSON.stringify(afterConfirm, null, 2))

await evaluate(`(() => { ${rowByOccurrence(1)}.scrollIntoView({ block: 'center' }); return true })()`)
await sleep(400)
await shot('v36-11b-group-mutex')

// 直连 IPC：第 1 处已确认时，第 2 处确认必须被 main 拒绝（不是仅 UI 置灰）
const ipcAttempt = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  if (!current.ok) return { ok: false, reason: 'reattach failed' }
  const snapshot = current.value.snapshot
  const draft = snapshot.project.extractionDrafts[0]
  const second = draft.candidates.find((item) => item.kind === 'ring' && item.data.symbol === 'A0' && item.occurrence?.index === 2)
  if (!second) return { ok: false, reason: 'no second A0' }
  const result = await window.cunlian.decideExtraction({
    sessionId: current.value.sessionId,
    baseEditSeq: current.value.editSeq,
    draftId: draft.draftId,
    candidateId: second.candidateId,
    editRevision: second.editRevision,
    action: 'confirm',
    confirmed: true,
  })
  return result.ok
    ? { ok: true, status: result.value.status }
    : { ok: false, code: result.error.code, message: result.error.message }
})()`)
console.log('ipcAttempt', JSON.stringify(ipcAttempt))

// 撤销第 1 处 → 第 2 处恢复可选
await evaluate(`(() => {
  const row = ${rowByOccurrence(1)}
  const button = [...row.querySelectorAll('button')].find((item) => item.textContent === '撤销确认')
  if (!button) throw new Error('未找到撤销确认按钮')
  button.click()
  return true
})()`)
await waitFor(
  () => evaluate(`${rowByOccurrence(1)}?.getAttribute('data-status') === 'pending'`),
  'A0 #1 revoked',
)
await sleep(500)
const afterRevoke = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.extraction-review__candidate')]
    .filter((row) => row.textContent.includes('组成环 · A0'))
  return rows.map((row) => {
    const button = [...row.querySelectorAll('button')].find((item) => item.textContent === '确认')
    return {
      occurrence: row.querySelector('.extraction-review__occurrence')?.textContent?.trim() ?? null,
      status: row.getAttribute('data-status'),
      confirmDisabled: button?.disabled ?? null,
    }
  })
})()`)
console.log('afterRevoke', JSON.stringify(afterRevoke, null, 2))
await shot('v36-11c-after-revoke')

// 撤销后保存：走真实 schema8 写盘校验（确认决定必须已失效，否则提取引用校验会拒绝）
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.desktop-workspace__toolbar button')].find((item) => item.textContent === '保存')
  if (!button) throw new Error('未找到保存按钮')
  button.click()
  return true
})()`)
await waitFor(
  () => evaluate(`(() => {
    const text = document.querySelector('.desktop-workspace__pending')?.textContent ?? ''
    return text.includes('已保存') && !text.includes('未保存')
  })()`),
  'saved after revoke',
  20000,
)
const persisted = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  const draft = current.value.snapshot.project.extractionDrafts[0]
  return {
    savedSeq: current.value.savedSeq,
    statuses: draft.candidates.map((item) => item.status),
    decisions: draft.decisions.map((item) => ({
      action: item.action,
      invalidated: item.invalidatedByEditRevision,
    })),
    occurrences: draft.candidates
      .filter((item) => item.occurrence)
      .map((item) => item.occurrence.index + '/' + item.occurrence.total),
  }
})()`)
console.log('persisted', JSON.stringify(persisted))

const summary = {
  app: appExecutable,
  seed: SEED,
  work: WORK,
  initial,
  afterConfirm,
  ipcAttempt,
  afterRevoke,
  persisted,
  shots: ['v36-11-ambiguous-candidates.png', 'v36-11b-group-mutex.png', 'v36-11c-after-revoke.png'],
}
await fsp.writeFile(SUMMARY, JSON.stringify(summary, null, 2))
console.log(`SUMMARY ${SUMMARY}`)

const a0Rows = afterConfirm
const mutexOk =
  a0Rows.filter((row) => row.status === 'confirmed').length === 1 &&
  a0Rows.filter((row) => row.status === 'pending' && row.confirmDisabled === true).length === 2 &&
  a0Rows.some((row) => row.status === 'confirmed' && row.hasRevoke === true)
const ipcOk = ipcAttempt.ok === false && ipcAttempt.code === 'EXTRACTION_GROUP_CONFLICT'
const revokeOk =
  afterRevoke.every((row) => row.status === 'pending' && row.confirmDisabled === false)
const persistedOk =
  persisted.statuses.every((status) => status === 'pending') &&
  persisted.decisions.some((item) => item.action === 'revoke') &&
  persisted.decisions.some((item) => item.action === 'confirm' && item.invalidated !== null) &&
  persisted.occurrences.length === 5
console.log(`RESULT mutexUi=${mutexOk} ipc=${ipcOk} revoke=${revokeOk} persisted=${persistedOk}`)

child.kill('SIGTERM')
await sleep(800)
if (childExit === null) child.kill('SIGKILL')
if (!mutexOk || !ipcOk || !revokeOk || !persistedOk) process.exit(1)
