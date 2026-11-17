/**
 * 手绘草图入口（主进程）：图片导入 + 图上框选读数提交。
 *
 * 边界：
 * - 文件路径只来自 main 的系统对话框；renderer 不能传路径/字节/blobKey；
 * - lstat 必须是常规文件、不跟随符号链接；空文件、超限在整文件读取前拒绝；
 * - 只收 PNG / JPEG（按文件头判），HEIC 明确拒绝并给 sips 转换命令；
 * - main 自算 SHA-256 与像素宽高，不信任 renderer 传的任何几何；
 * - 图片字节作为附件写进项目文件（与 PDF 同一套 blob/attachments）；
 * - 读数只进 pending 候选，位置一律原图像素；不做任何图像识别或像素量取。
 */
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { z } from 'zod'
import type {
  IpcErrorCode,
  SketchImageImportValue,
  SketchIngestValue,
} from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'
import type { ChangeEvent } from '../../src/history/events'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import { toSnapshotDto } from '../../src/project-file/codec'
import { expectedEntryRoles, validateProjectAssetBudget } from '../../src/project-file/validation'
import { checkSketchImage, SKETCH_IMAGE_MAX_BYTES } from '../../src/sketch/imageFormat'
import { imagePixelSize } from '../../src/sketch/imageSize'
import { readJpegOrientation } from '../../src/sketch/orientation'
import { formatMiB } from '../../src/sources/limits'
import { sha256Hex } from '../../src/sources/hash'
import { sketchIngestIntoSnapshot } from './ingestReadings'
import { IpcFailure, installChannel, type IpcDeps, type IpcMainLike } from './ipc'
import { validateSnapshot, type ModelFileIo } from './modelChannels'
import type { ProjectService, ProjectSession } from './projectService'
import type { RecoveryStore } from './recovery'
import type { SessionController } from './sessionController'
import type { SenderGuard } from './senderGuard'

export const sketchSchemas = {
  importImage: z.object({
    sessionId: z.string().min(1).max(200),
    baseEditSeq: z.number().int().nonnegative(),
  }).strict(),
  ingestReadings: z.object({
    sessionId: z.string().min(1).max(200),
    baseEditSeq: z.number().int().nonnegative(),
    payload: z.unknown(),
  }).strict(),
} as const

export interface SketchChannelDeps {
  guard: SenderGuard
  controller: SessionController
  projectService: ProjectService
  recovery: RecoveryStore
  /** 系统对话框；只选单个图片。取消返回 null。 */
  pickImagePath: (windowId: number) => Promise<string | null>
  io: ModelFileIo
  log?: IpcDeps['log']
  now?: () => Date
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
  if (controller.sessionIdFor(windowId) !== sessionId) {
    reject('STALE_SESSION', '会话已失效，请重新打开项目')
  }
  const session = controller.sessionFor(windowId)
  if (session === null) {
    reject('STALE_SESSION', '会话已失效，请重新打开项目')
  }
  return session
}

export function registerSketchChannels(ipc: IpcMainLike, deps: SketchChannelDeps): void {
  const now = deps.now ?? (() => new Date())
  const newId = deps.newId ?? (() => randomUUID())
  const ipcDeps: IpcDeps = { guard: deps.guard, log: deps.log, sessionTransactions: deps.projectService }
  const { controller, recovery } = deps

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.sketchImageImport,
      schema: sketchSchemas.importImage,
      handle: async ({ sender }, params): Promise<SketchImageImportValue> => {
        const windowId = sender.webContentsId
        const session = requireSession(controller, windowId, params.sessionId)
        if (params.baseEditSeq !== session.acceptedSeq) {
          reject('STALE_EDIT', '导入期间项目已发生其它编辑，请重试',
            `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${params.baseEditSeq}`)
        }
        const snapshot = session.snapshot
        const picked = await deps.pickImagePath(windowId)
        if (picked === null) reject('CANCELLED', '已取消选择图片')
        const kind = await deps.io.kindOf(picked)
        if (kind === 'missing') reject('NOT_FOUND', '图片文件不存在或已移动')
        if (kind !== 'file') reject('READ_FAILED', '图片不是常规文件（不允许符号链接或目录）', kind)
        const size = await deps.io.sizeOf(picked)
        if (size === null) reject('READ_FAILED', '无法读取图片文件大小')
        if (size === 0) reject('SOURCE_UNREADABLE', '图片为空（0 字节）')
        if (size > SKETCH_IMAGE_MAX_BYTES) {
          reject('TOO_LARGE', `图片超过单张上限 ${formatMiB(SKETCH_IMAGE_MAX_BYTES)}`,
            `实际 ${size} 字节，上限 ${SKETCH_IMAGE_MAX_BYTES} 字节`)
        }
        let bytes: Uint8Array
        try {
          bytes = await deps.io.readUpTo(picked, SKETCH_IMAGE_MAX_BYTES + 1)
        } catch (error) {
          reject('READ_FAILED', '读取图片文件失败', error instanceof Error ? error.message : String(error))
        }
        if (bytes.byteLength > SKETCH_IMAGE_MAX_BYTES) {
          reject('TOO_LARGE', `图片超过单张上限 ${formatMiB(SKETCH_IMAGE_MAX_BYTES)}`,
            `读取到 ${bytes.byteLength} 字节`)
        }
        const afterSize = await deps.io.sizeOf(picked)
        if (afterSize !== null && afterSize !== bytes.byteLength) {
          reject('FILE_CHANGED', '图片在读取期间发生变化，请重新选择',
            `读取前 ${size} 字节，读取后 ${afterSize} 字节`)
        }
        const fileName = basename(picked)
        const rejection = checkSketchImage(bytes, fileName)
        if (rejection !== null) {
          reject(rejection.code === 'TOO_LARGE' ? 'TOO_LARGE'
            : rejection.code === 'EMPTY_FILE' ? 'SOURCE_UNREADABLE' : 'UNSUPPORTED_IMAGE_FORMAT',
          rejection.message)
        }
        const pixelSize = imagePixelSize(bytes)
        if (pixelSize === null) {
          reject('SOURCE_UNREADABLE', '无法从图片文件头读出像素尺寸；这张图可能已损坏，请重新导出')
        }
        const orientationState = readJpegOrientation(bytes)
        const orientation = orientationState.kind === 'supported' ? orientationState.value
          : orientationState.kind === 'mirrored' ? orientationState.raw
            : (orientationState.raw ?? 1)
        const digest = await sha256Hex(bytes)
        const createdAt = now().toISOString()
        const documentId = `doc-${newId()}`
        const revisionId = `sr-${newId()}`
        const blobKey = `blob-${newId()}`
        const next: ProjectFileSnapshot = {
          ...snapshot,
          project: { ...snapshot.project, updatedAt: createdAt },
          documents: [...snapshot.documents, {
            id: documentId, projectId: snapshot.project.id, title: fileName, latestRevisionId: revisionId,
          }],
          revisions: [...snapshot.revisions, {
            id: revisionId, projectId: snapshot.project.id, documentId, fileName,
            sha256: digest, byteSize: bytes.byteLength, pageCount: 1, createdAt, blobKey,
          }],
          blobs: [...snapshot.blobs, {
            blobKey, projectId: snapshot.project.id, sha256: digest, byteSize: bytes.byteLength,
          }],
          attachments: [...snapshot.attachments, { blobKey, bytes }],
          events: [...snapshot.events, {
            id: `source_import:${revisionId}`, projectId: snapshot.project.id,
            type: 'source_import', createdAt, documentId, revisionId, after: fileName,
          } satisfies ChangeEvent],
        }
        const budget = validateProjectAssetBudget(next)
        if (!budget.ok) reject(budget.error.code, budget.error.message, budget.error.detail)
        if (expectedEntryRoles(next).length + 1 > 500) {
          reject('TOO_MANY_ENTRIES', '导入后将超过项目文件 500 条目上限（含 manifest）',
            `导入后附件 ${next.blobs.length} 个`)
        }
        const validated = validateSnapshot(next, snapshot)
        if (!validated.ok) reject(validated.error.code, validated.error.message, validated.error.detail)
        session.snapshot = next
        session.acceptedSeq = params.baseEditSeq + 1
        const recoveryOutcome = await recovery.stage(session.sessionId, session.snapshot,
          session.acceptedSeq, controller.recoveryMeta(session, session.snapshot))
        const value: SketchImageImportValue = {
          acceptedSeq: session.acceptedSeq, imageId: revisionId, revisionId, documentId, blobKey,
          fileName, sha256: digest, byteSize: bytes.byteLength,
          width: pixelSize.width, height: pixelSize.height, orientation,
          snapshot: toSnapshotDto(next), recovery: recoveryOutcome.state,
        }
        if (recoveryOutcome.warning !== undefined) value.warning = recoveryOutcome.warning
        return value
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.sketchIngestReadings,
      schema: sketchSchemas.ingestReadings,
      handle: async ({ sender }, params): Promise<SketchIngestValue> => {
        const windowId = sender.webContentsId
        const session = requireSession(controller, windowId, params.sessionId)
        if (params.baseEditSeq !== session.acceptedSeq) {
          reject('STALE_EDIT', '提交期间项目已发生其它编辑，请重试',
            `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${params.baseEditSeq}`)
        }
        // 会话已绑定项目：projectId 由 main 补，不接受 renderer 指定的别的项目。
        const payload = typeof params.payload === 'object' && params.payload !== null
          ? { ...(params.payload as Record<string, unknown>), projectId: session.snapshot.project.id }
          : params.payload
        const result = sketchIngestIntoSnapshot(session.snapshot, payload, {
          turnId: `sketch:${newId()}`, at: now().toISOString(),
        })
        if (!result.ok) reject('INVALID_REQUEST', result.message)
        const acceptedSeq = session.acceptedSeq + 1
        const recoveryOutcome = await recovery.stage(session.sessionId, result.snapshot, acceptedSeq,
          controller.recoveryMeta(session, result.snapshot))
        session.snapshot = result.snapshot
        session.acceptedSeq = acceptedSeq
        const value: SketchIngestValue = {
          acceptedSeq, draftId: result.data.draftId, candidates: result.data.candidates,
          snapshot: toSnapshotDto(result.snapshot), recovery: recoveryOutcome.state,
        }
        if (recoveryOutcome.warning !== undefined) value.warning = recoveryOutcome.warning
        return value
      },
    },
    ipcDeps,
  )
}
