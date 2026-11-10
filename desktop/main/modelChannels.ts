/**
 * STL 模型导入通道（V3-B2）。
 *
 * 安全边界：
 * - 不接受 renderer 传入的路径/blobKey；文件路径只来自 main 的系统对话框；
 * - lstat 必须是常规文件、不跟随符号链接，0 字节与 >10 MiB 在整文件读取前拒绝；
 * - 候选字节只存在 main 内存，token 绑定窗口 + 会话，5 分钟过期；
 * - commit 由 main 用共享纯解析器重新校验并自算 sha256/面数/包围盒；
 * - 容量：PDF+模型唯一 blob 总字节 ≤100 MiB，条目 ≤500，解压总量 ≤150 MiB；
 * - 失败不修改会话快照，不产生新版本/新附件。
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  IpcErrorCode,
  ModelCommitValue,
  ModelLinkValue,
  ModelPickValue,
  ModelReadValue,
} from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'
import type {
  ProjectFileSnapshot,
  ProjectFileVisualReferenceLink,
} from '../../src/project-file/types'
import {
  assembleSnapshot,
  expectedEntryRoles,
  validateProjectAssetBudget,
} from '../../src/project-file/validation'
import { toSnapshotDto } from '../../src/project-file/codec'
import { parseStl } from '../../src/parts/stlValidation'
import { DEFAULT_STL_LIMITS } from '../../src/parts/stlLimits'
import { sha256Hex } from '../../src/sources/hash'
import { IpcFailure, installChannel, type IpcDeps, type IpcMainLike } from './ipc'
import type { ProjectService, ProjectSession } from './projectService'
import type { RecoveryStore } from './recovery'
import type { SessionController } from './sessionController'
import type { SenderGuard } from './senderGuard'

export const MODEL_CANDIDATE_TTL_MS = 5 * 60 * 1000

export type FileKind = 'missing' | 'file' | 'directory' | 'symlink' | 'other'

/** main 侧受限文件端口；产品实现见 modelIo.ts，测试注入假实现。 */
export interface ModelFileIo {
  kindOf(path: string): Promise<FileKind>
  sizeOf(path: string): Promise<number | null>
  /** 最多读取 max 字节（max 为上界 + 1）；返回实际读到的字节。 */
  readUpTo(path: string, max: number): Promise<Uint8Array>
}

interface Candidate {
  token: string
  windowId: number
  sessionId: string
  baseEditSeq: number
  replacePartId: string | null
  fileName: string
  bytes: Uint8Array
  sha256: string
  byteSize: number
  expiresAt: number
}

export const modelSchemas = {
  pick: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseEditSeq: z.number().int().nonnegative(),
      replacePartId: z.string().min(1).max(240).optional(),
    })
    .strict(),
  read: z
    .object({
      sessionId: z.string().min(1).max(200),
      ref: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('candidate'), token: z.string().min(1).max(120) }).strict(),
        z
          .object({ kind: z.literal('revision'), modelRevisionId: z.string().min(1).max(240) })
          .strict(),
      ]),
    })
    .strict(),
  commit: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseEditSeq: z.number().int().nonnegative(),
      candidateToken: z.string().min(1).max(120),
      expectedCurrentModelRevisionId: z.string().min(1).max(240).nullable(),
      partName: z.string().min(1).max(200),
      unitNote: z.string().max(200),
    })
    .strict(),
  release: z
    .object({
      sessionId: z.string().min(1).max(200),
      candidateToken: z.string().min(1).max(120),
    })
    .strict(),
  link: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseEditSeq: z.number().int().nonnegative(),
      operation: z.enum(['bind', 'confirm-new']),
      linkId: z.string().min(1).max(240).optional(),
      termId: z.string().min(1).max(240),
      target: z
        .object({
          granularity: z.enum(['model', 'part']),
          partId: z.string().min(1).max(240),
          modelRevisionId: z.string().min(1).max(240).nullable(),
        })
        .strict(),
      expectedCurrentModelRevisionId: z.string().min(1).max(240).nullable(),
    })
    .strict(),
} as const

export interface ModelChannelDeps {
  guard: SenderGuard
  controller: SessionController
  projectService: ProjectService
  recovery: RecoveryStore
  /** 系统对话框；只允许选单个 STL 文件。取消返回 null。 */
  pickModelPath: (windowId: number) => Promise<string | null>
  io: ModelFileIo
  log?: IpcDeps['log']
  now?: () => number
  newId?: () => string
}

function reject(code: IpcErrorCode, message: string, detail?: string): never {
  throw new IpcFailure(code, message, detail)
}

function requireSession(
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

function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export class ModelCandidates {
  private readonly items = new Map<string, Candidate>()
  private readonly now: () => number
  private readonly newId: () => string

  constructor(now: () => number, newId: () => string = () => randomUUID()) {
    this.now = now
    this.newId = newId
  }

  put(input: Omit<Candidate, 'token' | 'expiresAt'>): Candidate {
    // 每个窗口最多一个活动候选；重新选择会作废旧候选。
    for (const [token, item] of this.items) {
      if (item.windowId === input.windowId && item.sessionId === input.sessionId) {
        this.items.delete(token)
      }
    }
    const candidate: Candidate = {
      ...input,
      token: this.newId(),
      expiresAt: this.now() + MODEL_CANDIDATE_TTL_MS,
    }
    this.items.set(candidate.token, candidate)
    return candidate
  }

  get(token: string, windowId: number, sessionId: string): Candidate | null {
    const item = this.items.get(token)
    if (item === undefined) return null
    if (item.windowId !== windowId || item.sessionId !== sessionId) return null
    if (item.expiresAt <= this.now()) {
      this.items.delete(token)
      return null
    }
    return item
  }

  /** 返回前不删除：commit 成功后才消费。 */
  take(token: string, windowId: number, sessionId: string): Candidate | null {
    const item = this.get(token, windowId, sessionId)
    return item
  }

  release(token: string, windowId: number, sessionId: string): boolean {
    const item = this.items.get(token)
    if (item === undefined || item.windowId !== windowId || item.sessionId !== sessionId) {
      return false
    }
    this.items.delete(token)
    return true
  }

  clearSession(sessionId: string): void {
    for (const [token, item] of this.items) {
      if (item.sessionId === sessionId) this.items.delete(token)
    }
  }
}

/** 把纯解析错误原样映射为 IPC 码；未知错误按 INTERNAL。 */
function stlFailure(error: { code: string; message: string; detail?: string }): never {
  const code = error.code as IpcErrorCode
  throw new IpcFailure(code, error.message, error.detail)
}

export function registerModelChannels(ipc: IpcMainLike, deps: ModelChannelDeps): ModelCandidates {
  const now = deps.now ?? (() => Date.now())
  const newId = deps.newId ?? (() => randomUUID())
  const candidates = new ModelCandidates(now, newId)
  const ipcDeps: IpcDeps = { guard: deps.guard, log: deps.log }
  const { controller, recovery } = deps

  const stageRecovery = async (
    session: ProjectSession,
  ): Promise<{ state: 'written' | 'unchanged' | 'pending' | 'failed'; warning?: string }> => {
    const outcome = await recovery.stage(
      session.sessionId,
      session.snapshot,
      session.acceptedSeq,
      controller.recoveryMeta(session, session.snapshot),
    )
    return outcome.warning === undefined
      ? { state: outcome.state }
      : { state: outcome.state, warning: outcome.warning }
  }

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.modelPick,
      schema: modelSchemas.pick,
      handle: async ({ sender }, params): Promise<ModelPickValue> => {
        const windowId = sender.webContentsId
        const session = requireSession(controller, windowId, params.sessionId)
        if (params.baseEditSeq !== session.acceptedSeq) {
          reject(
            'STALE_EDIT',
            '编辑序号已变化，请重试选择文件',
            `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${params.baseEditSeq}`,
          )
        }
        if (params.replacePartId !== undefined) {
          const part = session.snapshot.project.parts.find(
            (item) => item.partId === params.replacePartId,
          )
          if (part === undefined) {
            reject('INVALID_REQUEST', '要替换的部件不存在', params.replacePartId)
          }
        }
        const picked = await deps.pickModelPath(windowId)
        if (picked === null) {
          reject('CANCELLED', '已取消选择模型文件')
        }
        const kind = await deps.io.kindOf(picked)
        if (kind === 'missing') reject('NOT_FOUND', '文件不存在或已移动')
        if (kind !== 'file') {
          reject('READ_FAILED', '模型文件不是常规文件（不允许符号链接或目录）', kind)
        }
        const size = await deps.io.sizeOf(picked)
        if (size === null) reject('READ_FAILED', '无法读取文件大小')
        if (size === 0) reject('STL_EMPTY', 'STL 文件为空（0 字节）')
        if (size > DEFAULT_STL_LIMITS.maxBytes) {
          reject(
            'STL_TOO_LARGE',
            `STL 文件超过单文件上限 ${mib(DEFAULT_STL_LIMITS.maxBytes)}`,
            `实际 ${size} 字节，上限 ${DEFAULT_STL_LIMITS.maxBytes} 字节`,
          )
        }
        let bytes: Uint8Array
        try {
          bytes = await deps.io.readUpTo(picked, DEFAULT_STL_LIMITS.maxBytes + 1)
        } catch (error) {
          reject(
            'READ_FAILED',
            '读取模型文件失败',
            error instanceof Error ? error.message : String(error),
          )
        }
        if (bytes.byteLength > DEFAULT_STL_LIMITS.maxBytes) {
          reject(
            'STL_TOO_LARGE',
            `STL 文件超过单文件上限 ${mib(DEFAULT_STL_LIMITS.maxBytes)}`,
            `读取到 ${bytes.byteLength} 字节，上限 ${DEFAULT_STL_LIMITS.maxBytes} 字节`,
          )
        }
        const after = await deps.io.sizeOf(picked)
        if (after !== null && after !== bytes.byteLength) {
          reject(
            'FILE_CHANGED',
            '文件在读取期间发生变化，请重新选择',
            `读取前 ${size} 字节，读取后 ${after} 字节`,
          )
        }
        const digest = await sha256Hex(bytes)
        const candidate = candidates.put({
          windowId,
          sessionId: session.sessionId,
          baseEditSeq: params.baseEditSeq,
          replacePartId: params.replacePartId ?? null,
          fileName: basename(picked),
          bytes,
          sha256: digest,
          byteSize: bytes.byteLength,
        })
        return {
          candidateToken: candidate.token,
          fileName: candidate.fileName,
          byteSize: candidate.byteSize,
          sha256: candidate.sha256,
        }
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.modelRead,
      schema: modelSchemas.read,
      handle: async ({ sender }, params): Promise<ModelReadValue> => {
        const windowId = sender.webContentsId
        const session = requireSession(controller, windowId, params.sessionId)
        if (params.ref.kind === 'candidate') {
          const candidate = candidates.get(params.ref.token, windowId, session.sessionId)
          if (candidate === null) {
            reject(
              'CANDIDATE_EXPIRED',
              '候选已过期或不属于当前窗口/会话，请重新选择',
            )
          }
          return {
            bytes: new Uint8Array(candidate.bytes),
            sha256: candidate.sha256,
            fileName: candidate.fileName,
            byteSize: candidate.byteSize,
          }
        }
        const revisionRef = params.ref
        if (revisionRef.kind !== 'revision') {
          reject('INVALID_REQUEST', '模型引用不合法')
        }
        const revision = session.snapshot.project.modelRevisions.find(
          (item) => item.modelRevisionId === revisionRef.modelRevisionId,
        )
        if (revision === undefined) {
          reject('ATTACHMENT_MISSING', '模型版本不存在或不属于当前项目', revisionRef.modelRevisionId)
        }
        const blob = session.snapshot.blobs.find((item) => item.blobKey === revision.blobKey)
        const attachment = session.snapshot.attachments.find(
          (item) => item.blobKey === revision.blobKey,
        )
        if (blob === undefined || attachment === undefined) {
          reject(
            'ATTACHMENT_MISSING',
            '该模型版本没有随项目携带字节',
            revision.blobKey,
          )
        }
        if (attachment.bytes.byteLength > DEFAULT_STL_LIMITS.maxBytes) {
          reject('STL_TOO_LARGE', '模型字节超过单文件上限', `${attachment.bytes.byteLength} 字节`)
        }
        const digest = await sha256Hex(attachment.bytes)
        if (digest !== revision.attachmentSha256) {
          reject(
            'HASH_MISMATCH',
            '模型字节与版本记录哈希不一致',
            `declared=${revision.attachmentSha256}, actual=${digest}`,
          )
        }
        return {
          bytes: new Uint8Array(attachment.bytes),
          sha256: digest,
          fileName: revision.fileName,
          byteSize: attachment.bytes.byteLength,
        }
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.modelRelease,
      schema: modelSchemas.release,
      handle: async ({ sender }, params): Promise<{ released: boolean }> => {
        const windowId = sender.webContentsId
        const session = requireSession(controller, windowId, params.sessionId)
        return { released: candidates.release(params.candidateToken, windowId, session.sessionId) }
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.modelCommit,
      schema: modelSchemas.commit,
      handle: async ({ sender }, params): Promise<ModelCommitValue> => {
        const windowId = sender.webContentsId
        const session = requireSession(controller, windowId, params.sessionId)
        if (params.baseEditSeq !== session.acceptedSeq) {
          reject(
            'STALE_EDIT',
            '导入期间项目已发生其它编辑，请重试',
            `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${params.baseEditSeq}`,
          )
        }
        const candidate = candidates.get(params.candidateToken, windowId, session.sessionId)
        if (candidate === null) {
          reject('CANDIDATE_EXPIRED', '候选已过期，请重新选择文件')
        }
        const existingPart =
          candidate.replacePartId === null
            ? undefined
            : session.snapshot.project.parts.find(
                (item) => item.partId === candidate.replacePartId,
              )
        if (candidate.replacePartId !== null && existingPart === undefined) {
          reject('INVALID_REQUEST', '要替换的部件不存在', candidate.replacePartId)
        }
        const currentModelRevisionId = existingPart?.currentModelRevisionId ?? null
        if (currentModelRevisionId !== params.expectedCurrentModelRevisionId) {
          reject(
            'STALE_EDIT',
            '部件的当前模型版本已变化，请重新开始替换',
            `expected=${params.expectedCurrentModelRevisionId ?? 'null'}，current=${
              currentModelRevisionId ?? 'null'
            }`,
          )
        }

        // main 自算可信校验报告：renderer 传来的面数/包围盒一律不采用。
        const parsed = parseStl(candidate.bytes)
        if (!parsed.ok) stlFailure(parsed.error)
        const geometry = parsed.value

        const snapshot = session.snapshot
        const partId = existingPart?.partId ?? `part-${newId()}`
        const modelRevisionId = `model-${newId()}`
        const existingBlob = snapshot.blobs.find(
          (blob) => blob.sha256 === candidate.sha256 && blob.byteSize === candidate.byteSize,
        )
        const blobKey = existingBlob?.blobKey ?? `blob-${newId()}`
        const addedBytes = existingBlob === undefined ? candidate.byteSize : 0
        const budget = validateProjectAssetBudget(snapshot, addedBytes)
        if (!budget.ok) {
          reject(budget.error.code, budget.error.message, budget.error.detail)
        }

        const newModel = {
          modelRevisionId,
          partId,
          kind: 'stl' as const,
          parentModelRevisionId: currentModelRevisionId,
          createdAt: new Date(now()).toISOString(),
          reason: existingPart === undefined ? '导入模型' : '替换模型',
          fileName: candidate.fileName,
          blobKey,
          attachmentSha256: candidate.sha256,
          byteSize: candidate.byteSize,
          encoding: geometry.encoding,
          triangleCount: geometry.triangleCount,
          bounds: {
            min: [...geometry.bounds.min] as [number, number, number],
            max: [...geometry.bounds.max] as [number, number, number],
          },
          unitNote: params.unitNote.trim() === '' ? '未注明（STL 无标准单位）' : params.unitNote,
        }
        const parts = existingPart
          ? snapshot.project.parts.map((part) =>
              part.partId === partId
                ? { ...part, currentModelRevisionId: modelRevisionId }
                : part,
            )
          : [
              ...snapshot.project.parts,
              {
                partId,
                kind: 'imported-mesh' as const,
                name: params.partName,
                currentModelRevisionId: modelRevisionId,
                origin: 'stl-import' as const,
              },
            ]
        // 仅同一部件的已确认关联标记待核对；旧目标版本与确认凭据保留。
        let pendingCount = 0
        const dimensionLinks = snapshot.project.dimensionLinks.map((link) => {
          if (link.kind !== 'visual-reference') return link
          if (link.target.partId !== partId) return link
          if (link.reviewStatus !== 'confirmed') return link
          pendingCount += 1
          return { ...link, reviewStatus: 'pending' as const, reason: 'model-replaced' }
        })

        const next: ProjectFileSnapshot = {
          ...snapshot,
          project: {
            ...snapshot.project,
            parts,
            modelRevisions: [...snapshot.project.modelRevisions, newModel],
            dimensionLinks,
            updatedAt: newModel.createdAt,
          },
          blobs: existingBlob
            ? snapshot.blobs
            : [
                ...snapshot.blobs,
                {
                  blobKey,
                  projectId: snapshot.project.id,
                  sha256: candidate.sha256,
                  byteSize: candidate.byteSize,
                },
              ],
          attachments: existingBlob
            ? snapshot.attachments
            : [...snapshot.attachments, { blobKey, bytes: candidate.bytes }],
        }
        const roles = expectedEntryRoles(next)
        if (roles.length + 1 > 500) {
          reject(
            'TOO_MANY_ENTRIES',
            `导入后将超过项目文件 500 条目上限（含 manifest）`,
            `现有 ${snapshot.blobs.length} 个附件，导入后 ${next.blobs.length} 个`,
          )
        }
        const totalBytes = next.blobs.reduce((sum, blob) => sum + blob.byteSize, 0)
        if (totalBytes + 2 * 1024 * 1024 > 150 * 1024 * 1024) {
          reject(
            'TOO_LARGE',
            '导入后项目解压总量将超过 150 MiB 上限',
            `附件合计 ${totalBytes} 字节`,
          )
        }

        // 用打开端同一套引用校验复核候选快照；失败不提交。
        const validated = validateSnapshot(next, snapshot)
        if (!validated.ok) reject(validated.error.code, validated.error.message, validated.error.detail)

        session.snapshot = next
        session.acceptedSeq = params.baseEditSeq + 1
        candidates.release(candidate.token, windowId, session.sessionId)
        const recoveryOutcome = await stageRecovery(session)
        const value: ModelCommitValue = {
          acceptedSeq: session.acceptedSeq,
          modelRevisionId,
          snapshot: toSnapshotDto(next),
          recovery: recoveryOutcome.state,
        }
        if (recoveryOutcome.warning !== undefined) value.warning = recoveryOutcome.warning
        if (pendingCount > 0) {
          value.warning = `有 ${pendingCount} 条外形资料来源关联需核对新版；尺寸链数值未改变。`
        }
        return value
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.modelLink,
      schema: modelSchemas.link,
      handle: async ({ sender }, params): Promise<ModelLinkValue> => {
        const windowId = sender.webContentsId
        const session = requireSession(controller, windowId, params.sessionId)
        if (params.baseEditSeq !== session.acceptedSeq) {
          reject(
            'STALE_EDIT',
            '编辑序号已变化，请重试关联',
            `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${params.baseEditSeq}`,
          )
        }
        const snapshot = session.snapshot
        const term = snapshot.project.dimensionChain.terms.find(
          (item) => item.id === params.termId,
        )
        if (term === undefined) {
          reject('MISSING_REFERENCE', '组成环不存在', params.termId)
        }
        const part = snapshot.project.parts.find((item) => item.partId === params.target.partId)
        if (part === undefined) {
          reject('MISSING_REFERENCE', '部件不存在', params.target.partId)
        }
        if (params.target.granularity === 'model' && params.target.modelRevisionId === null) {
          reject('INVALID_REQUEST', '模型粒度必须指向具体模型版本')
        }
        if (params.target.modelRevisionId !== null) {
          const model = snapshot.project.modelRevisions.find(
            (item) => item.modelRevisionId === params.target.modelRevisionId,
          )
          if (model === undefined || model.partId !== part.partId) {
            reject('MISSING_REFERENCE', '模型版本不属于该部件', params.target.modelRevisionId)
          }
        }
        if (part.currentModelRevisionId !== params.expectedCurrentModelRevisionId) {
          reject(
            'STALE_EDIT',
            '部件的当前模型版本已变化，请重新核对',
            `expected=${params.expectedCurrentModelRevisionId ?? 'null'}，current=${
              part.currentModelRevisionId ?? 'null'
            }`,
          )
        }
        const nowIso = new Date(now()).toISOString()
        let dimensionLinks
        if (params.operation === 'bind') {
          dimensionLinks = [
            ...snapshot.project.dimensionLinks,
            {
              kind: 'visual-reference' as const,
              linkId: `link-${newId()}`,
              termId: params.termId,
              target: params.target,
              reviewStatus: 'confirmed' as const,
              reviewedModelRevisionId: params.target.modelRevisionId,
              reviewedAt: nowIso,
              reason: '',
            },
          ]
        } else {
          if (params.linkId === undefined) {
            reject('INVALID_REQUEST', '核对新版需要给出 linkId')
          }
          const existing = snapshot.project.dimensionLinks.find(
            (item) => item.kind === 'visual-reference' && item.linkId === params.linkId,
          ) as ProjectFileVisualReferenceLink | undefined
          if (existing === undefined) {
            reject('MISSING_REFERENCE', '待核对的关联不存在', params.linkId)
          }
          if (existing.reviewStatus !== 'pending') {
            reject('INVALID_REQUEST', '该关联不在待核对状态')
          }
          if (existing.target.partId !== params.target.partId) {
            reject('INVALID_REQUEST', '核对目标与关联的部件不一致')
          }
          if (params.target.modelRevisionId === null) {
            reject('INVALID_REQUEST', '核对新版必须指向具体模型版本')
          }
          dimensionLinks = snapshot.project.dimensionLinks.map((item) =>
            item.kind === 'visual-reference' && item.linkId === params.linkId
              ? {
                  ...item,
                  target: params.target,
                  reviewStatus: 'confirmed' as const,
                  reviewedModelRevisionId: params.target.modelRevisionId,
                  reviewedAt: nowIso,
                  reason: '',
                }
              : item,
          )
        }
        const next: ProjectFileSnapshot = {
          ...snapshot,
          project: { ...snapshot.project, dimensionLinks, updatedAt: nowIso },
        }
        const validated = validateSnapshot(next, snapshot)
        if (!validated.ok) reject(validated.error.code, validated.error.message, validated.error.detail)

        session.snapshot = next
        session.acceptedSeq = params.baseEditSeq + 1
        const recoveryOutcome = await stageRecovery(session)
        const value: ModelLinkValue = {
          acceptedSeq: session.acceptedSeq,
          snapshot: toSnapshotDto(next),
          recovery: recoveryOutcome.state,
          warning: '该关联只表示外形资料来源，不改变尺寸链数值、不自动同步。',
        }
        if (recoveryOutcome.warning !== undefined) {
          value.warning = `${value.warning} ${recoveryOutcome.warning}`
        }
        return value
      },
    },
    ipcDeps,
  )

  return candidates
}

/** 用打开端同一套 assembleSnapshot 复核候选快照（含模型/关联引用）。 */
function validateSnapshot(
  next: ProjectFileSnapshot,
  current: ProjectFileSnapshot,
): { ok: true } | { ok: false; error: { code: IpcErrorCode; message: string; detail?: string } } {
  const assembled = assembleSnapshot({
    project: next.project,
    draft: next.draft,
    documents: next.documents,
    revisions: next.revisions,
    bindings: next.bindings,
    blobs: next.blobs,
    events: next.events,
    analysisSnapshots: next.analysisSnapshots,
    importSnapshots: next.importSnapshots,
    migrationBackups: next.migrationBackups,
    legacyArchive: next.legacyArchive,
    fileRevisions: next.fileRevisions,
    attachments: next.attachments,
    missingAttachments: next.missingAttachments,
    snapshotReferences: next.snapshotReferences,
    manifestMeta: current.manifestMeta,
  })
  if (!assembled.ok) {
    return {
      ok: false,
      error: {
        code: assembled.error.code as IpcErrorCode,
        message: assembled.error.message,
        detail: assembled.error.detail,
      },
    }
  }
  return { ok: true }
}

function basename(targetPath: string): string {
  const parts = targetPath.split(/[\\/]/)
  return parts[parts.length - 1] ?? 'model.stl'
}
