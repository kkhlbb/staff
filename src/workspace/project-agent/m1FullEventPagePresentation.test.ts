import { describe, expect, it, vi } from 'vitest'
import { acceptM1EventPage } from './m1FieldPresentation.ts'
import {
  M1_FULL_EVENT_PAGE_CANDIDATE,
  M1_FULL_EVENT_PAGE_CAPABILITIES,
  acceptM1FullEventPage,
  applyM1FullEventPageToM0Reducer,
  bumpM1FullEventConsumerGeneration,
  classifyM1FullEvent,
  consumeM1FullEventPageForSession,
  createM1FullEventConsumerSession,
  issueM1FullEventRequestToken,
  presentM1IncrementFailure,
  switchM1FullEventConsumerProject,
} from './m1FullEventPagePresentation.ts'
import type { M1LegacyM0Event } from './m1FullEventPagePresentation.ts'

const SYNTHETIC_FIXTURE_META = Object.freeze({
  synthetic: true as const,
  label: '模拟' as const,
})

function isHeaderPageAccepted(result: unknown): boolean {
  if (result === null || typeof result !== 'object') return false
  if ('ok' in result && typeof result.ok === 'boolean') return result.ok
  if ('accepted' in result && typeof result.accepted === 'boolean') return result.accepted
  if ('valid' in result && typeof result.valid === 'boolean') return result.valid
  return true
}

function createSyntheticM0Event(projectId: string, sequence: number): Record<string, unknown> {
  // Minimal valid M0 contextChanged event (exact keys). Not a invented type.
  return Object.freeze({
    version: '0.1.0-m0',
    projectId,
    baseRevision: 'rev-base-1',
    draftRevision: null,
    jobId: null,
    sequence,
    type: 'contextChanged',
  })
}

function createSyntheticTaskChangedEvent(
  projectId: string,
  sequence: number,
  options?: {
    readonly draftRevision?: string | null
    readonly activityProjectId?: string
    readonly activityDraftRevision?: string | null
  },
): Record<string, unknown> {
  const draftRevision = options && 'draftRevision' in options ? options.draftRevision ?? null : 'draft-sim-1'
  const activityProjectId = options?.activityProjectId ?? projectId
  const activityDraftRevision =
    options && 'activityDraftRevision' in options
      ? options.activityDraftRevision ?? null
      : draftRevision

  return Object.freeze({
    candidate: M1_FULL_EVENT_PAGE_CANDIDATE,
    type: 'taskChanged',
    projectId,
    baseRevision: 'rev-base-1',
    draftRevision,
    jobId: 'job-sim-1',
    sequence,
    activity: Object.freeze({
      taskId: 'task-sim-1',
      projectId: activityProjectId,
      source: 'internal',
      baseRevision: 'rev-base-1',
      draftRevision: activityDraftRevision,
      status: 'running',
      lastStep: null,
      question: null,
      errorCode: null,
      updatedAtMs: 0,
    }),
  })
}

const VALID_INCREMENT_FAILURE_DETAILS = Object.freeze({
  baseRevision: null,
  draftRevision: null,
  retryStep: null,
  recovery: null,
  question: null,
})

function createSyntheticIncrementFailure(
  code: string,
  retryable: boolean,
  details: Record<string, unknown> = VALID_INCREMENT_FAILURE_DETAILS,
): Record<string, unknown> {
  return Object.freeze({
    code,
    message: `模拟失败 ${code}`,
    retryable,
    requestId: 'req-sim-1',
    details: Object.freeze({ ...details }),
  })
}

describe('m1FullEventPagePresentation (模拟 / synthetic: true)', () => {
  it('keeps formalSaveEnabled and productionApiConnected literally false', () => {
    expect(SYNTHETIC_FIXTURE_META.synthetic).toBe(true)
    expect(M1_FULL_EVENT_PAGE_CAPABILITIES.formalSaveEnabled).toBe(false)
    expect(M1_FULL_EVENT_PAGE_CAPABILITIES.productionApiConnected).toBe(false)
    expect(M1_FULL_EVENT_PAGE_CAPABILITIES.candidateBoundary).toBe('m1-review-1853')
  })

  it('keeps header projection and complete event page entries strictly distinct', () => {
    const headerOnlyPage = Object.freeze({
      events: Object.freeze([{ projectId: 'proj-sim-1', sequence: 1 }]),
      nextCursor: 1,
      highWatermark: 1,
    })

    const headerAccepted = acceptM1EventPage('proj-sim-1', 0, headerOnlyPage)
    expect(isHeaderPageAccepted(headerAccepted)).toBe(true)

    const completeRejected = acceptM1FullEventPage('proj-sim-1', 0, headerOnlyPage)
    expect(completeRejected.ok).toBe(false)
    expect(completeRejected.nextConsumerCursor).toBe(0)
    expect(completeRejected.formalSaveEnabled).toBe(false)
    expect(completeRejected.productionApiConnected).toBe(false)

    const mixedCompletePage = Object.freeze({
      events: Object.freeze([
        createSyntheticM0Event('proj-sim-1', 1),
        createSyntheticTaskChangedEvent('proj-sim-1', 2),
      ]),
      nextCursor: 2,
      highWatermark: 2,
    })

    const headerRejectedMixed = acceptM1EventPage('proj-sim-1', 0, mixedCompletePage)
    expect(isHeaderPageAccepted(headerRejectedMixed)).toBe(false)
  })

  it('accepts a legal mixed M0 + taskChanged page and withholds taskChanged from the M0 reducer', () => {
    const mixedPage = Object.freeze({
      events: Object.freeze([
        createSyntheticM0Event('proj-sim-1', 1),
        createSyntheticTaskChangedEvent('proj-sim-1', 2),
      ]),
      nextCursor: 2,
      highWatermark: 2,
    })

    const accepted = acceptM1FullEventPage('proj-sim-1', 0, mixedPage)
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return

    expect(accepted.nextConsumerCursor).toBe(2)
    expect(accepted.highWatermark).toBe(2)
    expect(accepted.hasMore).toBe(false)
    expect(accepted.hasCandidateTaskChanged).toBe(true)
    expect(accepted.m0Events).toHaveLength(1)
    expect(accepted.taskChangedEvents).toHaveLength(1)
    expect(accepted.formalSaveEnabled).toBe(false)
    expect(accepted.productionApiConnected).toBe(false)

    const seenTypes: string[] = []
    const m0ReducerSpy = vi.fn((state: readonly number[], event: M1LegacyM0Event) => {
      seenTypes.push(event.type)
      return [...state, event.sequence]
    })

    const applied = applyM1FullEventPageToM0Reducer(accepted, [] as readonly number[], m0ReducerSpy)
    expect(m0ReducerSpy).toHaveBeenCalledTimes(1)
    expect(seenTypes).not.toContain('taskChanged')
    expect(applied.state).toEqual([1])
    expect(applied.appliedM0Count).toBe(1)
    expect(applied.withheldTaskChangedEvents).toHaveLength(1)
    expect(applied.withheldTaskChangedEvents[0]?.type).toBe('taskChanged')
    expect(applied.nextConsumerCursor).toBe(2)
    expect(applied.formalSaveEnabled).toBe(false)
    expect(applied.productionApiConnected).toBe(false)

    const classifiedTask = classifyM1FullEvent(accepted.taskChangedEvents[0])
    expect(classifiedTask.ok).toBe(true)
    if (classifiedTask.ok) {
      expect(classifiedTask.kind).toBe('taskChanged')
    }
  })

  it('fails closed on illegal complete pages without advancing cursor', () => {
    const illegalPages: readonly { readonly name: string; readonly after: number; readonly page: unknown }[] = [
      {
        name: 'wrong project',
        after: 0,
        page: {
          events: [createSyntheticM0Event('proj-other', 1)],
          nextCursor: 1,
          highWatermark: 1,
        },
      },
      {
        name: 'inclusive sequence',
        after: 2,
        page: {
          events: [createSyntheticM0Event('proj-sim-1', 2)],
          nextCursor: 2,
          highWatermark: 2,
        },
      },
      {
        name: 'sequence gap',
        after: 0,
        page: {
          events: [
            createSyntheticM0Event('proj-sim-1', 1),
            createSyntheticTaskChangedEvent('proj-sim-1', 3),
          ],
          nextCursor: 3,
          highWatermark: 3,
        },
      },
      {
        name: 'wrong nextCursor',
        after: 0,
        page: {
          events: [createSyntheticM0Event('proj-sim-1', 1)],
          nextCursor: 2,
          highWatermark: 2,
        },
      },
      {
        name: 'highWatermark below nextCursor',
        after: 0,
        page: {
          events: [createSyntheticM0Event('proj-sim-1', 1)],
          nextCursor: 1,
          highWatermark: 0,
        },
      },
      {
        name: 'taskChanged activity.projectId mismatch',
        after: 0,
        page: {
          events: [
            createSyntheticTaskChangedEvent('proj-sim-1', 1, {
              activityProjectId: 'proj-other',
            }),
          ],
          nextCursor: 1,
          highWatermark: 1,
        },
      },
      {
        name: 'taskChanged activity.draftRevision string mismatch',
        after: 0,
        page: {
          events: [
            createSyntheticTaskChangedEvent('proj-sim-1', 1, {
              draftRevision: 'draft-sim-1',
              activityDraftRevision: 'draft-sim-2',
            }),
          ],
          nextCursor: 1,
          highWatermark: 1,
        },
      },
      {
        name: 'taskChanged activity.draftRevision null mismatch',
        after: 0,
        page: {
          events: [
            createSyntheticTaskChangedEvent('proj-sim-1', 1, {
              draftRevision: null,
              activityDraftRevision: 'draft-sim-1',
            }),
          ],
          nextCursor: 1,
          highWatermark: 1,
        },
      },
    ]

    for (const testCase of illegalPages) {
      const result = acceptM1FullEventPage('proj-sim-1', testCase.after, testCase.page)
      expect(result.ok, testCase.name).toBe(false)
      expect(result.nextConsumerCursor, testCase.name).toBe(testCase.after)
      expect(result.formalSaveEnabled, testCase.name).toBe(false)
      expect(result.productionApiConnected, testCase.name).toBe(false)
    }
  })

  it('keeps nextConsumerCursor at afterSequence for an empty complete page', () => {
    const emptyPage = Object.freeze({
      events: Object.freeze([]),
      nextCursor: 5,
      highWatermark: 5,
    })

    const result = acceptM1FullEventPage('proj-sim-1', 5, emptyPage)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.isEmpty).toBe(true)
    expect(result.nextConsumerCursor).toBe(5)
    expect(result.highWatermark).toBe(5)
    expect(result.hasMore).toBe(false)
    expect(result.m0Events).toHaveLength(0)
    expect(result.taskChangedEvents).toHaveLength(0)
  })

  it('advances consumer cursor only to nextCursor when highWatermark > nextCursor', () => {
    const partialPage = Object.freeze({
      events: Object.freeze([
        createSyntheticM0Event('proj-sim-1', 1),
        createSyntheticTaskChangedEvent('proj-sim-1', 2),
      ]),
      nextCursor: 2,
      highWatermark: 9,
    })

    const result = acceptM1FullEventPage('proj-sim-1', 0, partialPage)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.nextConsumerCursor).toBe(2)
    expect(result.nextConsumerCursor).not.toBe(result.highWatermark)
    expect(result.highWatermark).toBe(9)
    expect(result.hasMore).toBe(true)
  })

  it('rejects late pages after project switch or bumped request generation', () => {
    const sessionA = createM1FullEventConsumerSession('proj-sim-a', 0)
    const tokenA = issueM1FullEventRequestToken(sessionA)

    const validPageForA = Object.freeze({
      events: Object.freeze([createSyntheticM0Event('proj-sim-a', 1)]),
      nextCursor: 1,
      highWatermark: 3,
    })

    const switchedToB = switchM1FullEventConsumerProject(sessionA, 'proj-sim-b', 0)
    const lateAfterSwitch = consumeM1FullEventPageForSession(switchedToB, tokenA, validPageForA)
    expect(lateAfterSwitch.ok).toBe(false)
    if (!lateAfterSwitch.ok) {
      expect(lateAfterSwitch.reason).toBe('STALE_PROJECT')
      expect(lateAfterSwitch.session.projectId).toBe('proj-sim-b')
      expect(lateAfterSwitch.session.cursor).toBe(0)
      expect(lateAfterSwitch.formalSaveEnabled).toBe(false)
      expect(lateAfterSwitch.productionApiConnected).toBe(false)
    }

    const bumpedA = bumpM1FullEventConsumerGeneration(sessionA)
    const lateAfterBump = consumeM1FullEventPageForSession(bumpedA, tokenA, validPageForA)
    expect(lateAfterBump.ok).toBe(false)
    if (!lateAfterBump.ok) {
      expect(lateAfterBump.reason).toBe('STALE_GENERATION')
      expect(lateAfterBump.session.cursor).toBe(0)
    }

    const freshTokenA = issueM1FullEventRequestToken(bumpedA)
    const acceptedFresh = consumeM1FullEventPageForSession(bumpedA, freshTokenA, validPageForA)
    expect(acceptedFresh.ok).toBe(true)
    if (acceptedFresh.ok) {
      expect(acceptedFresh.session.cursor).toBe(1)
      expect(acceptedFresh.page.highWatermark).toBe(3)
      expect(acceptedFresh.page.hasMore).toBe(true)
    }
  })

  it('presents valid M0-shaped candidate failure codes and fails closed on slim envelopes', () => {
    const candidateCodes = [
      'DRAFT_NOT_EMPTY',
      'TOOL_ROUND_TRIP_REQUIRED',
      'TASK_SCOPE_MISMATCH',
    ] as const

    for (const code of candidateCodes) {
      const failure = createSyntheticIncrementFailure(code, true, VALID_INCREMENT_FAILURE_DETAILS)
      const presented = presentM1IncrementFailure(failure)
      expect(presented.ok, code).toBe(true)
      if (!presented.ok) continue
      expect(presented.isCandidateCode).toBe(true)
      expect(presented.code).toBe(code)
      expect(presented.retryable).toBe(true)
      expect(presented.details).toEqual(VALID_INCREMENT_FAILURE_DETAILS)
      expect(presented.error.requestId).toBe('req-sim-1')
      expect(presented.formalSaveEnabled).toBe(false)
      expect(presented.productionApiConnected).toBe(false)
    }

    const slimEnvelope = Object.freeze({
      code: 'DRAFT_NOT_EMPTY',
      message: '模拟精简错误体',
    })
    const rejectedSlim = presentM1IncrementFailure(slimEnvelope)
    expect(rejectedSlim.ok).toBe(false)
    expect(rejectedSlim.formalSaveEnabled).toBe(false)
    expect(rejectedSlim.productionApiConnected).toBe(false)

    const unknownCode = createSyntheticIncrementFailure('UNKNOWN_CANDIDATE_CODE', false, { synthetic: true })
    const rejectedUnknown = presentM1IncrementFailure(unknownCode)
    expect(rejectedUnknown.ok).toBe(false)
  })
})
