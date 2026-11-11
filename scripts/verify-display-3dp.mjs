import fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
const dir='docs/evidence/display-3dp/logs/'
await fs.mkdir(dir,{recursive:true})
const results=[]
for(const name of ['typecheck','typecheck:desktop','lint','test','test:desktop','build','package:desktop']) {
 const r=spawnSync('npm',['run',name],{encoding:'utf8',maxBuffer:64*1024*1024})
 const output=(r.stdout??'')+(r.stderr??'')
 const log=dir+name.replaceAll(':','-')+'.log'
 await fs.writeFile(log,output)
 results.push({command:`npm run ${name}`,exitCode:r.status,signal:r.signal,log})
 console.log(JSON.stringify(results.at(-1)))
 console.log(output.split('\n').slice(-12).join('\n'))
}
await fs.writeFile('docs/evidence/display-3dp/verification.json',JSON.stringify(results,null,2)+'\n')
if(results.some(x=>x.exitCode!==0))process.exitCode=1
