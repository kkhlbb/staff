import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import groundTruth from '../../docs/evidence/ground-truth/gt-01.json'
const truth = groundTruth.entries
import { compareGroundTruth } from './metrics.mjs'
function candidate(valueQ:number,status='pending',page=2) {
 return {kind:'ring',candidateId:'test',status,reasonCodes:[],data:{nominal:{text:'test',valueQ,evidence:[{page,rectPdf:[310,496,325,507]}]}}}
}
describe('crop ground truth correctness',()=>{
 it('exactly 19 verified crops: r2 7 / r5 2 / r6 10',()=>{
  expect(truth).toHaveLength(19)
  expect(['r2','r5','r6'].map(id=>truth.filter(t=>t.docId===id).length)).toEqual([7,2,10])
  for(const t of truth) {
   expect(t.verifiedBy).toBe('render-crop')
   expect(t.originalText.trim()).not.toBe('')
   expect(existsSync(`docs/evidence/ground-truth/${t.cropFile}`)).toBe(true)
   expect(readFileSync(`docs/evidence/ground-truth/${t.cropFile}`).subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a')
  }
 })
 it('detects 1001 vs 100 without matching by nominal',()=>{
  const gt=[truth[1]]
  expect(compareGroundTruth('r2',[candidate(10010000)],gt)).toMatchObject({pendingChecked:1,wrongPending:1})
  expect(compareGroundTruth('r2',[candidate(1000000)],gt)).toMatchObject({pendingChecked:1,wrongPending:0})
 })
 it('shared nominal chain rect uses symbol geometry, never the correct-looking value',()=>{
  const correct=candidate(1000000)
  const wrong=candidate(10010000)
  const a={...correct,evidence:[{page:2,rectPdf:[300,496,305,507]}]}
  const b={...wrong,evidence:[{page:2,rectPdf:[288.17699999999996,496,295,507]}]}
  const result=compareGroundTruth('r2',[a,b],[truth[1]])
  expect(result.pendingChecked).toBe(1)
  expect(result.wrongPending).toBe(1)
 })
 it('one q mismatch fails, not rounded to mm',()=>{
  expect(compareGroundTruth('r2',[candidate(1000001)],[truth[1]]).wrongPending).toBe(1)
 })
 it('blocked and missing are not checked pending; wrong page/document cannot match',()=>{
  expect(compareGroundTruth('r2',[candidate(10010000,'blocked')],[truth[1]])).toMatchObject({pendingChecked:0,wrongPending:0})
  expect(compareGroundTruth('r2',[],[truth[1]]).pendingChecked).toBe(0)
  expect(compareGroundTruth('r5',[candidate(10010000)],[truth[1]]).pendingChecked).toBe(0)
  expect(compareGroundTruth('r2',[candidate(10010000,'pending',3)],[truth[1]]).pendingChecked).toBe(0)
 })
})
