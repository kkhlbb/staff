import { useEffect, useRef, useState } from 'react'
import type {
  ChangeCompareValueResponse,
  ChangeDraftValue,
  ChangePreviewValue,
  IpcResult,
  MenuAction,
  MigrationInspectValue,
  RecentProjectItem,
  RecoveryItem,
  ExtractionRunRequest,
  ExtractionDecideRequest,
  ExtractionDecideValue,
  ExtractionCancelValue,
  ExtractionDeleteDraftRequest,
  ExtractionDeleteDraftValue,
} from '../../desktop/shared/contracts'
import { DesktopSessionAdapter, type DesktopSessionState } from './desktopAdapter'
import { draftToChain, workspaceReducer, type WorkspaceAction } from './draft'
import { resolveDraft } from './draftSync'
import type { RequirementEditDraft } from '../requirements/types'

/** 没有可写入的活动会话时统一使用的提示：所有提前返回的写路径都发同一条，不各自编文案。 */
export const NO_WRITABLE_SESSION_NOTICE = '当前没有可写入的活动项目，请先保存项目文件。'

/**
 * 预览因基准/草稿变化而作废的固定原因。
 *
 * 与“从未预览”区分：staleReason 只在确实存在过预览、且该预览已被后续编辑作废时写入；
 * 首次进入或从未预览时保持 null，界面不得显示“已作废”。
 */
export const PREVIEW_INVALIDATED_NOTICE = '基准已变化，旧预览已作废；请重新预览后再确认。'

const EMPTY_CHANGE: ChangeUiState = {
  sessionId: null,
  draft: null,
  preview: null,
  staleReason: null,
  compare: null,
  error: null,
  notice: '',
  autoState: 'idle',
  autoMessage: '',
}

export type AutoPreviewState = 'idle' | 'pending' | 'valid' | 'invalid'

export interface ChangeUiState {
  /** 归属会话：换会话即视为无草稿，不串场。 */
  sessionId: string | null
  draft: ChangeDraftValue | null
  preview: ChangePreviewValue | null
  /**
   * 明确过期原因（不用布尔冒充）。
   *
   * null 表示“没有作废的预览”：既可能是从未预览过，也可能是当前预览仍然有效。
   * 界面据 preview === null && staleReason === null 显示“尚未预览”，据 staleReason !== null
   * 显示“已作废 + 原因”，两种情况不混用同一句文案。
   */
  staleReason: string | null
  compare: ChangeCompareValueResponse | null
  error: { code: string; message: string } | null
  notice: string
  /** 自动预览状态：非法输入 → invalid（保留上次有效几何但不保留通过资格）。 */
  autoState: AutoPreviewState
  autoMessage: string
}

/** 仅持有适配器发布的会话快照；dirty gate 与文件事务始终由 main 执行。 */
export function useDesktopSession(options: { onOpenDxf?: () => void } = {}) {
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
  const [change, setChange] = useState<ChangeUiState>(EMPTY_CHANGE)
  /** 自动预览的单调请求序号：迟到响应不得覆盖新草稿。 */
  const autoSequence = useRef(0)
  /** 自动预览串行链：避免两次 stage 抢同一 acceptedSeq。 */
  const autoChain = useRef<Promise<unknown>>(Promise.resolve())

  const sessionId = state?.sessionId ?? null
  const changeView: ChangeUiState = change.sessionId === sessionId ? change : EMPTY_CHANGE
  const patchChange = (patch: Partial<ChangeUiState>) => {
    setChange(current => {
      const base = current.sessionId === sessionId ? current : { ...EMPTY_CHANGE, sessionId }
      return { ...base, sessionId, ...patch }
    })
  }

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
    // 看图与项目会话无关：不跑 dirty gate、不切换项目，交给外层面板。
    if (action === 'openDxf') { openDxfRef.current?.(); return }
    void run(async session => {
      report(await (action === 'open' ? session.openProject() : action === 'save' ? session.saveProject() : action === 'saveAs' ? session.saveProjectAs() : session.close()))
    })
  }
  const actionRef = useRef(action)
  useEffect(() => { actionRef.current = action })
  const openDxfRef = useRef(options.onOpenDxf)
  useEffect(() => { openDxfRef.current = options.onOpenDxf }, [options.onOpenDxf])
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
  function requireSession(): { session: DesktopSessionAdapter; sessionId: string; acceptedSeq: number } | null {
    const session = adapter.current
    const current = session?.getState()
    if (session === null || current === undefined || current.sessionId === null) {
      // 所有写路径共用同一条提示；不静默返回 null。
      setNotice(NO_WRITABLE_SESSION_NOTICE)
      patchChange({ notice: NO_WRITABLE_SESSION_NOTICE })
      return null
    }
    return { session, sessionId: current.sessionId, acceptedSeq: current.acceptedSeq }
  }

  /** 草稿被后续编辑/绑定替换时，之前建立过的预览必然作废；从未预览过则不写原因。 */
  const invalidatedPreviewReason = (): string | null =>
    changeView.preview !== null || changeView.staleReason !== null ? PREVIEW_INVALIDATED_NOTICE : null

  const requestId = () => {
    const random = globalThis.crypto?.randomUUID
    return random !== undefined ? random.call(globalThis.crypto) : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  /** 提交由 main 完成后，把 main 侧的新快照重新挂回界面（不重新打开文件）。 */
  async function reloadSession(): Promise<void> {
    if (!adapter.current) return
    const result = await adapter.current.reattachSession()
    report(result)
    await refresh()
  }

  return {
    state, recent, recovery, notice, busy, newOpen, setNewOpen, importOpen, setImportOpen, preview, action,
    reloadSession,
    applyModelMutation: async (value: Parameters<DesktopSessionAdapter['applyModelMutation']>[0]) => {
      await adapter.current?.applyModelMutation(value)
    },
    applyDrawingMutation: async (value: Parameters<DesktopSessionAdapter['applyDrawingMutation']>[0]) => {
      await adapter.current?.applyDrawingMutation(value)
    },
    edit: (action: WorkspaceAction) => {
      const current = adapter.current?.getState().snapshot
      if (!current || locked.current) return
      const resolved = resolveDraft(current)
      const draft = workspaceReducer({ ...resolved.draft, basisRelationRevision: resolved.basis }, action)
      const parsed = draftToChain(draft)
      // D：已绑定参数的组成环禁止手动改 nominal；导向参数编辑或解除绑定。
      if (parsed.ok && action.type === 'updateField' && action.field === 'nominal') {
        const bound = new Set(
          current.project.dimensionLinks.flatMap(link => (link.kind === 'parameter-binding' ? [link.termId] : [])),
        )
        for (const term of parsed.chain.terms) {
          const before = current.project.dimensionChain.terms.find(item => item.id === term.id)
          if (term.id === action.termId && bound.has(term.id) && before !== undefined && before.nominalQ !== term.nominalQ) {
            setNotice('该组成环已绑定隔套参数：请编辑参数或先解除绑定；不会反向修改参数，也不会静默解除。')
            return
          }
        }
      }
      adapter.current!.edit({ ...current, draft })
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
    change: changeView,
    stageChange: async (
      inputs: { innerDiameter: string; outerDiameter: string; length: string },
      sourceNotes?: { innerDiameter?: string; outerDiameter?: string; length?: string },
      bindings?: { termId: string; partId: string; parameterId: string }[],
    ) => {
      const target = requireSession()
      if (target === null) return null
      const result = await target.session.stageChange({
        sessionId: target.sessionId,
        baseEditSeq: target.acceptedSeq,
        inputs,
        ...(sourceNotes === undefined ? {} : { sourceNotes }),
        ...(bindings === undefined ? {} : { bindings }),
        reason: '隔套参数变更',
      })
      if (result.ok) {
        // 新草稿的 token 与旧预览不再对应：已有预览时必须留下作废原因，不能清成 null。
        patchChange({ draft: result.value, preview: null, staleReason: invalidatedPreviewReason(), error: null, notice: result.value.notice ?? '', autoState: 'idle', autoMessage: '' })
      } else {
        const invalidInput = result.error.code === 'INVALID_PARAMETER'
        patchChange({
          error: result.error,
          // 非法输入保留上次有效几何，但旧绿灯/提交资格立即失效。
          ...(invalidInput ? {} : { preview: null }),
          staleReason: invalidInput
            ? '输入待修正，当前检查未完成。'
            : result.error.code === 'STALE_BASE' || result.error.code === 'STALE_DRAFT'
              ? result.error.message
              : null,
          autoState: invalidInput ? 'invalid' : 'idle',
          autoMessage: invalidInput ? result.error.message : '',
        })
      }
      return result
    },
    /**
     * 合法输入自动驱动草稿+预览（不点按钮）。
     *
     * - 序号单调：只有最新请求的响应可以写入界面；
     * - 串行执行 stage/preview，避免同一 acceptedSeq 被抢；
     * - 非法输入保留上次有效画面，但作废旧通过资格。
     */
    autoPreviewChange: async (
      inputs: { innerDiameter: string; outerDiameter: string; length: string },
      sourceNotes?: { innerDiameter?: string; outerDiameter?: string; length?: string },
    ) => {
      const target = requireSession()
      if (target === null) return null
      const seq = autoSequence.current + 1
      autoSequence.current = seq
      patchChange({ autoState: 'pending', autoMessage: '正在按当前输入重新计算…' })

      const task = autoChain.current.then(async () => {
        if (seq !== autoSequence.current) return null
        const staged = await target.session.stageChange({
          sessionId: target.sessionId,
          baseEditSeq: target.acceptedSeq,
          inputs,
          ...(sourceNotes === undefined ? {} : { sourceNotes }),
          reason: '参数变更（自动预览）',
        })
        if (seq !== autoSequence.current) return null
        if (!staged.ok) {
          patchChange({
            error: staged.error,
            // 保留上一次有效预览画面，但不再把它当当前有效结论。
            staleReason: '输入待修正，当前检查未完成。',
            autoState: 'invalid',
            autoMessage: `${staged.error.code}：${staged.error.message}`,
          })
          return staged
        }
        patchChange({ draft: staged.value, error: null, notice: staged.value.notice ?? '' })
        const previewed = await target.session.previewChange({
          sessionId: target.sessionId,
          baseToken: staged.value.baseToken,
          draftToken: staged.value.draftToken,
        })
        if (seq !== autoSequence.current) return null
        if (!previewed.ok) {
          patchChange({
            error: previewed.error,
            staleReason: `自动预览未完成：${previewed.error.message}`,
            autoState: 'invalid',
            autoMessage: `${previewed.error.code}：${previewed.error.message}`,
          })
          return previewed
        }
        patchChange({
          preview: previewed.value,
          staleReason: null,
          error: null,
          autoState: 'valid',
          autoMessage: '',
        })
        return previewed
      })
      autoChain.current = task.catch(() => undefined)
      return task
    },
    importSource: async (documentId?: string | null) => {
      const current = adapter.current
      if (current === null) { setNotice('window.cunlian 不可用，请在桌面应用中执行文件操作。'); return null }
      if (locked.current) return null
      locked.current = true; setBusy(true); setNotice('')
      try {
        const flushed = await current.flushStage()
        if (!flushed.ok) return flushed
        const session = current.getState()
        if (session.sessionId === null) {
          setNotice(NO_WRITABLE_SESSION_NOTICE)
          return null
        }
        const result = await current.importSource({
          sessionId: session.sessionId,
          baseEditSeq: session.acceptedSeq,
          ...(documentId === undefined ? {} : { documentId }),
        })
        report(result)
        return result
      } finally {
        locked.current = false; setBusy(false); void refresh()
      }
    },
    /** V3.6：提取/决定只改隔离草稿；项目正式保存仍需用户显式保存。 */
    runExtraction: async (
      request: Omit<ExtractionRunRequest, 'sessionId' | 'baseEditSeq'>,
    ): Promise<{ requestId: string; result: Awaited<ReturnType<DesktopSessionAdapter['runExtraction']>> } | null> => {
      const current = adapter.current
      if (current === null) { setNotice('window.cunlian 不可用，请在桌面应用中执行文件操作。'); return null }
      if (locked.current) return null
      const state = current.getState()
      if (state.sessionId === null) { setNotice(NO_WRITABLE_SESSION_NOTICE); return null }
      locked.current = true; setBusy(true); setNotice('')
      try {
        const result = await current.runExtraction({
          sessionId: state.sessionId,
          baseEditSeq: state.acceptedSeq,
          ...request,
        })
        report(result)
        return { requestId: request.requestId, result }
      } finally {
        locked.current = false; setBusy(false); void refresh()
      }
    },
    decideExtraction: async (
      request: Omit<ExtractionDecideRequest, 'sessionId' | 'baseEditSeq'>,
    ): Promise<ExtractionDecideValue | null> => {
      const current = adapter.current
      if (current === null) { setNotice('window.cunlian 不可用，请在桌面应用中执行文件操作。'); return null }
      if (locked.current) return null
      const state = current.getState()
      if (state.sessionId === null) { setNotice(NO_WRITABLE_SESSION_NOTICE); return null }
      locked.current = true; setBusy(true); setNotice('')
      try {
        const result = await current.decideExtraction({
          sessionId: state.sessionId,
          baseEditSeq: state.acceptedSeq,
          ...request,
        })
        report(result)
        return result.ok ? result.value : null
      } finally {
        locked.current = false; setBusy(false); void refresh()
      }
    },
    cancelExtraction: async (requestId: string): Promise<ExtractionCancelValue | null> => {
      const current = adapter.current
      const state = current?.getState()
      if (current === null || state === undefined || state.sessionId === null) return null
      const result = await current.cancelExtraction({ sessionId: state.sessionId, requestId })
      report(result)
      return result.ok ? result.value : null
    },
    /** 多草稿方案 3：删除旧规则版本草稿；main 校验“必须被取代”，失败零写入。 */
    deleteExtractionDraft: async (
      request: Omit<ExtractionDeleteDraftRequest, 'sessionId' | 'baseEditSeq'>,
    ): Promise<ExtractionDeleteDraftValue | null> => {
      const current = adapter.current
      if (current === null) { setNotice('window.cunlian 不可用，请在桌面应用中执行文件操作。'); return null }
      if (locked.current) return null
      const state = current.getState()
      if (state.sessionId === null) { setNotice(NO_WRITABLE_SESSION_NOTICE); return null }
      locked.current = true; setBusy(true); setNotice('')
      try {
        const result = await current.deleteExtractionDraft({
          sessionId: state.sessionId,
          baseEditSeq: state.acceptedSeq,
          ...request,
        })
        report(result)
        return result.ok ? result.value : null
      } finally {
        locked.current = false; setBusy(false); void refresh()
      }
    },
    stageRequirementEdit: async (edit: RequirementEditDraft | null) => {
      const target = requireSession()
      if (target === null) return null
      const result = await target.session.stageRequirementEdit({
        sessionId: target.sessionId,
        baseEditSeq: target.acceptedSeq,
        edit,
      })
      if (!result.ok) patchChange({ error: result.error })
      else if (edit !== null) {
        patchChange({
          preview: null,
          staleReason: invalidatedPreviewReason(),
          autoState: 'idle',
          autoMessage: '条款表单尚未确认：当前结论待确认。',
        })
      } else {
        patchChange({ autoMessage: '', autoState: 'idle' })
      }
      return result
    },
    confirmRequirement: async (input: {
      baseToken: string
      expectedActiveRequirementRevisionId: string | null
      requirementId: string | null
      source: Parameters<DesktopSessionAdapter['confirmRequirement']>[0]['source']
      confirmedText: string
      lowerText: string
      upperText: string
      changeReason: string
    }) => {
      const target = requireSession()
      if (target === null) return null
      const result = await target.session.confirmRequirement({
        sessionId: target.sessionId,
        confirmed: true,
        ...input,
      })
      if (result.ok) {
        patchChange({
          draft: null,
          preview: null,
          staleReason: '条款版本已更新，请重新预览当前草稿。',
          error: null,
          notice: `已确认条款版本 ${result.value.requirementRevisionId}（基线检查：${result.value.baselineCheck.status}）。`,
          autoState: 'idle',
          autoMessage: '',
        })
        setNotice(`任务书要求已保存为条款版本 ${result.value.requirementRevisionId}。`)
      } else {
        patchChange({ error: result.error, notice: `条款确认失败：${result.error.message}` })
        report(result)
      }
      return result
    },
    previewChange: async () => {
      const target = requireSession()
      const draft = changeView.draft
      if (target === null || !draft) return null
      const result = await target.session.previewChange({
        sessionId: target.sessionId,
        baseToken: draft.baseToken,
        draftToken: draft.draftToken,
      })
      if (result.ok) {
        patchChange({ preview: result.value, staleReason: null, error: null, autoState: 'valid', autoMessage: '' })
      } else {
        patchChange({ preview: null, error: result.error, staleReason: result.error.message, autoState: 'invalid', autoMessage: result.error.message })
      }
      return result
    },
    applyChange: async (reason: string) => {
      const target = requireSession()
      const draft = changeView.draft
      const shown = changeView.preview
      if (target === null || !draft || !shown) return null
      const result = await target.session.applyChange({
        sessionId: target.sessionId,
        baseToken: draft.baseToken,
        draftToken: draft.draftToken,
        previewId: shown.previewId,
        previewToken: shown.previewToken,
        requestId: requestId(),
        reason,
      })
      if (result.ok) {
        patchChange({
          draft: null,
          preview: null,
          staleReason: null,
          error: null,
          compare: null,
          notice: `已提交新版本 ${result.value.revisionId}（一次写入参数/图纸/链/事件/快照/版本）。`,
        })
      } else {
        patchChange({
          error: result.error,
          staleReason: result.error.code === 'STALE_BASE' || result.error.code === 'STALE_DRAFT' || result.error.code === 'STALE_PREVIEW'
            ? result.error.message
            : null,
          notice: `提交失败：${result.error.message}`,
        })
      }
      return result
    },
    bindParameter: async (termId: string, partId: string, parameterId: string, replaceBindingId?: string) => {
      const target = requireSession()
      if (target === null) return null
      const result = await target.session.bindParameter({
        sessionId: target.sessionId,
        baseEditSeq: target.acceptedSeq,
        termId,
        partId,
        parameterId,
        ...(replaceBindingId === undefined ? {} : { replaceBindingId }),
        reason: '绑定参数到组成环',
      })
      if (result.ok) patchChange({ draft: result.value, preview: null, staleReason: invalidatedPreviewReason(), error: null })
      else patchChange({ error: result.error })
      return result
    },
    unbindParameter: async (bindingId: string) => {
      const target = requireSession()
      if (target === null) return null
      const result = await target.session.unbindParameter({
        sessionId: target.sessionId,
        baseEditSeq: target.acceptedSeq,
        bindingId,
        reason: '解除参数绑定',
      })
      if (result.ok) patchChange({ draft: result.value, preview: null, staleReason: invalidatedPreviewReason(), error: null })
      else patchChange({ error: result.error })
      return result
    },
    compareDrawings: async (leftRevisionId?: string) => {
      const target = requireSession()
      if (target === null) return null
      const draft = changeView.draft
      const result = await target.session.compareDrawings({
        sessionId: target.sessionId,
        ...(leftRevisionId === undefined ? {} : { leftRevisionId }),
        ...(draft === null ? {} : { rightDraftToken: draft.draftToken }),
      })
      if (result.ok) patchChange({ compare: result.value })
      else patchChange({ error: result.error })
      return result
    },
    restoreRevisionDraft: async (sourceRevisionId: string) => {
      const target = requireSession()
      if (target === null) return null
      let baseToken = changeView.draft?.baseToken
      if (baseToken === undefined) {
        const snapshot = target.session.getState().snapshot
        const parameters = snapshot?.project.parameters ?? []
        if (parameters.length !== 3) {
          patchChange({ error: { code: 'NO_PARAMETER_BINDING', message: '当前项目没有隔套参数，不能建立恢复草稿' } })
          return null
        }
        const text = (valueQ: number, decimals: number) => {
          const whole = Math.trunc(valueQ / 10000)
          const fraction = String(valueQ % 10000).padStart(4, '0').slice(0, decimals)
          return decimals === 0 ? String(whole) : `${whole}.${fraction}`
        }
        const byKey = new Map(parameters.map(parameter => [parameter.key, parameter]))
        const staged = await target.session.stageChange({
          sessionId: target.sessionId,
          baseEditSeq: target.acceptedSeq,
          inputs: {
            innerDiameter: text(byKey.get('innerDiameter')!.valueQ, byKey.get('innerDiameter')!.inputDecimals),
            outerDiameter: text(byKey.get('outerDiameter')!.valueQ, byKey.get('outerDiameter')!.inputDecimals),
            length: text(byKey.get('length')!.valueQ, byKey.get('length')!.inputDecimals),
          },
          reason: '准备恢复旧版本',
        })
        if (!staged.ok) {
          patchChange({ error: staged.error })
          return null
        }
        patchChange({ draft: staged.value })
        baseToken = staged.value.baseToken
      }
      const result = await target.session.restoreRevisionDraft({
        sessionId: target.sessionId,
        baseToken,
        sourceRevisionId,
        reason: `从版本 ${sourceRevisionId} 恢复`,
      })
      if (result.ok) patchChange({ draft: result.value, preview: null, staleReason: invalidatedPreviewReason(), error: null, notice: result.value.notice })
      else patchChange({ error: result.error })
      return result
    },
  }
}
