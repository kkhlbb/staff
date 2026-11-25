import { describe, expect, it } from 'vitest'
import { M0_CAPABILITIES, PROJECT_AGENT_VERSION } from '../../../desktop/shared/project-agent/contracts.ts'
import type { ProjectAgentArtifact, ProjectAgentJob, ProjectAgentManifest, ProjectAgentSnapshot } from '../../../desktop/shared/project-agent/contracts.ts'
import { reduceProjectAgentEvent, startProjectAgentStream } from '../../../desktop/shared/project-agent/events.ts'
import { presentProjectAgent } from './presentation.ts'
const H1 = 'a'.repeat(64)
const H2 = 'b'.repeat(64)
const mkInputs = (fp = H1): ProjectAgentJob['inputs'] => ({
  requirementVersion: 'r1', featureVersion: 'f1', kernelVersion: 'k1', rulesVersion: 'u1', inputFingerprint: fp,
  geometry: {
    unit: 'mm', coordinateSystemId: 'wcs', originMm: [0, 0, 0],
    xAxis: [1, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1], modelingToleranceMm: 0.01, displayDecimals: 3,
  },
})
const mkArtifact = (kind: ProjectAgentArtifact['kind'], o: Partial<ProjectAgentArtifact> = {}): ProjectAgentArtifact => ({
  projectId: 'p1', baseRevision: 'r7', draftRevision: 'd8', jobId: 'j1', artifactId: `a-${kind}`, kind,
  hash: H1, inputFingerprint: H1, objectMapVersion: 'om1', attempt: 1, localRef: `ref/${kind}`,
  unit: kind === 'checks' ? 'q' : 'mm', ...o,
})
const mkCheck = (fp = H1) => ({
  requirementId: 'req1', required: true, ruleId: 'rule1', ruleVersion: '1', inputFingerprint: fp, status: 'pass' as const,
  evidence: { requirementId: 'req1', anchors: [], objects: [], annotationIds: [], inputs: [], threshold: null },
})
const mkJob = (o: Partial<ProjectAgentJob> = {}): ProjectAgentJob => ({
  projectId: 'p1', baseRevision: 'r7', draftRevision: 'd8', jobId: 'j1', inputs: mkInputs(), status: 'complete',
  steps: [
    { kind: 'model', attempt: 1, status: 'ready', retryable: false },
    { kind: 'drawing', attempt: 2, status: 'ready', retryable: false },
    { kind: 'checks', attempt: 3, status: 'ready', retryable: false },
  ], ...o,
})
const mkSnapshot = (o: Partial<ProjectAgentSnapshot> = {}): ProjectAgentSnapshot => ({
  version: PROJECT_AGENT_VERSION, projectId: 'p1', baseRevision: 'r7', draftRevision: 'd8', cursor: 1,
  connection: { status: 'connected', source: 'external', clientName: 'cad' },
  authorization: { authorized: true, canWrite: false },
  writer: { epoch: 0, callerId: null }, selection: null, capabilities: M0_CAPABILITIES, activeJobId: 'j1', jobs: [mkJob()],
  currentManifest: {
    projectId: 'p1', baseRevision: 'r7', draftRevision: 'd8', inputs: mkInputs(),
    artifacts: [mkArtifact('model', { attempt: 1 }), mkArtifact('drawing', { attempt: 2 }), mkArtifact('checks', { attempt: 3 })],
    checks: [mkCheck()], objectMapVersion: 'om1', previewFingerprint: H1, checkFingerprint: H1,
  },
  fallbackArtifacts: [mkArtifact('drawing', { draftRevision: null, jobId: 'j0', artifactId: 'r7-drw' })], ...o,
})
describe('presentProjectAgent', () => {
  it('shows disconnected restored r7 artifacts without sameRevisionReady', () => {
    const snapshot = mkSnapshot({
      draftRevision: null, connection: { status: 'disconnected', source: null },
      authorization: { authorized: false, canWrite: false }, activeJobId: null, jobs: [],
      currentManifest: {
        projectId: 'p1', baseRevision: 'r7', draftRevision: null, inputs: mkInputs(),
        artifacts: [mkArtifact('model', { draftRevision: null, jobId: 'j0' }), mkArtifact('drawing', { draftRevision: null, jobId: 'j0' })],
        checks: [mkCheck()], objectMapVersion: 'om1', previewFingerprint: H1, checkFingerprint: H1,
      },
    })
    const view = presentProjectAgent({ synthetic: false, snapshot, narrow: false, selectedTab: 'drawing' })
    expect(view).toMatchObject({ connectionLabel: '未连接', authorizationLabel: '未授权', sameRevisionReady: false, formalSaveEnabled: false, badge: null })
    expect(view.model).toMatchObject({ revisionLabel: 'r7', isFallback: false })
    expect(view.drawing).toMatchObject({ revisionLabel: 'r7', isFallback: false })
  })
  it('separates connected and unauthorized labels', () => {
    const view = presentProjectAgent({ synthetic: false, snapshot: mkSnapshot({ authorization: { authorized: false, canWrite: false } }), narrow: false, selectedTab: 'model' })
    expect(view).toMatchObject({ connectionLabel: '已连接', authorizationLabel: '未授权', sameRevisionReady: false })
    expect(view.model.artifact?.artifactId).toBe('a-model')
  })
  it('shows d8 model with r7 fallback drawing when drawing step is not ready', () => {
    const job = mkJob({ status: 'running', steps: [{ kind: 'model', attempt: 1, status: 'ready', retryable: false }, { kind: 'drawing', attempt: 2, status: 'running', retryable: true }, { kind: 'checks', attempt: 3, status: 'queued', retryable: true }] })
    const view = presentProjectAgent({ synthetic: false, snapshot: mkSnapshot({ jobs: [job] }), narrow: false, selectedTab: 'drawing' })
    expect(view.model).toMatchObject({ revisionLabel: 'd8', isFallback: false })
    expect(view.drawing).toMatchObject({ revisionLabel: 'r7', isFallback: true })
    expect(view.drawing.artifact?.artifactId).toBe('r7-drw')
    expect(view).toMatchObject({ layout: 'model', sameRevisionReady: false })
  })
  it('keeps cancelled job and late event from advertising current ready artifacts', () => {
    const running = mkSnapshot({ jobs: [mkJob({ status: 'running', steps: [{ kind: 'model', attempt: 1, status: 'running', retryable: true }] })], currentManifest: null })
    const s1 = reduceProjectAgentEvent(startProjectAgentStream(running), { version: PROJECT_AGENT_VERSION, projectId: 'p1', baseRevision: 'r7', draftRevision: 'd8', jobId: 'j1', sequence: 2, type: 'jobCancelled' })
    const s2 = reduceProjectAgentEvent(s1, { version: PROJECT_AGENT_VERSION, projectId: 'p1', baseRevision: 'r7', draftRevision: 'd8', jobId: 'j1', sequence: 3, type: 'artifactReady', artifactId: 'late', kind: 'model', hash: H1, inputFingerprint: H1, objectMapVersion: 'om1', attempt: 1, localRef: 'ref/late', unit: 'mm' })
    expect(s2.activeJob?.status).toBe('cancelled')
    expect(s2.artifacts).toHaveLength(0)
    const view = presentProjectAgent({ synthetic: false, snapshot: mkSnapshot({ jobs: [mkJob({ status: 'cancelled' })] }), narrow: false, selectedTab: 'model' })
    expect(view.model.artifact).toBeNull()
    expect(view.drawing).toMatchObject({ revisionLabel: 'r7', isFallback: true })
    expect(view.sameRevisionReady).toBe(false)
  })
  it('offers split on valid matching manifest while keeping formal save disabled', () => {
    const view = presentProjectAgent({ synthetic: true, snapshot: mkSnapshot(), narrow: false, selectedTab: 'model' })
    expect(view).toMatchObject({ sameRevisionReady: true, layout: 'split', formalSaveEnabled: false })
    expect(view.formalSaveNote).toContain('正式保存')
    expect(M0_CAPABILITIES.persistentWrites).toBe(false)
  })
  it('handles fingerprint, objectMapVersion, and project mismatches', () => {
    const fpView = presentProjectAgent({ synthetic: false, snapshot: mkSnapshot({ jobs: [mkJob({ inputs: mkInputs(H2) })] }), narrow: false, selectedTab: 'model' })
    expect(fpView.sameRevisionReady).toBe(false)
    const base = mkSnapshot()
    if (!base.currentManifest) throw new Error('missing manifest')
    const manifest = base.currentManifest
    const withMap: ProjectAgentManifest = { ...manifest, objectMapVersion: 'om2', draftRevision: manifest.draftRevision }
    const withProject: ProjectAgentManifest = { ...manifest, projectId: 'p2', draftRevision: manifest.draftRevision }
    expect(() => presentProjectAgent({ synthetic: false, snapshot: { ...base, currentManifest: withMap }, narrow: false, selectedTab: 'model' })).toThrow(TypeError)
    expect(() => presentProjectAgent({ synthetic: false, snapshot: { ...base, currentManifest: withProject }, narrow: false, selectedTab: 'model' })).toThrow(TypeError)
  })
  it('retains selectedTab in narrow mode even when sameRevisionReady', () => {
    const view = presentProjectAgent({ synthetic: false, snapshot: mkSnapshot(), narrow: true, selectedTab: 'drawing' })
    expect(view).toMatchObject({ sameRevisionReady: true, layout: 'drawing' })
  })
  it('adds synthetic badge only for synthetic inputs and does not mutate snapshot', () => {
    const snapshot = mkSnapshot()
    const before = JSON.stringify(snapshot)
    const syn = presentProjectAgent({ synthetic: true, snapshot, narrow: false, selectedTab: 'model' })
    const real = presentProjectAgent({ synthetic: false, snapshot, narrow: false, selectedTab: 'model' })
    expect(syn.badge).toBe('模拟')
    expect(real.badge).toBeNull()
    expect(JSON.stringify(snapshot)).toBe(before)
    expect(Object.isFrozen(syn)).toBe(true)
  })
})
