#!/usr/bin/env node
/** Read-only packaged artifact checks, in addition to the existing PDF worker assertion. */
import { createHash } from 'node:crypto'
import { readFileSync,writeFileSync } from 'node:fs'
import { extractFile } from '@electron/asar'
import { loadEvidenceJson } from './real-docs/tsImport.mjs'
const asar='out/寸链-darwin-arm64/寸链.app/Contents/Resources/app.asar'
const pkg=JSON.parse(extractFile(asar,'package.json').toString('utf8'))
const main=extractFile(asar,pkg.main).toString('utf8')
const markers=['document-extractor-8','SUBSCRIPT_AMBIGUOUS','RULE_GEOMETRIC_SCRIPTS']
for(const marker of markers) if(!main.includes(marker)) throw new Error(`Packaged main missing ${marker}`)
const sha256=createHash('sha256').update(readFileSync(asar)).digest('hex')
const {serializeEvidence}=await loadEvidenceJson()
writeFileSync('docs/evidence/supersub-fix/package-proof.json',serializeEvidence({asar,sha256,main:pkg.main,markers,passed:true}))
console.log({asar,sha256,markers})
