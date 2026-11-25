// Review increment for the 1853 event-page and failure shapes.
import { isProjectAgentError, isProjectAgentEvent } from './contracts.ts'
import type { ProjectAgentError } from './contracts.ts'
import { isM1Activity, isM1EventPage } from './m1-fields.ts'
import { either, list, nat, nullable, object, oneOf, positive, text } from './schema.ts'
import type { Infer, Schema } from './schema.ts'

const taskEvent = object({
  candidate: oneOf('m1-review-1853'), type: oneOf('taskChanged'),
  projectId: text, baseRevision: nullable(text), draftRevision: nullable(text),
  jobId: nullable(text), sequence: positive, activity: isM1Activity,
})
type TaskEvent = Infer<typeof taskEvent>
const isBoundTaskEvent: Schema<TaskEvent> = (value): value is TaskEvent =>
  taskEvent(value) && value.activity.projectId === value.projectId &&
  value.activity.draftRevision === value.draftRevision

export const isM1FullEvent = either(isProjectAgentEvent, isBoundTaskEvent)
const fullPage = object({ events: list(isM1FullEvent), nextCursor: nat, highWatermark: nat })
export type M1FullEventPage = Infer<typeof fullPage>
export function isM1FullEventPage(projectId: string, afterSequence: number): Schema<M1FullEventPage> {
  const isHeaderPage = isM1EventPage(projectId, afterSequence)
  return (value): value is M1FullEventPage => fullPage(value) && isHeaderPage({
    events: value.events.map(({ projectId, sequence }) => ({ projectId, sequence })),
    nextCursor: value.nextCursor,
    highWatermark: value.highWatermark,
  })
}

const isNewCode = oneOf('DRAFT_NOT_EMPTY', 'TOOL_ROUND_TRIP_REQUIRED', 'TASK_SCOPE_MISMATCH')
type NewFailure = Omit<ProjectAgentError, 'code'> & { code: Infer<typeof isNewCode> }
const isNewFailure: Schema<NewFailure> = (value): value is NewFailure => {
  if (value === null || typeof value !== 'object' ||
    !Object.hasOwn(value, 'code') || !('code' in value) || !isNewCode(value.code)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  // Reuse the exact M0 envelope and recovery checks. The returned value keeps its candidate code.
  return Reflect.ownKeys(value).length === 5 &&
    isProjectAgentError({ ...value, code: 'INVALID_REQUEST' })
}

export const isM1IncrementFailure = either(isProjectAgentError, isNewFailure)
