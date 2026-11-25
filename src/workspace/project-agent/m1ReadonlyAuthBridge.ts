import type { IpcErrorCode, IpcErrorPayload, IpcResult } from '../../../desktop/shared/contracts'
import type { EntryReply, EntryScope } from '../../../desktop/shared/project-agent/m1-entry-1933.ts'
import type { M1ContextFields } from '../../../desktop/shared/project-agent/m1-fields.ts'
import {
  isM1AuthorizationRequest,
  type M1AuthorizationRequest,
} from '../../../desktop/shared/project-agent/m1-local-authorization-2002.ts'
import type {
  M1GetContextRequest,
  M1ReadCapabilitiesInput,
  M1ReadPreloadTransport,
  M1ReadProjectEventsRequest,
} from './m1ReadPreloadAdapter'

/**
 * Local bridge error codes.
 * `AUTH_REQUIRED` is handled strictly at this local frontend boundary without
 * modifying the frozen `IpcErrorCode` union in `desktop/shared/contracts.ts`.
 */
export type M1LocalBridgeErrorCode = IpcErrorCode | 'AUTH_REQUIRED'

export interface M1LocalBridgeErrorPayload {
  readonly code: M1LocalBridgeErrorCode | (string & {})
  readonly message: string
  readonly detail?: string
  readonly reasonCodes?: readonly string[]
}

export type M1LocalBridgeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: M1LocalBridgeErrorPayload }

export interface M1ReadonlyAuthBridge {
  readonly requestM1ProjectAuthorization: (
    request: M1AuthorizationRequest,
  ) => Promise<M1LocalBridgeResult<EntryScope>>
  readonly revokeM1ProjectAuthorization: (
    request: M1AuthorizationRequest,
  ) => Promise<M1LocalBridgeResult<{ readonly revoked: true }>>
  readonly getM1ProjectContext: (
    request: M1GetContextRequest,
  ) => Promise<M1LocalBridgeResult<EntryReply<'getContext'>>>
  readonly readM1ProjectEvents: (
    request: M1ReadProjectEventsRequest,
  ) => Promise<M1LocalBridgeResult<EntryReply<'readProjectEvents'>>>
  readonly getM1ReadCapabilities?: () => M1ReadCapabilitiesInput | undefined
}

export const M1_READONLY_REQUIRED_BRIDGE_METHODS = [
  'requestM1ProjectAuthorization',
  'revokeM1ProjectAuthorization',
  'getM1ProjectContext',
  'readM1ProjectEvents',
] as const

export type M1ReadonlyBridgeMethodName = (typeof M1_READONLY_REQUIRED_BRIDGE_METHODS)[number]

export type M1ReadonlyBridgeProbe =
  | {
      readonly available: true
      readonly bridge: M1ReadonlyAuthBridge
      readonly missingMethods: readonly []
    }
  | {
      readonly available: false
      readonly bridge: null
      readonly missingMethods: readonly M1ReadonlyBridgeMethodName[]
    }

/**
 * Literal capability flags for the M1 local read-only entry.
 * All write, subscribe, conversation, formal-save, and production-API flags stay false.
 */
export const M1_READONLY_ENTRY_CAPABILITIES = Object.freeze({
  productionApiConnected: false as const,
  formalSaveEnabled: false as const,
  writeEnabled: false as const,
  subscribeEnabled: false as const,
  conversationEnabled: false as const,
})

/**
 * Duck-type probe for the minimal M1 local read-only authorization & read bridge.
 * Never fabricates credentials or falls back to a mock transport.
 */
export function probeM1ReadonlyAuthBridge(candidate: unknown): M1ReadonlyBridgeProbe {
  if (candidate === null || typeof candidate !== 'object') {
    return {
      available: false,
      bridge: null,
      missingMethods: [...M1_READONLY_REQUIRED_BRIDGE_METHODS],
    }
  }

  const record = candidate as Record<string, unknown>
  const missingMethods: M1ReadonlyBridgeMethodName[] = []
  for (const methodName of M1_READONLY_REQUIRED_BRIDGE_METHODS) {
    if (typeof record[methodName] !== 'function') {
      missingMethods.push(methodName)
    }
  }

  if (missingMethods.length > 0) {
    return {
      available: false,
      bridge: null,
      missingMethods,
    }
  }

  const requestM1ProjectAuthorization = record.requestM1ProjectAuthorization as M1ReadonlyAuthBridge['requestM1ProjectAuthorization']
  const revokeM1ProjectAuthorization = record.revokeM1ProjectAuthorization as M1ReadonlyAuthBridge['revokeM1ProjectAuthorization']
  const getM1ProjectContext = record.getM1ProjectContext as M1ReadonlyAuthBridge['getM1ProjectContext']
  const readM1ProjectEvents = record.readM1ProjectEvents as M1ReadonlyAuthBridge['readM1ProjectEvents']
  const getM1ReadCapabilities =
    typeof record.getM1ReadCapabilities === 'function'
      ? (record.getM1ReadCapabilities as M1ReadonlyAuthBridge['getM1ReadCapabilities'])
      : undefined

  return {
    available: true,
    bridge: {
      requestM1ProjectAuthorization: (req) => requestM1ProjectAuthorization.call(record, req),
      revokeM1ProjectAuthorization: (req) => revokeM1ProjectAuthorization.call(record, req),
      getM1ProjectContext: (req) => getM1ProjectContext.call(record, req),
      readM1ProjectEvents: (req) => readM1ProjectEvents.call(record, req),
      getM1ReadCapabilities: getM1ReadCapabilities
        ? () => getM1ReadCapabilities.call(record)
        : undefined,
    },
    missingMethods: [],
  }
}

export function resolveWindowM1ReadonlyAuthBridge(): M1ReadonlyBridgeProbe {
  const candidate =
    typeof window !== 'undefined' ? (window as { cunlian?: unknown }).cunlian : undefined
  return probeM1ReadonlyAuthBridge(candidate)
}

/**
 * Construct a strict M1AuthorizationRequest containing only
 * `{ projectId, requestId, requestGeneration }` validated by the synced 2002 schema.
 */
export function buildM1AuthorizationRequest(
  projectId: string,
  requestId: string,
  requestGeneration: number,
): M1AuthorizationRequest | null {
  const candidate = {
    projectId,
    requestId,
    requestGeneration,
  }
  return isM1AuthorizationRequest(candidate) ? candidate : null
}

/**
 * Validate an EntryScope returned by `requestM1ProjectAuthorization` against
 * the originally issued `{ projectId, requestGeneration }`.
 */
export function acceptAuthorizedEntryScope(
  issued: M1AuthorizationRequest,
  value: unknown,
): EntryScope | null {
  if (value === null || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.projectId !== 'string' ||
    typeof record.authorizationRef !== 'string' ||
    typeof record.requestGeneration !== 'number'
  ) {
    return null
  }
  if (
    record.projectId !== issued.projectId ||
    record.requestGeneration !== issued.requestGeneration ||
    !Number.isSafeInteger(record.requestGeneration) ||
    record.requestGeneration < 0 ||
    record.authorizationRef.trim().length === 0
  ) {
    return null
  }
  return {
    projectId: record.projectId,
    authorizationRef: record.authorizationRef,
    requestGeneration: record.requestGeneration,
  }
}

export function isSameEntryScope(a: EntryScope | null, b: EntryScope | null): boolean {
  if (a === null || b === null) {
    return false
  }
  return (
    a.projectId === b.projectId &&
    a.authorizationRef === b.authorizationRef &&
    a.requestGeneration === b.requestGeneration
  )
}

export function normalizeBridgeError(
  error: unknown,
  fallbackMessage: string,
): M1LocalBridgeErrorPayload {
  if (error !== null && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const code =
      typeof record.code === 'string' && record.code.trim().length > 0
        ? record.code
        : 'INTERNAL'
    const message =
      typeof record.message === 'string' && record.message.trim().length > 0
        ? record.message
        : fallbackMessage
    return {
      code,
      message,
      ...(typeof record.detail === 'string' ? { detail: record.detail } : {}),
    }
  }
  return {
    code: 'INTERNAL',
    message: fallbackMessage,
  }
}

/**
 * Adapts the duck-typed local bridge to `M1ReadPreloadTransport` for
 * `createM1ReadPreloadAdapter`, while preserving local `AUTH_REQUIRED` errors
 * and capturing raw context payloads only until `acceptEntryReply` accepts them.
 */
export function createBridgeReadTransport(
  bridge: M1ReadonlyAuthBridge,
  onRawContextReply: (requestId: string, rawContext: M1ContextFields) => void,
): M1ReadPreloadTransport {
  return {
    async getM1ProjectContext(
      request: M1GetContextRequest,
    ): Promise<IpcResult<EntryReply<'getContext'>>> {
      try {
        const result = await bridge.getM1ProjectContext(request)
        if (!result.ok) {
          const normalized = normalizeBridgeError(result.error, '读取项目上下文失败')
          return {
            ok: false,
            error: normalized as unknown as IpcErrorPayload,
          }
        }
        if (result.value && typeof result.value === 'object' && result.value.ok) {
          onRawContextReply(request.requestId, result.value.result)
        }
        return { ok: true, value: result.value }
      } catch (err) {
        const message = err instanceof Error ? err.message : '读取项目上下文异常'
        return {
          ok: false,
          error: { code: 'INTERNAL', message },
        }
      }
    },
    async readM1ProjectEvents(
      request: M1ReadProjectEventsRequest,
    ): Promise<IpcResult<EntryReply<'readProjectEvents'>>> {
      try {
        const result = await bridge.readM1ProjectEvents(request)
        if (!result.ok) {
          const normalized = normalizeBridgeError(result.error, '读取项目事件失败')
          return {
            ok: false,
            error: normalized as unknown as IpcErrorPayload,
          }
        }
        return { ok: true, value: result.value }
      } catch (err) {
        const message = err instanceof Error ? err.message : '读取项目事件异常'
        return {
          ok: false,
          error: { code: 'INTERNAL', message },
        }
      }
    },
    getM1ReadCapabilities: bridge.getM1ReadCapabilities,
  }
}
