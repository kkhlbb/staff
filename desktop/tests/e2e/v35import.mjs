#!/usr/bin/env node
/**
 * P0 缺陷端到端自证：真实打包 .app 内「导入资料 → 系统 PDF 对话框 → 落进容器」。
 *
 * 覆盖：
 * 1. 打开内置示例（无 PDF 的新容器）→ 点工具栏「导入资料」→ 系统打开面板选
 *    合成两页任务书 → 新增 document/revision/blob，SHA-256 与源文件一致；
 * 2. 来源页「导入「…」新版…」→ 选第二个 PDF → 同文档换版：旧 revision/blob
 *    保留，latestRevisionId 前进；
 * 3. 来源 PDF 页 canvas 实际渲染（PDF 查看回归的打包路径冒烟）。
 *
 * 系统打开面板用 AppleScript（System Events）输入路径；需要辅助功能权限。
 * 若环境无法操作原生对话框，脚本会以 BLOCKED(2) 退出，不会假装导入成功。
 *
 * 所有截图/日志写入 CUNLIAN_E2E_OUT（默认系统临时目录下的 cunlian-e2e），
 * 不向仓库写文件。
 *
 * 用法：node desktop/tests/e2e/v35import.mjs [appExecutable] [port]
 */
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const appExecutable =
  process.argv[2] ??
  path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9367)
const FIXTURE = path.join(process.cwd(), 'docs', 'evidence', 'V3.5', 'fixtures', 'taskbook-2p.pdf')
const OUT = process.env.CUNLIAN_E2E_OUT ?? path.join(os.tmpdir(), 'cunlian-e2e')
const SHOTS = path.join(OUT, 'screenshots')

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}，先运行 npm run package:desktop`)
  process.exit(2)
}
if (!existsSync(FIXTURE)) {
  console.error(`BLOCKED: 缺少任务书夹具 ${FIXTURE}`)
  process.exit(2)
}
mkdirSync(SHOTS, { recursive: true })

const fixtureBytes = await fsp.readFile(FIXTURE)
const fixtureSha = createHash('sha256').update(fixtureBytes).digest('hex')
const versionBPath = path.join(OUT, 'taskbook-2p-v2.pdf')
const versionBBytes = Buffer.concat([fixtureBytes, Buffer.from('\n% cunlian import fix v2\n')])
await fsp.writeFile(versionBPath, versionBBytes)
const versionBSha = createHash('sha256').update(versionBBytes).digest('hex')

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
// 断言失败/超时也要收掉测试实例，避免单实例锁挡住下一次运行。
process.on('exit', () => {
  try {
    child.kill('SIGKILL')
  } catch {
    // 已退出
  }
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const failures = []
function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS ${name}${detail === undefined ? '' : `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
  } else {
    console.log(`FAIL ${name}${detail === undefined ? '' : `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
    failures.push(name)
  }
}

async function findPageTarget() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
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
  console.error('BLOCKED: 打包应用没有在 30 秒内暴露 page target；若已有实例占用单实例锁，请先退出。')
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
    const detail = response.result.exceptionDetails
    throw new Error(`evaluate failed: ${detail.text} ${detail.exception?.description ?? ''}`)
  }
  return response.result?.result?.value
}
async function shot(name) {
  const response = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const file = path.join(SHOTS, `${name}.png`)
  await fsp.writeFile(file, Buffer.from(response.result.data, 'base64'))
  return file
}
async function waitFor(predicate, label, timeoutMs = 20000) {
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
    // 面板刚关闭时查询 sheet 会得到 -1719；异常已由调用方捕获，别把
    // osascript 的 stderr 直接漏到证据日志里。
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

const APP_PROCESS = '寸链'

function appProcessName() {
  const names = osascript([
    'tell application "System Events" to get name of every process whose background only is false',
  ])
  const list = names.split(', ').map((item) => item.trim())
  const hit = list.find((name) => name === APP_PROCESS) ?? list.find((name) => name.includes(APP_PROCESS))
  return hit ?? null
}

function processScript(body) {
  return `tell application "System Events" to tell process ${JSON.stringify(APP_PROCESS)} to ${body}`
}

function sheetCounts() {
  let outer = 0
  let inner = 0
  try {
    outer = Number(osascript([processScript('get count of sheets of window 1')]))
  } catch {
    outer = 0
  }
  try {
    inner = Number(osascript([processScript('get count of sheets of sheet 1 of window 1')]))
  } catch {
    inner = 0
  }
  return { outer, inner }
}

async function waitUi(predicate, label, timeoutMs = 10000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await sleep(150)
  }
  throw new Error(`TIMEOUT(UI): ${label}`)
}

/**
 * 操作 macOS 系统打开面板：Cmd+Shift+G 打开“前往文件夹”，输入绝对路径，
 * 回车定位文件，再回车确认。每一步都轮询面板状态，不靠固定延时猜。
 */
async function answerOpenPanel(filePath) {
  if (appProcessName() === null) {
    throw new Error('BLOCKED: System Events 看不到「寸链」进程，无法操作系统打开面板')
  }
  osascript([`tell application ${JSON.stringify(APP_PROCESS)} to activate`])
  await waitUi(() => sheetCounts().outer === 1, '系统打开面板出现', 15000)
  osascript([processScript('keystroke "g" using {command down, shift down}')])
  await waitUi(() => sheetCounts().inner === 1, '前往文件夹面板出现', 10000)
  await sleep(500)
  osascript([
    processScript(
      'tell sheet 1 of sheet 1 of window 1 to set focused of text field 1 to true',
    ),
  ])
  osascript([processScript('keystroke "a" using {command down}')])
  osascript([processScript(`keystroke ${JSON.stringify(filePath)}`)])
  await sleep(600)
  let value = osascript([
    processScript('tell sheet 1 of sheet 1 of window 1 to get value of text field 1'),
  ])
  if (value !== filePath) {
    osascript([
      processScript(
        `tell sheet 1 of sheet 1 of window 1 to set value of text field 1 to ${JSON.stringify(filePath)}`,
      ),
    ])
    await sleep(300)
    value = osascript([
      processScript('tell sheet 1 of sheet 1 of window 1 to get value of text field 1'),
    ])
  }
  if (value !== filePath) {
    throw new Error(`前往文件夹输入失败：期望 ${filePath}，实际 ${JSON.stringify(value)}`)
  }
  osascript([
    processScript(
      'tell sheet 1 of sheet 1 of window 1 to set focused of text field 1 to true',
    ),
  ])
  await sleep(200)
  osascript([processScript('key code 36')])
  try {
    await waitUi(() => sheetCounts().inner === 0, '前往文件夹面板关闭', 4000)
  } catch {
    osascript([processScript('keystroke return')])
    await waitUi(() => sheetCounts().inner === 0, '前往文件夹面板关闭（重试）', 6000)
  }
  osascript([processScript('key code 36')])
  await waitUi(() => sheetCounts().outer === 0, '系统打开面板关闭', 10000)
}

await send('Runtime.enable')
await send('Page.enable')
await sleep(1200)

// 1) 打开内置示例：无 PDF 的新容器（真实 UI 入口）。
const hasStart = await evaluate(`Boolean(document.querySelector('main[aria-label="寸链启动页"]'))`)
check('启动页可见', hasStart)
if (!hasStart) {
  console.error('BLOCKED: 启动页不在前台（可能已有会话）；请先退出正在运行的「寸链」。')
  child.kill('SIGKILL')
  process.exit(2)
}
await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('打开内置示例'))
  if (!button) throw new Error('未找到内置示例入口')
  button.click()
  return true
})()`)
await waitFor(
  () => evaluate(`Boolean(document.querySelector('main[aria-label="寸链桌面工作台"]'))`),
  'built-in example workspace',
  25000,
)
const before = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  const snap = current.value.snapshot
  return { sessionId: current.value.sessionId, editSeq: current.value.editSeq, documents: snap.documents.length, revisions: snap.revisions.length, blobs: snap.blobs.length }
})()`)
check('导入前容器没有 PDF', before.documents === 0, before)
console.log(`SHOT ${await shot('import-00-before')}`)

// 2) 「导入资料」→ 系统打开面板 → 选任务书。
await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '导入资料')
  if (!button) throw new Error('未找到导入资料按钮')
  button.click()
  return true
})()`)
await sleep(1200)
await answerOpenPanel(FIXTURE)
await waitFor(
  async () => {
    const value = await evaluate(`(async () => {
      const current = await window.cunlian.reattachSession()
      if (!current.ok || !current.value.sessionId) return -1
      return current.value.snapshot.documents.length
    })()`)
    return value === 1
  },
  'document after import',
  40000,
)
const imported = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  const snap = current.value.snapshot
  const doc = snap.documents[0]
  const revision = snap.revisions.find((item) => item.id === doc.latestRevisionId)
  const blob = snap.blobs.find((item) => item.blobKey === revision.blobKey)
  const read = await window.cunlian.readAttachment({ sessionId: current.value.sessionId, revisionId: revision.id })
  const bytes = read.value.bytes
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunk))
  }
  return {
    sessionId: current.value.sessionId,
    document: { id: doc.id, title: doc.title, latestRevisionId: doc.latestRevisionId },
    revision: { id: revision.id, documentId: revision.documentId, pageCount: revision.pageCount, sha256: revision.sha256, byteSize: revision.byteSize, blobKey: revision.blobKey, fileName: revision.fileName },
    blob,
    documents: snap.documents.length,
    revisions: snap.revisions.length,
    blobs: snap.blobs.length,
    attachment: { sha256: read.value.sha256, byteSize: bytes.length, base64: btoa(binary) },
    noticeText: document.querySelector('.desktop-workspace__notice')?.textContent ?? null,
  }
})()`)
imported.attachmentSha = createHash('sha256').update(Buffer.from(imported.attachment.base64, 'base64')).digest('hex')
delete imported.attachment.base64
check('导入后新增 1 个 document', imported.documents === 1, imported.document)
check('任务书页数为 2', imported.revision.pageCount === 2, imported.revision)
check('revision SHA-256 与源文件一致', imported.revision.sha256 === fixtureSha, { expected: fixtureSha, actual: imported.revision.sha256 })
check('blob 记录 SHA-256 一致', imported.blob?.sha256 === fixtureSha, imported.blob)
check('blob 字节数一致', imported.blob?.byteSize === fixtureBytes.byteLength, imported.blob)
check('readAttachment 字节 SHA-256 一致', imported.attachmentSha === fixtureSha, imported.attachmentSha)
check('readAttachment 返回同一版本', imported.attachment.sha256 === fixtureSha)
console.log(`IMPORTED ${JSON.stringify(imported)}`)
console.log(`SHOT ${await shot('import-01-after')}`)

// 3) 来源 PDF 页 canvas 渲染（C 的 PDF 查看走打包路径）。
await evaluate(`(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent === '来源 PDF')
  if (!tab) throw new Error('未找到来源 PDF 标签')
  tab.click()
  return true
})()`)
await waitFor(
  () => evaluate(`Boolean(document.querySelector('[aria-label="来源版本"]'))`),
  'source viewer',
  15000,
)
await sleep(2000)
const canvas = await evaluate(`(() => {
  const canvases = [...document.querySelectorAll('canvas')]
  const first = canvases[0]
  return { count: canvases.length, width: first?.width ?? 0, height: first?.height ?? 0 }
})()`)
check('来源 PDF canvas 已渲染', canvas.count > 0 && canvas.width > 0 && canvas.height > 0, canvas)
console.log(`SHOT ${await shot('import-02-viewer')}`)

// 4) 同文档换版：来源页「导入「…」新版…」→ 第二个 PDF。
await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('新版'))
  if (!button) throw new Error('未找到换版入口')
  button.click()
  return true
})()`)
await sleep(1200)
await answerOpenPanel(versionBPath)
await waitFor(
  async () => {
    const value = await evaluate(`(async () => {
      const current = await window.cunlian.reattachSession()
      if (!current.ok || !current.value.sessionId) return -1
      return current.value.snapshot.revisions.length
    })()`)
    return value === 2
  },
  'second revision',
  40000,
)
const replaced = await evaluate(`(async () => {
  const current = await window.cunlian.reattachSession()
  const snap = current.value.snapshot
  const document = snap.documents[0]
  const revisions = snap.revisions.map((item) => ({ id: item.id, documentId: item.documentId, sha256: item.sha256, byteSize: item.byteSize, blobKey: item.blobKey, pageCount: item.pageCount }))
  return {
    documents: snap.documents.length,
    revisions,
    blobs: snap.blobs.map((item) => ({ blobKey: item.blobKey, sha256: item.sha256, byteSize: item.byteSize })),
    latestRevisionId: document.latestRevisionId,
  }
})()`)
const latest = replaced.revisions.find((item) => item.id === replaced.latestRevisionId)
const oldest = replaced.revisions.find((item) => item.id !== replaced.latestRevisionId)
check('换版后仍是同一 document', replaced.documents === 1, replaced.documents)
check('换版新增 revision 且旧版保留', replaced.revisions.length === 2, replaced.revisions)
check('latestRevisionId 指向新版', latest?.sha256 === versionBSha, latest)
check('旧 revision SHA-256 保留', oldest?.sha256 === fixtureSha, oldest)
check('两个独立 blob 均保留', replaced.blobs.length === 2 && replaced.blobs.some((blob) => blob.sha256 === fixtureSha) && replaced.blobs.some((blob) => blob.sha256 === versionBSha), replaced.blobs)
console.log(`REPLACED ${JSON.stringify(replaced)}`)
console.log(`SHOT ${await shot('import-03-replaced')}`)

await fsp.writeFile(
  path.join(OUT, 'result.json'),
  JSON.stringify({ fixtureSha, versionBSha, imported, replaced, failures }, null, 2),
  'utf8',
)
console.log(`EVIDENCE ${path.join(OUT, 'result.json')}`)

socket.close()
child.kill('SIGTERM')
await sleep(1200)
if (childExit === null) child.kill('SIGKILL')
if (failures.length > 0) {
  console.error(`RESULT FAIL ${failures.length} 项`)
  process.exit(1)
}
console.log('RESULT PASS 打包应用内 PDF 导入 + 换版成功')
process.exit(0)
