#!/usr/bin/env node
/**
 * 「批量补单位做成真状态变更」：打包应用走查 + 截屏 + 项目文件回读。
 *
 * 夹具：`UNIT-ATTEST-RUN.cunlian`（真实 r6 任务书：87 候选 / 44 待确认 / 43 阻塞 /
 * 29 仅差单位），由 `CONFIRM-L2.cunlian` 复制；不手写候选。
 *
 * 步骤与证据：
 * 1) 分组视图（未声明）→ 截图 l3-01-before：仅差单位 29；
 * 2) 一句「本表单位 mm…」→ 29 条真转待确认（总 73 / 阻塞 14）→ 截图 l3-02-after；
 * 3) 候选行显示「单位来源：用户声明」+ 原话 + 轮次 → 截图 l3-03-unit-source；
 * 4) 保存项目文件并 decodeProjectFile 回读：29 条 user-attestation 真在文件里；
 * 5) 整批撤销 → 44 / 43；再保存回读：候选回 blocked、断言只标 revokedAt → 截图 l3-04-revoked。
 *
 * 用法：node desktop/tests/e2e/unitAttestState.mjs [appExecutable] [port]
 * 产出：docs/evidence/unit-attest-state/screenshots/*.png + e2e-summary.json
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import path from 'node:path'
import { serializeEvidence } from '../../../scripts/evidence-json.ts'
import { loadProjectCodec } from '../../../scripts/real-docs/tsImport.mjs'

const appExecutable =
  process.argv[2] ??
  path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9382)
const SEED = '/Users/aston/DSH/tmp/cunlian-l2/CONFIRM-L2.cunlian'
const WORK_DIR = '/Users/aston/DSH/tmp/cunlian-unit-attest'
const WORK = path.join(WORK_DIR, 'UNIT-ATTEST-RUN.cunlian')
const EVIDENCE = path.join(process.cwd(), 'docs', 'evidence', 'unit-attest-state')
const SHOTS = path.join(EVIDENCE, 'screenshots')
const SUMMARY = path.join(EVIDENCE, 'e2e-summary.json')
const STATEMENT = '本表单位 mm（2026-11-12 复核）'

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
await fsp.mkdir(WORK_DIR, { recursive: true })
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

async function readDraft() {
  return evaluate(`(async () => {
    const current = await window.cunlian.reattachSession()
    const draft = current.value.snapshot.project.extractionDrafts[0]
    const project = current.value.snapshot.project
    const units = [...document.querySelectorAll('[data-testid^="unit-source-"]')].map((node) => node.textContent)
    return {
      editSeq: current.value.editSeq,
      sessionId: current.value.sessionId,
      pending: draft.candidates.filter((item) => item.status === 'pending').length,
      blocked: draft.candidates.filter((item) => item.status === 'blocked').length,
      attestDecisions: draft.decisions.filter((item) => item.action === 'attest-unit').length,
      revokeDecisions: draft.decisions.filter((item) => item.action === 'revoke').length,
      attestations: project.attestations.map((item) => ({
        actorId: item.actorId,
        sessionSeq: item.sessionSeq,
        turnId: item.turnId,
        statement: item.statement,
        revokedAt: item.revokedAt ?? null,
      })),
      unitSourceLines: units,
      batchText: document.querySelector('.extraction-review__unit-batch')?.textContent ?? '',
      groupsUnits: document.querySelector('[data-testid="group-summary-units"]')?.textContent ?? '',
      groupsConfirmable: document.querySelector('[data-testid="group-summary-confirmable"]')?.textContent ?? '',
    }
  })()`)
}

async function saveProjectFromPage() {
  return evaluate(`(async () => {
    const current = await window.cunlian.reattachSession()
    if (!current.ok || !current.value.sessionId) return { ok: false, error: 'no session' }
    const saved = await window.cunlian.saveProject({
      sessionId: current.value.sessionId,
      editSeq: current.value.editSeq,
      expectedFingerprint: current.value.fingerprint,
    })
    return saved.ok
      ? { ok: true, path: saved.value.path, savedSeq: saved.value.savedSeq }
      : { ok: false, error: saved.error }
  })()`)
}

const codec = await loadProjectCodec()
async function readSavedProject() {
  const bytes = new Uint8Array(await fsp.readFile(WORK))
  const decoded = await codec.decodeProjectFile(bytes)
  if (!decoded.ok) throw new Error(`项目文件回读失败：${JSON.stringify(decoded.error)}`)
  const draft = decoded.value.snapshot.project.extractionDrafts[0]
  const attestations = decoded.value.snapshot.project.attestations
  return {
    pending: draft.candidates.filter((item) => item.status === 'pending').length,
    blocked: draft.candidates.filter((item) => item.status === 'blocked').length,
    attestations: attestations.length,
    activeAttestations: attestations.filter((item) => (item.revokedAt ?? null) === null).length,
    revokedAttestations: attestations.filter((item) => (item.revokedAt ?? null) !== null).length,
    sample: attestations.slice(0, 2).map((item) => ({
      actorId: item.actorId,
      sessionSeq: item.sessionSeq,
      turnId: item.turnId,
      statement: item.statement,
      fieldPath: item.fieldPath,
      revokedAt: item.revokedAt ?? null,
    })),
  }
}

const summary = { statement: STATEMENT, steps: [] }

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

const before = await readDraft()
console.log('before', JSON.stringify({ pending: before.pending, blocked: before.blocked }))
assert(before.pending === 44 && before.blocked === 43, '未声明应为 44 / 43（r6）')
assert(before.groupsUnits.includes('仅差单位 29'), '仅差单位应为 29（r6）')
summary.steps.push({ step: 'before', pending: before.pending, blocked: before.blocked, groupsUnits: before.groupsUnits })
await evaluate(`(() => {
  document.querySelector('.extraction-review__groups')?.scrollIntoView({ block: 'start' })
  return true
})()`)
await sleep(400)
await shot('l3-01-before')

// 2) 批量补单位（真状态变更）
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
await evaluate(setValue('[aria-label="单位声明"]', STATEMENT))
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
const after = await readDraft()
console.log('after', JSON.stringify({ pending: after.pending, blocked: after.blocked, decisions: after.attestDecisions }))
assert(after.pending === 73, '补单位后待确认应为 44 + 29 = 73')
assert(after.blocked === 14, '补单位后阻塞应为 43 - 29 = 14')
assert(after.attestDecisions === 29, '应有 29 条 attest-unit 决定（逐条）')
assert(after.attestations.length === 29, '项目账本应有 29 条 user-attestation')
assert(
  after.attestations.every(
    (item) =>
      item.actorId === 'local-operator' &&
      Number.isSafeInteger(item.sessionSeq) &&
      typeof item.turnId === 'string' &&
      item.turnId === 'extraction-panel-1',
  ),
  '每条断言必须带 actorId / sessionSeq / turnId（由 main 生成）',
)
assert(
  after.attestations.every((item) => item.statement === STATEMENT),
  '声明原话必须逐字保存',
)
summary.steps.push({
  step: 'attested',
  pending: after.pending,
  blocked: after.blocked,
  decisions: after.attestDecisions,
  attestations: after.attestations.length,
  turnIds: [...new Set(after.attestations.map((item) => item.turnId))],
})
await evaluate(`(() => {
  document.querySelector('.extraction-review__groups')?.scrollIntoView({ block: 'start' })
  return true
})()`)
await sleep(400)
await shot('l3-02-after-attest')

// 3) 候选行上的「单位来源：用户声明」
await waitFor(
  () => evaluate(`document.querySelectorAll('[data-testid^="unit-source-"]').length > 0`),
  'unit-source line',
)
const unitLine = await evaluate(`(() => {
  const node = document.querySelector('[data-testid^="unit-source-"]')
  node.scrollIntoView({ block: 'center' })
  return node.textContent.replace(/\\s+/g, ' ').trim()
})()`)
console.log('unitLine', unitLine)
assert(unitLine.includes('单位来源：用户声明'), '界面必须写明“单位来源：用户声明”')
assert(unitLine.includes(STATEMENT), '界面必须显示声明原话')
assert(unitLine.includes('extraction-panel-1'), '界面必须显示轮次')
summary.steps.push({ step: 'unit-source', text: unitLine })
await sleep(400)
await shot('l3-03-unit-source')

// 4) 保存项目文件 → 回读证明出处真在文件里
const savedAfterAttest = await saveProjectFromPage()
assert(savedAfterAttest.ok, `保存失败：${JSON.stringify(savedAfterAttest)}`)
await sleep(600)
const fileAfterAttest = await readSavedProject()
console.log('fileAfterAttest', JSON.stringify({ pending: fileAfterAttest.pending, blocked: fileAfterAttest.blocked, attestations: fileAfterAttest.attestations }))
assert(fileAfterAttest.pending === 73 && fileAfterAttest.blocked === 14, '项目文件里的状态也必须是 73 / 14')
assert(fileAfterAttest.attestations === 29, '项目文件里必须有 29 条 user-attestation')
assert(fileAfterAttest.activeAttestations === 29, '补单位后 29 条断言应仍有效')
summary.steps.push({ step: 'saved-after-attest', ...fileAfterAttest })

// 5) 整批撤销（真改存储）
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
const revoked = await readDraft()
console.log('revoked', JSON.stringify({ pending: revoked.pending, blocked: revoked.blocked, revokeDecisions: revoked.revokeDecisions }))
assert(revoked.pending === 44 && revoked.blocked === 43, '撤销后状态数恢复 44 / 43')
assert(revoked.revokeDecisions === 29, '应有 29 条撤销决定落盘')
assert(revoked.attestations.every((item) => item.revokedAt !== null), '账本 29 条断言都应标撤销')
summary.steps.push({
  step: 'revoked',
  pending: revoked.pending,
  blocked: revoked.blocked,
  revokeDecisions: revoked.revokeDecisions,
  revokedAttestations: revoked.attestations.filter((item) => item.revokedAt !== null).length,
})

const savedAfterRevoke = await saveProjectFromPage()
assert(savedAfterRevoke.ok, `撤销后保存失败：${JSON.stringify(savedAfterRevoke)}`)
await sleep(600)
const fileAfterRevoke = await readSavedProject()
console.log('fileAfterRevoke', JSON.stringify({ pending: fileAfterRevoke.pending, blocked: fileAfterRevoke.blocked, revoked: fileAfterRevoke.revokedAttestations }))
assert(fileAfterRevoke.pending === 44 && fileAfterRevoke.blocked === 43, '项目文件里的状态也应回到 44 / 43')
assert(fileAfterRevoke.attestations === 29, '出处不删除：文件里仍应有 29 条断言')
assert(fileAfterRevoke.revokedAttestations === 29, '文件里 29 条断言都应带 revokedAt')
summary.steps.push({ step: 'saved-after-revoke', ...fileAfterRevoke })

await evaluate(`(() => {
  document.querySelector('.extraction-review__groups')?.scrollIntoView({ block: 'start' })
  return true
})()`)
await sleep(400)
await shot('l3-04-revoked')

summary.passed = true
await fsp.writeFile(SUMMARY, serializeEvidence(summary))
console.log(`SUMMARY ${SUMMARY}`)
socket.close()
child.kill('SIGKILL')
await waitFor(async () => childExit !== null, 'exit', 15000)
console.log('RESULT PASS 批量补单位真状态走查（29 条转 pending / 界面对话原话 / 项目文件回读 / 整批撤销）')
