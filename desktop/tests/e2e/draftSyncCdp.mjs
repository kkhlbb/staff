import fs from 'node:fs/promises'
export const out = new URL('../../../docs/evidence/V3.5-draft-sync/', import.meta.url).pathname
export const sleep = ms => new Promise(r => setTimeout(r, ms))
export async function connect(port = 9476) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target = targets.find(x => x.type === 'page')
  if (!target) throw new Error('Missing application page')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve,reject) => {socket.addEventListener('open',resolve);socket.addEventListener('error',reject)})
  let id=0
  const pending=new Map()
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result)}})
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(new Error('Timeout '+method))},30000);pending.set(n,{resolve,reject,timer});socket.send(JSON.stringify({id:n,method,params}))})
  const evaluate=async(expression)=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value}
  const shot=async(name,clip)=>{const r=await send('Page.captureScreenshot',{format:'png',...(clip?{clip}: {})});await fs.writeFile(out+name+'.png',Buffer.from(r.data,'base64'))}
  const wait=async(expression,timeout=25000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(expression))return;await sleep(150)}throw new Error('Condition timeout '+expression)}
  return {send,evaluate,shot,wait,close:()=>socket.close()}
}
