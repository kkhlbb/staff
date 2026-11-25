import { MAX_ABS_Q, Q_PER_MM } from '../../../src/domain/types.ts'
import { bool, either, finite, hash, list, nat, nullable, object, oneOf, positive, q, text } from './schema.ts'
import type { Infer, Schema } from './schema.ts'

export const PROJECT_AGENT_VERSION = '0.1.0-m0' as const

const version = oneOf(PROJECT_AGENT_VERSION)
const kind = oneOf('model', 'drawing', 'checks')
const format = oneOf('svg', 'dxf', 'step')
const connection = either(
  object({ status: oneOf('disconnected', 'connecting'), source: nullable(oneOf('external', 'internal')) }),
  object({ status: oneOf('connected'), source: oneOf('external', 'internal'), clientName: text }),
)
export const isCapabilities = object({
  projectService: bool, externalBridge: bool, internalToolRoundTrip: bool,
  persistentWrites: bool, eventReplay: bool, plateGeometry: bool,
  drawingProjection: bool, planarAnalysis: bool, spatialAnalysis: bool, fixedPoseInterference: bool,
  parts: list(object({ partType: oneOf('spacer', 'plate'), features: list(text), checks: list(text), formats: list(format) })),
})
export const M0_CAPABILITIES = {
  projectService: false, externalBridge: false, internalToolRoundTrip: false,
  persistentWrites: false, eventReplay: false, plateGeometry: false,
  drawingProjection: false, planarAnalysis: false, spatialAnalysis: false, fixedPoseInterference: false, parts: [],
} satisfies Infer<typeof isCapabilities>

export const isObjectRef = object({
  partId: text, featureId: text, role: text, revision: text, objectMapVersion: text,
})
export type ObjectRef = Infer<typeof isObjectRef>

const triple: Schema<[number, number, number]> = (v): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && finite(v[0]) && finite(v[1]) && finite(v[2])
const positiveMm: Schema<number> = (v): v is number => finite(v) && v > 0
const geometryBoundary = object({
  unit: oneOf('mm'), coordinateSystemId: text, originMm: triple,
  xAxis: triple, yAxis: triple, zAxis: triple, modelingToleranceMm: positiveMm, displayDecimals: nat,
})
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const near = (value: number, target: number) => Math.abs(value - target) <= 1e-9
export const isGeometryBoundary: Schema<Infer<typeof geometryBoundary>> =
  (value): value is Infer<typeof geometryBoundary> => {
    if (!geometryBoundary(value)) return false
    const { xAxis: x, yAxis: y, zAxis: z } = value
    const cross = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]
    return [x, y, z].every((axis) => near(dot(axis, axis), 1)) &&
      near(dot(x, y), 0) && near(dot(y, z), 0) && near(dot(z, x), 0) && near(dot(cross, z), 1)
  }
export function qToGeometryMm(value: number): number {
  if (!q(value)) throw new RangeError('Expected a safe integer q (0.0001 mm)')
  return value / Q_PER_MM
}
const anchor = object({
  documentRef: text, documentFingerprint: hash, page: positive,
  region: nullable(object({ x: nat, y: nat, width: positive, height: positive, unit: oneOf('pdfPoint1000') })),
  excerpt: text,
})
const thresholdFields = object({ lowerQ: nullable(q), upperQ: nullable(q), lowerInclusive: bool, upperInclusive: bool })
const threshold: Schema<Infer<typeof thresholdFields>> = (value): value is Infer<typeof thresholdFields> => {
  if (!thresholdFields(value)) return false
  const { lowerQ, upperQ, lowerInclusive, upperInclusive } = value
  if (lowerQ === null) return upperQ !== null && !lowerInclusive
  if (upperQ === null) return !upperInclusive
  return lowerQ < upperQ || (lowerQ === upperQ && lowerInclusive && upperInclusive)
}
const evidence = object({
  requirementId: text, anchors: list(anchor), objects: list(isObjectRef), annotationIds: list(text),
  inputs: list(object({ name: text, valueQ: q })), threshold: nullable(threshold),
})
const requirement = object({
  requirementId: text, anchors: list(anchor), interpretation: text, required: bool, threshold: nullable(threshold),
})
const question = object({
  questionId: text, reason: oneOf('missing', 'conflict', 'ambiguousReference'), prompt: text, anchors: list(anchor),
})
export const isCheck = object({
  requirementId: text, required: bool, ruleId: text, ruleVersion: text,
  inputFingerprint: hash, status: oneOf('pass', 'fail', 'needsClarification', 'uncovered', 'executionFailed'),
  evidence,
})
export type ProjectAgentCheck = Infer<typeof isCheck>
export const isBuildInputs = object({
  requirementVersion: text, featureVersion: text, kernelVersion: text, rulesVersion: text,
  inputFingerprint: hash, geometry: isGeometryBoundary,
})
const scopeFields = { projectId: text, baseRevision: nullable(text), draftRevision: text }
const artifactFields = {
  artifactId: text, kind, hash, inputFingerprint: hash, objectMapVersion: text, attempt: positive,
  localRef: text, unit: oneOf('mm', 'q'),
}
const artifact = object({ ...scopeFields, draftRevision: nullable(text), jobId: text, ...artifactFields })
export const isArtifact: Schema<Infer<typeof artifact>> = (value): value is Infer<typeof artifact> =>
  artifact(value) && (value.baseRevision !== null || value.draftRevision !== null) &&
  value.unit === (value.kind === 'checks' ? 'q' : 'mm')
export type ProjectAgentArtifact = Infer<typeof isArtifact>
const artifactManifest = object({
  ...scopeFields, draftRevision: nullable(text), inputs: isBuildInputs, artifacts: list(isArtifact), checks: list(isCheck),
  objectMapVersion: text, previewFingerprint: nullable(hash), checkFingerprint: nullable(hash),
})
export type ProjectAgentManifest = Infer<typeof artifactManifest>
export const isArtifactManifest: Schema<ProjectAgentManifest> = (value): value is ProjectAgentManifest =>
  artifactManifest(value) && (value.baseRevision !== null || value.draftRevision !== null) &&
  (value.previewFingerprint === null) === (value.checkFingerprint === null) &&
  new Set(value.artifacts.map((entry) => entry.kind)).size === value.artifacts.length &&
  value.artifacts.every((entry) =>
    entry.projectId === value.projectId && entry.baseRevision === value.baseRevision &&
    entry.draftRevision === value.draftRevision && entry.inputFingerprint === value.inputs.inputFingerprint &&
    entry.objectMapVersion === value.objectMapVersion) &&
  value.checks.every((entry) => entry.inputFingerprint === value.inputs.inputFingerprint &&
    entry.requirementId === entry.evidence.requirementId)
const step = object({
  kind, attempt: positive, status: oneOf('queued', 'running', 'ready', 'failed', 'cancelled'),
  retryable: bool,
})
const jobShape = object({
  ...scopeFields, jobId: text, inputs: isBuildInputs,
  status: oneOf('queued', 'running', 'complete', 'failed', 'cancelled'), steps: list(step),
})
export type ProjectAgentJob = Infer<typeof jobShape>
export const isJob: Schema<ProjectAgentJob> = (value): value is ProjectAgentJob =>
  jobShape(value) && new Set(value.steps.map((step) => step.kind)).size === value.steps.length

const snapshotShape = object({
  version, projectId: text, baseRevision: nullable(text), draftRevision: nullable(text), cursor: nat,
  connection, authorization: object({ authorized: bool, canWrite: bool }),
  writer: object({ epoch: nat, callerId: nullable(text) }), selection: nullable(isObjectRef),
  capabilities: isCapabilities, activeJobId: nullable(text), jobs: list(isJob), currentManifest: nullable(isArtifactManifest),
  fallbackArtifacts: list(isArtifact),
})
export type ProjectAgentSnapshot = Infer<typeof snapshotShape>
export const isProjectAgentSnapshot: Schema<ProjectAgentSnapshot> = (value): value is ProjectAgentSnapshot =>
  snapshotShape(value) &&
  (value.authorization.authorized || !value.authorization.canWrite) &&
  value.jobs.every((job) => job.projectId === value.projectId) &&
  new Set(value.jobs.map((job) => job.jobId)).size === value.jobs.length &&
  (value.activeJobId === null || value.jobs.some((job) => job.jobId === value.activeJobId &&
    job.baseRevision === value.baseRevision && job.draftRevision === value.draftRevision)) &&
  value.fallbackArtifacts.every((artifact) => artifact.projectId === value.projectId) &&
  (value.currentManifest === null || (
    value.currentManifest.projectId === value.projectId &&
    value.currentManifest.baseRevision === value.baseRevision &&
    value.currentManifest.draftRevision === value.draftRevision
  ))

const eventFields = {
  version, projectId: text, baseRevision: nullable(text), draftRevision: nullable(text), jobId: nullable(text),
  sequence: positive,
}
const scopedJobEvent = { ...eventFields, draftRevision: text, jobId: text }
const artifactReady = object({ ...scopedJobEvent, type: oneOf('artifactReady'), ...artifactFields })
const jobChanged = object({ ...scopedJobEvent, type: oneOf('jobChanged'), job: isJob })
const jobCancelled = object({ ...scopedJobEvent, type: oneOf('jobCancelled') })
const contextChanged = object({ ...eventFields, type: oneOf('contextChanged'), jobId: oneOf(null) })
export type ProjectAgentEvent = Infer<typeof artifactReady | typeof jobChanged | typeof jobCancelled | typeof contextChanged>
export const isProjectAgentEvent: Schema<ProjectAgentEvent> = (value): value is ProjectAgentEvent =>
  (artifactReady(value) && value.unit === (value.kind === 'checks' ? 'q' : 'mm')) || jobCancelled(value) || contextChanged(value) ||
  (jobChanged(value) && value.projectId === value.job.projectId && value.baseRevision === value.job.baseRevision &&
    value.draftRevision === value.job.draftRevision && value.jobId === value.job.jobId)

export const isProjectAgentError = object({
  code: oneOf('AUTH_REQUIRED', 'WRITER_HELD', 'WRITER_REVOKED', 'STALE_BASE', 'IDEMPOTENCY_CONFLICT',
    'NEEDS_CLARIFICATION', 'REFERENCE_STALE', 'UNSUPPORTED_SCOPE', 'CHECK_BLOCKED', 'STALE_CONFIRMATION',
    'CANCELLED', 'STEP_FAILED', 'CURSOR_EXPIRED', 'SAVE_FAILED', 'INVALID_REQUEST'),
  message: text, retryable: bool, requestId: text,
  details: object({
    baseRevision: nullable(text), draftRevision: nullable(text), retryStep: nullable(kind),
    recovery: nullable(oneOf('refreshSnapshot', 'reviewPreview', 'acquireWriter', 'retryStep')),
    question: nullable(question),
  }),
})
export type ProjectAgentError = Infer<typeof isProjectAgentError>

const request = { version, requestId: text }
const project = { ...request, projectId: text, authorizationRef: text }
const takeover = { ...project, expectedWriterEpoch: nat }
const write = {
  ...project, writerToken: text, writerEpoch: positive, baseRevision: nullable(text),
  expectedDraftRevision: nullable(text), idempotencyKey: text,
}
const draftWrite = { ...write, expectedDraftRevision: text }
const preview = { previewFingerprint: hash, checkFingerprint: hash }
const dimensionInputQ: Schema<number> = (value): value is number => q(value) && Math.abs(value) <= MAX_ABS_Q
const operation = either(
  object({ type: oneOf('translateHole'), target: isObjectRef, axis: oneOf('x', 'y'), deltaQ: dimensionInputQ }),
  either(object({ type: oneOf('removeFeature'), target: isObjectRef }),
    object({ type: oneOf('rebindReference'), target: isObjectRef, replacement: isObjectRef, requirementId: text })),
)
const writerResult = object({ writerToken: text, writerEpoch: positive, snapshot: isProjectAgentSnapshot })
const requirementResult = object({ draftRevision: text, requirements: list(requirement), questions: list(question) })

export const projectAgentRequests = {
  capabilities: object(request),
  getContext: object({ ...project, revision: nullable(text) }),
  acquireWriter: object(takeover),
  takeOverWriter: object(takeover),
  importRequirements: object({ ...write, documentRef: text, contentFingerprint: hash }),
  answerQuestion: object({ ...write, questionId: text, answer: text, basis: list(anchor) }),
  stageChange: object({ ...write, operation, basis: list(anchor) }),
  buildAndCheck: object({ ...draftWrite, requestedKinds: list(kind), ruleIds: list(text), inputs: isBuildInputs }),
  getJob: object({ ...project, jobId: text }),
  cancelJob: object({ ...draftWrite, jobId: text }),
  retryStep: object({ ...draftWrite, jobId: text, kind, expectedAttempt: positive }),
  getArtifacts: object({ ...project, revision: text }),
  locateEvidence: object({
    ...project, revision: text,
    target: either(object({ requirementId: text }), either(object({ object: isObjectRef }), object({ annotationId: text }))),
  }),
  issueConfirmation: object({ ...draftWrite, ...preview }),
  commitApprovedDraft: object({ ...draftWrite, ...preview, confirmationToken: text }),
  exportRevision: object({ ...project, revision: text, format, destinationRef: text }),
}

export const projectAgentResults = {
  capabilities: isCapabilities,
  getContext: isProjectAgentSnapshot,
  acquireWriter: writerResult,
  takeOverWriter: writerResult,
  importRequirements: requirementResult,
  answerQuestion: requirementResult,
  stageChange: object({ draftRevision: text, affectedRequirementIds: list(text) }),
  buildAndCheck: isJob,
  getJob: isJob,
  cancelJob: object({ jobId: text, status: oneOf('cancelled') }),
  retryStep: isJob,
  getArtifacts: isArtifactManifest,
  locateEvidence: list(evidence),
  issueConfirmation: object({ confirmationToken: text, expiresAtMs: positive, ...preview }),
  commitApprovedDraft: object({ revision: text, manifestHash: hash }),
  exportRevision: object({ revision: text, format, hash, unit: oneOf('mm'), artifactRef: text }),
}

export type ProjectAgentOperation = keyof typeof projectAgentRequests
export type ProjectAgentRequest<K extends ProjectAgentOperation> = Infer<(typeof projectAgentRequests)[K]>
export type ProjectAgentResult<K extends ProjectAgentOperation> = Infer<(typeof projectAgentResults)[K]>
export type ProjectAgentResponse<K extends ProjectAgentOperation> =
  | { version: typeof PROJECT_AGENT_VERSION; requestId: string; ok: true; result: ProjectAgentResult<K> }
  | { version: typeof PROJECT_AGENT_VERSION; requestId: string; ok: false; error: ProjectAgentError }

export function isProjectAgentResponse<K extends ProjectAgentOperation>(
  operationName: K, value: unknown,
): value is ProjectAgentResponse<K> {
  const success = object({ ...request, ok: oneOf(true), result: projectAgentResults[operationName] as Schema<ProjectAgentResult<K>> })
  const failure = object({ ...request, ok: oneOf(false), error: isProjectAgentError })
  return success(value) || (failure(value) && value.requestId === value.error.requestId)
}
