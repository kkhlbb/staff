#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { loadEvidenceJson } from './real-docs/tsImport.mjs'
const {serializeEvidence} = await loadEvidenceJson()
const truths = JSON.parse(readFileSync('docs/evidence/ground-truth/gt-01.json','utf8')).entries
const metrics = JSON.parse(readFileSync('docs/evidence/real-doc-baseline/metrics.json','utf8'))
const before = JSON.parse(readFileSync('docs/evidence/supersub-fix/before-correctness.json','utf8')).documents
const beforeChecked=before.reduce((n,r)=>n+r.pendingChecked,0)
const beforeWrong=before.reduce((n,r)=>n+r.wrongPending,0)
const after=metrics.documents.filter(d=>['r2','r5','r6'].includes(d.id)).flatMap(d=>d.correctness.details)
if(after.length!==19 || metrics.summary.correctness.wrongPending!==0) throw new Error('Truth acceptance failed')
const comparison=after.map((row,i)=>({index:i+1,...row,before:before.flatMap(d=>d.details).find(d=>d.docId===row.docId&&d.cropFile===row.cropFile)?.matches}))
writeFileSync('docs/evidence/supersub-fix/comparison.json',serializeEvidence({correctness:metrics.summary.correctness,comparison}))
const lines=['# 上下标与公差粘连修复逐条对照','','真值全部来自 gt-01.json 指向的原件渲染裁片；q 为 0.0001 mm 整数。',
 '这里只核 nominal 正确性，不把 19 条推广成整批语料的全面准确率。',
 `改前 checked=${beforeChecked}, wrongPending=${beforeWrong}, wrongRate=${beforeWrong/beforeChecked}。`,
 `改后 ${JSON.stringify(metrics.summary.correctness)}。`,'',
 '| # | 文档/页 | 裁片逐字原文 | 旧 nominal | 新 nominal | 新 upper/lower | 状态 |',
 '|---|---|---|---|---|---|---|']
for(const r of comparison) lines.push(`| ${r.index} | ${r.docId}/p${r.page} | ${r.originalText} | ${r.before.map(m=>m.nominal).join(', ')} | ${r.matches.map(m=>m.nominal).join(', ')} | ${r.matches.map(m=>`${m.upperDeviation??'无'}/${m.lowerDeviation??'无'}`).join('; ')} | ${r.matches.map(m=>m.status).join(', ')} |`)
lines.push('','注意：r6 A1=759.48 的 ±0.1 来自原有同符号同值跨处合并，当前裁片本身没有公差；真值保留 null/null，并不伪造裁片文字。',
 'r5 的 ryL2、r6 的 avA 等符号截断/跨栏粘连是已有局限；本单按任务卡只度量 nominal，未把符号名记作已修。','')
writeFileSync('docs/evidence/supersub-fix/COMPARISON.md',lines.join('\n'))
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
const examples=[truths[1],truths[5],truths[9]]
writeFileSync('docs/evidence/supersub-fix/index.html',`<!doctype html><html lang="zh"><meta charset="utf-8"><title>上下标修复裁片与真值对照</title><style>body{font:16px system-ui;margin:32px;max-width:1200px}img{max-width:100%;border:1px solid #bbb}figure{padding:16px;background:#f7f7f7}td,th{border:1px solid #ccc;padding:8px}table{border-collapse:collapse}code{white-space:pre-wrap}</style><h1>上下标与公差粘连修复</h1><p>${escape(JSON.stringify(metrics.summary.correctness))}</p><h2>三张原件裁片示例</h2>${examples.map(t=>`<figure><figcaption>${escape(t.docId+' p'+t.page+' '+t.originalText)}</figcaption><img src="../ground-truth/${t.cropFile}"></figure>`).join('')}<h2>19 条逐条对照</h2><table><tr><th>文档/页</th><th>原文</th><th>改前 nominal</th><th>改后 nominal</th><th>状态</th></tr>${comparison.map(r=>`<tr><td>${r.docId} p${r.page}</td><td>${escape(r.originalText)}</td><td>${escape(r.before.map(m=>m.nominal).join(','))}</td><td>${escape(r.matches.map(m=>m.nominal).join(','))}</td><td>${r.matches.map(m=>m.status).join(',')}</td></tr>`).join('')}</table></html>`)
console.log(JSON.stringify({before:{pendingChecked:beforeChecked,wrongPending:beforeWrong},after:metrics.summary.correctness,rows:comparison.length}))
