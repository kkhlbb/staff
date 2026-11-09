import { useEffect, useRef, useState } from 'react'
import type { IpcResult, MenuAction, MigrationInspectValue, RecentProjectItem, RecoveryItem } from '../../desktop/shared/contracts'
import { DesktopSessionAdapter, type DesktopSessionState } from './desktopAdapter'
import { chainToDraft, draftToChain, workspaceReducer, type WorkspaceAction } from './draft'

/** 仅持有适配器发布的会话快照；dirty gate 与文件事务始终由 main 执行。 */
export function useDesktopSession() {
  const [state, setState] = useState<DesktopSessionState | null>(null)
  const [recent, setRecent] = useState<RecentProjectItem[]>([])

  const [recovery, setRecovery] = useState<RecoveryItem[]>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(() => Boolean(window.cunlian))
  const [newOpen, setNewOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [preview, setPreview] = useState<MigrationInspectValue | null>(null)
  const adapter = useRef<DesktopSessionAdapter | null>(null)
  const locked = useRef(false)

  function report<T extends IpcResult<unknown>>(result: T) {
    if (!result.ok && result.error.code !== 'CANCELLED') setNotice(`${result.error.code}：${result.error.message}`)
    return result
  }
  async function refresh() {
    if (!adapter.current) return
    const [r, d] = await Promise.all([adapter.current.listRecent(), adapter.current.listRecovery()])
    if (report(r).ok && r.ok) setRecent(r.value.items)
    if (report(d).ok && d.ok) setRecovery(d.value.items)
  }
  async function run(work: (session: DesktopSessionAdapter) => Promise<unknown>) {
    if (!adapter.current) { setNotice('window.cunlian 不可用，请在桌面应用中执行文件操作。'); return }
    if (locked.current) return
    locked.current = true; setBusy(true); setNotice('')
    try { await work(adapter.current); await refresh() }
    catch (error) { setNotice(`操作失败：${error instanceof Error ? error.message : String(error)}；当前编辑仍保留。`) }
    finally { locked.current = false; setBusy(false) }
  }
  function action(action: MenuAction) {
    if (action === 'new') { setNewOpen(true); return }
    if (action === 'importV2') { setImportOpen(true); return }
    void run(async session => {
      report(await (action === 'open' ? session.openProject() : action === 'save' ? session.saveProject() : action === 'saveAs' ? session.saveProjectAs() : session.close()))
    })
  }
  const actionRef = useRef(action)
  useEffect(() => { actionRef.current = action })
  useEffect(() => {
    const api = window.cunlian
    if (!api) return
    const session = new DesktopSessionAdapter({ api, onStateChange: setState })
    adapter.current = session
    // 单独订阅菜单，确保工具栏/快捷键/原生菜单共用忙碌锁与迁移流程。
    const offMenu = api.onMenuAction(({ action }) => actionRef.current(action))
    const offFlush = api.onEditorFlush(({ requestId }) => {
      void session.flushStage().then(result => {
        // stage 失败不声称 flush 成功：让 main 的屏障超时阻止切换。
        if (!result.ok) { report(result); return }
        const current = session.getState()
        api.respondEditorFlush(current.sessionId ? { requestId, sessionId: current.sessionId, editSeq: current.acceptedSeq } : { requestId })
      })
    })
    locked.current = true
    void session.reattachSession().then(result => {
      if (adapter.current === session) report(result)
    }).catch(error => {
      if (adapter.current === session) setNotice(`恢复活动会话失败：${String(error)}`)
    }).finally(() => {
      if (adapter.current === session) { locked.current = false; setBusy(false); void refresh() }
    })
    return () => { offMenu(); offFlush(); session.dispose(); adapter.current = null }
    // API 生命周期固定为组件挂载期。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      // Electron 原生菜单已有 accelerator，避免同一次按键执行两次。
      if (window.cunlian || !event.metaKey || event.altKey) return
      if (['o', 's'].includes(event.key.toLowerCase())) {
        event.preventDefault(); actionRef.current(event.key.toLowerCase() === 'o' ? 'open' : event.shiftKey ? 'saveAs' : 'save')
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])
  return {
    state, recent, recovery, notice, busy, newOpen, setNewOpen, importOpen, setImportOpen, preview, action,
    applyModelMutation: async (value: Parameters<DesktopSessionAdapter['applyModelMutation']>[0]) => {
      await adapter.current?.applyModelMutation(value)
    },
    edit: (action: WorkspaceAction) => {
      const current = adapter.current?.getState().snapshot
      if (!current || locked.current) return
      const draft = workspaceReducer(current.draft ?? { ...chainToDraft(current.project.dimensionChain), relationRevision: current.project.relationRevision }, action)
      const parsed = draftToChain(draft)
      adapter.current!.edit({ ...current, draft, project: {
        ...current.project, relationRevision: draft.relationRevision,
        dimensionChain: parsed.ok ? parsed.chain : current.project.dimensionChain,
      } })
    },
    create: async (name: string, template: 'empty' | 'chain-demo') => {
      let created: string | null = null
      await run(async session => {
        const result = report(await session.newProject(name, template))
        if (result.ok) { setNewOpen(false); created = result.value.sessionId }
      })
      // 返回新会话 ID 供调用方（如轴系示例入口）在成功后接上局部视图。
      return created
    },
    openRecent: (item: RecentProjectItem) => run(async session => { report(await (item.missing ? session.relinkRecent(item.recentId) : session.openProject(item.recentId))) }),
    restore: (id: string) => run(async session => { report(await session.restoreRecovery(id)) }),
    inspect: (kind: 'bundle' | 'json') => run(async () => { setPreview(null); const result = report(await window.cunlian!.inspectV2({ kind })); if (result.ok) setPreview(result.value) }),
    commit: (projectId: string) => run(async session => {
      if (!preview) return
      const result = report(await session.importV2(preview.importToken, projectId))
      if (result.ok) { setImportOpen(false); setPreview(null) }
    }),
  }
}
