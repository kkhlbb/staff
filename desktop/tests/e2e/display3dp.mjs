import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { connect, sleep } from './draftSyncCdp.mjs'
import { serializeEvidence } from '../../../scripts/evidence-json.ts'

const out = path.resolve('docs/evidence/display-3dp')
const source = '/Users/aston/DSH/tmp/v35-indep/saved-after-12.05.cunlian'
const fixture = path.join(out, 'fixtures/saved-after-12.05-copy.cunlian')
const executable = path.resolve('out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链')
const bundle = path.resolve(path.dirname(executable), '../..')
const port = 9483
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
await fs.mkdir(path.dirname(fixture), { recursive: true })
const original = await fs.readFile(source)
await fs.copyFile(source, fixture)
const env = { ...process.env, HOME: path.join(process.env.TMPDIR, 'staff-display-3dp-home') }; delete env.ELECTRON_RUN_AS_NODE
await fs.mkdir(env.HOME, { recursive: true })
env.CFFIXED_USER_HOME = env.HOME
const child = spawn(executable, [`--remote-debugging-port=${port}`], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let appOutput = ''; let c
child.stdout.on('data', b => { appOutput += b.toString() })
child.stderr.on('data', b => { appOutput += b.toString() })
const results = { source, fixture, sourceSha256: hash(original) }
const tab = name => c.evaluate(`[...document.querySelectorAll('[role="tab"]')].find(x=>x.textContent===${JSON.stringify(name)}).click()`)
async function shot(name, selector) {
  let clip
  if (selector) clip = await c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('missing screenshot target');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.max(0,r.x),y:Math.max(0,r.y),width:Math.min(r.width,1700-Math.max(0,r.x)),height:Math.min(r.height,1400-Math.max(0,r.y)),scale:2}})()`)
  await sleep(200)
  const r = await c.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) })
  const file = path.join(out, `${name}.png`)
  await fs.writeFile(file, Buffer.from(r.data, 'base64'))
  console.log('SCREENSHOT', file)
}
try {
  for (let n=0;n<100;n++) { try { c=await connect(port); break } catch { await sleep(200) } }
  assert(c, 'Packaged app did not start')
  execFileSync('open', ['-a', bundle, fixture])
  await c.wait(`document.querySelector('main[aria-label="寸链桌面工作台"]') !== null`)
  await c.wait(`(async()=>{const s=await window.cunlian.reattachSession();return s.ok && s.value.path===${JSON.stringify(fixture)}})()`)
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 1400, deviceScaleFactor: 1, mobile: false })
  await tab('尺寸链')
  await c.evaluate(`(()=>{const b=document.querySelector('.desktop-workspace__review-toggle');if(b?.getAttribute('aria-expanded')==='false')b.click()})()`)
  results.chain = await c.evaluate(`({value:document.querySelector('input[aria-label*="S 基本尺寸"]')?.value,result:document.querySelector('section[aria-label="当前计算结果"]')?.innerText,stale:document.querySelector('[aria-label="草稿版本状态"]')?.innerText})`)
  assert.equal(results.chain.value, '12.050')
  assert(results.chain.result.includes('0.100 至 0.200'))
  assert(results.chain.stale.includes('旧草稿（关系版本 1）已由正式版本 3 取代'))
  await shot('01-chain')
  results.review = await c.evaluate(`document.querySelector('.desktop-workspace__review').innerText`)
  assert(results.review.includes('0.100 至 0.200'))
  await shot('03-review', '.desktop-workspace__review')
  await tab('工程图')
  await c.wait(`document.querySelector('section[aria-label="隔套工程图"] [data-annotation-id="ann.length"] text')?.textContent==='12.050'`)
  results.annotation = await c.evaluate(`document.querySelector('section[aria-label="隔套工程图"] [data-annotation-id="ann.length"] text').textContent`)
  await c.evaluate(`(()=>{const s=document.querySelector('section[aria-label="隔套工程图"]');[...s.querySelectorAll('button')].find(x=>x.textContent==='150%').click()})()`)
  await sleep(200)
  await c.evaluate(`document.querySelector('section[aria-label="隔套工程图"] [data-annotation-id="ann.length"] text').scrollIntoView({block:'center',inline:'center'})`)
  await shot('02-drawing')
  results.parameter = await c.evaluate(`document.querySelector('section[aria-label="参数联动"] input[aria-label="长度（mm）"]').value`)
  assert.equal(results.parameter, '12.050')
  await shot('04-parameters', 'section[aria-label="参数联动"]')
  const s = await c.evaluate(`(async()=>{const s=await window.cunlian.reattachSession();if(!s.ok)throw new Error(s.error.message);return s.value})()`)
  results.formalQ = s.snapshot.project.dimensionChain.terms.find(x=>x.id==='t-s').nominalQ
  results.storedDraft = s.snapshot.draft
  assert.equal(results.formalQ, 120500)
  assert.equal(results.storedDraft.terms.find(x=>x.id==='t-s').nominal, '12.00')
  assert.equal(hash(await fs.readFile(source)), results.sourceSha256)
  assert.equal(hash(await fs.readFile(fixture)), results.sourceSha256)
  results.originalAndCopyUnchanged = true
  await fs.writeFile(path.join(out,'packaged-results.json'), serializeEvidence(results))
  console.log('PASS packaged four surfaces, legacy draft notice, source/copy unchanged', JSON.stringify(results))
} catch (e) {
  await fs.writeFile(path.join(out,'packaged-failure.json'),serializeEvidence({results,error:String(e)}))
  if(c) await shot('failure').catch(()=>{})
  throw e
} finally {
  c?.close()
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  child.kill('SIGKILL')
  console.log('OWNED APP EXIT', await exited)
  await fs.writeFile(path.join(out,'app.log'),appOutput)
}
