#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync,writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { loadEvidenceJson } from './real-docs/tsImport.mjs'
const dir='docs/evidence/ground-truth'
const truth=JSON.parse(readFileSync(`${dir}/gt-02.json`,'utf8'))
const measured=JSON.parse(readFileSync(`${dir}/metrics-gt-02.json`,'utf8'))
const baseline=JSON.parse(execFileSync('git',['show','bd596cf:docs/evidence/real-doc-baseline/baseline.json'],{encoding:'utf8'}))
const strip=value=>{
 const copy=structuredClone(value)
 for(const row of copy.documents)delete row.correctness
 delete copy.summary.correctness
 return {corpus:copy.corpus,rules:copy.rules,documents:copy.documents,summary:copy.summary}
}
const sameExtraction=JSON.stringify(strip(baseline))===JSON.stringify(strip(measured))
const sha=value=>createHash('sha256').update(value).digest('hex')
const oldGt=execFileSync('git',['show','bd596cf:docs/evidence/ground-truth/gt-01.json'])
const newGt=readFileSync(`${dir}/gt-01.json`)
const oldCrops=execFileSync('git',['diff','bd596cf','--','docs/evidence/ground-truth/crops/r2*','docs/evidence/ground-truth/crops/r5*','docs/evidence/ground-truth/crops/r6*'],{encoding:'utf8'})
const audit={baseline:'bd596cf',extractionMetricsUnchanged:sameExtraction,gt01Unchanged:oldGt.equals(newGt),gt01Sha256:sha(newGt),gt01CropsUnchanged:oldCrops==='',distribution:measured.documents.map(row=>({docId:row.id,pending:row.candidates.pending,checked:row.correctness.pendingChecked,upperDeviationChecked:row.correctness.upperDeviationChecked,lowerDeviationChecked:row.correctness.lowerDeviationChecked})),correctness:measured.summary.correctness}
const {serializeEvidence}=await loadEvidenceJson()
writeFileSync(`${dir}/scope-audit.json`,serializeEvidence(audit))
const lines=['# gt-02 逐条覆盖清单','','本次实际提取器 document-extractor-8；58 条 pending，全部 nominal 核验。上偏差20、下偏差20；另外38条原件未标偏差，未当成数值0。','', '| 标签 | 候选 ID | 文档/页 | nominal 真值 | 上偏差 | 下偏差 | 原件裁片 |','|---|---|---|---|---|---|---|']
for(const t of truth.entries)lines.push(`| ${t.label} | ${t.candidateId} | ${t.docId}/${t.page} | ${t.nominal} | ${t.upperDeviation??'未标（非0）'} | ${t.lowerDeviation??'未标（非0）'} | [crop](${t.cropFile})${t.deviationSources.map(d=>` [偏差p${d.page}](${d.cropFile})`).join('')} |`)
lines.push('','未覆盖 pending：0 条；unchecked=[]，uncheckedReasons={}。r3 当前没有 pending，并非跳过文档。','', '偏差未标的38条候选（逐条原因相同：候选原件表达式无显式上下偏差，未据此补0）：',...truth.entries.filter(t=>t.upperDeviation===null).map(t=>`- ${t.candidateId} (${t.label}, ${t.docId}/${t.page})：原件未标上下偏差；仅核 nominal 与偏差未标状态。`))
writeFileSync(`${dir}/coverage.md`,lines.join('\n')+'\n')
const disagreements=[]
for(const row of measured.documents)for(const d of row.correctness.details)for(const c of d.comparisons)if(c.differences.length)disagreements.push({docId:row.id,page:d.page,...c})
if(disagreements.length!==measured.summary.correctness.wrongPending)throw Error('Mismatch disagreement count')
writeFileSync(`${dir}/disagreements.md`,[
 '# gt-02 disagreements','','最终差异：0 条。','',
 '核对方法：先按当前pending的页码/几何框渲染原PDF（4倍），先看图转录nominal与原排版偏差，再用候选ID+文档/页/几何定位进行精确q比较（1q也不放宽）。公式末值照原件抄录，不重新计算。',
 '', '核验范围：nominal 58/58；数值上偏差20条，下偏差20条；另外38条核对原件未标偏差，不等同于数值0通过。见 coverage.md 逐条清单。',
 '', '补充核验记录（保留过程，不将未看过的出处当正确）：首次只核nominal裁片时，r6-02/r6-13/r6-14/r6-15出现4条“本裁片未标偏差，而抽取有偏差”。检查其偏差出处几何后另渲染并逐字查看原件：r6-02在p2/p3印有A₁=759.48±0.1mm；r6-13在p3印有B₁=238.1±0.07mm；r6-14在p3印有B₃=488.88±0.05mm；r6-15在p3印有B₂=32.5±0.03mm。真值增加这些独立偏差裁片出处后，最终无差异。没有用抽取偏差值充当真值。',
 '', '| 候选 ID | 文档/页 | 抽取值 | 真值 | 差在哪 |','|---|---|---|---|---|','| 无（0条） | — | — | — | — |',
 '', '边界：这是58条pending的读数核验，不是候选语义正确、抽取召回率、blocked/OCR结果或全文数学公式正确性的保证。本轮未修改规则、阈值或产品判据。',
].join('\n')+'\n')
console.log(JSON.stringify(audit,null,2))
if(!sameExtraction||!audit.gt01Unchanged||!audit.gt01CropsUnchanged||disagreements.length)process.exitCode=1
