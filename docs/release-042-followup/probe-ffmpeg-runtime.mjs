// 2026-11-17 new evidence-only probe. Does not alter production code/signatures/hash checks.
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const legal = path.resolve(repo, '../release-042-artifacts/followup-source/legal')
const app = path.join(legal, 'mac-copy-20261117/product.app')
const out = path.join(legal, 'mac-runtime-20261117')
await fs.mkdir(out)
const lib = path.join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib')
const digest = async () => createHash('sha256').update(await fs.readFile(lib)).digest('hex')
const expected = '61c9c2ac6390e8d5cf0c666bd760b93f203c9ad9448ff3fba1ab4a466cdd45f8'
if (await digest() !== expected) throw Error('candidate hash mismatch')
const result = { status: 'FAIL', nativeRebuildExecuted: false, windowsRuntimeTested: false,
  legalCertification: false, signatureOrPermissionChanges: false, hashChecksDisabled: false,
  scope: 'Official alternative-codec library, app startup, loaded-image path and PCM WAV decode; not user-source recompile or all-codec compatibility' }
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/API_KEY|TOKEN|SECRET|PASSWORD|^DYLD_|^ELECTRON_|^NODE_OPTIONS$|^CUNLIAN_/.test(k)))
let child, ws, log = '', exitPromise
const pending = new Map()
let seq = 0
const timeout = (p, ms = 30000) => { let t; return Promise.race([p, new Promise((_, j) => { t = setTimeout(() => j(Error('probe timeout')), ms) })]).finally(() => clearTimeout(t)) }
try {
  child = spawn(path.join(app, 'Contents/MacOS/寸链'), ['--inspect=0', '--user-data-dir=' + path.join(out, 'user-data')], { env, cwd: out, stdio: ['ignore', 'pipe', 'pipe'] })
  exitPromise = new Promise(resolve => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', () => resolve({ error: 'spawn failed' })) })
  const endpoint = await timeout(new Promise((resolve, reject) => {
    const consume = b => { log += b.toString(); const m = log.match(/Debugger listening on (ws:\/\/[^\s]+)/); if (m) resolve(m[1]) }
    child.stdout.on('data', consume); child.stderr.on('data', consume)
    exitPromise.then(() => reject(Error('app exited before debugger endpoint')))
  }))
  ws = new WebSocket(endpoint)
  await timeout(new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) }))
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error('inspector request failed')) : p.resolve(m.result) } })
  const evaluate = expression => timeout(new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })) })).then(r => { if (r.exceptionDetails) throw Error('runtime evaluation failed'); return r.result.value })
  // Locally generated PCM WAV fixture, not fabricated measurement or downloaded media.
  const wav = Buffer.alloc(44 + 800 * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(1600, 40)
  for (let i = 0; i < 800; i++) wav.writeInt16LE(Math.round(10000 * Math.sin(2 * Math.PI * 400 * i / 8000)), 44 + i * 2)
  await fs.writeFile(path.join(out, 'generated-400Hz.wav'), wav, { flag: 'wx' })
  const rendererCode = `(async()=>{const bytes=Uint8Array.from(atob('${wav.toString('base64')}'),c=>c.charCodeAt(0));const c=new AudioContext({sampleRate:8000});try{const b=await c.decodeAudioData(bytes.buffer);const d=b.getChannelData(0);let peak=0;for(const n of d)peak=Math.max(peak,Math.abs(n));return {channels:b.numberOfChannels,frames:b.length,sampleRate:b.sampleRate,peak,passed:b.numberOfChannels===1&&b.length===800&&b.sampleRate===8000&&peak>0.29&&peak<0.32}}finally{await c.close()}})()`
  result.decode = await evaluate(`(async()=>{const e=process.mainModule.require('electron');await e.app.whenReady();for(let i=0;i<150;i++){const w=e.BrowserWindow.getAllWindows()[0];if(w&&!w.webContents.isLoading()){return {electron:process.versions.electron,...await w.webContents.executeJavaScript(${JSON.stringify(rendererCode)})}}await new Promise(r=>setTimeout(r,100))}throw Error('window not ready')})()`)
  const loaded = execFileSync('/usr/sbin/lsof', ['-p', String(child.pid), '-Fn'], { encoding: 'utf8' }).split('\n').filter(s => s.includes('libffmpeg.dylib'))
  result.loadedCandidateImage = loaded.some(s => s === 'n' + lib)
  result.candidateSha256 = await digest()
  result.status = result.decode.passed && result.loadedCandidateImage && result.candidateSha256 === expected ? 'PASS' : 'FAIL'
  await evaluate("setImmediate(()=>process.mainModule.require('electron').app.exit(0));true")
} catch (e) {
  result.error = ['probe timeout', 'runtime evaluation failed', 'app exited before debugger endpoint'].includes(e.message) ? e.message : 'probe failed; raw local log withheld'
} finally {
  ws?.close()
  if (child) {
    try { result.processExit = await timeout(exitPromise, 5000) }
    catch { child.kill('SIGKILL'); result.processExit = await exitPromise }
  }
  await fs.writeFile(path.join(out, 'runtime.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(result, null, 2))
  if (result.status !== 'PASS') process.exitCode = 1
}
