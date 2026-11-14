#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { defaultCorpusDir, MANIFEST_RELATIVE_PATH, measureCorpus } from './real-docs/metrics.mjs'
import { loadEvidenceJson } from './real-docs/tsImport.mjs'
const result=await measureCorpus({manifestPath:MANIFEST_RELATIVE_PATH,corpusDir:process.env.REAL_DOC_CORPUS??defaultCorpusDir()})
const {serializeEvidence}=await loadEvidenceJson()
writeFileSync('docs/evidence/ground-truth/metrics-gt-02.json',serializeEvidence(result))
console.log(JSON.stringify(result.summary.correctness,null,2))
for(const row of result.documents) {
 console.log(`${row.id}: ${row.candidates.pending} pending / ${row.correctness.pendingChecked} checked`)
 for(const d of row.correctness.details) for(const c of d.comparisons) if(c.differences.length) console.log(JSON.stringify({docId:row.id,page:d.page,crop:d.cropFile,...c,matches:d.matches}))
}
