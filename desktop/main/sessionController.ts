/**
 * 桌面项目会话与 dirty gate（A-04，任务卡 §3 / §4.2）。
 *
 * 核心规则：
 * 1. dirty 完全由 main 判定：`acceptedSeq > savedSeq`，renderer 没有任何
 *    参数能把它设成 false；stage 契约里也不存在 dirty 字段。
 * 2. 所有打开/新建/迁移/恢复/关闭动作先跑编辑屏障，再按“保存/不保存/取消”
 *    三选处理；选保存必须等真实磁盘提交成功，失败或取消都停止切换。
 * 3. 保存期间如果有更高 editSeq 被接受，不能把旧序号当已保存：重新询问，
 *    直到确认没有更新编辑，或用户取消。
 * 4. 切换成功后旧会话关闭、草稿清理；新会话 editSeq 从 0 开始（由
 *    ProjectService.openBytes/new 返回的对象保证）。
 *
 * 本模块不导入 Electron：对话框、编辑屏障、最近项目/草稿存储都通过注入
 * 端口提供，测试可以直接驱动三选与故障路径。
 */
import type { IpcErrorPayload, IpcResult, ProjectOpenValue } from '../shared/contracts'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import { toSnapshotDto } from '../../src/project-file/codec'
import type { ProjectService, ProjectSession } from './projectService'
import type { RecoveryStore } from './recovery'
import type { RecentProjectsStore } from './recentProjects'
import type { ExportEditLease } from './closeGuard'

export type SwitchPurpose = 'new' | 'open' | 'migrate' | 'restore' | 'close' | 'quit'
export type GateChoice = 'save' | 'discard' | 'cancel'
export type GateDecision = 'none' | 'saved' | 'discarded'

export interface GatePrompt {
  projectName: string
  path: string | null
  purpose: SwitchPurpose
}

export interface SessionPorts {
  onSessionBindingChanged?: (windowId: number) => Promise<void>
  /** 主进程三选对话框。 */
  askChoice: (prompt: GatePrompt) => Promise<GateChoice>
  /** 另存对话框；取消返回 null。 */
  pickSaveTarget: (suggestedName: string) => Promise<string | null>
  /** 编辑屏障（editor:flush → editor:flushed）；超时或失败都不能继续。 */
  flushEditor: (windowId: number) => Promise<IpcResult<null>>
  acquireExportLease?: (windowId: number) => Promise<IpcResult<ExportEditLease>>
  log?: (entry: { code: string; detail?: string }) => void
}

export interface SessionControllerOptions {
  projectService: ProjectService
  recovery: RecoveryStore
  recent: RecentProjectsStore
  ports: SessionPorts
}

export interface GateOutcome {
  ok: true
  decision: GateDecision
}

export type SaveOutcome =
  | {
      ok: true
      value: { path: string; fingerprint: string; savedSeq: number; warnings: string[] }
    }
  | { ok: false; error: IpcErrorPayload }

/** 最多重新询问次数；防止编辑流无限打断保存。 */
const MAX_GATE_ROUNDS = 3

function failure(code: IpcErrorPayload['code'], message: string, detail?: string): IpcResult<never> {
  return detail === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, detail } }
}

export class SessionController {
  private readonly projectService: ProjectService
  private readonly recovery: RecoveryStore
  private readonly recent: RecentProjectsStore
  private readonly ports: SessionPorts
  private readonly active = new Map<number, string>()
  /** 同一窗口同时只允许一个 gate 流程（防 ⌘O 连按、关闭与打开并发）。 */
  private readonly gateLocks = new Set<number>()

  constructor(options: SessionControllerOptions) {
    this.projectService = options.projectService
    this.recovery = options.recovery
    this.recent = options.recent
    this.ports = options.ports
  }

  sessionIdFor(windowId: number): string | null {
    return this.active.get(windowId) ?? null
  }

  sessionFor(windowId: number): ProjectSession | null {
    const sessionId = this.active.get(windowId)
    return sessionId === undefined ? null : this.projectService.getSession(sessionId)
  }

  /** 只提交 renderer 待发送编辑，不保存、不询问；必须在会话事务锁之外等待。 */
  async flushPendingEdits(windowId: number): Promise<IpcResult<null>> {
    const session = this.sessionFor(windowId)
    if (session === null) return failure('STALE_SESSION', '没有活动项目')
    if (typeof this.ports.flushEditor !== 'function') return failure('SAVE_FAILED', '编辑屏障端口未装配，请先保存后重试')
    try {
      const result = await this.ports.flushEditor(windowId)
      if (!result.ok) return result
      return this.sessionFor(windowId) === session
        ? result : failure('STALE_SESSION', '编辑屏障期间会话已切换')
    } catch {
      return failure('SAVE_FAILED', '编辑屏障失联，请先保存后重试')
    }
  }

  async acquireExportLease(windowId: number): Promise<IpcResult<ExportEditLease>> {
    if (!this.ports.acquireExportLease) return failure('SAVE_FAILED', '持续编辑租约端口未装配，请先保存后重试')
    const session = this.sessionFor(windowId)
    const exclusive = () => session !== null && this.sessionFor(windowId) === session
      && ![...this.active].some(([id, sessionId]) => id !== windowId && sessionId === session.sessionId)
    if (!exclusive()) return failure('BUSY', '会话由多个窗口共享，无法独占导出编辑边界')
    try {
      const acquired = await this.ports.acquireExportLease(windowId)
      if (!acquired.ok) return acquired
      const lease = acquired.value
      return { ok: true, value: { requestId: lease.requestId, valid: () => exclusive() && lease.valid(), release: () => lease.release() } }
    }
    catch { return failure('SAVE_FAILED', '持续编辑租约失联，请先保存后重试') }
  }

  /** dirty 的唯一判定：已接受但未成功落盘的编辑。 */
  isDirty(session: ProjectSession): boolean {
    return session.acceptedSeq > session.savedSeq || this.projectService.hasPendingStage(session.sessionId)
  }

  /**
   * dirty gate。调用方拿到 ok 后才允许切换/关闭；任何失败都保持当前会话。
   */
  async gate(windowId: number, purpose: SwitchPurpose): Promise<IpcResult<GateDecision>> {
    const barrier = await this.ports.flushEditor(windowId)
    if (!barrier.ok) {
      return failure(barrier.error.code, barrier.error.message, barrier.error.detail)
    }

    // 切换/关闭前先尽力把已接受编辑写成恢复草稿。写失败只记录，
    // 不能因此谎称已持久化；真正的保存/放弃仍由下面的三选决定。
    const initial = this.sessionFor(windowId)
    if (initial !== null) {
      const flushed = await this.recovery.flush(initial.sessionId)
      if (flushed.state === 'failed') {
        this.ports.log?.({
          code: 'RECOVERY_FLUSH_FAILED',
          detail: flushed.warning ?? '恢复草稿写入失败',
        })
      }
    }

    for (let round = 0; round < MAX_GATE_ROUNDS; round += 1) {
      const session = this.sessionFor(windowId)
      if (session === null || !this.isDirty(session)) {
        return { ok: true, value: 'none' }
      }
      const prompt: GatePrompt = {
        projectName: session.snapshot.project.name,
        path: session.path,
        purpose,
      }
      const choice = await this.ports.askChoice(prompt)
      if (choice === 'cancel') {
        return failure('CANCELLED', '已取消，当前项目保持不变')
      }
      if (choice === 'discard') {
        return { ok: true, value: 'discarded' }
      }

      // 选保存：等待真实磁盘提交；失败不切换。
      const saved = await this.saveSession(session)
      if (!saved.ok) {
        return saved
      }
      if (this.isDirty(session)) {
        // 保存期间产生了更高 editSeq：旧序号不能冒充已保存，重新询问。
        this.ports.log?.({
          code: 'SAVE_RACE',
          detail: `acceptedSeq=${session.acceptedSeq}, savedSeq=${session.savedSeq}`,
        })
        continue
      }
      return { ok: true, value: 'saved' }
    }

    return failure('BUSY', '保存期间编辑持续变化，请先停止输入后重试')
  }

  /**
   * 带防重入的 gate：同一窗口已有 gate 在跑时直接 BUSY，不弹第二个对话框。
   * action 只在 gate 放行后执行；action 自身失败不会清理旧会话。
   */
  async withGate<T>(
    windowId: number,
    purpose: SwitchPurpose,
    action: (decision: GateDecision) => Promise<IpcResult<T>>,
  ): Promise<IpcResult<T>> {
    if (this.gateLocks.has(windowId)) {
      return failure('BUSY', '已有未完成的切换/关闭流程，请稍候')
    }
    this.gateLocks.add(windowId)
    try {
      const gated = await this.gate(windowId, purpose)
      if (!gated.ok) {
        return gated
      }
      return await action(gated.value)
    } finally {
      this.gateLocks.delete(windowId)
    }
  }

  /**
   * 保存当前会话到正式文件。
   * - 有授权路径：直接原子保存；
   * - 无路径：main 对话框取目标，目标已存在时带上其指纹做覆盖确认。
   */
  async saveSession(session: ProjectSession): Promise<SaveOutcome> {
    const editSeq = session.acceptedSeq
    if (session.path === null) {
      const target = await this.ports.pickSaveTarget(suggestedName(session.snapshot.project.name))
      if (target === null) {
        return { ok: false, error: { code: 'CANCELLED', message: '已取消选择保存位置，当前项目保持不变' } }
      }
      const existing = await this.projectService.fingerprint(target)
      const saved = await this.projectService.saveAs(session.sessionId, {
        editSeq,
        expectedFingerprint: null,
        targetPath: target,
        overwriteFingerprint: existing,
      })
      if (!saved.ok) {
        return saved
      }
      await this.afterSave(session, saved.value.path, saved.value.fingerprint)
      return { ok: true, value: saved.value }
    }

    const saved = await this.projectService.save(session.sessionId, {
      editSeq,
      expectedFingerprint: session.fingerprint,
    })
    if (!saved.ok) {
      return saved
    }
    await this.afterSave(session, saved.value.path, saved.value.fingerprint)
    return { ok: true, value: saved.value }
  }

  /** 供 IPC save/save-as 在直接调用 ProjectService 后维护索引与草稿。 */
  async noteSaveCommitted(
    session: ProjectSession,
    path: string,
    fingerprint: string,
  ): Promise<void> {
    await this.afterSave(session, path, fingerprint)
  }

  /** 保存成功后的索引/草稿维护：失败只警告，不否认正式保存。 */
  private async afterSave(
    session: ProjectSession,
    targetPath: string,
    fingerprint: string,
  ): Promise<void> {
    const recorded = await this.recent.record({
      projectId: session.snapshot.project.id,
      name: session.snapshot.project.name,
      path: targetPath,
      fingerprint,
      sourceKind: session.snapshot.project.sourceKind,
    })
    if (!recorded.ok) {
      this.ports.log?.({
        code: recorded.error.code,
        detail: '正式文件已保存，但最近项目索引更新失败',
      })
    }
    await this.recovery.discardSaved(session.sessionId, session.savedSeq, () => !this.isDirty(session))
  }

  /**
   * 切换/新建完成后登记活动会话：关闭上一会话、清理它的草稿。
   * 必须在 gate 成功且新会话已建立之后调用。
   */
  async attach(windowId: number, sessionId: string): Promise<void> {
    const previous = this.active.get(windowId)
    if (previous !== sessionId) await this.ports.onSessionBindingChanged?.(windowId)
    if (previous !== undefined && previous !== sessionId) {
      // 先完成旧草稿清理，再登记新会话：避免恢复草稿时“清理”晚到把新草稿删掉。
      await this.recovery.discard(previous)
      await this.projectService.closeSession(previous)
    }
    this.active.set(windowId, sessionId)
  }

  /** 关闭项目/窗口：gate 通过后清理活动会话与草稿。 */
  async detach(windowId: number): Promise<void> {
    await this.ports.onSessionBindingChanged?.(windowId)
    const sessionId = this.active.get(windowId)
    if (sessionId === undefined) {
      return
    }
    this.active.delete(windowId)
    await this.recovery.discard(sessionId)
    await this.projectService.closeSession(sessionId)
  }

  /** 把开放会话包装为 IPC 返回 DTO；不包含附件字节。 */
  toOpenValue(session: ProjectSession, warnings: string[] = []): ProjectOpenValue {
    return {
      sessionId: session.sessionId,
      editSeq: 0,
      snapshot: toSnapshotDto(session.snapshot),
      path: session.path,
      fingerprint: session.fingerprint,
      warnings,
    }
  }

  /**
   * 恢复草稿与当前磁盘基准比较：基准路径存在且指纹变化时明确标注冲突。
   * 只做提示，不覆盖任何正式文件。
   */
  async recoveryConflicts(entry: {
    basePath: string | null
    baseFingerprint: string | null
  }): Promise<string[]> {
    if (entry.basePath === null || entry.baseFingerprint === null) {
      return []
    }
    const current = await this.projectService.fingerprint(entry.basePath)
    if (current === null) {
      return [`基准项目文件已不存在：${entry.basePath}`]
    }
    if (current !== entry.baseFingerprint) {
      return [`基准项目文件在生成草稿后已变化：${entry.basePath}（恢复为未保存副本，不覆盖原文件）`]
    }
    return []
  }

  /** stage 用的恢复元数据；草稿以当前会话的正式路径为基准。 */
  recoveryMeta(session: ProjectSession, snapshot: ProjectFileSnapshot) {
    return {
      projectId: snapshot.project.id,
      name: snapshot.project.name,
      basePath: session.path,
      baseFingerprint: session.fingerprint,
    }
  }
}

/**
 * 关闭/退出共用的唯一流程：dirty gate（含编辑屏障）→ 关闭活动会话。
 * ⌘Q、红点、requestClose 都必须走这里，保证三选与失败语义一致。
 */
export async function runCloseGate(
  controller: SessionController,
  windowId: number,
  purpose: 'close' | 'quit',
): Promise<IpcResult<null>> {
  return controller.withGate(windowId, purpose, async () => {
    await controller.detach(windowId)
    return { ok: true as const, value: null }
  })
}

function suggestedName(projectName: string): string {
  const cleaned = [...projectName]
    .map((character) =>
      character.charCodeAt(0) < 32 || '/\\:*?"<>|'.includes(character) ? '_' : character,
    )
    .join('')
    .trim()
  const base = cleaned === '' ? '未命名项目' : cleaned.slice(0, 120)
  return base.endsWith('.cunlian') ? base : `${base}.cunlian`
}
