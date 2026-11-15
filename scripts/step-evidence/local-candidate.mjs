import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
export function modifiedWasm(original) {
  const b=Buffer.from(original);let p=8
  function u(){let n=0,s=0,x;do{x=b[p++];n+=(x&127)*2**s;s+=7;assert.ok(s<=35)}while(x&128);return n}
  let memoryChanged=false
  while(p<b.length){const id=b[p++],len=u(),end=p+len;if(id===5){assert.equal(u(),1);assert.equal(u(),1);u();const start=p;assert.equal(u(),65536);assert.equal(p-start,3);b.set([128,192,0],start);memoryChanged=true}p=end}
  assert.ok(memoryChanged)
  let changes=0
  for(const text of ['Open CASCADE STEP translator 8.0','Open CASCADE %s processor 8.0']) {
    const old=Buffer.from(text),replacement=Buffer.from(text.replace('Open CASCADE','USER PATCHED'))
    assert.equal(old.length,replacement.length)
    const offset=b.indexOf(old);assert.ok(offset>0);assert.equal(b.indexOf(old,offset+1),-1)
    replacement.copy(b,offset);changes++
  }
  assert.equal(WebAssembly.validate(b),true)
  return {bytes:b,changes,memoryMaximumPages:8192}
}
if(process.argv[1]===new URL(import.meta.url).pathname) {
  const [source,out]=process.argv.slice(2);fs.mkdirSync(out,{recursive:true})
  const result=modifiedWasm(fs.readFileSync(source));fs.writeFileSync(path.join(out,'modified.wasm'),result.bytes,{flag:'wx'})
  const info={...result,bytes:undefined,sha256:createHash('sha256').update(result.bytes).digest('hex'),kind:'WASM data-section behavior modification and memory maximum reduction; NOT source-rebuilt OCCT or full LGPL relink proof'}
  fs.writeFileSync(path.join(out,'candidate.json'),JSON.stringify(info,null,2),{flag:'wx'});console.log(info)
}
