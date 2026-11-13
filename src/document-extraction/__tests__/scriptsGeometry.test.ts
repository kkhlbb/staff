import { describe, expect, it } from 'vitest'
import fixtures from '../__fixtures__/script-geometry.json'
import { buildPdfTextLayer, type PdfTextLayer, type RawPdfTextItem, type RawPdfTextPage } from '../textLayer'
import { buildExtractionDraft } from '../parse'
import { classifyScript, SCRIPT_MAX_FONT_RATIO, SCRIPT_MIN_BASELINE_RATIO, SCRIPT_MAX_BASELINE_RATIO, SCRIPT_SUSPECT_FONT_RATIO, SCRIPT_X_PADDING_RATIO } from '../scriptsGeometry'
import { EXTRACTOR_VERSION } from '../types'
function extract(page: RawPdfTextPage, layer: PdfTextLayer = buildPdfTextLayer([page])) {
 return buildExtractionDraft({projectId:'scripts',baseToken:'scripts',
 source:{documentId:'r2',revisionId:'scripts',sha256:'a'.repeat(64),blobKey:'fixture',pageCount:page.page},
 pageRange:{from:page.page,to:page.page},layer})
}
function item(str:string,x:number,y:number,size=10): RawPdfTextItem {
 return {str,transform:[size,0,0,size,x,y],width:str.length*size/2,height:size}
}
function sample(upper:string|null,lower:string|null,lowerY=99) {
 const items=[item('L1 = ',10,100),item('100',40,100),item(' mm',85,100)]
 if(upper!==null) items.push(item(upper,60,104.5,5.5))
 if(lower!==null) items.push(item(lower,60,lowerY,5.5))
 return {page:1,view:[0,0,600,800],items}
}
function ring(page:RawPdfTextPage,nominal:string) {
 const candidates=extract(page).candidates.filter(c=>c.kind==='ring'&&c.data.nominal?.text===nominal)
 expect(candidates.length).toBeGreaterThan(0)
 const c=candidates[0]
 if(c.kind!=='ring') throw new Error('ring required')
 return c
}
describe('geometric scripts safety',()=>{
 it('version 8',()=>expect(EXTRACTOR_VERSION).toBe('document-extractor-8'))
 it.each([1,5])('M43 real r2 crop #%s: never nominal 1001 or 430',index=>{
  const f=fixtures[index]
  // Preserve original full-page line grouping/indices: clipping and rebuilding lines changes the bug.
  const draft=extract(f.page,{pages:[f.layerPage]} as unknown as PdfTextLayer)
  const candidates=draft.candidates.filter(c=>c.kind==='ring')
  expect(candidates.map(c=>c.data.nominal?.text)).not.toContain(index===1?'1001':'430')
  const c=candidates.find(c=>c.data.nominal?.text===f.truth.nominal)
  expect(c).toBeDefined()
  if(!c) throw new Error('missing crop candidate')
  expect(c.status).toBe('pending')
  expect(c.data.nominal?.valueQ).toBe(index===1?1000000:430000)
  expect(c.data.upperDeviation?.valueQ).toBe(2000)
  expect(c.data.lowerDeviation?.valueQ).toBe(index===1?-1000:0)

 })
 it('crop 5.2 lower zero is not a nominal digit',()=>{
  const c=ring(fixtures[2].page,'5.2')
  expect(c.data.upperDeviation?.valueQ).toBe(1000)
  expect(c.data.lowerDeviation?.valueQ).toBe(0)
 })
 it('M44 asymmetric +0.2 / -0.1 stays asymmetric',()=>{
  const c=ring(sample('+0.2','-0.1'),'100')
  expect(c.status).toBe('pending')
  expect(c.data.upperDeviation?.valueQ).toBe(2000)
  expect(c.data.lowerDeviation?.valueQ).toBe(-1000)
  expect(c.data.upperDeviation?.evidence.length).toBeGreaterThan(0)
 })
 it.each([['+0.2',null,2000,0],[null,'-0.2',0,-2000],['0','-0.2',0,-2000]] as const)('one-sided %s %s is not symmetric',(upper,lower,u,l)=>{
  const c=ring(sample(upper,lower),'100')
  expect(c.status).toBe('pending')
  expect(c.data.upperDeviation?.valueQ).toBe(u)
  expect(c.data.lowerDeviation?.valueQ).toBe(l)
 })
 it('M45 unresolved small digit is blocked, never silently appended',()=>{
  const c=ring(sample(null,'1',100),'100')
  expect(c.status).toBe('blocked')
  expect(c.reasonCodes).toContain('SUBSCRIPT_AMBIGUOUS')
  expect(c.data.nominal?.valueQ).toBe(1000000)
  expect(extract(sample(null,'1',100)).candidates.filter(c=>c.kind==='ring').map(c=>c.data.nominal?.text)).not.toContain('1001')
 })
 it.each([0,9])('M45 missing/uncertain size %s cannot silently join a nominal',size=>{
  const page=sample(null,null)
  page.items.push(item('1',60,99,size))
  const c=ring(page,'100')
  expect(c.status).toBe('blocked')
  expect(c.reasonCodes).toContain('SUBSCRIPT_AMBIGUOUS')
 })
 it('real crop L1 = 30 upper zero / lower -0.2',()=>{
  const c=ring(fixtures[5].page,'30')
  expect(c.status).toBe('pending')
  expect(c.data.upperDeviation?.valueQ).toBe(0)
  expect(c.data.lowerDeviation?.valueQ).toBe(-2000)
 })
 it('unrecognized script text is blocked',()=>{
  expect(ring(sample('+?','-0.1'),'100').reasonCodes).toContain('SUBSCRIPT_AMBIGUOUS')
 })
 it('normal 1001 at the same font/baseline remains 1001 (no value heuristics)',()=>{
  const page=sample(null,null);page.items=[item('L1 = 1001 mm',10,100)]
  expect(ring(page,'1001').data.nominal?.valueQ).toBe(10010000)
 })
 it('fixed threshold boundaries, upward upper / downward lower',()=>{
  expect([SCRIPT_MAX_FONT_RATIO,SCRIPT_MIN_BASELINE_RATIO,SCRIPT_MAX_BASELINE_RATIO,SCRIPT_SUSPECT_FONT_RATIO,SCRIPT_X_PADDING_RATIO]).toEqual([0.8,0.05,0.65,0.95,0.25])
  const build=(height:number,y:number)=>buildPdfTextLayer([{page:1,view:[0,0,600,800],items:[item('1',10,y,height)]}]).pages[0].items[0]
  expect(classifyScript(build(8,104),100,10)).toBe('baseline')
  expect(classifyScript(build(7.9,100.5),100,10)).toBe('ambiguous')
  expect(classifyScript(build(7.9,100.51),100,10)).toBe('upper')
  expect(classifyScript(build(5.5,99.3),100,10)).toBe('lower')
  expect(classifyScript(build(5.5,106.5),100,10)).toBe('upper')
  expect(classifyScript(build(5.5,106.51),100,10)).toBe('ambiguous')
 })
})
