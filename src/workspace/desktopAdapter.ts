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
  IpcErrorPayload,
  IpcResult,
  MenuAction,
  ProjectOpenValue,
  ProjectSaveValue,
  ProjectStageValue,
  RecoveryWriteState,
  SnapshotDto,
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
  warnings: string[]
  lastError?: IpcErrorPayload
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

export class DesktopSessionAdapter {
  private readonly api: CunlianApi
  private readonly stageDelayMs: number
  private readonly handlers: DesktopAdapterHandlers
  private readonly onStateChange: ((state: DesktopSessionState) => void) | undefined
  private state: DesktopSessionState = { ...INITIAL_STATE }
  private stageTimer: ReturnType<typeof setTimeout> | null = null
  private stageInFlight: Promise<IpcResult<ProjectStageValue>> | null = null
  private unsubscribers: (() => void)[] = []

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

  /** 订阅菜单与编辑屏障；返回取消订阅函数。 */
  bind(): () => void {
    const offMenu = this.api.onMenuAction((payload) => {
      void this.handleMenuAction(payload.action)
    })
    const offFlush = this.api.onEditorFlush((payload) => {
      void this.handleFlush(payload.requestId)
    })
    this.unsubscribers = [offMenu, offFlush]
    return () => {
      this.dispose()
    }
  }

  dispose(): void {
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
    while (this.state.localSeq > this.state.acceptedSeq && this.state.snapshot !== null) {
      const seq = this.state.localSeq
      const snapshot = this.state.snapshot
      const inFlight = this.api.stageDraft({ sessionId, editSeq: seq, snapshot })
      this.stageInFlight = inFlight
      try {
        const staged = await inFlight
        if (!staged.ok) {
          this.state = { ...this.state, lastError: staged.error, dirty: true }
          this.emit()
          if (staged.error.code === 'STALE_SESSION') {
            this.reset()
          }
          return { ok: false, error: staged.error }
        }
        this.state = {
          ...this.state,
          acceptedSeq: staged.value.acceptedSeq,
          recovery: staged.value.recovery,
          recoveryWarning: staged.value.warning,
          lastError: undefined,
          dirty: staged.value.acceptedSeq > this.state.savedSeq,
        }
        this.emit()
      } finally {
        this.stageInFlight = null
      }
    }
    return { ok: true, value: { acceptedSeq: this.state.acceptedSeq } }
  }

  async newProject(name: string, template: 'empty' | 'chain-demo'): Promise<IpcResult<ProjectOpenValue>> {
    const result = await this.api.newProject({ name, template })
    this.applyOpen(result)
    return result
  }

  async openProject(recentId?: string): Promise<IpcResult<ProjectOpenValue>> {
    const result = await this.api.openProject(recentId === undefined ? {} : { recentId })
    this.applyOpen(result)
    return result
  }

  /** 迁移成功后接入 main 返回的唯一会话，不另建本地副本。 */
  async importV2(importToken: string, projectId: string): Promise<IpcResult<ProjectOpenValue>> {
    const result = await this.api.commitV2({ importToken, projectId })
    this.applyOpen(result)
    return result
  }

  async restoreRecovery(recoveryId: string): Promise<IpcResult<ProjectOpenValue>> {
    const result = await this.api.restoreRecovery({ recoveryId })
    this.applyOpen(result)
    return result
  }

  /** ⌘S：先 flush 本地编辑，再保存；main 校验 editSeq 与指纹。 */
  async saveProject(): Promise<IpcResult<ProjectSaveValue>> {
    const flushed = await this.flushStage()
    if (!flushed.ok) {
      return flushed
    }
    const sessionId = this.state.sessionId
    if (sessionId === null) {
      return { ok: false, error: { code: 'STALE_SESSION', message: '没有活动项目' } }
    }
    const result = await this.api.saveProject({
      sessionId,
      editSeq: this.state.acceptedSeq,
      expectedFingerprint: this.state.fingerprint,
    })
    this.applySave(result)
    return result
  }

  /** ⇧⌘S：先 flush，再让 main 取新目标。 */
  async saveProjectAs(): Promise<IpcResult<ProjectSaveValue>> {
    const flushed = await this.flushStage()
    if (!flushed.ok) {
      return flushed
    }
    const sessionId = this.state.sessionId
    if (sessionId === null) {
      return { ok: false, error: { code: 'STALE_SESSION', message: '没有活动项目' } }
    }
    const result = await this.api.saveProjectAs({
      sessionId,
      editSeq: this.state.acceptedSeq,
    })
    this.applySave(result)
    return result
  }

  /** ⌘Q/⌘W：main 负责 dirty gate 与编辑屏障；这里只发起请求。 */
  async close(): Promise<IpcResult<{ closed: true }>> {
    return this.api.requestClose()
  }

  async listRecent() {
    return this.api.listRecent()
  }

  async reattachSession() {
    const result = await this.api.reattachSession()
    if (result.ok && 'sessionId' in result.value) {
      const value = result.value
      this.resetState({
        ...INITIAL_STATE, status: 'open', sessionId: value.sessionId,
        snapshot: value.snapshot, path: value.path, fingerprint: value.fingerprint,
        localSeq: value.editSeq, acceptedSeq: value.editSeq,
        recovery: value.recovery, saveStateKnown: false,
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

  private async handleFlush(requestId: string): Promise<void> {
    await this.flushStage()
    const sessionId = this.state.sessionId
    this.api.respondEditorFlush(
      sessionId === null
        ? { requestId }
        : { requestId, sessionId, editSeq: this.state.acceptedSeq },
    )
  }

  private async handleMenuAction(action: MenuAction): Promise<void> {
    switch (action) {
      case 'new': {
        if (this.handlers.newProject !== undefined) {
          const value = await this.handlers.newProject()
          if (value !== null) {
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
      dirty: this.state.acceptedSeq > result.value.savedSeq,
      warnings: result.value.warnings,
      lastError: undefined,
    }
    this.emit()
  }

  private reset(): void {
    this.resetState({ ...INITIAL_STATE })
  }

  private resetState(state: DesktopSessionState): void {
    this.state = state
    this.emit()
  }

  private emit(): void {
    this.onStateChange?.(this.state)
  }
}
