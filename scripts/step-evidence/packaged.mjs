// Evidence harness only. Real packaged main+preload IPC+worker; debugger injects ONLY native dialog responses.
// No product test backdoor, no renderer filesystem/kernel, isolated user-data, app.exit in finally.
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const [executable,fixtureDirectory,out] = process.argv.slice(2)
if(!executable || !out) throw Error('Usage: node packaged.mjs <app executable> <product fixture directory> <new evidence dir>')
await fs.mkdir(out,{recursive:true})
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const app=spawn(executable,['--inspect=9491','--remote-debugging-port=9492',`--user-data-dir=${path.join(out,'user-data')}`],{env,stdio:['ignore','pipe','pipe']})
let output='';app.stdout.on('data',x=>output+=x);app.stderr.on('data',x=>output+=x)
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const sockets=[]
async function connect(port) {
 for(let i=0;i<120;i++) {
  try {
   const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const t=list.find(x=>x.webSocketDebuggerUrl)
   if(t) {const socket=new WebSocket(t.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});sockets.push(socket);let id=0;const pending=new Map();socket.addEventListener('message',e=>{const v=JSON.parse(e.data);if(v.id) {pending.get(v.id)?.(v);pending.delete(v.id)}});return async expression=>{const n=++id;const p=new Promise((r,j)=>{pending.set(n,r);setTimeout(()=>{if(pending.has(n)){pending.delete(n);j(Error('inspector timeout'))}},40000).unref()});socket.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));const result=await p;if(result.result?.exceptionDetails)throw Error(JSON.stringify(result.result.exceptionDetails));return result.result?.result?.value} }
  } catch { /* bounded wait for actual ready */ }
  await sleep(100)
 }
 throw Error(`inspector unavailable ${port}: ${output}`)
}
let main
let renamed=false
const assets=path.resolve(executable,'../../Resources/step-kernel')
try {
 main=await connect(9491)
 const probe=await main(`({requireType:typeof require,mainType:typeof process.mainModule,resourcesPath:process.resourcesPath,version:process.versions.electron})`)
 await fs.writeFile(path.join(out,'runtime-probe.json'),JSON.stringify(probe,null,2),{flag:'wx'})
 const req=`process.mainModule.require.bind(process.mainModule)`
 await main(`globalThis.__stepEvidenceElectron=(${req})('electron');globalThis.__stepEvidenceElectron.BrowserWindow.getAllWindows().forEach(w=>w.hide());true`)
 const renderer=await connect(9492)
 // Wait for React effects (including real editor flush subscription), not just preload exposure.
 await sleep(1800)
 const base=JSON.parse(await fs.readFile(path.join(fixtureDirectory,'base-receipt.json'),'utf8'))
 const fixture=path.join(fixtureDirectory,'base.cunlian')
 await main(`globalThis.__stepEvidenceElectron.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(fixture)}]});true`)
 let opened
 for(let i=0;i<100;i++){try{opened=await renderer(`window.cunlian ? window.cunlian.openProject({}) : null`);if(opened)break}catch{}await sleep(100)}
 assert.ok(opened?.ok,JSON.stringify(opened));await fs.writeFile(path.join(out,'opened.json'),JSON.stringify(opened,null,2),{flag:'wx'})
 const request={sessionId:opened.value.sessionId,baseEditSeq:0,revisionId:base.input.revisionId,partId:base.input.partId,expectedInputFingerprint:base.input.inputFingerprint,jobId:'packaged-1'}
 const target=path.join(out,'packaged.step')
 await main(`globalThis.__stepEvidenceElectron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(target)}});globalThis.__stepEvidenceElectron.dialog.showMessageBox=async()=>({response:1});true`)
 const receipt=await renderer(`window.cunlian.stepExport(${JSON.stringify(request)})`)
 await fs.writeFile(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx'});assert.ok(receipt.ok,JSON.stringify(receipt))
 const bytes=await fs.readFile(target);assert.equal(createHash('sha256').update(bytes).digest('hex'),receipt.value.sha256);assert.equal(bytes.length,receipt.value.byteSize)
 // Actual packaged resource omission, then restore, with no development-tree fallback.
 const wasm=path.join(assets,'replicad_single.wasm');await fs.rename(wasm,wasm+'.mutation-hidden');renamed=true
 const badTarget=path.join(out,'must-not-exist.step')
 await main(`globalThis.__stepEvidenceElectron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(badTarget)}});true`)
 const missing=await renderer(`window.cunlian.stepExport(${JSON.stringify({...request,jobId:'missing-wasm'})})`)
 await fs.writeFile(path.join(out,'missing-wasm-receipt.json'),JSON.stringify(missing,null,2),{flag:'wx'})
 assert.equal(missing.ok,false);assert.equal(missing.error.code,'STEP_EXPORT_FAILED');assert.match(missing.error.message,/STEP_ASSET_MISSING/);await assert.rejects(fs.stat(badTarget))
 await fs.writeFile(path.join(out,'missing-wasm.patch'),'rename packaged/step-kernel/replicad_single.wasm -> replicad_single.wasm.mutation-hidden\nExpected: STEP_ASSET_MISSING, no fallback and no target writes.\n',{flag:'wx'})
 await fs.rename(wasm+'.mutation-hidden',wasm);renamed=false
 const greenTarget=path.join(out,'restored.step')
 await main(`globalThis.__stepEvidenceElectron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(greenTarget)}});true`)
 const restored=await renderer(`window.cunlian.stepExport(${JSON.stringify({...request,jobId:'restored-wasm'})})`)
 await fs.writeFile(path.join(out,'restored-receipt.json'),JSON.stringify(restored,null,2),{flag:'wx'}); assert.ok(restored.ok,JSON.stringify(restored))
 // Switch to a separately persisted odd-q historical version; real kernel geometry must change.
 const odd=JSON.parse(await fs.readFile(path.join(fixtureDirectory,'odd-receipt.json'),'utf8'))
 await main(`globalThis.__stepEvidenceElectron.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(path.join(fixtureDirectory,'odd.cunlian'))}]});true`)
 const openedOdd=await renderer(`window.cunlian.openProject({})`);assert.ok(openedOdd.ok,JSON.stringify(openedOdd))
 const oddTarget=path.join(out,'odd-packaged.step')
 await main(`globalThis.__stepEvidenceElectron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(oddTarget)}});true`)
 const oddRequest={sessionId:openedOdd.value.sessionId,baseEditSeq:openedOdd.value.editSeq,revisionId:odd.input.revisionId,partId:odd.input.partId,expectedInputFingerprint:odd.input.inputFingerprint,jobId:'odd-packaged'}
 const oddReceipt=await renderer(`window.cunlian.stepExport(${JSON.stringify(oddRequest)})`)
 await fs.writeFile(path.join(out,'odd-receipt.json'),JSON.stringify(oddReceipt,null,2),{flag:'wx'});assert.ok(oddReceipt.ok,JSON.stringify(oddReceipt));assert.notEqual(oddReceipt.value.geometryFingerprint,receipt.value.geometryFingerprint)
 // A switched-out session must fail BEFORE even opening a save dialog.
 const cancelTarget=path.join(out,'cancelled-must-not-exist.step')
 const beforeFiles=(await fs.readdir(out)).filter(n=>n.endsWith('.step') || n.endsWith('.step-tmp')).sort()
 await main(`globalThis.__stepDialogCalls=0;globalThis.__stepEvidenceElectron.dialog.showSaveDialog=async()=>{globalThis.__stepDialogCalls++;return {canceled:true,filePath:${JSON.stringify(cancelTarget)}}};true`)
 const stale=await renderer(`window.cunlian.stepExport(${JSON.stringify({...request,jobId:'stale-session'})})`)
 await fs.writeFile(path.join(out,'stale-session-receipt.json'),JSON.stringify(stale,null,2),{flag:'wx'})
 assert.equal(stale.ok,false);assert.equal(stale.error.code,'STALE_SESSION');assert.equal(await main('globalThis.__stepDialogCalls'),0)
 // Use CURRENT session, edit sequence AND selected frozen revision/fingerprint.
 const cancelled=await renderer(`window.cunlian.stepExport(${JSON.stringify({...oddRequest,jobId:'cancelled'})})`)
 await fs.writeFile(path.join(out,'cancelled-receipt.json'),JSON.stringify(cancelled,null,2),{flag:'wx'})
 assert.equal(cancelled.ok,false);assert.equal(cancelled.error.code,'CANCELLED');assert.equal(await main('globalThis.__stepDialogCalls'),1)
 await assert.rejects(fs.stat(cancelTarget),{code:'ENOENT'})
 const afterFiles=(await fs.readdir(out)).filter(n=>n.endsWith('.step') || n.endsWith('.step-tmp')).sort()
 assert.deepEqual(afterFiles,beforeFiles);assert.equal(afterFiles.filter(n=>n.endsWith('.step-tmp')).length,0)
 await fs.writeFile(path.join(out,'cancelled-disk-audit.json'),JSON.stringify({beforeFiles,afterFiles,targetAbsent:true,ownTemporaryFiles:[],staleRejectedBeforeDialog:true,currentFrozenRevision:oddRequest.revisionId,scope:'Export directory only; not a whole-disk no-write claim; native dialogs stubbed.'},null,2),{flag:'wx'})
 console.log(JSON.stringify({status:'PASS',scope:'real packaged Electron main/preload IPC/worker/save; native dialogs stubbed via debugger, NOT native dialog UX verification',probe,target,receipt:receipt.value,missingWasmRejected:true,restored:true,cancelled:true},null,2))
} finally {
 if(renamed)await fs.rename(path.join(assets,'replicad_single.wasm.mutation-hidden'),path.join(assets,'replicad_single.wasm'))
 if(main) {try{await main(`setTimeout(()=>globalThis.__stepEvidenceElectron.app.exit(0),30);true`)}catch{}}
 for(const socket of sockets)socket.close()
 const exit=await Promise.race([new Promise(r=>app.once('exit',(code,signal)=>r({code,signal}))),sleep(5000).then(()=>null)])
 if(!exit)app.kill('SIGKILL')
 await fs.writeFile(path.join(out,'electron.log'),output,{flag:'wx'});await fs.writeFile(path.join(out,'process-exit.json'),JSON.stringify(exit),{flag:'wx'})
}
