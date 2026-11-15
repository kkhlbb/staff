import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const root='/Users/aston/DSH/tmp/cunlian-v4/risk-closeout'
const out='/Users/aston/DSH/tmp/cunlian-v4/risk-closeout-evidence/continuation-02/font-audit'
const require=createRequire(root+'/package.json')
const { extractFile, listPackage }=require('@electron/asar')
const asar=out.replace('/font-audit','/supply/app/寸链.app/Contents/Resources/app.asar')
mkdirSync(out,{recursive:true})
const results=[]
for(const name of ['NotoSansSC-Cunlian-subset.woff2','NotoSansMath-Cunlian-symbols.woff2','LICENSE-OFL-1.1.txt']){
 const member=listPackage(asar).find(p=>p.endsWith('/fonts/'+name))
 assert.ok(member,name)
 const bytes=extractFile(asar,member.slice(1))
 assert.deepEqual(bytes,readFileSync(root+'/public/fonts/'+name))
 writeFileSync(out+'/'+name,bytes)
 results.push({name,member,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),sameAsCurrentSource:true})
}
writeFileSync(out+'/packaged-font-binding.json',JSON.stringify({results},null,2)+'\n')
console.log(JSON.stringify(results,null,2))
