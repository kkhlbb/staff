/**
 * V3.6：任务书 PDF 提取 IPC（extraction:run / decide / cancel）。
 *
 * 通道层只做 sender/会话/参数形状校验；版本解析、哈希、页范围、预算、取消、
 * 候选出处与决定门禁都在 ExtractionService/main 内完成。renderer 不能传路径、
 * blobKey、sha256、actor、decidedAt 或最终状态。
 */
import { z } from 'zod'
import type {
  ExtractionCancelValue,
  ExtractionDecideValue,
  ExtractionDeleteDraftValue,
  ExtractionRunValue,
  IpcErrorCode,
  IpcResult,
} from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'
import { IpcFailure, installChannel, type IpcDeps, type IpcMainLike } from './ipc'
import type { SenderGuard } from './senderGuard'
import type { SessionController } from './sessionController'
import type { ExtractionService } from './extractionService'

const idLike = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (value) =>
      !value.includes('/') &&
      !value.includes('\\') &&
      !value.includes('\u0000') &&
      value !== '.' &&
      value !== '..',
    { message: 'ID 不能是路径' },
  )

const requestIdSchema = z.string().min(1).max(120)

export const extractionSchemas = {
  run: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseEditSeq: z.number().int().nonnegative(),
      revisionId: idLike,
      pageFrom: z.number().int().min(1).max(1000),
      pageTo: z.number().int().min(1).max(1000),
      requestId: requestIdSchema,
    })
    .strict(),
  decide: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseEditSeq: z.number().int().nonnegative(),
      draftId: idLike,
      candidateId: idLike,
      editRevision: z.number().int().nonnegative(),
      action: z.enum(['confirm', 'reject', 'edit', 'revoke']),
      confirmed: z.literal(true).optional(),
      reason: z.string().max(2000).optional(),
      field: z
        .enum([
          'nominal',
          'upperDeviation',
          'lowerDeviation',
          'lower',
          'upper',
          'innerDiameter',
          'outerDiameter',
          'length',
        ])
        .optional(),
      text: z.string().min(1).max(64).optional(),
    })
    .strict(),
  cancel: z
    .object({
      sessionId: z.string().min(1).max(200),
      requestId: requestIdSchema,
    })
    .strict(),
  deleteDraft: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseEditSeq: z.number().int().nonnegative(),
      draftId: idLike,
    })
    .strict(),
} as const

export interface ExtractionChannelDeps {
  guard: SenderGuard
  controller: SessionController
  service: ExtractionService
  issuePlanToken?: (windowId: number, draftId: string) => Promise<string | null>
  log?: IpcDeps['log']
}

function unwrap<T>(result: IpcResult<T>): T {
  if (result.ok) return result.value
  throw new IpcFailure(
    result.error.code as IpcErrorCode,
    result.error.message,
    result.error.detail,
  )
}

export function registerExtractionChannels(
  ipc: IpcMainLike,
  deps: ExtractionChannelDeps,
): void {
  const ipcDeps: IpcDeps = { guard: deps.guard, log: deps.log }

  function requireActive(windowId: number, sessionId: string): void {
    if (deps.controller.sessionIdFor(windowId) !== sessionId) {
      throw new IpcFailure('STALE_SESSION', '会话已失效，请重新打开项目')
    }
  }

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.extractionRun,
      schema: extractionSchemas.run,
      handle: async ({ sender }, params): Promise<ExtractionRunValue> => {
        requireActive(sender.webContentsId, params.sessionId)
        return unwrap(await deps.service.run(sender.webContentsId, params))
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.extractionDecide,
      schema: extractionSchemas.decide,
      handle: async ({ sender }, params): Promise<ExtractionDecideValue> => {
        requireActive(sender.webContentsId, params.sessionId)
        const value = unwrap(await deps.service.decide(params))
        if (params.action === 'confirm' && deps.issuePlanToken !== undefined) {
          const token = await deps.issuePlanToken(sender.webContentsId, params.draftId)
          if (token !== null) value.planToken = token
          else value.warning = '决定尚未持久化，应用计划凭据未签发；请重试确认'
        }
        return value
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.extractionCancel,
      schema: extractionSchemas.cancel,
      handle: async ({ sender }, params): Promise<ExtractionCancelValue> => {
        requireActive(sender.webContentsId, params.sessionId)
        return unwrap(deps.service.cancel(sender.webContentsId, params))
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.extractionDeleteDraft,
      schema: extractionSchemas.deleteDraft,
      handle: async ({ sender }, params): Promise<ExtractionDeleteDraftValue> => {
        requireActive(sender.webContentsId, params.sessionId)
        return unwrap(await deps.service.deleteDraft(params))
      },
    },
    ipcDeps,
  )
}
