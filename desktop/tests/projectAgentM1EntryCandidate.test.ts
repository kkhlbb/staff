import { expect, it, vi } from 'vitest'
import { isProjectAgentEvent } from '../shared/project-agent/contracts.ts'
import {
  acceptEntryDelivery, acceptEntryReply, classifyEntryFailure, entryRequests, M1_ENTRY_CANDIDATE,
  m1EntryCapabilities, routeEntryPage,
} from '../shared/project-agent/m1-entry-1933.ts'

const scope = { projectId: 'p', authorizationRef: 'a', requestGeneration: 4 }
const req = { ...scope, requestId: 'r' }
const eventScope = { projectId: 'p', baseRevision: null, draftRevision: null, jobId: null }
const m0 = { ...eventScope, version: '0.1.0-m0', type: 'contextChanged', sequence: 1 }
const task = { ...eventScope, candidate: 'm1-review-1853', type: 'taskChanged', sequence: 2,
  activity: { projectId: 'p', taskId: 't', source: 'internal', baseRevision: null, draftRevision: null,
    status: 'queued', lastStep: null, question: null, errorCode: null, updatedAtMs: 0 } }
const page = { events: [m0, task], nextCursor: 2, highWatermark: 3 }
const read = { ...req, afterSequence: 0, limit: 2 }
const reply = { ...req, entry: M1_ENTRY_CANDIDATE, operation: 'readProjectEvents', ok: true, result: page }
const subscription = { ...scope, subscriptionId: 'server-1' }
const delivery = { ...subscription, entry: M1_ENTRY_CANDIDATE, page }

it('accepts only the narrow context, read and spacer request shapes', () => {
  expect(entryRequests.getContext(req)).toBe(true)
  expect(entryRequests.getContext({ ...req, channel: 'agent:context' })).toBe(false)
  expect(entryRequests.readProjectEvents(read)).toBe(true)
  expect(entryRequests.readProjectEvents({ ...read, afterSequence: -1 })).toBe(false)
  const stage = { ...req, writerToken: 'w', writerEpoch: 1, idempotencyKey: 'i',
    baseRevision: null, expectedDraftRevision: null,
    operation: { type: 'createSpacerDraft' as const, innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120000 } }
  expect(entryRequests.stageChange(stage)).toBe(true)
  expect(entryRequests.stageChange({ ...stage, operation: { ...stage.operation, type: 'commitApprovedDraft' } })).toBe(false)
  expect(entryRequests.stageChange({ ...stage, path: '/project' })).toBe(false)
  const draft = { draftRevision: 'd', innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120000,
    sources: { innerDiameterQ: { type: 'userInput' }, outerDiameterQ: { type: 'userInput' }, lengthQ: { type: 'userInput' } },
    question: null }
  const staged = { ...req, entry: M1_ENTRY_CANDIDATE, operation: 'stageChange', ok: true, result: draft }
  expect(acceptEntryReply('stageChange', stage, scope, staged)).toBe(true)
  expect(acceptEntryReply('stageChange', stage, scope, { ...staged, result: { ...draft, lengthQ: 130000 } })).toBe(false)
})

it('checks the server-issued subscription and rejects delivery after local cancellation', () => {
  const start = { ...req, afterSequence: 0 }
  const started = { ...req, entry: M1_ENTRY_CANDIDATE, operation: 'subscribe', ok: true, result: subscription }
  expect(entryRequests.subscribe(start)).toBe(true)
  expect(acceptEntryReply('subscribe', start, scope, started)).toBe(true)
  expect(acceptEntryReply('subscribe', start, scope, { ...started, result: { ...subscription, projectId: 'q' } })).toBe(false)
  expect(entryRequests.cancel({ ...req, subscriptionId: subscription.subscriptionId })).toBe(true)
  expect(entryRequests.cancel(req)).toBe(false)
  expect(acceptEntryDelivery(scope, subscription, 0, delivery)).toBe(true)
  expect(acceptEntryDelivery(scope, subscription, 0, { ...delivery, subscriptionId: 'other' })).toBe(false)
  expect(acceptEntryDelivery(scope, null, 0, delivery)).toBe(false)
})

it('rejects old project, authorization and request generations for replies and subscriptions', () => {
  expect(acceptEntryReply('readProjectEvents', read, scope, reply)).toBe(true)
  const contextReply = { ...req, entry: M1_ENTRY_CANDIDATE, operation: 'getContext', ok: true,
    result: { snapshot: { projectId: 'p', draftRevision: null, cursor: 0, connection: 'disconnected',
      authorization: { authorized: true, canWrite: false }, writer: { epoch: 0, occupied: false }, spacerDraft: null }, activities: [] } }
  expect(acceptEntryReply('getContext', req, scope, contextReply)).toBe(true)
  for (const change of [{ projectId: 'q' }, { authorizationRef: 'b' }, { requestGeneration: 5 }]) {
    const current = { ...scope, ...change }
    expect(acceptEntryReply('readProjectEvents', read, current, reply)).toBe(false)
    expect(acceptEntryReply('getContext', req, current, contextReply)).toBe(false)
    expect(acceptEntryDelivery(current, subscription, 0, delivery)).toBe(false)
  }
})

it('fails closed on legacy agent payloads and bare M0 pages at the entry boundary', () => {
  expect(acceptEntryReply('readProjectEvents', read, scope, { events: [m0], nextCursor: 1, highWatermark: 1 })).toBe(false)
  expect(acceptEntryReply('readProjectEvents', read, scope, { ...reply, entry: '0.1.0-m0' })).toBe(false)
  expect(acceptEntryReply('getContext', req, scope, { ok: true, value: { activeTask: null } })).toBe(false)
  expect(acceptEntryReply('getContext', req, scope, { ...reply, operation: 'getContext', result: { activeTask: null } })).toBe(false)
  expect(acceptEntryReply('readProjectEvents', read, scope, {
    ...reply, result: { events: [m0], nextCursor: 1, highWatermark: 1 },
  })).toBe(true)
})

it('routes taskChanged to the task callback only', () => {
  const onM0 = vi.fn()
  const onTask = vi.fn()
  expect(isProjectAgentEvent(task)).toBe(false)
  expect(routeEntryPage('p', 0, page, onM0, onTask)).toBe(true)
  expect(onM0.mock.calls).toEqual([[m0]])
  expect(onTask.mock.calls).toEqual([[task]])
  expect(routeEntryPage('p', 1, page, onM0, onTask)).toBe(false)
  expect(onM0).toHaveBeenCalledTimes(1)
  expect(onTask).toHaveBeenCalledTimes(1)
})

it('classifies M0 and candidate errors only with complete recovery envelopes', () => {
  const failure = { requestId: 'r', message: 'retry', retryable: true,
    details: { baseRevision: null, draftRevision: null, retryStep: null, recovery: 'refreshSnapshot', question: null } }
  expect(classifyEntryFailure({ ...failure, code: 'CURSOR_EXPIRED' })?.kind).toBe('m0')
  expect(classifyEntryFailure({ ...failure, code: 'DRAFT_NOT_EMPTY' })?.kind).toBe('candidate')
  expect(classifyEntryFailure({ requestId: 'r', code: 'DRAFT_NOT_EMPTY', message: 'retry' })).toBeNull()
  const { result: _result, ...header } = reply
  expect(_result).toBe(page)
  const response = { ...header, ok: false, error: { ...failure, code: 'DRAFT_NOT_EMPTY' } }
  expect(acceptEntryReply('readProjectEvents', read, scope, response)).toBe(true)
  expect(acceptEntryReply('readProjectEvents', read, scope, { ...response, error: { ...response.error, requestId: 'wrong' } })).toBe(false)
})

it('reports no connected production capabilities', () => {
  expect(m1EntryCapabilities.connected).toEqual([])
  expect(m1EntryCapabilities.productionApiConnected).toBe(false)
  expect(m1EntryCapabilities.formalSaveEnabled).toBe(false)
  expect(m1EntryCapabilities.unimplemented.continueConversation).toBe(false)
  expect(Object.values(m1EntryCapabilities.unimplemented)).not.toContain(true)
  expect(Object.values(m1EntryCapabilities.harnessOnly)).not.toContain(true)
})
