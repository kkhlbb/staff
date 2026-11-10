// Real Electron/IPC/filesystem integration. Only dialog responses are automated
// through the main-process debugger. This is NOT evidence of native button clicks.
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
const dir = new URL('.', import.meta.url).pathname
const log = []
const sleep = ms => new Promise(r => setTimeout(r, ms))
function record(label, data) {
  const line = `${new Date().toISOString()} ${label} ${JSON.stringify(data)}`
  console.log(line); log.push(line)
  writeFileSync(`${dir}dirty-branches.log`, log.join('\n') + '\n')
}
function check(label, condition, data) {
  record(`${condition ? 'PASS' : 'FAIL'} ${label}`, data)
  if (!condition) throw Error(label)
}
async function connect(port, page = false) {
  const ts = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const ws = new WebSocket(ts.find(t => !page || t.type === 'page').webSocketDebuggerUrl)
  await new Promise(r => ws.addEventListener('open', r))
  let seq = 0; const pending = new Map()
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id) })
  const send = (method, params) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
  return {
    ws, send,
    async eval(expression) {
      const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (m.result?.exceptionDetails || m.error) throw Error(JSON.stringify(m))
      return m.result?.result?.value
    },
  }
}
const main = await connect(9244), page = await connect(9344, true)
try {
  await page.send('Page.navigate', { url: 'http://localhost:5173/index.desktop.html' }); await sleep(1400)
  record('environment', await main.eval(`globalThis.R=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');globalThis.E=R('electron');({electron:process.versions.electron,pid:process.pid,window:E.BrowserWindow.getAllWindows()[0].getBounds(),zoom:E.BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()})`))
  await page.eval(`(()=>{let f=document.querySelector('main')[Object.keys(document.querySelector('main')).find(k=>k.startsWith('__reactFiber'))];while(f&&f.type?.name!=='DesktopWorkspace')f=f.return;let h=f.memoizedState;while(h){if(h.memoizedState?.current?.constructor?.name==='DesktopSessionAdapter')window.A=h.memoizedState.current;h=h.next;}return !!window.A})()`)
  await main.eval(`globalThis.nativeMessage=E.dialog.showMessageBox;globalThis.nativeSave=E.dialog.showSaveDialog;globalThis.dialogSeen=[];E.dialog.showMessageBox=async(...args)=>{const o=args.at(-1);dialogSeen.push(o);return await new Promise(resolve=>globalThis.choose=response=>resolve({response,checkboxChecked:false}))};globalThis.saveTarget=${JSON.stringify(dir + 'dirty-saved.cunlian')};E.dialog.showSaveDialog=async()=>({canceled:false,filePath:saveTarget});`)
  const state = () => page.eval(`(()=>{const s=A.getState();return {sessionId:s.sessionId,projectId:s.snapshot?.project.id,name:s.snapshot?.project.name,acceptedSeq:s.acceptedSeq,savedSeq:s.savedSeq,dirty:s.dirty,path:s.path}})()`)
  const recover = () => page.eval('window.cunlian.listRecovery()')
  async function start(expression) {
    const before = await main.eval('dialogSeen.length')
    await page.eval(`window.branchResult=null;(${expression}).then(r=>window.branchResult=r);true`)
    for (let i=0;i<50;i++) { if (await main.eval('dialogSeen.length') > before) return; await sleep(100) }
    throw Error('dirty dialog was not requested')
  }
  async function complete(response) {
    await main.eval(`choose(${response});true`)
    for (let i=0;i<70;i++) { const r=await page.eval('window.branchResult'); if(r!==null)return r; await sleep(100) }
    throw Error('gate did not finish')
  }
  const shot = async name => { await sleep(200); await main.eval(`(async()=>{R('node:fs').writeFileSync(${JSON.stringify(dir)}+${JSON.stringify(name)}+'.png',(await E.BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG());return true})()`) }
  check('create through real preload IPC', (await page.eval(`A.newProject('A04b 分支实测','chain-demo')`)).ok, null)
  check('edit through existing UI adapter and real stageDraft', (await page.eval(`(async()=>{const s=structuredClone(A.getState().snapshot);s.project.name='A04b 取消后编辑仍在';A.edit(s);return A.flushStage()})()`)).ok, null)
  const original=await state()
  await start('window.cunlian.requestClose()')
  record('requestClose native-dialog options (automated response only)', await main.eval('dialogSeen.at(-1)'))
  const draftBefore = await recover(); const draft=draftBefore.value.items.find(i=>i.projectId===original.projectId)
  check('draft physically exists before choice', !!draft, draftBefore)
  const root=await main.eval(`E.app.getPath('userData')+'/workspace/recovery/'`)
  check('draft file on disk before choice', existsSync(root+draft.recoveryId+'.cunlian'), {root,recoveryId:draft.recoveryId})
  const cancelled=await complete(2), afterCancel=await state()
  check('cancel close: same session/name/editSeq/dirty and window remains', !cancelled.ok&&cancelled.error.code==='CANCELLED'&&JSON.stringify(original)===JSON.stringify(afterCancel)&&(await main.eval('E.BrowserWindow.getAllWindows().length'))===1, {result:cancelled,before:original,after:afterCancel})
  await shot('dirty-cancel-after')
  await start(`A.newProject('A04b 不保存后目标项目','empty')`)
  const discarded=await complete(1), afterDiscard=await state(), recAfter=await recover()
  check('discard switches and removes recovery index AND actual draft file', discarded.ok&&afterDiscard.sessionId!==original.sessionId&&afterDiscard.name==='A04b 不保存后目标项目'&&!recAfter.value.items.some(i=>i.projectId===original.projectId)&&!existsSync(root+draft.recoveryId+'.cunlian'), {result:discarded.ok,after:afterDiscard,recovery:recAfter,fileExists:existsSync(root+draft.recoveryId+'.cunlian')})
  await shot('dirty-discard-after')
  await page.eval(`(async()=>{const s=structuredClone(A.getState().snapshot);s.project.name='A04b 必须真实保存的编辑';A.edit(s);await A.flushStage();return true})()`)
  const beforeSave=await state()
  // Delay only the real target rename, without replacing the actual filesystem commit.
  await main.eval(`globalThis.F=R('node:fs').promises;globalThis.realRename=F.rename;globalThis.renameWaiting=false;F.rename=async function(from,to){if(to===saveTarget){renameWaiting=true;await new Promise(r=>globalThis.releaseRename=r)}return realRename.call(this,from,to)}`)
  await start(`A.newProject('A04b 保存后目标项目','empty')`)
  await main.eval('choose(0);true')
  for(let i=0;i<60;i++){if(await main.eval('renameWaiting'))break;await sleep(100)}
  const waitingState=await state()
  check('save does NOT switch before actual filesystem rename', (await main.eval('renameWaiting'))&&JSON.stringify(waitingState)===JSON.stringify(beforeSave)&&(await page.eval('window.branchResult'))===null&&!existsSync(dir+'dirty-saved.cunlian'), {before:beforeSave,waiting:waitingState,result:await page.eval('window.branchResult'),targetExists:existsSync(dir+'dirty-saved.cunlian')})
  await main.eval('releaseRename();true')
  for(let i=0;i<60;i++){if(await page.eval('window.branchResult'))break;await sleep(100)}
  const savedResult=await page.eval('window.branchResult'), afterSave=await state()
  const bytes=readFileSync(dir+'dirty-saved.cunlian'), digest=createHash('sha256').update(bytes).digest('hex')
  check('save switches only after successful disk commit', savedResult.ok&&afterSave.sessionId!==beforeSave.sessionId&&afterSave.name==='A04b 保存后目标项目'&&bytes.length>0, {result:savedResult.ok,after:afterSave,disk:{path:dir+'dirty-saved.cunlian',bytes:bytes.length,sha256:digest}})
  await shot('dirty-save-after')
  await main.eval('F.rename=realRename;true')
  await page.eval(`(async()=>{const s=structuredClone(A.getState().snapshot);s.project.name='A04b ENOENT 后仍保留';A.edit(s);await A.flushStage();return true})()`)
  const failureState=await state()
  await main.eval(`saveTarget=${JSON.stringify(dir+'enoent-injected.cunlian')};globalThis.realOpen=F.open;F.open=async function(p,...args){if(String(p).startsWith(saveTarget+'.')){throw Object.assign(new Error('injected ENOENT at exclusive temp-file open'),{code:'ENOENT'})}return realOpen.call(this,p,...args)};true`)
  for(const [name,expression] of [['switch',`A.newProject('不得切换到此项目','empty')`],['requestClose','window.cunlian.requestClose()']]) {
    await start(expression)
    const r=await complete(0), after=await state()
    check(`real ENOENT blocks ${name}, preserves session/edit/dirty/window`, !r.ok&&String(r.error.detail).includes('ENOENT')&&JSON.stringify(after)===JSON.stringify(failureState)&&(await main.eval('E.BrowserWindow.getAllWindows().length'))===1, {result:r,before:failureState,after,windowCount:await main.eval('E.BrowserWindow.getAllWindows().length')})
    await shot('dirty-save-failure-'+name)
  }
  record('RESULT','PASS Electron IPC/filesystem branches; native clicking/screenshot NOT verified by this script')
} finally {
  await main.eval('E.dialog.showMessageBox=nativeMessage;E.dialog.showSaveDialog=nativeSave;if(globalThis.realRename)F.rename=realRename;if(globalThis.realOpen)F.open=realOpen;true')
  main.ws.close();page.ws.close()
}
