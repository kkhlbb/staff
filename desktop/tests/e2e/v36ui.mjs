#!/usr/bin/env node
/**
 * V3.6 第 2 阶段打包应用走查：真实 .app + CDP + open-file（无文件对话框）。
 *
 * 步骤：打开含 1110 PDF 的 schema8 项目 → 任务书提取页 → 提取 [1,2] →
 * 确认 H / 拒绝 S → 定位到 PDF 选区 → 保存 → 同范围重提（候选数不变）→
 * 退出重启重开项目 → 决定与候选仍在。
 *
 * 用法：node desktop/tests/e2e/v36ui.mjs [appExecutable] [port]
 * 截图：docs/evidence/V3.6/screenshots/；状态摘要：docs/evidence/V3.6/stage2-e2e.json
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import path from 'node:path'
import { serializeEvidence } from '../../../scripts/evidence-json.ts'

const appExecutable =
  process.argv[2] ??
  path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9371)
const SEED = '/Users/aston/DSH/tmp/cunlian-v36/E2E-V36.cunlian'
const WORK = '/Users/aston/DSH/tmp/cunlian-v36/E2E-V36-run.cunlian'
const SHOTS = path.join(process.cwd(), 'docs', 'evidence', 'V3.6', 'screenshots')
const SUMMARY = path.join(process.cwd(), 'docs', 'evidence', 'V3.6', 'stage2-e2e.json')

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}，先运行 npm run package:desktop -- --arch=arm64`)
  process.exit(2)
}
if (!existsSync(SEED)) {
  console.error(`BLOCKED: 缺少证据项目 ${SEED}（先运行 V36_SEED_OUT=... npx vitest run --config vitest.v36fixture.config.ts）`)
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

async function openProject() {
  execFileSync('open', ['-a', bundle, WORK])
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('main[aria-label="寸链桌面工作台"]'))`),
    'workspace',
    30000,
  )
  await waitFor(
    async () => {
      const count = await evaluate(`(async () => {
        const current = await window.cunlian.reattachSession()
        return current.ok && current.value.sessionId ? current.value.snapshot.documents.length : -1
      })()`)
      return count >= 1
    },
    'PDF present',
    30000,
  )
}

async function openExtractionTab() {
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent === '任务书提取')
    if (!tab) throw new Error('未找到任务书提取页')
    tab.click()
    return true
  })()`)
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.extraction-review'))`),
    'extraction panel',
  )
}

function setValue(selector, value) {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    const proto = HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return input.value
  })()`
}

await launch()
await send('Runtime.enable')
await send('Page.enable')
await sleep(1200)
await openProject()
await openExtractionTab()
await shot('v36-01-extraction-empty')

// 1) 提取 [1,2]
await evaluate(setValue('[aria-label="提取起始页"]', '1'))
await evaluate(setValue('[aria-label="提取结束页"]', '2'))
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.extraction-review button')].find((item) => item.textContent === '提取候选')
  if (!button) throw new Error('未找到提取按钮')
  button.click()
  return true
})()`)
await waitFor(
  () => evaluate(`document.querySelectorAll('.extraction-review__candidate').length === 7`),
  '7 candidates',
  30000,
)
await sleep(600)
await shot('v36-02-candidates-pending')

// 2) 确认 H
const confirmH = await evaluate(`(() => {
  const row = [...document.querySelectorAll('.extraction-review__candidate')].find((item) => item.textContent.includes('组成环 · H'))
  if (!row) throw new Error('未找到 H 候选')
  const button = [...row.querySelectorAll('button')].find((item) => item.textContent === '确认')
  button.click()
  return true
})()`)
void confirmH
await waitFor(
  () => evaluate(`(() => {
    const row = [...document.querySelectorAll('.extraction-review__candidate')].find((item) => item.textContent.includes('组成环 · H'))
    return row?.getAttribute('data-status') === 'confirmed'
  })()`),
  'H confirmed',
)

// 3) 拒绝 S（必须填理由）
await evaluate(`(() => {
  const row = [...document.querySelectorAll('.extraction-review__candidate')].find((item) => item.textContent.includes('组成环 · S'))
  if (!row) throw new Error('未找到 S 候选')
  const button = [...row.querySelectorAll('button')].find((item) => item.textContent === '拒绝…')
  button.click()
  return true
})()`)
await waitFor(
  () => evaluate(`Boolean(document.querySelector('.extraction-review__candidate input[aria-label="拒绝理由"]'))`),
  'reject input',
)
await evaluate(`(() => {
  const input = document.querySelector('.extraction-review__candidate input[aria-label="拒绝理由"]')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '长度数值需人工核对')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return input.value
})()`)
await sleep(200)
await evaluate(`(() => {
  const input = document.querySelector('.extraction-review__candidate input[aria-label="拒绝理由"]')
  const row = input.closest('.extraction-review__candidate')
  const button = [...row.querySelectorAll('button')].find((item) => item.textContent === '确认拒绝')
  if (button.disabled) throw new Error('确认拒绝仍被禁用')
  button.click()
  return true
})()`)
await waitFor(
  () => evaluate(`(() => {
    const row = [...document.querySelectorAll('.extraction-review__candidate')].find((item) => item.textContent.includes('组成环 · S'))
    return row?.getAttribute('data-status') === 'rejected'
  })()`),
  'S rejected',
)
await sleep(400)
await shot('v36-03-confirmed-rejected')
await evaluate(`(() => {
  const row = [...document.querySelectorAll('.extraction-review__candidate')].find((item) => item.textContent.includes('组成环 · H'))
  row.scrollIntoView({ block: 'center' })
  return true
})()`)
await sleep(300)
await shot('v36-03a-confirmed-row')
await evaluate(`(() => {
  const row = [...document.querySelectorAll('.extraction-review__candidate')].find((item) => item.textContent.includes('组成环 · S'))
  row.scrollIntoView({ block: 'center' })
  return true
})()`)
await sleep(300)
await shot('v36-03b-rejected-row')

// 4) 定位到 PDF 选区
await evaluate(`(() => {
  const row = [...document.querySelectorAll('.extraction-review__candidate')].find((item) => item.textContent.includes('组成环 · H'))
  const button = [...row.querySelectorAll('button')].find((item) => item.textContent === '定位到 PDF 选区')
  button.click()
  return true
})()`)
await waitFor(
  () => evaluate(`Boolean(document.querySelector('[data-testid="extraction-locate-summary"]'))`),
  'locate summary',
)
await waitFor(
  () => evaluate(`Boolean(document.querySelector('.extraction-review__locate canvas'))`),
  'locate canvas',
  20000,
)
await sleep(800)
await evaluate(`(() => {
  const section = document.querySelector('.extraction-review__locate')
  section?.scrollIntoView({ block: 'center' })
  return true
})()`)
await sleep(400)
await shot('v36-04-locate-pdf-selection')

// 5) 保存（显式）
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.desktop-workspace__toolbar button')].find((item) => item.textContent === '保存')
  button.click()
  return true
})()`)
await waitFor(
  () => evaluate(`(() => {
    const text = document.querySelector('.desktop-workspace__pending')?.textContent ?? ''
    return text.includes('已保存') && !text.includes('未保存')
  })()`),
  'saved',
  20000,
)
const savedState = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  const snapshot = current.value.snapshot
  return {
    path: current.value.path,
    savedSeq: current.value.savedSeq,
    editSeq: current.value.editSeq,
    drafts: snapshot.project.extractionDrafts.length,
    candidates: snapshot.project.extractionDrafts[0].candidates.length,
    statuses: snapshot.project.extractionDrafts[0].candidates.map((item) => item.status),
    decisions: snapshot.project.extractionDrafts[0].decisions.map((item) => ({ action: item.action, actor: item.actor, reason: item.reason })),
    target: snapshot.project.dimensionChain.target,
    activeRequirementRevisionId: snapshot.project.activeRequirementRevisionId,
    parameters: snapshot.project.parameters.length,
    bindings: snapshot.project.dimensionLinks.length,
  }
})()`)
console.log('saved', JSON.stringify(savedState))

// 6) 同版本/同页范围/同规则重提：候选数不变
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.extraction-review button')].find((item) => item.textContent === '提取候选')
  button.click()
  return true
})()`)
await waitFor(
  () => evaluate(`document.querySelector('.extraction-review__message')?.textContent.includes('未变化')`),
  'idempotent message',
  30000,
)
await sleep(300)
const idempotent = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  const drafts = current.value.snapshot.project.extractionDrafts
  return {
    drafts: drafts.length,
    candidates: drafts[0].candidates.length,
    draftRevision: drafts[0].draftRevision,
    editSeq: current.value.editSeq,
    savedSeq: current.value.savedSeq,
  }
})()`)
console.log('idempotent', JSON.stringify(idempotent))
await shot('v36-05-idempotent-reextract')

// 7) 退出并重启，重开同一文件
// 项目已显式保存；直接结束进程，避免关闭闸门因无交互而等待。
socket.close()
child.kill('SIGKILL')
await waitFor(async () => childExit !== null, 'first instance exit', 15000)
await sleep(2000)

await launch()
await send('Runtime.enable')
await send('Page.enable')
await sleep(1200)
await openProject()
await openExtractionTab()
await waitFor(
  () => evaluate(`document.querySelectorAll('.extraction-review__candidate').length === 7`),
  'candidates after reopen',
  20000,
)
await sleep(500)
const reopened = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  const drafts = current.value.snapshot.project.extractionDrafts
  return {
    path: current.value.path,
    drafts: drafts.length,
    candidates: drafts[0].candidates.length,
    statuses: drafts[0].candidates.map((item) => item.status),
    decisions: drafts[0].decisions.map((item) => ({ action: item.action, actor: item.actor, reason: item.reason })),
    extractorVersion: drafts[0].extractorVersion,
  }
})()`)
console.log('reopened', JSON.stringify(reopened))
await shot('v36-06-reopened-state-kept')
await evaluate(`(() => {
  const row = [...document.querySelectorAll('.extraction-review__candidate')].find((item) => item.textContent.includes('组成环 · S'))
  row.scrollIntoView({ block: 'center' })
  return true
})()`)
await sleep(300)
await shot('v36-06b-reopened-rejected-row')

// 8) 重开后再提取同一版本/页范围：候选数仍为 7（跨重启幂等）
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.extraction-review button')].find((item) => item.textContent === '提取候选')
  button.click()
  return true
})()`)
await waitFor(
  () => evaluate(`document.querySelector('.extraction-review__message')?.textContent.includes('未变化')`),
  'idempotent after reopen',
  30000,
)
const idempotentAfterReopen = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  const drafts = current.value.snapshot.project.extractionDrafts
  return {
    drafts: drafts.length,
    candidates: drafts[0].candidates.length,
    statuses: drafts[0].candidates.map((item) => item.status),
    editSeq: current.value.editSeq,
    savedSeq: current.value.savedSeq,
  }
})()`)
console.log('idempotentAfterReopen', JSON.stringify(idempotentAfterReopen))
await evaluate(`(() => {
  const panel = document.querySelector('.extraction-review')
  if (panel) panel.scrollTop = 0
  return true
})()`)
await sleep(300)
await shot('v36-07-reopened-idempotent')

await fsp.writeFile(
  SUMMARY,
  serializeEvidence({ savedState, idempotent, reopened, idempotentAfterReopen }),
)
console.log(`SUMMARY ${SUMMARY}`)
console.log('DONE')
socket.close()
child.kill('SIGKILL')
await sleep(800)
process.exit(0)
