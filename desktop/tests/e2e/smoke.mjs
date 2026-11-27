#!/usr/bin/env node
/**
 * A-01 桌面壳冒烟测试（真实 Electron + 打包产物）。
 *
 * 通过 Chromium DevTools Protocol 连接由 `npm run package:desktop` 产出的 .app：
 * - 生产入口从本地 file:// 加载，无远程资源；
 * - renderer 没有 require/process/ipcRenderer，window.cunlian 只有具体函数；
 * - 子框架拿不到 preload 桥；
 * - 编辑屏障协议可完成，requestClose 返回 ok 后窗口销毁。
 *
 * 用法：
 *   node desktop/tests/e2e/smoke.mjs [appExecutablePath] [port]
 * 默认路径 out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const appExecutable =
  process.argv[2] ??
  path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
let port = Number(process.argv[3] ?? 0)

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}，先运行 npm run package:desktop -- --arch=arm64`)
  process.exit(2)
}

const failures = []
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`PASS ${name}`)
  } else {
    console.log(`FAIL ${name} ${detail}`)
    failures.push(name)
  }
}

const profile = mkdtempSync(path.join(tmpdir(), 'cunlian-desktop-smoke-'))
const child = spawn(appExecutable, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
let appOutput = ''
child.stdout.on('data', (chunk) => (appOutput += chunk.toString()))
child.stderr.on('data', (chunk) => (appOutput += chunk.toString()))
let childExit = null
child.on('exit', (code, signal) => {
  childExit = { code, signal }
})

process.once('exit', () => {
  if (childExit === null) child.kill('SIGKILL')
  rmSync(profile, { recursive: true, force: true })
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findPageTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (childExit !== null) {
      return null
    }
    try {
      if (port === 0) {
        port = Number(readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0])
      }
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
  console.error('BLOCKED: 打包应用没有在 20 秒内暴露 page target')
  if (childExit !== null) {
    console.error(
      `应用提前退出 code=${childExit.code} signal=${childExit.signal}`,
    )
  }
  console.error(appOutput)
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

async function waitForElement(selector) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return true
    await sleep(150)
  }
  return false
}

await send('Runtime.enable')
const defaultWorkbench = await waitForElement('main[aria-label="寸链 M1 双入口工作台"]')

const title = await evaluate('document.title')
check('窗口标题为 寸链', title === '寸链', `got=${title}`)

check('渲染出默认工作台', defaultWorkbench === true)
await evaluate(`document.querySelector('button[aria-label="更多操作"]')?.click()`)
const legacyLink = 'a[href="#/desktop-legacy"]'
check('更多菜单提供旧工作台入口', await waitForElement(legacyLink))
await evaluate(`document.querySelector(${JSON.stringify(legacyLink)})?.click()`)
await waitForElement('main[aria-label="寸链启动页"]')
const bodyText = await evaluate('document.body.innerText')
check('渲染出桌面壳内容', String(bodyText).includes('打开项目，继续设计'), `got=${String(bodyText).slice(0, 80)}`)

const apiKeys = await evaluate('Object.keys(window.cunlian).sort()')
const expectedKeys = [
  'agentCancel', 'agentPreviewSummary', 'agentProviderStatus', 'agentResume', 'agentStart',
  'agentTaskState', 'analyzeCompliantStackup', 'analyzeGdtStackup', 'applyChange', 'applyConfirmedInputs', 'attestExtractionUnits', 'bindParameter',
  'cancelExtraction', 'cancelM1ChatMessage', 'cancelM1ProjectSubscription', 'clearAgentProviderKey', 'commitApprovedDraft',
  'commitM3ApprovedDraft', 'commitModel', 'commitV2', 'compareDrawings', 'confirmExtractionBatch',
  'confirmRequirement', 'decideExtraction', 'deleteExtractionDraft', 'detectFeaSidecars', 'detectM1LocalAgents', 'exportApprovedVersion',
  'exportDrawingDxf2000', 'exportDrawingDxfR12', 'exportDrawingPdf', 'exportDrawingSvg', 'exportSimulationReport', 'getConfirmedInputs',
  'getGdtCapability', 'getM1ConnectionStatus', 'getM1ExternalActivities', 'getM1LocalAgentInstallInfo', 'getM1ProjectContext', 'getM1ReadCapabilities',
  'getM2PreviewSnapshot', 'getMigrationReport', 'getProjectContext', 'importMicMatrix', 'importSketchImage', 'importSource',
  'ingestSketchReadings', 'inspectV2', 'intentApply', 'intentConfirmCandidate', 'intentCreateProject',
  'intentIssueApproval', 'intentPreview', 'intentState', 'issueAgentApproval', 'linkModel',
  'listM1ModelApiModels', 'listRecent', 'listRecovery', 'locateEvidence', 'locateM2Evidence',
  'newProject', 'onAgentEvent', 'onEditorFlush', 'onMenuAction', 'openDxf',
  'openExternalProjectResult', 'openProject', 'pickModel', 'previewAndCheck', 'previewChange',
  'readAttachment', 'readM1ProjectEvents', 'readModel', 'reattachSession', 'reconnectM1Session',
  'registerM1LocalAgent', 'releaseModel', 'relinkRecent', 'requestClose', 'requestM1ProjectAuthorization',
  'respondEditorFlush', 'restoreRecovery', 'restoreRevisionDraft', 'retryM2Drawing', 'revealProject',
  'revokeExtractionUnits', 'revokeM1ProjectAuthorization', 'runExtraction', 'saveAgentProvider', 'saveProject',
  'saveProjectAs', 'sendM1ChatMessage', 'stageChangeDraft', 'stageDatum', 'stageDraft', 'stageGdt', 'stageParameterChange',
  'stagePhysics', 'stageRequirementEdit', 'stepCancel', 'stepExport', 'submitM2Clarification', 'subscribeM1ProjectEvents',
  'subscribeM1WorkbenchEvents', 'subscribeM2PreviewEvents', 'subscribeM3ExternalProjectEvents', 'takePendingDxf', 'takeoverM1Draft',
  'testAgentProvider', 'testM1ModelApiConnection', 'unbindParameter', 'undoDraftChange', 'updateSpacerDrawing',
].sort()
const nonFunctions = await evaluate('Object.keys(window.cunlian).filter(key => typeof window.cunlian[key] !== "function")')
check(
  'window.cunlian 只暴露具体函数',
  JSON.stringify(apiKeys) === JSON.stringify(expectedKeys) && nonFunctions.length === 0,
  `got=${JSON.stringify(apiKeys)}, nonFunctions=${JSON.stringify(nonFunctions)}`,
)

const genericEscape = await evaluate(
  "['invoke','send','on','ipcRenderer','require','process'].filter((k) => typeof window[k] !== 'undefined' || (window.cunlian && typeof window.cunlian[k] !== 'undefined'))",
)
check('没有通用 IPC 转义口 / Node 全局', Array.isArray(genericEscape) && genericEscape.length === 0, `got=${JSON.stringify(genericEscape)}`)

const chrome = await evaluate(`(async () => {
  const api = window.cunlianDesktop
  return {
    keys: Object.keys(api).sort(),
    info: api.windowChrome,
    frozen: Object.isFrozen(api.windowChrome),
    light: await api.setTitleBarTheme('light'),
    dark: await api.setTitleBarTheme('dark'),
    rejectsInvalid: await api.setTitleBarTheme('invalid').then(() => false, () => true),
  }
})()`)
const expectedChrome = {
  platform: process.platform,
  hasCustomTitlebar: true,
  titlebarHeightPx: 36,
  rightInsetPx: process.platform === 'win32' ? 138 : 0,
  leftInsetPx: process.platform === 'darwin' ? 72 : 0,
}
check(
  '原生窗口桥只暴露只读元数据和主题方法，支持深浅主题并拒绝非法参数',
  JSON.stringify(chrome.keys) === JSON.stringify(['setTitleBarTheme', 'windowChrome']) &&
    Object.entries(expectedChrome).every(([key, value]) => chrome.info[key] === value) &&
    chrome.frozen && chrome.light.ok && chrome.dark.ok && chrome.rejectsInvalid,
  `got=${JSON.stringify(chrome)}`,
)

const resourceUrls = await evaluate(
  'performance.getEntriesByType("resource").map((entry) => entry.name)',
)
const remoteResources = (resourceUrls ?? []).filter((url) => !String(url).startsWith('file:'))
check('页面没有远程资源请求', remoteResources.length === 0, `remote=${JSON.stringify(remoteResources)}`)

const frameBridge = await evaluate(`(() => {
  const frame = document.createElement('iframe')
  frame.srcdoc = '<!doctype html><html><body>frame</body></html>'
  document.body.appendChild(frame)
  const result = [typeof frame.contentWindow.cunlian, typeof frame.contentWindow.cunlianDesktop]
  frame.remove()
  return result
})()`)
check('子框架拿不到 preload 桥', frameBridge?.length === 2 && frameBridge.every((value) => value === 'undefined'), `got=${frameBridge}`)

// 记录真实 renderer 收到的 editor:flush，回复由旧工作台的会话适配器发送。
const flushSeen = await evaluate(`(async () => {
  window.__flushRequestId = null
  window.cunlian.onEditorFlush((payload) => {
    window.__flushRequestId = payload.requestId
  })
  const result = await window.cunlian.requestClose()
  return { result, flushRequestId: window.__flushRequestId }
})()`)
check(
  'requestClose 经编辑屏障后返回 closed',
  flushSeen?.result?.ok === true && flushSeen?.result?.value?.closed === true,
  `got=${JSON.stringify(flushSeen?.result)}`,
)
check('renderer 实际收到 editor:flush', typeof flushSeen?.flushRequestId === 'string', `got=${flushSeen?.flushRequestId}`)

// 窗口应在回复后销毁：page target 消失。
let targetGone = false
for (let attempt = 0; attempt < 40; attempt += 1) {
  await sleep(150)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`)
    const targets = await response.json()
    if (!targets.some((entry) => entry.type === 'page')) {
      targetGone = true
      break
    }
  } catch {
    targetGone = true
    break
  }
}
check('关闭流程结束后窗口销毁', targetGone)

try {
  socket.close()
} catch {
  // 窗口已销毁时连接可能已断开
}
if (childExit === null) {
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
}
console.log(failures.length === 0 ? 'E2E_RESULT=PASS' : `E2E_RESULT=FAIL(${failures.join(',')})`)
process.exit(failures.length === 0 ? 0 : 1)
