// Evidence-only source mutations. Never edits production sources or committed evidence.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { assetDirectory,hashes,root } from '../step-assets.mjs'
const [out,python]=process.argv.slice(2);if(!python)throw Error('Usage: node mutations.mjs <new dir> <isolated native python>')
await fs.mkdir(out,{recursive:true})
const original=await fs.readFile(path.join(root,'desktop/main/cad/step-worker.cjs'),'utf8')
// Native-reader mutations intentionally bypass exporter geometry guards to exercise independent oracle.
// Exact bypass plus each geometry change is preserved in full unified diff via git --no-index.
const unguarded=original.replace(/  assert.ok\(!shape.IsNull\(\)[\s\S]+?(?=  \/\/ Seed initializes STEP static settings\.)/,'  // EVIDENCE ONLY: bypass exporter post-build guards to test independent native reader.\n')
assert.notEqual(unguarded,original)
const cases=[
 ['green',original,200001,0,null],
 ['diameter-as-radius',unguarded.replaceAll('input.outerDiameter / 20000','input.outerDiameter / 10000').replaceAll('input.innerDiameter / 20000','input.innerDiameter / 10000'),200001,3,'radius mismatch'],
 ['solid-instead-of-hole',unguarded.replace('const shape = cut.Shape();','const shape = a;'),200001,3,'face topology'],
 ['half-q-truncated',unguarded.replace('input.innerDiameter / 20000','Math.floor(input.innerDiameter / 2) / 10000'),200001,3,'radius mismatch'],
 ['unit-scale-25.4',unguarded.replace('L = input.length / 10000','L = input.length / 10000 * 25.4').replace('input.outerDiameter / 20000','input.outerDiameter / 20000 * 25.4').replace('input.innerDiameter / 20000','input.innerDiameter / 20000 * 25.4'),200001,3,'radius mismatch'],
 ['AP242',original.replace("['write.step.schema', 'AP214IS']","['write.step.schema', 'AP242DIS']").replace("IVal('write.step.schema'), 4","IVal('write.step.schema'), 5"),200001,3,'schema mismatch'],
 ['unit-inch',original.replace("['write.step.unit', 'MM']","['write.step.unit', 'INCH']"),200001,3,'source unit policy rejects non-mm'],
 ['green-after',original,200001,0,null],
]
const summary=[]
for(const [name,source,inner,expected,reason] of cases) {
 const dir=path.join(out,name);await fs.mkdir(dir)
 const worker=path.join(dir,'worker.cjs');await fs.writeFile(worker,source,{flag:'wx'})
 await fs.writeFile(path.join(dir,'original.cjs'),original,{flag:'wx'})
 const diff=spawnSync('git',['diff','--no-index','--','original.cjs','worker.cjs'],{cwd:dir,encoding:'utf8'});await fs.writeFile(path.join(dir,'mutation.patch'),diff.stdout,{flag:'wx'})
 const start=performance.now()
 const bytes=await new Promise((resolve,reject)=>{const w=new Worker(worker,{workerData:{input:{innerDiameter:inner,outerDiameter:320000,length:120000},assetDirectory,hashes}});const timer=setTimeout(()=>{w.terminate();reject(Error('timeout'))},30000);w.once('error',reject);w.once('message',async m=>{clearTimeout(timer);await w.terminate();m.error?reject(Error(m.error)):resolve(m.bytes)})})
 const step=path.join(dir,'model.step');await fs.writeFile(step,bytes,{flag:'wx'})
 const read=spawnSync(python,['-B',path.join(root,'scripts/step-evidence/native-readback.py'),step,path.join(dir,'readback.json'),String(inner),'320000','120000'],{encoding:'utf8'})
 await fs.writeFile(path.join(dir,'native.log'),read.stdout+'\nSTDERR:\n'+read.stderr,{flag:'wx'})
 const report=JSON.parse(await fs.readFile(path.join(dir,'readback.json'),'utf8'))
 const item={name,workerExit:'terminated-after-result',nativeExit:read.status,expectedExit:expected,reason:report.reason??null,expectedReason:reason,passed:read.status===expected&&(reason===null?report.status==='ACCEPTED':report.reason===reason),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),elapsedMs:performance.now()-start}
 summary.push(item);console.log(JSON.stringify(item));assert.ok(item.passed,JSON.stringify(item))
}
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2),{flag:'wx'})
assert.equal(await fs.readFile(path.join(root,'desktop/main/cad/step-worker.cjs'),'utf8'),original)
