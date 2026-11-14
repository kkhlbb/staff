#!/usr/bin/env node
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { loadEvidenceJson } from './real-docs/tsImport.mjs'
const dir='docs/evidence/ground-truth/mutations'
mkdirSync(dir,{recursive:true})
const file='scripts/real-docs/metrics.mjs'
const original=readFileSync(file,'utf8')
const hash=text=>createHash('sha256').update(text).digest('hex')
const run=()=>spawnSync('./node_modules/.bin/vitest',['run','--config','vitest.realdocs.config.ts','scripts/real-docs/correctness-expand.test.ts'],{encoding:'utf8',timeout:120000})
const mutations=[
 {id:'M59',from:'const details = truths.filter(t => t.docId === docId).map(truth => {',to:'const details = truths.filter(t => t.docId === docId).slice(0, -1).map(truth => {'},
 {id:'M60',from:'const verified = cropValid && pending.length === 1 ? pending : []',to:'const verified = (cropValid || !truth.cropFile) && pending.length === 1 ? pending : []'},
]
const rows=[]
for(const mutation of mutations) {
 if(!original.includes(mutation.from))throw Error(`${mutation.id} missing target`)
 const altered=original.replace(mutation.from,mutation.to)
 writeFileSync(`${dir}/${mutation.id}.patch`,`--- a/${file}\n+++ b/${file}\n@@\n-${mutation.from}\n+${mutation.to}\n`)
 let red
 try {
  writeFileSync(file,altered)
  red=run()
  writeFileSync(`${dir}/${mutation.id}-red.log`,`${red.stdout}${red.stderr}\nEXIT_CODE=${red.status}\nSIGNAL=${red.signal}\n`)
 } finally {writeFileSync(file,original)}
 const green=run()
 writeFileSync(`${dir}/${mutation.id}-green.log`,`${green.stdout}${green.stderr}\nEXIT_CODE=${green.status}\nSIGNAL=${green.signal}\n`)
 const killed=red.status!==0&&red.status!==null&&`${red.stdout}${red.stderr}`.includes('AssertionError')
 const restored=hash(readFileSync(file,'utf8'))===hash(original)
 rows.push({id:mutation.id,redExitCode:red.status,redSignal:red.signal,assertionKilled:killed,greenExitCode:green.status,greenSignal:green.signal,sourceRestored:restored,sourceSha256:hash(original)})
 const {serializeEvidence}=await loadEvidenceJson()
 writeFileSync('docs/evidence/ground-truth/mutations.json',serializeEvidence({rows}))
 console.log(rows.at(-1))
 if(!killed||green.status!==0||!restored)process.exitCode=1
}
