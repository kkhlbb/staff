import type { IpcErrorPayload, IpcResult } from '../../../desktop/shared/contracts';
import {
  M1_ENTRY_CANDIDATE,
  acceptEntryReply,
  classifyEntryFailure,
  entryRequests,
  type EntryReply,
} from '../../../desktop/shared/project-agent/m1-entry-1933.ts';
import type { Infer } from '../../../desktop/shared/project-agent/schema.ts';
import {
  presentM1Context,
  presentM1ReadRecovery,
} from './m1FieldPresentation';
import {
  acceptM1FullEventPage,
  presentM1IncrementFailure,
} from './m1FullEventPagePresentation';

export type M1ReadOperation = 'getContext' | 'readProjectEvents';

export type M1GetContextRequest = Infer<typeof entryRequests.getContext>;
export type M1ReadProjectEventsRequest = Infer<typeof entryRequests.readProjectEvents>;

export type M1PresentedContext = ReturnType<typeof presentM1Context>;
export type M1AcceptedEventPage = ReturnType<typeof acceptM1FullEventPage>;
export type M1EntryFailureClassification = ReturnType<typeof classifyEntryFailure>;
export type M1ReadRecoveryPresentation = ReturnType<typeof presentM1ReadRecovery>;
export type M1IncrementFailurePresentation = ReturnType<typeof presentM1IncrementFailure>;

export interface M1ReadCapabilities {
  readonly trustedInjectionOnly: boolean;
  readonly productionAuthorizationMapped: boolean;
  readonly subscriptionsAvailable: false;
  readonly productionApiConnected: false;
  readonly formalSaveEnabled: false;
}

export interface M1ReadCapabilitiesInput {
  readonly trustedInjectionOnly?: boolean;
  readonly productionAuthorizationMapped?: boolean;
  readonly subscriptionsAvailable?: boolean;
  readonly productionApiConnected?: boolean;
  readonly formalSaveEnabled?: boolean;
}

export interface M1ReadPreloadTransport {
  readonly getM1ProjectContext: (
    request: M1GetContextRequest,
  ) => Promise<IpcResult<EntryReply<'getContext'>>>;
  readonly readM1ProjectEvents: (
    request: M1ReadProjectEventsRequest,
  ) => Promise<IpcResult<EntryReply<'readProjectEvents'>>>;
  readonly getM1ReadCapabilities?: () => M1ReadCapabilitiesInput | undefined;
}

export interface M1ReadTrustedScope {
  readonly projectId: string;
  readonly authorizationRef: string;
  readonly requestGeneration: number;
}

export interface M1GetContextReadInput extends M1ReadTrustedScope {
  readonly requestId: string;
}

export interface M1ReadEventsInput extends M1ReadTrustedScope {
  readonly requestId: string;
  readonly afterSequence: number;
  readonly limit: number;
}

export interface M1OuterIpcErrorView {
  readonly layer: 'outer_ipc';
  readonly operation: M1ReadOperation;
  readonly code: IpcErrorPayload['code'];
  readonly message: string;
}

export interface M1InnerFailureView {
  readonly layer: 'inner_entry';
  readonly operation: M1ReadOperation;
  readonly classification: M1EntryFailureClassification;
  readonly recovery: M1ReadRecoveryPresentation;
  readonly incrementFailure: M1IncrementFailurePresentation | null;
  readonly error: Extract<EntryReply<M1ReadOperation>, { ok: false }>['error'];
}

export interface M1RejectedReplyView {
  readonly operation: M1ReadOperation;
  readonly requestId: string;
  readonly reason: 'STALE_OR_MALFORMED_REPLY';
}

export interface M1ReadPreloadAdapterState {
  readonly entryCandidate: typeof M1_ENTRY_CANDIDATE;
  readonly capabilities: M1ReadCapabilities;
  readonly productionApiConnected: false;
  readonly formalSaveEnabled: false;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly acceptedContext: M1PresentedContext | null;
  readonly acceptedEventPage: M1AcceptedEventPage | null;
  readonly outerError: M1OuterIpcErrorView | null;
  readonly innerFailure: M1InnerFailureView | null;
  readonly lastRejection: M1RejectedReplyView | null;
}

export type M1ContextReadOutcome =
  | {
      readonly status: 'unavailable';
      readonly operation: 'getContext';
      readonly reason: string;
      readonly state: M1ReadPreloadAdapterState;
    }
  | {
      readonly status: 'outer_error';
      readonly operation: 'getContext';
      readonly error: M1OuterIpcErrorView;
      readonly state: M1ReadPreloadAdapterState;
    }
  | {
      readonly status: 'rejected';
      readonly operation: 'getContext';
      readonly rejection: M1RejectedReplyView;
      readonly state: M1ReadPreloadAdapterState;
    }
  | {
      readonly status: 'inner_error';
      readonly operation: 'getContext';
      readonly failure: M1InnerFailureView;
      readonly state: M1ReadPreloadAdapterState;
    }
  | {
      readonly status: 'accepted';
      readonly operation: 'getContext';
      readonly context: M1PresentedContext;
      readonly state: M1ReadPreloadAdapterState;
    };

export type M1EventsReadOutcome =
  | {
      readonly status: 'unavailable';
      readonly operation: 'readProjectEvents';
      readonly reason: string;
      readonly state: M1ReadPreloadAdapterState;
    }
  | {
      readonly status: 'outer_error';
      readonly operation: 'readProjectEvents';
      readonly error: M1OuterIpcErrorView;
      readonly state: M1ReadPreloadAdapterState;
    }
  | {
      readonly status: 'rejected';
      readonly operation: 'readProjectEvents';
      readonly rejection: M1RejectedReplyView;
      readonly state: M1ReadPreloadAdapterState;
    }
  | {
      readonly status: 'inner_error';
      readonly operation: 'readProjectEvents';
      readonly failure: M1InnerFailureView;
      readonly state: M1ReadPreloadAdapterState;
    }
  | {
      readonly status: 'accepted';
      readonly operation: 'readProjectEvents';
      readonly page: M1AcceptedEventPage;
      readonly state: M1ReadPreloadAdapterState;
    };

export interface CreateM1ReadPreloadAdapterOptions {
  readonly transport: M1ReadPreloadTransport;
  readonly getCurrentScope?: () => M1ReadTrustedScope;
}

export interface M1ReadPreloadAdapter {
  readonly getState: () => M1ReadPreloadAdapterState;
  readonly getCapabilities: () => M1ReadCapabilities;
  readonly readContext: (input: M1GetContextReadInput) => Promise<M1ContextReadOutcome>;
  readonly readEvents: (input: M1ReadEventsInput) => Promise<M1EventsReadOutcome>;
}

export const DEFAULT_M1_READ_CAPABILITIES: M1ReadCapabilities = Object.freeze({
  trustedInjectionOnly: true,
  productionAuthorizationMapped: false,
  subscriptionsAvailable: false,
  productionApiConnected: false,
  formalSaveEnabled: false,
});

export function resolveM1ReadCapabilities(
  transport: Pick<M1ReadPreloadTransport, 'getM1ReadCapabilities'>,
): M1ReadCapabilities {
  const raw = transport.getM1ReadCapabilities?.();
  return Object.freeze({
    trustedInjectionOnly: raw?.trustedInjectionOnly ?? true,
    productionAuthorizationMapped: raw?.productionAuthorizationMapped ?? false,
    subscriptionsAvailable: false,
    productionApiConnected: false,
    formalSaveEnabled: false,
  });
}

function hasTrustedAuthorizationRef(
  authorizationRef: string,
  capabilities: M1ReadCapabilities,
): boolean {
  const trimmed = authorizationRef.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (capabilities.trustedInjectionOnly && trimmed.length === 0) {
    return false;
  }
  return true;
}

function buildUnavailableReason(capabilities: M1ReadCapabilities): string {
  if (capabilities.trustedInjectionOnly) {
    return 'Trusted authorizationRef is required when trustedInjectionOnly is enabled; adapter will not fabricate credentials.';
  }
  return 'Missing authorizationRef; read transport is unavailable.';
}

function mapOuterError(
  operation: M1ReadOperation,
  error: IpcErrorPayload,
): M1OuterIpcErrorView {
  return {
    layer: 'outer_ipc',
    operation,
    code: error.code,
    message: error.message,
  };
}

export function createM1ReadPreloadAdapter(
  options: CreateM1ReadPreloadAdapterOptions,
): M1ReadPreloadAdapter {
  const { transport, getCurrentScope } = options;
  const initialCapabilities = resolveM1ReadCapabilities(transport);

  let state: M1ReadPreloadAdapterState = {
    entryCandidate: M1_ENTRY_CANDIDATE,
    capabilities: initialCapabilities,
    productionApiConnected: false,
    formalSaveEnabled: false,
    available: false,
    unavailableReason: buildUnavailableReason(initialCapabilities),
    acceptedContext: null,
    acceptedEventPage: null,
    outerError: null,
    innerFailure: null,
    lastRejection: null,
  };

  function refreshCapabilities(): M1ReadCapabilities {
    return resolveM1ReadCapabilities(transport);
  }

  function readScopeForValidation(fallback: M1ReadTrustedScope): M1ReadTrustedScope {
    if (getCurrentScope) {
      const current = getCurrentScope();
      return {
        projectId: current.projectId,
        authorizationRef: current.authorizationRef,
        requestGeneration: current.requestGeneration,
      };
    }
    return fallback;
  }

  async function readContext(input: M1GetContextReadInput): Promise<M1ContextReadOutcome> {
    const capabilities = refreshCapabilities();
    if (!hasTrustedAuthorizationRef(input.authorizationRef, capabilities)) {
      const reason = buildUnavailableReason(capabilities);
      state = {
        ...state,
        capabilities,
        productionApiConnected: false,
        formalSaveEnabled: false,
        available: false,
        unavailableReason: reason,
      };
      return {
        status: 'unavailable',
        operation: 'getContext',
        reason,
        state,
      };
    }

    const issuedRequest: M1GetContextRequest = {
      projectId: input.projectId,
      authorizationRef: input.authorizationRef,
      requestGeneration: input.requestGeneration,
      requestId: input.requestId,
    };

    const ipcResult = await transport.getM1ProjectContext(issuedRequest);
    if (!ipcResult.ok) {
      const outerError = mapOuterError('getContext', ipcResult.error);
      state = {
        ...state,
        capabilities,
        productionApiConnected: false,
        formalSaveEnabled: false,
        available: true,
        unavailableReason: null,
        outerError,
        innerFailure: null,
      };
      return {
        status: 'outer_error',
        operation: 'getContext',
        error: outerError,
        state,
      };
    }

    const currentScope = readScopeForValidation({
      projectId: issuedRequest.projectId,
      authorizationRef: issuedRequest.authorizationRef,
      requestGeneration: issuedRequest.requestGeneration,
    });

    const innerReply = ipcResult.value;
    if (!acceptEntryReply('getContext', issuedRequest, currentScope, innerReply)) {
      const rejection: M1RejectedReplyView = {
        operation: 'getContext',
        requestId: issuedRequest.requestId,
        reason: 'STALE_OR_MALFORMED_REPLY',
      };
      state = {
        ...state,
        capabilities,
        productionApiConnected: false,
        formalSaveEnabled: false,
        available: true,
        unavailableReason: null,
        lastRejection: rejection,
      };
      return {
        status: 'rejected',
        operation: 'getContext',
        rejection,
        state,
      };
    }

    if (!innerReply.ok) {
      const failure: M1InnerFailureView = {
        layer: 'inner_entry',
        operation: 'getContext',
        classification: classifyEntryFailure(innerReply.error),
        recovery: presentM1ReadRecovery(innerReply.error.code),
        incrementFailure: presentM1IncrementFailure(innerReply.error),
        error: innerReply.error,
      };
      state = {
        ...state,
        capabilities,
        productionApiConnected: false,
        formalSaveEnabled: false,
        available: true,
        unavailableReason: null,
        outerError: null,
        innerFailure: failure,
      };
      return {
        status: 'inner_error',
        operation: 'getContext',
        failure,
        state,
      };
    }

    const presented = presentM1Context(innerReply.result);
    state = {
      ...state,
      capabilities,
      productionApiConnected: false,
      formalSaveEnabled: false,
      available: true,
      unavailableReason: null,
      acceptedContext: presented,
      outerError: null,
      innerFailure: null,
      lastRejection: null,
    };
    return {
      status: 'accepted',
      operation: 'getContext',
      context: presented,
      state,
    };
  }

  async function readEvents(input: M1ReadEventsInput): Promise<M1EventsReadOutcome> {
    const capabilities = refreshCapabilities();
    if (!hasTrustedAuthorizationRef(input.authorizationRef, capabilities)) {
      const reason = buildUnavailableReason(capabilities);
      state = {
        ...state,
        capabilities,
        productionApiConnected: false,
        formalSaveEnabled: false,
        available: false,
        unavailableReason: reason,
      };
      return {
        status: 'unavailable',
        operation: 'readProjectEvents',
        reason,
        state,
      };
    }

    const issuedRequest: M1ReadProjectEventsRequest = {
      projectId: input.projectId,
      authorizationRef: input.authorizationRef,
      requestGeneration: input.requestGeneration,
      requestId: input.requestId,
      afterSequence: input.afterSequence,
      limit: input.limit,
    };

    const ipcResult = await transport.readM1ProjectEvents(issuedRequest);
    if (!ipcResult.ok) {
      const outerError = mapOuterError('readProjectEvents', ipcResult.error);
      state = {
        ...state,
        capabilities,
        productionApiConnected: false,
        formalSaveEnabled: false,
        available: true,
        unavailableReason: null,
        outerError,
        innerFailure: null,
      };
      return {
        status: 'outer_error',
        operation: 'readProjectEvents',
        error: outerError,
        state,
      };
    }

    const currentScope = readScopeForValidation({
      projectId: issuedRequest.projectId,
      authorizationRef: issuedRequest.authorizationRef,
      requestGeneration: issuedRequest.requestGeneration,
    });

    const innerReply = ipcResult.value;
    if (!acceptEntryReply('readProjectEvents', issuedRequest, currentScope, innerReply)) {
      const rejection: M1RejectedReplyView = {
        operation: 'readProjectEvents',
        requestId: issuedRequest.requestId,
        reason: 'STALE_OR_MALFORMED_REPLY',
      };
      state = {
        ...state,
        capabilities,
        productionApiConnected: false,
        formalSaveEnabled: false,
        available: true,
        unavailableReason: null,
        lastRejection: rejection,
      };
      return {
        status: 'rejected',
        operation: 'readProjectEvents',
        rejection,
        state,
      };
    }

    if (!innerReply.ok) {
      const failure: M1InnerFailureView = {
        layer: 'inner_entry',
        operation: 'readProjectEvents',
        classification: classifyEntryFailure(innerReply.error),
        recovery: presentM1ReadRecovery(innerReply.error.code),
        incrementFailure: presentM1IncrementFailure(innerReply.error),
        error: innerReply.error,
      };
      state = {
        ...state,
        capabilities,
        productionApiConnected: false,
        formalSaveEnabled: false,
        available: true,
        unavailableReason: null,
        outerError: null,
        innerFailure: failure,
      };
      return {
        status: 'inner_error',
        operation: 'readProjectEvents',
        failure,
        state,
      };
    }

    const acceptedPage = acceptM1FullEventPage(
      issuedRequest.projectId,
      issuedRequest.afterSequence,
      innerReply.result,
    );
    if (!acceptedPage.ok) {
      const rejection: M1RejectedReplyView = {
        operation: 'readProjectEvents',
        requestId: issuedRequest.requestId,
        reason: 'STALE_OR_MALFORMED_REPLY',
      };
      state = {
        ...state,
        capabilities,
        productionApiConnected: false,
        formalSaveEnabled: false,
        available: true,
        unavailableReason: null,
        lastRejection: rejection,
      };
      return {
        status: 'rejected',
        operation: 'readProjectEvents',
        rejection,
        state,
      };
    }
    state = {
      ...state,
      capabilities,
      productionApiConnected: false,
      formalSaveEnabled: false,
      available: true,
      unavailableReason: null,
      acceptedEventPage: acceptedPage,
      outerError: null,
      innerFailure: null,
      lastRejection: null,
    };
    return {
      status: 'accepted',
      operation: 'readProjectEvents',
      page: acceptedPage,
      state,
    };
  }

  return {
    getState: () => state,
    getCapabilities: () => refreshCapabilities(),
    readContext,
    readEvents,
  };
}
