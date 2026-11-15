import { expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createSpacerSnapshot } from '../../src/project-file/__fixtures__/spacerProjectFile'
import { encodeProjectFile } from '../../src/project-file/codec'
import { selectSpacerStepInputFromSnapshot } from '../../src/cad/selectSpacerStepInput'
import { SPACER_PART_ID } from '../../src/drawing/types'
import { generateStep } from '../../desktop/main/cad/stepKernel'
import { StepExportStore } from '../../desktop/main/stepExportStore'
it('explicit evidence generation only; never in ordinary test include',async()=>{
 const dir = process.env.STEP_EVIDENCE_DIR
 if(!dir) throw Error('STEP_EVIDENCE_DIR required, new directory only')
 await fs.mkdir(dir,{recursive:true})
 for(const inner of ['20.0000','20.0001']) {
  const snapshot=await createSpacerSnapshot({innerDiameter:inner})
  // Synthetic formally persisted historical version, pending review (not draft or user-confirmed).
  snapshot.project.parameters=snapshot.project.parameters.map(p=>({...p,reviewStatus:'pending'}))
  snapshot.project.drawings=[]; snapshot.project.dimensionLinks=[]
  for(const r of snapshot.fileRevisions) r.project=structuredClone(snapshot.project)
  // Persist a genuinely different current model; historical export must still use 12mm.
  snapshot.project.parameters=snapshot.project.parameters.map(p=>p.key==='length'?{...p,valueQ:990000,parameterRevision:p.parameterRevision+1}:p)
  const encoded=await encodeProjectFile(snapshot)
  if(!encoded.ok) throw Error(JSON.stringify(encoded.error))
  const suffix=inner.endsWith('1')?'odd':'base'
  await fs.writeFile(path.join(dir,`${suffix}.cunlian`),encoded.value.bytes,{flag:'wx'})
  const input=selectSpacerStepInputFromSnapshot(snapshot,snapshot.fileRevisions[0].revisionId,SPACER_PART_ID)
  const result=await generateStep({innerDiameter:input.innerDiameterQ,outerDiameter:input.outerDiameterQ,length:input.lengthQ})
  const target=path.join(dir,`${suffix}.step`)
  const receipt=await new StepExportStore().save(target,result.bytes,null)
  await fs.writeFile(path.join(dir,`${suffix}-receipt.json`),JSON.stringify({...receipt,input,kernelVersion:result.kernelVersion,wasmSha256:result.wasmSha256,generatorVersion:result.generatorVersion},null,2),{flag:'wx'})
  expect(result.bytes.length).toBeGreaterThan(8000)
 }
 for (const [name,key,valueQ] of [['degenerate-length','length',1],['thin-wall','outerDiameter',200001]] as const) {
  const snapshot=await createSpacerSnapshot()
  snapshot.project.drawings=[];snapshot.project.dimensionLinks=[]
  snapshot.project.parameters=snapshot.project.parameters.map(p=>({...p,reviewStatus:'pending',...(p.key===key?{valueQ}:{})}))
  for(const revision of snapshot.fileRevisions)revision.project=structuredClone(snapshot.project)
  const encoded=await encodeProjectFile(snapshot)
  if(!encoded.ok)throw Error(JSON.stringify(encoded.error))
  await fs.writeFile(path.join(dir,`${name}.cunlian`),encoded.value.bytes,{flag:'wx'})
  const input=selectSpacerStepInputFromSnapshot(snapshot,snapshot.fileRevisions[0].revisionId,SPACER_PART_ID)
  await fs.writeFile(path.join(dir,`${name}-request.json`),JSON.stringify({revisionId:snapshot.fileRevisions[0].revisionId,partId:SPACER_PART_ID,expectedInputFingerprint:input.inputFingerprint,expectedCode:'UNSUPPORTED_GEOMETRY'},null,2),{flag:'wx'})
 }
},30000)
