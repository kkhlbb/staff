import path from 'node:path'
import { z } from 'zod'
import { IPC_CHANNELS, type StepExportValue } from '../shared/contracts'
import { selectSpacerStepInputFromSnapshot } from '../../src/cad/selectSpacerStepInput'
import { IpcFailure, installChannel, type IpcMainLike, type IpcDeps } from './ipc'
import type { ProjectService } from './projectService'
import type { SessionController } from './sessionController'
import { generateStep } from './cad/stepKernel'
import { StepExportStore } from './stepExportStore'
const id = z.string().min(1).max(240).refine(s=>!s.includes('/') && !s.includes('\\') && !s.includes('\u0000'))
const requestSchema = z.object({sessionId:id,baseEditSeq:z.number().int().nonnegative(),revisionId:id,partId:id,expectedInputFingerprint:z.string().regex(/^[a-f0-9]{16}$/),jobId:id}).strict()
export interface StepChannelDeps extends IpcDeps {
 controller: SessionController
 projectService: ProjectService
 exportStore: StepExportStore
 pickExportPath: (windowId:number,suggestedName:string)=>Promise<string|null>
 confirmOverwrite: (windowId:number,target:string)=>Promise<boolean>
 generate?: typeof generateStep
 isWindowAlive?: (windowId:number)=>boolean
}
export function registerStepChannels(ipc:IpcMainLike,deps:StepChannelDeps): void {
 const jobs = new Map<string,{jobId:string;windowId:number;abort:AbortController;committing:boolean}>()
 // Reuse is denied for this active job; completed IDs do not confer any authority.
 function active(windowId:number,sessionId:string,seq?:number) {
  if (deps.isWindowAlive?.(windowId) === false || deps.controller.sessionIdFor(windowId)!==sessionId) throw new IpcFailure('STALE_SESSION','会话或窗口已失效')
  const session = deps.projectService.getSession(sessionId)
  if (!session) throw new IpcFailure('STALE_SESSION','会话已失效')
  if (seq!==undefined && session.acceptedSeq!==seq) throw new IpcFailure('STALE_EDIT','导出等待期间项目已更新，请重新选择历史版本')
  return session
 }
 installChannel(ipc,{channel:IPC_CHANNELS.stepCancel,schema:z.object({sessionId:id,jobId:id}).strict(),handle:async({sender},p)=>{
  active(sender.webContentsId,p.sessionId)
  const job=jobs.get(p.sessionId)
  if(!job || job.windowId!==sender.webContentsId || job.jobId!==p.jobId || job.committing) return {cancelled:false}
  job.abort.abort(); return {cancelled:true}
 }},deps)
 installChannel(ipc,{channel:IPC_CHANNELS.stepExport,schema:requestSchema,handle:async({sender},p):Promise<StepExportValue>=>{
  const windowId=sender.webContentsId
  const session=active(windowId,p.sessionId,p.baseEditSeq)
  if(jobs.has(p.sessionId)) throw new IpcFailure('BUSY','已有 STEP 导出任务')
  let input
  try { input=selectSpacerStepInputFromSnapshot(session.snapshot,p.revisionId,p.partId) }
  catch(e) { throw new IpcFailure('INVALID_PARAMETER',e instanceof Error?e.message:'历史参数无效') }
  if(input.inputFingerprint!==p.expectedInputFingerprint) throw new IpcFailure('STALE_EDIT','历史输入指纹不一致')
  const job={jobId:p.jobId,windowId,abort:new AbortController(),committing:false}; jobs.set(p.sessionId,job)
  const ensure=()=>{
   if(job.abort.signal.aborted) throw new IpcFailure('CANCELLED','已取消 STEP 导出；未提交文件')
   const current=active(windowId,p.sessionId,p.baseEditSeq)
   if(selectSpacerStepInputFromSnapshot(current.snapshot,p.revisionId,p.partId).inputFingerprint!==input.inputFingerprint) throw new IpcFailure('STALE_EDIT','冻结输入身份已变更')
  }
  // Window/session invalidation also stops a running kernel, not just the final commit.
  const watch=setInterval(()=>{if(!job.committing){try{active(windowId,p.sessionId,p.baseEditSeq)}catch{job.abort.abort()}}},50)
  try {
   const ordinal=session.snapshot.fileRevisions.findIndex(r=>r.revisionId===input.revisionId)+1
   const target=await deps.pickExportPath(windowId,`隔套-历史第${ordinal}版-${input.source.kind==='user-intent'?'用户输入无外部原件':'历史来源'}-待复核-AP214IS.step`)
   ensure()
   if(target===null) throw new IpcFailure('CANCELLED','已取消选择导出位置')
   const previous=await deps.exportStore.fingerprint(target)
   if(previous!==null && !await deps.confirmOverwrite(windowId,target)) throw new IpcFailure('CANCELLED','已取消覆盖已有文件')
   ensure()
   let generated
   try { generated=await (deps.generate??generateStep)({innerDiameter:input.innerDiameterQ,outerDiameter:input.outerDiameterQ,length:input.lengthQ},{signal:job.abort.signal}) }
   catch(e) {
    ensure()
    const message=e instanceof Error?e.message:String(e)
    const reason=/\bSTEP_LOCAL_(?:CONFIG|FILE|SIZE|HASH|COMPILE|ABI|MEMORY|TABLE|INSTANTIATE|API)\b/.exec(message)?.[0] ?? /STEP_[A-Z_]+/.exec(message)?.[0] ?? 'STEP_KERNEL_FAILED'
    throw new IpcFailure(message.includes('UNSUPPORTED')?'UNSUPPORTED_GEOMETRY':message.includes('CANCELLED')?'CANCELLED':'STEP_EXPORT_FAILED',`STEP 内核未生成有效文件：${reason}`)
   }
   ensure(); job.committing=true
   const saved=await deps.exportStore.save(target,generated.bytes,previous)
   return {generationInput:input,fileName:path.basename(target),byteSize:generated.bytes.length,sha256:saved.sha256,revisionId:input.revisionId,inputFingerprint:input.inputFingerprint,geometryFingerprint:input.geometryFingerprint,kernelVersion:generated.kernelVersion,wasmSha256:generated.wasmSha256,generatorVersion:generated.generatorVersion,schema:'AP214IS',unit:'mm',historicalByteIdentical:null,warnings:[...saved.warnings,'按所选历史参数新生成，非当时 STEP 字节重出；仅名义几何，无 PMI。',...(input.source.kind==='user-intent'?['用户输入，无外部原件。']:[]),...(input.parameters.some(x=>x.reviewStatus==='pending')?['历史参数待复核；未自动确认。']:[])]}
  } finally {clearInterval(watch);jobs.delete(p.sessionId)}
 }},deps)
}
