import { useEffect, useState } from 'react'
import { DesktopSessionAdapter, type DesktopSessionState } from '../desktopAdapter'
import { ProjectAgentM1Workbench } from './ProjectAgentM1Workbench'

export function DesktopAgentWorkspace() {
  const [session, setSession] = useState<DesktopSessionState | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const api = window.cunlian
    if (!api?.reattachSession || !api.onMenuAction || !api.onEditorFlush || !api.openProject) return
    let active = true
    const adapter = new DesktopSessionAdapter({ api, onStateChange: setSession })
    let queue = Promise.resolve()
    function run(operation: () => Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }>) {
      queue = queue.then(async () => {
        if (!active) return
        const result = await operation()
        if (active && (result.ok || result.error.code !== 'CANCELLED')) {
          setError(result.ok ? '' : result.error.message)
        }
      }).catch(() => {
        if (active) setError('无法读取桌面项目会话')
      })
    }

    run(() => adapter.reattachSession())
    const offMenu = api.onMenuAction(({ action }) => {
      if (action === 'open') run(() => adapter.openProject())
    })
    const offFlush = api.onEditorFlush(payload => { void adapter.handleEditorFlush(payload) })
    return () => {
      active = false
      offMenu()
      offFlush()
      adapter.dispose()
    }
  }, [])

  const project = session?.snapshot?.project
  return <>
    {error && <p role="alert">{error}</p>}
    <ProjectAgentM1Workbench
      key={session?.sessionId ?? 'startup'}
      initialProjectId={project?.id}
      initialProjectName={project?.name}
      initialBaseRevision={session?.fingerprint ?? null}
    />
  </>
}
