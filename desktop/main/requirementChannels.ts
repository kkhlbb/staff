/**
 * V3.5：任务书条款 IPC（requirement:edit / requirement:confirm）。
 *
 * renderer 只传：会话、基准 token、来源版本与 PDF 空间选区、原文、mm 文本与
 * 更新理由。路径、blobKey、字节、判定结果一律由 main 解析/校验；确认必须带
 * `confirmed: true`，不存在“未确认也算确认”的请求形态。
 */
import { z } from 'zod'
import type {
  IpcErrorCode,
  RequirementConfirmValue,
  RequirementEditValue,
} from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'
import { IpcFailure, installChannel, type IpcDeps, type IpcMainLike } from './ipc'
import type { SenderGuard } from './senderGuard'
import type { ChangeResult, ChangeService } from './changeService'
import type { SessionController } from './sessionController'

const idLike = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => !value.includes('/') && !value.includes('\\') && !value.includes('\u0000'), {
    message: 'ID 不能是路径',
  })
const tokenSchema = z.string().regex(/^[0-9a-f]{16,64}$/)
const rectSchema = z
  .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
  .refine((values) => values.every((value) => Math.abs(value) <= 1_000_000), {
    message: '坐标超出允许范围',
  })

const requirementSourceSchema = z
  .object({
    documentId: idLike,
    revisionId: idLike,
    page: z.number().int().min(1).max(1000),
    rectPdf: rectSchema,
    pageBoxPdf: rectSchema,
  })
  .strict()

const schemas = {
  edit: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseEditSeq: z.number().int().nonnegative(),
      edit: z
        .object({
          requirementId: idLike.nullable(),
          editRevision: z.number().int().nonnegative(),
          confirmedText: z.string().max(20000),
          lowerText: z.string().max(64),
          upperText: z.string().max(64),
          source: z
            .object({
              documentId: idLike.nullable(),
              revisionId: idLike.nullable(),
              page: z.number().int().min(1).max(1000).nullable(),
              rectPdf: rectSchema.nullable(),
              pageBoxPdf: rectSchema.nullable(),
            })
            .strict(),
        })
        .strict()
        .nullable(),
    })
    .strict(),
  confirm: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseToken: tokenSchema,
      expectedActiveRequirementRevisionId: idLike.nullable(),
      requirementId: idLike.nullable(),
      source: requirementSourceSchema,
      confirmedText: z.string().min(1).max(20000),
      lowerText: z.string().max(64),
      upperText: z.string().max(64),
      changeReason: z.string().max(500),
      confirmed: z.literal(true),
    })
    .strict(),
} as const

export interface RequirementChannelDeps {
  guard: SenderGuard
  controller: SessionController
  changeService: ChangeService
  log?: IpcDeps['log']
}

function unwrap<T>(result: ChangeResult<T>): T {
  if (result.ok) return result.value
  throw new IpcFailure(
    result.error.code as IpcErrorCode,
    result.error.message,
    (result.error as { detail?: string }).detail,
  )
}

export function registerRequirementChannels(
  ipc: IpcMainLike,
  deps: RequirementChannelDeps,
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
      channel: IPC_CHANNELS.requirementEdit,
      schema: schemas.edit,
      handle: async ({ sender }, params): Promise<RequirementEditValue> => {
        requireActive(sender.webContentsId, params.sessionId)
        return unwrap(await deps.changeService.stageRequirementEdit(params.sessionId, params))
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.requirementConfirm,
      schema: schemas.confirm,
      handle: async ({ sender }, params): Promise<RequirementConfirmValue> => {
        requireActive(sender.webContentsId, params.sessionId)
        return unwrap(await deps.changeService.confirmRequirement(params.sessionId, params))
      },
    },
    ipcDeps,
  )
}
