import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { connect, out, sleep } from './draftSyncCdp.mjs'
import { serializeEvidence } from '../../../scripts/evidence-json.ts'
const executable = path.resolve('out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链')
const bundle = path.resolve(path.dirname(executable), '../..')
const source = '/Users/aston/DSH/tmp/v35-indep/saved-after-12.05.cunlian'
const fixture = path.join(out, 'fixtures/ui-session.cunlian')
await fs.copyFile(path.join(out, 'fixtures/baseline.cunlian'), fixture)
let child, c
const results = {}
async function boot(file) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  child = spawn(executable, ['--remote-debugging-port=9476'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', b => fs.appendFile(out+'logs/app.log', b))
  child.stderr.on('data', b => fs.appendFile(out+'logs/app.log', b))
  for (let n=0;n<100;n++) { try { c=await connect(); break } catch { await sleep(200) } }
  if (!c) throw new Error('Packaged app did not start')
  execFileSync('open', ['-a', bundle, file])
  await c.wait(`document.querySelector('main[aria-label="寸链桌面工作台"]') !== null`)
  await c.wait(`(async()=>{const s=await window.cunlian.reattachSession();return s.ok && s.value.path===${JSON.stringify(file)}})()`)
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 1400, deviceScaleFactor: 1, mobile: false })
}
async function quit() {
  c.close(); c=null
  const exited = new Promise(r => child.once('exit', (code,signal) => r({code,signal})))
  child.kill('SIGKILL')
  const status = await Promise.race([exited, sleep(15000).then(()=>{throw new Error('App did not exit')})])
  console.log('PROCESS EXIT', status)
  return status
}
const session = () => c.evaluate('(async()=>{const r=await window.cunlian.reattachSession();if(!r.ok)throw new Error(r.error.message);return r.value})()')
const tab = name => c.evaluate(`[...document.querySelectorAll('[role="tab"]')].find(x=>x.textContent===${JSON.stringify(name)}).click()`)
async function review() {
  await c.evaluate(`(()=>{const b=document.querySelector('.desktop-workspace__review-toggle');if(b.getAttribute('aria-expanded')==='false')b.click()})()`)
}
async function visibleCheck(id, length, min, max, top = true) {
  await tab('工程图'); await review()
  await c.wait(`document.querySelector('section[aria-label="隔套工程图"] [data-annotation-id="ann.length"] text')?.textContent===${JSON.stringify(length)}`)
  const annotation = await c.evaluate(`document.querySelector('section[aria-label="隔套工程图"] [data-annotation-id="ann.length"] text').textContent`)
  await c.shot(id+'-drawing')
  await c.evaluate(`(()=>{const s=document.querySelector('section[aria-label="隔套工程图"]');[...s.querySelectorAll('button')].find(x=>x.textContent==='150%')?.click()})()`)
  await sleep(150)
  const detail=await c.evaluate(`(()=>{const e=document.querySelector('section[aria-label="隔套工程图"] [data-annotation-id="ann.length"] text');e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:Math.max(0,r.x-100),y:Math.max(0,r.y-100),width:220,height:180,scale:4}})()`)
  await c.shot(id+'-drawing-detail',detail)
  await tab('尺寸链')
  await c.wait(`document.querySelector('section[aria-label="当前计算结果"]')!==null`)
  const view = await c.evaluate(`({ table:document.querySelector('input[aria-label*="S 基本尺寸"]')?.value, calculation:document.querySelector('section[aria-label="当前计算结果"]').innerText, review:document.querySelector('.desktop-workspace__review').innerText, state:document.querySelector('[aria-label="草稿版本状态"]')?.innerText })`)
  const interval = `${min} 至 ${max}`
  assert.equal(Number(view.table), Number(length)); assert(view.calculation.includes(interval)); assert(view.review.includes(interval))
  const s = await session()
  assert.equal(s.snapshot.project.dimensionChain.terms.find(x=>x.id==='t-s').nominalQ, Math.round(Number(length)*10000))
  if(top) { assert.equal(Number(s.snapshot.draft.terms.find(x=>x.id==='t-s').nominal), Number(length)); assert.equal(s.snapshot.draft.relationRevision,s.snapshot.project.relationRevision) }
  await c.shot(id+'-chain'); await c.shot(id+'-review')
  const r={ formalS:s.snapshot.project.dimensionChain.terms.find(x=>x.id==='t-s'), draftS:s.snapshot.draft.terms.find(x=>x.id==='t-s'), relationRevision:s.snapshot.project.relationRevision,draftRevision:s.snapshot.draft.relationRevision,annotation,view,check:s.snapshot.project.currentRequirementCheck }
  results[id]=r; console.log('PASS',id, JSON.stringify({formalQ:r.formalS.nominalQ,draft:r.draftS.nominal,interval,check:r.check?.status}))
  return r
}
async function change(length, commit) {
  await tab('工程图')
  const before = await session()
  await c.evaluate(`(()=>{const e=document.querySelector('input[aria-label="长度（mm）"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(length)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await c.wait(`(()=>{const p=document.querySelector('section[aria-label="隔套工程图"] [data-annotation-id="ann.length"] text');return p?.textContent===${JSON.stringify(length)}&&document.querySelector('section[aria-label="参数联动"]')?.innerText.includes('任务书要求检查')})()`)
  await sleep(400)
  const preview=await c.evaluate(`(()=>{const s=document.querySelector('section[aria-label="参数联动"]');return {text:s.innerText,blocked:[...s.querySelectorAll('button')].find(x=>x.textContent.includes('确认提交')).disabled}})()`)
  if(commit){
    assert.equal(preview.blocked,false)
    await c.evaluate(`(()=>{const s=document.querySelector('section[aria-label="参数联动"]');[...s.querySelectorAll('button')].find(x=>x.textContent.includes('确认提交')).click()})()`)
    await c.wait(`(async()=>{const s=await window.cunlian.reattachSession();return s.value.snapshot.project.currentRevisionId!==${JSON.stringify(before.snapshot.project.currentRevisionId)}})()`)
  }
  return {before,preview}
}
try {
  await boot(fixture)
  const initial = await session()
  await change('12.04',true)
  await visibleCheck('FIX-01','12.04','0.1100','0.2100')
  const blocked = await change('12.10',false)
  assert.equal(blocked.preview.blocked,true)
  assert(blocked.preview.text.includes('0.0500')); assert(blocked.preview.text.includes('0.1500'))
  await c.shot('FIX-02-blocked')
  const backend = await c.evaluate(`(async()=>{const s=(await window.cunlian.reattachSession()).value;const d=await window.cunlian.stageChangeDraft({sessionId:s.sessionId,baseEditSeq:s.editSeq,inputs:{innerDiameter:'20.00',outerDiameter:'32.00',length:'12.10'},reason:'FIX-02 main gate'});if(!d.ok)return d;const p=await window.cunlian.previewChange({sessionId:s.sessionId,baseToken:d.value.baseToken,draftToken:d.value.draftToken});if(!p.ok)return p;return window.cunlian.applyChange({sessionId:s.sessionId,baseToken:d.value.baseToken,draftToken:d.value.draftToken,previewId:p.value.previewId,previewToken:p.value.previewToken,requestId:crypto.randomUUID(),reason:'FIX-02 main gate'})})()`)
  assert.equal(backend.ok,false);assert.equal(backend.error.code,'REQUIREMENT_NOT_SATISFIED')
  assert.deepEqual((await session()).snapshot,blocked.before.snapshot)
  results['FIX-02']={preview:blocked.preview,backend}
  await change('12.05',true)
  const final=await visibleCheck('FIX-03','12.05','0.1000','0.2000')
  assert.equal(final.check.status,'satisfied'); assert.equal(final.check.margins.lowerQ,0)
  const saved=await c.evaluate(`(async()=>{const s=(await window.cunlian.reattachSession()).value;return window.cunlian.saveProject({sessionId:s.sessionId,editSeq:s.editSeq,expectedFingerprint:s.fingerprint})})()`)
  assert.equal(saved.ok,true)
  results.exit=await quit()
  await boot(fixture)
  const reopened = await visibleCheck('FIX-04','12.05','0.1000','0.2000')
  assert.deepEqual(reopened.check,final.check)
  await c.evaluate(`[...document.querySelectorAll('button')].find(x=>x.textContent==='定位任务书').click()`)
  await c.wait(`document.querySelector('.pdf-highlight--active')!==null`)
  const location=await c.evaluate(`({summary:document.querySelector('[data-testid="requirement-locate-summary"]')?.innerText,page:document.querySelector('input[aria-label="页码跳转"]')?.value,highlight:Boolean(document.querySelector('.pdf-highlight--active'))})`)
  assert.equal(location.page,'2');assert.equal(location.highlight,true)
  const formal = (await session()).snapshot.project
  assert.deepEqual(formal.requirementRevisions[0].source, initial.snapshot.project.requirementRevisions[0].source)
  results['FIX-04'].location=location; await c.shot('FIX-04-source')
  await quit()
  // Read the original defect file directly. No save is invoked on this file.
  const originalBytes=await fs.readFile(source)
  await boot(source)
  const legacy=await visibleCheck('FIX-05','12.05','0.1000','0.2000',false)
  assert(legacy.view.state.includes('旧草稿（关系版本 1）已由正式版本 3 取代'))
  assert.equal(legacy.draftS.nominal,'12.00')
  await quit()
  assert.deepEqual(await fs.readFile(source),originalBytes)
  await fs.copyFile('/Users/aston/DSH/tmp/v35-indep/baseline.cunlian.pre-v35.ded17783b6b540d8.cunlian',path.join(out,'fixtures/old-baseline.cunlian'))
  await boot(path.join(out,'fixtures/old-baseline.cunlian'))
  const baseline=await visibleCheck('FIX-09','12.00','0.1500','0.2500')
  const b=await session()
  assert.deepEqual(b.snapshot.analysisSnapshots[0], initial.snapshot.analysisSnapshots[0])
  assert.deepEqual(b.snapshot.revisions, initial.snapshot.revisions)
  assert.deepEqual(b.snapshot.bindings, initial.snapshot.bindings)
  await tab('历史报告');await c.shot('FIX-09-history')
  results['FIX-09'].historyText=await c.evaluate(`document.querySelector('[role="tabpanel"]:not([hidden])').innerText`)
  assert(results['FIX-09'].historyText.includes('0.1500 至 0.2500'))
  assert.equal(baseline.formalS.nominalQ,120000)
  await quit()
  await fs.writeFile(out+'packaged-results.json',serializeEvidence(results))
  console.log('PASS packaged FIX-01/02/03/04/05/09')
} catch(e) {
  await fs.writeFile(out+'packaged-partial.json',serializeEvidence(results))
  if(c)await c.shot('failure').catch(()=>{})
  c?.close(); child?.kill('SIGTERM')
  throw e
}
