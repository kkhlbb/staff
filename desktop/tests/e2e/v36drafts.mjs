#!/usr/bin/env node
/**
 * V3.6 多草稿打包应用走查（1+3 方案）：真实 .app + CDP + open-file（无文件对话框）。
 *
 * 步骤：打开含两份草稿的项目（同一 PDF 版本 + 同一页范围：document-extractor-1
 * 已确认 1 条 / document-extractor-6 全待确认）→ 任务书提取页：
 * 1) 默认显示新草稿（顶部写明版本 + 草稿 id），候选列表与计数都来自它；
 * 2) 旧草稿折叠成一行（版本/候选数/已确认数/被谁取代）；
 * 3) 展开旧草稿：候选可见、确认/编辑/拒绝禁用且有原因文案、定位可用；
 * 4) 删除必须二次确认（写明已确认决定数）→ 确认后只删该草稿；
 * 5) 角标与提取页计数一致；
 * 6) 保存 → 退出重启 → 重开同文件：只剩新草稿且仍默认选中。
 *
 * 用法：node desktop/tests/e2e/v36drafts.mjs [appExecutable] [port]
 * 截图：docs/evidence/V3.6/screenshots/；状态摘要：docs/evidence/V3.6/drafts-e2e.json
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import path from 'node:path'

const appExecutable =
  process.argv[2] ??
  path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9375)
const SEED = '/Users/aston/DSH/tmp/cunlian-v36-drafts/DRAFTS-V36.cunlian'
const WORK = '/Users/aston/DSH/tmp/cunlian-v36-drafts/DRAFTS-V36-run.cunlian'
const SHOTS = path.join(process.cwd(), 'docs', 'evidence', 'V3.6', 'screenshots')
const SUMMARY = path.join(process.cwd(), 'docs', 'evidence', 'V3.6', 'drafts-e2e.json')

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}，先运行 npm run package:desktop -- --arch=arm64`)
  process.exit(2)
}
if (!existsSync(SEED)) {
  console.error(
    `BLOCKED: 缺少证据项目 ${SEED}（先运行 V36_DRAFTS_SEED_OUT=${SEED} npx vitest run --config vitest.v36fixture.config.ts）`,
  )
  process.exit(2)
}
await fsp.mkdir(SHOTS, { recursive: true })
await fsp.copyFile(SEED, WORK)

const bundle = path.resolve(path.dirname(appExecutable), '../..')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const summary = {}

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

async function draftsFromSession() {
  return evaluate(`(async () => {
    const current = await window.cunlian.reattachSession()
    if (!current.ok || !current.value.sessionId) return { drafts: [], savedSeq: null, editSeq: null }
    const drafts = current.value.snapshot.project.extractionDrafts
    return {
      drafts: drafts.map((draft) => ({
        draftId: draft.draftId,
        extractorVersion: draft.extractorVersion,
        candidates: draft.candidates.length,
        confirmed: draft.candidates.filter((candidate) => candidate.status === 'confirmed').length,
        decisions: draft.decisions.length,
      })),
      savedSeq: current.value.savedSeq,
      editSeq: current.value.editSeq,
    }
  })()`)
}

try {
  await launch()
  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(1200)
  await openProject()
  await openExtractionTab()
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('[data-testid="extraction-current-draft"]'))`),
    'current draft header',
  )
  await sleep(500)

  // A) 默认显示最新规则版本的草稿：候选列表与计数都来自它。
  const current = await evaluate(`(() => {
    const header = document.querySelector('[data-testid="extraction-current-draft"]').textContent
    const list = document.querySelector('[aria-label="提取候选列表"]')
    const rows = list ? list.querySelectorAll('.extraction-review__candidate') : []
    return {
      header,
      rows: rows.length,
      statuses: [...rows].map((row) => row.getAttribute('data-status')),
      counts: document.querySelector('.extraction-review__counts')?.textContent ?? null,
      badge: document.querySelector('[data-testid="extraction-pending-badge"]')?.textContent ?? null,
      supersededRows: document.querySelectorAll('.extraction-review__superseded-row').length,
      foldedHeadline: document.querySelector('.extraction-review__superseded-headline')?.textContent ?? null,
    }
  })()`)
  assert(current.header.includes('document-extractor-6'), `默认草稿应为 v5，实际：${current.header}`)
  assert(current.rows === 7, `新草稿候选应为 7 条，实际 ${current.rows}`)
  assert(current.header.includes('draft-'), '顶部必须写出草稿 id')
  assert(current.counts.includes('待确认 7'), `新草稿计数应为待确认 7，实际：${current.counts}`)
  assert(current.badge === '待确认 7', `角标应与当前草稿一致（待确认 7），实际：${current.badge}`)
  await shot('v36-12-multidraft-default-new')

  // B) 旧草稿折叠成一行：版本/候选数/已确认数/被谁取代。
  summary.beforeDelete = { ...current, session: await draftsFromSession() }
  assert(current.supersededRows === 1, `旧草稿应为 1 行折叠，实际 ${current.supersededRows}`)
  assert(
    current.foldedHeadline.includes('旧规则版本（document-extractor-1）'),
    `折叠行版本不对：${current.foldedHeadline}`,
  )
  assert(current.foldedHeadline.includes('共 7 条候选（已确认 1）'), `折叠行候选/确认数不对：${current.foldedHeadline}`)
  assert(current.foldedHeadline.includes('已被 v3 取代'), `折叠行缺少取代说明：${current.foldedHeadline}`)
  await evaluate(`(() => {
    const row = document.querySelector('.extraction-review__superseded-row')
    row.scrollIntoView({ block: 'center' })
    return true
  })()`)
  await sleep(300)
  await shot('v36-12b-old-draft-folded-row')

  // C) 展开旧草稿：候选可看、确认/编辑/拒绝禁用且有原因文案、定位可用。
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.extraction-review__superseded button')]
      .find((item) => item.textContent === '展开查看旧草稿候选')
    if (!button) throw new Error('未找到展开按钮')
    button.click()
    return true
  })()`)
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('[aria-label^="旧草稿候选列表"]'))`),
    'old draft candidate list',
  )
  const oldRows = await evaluate(`(() => {
    const list = document.querySelector('[aria-label^="旧草稿候选列表"]')
    const rows = [...list.querySelectorAll('.extraction-review__candidate')]
    const first = rows[0]
    const button = (label) => [...first.querySelectorAll('button')].find((item) => item.textContent === label)
    return {
      rows: rows.length,
      note: first.querySelector('.extraction-review__readonly')?.textContent ?? null,
      confirmDisabled: button('确认')?.disabled ?? null,
      confirmTitle: button('确认')?.title ?? null,
      rejectDisabled: button('拒绝…')?.disabled ?? null,
      editDisabled: button('编辑…')?.disabled ?? null,
      locateDisabled: button('定位到 PDF 选区')?.disabled ?? null,
      checkboxDisabled: first.querySelector('input[type="checkbox"]')?.disabled ?? null,
    }
  })()`)
  assert(oldRows.rows === 7, `旧草稿候选应为 7 条，实际 ${oldRows.rows}`)
  assert(oldRows.confirmDisabled === true, '旧草稿的确认必须禁用')
  assert(oldRows.rejectDisabled === true, '旧草稿的拒绝必须禁用')
  assert(oldRows.editDisabled === true, '旧草稿的编辑必须禁用')
  assert(oldRows.checkboxDisabled === true, '旧草稿的候选选择必须禁用')
  assert(oldRows.locateDisabled === false, '旧草稿的定位必须可用')
  assert(
    (oldRows.note ?? '').includes('旧规则版本，请在新版（document-extractor-6）上复核后确认'),
    `旧草稿必须写明原因，实际：${oldRows.note}`,
  )
  summary.expandedOldDraft = oldRows
  await evaluate(`(() => {
    const list = document.querySelector('[aria-label^="旧草稿候选列表"]')
    list.scrollIntoView({ block: 'start' })
    return true
  })()`)
  await sleep(400)
  await shot('v36-13-old-draft-expanded-readonly')

  // D) 删除必须二次确认，确认框写明已确认决定数。
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.extraction-review__superseded button')]
      .find((item) => item.textContent === '删除该旧草稿…')
    if (!button) throw new Error('未找到删除按钮')
    button.click()
    return true
  })()`)
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('[aria-label="删除旧草稿确认"]'))`),
    'delete confirmation',
  )
  const confirmBox = await evaluate(`(() => {
    const box = document.querySelector('[aria-label="删除旧草稿确认"]')
    return {
      alert: box.querySelector('[role="alert"]')?.textContent ?? null,
      buttons: [...box.querySelectorAll('button')].map((item) => item.textContent),
    }
  })()`)
  assert(
    (confirmBox.alert ?? '').includes('该草稿有 1 条已确认决定，删除后不可恢复'),
    `确认框必须写明已确认决定数，实际：${confirmBox.alert}`,
  )
  summary.deleteConfirm = confirmBox
  await evaluate(`(() => {
    document.querySelector('[aria-label="删除旧草稿确认"]').scrollIntoView({ block: 'center' })
    return true
  })()`)
  await sleep(300)
  await shot('v36-14-delete-confirm')

  // E) 确认删除：只删该草稿，另一个草稿与项目数据完好；角标与计数同步。
  await evaluate(`(() => {
    const box = document.querySelector('[aria-label="删除旧草稿确认"]')
    const button = [...box.querySelectorAll('button')].find((item) => item.textContent === '确认删除')
    button.click()
    return true
  })()`)
  await waitFor(
    () => evaluate(`document.querySelectorAll('.extraction-review__superseded-row').length === 0`),
    'old draft removed',
  )
  await sleep(500)
  const afterDelete = await evaluate(`(() => ({
    header: document.querySelector('[data-testid="extraction-current-draft"]')?.textContent ?? null,
    rows: document.querySelectorAll('[aria-label="提取候选列表"] .extraction-review__candidate').length,
    counts: document.querySelector('.extraction-review__counts')?.textContent ?? null,
    badge: document.querySelector('[data-testid="extraction-pending-badge"]')?.textContent ?? null,
    message: document.querySelector('.extraction-review__message')?.textContent ?? null,
    supersededRows: document.querySelectorAll('.extraction-review__superseded-row').length,
  }))()`)
  const afterSession = await draftsFromSession()
  assert(afterDelete.supersededRows === 0, '删除后不应再有旧草稿行')
  assert((afterDelete.header ?? '').includes('document-extractor-6'), '删除后仍应显示新草稿')
  assert(afterSession.drafts.length === 1, `删除后应只剩 1 份草稿，实际 ${afterSession.drafts.length}`)
  assert(afterSession.drafts[0].extractorVersion === 'document-extractor-6', '剩下的必须是新草稿')
  assert(afterDelete.badge === '待确认 7', `删除后角标应与当前草稿一致，实际 ${afterDelete.badge}`)
  assert((afterDelete.counts ?? '').includes('待确认 7'), `删除后计数应为待确认 7，实际 ${afterDelete.counts}`)
  summary.afterDelete = { ...afterDelete, session: afterSession }
  await shot('v36-15-old-draft-deleted')

  // F) 显式保存。
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
    'saved',
    20000,
  )
  summary.saved = await draftsFromSession()

  // G) 退出重启，重开同一文件：只剩新草稿且仍默认选中。
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
    () => evaluate(`Boolean(document.querySelector('[data-testid="extraction-current-draft"]'))`),
    'current draft after reopen',
  )
  await sleep(500)
  const reopened = await evaluate(`(() => ({
    header: document.querySelector('[data-testid="extraction-current-draft"]')?.textContent ?? null,
    rows: document.querySelectorAll('[aria-label="提取候选列表"] .extraction-review__candidate').length,
    supersededRows: document.querySelectorAll('.extraction-review__superseded-row').length,
    badge: document.querySelector('[data-testid="extraction-pending-badge"]')?.textContent ?? null,
  }))()`)
  const reopenedSession = await draftsFromSession()
  assert(reopenedSession.drafts.length === 1, `重开后应只剩 1 份草稿，实际 ${reopenedSession.drafts.length}`)
  assert(
    reopenedSession.drafts[0].extractorVersion === 'document-extractor-6',
    '重开后默认草稿必须是新规则版本',
  )
  assert((reopened.header ?? '').includes('document-extractor-6'), '重开后顶部应显示新草稿')
  assert(reopened.supersededRows === 0, '重开后不应再有旧草稿行')
  assert(reopened.badge === '待确认 7', `重开后角标应为待确认 7，实际 ${reopened.badge}`)
  summary.reopened = { ...reopened, session: reopenedSession }
  await shot('v36-16-reopened-single-draft')

  summary.result = 'PASS'
  await fsp.writeFile(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(`SUMMARY ${SUMMARY}`)
  console.log('RESULT PASS')
} catch (error) {
  summary.result = `FAIL: ${error instanceof Error ? error.message : String(error)}`
  await fsp.writeFile(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`)
  console.error(summary.result)
  process.exitCode = 1
} finally {
  try {
    socket?.close()
  } catch {
    // 已关闭
  }
  if (child !== null && childExit === null) child.kill('SIGKILL')
}
