/**
 * V3.5：桌面 PDF 导入 / 同文档换版（主进程）。
 *
 * 安全与一致性边界：
 * - 文件路径只来自 main 的系统对话框；renderer 不能传路径/字节/blobKey；
 * - lstat 必须是常规文件、不跟随符号链接；空文件、超限在整文件读取前拒绝；
 * - main 自算 SHA-256、页数与每页 pageBoxPdf，不信任 renderer 传入的任何几何；
 * - 每次导入新增不可变 SourceRevision 与独立 blob（不复用旧 blobKey）；
 * - 中途任何校验失败都不修改会话快照：不存在半截文档/半截附件；
 * - 成功后只更新 main 内存聚合并写恢复草稿；正式落盘仍走用户保存/原子提交。
 *
 * 这里不使用依赖 IndexedDB 的 sources/bindings.ts 写入函数。
 */
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { z } from 'zod'
import type { SourceImportValue, IpcErrorCode } from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'
import type { ChangeEvent } from '../../src/history/events'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import { toSnapshotDto } from '../../src/project-file/codec'
import { expectedEntryRoles, validateProjectAssetBudget } from '../../src/project-file/validation'
import { DEFAULT_SOURCE_LIMITS, formatMiB } from '../../src/sources/limits'
import { sha256Hex } from '../../src/sources/hash'
import { SourcePdfInspectError, inspectSourcePdf, type SourcePdfInspection } from './pdfSourceInspect'
import { IpcFailure, installChannel, type IpcDeps, type IpcMainLike } from './ipc'
import { validateSnapshot, type ModelFileIo } from './modelChannels'
import type { ProjectService, ProjectSession } from './projectService'
import type { RecoveryStore } from './recovery'
import type { SessionController } from './sessionController'
import type { SenderGuard } from './senderGuard'

export const sourceSchemas = {
  import: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseEditSeq: z.number().int().nonnegative(),
      documentId: z.string().min(1).max(240).nullable().optional(),
    })
    .strict(),
} as const

export interface SourceChannelDeps {
  guard: SenderGuard
  controller: SessionController
  projectService: ProjectService
  recovery: RecoveryStore
  /** 系统对话框；只选单个 PDF。取消返回 null。 */
  pickSourcePath: (windowId: number) => Promise<string | null>
  io: ModelFileIo
  /** 测试注入；生产使用真实 pdfjs 解析。 */
  inspectPdf?: (bytes: Uint8Array) => Promise<SourcePdfInspection>
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

function mib(bytes: number): string {
  return formatMiB(bytes)
}

export function registerSourceChannels(ipc: IpcMainLike, deps: SourceChannelDeps): void {
  const now = deps.now ?? (() => new Date())
  const newId = deps.newId ?? (() => randomUUID())
  const inspectPdf = deps.inspectPdf ?? ((bytes: Uint8Array) => inspectSourcePdf(bytes, { maxPages: DEFAULT_SOURCE_LIMITS.maxPages }))
  const ipcDeps: IpcDeps = { guard: deps.guard, log: deps.log, sessionTransactions: deps.projectService }
  const { controller, recovery } = deps

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.sourceImport,
      schema: sourceSchemas.import,
      handle: async ({ sender }, params): Promise<SourceImportValue> => {
        const windowId = sender.webContentsId
        const session = requireSession(controller, windowId, params.sessionId)
        if (params.baseEditSeq !== session.acceptedSeq) {
          reject(
            'STALE_EDIT',
            '导入期间项目已发生其它编辑，请重试',
            `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${params.baseEditSeq}`,
          )
        }
        const snapshot = session.snapshot

        // 早期拒绝：文档不存在 / 已是不同项目。
        const existingDocument =
          params.documentId === undefined || params.documentId === null
            ? null
            : (snapshot.documents.find((item) => item.id === params.documentId) ?? null)
        if (params.documentId !== undefined && params.documentId !== null && existingDocument === null) {
          reject('SOURCE_NOT_FOUND', '要换版的来源文档不存在或不属于当前项目', params.documentId)
        }
        if (existingDocument !== null && existingDocument.projectId !== snapshot.project.id) {
          reject('SOURCE_NOT_FOUND', '要换版的来源文档不属于当前项目', params.documentId ?? '')
        }

        const picked = await deps.pickSourcePath(windowId)
        if (picked === null) {
          reject('CANCELLED', '已取消选择 PDF 文件')
        }
        const kind = await deps.io.kindOf(picked)
        if (kind === 'missing') reject('NOT_FOUND', 'PDF 文件不存在或已移动')
        if (kind !== 'file') {
          reject('READ_FAILED', 'PDF 不是常规文件（不允许符号链接或目录）', kind)
        }
        const size = await deps.io.sizeOf(picked)
        if (size === null) reject('READ_FAILED', '无法读取 PDF 文件大小')
        if (size === 0) reject('SOURCE_UNREADABLE', 'PDF 为空（0 字节）')
        if (size > DEFAULT_SOURCE_LIMITS.maxFileBytes) {
          reject(
            'TOO_LARGE',
            `PDF 超过单文件上限 ${mib(DEFAULT_SOURCE_LIMITS.maxFileBytes)}`,
            `实际 ${size} 字节，上限 ${DEFAULT_SOURCE_LIMITS.maxFileBytes} 字节`,
          )
        }
        let bytes: Uint8Array
        try {
          bytes = await deps.io.readUpTo(picked, DEFAULT_SOURCE_LIMITS.maxFileBytes + 1)
        } catch (error) {
          reject(
            'READ_FAILED',
            '读取 PDF 文件失败',
            error instanceof Error ? error.message : String(error),
          )
        }
        if (bytes.byteLength > DEFAULT_SOURCE_LIMITS.maxFileBytes) {
          reject(
            'TOO_LARGE',
            `PDF 超过单文件上限 ${mib(DEFAULT_SOURCE_LIMITS.maxFileBytes)}`,
            `读取到 ${bytes.byteLength} 字节`,
          )
        }
        const afterSize = await deps.io.sizeOf(picked)
        if (afterSize !== null && afterSize !== bytes.byteLength) {
          reject(
            'FILE_CHANGED',
            'PDF 在读取期间发生变化，请重新选择',
            `读取前 ${size} 字节，读取后 ${afterSize} 字节`,
          )
        }

        const digest = await sha256Hex(bytes)
        let inspection: SourcePdfInspection
        try {
          inspection = await inspectPdf(bytes)
        } catch (error) {
          if (error instanceof SourcePdfInspectError) {
            reject(error.code === 'SOURCE_PAGE_LIMIT' ? 'TOO_LARGE' : 'SOURCE_UNREADABLE', error.message)
          }
          reject(
            'SOURCE_UNREADABLE',
            'PDF 无法解析，已拒绝导入',
            error instanceof Error ? error.message : String(error),
          )
        }

        const createdAt = now().toISOString()
        const documentId = existingDocument?.id ?? `doc-${newId()}`
        const revisionId = `sr-${newId()}`
        const blobKey = `blob-${newId()}`
        const fileName = basename(picked)

        const next: ProjectFileSnapshot = {
          ...snapshot,
          project: {
            ...snapshot.project,
            updatedAt: createdAt,
          },
          documents: existingDocument === null
            ? [
                ...snapshot.documents,
                {
                  id: documentId,
                  projectId: snapshot.project.id,
                  title: fileName,
                  latestRevisionId: revisionId,
                },
              ]
            : snapshot.documents.map((item) =>
                item.id === documentId ? { ...item, latestRevisionId: revisionId } : item,
              ),
          revisions: [
            ...snapshot.revisions,
            {
              id: revisionId,
              projectId: snapshot.project.id,
              documentId,
              fileName,
              sha256: digest,
              byteSize: bytes.byteLength,
              pageCount: inspection.pageCount,
              createdAt,
              blobKey,
            },
          ],
          blobs: [
            ...snapshot.blobs,
            {
              blobKey,
              projectId: snapshot.project.id,
              sha256: digest,
              byteSize: bytes.byteLength,
            },
          ],
          // 每次导入独立 blob，不复用旧版本；旧 revision 与字节保留。
          attachments: [...snapshot.attachments, { blobKey, bytes }],
          events: [
            ...snapshot.events,
            {
              id: `source_import:${revisionId}`,
              projectId: snapshot.project.id,
              type: 'source_import',
              createdAt,
              documentId,
              revisionId,
              after: fileName,
            } satisfies ChangeEvent,
          ],
        }

        const budget = validateProjectAssetBudget(next)
        if (!budget.ok) {
          reject(budget.error.code, budget.error.message, budget.error.detail)
        }
        if (expectedEntryRoles(next).length + 1 > 500) {
          reject(
            'TOO_MANY_ENTRIES',
            '导入后将超过项目文件 500 条目上限（含 manifest）',
            `导入后附件 ${next.blobs.length} 个`,
          )
        }
        const validated = validateSnapshot(next, snapshot)
        if (!validated.ok) {
          reject(validated.error.code, validated.error.message, validated.error.detail)
        }

        // 所有校验通过后才替换会话快照：失败路径不会留下半截记录。
        session.snapshot = next
        session.acceptedSeq = params.baseEditSeq + 1
        const recoveryOutcome = await recovery.stage(
          session.sessionId,
          session.snapshot,
          session.acceptedSeq,
          controller.recoveryMeta(session, session.snapshot),
        )
        const value: SourceImportValue = {
          acceptedSeq: session.acceptedSeq,
          documentId,
          revisionId,
          blobKey,
          fileName,
          sha256: digest,
          byteSize: bytes.byteLength,
          pageCount: inspection.pageCount,
          pages: inspection.pages.map((page) => ({ ...page, pageBoxPdf: [...page.pageBoxPdf] })),
          snapshot: toSnapshotDto(next),
          recovery: recoveryOutcome.state,
        }
        if (recoveryOutcome.warning !== undefined) value.warning = recoveryOutcome.warning
        return value
      },
    },
    ipcDeps,
  )
}
