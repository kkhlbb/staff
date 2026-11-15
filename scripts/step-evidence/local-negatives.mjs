import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import { signatureMismatchWasm } from '../../desktop/tests/narrowWasmFixture.ts'
const [executable,fixtures,evidenceRoot] = process.argv.slice(2)
const out=path.resolve(evidenceRoot),root=process.cwd(),sha=b=>createHash('sha256').update(b).digest('hex')
function leb(value) {
 const bytes=[]
 do {const b=value&127;value>>>=7;bytes.push(b|(value?128:0))}while(value)
 return Buffer.from(bytes)
}
function sectionChanged(bytes,id,payload) {
 let cursor=8
 while(cursor<bytes.length) {
  const start=cursor,section=bytes[cursor++];let size=0,shift=0,b
  do{b=bytes[cursor++];size+=(b&127)*2**shift;shift+=7}while(b&128)
  const end=cursor+size
  if(section===id)return Buffer.concat([bytes.subarray(0,start),Buffer.from([id]),leb(payload.length),Buffer.from(payload),bytes.subarray(end)])
  cursor=end
 }
 throw Error('missing section')
}
const selected=fs.readFileSync(path.join(out,'candidate/modified.wasm'))
const excessiveMemory=sectionChanged(selected,5,[1,1,128,2,128,128,4]) // 65536 pages
const excessiveTable=sectionChanged(selected,4,[1,112,1,128,128,64,128,128,64]) // 1048576 entries
assert.equal(WebAssembly.validate(excessiveMemory),true)
assert.equal(WebAssembly.validate(excessiveTable),true)
const cases=[
 {name:'no-opt-in',bytes:selected,reason:'STEP_LOCAL_CONFIG',consent:'unset'},
 {name:'invalid-opt-in',bytes:selected,reason:'STEP_LOCAL_CONFIG',consent:'0'},
 {name:'invalid-binary',bytes:Buffer.alloc(64,1),reason:'STEP_LOCAL_COMPILE'},
 {name:'wrong-abi',bytes:Buffer.from([0,97,115,109,1,0,0,0]),reason:'STEP_LOCAL_ABI'},
 {name:'wrong-signature',bytes:signatureMismatchWasm(),reason:'STEP_LOCAL_ABI'},
 {name:'memory-limit',bytes:excessiveMemory,reason:'STEP_LOCAL_MEMORY'},
 {name:'table-limit',bytes:excessiveTable,reason:'STEP_LOCAL_TABLE'},
 {name:'wrong-hash',bytes:selected,reason:'STEP_LOCAL_HASH',wrongHash:true},
 {name:'missing',bytes:selected,reason:'STEP_LOCAL_FILE',kind:'missing'},
 {name:'symlink',bytes:selected,reason:'STEP_LOCAL_FILE',kind:'symlink'},
 {name:'directory',bytes:selected,reason:'STEP_LOCAL_FILE',kind:'directory'},
]
const summary=[]
// Full Electron under sandbox-exec failed at the inspector before export;
// preserve that first-attempt evidence. OS read denial is separately exercised
// with the exact main loader by local-permission.mjs, not counted as packaged QA.
for(const c of cases) {
 const candidate=path.join(out,'negative-candidates',c.name),result=path.join(out,'packaged-negative',c.name)
 fs.mkdirSync(candidate,{recursive:true})
 const file=path.join(candidate,'modified.wasm')
 if(c.kind==='symlink')fs.symlinkSync(path.join(out,'candidate/modified.wasm'),file)
 else if(c.kind==='directory')fs.mkdirSync(file)
 else if(c.kind!=='missing')fs.writeFileSync(file,c.bytes,{flag:'wx'})
 fs.writeFileSync(path.join(candidate,'candidate.json'),JSON.stringify({sha256:c.wrongHash?'0'.repeat(64):sha(c.bytes)},null,2),{flag:'wx'})
 const argv=[process.execPath,path.join(root,'scripts/step-evidence/packaged.mjs'),executable,fixtures,result,candidate,c.reason,c.consent??'1']
 const command=spawnSync(argv[0],argv.slice(1),{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024})
 const entry={name:c.name,expected:c.reason,argv,status:command.status,signal:command.signal,stdout:command.stdout,stderr:command.stderr,error:command.error?.message}
 fs.writeFileSync(path.join(out,'logs',`negative-${c.name}.json`),JSON.stringify(entry,null,2),{flag:'wx'})
 fs.writeFileSync(path.join(out,'logs',`negative-${c.name}.log`),(command.stdout||'')+(command.stderr||''),{flag:'wx'})
 summary.push({name:c.name,expected:c.reason,status:command.status});console.log(JSON.stringify(entry))
}
fs.writeFileSync(path.join(out,'negative-summary.json'),JSON.stringify(summary,null,2),{flag:'wx'})
assert.equal(summary.length,cases.length);assert.ok(summary.every(c=>c.status===0))
