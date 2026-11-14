#!/usr/bin/env node
/** Transcriptions made from original rendered crops, before inspecting extractor values. */
import { readFileSync, writeFileSync } from 'node:fs'
import { loadEvidenceJson } from './real-docs/tsImport.mjs'
const dir='docs/evidence/ground-truth'
const inventory=JSON.parse(readFileSync(`${dir}/inventory.json`,'utf8')).entries
// Original printed values, not recalculated formula results. null means not printed, NOT zero.
const readings={
 r1:[['A₃ = 12 mm','12'],['A₁ = 34 mm','34'],['A₂ = 22 mm','22'],['T₀ = 0.35 mm','0.35']],
 r2:[['L₀ = 0⁰₀ mm','0','0','0'],['L₁ = 100⁺⁰·²₋₀.₁ mm','100','+0.2','-0.1'],
 ['L₂ = 100 (上 −0.1，下 +0.2) mm','100','-0.1','+0.2'],['L_b = 5 (上 −0.1，下 +0.2) mm','5','-0.1','+0.2'],
 ['L′_b = 5.2⁺⁰·¹₀ mm','5.2','+0.1','0'],['Z_max = 5.2 + 0.1 − 4.9 = 0.4 (mm)','0.4'],
 ['L₁ = 30⁰₋₀.₂ mm','30','0','-0.2'],['δ_L′b = 0.10 mm','0.10'],['L₃ = 43⁺⁰·²₀ mm','43','+0.2','0'],
 ['δ_Lz = δ_L0 − δ_Lb = 0.25 − 0.10 = 0.15 (mm)','0.15']],
 r4:[['R = 0.5 mm','0.5']],
 r5:[['L₁ = 50 mm','50'],['L₂ = 27 mm','27']],
 r6:[['A = 230 ± 0.3 mm','230','+0.3','-0.3'],['A₁ = 759.48 mm','759.48'],['A₂ = 765.41 mm','765.41'],['A₃ = 1753 mm','1753'],
 ['T_avA = T₀/m (m−Ring Qty.) = 0.6/3 = 0.2 mm','0.2'],['T₂ = 0.2 mm','0.2'],['T₁ = T₂ = 0.2 mm','0.2'],
 ['T₃ = T₀ − T₁ − T₂ = 0.6 − 0.2 − 0.2 = 0.2 mm','0.2'],
 ['A₀max = 1753.1 − 759.38 − 765.31 = 228.41 mm','228.41'],['A₀min = 1752.9 − 759.58 − 765.51 = 227.81 mm','227.81'],
 ['A₀ = 228.11 ± 0.3 mm','228.11','+0.3','-0.3'],['T = 0.04 mm','0.04'],['B₁ = (125×COS10°+230/2) = 238.1 mm','238.1'],
 ['B₃ = 488.88 mm','488.88'],['B₂ = (33×COS10°) = 32.5 mm','32.5'],['a₁ = 759.48 ± 0.1 mm','759.48','+0.1','-0.1'],
 ['T₃ = 0.97 mm','0.97'],['T₁ = 0.115 mm','0.115'],['T₃ = 0.10 mm','0.10'],
 ['T₀ = √(T₁²−T₂²−T₃²) = √(0.41²−0.06²−0.10²) = 0.182 mm','0.182'],['T₀ = 0.2 mm','0.2'],
 ['Δ₀ = [0.1+(−0.1)]/2 = 0 mm','0'],['Δ₁ = [0.07+(−0.07)]/2 = 0 mm','0'],['Δ₃ = [0.05+(−0.05)]/2 = 0 mm','0'],
 ['Δ₂ = 0−0−0 = 0 mm','0'],['ES₀ = Δ₀+T₀/2 = 0+0.182/2 = 0.091 mm','0.091'],['EI₀ = Δ₀−T₀/2 = 0−0.182/2 = −0.091 mm','-0.091'],
 ['B₁ = 260 ± 0.07 mm','260','+0.07','-0.07'],['T₀ = +0.07−(−0.07) = 0.14 mm','0.14'],
 ['T₂ = 0.10 mm','0.10'],['T₁ = T₂ = 0.10 mm','0.10'],['T₂ = 0.09 mm','0.09'],
 ['B₁ = 125 ± 0.045 mm','125','+0.045','-0.045'],['ES₀ = Δ₀+T₀/2 = 0+0.135/2 = 0.07 mm','0.07'],
 ['T₀ = √(T₁²+T₂²) = √(0.10²+0.09²) = 0.135 mm','0.135'],['B₁upper = 135 ± 0.05 mm','135','+0.05','-0.05'],
 ['B₁below = 125 ± 0.045 mm','125','+0.045','-0.045'],['B₁upper = 125 ± 0.045 mm','125','+0.045','-0.045'],
 ['B₁.on = 125 ± 0.045 mm','125','+0.045','-0.045'],['Δ₀ = Δ₁+Δ₂ = [0.052+(−0.048)]/2+[0.045+(−0.045)]/2 = 0.002 mm','0.002'],
 ['EI₀ = Δ₀−T₀/2 = 0.002−0.135/2 = −0.07 mm','-0.07']]
}
const supplemental={
 'r6-02':{upper:'+0.1',lower:'-0.1',text:'A₁ = 759.48 ± 0.1 mm',pages:[2,3]},
 'r6-13':{upper:'+0.07',lower:'-0.07',text:'B₁ = 238.1 ± 0.07 mm',pages:[3]},
 'r6-14':{upper:'+0.05',lower:'-0.05',text:'B₃ = 488.88 ± 0.05 mm',pages:[3]},
 'r6-15':{upper:'+0.03',lower:'-0.03',text:'B₂ = 32.5 ± 0.03 mm',pages:[3]},
}
const entries=inventory.map(item=>{
 const index=Number(item.label.split('-')[1])-1
 const row=readings[item.docId]?.[index]
 if(!row)throw Error(`Missing crop transcription ${item.label}`)
 const extra=supplemental[item.label]
 const upper=extra?.upper??row[2]??null, lower=extra?.lower??row[3]??null
 const deviationSources=extra?extra.pages.map((page,j)=>({page,originalText:extra.text,
   cropFile:`crops/gt-02/${item.label}-upperDeviation-${j}-p${page}.png`,rect:item.deviationGeometry.upperDeviation[j].rect})):[]
 return {...item, originalText:row[0],nominal:row[1],upperDeviation:upper,lowerDeviation:lower,deviationSources,
 verifiedBy:'render-crop',verificationScope:{nominal:'verified',upperDeviation:upper===null?'not-stated':'verified',lowerDeviation:lower===null?'not-stated':'verified'}}
})
const {serializeEvidence}=await loadEvidenceJson()
writeFileSync(`${dir}/gt-02.json`,serializeEvidence({gtVersion:'gt-02',method:'Original PDF rendered at 4x; geometry-only inventory; visual transcription before comparison. Printed formula results are transcribed, not recomputed. not-stated is not numeric zero.',entries}))
console.log(`Transcribed ${entries.length} original crops; explicit deviation pairs ${entries.filter(e=>e.upperDeviation!==null).length}`)
