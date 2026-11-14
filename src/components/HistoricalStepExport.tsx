import { useEffect, useRef, useState } from 'react'
import type { CunlianApi, SnapshotDto, StepExportValue } from '../../desktop/shared/contracts'
import { selectSpacerStepInputFromSnapshot } from '../cad/selectSpacerStepInput'
import { SPACER_PART_ID } from '../drawing/types'
import type { CadGenerationInput } from '../cad/types'
import { uiFileVersionLabel, uiDiagnosticText } from './uiIdentity'

type StepApi = Pick<CunlianApi, 'stepExport' | 'stepCancel'>
export interface HistoricalStepExportProps {
  snapshot: SnapshotDto
  sessionId: string | null
  baseEditSeq: number
  api?: StepApi
  disabled?: boolean
}

/** No implicit current-version selection; success and cancellation come only from main. */
export function HistoricalStepExport({ snapshot, sessionId, baseEditSeq, api = window.cunlian, disabled = false }: HistoricalStepExportProps) {
  const [revisionId, setRevisionId] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [receipt, setReceipt] = useState<StepExportValue | null>(null)
  const active = useRef<string | null>(null)
  useEffect(() => () => { active.current = null }, [])
  let input: CadGenerationInput | null = null
  let problem = ''
  try { input = selectSpacerStepInputFromSnapshot(snapshot, revisionId, SPACER_PART_ID) }
  catch (error) { problem = error instanceof Error ? error.message : '历史输入不可用' }
  const available = sessionId !== null && typeof api?.stepExport === 'function' && typeof api?.stepCancel === 'function'

  async function start() {
    if (!available || disabled || active.current || !input || !sessionId) return
    const id = crypto.randomUUID()
    active.current = id
    setJobId(id); setReceipt(null); setMessage('正在导出，等待主进程回执…')
    try {
      const result = await api.stepExport({ sessionId, baseEditSeq, revisionId: input.revisionId,
        partId: input.partId, expectedInputFingerprint: input.inputFingerprint, jobId: id })
      if (active.current !== id) return
      if (result.ok) {
        if (result.value.revisionId !== input.revisionId || result.value.inputFingerprint !== input.inputFingerprint) {
          setMessage('STEP_EXPORT_FAILED：回执身份不匹配，不能确认导出成功')
        } else { setReceipt(result.value); setMessage('主进程已确认 STEP 导出') }
      } else setMessage(`${result.error.code}：${uiDiagnosticText(result.error.message)}`)
    } catch { if (active.current === id) setMessage('STEP_EXPORT_FAILED：未收到最终回执，不能确认文件状态') }
    finally { if (active.current === id) { active.current = null; setJobId(null) } }
  }
  async function cancel() {
    if (!sessionId || !jobId || !available) return
    const id = jobId
    try {
      const result = await api.stepCancel({ sessionId, jobId: id })
      if (active.current !== id) return
      setMessage(result.ok ? result.value.cancelled ? '主进程已受理取消；等待导出最终回执' : '未取消；等待导出最终回执' : `${result.error.code}：${uiDiagnosticText(result.error.message)}`)
    } catch { if (active.current === id) setMessage('取消回执不可用；等待导出最终回执') }
  }

  return <section aria-label="历史版本 STEP 导出">
    <h4>隔套 STEP</h4>
    <p>按历史参数新生成，非当时 STEP 字节重出；不回填历史记录。仅隔套单实体、AP214IS、mm；无 PMI，不支持装配或任意回转体。</p>
    <label>STEP 正式历史版本<select aria-label="STEP 正式历史版本" value={revisionId} disabled={jobId !== null} onChange={event => { setRevisionId(event.target.value); setReceipt(null); setMessage('') }}>
      <option value="">请选择正式历史版本（不使用当前参数/草稿）</option>
      {snapshot.fileRevisions.map(revision => <option key={revision.revisionId} value={revision.revisionId}>{uiFileVersionLabel(snapshot.fileRevisions, revision.revisionId)}</option>)}
    </select></label>
    {problem && <p>{problem}</p>}
    {!available && <p>桌面导出权限或会话不可用；不能导出 STEP。</p>}
    {input && <p>{input.parameters.every(p => p.reviewStatus === 'confirmed') ? '历史参数已复核' : '历史参数待复核（不是批准结论）'}；{input.source.kind === 'user-intent' ? '用户输入，无外部原文件' : '历史来源身份保留，不写入个人源材料'}</p>}
    <button type="button" disabled={!available || disabled || !input || jobId !== null} onClick={() => void start()}>导出所选历史版本 STEP</button>
    {jobId && <button type="button" onClick={() => void cancel()}>取消 STEP 导出</button>}
    {message && <p role="status">{message}</p>}
    {receipt && <div aria-label="STEP 主进程回执">
      <p>{receipt.fileName} · {receipt.byteSize} 字节 · SHA-256 {receipt.sha256}</p>
      <p>{receipt.schema} · {receipt.unit} · {receipt.kernelVersion} · {receipt.generatorVersion}</p>
      <p>WASM SHA-256 {receipt.wasmSha256} · 输入指纹 {receipt.inputFingerprint} · 几何指纹 {receipt.geometryFingerprint}</p>
      {receipt.warnings.map((warning, index) => <p key={index}>{uiDiagnosticText(warning)}</p>)}
    </div>}
  </section>
}
