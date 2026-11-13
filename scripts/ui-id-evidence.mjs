#!/usr/bin/env node
/** Real packaged Electron evidence; no DOM/content or API mocks.
 * node scripts/ui-id-evidence.mjs before|after|packaged [executable] [port]
 * before must point to an independently packaged fdd200d archive.
 * Fixture: isolated copy of the committed stage3 seed; built-in offline demo,
 * real main-process preview/approval/atomic commit. No real model/network used.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { serializeEvidence } from './evidence-json.ts'
const exec = promisify(execFile)
const root = process.cwd()
const label = process.argv[2] ?? 'after'
assert(['before', 'after', 'packaged'].includes(label))
const executable = path.resolve(process.argv[3] ?? 'out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链')
const bundle = path.resolve(path.dirname(executable), '../..')
const port = Number(process.argv[4] ?? 9461)
const out = path.join(root, 'docs/evidence/ui-id-leak')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const pending = new Map()
let socket, ownedPid, counter = 0
const result = { label, executable, viewport: [960, 640], fixture: 'Unmodified docs/evidence/v40-stage3/fixtures/stage3-seed.cunlian copied into isolated scratch; built-in offline normal demo; real approval and atomic commit.', screenshots: [], verdict: 'fail' }
function send(method, params = {}) {
  const id = ++counter
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result?.value
}
async function wait(predicate, name) {
  for (let n = 0; n < 200; n++) { if (await predicate()) return; await sleep(200) }
  throw Error(`Timeout ${name}`)
}
async function click(selector, text) {
  const point = await evaluate(`(() => {
    const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.textContent.trim().includes(${JSON.stringify(text)}));
    if(!el || el.disabled) throw Error('Missing/enabled '+${JSON.stringify(text)});
    el.scrollIntoView({block:'nearest',inline:'nearest'});
    const b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};
  })()`)
  await sleep(200)
  await send('Input.dispatchMouseEvent', {type:'mousePressed',...point,button:'left',clickCount:1})
  await send('Input.dispatchMouseEvent', {type:'mouseReleased',...point,button:'left',clickCount:1})
  await sleep(300)
}
async function shot(name) {
  await sleep(500)
  const data = await send('Page.captureScreenshot', { format:'png', fromSurface:true })
  const file = `${label}-${name}-960x640.png`
  const bytes = Buffer.from(data.data,'base64')
  assert.equal(bytes.readUInt32BE(16),960); assert.equal(bytes.readUInt32BE(20),640)
  await fs.writeFile(path.join(out,file),bytes)
  result.screenshots.push({file,sha256:createHash('sha256').update(bytes).digest('hex')})
}
const banned = /[a-f0-9]{32,}|rev-[a-z0-9]-[a-z0-9-]+/i
try {
  await fs.mkdir(out,{recursive:true}); await fs.access(executable)
  let occupied=false
  try { await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(500)}); occupied=true } catch { /* free */ }
  assert(!occupied,'Refuse occupied debug port')
  const runtime=await fs.mkdtemp(path.join(os.homedir(),'.hermes/profiles/daedalus/cache/scratch/ui-id-'))
  result.runtime=runtime
  const work=path.join(runtime,'evidence.cunlian')
  const seed=await fs.readFile(path.join(root,'docs/evidence/v40-stage3/fixtures/stage3-seed.cunlian'))
  result.seedSha256=createHash('sha256').update(seed).digest('hex')
  await fs.writeFile(work,seed)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  await exec('open',['-n','-a',bundle,'--args',`--user-data-dir=${path.join(runtime,'profile')}`,`--remote-debugging-port=${port}`],{env})
  let target
  await wait(async()=>{try {target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return Boolean(target)}catch{return false}},'app target')
  const pid=Number((await exec('lsof',['-t',`-iTCP:${port}`,'-sTCP:LISTEN'])).stdout.trim())
  assert((await exec('ps',['-p',String(pid),'-o','command='])).stdout.includes(`--user-data-dir=${path.join(runtime,'profile')}`))
  ownedPid=pid
  socket=new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data),r=pending.get(m.id);if(!r)return;clearTimeout(r.timer);pending.delete(m.id);if(m.error)r.reject(Error(JSON.stringify(m.error)));else r.resolve(m.result)})
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride',{width:960,height:640,deviceScaleFactor:1,mobile:false})
  await exec('open',['-a',bundle,work],{env})
  await wait(()=>evaluate(`Boolean(document.querySelector('.desktop-workspace__center'))`),'workspace')
  await evaluate(`(() => {const b=[...document.querySelectorAll('.desktop-workspace__layout-tools button')].find(n=>n.textContent.includes('任务侧栏'));if(b?.getAttribute('aria-expanded')==='false')b.click();return true})()`)
  await wait(()=>evaluate(`Boolean(document.querySelector('#agent-sidebar-panel'))`),'agent sidebar')
  result.initial=await evaluate(`({topbar:document.querySelector('.desktop-workspace__topbar')?.innerText??document.querySelector('.desktop-workspace header')?.innerText,formalVersion:[...document.querySelectorAll('.agent-sidebar dl div')].find(n=>n.querySelector('dt')?.textContent==='正式版本')?.querySelector('dd')?.innerText,session:null})`)
  result.initial.session=await evaluate('window.cunlian.reattachSession()')
  await click('.agent-sidebar button','正常改图')
  await wait(()=>evaluate(`(() => {const b=[...document.querySelectorAll('.agent-sidebar button')].find(n=>n.textContent.trim()==='确认保存');return Boolean(b&&!b.disabled)})()`),'normal demo ready for actual approval')
  await click('.agent-sidebar button','确认保存')
  await wait(()=>evaluate(`Boolean(document.querySelector('[data-testid="agent-commit-result"]')?.textContent.includes('已提交'))`),'commit receipt')
  result.receipt=await evaluate(`document.querySelector('[data-testid="agent-commit-result"]').innerText`)
  result.committed=await evaluate('window.cunlian.reattachSession()')
  assert(result.initial.session.ok && result.committed.ok)
  assert.notEqual(result.initial.session.value.snapshot.project.currentRevisionId,result.committed.value.snapshot.project.currentRevisionId,'actual main-process commit must change persisted revision')
  await evaluate(`document.querySelector('[data-testid="agent-commit-result"]').scrollIntoView({block:'center'})`)
  await shot('agent-submit-receipt')
  // Reload reattaches the actually committed main-process snapshot. Baseline
  // commit handler does not refresh its topbar props; never fake those props.
  await send('Page.reload')
  await wait(()=>evaluate(`Boolean(document.querySelector('.desktop-workspace__center'))`),'reattached committed workspace')
  await evaluate(`(() => {const b=[...document.querySelectorAll('.desktop-workspace__layout-tools button')].find(n=>n.textContent.includes('任务侧栏'));if(b?.getAttribute('aria-expanded')==='false')b.click();return true})()`)
  await wait(()=>evaluate(`Boolean(document.querySelector('#agent-sidebar-panel'))`),'reattached sidebar')
  result.initial.topbar=await evaluate(`document.querySelector('.desktop-workspace__topbar')?.innerText??document.querySelector('.desktop-workspace header')?.innerText`)
  result.initial.formalVersion=await evaluate(`[...document.querySelectorAll('.agent-sidebar dl div')].find(n=>n.querySelector('dt')?.textContent==='正式版本')?.querySelector('dd')?.innerText`)
  await shot('topbar-formal-version')
  result.leaks={topbar:banned.test(result.initial.topbar??''),formalVersion:banned.test(result.initial.formalVersion??''),receipt:banned.test(result.receipt)}
  assert(result.initial.topbar,'Topbar selector must resolve actual visible text')
  if(label==='before')assert(Object.values(result.leaks).every(Boolean),'Baseline must reproduce all three actual leaks')
  else {
    assert(Object.values(result.leaks).every(v=>!v),'Fixed UI must not leak IDs')
    const committedSnapshot = result.committed.value.snapshot
    const ordinal = committedSnapshot.fileRevisions.findIndex(revision => revision.revisionId === committedSnapshot.project.currentRevisionId) + 1
    assert(ordinal > 0, 'Fixture must have an actual formal version ordinal')
    result.expectedVersionLabel = `第 ${ordinal} 版`
    assert(result.initial.topbar.includes(result.expectedVersionLabel), 'Topbar must show the actual committed ordinal')
    assert.equal(result.initial.formalVersion, result.expectedVersionLabel)
    assert(result.receipt.includes(result.expectedVersionLabel), 'Receipt must show the actual committed ordinal')
  }
  result.verdict=label==='before'?'baseline-reproduced':'pass'
} catch(error) {
  result.error=error.stack??String(error); console.error(result.error);process.exitCode=1
  if(socket)try{await shot('failure')}catch{/* original error retained */}
} finally {
  if(socket){try{await Promise.race([send('Browser.close'),sleep(1500)])}catch{/* exiting */}socket.close()}
  for(const r of pending.values())clearTimeout(r.timer)
  if(ownedPid){await sleep(500);try{process.kill(ownedPid,'SIGKILL')}catch{/* exited */}}
  await fs.mkdir(out,{recursive:true})
  await fs.writeFile(path.join(out,`${label}-observed.json`),serializeEvidence(result))
  console.log(`UI_ID_EVIDENCE=${result.verdict}`)
}
