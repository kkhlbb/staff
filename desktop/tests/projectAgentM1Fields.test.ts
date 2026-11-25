import { expect, it } from 'vitest'
import {
  isM1Activity, isM1ContextFields, isM1CreateSpacerDraft, isM1EventPage, isM1SpacerDraft, spacerDraftEligibility,
} from '../shared/project-agent/m1-fields'

const dimensions = { innerDiameterQ: 200_000, outerDiameterQ: 320_000, lengthQ: 120_000 }
it('accepts only the closed spacer shape with valid existing q dimensions', () => {
  const draft = { type: 'createSpacerDraft', ...dimensions }
  expect(isM1CreateSpacerDraft(draft)).toBe(true)
  for (const extra of [{ lengthQ: 1.5 }, { lengthQ: 0 }, { lengthQ: '120000' },
    { lengthQ: Number.MAX_SAFE_INTEGER }, { outerDiameterQ: dimensions.innerDiameterQ }, { noise: true }]) {
    expect(isM1CreateSpacerDraft({ ...draft, ...extra })).toBe(false)
  }
  expect(spacerDraftEligibility('emptyProject')).toBe('eligible')
  expect(spacerDraftEligibility('emptyDraft')).toBe('eligible')
  expect(spacerDraftEligibility('nonEmpty')).toBe('DRAFT_NOT_EMPTY')
  expect(spacerDraftEligibility(null)).toBe('INVALID_REQUEST')
  const userInput = { type: 'userInput' }
  const view = { draftRevision: 'd1', ...dimensions, question: null,
    sources: { innerDiameterQ: userInput, outerDiameterQ: userInput, lengthQ: userInput } }
  expect(isM1SpacerDraft(view)).toBe(true)
  expect(isM1SpacerDraft({ ...view, question: undefined })).toBe(false)
  expect(isM1SpacerDraft({ ...view, sources: {} })).toBe(false)
})

it('requires explicit activity nulls and matches project and draft in the context', () => {
  const activity = { taskId: 't1', projectId: 'p1', source: 'internal', baseRevision: null, draftRevision: 'd1',
    status: 'succeeded', lastStep: null, question: null, errorCode: null, updatedAtMs: 1 }
  expect(isM1Activity(activity)).toBe(true)
  expect(isM1Activity({ ...activity, status: 'complete' })).toBe(false)
  expect(isM1Activity({ ...activity, lastStep: undefined })).toBe(false)
  const snapshot = { projectId: 'p1', draftRevision: 'd1', cursor: 4, connection: 'disconnected',
    authorization: { authorized: true, canWrite: true }, writer: { epoch: 2, occupied: true }, spacerDraft: null }
  expect(isM1ContextFields({ snapshot, activities: [activity] })).toBe(true)
  expect(isM1ContextFields({ snapshot, activities: [{ ...activity, projectId: 'p2' }] })).toBe(false)
})

it('keeps consumption separate from the high watermark and rejects gaps', () => {
  const check = isM1EventPage('p1', 4)
  const event = { projectId: 'p1', sequence: 5 }
  expect(check({ events: [event], nextCursor: 5, highWatermark: 9 })).toBe(true)
  expect(check({ events: [], nextCursor: 4, highWatermark: 9 })).toBe(true)
  expect(check({ events: [event], nextCursor: 9, highWatermark: 9 })).toBe(false)
  expect(check({ events: [{ ...event, sequence: 6 }], nextCursor: 6, highWatermark: 9 })).toBe(false)
  expect(check({ events: [event], nextCursor: 5, highWatermark: 4 })).toBe(false)
})
