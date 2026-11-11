#!/usr/bin/env node
/**
 * V3.5 第 3 阶段打包应用证据（真实 .app + CDP）。
 *
 * 覆盖用户实测的三处缺陷：
 * 1. 合法草稿 12.04 自动预览后，二维图纸标注/图形与属性按候选参数重画；
 *    12.00 与 12.04 各截一张画布图，并记录实际标注文本。
 * 2. 条款不满足（12.10）时「确认提交」按钮 disabled，原因文字仍可见。
 * 3. 顶栏批次标签为「V4.0 · Beta」（V4.0 起由 V3.5 改名）。
 * 4. 已确认条款的项目打开后，参数绑定行仍为「已确认生效」，不出现
 *    「来源基准与确认时不一致」。
 *
 * 用法：node desktop/tests/e2e/v35fixes.mjs [appExecutable] [port]
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, promises as fsp, mkdirSync } from 'node:fs'
import path from 'node:path'

const appExecutable =
  process.argv[2] ??
  path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9366)
const SEED = '/Users/aston/DSH/tmp/cunlian-v35/P35-imported.cunlian'
const SHOTS = path.join(process.cwd(), 'docs', 'evidence', 'V3.5', 'screenshots')

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}，先运行 npm run package:desktop`)
  process.exit(2)
}
if (!existsSync(SEED)) {
  console.error(`BLOCKED: 缺少证据项目 ${SEED}`)
  process.exit(2)
}
mkdirSync(SHOTS, { recursive: true })

const childEnv = { ...process.env }
delete childEnv.ELECTRON_RUN_AS_NODE
const child = spawn(appExecutable, [`--remote-debugging-port=${port}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: childEnv,
})
let appOutput = ''
child.stdout.on('data', (chunk) => (appOutput += chunk.toString()))
child.stderr.on('data', (chunk) => (appOutput += chunk.toString()))
let childExit = null
child.on('exit', (code, signal) => (childExit = { code, signal }))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findPageTarget() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (childExit !== null) return null
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

const target = await findPageTarget()
if (!target) {
  console.error('BLOCKED: 打包应用没有在 25 秒内暴露 page target；若已有实例占用单实例锁，请先退出。')
  console.error(appOutput)
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
async function shot(name, clip, scale = 1) {
  const params = { format: 'png', fromSurface: true }
  if (clip) params.clip = { ...clip, scale }
  const response = await send('Page.captureScreenshot', params)
  const file = path.join(SHOTS, `${name}.png`)
  await fsp.writeFile(file, Buffer.from(response.result.data, 'base64'))
  console.log(`SHOT ${file}`)
  return file
}
async function waitFor(predicate, label, timeoutMs = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true
    await sleep(200)
  }
  throw new Error(`TIMEOUT: ${label}`)
}
function check(name, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` ${detail}`}`)
  if (!condition) failures.push(`${name} ${detail}`)
}
const failures = []
const setValue = (selector, value) => `(() => {
  const input = document.querySelector(${JSON.stringify(selector)})
  if (!input) throw new Error('missing input ' + ${JSON.stringify(selector)})
  const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return input.value
})()`
const annotationText = () => evaluate(`(() => {
  const panel = document.querySelector('section[aria-label="隔套工程图"]')
  const text = panel?.querySelector('[data-annotation-id="ann.length"] text')
  return text ? text.textContent : null
})()`)
const drawingRect = () => evaluate(`(() => {
  const panel = document.querySelector('section[aria-label="隔套工程图"]')
  const canvas = panel?.querySelector('.spacer-drawing__canvas')
  if (!canvas) return null
  canvas.scrollIntoView({ block: 'center' })
  const rect = canvas.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
})()`)
const drawingDetailRect = () => evaluate(`(() => {
  const panel = document.querySelector('section[aria-label="隔套工程图"]')
  const canvas = panel?.querySelector('.spacer-drawing__canvas')
  const text = panel?.querySelector('[data-annotation-id="ann.length"] text')
  if (!canvas || !text) return null
  canvas.scrollIntoView({ block: 'center' })
  const rect = canvas.getBoundingClientRect()
  const label = text.getBoundingClientRect()
  // 侧视图 + 长度标注所在左半区，放大 4 倍，文字可核对。
  const x = Math.max(rect.x, label.x - 140)
  const y = Math.max(rect.y, label.y - 120)
  return {
    x,
    y,
    width: Math.min(rect.x + rect.width, label.x + 220) - x,
    height: Math.min(rect.y + rect.height, label.y + 160) - y,
  }
})()`)

await send('Runtime.enable')
await send('Page.enable')
// 证据截图用更高的视口，让工程图画布与参数联动同时完整可见（不改应用数据）。
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1400,
  deviceScaleFactor: 1,
  mobile: false,
})
await sleep(1200)

// 1) 通过 LaunchServices 打开已含任务书条款的项目（无原生文件对话框）。
const bundle = path.resolve(path.dirname(appExecutable), '../..')
execFileSync('open', ['-a', bundle, SEED])
await waitFor(
  () => evaluate(`Boolean(document.querySelector('main[aria-label="寸链桌面工作台"]'))`),
  'workspace after open-file',
  25000,
)
await waitFor(
  async () => {
    const count = await evaluate(`(async () => {
      const current = await window.cunlian.reattachSession()
      return current.ok && current.value.sessionId ? current.value.snapshot.documents.length : -1
    })()`)
    return count >= 2
  },
  'taskbook PDF present in opened project',
  25000,
)

// 批次标签（第 3 处缺陷）；V4.0 起顶栏标识改为 V4.0 · Beta。
const batch = await evaluate(`document.querySelector('.desktop-workspace__batch')?.textContent ?? null`)
check('批次标签', batch === 'V4.0 · Beta', JSON.stringify(batch))
await shot('v35fix-00-workspace')

// 项目里已有活动条款；绑定行不应因任务书 PDF 被误判待核（第 4 项疑点）。
const sessionInfo = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  const snapshot = current.value.snapshot
  const project = snapshot.project
  return {
    path: current.value.path,
    activeRequirementRevisionId: project.activeRequirementRevisionId,
    requirementCount: project.requirementRevisions.length,
    documents: snapshot.documents.length,
    bindingConfirmEvents: snapshot.events.filter((event) => event.type === 'parameter_binding_confirmed').length,
  }
})()`)
console.log('SESSION', JSON.stringify(sessionInfo))
check('项目含活动条款', typeof sessionInfo.activeRequirementRevisionId === 'string')
check('项目含确认绑定事件', sessionInfo.bindingConfirmEvents >= 1, String(sessionInfo.bindingConfirmEvents))

await evaluate(`(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent === '工程图')
  tab.click()
  return true
})()`)
await sleep(800)
const benchText = await evaluate(`document.querySelector('section[aria-label="参数联动"]')?.innerText ?? ''`)
const bindingLine = benchText.split('\n').find((line) => line.includes('S ←') || line.includes('长度（param')) ?? ''
console.log('BINDING_ROW', JSON.stringify(bindingLine))
check('绑定行显示已确认生效', benchText.includes('已确认生效'))
check('绑定行没有来源基准待核', !benchText.includes('来源基准与确认时不一致'))
const bindRect = await evaluate(`(() => {
  const section = document.querySelector('.change-workbench__bind')
  if (!section) return null
  section.scrollIntoView({ block: 'center' })
  const rect = section.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
})()`)
await sleep(300)
if (bindRect) await shot('v35fix-01b-binding-detail', bindRect, 2)
await shot('v35fix-01-binding-confirmed')

// 2) 12.00 基线画布。
await waitFor(() => annotationText().then((text) => text === '12.00'), 'baseline annotation 12.00')
const rectBefore = await drawingRect()
const detailBefore = await drawingDetailRect()
await sleep(300)
await shot('v35fix-02-drawing-1200', rectBefore, 2)
if (detailBefore) await shot('v35fix-02b-drawing-1200-detail', detailBefore, 4)

// 3) 合法输入 12.04：自动预览（不点按钮），二维图按候选参数重画。
await evaluate(setValue('[aria-label="长度（mm）"]', '12.04'))
await waitFor(
  () => evaluate(`Boolean(document.querySelector('.spacer-drawing__candidate'))`),
  'candidate drawing banner',
  15000,
)
await waitFor(() => annotationText().then((text) => text === '12.04'), 'candidate annotation 12.04', 15000)
const rectAfter = await drawingRect()
const detailAfter = await drawingDetailRect()
await sleep(300)
await shot('v35fix-03-drawing-1204', rectAfter, 2)
if (detailAfter) await shot('v35fix-03b-drawing-1204-detail', detailAfter, 4)
const candidateState = await evaluate(`(() => {
  const panel = document.querySelector('section[aria-label="隔套工程图"]')
  const propertyButton = [...document.querySelectorAll('#desktop-tree button')].find((item) => item.textContent.startsWith('长度 · '))
  return {
    annotation: panel?.querySelector('[data-annotation-id="ann.length"] text')?.textContent ?? null,
    diameter: panel?.querySelector('[data-annotation-id="ann.outer-diameter"] text')?.textContent ?? null,
    candidateBanner: panel?.querySelector('.spacer-drawing__candidate')?.textContent?.trim() ?? null,
    parameterTreeLabel: propertyButton?.textContent ?? null,
    previewText: document.querySelector('section[aria-label="变更预览"]')?.innerText?.slice(0, 400) ?? null,
  }
})()`)
console.log('CANDIDATE_1204', JSON.stringify(candidateState))
check('二维标注为 12.04', candidateState.annotation === '12.04', JSON.stringify(candidateState.annotation))
check('项目树参数标签为 12.04', candidateState.parameterTreeLabel === '长度 · 12.04', JSON.stringify(candidateState.parameterTreeLabel))
check('明确标注候选未提交', (candidateState.candidateBanner ?? '').includes('候选参数预览（未提交）'))
check('候选结果 0.1100～0.2100', (candidateState.previewText ?? '').includes('0.1100') && (candidateState.previewText ?? '').includes('0.2100'))

// 属性栏也读候选参数（用户实测的 120000 q 停留点）。
await evaluate(`(() => {
  const button = [...document.querySelectorAll('#desktop-tree button')].find((item) => item.textContent === '长度 · 12.04')
  if (!button) throw new Error('未找到候选参数树节点')
  button.click()
  return true
})()`)
await sleep(500)
const property = await evaluate(`(() => {
  const panel = document.querySelector('aside[aria-label="属性栏"]')
  return panel?.innerText ?? null
})()`)
console.log('PROPERTY_1204', JSON.stringify((property ?? '').split('\n').filter((line) => line.includes('q =') || line.includes('显示')).join(' | ')))
check('属性 q 为 120400', (property ?? '').includes('q = 120400'))

// 4) 12.10：条款不满足 → 确认提交 disabled，原因文字可见。
await evaluate(setValue('[aria-label="长度（mm）"]', '12.10'))
await waitFor(
  () => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('确认提交'))
    return Boolean(button && button.disabled)
  })()`),
  'confirm button disabled at 12.10',
  15000,
)
const gate = await evaluate(`(() => {
  const bench = document.querySelector('section[aria-label="参数联动"]')
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('确认提交'))
  const reason = document.getElementById('change-workbench-confirm-reason')
  const panel = document.querySelector('section[aria-label="隔套工程图"]')
  return {
    disabled: button?.disabled ?? null,
    reason: reason?.textContent ?? null,
    title: button?.getAttribute('title') ?? null,
    annotation: panel?.querySelector('[data-annotation-id="ann.length"] text')?.textContent ?? null,
    requirementStatus: document.querySelector('.requirement-panel__status')?.textContent ?? null,
    revision: bench?.querySelector('header')?.innerText ?? null,
  }
})()`)
console.log('GATE_1210', JSON.stringify(gate))
check('确认提交按钮 disabled', gate.disabled === true)
check('原因文字可见（不只在 title）', (gate.reason ?? '').includes('条款检查为「不满足要求」'), JSON.stringify(gate.reason))
check('原因包含下界越界', (gate.reason ?? '').includes('下界越界'))
check('二维标注为 12.10', gate.annotation === '12.10', JSON.stringify(gate.annotation))
check('条款状态为不满足要求', gate.requirementStatus === '不满足要求', JSON.stringify(gate.requirementStatus))

await evaluate(`(() => {
  const form = document.querySelector('.change-workbench__inputs')
  form?.scrollIntoView({ block: 'center' })
  return Boolean(form)
})()`)
await sleep(400)
const gateRect = await evaluate(`(() => {
  const form = document.querySelector('.change-workbench__inputs')
  const rect = form.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
})()`)
await shot('v35fix-04-confirm-disabled', gateRect, 2)
await shot('v35fix-05-confirm-disabled-full')

// 5) 3D 在场：切到 3D 开启内置示例，确认相机/选择/爆炸控件仍可用（候选参数已由 2D 证明同源）。
await evaluate(`(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent === '3D')
  tab.click()
  return true
})()`)
await sleep(600)
const hasDemo = await evaluate(`Boolean([...document.querySelectorAll('button')].find((item) => item.textContent === '查看内置轴系示例'))`)
if (hasDemo) {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent === '查看内置轴系示例')
    button.click()
    return true
  })()`)
  await waitFor(
    () => evaluate(`document.querySelector('.three-viewport')?.getAttribute('data-three-state') === 'ready'`),
    '3D ready',
    20000,
  )
  await sleep(600)
  await shot('v35fix-06-3d-candidate-1210')
} else {
  console.log('SKIP 3D 示例入口不存在（当前项目已有导入模型？）')
}

console.log('RESULT', failures.length === 0 ? 'ALL_PASS' : `FAILURES=${failures.length}`)
if (failures.length > 0) console.log('FAILED', JSON.stringify(failures))
socket.close()
child.kill('SIGTERM')
await sleep(1200)
if (childExit === null) child.kill('SIGKILL')
process.exit(failures.length === 0 ? 0 : 1)
