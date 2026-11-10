/**
 * D：参数联动 IPC 通道（change:stage/preview/apply/bind/unbind/compare/restore）。
 *
 * 全部走 installChannel：sender 白名单 → strict zod schema → handler → 统一包络。
 * renderer 只传会话、token、十进制字符串、稳定 ID 与理由；不能传路径、图元、
 * DrawingData、事件或“已确认=true”。路径只由 main 对话框决定。
 */
import { z } from 'zod'
import type {
  ChangeApplyValue,
  ChangeCompareValueResponse,
  ChangeDraftValue,
  ChangePreviewValue,
  ChangeRestoreValue,
  IpcErrorCode,
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
const reasonSchema = z.string().max(500)

const bindingSchema = z
  .object({
    termId: idLike,
    partId: idLike,
    parameterId: idLike,
  })
  .strict()

const schemas = {
  stage: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseEditSeq: z.number().int().nonnegative(),
      inputs: z
        .object({
          innerDiameter: z.string().max(32),
          outerDiameter: z.string().max(32),
          length: z.string().max(32),
        })
        .strict(),
      sourceNotes: z
        .object({
          innerDiameter: z.string().max(2000).optional(),
          outerDiameter: z.string().max(2000).optional(),
          length: z.string().max(2000).optional(),
        })
        .strict()
        .optional(),
      bindings: z.array(bindingSchema).max(200).optional(),
      reason: reasonSchema,
    })
    .strict(),
  preview: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseToken: tokenSchema,
      draftToken: tokenSchema,
    })
    .strict(),
  apply: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseToken: tokenSchema,
      draftToken: tokenSchema,
      previewId: idLike,
      previewToken: tokenSchema,
      requestId: idLike,
      reason: reasonSchema,
    })
    .strict(),
  bind: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseEditSeq: z.number().int().nonnegative(),
      termId: idLike,
      partId: idLike,
      parameterId: idLike,
      replaceBindingId: idLike.optional(),
      reason: reasonSchema,
    })
    .strict(),
  unbind: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseEditSeq: z.number().int().nonnegative(),
      bindingId: idLike,
      reason: reasonSchema,
    })
    .strict(),
  compare: z
    .object({
      sessionId: z.string().min(1).max(200),
      leftRevisionId: idLike.optional(),
      rightDraftToken: tokenSchema.optional(),
      drawingId: idLike.optional(),
    })
    .strict(),
  restore: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseToken: tokenSchema,
      sourceRevisionId: idLike,
      reason: reasonSchema,
    })
    .strict(),
} as const

export interface ChangeChannelDeps {
  guard: SenderGuard
  controller: SessionController
  changeService: ChangeService
  log?: IpcDeps['log']
}

function unwrap<T>(result: ChangeResult<T>): T {
  if (result.ok) {
    return result.value
  }
  throw new IpcFailure(
    result.error.code as IpcErrorCode,
    result.error.message,
    result.error.detail,
  )
}

export function registerChangeChannels(ipc: IpcMainLike, deps: ChangeChannelDeps): void {
  const ipcDeps: IpcDeps = { guard: deps.guard, log: deps.log }

  function requireActive(windowId: number, sessionId: string): void {
    if (deps.controller.sessionIdFor(windowId) !== sessionId) {
      throw new IpcFailure('STALE_SESSION', '会话已失效，请重新打开项目')
    }
  }

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.changeStage,
      schema: schemas.stage,
      handle: async ({ sender }, params): Promise<ChangeDraftValue> => {
        requireActive(sender.webContentsId, params.sessionId)
        return unwrap(await deps.changeService.stage(params.sessionId, params))
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.changePreview,
      schema: schemas.preview,
      handle: async ({ sender }, params): Promise<ChangePreviewValue> => {
        requireActive(sender.webContentsId, params.sessionId)
        return unwrap(
          await deps.changeService.preview(params.sessionId, params.baseToken, params.draftToken),
        )
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.changeApply,
      schema: schemas.apply,
      handle: async ({ sender }, params): Promise<ChangeApplyValue> => {
        requireActive(sender.webContentsId, params.sessionId)
        return unwrap(await deps.changeService.apply(params))
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.changeBind,
      schema: schemas.bind,
      handle: async ({ sender }, params): Promise<ChangeDraftValue> => {
        requireActive(sender.webContentsId, params.sessionId)
        return unwrap(await deps.changeService.bind(params.sessionId, params))
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.changeUnbind,
      schema: schemas.unbind,
      handle: async ({ sender }, params): Promise<ChangeDraftValue> => {
        requireActive(sender.webContentsId, params.sessionId)
        return unwrap(await deps.changeService.unbind(params.sessionId, params))
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.changeCompare,
      schema: schemas.compare,
      handle: async ({ sender }, params): Promise<ChangeCompareValueResponse> => {
        requireActive(sender.webContentsId, params.sessionId)
        return unwrap(await deps.changeService.compare(params.sessionId, params))
      },
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.changeRestore,
      schema: schemas.restore,
      handle: async ({ sender }, params): Promise<ChangeRestoreValue> => {
        requireActive(sender.webContentsId, params.sessionId)
        return unwrap(await deps.changeService.restore(params.sessionId, params))
      },
    },
    ipcDeps,
  )
}
