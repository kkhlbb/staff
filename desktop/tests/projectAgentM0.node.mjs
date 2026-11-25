import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  hasMatchingBuildArtifacts, isProjectAgentEvent, isProjectAgentResponse, isProjectAgentSnapshot,
  M0_CAPABILITIES, PROJECT_AGENT_VERSION, projectAgentRequests, qToGeometryMm,
  reduceProjectAgentEvent, resolveObjectRef, startProjectAgentStream,
} from '../shared/project-agent/index.ts'
import {
  checkCommitConfirmation, checkSetFingerprint, checkWrite, checkWriterAcquisition, previewFingerprint,
} from '../main/project-agent/guards.ts'

const version = PROJECT_AGENT_VERSION
const hash = 'a'.repeat(64)
const anotherHash = 'b'.repeat(64)
const scope = { projectId: 'p', baseRevision: 'r7', draftRevision: 'd8' }
const kinds = ['model', 'drawing', 'checks']
const target = { partId: 'plate', featureId: 'right-hole', role: 'axis', revision: 'd8', objectMapVersion: 'v8' }
const inputs = {
  requirementVersion: 'req1', featureVersion: 'feat1', kernelVersion: 'kernel1', rulesVersion: 'rules1',
  inputFingerprint: hash, geometry: {
    unit: 'mm', coordinateSystemId: 'plate', originMm: [0, 0, 0],
    xAxis: [1, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1], modelingToleranceMm: 1e-7, displayDecimals: 4,
  },
}
const job = {
  ...scope, jobId: 'j8', inputs, status: 'complete',
  steps: kinds.map((kind) => ({ kind, attempt: 1, status: 'ready', retryable: false })),
}
const artifacts = kinds.map((kind) => ({
  ...scope, jobId: 'j8', artifactId: kind + '-8', kind, hash, inputFingerprint: hash, objectMapVersion: 'v8',
  attempt: 1, localRef: 'ref-' + kind, unit: kind === 'checks' ? 'q' : 'mm',
}))
const snapshot = {
  version, ...scope, cursor: 100, connection: { status: 'disconnected', source: null },
  authorization: { authorized: false, canWrite: false }, writer: { epoch: 5, callerId: null },
  selection: null, capabilities: M0_CAPABILITIES, activeJobId: 'j8', jobs: [job], currentManifest: null,
  fallbackArtifacts: [],
}
const caller = { projectId: 'p', authorizationRef: 'grant', callerId: 'external', userId: 'user', canWrite: true }
const state = { ...scope, writerEpoch: 5, writer: { callerId: caller.callerId, token: 'lease' } }
const write = {
  version, requestId: 'req', projectId: 'p', authorizationRef: 'grant', writerToken: 'lease',
  writerEpoch: 5, baseRevision: 'r7', expectedDraftRevision: 'd8', idempotencyKey: 'key',
}
const stage = { ...write, operation: { type: 'translateHole', target, axis: 'x', deltaQ: 10_000 }, basis: [] }
const ready = (index, sequence, overrides = {}) => ({
  ...artifacts[index], version, sequence, type: 'artifactReady', ...overrides,
})

test('validates snapshot, response envelopes and disconnected default capabilities', () => {
  assert.equal(isProjectAgentSnapshot(snapshot), true)
  assert.equal(isProjectAgentSnapshot({ ...snapshot, activeJobId: 'missing' }), false)
  assert.equal(isProjectAgentSnapshot({ ...snapshot, connection: { status: 'connected', source: 'external' } }), false)
  assert.equal(Object.values(M0_CAPABILITIES).filter((value) => value === true).length, 0)
  assert.equal(isProjectAgentResponse('getContext', { version, requestId: 'r', ok: true, result: snapshot }), true)
  assert.equal(isProjectAgentResponse('getJob', { version, requestId: 'r', ok: true, result: snapshot }), false)
  assert.equal(isProjectAgentEvent({ ...ready(0, 101), unit: 'q' }), false)
})

test('enforces integer q and a right-handed geometry boundary', () => {
  assert.equal(projectAgentRequests.stageChange(stage), true)
  assert.equal(projectAgentRequests.stageChange({ ...stage, operation: { ...stage.operation, deltaQ: 0.001 } }), false)
  assert.equal(projectAgentRequests.stageChange({ ...stage, operation: { ...stage.operation, code: 'arbitrary' } }), false)
  assert.equal(qToGeometryMm(120_500), 12.05)
  assert.throws(() => qToGeometryMm(Number.MAX_SAFE_INTEGER + 1), RangeError)
  const build = { ...write, inputs, requestedKinds: kinds, ruleIds: [] }
  assert.equal(projectAgentRequests.buildAndCheck(build), true)
  assert.equal(projectAgentRequests.buildAndCheck({
    ...build, inputs: { ...inputs, geometry: { ...inputs.geometry, zAxis: [0, 0, -1] } },
  }), false)
})

test('filters foreign projects, advances history cursor, and deduplicates sequence and artifact replay', () => {
  const initial = startProjectAgentStream(snapshot)
  assert.equal(reduceProjectAgentEvent(initial, ready(0, 101, { projectId: 'other' })), initial)
  const history = reduceProjectAgentEvent(initial, ready(0, 101, { draftRevision: 'd7' }))
  assert.equal(history.cursor, 101)
  assert.equal(history.artifacts.length, 0)
  const visible = reduceProjectAgentEvent(history, ready(0, 102))
  assert.equal(reduceProjectAgentEvent(visible, ready(1, 102)), visible)
  const replay = reduceProjectAgentEvent(visible, ready(0, 103, { hash: anotherHash }))
  assert.deepEqual(replay.artifacts, [artifacts[0]])
})

test('gaps require a fresh snapshot before subsequent events can apply', () => {
  const initial = startProjectAgentStream(snapshot)
  const gap = reduceProjectAgentEvent(initial, ready(0, 102))
  assert.equal(gap.needsSnapshot, true)
  assert.equal(gap.cursor, 100)
  assert.equal(reduceProjectAgentEvent(gap, ready(0, 101)), gap)
  const resumed = startProjectAgentStream({ ...snapshot, cursor: 102 })
  assert.deepEqual(reduceProjectAgentEvent(resumed, ready(0, 103)).artifacts, [artifacts[0]])
})

test('cancellation seals the job against late status and output', () => {
  const visible = reduceProjectAgentEvent(startProjectAgentStream(snapshot), ready(0, 101))
  const cancelled = reduceProjectAgentEvent(visible, { ...scope, version, sequence: 102, jobId: 'j8', type: 'jobCancelled' })
  const lateJob = reduceProjectAgentEvent(cancelled, { ...scope, version, sequence: 103, jobId: 'j8', type: 'jobChanged', job })
  const late = reduceProjectAgentEvent(lateJob, ready(1, 104))
  assert.equal(late.activeJob.status, 'cancelled')
  assert.equal(late.cursor, 104)
  assert.deepEqual(late.artifacts, [artifacts[0]])
  assert.equal(hasMatchingBuildArtifacts(late.activeJob, artifacts, 'v8'), false)
})

test('ready requires matching input fingerprints, attempt and object map across all artifacts', () => {
  assert.equal(hasMatchingBuildArtifacts(job, artifacts, 'v8'), true)
  for (const override of [{ inputFingerprint: anotherHash }, { attempt: 2 }, { objectMapVersion: 'v7' }]) {
    assert.equal(hasMatchingBuildArtifacts(job, [artifacts[0], artifacts[1], { ...artifacts[2], ...override }], 'v8'), false)
  }
})

test('a retried step discards previous attempts without discarding other ready steps', () => {
  const first = reduceProjectAgentEvent(startProjectAgentStream(snapshot), ready(0, 101))
  const both = reduceProjectAgentEvent(first, ready(1, 102))
  const revisedJob = { ...job, status: 'running', steps: job.steps.map((step) =>
    step.kind === 'drawing' ? { ...step, status: 'running', attempt: 2 } : step) }
  const retry = reduceProjectAgentEvent(both, { ...scope, version, sequence: 103, jobId: 'j8', type: 'jobChanged', job: revisedJob })
  const old = reduceProjectAgentEvent(retry, ready(1, 104))
  assert.deepEqual(old.artifacts, [artifacts[0]])
  const newDrawing = reduceProjectAgentEvent(old, ready(1, 105, { attempt: 2 }))
  assert.equal(newDrawing.artifacts[1].attempt, 2)
})

test('stable object roles resolve only on the current mapped revision', () => {
  const next = { ...target, revision: 'd9', objectMapVersion: 'v9' }
  assert.deepEqual(resolveObjectRef(target, 'd9', 'v9', [next]), { status: 'resolved', object: next })
  assert.equal(resolveObjectRef(target, 'd9', 'v9', [{ ...next, featureId: 'new-hole' }]).status, 'stale')
  assert.equal(resolveObjectRef(target, 'd9', 'v9', [next, next]).status, 'ambiguous')
})

test('takeover uses epoch CAS and revokes queued writes by the old writer', () => {
  const acquisition = { version, requestId: 'r', projectId: 'p', authorizationRef: 'grant', expectedWriterEpoch: 5 }
  assert.deepEqual(checkWriterAcquisition('acquireWriter', acquisition, state, caller), { ok: false, code: 'WRITER_HELD' })
  assert.deepEqual(checkWriterAcquisition('takeOverWriter', acquisition, state, caller), { ok: true, nextEpoch: 6 })
  const next = { ...state, writerEpoch: 6, writer: { callerId: 'internal', token: 'new' } }
  assert.deepEqual(checkWriterAcquisition('takeOverWriter', acquisition, next, caller), { ok: false, code: 'WRITER_HELD' })
  assert.deepEqual(checkWrite('stageChange', stage, next, caller, () => assert.fail()), { status: 'rejected', code: 'WRITER_REVOKED' })
  assert.deepEqual(checkWrite('stageChange', stage, state, { ...caller, canWrite: false }, () => assert.fail()), { status: 'rejected', code: 'AUTH_REQUIRED' })
})

test('two-level CAS, lost-reply idempotency replay and payload conflict', () => {
  const permit = checkWrite('stageChange', stage, state, caller, () => undefined)
  assert.equal(permit.status, 'proceed')
  const result = { draftRevision: 'd9', affectedRequirementIds: [] }
  const lookup = (scope) => scope === permit.scope ? { scope, digest: permit.digest, result } : undefined
  const advanced = { ...state, draftRevision: 'd9' }
  assert.deepEqual(checkWrite('stageChange', { ...stage, requestId: 'retry' }, advanced, caller, lookup), { status: 'replay', result })
  const changed = { ...stage, operation: { ...stage.operation, deltaQ: 20_000 } }
  assert.deepEqual(checkWrite('stageChange', changed, advanced, caller, lookup), { status: 'rejected', code: 'IDEMPOTENCY_CONFLICT' })
  for (const stale of [advanced, { ...state, baseRevision: 'r8' }]) {
    assert.deepEqual(checkWrite('stageChange', stage, stale, caller, () => undefined), { status: 'rejected', code: 'STALE_BASE' })
  }
  assert.equal(checkWrite('stageChange', { ...stage, expectedDraftRevision: null }, { ...state, draftRevision: null }, caller, () => undefined).status, 'proceed')
})

function approval(status = 'pass') {
  const requirementId = 'R1'
  const manifest = {
    ...scope, inputs, artifacts, objectMapVersion: 'v8',
    checks: [{
      requirementId, required: true, ruleId: 'rule', ruleVersion: '1', inputFingerprint: hash, status,
      evidence: { requirementId, anchors: [], objects: [target], annotationIds: [], inputs: [], threshold: null },
    }],
  }
  manifest.checkFingerprint = checkSetFingerprint(manifest)
  manifest.previewFingerprint = previewFingerprint(manifest)
  const fingerprints = { checkFingerprint: manifest.checkFingerprint, previewFingerprint: manifest.previewFingerprint }
  return {
    manifest, request: { ...write, ...fingerprints, confirmationToken: 'preview-token' },
    token: { ...scope, userId: caller.userId, writerEpoch: 5, ...fingerprints, token: 'preview-token', expiresAtMs: 1000, consumed: false },
  }
}

test('commit confirms current preview and recomputes the check fingerprint', () => {
  const { request, token, manifest } = approval()
  const verify = (confirmation, now, candidate = manifest) =>
    checkCommitConfirmation(request, confirmation, caller.userId, now, candidate, job, ['R1'])
  assert.equal(verify(token, 999), null)
  assert.equal(verify(token, 1000), 'STALE_CONFIRMATION')
  for (const change of [{ consumed: true }, { writerEpoch: 4 }, { userId: 'other' }, { draftRevision: 'd7' }, { checkFingerprint: anotherHash }]) {
    assert.equal(verify({ ...token, ...change }, 10), 'STALE_CONFIRMATION')
  }
  assert.equal(verify(token, 10, { ...manifest, artifacts: [{ ...artifacts[0], hash: anotherHash }, ...artifacts.slice(1)] }), 'STALE_CONFIRMATION')
  assert.equal(verify(token, 10, { ...manifest, checks: [{ ...manifest.checks[0], ruleVersion: '2' }] }), 'STALE_CONFIRMATION')
})

test('required checks must be present and passed even with a correctly bound confirmation', () => {
  for (const status of ['fail', 'needsClarification', 'uncovered', 'executionFailed']) {
    const { request, token, manifest } = approval(status)
    assert.equal(checkCommitConfirmation(request, token, caller.userId, 10, manifest, job, ['R1']), 'CHECK_BLOCKED')
  }
  const { request, token, manifest } = approval()
  assert.equal(checkCommitConfirmation(request, token, caller.userId, 10, manifest, job, ['missing']), 'CHECK_BLOCKED')
})

test('a drawing failure preserves the ready model and a formal fallback remains distinguishable', () => {
  const failed = { ...job, status: 'failed', steps: job.steps.map((step) =>
    step.kind === 'drawing' ? { ...step, status: 'failed', retryable: true } : step) }
  const oldDrawing = { ...artifacts[1], draftRevision: null, artifactId: 'drawing-r7' }
  const manifest = {
    ...scope, inputs, artifacts: [artifacts[0]], checks: [], objectMapVersion: 'v8',
    previewFingerprint: null, checkFingerprint: null,
  }
  const partial = { ...snapshot, jobs: [failed], currentManifest: manifest, fallbackArtifacts: [oldDrawing] }
  assert.equal(isProjectAgentSnapshot(partial), true)
  const stream = startProjectAgentStream(partial)
  assert.deepEqual(stream.artifacts, [artifacts[0]])
  assert.deepEqual(stream.snapshot.fallbackArtifacts, [oldDrawing])
  assert.deepEqual(reduceProjectAgentEvent(stream, ready(1, 101)).artifacts, [artifacts[0]])
})

test('check and preview fingerprints are independent of check and artifact list order', () => {
  const { manifest } = approval()
  const second = { ...manifest.checks[0], requirementId: 'R2',
    evidence: { ...manifest.checks[0].evidence, requirementId: 'R2' } }
  const firstOrder = { ...manifest, checks: [...manifest.checks, second] }
  const secondOrder = { ...firstOrder, checks: [...firstOrder.checks].reverse(), artifacts: [...manifest.artifacts].reverse() }
  assert.equal(checkSetFingerprint(firstOrder), checkSetFingerprint(secondOrder))
  assert.equal(previewFingerprint(firstOrder), previewFingerprint(secondOrder))
})

test('idempotency receipts do not cross authenticated users that reuse a caller ID', () => {
  const permit = checkWrite('stageChange', stage, state, caller, () => undefined)
  assert.equal(permit.status, 'proceed')
  const receipt = { scope: permit.scope, digest: permit.digest, result: { draftRevision: 'd9', affectedRequirementIds: [] } }
  const advanced = { ...state, draftRevision: 'd9' }
  const other = { ...caller, userId: 'other-user' }
  const lookup = (key) => key === permit.scope ? receipt : undefined
  assert.deepEqual(checkWrite('stageChange', stage, advanced, other, lookup), { status: 'rejected', code: 'STALE_BASE' })
})

const changedJob = (sequence, update) => ({
  ...scope, version, sequence, jobId: 'j8', type: 'jobChanged', job: update,
})
const geometryChange = (geometry) => ({ ...inputs, geometry: { ...inputs.geometry, ...geometry } })

for (const [name, changedInputs] of [
  ['origin', geometryChange({ originMm: [0, 0, 1] })],
  ['rotated axes', geometryChange({ yAxis: [0, 0, 1], zAxis: [0, -1, 0] })],
  ['coordinate system', geometryChange({ coordinateSystemId: 'assembly' })],
  ['modeling tolerance', geometryChange({ modelingToleranceMm: 1e-8 })],
  ['display precision', geometryChange({ displayDecimals: 5 })],
  ['requirement revision', { ...inputs, requirementVersion: 'req2' }],
  ['feature revision', { ...inputs, featureVersion: 'feat2' }],
  ['kernel revision', { ...inputs, kernelVersion: 'kernel2' }],
  ['rules revision', { ...inputs, rulesVersion: 'rules2' }],
  ['fingerprint', { ...inputs, inputFingerprint: anotherHash }],
]) {
  test(`same-job ${name} change quarantines old artifacts and requires a snapshot`, () => {
    let visible = startProjectAgentStream(snapshot)
    for (const index of artifacts.keys()) visible = reduceProjectAgentEvent(visible, ready(index, 101 + index))
    assert.equal(hasMatchingBuildArtifacts(visible.activeJob, visible.artifacts, 'v8'), true)
    const event = changedJob(104, { ...job, inputs: changedInputs })
    assert.equal(isProjectAgentEvent(event), true)
    const next = reduceProjectAgentEvent(visible, event)
    assert.deepEqual(next.activeJob.inputs, inputs)
    assert.equal(next.cursor, 103)
    assert.equal(next.needsSnapshot, true)
    assert.deepEqual(next.artifacts, [])
    assert.equal(hasMatchingBuildArtifacts(next.activeJob, next.artifacts, 'v8'), false)
    assert.equal(reduceProjectAgentEvent(next, ready(0, 105)), next)
  })
}

test('snapshot recovery checks complete manifest inputs and resumes from the new cursor', () => {
  const { manifest } = approval()
  const changed = { ...job, inputs: geometryChange({ originMm: [0, 0, 1] }) }
  const inconsistent = { ...snapshot, cursor: 104, jobs: [changed], currentManifest: manifest }
  assert.equal(isProjectAgentSnapshot(inconsistent), true)
  const blocked = startProjectAgentStream(inconsistent)
  assert.equal(blocked.needsSnapshot, true)
  assert.deepEqual(blocked.artifacts, [])
  assert.equal(reduceProjectAgentEvent(blocked, ready(0, 105)), blocked)

  const replacement = { ...changed, jobId: 'j9' }
  const resumed = startProjectAgentStream({ ...inconsistent, cursor: 106, jobs: [replacement], activeJobId: 'j9' })
  assert.equal(resumed.needsSnapshot, false)
  assert.deepEqual(resumed.artifacts, [])
  assert.equal(reduceProjectAgentEvent(resumed, ready(0, 106, { jobId: 'j9' })), resumed)
  const historical = reduceProjectAgentEvent(resumed, changedJob(107, changed))
  assert.equal(historical.cursor, 107)
  assert.equal(historical.activeJob, replacement)
  assert.equal(historical.needsSnapshot, false)
  const oldArtifact = reduceProjectAgentEvent(historical, ready(0, 108))
  assert.deepEqual(oldArtifact.artifacts, [])
  const current = reduceProjectAgentEvent(oldArtifact, ready(0, 109, { jobId: 'j9' }))
  assert.equal(current.artifacts[0].jobId, 'j9')
})

test('object field and step reordering preserve bindings while units remain validated', () => {
  const reverse = (value) => Object.fromEntries(Object.entries(value).reverse())
  const reordered = reverse({ ...inputs, geometry: reverse({ ...inputs.geometry, originMm: [-0, 0, 0] }) })
  const { manifest } = approval()
  const initial = startProjectAgentStream({ ...snapshot, currentManifest: { ...manifest, inputs: reordered } })
  assert.deepEqual(initial.artifacts, artifacts)
  const updatedJob = { ...job, inputs: reordered, steps: [...job.steps].reverse() }
  const updated = reduceProjectAgentEvent(initial, changedJob(101, updatedJob))
  assert.equal(updated.activeJob, updatedJob)
  assert.equal(updated.cursor, 101)
  assert.equal(updated.needsSnapshot, false)
  assert.deepEqual(updated.artifacts, artifacts)
  const invalidUnit = changedJob(102, { ...job, inputs: geometryChange({ unit: 'inch' }) })
  assert.equal(isProjectAgentEvent(invalidUnit), false)
  assert.equal(reduceProjectAgentEvent(updated, invalidUnit), updated)
})

test('interleaved historical status and output cannot regress per-kind retries', () => {
  const { manifest } = approval()
  const withAttempts = (drawing, checks) => ({
    ...job, status: 'running', steps: [job.steps[0],
      { ...job.steps[1], attempt: drawing, status: 'running' },
      { ...job.steps[2], attempt: checks, status: 'running' }],
  })
  const initial = startProjectAgentStream({ ...snapshot, currentManifest: manifest })
  const retried = reduceProjectAgentEvent(initial, changedJob(101, withAttempts(3, 2)))
  assert.deepEqual(retried.artifacts, [artifacts[0]])
  const stale = reduceProjectAgentEvent(retried, changedJob(102, withAttempts(2, 3)))
  assert.equal(stale.activeJob, retried.activeJob)
  const current = reduceProjectAgentEvent(stale, changedJob(103, withAttempts(3, 3)))
  const late = reduceProjectAgentEvent(current, ready(2, 104, { attempt: 2 }))
  assert.deepEqual(late.artifacts, [artifacts[0]])
  const drawing = reduceProjectAgentEvent(late, ready(1, 105, { attempt: 3 }))
  const sameAttemptHistory = withAttempts(3, 3)
  sameAttemptHistory.steps[0] = { ...job.steps[0], status: 'running' }
  const history = reduceProjectAgentEvent(drawing, changedJob(106, sameAttemptHistory))
  assert.equal(history.activeJob, drawing.activeJob)
  assert.deepEqual(history.artifacts, drawing.artifacts)
  assert.equal(history.cursor, 106)
})
