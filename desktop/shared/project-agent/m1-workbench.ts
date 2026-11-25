import type {
  M1CancelChatRequest, M1ChatRequest, M1ChatResult, M1ModelConnectionRequest, M1ModelConnectionResult, M1ModelResult,
} from './m1-model-api'
import type { M1Activity } from './m1-fields'

export type M1WorkbenchScope = { projectId: string; scopeEpoch: number }
export type M1EntrySource = 'local-agent' | 'model-api'
export type M1LocalAgentInstallInfo = {
  installPath: string
  bridgeCommand: string
  bridgeArgs?: readonly string[]
  mcpServerName?: string
  mcpConfigJson?: string
  connectPrompt?: string
}
export type M1ConnectionStatusSnapshot = {
  connectionState: 'disconnected' | 'connecting' | 'connected'
  source: M1EntrySource | 'none'
  clientName: string | null
  projectId: string
  projectName?: string
  baseRevision?: string | null
  draftRevision: string | null
  authorizationState: 'unauthorized' | 'authorized-readonly' | 'authorized-writable'
  writerEpoch: number
  writerOccupied: boolean
  writerOwner?: string | null
}
export type M1ExternalActivity = M1Activity & { title: string }
export type M1ExternalActivities = { activities: M1ExternalActivity[]; draftRevision: string | null }
export type M1WorkbenchEvent = {
  projectId: string
  scopeEpoch: number
  writerEpoch: number
  sequence: number
  baseRevision: string | null
  draftRevision: string | null
  jobId: string | null
} & (
  | { type: 'activity_updated'; activity: M1ExternalActivity }
  | { type: 'draft_updated' }
  | { type: 'connection_changed'; connectionState: M1ConnectionStatusSnapshot['connectionState']; clientName: string | null }
  | { type: 'snapshot_required'; snapshot: M1ConnectionStatusSnapshot; activities: M1ExternalActivity[] }
)
export type M1SubscribeRequest = M1WorkbenchScope & { afterSequence?: number }
export type M1ReconnectRequest = M1WorkbenchScope & { source: M1EntrySource; requestId: string }
export type M1TakeoverRequest = {
  projectId: string
  draftRevision: string | null
  requestId: string
  previousScopeEpoch: number
  nextScopeEpoch: number
  targetSource: M1EntrySource
}
export type M1TakeoverResult = {
  projectId: string
  draftRevision: string | null
  writerEpoch: number
  scopeEpoch: number
  writerOwner: string
  revokedPreviousWriter: true
}

export interface M1WorkbenchApi {
  getM1LocalAgentInstallInfo(): Promise<M1ModelResult<M1LocalAgentInstallInfo>>
  getM1ConnectionStatus(request: M1WorkbenchScope): Promise<M1ModelResult<M1ConnectionStatusSnapshot>>
  testM1ModelApiConnection(request: M1ModelConnectionRequest): Promise<M1ModelResult<M1ModelConnectionResult>>
  sendM1ChatMessage(request: M1ChatRequest): Promise<M1ModelResult<M1ChatResult>>
  cancelM1ChatMessage(request: M1CancelChatRequest): Promise<M1ModelResult<{ cancelled: true }>>
  getM1ExternalActivities(request: M1WorkbenchScope): Promise<M1ModelResult<M1ExternalActivities>>
  subscribeM1WorkbenchEvents(request: M1SubscribeRequest, listener: (event: M1WorkbenchEvent) => void):
    Promise<M1ModelResult<{ subscriptionId: string; unsubscribe(): void }>>
  reconnectM1Session(request: M1ReconnectRequest): Promise<M1ModelResult<M1ConnectionStatusSnapshot>>
  takeoverM1Draft(request: M1TakeoverRequest): Promise<M1ModelResult<M1TakeoverResult>>
}
