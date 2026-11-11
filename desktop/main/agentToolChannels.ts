import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { IPC_CHANNELS, type ToolResult } from '../shared/contracts'
import { toSenderInfo, type IpcMainLike } from './ipc'
import type { SenderGuard } from './senderGuard'
import type { AgentToolService } from './agentToolService'

const id = z.string().min(1).max(240)
const basis = { draftId: id, baseRevisionId: id }
const parameter = z.enum(['innerDiameter', 'outerDiameter', 'length'])
export const agentToolSchemas = {
  context: z.object({}).strict(),
  confirmed: z.object({ draftId: id }).strict(),
  apply: z.preprocess(value => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    // Untrusted identity/confirmation claims have NO authority; the saved decision is read below.
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['confirmed', 'user', 'approvedBy'].includes(key)))
  }, z.object({ planToken: id, baseRevisionId: id, candidateIds: z.array(id).min(1).max(200), mapping: z.object({
    spacerPart: z.literal('builtin:shaft-demo:spacer').optional(), ringSymbols: z.array(id).max(20).optional(),
    formulaId: id.optional(), requirement: z.boolean().optional(), linkLengthToSymbol: id.optional(),
  }).strict() }).strict()),
  stage: z.object({ toolMode: z.literal('agent'), ...basis, parameter, valueMm: z.string().max(32).optional(), deltaMm: z.string().max(32).optional(), lockedKeys: z.array(parameter).max(3) }).strict()
    .refine(value => (value.valueMm === undefined) !== (value.deltaMm === undefined), '必须提供且仅提供 valueMm 或 deltaMm'),
  preview: z.object({ toolMode: z.literal('agent'), ...basis }).strict(),
}
type Command = keyof typeof agentToolSchemas
interface Deps { guard: SenderGuard; service: AgentToolService }

export async function dispatchAgentTool(deps: Deps, event: Parameters<typeof toSenderInfo>[0], command: Command, input: unknown): Promise<ToolResult<unknown>> {
  const sender = toSenderInfo(event)
  const rejected = (code: 'INVALID_INPUT' | 'STALE_BASE', message: string): ToolResult<never> => ({ ok: false, code, message, requestId: randomUUID(), objectVersion: 'unavailable' })
  if (!deps.guard.verify(sender).ok) return rejected('INVALID_INPUT', '不可信的调用窗口')
  const parsed = agentToolSchemas[command].safeParse(input ?? {})
  if (!parsed.success) return rejected('INVALID_INPUT', '工具参数校验失败')
  return deps.service.run(sender.webContentsId, command, parsed.data)
}

/** Reuse legacy change channels with an explicit discriminant; old IPC result contracts stay intact. */
export function agentChangeRouter(ipc: IpcMainLike, deps: Deps): IpcMainLike {
  return { on: ipc.on.bind(ipc), handle(channel, legacy) {
    if (channel !== IPC_CHANNELS.changeStage && channel !== IPC_CHANNELS.changePreview) { ipc.handle(channel, legacy); return }
    ipc.handle(channel, async (event, ...args) => {
      const input = args[0]
      if (typeof input === 'object' && input !== null && 'toolMode' in input) {
        // IpcMainLike is the legacy port; Electron itself transports either contract unchanged.
        return dispatchAgentTool(deps, event, channel === IPC_CHANNELS.changeStage ? 'stage' : 'preview', input) as never
      }
      return legacy(event, ...args)
    })
  } }
}

export function registerAgentToolChannels(ipc: IpcMainLike, deps: Deps): void {
  for (const [channel, command] of [[IPC_CHANNELS.agentContext, 'context'], [IPC_CHANNELS.agentConfirmedInputs, 'confirmed'], [IPC_CHANNELS.agentApplyConfirmed, 'apply']] as const) {
    ipc.handle(channel, (event, input) => dispatchAgentTool(deps, event, command, input) as never)
  }
}
