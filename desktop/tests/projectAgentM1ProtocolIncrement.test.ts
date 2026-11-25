import { expect, it } from 'vitest'
import { isM1EventPage } from '../shared/project-agent/m1-fields.ts'
import { isM1FullEventPage, isM1IncrementFailure } from '../shared/project-agent/m1-protocol-1915.ts'

const scope = { projectId: 'p', baseRevision: null, draftRevision: 'd', jobId: null }
const context = { ...scope, version: '0.1.0-m0', type: 'contextChanged', sequence: 5 }
const task = {
  ...scope, candidate: 'm1-review-1853', type: 'taskChanged', sequence: 6,
  activity: { projectId: 'p', draftRevision: 'd', baseRevision: null, taskId: 't', source: 'internal',
    status: 'succeeded', lastStep: null, question: null, errorCode: null, updatedAtMs: 1 },
}
const page = { events: [context, task], nextCursor: 6, highWatermark: 9 }
const validate = isM1FullEventPage('p', 4)

it('accepts mixed complete events in order and preserves the frozen header shape', () => {
  expect(validate(page)).toBe(true)
  expect(isM1EventPage('p', 4)(page)).toBe(false)
  expect(validate({ ...page, events: [{ projectId: 'p', sequence: 5 }], nextCursor: 5 })).toBe(false)
  expect(validate({ ...page, events: [context, { ...task, version: '0.1.0-m0' }] })).toBe(false)
})

it('enforces exclusive, contiguous consumption on the requested project', () => {
  for (const first of [{ sequence: 4 }, { sequence: 6 }, { projectId: 'elsewhere' }]) {
    expect(validate({ ...page, events: [{ ...context, ...first }, task] })).toBe(false)
  }
  expect(validate({ ...page, events: [context, { ...task, sequence: 7 }], nextCursor: 7 })).toBe(false)
  expect(validate({ ...page, nextCursor: 9 })).toBe(false)
  expect(validate({ ...page, highWatermark: 5 })).toBe(false)
})

it('leaves the cursor at the input for empty pages', () => {
  expect(validate({ ...page, events: [], nextCursor: 4 })).toBe(true)
  expect(validate({ ...page, events: [], nextCursor: 9 })).toBe(false)
  expect(validate({ ...page, events: [], nextCursor: 4, highWatermark: 3 })).toBe(false)
})

it('binds task activity to both event project and draft revision', () => {
  for (const change of [{ projectId: 'elsewhere' }, { draftRevision: 'old' }, { draftRevision: null }]) {
    expect(validate({ ...page, events: [context, { ...task, activity: { ...task.activity, ...change } }] })).toBe(false)
  }
  expect(validate({ ...page, events: [context, { ...task, draftRevision: null,
    activity: { ...task.activity, draftRevision: null } }] })).toBe(true)
})

it('validates M0 recovery fields for old and new error codes', () => {
  const details = { baseRevision: null, draftRevision: 'd', retryStep: null, recovery: 'refreshSnapshot', question: null }
  const envelope = { requestId: 'r', message: 'recover', retryable: true, details }
  for (const code of ['CURSOR_EXPIRED', 'DRAFT_NOT_EMPTY', 'TOOL_ROUND_TRIP_REQUIRED', 'TASK_SCOPE_MISMATCH']) {
    expect(isM1IncrementFailure({ ...envelope, code })).toBe(true)
    expect(isM1IncrementFailure({ requestId: 'r', message: 'recover', code })).toBe(false)
    expect(isM1IncrementFailure({ ...envelope, code, retryable: 'yes' })).toBe(false)
    expect(isM1IncrementFailure({ ...envelope, code, details: { ...details, recovery: 'reconnect' } })).toBe(false)
    expect(isM1IncrementFailure({ ...envelope, code, details: { ...details, extra: true } })).toBe(false)
  }
  expect(isM1IncrementFailure({ ...envelope, code: 'UNKNOWN' })).toBe(false)
})
