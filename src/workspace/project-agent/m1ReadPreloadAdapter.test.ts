/**
 * 模拟 / synthetic: true
 * Unit doubles only — never a real production entry, session mount, or live IPC bridge.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcResult } from '../../../desktop/shared/contracts';
import {
  M1_ENTRY_CANDIDATE,
  acceptEntryReply,
  classifyEntryFailure,
  type EntryReply,
} from '../../../desktop/shared/project-agent/m1-entry-1933.ts';
import { createSyntheticM1ContextFields } from './m1FieldFixtures';
import { presentM1Context } from './m1FieldPresentation';
import {
  M1_FULL_EVENT_PAGE_CANDIDATE,
  acceptM1FullEventPage,
} from './m1FullEventPagePresentation';
import {
  createM1ReadPreloadAdapter,
  type M1GetContextRequest,
  type M1ReadPreloadTransport,
  type M1ReadProjectEventsRequest,
  type M1ReadTrustedScope,
} from './m1ReadPreloadAdapter';

vi.mock('../../../desktop/shared/project-agent/m1-entry-1933.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../desktop/shared/project-agent/m1-entry-1933.ts')>();
  return {
    ...actual,
    acceptEntryReply: vi.fn(actual.acceptEntryReply),
  };
});

const SYNTHETIC_META = Object.freeze({
  synthetic: true as const,
  note: '模拟测试桩 / unit double only',
});

const VALID_M0_ERROR_DETAILS = Object.freeze({
  baseRevision: null,
  draftRevision: null,
  retryStep: null,
  recovery: null,
  question: null,
});

function createSyntheticM0ContextChanged(projectId: string, sequence: number) {
  return {
    version: '0.1.0-m0' as const,
    projectId,
    baseRevision: 'rev-base-1',
    draftRevision: null,
    jobId: null,
    sequence,
    type: 'contextChanged' as const,
  };
}

function createSyntheticTaskChanged(projectId: string, sequence: number) {
  return {
    candidate: M1_FULL_EVENT_PAGE_CANDIDATE,
    type: 'taskChanged' as const,
    projectId,
    baseRevision: 'rev-base-1',
    draftRevision: 'draft-sim-1',
    jobId: 'job-sim-1',
    sequence,
    activity: {
      taskId: 'task-sim-1',
      projectId,
      source: 'internal' as const,
      baseRevision: 'rev-base-1',
      draftRevision: 'draft-sim-1',
      status: 'running' as const,
      lastStep: null,
      question: null,
      errorCode: null,
      updatedAtMs: 0,
    },
  };
}

function createSyntheticFullEventPage(
  projectId: string,
  afterSequence: number,
): Extract<EntryReply<'readProjectEvents'>, { ok: true }>['result'] {
  return {
    events: [
      createSyntheticM0ContextChanged(projectId, afterSequence + 1),
      createSyntheticTaskChanged(projectId, afterSequence + 2),
    ],
    nextCursor: afterSequence + 2,
    highWatermark: afterSequence + 2,
  };
}


interface TransportWithForbiddenSubscribeMethods extends M1ReadPreloadTransport {
  readonly synthetic: true;
  readonly subscribeM1ProjectEvents: ReturnType<typeof vi.fn>;
  readonly cancelM1ProjectSubscription: ReturnType<typeof vi.fn>;
}

function createSyntheticTransportDouble(
  overrides?: Partial<M1ReadPreloadTransport>,
): TransportWithForbiddenSubscribeMethods {
  const subscribeM1ProjectEvents = vi.fn(() => {
    throw new Error('subscribeM1ProjectEvents must never be called by read-only peel adapter');
  });
  const cancelM1ProjectSubscription = vi.fn(() => {
    throw new Error('cancelM1ProjectSubscription must never be called by read-only peel adapter');
  });

  return {
    synthetic: SYNTHETIC_META.synthetic,
    getM1ProjectContext: vi.fn(async (request: M1GetContextRequest) => {
      const result = createSyntheticM1ContextFields({ snapshot: { projectId: request.projectId } });
      const reply: EntryReply<'getContext'> = {
        projectId: request.projectId,
        authorizationRef: request.authorizationRef,
        requestGeneration: request.requestGeneration,
        requestId: request.requestId,
        entry: M1_ENTRY_CANDIDATE,
        operation: 'getContext',
        ok: true,
        result,
      };
      return { ok: true as const, value: reply };
    }),
    readM1ProjectEvents: vi.fn(async (request: M1ReadProjectEventsRequest) => {
      const page = createSyntheticFullEventPage(request.projectId, request.afterSequence);
      const reply: EntryReply<'readProjectEvents'> = {
        projectId: request.projectId,
        authorizationRef: request.authorizationRef,
        requestGeneration: request.requestGeneration,
        requestId: request.requestId,
        entry: M1_ENTRY_CANDIDATE,
        operation: 'readProjectEvents',
        ok: true,
        result: page,
      };
      return { ok: true as const, value: reply };
    }),
    subscribeM1ProjectEvents,
    cancelM1ProjectSubscription,
    ...overrides,
  };
}

describe('m1ReadPreloadAdapter (模拟 / synthetic: true)', () => {
  beforeEach(() => {
    vi.mocked(acceptEntryReply).mockClear();
  });

  it('keeps fail-closed defaults when getM1ReadCapabilities is absent and clamps production flags to false', () => {
    const transport = createSyntheticTransportDouble();
    const adapter = createM1ReadPreloadAdapter({ transport });

    const caps = adapter.getCapabilities();
    expect(caps).toEqual({
      trustedInjectionOnly: true,
      productionAuthorizationMapped: false,
      subscriptionsAvailable: false,
      productionApiConnected: false,
      formalSaveEnabled: false,
    });
    expect(adapter.getState().productionApiConnected).toBe(false);
    expect(adapter.getState().formalSaveEnabled).toBe(false);

    const permissiveTransport = createSyntheticTransportDouble({
      getM1ReadCapabilities: () => ({
        trustedInjectionOnly: true,
        productionAuthorizationMapped: false,
        subscriptionsAvailable: true,
        productionApiConnected: true,
        formalSaveEnabled: true,
      }),
    });
    const clampedAdapter = createM1ReadPreloadAdapter({ transport: permissiveTransport });
    expect(clampedAdapter.getCapabilities().subscriptionsAvailable).toBe(false);
    expect(clampedAdapter.getCapabilities().productionApiConnected).toBe(false);
    expect(clampedAdapter.getCapabilities().formalSaveEnabled).toBe(false);
    expect(permissiveTransport.subscribeM1ProjectEvents).not.toHaveBeenCalled();
    expect(permissiveTransport.cancelM1ProjectSubscription).not.toHaveBeenCalled();
  });

  it('stays honestly unavailable and never calls transport when authorizationRef is missing or empty', async () => {
    const transport = createSyntheticTransportDouble();
    const adapter = createM1ReadPreloadAdapter({ transport });

    const contextOutcome = await adapter.readContext({
      projectId: 'proj-synthetic-1',
      authorizationRef: '',
      requestGeneration: 1,
      requestId: 'req-empty-auth-1',
    });
    expect(contextOutcome.status).toBe('unavailable');
    expect(adapter.getState().available).toBe(false);
    expect(adapter.getState().acceptedContext).toBeNull();
    expect(transport.getM1ProjectContext).not.toHaveBeenCalled();

    const eventsOutcome = await adapter.readEvents({
      projectId: 'proj-synthetic-1',
      authorizationRef: '   ',
      requestGeneration: 1,
      requestId: 'req-blank-auth-2',
      afterSequence: 0,
      limit: 20,
    });
    expect(eventsOutcome.status).toBe('unavailable');
    expect(adapter.getState().available).toBe(false);
    expect(adapter.getState().acceptedEventPage).toBeNull();
    expect(transport.readM1ProjectEvents).not.toHaveBeenCalled();
    expect(acceptEntryReply).not.toHaveBeenCalled();
    expect(transport.subscribeM1ProjectEvents).not.toHaveBeenCalled();
    expect(transport.cancelM1ProjectSubscription).not.toHaveBeenCalled();
  });

  it('surfaces outer IpcResult errors (FORBIDDEN_SENDER / INVALID_REQUEST) without calling acceptEntryReply', async () => {
    const transport = createSyntheticTransportDouble({
      getM1ProjectContext: vi.fn(async (): Promise<IpcResult<EntryReply<'getContext'>>> => ({
        ok: false,
        error: {
          code: 'FORBIDDEN_SENDER',
          message: 'Sender frame is not authorized for preload read.',
        },
      })),
      readM1ProjectEvents: vi.fn(
        async (): Promise<IpcResult<EntryReply<'readProjectEvents'>>> => ({
          ok: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid readProjectEvents payload.',
          },
        }),
      ),
    });

    const adapter = createM1ReadPreloadAdapter({ transport });

    const ctxOutcome = await adapter.readContext({
      projectId: 'proj-synthetic-1',
      authorizationRef: 'trusted-ref-synthetic-1',
      requestGeneration: 1,
      requestId: 'req-outer-err-1',
    });
    expect(ctxOutcome.status).toBe('outer_error');
    if (ctxOutcome.status === 'outer_error') {
      expect(ctxOutcome.error.code).toBe('FORBIDDEN_SENDER');
      expect(ctxOutcome.error.message).toContain('Sender frame');
    }
    expect(adapter.getState().outerError?.code).toBe('FORBIDDEN_SENDER');
    expect(adapter.getState().acceptedContext).toBeNull();
    expect(acceptEntryReply).not.toHaveBeenCalled();

    const evtOutcome = await adapter.readEvents({
      projectId: 'proj-synthetic-1',
      authorizationRef: 'trusted-ref-synthetic-1',
      requestGeneration: 1,
      requestId: 'req-outer-err-2',
      afterSequence: 0,
      limit: 10,
    });
    expect(evtOutcome.status).toBe('outer_error');
    if (evtOutcome.status === 'outer_error') {
      expect(evtOutcome.error.code).toBe('INVALID_REQUEST');
      expect(evtOutcome.error.message).toContain('Invalid readProjectEvents');
    }
    expect(adapter.getState().outerError?.code).toBe('INVALID_REQUEST');
    expect(adapter.getState().acceptedEventPage).toBeNull();
    expect(acceptEntryReply).not.toHaveBeenCalled();
  });

  it('classifies and displays inner AUTH_REQUIRED and UNSUPPORTED_SCOPE error envelopes on outer ok', async () => {
    const transport = createSyntheticTransportDouble({
      getM1ProjectContext: vi.fn(async (request: M1GetContextRequest) => {
        const error = {
          code: 'AUTH_REQUIRED' as const,
          requestId: request.requestId,
          message: 'Authorization grant expired or missing.',
          retryable: false,
          details: VALID_M0_ERROR_DETAILS,
        };
        const reply: EntryReply<'getContext'> = {
          projectId: request.projectId,
        authorizationRef: request.authorizationRef,
        requestGeneration: request.requestGeneration,
        requestId: request.requestId,
          entry: M1_ENTRY_CANDIDATE,
          operation: 'getContext',
          ok: false,
          error,
        };
        return { ok: true as const, value: reply };
      }),
      readM1ProjectEvents: vi.fn(async (request: M1ReadProjectEventsRequest) => {
        const error = {
          code: 'UNSUPPORTED_SCOPE' as const,
          requestId: request.requestId,
          message: 'Project scope is not supported by this read entry.',
          retryable: false,
          details: VALID_M0_ERROR_DETAILS,
        };
        const reply: EntryReply<'readProjectEvents'> = {
          projectId: request.projectId,
        authorizationRef: request.authorizationRef,
        requestGeneration: request.requestGeneration,
        requestId: request.requestId,
          entry: M1_ENTRY_CANDIDATE,
          operation: 'readProjectEvents',
          ok: false,
          error,
        };
        return { ok: true as const, value: reply };
      }),
    });

    const adapter = createM1ReadPreloadAdapter({ transport });

    const authOutcome = await adapter.readContext({
      projectId: 'proj-synthetic-1',
      authorizationRef: 'trusted-ref-synthetic-1',
      requestGeneration: 1,
      requestId: 'req-inner-auth-1',
    });
    expect(acceptEntryReply).toHaveBeenCalledTimes(1);
    expect(authOutcome.status).toBe('inner_error');
    if (authOutcome.status === 'inner_error') {
      expect(authOutcome.failure.classification).toEqual(
        classifyEntryFailure(authOutcome.failure.error),
      );
      expect(authOutcome.failure.error.code).toBe('AUTH_REQUIRED');
      expect(authOutcome.failure.error.requestId).toBe('req-inner-auth-1');
    }
    expect(adapter.getState().innerFailure?.error.code).toBe('AUTH_REQUIRED');
    expect(adapter.getState().acceptedContext).toBeNull();

    const scopeOutcome = await adapter.readEvents({
      projectId: 'proj-synthetic-1',
      authorizationRef: 'trusted-ref-synthetic-1',
      requestGeneration: 1,
      requestId: 'req-inner-scope-2',
      afterSequence: 0,
      limit: 25,
    });
    expect(acceptEntryReply).toHaveBeenCalledTimes(2);
    expect(scopeOutcome.status).toBe('inner_error');
    if (scopeOutcome.status === 'inner_error') {
      expect(scopeOutcome.failure.classification).toEqual(
        classifyEntryFailure(scopeOutcome.failure.error),
      );
      expect(scopeOutcome.failure.error.code).toBe('UNSUPPORTED_SCOPE');
      expect(scopeOutcome.failure.error.requestId).toBe('req-inner-scope-2');
    }
    expect(adapter.getState().innerFailure?.error.code).toBe('UNSUPPORTED_SCOPE');
    expect(adapter.getState().acceptedEventPage).toBeNull();
  });

  it('presents accepted getContext via presentM1Context and readProjectEvents via acceptM1FullEventPage', async () => {
    const projectId = 'proj-synthetic-happy';
    const expectedContextFields = createSyntheticM1ContextFields({ snapshot: { projectId } });
    const expectedPage = createSyntheticFullEventPage(projectId, 0);

    const transport = createSyntheticTransportDouble({
      getM1ProjectContext: vi.fn(async (request: M1GetContextRequest) => ({
        ok: true as const,
        value: {
          projectId: request.projectId,
        authorizationRef: request.authorizationRef,
        requestGeneration: request.requestGeneration,
        requestId: request.requestId,
          entry: M1_ENTRY_CANDIDATE,
          operation: 'getContext' as const,
          ok: true as const,
          result: expectedContextFields,
        },
      })),
      readM1ProjectEvents: vi.fn(async (request: M1ReadProjectEventsRequest) => ({
        ok: true as const,
        value: {
          projectId: request.projectId,
        authorizationRef: request.authorizationRef,
        requestGeneration: request.requestGeneration,
        requestId: request.requestId,
          entry: M1_ENTRY_CANDIDATE,
          operation: 'readProjectEvents' as const,
          ok: true as const,
          result: expectedPage,
        },
      })),
    });

    const adapter = createM1ReadPreloadAdapter({ transport });

    const ctxOutcome = await adapter.readContext({
      projectId,
      authorizationRef: 'trusted-ref-happy-1',
      requestGeneration: 1,
      requestId: 'req-happy-ctx-1',
    });
    expect(ctxOutcome.status).toBe('accepted');
    if (ctxOutcome.status === 'accepted') {
      expect(ctxOutcome.context).toEqual(presentM1Context(expectedContextFields));
    }
    expect(adapter.getState().acceptedContext).toEqual(presentM1Context(expectedContextFields));

    const evtOutcome = await adapter.readEvents({
      projectId,
      authorizationRef: 'trusted-ref-happy-1',
      requestGeneration: 1,
      requestId: 'req-happy-evt-2',
      afterSequence: 0,
      limit: 50,
    });
    expect(evtOutcome.status).toBe('accepted');
    if (evtOutcome.status === 'accepted') {
      expect(evtOutcome.page).toEqual(
        acceptM1FullEventPage(projectId, 0, expectedPage),
      );
    }
    expect(adapter.getState().acceptedEventPage).toEqual(
      acceptM1FullEventPage(projectId, 0, expectedPage),
    );
    expect(adapter.getState().productionApiConnected).toBe(false);
    expect(adapter.getState().formalSaveEnabled).toBe(false);
    expect(transport.subscribeM1ProjectEvents).not.toHaveBeenCalled();
    expect(transport.cancelM1ProjectSubscription).not.toHaveBeenCalled();
  });

  it('rejects late replies with mismatched projectId, requestGeneration, or requestId without updating accepted state', async () => {
    let currentScope: M1ReadTrustedScope = {
      projectId: 'proj-synthetic-a',
      authorizationRef: 'trusted-ref-a',
      requestGeneration: 1,
    };

    const transport = createSyntheticTransportDouble({
      getM1ProjectContext: vi.fn(async (request: M1GetContextRequest) => {
        // Simulate scope switching to another project while request is in flight
        currentScope = {
          projectId: 'proj-synthetic-b',
          authorizationRef: 'trusted-ref-a',
          requestGeneration: 1,
        };
        return {
          ok: true as const,
          value: {
            projectId: request.projectId,
        authorizationRef: request.authorizationRef,
        requestGeneration: request.requestGeneration,
        requestId: request.requestId,
            entry: M1_ENTRY_CANDIDATE,
            operation: 'getContext' as const,
            ok: true as const,
            result: createSyntheticM1ContextFields({ snapshot: { projectId: request.projectId } }),
          },
        };
      }),
      readM1ProjectEvents: vi.fn(async (request: M1ReadProjectEventsRequest) => {
        return {
          ok: true as const,
          value: {
            projectId: request.projectId,
            authorizationRef: request.authorizationRef,
            requestGeneration: request.requestGeneration,
            requestId: 'req-mismatched-stale',
            entry: M1_ENTRY_CANDIDATE,
            operation: 'readProjectEvents' as const,
            ok: true as const,
            result: createSyntheticFullEventPage(request.projectId, request.afterSequence),
          },
        };
      }),
    });

    const adapter = createM1ReadPreloadAdapter({
      transport,
      getCurrentScope: () => currentScope,
    });

    // 1. Mismatched projectId
    const wrongProjectOutcome = await adapter.readContext({
      projectId: 'proj-synthetic-a',
      authorizationRef: 'trusted-ref-a',
      requestGeneration: 1,
      requestId: 'req-late-project-1',
    });
    expect(wrongProjectOutcome.status).toBe('rejected');
    expect(adapter.getState().acceptedContext).toBeNull();

    // 2. Mismatched requestGeneration
    const genTransport = createSyntheticTransportDouble({
      getM1ProjectContext: vi.fn(async (request: M1GetContextRequest) => {
        currentScope = {
          projectId: request.projectId,
          authorizationRef: request.authorizationRef,
          requestGeneration: request.requestGeneration + 1,
        };
        return {
          ok: true as const,
          value: {
            projectId: request.projectId,
        authorizationRef: request.authorizationRef,
        requestGeneration: request.requestGeneration,
        requestId: request.requestId,
            entry: M1_ENTRY_CANDIDATE,
            operation: 'getContext' as const,
            ok: true as const,
            result: createSyntheticM1ContextFields({ snapshot: { projectId: request.projectId } }),
          },
        };
      }),
    });
    currentScope = {
      projectId: 'proj-synthetic-gen',
      authorizationRef: 'trusted-ref-gen',
      requestGeneration: 3,
    };
    const genAdapter = createM1ReadPreloadAdapter({
      transport: genTransport,
      getCurrentScope: () => currentScope,
    });
    const wrongGenOutcome = await genAdapter.readContext({
      projectId: 'proj-synthetic-gen',
      authorizationRef: 'trusted-ref-gen',
      requestGeneration: 3,
      requestId: 'req-late-gen-1',
    });
    expect(wrongGenOutcome.status).toBe('rejected');
    expect(genAdapter.getState().acceptedContext).toBeNull();

    // 3. Mismatched requestId on readProjectEvents
    currentScope = {
      projectId: 'proj-synthetic-b',
      authorizationRef: 'trusted-ref-a',
      requestGeneration: 1,
    };
    const wrongReqIdOutcome = await adapter.readEvents({
      projectId: 'proj-synthetic-b',
      authorizationRef: 'trusted-ref-a',
      requestGeneration: 1,
      requestId: 'req-expected-id',
      afterSequence: 0,
      limit: 10,
    });
    expect(wrongReqIdOutcome.status).toBe('rejected');
    expect(adapter.getState().acceptedEventPage).toBeNull();
    expect(transport.subscribeM1ProjectEvents).not.toHaveBeenCalled();
    expect(transport.cancelM1ProjectSubscription).not.toHaveBeenCalled();
  });
});
