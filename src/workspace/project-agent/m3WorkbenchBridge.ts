/**
 * Narrow duck-typing bridge and pure state/confirmation helpers for M3-FE-01:
 * completion review view & bound one-time formal commit (A11 / A04),
 * non-disruptive external project modification notifications,
 * history restore / blocked-draft undo (A04 / A09), and
 * legacy `.cunlian` spacer project migration diff reporting (A10).
 *
 * Boundary rules:
 * - Never modifies frozen `desktop/shared/contracts.ts`, `desktop/preload`, or `desktop/main`.
 * - Never fabricates backend success when M3 narrow methods are missing.
 */

import {
  normalizeWorkbenchBridgeError,
  type M1WorkbenchBridgeResult,
} from './m1WorkbenchBridge'
import {
  areArtifactsRevisionAligned,
  parseRevisionOrder,
  type M2ArtifactSlotState,
  type M2CheckItem,
  type M2DrawingFailureNotice,
  type M2ModelFeatureItem,
  type M2PreviewEvent,
  type M2PreviewSnapshot,
  type M2RequirementItem,
  type M2SourceAnchor,
} from './m2WorkbenchBridge'

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
  ) => Promise<M1WorkbenchBridgeResult<M3CommitApprovedDraftResult>>
  readonly undoDraftChange?: (
    request: M3UndoDraftChangeRequest,
  ) => Promise<M1WorkbenchBridgeResult<M3UndoDraftChangeResult>>
  readonly getMigrationReport?: (
    request: M3GetMigrationReportRequest,
  ) => Promise<M1WorkbenchBridgeResult<M3MigrationReport | null>>
  readonly openExternalProjectResult?: (
    request: M3OpenExternalProjectRequest,
  ) => Promise<M1WorkbenchBridgeResult<M3OpenExternalProjectResult>>
  readonly subscribeM3ExternalProjectEvents?: (
    listener: (event: M3ExternalProjectEvent) => void,
  ) => Promise<
    M1WorkbenchBridgeResult<{
      readonly subscriptionId: string
      readonly unsubscribe?: () => void
    }>
  >
}

export const M3_WORKBENCH_BRIDGE_METHODS = [
  'commitM3ApprovedDraft',
  'undoDraftChange',
  'getMigrationReport',
  'openExternalProjectResult',
  'subscribeM3ExternalProjectEvents',
] as const

export type M3WorkbenchBridgeMethodName = (typeof M3_WORKBENCH_BRIDGE_METHODS)[number]

export interface M3WorkbenchBridgeProbe {
  readonly bridge: M3WorkbenchBridge
  readonly capabilities: {
    readonly commitM3ApprovedDraft: boolean
    readonly undoDraftChange: boolean
    readonly getMigrationReport: boolean
    readonly openExternalProjectResult: boolean
    readonly externalProjectEvents: boolean
  }
  readonly anyAvailable: boolean
  readonly missingMethods: readonly M3WorkbenchBridgeMethodName[]
}

export function probeM3WorkbenchBridge(candidate: unknown): M3WorkbenchBridgeProbe {
  const record =
    candidate !== null && typeof candidate === 'object'
      ? (candidate as Record<string, unknown>)
      : null

  const bindMethod = <K extends M3WorkbenchBridgeMethodName>(
    name: K,
  ): M3WorkbenchBridge[K] | undefined => {
    if (!record || typeof record[name] !== 'function') {
      return undefined
    }
    const fn = record[name] as (...args: unknown[]) => unknown
    return ((...args: unknown[]) => fn.apply(record, args)) as M3WorkbenchBridge[K]
  }

  const bridge: M3WorkbenchBridge = {
    commitM3ApprovedDraft: bindMethod('commitM3ApprovedDraft'),
    undoDraftChange: bindMethod('undoDraftChange'),
    getMigrationReport: bindMethod('getMigrationReport'),
    openExternalProjectResult: bindMethod('openExternalProjectResult'),
    subscribeM3ExternalProjectEvents: bindMethod('subscribeM3ExternalProjectEvents'),
  }

  const missingMethods: M3WorkbenchBridgeMethodName[] = []
  for (const name of M3_WORKBENCH_BRIDGE_METHODS) {
    if (typeof bridge[name] !== 'function') {
      missingMethods.push(name)
    }
  }

  const capabilities = {
    commitM3ApprovedDraft: typeof bridge.commitM3ApprovedDraft === 'function',
    undoDraftChange: typeof bridge.undoDraftChange === 'function',
    getMigrationReport: typeof bridge.getMigrationReport === 'function',
    openExternalProjectResult: typeof bridge.openExternalProjectResult === 'function',
    externalProjectEvents: typeof bridge.subscribeM3ExternalProjectEvents === 'function',
  }

  return {
    bridge,
    capabilities,
    anyAvailable: Object.values(capabilities).some(Boolean),
    missingMethods,
  }
}

export function resolveWindowM3WorkbenchBridge(): M3WorkbenchBridgeProbe {
  const candidate =
    typeof window !== 'undefined' ? (window as { cunlian?: unknown }).cunlian : undefined
  return probeM3WorkbenchBridge(candidate)
}

export function normalizeM3BridgeError(error: unknown, fallbackMessage: string) {
  return normalizeWorkbenchBridgeError(error, fallbackMessage)
}

/**
 * Detect whether a user chat message expresses a completion/review intent
 * (e.g., "完成", "完成了", "保存此版本", "确认完成", "进入完成视图").
 * In M3, chat completion intent MUST ONLY open the completion review view
 * and MUST NEVER bypass human confirmation to commit directly.
 */
export function isCompletionIntentPrompt(prompt: string): boolean {
  const normalized = prompt.trim().replace(/[。！!？?\s]+$/g, '')
  if (!normalized) return false
  const exactMatches = [
    /^完成$/i,
    /^完成了$/i,
    /^已完成$/i,
    /^可以完成$/i,
    /^确认完成$/i,
    /^完成并保存$/i,
    /^保存此版本$/i,
    /^保存正式版本$/i,
    /^提交正式版本$/i,
    /^进入完成视图$/i,
    /^打开完成视图$/i,
    /^done$/i,
    /^finish$/i,
    /^complete$/i,
  ]
  return exactMatches.some((pattern) => pattern.test(normalized))
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function canonicalizeSourceAnchor(anchor: M2SourceAnchor | null | undefined) {
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

export interface M3CheckCounts {
  readonly total: number
  readonly pass: number
  readonly fail: number
  readonly needsClarification: number
  readonly uncovered: number
  readonly executionFailed: number
  readonly checking: number
}

export function summarizeCheckCounts(
  checks: readonly M2CheckItem[],
  checksInProgress: boolean,
): M3CheckCounts {
  let pass = 0
  let fail = 0
  let needsClarification = 0
  let uncovered = 0
  let executionFailed = 0
  let checking = 0

  for (const item of checks) {
    switch (item.status) {
      case 'pass':
        pass += 1
        break
      case 'fail':
        fail += 1
        break
      case 'needsClarification':
        needsClarification += 1
        break
      case 'uncovered':
        uncovered += 1
        break
      case 'executionFailed':
        executionFailed += 1
        break
      case 'checking':
        checking += 1
        break
    }
  }

  if (checksInProgress && checking === 0 && checks.length === 0) {
    checking = 1
  }

  return {
    total: checks.length,
    pass,
    fail,
    needsClarification,
    uncovered,
    executionFailed,
    checking,
  }
}

export interface M3BlockingCheckDetail {
  readonly check: M2CheckItem
  readonly linkedFeatures: readonly M2ModelFeatureItem[]
}

export interface M3BlockingRequirementDetail {
  readonly requirement: M2RequirementItem
  readonly reason: 'status_not_confirmed' | 'missing_passed_check'
  readonly reasonText: string
}

export interface M3CompletionReadiness {
  readonly isGenerating: boolean
  readonly modelReady: boolean
  readonly drawingReady: boolean
  readonly artifactsAligned: boolean
  readonly checksInProgress: boolean
  readonly counts: M3CheckCounts
  readonly failedOrUncheckedChecks: readonly M2CheckItem[]
  readonly blockingChecks: readonly M3BlockingCheckDetail[]
  readonly blockingRequirements: readonly M3BlockingRequirementDetail[]
  readonly canSaveFormal: boolean
  readonly blockReasons: readonly string[]
}

function formatRequirementStatusLabel(status: M2RequirementItem['status']): string {
  switch (status) {
    case 'confirmed':
      return '已确认'
    case 'needsClarification':
      return '待澄清'
    case 'conflict':
      return '来源冲突'
    case 'uncovered':
      return '未覆盖'
  }
}

export function evaluateCompletionReadiness(params: {
  readonly draftRevision: string | null
  readonly model: M2ArtifactSlotState
  readonly drawing: M2ArtifactSlotState
  readonly drawingFailure?: M2DrawingFailureNotice | null
  readonly requirements?: readonly M2RequirementItem[]
  readonly checks: readonly M2CheckItem[]
  readonly checksInProgress: boolean
  readonly features: readonly M2ModelFeatureItem[]
}): M3CompletionReadiness {
  const targetDraftRevision = params.draftRevision?.trim() || null
  const modelFp = params.model.fingerprint?.trim() ?? ''
  const drawingFp = params.drawing.fingerprint?.trim() ?? ''

  const modelReady =
    params.model.status === 'ready' &&
    Boolean(targetDraftRevision) &&
    params.model.revision === targetDraftRevision &&
    Boolean(modelFp)
  const drawingReady =
    params.drawing.status === 'ready' &&
    Boolean(targetDraftRevision) &&
    params.drawing.revision === targetDraftRevision &&
    Boolean(drawingFp)

  // F08: Same-revision drawing_failed MUST block formal commit even if drawing slot retained a previous/ready state.
  const hasSameRevisionDrawingFailure = Boolean(
    targetDraftRevision &&
      params.drawingFailure &&
      params.drawingFailure.failedRevision === targetDraftRevision,
  )

  const artifactsAligned =
    Boolean(targetDraftRevision) &&
    areArtifactsRevisionAligned(params.model, params.drawing, targetDraftRevision) &&
    !hasSameRevisionDrawingFailure

  const currentFingerprint = artifactsAligned ? modelFp : null
  const counts = summarizeCheckCounts(params.checks, params.checksInProgress)
  const isChecking = params.checksInProgress || counts.checking > 0

  const isGenerating =
    params.model.status === 'building' ||
    params.drawing.status === 'building' ||
    isChecking ||
    (!hasSameRevisionDrawingFailure && modelReady && !drawingReady && params.drawing.status !== 'failed') ||
    (!hasSameRevisionDrawingFailure && modelReady && drawingReady && !artifactsAligned)

  const failedOrUncheckedChecks = params.checks.filter((item) => item.status !== 'pass')

  const featureById = new Map(params.features.map((f) => [f.objectId, f]))
  const requiredChecks = params.checks.filter((item) => item.required)
  const blockingChecks: M3BlockingCheckDetail[] = requiredChecks
    .filter((item) => item.status !== 'pass')
    .map((check) => ({
      check,
      linkedFeatures: check.linkedFeatureIds
        .map((id) => featureById.get(id))
        .filter((f): f is M2ModelFeatureItem => f !== undefined),
    }))

  // F08 / E1: Every required check MUST have a non-empty revisionFingerprint strictly equal to current draft fingerprint.
  const staleOrUnboundRequiredChecks = requiredChecks.filter((item) => {
    const checkFp = item.revisionFingerprint?.trim() ?? ''
    if (!checkFp) return true
    if (currentFingerprint !== null && checkFp !== currentFingerprint) return true
    return false
  })

  // E3: Required requirements that are not confirmed or lack a passed check for the current revision fingerprint MUST block formal commit.
  const requiredRequirements = (params.requirements ?? []).filter((req) => req.required)
  const blockingRequirements: M3BlockingRequirementDetail[] = []
  for (const req of requiredRequirements) {
    if (req.status !== 'confirmed') {
      blockingRequirements.push({
        requirement: req,
        reason: 'status_not_confirmed',
        reasonText: `必需要求状态为「${formatRequirementStatusLabel(req.status)}」，尚未确认通过`,
      })
      continue
    }
    const hasCurrentRevPassedCheck = params.checks.some((chk) => {
      if (chk.requirementId !== req.requirementId || chk.status !== 'pass') return false
      const chkFp = chk.revisionFingerprint?.trim() ?? ''
      if (!chkFp) return false
      if (currentFingerprint !== null && chkFp !== currentFingerprint) return false
      return true
    })
    if (!hasCurrentRevPassedCheck) {
      blockingRequirements.push({
        requirement: req,
        reason: 'missing_passed_check',
        reasonText: '缺少对应当前草稿修订指纹且通过的检查记录',
      })
    }
  }

  const blockReasons: string[] = []
  if (!targetDraftRevision) {
    blockReasons.push('当前没有待提交的草稿修订。')
  }
  if (hasSameRevisionDrawingFailure) {
    blockReasons.push(
      `当前草稿（${targetDraftRevision}）存在图纸生成失败记录，请先重试图纸并待同修订就绪后再提交正式版本。`,
    )
  } else if (!modelReady || !drawingReady || !artifactsAligned) {
    blockReasons.push('同修订模型与二维图纸尚未全部就绪或修订指纹不一致。')
  }
  if (isChecking) {
    blockReasons.push('仍有条款正在检查中，请等待检查完成。')
  }
  if (params.checks.length === 0 || requiredChecks.length === 0) {
    blockReasons.push('当前草稿缺少必需条款检查通过记录，禁止提交正式版本。')
  }
  if (blockingChecks.length > 0) {
    blockReasons.push(
      `存在 ${blockingChecks.length} 项未通过的必需条款，禁止提交正式版本，仅允许保留草稿或撤销修改。`,
    )
  }
  if (blockingRequirements.length > 0) {
    blockReasons.push(
      `存在 ${blockingRequirements.length} 项未满足或待澄清的必需要求（${blockingRequirements.map((b) => b.requirement.title).join('、')}），禁止提交正式版本。`,
    )
  }
  if (requiredChecks.length > 0 && staleOrUnboundRequiredChecks.length > 0) {
    blockReasons.push(
      `存在 ${staleOrUnboundRequiredChecks.length} 项必需条款缺少当前草稿修订指纹或指纹不匹配，禁止沿用旧修订检查结果放行正式提交。`,
    )
  }

  const canSaveFormal =
    Boolean(targetDraftRevision) &&
    modelReady &&
    drawingReady &&
    artifactsAligned &&
    !hasSameRevisionDrawingFailure &&
    !isChecking &&
    params.checks.length > 0 &&
    requiredChecks.length > 0 &&
    blockingChecks.length === 0 &&
    blockingRequirements.length === 0 &&
    staleOrUnboundRequiredChecks.length === 0

  return {
    isGenerating,
    modelReady,
    drawingReady,
    artifactsAligned,
    checksInProgress: isChecking,
    counts,
    failedOrUncheckedChecks,
    blockingChecks,
    blockingRequirements,
    canSaveFormal,
    blockReasons,
  }
}

export interface M3ExternalNotificationWatermark {
  readonly revisionOrder: number | null
  readonly sequence: number
  readonly lastEventId?: string
}

export type M3ExternalNotificationWatermarks = Readonly<
  Record<string, M3ExternalNotificationWatermark>
>

/**
 * E6: Persistent per-project high-watermark check so dismissed/opened/cleared notifications
 * can never be resurrected by re-delivered older events.
 */
export function isExternalNotificationNewerThanWatermark(
  watermark: M3ExternalNotificationWatermark | undefined,
  incoming: M3ExternalProjectEvent,
): boolean {
  if (!watermark) return true
  if (watermark.lastEventId && watermark.lastEventId === incoming.eventId) {
    return false
  }
  const incomingOrder = parseRevisionOrder(incoming.draftRevision, incoming.revisionOrder)
  if (watermark.revisionOrder !== null && incomingOrder !== null) {
    if (incomingOrder < watermark.revisionOrder) return false
    if (incomingOrder > watermark.revisionOrder) return true
  }
  return incoming.sequence > watermark.sequence
}

/**
 * F12: Monotonic comparison for non-current project external notifications.
 * Rejects older revisionOrder / sequence from overwriting a newer notification for the same project.
 */
export function isIncomingExternalNotificationNewer(
  existing: M3ExternalProjectEvent,
  incoming: M3ExternalProjectEvent,
): boolean {
  if (existing.eventId === incoming.eventId) {
    return false
  }
  const existingOrder = parseRevisionOrder(existing.draftRevision, existing.revisionOrder)
  const incomingOrder = parseRevisionOrder(incoming.draftRevision, incoming.revisionOrder)
  if (existingOrder !== null && incomingOrder !== null) {
    if (incomingOrder < existingOrder) return false
    if (incomingOrder > existingOrder) return true
  }
  return incoming.sequence > existing.sequence
}

export function mergeExternalProjectNotification(
  current: readonly M3ExternalProjectEvent[],
  incoming: M3ExternalProjectEvent,
): readonly M3ExternalProjectEvent[] {
  if (current.some((item) => item.eventId === incoming.eventId)) {
    return current
  }
  const existingForProject = current.find((item) => item.projectId === incoming.projectId)
  if (existingForProject && !isIncomingExternalNotificationNewer(existingForProject, incoming)) {
    return current
  }
  const withoutSameProject = current.filter((item) => item.projectId !== incoming.projectId)
  return [incoming, ...withoutSameProject]
}

/**
 * N4: Compute next persistent high-watermark for a project's external notifications.
 * When an incomparable notification omits numeric `revisionOrder` (`null`/`undefined`),
 * strictly preserves the existing numeric `revisionOrder` so older revisions cannot
 * bypass the watermark via a higher sequence.
 */
export function computeNextExternalNotificationWatermark(
  prev: M3ExternalNotificationWatermark | undefined,
  incoming: M3ExternalProjectEvent,
): M3ExternalNotificationWatermark {
  const incomingOrder = parseRevisionOrder(incoming.draftRevision, incoming.revisionOrder)
  const prevOrder = prev?.revisionOrder ?? null
  const nextRevisionOrder =
    incomingOrder !== null
      ? prevOrder !== null
        ? Math.max(prevOrder, incomingOrder)
        : incomingOrder
      : prevOrder
  return {
    revisionOrder: nextRevisionOrder,
    sequence: incoming.sequence,
    lastEventId: incoming.eventId,
  }
}

/**
 * E6 / N4: Merge external project notification against a persistent per-project watermark map.
 * Watermarks persist even after notifications are dismissed, opened, or cleared,
 * and never erase an existing numeric `revisionOrder` when an incomparable notification arrives.
 */
export function mergeExternalProjectNotificationWithWatermarks(
  current: readonly M3ExternalProjectEvent[],
  watermarks: M3ExternalNotificationWatermarks,
  incoming: M3ExternalProjectEvent,
): {
  readonly notifications: readonly M3ExternalProjectEvent[]
  readonly watermarks: M3ExternalNotificationWatermarks
  readonly accepted: boolean
} {
  if (!isExternalNotificationNewerThanWatermark(watermarks[incoming.projectId], incoming)) {
    return { notifications: current, watermarks, accepted: false }
  }
  const merged = mergeExternalProjectNotification(current, incoming)
  if (merged === current) {
    return { notifications: current, watermarks, accepted: false }
  }
  const nextWatermarks: M3ExternalNotificationWatermarks = {
    ...watermarks,
    [incoming.projectId]: computeNextExternalNotificationWatermark(
      watermarks[incoming.projectId],
      incoming,
    ),
  }
  return {
    notifications: merged,
    watermarks: nextWatermarks,
    accepted: true,
  }
}

export interface M3BoundConfirmation {
  readonly confirmationToken: string
  readonly projectId: string
  readonly baseRevision: string | null
  readonly draftRevision: string
  readonly checkSetFingerprint: string
  readonly createdAtSeq: number
}

export function createBoundConfirmation(params: {
  readonly projectId: string
  readonly baseRevision: string | null
  readonly draftRevision: string
  readonly checkSetFingerprint: string
  readonly seq: number
}): M3BoundConfirmation {
  const tokenSeed = `${params.projectId}|${params.baseRevision ?? 'none'}|${params.draftRevision}|${params.checkSetFingerprint}|${params.seq}`
  return {
    confirmationToken: `cfm-${params.seq}-${fnv1aHex(tokenSeed)}`,
    projectId: params.projectId,
    baseRevision: params.baseRevision,
    draftRevision: params.draftRevision,
    checkSetFingerprint: params.checkSetFingerprint,
    createdAtSeq: params.seq,
  }
}

export function isBoundConfirmationValid(
  confirmation: M3BoundConfirmation | null,
  current: {
    readonly projectId: string
    readonly baseRevision: string | null
    readonly draftRevision: string | null
    readonly checkSetFingerprint: string
  },
): boolean {
  if (!confirmation) return false
  if (confirmation.projectId !== current.projectId) return false
  if (confirmation.baseRevision !== current.baseRevision) return false
  if (confirmation.draftRevision !== current.draftRevision) return false
  if (confirmation.checkSetFingerprint !== current.checkSetFingerprint) return false
  return true
}
