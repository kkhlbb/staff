// Evidence harness only. Real packaged main+preload IPC+worker; debugger injects ONLY native dialog responses.
// No product test backdoor, no renderer filesystem/kernel, isolated user-data, app.exit in finally.
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const [executable,fixtureDirectory,out,localCandidateDirectory,expectedLocalError,consent='1'] = process.argv.slice(2)
if(!executable || !out) throw Error('Usage: node packaged.mjs <app executable> <product fixture directory> <new evidence dir>')
await fs.mkdir(out,{recursive:true})
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
for(const name of ['CUNLIAN_STEP_LOCAL_OPT_IN','CUNLIAN_STEP_LOCAL_WASM','CUNLIAN_STEP_LOCAL_SHA256'])delete env[name]
let localCandidate
if(localCandidateDirectory) {
 localCandidate=JSON.parse(await fs.readFile(path.join(localCandidateDirectory,'candidate.json'),'utf8'))
 if(consent!=='unset')env.CUNLIAN_STEP_LOCAL_OPT_IN=consent
 env.CUNLIAN_STEP_LOCAL_WASM=path.resolve(localCandidateDirectory,'modified.wasm')
 env.CUNLIAN_STEP_LOCAL_SHA256=localCandidate.sha256
}
const launchArgs=['--inspect=9491','--remote-debugging-port=9492',`--user-data-dir=${path.join(out,'user-data')}`]
const profile=process.env.STEP_EVIDENCE_OS_PROFILE
const app=spawn(profile?'sandbox-exec':executable,profile?['-f',profile,executable,...launchArgs]:launchArgs,{env,cwd:path.resolve(out),stdio:['ignore','pipe','pipe']})
const appExit=new Promise(resolve=>{app.once('exit',(code,signal)=>resolve({code,signal}));app.once('error',error=>resolve({code:null,signal:null,error:error.message}))})
let output='';app.stdout.on('data',x=>output+=x);app.stderr.on('data',x=>output+=x)
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const sockets=[]
async function connect(port) {
 for(let i=0;i<120;i++) {
  try {
   const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const t=list.find(x=>x.webSocketDebuggerUrl)
   if(t) {
    const socket=new WebSocket(t.webSocketDebuggerUrl)
    await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})})
    sockets.push(socket);let id=0;const pending=new Map()
    socket.addEventListener('message',e=>{const v=JSON.parse(e.data),p=pending.get(v.id);if(p){clearTimeout(p.timer);pending.delete(v.id);p.resolve(v)}})
    socket.addEventListener('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('inspector closed'))}pending.clear()})
    return async expression=>{
     if(socket.readyState!==WebSocket.OPEN)throw Error('inspector not open')
     const n=++id
     const p=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(n);reject(Error('inspector timeout'))},40000);pending.set(n,{resolve,reject,timer})})
     socket.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}))
     const result=await p;if(result.result?.exceptionDetails)throw Error(JSON.stringify(result.result.exceptionDetails))
     return result.result?.result?.value
    }
   }
  } catch { /* bounded wait for actual ready */ }
  await sleep(100)
 }
 throw Error(`inspector unavailable ${port}: ${output}`)
}
let main
let renamed=false
const assets=path.resolve(executable,'../../Resources/step-narrow-v1')
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
 const request={sessionId:opened.value.sessionId,baseEditSeq:opened.value.editSeq,revisionId:base.input.revisionId,partId:base.input.partId,expectedInputFingerprint:base.input.inputFingerprint,jobId:'packaged-1'}
 const target=path.join(out,'packaged.step')
 await main(`globalThis.__stepEvidenceElectron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(target)}});globalThis.__stepEvidenceElectron.dialog.showMessageBox=async()=>({response:1});true`)
 const receipt=await renderer(`window.cunlian.stepExport(${JSON.stringify(request)})`)
 await fs.writeFile(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx'})
 if(expectedLocalError) {
  assert.equal(receipt.ok,false);assert.equal(receipt.error.code,'STEP_EXPORT_FAILED');assert.ok(receipt.error.message.includes(expectedLocalError),JSON.stringify(receipt))
  assert.equal(receipt.error.message.includes(env.CUNLIAN_STEP_LOCAL_WASM),false)
  await assert.rejects(fs.stat(target),{code:'ENOENT'})
  console.log(JSON.stringify({status:'PASS',expectedLocalError,noFallback:true,targetAbsent:true,pathRedacted:true}))
 } else {
 assert.ok(receipt.ok,JSON.stringify(receipt))
 const bytes=await fs.readFile(target);assert.equal(createHash('sha256').update(bytes).digest('hex'),receipt.value.sha256);assert.equal(bytes.length,receipt.value.byteSize)
 if(localCandidate) {
  assert.equal(receipt.value.wasmSha256,localCandidate.sha256)
  assert.match(receipt.value.kernelVersion,/user-selected-local-wasm/)
  assert.ok(bytes.toString('ascii').includes('SOURCE MODIFIED OCCT STEP translator'))
  // Snapshotting and revalidation apply to the user file as well; never fallback.
  const selected=env.CUNLIAN_STEP_LOCAL_WASM,original=await fs.readFile(selected),failureTarget=path.join(out,'local-hash-must-not-exist.step')
  try {
   await fs.writeFile(selected,Buffer.alloc(64,1))
   await main(`globalThis.__stepEvidenceElectron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(failureTarget)}});true`)
   const failure=await renderer(`window.cunlian.stepExport(${JSON.stringify({...request,jobId:'local-changed-file'})})`)
   await fs.writeFile(path.join(out,'local-changed-receipt.json'),JSON.stringify(failure,null,2),{flag:'wx'})
   assert.equal(failure.ok,false);assert.match(failure.error.message,/STEP_LOCAL_HASH/)
   await assert.rejects(fs.stat(failureTarget),{code:'ENOENT'})
  } finally {await fs.writeFile(selected,original)}
 }
 else assert.equal(bytes.toString('ascii').includes('SOURCE MODIFIED OCCT STEP translator'),false)
 assert.deepEqual(receipt.value.generationInput,base.input)
 const currentLengthQ=opened.value.snapshot.project.parameters.find(p=>p.key==='length').valueQ
 assert.notEqual(currentLengthQ,receipt.value.generationInput.lengthQ)
 await fs.writeFile(path.join(out,'historical-freeze-audit.json'),JSON.stringify({currentLengthQ,selectedFrozenLengthQ:receipt.value.generationInput.lengthQ,inputMatchesSelectedFrozenReceipt:true,historicalByteIdentical:receipt.value.historicalByteIdentical},null,2),{flag:'wx'})
 // Actual packaged resource omission, then restore, with no development-tree fallback.
 const wasm=path.join(assets,'spacer.wasm');await fs.rename(wasm,wasm+'.mutation-hidden');renamed=true
 const badTarget=path.join(out,'must-not-exist.step')
 await main(`globalThis.__stepEvidenceElectron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(badTarget)}});true`)
 const missing=await renderer(`window.cunlian.stepExport(${JSON.stringify({...request,jobId:'missing-wasm'})})`)
 await fs.writeFile(path.join(out,'missing-wasm-receipt.json'),JSON.stringify(missing,null,2),{flag:'wx'})
 assert.equal(missing.ok,false);assert.equal(missing.error.code,'STEP_EXPORT_FAILED');assert.match(missing.error.message,/STEP_ASSET_MISSING/);await assert.rejects(fs.stat(badTarget))
 await fs.writeFile(path.join(out,'missing-wasm.patch'),'rename packaged/step-kernel/spacer.wasm -> spacer.wasm.mutation-hidden\nExpected: STEP_ASSET_MISSING, no fallback and no target writes.\n',{flag:'wx'})
 await fs.rename(wasm+'.mutation-hidden',wasm);renamed=false
 const greenTarget=path.join(out,'restored.step')
 await main(`globalThis.__stepEvidenceElectron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(greenTarget)}});true`)
 const restored=await renderer(`window.cunlian.stepExport(${JSON.stringify({...request,jobId:'restored-wasm'})})`)
 await fs.writeFile(path.join(out,'restored-receipt.json'),JSON.stringify(restored,null,2),{flag:'wx'}); assert.ok(restored.ok,JSON.stringify(restored))
 assert.equal(createHash('sha256').update(await fs.readFile(greenTarget)).digest('hex'),restored.value.sha256)
 // Omit/corrupt every own runtime asset in this package, then restore bytes in finally.
 const resourceChecks=[]
 for(const name of ['spacer.cjs','spacer.wasm','step-worker.cjs']) {
  const resource=path.join(assets,name),original=await fs.readFile(resource)
  for(const mode of ['missing','corrupt']) {
   const mutationTarget=path.join(out,`${mode}-${name}.step`)
   if(mode==='missing')await fs.rename(resource,resource+'.probe-hidden')
   else await fs.writeFile(resource,'corrupt evidence-only resource')
   try {
    await main(`globalThis.__stepEvidenceElectron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(mutationTarget)}});true`)
    const result=await renderer(`window.cunlian.stepExport(${JSON.stringify({...request,jobId:`${mode}-${name}`})})`)
    await fs.writeFile(path.join(out,`${mode}-${name}-receipt.json`),JSON.stringify(result,null,2),{flag:'wx'})
    assert.equal(result.ok,false);assert.equal(result.error.code,'STEP_EXPORT_FAILED');assert.match(result.error.message,mode==='missing'?/STEP_ASSET_MISSING/:/STEP_ASSET_HASH/)
    await assert.rejects(fs.stat(mutationTarget),{code:'ENOENT'})
    resourceChecks.push({name,mode,rejected:true,targetAbsent:true})
   } finally {
    if(mode==='missing')await fs.rename(resource+'.probe-hidden',resource)
    else await fs.writeFile(resource,original)
   }
   assert.deepEqual(await fs.readFile(resource),original)
  }
 }
 await fs.writeFile(path.join(out,'resource-mutation-audit.json'),JSON.stringify(resourceChecks,null,2),{flag:'wx'})
 // A valid WASM with only an added inert custom section is still refused by pinned integrity.
 // This is an executable replacement BLOCKER probe, NOT proof of LGPL relink compliance.
 const originalWasm=await fs.readFile(wasm)
 const sectionName=Buffer.from('cunlian-replacement-probe')
 const candidate=Buffer.concat([originalWasm,Buffer.from([0,sectionName.length+1,sectionName.length]),sectionName])
 assert.equal(WebAssembly.validate(candidate),true)
 await fs.writeFile(path.join(out,'replacement-probe.wasm'),candidate,{flag:'wx'})
 const replacementTarget=path.join(out,'replacement-must-not-exist.step')
 try {
  await fs.writeFile(wasm,candidate)
  await main(`globalThis.__stepEvidenceElectron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(replacementTarget)}});true`)
  const replacement=await renderer(`window.cunlian.stepExport(${JSON.stringify({...request,jobId:'replacement-probe'})})`)
  await fs.writeFile(path.join(out,'replacement-receipt.json'),JSON.stringify(replacement,null,2),{flag:'wx'})
  assert.equal(replacement.ok,false);assert.equal(replacement.error.code,'STEP_EXPORT_FAILED');assert.match(replacement.error.message,/STEP_ASSET_HASH/)
  await assert.rejects(fs.stat(replacementTarget),{code:'ENOENT'})
  await fs.writeFile(path.join(out,'replacement-audit.json'),JSON.stringify({wasmValid:true,originalSha256:createHash('sha256').update(originalWasm).digest('hex'),candidateSha256:createHash('sha256').update(candidate).digest('hex'),status:'BLOCKED_DIRECT_BINARY_REPLACEMENT',reason:'Pinned default integrity rejects direct changed bytes; explicit user opt-in is a separate tested source-rebuild path.'},null,2),{flag:'wx'})
 } finally { await fs.writeFile(wasm,originalWasm) }
 assert.deepEqual(await fs.readFile(wasm),originalWasm)
 // Switch to a separately persisted odd-q historical version; real kernel geometry must change.
 const odd=JSON.parse(await fs.readFile(path.join(fixtureDirectory,'odd-receipt.json'),'utf8'))
 await main(`globalThis.__stepEvidenceElectron.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(path.join(fixtureDirectory,'odd.cunlian'))}]});true`)
 const openedOdd=await renderer(`window.cunlian.openProject({})`);assert.ok(openedOdd.ok,JSON.stringify(openedOdd))
 const oddTarget=path.join(out,'odd-packaged.step')
 await main(`globalThis.__stepEvidenceElectron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(oddTarget)}});true`)
 const oddRequest={sessionId:openedOdd.value.sessionId,baseEditSeq:openedOdd.value.editSeq,revisionId:odd.input.revisionId,partId:odd.input.partId,expectedInputFingerprint:odd.input.inputFingerprint,jobId:'odd-packaged'}
 const oddReceipt=await renderer(`window.cunlian.stepExport(${JSON.stringify(oddRequest)})`)
 await fs.writeFile(path.join(out,'odd-receipt.json'),JSON.stringify(oddReceipt,null,2),{flag:'wx'});assert.ok(oddReceipt.ok,JSON.stringify(oddReceipt));assert.notEqual(oddReceipt.value.geometryFingerprint,receipt.value.geometryFingerprint)
 assert.deepEqual(oddReceipt.value.generationInput,odd.input)
 assert.equal(createHash('sha256').update(await fs.readFile(oddTarget)).digest('hex'),oddReceipt.value.sha256)
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
 // Explicit cancellation through real IPC while the real worker job is pending.
 const runningCancelTarget=path.join(out,'running-cancel-must-not-exist.step')
 await main(`globalThis.__stepEvidenceElectron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(runningCancelTarget)}});true`)
 const pendingCancel=await renderer(`(async()=>{const request=${JSON.stringify({...oddRequest,jobId:'running-cancel'})};const pending=window.cunlian.stepExport(request);await new Promise(r=>setTimeout(r,35));const cancellation=await window.cunlian.stepCancel({sessionId:request.sessionId,jobId:request.jobId});return {cancellation,result:await pending}})()`)
 await fs.writeFile(path.join(out,'running-cancel-receipt.json'),JSON.stringify(pendingCancel,null,2),{flag:'wx'})
 assert.equal(pendingCancel.cancellation.ok,true);assert.equal(pendingCancel.cancellation.value.cancelled,true)
 assert.equal(pendingCancel.result.ok,false);assert.equal(pendingCancel.result.error.code,'CANCELLED')
 await assert.rejects(fs.stat(runningCancelTarget),{code:'ENOENT'})
 // Formally persisted invalid/degenerate historical input still cannot create a target.
 for(const name of ['degenerate-length','thin-wall']) {
  const bad=JSON.parse(await fs.readFile(path.join(fixtureDirectory,`${name}-request.json`),'utf8'))
  await main(`globalThis.__stepEvidenceElectron.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(path.join(fixtureDirectory,`${name}.cunlian`))}]});true`)
  const openedBad=await renderer('window.cunlian.openProject({})');assert.ok(openedBad.ok,JSON.stringify(openedBad))
  const badTarget=path.join(out,`${name}-must-not-exist.step`)
  await main(`globalThis.__stepEvidenceElectron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(badTarget)}});true`)
  const failure=await renderer(`window.cunlian.stepExport(${JSON.stringify({sessionId:openedBad.value.sessionId,baseEditSeq:openedBad.value.editSeq,revisionId:bad.revisionId,partId:bad.partId,expectedInputFingerprint:bad.expectedInputFingerprint,jobId:name})})`)
  await fs.writeFile(path.join(out,`${name}-receipt.json`),JSON.stringify(failure,null,2),{flag:'wx'})
  assert.equal(failure.ok,false);assert.equal(failure.error.code,bad.expectedCode);await assert.rejects(fs.stat(badTarget),{code:'ENOENT'})
 }
 const modules=await main(`Object.keys(process.mainModule.require('node:module')._cache)`)
 assert.ok(modules.every(name=>!name.includes('/step-implementation/')&&!name.includes('/node_modules/')))
 await fs.writeFile(path.join(out,'runtime-dependencies.json'),JSON.stringify({modules,profile:profile??null,workingDirectory:out,scope:'Packaged app module paths; OS denied development roots when profile present. Not a whole application network isolation claim.'},null,2),{flag:'wx'})
 assert.equal((await fs.readdir(out)).filter(n=>n.endsWith('.step-tmp')).length,0)
 console.log(JSON.stringify({status:'PASS',scope:'real packaged Electron main/preload IPC/worker/save; native dialogs stubbed via debugger, NOT native dialog UX verification',probe,target,receipt:receipt.value,missingWasmRejected:true,restored:true,cancelled:true},null,2))
 }
} finally {
 if(renamed)await fs.rename(path.join(assets,'spacer.wasm.mutation-hidden'),path.join(assets,'spacer.wasm'))
 if(main) {try{await main(`setTimeout(()=>globalThis.__stepEvidenceElectron.app.exit(0),30);true`)}catch{}}
 for(const socket of sockets)socket.close()
 let exit=await Promise.race([appExit,sleep(5000).then(()=>null)])
 if(!exit){app.kill('SIGKILL');exit=await appExit}
 await fs.writeFile(path.join(out,'electron.log'),output,{flag:'wx'});await fs.writeFile(path.join(out,'process-exit.json'),JSON.stringify(exit),{flag:'wx'})
 assert.equal(exit.code,0,'packaged process must exit normally');assert.equal(exit.signal,null)
}
