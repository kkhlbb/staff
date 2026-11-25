import {
  isM1FullEvent,
  isM1FullEventPage,
  isM1IncrementFailure,
} from '../../../desktop/shared/project-agent/m1-protocol-1915.ts'
import type { M1FullEventPage } from '../../../desktop/shared/project-agent/m1-protocol-1915.ts'

export const M1_FULL_EVENT_PAGE_CANDIDATE = 'm1-review-1853' as const

export interface M1FullEventPageCapabilities {
  readonly entryKind: 'complete-event-page'
  readonly candidateBoundary: typeof M1_FULL_EVENT_PAGE_CANDIDATE
  readonly formalSaveEnabled: false
  readonly productionApiConnected: false
}

export const M1_FULL_EVENT_PAGE_CAPABILITIES: M1FullEventPageCapabilities = Object.freeze({
  entryKind: 'complete-event-page' as const,
  candidateBoundary: M1_FULL_EVENT_PAGE_CANDIDATE,
  formalSaveEnabled: false as const,
  productionApiConnected: false as const,
})

export type M1FullEvent = M1FullEventPage['events'][number]
export type M1TaskChangedEvent = Extract<M1FullEvent, { type: 'taskChanged' }>
export type M1LegacyM0Event = Exclude<M1FullEvent, M1TaskChangedEvent>
export type M1IncrementFailure =
  typeof isM1IncrementFailure extends (value: unknown) => value is infer T ? T : never

export type M1CandidateFailureCode =
  | 'DRAFT_NOT_EMPTY'
  | 'TOOL_ROUND_TRIP_REQUIRED'
  | 'TASK_SCOPE_MISMATCH'

const CANDIDATE_FAILURE_CODES: ReadonlySet<string> = new Set<M1CandidateFailureCode>([
  'DRAFT_NOT_EMPTY',
  'TOOL_ROUND_TRIP_REQUIRED',
  'TASK_SCOPE_MISMATCH',
])

export function isM1TaskChangedEvent(event: M1FullEvent): event is M1TaskChangedEvent {
  return event.type === 'taskChanged'
}

export type ClassifiedM1FullEvent =
  | {
      readonly ok: true
      readonly kind: 'm0'
      readonly event: M1LegacyM0Event
    }
  | {
      readonly ok: true
      readonly kind: 'taskChanged'
      readonly event: M1TaskChangedEvent
    }
  | {
      readonly ok: false
      readonly reason: 'INVALID_FULL_EVENT'
    }

export function classifyM1FullEvent(value: unknown): ClassifiedM1FullEvent {
  if (!isM1FullEvent(value)) {
    return Object.freeze({
      ok: false as const,
      reason: 'INVALID_FULL_EVENT' as const,
    })
  }
  if (isM1TaskChangedEvent(value)) {
    return Object.freeze({
      ok: true as const,
      kind: 'taskChanged' as const,
      event: value,
    })
  }
  return Object.freeze({
    ok: true as const,
    kind: 'm0' as const,
    event: value,
  })
}

export interface SplitM1FullEvents {
  readonly m0Events: readonly M1LegacyM0Event[]
  readonly taskChangedEvents: readonly M1TaskChangedEvent[]
}

export function splitM1FullEvents(events: readonly M1FullEvent[]): SplitM1FullEvents {
  const m0Events: M1LegacyM0Event[] = []
  const taskChangedEvents: M1TaskChangedEvent[] = []
  for (const event of events) {
    if (isM1TaskChangedEvent(event)) {
      taskChangedEvents.push(event)
    } else {
      m0Events.push(event)
    }
  }
  return Object.freeze({
    m0Events: Object.freeze(m0Events),
    taskChangedEvents: Object.freeze(taskChangedEvents),
  })
}

export interface AcceptedM1FullEventPage {
  readonly ok: true
  readonly entryKind: 'complete-event-page'
  readonly candidateBoundary: typeof M1_FULL_EVENT_PAGE_CANDIDATE
  readonly projectId: string
  readonly afterSequence: number
  readonly nextConsumerCursor: number
  readonly highWatermark: number
  readonly hasMore: boolean
  readonly isEmpty: boolean
  readonly events: readonly M1FullEvent[]
  readonly m0Events: readonly M1LegacyM0Event[]
  readonly taskChangedEvents: readonly M1TaskChangedEvent[]
  readonly hasCandidateTaskChanged: boolean
  readonly formalSaveEnabled: false
  readonly productionApiConnected: false
}

export interface RejectedM1FullEventPage {
  readonly ok: false
  readonly entryKind: 'complete-event-page'
  readonly candidateBoundary: typeof M1_FULL_EVENT_PAGE_CANDIDATE
  readonly reason: 'INVALID_FULL_EVENT_PAGE'
  readonly projectId: string
  readonly afterSequence: number
  readonly nextConsumerCursor: number
  readonly formalSaveEnabled: false
  readonly productionApiConnected: false
}

export type M1FullEventPageResult = AcceptedM1FullEventPage | RejectedM1FullEventPage

export function acceptM1FullEventPage(
  projectId: string,
  afterSequence: number,
  page: unknown,
): M1FullEventPageResult {
  const validatePage = isM1FullEventPage(projectId, afterSequence)
  if (!validatePage(page)) {
    return Object.freeze({
      ok: false as const,
      entryKind: 'complete-event-page' as const,
      candidateBoundary: M1_FULL_EVENT_PAGE_CANDIDATE,
      reason: 'INVALID_FULL_EVENT_PAGE' as const,
      projectId,
      afterSequence,
      nextConsumerCursor: afterSequence,
      formalSaveEnabled: false as const,
      productionApiConnected: false as const,
    })
  }

  const { m0Events, taskChangedEvents } = splitM1FullEvents(page.events)
  return Object.freeze({
    ok: true as const,
    entryKind: 'complete-event-page' as const,
    candidateBoundary: M1_FULL_EVENT_PAGE_CANDIDATE,
    projectId,
    afterSequence,
    nextConsumerCursor: page.nextCursor,
    highWatermark: page.highWatermark,
    hasMore: page.highWatermark > page.nextCursor,
    isEmpty: page.events.length === 0,
    events: Object.freeze([...page.events]),
    m0Events,
    taskChangedEvents,
    hasCandidateTaskChanged: taskChangedEvents.length > 0,
    formalSaveEnabled: false as const,
    productionApiConnected: false as const,
  })
}

export interface ApplyM1FullEventPageResult<TState> {
  readonly state: TState
  readonly appliedM0Count: number
  readonly withheldTaskChangedEvents: readonly M1TaskChangedEvent[]
  readonly nextConsumerCursor: number
  readonly formalSaveEnabled: false
  readonly productionApiConnected: false
}

export function applyM1FullEventPageToM0Reducer<TState>(
  acceptedPage: AcceptedM1FullEventPage,
  initialState: TState,
  reduceM0Event: (state: TState, event: M1LegacyM0Event) => TState,
): ApplyM1FullEventPageResult<TState> {
  let state = initialState
  for (const event of acceptedPage.m0Events) {
    state = reduceM0Event(state, event)
  }
  return Object.freeze({
    state,
    appliedM0Count: acceptedPage.m0Events.length,
    withheldTaskChangedEvents: acceptedPage.taskChangedEvents,
    nextConsumerCursor: acceptedPage.nextConsumerCursor,
    formalSaveEnabled: false as const,
    productionApiConnected: false as const,
  })
}

export interface M1FullEventConsumerSession {
  readonly projectId: string
  readonly generation: number
  readonly cursor: number
  readonly formalSaveEnabled: false
  readonly productionApiConnected: false
}

export interface M1FullEventRequestToken {
  readonly projectId: string
  readonly generation: number
  readonly afterSequence: number
}

export type M1FullEventSessionRejectionReason =
  | 'STALE_PROJECT'
  | 'STALE_GENERATION'
  | 'STALE_CURSOR'
  | 'INVALID_FULL_EVENT_PAGE'

export type M1FullEventSessionConsumeResult =
  | {
      readonly ok: true
      readonly session: M1FullEventConsumerSession
      readonly page: AcceptedM1FullEventPage
      readonly formalSaveEnabled: false
      readonly productionApiConnected: false
    }
  | {
      readonly ok: false
      readonly reason: M1FullEventSessionRejectionReason
      readonly session: M1FullEventConsumerSession
      readonly formalSaveEnabled: false
      readonly productionApiConnected: false
    }

function normalizeCursor(cursor: number): number {
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0
}

export function createM1FullEventConsumerSession(
  projectId: string,
  initialCursor = 0,
): M1FullEventConsumerSession {
  return Object.freeze({
    projectId,
    generation: 1,
    cursor: normalizeCursor(initialCursor),
    formalSaveEnabled: false as const,
    productionApiConnected: false as const,
  })
}

export function switchM1FullEventConsumerProject(
  session: M1FullEventConsumerSession,
  nextProjectId: string,
  initialCursor = 0,
): M1FullEventConsumerSession {
  return Object.freeze({
    projectId: nextProjectId,
    generation: session.generation + 1,
    cursor: normalizeCursor(initialCursor),
    formalSaveEnabled: false as const,
    productionApiConnected: false as const,
  })
}

export function bumpM1FullEventConsumerGeneration(
  session: M1FullEventConsumerSession,
): M1FullEventConsumerSession {
  return Object.freeze({
    projectId: session.projectId,
    generation: session.generation + 1,
    cursor: session.cursor,
    formalSaveEnabled: false as const,
    productionApiConnected: false as const,
  })
}

export function issueM1FullEventRequestToken(
  session: M1FullEventConsumerSession,
): M1FullEventRequestToken {
  return Object.freeze({
    projectId: session.projectId,
    generation: session.generation,
    afterSequence: session.cursor,
  })
}

export function consumeM1FullEventPageForSession(
  session: M1FullEventConsumerSession,
  token: M1FullEventRequestToken,
  page: unknown,
): M1FullEventSessionConsumeResult {
  if (token.projectId !== session.projectId) {
    return Object.freeze({
      ok: false as const,
      reason: 'STALE_PROJECT' as const,
      session,
      formalSaveEnabled: false as const,
      productionApiConnected: false as const,
    })
  }
  if (token.generation !== session.generation) {
    return Object.freeze({
      ok: false as const,
      reason: 'STALE_GENERATION' as const,
      session,
      formalSaveEnabled: false as const,
      productionApiConnected: false as const,
    })
  }
  if (token.afterSequence !== session.cursor) {
    return Object.freeze({
      ok: false as const,
      reason: 'STALE_CURSOR' as const,
      session,
      formalSaveEnabled: false as const,
      productionApiConnected: false as const,
    })
  }

  const accepted = acceptM1FullEventPage(token.projectId, token.afterSequence, page)
  if (!accepted.ok) {
    return Object.freeze({
      ok: false as const,
      reason: 'INVALID_FULL_EVENT_PAGE' as const,
      session,
      formalSaveEnabled: false as const,
      productionApiConnected: false as const,
    })
  }

  const nextSession: M1FullEventConsumerSession = Object.freeze({
    projectId: session.projectId,
    generation: session.generation,
    cursor: accepted.nextConsumerCursor,
    formalSaveEnabled: false as const,
    productionApiConnected: false as const,
  })

  return Object.freeze({
    ok: true as const,
    session: nextSession,
    page: accepted,
    formalSaveEnabled: false as const,
    productionApiConnected: false as const,
  })
}

export type M1IncrementFailurePresentation =
  | {
      readonly ok: true
      readonly isCandidateCode: boolean
      readonly code: M1IncrementFailure['code']
      readonly message: string
      readonly retryable: M1IncrementFailure['retryable']
      readonly details: M1IncrementFailure['details']
      readonly error: M1IncrementFailure
      readonly formalSaveEnabled: false
      readonly productionApiConnected: false
    }
  | {
      readonly ok: false
      readonly reason: 'INVALID_INCREMENT_FAILURE'
      readonly formalSaveEnabled: false
      readonly productionApiConnected: false
    }

export function presentM1IncrementFailure(value: unknown): M1IncrementFailurePresentation {
  if (!isM1IncrementFailure(value)) {
    return Object.freeze({
      ok: false as const,
      reason: 'INVALID_INCREMENT_FAILURE' as const,
      formalSaveEnabled: false as const,
      productionApiConnected: false as const,
    })
  }
  const message = 'message' in value && typeof value.message === 'string' ? value.message : ''
  return Object.freeze({
    ok: true as const,
    isCandidateCode: CANDIDATE_FAILURE_CODES.has(value.code),
    code: value.code,
    message,
    retryable: value.retryable,
    details: value.details,
    error: value,
    formalSaveEnabled: false as const,
    productionApiConnected: false as const,
  })
}
