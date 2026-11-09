// Real native showMessageBox; no dialog-response mock in this capture attempt.
import { writeFileSync } from 'node:fs'
const dir=new URL('.',import.meta.url).pathname
async function connect(port,page=false){
 const ts=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
 const ws=new WebSocket(ts.find(t=>!page||t.type==='page').webSocketDebuggerUrl)
 await new Promise(r=>ws.addEventListener('open',r));let id=0;const pending=new Map()
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id)})
 return {ws,eval:expression=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,m=>m.result?.exceptionDetails?reject(Error(JSON.stringify(m))):resolve(m.result?.result?.value));ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))})}
}
const main=await connect(9244),page=await connect(9344,true)
const log=[];const record=(label,result)=>{log.push({label,result});writeFileSync(dir+'dirty-capture-attempts.json',JSON.stringify(log,null,2));console.log(label,JSON.stringify(result))}
try{
 record('native dialog observation installed',await main.eval(`globalThis.captureOptions=null;globalThis.realNativeDialog=E.dialog.showMessageBox;E.dialog.showMessageBox=(...args)=>{captureOptions=args.at(-1);return realNativeDialog.apply(E.dialog,args)};true`))
 await page.eval('window.nativeCloseResult=null;window.cunlian.requestClose().then(r=>window.nativeCloseResult=r);true')
 await new Promise(r=>setTimeout(r,900))
 record('real showMessageBox called; promise pending',await main.eval('({options:captureOptions,windowCount:E.BrowserWindow.getAllWindows().length,pid:process.pid})'))
 record('requestClose pending',await page.eval('({closeResult:window.nativeCloseResult,state:{name:A.getState().snapshot.project.name,dirty:A.getState().dirty,acceptedSeq:A.getState().acceptedSeq,savedSeq:A.getState().savedSeq}})'))
 record('capturePage attempt',await main.eval(`(async()=>{const w=E.BrowserWindow.getAllWindows()[0];const img=await w.webContents.capturePage();const p=${JSON.stringify(dir+'dirty-capturePage-attempt.png')};R('node:fs').writeFileSync(p,img.toPNG());return {path:p,size:img.getSize(),bounds:w.getBounds(),zoom:w.webContents.getZoomFactor()}})()`))
 record('Electron native capture sources',await main.eval(`(async()=>({screenPermission:E.systemPreferences.getMediaAccessStatus('screen'),displays:E.screen.getAllDisplays().map(d=>({id:d.id,size:d.size,scaleFactor:d.scaleFactor})),screens:(await E.desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:2560,height:1440}})).map(s=>({id:s.id,name:s.name,size:s.thumbnail.getSize()})),windows:(await E.desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1440,height:900}})).map(s=>({id:s.id,name:s.name,size:s.thumbnail.getSize()}))}))()`))
 record('status','BLOCKED: capturePage contains renderer only; inspect image before accepting. No dirty-dialog.png produced. Native sheet requires working OS capture path.')
}finally{main.ws.close();page.ws.close()}
