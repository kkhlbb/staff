import { useCallback, useEffect, useRef, useState } from 'react'
import { DesktopSessionAdapter, type DesktopSessionState } from '../desktopAdapter'
import {
  ProjectAgentM1Workbench,
  type DesktopProjectOpenForAuthResult,
} from './ProjectAgentM1Workbench'

export function DesktopAgentWorkspace() {
  const [session, setSession] = useState<DesktopSessionState | null>(null)
  const [error, setError] = useState('')
  const [pendingReadonlyAuthSessionId, setPendingReadonlyAuthSessionId] = useState<string | null>(
    null,
  )
  const adapterRef = useRef<DesktopSessionAdapter | null>(null)
  const sessionRef = useRef<DesktopSessionState | null>(null)
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  const mountedRef = useRef(true)

  const handleStateChange = useCallback((next: DesktopSessionState) => {
    sessionRef.current = next
    setSession(next)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const api = window.cunlian
    if (!api?.reattachSession || !api.onMenuAction || !api.onEditorFlush || !api.openProject) {
      adapterRef.current = null
      return () => {
        mountedRef.current = false
      }
    }
    let active = true
    const adapter = new DesktopSessionAdapter({ api, onStateChange: handleStateChange })
    adapterRef.current = adapter
    function run(
      operation: () => Promise<
        { ok: true } | { ok: false; error: { code: string; message: string } }
      >,
    ) {
      queueRef.current = queueRef.current
        .then(async () => {
          if (!active) return
          const result = await operation()
          if (active && (result.ok || result.error.code !== 'CANCELLED')) {
            setError(result.ok ? '' : result.error.message)
          }
        })
        .catch(() => {
          if (active) setError('无法读取桌面项目会话')
        })
    }

    run(() => adapter.reattachSession())
    const offMenu = api.onMenuAction(({ action }) => {
      if (action === 'open') run(() => adapter.openProject())
    })
    const offFlush = api.onEditorFlush((payload) => {
      void adapter.handleEditorFlush(payload)
    })
    return () => {
      active = false
      mountedRef.current = false
      adapterRef.current = null
      offMenu()
      offFlush()
      adapter.dispose()
    }
  }, [handleStateChange])

  const handleRequestDesktopProjectForReadonlyAuth = useCallback(
    async (requestedProjectId: string): Promise<DesktopProjectOpenForAuthResult> => {
      const adapter = adapterRef.current
      if (!adapter) {
        return { ok: false, message: '桌面项目会话尚未初始化，请稍后重试。' }
      }
      const task = queueRef.current.then(async (): Promise<DesktopProjectOpenForAuthResult> => {
        if (!mountedRef.current) {
          return { ok: false, cancelled: true }
        }
        const current = sessionRef.current
        if (
          current?.status === 'open' &&
          current.sessionId &&
          current.path &&
          current.fingerprint &&
          current.snapshot?.project.id === requestedProjectId
        ) {
          setPendingReadonlyAuthSessionId(current.sessionId)
          return {
            ok: true,
            projectId: current.snapshot.project.id,
            sessionId: current.sessionId,
          }
        }
        const result = await adapter.openProject()
        if (!mountedRef.current) {
          return { ok: false, cancelled: true }
        }
        if (!result.ok) {
          if (result.error.code === 'CANCELLED') {
            return { ok: false, cancelled: true }
          }
          setError(result.error.message)
          return { ok: false, message: result.error.message }
        }
        setError('')
        const opened = result.value
        const openedProjectId = opened.snapshot.project.id
        if (!opened.path || !opened.fingerprint) {
          return {
            ok: false,
            message: '所选项目尚未绑定本地 .cunlian 文件指纹，无法发起原生只读授权。',
          }
        }
        setPendingReadonlyAuthSessionId(opened.sessionId)
        return { ok: true, projectId: openedProjectId, sessionId: opened.sessionId }
      })
      queueRef.current = task.catch(() => {})
      return task
    }, [])

  const handleAutoReadonlyAuthConsumed = useCallback(() => {
    setPendingReadonlyAuthSessionId(null)
  }, [])

  const desktopApi = typeof window !== 'undefined' ? window.cunlian : undefined
  const canOpenDesktopProject =
    typeof desktopApi?.reattachSession === 'function' &&
    typeof desktopApi.onMenuAction === 'function' &&
    typeof desktopApi.onEditorFlush === 'function' &&
    typeof desktopApi.openProject === 'function'

  const project = session?.snapshot?.project
  const boundProjectId =
    session?.status === 'open' && session.path && session.fingerprint
      ? (project?.id ?? null)
      : null
  const autoRequestReadonlyAuth = Boolean(
    session?.sessionId && session.sessionId === pendingReadonlyAuthSessionId,
  )

  return (
    <>
      {error && <p role="alert">{error}</p>}
      <ProjectAgentM1Workbench
        key={session?.sessionId ?? 'startup'}
        initialProjectId={project?.id}
        initialProjectName={project?.name}
        initialBaseRevision={session?.fingerprint ?? null}
        desktopBoundProjectId={canOpenDesktopProject ? boundProjectId : undefined}
        onRequestDesktopProjectForReadonlyAuth={
          canOpenDesktopProject ? handleRequestDesktopProjectForReadonlyAuth : undefined
        }
        autoRequestReadonlyAuth={autoRequestReadonlyAuth}
        onAutoReadonlyAuthConsumed={handleAutoReadonlyAuthConsumed}
      />
    </>
  )
}
