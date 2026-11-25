import { isProjectAgentSnapshot } from '../../../desktop/shared/project-agent/contracts.ts'
import type { ProjectAgentArtifact, ProjectAgentJob, ProjectAgentSnapshot } from '../../../desktop/shared/project-agent/contracts.ts'
import { hasMatchingBuildArtifacts, startProjectAgentStream } from '../../../desktop/shared/project-agent/events.ts'
export type ViewTab = 'model' | 'drawing'
export type ViewLayout = ViewTab | 'split'
export interface ProjectAgentViewInput {
  readonly synthetic: boolean
  readonly snapshot: ProjectAgentSnapshot
  readonly narrow: boolean
  readonly selectedTab: ViewTab
}
export interface ArtifactSlot {
  readonly artifact: Readonly<ProjectAgentArtifact> | null
  readonly revisionLabel: string | null
  readonly isFallback: boolean
}
export interface ProjectAgentPresentation {
  readonly connectionLabel: string
  readonly authorizationLabel: string
  readonly badge: '模拟' | null
  readonly model: ArtifactSlot
  readonly drawing: ArtifactSlot
  readonly layout: ViewLayout
  readonly sameRevisionReady: boolean
  readonly formalSaveEnabled: false
  readonly formalSaveNote: string
}
const sameInputs = (a: ProjectAgentJob['inputs'], b: ProjectAgentJob['inputs']): boolean =>
  a.inputFingerprint === b.inputFingerprint && a.requirementVersion === b.requirementVersion &&
  a.featureVersion === b.featureVersion && a.kernelVersion === b.kernelVersion && a.rulesVersion === b.rulesVersion
const pickSlot = (
  snapshot: ProjectAgentSnapshot,
  artifacts: readonly ProjectAgentArtifact[],
  job: ProjectAgentJob | null,
  kind: ViewTab,
): ArtifactSlot => {
  const current = artifacts.find((entry) => {
    if (entry.kind !== kind) return false
    if (snapshot.draftRevision === null) return true
    if (job === null || job.status === 'cancelled') return false
    return job.steps.some((s) => s.kind === kind && s.status === 'ready' && s.attempt === entry.attempt)
  })
  if (current) {
    return Object.freeze({
      artifact: Object.freeze({ ...current }),
      revisionLabel: current.draftRevision ?? current.baseRevision,
      isFallback: false,
    })
  }
  const fallback = snapshot.fallbackArtifacts.find((entry) =>
    entry.kind === kind && entry.projectId === snapshot.projectId &&
    entry.draftRevision === null && entry.baseRevision !== null)
  if (fallback) {
    return Object.freeze({ artifact: Object.freeze({ ...fallback }), revisionLabel: fallback.baseRevision, isFallback: true })
  }
  return Object.freeze({ artifact: null, revisionLabel: null, isFallback: false })
}
export function presentProjectAgent(input: ProjectAgentViewInput): ProjectAgentPresentation {
  if (!isProjectAgentSnapshot(input.snapshot)) throw new TypeError('Invalid ProjectAgentSnapshot')
  const { snapshot } = input
  const stream = startProjectAgentStream(snapshot)
  const { activeJob } = stream
  const model = pickSlot(snapshot, stream.artifacts, activeJob, 'model')
  const drawing = pickSlot(snapshot, stream.artifacts, activeJob, 'drawing')
  const manifest = snapshot.currentManifest
  const requiredChecks = manifest ? manifest.checks.filter((c) => c.required) : []
  const sameRevisionReady =
    snapshot.connection.status === 'connected' && snapshot.authorization.authorized &&
    activeJob !== null && activeJob.status === 'complete' && manifest !== null &&
    manifest.projectId === snapshot.projectId && manifest.baseRevision === snapshot.baseRevision &&
    manifest.draftRevision === snapshot.draftRevision &&
    manifest.previewFingerprint !== null && manifest.checkFingerprint !== null &&
    sameInputs(manifest.inputs, activeJob.inputs) &&
    hasMatchingBuildArtifacts(activeJob, stream.artifacts, manifest.objectMapVersion) &&
    requiredChecks.length > 0 &&
    manifest.checks.every((c) => c.inputFingerprint === activeJob.inputs.inputFingerprint) &&
    requiredChecks.every((c) => c.status === 'pass')
  const layout: ViewLayout = input.narrow ? input.selectedTab
    : sameRevisionReady ? 'split' : !model.isFallback && model.artifact !== null ? 'model' : input.selectedTab
  const connectionLabel = snapshot.connection.status === 'connected' ? '已连接'
    : snapshot.connection.status === 'connecting' ? '连接中' : '未连接'
  const authorizationLabel = !snapshot.authorization.authorized ? '未授权'
    : snapshot.authorization.canWrite ? '已授权（可写）' : '已授权（只读）'
  return Object.freeze({
    connectionLabel, authorizationLabel, badge: input.synthetic ? '模拟' : null,
    model, drawing, layout, sameRevisionReady, formalSaveEnabled: false,
    formalSaveNote: '正式保存尚未接入（M0只读预览）',
  })
}
