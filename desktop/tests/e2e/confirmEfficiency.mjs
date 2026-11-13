#!/usr/bin/env node
/**
 * L2 确认效率：打包应用走查 + 截屏（真实 .app + CDP + open-file，无文件对话框）。
 *
 * 夹具：CONFIRM-L2.cunlian（真实 r6 任务书：87 候选 / 44 待确认 / 43 阻塞 / 29 仅差单位），
 * 由 `CONFIRM_SEED_OUT=... npx vitest run --config vitest.v36fixture.config.ts` 生成。
 *
 * 步骤与截图：
 * 1) 任务书提取页 → 按原因码分组视图（可确认 / 仅差单位 / 三类阻塞）→ 01；
 * 2) 「批量补单位（29 条）…」→ 填一句单位声明 → 02；
 * 3) 确认补单位 → 29 条逐条记 user-attestation，仍待确认 → 03；
 * 4) 「整批撤销」→ 单位回到未定 → 04（可选，验证可撤销）；
 * 5) 选中同一符号的两处 → 「批量确认选中项」→ 整批拒绝（0 写入）→ 05。
 *
 * 用法：node desktop/tests/e2e/confirmEfficiency.mjs [appExecutable] [port]
 * 产出：docs/evidence/confirm-efficiency/screenshots/*.png + e2e-summary.json（serializeEvidence）
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import path from 'node:path'
import { serializeEvidence } from '../../../scripts/evidence-json.ts'

const appExecutable =
  process.argv[2] ??
  path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9381)
const SEED = '/Users/aston/DSH/tmp/cunlian-l2/CONFIRM-L2.cunlian'
const WORK = '/Users/aston/DSH/tmp/cunlian-l2/CONFIRM-L2-run.cunlian'
const SHOTS = path.join(process.cwd(), 'docs', 'evidence', 'confirm-efficiency', 'screenshots')
const SUMMARY = path.join(process.cwd(), 'docs', 'evidence', 'confirm-efficiency', 'e2e-summary.json')

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}，先运行 npm run package:desktop -- --arch=arm64`)
  process.exit(2)
}
if (!existsSync(SEED)) {
  console.error(
    `BLOCKED: 缺少证据项目 ${SEED}（先运行 CONFIRM_SEED_OUT=${SEED} npx vitest run --config vitest.v36fixture.config.ts）`,
  )
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

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`)
}

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
    const details = response.result.exceptionDetails
    const description = details.exception?.description ?? details.text
    throw new Error(`evaluate failed: ${description}`)
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

function setValue(selector, value) {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!input) throw new Error('missing input ' + ${JSON.stringify(selector)})
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return input.value
  })()`
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
    const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent.includes('任务书提取'))
    if (!tab) throw new Error('未找到任务书提取页')
    tab.click()
    return true
  })()`)
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.extraction-review'))`),
    'extraction panel',
  )
}

const summary = { steps: [] }

await launch()
await send('Runtime.enable')
await send('Page.enable')
await sleep(1200)
await openProject()
await openExtractionTab()
await waitFor(
  () => evaluate(`document.querySelectorAll('.extraction-review__candidate').length === 87`),
  '87 candidates',
  30000,
)
await sleep(500)

const grouped = await evaluate(`(() => {
  const text = (selector) => document.querySelector(selector)?.textContent ?? ''
  return {
    confirmable: text('[data-testid="group-summary-confirmable"]').replace(/\\s+/g, ' ').trim(),
    units: text('[data-testid="group-summary-units"]').replace(/\\s+/g, ' ').trim(),
    blocked: text('[data-testid="group-summary-blocked"]').replace(/\\s+/g, ' ').trim(),
    groupHeads: [...document.querySelectorAll('.extraction-review__group-head button[aria-expanded]')].map(
      (item) => item.textContent.trim(),
    ),
  }
})()`)
console.log('grouped', JSON.stringify(grouped))
assert(grouped.confirmable.includes('可确认 44'), '可确认应为 44（r6）')
assert(grouped.units.includes('仅差单位 29'), '仅差单位应为 29（r6）')
assert(grouped.blocked.includes('FORMULA_UNSUPPORTED 13'), '公式不支持应为 13（r6）')
assert(grouped.blocked.includes('UNSUPPORTED_UNIT 1'), '单位不支持应为 1（r6）')
summary.steps.push({ step: 'grouped', ...grouped })
await evaluate(`(() => {
  document.querySelector('.extraction-review__groups')?.scrollIntoView({ block: 'start' })
  return true
})()`)
await sleep(400)
await shot('l2-01-grouped-panel')

// 2) 批量补单位表单
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.extraction-review__groups button')].find((item) => item.textContent.includes('批量补单位'))
  if (!button) throw new Error('未找到批量补单位按钮')
  button.click()
  return true
})()`)
await waitFor(
  () => evaluate(`Boolean(document.querySelector('[aria-label="单位声明"]'))`),
  'unit statement input',
)
await evaluate(`(() => {
  document.querySelector('[aria-label="单位声明"]')?.scrollIntoView({ block: 'center' })
  return true
})()`)
await sleep(300)
await shot('l2-02-unit-statement-form')

await evaluate(setValue('[aria-label="单位声明"]', '本表单位 mm（2026-11-12 复核）'))
await sleep(200)
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.extraction-review__groups button')].find((item) => item.textContent.startsWith('确认补单位'))
  if (!button) throw new Error('未找到确认补单位按钮')
  button.click()
  return true
})()`)
await waitFor(
  () =>
    evaluate(
      `document.querySelector('.extraction-review__message')?.textContent.includes('已为 29 条“仅差单位”候选补上 mm') ?? false`,
    ),
  'attested 29',
  30000,
)
await sleep(500)
const attested = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  const draft = current.value.snapshot.project.extractionDrafts[0]
  const attestations = current.value.snapshot.project.attestations
  return {
    pending: draft.candidates.filter((item) => item.status === 'pending').length,
    blocked: draft.candidates.filter((item) => item.status === 'blocked').length,
    attestUnits: draft.decisions.filter((item) => item.action === 'attest-unit').length,
    statements: [...new Set(attestations.map((item) => item.statement))],
    batches: [...new Set(draft.decisions.filter((item) => item.batchId).map((item) => item.batchId))],
  }
})()`)
console.log('attested', JSON.stringify(attested))
assert(attested.attestUnits === 29, '补单位决定应为 29 条（逐条）')
assert(attested.statements.length === 1 && attested.statements[0] === '本表单位 mm（2026-11-12 复核）', 'statement 必须逐字保存')
assert(attested.pending === 73, '补单位后待确认应为 44 + 29 = 73')
summary.steps.push({ step: 'attested', ...attested })
await evaluate(`(() => {
  document.querySelector('.extraction-review__message')?.scrollIntoView({ block: 'center' })
  return true
})()`)
await sleep(300)
await shot('l2-03a-attest-message')
await evaluate(`(() => {
  document.querySelector('.extraction-review__groups')?.scrollIntoView({ block: 'start' })
  return true
})()`)
await sleep(400)
await shot('l2-03-units-attested')

// 3) 整批撤销
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.extraction-review__unit-batch button')].find((item) => item.textContent === '整批撤销')
  if (!button) throw new Error('未找到整批撤销按钮')
  button.click()
  return true
})()`)
await waitFor(
  () => evaluate(`document.querySelector('.extraction-review__message')?.textContent.includes('已撤销 29 条补单位') ?? false`),
  'revoked 29',
  30000,
)
await sleep(400)
const revoked = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  const draft = current.value.snapshot.project.extractionDrafts[0]
  const attestations = current.value.snapshot.project.attestations
  return {
    pending: draft.candidates.filter((item) => item.status === 'pending').length,
    blocked: draft.candidates.filter((item) => item.status === 'blocked').length,
    revoked: attestations.filter((item) => item.revokedAt).length,
    unknownUnit: draft.candidates.filter((item) => item.reasonCodes.includes('UNKNOWN_UNIT')).length,
  }
})()`)
console.log('revoked', JSON.stringify(revoked))
assert(revoked.pending === 44 && revoked.blocked === 43, '撤销后状态数恢复 44 / 43')
assert(revoked.revoked === 29, '账本应有 29 条撤销留痕')
summary.steps.push({ step: 'revoked', ...revoked })
await evaluate(`(() => {
  document.querySelector('.extraction-review__message')?.scrollIntoView({ block: 'center' })
  return true
})()`)
await sleep(300)
await shot('l2-04a-revoke-message')
await evaluate(`(() => {
  document.querySelector('.extraction-review__groups')?.scrollIntoView({ block: 'start' })
  return true
})()`)
await sleep(400)
await shot('l2-04-units-revoked')

// 4) 互斥拒绝：选同一符号的两处 → 批量确认整批拒绝
const multi = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  const draft = current.value.snapshot.project.extractionDrafts[0]
  const groups = new Map()
  for (const candidate of draft.candidates) {
    if (candidate.kind !== 'ring' || candidate.groupId === null || candidate.status !== 'pending') continue
    const list = groups.get(candidate.groupId) ?? []
    list.push(candidate.candidateId)
    groups.set(candidate.groupId, list)
  }
  const found = [...groups.values()].find((list) => list.length > 1)
  return found ?? null
})()`)
assert(multi !== null, '应存在同符号多处赋值的待确认组')
for (const [index, candidateId] of multi.slice(0, 2).entries()) {
  await evaluate(`(() => {
    const box = document.querySelector('input[aria-label="选择候选 ${candidateId}"]')
    if (!box) throw new Error('未找到选择框 ${candidateId}')
    if (!box.checked) box.click()
    return box.checked
  })()`)
  await sleep(150)
  console.log(`selected ${index + 1}: ${candidateId}`)
}
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.extraction-review__batch button')].find((item) => item.textContent === '批量确认选中项')
  if (!button) throw new Error('未找到批量确认选中项')
  button.click()
  return true
})()`)
await waitFor(
  () => evaluate(`document.querySelector('.extraction-review__error')?.textContent.includes('同一符号多处赋值只能确认一处') ?? false`),
  'group refusal message',
  20000,
)
await sleep(400)
const refused = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  const draft = current.value.snapshot.project.extractionDrafts[0]
  const error = document.querySelector('.extraction-review__error')?.textContent ?? ''
  return {
    error,
    confirmed: draft.candidates.filter((item) => item.status === 'confirmed').length,
    decisions: draft.decisions.filter((item) => item.action === 'confirm').length,
    selected: [...document.querySelectorAll('.extraction-review__candidate input[type="checkbox"]:checked')].length,
  }
})()`)
console.log('refused', JSON.stringify(refused))
assert(refused.error.includes('整批未执行'), '拒绝文案必须写明整批未执行')
assert(refused.confirmed === 0 && refused.decisions === 0, '整批拒绝必须 0 写入')
summary.steps.push({ step: 'group-refused', selectedCandidateIds: multi.slice(0, 2), ...refused })
await evaluate(`(() => {
  // 只调整布局（收起右栏），不改任何数据，便于截屏读完整拒绝文案。
  const collapse = [...document.querySelectorAll('button')].filter((item) => item.textContent === '收起')
  for (const button of collapse) button.click()
  const properties = [...document.querySelectorAll('button')].find((item) => item.textContent === '收起属性栏')
  properties?.click()
  document.querySelector('.extraction-review__groups')?.scrollIntoView({ block: 'start' })
  return true
})()`)
await sleep(500)
await shot('l2-05-group-refusal')

summary.passed = true
await fsp.writeFile(SUMMARY, serializeEvidence(summary))
console.log(`SUMMARY ${SUMMARY}`)
socket.close()
child.kill('SIGKILL')
await waitFor(async () => childExit !== null, 'exit', 15000)
console.log('RESULT PASS L2 确认效率走查（分组 / 批量补单位 / 整批撤销 / 互斥拒绝）')
