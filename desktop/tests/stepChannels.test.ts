import { afterEach, expect, it, vi } from 'vitest'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { createHarness, makeEvent, type Harness } from './helpers/a04'
import { registerStepChannels } from '../main/stepChannels'
import { createSpacerSnapshot } from '../../src/project-file/__fixtures__/spacerProjectFile'
import { selectSpacerStepInputFromSnapshot } from '../../src/cad/selectSpacerStepInput'
import { SPACER_PART_ID } from '../../src/drawing/types'
import { IPC_CHANNELS, type StepExportValue } from '../shared/contracts'
import { StepExportStore } from '../main/stepExportStore'
import type { generateStep } from '../main/cad/stepKernel'
import type { ProjectFileSpacerParameter } from '../../src/project-file/types'
let h: Harness
let release: (() => void) | undefined
afterEach(async () => { release?.(); release = undefined; await h?.dispose(); vi.restoreAllMocks() })
async function setup() {
 h = await createHarness(); const snap = await createSpacerSnapshot({ confirmed: true })
 const opened = await h.openSample(snap)
 const session = h.projectService.getSession(opened.sessionId)!
 // Transport/unit fixture only: kernel geometry tested separately with real OCCT.
 session.snapshot.fileRevisions[0].project.parameters = structuredClone(snap.project.parameters).map(p => ({ ...p, reviewStatus: 'confirmed' }))
 const input = selectSpacerStepInputFromSnapshot(session.snapshot, snap.fileRevisions[0].revisionId, SPACER_PART_ID)
 const request = { sessionId: opened.sessionId, baseEditSeq: 0, revisionId: input.revisionId, partId: SPACER_PART_ID, expectedInputFingerprint: input.inputFingerprint, jobId: 'job-1' }
 const target = path.join(h.directory,'隔套 历史.step')
 const generate = vi.fn<typeof generateStep>(async () => ({ bytes: new Uint8Array([1,2,3]), kernelVersion: 'test-transport-only', wasmSha256: 'a'.repeat(64), generatorVersion: 'test' }))
 const pick = vi.fn(async (): Promise<string|null> => target); const confirm = vi.fn(async () => true)
 const store = new StepExportStore()
 registerStepChannels(h.ipc, { guard: h.guard, controller: h.controller, projectService: h.projectService, exportStore: store, pickExportPath: pick, confirmOverwrite: confirm, generate })
 return { request, target, generate, pick, confirm, session, store }
}
it.each(['COMPILE', 'ABI', 'MEMORY', 'TABLE', 'INSTANTIATE'])('reports nested local %s failure without exposing paths or writing target', async reason => {
 const c = await setup(); await fs.writeFile(c.target, 'old')
 c.generate.mockRejectedValue(Error(`STEP_KERNEL_FAILED: STEP_LOCAL_${reason}: /private/user-library.wasm`))
 const failure = await h.invoke(IPC_CHANNELS.stepExport, c.request)
 expect(failure).toMatchObject({ok:false,error:{code:'STEP_EXPORT_FAILED',message:`STEP 内核未生成有效文件：STEP_LOCAL_${reason}`}})
 expect(JSON.stringify(failure)).not.toContain('/private/user-library.wasm')
 expect(await fs.readFile(c.target, 'utf8')).toBe('old')
})
it('writes selected frozen q, never current, and leaves project/history/recovery unchanged', async () => {
 const c = await setup(); c.session.snapshot.project.parameters[2].valueQ = 999999
 const before = JSON.stringify(c.session.snapshot)
 const r = await h.invoke<StepExportValue>(IPC_CHANNELS.stepExport,c.request)
 expect(r.ok).toBe(true); expect(c.generate.mock.calls[0][0]).toEqual({innerDiameter:200000,outerDiameter:320000,length:120000})
 expect(JSON.stringify(c.session.snapshot)).toBe(before); expect(await fs.readFile(c.target)).toEqual(Buffer.from([1,2,3]))
 if (r.ok) { expect(r.value.generationInput).toMatchObject({revisionId:c.request.revisionId,lengthQ:120000,fileStatus:'historical-frozen'}); expect(r.value.historicalByteIdentical).toBeNull(); expect(r.value.sha256).toMatch(/^[a-f0-9]{64}$/) }
})
it.each(['path','overwrite'])('cancel %s means zero writes and kernel not started', async mode => {
 const c = await setup(); if (mode === 'path') c.pick.mockResolvedValue(null)
 else { await fs.writeFile(c.target,'old'); c.confirm.mockResolvedValue(false) }
 const before = await fs.readdir(h.directory)
 expect(await h.invoke(IPC_CHANNELS.stepExport,c.request)).toMatchObject({ok:false,error:{code:'CANCELLED'}})
 expect(c.generate).not.toHaveBeenCalled(); expect(await fs.readdir(h.directory)).toEqual(before)
 if(mode === 'overwrite') expect(await fs.readFile(c.target,'utf8')).toBe('old')
})
it.each(['seq','revision','fingerprint','path','sender','draft'])('rejects %s without kernel or output', async mode => {
 const c = await setup(); const request: Record<string,unknown> = {...c.request}
 if(mode === 'seq') request.baseEditSeq = 99
 if(mode === 'revision') request.revisionId = 'draft-id'
 if(mode === 'fingerprint') request.expectedInputFingerprint = '0'.repeat(16)
 if(mode === 'path') request.target = c.target
 if(mode === 'draft') (c.session.snapshot.fileRevisions[0].project.parameters[0] as ProjectFileSpacerParameter).reviewStatus = 'draft'
 const r = mode === 'sender' ? await h.ipc.invoke(IPC_CHANNELS.stepExport,request,makeEvent({webContentsId:99})) : await h.invoke(IPC_CHANNELS.stepExport,request)
 expect(r.ok).toBe(false); expect(c.generate).not.toHaveBeenCalled(); await expect(fs.stat(c.target)).rejects.toThrow()
})
it('cancel during worker drops result; concurrent jobs rejected; no host writes', async () => {
 const c = await setup(); let started!: () => void; const start = new Promise<void>(r=>{started=r})
 c.generate.mockImplementation(async () => { started(); await new Promise<void>(r=>{release=r}); return {bytes:new Uint8Array([4]),kernelVersion:'test',wasmSha256:'a'.repeat(64),generatorVersion:'test'} })
 const pending = h.invoke(IPC_CHANNELS.stepExport,c.request); await start
 expect(await h.invoke(IPC_CHANNELS.stepExport,{...c.request,jobId:'job-2'})).toMatchObject({ok:false,error:{code:'BUSY'}})
 expect(await h.invoke(IPC_CHANNELS.stepCancel,{sessionId:c.request.sessionId,jobId:'wrong'})).toMatchObject({ok:true,value:{cancelled:false}})
 expect(await h.invoke(IPC_CHANNELS.stepCancel,{sessionId:c.request.sessionId,jobId:c.request.jobId})).toMatchObject({ok:true,value:{cancelled:true}})
 release!(); expect(await pending).toMatchObject({ok:false,error:{code:'CANCELLED'}}); await expect(fs.stat(c.target)).rejects.toThrow()
})
it('does not acknowledge cancellation once atomic commit has started', async () => {
 const c=await setup(); let entered!:()=>void; const gate=new Promise<void>(r=>{entered=r}); const save=c.store.save.bind(c.store)
 vi.spyOn(c.store,'save').mockImplementation(async(...args)=>{entered(); await new Promise<void>(r=>{release=r}); return save(...args)})
 const pending=h.invoke(IPC_CHANNELS.stepExport,c.request); await gate
 expect(await h.invoke(IPC_CHANNELS.stepCancel,{sessionId:c.request.sessionId,jobId:c.request.jobId})).toMatchObject({ok:true,value:{cancelled:false}})
 release!(); expect((await pending).ok).toBe(true); expect(await fs.readFile(c.target)).toEqual(Buffer.from([1,2,3]))
})
it('switching/closing session while kernel runs rejects stale result without any export writes', async () => {
 const c=await setup(); let entered!:()=>void;const gate=new Promise<void>(r=>{entered=r})
 c.generate.mockImplementation(async()=>{entered();await new Promise<void>(r=>{release=r});return {bytes:new Uint8Array([4]),kernelVersion:'test',wasmSha256:'a'.repeat(64),generatorVersion:'test'}})
 const pending=h.invoke(IPC_CHANNELS.stepExport,c.request);await gate;await h.controller.detach(1);release!()
 expect((await pending).ok).toBe(false);await expect(fs.stat(c.target)).rejects.toThrow()
})
it('edit while generating invalidates before any host write; kernel errors preserve target', async () => {
 const c = await setup(); await fs.writeFile(c.target,'old')
 c.generate.mockImplementation(async () => { c.session.acceptedSeq++; return {bytes:new Uint8Array([4]),kernelVersion:'test',wasmSha256:'a'.repeat(64),generatorVersion:'test'} })
 expect(await h.invoke(IPC_CHANNELS.stepExport,c.request)).toMatchObject({ok:false,error:{code:'STALE_EDIT'}})
 expect(await fs.readFile(c.target,'utf8')).toBe('old')
 c.request.baseEditSeq = c.session.acceptedSeq; c.request.jobId='job-error'; c.generate.mockRejectedValue(Error('STEP_ASSET_MISSING /private/model-material'))
 const failed=await h.invoke(IPC_CHANNELS.stepExport,c.request)
 expect(failed).toMatchObject({ok:false,error:{code:'STEP_EXPORT_FAILED'}})
 expect(JSON.stringify(failed)).not.toContain('/private/model-material')
 expect(await fs.readFile(c.target,'utf8')).toBe('old')
})
