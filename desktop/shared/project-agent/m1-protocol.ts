// Review candidate only. This identifier is not a frozen public protocol version.
import { object, oneOf, text, nat, positive, nullable, list, either } from './schema'
import { isM1Activity, isM1ContextFields, isM1CreateSpacerDraft } from './m1-fields'
import { isProjectAgentEvent, isProjectAgentError } from './contracts'
export const M1_CANDIDATE = 'm1-review-1853' as const
const scope = { candidate: oneOf(M1_CANDIDATE), requestId: text, projectId: text, authorizationRef: text }
export const candidateRequests = {
  getContext: object(scope),
  readProjectEvents: object({ ...scope, afterSequence: nat, limit: positive }),
  stageChange: object({ ...scope, writerToken: text, writerEpoch: positive, idempotencyKey: text,
    baseRevision: nullable(text), expectedDraftRevision: nullable(text), operation: isM1CreateSpacerDraft }),
  continueConversation: object({ ...scope, taskId: text, writerToken: text, writerEpoch: positive,
    idempotencyKey: text, expectedDraftRevision: nullable(text), message: text,
    resumeAfterStepId: nullable(text) }),
}
const taskEvent = object({
  candidate: oneOf(M1_CANDIDATE), projectId: text, baseRevision: nullable(text),
  draftRevision: nullable(text), jobId: nullable(text), sequence: positive,
  type: oneOf('taskChanged'), activity: isM1Activity,
})
export const isCandidateEvent = either(isProjectAgentEvent, taskEvent)
export const candidateResults = {
  getContext: isM1ContextFields,
  readProjectEvents: object({ events: list(isCandidateEvent), nextCursor: nat, highWatermark: nat }),
  continueConversation: object({ projectId: text, taskId: text, stepId: text,
    toolRoundTripId: text, receiptRef: text, activity: isM1Activity }),
}
export const isCandidateFailure = either(isProjectAgentError, object({
  code: oneOf('DRAFT_NOT_EMPTY', 'TOOL_ROUND_TRIP_REQUIRED', 'TASK_SCOPE_MISMATCH'),
  requestId: text, message: text,
}))
