/** Real packaged Electron preload and macOS confirmation sheet. Uses a disposable profile and project copy. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'

const out = path.resolve('out')
const source = path.resolve(process.argv[2] ?? path.join(out, '寸链-darwin-arm64/寸链.app'))
const folder = await mkdtemp(path.join(out, 'M1 Workbench GUI '))
const bundle = path.join(folder, path.basename(source))
let desktop
let inspector
let logs = ''
let serial = 0

async function eventually(probe) {
  for (let tries = 0; tries < 80; tries++) {
    const result = await probe()
    if (result) return result
    await delay(125)
  }
  throw Error('Timed out waiting for the expected GUI state')
}

function evaluate(expression) {
  return new Promise((resolve, reject) => {
    const id = ++serial
    const handle = ({ data }) => {
      const packet = JSON.parse(data)
      if (packet.id !== id) return
      inspector.removeEventListener('message', handle)
      if (packet.result?.exceptionDetails) reject(Error(JSON.stringify(packet.result.exceptionDetails)))
      else if (packet.error) reject(Error(JSON.stringify(packet.error)))
      else resolve(packet.result.result.value)
    }
    inspector.addEventListener('message', handle)
    inspector.send(JSON.stringify({ id, method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true } }))
  })
}
const renderer = code => evaluate(`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript(${JSON.stringify(code)})`)

function select(button, result) {
  console.log(`In the isolated app, click 「${button}」. App path: ${bundle}`)
  return Promise.race([result, delay(120_000, undefined, { ref: false }).then(() => {
    throw Error('Timed out waiting for the native confirmation')
  })])
}

try {
  await cp(source, bundle, { recursive: true, verbatimSymlinks: true })
  const fixture = path.join(folder, 'Spacer Fixture.cunlian')
  await cp(path.resolve('docs/evidence/v40-stage4/fixtures/a40-1204.cunlian'), fixture)
  const original = await readFile(fixture)
  desktop = spawn(path.join(bundle, 'Contents/MacOS/寸链'), [
    '--inspect=0', `--user-data-dir=${path.join(folder, 'profile')}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  desktop.stderr.on('data', chunk => { logs += String(chunk) })
  const lines = createInterface({ input: desktop.stderr })
  let url
  for await (const line of lines) {
    url = /Debugger listening on (ws:\/\/\S+)/.exec(line)?.[1]
    if (url) break
  }
  assert.ok(url, logs)
  inspector = new WebSocket(url)
  await once(inspector, 'open')
  const methodGroups = [
    'm1WorkbenchBridge',
    'm2WorkbenchBridge',
    'm3WorkbenchBridge',
  ]
  const methods = []
  for (const [index, module] of methodGroups.entries()) {
    const frontend = await readFile(path.resolve(`src/workspace/project-agent/${module}.ts`), 'utf8')
    const table = frontend.match(/WORKBENCH_BRIDGE_METHODS = \[([^\]]+)\] as const/)
    assert.ok(table, module)
    const groupMethods = [...table[1].matchAll(/'([^']+)'/g)].map(match => match[1])
    assert.equal(groupMethods.length, [9, 5, 5][index], module)
    methods.push(...groupMethods)
  }
  assert.equal(new Set(methods).size, 19)
  const workbench = 'main[aria-label="寸链 M1 双入口工作台"]'
  await eventually(() => renderer(`Boolean(document.querySelector(${JSON.stringify(workbench)}))`))
  assert.equal(await renderer('location.hash'), '')
  assert.deepEqual(await renderer(`${JSON.stringify(methods)}.filter(name => typeof window.cunlian[name] !== 'function')`), [])
  await renderer(`document.querySelector('button[aria-label="更多操作"]').click()`)
  await eventually(() => renderer(`Boolean(document.querySelector('a[href="#/desktop-legacy"]'))`))
  await renderer(`document.querySelector('a[href="#/desktop-legacy"]').click()`)
  await eventually(() => renderer(`Boolean(document.querySelector('main[aria-label="寸链启动页"]'))`))
  assert.equal(await renderer('location.hash'), '#/desktop-legacy')
  await renderer('location.hash = "#/desktop"')
  await eventually(() => renderer(`Boolean(document.querySelector(${JSON.stringify(workbench)}))`))
  console.log('PASS packaged default route, legacy link, explicit desktop route and 19 preload methods')
  const install = await renderer('window.cunlian.getM1LocalAgentInstallInfo()')
  assert.equal(install.value.installPath, bundle)
  await evaluate(`process.mainModule.require('electron').app.emit('open-file', { preventDefault() {} }, ${JSON.stringify(fixture)})`)
  const request = { projectId: 'project-a', scopeEpoch: 1 }
  const query = `window.cunlian.getM1ConnectionStatus(${JSON.stringify(request)})`
  const opened = await eventually(async () => {
    const result = await renderer(query)
    return result?.ok && result.value
  })
  assert.equal(opened.authorizationState, 'unauthorized')
  await eventually(() => renderer(`document.querySelector('main h1')?.textContent === ${JSON.stringify(opened.projectName)}`))
  const m1 = { ...request, requestId: 'int01-probe' }
  const m2 = { projectId: request.projectId }
  const m3 = { ...m2, requestId: 'int01-probe' }
  const calls = {
    testM1ModelApiConnection: [{ ...m1, baseUrl: 'http://127.0.0.1:1', model: 'int01', apiKey: '', contextPreview: false }],
    sendM1ChatMessage: [{ ...m1, writerEpoch: 0, prompt: 'int01', attachments: [], selectedObject: null, history: [] }],
    cancelM1ChatMessage: [m1],
    getM1ExternalActivities: [request],
    reconnectM1Session: [{ ...m1, source: 'local-agent' }],
    getM2PreviewSnapshot: [m2],
    locateM2Evidence: [{ ...m2, revision: null, target: { kind: 'requirement', requirementId: 'int01' } }],
    retryM2Drawing: [{ ...m2, revision: 'draft-int01', requestId: 'int01-probe' }],
    submitM2Clarification: [{ ...m2, revision: null, targetId: 'int01', requestId: 'int01-probe', mode: 'answer', content: 'int01' }],
    commitM3ApprovedDraft: [{ ...m3, baseRevision: null, draftRevision: 'draft-int01', checkSetFingerprint: 'int01', confirmationToken: 'int01' }],
    undoDraftChange: [{ ...m3, draftRevision: null }],
    getMigrationReport: [m2],
    openExternalProjectResult: [m3],
  }
  for (const [name, args] of Object.entries(calls)) {
    const reply = await renderer(`window.cunlian[${JSON.stringify(name)}](...${JSON.stringify(args)})`)
    assert.equal(reply.ok, false, name)
    assert.equal(reply.error.code, name.includes('M1') || name.includes('M2') ? 'AUTH_REQUIRED' : 'UNAUTHORIZED', name)
  }
  console.log('PASS 13 request handlers return scoped authorization errors through packaged IPC')
  const consent = renderer(`window.cunlian.requestM1ProjectAuthorization({projectId:'project-a',requestId:'gui-auth',requestGeneration:1})`)
  assert.equal((await select('允许只读', consent)).ok, true)
  assert.equal((await renderer(query)).value.authorizationState, 'authorized-readonly')
  assert.equal((await renderer(`window.cunlian.getM2PreviewSnapshot(${JSON.stringify(m2)})`)).ok, true)
  assert.equal((await renderer(`window.cunlian.getMigrationReport(${JSON.stringify(m2)})`)).ok, true)
  assert.deepEqual(await renderer(`(async () => {
    const m2 = await window.cunlian.subscribeM2PreviewEvents(${JSON.stringify(m2)}, () => {})
    const m3 = await window.cunlian.subscribeM3ExternalProjectEvents(() => {})
    for (const stream of [m2, m3]) if (stream.ok) stream.value.unsubscribe()
    return [m2, m3].map(stream => stream.ok && typeof stream.value.subscriptionId === 'string')
  })()`), [true, true])
  console.log('PASS authorized M2/M3 reads and subscribe/unsubscribe receipts')
  assert.equal(await renderer(`(async () => {
    window.receivedM1 = []
    const stream = await window.cunlian.subscribeM1WorkbenchEvents(
      ${JSON.stringify(request)}, event => window.receivedM1.push(event))
    if (stream.ok) window.stopOldM1 = stream.value.unsubscribe
    return stream.ok
  })()`), true)
  const handoff = `window.cunlian.takeoverM1Draft({projectId:'project-a',draftRevision:null,requestId:'gui-handoff',
    previousScopeEpoch:1,nextScopeEpoch:2,targetSource:'model-api'})`
  const declined = renderer(handoff)
  assert.equal((await select('取消', declined)).error.code, 'AUTH_REQUIRED')
  const approved = renderer(handoff)
  const transfer = await select('接管草稿', approved)
  assert.equal(transfer.value.scopeEpoch, 2)
  assert.equal(transfer.value.writerEpoch, 1)
  const post = await renderer(`(async () => {
    const stream = await window.cunlian.subscribeM1WorkbenchEvents({projectId:'project-a',scopeEpoch:2,afterSequence:0},
      event => window.receivedM1.push(event))
    if (stream.ok) window.stopM1 = stream.value.unsubscribe
    return stream.ok
  })()`)
  assert.equal(post, true)
  const pushed = await eventually(async () => {
    const events = await renderer('window.receivedM1')
    return events.find(event => event.scopeEpoch === 2)
  })
  assert.equal(pushed.writerEpoch, 1)
  assert.equal(pushed.type, 'draft_updated')
  await renderer('window.stopOldM1(); window.stopM1()')
  assert.deepEqual(await readFile(fixture), original)
  console.log('PASS BrowserWindow/preload, native decline and approval, generation 2 event and unchanged file')
} catch (error) {
  console.error(logs)
  throw error
} finally {
  if (inspector?.readyState === WebSocket.OPEN) {
    await evaluate(`(() => {
      const { app, BrowserWindow } = process.mainModule.require('electron');
      setTimeout(() => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); app.quit() }, 100);
      return true
    })()`).catch(() => {})
    inspector.close()
  }
  if (desktop && desktop.exitCode === null && desktop.signalCode === null) {
    await Promise.race([once(desktop, 'exit'), delay(3000, false, { ref: false })])
    if (desktop.exitCode === null && desktop.signalCode === null) {
      const closed = once(desktop, 'exit')
      desktop.kill('SIGKILL')
      await closed
    }
  }
  await rm(folder, { recursive: true, force: true })
}
