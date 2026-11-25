/** Smoke test for the real packaged macOS GUI and bundled stdio client. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { LocalM1Client } from '../../../mcp/localClient.ts'
import { localM1Socket, M1_LAUNCH_ARGUMENT } from '../../main/project-agent/m1LocalTransport.ts'

const work = path.resolve('out')
const args = process.argv.slice(2)
const interactive = args.includes('--interactive')
const source = path.resolve(args.find(arg => arg !== '--interactive') ?? path.join(work, '寸链-darwin-arm64/寸链.app'))
await mkdir(work, { recursive: true })
const testRoot = await mkdtemp(path.join(work, 'Local Agent Smoke '))
const env = { PATH: '/usr/bin:/bin', CUN_LIAN_MCP_VERBOSE: '1' }
const bundle = path.join(testRoot, path.basename(source))
const executable = path.join(bundle, 'Contents/MacOS/寸链')
const bridgeCommand = path.join(bundle, 'Contents/Resources/cunlian-agent/cunlian-mcp')
const peerHelper = path.join(path.dirname(bridgeCommand), 'm1-peer')
const children = []
let inspector
let desktopOutput = ''
let testSocket

function child(command, args) {
  const proc = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
  children.push(proc)
  return proc
}

async function target(proc) {
  const lines = createInterface({ input: proc.stderr })
  for await (const line of lines) {
    const address = /Debugger listening on (ws:\/\/\S+)/.exec(line)?.[1]
    if (address) return address
  }
  throw Error('Main-process inspector did not start')
}

async function quitDesktop(address) {
  inspector = new WebSocket(address)
  await once(inspector, 'open')
  inspector.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
    params: { expression: `(() => {
      const { app, BrowserWindow } = process.mainModule.require('electron');
      setTimeout(() => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
        app.quit();
      }, 100);
      return true;
    })()` } }))
  const [event] = await once(inspector, 'message')
  const reply = JSON.parse(event.data)
  assert.equal(reply.result.result.value, true, JSON.stringify(reply))
  inspector.close()
}

try {
  await cp(source, bundle, { recursive: true, verbatimSymlinks: true })
  const socketPath = localM1Socket(executable)
  testSocket = socketPath
  await assert.rejects(lstat(socketPath), { code: 'ENOENT' })
  let desktop
  let address
  const client = new LocalM1Client({
    executable, socketPath, peerHelper,
    async launch(command, args) {
      assert.equal(command, executable)
      assert.deepEqual(args, [M1_LAUNCH_ARGUMENT])
      desktop = child(command, [...args, `--user-data-dir=${path.join(testRoot, 'Isolated Profile')}`, '--inspect=0'])
      desktop.stderr.on('data', chunk => { desktopOutput += String(chunk) })
      address = await target(desktop)
    },
  })
  client.initialize('Packaged cold launch probe')
  try {
    assert.equal((await client.call('capabilities', {})).protocol, 1)
  } finally {
    client.close()
  }
  assert.equal((await lstat(socketPath)).mode & 0o777, 0o600)
  console.log('PASS real packaged desktop cold launch, absolute path with spaces, kernel peer and socket permissions')

  const bridge = child(bridgeCommand, [])
  let stderr = ''
  bridge.stderr.on('data', chunk => { stderr += String(chunk) })
  const lines = createInterface({ input: bridge.stdout })[Symbol.asyncIterator]()
  let nextId = 0
  async function request(method, params) {
    const id = ++nextId
    bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    const line = await Promise.race([lines.next(), delay(interactive ? 110_000 : 15_000, undefined, { ref: false }).then(() => {
      throw Error('MCP frame timeout')
    })])
    const reply = JSON.parse(line.value)
    assert.equal(reply.jsonrpc, '2.0')
    assert.equal(reply.id, id)
    assert.ok(reply.result)
    return reply.result
  }
  const call = (name, args) => request('tools/call', { name, arguments: args })
  const hello = await request('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'MCP stdio smoke', version: '1' },
  })
  assert.equal(hello.serverInfo.name, 'cunlian-local')
  bridge.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
  const listed = await request('tools/list', {})
  assert.deepEqual(listed.tools.map(tool => tool.name), ['capabilities', 'authorizeProject', 'getContext',
    'getExternalActivities', 'acquireWriter', 'takeOverWriter', 'readWriterContext', 'stageChange', 'revokeWriter'])
  assert.equal((await call('capabilities', {})).structuredContent.protocol, 1)
  const denied = await call('getExternalActivities', { projectId: 'not-authorized' })
  assert.equal(denied.isError, true)
  assert.equal(JSON.parse(denied.content[0].text).error.code, 'AUTH_REQUIRED')
  if (interactive) {
    const fixture = path.join(testRoot, 'Spacer Fixture.cunlian')
    await cp(path.resolve('docs/evidence/v40-stage4/fixtures/a40-1204.cunlian'), fixture)
    console.log(`Open ${fixture} in ${bundle}, then press Enter in this terminal.`)
    const formalBytes = await readFile(fixture)
    const input = createInterface({ input: process.stdin })
    await once(input, 'line')
    input.close()
    process.stdin.pause()
    const project = { projectId: 'project-a' }
    console.log('Reject external project access in the native sheet.')
    const rejection = await call('authorizeProject', project)
    assert.equal(rejection.isError, true)
    assert.equal(JSON.parse(rejection.content[0].text).error.code, 'AUTH_REQUIRED')
    console.log('Approve external project access in the native sheet.')
    assert.deepEqual((await call('authorizeProject', project)).structuredContent, { ...project, authorized: true })
    const context = (await call('getContext', project)).structuredContent
    assert.equal(context.snapshot.writer.occupied, false)
    console.log('Approve writing the spacer draft in the native sheet.')
    const lease = (await call('acquireWriter', { ...project, expectedWriterEpoch: context.snapshot.writer.epoch })).structuredContent
    assert.deepEqual(Object.keys(lease).sort(), ['baseRevision', 'draftRevision', 'writerEpoch'])
    const change = { ...project, change: { baseRevision: context.baseRevision, expectedDraftRevision: lease.draftRevision,
      idempotencyKey: 'gui-ask', operation: { type: 'createSpacerDraft' }, sources: {} } }
    const clarification = (await call('stageChange', change)).structuredContent
    assert.equal(clarification.activity.status, 'awaitingInput')
    assert.deepEqual((await call('stageChange', change)).structuredContent, clarification)
    const userInput = { type: 'userInput' }
    const resume = { ...project, change: { ...change.change, idempotencyKey: 'gui-resume',
      operation: { type: 'resumeSpacerDraft', taskId: clarification.activity.taskId,
        innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120000 },
      sources: { innerDiameterQ: userInput, outerDiameterQ: userInput, lengthQ: userInput } } }
    const drafted = (await call('stageChange', resume)).structuredContent
    assert.ok(drafted.draftRevision)
    const activities = (await call('getExternalActivities', project)).structuredContent
    assert.equal(activities.draftRevision, drafted.draftRevision)
    assert.equal(activities.activities[0].status, 'succeeded')
    assert.equal(activities.activities[0].source, 'external')
    assert.deepEqual(await readFile(fixture), formalBytes)
    console.log('PASS native read denial, read approval, writer approval, clarification, idempotency and resumed draft')
  }
  bridge.stdin.end()
  assert.deepEqual(await once(bridge, 'close'), [0, null])
  assert.ok((await lines.next()).done)
  assert.match(stderr, /tools\/call capabilities/)
  console.log('PASS packaged stdio, system-only PATH, warm handshake, unauthorized read and JSON-RPC-only stdout')

  await quitDesktop(address)
  const exit = await Promise.race([once(desktop, 'exit'), delay(10_000, undefined, { ref: false }).then(() => {
    throw Error('Desktop shutdown timeout')
  })])
  assert.deepEqual(exit, [0, null])
  await assert.rejects(lstat(socketPath), { code: 'ENOENT' })
  console.log('PASS Electron quit closes and removes the endpoint')
} catch (error) {
  process.stderr.write(desktopOutput)
  throw error
} finally {
  inspector?.close()
  await Promise.all(children.filter(proc => proc.exitCode === null && proc.signalCode === null).map(async proc => {
    proc.kill('SIGKILL')
    await once(proc, 'exit')
  }))
  if (testSocket) await rm(path.dirname(testSocket), { recursive: true, force: true })
  await rm(testRoot, { recursive: true, force: true })
}
