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
  ProjectRevealValue,
  ProjectSaveValue,
  ProjectStageValue,
  RecentProjectListValue,
  RecentProjectItem,
  RecoveryListValue,
  SessionReattachValue,
  SourceReadValue,
} from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'
import type { SenderGuard } from './senderGuard'
import { decodeProjectFile, toSnapshotDto } from '../../src/project-file/codec'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import { sha256Hex } from '../../src/sources/hash'
import { DEFAULT_SOURCE_LIMITS, formatMiB } from '../../src/sources/limits'
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
  sourceRead: z
    .object({
      sessionId: z.string().min(1).max(200),
      // revisionId 只是内存聚合里的键，不允许任何路径形态；含分隔符/空字节
      // 或路径段的输入直接按坏参数拒绝，不会触到文件系统。
      revisionId: z
        .string()
        .min(1)
        .max(240)
        .refine(
          (value: string) =>
            !value.includes('/') &&
            !value.includes('\\') &&
            !value.includes('\u0000') &&
            value !== '.' &&
            value !== '..',
          { message: 'revisionId 不能是路径' },
        ),
    })
    .strict(),
  revealProject: z
    .object({ sessionId: z.string().min(1).max(200) })
    .strict(),
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
  /**
   * 在系统文件管理器中显示一个项目文件。
   *
   * 只在 handler 已确认路径来自当前会话、存在且为常规文件后调用；参数不是
   * shell 命令，也不接受 renderer 传入的任意路径。
   */
  revealPath: (targetPath: string) => Promise<void>
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

/**
 * source:read 解析出的版本视图。只保留读字节需要的字段；`origin` 用于区分
 * 当前聚合同历史归档，错误信息不泄露其它项目内容。
 */
interface ResolvedSourceRevision {
  id: string
  fileName: string
  sha256: string
  byteSize: number
  blobKey: string
  origin: 'current' | 'legacy-archive'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null
}

/**
 * 只在会话内存聚合里按 revision ID 查版本：先查当前来源，再查只读历史归档。
 * 不接受 renderer 传入的 blobKey/路径；blobKey 只能由这里从版本记录解析。
 */
function resolveSourceRevision(
  snapshot: ProjectFileSnapshot,
  revisionId: string,
): ResolvedSourceRevision | null {
  const current = snapshot.revisions.find((revision) => revision.id === revisionId)
  if (current !== undefined) {
    return {
      id: current.id,
      fileName: current.fileName,
      sha256: current.sha256,
      byteSize: current.byteSize,
      blobKey: current.blobKey,
      origin: 'current',
    }
  }

  for (const entry of snapshot.legacyArchive?.records ?? []) {
    const wrapper = asRecord(entry)
    if (wrapper === null || wrapper.kind !== 'revision') {
      continue
    }
    const record = asRecord(wrapper.record)
    if (record === null || record.id !== revisionId) {
      continue
    }
    const { fileName, sha256, byteSize, blobKey } = record
    if (
      typeof fileName !== 'string' ||
      typeof sha256 !== 'string' ||
      typeof byteSize !== 'number' ||
      !Number.isSafeInteger(byteSize) ||
      byteSize < 0 ||
      typeof blobKey !== 'string'
    ) {
      // 归档记录不完整时按“附件不可用”处理，不用猜测补齐。
      return null
    }
    return { id: revisionId, fileName, sha256, byteSize, blobKey, origin: 'legacy-archive' }
  }
  return null
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
    sourceKind: session.snapshot.project.sourceKind,
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
            decoded.value.manifest.project.projectSchemaVersion,
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
        let recoveryOutcome: { state: ProjectStageValue['recovery']; warning?: string } = { state: 'failed' }
        const accepted = await projectService.stageFromDto(
          session.sessionId,
          params.editSeq,
          params.snapshot as Omit<ProjectFileSnapshot, 'attachments'>,
          async (current, conflict) => {
            try {
              recoveryOutcome = await recovery.stage(
                current.sessionId, current.snapshot, current.acceptedSeq,
                controller.recoveryMeta(current, current.snapshot),
              )
              if (conflict && recoveryOutcome.state !== 'failed') recoveryOutcome = await recovery.flush(current.sessionId)
            } catch {
              // 编辑已在内存接纳：恢复失败必须明示，不冒充未接纳或已持久化。
              recoveryOutcome = { state: 'failed', warning: '编辑已保留，但恢复草稿写入失败，请立即保存项目' }
            }
          },
        )
        if (!accepted.ok) {
          reject(accepted.error.code, accepted.error.message, [accepted.error.detail, `恢复状态=${recoveryOutcome.state}`, recoveryOutcome.warning].filter(Boolean).join('；'))
        }
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

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.sessionReattach,
      schema: projectSchemas.empty,
      handle: async ({ sender }): Promise<SessionReattachValue> => {
        // 只读重新挂接：不跑 gate、不 flush 草稿、不 attach/adopt。
        // main 内存里没有活动会话时只报告 null，绝不自动新建。
        const session = controller.sessionFor(sender.webContentsId)
        if (session === null) {
          return { session: null }
        }
        return {
          sessionId: session.sessionId,
          editSeq: session.acceptedSeq,
          savedSeq: session.savedSeq,
          snapshot: toSnapshotDto(session.snapshot),
          path: session.path,
          fingerprint: session.fingerprint,
          recovery: recovery.stateOf(session.sessionId),
        }
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.sourceRead,
      schema: projectSchemas.sourceRead,
      handle: async ({ sender }, params): Promise<SourceReadValue> => {
        const windowId = sender.webContentsId
        const session = requireActive(controller, windowId, params.sessionId)
        const revision = resolveSourceRevision(session.snapshot, params.revisionId)
        if (revision === null) {
          reject(
            'ATTACHMENT_MISSING',
            '该来源版本不存在或不属于当前项目及其历史归档',
            `revisionId=${params.revisionId}`,
          )
        }

        // 限额按 main 持有的聚合元数据判定，不信任 renderer 传入的任何大小。
        const limits = DEFAULT_SOURCE_LIMITS
        const projectBytes = session.snapshot.revisions.reduce(
          (total, item) => total + item.byteSize,
          0,
        )
        if (revision.byteSize > limits.maxFileBytes || projectBytes > limits.maxProjectBytes) {
          reject(
            'INVALID_REQUEST',
            `来源附件超过项目限额（单文件 ${formatMiB(
              limits.maxFileBytes,
            )}，项目 ${formatMiB(limits.maxProjectBytes)}）`,
            `revisionBytes=${revision.byteSize}, projectBytes=${projectBytes}`,
          )
        }

        const declaredMissing = session.snapshot.missingAttachments.find(
          (item) => item.revisionId === revision.id && item.blobKey === revision.blobKey,
        )
        const attachment = session.snapshot.attachments.find(
          (item) => item.blobKey === revision.blobKey,
        )
        if (attachment === undefined || !(attachment.bytes instanceof Uint8Array)) {
          reject(
            'ATTACHMENT_MISSING',
            declaredMissing === undefined
              ? revision.origin === 'legacy-archive'
                ? '历史归档只保留版本记录与哈希，不携带附件字节'
                : '当前会话没有该来源版本的附件字节'
              : '该来源版本的附件已声明缺失，未随项目携带',
            `revisionId=${revision.id}, blobKey=${revision.blobKey}`,
          )
        }

        // 复制一份再返回：renderer 修改字节不能影响 main 会话里的原始附件。
        const bytes = new Uint8Array(attachment.bytes)
        if (bytes.byteLength > limits.maxFileBytes) {
          reject(
            'INVALID_REQUEST',
            `附件字节超过单文件限额 ${formatMiB(limits.maxFileBytes)}`,
            `actualBytes=${bytes.byteLength}`,
          )
        }
        const digest = await sha256Hex(bytes)
        if (digest !== revision.sha256) {
          reject(
            'HASH_MISMATCH',
            '附件字节与版本记录的 SHA-256 不一致，已拒绝返回',
            `declared=${revision.sha256}, actual=${digest}`,
          )
        }
        return { bytes, sha256: digest, fileName: revision.fileName }
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.projectReveal,
      schema: projectSchemas.revealProject,
      handle: async ({ sender }, params): Promise<ProjectRevealValue> => {
        const windowId = sender.webContentsId
        const session = requireActive(controller, windowId, params.sessionId)
        // 路径只能来自 main 会话（打开或保存成功后才会有值）；renderer 没有
        // 任何参数能指定目标路径或 shell 参数。
        const targetPath = session.path
        if (targetPath === null) {
          reject('NOT_FOUND', '当前项目尚未保存到磁盘，无法在访达中显示')
        }
        const kind = await projectService.kindOf(targetPath)
        if (kind === 'missing') {
          reject('NOT_FOUND', '项目文件不存在或已移动')
        }
        if (kind !== 'file') {
          reject('NOT_FOUND', '项目路径不是常规文件（不允许符号链接或目录）', kind)
        }
        try {
          await deps.revealPath(targetPath)
        } catch (error) {
          reject(
            'REVEAL_FAILED',
            '无法在访达中显示项目文件',
            error instanceof Error ? error.message : String(error),
          )
        }
        return { shown: true }
      },
    },
    ipcDeps,
  )
}
