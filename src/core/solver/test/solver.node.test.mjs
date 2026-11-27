import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Matrix4, Vector3 } from 'three'
import { assemblyModelV1Schema } from '../../../project-file/assembly3d.ts'
import { solveAssembly } from '../assemblySolver.mjs'
import { recoverCandidates, suggestMateDrafts } from '../mateDrafts.ts'
import { createSolverScheduler } from '../solverScheduler.mjs'
import { axis, face, fixture, model, part, point, pose } from './fixture.ts'

const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`)
const two = (...features) => model([part('a'), part('b', pose(2, -3, 4))], features)

test('face contact, parallel, axial alignment and distance use distinct DOFs and Matrix4 ordering', () => {
  const tilted = [[1, 0, 0, 2], [0, 0, -1, -3], [0, 1, 0, 4], [0, 0, 0, 1]]
  for (const [kind, expected] of [['face-contact', 3], ['parallel', 4], ['coaxial', 2], ['distance', 5]]) {
    const axial = kind === 'coaxial'
    const assembly = two(
      axial ? axis('left', 'a', [0, 0, 0], [0, 0, 1], 20000) : face('left', 'a', [0, 0, 0], [0, 0, 1]),
      axial ? axis('right', 'b', [0, 0, 0], [0, 0, 1], 20000) : face('right', 'b', [0, 0, 0], [0, 0, -1]),
    )
    assembly.parts[1].nominalTransform = tilted
    assembly.mates.push({ id: 'mate', kind, featureIds: ['left', 'right'], constrainedDofs: [],
      ...(kind === 'distance' ? { distanceQ: -25000 } : {}) })
    const result = solveAssembly({ assembly: assemblyModelV1Schema.parse(assembly) })
    assert.equal(result.status, 'underconstrained')
    assert.equal(result.remainingDof, expected, kind)
    assert.equal(result.remainingDofs.length, expected)
    const matrix = new Matrix4().set(...result.parts[1].nominalTransform.flat())
    const origin = new Vector3().applyMatrix4(matrix)
    const direction = new Vector3(0, 0, 1).transformDirection(matrix)
    if (kind === 'face-contact' || kind === 'parallel') close(direction.z, 1)
    if (kind === 'face-contact') close(origin.z, 0)
    if (kind === 'distance') close(origin.z, -2.5)
    if (kind === 'coaxial') {
      close(Math.abs(direction.z), 1)
      close(Math.hypot(origin.x, origin.y), 0)
    }
  }
})

test('clearance float respects limiting radii and flags impossible intervals', () => {
  const assembly = two(axis('hole', 'a', [0, 0, 0], [0, 0, 1], 22000),
    axis('pin', 'b', [0, 0, 0], [0, 0, 1], 20000))
  const mate = { id: 'clear', kind: 'floating-clearance', featureIds: ['hole', 'pin'], constrainedDofs: [], minQ: 1000, maxQ: 3000 }
  assembly.mates = [mate]
  let result = solveAssembly({ assembly })
  assert.equal(result.remainingDof, 4)
  let radial = Math.hypot(result.parts[1].nominalTransform[0][3], result.parts[1].nominalTransform[1][3])
  assert.ok(radial >= 0.1 - 1e-6 && radial <= 0.2 + 1e-6)
  assembly.parts[1].nominalTransform = pose()
  result = solveAssembly({ assembly })
  radial = Math.hypot(result.parts[1].nominalTransform[0][3], result.parts[1].nominalTransform[1][3])
  close(radial, 0.1)
  mate.minQ = 2500
  result = solveAssembly({ assembly })
  assert.deepEqual(result.conflictMateIds, ['clear'])
  assert.match(result.contradictions[0].reason, /available clearance/)
})

test('six 3-2-1 contacts locate a rigid body and isolate a geometric distance contradiction', () => {
  const assembly = two(
    face('primary', 'a', [0, 0, 0], [0, 0, 1]),
    face('secondary', 'a', [0, 0, 0], [0, 1, 0]),
    face('tertiary', 'a', [0, 0, 0], [1, 0, 0]),
    point('p1', 'b', [0, 0, 0]), point('p2', 'b', [10000, 0, 0]), point('p3', 'b', [0, 10000, 0]),
    point('p4', 'b', [0, 0, 0]), point('p5', 'b', [10000, 0, 0]), point('p6', 'b', [0, 0, 0]),
  )
  assembly.mates.push({ id: 'locator', kind: '3-2-1', constrainedDofs: [],
    contactPairs: [['primary', 'p1'], ['primary', 'p2'], ['primary', 'p3'],
      ['secondary', 'p4'], ['secondary', 'p5'], ['tertiary', 'p6']] })
  let result = solveAssembly({ assembly })
  assert.equal(result.status, 'solved')
  assert.equal(result.remainingDof, 0)
  result.parts[1].nominalTransform.forEach((row, i) => row.forEach((val, j) => close(val, pose()[i][j])))
  assembly.mates.push({ id: 'contradiction', kind: 'distance', featureIds: ['primary', 'p1'], distanceQ: 10000, constrainedDofs: [] })
  result = solveAssembly({ assembly })
  assert.equal(result.status, 'overconstrained')
  assert.deepEqual(result.conflictMateIds, ['locator', 'contradiction'])
  assert.ok(result.contradictions.some(problem => problem.lengthMm > 0.1))
})

test('distinguishes redundant mates from contradictions and retains coupled free motions', () => {
  const assembly = two(
    axis('x', 'a', [0, 0, 0], [1, 0, 0], 5000),
    axis('y', 'b', [0, 0, 0], [1, 0, 0], 10000),
  )
  const mate = { id: 'mate', kind: 'coaxial', featureIds: ['x', 'y'], constrainedDofs: [] }
  assembly.mates = [mate, { ...mate, id: 'repeated' }]
  const result = solveAssembly({ assembly, fixedPartIds: [] })
  assert.equal(result.remainingDof, 8)
  assert.ok(result.remainingDofs.some(mode => new Set(mode.map(item => item.partId)).size > 1))
  assert.deepEqual(result.redundantMateIds, ['repeated'])
  assert.deepEqual(result.conflictMateIds, [])
})

test('topology drafts dedupe and preserve complete source evidence without writes', () => {
  const assembly = model([part('a'), part('b')], [
    face('plane-left', 'a', [0, 0, 0], [0, 0, 1]), face('plane-right', 'b', [0, 0, 0], [0, 0, -1]),
    axis('axis-left', 'a', [0, 0, 0], [0, 0, 1], 9000), axis('axis-right', 'b', [0, 0, 20000], [0, 0, -1], 8000),
  ])
  const evidence = { kind: 'user-attestation', actorId: 'operator', at: '2026-11-25T12:00:00Z',
    sessionSeq: 1, sessionLabel: null, fieldPath: 'feature.plane-left', statement: 'These two surfaces seat together.' }
  const candidates = recoverCandidates(assembly)
  candidates.coplanar.push(['plane-right', 'plane-left'])
  const before = structuredClone(assembly)
  const result = suggestMateDrafts(assembly, candidates, { 'plane-left': [evidence] })
  assert.deepEqual(result.drafts.map(item => item.mate.kind), ['face-contact', 'coaxial'])
  assert.deepEqual(result.drafts[0].evidenceRefs, [evidence])
  assert.deepEqual(result.drafts[1].basis.partIds, ['a', 'b'])
  assert.equal(result.requiresConfirmation, true)
  assert.deepEqual(assembly, before)
  assemblyModelV1Schema.parse({ ...assembly, mates: result.drafts.map(item => item.mate) })
})

test('real solver worker evaluates five measurements, reproduces seeds, and caches unchanged results', async () => {
  const input = { ...fixture(), samples: 10_000 }
  assemblyModelV1Schema.parse(input.assembly)
  const worker = createSolverScheduler()
  try {
    const full = () => worker.run({ kind: 'multivariate', inputs: input })
    const first = await full()
    assert.equal(first.status, 'ok')
    const second = await full()
    assert.deepEqual(first.measurements, second.measurements)
    assert.notDeepEqual((await worker.run({ kind: 'multivariate', inputs: { ...input, seed: 0 } })).measurements, first.measurements)
    const baseline = await full()
    const [gap, flush, center, coax, angle] = baseline.measurements
    close(gap.nominal, 14)
    close(flush.nominal, 0)
    assert.ok(center.nominal > 7.9 && center.nominal < 8.11)
    close(coax.nominal, 0)
    close(angle.nominal, 0)
    for (const result of baseline.measurements) {
      assert.equal(result.histogram.counts.reduce((a, b) => a + b), 10_000)
      assert.ok(result.sigma > 0 && Number.isFinite(result.cpk))
      assert.equal(result.extremeEstimate.guaranteedBounds, false)
      assert.ok(result.ppm >= 0 && result.ppm <= 1e6)
    }
    assert.equal(gap.contributions[0].parameterId, 'cover-height')
    close(gap.sigma, Math.hypot(0.025, 0.012, 0.014), 0.001)
    assert.ok(gap.contributions.some(item => item.featureId === 'spacer-top' && item.variance > 1e-5))
    assert.ok(coax.contributions[0].variance > 0)
    assert.equal(angle.unit, 'rad')
    const parameter = { ...input.parameters[0], sigmaQ: 600 }
    const incremental = () => worker.run({ kind: 'multivariate', inputs: {
      incremental: { baselineRevision: baseline.baselineRevision, parameter },
    } })
    const updated = await incremental()
    assert.deepEqual(updated.recalculatedMeasurementIds, ['gap'])
    assert.deepEqual(updated.measurements.slice(1), baseline.measurements.slice(1))
    assert.ok(updated.measurements[0].sigma > gap.sigma)
    await assert.rejects(incremental(), /stale/i)
    const rebuilt = await worker.run({ kind: 'multivariate', inputs: { ...input, parameters: [parameter, ...input.parameters.slice(1)] } })
    assert.deepEqual(updated.measurements, rebuilt.measurements)
    const other = createSolverScheduler()
    try {
      const foreign = await other.run({ kind: 'multivariate', inputs: input })
      assert.notEqual(foreign.baselineRevision, rebuilt.baselineRevision)
      await assert.rejects(worker.run({ kind: 'multivariate', inputs: {
        incremental: { baselineRevision: foreign.baselineRevision, parameter },
      } }), /stale/i)
    } finally {
      await other.close()
    }
  } finally {
    await worker.close()
  }
})

test('drafts use the actual geometry worker coplanar and coaxial extraction', async () => {
  const { createGeometryManager } = await import('../../geometry/geometryManager.mjs')
  const geometry = createGeometryManager()
  const spacer = (id, z) => ({
    id, color: '#778899', displayName: id, nominalTransform: pose(0, 0, z),
    kind: 'parametric-primitive', baseKind: 'cylinder-spacer',
    sizeQ: { outerDiameterQ: 100000, innerDiameterQ: 40000, lengthQ: 50000 }, modifiers: [],
  })
  const assembly = model([spacer('ring-a', 0), spacer('ring-b', 5)], [])
  try {
    const result = await geometry.rebuildAssembly(assembly, { jobId: 'candidate-test', attempt: 1 })
    const { features, candidates } = result.report
    assert.ok(candidates.coplanar.length > 0)
    assert.ok(candidates.coaxial.length > 0)
    const output = suggestMateDrafts({ ...assembly, features }, candidates)
    assert.ok(output.drafts.some(item => item.mate.kind === 'face-contact'))
    assert.ok(output.drafts.some(item => item.mate.kind === 'coaxial'))
    assert.deepEqual(assembly.mates, [])
  } finally {
    await geometry.close()
  }
})

test('mate drafting detects eccentric floating-clearance, rejects non-overlapping planes, and suppresses transitive hole-hole mates', async () => {
  const { createGeometryManager } = await import('../../geometry/geometryManager.mjs')
  const geometry = createGeometryManager()
  const plateA = {
    id: 'plate-a', color: '#778899', displayName: 'Plate A', nominalTransform: pose(0, 0, 0),
    kind: 'parametric-primitive', baseKind: 'plate',
    sizeQ: { lengthQ: 200000, widthQ: 200000, thicknessQ: 50000 },
    modifiers: [{ id: 'hole-a', kind: 'through-hole', originQ: [100000, 100000, 0], axis: [0, 0, 1], diameterQ: 44000 }],
  }
  const plateB = {
    id: 'plate-b', color: '#778899', displayName: 'Plate B', nominalTransform: pose(0, 0, 5),
    kind: 'parametric-primitive', baseKind: 'plate',
    sizeQ: { lengthQ: 200000, widthQ: 200000, thicknessQ: 50000 },
    modifiers: [{ id: 'hole-b', kind: 'through-hole', originQ: [100000, 100000, 0], axis: [0, 0, 1], diameterQ: 44000 }],
  }
  const plateFar = {
    id: 'plate-far', color: '#778899', displayName: 'Plate Far', nominalTransform: pose(60, 0, 5),
    kind: 'parametric-primitive', baseKind: 'plate',
    sizeQ: { lengthQ: 200000, widthQ: 200000, thicknessQ: 50000 },
    modifiers: [],
  }
  const pin = {
    id: 'pin', color: '#998877', displayName: 'Pin', nominalTransform: pose(10.1, 10, 0),
    kind: 'parametric-primitive', baseKind: 'cylinder-spacer',
    sizeQ: { outerDiameterQ: 40000, innerDiameterQ: 10000, lengthQ: 100000 },
    modifiers: [],
  }
  const base = model([plateA, plateB, plateFar, pin], [])
  try {
    const { report } = await geometry.rebuildAssembly(base, { jobId: 'clearance-draft-test', attempt: 1 })
    const assembly = { ...base, features: report.features }
    const candidates = recoverCandidates(assembly)
    const { drafts } = suggestMateDrafts(assembly, candidates)
    const faceContacts = drafts.filter(item => item.mate.kind === 'face-contact')
    const clearances = drafts.filter(item => item.mate.kind === 'floating-clearance')
    const coaxials = drafts.filter(item => item.mate.kind === 'coaxial')
    assert.equal(faceContacts.length, 1)
    assert.deepEqual(faceContacts[0].basis.partIds.slice().sort(), ['plate-a', 'plate-b'])
    assert.equal(clearances.length, 2)
    for (const draft of clearances) {
      assert.equal(draft.mate.minQ, 0)
      assert.equal(draft.mate.maxQ, 2000)
      assert.equal(draft.basis.partIds[1], 'pin')
    }
    assert.equal(coaxials.length, 0)
  } finally {
    await geometry.close()
  }
})
