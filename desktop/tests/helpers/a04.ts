/**
 * A-04 测试夹具：真实临时目录 + Fake IPC + 采样项目容器。
 * 不进入产品路径；只复用既有夹具与真实 ProjectService/RecoveryStore。
 */
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type {
  IpcResult,
  ProjectOpenValue,
  ProjectStageValue,
} from '../../shared/contracts'
import { IPC_CHANNELS } from '../../shared/contracts'
import { encodeProjectFile, toSnapshotDto } from '../../../src/project-file/codec'
import { createSampleSnapshot } from '../../../src/project-file/__fixtures__/sampleProjectFile'
import type { ProjectFileSnapshot } from '../../../src/project-file/types'
import { installChannel, type IpcMainLike } from '../../main/ipc'
import { FileStore, nodeFileOps, type FileOps } from '../../main/fileStore'
import { nodeWorkspaceOps, type WorkspaceOps } from '../../main/workspaceJson'
import { ProjectService } from '../../main/projectService'
import { RecentProjectsStore } from '../../main/recentProjects'
import { RecoveryStore } from '../../main/recovery'
import { registerProjectChannels } from '../../main/channels'
import {
  SessionController,
  type GateChoice,
  type GatePrompt,
} from '../../main/sessionController'
import { SenderGuard } from '../../main/senderGuard'

const PROD_URL =
  'file:///Applications/%E5%AF%B8%E9%93%BE.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.desktop.html'

type Handler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => Promise<IpcResult<unknown>>
type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => void

export class FakeIpc implements IpcMainLike {
  readonly handlers = new Map<string, Handler>()
  readonly listeners = new Map<string, Listener>()

  handle(channel: string, listener: Handler): void {
    this.handlers.set(channel, listener)
  }

  on(channel: string, listener: Listener): void {
    this.listeners.set(channel, listener)
  }

  async invoke(
    channel: string,
    params?: unknown,
    event?: IpcMainInvokeEvent,
  ): Promise<IpcResult<unknown>> {
    const handler = this.handlers.get(channel)
    if (handler === undefined) {
      throw new Error(`No handler registered for '${channel}'`)
    }
    return handler(event ?? makeEvent({ webContentsId: 1 }), params)
  }
}

export function makeEvent(options: {
  webContentsId: number
  url?: string
  subFrame?: boolean
}): IpcMainInvokeEvent {
  const mainFrame = { url: options.url ?? PROD_URL }
  const senderFrame = options.subFrame ? { url: options.url ?? PROD_URL } : mainFrame
  return {
    sender: { id: options.webContentsId, mainFrame },
    senderFrame,
  } as unknown as IpcMainInvokeEvent
}

export function makeGuard(windowId = 1): SenderGuard {
  const guard = new SenderGuard()
  guard.register({
    webContentsId: windowId,
    isDestroyed: () => false,
    isAllowedFrameUrl: (url) => url === PROD_URL,
  })
  return guard
}

/** 只让写临时文件失败，读/rename 仍可用：用于保存/草稿失败路径。 */
export function failingWriteOps(code: string): FileOps {
  return {
    ...nodeFileOps,
    async writeExclusive() {
      const error = new Error(`injected ${code}`) as Error & { code?: string }
      error.code = code
      throw error
    },
  }
}

/** 与上面相同，但带 ensureDirectory：恢复草稿/索引的 WorkspaceOps 端口。 */
export function failingWorkspaceOps(code: string): WorkspaceOps {
  return {
    ...nodeWorkspaceOps,
    async writeExclusive() {
      const error = new Error(`injected ${code}`) as Error & { code?: string }
      error.code = code
      throw error
    },
  }
}

export function dtoOf(snapshot: ProjectFileSnapshot) {
  return toSnapshotDto(snapshot)
}

/** 只改项目名的编辑（不破坏引用完整性）。 */
export function renamed(
  snapshot: ProjectFileSnapshot,
  name: string,
): ProjectFileSnapshot {
  return {
    ...snapshot,
    project: { ...snapshot.project, name, updatedAt: new Date().toISOString() },
  }
}

export interface HarnessOptions {
  /** 仅 main 单元测试使用；真实 renderer 集成覆盖在 savedExportBarrier 中。 */
  stubExportLease?: boolean
  choices?: GateChoice[]
  saveTarget?: string | null
  flushResult?: IpcResult<null>
  fileOps?: FileOps
  debounceMs?: number
  /** 迁移前副本的唯一后缀；测试用它固定备份文件名。 */
  newBackupSuffix?: () => string
  openPaths?: (string | null)[]
  relinkPaths?: (string | null)[]
  /** 注入 reveal 端口失败，用于 REVEAL_FAILED 路径。 */
  revealError?: Error
  /** 每次三选对话框前调用；用于在保存过程中注入新的 stage。 */
  onAskChoice?: (prompt: GatePrompt, index: number) => void | Promise<void>
}

/** 在写临时文件前执行一次钩子；用于模拟“保存进行中又有新编辑”。 */
export function writeHookOps(hook: { fn: (() => Promise<void>) | null }): FileOps {
  return {
    ...nodeFileOps,
    async writeExclusive(targetPath, bytes) {
      const pending = hook.fn
      if (pending !== null) {
        hook.fn = null
        await pending()
      }
      return nodeFileOps.writeExclusive(targetPath, bytes)
    },
  }
}

export interface Harness {
  directory: string
  workspace: string
  ipc: FakeIpc
  guard: SenderGuard
  projectService: ProjectService
  recovery: RecoveryStore
  recent: RecentProjectsStore
  controller: SessionController
  prompts: GatePrompt[]
  saveTargetCalls: number
  openPathCalls: number
  relinkPathCalls: number
  /** 每次 reveal 端口被调用时记录的路径，用于断言只传会话正式路径。 */
  revealCalls: string[]
  /** main 实际创建的会话 ID 顺序；用于断言 reattach 未命中不会新建会话。 */
  createdSessionIds: string[]
  /** 打开/另存/relink 对话框的下一次返回值；测试可直接改。 */
  openQueue: (string | null)[]
  relinkQueue: (string | null)[]
  saveTargetValue: string | null
  flushResult: IpcResult<null>
  invoke: <T>(channel: string, params?: unknown) => Promise<IpcResult<T>>
  samplePath: (name?: string) => string
  writeSample: (snapshot: ProjectFileSnapshot, name?: string) => Promise<string>
  newSnapshot: () => Promise<ProjectFileSnapshot>
  openSample: (snapshot?: ProjectFileSnapshot, name?: string) => Promise<ProjectOpenValue>
  dispose: () => Promise<void>
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'cunlian-a04-'))
  const workspace = path.join(directory, 'workspace')
  let counter = 0
  const createdSessionIds: string[] = []
  const projectService = new ProjectService({
    newSessionId: () => {
      const sessionId = `session-${(counter += 1)}`
      createdSessionIds.push(sessionId)
      return sessionId
    },
    store: new FileStore(options.fileOps === undefined ? {} : { ops: options.fileOps }),
    ...(options.newBackupSuffix === undefined
      ? {}
      : { newBackupSuffix: options.newBackupSuffix }),
  })
  const recovery = new RecoveryStore({
    rootDir: workspace,
    debounceMs: options.debounceMs ?? 5,
    newId: () => `recovery-${(counter += 1)}`,
    now: () => new Date('2026-11-09T10:00:00.000Z'),
  })
  const recent = new RecentProjectsStore({
    rootDir: workspace,
    newId: () => `recent-${(counter += 1)}`,
    now: () => new Date(`2026-11-09T10:00:${String(counter).padStart(2, '0')}.000Z`),
  })

  const choices = [...(options.choices ?? [])]
  const prompts: GatePrompt[] = []
  const openQueue = [...(options.openPaths ?? [])]
  const relinkQueue = [...(options.relinkPaths ?? [])]

  const state: Harness = {
    directory,
    workspace,
    ipc: new FakeIpc(),
    guard: makeGuard(),
    projectService,
    recovery,
    recent,
    controller: undefined as unknown as SessionController,
    prompts,
    saveTargetCalls: 0,
    openPathCalls: 0,
    relinkPathCalls: 0,
    revealCalls: [],
    createdSessionIds,
    openQueue,
    relinkQueue,
    saveTargetValue: options.saveTarget ?? null,
    flushResult: options.flushResult ?? { ok: true, value: null },
    invoke: async <T>(channel: string, params?: unknown): Promise<IpcResult<T>> => {
      const result = await state.ipc.invoke(channel, params)
      return result as IpcResult<T>
    },
    samplePath: (name = 'sample') => path.join(directory, `${name}.cunlian`),
    writeSample: async (snapshot, name = 'sample') => {
      const encoded = await encodeProjectFile(snapshot)
      if (!encoded.ok) {
        throw new Error(`encode failed: ${encoded.error.code}`)
      }
      const target = path.join(directory, `${name}.cunlian`)
      await fsp.writeFile(target, encoded.value.bytes)
      return target
    },
    newSnapshot: () => createSampleSnapshot(),
    openSample: async (snapshot, name = 'sample') => {
      const target = await state.writeSample(
        snapshot ?? (await createSampleSnapshot()),
        name,
      )
      openQueue.unshift(target)
      const result = await state.invoke<ProjectOpenValue>(IPC_CHANNELS.projectOpen, {})
      if (!result.ok) {
        throw new Error(`openSample failed: ${result.error.code} ${result.error.message}`)
      }
      return result.value
    },
    dispose: async () => {
      // 恢复草稿的防抖写入可能仍在进行；等它结束后再删临时目录。
      await new Promise((resolve) => setTimeout(resolve, 30))
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await fsp.rm(directory, { recursive: true, force: true })
          return
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 30))
        }
      }
    },
  }

  const controller = new SessionController({
    projectService,
    recovery,
    recent,
    ports: {
      askChoice: async (prompt) => {
        prompts.push(prompt)
        await options.onAskChoice?.(prompt, prompts.length)
        const choice = choices.shift()
        if (choice === undefined) {
          throw new Error('测试没有提供 dirty 选择')
        }
        return choice
      },
      pickSaveTarget: async () => {
        state.saveTargetCalls += 1
        return state.saveTargetValue
      },
      flushEditor: async () => state.flushResult,
      ...(options.stubExportLease ? { acquireExportLease: async () => ({ ok: true as const, value: { requestId: 'main-only-test-stub', valid: () => true, release: () => {} } }) } : {}),
      log: () => undefined,
    },
  })
  state.controller = controller

  registerProjectChannels(state.ipc, {
    guard: state.guard,
    projectService,
    recovery,
    recent,
    controller,
    pickOpenPath: async () => {
      state.openPathCalls += 1
      return state.openQueue.shift() ?? null
    },
    pickRelinkPath: async () => {
      state.relinkPathCalls += 1
      return state.relinkQueue.shift() ?? null
    },
    pickSaveTarget: async () => {
      state.saveTargetCalls += 1
      return state.saveTargetValue
    },
    revealPath: async (targetPath) => {
      state.revealCalls.push(targetPath)
      if (options.revealError !== undefined) {
        throw options.revealError
      }
    },
    appVersion: '2.0.0-test',
    electronVersion: '45.2.3-test',
  })

  return state
}

/** 通过 project:stage 提交一次改名编辑。 */
export async function stageRename(
  harness: Harness,
  session: { sessionId: string; snapshot: unknown },
  editSeq: number,
  name: string,
): Promise<IpcResult<ProjectStageValue>> {
  const snapshot = session.snapshot as ProjectFileSnapshot
  return harness.invoke<ProjectStageValue>(IPC_CHANNELS.projectStage, {
    sessionId: session.sessionId,
    editSeq,
    snapshot: dtoOf(renamed(snapshot, name)),
  })
}

export const emptySchema = z.object({}).strict()

export { installChannel }
