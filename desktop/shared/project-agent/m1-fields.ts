// Standalone field contract. No transport operation names or public protocol version.
import { MAX_ABS_Q } from '../../../src/domain/types.ts'
import { formatMm } from '../../../src/domain/units.ts'
import { parseSpacerParameters } from '../../../src/parts/spacerParameters.ts'
import { bool, either, hash, list, nat, nullable, object, oneOf, positive, text } from './schema.ts'
import type { Infer, Schema } from './schema.ts'

const dimensions = {
  innerDiameterQ: positive, outerDiameterQ: positive, lengthQ: positive,
}
type SpacerDimensions = { [K in keyof typeof dimensions]: Infer<(typeof dimensions)[K]> }
function validSpacer(value: SpacerDimensions): boolean {
  const { innerDiameterQ, outerDiameterQ, lengthQ } = value
  return [innerDiameterQ, outerDiameterQ, lengthQ].every(q => q <= MAX_ABS_Q) &&
    parseSpacerParameters({
      innerDiameter: formatMm(innerDiameterQ),
      outerDiameter: formatMm(outerDiameterQ),
      length: formatMm(lengthQ),
    }).ok
}

const createSpacerShape = object({ type: oneOf('createSpacerDraft'), ...dimensions })
export type M1CreateSpacerDraft = Infer<typeof createSpacerShape>
export const isM1CreateSpacerDraft: Schema<M1CreateSpacerDraft> =
  (value): value is M1CreateSpacerDraft => createSpacerShape(value) && validSpacer(value)

export const isM1DraftOccupancy = oneOf('emptyProject', 'emptyDraft', 'nonEmpty')
export type M1DraftOccupancy = Infer<typeof isM1DraftOccupancy>
export function spacerDraftEligibility(occupancy: unknown) {
  if (!isM1DraftOccupancy(occupancy)) return 'INVALID_REQUEST'
  return occupancy === 'nonEmpty' ? 'DRAFT_NOT_EMPTY' : 'eligible'
}

const anchor = object({
  documentRef: text, documentFingerprint: hash, page: positive,
  region: nullable(object({ x: nat, y: nat, width: positive, height: positive, unit: oneOf('pdfPoint1000') })),
  excerpt: text,
})
const question = object({
  questionId: text, reason: oneOf('missing', 'conflict', 'ambiguousReference'), prompt: text, anchors: list(anchor),
})
const source = either(object({ type: oneOf('userInput') }), object({ type: oneOf('document'), anchor }))
const draftShape = object({
  draftRevision: text, ...dimensions,
  sources: object({ innerDiameterQ: source, outerDiameterQ: source, lengthQ: source }),
  question: nullable(question),
})
export type M1SpacerDraft = Infer<typeof draftShape>
export const isM1SpacerDraft: Schema<M1SpacerDraft> =
  (value): value is M1SpacerDraft => draftShape(value) && validSpacer(value)

export const isM1ActivityStatus = oneOf('queued', 'running', 'awaitingInput', 'interrupted', 'succeeded', 'failed', 'cancelled')
export const isM1Activity = object({
  taskId: text, projectId: text, source: oneOf('internal', 'external'),
  baseRevision: nullable(text), draftRevision: nullable(text), status: isM1ActivityStatus,
  lastStep: nullable(text), question: nullable(question), errorCode: nullable(text), updatedAtMs: nat,
})
export type M1Activity = Infer<typeof isM1Activity>

const snapshot = object({
  projectId: text, draftRevision: nullable(text), cursor: nat,
  connection: oneOf('disconnected', 'connecting', 'connected'),
  authorization: object({ authorized: bool, canWrite: bool }),
  writer: object({ epoch: nat, occupied: bool }),
  spacerDraft: nullable(isM1SpacerDraft),
})
const context = object({ snapshot, activities: list(isM1Activity) })
export type M1ContextFields = Infer<typeof context>
export const isM1ContextFields: Schema<M1ContextFields> = (value): value is M1ContextFields =>
  context(value) &&
  (value.snapshot.authorization.authorized || !value.snapshot.authorization.canWrite) &&
  (value.snapshot.spacerDraft === null || value.snapshot.spacerDraft.draftRevision === value.snapshot.draftRevision) &&
  value.activities.every(activity => activity.projectId === value.snapshot.projectId)

// Minimal event header projection. This does not replace the M0 event union.
const event = object({ projectId: text, sequence: positive })
const page = object({ events: list(event), nextCursor: nat, highWatermark: nat })
export type M1EventPageFields = Infer<typeof page>
export const isM1EventPage = (projectId: string, afterSequence: number): Schema<M1EventPageFields> =>
  (value): value is M1EventPageFields =>
    nat(afterSequence) && page(value) && value.highWatermark >= value.nextCursor &&
    value.nextCursor === afterSequence + value.events.length &&
    value.events.every((entry, index) => entry.projectId === projectId && entry.sequence === afterSequence + index + 1)

export const isM1ReadRecoveryCode = oneOf('AUTH_REQUIRED', 'CURSOR_EXPIRED')
export const isM1WriterRejectionCode = oneOf('AUTH_REQUIRED', 'WRITER_HELD', 'WRITER_REVOKED')
