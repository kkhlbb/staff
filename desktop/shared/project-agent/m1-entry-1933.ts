// Review-only renderer boundary. No transport, channel names or runtime registration.
import { isProjectAgentError, isProjectAgentEvent } from './contracts.ts'
import { isM1Activity, isM1ContextFields, isM1CreateSpacerDraft, isM1SpacerDraft } from './m1-fields.ts'
import { isM1FullEventPage, isM1IncrementFailure } from './m1-protocol-1915.ts'
import { either, nat, nullable, object, oneOf, positive, text } from './schema.ts'
import type { Infer, Schema } from './schema.ts'

export const M1_ENTRY_CANDIDATE = 'm1-entry-review-1933' as const
const scope = { projectId: text, authorizationRef: text, requestGeneration: nat }
const request = { ...scope, requestId: text }
const subscriptionScope = { ...scope, subscriptionId: text }
const isScope = object(scope)
const isSubscriptionScope = object(subscriptionScope)
export type EntryScope = Infer<typeof isScope>
export type EntrySubscription = Infer<typeof isSubscriptionScope>

export const entryRequests = {
  getContext: object(request),
  readProjectEvents: object({ ...request, afterSequence: nat, limit: positive }),
  stageChange: object({ ...request, writerToken: text, writerEpoch: positive, idempotencyKey: text,
    baseRevision: nullable(text), expectedDraftRevision: nullable(text), operation: isM1CreateSpacerDraft }),
  subscribe: object({ ...request, afterSequence: nat }),
  cancel: object({ ...request, subscriptionId: text }),
}
type Requests = { [K in keyof typeof entryRequests]: Infer<(typeof entryRequests)[K]> }
type EntryKind = keyof Requests
type Failure = Infer<typeof isM1IncrementFailure>
const awaiting = object({ draftRevision: oneOf(null), activity: isM1Activity })
const cancelled = object({ cancelled: oneOf(true) })
type StageOutcome = Infer<typeof isM1SpacerDraft> | Infer<typeof awaiting>
type Results = {
  getContext: Infer<typeof isM1ContextFields>
  readProjectEvents: Infer<ReturnType<typeof isM1FullEventPage>>
  stageChange: StageOutcome
  subscribe: EntrySubscription
  cancel: Infer<typeof cancelled>
}
type ReplyBase<K extends EntryKind> = EntryScope & {
  entry: typeof M1_ENTRY_CANDIDATE; operation: K; requestId: string
}
export type EntryReply<K extends EntryKind> = ReplyBase<K> &
  ({ ok: true; result: Results[K] } | { ok: false; error: Failure })

export interface M1EntryCandidate {
  getM1ProjectContext(request: Requests['getContext']): Promise<EntryReply<'getContext'>>
  readM1ProjectEvents(request: Requests['readProjectEvents']): Promise<EntryReply<'readProjectEvents'>>
  stageM1ProjectChange(request: Requests['stageChange']): Promise<EntryReply<'stageChange'>>
  subscribeM1ProjectEvents(request: Requests['subscribe'], listener: (delivery: EntryDelivery) => void):
    Promise<EntryReply<'subscribe'>>
  cancelM1ProjectSubscription(request: Requests['cancel']): Promise<EntryReply<'cancel'>>
}

const sameScope = (a: EntryScope, b: EntryScope) => a.projectId === b.projectId &&
  a.authorizationRef === b.authorizationRef && a.requestGeneration === b.requestGeneration

function isEntryResult<K extends EntryKind>(operation: K, req: Requests[K], result: unknown): boolean {
  switch (operation) {
    case 'getContext':
      return isM1ContextFields(result) && result.snapshot.projectId === req.projectId
    case 'readProjectEvents':
      return entryRequests.readProjectEvents(req) && isM1FullEventPage(req.projectId, req.afterSequence)(result) &&
        result.events.length <= req.limit
    case 'stageChange':
      return entryRequests.stageChange(req) &&
        (isM1SpacerDraft(result)
          ? result.innerDiameterQ === req.operation.innerDiameterQ &&
            result.outerDiameterQ === req.operation.outerDiameterQ && result.lengthQ === req.operation.lengthQ
          : awaiting(result) && result.activity.projectId === req.projectId &&
            result.activity.draftRevision === null && result.activity.status === 'awaitingInput' && result.activity.question !== null)
    case 'subscribe':
      return isSubscriptionScope(result) && sameScope(result, req)
    case 'cancel':
      return cancelled(result)
  }
  return false
}

// Pass the originally issued request and the current renderer scope, never a scope derived from a reply.
export function acceptEntryReply<K extends EntryKind>(operation: K, req: Requests[K],
  current: EntryScope | null, value: unknown): value is EntryReply<K> {
  if (!isScope(current) || !entryRequests[operation](req) || !sameScope(req, current)) return false
  const header = { ...request, entry: oneOf(M1_ENTRY_CANDIDATE), operation: oneOf(operation) }
  const success = object({
    ...header, ok: oneOf(true),
    result: (result: unknown): result is Results[K] => isEntryResult(operation, req, result),
  })
  const failure = object({ ...header, ok: oneOf(false), error: isM1IncrementFailure })
  if (!either(success, failure)(value)) return false
  return sameScope(value, current) && value.requestId === req.requestId &&
    (value.ok || value.error.requestId === req.requestId)
}

export type EntryDelivery = EntrySubscription & { entry: typeof M1_ENTRY_CANDIDATE; page: Results['readProjectEvents'] }
export function acceptEntryDelivery(current: EntryScope | null, subscription: EntrySubscription | null,
  afterSequence: number, value: unknown): value is EntryDelivery {
  if (!isScope(current) || !isSubscriptionScope(subscription) || !sameScope(subscription, current)) return false
  const validate = object({
    ...subscriptionScope, entry: oneOf(M1_ENTRY_CANDIDATE), page: isM1FullEventPage(current.projectId, afterSequence),
  })
  return validate(value) && sameScope(value, current) && value.subscriptionId === subscription.subscriptionId
}

type M0Event = Infer<typeof isProjectAgentEvent>
type TaskEvent = Exclude<Results['readProjectEvents']['events'][number], M0Event>
// Route validated events in sequence. Task events and their sequence positions stay on the M1 side.
export function routeEntryPage(projectId: string, afterSequence: number, page: unknown,
  onM0: (event: M0Event) => void, onTask: (event: TaskEvent) => void): boolean {
  const validate: Schema<Results['readProjectEvents']> = isM1FullEventPage(projectId, afterSequence)
  if (!validate(page)) return false
  for (const event of page.events) {
    if ('candidate' in event) onTask(event)
    else onM0(event)
  }
  return true
}

export function classifyEntryFailure(value: unknown) {
  if (isProjectAgentError(value)) return { kind: 'm0' as const, error: value }
  if (isM1IncrementFailure(value)) return { kind: 'candidate' as const, error: value }
  return null
}

export const m1EntryCapabilities = {
  productionApiConnected: false,
  formalSaveEnabled: false,
  connected: [],
  harnessOnly: { getContext: false, readProjectEvents: false, stageChange: false, subscriptionLifecycle: false },
  unimplemented: {
    continueConversation: false, toolRoundTrip: false, modelApi: false, installationBridge: false,
    formalSave: false, productionSubscriptionPush: false,
  },
} as const
