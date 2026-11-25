// Main-process contracts shared by the future bridge and model adapters.
import type { M1Activity, M1CreateSpacerDraft, M1SpacerDraft } from '../../shared/project-agent/m1-fields'

export type M1StageOperation =
  | { type: 'createSpacerDraft' } & Partial<Omit<M1CreateSpacerDraft, 'type'>>
  | { type: 'updateSpacerDraft' } & Omit<M1CreateSpacerDraft, 'type'>
  | { type: 'resumeSpacerDraft'; taskId: string } & Partial<Omit<M1CreateSpacerDraft, 'type'>>

export type M1StageChangeRequest = {
  baseRevision: string | null
  expectedDraftRevision: string | null
  idempotencyKey: string
  operation: M1StageOperation
  sources: Partial<M1SpacerDraft['sources']>
}

export type M1StageResult = M1SpacerDraft | { draftRevision: null; activity: M1Activity } |
  { kind: 'clarification'; code: 'UNSUPPORTED_SCOPE'; question: string }

export type M1WriterContext = {
  baseRevision: string
  draftRevision: string | null
  cursor: number
  spacerDraft: M1SpacerDraft | null
}

export type VerifiedM1Binding = {
  baseRevision: string
  canonicalPath: string
  seal(): void
}
export type VerifyM1Binding = () => Promise<VerifiedM1Binding>
