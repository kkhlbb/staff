import { createHash } from 'crypto'
import { isArtifactManifest, isJob, PROJECT_AGENT_VERSION, projectAgentRequests, projectAgentResults } from '../../shared/project-agent/contracts.ts'
import type {
  ProjectAgentError, ProjectAgentJob, ProjectAgentManifest, ProjectAgentOperation, ProjectAgentRequest,
  ProjectAgentResult,
} from '../../shared/project-agent/contracts.ts'
import { hasMatchingBuildArtifacts } from '../../shared/project-agent/events.ts'

type WriteOperation = 'importRequirements' | 'answerQuestion' | 'stageChange' | 'buildAndCheck' |
  'cancelJob' | 'retryStep' | 'issueConfirmation' | 'commitApprovedDraft'

interface AuthenticatedCaller {
  callerId: string
  userId: string
  projectId: string
  authorizationRef: string
  canWrite: boolean
}

interface WriteState {
  projectId: string
  baseRevision: string | null
  draftRevision: string | null
  writerEpoch: number
  writer: { callerId: string; token: string } | null
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    const fields = value as Record<string, unknown>
    return '{' + Object.keys(fields).sort().map((key) => JSON.stringify(key) + ':' + canonical(fields[key])).join(',') + '}'
  }
  return JSON.stringify(value)
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

function authorized(caller: AuthenticatedCaller, projectId: string, authorizationRef: string): boolean {
  return caller.canWrite && caller.projectId === projectId && caller.authorizationRef === authorizationRef
}

export function checkWriterAcquisition(
  operation: 'acquireWriter' | 'takeOverWriter', raw: unknown, state: WriteState, caller: AuthenticatedCaller,
): { ok: true; nextEpoch: number } | { ok: false; code: ProjectAgentError['code'] } {
  if (!projectAgentRequests[operation](raw)) return { ok: false, code: 'INVALID_REQUEST' }
  if (state.projectId !== raw.projectId || !authorized(caller, raw.projectId, raw.authorizationRef)) {
    return { ok: false, code: 'AUTH_REQUIRED' }
  }
  if (raw.expectedWriterEpoch !== state.writerEpoch || (operation === 'acquireWriter' && state.writer !== null)) {
    return { ok: false, code: 'WRITER_HELD' }
  }
  if (!Number.isSafeInteger(state.writerEpoch + 1)) return { ok: false, code: 'STEP_FAILED' }
  return { ok: true, nextEpoch: state.writerEpoch + 1 }
}

export interface WriteReceipt<K extends ProjectAgentOperation> {
  scope: string
  digest: string
  result: ProjectAgentResult<K>
}

export function checkWrite<K extends WriteOperation>(
  operation: K, raw: unknown, state: WriteState, caller: AuthenticatedCaller,
  lookupReceipt: (scope: string) => WriteReceipt<K> | undefined,
): { status: 'proceed'; scope: string; digest: string; request: ProjectAgentRequest<K> } |
   { status: 'replay'; result: ProjectAgentResult<K> } |
   { status: 'rejected'; code: ProjectAgentError['code'] } {
  if (!projectAgentRequests[operation](raw)) return { status: 'rejected', code: 'INVALID_REQUEST' }
  if (state.projectId !== raw.projectId || !authorized(caller, raw.projectId, raw.authorizationRef)) {
    return { status: 'rejected', code: 'AUTH_REQUIRED' }
  }
  if (state.writerEpoch !== raw.writerEpoch || state.writer?.callerId !== caller.callerId ||
      state.writer.token !== raw.writerToken) return { status: 'rejected', code: 'WRITER_REVOKED' }

  // Transport IDs and refreshed credentials do not change the logical request.
  const payload = { ...raw, requestId: null, authorizationRef: null, writerToken: null, writerEpoch: null }
  const scope = canonical([PROJECT_AGENT_VERSION, raw.projectId, caller.userId, caller.callerId, operation, raw.idempotencyKey])
  const digest = fingerprint(payload)
  const receipt = lookupReceipt(scope)
  if (receipt) {
    if (receipt.scope !== scope || receipt.digest !== digest) return { status: 'rejected', code: 'IDEMPOTENCY_CONFLICT' }
    if (!projectAgentResults[operation](receipt.result)) return { status: 'rejected', code: 'SAVE_FAILED' }
    return { status: 'replay', result: receipt.result }
  }
  if (raw.baseRevision !== state.baseRevision || raw.expectedDraftRevision !== state.draftRevision) {
    return { status: 'rejected', code: 'STALE_BASE' }
  }
  return { status: 'proceed', scope, digest, request: raw as ProjectAgentRequest<K> }
}

export function checkSetFingerprint(manifest: ProjectAgentManifest): string {
  const checks = manifest.checks.map(canonical).sort()
  return fingerprint({ inputFingerprint: manifest.inputs.inputFingerprint, rulesVersion: manifest.inputs.rulesVersion, checks })
}

export function previewFingerprint(manifest: ProjectAgentManifest): string {
  const { projectId, baseRevision, draftRevision, inputs, objectMapVersion } = manifest
  const artifacts = manifest.artifacts.map(canonical).sort()
  return fingerprint({ projectId, baseRevision, draftRevision, inputs, objectMapVersion, artifacts,
    checkFingerprint: checkSetFingerprint(manifest) })
}

export interface PreviewConfirmation {
  token: string
  projectId: string
  userId: string
  writerEpoch: number
  baseRevision: string | null
  draftRevision: string
  previewFingerprint: string
  checkFingerprint: string
  expiresAtMs: number
  consumed: boolean
}

// Call only after checkWrite returns proceed. Transaction ownership and token consumption
// belong to the caller; the guard does not mutate or persist any records.
export function checkCommitConfirmation(
  raw: unknown, confirmation: PreviewConfirmation | null, userId: string, nowMs: number,
  current: ProjectAgentManifest, job: ProjectAgentJob, requiredRequirementIds: readonly string[],
): 'INVALID_REQUEST' | 'STALE_CONFIRMATION' | 'CHECK_BLOCKED' | null {
  if (!projectAgentRequests.commitApprovedDraft(raw)) return 'INVALID_REQUEST'
  if (!confirmation || confirmation.consumed || !Number.isSafeInteger(nowMs) ||
      !Number.isSafeInteger(confirmation.expiresAtMs) || nowMs < 0 || nowMs >= confirmation.expiresAtMs ||
      !isArtifactManifest(current) || !isJob(job) ||
      confirmation.token !== raw.confirmationToken || confirmation.userId !== userId ||
      confirmation.projectId !== raw.projectId || confirmation.writerEpoch !== raw.writerEpoch ||
      confirmation.baseRevision !== raw.baseRevision || confirmation.draftRevision !== raw.expectedDraftRevision ||
      current.projectId !== raw.projectId || current.baseRevision !== raw.baseRevision ||
      current.draftRevision !== raw.expectedDraftRevision ||
      current.previewFingerprint !== raw.previewFingerprint || confirmation.previewFingerprint !== raw.previewFingerprint ||
      current.checkFingerprint !== raw.checkFingerprint || confirmation.checkFingerprint !== raw.checkFingerprint ||
      previewFingerprint(current) !== raw.previewFingerprint || checkSetFingerprint(current) !== raw.checkFingerprint) {
    return 'STALE_CONFIRMATION'
  }
  const checks = new Map(current.checks.map((check) => [check.requirementId, check]))
  if (!hasMatchingBuildArtifacts(job, current.artifacts, current.objectMapVersion) ||
      canonical(current.inputs) !== canonical(job.inputs) || checks.size !== current.checks.length ||
      current.checks.some((check) => check.inputFingerprint !== current.inputs.inputFingerprint ||
        check.evidence.requirementId !== check.requirementId || (check.required && check.status !== 'pass')) ||
      requiredRequirementIds.some((id) => {
        const check = checks.get(id)
        return check?.required !== true || check.status !== 'pass'
      })) return 'CHECK_BLOCKED'
  return null
}
