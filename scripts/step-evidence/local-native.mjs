import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
const [evidenceRoot,python]=process.argv.slice(2),root=path.resolve(evidenceRoot)
const cases=[['product/base.step',200000],['product/odd.step',200001],...['packaged-default','packaged-local'].flatMap(dir=>[[`${dir}/packaged.step`,200000],[`${dir}/odd-packaged.step`,200001],[`${dir}/restored.step`,200000]])]
const results=[]
for(const [relative,d] of cases) {
 const file=path.join(root,relative),report=file+'.native.json',argv=[python,'-B',path.resolve('scripts/step-evidence/native-readback.py'),file,report,String(d),'320000','120000']
 assert.equal(fs.existsSync(report),false)
 const result=spawnSync(argv[0],argv.slice(1),{encoding:'utf8',maxBuffer:8*1024*1024})
 const label=relative.replaceAll('/','-'),record={argv,cwd:process.cwd(),status:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr}
 fs.writeFileSync(path.join(root,'logs',`native-${label}.json`),JSON.stringify(record,null,2),{flag:'wx'})
 fs.writeFileSync(path.join(root,'logs',`native-${label}.log`),(result.stdout||'')+(result.stderr||''),{flag:'wx'})
 const native=fs.existsSync(report)?JSON.parse(fs.readFileSync(report,'utf8')):null
 const modifiedHeader=fs.readFileSync(file,'utf8').includes('USER PATCHED STEP processor 8.0')
 results.push({relative,status:result.status,verdict:native?.status,modifiedHeader})
 if(relative.startsWith('packaged-local'))assert.equal(modifiedHeader,true)
 console.log(JSON.stringify(results.at(-1)))
}
fs.writeFileSync(path.join(root,'native-summary.json'),JSON.stringify(results,null,2),{flag:'wx'})
assert.equal(results.length,8);assert.ok(results.every(r=>r.status===0))
