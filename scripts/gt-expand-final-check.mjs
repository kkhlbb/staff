#!/usr/bin/env node
import { readFileSync,writeFileSync,openSync,closeSync,appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { extractFile } from '@electron/asar'
import { loadEvidenceJson } from './real-docs/tsImport.mjs'
const dir='docs/evidence/ground-truth'
const {serializeEvidence}=await loadEvidenceJson()
const asar='out/寸链-darwin-arm64/寸链.app/Contents/Resources/app.asar'
const pkg=JSON.parse(extractFile(asar,'package.json').toString('utf8'))
const main=extractFile(asar,pkg.main).toString('utf8')
if(!main.includes('document-extractor-8'))throw Error('Wrong packaged extractor')
writeFileSync(`${dir}/package-proof.json`,serializeEvidence({asar,sha256:createHash('sha256').update(readFileSync(asar)).digest('hex'),main:pkg.main,extractorVersionMarker:'document-extractor-8',markerPresent:true,scope:'asar identity and PDF-worker static assertions, not packaged GUI interaction'}))
const file=`${dir}/logs/final-test.log`
const fd=openSync(file,'w')
const result=spawnSync('npm',['test'],{stdio:['ignore',fd,fd],timeout:600000,env:{...process.env,npm_config_offline:'true'}})
closeSync(fd)
appendFileSync(file,`\nEXIT_CODE=${result.status}\nSIGNAL=${result.signal}\n`)
const gates=JSON.parse(readFileSync(`${dir}/gates.json`,'utf8'))
const text=readFileSync(file,'utf8')
gates.rows.push({command:'npm test (final evidence inventory)',exitCode:result.status,signal:result.signal,log:file,outputSummary:text.split('\n').filter(line=>/Test Files|Tests\s/.test(line))})
writeFileSync(`${dir}/gates.json`,serializeEvidence(gates))
console.log(JSON.stringify(gates.rows.at(-1),null,2))
process.exitCode=result.status??1
