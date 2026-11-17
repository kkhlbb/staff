/**
 * 渲染进程侧的文件会话适配器（A-04，会话层）。
 *
 * 职责：把 `window.cunlian` 的具体函数包装成工作台可用的状态机：
 * - 编辑后本地 editSeq 递增，按短延迟 stage 到 main（main 才是 dirty 权威）；
 * - 保存/另存前先 flush 未提交的 stage，保证保存的序号与 main 已接受一致；
 * - 编辑屏障（editor:flush）到达时立即 flush，再用 main 已接受的序号回复；
 * - 菜单动作、最近项目、恢复草稿只调用 preload 暴露的具体方法。
 *
 * 不负责界面布局、样式和对话框：项目名/模板/迁移等需要用户输入的菜单项
 * 通过 handlers 交给界面层（Venus 的 DesktopWorkspace）处理。
 * 这里不读写 IndexedDB，也不把自动保存冒充成正式文件保存。
 */
import type {
  CunlianApi,
  EditorFlushRequest,
  IpcErrorPayload,
  IpcResult,
  MenuAction,
  ProjectOpenValue,
  ProjectSaveValue,
  ProjectStageValue,
  RecoveryWriteState,
  SnapshotDto,
  ChangeStageRequest,
  ChangeDraftValue,
  ChangePreviewValue,
  ChangeApplyRequest,
  ChangeApplyValue,
  ChangeBindRequest,
  ChangeUnbindRequest,
  ChangeCompareRequest,
  ChangeCompareValueResponse,
  ChangeRestoreRequest,
  ChangeRestoreValue,
  SourceImportRequest,
  SourceImportValue,
  SketchImageImportValue,
  SketchIngestRequest,
  SketchIngestValue,
  RequirementEditRequest,
  RequirementEditValue,
  RequirementConfirmRequest,
  RequirementConfirmValue,
  ExtractionRunRequest,
  ExtractionRunValue,
  ExtractionDecideRequest,
  ExtractionDecideValue,
  ExtractionCancelRequest,
  ExtractionCancelValue,
  ExtractionDeleteDraftRequest,
  ExtractionDeleteDraftValue,
  ExtractionConfirmBatchRequest,
  ExtractionAttestUnitsRequest,
  ExtractionAttestUnitsValue,
  ExtractionRevokeUnitsRequest,
  ExtractionBatchValue,
} from '../../desktop/shared/contracts'

export interface DesktopSessionState {
  status: 'empty' | 'open'
  sessionId: string | null
  path: string | null
  fingerprint: string | null
  /** 本地最新编辑序号（尚未被 main 接受时大于 acceptedSeq）。 */
  localSeq: number
  /** main 已接受的最新编辑序号。 */
  acceptedSeq: number
  /** main 已成功落盘的编辑序号。 */
  savedSeq: number
  /** 仅用于展示；真正判定在 main（acceptedSeq > savedSeq）。 */
  dirty: boolean
  /** reattach 契约未提供 savedSeq，不能声称已保存。 */
  saveStateKnown?: boolean
  recovery: RecoveryWriteState | 'none'
  recoveryWarning?: string
  snapshot: SnapshotDto | null
  /** Renderer-only queued editing projection. Never stage/export this until lease release. */
  editingSnapshot?: SnapshotDto
  warnings: string[]
  lastError?: IpcErrorPayload
  exportEditNotice?: string
}

export interface DesktopAdapterHandlers {
  /** “新建项目…”需要界面先收集名称/模板；返回项目或 null（取消）。 */
  newProject?: () => Promise<ProjectOpenValue | null>
  /** “导入 V2 备份…”属于界面流程；适配器只转交。 */
  importV2?: () => void | Promise<void>
  /** 菜单动作的额外观察者（在默认动作执行后调用）。 */
  onMenuAction?: (action: MenuAction) => void
}

export interface DesktopAdapterOptions {
  api?: CunlianApi
  /** stage 防抖；main 侧恢复草稿另有 1 秒防抖。 */
  stageDelayMs?: number
  handlers?: DesktopAdapterHandlers
  onStateChange?: (state: DesktopSessionState) => void
}

const INITIAL_STATE: DesktopSessionState = {
  status: 'empty',
  sessionId: null,
  path: null,
  fingerprint: null,
  localSeq: 0,
  acceptedSeq: 0,
  savedSeq: 0,
  dirty: false,
  recovery: 'none',
  snapshot: null,
  warnings: [],
}

interface ResponseTicket {
  binding: number
  sessionId: string | null
  edits: number
  authority: number
  recovery: number
  pendingEdits: boolean
  reset: number
}

export class DesktopSessionAdapter {
  private readonly api: CunlianApi
  private readonly stageDelayMs: number
  private readonly handlers: DesktopAdapterHandlers
  private readonly onStateChange: ((state: DesktopSessionState) => void) | undefined
  private state: DesktopSessionState = { ...INITIAL_STATE }
  private stageTimer: ReturnType<typeof setTimeout> | null = null
  private stageInFlight: Promise<IpcResult<ProjectStageValue>> | null = null
  private unsubscribers: (() => void)[] = []
  private bindingGeneration = 0
  private sessionGeneration = 0
  // Monotonic across reset/dispose: localSeq is a per-session main protocol number,
  // not a safe freshness token (queued edits do not advance it until release).
  private editGeneration = 0
  private authorityGeneration = 0
  private recoveryGeneration = 0
  private resetRequestGeneration = 0

  private responseTicket(reset = false): ResponseTicket {
    if (reset) this.resetRequestGeneration++
    return { binding: this.bindingGeneration, sessionId: this.state.sessionId,
      edits: this.editGeneration, authority: this.authorityGeneration, recovery: this.recoveryGeneration,
      pendingEdits: this.state.localSeq > this.state.acceptedSeq, reset: this.resetRequestGeneration }
  }

  private responseError(ticket: ResponseTicket, mode: 'open' | 'reset' | 'mutation' | 'save', aggregateSeq?: number): IpcErrorPayload | undefined {
    // Keep the explicit lease rejection, but never use that instantaneous lock as
    // the lifetime freshness test. A released lease may already have replayed edits.
    if (mode === 'reset' || mode === 'open') this.assertNoExportLease()
    const identityChanged = ticket.binding !== this.bindingGeneration || ticket.sessionId !== this.state.sessionId
    const editsChanged = mode !== 'save' && (ticket.edits !== this.editGeneration ||
      (mode !== 'open' && ticket.pendingEdits))
    // Main can serialize a genuine commit after a save that completed while this
    // request was pending. A strictly newer aggregate is not an old read receipt.
    // Never use this exception for intervening local edits or identity changes.
    const newerAggregate = aggregateSeq !== undefined && aggregateSeq > this.state.acceptedSeq &&
      this.state.localSeq === this.state.acceptedSeq
    const authorityChanged = mode !== 'open' && !newerAggregate && ticket.authority !== this.authorityGeneration
    if (identityChanged || editsChanged || authorityChanged ||
        (mode === 'reset' && !newerAggregate && ticket.recovery !== this.recoveryGeneration) ||
        ((mode === 'open' || mode === 'reset') && ticket.reset !== this.resetRequestGeneration) ||
        (mode !== 'save' && this.exportLease)) {
      const error: IpcErrorPayload = { code: 'STALE_SESSION', message: '异步响应已过期；当前编辑与恢复信息已保留，请核对后重试或重新打开项目。' }
      if (!identityChanged && editsChanged) {
        this.state = { ...this.state, lastError: error }
        this.emit()
      }
      return error
    }
    return undefined
  }
  private exportLease: { requestId: string; sessionId: string; timer: ReturnType<typeof setTimeout>; edits: SnapshotDto[] } | null = null

  constructor(options: DesktopAdapterOptions = {}) {
    const api = options.api ?? (globalThis as { cunlian?: CunlianApi }).cunlian
    if (api === undefined) {
      throw new Error('window.cunlian 不可用：必须在桌面 preload 下使用')
    }
    this.api = api
    this.stageDelayMs = options.stageDelayMs ?? 250
    this.handlers = options.handlers ?? {}
    this.onStateChange = options.onStateChange
  }

  getState(): DesktopSessionState {
    return this.state
  }

  /** Every local read-modify-write must use the last queued result, not the frozen export basis. */
  getEditingSnapshot(): SnapshotDto | null {
    return this.state.editingSnapshot ?? this.state.snapshot
  }

  private assertNoExportLease(): void {
    if (this.exportLease) throw new Error('正在提交已保存版本导出，此操作尚未执行；请在导出结束或超时后重试，排队编辑仍保留且不会自动保存')
  }

  /** 订阅菜单与编辑屏障；返回取消订阅函数。 */
  bind(): () => void {
    const offMenu = this.api.onMenuAction((payload) => {
      void this.handleMenuAction(payload.action)
    })
    const offFlush = this.api.onEditorFlush((payload) => {
      void this.handleEditorFlush(payload)
    })
    this.unsubscribers = [offMenu, offFlush]
    return () => {
      this.dispose()
    }
  }

  dispose(): void {
    this.bindingGeneration++
    if (this.exportLease) this.api.respondEditorFlush({ requestId: this.exportLease.requestId, failed: true })
    for (const off of this.unsubscribers) {
      off()
    }
    this.unsubscribers = []
    if (this.stageTimer !== null) {
      clearTimeout(this.stageTimer)
      this.stageTimer = null
    }
  }

  /** 更新本地快照并安排 stage。main 仍会独立校验结构与引用。 */
  edit(snapshot: SnapshotDto): void {
    if (this.state.status !== 'open') {
      throw new Error('没有活动项目，不能提交编辑')
    }
    this.editGeneration++
    if (this.exportLease) {
      // Keep full replacement semantics, but publish a separate editing projection so
      // the next reducer reads this result. Frozen snapshot and main sequences stay untouched.
      const queued = structuredClone(snapshot)
      this.exportLease.edits.push(queued)
      this.state = { ...this.state, editingSnapshot: queued, exportEditNotice: `正在提交已保存版本导出；${this.exportLease.edits.length} 次编辑已排队，提交结束或超时后接纳，不会自动保存。` }
      this.emit()
      return
    }
    this.state = {
      ...this.state,
      snapshot,
      localSeq: this.state.localSeq + 1,
      dirty: true,
    }
    this.emit()
    this.scheduleStage()
  }

  /** 立即提交最新编辑；保存/关闭/屏障前必须等待它完成。 */
  async flushStage(): Promise<IpcResult<{ acceptedSeq: number }>> {
    const binding = this.bindingGeneration
    const sessionGeneration = this.sessionGeneration
    if (this.stageTimer !== null) {
      clearTimeout(this.stageTimer)
      this.stageTimer = null
    }
    const sessionId = this.state.sessionId
    if (sessionId === null) {
      return { ok: true, value: { acceptedSeq: 0 } }
    }
    if (this.stageInFlight !== null) {
      await this.stageInFlight
    }
    if (binding !== this.bindingGeneration || sessionGeneration !== this.sessionGeneration) {
      return { ok: false, error: { code: 'STALE_SESSION', message: '等待 stage 期间会话已变更' } }
    }
    while (this.state.localSeq > this.state.acceptedSeq && this.state.snapshot !== null) {
      const seq = this.state.localSeq
      const snapshot = this.state.snapshot
      const inFlight = this.api.stageDraft({ sessionId, editSeq: seq, snapshot })
      this.stageInFlight = inFlight
      try {
        const staged = await inFlight
        if (binding !== this.bindingGeneration || sessionGeneration !== this.sessionGeneration || sessionId !== this.state.sessionId) {
          return { ok: false, error: { code: 'STALE_SESSION', message: 'stage 响应所属会话已变更，未应用到当前项目' } }
        }
        this.recoveryGeneration++
        if (!staged.ok) {
          this.state = { ...this.state, lastError: staged.error, dirty: true }
          this.emit()
          return { ok: false, error: staged.error }
        }
        this.state = {
          ...this.state,
          acceptedSeq: staged.value.acceptedSeq,
          recovery: staged.value.recovery,
          recoveryWarning: staged.value.warning,
          lastError: undefined,
          dirty: this.state.localSeq > this.state.savedSeq,
        }
        this.emit()
      } finally {
        this.stageInFlight = null
      }
    }
    return { ok: true, value: { acceptedSeq: this.state.acceptedSeq } }
  }

  async newProject(name: string, template: 'empty' | 'chain-demo'): Promise<IpcResult<ProjectOpenValue>> {
    this.assertNoExportLease()
    const ticket = this.responseTicket(true)
    const result = await this.api.newProject({ name, template })
    const stale = this.responseError(ticket, 'open')
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    this.applyOpen(result)
    return result
  }

  async openProject(recentId?: string): Promise<IpcResult<ProjectOpenValue>> {
    this.assertNoExportLease()
    const ticket = this.responseTicket(true)
    const result = await this.api.openProject(recentId === undefined ? {} : { recentId })
    const stale = this.responseError(ticket, 'open')
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    this.applyOpen(result)
    return result
  }

  /** 迁移成功后接入 main 返回的唯一会话，不另建本地副本。 */
  async importV2(importToken: string, projectId: string): Promise<IpcResult<ProjectOpenValue>> {
    this.assertNoExportLease()
    const ticket = this.responseTicket(true)
    const result = await this.api.commitV2({ importToken, projectId })
    const stale = this.responseError(ticket, 'open')
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    this.applyOpen(result)
    return result
  }

  async restoreRecovery(recoveryId: string): Promise<IpcResult<ProjectOpenValue>> {
    this.assertNoExportLease()
    const ticket = this.responseTicket(true)
    const result = await this.api.restoreRecovery({ recoveryId })
    const stale = this.responseError(ticket, 'open')
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    this.applyOpen(result)
    return result
  }

  /** ⌘S：先 flush 本地编辑，再保存；main 校验 editSeq 与指纹。 */
  async saveProject(): Promise<IpcResult<ProjectSaveValue>> {
    this.assertNoExportLease()
    const intent = this.responseTicket()
    const flushed = await this.flushStage()
    if (!flushed.ok) {
      return flushed
    }
    const obsoleteIntent = this.responseError(intent, 'save')
    if (obsoleteIntent) return { ok: false, error: obsoleteIntent }
    const sessionId = this.state.sessionId
    if (sessionId === null) {
      return { ok: false, error: { code: 'STALE_SESSION', message: '没有活动项目' } }
    }
    const ticket = this.responseTicket(false)
    const result = await this.api.saveProject({
      sessionId,
      editSeq: this.state.acceptedSeq,
      expectedFingerprint: this.state.fingerprint,
    })
    const stale = this.responseError(ticket, 'save')
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    this.applySave(result)
    return result
  }

  /** ⇧⌘S：先 flush，再让 main 取新目标。 */
  async saveProjectAs(): Promise<IpcResult<ProjectSaveValue>> {
    this.assertNoExportLease()
    const intent = this.responseTicket()
    const flushed = await this.flushStage()
    if (!flushed.ok) {
      return flushed
    }
    const obsoleteIntent = this.responseError(intent, 'save')
    if (obsoleteIntent) return { ok: false, error: obsoleteIntent }
    const sessionId = this.state.sessionId
    if (sessionId === null) {
      return { ok: false, error: { code: 'STALE_SESSION', message: '没有活动项目' } }
    }
    const ticket = this.responseTicket(false)
    const result = await this.api.saveProjectAs({
      sessionId,
      editSeq: this.state.acceptedSeq,
    })
    const stale = this.responseError(ticket, 'save')
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    this.applySave(result)
    return result
  }

  /** ⌘Q/⌘W：main 负责 dirty gate 与编辑屏障；这里只发起请求。 */
  async close(): Promise<IpcResult<{ closed: true }>> {
    this.assertNoExportLease()
    return this.api.requestClose()
  }

  async listRecent() {
    return this.api.listRecent()
  }

  async reattachSession() {
    this.assertNoExportLease()
    const ticket = this.responseTicket(true)
    const result = await this.api.reattachSession()
    const stale = this.responseError(ticket, 'reset', result.ok && 'sessionId' in result.value ? result.value.editSeq : undefined)
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    if (result.ok && 'sessionId' in result.value) {
      const value = result.value
      this.resetState({
        ...INITIAL_STATE, status: 'open', sessionId: value.sessionId,
        snapshot: value.snapshot, path: value.path, fingerprint: value.fingerprint,
        localSeq: value.editSeq, acceptedSeq: value.editSeq, savedSeq: value.savedSeq,
        dirty: value.editSeq > value.savedSeq, saveStateKnown: true,
        recovery: value.recovery,
      })
    }
    return result
  }

  async relinkRecent(recentId: string) {
    return this.api.relinkRecent({ recentId })
  }

  async listRecovery() {
    return this.api.listRecovery()
  }

  /** 保存失败保留当前项目，之后仍可另存；取消打开不替换会话。 */
  async applyModelMutation(value: {
    acceptedSeq: number
    snapshot: SnapshotDto
    recovery: RecoveryWriteState | 'none'
    warning?: string
  }): Promise<void> {
    this.assertNoExportLease()
    this.authorityGeneration++
    // model:commit/link 已在 main 内完成原子提交；这里只做权威状态重同步，
    // 不把旧 DTO 回写，也不自行把 pending 关联改成已核对。
    this.state = {
      ...this.state,
      status: 'open',
      snapshot: value.snapshot,
      acceptedSeq: value.acceptedSeq,
      localSeq: Math.max(this.state.localSeq, value.acceptedSeq),
      dirty: value.acceptedSeq > this.state.savedSeq,
      recovery: value.recovery,
      recoveryWarning: value.warning,
      lastError: undefined,
    }
    this.emit()
  }

  /** C：drawing:update-spacer 已由 main 原子提交；与模型一样只重同步权威状态。 */
  async applyDrawingMutation(value: {
    acceptedSeq: number
    snapshot: SnapshotDto
    recovery: RecoveryWriteState | 'none'
    warning?: string
  }): Promise<void> {
    return this.applyModelMutation(value)
  }

  /* ---- D：参数联动 ------------------------------------------------- */

  async stageChange(request: ChangeStageRequest): Promise<IpcResult<ChangeDraftValue>> {
    this.assertNoExportLease()
    return this.api.stageChangeDraft(request)
  }

  async previewChange(request: {
    sessionId: string
    baseToken: string
    draftToken: string
  }): Promise<IpcResult<ChangePreviewValue>> {
    return this.api.previewChange(request)
  }

  /** 确认成功后一次性重同步权威快照；失败保留当前编辑与草稿。 */
  async applyChange(request: ChangeApplyRequest): Promise<IpcResult<ChangeApplyValue>> {
    this.assertNoExportLease()
    const ticket = this.responseTicket(false)
    const result = await this.api.applyChange(request)
    const stale = this.responseError(ticket, 'mutation', result.ok ? result.value.acceptedSeq : undefined)
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    if (result.ok) {
      this.state = {
        ...this.state,
        status: 'open',
        snapshot: result.value.snapshot,
        path: result.value.path,
        fingerprint: result.value.fingerprint,
        acceptedSeq: result.value.acceptedSeq,
        localSeq: Math.max(this.state.localSeq, result.value.acceptedSeq),
        savedSeq: result.value.savedSeq,
        saveStateKnown: true,
        dirty: result.value.acceptedSeq > result.value.savedSeq,
        recovery: 'none',
        warnings: result.value.warnings,
        lastError: undefined,
      }
      this.emit()
    } else {
      this.state = { ...this.state, lastError: result.error }
      this.emit()
    }
    return result
  }

  async bindParameter(request: ChangeBindRequest): Promise<IpcResult<ChangeDraftValue>> {
    this.assertNoExportLease()
    return this.api.bindParameter(request)
  }

  async unbindParameter(request: ChangeUnbindRequest): Promise<IpcResult<ChangeDraftValue>> {
    this.assertNoExportLease()
    return this.api.unbindParameter(request)
  }

  async compareDrawings(
    request: ChangeCompareRequest,
  ): Promise<IpcResult<ChangeCompareValueResponse>> {
    return this.api.compareDrawings(request)
  }

  async restoreRevisionDraft(
    request: ChangeRestoreRequest,
  ): Promise<IpcResult<ChangeRestoreValue>> {
    this.assertNoExportLease()
    return this.api.restoreRevisionDraft(request)
  }

  /* ---- V3.5：桌面 PDF 与条款 --------------------------------------- */

  async importSource(request: SourceImportRequest): Promise<IpcResult<SourceImportValue>> {
    this.assertNoExportLease()
    const ticket = this.responseTicket(false)
    const result = await this.api.importSource(request)
    const stale = this.responseError(ticket, 'mutation', result.ok ? result.value.acceptedSeq : undefined)
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    if (result.ok) {
      this.state = {
        ...this.state,
        status: 'open',
        snapshot: result.value.snapshot,
        acceptedSeq: result.value.acceptedSeq,
        localSeq: Math.max(this.state.localSeq, result.value.acceptedSeq),
        dirty: result.value.acceptedSeq > this.state.savedSeq,
        recovery: result.value.recovery,
        lastError: undefined,
      }
      this.emit()
    } else {
      this.state = { ...this.state, lastError: result.error }
      this.emit()
    }
    return result
  }

  /* ---- 手绘草图入口：图片导入与图上框选读数 ------------------------- */

  async importSketchImage(request: {
    sessionId: string
    baseEditSeq: number
  }): Promise<IpcResult<SketchImageImportValue>> {
    this.assertNoExportLease()
    const ticket = this.responseTicket(false)
    const result = await this.api.importSketchImage(request)
    const stale = this.responseError(ticket, 'mutation', result.ok ? result.value.acceptedSeq : undefined)
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    if (result.ok) {
      this.state = {
        ...this.state,
        status: 'open',
        snapshot: result.value.snapshot,
        acceptedSeq: result.value.acceptedSeq,
        localSeq: Math.max(this.state.localSeq, result.value.acceptedSeq),
        dirty: result.value.acceptedSeq > this.state.savedSeq,
        recovery: result.value.recovery,
        lastError: undefined,
      }
      this.emit()
    } else {
      this.state = { ...this.state, lastError: result.error }
      this.emit()
    }
    return result
  }

  async ingestSketchReadings(
    request: SketchIngestRequest,
  ): Promise<IpcResult<SketchIngestValue>> {
    this.assertNoExportLease()
    const ticket = this.responseTicket(false)
    const result = await this.api.ingestSketchReadings(request)
    const stale = this.responseError(ticket, 'mutation', result.ok ? result.value.acceptedSeq : undefined)
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    if (result.ok) {
      this.state = {
        ...this.state,
        snapshot: result.value.snapshot,
        acceptedSeq: result.value.acceptedSeq,
        localSeq: Math.max(this.state.localSeq, result.value.acceptedSeq),
        dirty: result.value.acceptedSeq > this.state.savedSeq,
        recovery: result.value.recovery,
        lastError: undefined,
      }
      this.emit()
    } else {
      this.state = { ...this.state, lastError: result.error }
      this.emit()
    }
    return result
  }

  async stageRequirementEdit(
    request: RequirementEditRequest,
  ): Promise<IpcResult<RequirementEditValue>> {
    this.assertNoExportLease()
    return this.api.stageRequirementEdit(request)
  }

  /* ---- V3.6：任务书 PDF 提取 ----------------------------------------- */

  /** 提取只更新会话快照里的隔离草稿；不自动保存项目文件。 */
  async runExtraction(request: ExtractionRunRequest): Promise<IpcResult<ExtractionRunValue>> {
    this.assertNoExportLease()
    const ticket = this.responseTicket(false)
    const result = await this.api.runExtraction(request)
    const stale = this.responseError(ticket, 'mutation', result.ok ? result.value.acceptedSeq : undefined)
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    if (result.ok) {
      this.state = {
        ...this.state,
        status: 'open',
        snapshot: result.value.snapshot,
        acceptedSeq: result.value.acceptedSeq,
        localSeq: Math.max(this.state.localSeq, result.value.acceptedSeq),
        dirty: result.value.acceptedSeq > this.state.savedSeq,
        recovery: result.value.recovery,
        lastError: undefined,
      }
      this.emit()
    } else {
      this.state = { ...this.state, lastError: result.error }
      this.emit()
    }
    return result
  }

  /** 逐条确认/拒绝/编辑：main 校验候选代数、出处与状态后才推进快照。 */
  async decideExtraction(
    request: ExtractionDecideRequest,
  ): Promise<IpcResult<ExtractionDecideValue>> {
    this.assertNoExportLease()
    const ticket = this.responseTicket(false)
    const result = await this.api.decideExtraction(request)
    const stale = this.responseError(ticket, 'mutation', result.ok ? result.value.acceptedSeq : undefined)
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    if (result.ok) {
      this.state = {
        ...this.state,
        status: 'open',
        snapshot: result.value.snapshot,
        acceptedSeq: result.value.acceptedSeq,
        localSeq: Math.max(this.state.localSeq, result.value.acceptedSeq),
        dirty: result.value.acceptedSeq > this.state.savedSeq,
        recovery: result.value.recovery,
        lastError: undefined,
      }
      this.emit()
    } else {
      this.state = { ...this.state, lastError: result.error }
      this.emit()
    }
    return result
  }

  /** 取消进行中的提取；不改变会话快照。 */
  async cancelExtraction(
    request: ExtractionCancelRequest,
  ): Promise<IpcResult<ExtractionCancelValue>> {
    return this.api.cancelExtraction(request)
  }

  /** 删除被取代的旧规则版本草稿：main 原子校验并切快照，失败零写入。 */
  async deleteExtractionDraft(
    request: ExtractionDeleteDraftRequest,
  ): Promise<IpcResult<ExtractionDeleteDraftValue>> {
    this.assertNoExportLease()
    const ticket = this.responseTicket(false)
    const result = await this.api.deleteExtractionDraft(request)
    const stale = this.responseError(ticket, 'mutation', result.ok ? result.value.acceptedSeq : undefined)
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    if (result.ok) {
      this.state = {
        ...this.state,
        status: 'open',
        snapshot: result.value.snapshot,
        acceptedSeq: result.value.acceptedSeq,
        localSeq: Math.max(this.state.localSeq, result.value.acceptedSeq),
        dirty: result.value.acceptedSeq > this.state.savedSeq,
        recovery: result.value.recovery,
        lastError: undefined,
      }
      this.emit()
    } else {
      this.state = { ...this.state, lastError: result.error }
      this.emit()
    }
    return result
  }

  /**
   * L2 批量动作的公共收尾：成功时重同步权威快照；失败时只记录错误（快照不动）。
   * “整批拒绝 = 0 写入”由 main 保证，这里不自行改快照。
   */
  private applyBatchResult<T extends { snapshot: SnapshotDto; acceptedSeq: number; recovery: RecoveryWriteState | 'none' }>(
    result: IpcResult<T>,
  ): IpcResult<T> {
    if (result.ok) {
      this.state = {
        ...this.state,
        status: 'open',
        snapshot: result.value.snapshot,
        acceptedSeq: result.value.acceptedSeq,
        localSeq: Math.max(this.state.localSeq, result.value.acceptedSeq),
        dirty: result.value.acceptedSeq > this.state.savedSeq,
        recovery: result.value.recovery,
        lastError: undefined,
      }
      this.emit()
    } else {
      this.state = { ...this.state, lastError: result.error }
      this.emit()
    }
    return result
  }

  /** L2：同组批量确认（互斥组整批拒绝）。 */
  async confirmExtractionBatch(
    request: ExtractionConfirmBatchRequest,
  ): Promise<IpcResult<ExtractionBatchValue>> {
    this.assertNoExportLease()
    const api = this.api
    if (api.confirmExtractionBatch === undefined) {
      return { ok: false, error: { code: 'UNSUPPORTED_VERSION', message: '当前 preload 未提供批量确认' } }
    }
    const ticket = this.responseTicket()
    const result = await api.confirmExtractionBatch(request)
    const stale = this.responseError(ticket, 'mutation', result.ok ? result.value.acceptedSeq : undefined)
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    return this.applyBatchResult(result)
  }

  /** L2：批量补单位（只对“仅差单位”）。 */
  async attestExtractionUnits(
    request: ExtractionAttestUnitsRequest,
  ): Promise<IpcResult<ExtractionAttestUnitsValue>> {
    this.assertNoExportLease()
    const api = this.api
    if (api.attestExtractionUnits === undefined) {
      return { ok: false, error: { code: 'UNSUPPORTED_VERSION', message: '当前 preload 未提供批量补单位' } }
    }
    const ticket = this.responseTicket()
    const result = await api.attestExtractionUnits(request)
    const stale = this.responseError(ticket, 'mutation', result.ok ? result.value.acceptedSeq : undefined)
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    return this.applyBatchResult(result)
  }

  /** L2：撤销补单位（整批或逐条）。 */
  async revokeExtractionUnits(
    request: ExtractionRevokeUnitsRequest,
  ): Promise<IpcResult<ExtractionBatchValue>> {
    this.assertNoExportLease()
    const api = this.api
    if (api.revokeExtractionUnits === undefined) {
      return { ok: false, error: { code: 'UNSUPPORTED_VERSION', message: '当前 preload 未提供撤销补单位' } }
    }
    const ticket = this.responseTicket()
    const result = await api.revokeExtractionUnits(request)
    const stale = this.responseError(ticket, 'mutation', result.ok ? result.value.acceptedSeq : undefined)
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    return this.applyBatchResult(result)
  }

  /** 条款确认已由 main 原子写盘；成功只重同步权威快照与保存状态。 */
  async confirmRequirement(
    request: RequirementConfirmRequest,
  ): Promise<IpcResult<RequirementConfirmValue>> {
    this.assertNoExportLease()
    const ticket = this.responseTicket(false)
    const result = await this.api.confirmRequirement(request)
    const stale = this.responseError(ticket, 'mutation', result.ok ? result.value.acceptedSeq : undefined)
    if (stale) return { ok: false as const, error: stale }
    if (result.ok) this.authorityGeneration++
    if (result.ok) {
      this.state = {
        ...this.state,
        status: 'open',
        snapshot: result.value.snapshot,
        path: result.value.path,
        fingerprint: result.value.fingerprint,
        acceptedSeq: result.value.acceptedSeq,
        localSeq: Math.max(this.state.localSeq, result.value.acceptedSeq),
        savedSeq: result.value.savedSeq,
        saveStateKnown: true,
        dirty: false,
        recovery: 'none',
        warnings: result.value.warnings,
        lastError: undefined,
      }
      this.emit()
    } else {
      this.state = { ...this.state, lastError: result.error }
      this.emit()
    }
    return result
  }

  private scheduleStage(): void {
    if (this.stageTimer !== null) {
      clearTimeout(this.stageTimer)
    }
    this.stageTimer = setTimeout(() => {
      this.stageTimer = null
      void this.flushStage()
    }, this.stageDelayMs)
    this.stageTimer.unref?.()
  }

  private releaseExportLease(requestId: string, sessionId: string): void {
    const lease = this.exportLease
    if (!lease || lease.requestId !== requestId || lease.sessionId !== sessionId) return
    clearTimeout(lease.timer)
    this.exportLease = null
    this.state = { ...this.state, editingSnapshot: undefined, exportEditNotice: undefined }
    // 只回放原会话；切换由 main 的 dirty gate 负责，不能把旧编辑写进新项目。
    if (this.state.sessionId === sessionId) for (const snapshot of lease.edits) this.edit(snapshot)
    this.emit()
  }

  /** UI 和测试必须使用同一个协议入口，不得另写一个瞬时 flush listener。 */
  async handleEditorFlush(payload: EditorFlushRequest): Promise<void> {
    const { requestId, exportLease } = payload
    if (exportLease?.action === 'release') {
      this.releaseExportLease(requestId, exportLease.sessionId)
      return
    }
    if (this.exportLease) {
      this.api.respondEditorFlush({ requestId, failed: true })
      return
    }
    if (exportLease) {
      if (this.state.sessionId !== exportLease.sessionId || exportLease.durationMs <= 0 || exportLease.durationMs > 30_000) {
        this.api.respondEditorFlush({ requestId, failed: true })
        return
      }
      // 同步安装，随后才 await flush；main 的截止时间早于本地计时开始。
      const deadline = performance.now() + exportLease.durationMs
      const expire = (): void => {
        if (this.exportLease?.requestId !== requestId) return
        // 定时器可能按毫秒取整提前触发；本地单调时钟也到期后才可单方面接纳编辑。
        const remaining = deadline - performance.now()
        if (remaining > 0) {
          this.exportLease.timer = setTimeout(expire, Math.ceil(remaining))
          this.exportLease.timer.unref?.()
        } else this.releaseExportLease(requestId, exportLease.sessionId)
      }
      const timer = setTimeout(expire, exportLease.durationMs)
      timer.unref?.()
      this.exportLease = { requestId, sessionId: exportLease.sessionId, timer, edits: [] }
      this.state = { ...this.state, exportEditNotice: '正在提交已保存版本导出；新编辑将短暂排队，结束或超时后接纳，不会自动保存。' }
      this.emit()
    }
    const sessionId = this.state.sessionId
    const generation = this.bindingGeneration
    try {
      const flushed = await this.flushStage()
      if (!flushed.ok || generation !== this.bindingGeneration || this.state.sessionId !== sessionId || this.state.localSeq !== this.state.acceptedSeq) {
        this.api.respondEditorFlush({ requestId, failed: true })
        return
      }
      if (exportLease && this.exportLease?.requestId !== requestId) {
        this.api.respondEditorFlush({ requestId, failed: true })
        return
      }
      this.api.respondEditorFlush(sessionId === null ? { requestId } : { requestId, sessionId, editSeq: flushed.value.acceptedSeq, ...(exportLease ? { exportLeaseHeld: true as const } : {}) })
    } catch {
      this.api.respondEditorFlush({ requestId, failed: true })
    }
  }

  private async handleMenuAction(action: MenuAction): Promise<void> {
    switch (action) {
      case 'new': {
        if (this.handlers.newProject !== undefined) {
          const ticket = this.responseTicket(true)
          const value = await this.handlers.newProject()
          if (this.responseError(ticket, 'open')) break
          if (value !== null) {
            this.authorityGeneration++
            this.attachOpen(value)
          }
        }
        break
      }
      case 'open':
        await this.openProject()
        break
      case 'save':
        await this.saveProject()
        break
      case 'saveAs':
        await this.saveProjectAs()
        break
      case 'importV2':
        await this.handlers.importV2?.()
        break
      case 'close':
        await this.close()
        break
    }
    this.handlers.onMenuAction?.(action)
  }

  private applyOpen(result: IpcResult<ProjectOpenValue>): void {
    if (!result.ok) {
      this.state = { ...this.state, lastError: result.error }
      this.emit()
      return
    }
    this.attachOpen(result.value)
  }

  private attachOpen(value: ProjectOpenValue): void {
    this.resetState({
      status: 'open',
      sessionId: value.sessionId,
      path: value.path,
      fingerprint: value.fingerprint,
      localSeq: 0,
      acceptedSeq: 0,
      savedSeq: 0,
      dirty: false,
      recovery: 'none',
      snapshot: value.snapshot,
      warnings: value.warnings,
    })
  }

  private applySave(result: IpcResult<ProjectSaveValue>): void {
    if (!result.ok) {
      this.state = { ...this.state, lastError: result.error, dirty: true }
      this.emit()
      return
    }
    this.state = {
      ...this.state,
      path: result.value.path,
      fingerprint: result.value.fingerprint,
      savedSeq: result.value.savedSeq,
      saveStateKnown: true,
      dirty: this.state.localSeq > result.value.savedSeq,
      warnings: result.value.warnings,
      lastError: undefined,
    }
    this.emit()
  }

  private resetState(state: DesktopSessionState): void {
    // 包括租约建立前已经发出的异步 open/reattach 回执：不能清掉排队编辑。
    this.assertNoExportLease()
    this.authorityGeneration++
    this.sessionGeneration++
    if (this.stageTimer !== null) { clearTimeout(this.stageTimer); this.stageTimer = null }
    this.state = state
    this.emit()
  }

  private emit(): void {
    this.onStateChange?.(this.state)
  }
}
