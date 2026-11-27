import type { M2CheckItem, M2PreviewEvent, M2PreviewSnapshot, M2Result, M2SourceAnchor } from './m2-preview'

export type M3WorkbenchErrorCode =
  | 'CONFIRMATION_EXPIRED'
  | 'FINGERPRINT_MISMATCH'
  | 'CHECKS_BLOCKED'
  | 'BASE_REVISION_CONFLICT'
  | 'DUPLICATE_REQUEST'
  | 'NOTHING_TO_UNDO'
  | 'DRAFT_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'WRITER_REVOKED'
  | 'UNAUTHORIZED'
  | 'BACKEND_UNAVAILABLE'
  | 'INTERNAL'

export interface M3CommitApprovedDraftRequest {
  readonly projectId: string
  readonly baseRevision: string | null
  readonly draftRevision: string
  readonly checkSetFingerprint: string
  readonly confirmationToken: string
  readonly requestId: string
}

export interface M3CommitApprovedDraftResult {
  readonly projectId: string
  readonly committedRevision: string
  readonly previousBaseRevision: string | null
  readonly committedDraftRevision: string
  readonly checkSetFingerprint: string
  readonly nextDraftRevision?: string | null
  readonly committedAtLabel?: string
  readonly summary?: string
}

export interface M3UndoDraftChangeRequest {
  readonly projectId: string
  readonly draftRevision: string | null
  readonly requestId: string
}

export interface M3UndoDraftChangeResult {
  readonly projectId: string
  readonly restoredDraftRevision: string | null
  readonly previousDraftRevision: string | null
  readonly summary: string
  readonly previewSnapshot?: Partial<M2PreviewSnapshot>
}

export interface M3UnexplainedLegacyField {
  readonly fieldPath: string
  readonly rawValueSummary: string
  readonly reason: string
  readonly preservedInOriginal: true
}

export interface M3RestrictedOperation {
  readonly operation: string
  readonly reason: string
  readonly workaround?: string
}

export interface M3LegacyChainSampleResult {
  readonly label: string
  readonly lengthMm: string
  readonly verdict: 'pass' | 'fail' | 'boundary_pass'
  readonly detail?: string
}

export interface M3LegacyChainCompatibility {
  readonly compatible: boolean
  readonly summary: string
  readonly samples?: readonly M3LegacyChainSampleResult[]
}

export interface M3MigrationReport {
  readonly projectId: string
  readonly sourceFormat: string
  readonly originalFilePreserved: boolean
  readonly originalFilePath?: string
  readonly migratedFilePath?: string
  readonly migratedAtLabel?: string
  readonly unexplainedLegacyFields: readonly M3UnexplainedLegacyField[]
  readonly restrictedOperations: readonly M3RestrictedOperation[]
  readonly legacyChainCompatibility: M3LegacyChainCompatibility
}

export interface M3GetMigrationReportRequest {
  readonly projectId: string
}

export interface M3FormalVersionItem {
  readonly revision: string
  readonly committedAtLabel: string
  readonly summary: string
  readonly checkSummary?: string
  readonly isCurrent?: boolean
}

export interface M3UncommittedDraftItem {
  readonly draftRevision: string
  readonly baseRevision: string | null
  readonly updatedAtLabel: string
  readonly status: 'passed' | 'blocked' | 'in_progress'
  readonly summary: string
  readonly canUndo?: boolean
}

export interface M3ReopenRestoreStatus {
  readonly restoredFromDisk: boolean
  readonly baseRevision: string | null
  readonly draftRevision: string | null
  readonly restoredSourceCount: number
  readonly viewsConsistentWithSnapshot: boolean
  readonly restoredAtLabel?: string
  readonly summary: string
}

export interface M3OpenExternalProjectRequest {
  readonly projectId: string
  readonly draftRevision?: string | null
  readonly requestId: string
}

export interface M3OpenExternalProjectResult {
  readonly projectId: string
  readonly projectName: string
  readonly baseRevision: string | null
  readonly draftRevision: string | null
  readonly previewSnapshot?: Partial<M2PreviewSnapshot>
  readonly formalVersions?: readonly M3FormalVersionItem[]
  readonly uncommittedDrafts?: readonly M3UncommittedDraftItem[]
  readonly restoreStatus?: M3ReopenRestoreStatus | null
  readonly migrationReport?: M3MigrationReport | null
  readonly summary?: string
}

export interface M3ExternalProjectEvent {
  readonly eventId: string
  readonly projectId: string
  readonly projectName: string
  readonly sequence: number
  readonly baseRevision?: string | null
  readonly draftRevision: string
  readonly revisionOrder?: number
  readonly fingerprint?: string | null
  readonly scopeEpoch?: number | null
  readonly writerEpoch?: number | null
  readonly summary: string
  readonly updatedAtLabel?: string
  readonly previewEvent?: M2PreviewEvent
}

export interface M3WorkbenchBridge {
  readonly commitM3ApprovedDraft?: (
    request: M3CommitApprovedDraftRequest,
  ) => Promise<M2Result<M3CommitApprovedDraftResult>>
  readonly undoDraftChange?: (
    request: M3UndoDraftChangeRequest,
  ) => Promise<M2Result<M3UndoDraftChangeResult>>
  readonly getMigrationReport?: (
    request: M3GetMigrationReportRequest,
  ) => Promise<M2Result<M3MigrationReport | null>>
  readonly openExternalProjectResult?: (
    request: M3OpenExternalProjectRequest,
  ) => Promise<M2Result<M3OpenExternalProjectResult>>
  readonly subscribeM3ExternalProjectEvents?: (
    listener: (event: M3ExternalProjectEvent) => void,
  ) => Promise<
    M2Result<{
      readonly subscriptionId: string
      readonly unsubscribe?: () => void
    }>
  >
}

export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function canonicalizeSourceAnchor(anchor: M2SourceAnchor | null | undefined) {
  if (!anchor) return null
  return [
    anchor.documentRef,
    anchor.documentName,
    anchor.page,
    anchor.region
      ? [
          anchor.region.x,
          anchor.region.y,
          anchor.region.width,
          anchor.region.height,
          anchor.region.unit ?? '',
        ]
      : null,
    anchor.excerpt,
  ]
}

export function computeCheckSetFingerprint(params: {
  readonly projectId: string
  readonly baseRevision: string | null
  readonly draftRevision: string | null
  readonly modelFingerprint: string | null
  readonly drawingFingerprint: string | null
  readonly checks: readonly M2CheckItem[]
}): string {
  // F09 + E5: Include conclusion fields, stably sorted linkedFeatureIds/linkedAnnotationIds,
  // and canonicalized source anchor so any evidence/anchor change invalidates confirmation.
  const canonicalChecks = [...params.checks]
    .sort((a, b) => a.checkId.localeCompare(b.checkId))
    .map((c) =>
      JSON.stringify([
        c.checkId,
        c.requirementId,
        c.title,
        c.required ? 1 : 0,
        c.status,
        c.summary,
        c.detail ?? '',
        c.revisionFingerprint ?? '',
        c.clarificationReason ?? '',
        c.clarificationPrompt ?? '',
        [...c.linkedFeatureIds].sort((a, b) => a.localeCompare(b)),
        [...c.linkedAnnotationIds].sort((a, b) => a.localeCompare(b)),
        canonicalizeSourceAnchor(c.anchor),
      ]),
    )
    .join('|')

  const payload = [
    params.projectId,
    params.baseRevision ?? 'none',
    params.draftRevision ?? 'none',
    params.modelFingerprint ?? 'no-model',
    params.drawingFingerprint ?? 'no-drawing',
    canonicalChecks,
  ].join('::')

  return `csfp-${fnv1aHex(payload)}`
}

