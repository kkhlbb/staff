// S05 evidence only: real packaged main/preload/renderer and PDF renderer.
// Debugger substitutes ONLY native dialog answers. No model/network/auto-save.
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { loadProjectCodec, loadPdfTextExtract } from './real-docs/tsImport.mjs'

const [executableArg, outArg] = process.argv.slice(2)
if (!executableArg || !outArg) throw Error('Usage: node scripts/saved-export-packaged.mjs <packaged executable> <new output directory>')
const executable = path.resolve(executableArg), out = path.resolve(outArg)
await fs.mkdir(out, { recursive: true })
const { encodeProjectFile, decodeProjectFile } = await loadProjectCodec()
const { createRequirementProject } = await import('../src/requirements/__fixtures__/requirementFixture.ts')
const { rebuildDrawingFromProject } = await import('../src/drawing/rebuildDrawing.ts')
const { renderDrawingSvg, validateDrawingSvgMarkup } = await import('../src/drawing/renderDrawingSvg.ts')
const { snapshot } = await createRequirementProject()
const encoded = await encodeProjectFile(snapshot)
assert.ok(encoded.ok)
const fixture = path.join(out, 'saved-project.cunlian')
await fs.writeFile(fixture, encoded.value.bytes, { flag: 'wx' })
const before = await fs.readFile(fixture)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
// The isolated config has no model provider or credentials. Never read a developer key.
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_TOKEN|AUTH_TOKEN/.test(key)) delete env[key]
const child = spawn(executable, ['--inspect=9501', '--remote-debugging-port=9502', `--user-data-dir=${path.join(out, 'user-data')}`], { env, cwd: out, stdio: ['ignore', 'pipe', 'pipe'] })
const childExit = new Promise(resolve => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', error => resolve({ error: error.message })) })
let output = ''
child.stdout.on('data', data => { output += data })
child.stderr.on('data', data => { output += data })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const sockets = []
async function connect(port) {
  for (let attempt = 0; attempt < 120; attempt++) {
    let targets
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() } catch { await sleep(100); continue }
    const target = targets.find(item => item.webSocketDebuggerUrl && (port === 9501 || item.type === 'page'))
    if (!target) { await sleep(100); continue }
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    sockets.push(socket)
    let id = 0
    const pending = new Map()
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), entry = pending.get(message.id)
      if (entry) { clearTimeout(entry.timer); pending.delete(message.id); entry.resolve(message) }
    })
    socket.addEventListener('close', () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('inspector closed')) }; pending.clear() })
    const send = (method, params) => new Promise((resolve, reject) => {
      const requestId = ++id
      const timer = setTimeout(() => { pending.delete(requestId); reject(Error(`timeout: ${method}`)) }, 40000)
      pending.set(requestId, { resolve, reject, timer })
      socket.send(JSON.stringify({ id: requestId, method, params }))
    })
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (response.error || response.result?.exceptionDetails) throw Error(JSON.stringify(response))
      return response.result?.result?.value
    }
    return { evaluate, send }
  }
  throw Error(`inspector unavailable ${port}: ${output}`)
}
const results = { scope: 'Packaged product, native dialogs substituted via debugger; not native dialog UX or paid-model verification', checks: [] }
let main, renderer
const check = (name, condition) => { results.checks.push({ name, passed: Boolean(condition) }); assert.ok(condition, name); console.log(`PASS ${name}`) }
async function waitFor(expression) {
  for (let i = 0; i < 100; i++) { if (await renderer.evaluate(expression)) return; await sleep(100) }
  throw Error(`condition timeout ${expression}`)
}
async function screenshot(name) {
  const response = await renderer.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  assert.ok(response.result?.data)
  await fs.writeFile(path.join(out, name + '.png'), Buffer.from(response.result.data, 'base64'), { flag: 'wx' })
}
async function selectTarget(file) {
  await main.evaluate(`globalThis.__s05.dialog.showSaveDialog=async()=>{globalThis.__s05Picks++;return {canceled:false,filePath:${JSON.stringify(file)}}};true`)
}
try {
  main = await connect(9501)
  await main.evaluate(`globalThis.__s05=process.mainModule.require('electron');globalThis.__s05Picks=0;globalThis.__s05.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(fixture)}]});true`)
  renderer = await connect(9502)
  await waitFor(`Boolean(window.cunlian && [...document.querySelectorAll('button')].some(b=>b.textContent==='打开项目…' && !b.disabled))`)
  await renderer.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='打开项目…').click();true`)
  await waitFor(`Boolean(document.querySelector('main[aria-label="寸链桌面工作台"]'))`)
  await renderer.evaluate(`[...document.querySelectorAll('[role="tab"]')].find(b=>b.textContent==='尺寸链').click();true`)
  await waitFor(`Boolean(document.querySelector('input[aria-label*="H 基本尺寸"]'))`)
  const initial = await renderer.evaluate('window.cunlian.reattachSession()')
  check('actual UI opened saved fixture with acceptedSeq=savedSeq=0', initial.ok && initial.value.editSeq === 0 && initial.value.savedSeq === 0)
  results.runtime = await main.evaluate('({electron:process.versions.electron,resourcesPath:process.resourcesPath,userData:globalThis.__s05.app.getPath("userData")})')
  check('isolated product user data', results.runtime.userData === path.join(out, 'user-data'))
  const refusedTarget = path.join(out, 'unsaved-must-not-exist.svg')
  await selectTarget(refusedTarget)
  // UI handler calls the actual adapter.edit synchronously. Immediately query main,
  // then export within the default 250ms debounce, without sleeping for stage.
  const dirty = await renderer.evaluate(`(async()=>{
    const input=document.querySelector('input[aria-label*="H 基本尺寸"]');
    const start=performance.now();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'52.21');
    input.dispatchEvent(new Event('input',{bubbles:true}));
    const before=await window.cunlian.reattachSession();
    const result=await window.cunlian.exportApprovedVersion({format:'svg'});
    return {before,result,elapsedMs:performance.now()-start,ui:document.querySelector('.desktop-workspace__titlebar')?.innerText,after:await window.cunlian.reattachSession()};
  })()`)
  results.dirty = dirty
  check('export began while main was still clean (renderer debounce window)', dirty.before.ok && dirty.before.value.editSeq === 0 && dirty.before.value.savedSeq === 0)
  check('unsaved product export says save first', !dirty.result.ok && dirty.result.code === 'SAVE_FAILED' && dirty.result.message.includes('先保存'))
  check('barrier received pending UI edit without saving', dirty.after.value.editSeq === 1 && dirty.after.value.savedSeq === 0)
  check('unsaved rejection never opened target dialog', await main.evaluate('globalThis.__s05Picks') === 0)
  await assert.rejects(fs.stat(refusedTarget), { code: 'ENOENT' })
  check('source bytes unchanged after refusal', before.equals(await fs.readFile(fixture)))
  await screenshot('unsaved-refused')
  await renderer.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='保存' && b.closest('[role="toolbar"]')).click();true`)
  await waitFor(`(async()=>{const s=await window.cunlian.reattachSession();return s.ok&&s.value.editSeq===1&&s.value.savedSeq===1})()`)
  const persisted = await fs.readFile(fixture), decoded = await decodeProjectFile(persisted)
  check('explicit UI save changed source and decoded successfully', !before.equals(persisted) && decoded.ok)
  results.savedSha256 = digest(persisted)
  const rebuilt = rebuildDrawingFromProject(decoded.value.snapshot.project)
  assert.ok(rebuilt.ok)
  results.exports = []
  for (const format of ['svg', 'pdf']) {
    const target = path.join(out, `saved-drawing.${format}`)
    await selectTarget(target)
    const receipt = await renderer.evaluate(`window.cunlian.exportApprovedVersion({format:${JSON.stringify(format)}})`)
    results.exports.push({ format, target, receipt })
    check(`${format} product export succeeded`, receipt.ok && receipt.data.status === 'EXPORTED')
    const bytes = await fs.readFile(target)
    check(`${format} actual readback size/hash matches service receipt`, receipt.data.byteSize === bytes.length && receipt.data.sha256 === digest(bytes))
    check(`${format} actual content header`, format === 'svg' ? bytes.toString('utf8').includes('<svg') : bytes.subarray(0, 5).toString() === '%PDF-')
    if (format === 'svg') {
      check('SVG readback exactly renders saved snapshot and passes drawing structure validation', bytes.toString('utf8') === renderDrawingSvg(rebuilt.data) && validateDrawingSvgMarkup(bytes.toString('utf8'), rebuilt.data).ok)
    } else {
      const { extractPdfTextPages } = await loadPdfTextExtract()
      const pages = await extractPdfTextPages(bytes, { from: 1, to: 1 })
      results.pdfReadback = pages
      check('PDF actual parser readback contains saved length annotation', pages.length === 1 && pages[0].items.map(item => item.str).join(' ').includes('12.000'))
    }
  }
  await screenshot('saved-exported')
  results.status = 'PASS'
} catch (error) {
  results.status = 'FAIL'; results.error = error.stack
  if (renderer) await screenshot('failure').catch(() => {})
  throw error
} finally {
  if (main) { try { await main.evaluate('setTimeout(()=>globalThis.__s05.app.exit(0),30);true') } catch { /* closed already */ } }
  for (const socket of sockets) socket.close()
  let exit = await Promise.race([childExit, sleep(5000).then(() => null)])
  if (!exit) { child.kill('SIGTERM'); exit = await childExit }
  results.processExit = exit
  await fs.writeFile(path.join(out, 'electron.log'), output, { flag: 'wx' })
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(results, null, 2) + '\n', { flag: 'wx' })
  assert.deepEqual(exit, { code: 0, signal: null })
}
