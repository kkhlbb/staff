import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const [out, label, ...argv] = process.argv.slice(2)
fs.mkdirSync(out,{recursive:true})
const result=spawnSync(argv[0],argv.slice(1),{encoding:'utf8',env:process.env,maxBuffer:64*1024*1024})
const record={argv,cwd:process.cwd(),status:result.status,signal:result.signal,error:result.error?.message,stdout:result.stdout,stderr:result.stderr}
fs.writeFileSync(path.join(out,label+'.json'),JSON.stringify(record,null,2),{flag:'wx'})
fs.writeFileSync(path.join(out,label+'.log'),(result.stdout||'')+(result.stderr||''),{flag:'wx'})
console.log(JSON.stringify(record,null,2));process.exitCode=result.status??1
