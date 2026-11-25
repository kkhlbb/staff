// @vitest-environment jsdom
/**
 * 模拟 / synthetic: true
 * Isolated synthetic bridge doubles only — never real native authorization or live IPC.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  M1_ENTRY_CANDIDATE,
  type EntryReply,
  type EntryScope,
} from '../../../desktop/shared/project-agent/m1-entry-1933.ts'
import type { M1AuthorizationRequest } from '../../../desktop/shared/project-agent/m1-local-authorization-2002.ts'
import {
  createSyntheticM1ContextFields,
  createSyntheticM1SpacerDraft,
} from './m1FieldFixtures'
import { M1_FULL_EVENT_PAGE_CANDIDATE } from './m1FullEventPagePresentation'
import type {
  M1GetContextRequest,
  M1ReadProjectEventsRequest,
} from './m1ReadPreloadAdapter'
import {
  M1_READONLY_ENTRY_CAPABILITIES,
  M1_READONLY_REQUIRED_BRIDGE_METHODS,
  probeM1ReadonlyAuthBridge,
  type M1LocalBridgeResult,
  type M1ReadonlyAuthBridge,
} from './m1ReadonlyAuthBridge'
import { ProjectAgentM1ReadonlyEntry } from './ProjectAgentM1ReadonlyEntry'

afterEach(cleanup)

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createSyntheticEventPage(
  projectId: string,
  afterSequence: number,
): Extract<EntryReply<'readProjectEvents'>, { ok: true }>['result'] {
  return {
    events: [
      {
        version: '0.1.0-m0' as const,
        projectId,
        baseRevision: 'rev-base-1',
        draftRevision: null,
        jobId: null,
        sequence: afterSequence + 1,
        type: 'contextChanged' as const,
      },
      {
        candidate: M1_FULL_EVENT_PAGE_CANDIDATE,
        type: 'taskChanged' as const,
        projectId,
        baseRevision: 'rev-base-1',
        draftRevision: 'draft-sim-1',
        jobId: 'job-sim-1',
        sequence: afterSequence + 2,
        activity: {
          taskId: 'task-sim-1',
          projectId,
          source: 'internal' as const,
          baseRevision: 'rev-base-1',
          draftRevision: 'draft-sim-1',
          status: 'running' as const,
          lastStep: '解析隔套参数',
          question: null,
          errorCode: null,
          updatedAtMs: 0,
        },
      },
    ],
    nextCursor: afterSequence + 2,
    highWatermark: afterSequence + 2,
  }
}

interface SyntheticBridgeDouble extends M1ReadonlyAuthBridge {
  readonly synthetic: true
  readonly requestM1ProjectAuthorization: ReturnType<
    typeof vi.fn<(request: M1AuthorizationRequest) => Promise<M1LocalBridgeResult<EntryScope>>>
  >
  readonly revokeM1ProjectAuthorization: ReturnType<
    typeof vi.fn<
      (request: M1AuthorizationRequest) => Promise<M1LocalBridgeResult<{ readonly revoked: true }>>
    >
  >
  readonly getM1ProjectContext: ReturnType<
    typeof vi.fn<
      (request: M1GetContextRequest) => Promise<M1LocalBridgeResult<EntryReply<'getContext'>>>
    >
  >
  readonly readM1ProjectEvents: ReturnType<
    typeof vi.fn<
      (
        request: M1ReadProjectEventsRequest,
      ) => Promise<M1LocalBridgeResult<EntryReply<'readProjectEvents'>>>
    >
  >
  readonly subscribeM1ProjectEvents: ReturnType<typeof vi.fn>
  readonly cancelM1ProjectSubscription: ReturnType<typeof vi.fn>
}

function createSyntheticBridgeDouble(
  overrides?: Partial<M1ReadonlyAuthBridge>,
): SyntheticBridgeDouble {
  let grantSeq = 0
  const subscribeM1ProjectEvents = vi.fn(() => {
    throw new Error('subscribeM1ProjectEvents must never be called by M1 read-only entry')
  })
  const cancelM1ProjectSubscription = vi.fn(() => {
    throw new Error('cancelM1ProjectSubscription must never be called by M1 read-only entry')
  })

  const base: SyntheticBridgeDouble = {
    synthetic: true as const,
    requestM1ProjectAuthorization: vi.fn(async (request: M1AuthorizationRequest) => {
      grantSeq += 1
      return {
        ok: true as const,
        value: {
          projectId: request.projectId,
          authorizationRef: `synth-ref-${grantSeq}`,
          requestGeneration: request.requestGeneration,
        },
      }
    }),
    revokeM1ProjectAuthorization: vi.fn(async () => ({
      ok: true as const,
      value: { revoked: true as const },
    })),
    getM1ProjectContext: vi.fn(async (request: M1GetContextRequest) => {
      const draftRevision = `draft-${request.projectId}`
      const result = createSyntheticM1ContextFields({
        snapshot: {
          projectId: request.projectId,
          authorization: { authorized: true, canWrite: false },
          draftRevision,
          spacerDraft: createSyntheticM1SpacerDraft({ draftRevision }),
        },
      })
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
          result,
        },
      }
    }),
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
        result: createSyntheticEventPage(request.projectId, request.afterSequence),
      },
    })),
    subscribeM1ProjectEvents,
    cancelM1ProjectSubscription,
  }

  return {
    ...base,
    ...overrides,
  } as SyntheticBridgeDouble
}

describe('ProjectAgentM1ReadonlyEntry (模拟 / synthetic: true)', () => {
  it('桥接方法缺失任一项时诚实显示不可用，禁止伪造凭据或回退 mock', () => {
    const emptyProbe = probeM1ReadonlyAuthBridge(null)
    expect(emptyProbe.available).toBe(false)
    expect(emptyProbe.missingMethods).toEqual([...M1_READONLY_REQUIRED_BRIDGE_METHODS])

    for (const missingMethod of M1_READONLY_REQUIRED_BRIDGE_METHODS) {
      const partialBridge: Record<string, unknown> = {
        requestM1ProjectAuthorization: vi.fn(),
        revokeM1ProjectAuthorization: vi.fn(),
        getM1ProjectContext: vi.fn(),
        readM1ProjectEvents: vi.fn(),
      }
      delete partialBridge[missingMethod]

      const probe = probeM1ReadonlyAuthBridge(partialBridge)
      expect(probe.available).toBe(false)
      expect(probe.missingMethods).toEqual([missingMethod])

      render(
        <ProjectAgentM1ReadonlyEntry
          bridge={partialBridge}
          initialProjectId="proj-alpha"
          synthetic
        />,
      )

      expect(screen.getByText('不可用')).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent(missingMethod)
      expect(screen.getByRole('button', { name: '申请只读授权' })).toBeDisabled()
      expect(screen.getByRole('button', { name: '撤销授权' })).toBeDisabled()
      expect(screen.getByRole('button', { name: '读取项目上下文' })).toBeDisabled()
      expect(screen.getByRole('button', { name: '读取项目事件' })).toBeDisabled()
      cleanup()
    }
  })

  it('初始渲染不自动发起授权或读取，且全部写/订阅/对话/正式保存/生产连接能力标志保持 false', () => {
    const bridge = createSyntheticBridgeDouble({
      // Even if backend reports productionAuthorizationMapped: true, UI must NOT claim production connected.
      getM1ReadCapabilities: () => ({
        trustedInjectionOnly: true,
        productionAuthorizationMapped: true,
        subscriptionsAvailable: true,
        productionApiConnected: true,
        formalSaveEnabled: true,
      }),
    })

    render(
      <ProjectAgentM1ReadonlyEntry
        bridge={bridge}
        initialProjectId="proj-alpha"
        synthetic
      />,
    )

    expect(M1_READONLY_ENTRY_CAPABILITIES).toEqual({
      productionApiConnected: false,
      formalSaveEnabled: false,
      writeEnabled: false,
      subscribeEnabled: false,
      conversationEnabled: false,
    })
    expect(bridge.requestM1ProjectAuthorization).not.toHaveBeenCalled()
    expect(bridge.revokeM1ProjectAuthorization).not.toHaveBeenCalled()
    expect(bridge.getM1ProjectContext).not.toHaveBeenCalled()
    expect(bridge.readM1ProjectEvents).not.toHaveBeenCalled()
    expect(bridge.subscribeM1ProjectEvents).not.toHaveBeenCalled()
    expect(bridge.cancelM1ProjectSubscription).not.toHaveBeenCalled()

    expect(screen.getAllByText('生产 API：未接通').length).toBeGreaterThan(0)
    expect(screen.getByText('正式保存：禁用')).toBeInTheDocument()
    expect(screen.getByText(/写入：未开放 · 订阅：未开放 · 对话：未开放/)).toBeInTheDocument()
    expect(screen.getByText('本地只读未授权')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '读取项目上下文' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '读取项目事件' })).toBeDisabled()
  })

  it('取消/拒绝返回 AUTH_REQUIRED 时不产生假成功，且取消新请求不破坏已有有效授权', async () => {
    const bridge = createSyntheticBridgeDouble()
    bridge.requestM1ProjectAuthorization
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'AUTH_REQUIRED', message: '用户取消了授权确认' },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          projectId: 'proj-alpha',
          authorizationRef: 'synth-ref-valid-1',
          requestGeneration: 2,
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'AUTH_REQUIRED', message: '用户取消了新的授权请求' },
      })

    render(
      <ProjectAgentM1ReadonlyEntry
        bridge={bridge}
        initialProjectId="proj-alpha"
        synthetic
      />,
    )

    // 1) Initial request cancelled -> AUTH_REQUIRED visible, no fake success
    fireEvent.click(screen.getByRole('button', { name: '申请只读授权' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('AUTH_REQUIRED')
    })
    expect(screen.getByRole('alert')).toHaveTextContent('用户取消了授权确认')
    expect(screen.getByText('本地只读未授权')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '读取项目上下文' })).toBeDisabled()

    // 2) Second request succeeds -> valid grant active
    fireEvent.click(screen.getByRole('button', { name: '申请只读授权' }))

    await waitFor(() => {
      expect(screen.getByText('本地只读已授权')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '读取项目上下文' })).not.toBeDisabled()

    // 3) Third (new) request cancelled -> AUTH_REQUIRED visible, existing valid grant remains intact
    fireEvent.click(screen.getByRole('button', { name: '申请只读授权' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('AUTH_REQUIRED')
    })
    expect(screen.getByRole('alert')).toHaveTextContent('用户取消了新的授权请求')
    expect(screen.getByText('本地只读已授权')).toBeInTheDocument()

    // Reading context still succeeds using the existing valid authorizationRef & generation
    fireEvent.click(screen.getByRole('button', { name: '读取项目上下文' }))

    await waitFor(() => {
      expect(screen.getAllByText('draft-proj-alpha').length).toBeGreaterThan(0)
    })
    expect(bridge.getM1ProjectContext).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-alpha',
        authorizationRef: 'synth-ref-valid-1',
        requestGeneration: 2,
      }),
    )
  })

  it('授权请求仅发送 2002 白名单字段，授权后通过 peel adapter 读取上下文与事件并渲染 Session', async () => {
    const bridge = createSyntheticBridgeDouble()

    render(
      <ProjectAgentM1ReadonlyEntry
        bridge={bridge}
        initialProjectId="proj-alpha"
        synthetic
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '申请只读授权' }))

    await waitFor(() => {
      expect(screen.getByText('本地只读已授权')).toBeInTheDocument()
    })

    // Strictly { projectId, requestId, requestGeneration } only
    const authReq = bridge.requestM1ProjectAuthorization.mock.calls[0]?.[0]
    expect(authReq).toBeDefined()
    expect(Object.keys(authReq!).sort()).toEqual(['projectId', 'requestGeneration', 'requestId'])
    expect(authReq!.projectId).toBe('proj-alpha')
    expect(authReq!.requestGeneration).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: '读取项目上下文' }))

    await waitFor(() => {
      expect(screen.getAllByText('draft-proj-alpha').length).toBeGreaterThan(0)
    })
    expect(screen.getByRole('region', { name: '授权：已授权（只读）' })).toBeInTheDocument()
    expect(screen.getByText('task-01')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '读取项目事件' }))

    await waitFor(() => {
      expect(screen.getByRole('region', { name: '只读事件页' })).toBeInTheDocument()
    })
    expect(screen.getByText('事件总数：2')).toBeInTheDocument()
    expect(screen.getByText('M0 事件：1')).toBeInTheDocument()
    expect(screen.getByText('任务事件：1')).toBeInTheDocument()
    expect(screen.getByText('contextChanged')).toBeInTheDocument()
    expect(screen.getByText('taskChanged')).toBeInTheDocument()
    expect(bridge.subscribeM1ProjectEvents).not.toHaveBeenCalled()
    expect(bridge.cancelM1ProjectSubscription).not.toHaveBeenCalled()
  })

  it('丢弃乱序与迟到的授权和读取回包，不覆盖最新结果', async () => {
    const firstContextDeferred = createDeferred<M1LocalBridgeResult<EntryReply<'getContext'>>>()
    const secondContextDeferred = createDeferred<M1LocalBridgeResult<EntryReply<'getContext'>>>()
    const firstAuthDeferred = createDeferred<M1LocalBridgeResult<EntryScope>>()
    const secondAuthDeferred = createDeferred<M1LocalBridgeResult<EntryScope>>()

    const bridge = createSyntheticBridgeDouble()
    bridge.requestM1ProjectAuthorization
      .mockImplementationOnce(() => firstAuthDeferred.promise)
      .mockImplementationOnce(() => secondAuthDeferred.promise)
    bridge.getM1ProjectContext
      .mockImplementationOnce(() => firstContextDeferred.promise)
      .mockImplementationOnce(() => secondContextDeferred.promise)

    render(
      <ProjectAgentM1ReadonlyEntry
        bridge={bridge}
        initialProjectId="proj-alpha"
        synthetic
      />,
    )

    // Issue two auth requests; second resolves first, first arrives late
    fireEvent.click(screen.getByRole('button', { name: '申请只读授权' }))
    fireEvent.click(screen.getByRole('button', { name: '申请只读授权' }))

    const req1 = bridge.requestM1ProjectAuthorization.mock.calls[0]![0]
    const req2 = bridge.requestM1ProjectAuthorization.mock.calls[1]![0]

    await act(async () => {
      secondAuthDeferred.resolve({
        ok: true,
        value: {
          projectId: req2.projectId,
          authorizationRef: 'synth-ref-latest',
          requestGeneration: req2.requestGeneration,
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByText('本地只读已授权')).toBeInTheDocument()
    })

    // Late auth reply from req1 must be discarded
    await act(async () => {
      firstAuthDeferred.resolve({
        ok: true,
        value: {
          projectId: req1.projectId,
          authorizationRef: 'synth-ref-stale',
          requestGeneration: req1.requestGeneration,
        },
      })
    })

    // Issue two context reads; second resolves first, first arrives late
    fireEvent.click(screen.getByRole('button', { name: '读取项目上下文' }))
    fireEvent.click(screen.getByRole('button', { name: '读取项目上下文' }))

    const ctxReq1 = bridge.getM1ProjectContext.mock.calls[0]![0]
    const ctxReq2 = bridge.getM1ProjectContext.mock.calls[1]![0]
    expect(ctxReq1.authorizationRef).toBe('synth-ref-latest')
    expect(ctxReq2.authorizationRef).toBe('synth-ref-latest')

    await act(async () => {
      secondContextDeferred.resolve({
        ok: true,
        value: {
          projectId: ctxReq2.projectId,
          authorizationRef: ctxReq2.authorizationRef,
          requestGeneration: ctxReq2.requestGeneration,
          requestId: ctxReq2.requestId,
          entry: M1_ENTRY_CANDIDATE,
          operation: 'getContext',
          ok: true,
          result: createSyntheticM1ContextFields({
            snapshot: {
              projectId: ctxReq2.projectId,
              draftRevision: 'draft-newest',
              spacerDraft: createSyntheticM1SpacerDraft({ draftRevision: 'draft-newest' }),
              authorization: { authorized: true, canWrite: false },
            },
          }),
        },
      })
    })

    await waitFor(() => {
      expect(screen.getAllByText('draft-newest').length).toBeGreaterThan(0)
    })

    // Late reply from ctxReq1 must be discarded and must not overwrite draft-newest
    await act(async () => {
      firstContextDeferred.resolve({
        ok: true,
        value: {
          projectId: ctxReq1.projectId,
          authorizationRef: ctxReq1.authorizationRef,
          requestGeneration: ctxReq1.requestGeneration,
          requestId: ctxReq1.requestId,
          entry: M1_ENTRY_CANDIDATE,
          operation: 'getContext',
          ok: true,
          result: createSyntheticM1ContextFields({
            snapshot: {
              projectId: ctxReq1.projectId,
              draftRevision: 'draft-stale-old',
              spacerDraft: createSyntheticM1SpacerDraft({ draftRevision: 'draft-stale-old' }),
              authorization: { authorized: true, canWrite: false },
            },
          }),
        },
      })
    })

    expect(screen.getAllByText('draft-newest').length).toBeGreaterThan(0)
    expect(screen.queryByText('draft-stale-old')).not.toBeInTheDocument()
  })

  it('撤权时立即清空受限视图并丢弃已接受上下文与 ref，且撤权后迟到读取回包被丢弃', async () => {
    const revokeDeferred = createDeferred<M1LocalBridgeResult<{ readonly revoked: true }>>()
    const inflightReadDeferred = createDeferred<M1LocalBridgeResult<EntryReply<'getContext'>>>()
    const bridge = createSyntheticBridgeDouble()
    bridge.revokeM1ProjectAuthorization.mockImplementationOnce(() => revokeDeferred.promise)

    render(
      <ProjectAgentM1ReadonlyEntry
        bridge={bridge}
        initialProjectId="proj-alpha"
        synthetic
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '申请只读授权' }))
    await waitFor(() => {
      expect(screen.getByText('本地只读已授权')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '读取项目上下文' }))
    await waitFor(() => {
      expect(screen.getAllByText('draft-proj-alpha').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: '读取项目事件' }))
    await waitFor(() => {
      expect(screen.getByRole('region', { name: '只读事件页' })).toBeInTheDocument()
    })

    // Start an in-flight read right before revoking
    bridge.getM1ProjectContext.mockImplementationOnce(() => inflightReadDeferred.promise)
    fireEvent.click(screen.getByRole('button', { name: '读取项目上下文' }))
    const inflightReq = bridge.getM1ProjectContext.mock.calls[1]![0]

    // Click revoke — restricted view MUST clear immediately before revoke promise settles
    fireEvent.click(screen.getByRole('button', { name: '撤销授权' }))

    expect(screen.getByText('本地只读未授权')).toBeInTheDocument()
    expect(screen.queryByText('draft-proj-alpha')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '只读事件页' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '读取项目上下文' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '读取项目事件' })).toBeDisabled()

    // Late read reply arriving after revoke must be discarded
    await act(async () => {
      inflightReadDeferred.resolve({
        ok: true,
        value: {
          projectId: inflightReq.projectId,
          authorizationRef: inflightReq.authorizationRef,
          requestGeneration: inflightReq.requestGeneration,
          requestId: inflightReq.requestId,
          entry: M1_ENTRY_CANDIDATE,
          operation: 'getContext',
          ok: true,
          result: createSyntheticM1ContextFields({
            snapshot: {
              projectId: inflightReq.projectId,
              draftRevision: 'draft-after-revoke-leak',
              spacerDraft: createSyntheticM1SpacerDraft({ draftRevision: 'draft-after-revoke-leak' }),
              authorization: { authorized: true, canWrite: false },
            },
          }),
        },
      })
    })

    expect(screen.queryByText('draft-after-revoke-leak')).not.toBeInTheDocument()
    expect(screen.getByText('本地只读未授权')).toBeInTheDocument()

    // Settle revoke IPC
    await act(async () => {
      revokeDeferred.resolve({ ok: true, value: { revoked: true } })
    })
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('已撤销项目 proj-alpha 的本地只读授权')
    })
  })

  it('切换项目与组件卸载均隔离作用域并丢弃迟到的授权和读取回包', async () => {
    const authAlphaDeferred = createDeferred<M1LocalBridgeResult<EntryScope>>()
    const readAlphaDeferred = createDeferred<M1LocalBridgeResult<EntryReply<'getContext'>>>()
    const bridge = createSyntheticBridgeDouble()

    // Part A: Switch project while auth request is in flight
    bridge.requestM1ProjectAuthorization.mockImplementationOnce(() => authAlphaDeferred.promise)

    const { unmount } = render(
      <ProjectAgentM1ReadonlyEntry
        bridge={bridge}
        initialProjectId="proj-alpha"
        synthetic
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '申请只读授权' }))
    const alphaAuthReq = bridge.requestM1ProjectAuthorization.mock.calls[0]![0]

    // Switch project to proj-beta before proj-alpha auth resolves
    fireEvent.change(screen.getByLabelText('目标项目 ID'), { target: { value: 'proj-beta' } })
    fireEvent.click(screen.getByRole('button', { name: '切换项目' }))

    // Late proj-alpha auth resolves -> must be discarded
    await act(async () => {
      authAlphaDeferred.resolve({
        ok: true,
        value: {
          projectId: alphaAuthReq.projectId,
          authorizationRef: 'synth-ref-alpha-late',
          requestGeneration: alphaAuthReq.requestGeneration,
        },
      })
    })

    expect(screen.getByText('本地只读未授权')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '读取项目上下文' })).toBeDisabled()

    // Authorize proj-beta, start a context read, then unmount before it resolves
    fireEvent.click(screen.getByRole('button', { name: '申请只读授权' }))
    await waitFor(() => {
      expect(screen.getByText('本地只读已授权')).toBeInTheDocument()
    })

    bridge.getM1ProjectContext.mockImplementationOnce(() => readAlphaDeferred.promise)
    fireEvent.click(screen.getByRole('button', { name: '读取项目上下文' }))
    const betaReadReq = bridge.getM1ProjectContext.mock.calls[0]![0]

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    unmount()

    // Resolve in-flight read after unmount -> must be discarded cleanly with no React state error
    await act(async () => {
      readAlphaDeferred.resolve({
        ok: true,
        value: {
          projectId: betaReadReq.projectId,
          authorizationRef: betaReadReq.authorizationRef,
          requestGeneration: betaReadReq.requestGeneration,
          requestId: betaReadReq.requestId,
          entry: M1_ENTRY_CANDIDATE,
          operation: 'getContext',
          ok: true,
          result: createSyntheticM1ContextFields({
            snapshot: {
              projectId: betaReadReq.projectId,
              draftRevision: 'draft-after-unmount',
              spacerDraft: createSyntheticM1SpacerDraft({ draftRevision: 'draft-after-unmount' }),
              authorization: { authorized: true, canWrite: false },
            },
          }),
        },
      })
    })

    expect(consoleErrorSpy).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})
