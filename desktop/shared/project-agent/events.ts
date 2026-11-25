import { isProjectAgentEvent } from './contracts.ts'
import type { ProjectAgentArtifact, ProjectAgentJob, ProjectAgentSnapshot } from './contracts.ts'

// Validated inputs contain JSON values. Object key order is immaterial, while
// vector components are positional and compared without a numeric tolerance.
function sameInputValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameInputValue(value, right[index]))
  }
  if (left === null || right === null || typeof left !== 'object' ||
      typeof right !== 'object' || Array.isArray(right)) return false
  const fields = right as Record<string, unknown>
  const entries = Object.entries(left)
  return entries.length === Object.keys(fields).length &&
    entries.every(([key, value]) => Object.hasOwn(fields, key) && sameInputValue(value, fields[key]))
}

function isCurrentStep(previous: ProjectAgentJob['steps'][number], next: ProjectAgentJob['steps'][number]): boolean {
  if (next.attempt !== previous.attempt) return next.attempt > previous.attempt
  if (previous.status === next.status || previous.status === 'queued') return true
  return previous.status === 'running' && next.status !== 'queued'
}

export function canPublishArtifact(job: ProjectAgentJob, artifact: ProjectAgentArtifact): boolean {
  if (job.status === 'cancelled' ||
      job.projectId !== artifact.projectId || job.baseRevision !== artifact.baseRevision ||
      job.draftRevision !== artifact.draftRevision || job.jobId !== artifact.jobId ||
      job.inputs.inputFingerprint !== artifact.inputFingerprint) return false
  const step = job.steps.find((entry) => entry.kind === artifact.kind)
  return step?.attempt === artifact.attempt && (step.status === 'ready' || (step.status === 'running' && job.status === 'running'))
}

export interface ProjectAgentStream {
  snapshot: ProjectAgentSnapshot
  cursor: number
  activeJob: ProjectAgentJob | null
  artifacts: ProjectAgentArtifact[]
  needsSnapshot: boolean
}

export function startProjectAgentStream(snapshot: ProjectAgentSnapshot): ProjectAgentStream {
  const activeJob = snapshot.jobs.find((job) => job.jobId === snapshot.activeJobId) ?? null
  const manifest = snapshot.currentManifest
  const inputsMatch = activeJob !== null && manifest !== null && sameInputValue(activeJob.inputs, manifest.inputs)
  const conflictingManifest = !inputsMatch && activeJob !== null &&
    (manifest?.artifacts.some((artifact) => artifact.jobId === activeJob.jobId) ?? false)
  return {
    snapshot, cursor: snapshot.cursor, activeJob, needsSnapshot: conflictingManifest,
    artifacts: (manifest?.artifacts ?? []).filter((artifact) =>
      snapshot.draftRevision === null ||
      (inputsMatch && canPublishArtifact(activeJob, artifact))),
  }
}

export function reduceProjectAgentEvent(state: ProjectAgentStream, raw: unknown): ProjectAgentStream {
  if (state.needsSnapshot || !isProjectAgentEvent(raw)) return state
  const event = raw
  const { snapshot, activeJob } = state
  if (event.projectId !== snapshot.projectId || event.sequence <= state.cursor) return state
  if (event.sequence !== state.cursor + 1) return { ...state, needsSnapshot: true }

  const next = { ...state, cursor: event.sequence }
  if (event.type === 'contextChanged') return { ...next, needsSnapshot: true }
  if (event.baseRevision !== snapshot.baseRevision || event.draftRevision !== snapshot.draftRevision ||
      activeJob === null || event.jobId !== activeJob.jobId || activeJob.status === 'cancelled') return next

  if (event.type === 'jobChanged' && !sameInputValue(activeJob.inputs, event.job.inputs)) {
    return { ...state, artifacts: [], needsSnapshot: true }
  }
  if (event.type === 'jobCancelled' || (event.type === 'jobChanged' && event.job.status === 'cancelled')) {
    return { ...next, activeJob: { ...activeJob, status: 'cancelled' } }
  }
  if (event.type === 'jobChanged') {
    const updated = event.job
    // A historical job reply is one observation; don't merge its aggregate status
    // or other steps when any previously observed step has regressed.
    if (activeJob.steps.some((step) => !updated.steps.some((candidate) =>
      candidate.kind === step.kind && isCurrentStep(step, candidate)))) return next
    return {
      ...next, activeJob: updated,
      artifacts: state.artifacts.filter((artifact) => canPublishArtifact(updated, artifact)),
    }
  }

  const { artifactId, kind, hash, inputFingerprint, objectMapVersion, attempt, localRef, unit,
    projectId, baseRevision, draftRevision, jobId } = event
  const artifact = { artifactId, kind, hash, inputFingerprint, objectMapVersion, attempt, localRef, unit,
    projectId, baseRevision, draftRevision, jobId }
  if (!canPublishArtifact(activeJob, artifact)) return next
  if (state.artifacts.some((existing) => existing.kind === kind && existing.attempt === attempt)) return next
  return { ...next, artifacts: [...state.artifacts.filter((existing) => existing.kind !== kind), artifact] }
}

export function hasMatchingBuildArtifacts(
  job: ProjectAgentJob, artifacts: readonly ProjectAgentArtifact[], objectMapVersion: string,
): boolean {
  return job.status === 'complete' && artifacts.length === 3 &&
    (['model', 'drawing', 'checks'] as const).every((kind) =>
      job.steps.some((step) => step.kind === kind && step.status === 'ready') &&
      artifacts.some((artifact) => artifact.kind === kind &&
        artifact.unit === (kind === 'checks' ? 'q' : 'mm') &&
        artifact.objectMapVersion === objectMapVersion && canPublishArtifact(job, artifact)))
}
