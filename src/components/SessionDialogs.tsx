import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { useDesktopSession } from '../workspace/useDesktopSession'
import { uiDiagnosticText } from './uiIdentity'

function SessionDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <dialog ref={ref} className="desktop-workspace__dialog" aria-labelledby="session-dialog-title" onCancel={event => { event.preventDefault(); onClose() }}>
    <h2 id="session-dialog-title">{title}</h2>{children}
  </dialog>
}

export function SessionDialogs({ session }: { session: ReturnType<typeof useDesktopSession> }) {
  const [name, setName] = useState('未命名项目')
  if (session.newOpen) return <SessionDialog title="新建项目" onClose={() => { if (!session.busy) session.setNewOpen(false) }}>
    <form onSubmit={event => { event.preventDefault(); void session.create(name.trim(), 'empty') }}>
      <label htmlFor="new-project-name">项目名称</label>
      <input id="new-project-name" value={name} required maxLength={200} onChange={event => setName(event.target.value)} aria-describedby="new-project-note" />
      <p id="new-project-note">新项目带两个无业务含义的占位组成环，不解析项目名中的文字或数值。请明确填写尺寸并核对来源；也可导入资料或在任务侧栏提供目标后逐条确认候选。</p>
      {session.notice && <p role="alert">{uiDiagnosticText(session.notice)}</p>}
      <div className="desktop-workspace__dialog-actions"><button type="button" disabled={session.busy} onClick={() => session.setNewOpen(false)}>取消</button><button disabled={session.busy || !name.trim()}>新建</button></div>
    </form>
  </SessionDialog>
  if (session.importOpen) return <SessionDialog title="导入 V2 备份" onClose={() => { if (!session.busy) session.setImportOpen(false) }}>
    <p>先只读预检，再选择项目另存为新的 .cunlian 文件；不覆盖 V2 原文件。</p>
    <div className="desktop-workspace__dialog-actions"><button disabled={session.busy} onClick={() => void session.inspect('bundle')}>选择完整备份…</button><button disabled={session.busy} onClick={() => void session.inspect('json')}>选择项目 JSON…</button></div>
    {session.preview?.warnings.map((warning, index) => <p key={index}>{uiDiagnosticText(warning)}</p>)}
    {session.preview?.projects.map(project => <div key={project.id}><h3>{project.name}</h3><p>附件 {project.attachmentCount} · 缺失 {project.missingItems}</p><button disabled={session.busy} onClick={() => void session.commit(project.id)}>导入并另存为…</button></div>)}
    {session.notice && <p role="alert">{uiDiagnosticText(session.notice)}</p>}
    <div className="desktop-workspace__dialog-actions"><button disabled={session.busy} onClick={() => session.setImportOpen(false)}>取消</button></div>
  </SessionDialog>
  return null
}
