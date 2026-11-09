/**
 * A-04 项目会话 IPC 通道（任务卡 §3 白名单里的项目/最近/恢复部分）。
 *
 * 与 index.ts 的分工：这里只依赖注入的端口（对话框、路径选择），不导入
 * Electron；index.ts 负责把真实 dialog/window 端口接进来，并注册窗口关闭
 * 通道。这样三选、并发、恢复与索引行为都能用 fake IPC 在 Node 里测试。
 *
 * 每个通道都经过 installChannel：sender 白名单 → 严格 schema → handler →
 * 统一结果包络。dirty 判定只在 main 内进行，参数里没有 dirty 字段；
 * 额外字段会被 strict schema 拒绝。
 */
import { z } from 'zod'
import type {
  IpcErrorCode,
  ProjectOpenValue,
  ProjectSaveValue,
  ProjectStageValue,
  RecentProjectListValue,
  RecentProjectItem,
  RecoveryListValue,
} from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'
import type { SenderGuard } from './senderGuard'
import { decodeProjectFile } from '../../src/project-file/codec'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import { IpcFailure, installChannel, type IpcDeps, type IpcMainLike } from './ipc'
import { createNewProjectSnapshot } from './newProject'
import type { ProjectService, ProjectSession } from './projectService'
import type { RecentProjectsStore } from './recentProjects'
import type { RecoveryStore } from './recovery'
import type { GateDecision, SessionController } from './sessionController'

/** 单个 stage 快照 DTO 的字节上限；超过直接拒绝，避免主进程被大对象拖死。 */
export const SNAPSHOT_DTO_MAX_BYTES = 32 * 1024 * 1024

export const projectSchemas = {
  newProject: z
    .object({
      name: z.string().min(1).max(200),
      template: z.enum(['empty', 'chain-demo']),
    })
    .strict(),
  openProject: z
    .object({ recentId: z.string().min(1).max(120).optional() })
    .strict(),
  stageDraft: z
    .object({
      sessionId: z.string().min(1).max(200),
      editSeq: z.number().int().nonnegative(),
      snapshot: z.unknown(),
    })
    .strict(),
  saveProject: z
    .object({
      sessionId: z.string().min(1).max(200),
      editSeq: z.number().int().nonnegative(),
      expectedFingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    })
    .strict(),
  saveProjectAs: z
    .object({
      sessionId: z.string().min(1).max(200),
      editSeq: z.number().int().nonnegative(),
    })
    .strict(),
  relinkRecent: z.object({ recentId: z.string().min(1).max(120) }).strict(),
  restoreRecovery: z.object({ recoveryId: z.string().min(1).max(120) }).strict(),
  empty: z.object({}).strict(),
} as const

export interface ProjectChannelDeps {
  guard: SenderGuard
  projectService: ProjectService
  recovery: RecoveryStore
  recent: RecentProjectsStore
  controller: SessionController
  /** 打开项目的主对话框；返回 null 表示取消。Finder open-file 的排队路径也由这里消费。 */
  pickOpenPath: (windowId: number) => Promise<string | null>
  /** relink 的主对话框；只修索引，不打开项目。 */
  pickRelinkPath: (windowId: number) => Promise<string | null>
  /** 另存对话框；取消返回 null。 */
  pickSaveTarget: (session: ProjectSession) => Promise<string | null>
  appVersion: string
  electronVersion: string
  log?: IpcDeps['log']
}

function reject(code: IpcErrorCode, message: string, detail?: string): never {
  throw new IpcFailure(code, message, detail)
}

function requireActive(
  controller: SessionController,
  windowId: number,
  sessionId: string,
): ProjectSession {
  const active = controller.sessionIdFor(windowId)
  if (active === null || active !== sessionId) {
    reject('STALE_SESSION', '会话已失效，请重新打开项目')
  }
  const session = controller.sessionFor(windowId)
  if (session === null) {
    reject('STALE_SESSION', '会话已失效，请重新打开项目')
  }
  return session
}

function snapshotByteLength(snapshot: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/**
 * 读取项目文件前的类型检查：不存在 → NOT_FOUND，目录/链接/其它 → READ_FAILED。
 * 不把“文件没了”报成保存失败，也不跟随符号链接。
 */
async function readProjectOrFail(
  projectService: ProjectService,
  targetPath: string,
): Promise<{ bytes: Uint8Array; fingerprint: string }> {
  const kind = await projectService.kindOf(targetPath)
  if (kind === 'missing') {
    reject('NOT_FOUND', '项目文件不存在或已移动')
  }
  if (kind !== 'file') {
    reject('READ_FAILED', '项目文件不是常规文件（不允许符号链接或目录）', kind)
  }
  const read = await projectService.readProjectBytes(targetPath)
  if (!read.ok) {
    reject(read.error.code, read.error.message, read.error.detail)
  }
  return read.value
}

/** 从 gate 结果里取行动分支；失败统一抛 IpcFailure。 */
async function gated<T>(
  controller: SessionController,
  windowId: number,
  purpose: Parameters<SessionController['gate']>[1],
  action: (decision: GateDecision) => Promise<T>,
): Promise<T> {
  const result = await controller.withGate(windowId, purpose, async (decision) => ({
    ok: true as const,
    value: await action(decision),
  }))
  if (!result.ok) {
    reject(result.error.code, result.error.message, result.error.detail)
  }
  return result.value
}

/** 把最近项目索引写失败降级为 warning：正式文件已经保存/打开，不能反悔。 */
async function recordRecent(
  recent: RecentProjectsStore,
  session: ProjectSession,
  warnings: string[],
): Promise<void> {
  if (session.path === null || session.fingerprint === null) {
    return
  }
  const recorded = await recent.record({
    projectId: session.snapshot.project.id,
    name: session.snapshot.project.name,
    path: session.path,
    fingerprint: session.fingerprint,
  })
  if (!recorded.ok) {
    warnings.push(`最近项目索引更新失败：${recorded.error.message}`)
  }
}

export function registerProjectChannels(ipc: IpcMainLike, deps: ProjectChannelDeps): void {
  const ipcDeps: IpcDeps = { guard: deps.guard, log: deps.log }
  const { projectService, recovery, recent, controller } = deps

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.projectNew,
      schema: projectSchemas.newProject,
      handle: async ({ sender }, params) => {
        const windowId = sender.webContentsId
        return gated(controller, windowId, 'new', async () => {
          const snapshot = createNewProjectSnapshot({
            name: params.name,
            template: params.template,
            appVersion: deps.appVersion,
            electronVersion: deps.electronVersion,
          })
          const opened = projectService.adoptSnapshot(snapshot, null, null)
          if (!opened.ok) {
            reject(opened.error.code, opened.error.message, opened.error.detail)
          }
          await controller.attach(windowId, opened.value.sessionId)
          const session = controller.sessionFor(windowId)
          if (session === null) {
            reject('INTERNAL', '新会话建立后无法读取')
          }
          const value: ProjectOpenValue = controller.toOpenValue(session)
          return value
        })
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.projectOpen,
      schema: projectSchemas.openProject,
      handle: async ({ sender }, params) => {
        const windowId = sender.webContentsId
        let targetPath: string
        if (params.recentId !== undefined) {
          const record = await recent.get(params.recentId)
          if (!record.ok) {
            reject(record.error.code, record.error.message, record.error.detail)
          }
          targetPath = record.value.path
        } else {
          const picked = await deps.pickOpenPath(windowId)
          if (picked === null) {
            reject('CANCELLED', '已取消打开项目')
          }
          targetPath = picked
        }

        // 先完整读取/校验，再跑 dirty gate：格式错误不会先把当前编辑处理掉。
        const read = await readProjectOrFail(projectService, targetPath)
        const decoded = await decodeProjectFile(read.bytes)
        if (!decoded.ok) {
          reject(decoded.error.code, decoded.error.message, decoded.error.detail)
        }

        return gated(controller, windowId, 'open', async () => {
          const opened = projectService.adoptSnapshot(
            decoded.value.snapshot,
            targetPath,
            read.fingerprint,
          )
          if (!opened.ok) {
            reject(opened.error.code, opened.error.message, opened.error.detail)
          }
          await controller.attach(windowId, opened.value.sessionId)
          const session = controller.sessionFor(windowId)
          if (session === null) {
            reject('INTERNAL', '打开后无法读取会话')
          }
          const warnings: string[] = []
          await recordRecent(recent, session, warnings)
          return controller.toOpenValue(session, warnings)
        })
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.projectStage,
      schema: projectSchemas.stageDraft,
      handle: async ({ sender }, params): Promise<ProjectStageValue> => {
        const windowId = sender.webContentsId
        const session = requireActive(controller, windowId, params.sessionId)
        if (snapshotByteLength(params.snapshot) > SNAPSHOT_DTO_MAX_BYTES) {
          reject('TOO_LARGE', '编辑快照超过 32 MiB 上限')
        }
        const accepted = projectService.stageFromDto(
          session.sessionId,
          params.editSeq,
          params.snapshot as Omit<ProjectFileSnapshot, 'attachments'>,
        )
        if (!accepted.ok) {
          reject(accepted.error.code, accepted.error.message, accepted.error.detail)
        }
        const current = projectService.getSession(session.sessionId)
        if (current === null) {
          reject('STALE_SESSION', '会话已失效，请重新打开项目')
        }
        const recoveryOutcome = await recovery.stage(
          session.sessionId,
          current.snapshot,
          params.editSeq,
          controller.recoveryMeta(current, current.snapshot),
        )
        const value: ProjectStageValue = {
          acceptedSeq: accepted.value.acceptedSeq,
          recovery: recoveryOutcome.state,
        }
        if (recoveryOutcome.warning !== undefined) {
          value.warning = recoveryOutcome.warning
        }
        return value
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.projectSave,
      schema: projectSchemas.saveProject,
      handle: async ({ sender }, params): Promise<ProjectSaveValue> => {
        const windowId = sender.webContentsId
        const session = requireActive(controller, windowId, params.sessionId)
        if (session.acceptedSeq !== params.editSeq) {
          reject(
            'STALE_EDIT',
            '保存的编辑序号与已接受序号不一致',
            `acceptedSeq=${session.acceptedSeq}, editSeq=${params.editSeq}`,
          )
        }
        if (session.path === null) {
          // 没有授权路径时必须另存；main 负责对话框。
          const saved = await controller.saveSession(session)
          if (!saved.ok) {
            reject(saved.error.code, saved.error.message, saved.error.detail)
          }
          return {
            path: saved.value.path,
            fingerprint: saved.value.fingerprint,
            savedSeq: saved.value.savedSeq,
            warnings: saved.value.warnings,
          }
        }
        const saved = await projectService.save(session.sessionId, {
          editSeq: params.editSeq,
          expectedFingerprint: params.expectedFingerprint,
        })
        if (!saved.ok) {
          reject(saved.error.code, saved.error.message, saved.error.detail)
        }
        await controller.noteSaveCommitted(session, saved.value.path, saved.value.fingerprint)
        return saved.value
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.projectSaveAs,
      schema: projectSchemas.saveProjectAs,
      handle: async ({ sender }, params): Promise<ProjectSaveValue> => {
        const windowId = sender.webContentsId
        const session = requireActive(controller, windowId, params.sessionId)
        if (session.acceptedSeq !== params.editSeq) {
          reject(
            'STALE_EDIT',
            '保存的编辑序号与已接受序号不一致',
            `acceptedSeq=${session.acceptedSeq}, editSeq=${params.editSeq}`,
          )
        }
        const target = await deps.pickSaveTarget(session)
        if (target === null) {
          reject('CANCELLED', '已取消选择保存位置')
        }
        const existing = await projectService.fingerprint(target)
        const saved = await projectService.saveAs(session.sessionId, {
          editSeq: params.editSeq,
          expectedFingerprint: null,
          targetPath: target,
          overwriteFingerprint: existing,
        })
        if (!saved.ok) {
          reject(saved.error.code, saved.error.message, saved.error.detail)
        }
        await controller.noteSaveCommitted(session, saved.value.path, saved.value.fingerprint)
        return saved.value
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.recentList,
      schema: projectSchemas.empty,
      handle: async (): Promise<RecentProjectListValue> => {
        const listed = await recent.list()
        if (!listed.ok) {
          reject(listed.error.code, listed.error.message, listed.error.detail)
        }
        return listed.value
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.recentRelink,
      schema: projectSchemas.relinkRecent,
      handle: async ({ sender }, params): Promise<{ item: RecentProjectItem }> => {
        const windowId = sender.webContentsId
        const record = await recent.get(params.recentId)
        if (!record.ok) {
          reject(record.error.code, record.error.message, record.error.detail)
        }
        const picked = await deps.pickRelinkPath(windowId)
        if (picked === null) {
          reject('CANCELLED', '已取消重新定位')
        }
        const read = await readProjectOrFail(projectService, picked)
        const decoded = await decodeProjectFile(read.bytes)
        if (!decoded.ok) {
          reject(decoded.error.code, decoded.error.message, decoded.error.detail)
        }
        // 只修索引：项目 ID 必须相符；不打开、不切换、不覆盖任何项目文件。
        const relinked = await recent.relink({
          recentId: params.recentId,
          path: picked,
          projectId: decoded.value.snapshot.project.id,
          fingerprint: read.fingerprint,
        })
        if (!relinked.ok) {
          reject(relinked.error.code, relinked.error.message, relinked.error.detail)
        }
        return relinked.value
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.recoveryList,
      schema: projectSchemas.empty,
      handle: async (): Promise<RecoveryListValue> => {
        const listed = await recovery.list()
        if (!listed.ok) {
          reject(listed.error.code, listed.error.message, listed.error.detail)
        }
        return listed.value
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.recoveryRestore,
      schema: projectSchemas.restoreRecovery,
      handle: async ({ sender }, params): Promise<ProjectOpenValue> => {
        const windowId = sender.webContentsId
        const draft = await recovery.readDraft(params.recoveryId)
        if (!draft.ok) {
          reject(draft.error.code, draft.error.message, draft.error.detail)
        }
        return gated(controller, windowId, 'restore', async () => {
          const conflicts = await controller.recoveryConflicts(draft.value.entry)
          const opened = projectService.adoptSnapshot(draft.value.snapshot, null, null)
          if (!opened.ok) {
            reject(opened.error.code, opened.error.message, opened.error.detail)
          }
          await controller.attach(windowId, opened.value.sessionId)
          const session = controller.sessionFor(windowId)
          if (session === null) {
            reject('INTERNAL', '恢复后无法读取会话')
          }
          // 恢复为未保存副本后立即重新落草稿：即使随后崩溃，副本仍可再恢复。
          const warnings = [
            '已恢复为未保存副本，不会覆盖正式项目文件。',
            ...conflicts,
          ]
          const meta = controller.recoveryMeta(session, session.snapshot)
          await recovery.stage(
            session.sessionId,
            session.snapshot,
            draft.value.entry.editSeq === 0 ? 1 : draft.value.entry.editSeq,
            meta,
          )
          const flushed = await recovery.flush(session.sessionId)
          if (flushed.state === 'failed') {
            warnings.push(flushed.warning ?? '恢复草稿未能重新写入')
          }
          return controller.toOpenValue(session, warnings)
        })
      },
    },
    ipcDeps,
  )
}
