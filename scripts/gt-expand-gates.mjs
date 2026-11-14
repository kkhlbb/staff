#!/usr/bin/env node
import { readFileSync,writeFileSync,mkdirSync,openSync,closeSync,appendFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { loadEvidenceJson } from './real-docs/tsImport.mjs'
const dir='docs/evidence/ground-truth'
mkdirSync(`${dir}/logs`,{recursive:true})
const {serializeEvidence}=await loadEvidenceJson()
const commands=[
 ['typecheck','npm',['run','typecheck']],['typecheck-desktop','npm',['run','typecheck:desktop']],
 ['lint','npm',['run','lint']],['test','npm',['test']],['test-desktop','npm',['run','test:desktop']],
 ['test-mcp','npm',['run','test:mcp']],['build','npm',['run','build']],
 ['test-real-docs','npm',['run','test:real-docs']],['metrics','node',['scripts/real-doc-metrics.mjs']],
 ['package-desktop','npm',['run','package:desktop']],['package-pdf-worker','npm',['run','check:package:pdf-worker']],
]
const rows=[]
writeFileSync(`${dir}/gates.json`,serializeEvidence({rows}))
for(const [name,command,args] of commands) {
 const log=`${dir}/logs/${name}.log`
 const fd=openSync(log,'w')
 const result=spawnSync(command,args,{stdio:['ignore',fd,fd],timeout:600000,env:{...process.env,npm_config_offline:'true'}})
 closeSync(fd)
 appendFileSync(log,`\nEXIT_CODE=${result.status}\nSIGNAL=${result.signal}\n${result.error?`ERROR=${result.error.message}\n`:''}`)
 const text=readFileSync(log,'utf8')
 rows.push({command:[command,...args].join(' '),exitCode:result.status,signal:result.signal,error:result.error?.message??null,log,
 outputSummary:text.split('\n').filter(line=>/Test Files|Tests\s|correctness:|BASELINE MATCH|PASS|Error|error TS|✖/.test(line))})
 writeFileSync(`${dir}/gates.json`,serializeEvidence({rows}))
 console.log(`${name}: exit=${result.status} signal=${result.signal}`)
}
if(rows.some(row=>row.exitCode!==0))process.exitCode=1
