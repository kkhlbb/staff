// Evidence-only C++ source mutations: independent native oracle, never production edits.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { root } from '../step-assets.mjs'
const [out,python,toolWork,supply]=process.argv.slice(2)
if(!supply)throw Error('Usage: mutations.mjs <new output> <native python> <prepared SDK work> <core supply directory>')
await fs.mkdir(out,{recursive:true})
const original=await fs.readFile(path.join(root,'vendor/step-narrow-v1/spacer.cpp'),'utf8')
// These deliberate bypasses apply ONLY to independently compiled oracle mutants.
const unguarded=original.replace('!validate_geometry(cut.Shape(),outer,inner,height)','false').replace('!validate_geometry(reader.OneShape(),outer,inner,height)','false')
assert.notEqual(unguarded,original)
const cases=[
 ['green',original,0,null],
 ['diameter-as-radius',unguarded.replace('outer/2,height','outer,height').replace('inner/2,height','inner,height'),3,'radius mismatch'],
 ['solid-instead-of-hole',unguarded.replace('writer.Transfer(cut.Shape(),','writer.Transfer(a,'),3,'face topology'],
 ['half-q-truncated',unguarded.replace('inner/2,height','std::floor(inner*10000/2)/10000,height'),3,'radius mismatch'],
 ['unit-scale-25.4',unguarded.replace('gp_Pnt(-height/2,','gp_Pnt(-height/2*25.4,').replace('outer/2,height','outer/2*25.4,height*25.4').replace('inner/2,height','inner/2*25.4,height*25.4'),3,'radius mismatch'],
 ['AP242',unguarded.replace('"AP214IS"','"AP242DIS"').replace('IVal("write.step.schema")!=4','IVal("write.step.schema")!=5'),3,'schema mismatch'],
 ['unit-inch',unguarded.replace('{"write.step.unit","MM"}','{"write.step.unit","INCH"}'),3,'source unit policy rejects non-mm'],
 ['green-after',original,0,null],
]
const env={...process.env,EM_CONFIG:path.resolve(toolWork,'emscripten-config.py'),EM_CACHE:path.resolve(toolWork,'cache'),HOME:path.resolve(toolWork,'home'),TMPDIR:path.resolve(toolWork,'tmp'),TMP:path.resolve(toolWork,'tmp'),TEMP:path.resolve(toolWork,'tmp'),SOURCE_DATE_EPOCH:'1785268800',TZ:'UTC',LC_ALL:'C'}
delete env.ELECTRON_RUN_AS_NODE
const sdk=path.resolve(toolWork,'sdk/install'),inputs=path.resolve(supply,'inputs')
const libs=(await fs.readdir(path.join(inputs,'lib'))).filter(n=>/^libTK.*\.a$/.test(n)).sort().map(n=>path.join(inputs,'lib',n));assert.equal(libs.length,23)
const summary=[]
for(const [name,source,expected,reason] of cases) {
 const dir=path.resolve(out,name);await fs.mkdir(dir)
 const cpp=path.join(dir,'spacer.cpp'),object=path.join(dir,'spacer.o'),js=path.join(dir,'spacer.cjs')
 await fs.writeFile(cpp,source,{flag:'wx'});await fs.writeFile(path.join(dir,'original.cpp'),original,{flag:'wx'})
 const diff=spawnSync('git',['diff','--no-index','--','original.cpp','spacer.cpp'],{cwd:dir,encoding:'utf8'});await fs.writeFile(path.join(dir,'mutation.patch'),diff.stdout,{flag:'wx'})
 async function run(args,label,expectedCode=0) {
  const result=spawnSync(args[0],args.slice(1),{env,encoding:'utf8',maxBuffer:32*1024*1024})
  await fs.writeFile(path.join(dir,label+'.json'),JSON.stringify({args,status:result.status,signal:result.signal,error:result.error?.message},null,2),{flag:'wx'})
  await fs.writeFile(path.join(dir,label+'.log'),result.stdout+'\nSTDERR:\n'+result.stderr,{flag:'wx'})
  assert.equal(result.status,expectedCode,`${name}/${label}: ${result.stderr}`);return result
 }
 await run([path.join(sdk,'emscripten/em++'),'-std=c++17','-O2','-fexceptions','-I'+path.join(inputs,'include/opencascade'),'-c',cpp,'-o',object],'compile')
 await run([path.join(sdk,'emscripten/em++'),'--no-entry','-O2','-fexceptions',object,'-Wl,--start-group',...libs,'-Wl,--end-group','-lpthread','-lrt','-lstdc++','-ldl','-sDISABLE_EXCEPTION_CATCHING=0','-sMALLOC=dlmalloc','-sMODULARIZE=1','-sEXPORT_NAME=createNarrowSpacer','-sENVIRONMENT=node,web,worker','-sFORCE_FILESYSTEM=1','-sALLOW_MEMORY_GROWTH=1','-sMAXIMUM_MEMORY=536870912','-sERROR_ON_UNDEFINED_SYMBOLS=1','-sEXPORTED_FUNCTIONS=["_spacer_step"]','-sEXPORTED_RUNTIME_METHODS=["FS"]','-o',js],'link')
 const runner=path.join(dir,'export.cjs'),step=path.join(dir,'model.step')
 await fs.writeFile(runner,`const fs=require('node:fs');require('./spacer.cjs')({print:()=>{},printErr:()=>{}}).then(m=>{const code=m._spacer_step(32,20.0001,12);if(code!==0)throw Error('status '+code);fs.writeFileSync('model.step',m.FS.readFile('/spacer.step'))}).catch(e=>{console.error(e);process.exitCode=1})`,{flag:'wx'})
 const exported=spawnSync(process.execPath,[runner],{cwd:dir,env,encoding:'utf8'});await fs.writeFile(path.join(dir,'export.log'),exported.stdout+exported.stderr,{flag:'wx'});assert.equal(exported.status,0)
 await run([python,'-B',path.join(root,'scripts/step-evidence/native-readback.py'),step,path.join(dir,'readback.json'),'200001','320000','120000'],'native',expected)
 const report=JSON.parse(await fs.readFile(path.join(dir,'readback.json'),'utf8')),bytes=await fs.readFile(step)
 const item={name,nativeExit:expected,expectedReason:reason,actualReason:report.reason??null,status:report.status,sha256:createHash('sha256').update(bytes).digest('hex')}
 assert.equal(report.reason??null,reason);if(expected===0)assert.equal(report.status,'ACCEPTED')
 summary.push(item);console.log(JSON.stringify(item))
}
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2),{flag:'wx'})
assert.equal(await fs.readFile(path.join(root,'vendor/step-narrow-v1/spacer.cpp'),'utf8'),original)
