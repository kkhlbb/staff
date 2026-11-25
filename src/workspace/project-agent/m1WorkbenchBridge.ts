/**
 * Narrow duck-typing bridge for M1-FE-02 Workbench (onboarding, local Agent,
 * model API tool round-trip, dual-entry sidebar, and disconnect takeover).
 *
 * Boundary rules:
 * - Never modifies frozen `desktop/shared/contracts.ts`, `desktop/preload`, or `desktop/main`.
 * - Never fabricates backend success or credentials when methods are missing.
 */

import type { EntryScope } from '../../../desktop/shared/project-agent/m1-entry-1933.ts'
import type { M1AuthorizationRequest } from '../../../desktop/shared/project-agent/m1-local-authorization-2002.ts'

export type M1WorkbenchErrorCode =
  | 'AUTH_FAILED'
  | 'AUTH_REQUIRED'
  | 'INVALID_API_KEY'
  | 'UNAUTHORIZED'
  | 'TOOL_CALL_UNSUPPORTED'
  | 'TOOL_ROUNDTRIP_FAILED'
  | 'DISCONNECTED'
  | 'WRITER_HELD'
  | 'WRITER_REVOKED'
  | 'CANCELLED'
  | 'BACKEND_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'NETWORK_ERROR'
  | 'INTERNAL'

export interface M1WorkbenchErrorPayload {
  readonly code: M1WorkbenchErrorCode | (string & {})
  readonly message: string
  readonly detail?: string
}

export type M1WorkbenchBridgeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: M1WorkbenchErrorPayload }

export type M1ConnectionSource = 'none' | 'local-agent' | 'model-api'
export type M1ClientConnectionState = 'disconnected' | 'connecting' | 'connected'
export type M1ProjectAuthorizationState =
  | 'unauthorized'
  | 'authorized-readonly'
  | 'authorized-writable'

export interface M1LocalAgentInstallInfo {
  readonly installPath: string
  readonly bridgeCommand: string
  readonly bridgeArgs?: readonly string[]
  readonly mcpServerName?: string
  readonly mcpConfigJson?: string
  readonly connectPrompt?: string
}

export interface M1ConnectionStatusSnapshot {
  readonly connectionState: M1ClientConnectionState
  readonly source: M1ConnectionSource
  readonly clientName: string | null
  readonly projectId: string
  readonly projectName?: string
  readonly baseRevision?: string | null
  readonly draftRevision: string | null
  readonly authorizationState: M1ProjectAuthorizationState
  readonly writerEpoch: number
  readonly writerOccupied: boolean
  readonly writerOwner?: string | null
}

export interface M1TaskbookReference {
  readonly refId: string
  readonly documentName: string
  readonly page: number
  readonly excerpt: string
}

export interface M1SelectedObjectRef {
  readonly objectId: string
  readonly breadcrumb: string
  readonly featureRef: string
}

export interface M1OutgoingContextSummary {
  readonly projectId: string
  readonly projectName: string
  readonly draftRevision: string | null
  readonly selectedObject: M1SelectedObjectRef | null
  readonly documentExcerpts: readonly M1TaskbookReference[]
}

export interface M1ModelApiTestRequest {
  readonly baseUrl: string
  readonly model: string
  readonly apiKey: string
  readonly projectId: string
  readonly requestId: string
  readonly scopeEpoch: number
  readonly contextPreview: boolean
}

export interface M1ModelApiTestResult {
  readonly availableModels: readonly string[]
  readonly selectedModel: string
  readonly toolCallSupported: boolean
  readonly toolRoundTripPassed: boolean
  readonly toolRoundTripName?: string
  readonly toolRoundTripLatencyMs?: number
  readonly sentContextSummary?: string
}

export interface M1ChatHistoryItem {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

export interface M1BackendChatToolCall {
  readonly name: string
  readonly status: 'awaitingInput' | 'succeeded'
  readonly taskId?: string
}

export interface M1LegacyChatToolCallSummary {
  readonly toolName: string
  readonly status: 'succeeded' | 'failed'
  readonly summary: string
}

export type M1ChatToolCallItem =
  | M1BackendChatToolCall
  | M1LegacyChatToolCallSummary
  | string

export type M1ChatToolCallSummary = M1ChatToolCallItem

export interface M1ChatSendRequest {
  readonly projectId: string
  readonly requestId: string
  readonly scopeEpoch: number
  readonly writerEpoch: number
  readonly prompt: string
  readonly attachments: readonly string[]
  readonly selectedObject: string | null
  readonly history: readonly M1ChatHistoryItem[]
}

export interface M1ChatSendResult {
  readonly messageId: string
  readonly reply: string
  readonly draftRevision?: string | null
  readonly toolCalls?: readonly M1ChatToolCallItem[]
  readonly scopeEpoch?: number
  readonly writerEpoch?: number
}

export interface M1ExternalActivityQuestion {
  readonly questionId: string
  readonly reason: 'missing' | 'conflict' | 'ambiguousReference'
  readonly prompt: string
  readonly sourceExcerpt?: string
}

export interface M1ExternalActivityItem {
  readonly taskId: string
  readonly projectId: string
  readonly status: 'queued' | 'running' | 'awaitingInput' | 'interrupted' | 'succeeded' | 'failed' | 'cancelled'
  readonly title: string
  readonly lastStep?: string | null
  readonly draftRevision?: string | null
  readonly question?: M1ExternalActivityQuestion | null
  readonly previewSummary?: string | null
  readonly updatedAtLabel?: string
}

export interface M1DraftTakeoverRequest {
  readonly projectId: string
  readonly draftRevision: string | null
  readonly requestId: string
  readonly previousScopeEpoch: number
  readonly nextScopeEpoch: number
  readonly targetSource: 'local-agent' | 'model-api'
}

export interface M1DraftTakeoverResult {
  readonly projectId: string
  readonly draftRevision: string | null
  readonly writerEpoch: number
  readonly scopeEpoch: number
  readonly writerOwner: string
  readonly revokedPreviousWriter: true
}

export interface M1WorkbenchSubscribeRequest {
  readonly projectId: string
  readonly scopeEpoch: number
  readonly afterSequence?: number
}

export interface M1WorkbenchIncomingEvent {
  readonly projectId: string
  readonly scopeEpoch: number
  readonly writerEpoch: number
  readonly sequence: number
  readonly baseRevision?: string | null
  readonly draftRevision?: string | null
  readonly jobId?: string | null
  readonly type:
    | 'connection_changed'
    | 'activity_updated'
    | 'draft_updated'
    | 'chat_reply'
    | 'snapshot_required'
  readonly connectionState?: M1ClientConnectionState
  readonly clientName?: string | null
  readonly activity?: M1ExternalActivityItem
  readonly snapshot?: M1ConnectionStatusSnapshot
  readonly activities?: readonly M1ExternalActivityItem[]
  readonly chatMessage?: {
    readonly messageId: string
    readonly reply: string
  }
}

export type M1LocalAgentId = 'claude-code' | 'codex' | 'claude-desktop' | 'cursor' | 'windsurf'

export interface M1DetectedLocalAgent {
  readonly id: M1LocalAgentId
  readonly name: string
  readonly detected: boolean
  readonly configured: boolean
  readonly method: 'cli' | 'config-file'
  readonly configPath: string | null
  readonly detail?: string
}

export interface M1DetectLocalAgentsResult {
  readonly agents: readonly M1DetectedLocalAgent[]
}

export interface M1RegisterLocalAgentRequest {
  readonly agentId: M1LocalAgentId
}

export interface M1RegisterLocalAgentResult {
  readonly agentId: M1LocalAgentId
  readonly name: string
  readonly configured: true
  readonly method: 'cli' | 'config-file'
  readonly configPath: string | null
  readonly backupPath: string | null
  readonly message: string
  readonly requiresRestart?: boolean
}

export interface M1ListModelApiModelsRequest {
  readonly baseUrl: string
  readonly apiKey: string
  readonly projectId: string
  readonly requestId: string
  readonly scopeEpoch: number
}

export interface M1ListModelApiModelsResult {
  readonly models: readonly string[]
  readonly defaultModel: string | null
}

export interface M1WorkbenchBridge {
  readonly getM1LocalAgentInstallInfo?: () => Promise<
    M1WorkbenchBridgeResult<M1LocalAgentInstallInfo>
  >
  readonly getM1ConnectionStatus?: (request: {
    readonly projectId: string
    readonly scopeEpoch: number
  }) => Promise<M1WorkbenchBridgeResult<M1ConnectionStatusSnapshot>>
  readonly testM1ModelApiConnection?: (
    request: M1ModelApiTestRequest,
  ) => Promise<M1WorkbenchBridgeResult<M1ModelApiTestResult>>
  readonly sendM1ChatMessage?: (
    request: M1ChatSendRequest,
  ) => Promise<M1WorkbenchBridgeResult<M1ChatSendResult>>
  readonly cancelM1ChatMessage?: (request: {
    readonly projectId: string
    readonly requestId: string
    readonly scopeEpoch: number
  }) => Promise<M1WorkbenchBridgeResult<{ readonly cancelled: true }>>
  readonly getM1ExternalActivities?: (request: {
    readonly projectId: string
    readonly scopeEpoch: number
  }) => Promise<
    M1WorkbenchBridgeResult<{
      readonly activities: readonly M1ExternalActivityItem[]
      readonly draftRevision: string | null
    }>
  >
  readonly subscribeM1WorkbenchEvents?: (
    request: M1WorkbenchSubscribeRequest,
    listener: (event: M1WorkbenchIncomingEvent) => void,
  ) => Promise<
    M1WorkbenchBridgeResult<{
      readonly subscriptionId: string
      readonly unsubscribe?: () => void
    }>
  >
  readonly reconnectM1Session?: (request: {
    readonly projectId: string
    readonly source: 'local-agent' | 'model-api'
    readonly requestId: string
    readonly scopeEpoch: number
  }) => Promise<M1WorkbenchBridgeResult<M1ConnectionStatusSnapshot>>
  readonly takeoverM1Draft?: (
    request: M1DraftTakeoverRequest,
  ) => Promise<M1WorkbenchBridgeResult<M1DraftTakeoverResult>>
}

export const M1_WORKBENCH_BRIDGE_METHODS = [
  'getM1LocalAgentInstallInfo',
  'getM1ConnectionStatus',
  'testM1ModelApiConnection',
  'sendM1ChatMessage',
  'cancelM1ChatMessage',
  'getM1ExternalActivities',
  'subscribeM1WorkbenchEvents',
  'reconnectM1Session',
  'takeoverM1Draft',
] as const

export type M1WorkbenchBridgeMethodName = (typeof M1_WORKBENCH_BRIDGE_METHODS)[number]

export interface M1WorkbenchBridgeProbe {
  readonly bridge: M1WorkbenchBridge
  readonly capabilities: {
    readonly localAgentInstallInfo: boolean
    readonly connectionStatus: boolean
    readonly modelApiTest: boolean
    readonly builtinChat: boolean
    readonly cancelChat: boolean
    readonly externalActivities: boolean
    readonly eventSubscription: boolean
    readonly reconnect: boolean
    readonly takeover: boolean
  }
  readonly anyAvailable: boolean
  readonly missingMethods: readonly M1WorkbenchBridgeMethodName[]
}

export function probeM1WorkbenchBridge(candidate: unknown): M1WorkbenchBridgeProbe {
  const record =
    candidate !== null && typeof candidate === 'object'
      ? (candidate as Record<string, unknown>)
      : null

  const bindMethod = <K extends M1WorkbenchBridgeMethodName>(
    name: K,
  ): M1WorkbenchBridge[K] | undefined => {
    if (!record || typeof record[name] !== 'function') {
      return undefined
    }
    const fn = record[name] as (...args: unknown[]) => unknown
    return ((...args: unknown[]) => fn.apply(record, args)) as M1WorkbenchBridge[K]
  }

  const bridge: M1WorkbenchBridge = {
    getM1LocalAgentInstallInfo: bindMethod('getM1LocalAgentInstallInfo'),
    getM1ConnectionStatus: bindMethod('getM1ConnectionStatus'),
    testM1ModelApiConnection: bindMethod('testM1ModelApiConnection'),
    sendM1ChatMessage: bindMethod('sendM1ChatMessage'),
    cancelM1ChatMessage: bindMethod('cancelM1ChatMessage'),
    getM1ExternalActivities: bindMethod('getM1ExternalActivities'),
    subscribeM1WorkbenchEvents: bindMethod('subscribeM1WorkbenchEvents'),
    reconnectM1Session: bindMethod('reconnectM1Session'),
    takeoverM1Draft: bindMethod('takeoverM1Draft'),
  }

  const missingMethods: M1WorkbenchBridgeMethodName[] = []
  for (const name of M1_WORKBENCH_BRIDGE_METHODS) {
    if (typeof bridge[name] !== 'function') {
      missingMethods.push(name)
    }
  }

  const capabilities = {
    localAgentInstallInfo: typeof bridge.getM1LocalAgentInstallInfo === 'function',
    connectionStatus: typeof bridge.getM1ConnectionStatus === 'function',
    modelApiTest: typeof bridge.testM1ModelApiConnection === 'function',
    builtinChat: typeof bridge.sendM1ChatMessage === 'function',
    cancelChat: typeof bridge.cancelM1ChatMessage === 'function',
    externalActivities: typeof bridge.getM1ExternalActivities === 'function',
    eventSubscription: typeof bridge.subscribeM1WorkbenchEvents === 'function',
    reconnect: typeof bridge.reconnectM1Session === 'function',
    takeover: typeof bridge.takeoverM1Draft === 'function',
  }

  const anyAvailable = Object.values(capabilities).some(Boolean)

  return {
    bridge,
    capabilities,
    anyAvailable,
    missingMethods,
  }
}

export function resolveWindowM1WorkbenchBridge(): M1WorkbenchBridgeProbe {
  const candidate =
    typeof window !== 'undefined' ? (window as { cunlian?: unknown }).cunlian : undefined
  return probeM1WorkbenchBridge(candidate)
}

export type M1ProjectAuthorizationInvoker = (
  request: M1AuthorizationRequest,
) => Promise<M1WorkbenchBridgeResult<EntryScope>>

export interface M1ProjectAuthorizationProbe {
  readonly available: boolean
  readonly requestM1ProjectAuthorization?: M1ProjectAuthorizationInvoker
}

/**
 * Narrow duck-typing probe for native read-only project authorization
 * (`requestM1ProjectAuthorization`) on `window.cunlian` or injected props.
 */
export function probeM1ProjectAuthorization(candidate: unknown): M1ProjectAuthorizationProbe {
  const record =
    candidate !== null && typeof candidate === 'object'
      ? (candidate as Record<string, unknown>)
      : null
  if (!record || typeof record.requestM1ProjectAuthorization !== 'function') {
    return { available: false }
  }
  const fn = record.requestM1ProjectAuthorization as (
    request: M1AuthorizationRequest,
  ) => Promise<M1WorkbenchBridgeResult<EntryScope>>
  return {
    available: true,
    requestM1ProjectAuthorization: (request) => fn.call(record, request),
  }
}

export function resolveWindowM1ProjectAuthorization(): M1ProjectAuthorizationProbe {
  const candidate =
    typeof window !== 'undefined' ? (window as { cunlian?: unknown }).cunlian : undefined
  return probeM1ProjectAuthorization(candidate)
}

export function normalizeWorkbenchBridgeError(
  error: unknown,
  fallbackMessage: string,
): M1WorkbenchErrorPayload {
  if (error !== null && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const code =
      typeof record.code === 'string' && record.code.trim().length > 0
        ? record.code.trim()
        : 'INTERNAL'
    const message =
      typeof record.message === 'string' && record.message.trim().length > 0
        ? record.message.trim()
        : fallbackMessage
    return {
      code,
      message,
      ...(typeof record.detail === 'string' && record.detail.trim().length > 0
        ? { detail: record.detail.trim() }
        : {}),
    }
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return { code: 'INTERNAL', message: error.message.trim() }
  }
  return { code: 'INTERNAL', message: fallbackMessage }
}

export type ModelApiTestFailureKind =
  | 'auth_failed'
  | 'tool_call_unsupported'
  | 'tool_roundtrip_failed'
  | 'backend_unavailable'
  | 'other'

export function classifyModelApiFailure(
  error: M1WorkbenchErrorPayload | null,
  result?: M1ModelApiTestResult | null,
): { readonly kind: ModelApiTestFailureKind; readonly title: string; readonly detail: string } | null {
  if (error) {
    const code = error.code.toUpperCase()
    if (
      code === 'AUTH_FAILED' ||
      code === 'INVALID_API_KEY' ||
      code === 'UNAUTHORIZED' ||
      code === '401' ||
      code === '403'
    ) {
      return {
        kind: 'auth_failed',
        title: '鉴权失败',
        detail: error.message || 'API 密钥无效或无权访问所选服务地址，请检查密钥与服务地址。',
      }
    }
    if (code === 'TOOL_CALL_UNSUPPORTED' || code === 'TOOLS_NOT_SUPPORTED') {
      return {
        kind: 'tool_call_unsupported',
        title: '缺少工具调用能力',
        detail:
          error.message || '所选模型不支持结构化工具调用，无法驱动寸链建模与检查，请更换支持工具调用的模型。',
      }
    }
    if (code === 'TOOL_ROUNDTRIP_FAILED') {
      return {
        kind: 'tool_roundtrip_failed',
        title: '工具往返测试未通过',
        detail: error.message || '模型未能完成一次真实工具调用往返，内置建模对话保持锁定。',
      }
    }
    if (code === 'BACKEND_UNAVAILABLE') {
      return {
        kind: 'backend_unavailable',
        title: '后端尚未接线/不可用',
        detail: error.message,
      }
    }
    return {
      kind: 'other',
      title: '连接测试失败',
      detail: error.message || '模型 API 测试未成功。',
    }
  }

  if (result) {
    if (!result.toolCallSupported) {
      return {
        kind: 'tool_call_unsupported',
        title: '缺少工具调用能力',
        detail: `模型 ${result.selectedModel} 未报告工具调用能力，无法解锁内置建模对话。`,
      }
    }
    if (!result.toolRoundTripPassed) {
      return {
        kind: 'tool_roundtrip_failed',
        title: '工具往返测试未通过',
        detail: `模型 ${result.selectedModel} 尚未完成一次真实工具往返，内置建模对话保持锁定。`,
      }
    }
  }

  return null
}

export function isModelApiUnlocked(result: M1ModelApiTestResult | null): boolean {
  return Boolean(result && result.toolCallSupported && result.toolRoundTripPassed)
}

export function computeModelApiConfigFingerprint(config: {
  readonly baseUrl: string
  readonly model: string
  readonly apiKey: string
}): string {
  return JSON.stringify([config.baseUrl.trim(), config.model.trim(), config.apiKey.trim()])
}

/**
 * Single unified gate for built-in model API chat unlock:
 * requires a passed real tool round-trip test bound to the CURRENT form config
 * AND an active connected model-api session (prevents reconnect or late test
 * responses for edited forms from bypassing unlock conditions).
 */
export function canUseBuiltinModelApiChat(params: {
  readonly testResult: M1ModelApiTestResult | null
  readonly testedConfigFingerprint: string | null
  readonly currentConfigFingerprint: string
  readonly connectionState: M1ClientConnectionState
  readonly connectionSource: M1ConnectionSource
}): boolean {
  if (!isModelApiUnlocked(params.testResult)) {
    return false
  }
  if (
    !params.testedConfigFingerprint ||
    params.testedConfigFingerprint !== params.currentConfigFingerprint
  ) {
    return false
  }
  return params.connectionSource === 'model-api' && params.connectionState === 'connected'
}

export const DEFAULT_MACOS_INSTALL_PATH = '/Applications/寸链.app'

export function buildLocalAgentConfigSnippet(info: M1LocalAgentInstallInfo | null): {
  readonly installPath: string
  readonly mcpConfigJson: string
  readonly connectPrompt: string
  readonly fromBackend: boolean
} {
  if (info) {
    const serverName = info.mcpServerName?.trim() || 'cunlian'
    const args = info.bridgeArgs ? [...info.bridgeArgs] : []
    const mcpConfigJson =
      info.mcpConfigJson?.trim() ||
      JSON.stringify(
        {
          mcpServers: {
            [serverName]: {
              command: info.bridgeCommand,
              args,
            },
          },
        },
        null,
        2,
      )
    const connectPrompt =
      info.connectPrompt?.trim() ||
      `连接寸链：请使用本机 MCP 桥接程序 ${info.bridgeCommand}（安装位置：${info.installPath}）注册服务 "${serverName}"，并在握手后读取当前项目能力与上下文。`

    return {
      installPath: info.installPath,
      mcpConfigJson,
      connectPrompt,
      fromBackend: true,
    }
  }

  const fallbackCommand = `${DEFAULT_MACOS_INSTALL_PATH}/Contents/Resources/cunlian-mcp-bridge`
  const mcpConfigJson = JSON.stringify(
    {
      mcpServers: {
        cunlian: {
          command: fallbackCommand,
          args: ['--stdio'],
        },
      },
    },
    null,
    2,
  )
  const connectPrompt = `连接寸链：请使用本机 MCP 桥接程序 ${fallbackCommand}（默认安装位置：${DEFAULT_MACOS_INSTALL_PATH}）注册服务 "cunlian"，握手后读取当前能力。`

  return {
    installPath: DEFAULT_MACOS_INSTALL_PATH,
    mcpConfigJson,
    connectPrompt,
    fromBackend: false,
  }
}

export function formatSelectedObjectReference(obj: M1SelectedObjectRef): string {
  return `${obj.breadcrumb} [${obj.featureRef}]`
}

export interface WorkbenchScopeState {
  readonly projectId: string
  readonly scopeEpoch: number
  readonly writerEpoch: number
}

export interface WorkbenchScopedEpochState extends WorkbenchScopeState {
  readonly strictEpochGuard?: boolean
}

function isValidEpoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Guard against late async responses after project switch, cancel, or draft takeover.
 * Fail-closed: rejects missing, null, or non-finite scopeEpoch/writerEpoch.
 */
export function isReplyAcceptedForScope(
  current: WorkbenchScopeState,
  captured: {
    readonly projectId: string
    readonly scopeEpoch?: number | null
    readonly writerEpoch?: number | null
  },
  replyScope?: {
    readonly scopeEpoch?: number | null
    readonly writerEpoch?: number | null
  },
): boolean {
  if (current.projectId !== captured.projectId) {
    return false
  }
  if (!isValidEpoch(current.scopeEpoch) || !isValidEpoch(current.writerEpoch)) {
    return false
  }
  if (!isValidEpoch(captured.scopeEpoch) || !isValidEpoch(captured.writerEpoch)) {
    return false
  }
  if (current.scopeEpoch !== captured.scopeEpoch) {
    return false
  }
  if (current.writerEpoch !== captured.writerEpoch) {
    return false
  }
  if (replyScope !== undefined) {
    if (!isValidEpoch(replyScope.scopeEpoch) || !isValidEpoch(replyScope.writerEpoch)) {
      return false
    }
    if (replyScope.scopeEpoch < current.scopeEpoch) {
      return false
    }
    if (replyScope.writerEpoch < current.writerEpoch) {
      return false
    }
  }
  return true
}

/**
 * Guard against late pushed events from a superseded client/writer after takeover.
 * Fail-closed: rejects missing, null, or non-finite scopeEpoch/writerEpoch.
 */
export function isEventAcceptedForScope(
  current: WorkbenchScopeState,
  event: {
    readonly projectId: string
    readonly scopeEpoch?: number | null
    readonly writerEpoch?: number | null
  },
): boolean {
  if (event.projectId !== current.projectId) {
    return false
  }
  if (!isValidEpoch(current.scopeEpoch) || !isValidEpoch(current.writerEpoch)) {
    return false
  }
  if (!isValidEpoch(event.scopeEpoch) || !isValidEpoch(event.writerEpoch)) {
    return false
  }
  if (event.scopeEpoch < current.scopeEpoch) {
    return false
  }
  if (event.writerEpoch < current.writerEpoch) {
    return false
  }
  return true
}

/**
 * Guard for M2 preview events and M3 same-project external events.
 * - Before takeover (`strictEpochGuard` is false/omitted): events omitting both
 *   `scopeEpoch` and `writerEpoch` remain accepted for backward compatibility;
 *   if either epoch field is supplied, both must be valid finite numbers >= current epochs.
 * - After takeover (`strictEpochGuard === true`): fail-closed — missing, null,
 *   non-finite, or older `scopeEpoch` / `writerEpoch` are strictly rejected.
 */
export function isScopedArtifactEventAccepted(
  current: WorkbenchScopedEpochState,
  event: {
    readonly projectId: string
    readonly scopeEpoch?: number | null
    readonly writerEpoch?: number | null
  },
): boolean {
  if (event.projectId !== current.projectId) {
    return false
  }
  const hasAnyEpoch = event.scopeEpoch !== undefined || event.writerEpoch !== undefined
  if (current.strictEpochGuard || hasAnyEpoch) {
    return isEventAcceptedForScope(current, event)
  }
  return true
}

/**
 * M1-BE-02D: Format both backend standard tool call receipts
 * (`{ name, status: 'awaitingInput' | 'succeeded', taskId? }`) and legacy
 * `{ toolName, status, summary }` / string representations for chat bubbles.
 */
export function formatChatToolCallItem(tc: M1ChatToolCallItem): {
  readonly label: string
  readonly tone: string
} {
  if (typeof tc === 'string') {
    return { label: tc, tone: 'pa-tone-muted' }
  }
  if ('name' in tc) {
    const statusLabel = tc.status === 'awaitingInput' ? '待补充输入' : '已成功'
    const taskPart = tc.taskId ? `（任务 ${tc.taskId}）` : ''
    return {
      label: `${tc.name}：${statusLabel}${taskPart}`,
      tone: tc.status === 'succeeded' ? 'pa-tone-pass' : 'pa-tone-pending',
    }
  }
  return {
    label: `${tc.toolName}：${tc.summary}`,
    tone: tc.status === 'succeeded' ? 'pa-tone-pass' : 'pa-tone-danger',
  }
}

export const MAX_M1_CHAT_HISTORY = 32
export const MAX_M1_CHAT_ATTACHMENTS = 8

/**
 * P1-3: Trim chat history to the most recent `MAX_M1_CHAT_HISTORY` (32) valid entries
 * to align with backend Zod schema length limits and prevent `INVALID_REQUEST`.
 */
export function trimM1ChatHistory(
  history: readonly M1ChatHistoryItem[],
  maxLength: number = MAX_M1_CHAT_HISTORY,
): readonly M1ChatHistoryItem[] {
  const limit = Math.max(0, Math.floor(maxLength))
  if (limit === 0) return []
  const valid = history.filter(
    (item) =>
      (item.role === 'user' || item.role === 'assistant') &&
      typeof item.content === 'string' &&
      item.content.trim().length > 0,
  )
  if (valid.length <= limit) return valid
  return valid.slice(valid.length - limit)
}

/**
 * P1-3: Deduplicate and clamp chat attachment opaque IDs to at most
 * `MAX_M1_CHAT_ATTACHMENTS` (8) to align with backend Zod schema limits.
 */
export function trimM1ChatAttachments(
  attachmentIds: readonly string[],
  maxLength: number = MAX_M1_CHAT_ATTACHMENTS,
): {
  readonly attachments: readonly string[]
  readonly truncatedCount: number
} {
  const limit = Math.max(0, Math.floor(maxLength))
  const uniqueValid: string[] = []
  const seen = new Set<string>()
  for (const raw of attachmentIds) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    uniqueValid.push(trimmed)
  }
  if (uniqueValid.length <= limit) {
    return { attachments: uniqueValid, truncatedCount: 0 }
  }
  return {
    attachments: uniqueValid.slice(0, limit),
    truncatedCount: uniqueValid.length - limit,
  }
}

/**
 * M1-BE-02D: When the main process returns `AUTH_REQUIRED` with a positive decimal
 * integer string in `detail` (e.g. "3"), parse and return the authoritative `scopeEpoch`.
 */
export function parseAuthoritativeScopeEpochFromError(
  error: M1WorkbenchErrorPayload | null | undefined,
): number | null {
  if (!error || error.code.toUpperCase() !== 'AUTH_REQUIRED') {
    return null
  }
  const detail = error.detail?.trim() ?? ''
  if (!/^[1-9]\d*$/.test(detail)) {
    return null
  }
  const parsed = Number.parseInt(detail, 10)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null
}

/**
 * P1-1: Synchronize local `scopeEpoch` from an authoritative `AUTH_REQUIRED.detail`
 * response and reset `writerEpoch` baseline to `0` so the subsequent authoritative
 * `snapshot_required` frame in the new scope can establish the new `writerEpoch`
 * without being falsely dropped by a higher previous-scope `writerEpoch`.
 */
export function applyAuthoritativeScopeEpochSync(
  current: WorkbenchScopeState,
  error: M1WorkbenchErrorPayload | null | undefined,
): { readonly changed: boolean; readonly next: WorkbenchScopeState } {
  const authoritativeEpoch = parseAuthoritativeScopeEpochFromError(error)
  if (authoritativeEpoch === null || authoritativeEpoch === current.scopeEpoch) {
    return { changed: false, next: current }
  }
  return {
    changed: true,
    next: {
      projectId: current.projectId,
      scopeEpoch: authoritativeEpoch,
      writerEpoch: 0,
    },
  }
}

/**
 * M1-BE-02D: Sequence check for `subscribeM1WorkbenchEvents`.
 * Normal events must advance strictly past `currentLastSequence`.
 * `snapshot_required` is an authoritative cursor reset frame that can reset even an
 * ahead cursor (`event.sequence <= currentLastSequence`) so subsequent events resume cleanly.
 */
export function shouldAcceptWorkbenchEventSequence(
  currentLastSequence: number,
  event: Pick<M1WorkbenchIncomingEvent, 'type' | 'sequence'>,
): { readonly accepted: boolean; readonly nextLastSequence: number } {
  if (typeof event.sequence !== 'number' || !Number.isFinite(event.sequence) || event.sequence < 0) {
    return { accepted: false, nextLastSequence: currentLastSequence }
  }
  if (event.type === 'snapshot_required') {
    return { accepted: true, nextLastSequence: event.sequence }
  }
  if (event.sequence <= currentLastSequence) {
    return { accepted: false, nextLastSequence: currentLastSequence }
  }
  return { accepted: true, nextLastSequence: event.sequence }
}

/* ============================================================================
   UX-CONN-FE-01: Zero-Manual-Config Connection Extensions
   - Duck-typing probe for 3 optional backend methods without breaking the
     existing 9-method M1_WORKBENCH_BRIDGE_METHODS contract.
   - Built-in 10 Model API provider presets & pure helpers.
   ============================================================================ */

export const M1_CONNECTION_UX_BRIDGE_METHODS = [
  'detectM1LocalAgents',
  'registerM1LocalAgent',
  'listM1ModelApiModels',
] as const

export type M1ConnectionUxBridgeMethodName = (typeof M1_CONNECTION_UX_BRIDGE_METHODS)[number]

export interface M1ConnectionUxBridge {
  readonly detectM1LocalAgents?: () => Promise<
    M1WorkbenchBridgeResult<M1DetectLocalAgentsResult>
  >
  readonly registerM1LocalAgent?: (
    request: M1RegisterLocalAgentRequest,
  ) => Promise<M1WorkbenchBridgeResult<M1RegisterLocalAgentResult>>
  readonly listM1ModelApiModels?: (
    request: M1ListModelApiModelsRequest,
  ) => Promise<M1WorkbenchBridgeResult<M1ListModelApiModelsResult>>
}

export interface M1ConnectionUxBridgeProbe {
  readonly bridge: M1ConnectionUxBridge
  readonly capabilities: {
    readonly detectLocalAgents: boolean
    readonly registerLocalAgent: boolean
    readonly listModelApiModels: boolean
  }
  readonly anyAvailable: boolean
  readonly missingMethods: readonly M1ConnectionUxBridgeMethodName[]
}

export function probeM1ConnectionUxBridge(candidate: unknown): M1ConnectionUxBridgeProbe {
  const record =
    candidate !== null && typeof candidate === 'object'
      ? (candidate as Record<string, unknown>)
      : null

  const bindMethod = <K extends M1ConnectionUxBridgeMethodName>(
    name: K,
  ): M1ConnectionUxBridge[K] | undefined => {
    if (!record || typeof record[name] !== 'function') {
      return undefined
    }
    const fn = record[name] as (...args: unknown[]) => unknown
    return ((...args: unknown[]) => fn.apply(record, args)) as M1ConnectionUxBridge[K]
  }

  const bridge: M1ConnectionUxBridge = {
    detectM1LocalAgents: bindMethod('detectM1LocalAgents'),
    registerM1LocalAgent: bindMethod('registerM1LocalAgent'),
    listM1ModelApiModels: bindMethod('listM1ModelApiModels'),
  }

  const missingMethods: M1ConnectionUxBridgeMethodName[] = []
  for (const name of M1_CONNECTION_UX_BRIDGE_METHODS) {
    if (typeof bridge[name] !== 'function') {
      missingMethods.push(name)
    }
  }

  const capabilities = {
    detectLocalAgents: typeof bridge.detectM1LocalAgents === 'function',
    registerLocalAgent: typeof bridge.registerM1LocalAgent === 'function',
    listModelApiModels: typeof bridge.listM1ModelApiModels === 'function',
  }

  const anyAvailable = Object.values(capabilities).some(Boolean)

  return {
    bridge,
    capabilities,
    anyAvailable,
    missingMethods,
  }
}

export function resolveWindowM1ConnectionUxBridge(): M1ConnectionUxBridgeProbe {
  const candidate =
    typeof window !== 'undefined' ? (window as { cunlian?: unknown }).cunlian : undefined
  return probeM1ConnectionUxBridge(candidate)
}

export function sortDetectedLocalAgents(
  agents: readonly M1DetectedLocalAgent[],
): {
  readonly detected: readonly M1DetectedLocalAgent[]
  readonly undetected: readonly M1DetectedLocalAgent[]
} {
  const detected: M1DetectedLocalAgent[] = []
  const undetected: M1DetectedLocalAgent[] = []
  for (const agent of agents) {
    if (agent.detected) {
      detected.push(agent)
    } else {
      undetected.push(agent)
    }
  }
  return { detected, undetected }
}

export type M1ModelApiProviderPresetId =
  | 'deepseek'
  | 'openai'
  | 'zhipu'
  | 'qwen'
  | 'moonshot'
  | 'siliconflow'
  | 'openrouter'
  | 'ollama'
  | 'lmstudio'
  | 'custom'

export interface M1ModelApiProviderPreset {
  readonly id: M1ModelApiProviderPresetId
  readonly label: string
  readonly baseUrl: string
  readonly defaultModel: string
  readonly apiKeyOptional: boolean
  readonly isCustom?: boolean
}

export const M1_MODEL_API_PROVIDER_PRESETS: readonly M1ModelApiProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    apiKeyOptional: false,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    apiKeyOptional: false,
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    apiKeyOptional: false,
  },
  {
    id: 'qwen',
    label: '通义千问（阿里云百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    apiKeyOptional: false,
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    apiKeyOptional: false,
  },
  {
    id: 'siliconflow',
    label: '硅基流动（SiliconFlow）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: '',
    apiKeyOptional: false,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: '',
    apiKeyOptional: false,
  },
  {
    id: 'ollama',
    label: '本地 Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: '',
    apiKeyOptional: true,
  },
  {
    id: 'lmstudio',
    label: '本地 LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    defaultModel: '',
    apiKeyOptional: true,
  },
  {
    id: 'custom',
    label: '自定义 OpenAI 兼容地址',
    baseUrl: '',
    defaultModel: '',
    apiKeyOptional: false,
    isCustom: true,
  },
] as const

export const DEFAULT_M1_MODEL_API_PROVIDER_ID: M1ModelApiProviderPresetId = 'deepseek'

export function getModelApiProviderPreset(
  id: M1ModelApiProviderPresetId,
): M1ModelApiProviderPreset {
  return (
    M1_MODEL_API_PROVIDER_PRESETS.find((preset) => preset.id === id) ??
    M1_MODEL_API_PROVIDER_PRESETS[M1_MODEL_API_PROVIDER_PRESETS.length - 1]
  )
}

export function findModelApiProviderPresetByUrl(
  baseUrl: string,
): M1ModelApiProviderPreset | null {
  const normalized = baseUrl.trim().replace(/\/+$/, '').toLowerCase()
  if (!normalized) return null
  for (const preset of M1_MODEL_API_PROVIDER_PRESETS) {
    if (preset.isCustom || !preset.baseUrl) continue
    if (preset.baseUrl.replace(/\/+$/, '').toLowerCase() === normalized) {
      return preset
    }
  }
  return null
}

export function isValidModelApiBaseUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.trim()
  if (!trimmed) return false
  try {
    const parsed = new URL(trimmed)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname.trim().length > 0
    )
  } catch {
    return false
  }
}

export function canAutoFetchModelApiModels(params: {
  readonly baseUrl: string
  readonly apiKey: string
  readonly providerId: M1ModelApiProviderPresetId
}): boolean {
  if (!isValidModelApiBaseUrl(params.baseUrl)) {
    return false
  }
  const preset = getModelApiProviderPreset(params.providerId)
  return preset.apiKeyOptional || params.apiKey.trim().length > 0
}

export function selectPreferredModelFromList(params: {
  readonly models: readonly string[]
  readonly defaultModel: string | null
  readonly presetDefaultModel: string
}): string {
  const cleaned: string[] = []
  const seen = new Set<string>()
  for (const raw of params.models) {
    const trimmed = raw.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    cleaned.push(trimmed)
  }
  if (cleaned.length === 0) return ''

  const backendDefault = params.defaultModel?.trim() ?? ''
  if (backendDefault && cleaned.includes(backendDefault)) {
    return backendDefault
  }

  const presetDefault = params.presetDefaultModel.trim()
  if (presetDefault && cleaned.includes(presetDefault)) {
    return presetDefault
  }

  return cleaned[0]
}
