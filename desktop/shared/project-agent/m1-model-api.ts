import { z } from 'zod'

const id = z.string().min(1).max(160)
const epoch = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const scope = { projectId: id, requestId: id, scopeEpoch: epoch }
const chatText = z.string().trim().min(1).max(16_000)

export const m1ModelConnectionRequest = z.object({
  ...scope, baseUrl: z.string().trim().min(1).max(2048), model: z.string().trim().min(1).max(120),
  apiKey: z.string().max(4096), contextPreview: z.boolean(),
}).strict()
export const m1ModelListRequest = m1ModelConnectionRequest.omit({ model: true, contextPreview: true })
export type M1ModelListRequest = z.infer<typeof m1ModelListRequest>
export type M1ModelListResult = { models: string[]; defaultModel: string | null }

export const m1ChatRequest = z.object({
  ...scope, writerEpoch: epoch, prompt: chatText, attachments: z.array(id).max(8),
  selectedObject: id.nullable(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: chatText }).strict()).max(32),
}).strict()
export const m1CancelChatRequest = z.object(scope).strict()

export type M1ModelConnectionRequest = z.infer<typeof m1ModelConnectionRequest>
type ParsedM1ChatRequest = z.infer<typeof m1ChatRequest>
export type M1ChatRequest = Omit<ParsedM1ChatRequest, 'attachments' | 'history'> & {
  attachments: readonly string[]
  history: readonly ParsedM1ChatRequest['history'][number][]
}
export type M1CancelChatRequest = z.infer<typeof m1CancelChatRequest>
export type M1ModelConnectionResult = {
  availableModels: string[]
  selectedModel: string
  toolCallSupported: boolean
  toolRoundTripPassed: boolean
  toolRoundTripName?: string
  toolRoundTripLatencyMs?: number
  sentContextSummary?: string
}
export type M1ChatResult = {
  messageId: string
  reply: string
  draftRevision?: string
  toolCalls?: { name: string; status: 'awaitingInput' | 'succeeded'; taskId?: string }[]
  scopeEpoch?: number
  writerEpoch?: number
}
export type M1ModelResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; detail?: string } }
