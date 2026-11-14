import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import gt from '../../docs/evidence/ground-truth/gt-02.json'
import { compareGroundTruth } from './metrics.mjs'
const truths = gt.entries
// Deliberately synthetic comparator inputs. These are NOT used to establish PDF truth.
function q(text: string) { return Math.round(Number(text) * 10000) }
function synthetic(t: typeof truths[number]) {
 const rectPdf = t.rect
 return { kind:'ring',candidateId:t.candidateId,status:'pending',reasonCodes:[],evidence:[{page:t.page,rectPdf}],
 data:{nominal:{text:t.nominal,valueQ:q(t.nominal),evidence:[{page:t.page,rectPdf}]},
 upperDeviation:t.upperDeviation===null?null:{text:t.upperDeviation,valueQ:q(t.upperDeviation)},
 lowerDeviation:t.lowerDeviation===null?null:{text:t.lowerDeviation,valueQ:q(t.lowerDeviation)}} }
}
const ids=['r1','r2','r3','r4','r5','r6']
describe('gt-02 completeness and evidence guards',()=>{
 it('58 unique original crops; distribution from this run, gt-01 retained',()=>{
  expect(truths).toHaveLength(58)
  expect(new Set(truths.map(t=>t.candidateId)).size).toBe(58)
  expect(ids.map(id=>truths.filter(t=>t.docId===id).length)).toEqual([4,10,0,1,2,41])
  expect(JSON.parse(readFileSync('docs/evidence/ground-truth/gt-01.json','utf8')).entries).toHaveLength(19)
  for(const t of truths) {
   expect(t.verifiedBy).toBe('render-crop')
   expect(t.originalText.trim()).not.toBe('')
   for(const source of [t,...t.deviationSources]) {
    expect(readFileSync(`docs/evidence/ground-truth/${source.cropFile}`).subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a')
   }
  }
 })
 it('M59 all pending IDs counted exactly once, not just a subset',()=>{
  const results=ids.map(id=>compareGroundTruth(id,truths.filter(t=>t.docId===id).map(synthetic),truths))
  expect(results.reduce((n,r)=>n+r.pendingChecked,0)).toBe(58)
  expect(results.flatMap(r=>r.unchecked)).toEqual([])
  expect(results.reduce((n,r)=>n+r.upperDeviationChecked,0)).toBe(20)
  expect(results.reduce((n,r)=>n+r.lowerDeviationChecked,0)).toBe(20)
  expect(results.reduce((n,r)=>n+r.wrongPending,0)).toBe(0)
  expect(results.flatMap(r=>r.details.flatMap((d: {comparisons: {candidateId: string}[]})=>d.comparisons.map(c=>c.candidateId))).sort()).toEqual(truths.map(t=>t.candidateId).sort())
 })
 it('M60 missing cropFile is NEVER checked or passed',()=>{
  const t=truths[0]
  const result=compareGroundTruth(t.docId,[synthetic(t)],[{...t,cropFile:undefined}])
  expect(result.pendingChecked).toBe(0)
  expect(result.unchecked).toEqual([t.candidateId])
  expect(result.uncheckedReasons).toEqual({'missing-or-invalid-crop':1})
 })
 it('nonexistent crop, invalid verifier, or missing supplemental crop also cannot count',()=>{
  for(const cropFile of ['crops/gt-02/not-present.png','../gt-01.json','']) {
   const t=truths[0]
   expect(compareGroundTruth(t.docId,[synthetic(t)],[{...t,cropFile}]).pendingChecked).toBe(0)
  }
  const t=truths.find(t=>t.deviationSources.length>0)!
  expect(compareGroundTruth(t.docId,[synthetic(t)],[{...t,deviationSources:[{...t.deviationSources[0],cropFile:'crops/missing.png'}]}]).pendingChecked).toBe(0)
  expect(compareGroundTruth(t.docId,[synthetic(t)],[{...t,verifiedBy:'extraction'}]).pendingChecked).toBe(0)
 })
 it('duplicate truth does not inflate coverage; missing truth lists the exact pending ID',()=>{
  const t=truths[0], c=synthetic(t)
  expect(compareGroundTruth(t.docId,[c],[t,t]).pendingChecked).toBe(1)
  expect(compareGroundTruth(t.docId,[c],[])).toMatchObject({pendingTotal:1,pendingChecked:0,unchecked:[c.candidateId],uncheckedReasons:{'no-verified-truth-match':1}})
 })
 it('upper and lower differences fail independently at one q, without contaminating nominal',()=>{
  const t=truths.find(t=>t.upperDeviation!==null)!
  for(const field of ['upperDeviation','lowerDeviation'] as const) {
   const c=synthetic(t)
   c.data[field]!.valueQ+=1
   const result=compareGroundTruth(t.docId,[c],[t])
   expect(result).toMatchObject({pendingChecked:1,wrongPending:1,nominalWrong:0})
   expect(result.details[0].comparisons[0].differences.map((d: {field:string})=>d.field)).toEqual([field])
  }
 })
 it('not stated is not zero; geometry and stable ID must still match',()=>{
  const t=truths[0], c=synthetic(t)
  c.data.upperDeviation={text:'0',valueQ:0}
  expect(compareGroundTruth(t.docId,[c],[t]).wrongPending).toBe(1)
  expect(compareGroundTruth(t.docId,[{...c,candidateId:'wrong-id'}],[t]).pendingChecked).toBe(0)
  c.data.nominal.evidence=[{page:t.page,rectPdf:[0,0,1,1]}]
  expect(compareGroundTruth(t.docId,[c],[t]).pendingChecked).toBe(0)
 })
})
