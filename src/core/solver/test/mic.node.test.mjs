import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import {
  MicValidationError,
  buildMicDisplacementField,
  evaluateMicBatch,
  parseAndValidateMicMatrix,
  prepareMicAttachment,
} from '../mic.mjs'

const fixtureUrl = new URL('./fixtures/sample-mic-matrix.json', import.meta.url)
const fixtureText = readFileSync(fixtureUrl, 'utf8')
const fixturePayload = JSON.parse(fixtureText)

const near = (actual, expected, epsilon = 1e-12) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} ≈ ${expected} (tol ${epsilon})`)

test('parseAndValidateMicMatrix accepts object, JSON string, and UTF-8 bytes from sample fixture', () => {
  const fromObj = parseAndValidateMicMatrix(fixturePayload)
  const fromStr = parseAndValidateMicMatrix(fixtureText)
  const fromBytes = parseAndValidateMicMatrix(new TextEncoder().encode(fixtureText))

  assert.equal(fromObj.rows, 16)
  assert.equal(fromObj.cols, 6)
  assert.equal(fromObj.matrix.length, 96)
  assert.equal(fromObj.payload.partId, 'cover-plate-al6061')
  assert.deepEqual(fromStr.payload, fromObj.payload)
  assert.deepEqual(fromBytes.payload, fromObj.payload)
  near(fromObj.matrix[0], 0.0018)
  near(fromObj.matrix[5 * 6 + 4], 0.0024)
})

test('parseAndValidateMicMatrix rejects dimension mismatches, NaN/Infinity, and invalid schema fields', () => {
  const base = {
    schemaVersion: 1,
    partId: 'plate-a',
    units: 'mm',
    forceUnits: 'N',
    controlPointsMm: [[0, 0, 0], [10, 0, 0]],
    measurePointsMm: [[5, 5, 0], [15, 5, 0], [25, 5, 0]],
    sensitivityMatrix: [
      [0.1, 0.2],
      [0.3, 0.4],
      [0.5, 0.6],
    ],
  }
  assert.equal(parseAndValidateMicMatrix(base).rows, 3)

  const invalidCases = [
    null,
    'not-json{',
    [],
    { ...base, schemaVersion: 2 },
    { ...base, partId: '' },
    { ...base, units: 'cm' },
    { ...base, forceUnits: 'kN' },
    { ...base, unexpectedKey: true },
    { ...base, controlPointsMm: [[0, 0]] },
    { ...base, controlPointsMm: [[0, Number.NaN, 0], [10, 0, 0]] },
    { ...base, measurePointsMm: [[5, Number.POSITIVE_INFINITY, 0], [15, 5, 0], [25, 5, 0]] },
    // Row count mismatch (2 rows instead of 3)
    { ...base, sensitivityMatrix: [[0.1, 0.2], [0.3, 0.4]] },
    // Column count mismatch (3 cols instead of 2)
    { ...base, sensitivityMatrix: [[0.1, 0.2], [0.3, 0.4, 0.5], [0.5, 0.6]] },
    // Non-finite and non-numeric matrix entries
    { ...base, sensitivityMatrix: [[Number.NaN, 0.2], [0.3, 0.4], [0.5, 0.6]] },
    { ...base, sensitivityMatrix: [[0.1, Number.NEGATIVE_INFINITY], [0.3, 0.4], [0.5, 0.6]] },
    { ...base, sensitivityMatrix: [[0.1, '0.2'], [0.3, 0.4], [0.5, 0.6]] },
    // Invalid sourceMeta
    { ...base, sourceMeta: { solverName: '' } },
    { ...base, sourceMeta: { solverName: 'ccx', meshNodes: -5 } },
    { ...base, sourceMeta: { solverName: 'ccx', meshNodes: 12.5 } },
    { ...base, sourceMeta: { solverName: 'ccx', generatedAtIso: 'not-a-date' } },
    { ...base, sourceMeta: { solverName: 'ccx', extra: 1 } },
  ]

  for (const invalid of invalidCases) {
    assert.throws(
      () => parseAndValidateMicMatrix(invalid),
      err => err instanceof MicValidationError,
      `expected rejection for ${JSON.stringify(invalid)}`,
    )
  }
})

test('evaluateMicBatch matches analytical Δu = [S]·(Δv_0 + Δv_i + Δv_ext) and computes exact stats', () => {
  const mic = parseAndValidateMicMatrix({
    schemaVersion: 1,
    partId: 'bracket-1',
    units: 'mm',
    forceUnits: 'N',
    controlPointsMm: [[0, 0, 0], [10, 0, 0], [20, 0, 0]],
    measurePointsMm: [[5, 0, 0], [15, 0, 0]],
    sensitivityMatrix: [
      [1.0, 2.0, -0.5],
      [-0.25, 0.5, 1.5],
    ],
  })

  // Two samples: v0 = [2, 4, 6], v1 = [-2, 0, 2]
  // initialWarpVector = [1, -1, 0]
  // broadcast externalLoad = [0, 2, 0]
  // Combined effective vectors:
  //   sample 0: [3, 5, 6]   -> u0 = [1*3 + 2*5 - 0.5*6, -0.25*3 + 0.5*5 + 1.5*6] = [10, 10.75]
  //   sample 1: [-1, 1, 2]  -> u1 = [1*(-1) + 2*1 - 0.5*2, -0.25*(-1) + 0.5*1 + 1.5*2] = [0, 3.75]
  const loadBatch = new Float64Array([2, 4, 6, -2, 0, 2])
  const result = evaluateMicBatch(mic, loadBatch, {
    initialWarpVector: [1, -1, 0],
    externalLoadVectors: [0, 2, 0],
    computeStats: true,
  })

  assert.equal(result.partId, 'bracket-1')
  assert.equal(result.sampleCount, 2)
  assert.equal(result.measureCount, 2)
  assert.equal(result.controlCount, 3)

  near(result.displacements[0], 10.0)
  near(result.displacements[1], 10.75)
  near(result.displacements[2], 0.0)
  near(result.displacements[3], 3.75)

  // Stats check: row 0 has [10, 0] -> mean=5, stdDev=5, min=0, max=10
  // row 1 has [10.75, 3.75] -> mean=7.25, stdDev=3.5, min=3.75, max=10.75
  near(result.stats.mean[0], 5.0)
  near(result.stats.stdDev[0], 5.0)
  near(result.stats.min[0], 0.0)
  near(result.stats.max[0], 10.0)
  near(result.stats.mean[1], 7.25)
  near(result.stats.stdDev[1], 3.5)
  near(result.stats.min[1], 3.75)
  near(result.stats.max[1], 10.75)

  // Per-sample externalLoadVectors batch check
  const batchExt = evaluateMicBatch(mic, [[1, 0, 0], [0, 1, 0]], {
    externalLoadVectors: [[0, 1, 0], [0, 0, 1]],
  })
  near(batchExt.displacements[0], 3.0) // [1,1,0] -> 1 + 2 = 3
  near(batchExt.displacements[1], 0.25) // -0.25 + 0.5 = 0.25
  near(batchExt.displacements[2], 1.5) // [0,1,1] -> 2 - 0.5 = 1.5
  near(batchExt.displacements[3], 2.0) // 0.5 + 1.5 = 2.0
})

test('buildMicDisplacementField produces frozen PartDisplacementField for scalar and 3D vectors', () => {
  const mic = parseAndValidateMicMatrix({
    schemaVersion: 1,
    partId: 'cover-1',
    units: 'mm',
    forceUnits: 'N',
    controlPointsMm: [[0, 0, 0]],
    measurePointsMm: [[10, 20, 0], [30, 40, 0], [50, 60, 0]],
    sensitivityMatrix: [[0.1], [0.2], [0.3]],
  })

  // Scalar vector along custom non-unit direction [0, 3, 4] -> normalized [0, 0.6, 0.8]
  const field = buildMicDisplacementField(mic, [-0.5, 0.25, 1.0], { direction: [0, 3, 4] })
  assert.equal(field.partId, 'cover-1')
  near(field.minDisplacementMm, 0.25)
  near(field.maxDisplacementMm, 1.0)
  assert.equal(field.samples.length, 3)
  assert.deepEqual(field.samples[0].posMm, [10, 20, 0])
  near(field.samples[0].dispMm[0], 0)
  near(field.samples[0].dispMm[1], -0.3)
  near(field.samples[0].dispMm[2], -0.4)
  near(field.samples[0].magMm, 0.5)
  assert.ok(Object.isFrozen(field))
  assert.ok(Object.isFrozen(field.samples))
  assert.ok(Object.isFrozen(field.samples[0]))
  assert.ok(Object.isFrozen(field.samples[0].dispMm))

  // Explicit 3D vector (length m * 3)
  const field3d = buildMicDisplacementField(mic, [3, 4, 0, 0, 0, -2, 0, 0, 0])
  near(field3d.maxDisplacementMm, 5)
  near(field3d.minDisplacementMm, 0)
  near(field3d.samples[0].magMm, 5)
  near(field3d.samples[1].magMm, 2)
  near(field3d.samples[2].magMm, 0)
})

test('prepareMicAttachment canonicalizes bytes, computes SHA-256, and preserves EvidenceRef provenance', async () => {
  const evidence = [
    {
      kind: 'user-attestation',
      actorId: 'fea-engineer-1',
      at: '2026-11-26T00:00:00Z',
      sessionSeq: 1,
      sessionLabel: 'CalculiX unit-load export',
      statement: 'Exported from CalculiX 2.21 static unit-load deck (4820 C3D10 nodes)',
      fieldPath: '/micMatrixRef',
    },
  ]

  // Re-order keys to verify deterministic canonicalization produces identical SHA-256
  const reordered = {
    sourceMeta: {
      generatedAtIso: fixturePayload.sourceMeta.generatedAtIso,
      meshNodes: fixturePayload.sourceMeta.meshNodes,
      solverName: fixturePayload.sourceMeta.solverName,
    },
    sensitivityMatrix: fixturePayload.sensitivityMatrix,
    measurePointsMm: fixturePayload.measurePointsMm,
    controlPointsMm: fixturePayload.controlPointsMm,
    forceUnits: fixturePayload.forceUnits,
    units: fixturePayload.units,
    partId: fixturePayload.partId,
    schemaVersion: fixturePayload.schemaVersion,
  }

  const a = await prepareMicAttachment(fixturePayload, {
    attachmentId: 'mic-cover-1',
    blobKey: 'mic-cover-blob',
    fileName: 'cover-plate-mic.json',
    evidence,
  })
  const b = await prepareMicAttachment(reordered, {
    attachmentId: 'mic-cover-1',
    blobKey: 'mic-cover-blob',
    fileName: 'cover-plate-mic.json',
    evidence,
  })

  const expectedSha = createHash('sha256').update(a.bytes).digest('hex')
  assert.equal(a.sha256, expectedSha)
  assert.match(a.sha256, /^[0-9a-f]{64}$/)
  assert.equal(a.sha256, b.sha256)
  assert.deepEqual(a.bytes, b.bytes)

  assert.equal(a.micMatrixRef, 'mic-cover-1')
  assert.deepEqual(a.attachment, {
    kind: 'mic-matrix',
    revisionId: 'mic-cover-1',
    blobKey: 'mic-cover-blob',
    path: 'attachments/mic-cover-blob.bin',
    sha256: expectedSha,
    byteSize: a.bytes.byteLength,
  })
  assert.deepEqual(a.record, {
    id: 'mic-cover-1',
    blobKey: 'mic-cover-blob',
    fileName: 'cover-plate-mic.json',
  })
  assert.deepEqual(a.evidence, evidence)
  assert.deepEqual(a.summary, {
    partId: 'cover-plate-al6061',
    controlPointCount: 6,
    measurePointCount: 16,
    solverName: 'CalculiX 2.21',
    meshNodes: 4820,
    generatedAtIso: '2026-11-26T00:00:00Z',
  })
})

test('benchmark: 50,000-sample MIC evaluation completes in sub-second (< 500ms)', t => {
  const mic = parseAndValidateMicMatrix(fixturePayload)
  const sampleCount = 50_000
  const cols = mic.cols
  const loads = new Float64Array(sampleCount * cols)

  // Deterministic pseudo-random load perturbations in [-20N, +20N]
  let state = 0x12345678
  for (let i = 0; i < loads.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    loads[i] = ((state / 0xffffffff) - 0.5) * 40
  }
  const initialWarp = new Float64Array([50, 50, 50, 50, -15, -10])
  const out = new Float64Array(sampleCount * mic.rows)

  // Warm up JIT once with a tiny slice
  evaluateMicBatch(mic, loads.subarray(0, cols * 100), { initialWarpVector: initialWarp })

  const t0 = performance.now()
  const result = evaluateMicBatch(mic, loads, {
    initialWarpVector: initialWarp,
    out,
  })
  const elapsedMs = performance.now() - t0

  assert.equal(result.sampleCount, sampleCount)
  assert.equal(result.displacements.length, sampleCount * mic.rows)
  assert.ok(Number.isFinite(result.displacements[0]))
  assert.ok(Number.isFinite(result.displacements[result.displacements.length - 1]))
  t.diagnostic(`50,000-sample MIC batch (${mic.rows}x${mic.cols}) elapsed: ${elapsedMs.toFixed(2)} ms`)
  assert.ok(elapsedMs < 500, `Expected 50k MIC batch < 500ms, got ${elapsedMs.toFixed(2)}ms`)
})
