import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const [executable,fixtures,evidenceRoot] = process.argv.slice(2)
const out=path.resolve(evidenceRoot),root=process.cwd(),sha=b=>createHash('sha256').update(b).digest('hex')
const original=fs.readFileSync('node_modules/replicad-opencascadejs/dist/replicad_single.wasm')
const selected=fs.readFileSync(path.join(out,'candidate/modified.wasm'))
const excessiveTable=Buffer.from(selected);excessiveTable.set([255,255,127],36538)
const cases=[
 {name:'no-opt-in',bytes:selected,reason:'STEP_LOCAL_CONFIG',consent:'unset'},
 {name:'invalid-opt-in',bytes:selected,reason:'STEP_LOCAL_CONFIG',consent:'0'},
 {name:'invalid-binary',bytes:Buffer.alloc(64,1),reason:'STEP_LOCAL_COMPILE'},
 {name:'wrong-abi',bytes:Buffer.from([0,97,115,109,1,0,0,0]),reason:'STEP_LOCAL_ABI'},
 {name:'memory-limit',bytes:original,reason:'STEP_LOCAL_MEMORY'},
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
