import assert from 'node:assert/strict'
import test from 'node:test'
import { createRng } from '../../../domain/statistics.ts'
import { buildDatumFrame } from '../datumFrame.mjs'
import { evaluateGdt, materialBonus, prepareGdt, sampleSdt, zoneError } from '../gdt.mjs'
import { createSolverScheduler } from '../solverScheduler.mjs'
import { scene } from '../spatial.mjs'
import { axis, model, part } from './fixture.ts'
import { gdtFixture } from './gdtFixture.mjs'

const near = (actual, expected, epsilon = 1e-12) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} vs ${expected}`)
const plane = (id, axis, point) => ({ id, plane: true, axis, point })
const cylinder = (id, axis, point) => ({ id, cylinder: true, axis, point })

test('3-2-1 respects precedence with a nonorthogonal secondary and returns a proper transform', () => {
  const a = plane('A', [0, 0, 1], [0, 0, 3])
  const b = plane('B', [0, Math.SQRT1_2, Math.SQRT1_2], [0, 2, 3])
  const c = plane('C', [1, 0, 0], [1, 0, 0])
  const frame = buildDatumFrame([a, b, c])
  assert.deepEqual(frame.ranks, [3, 2, 1])
  const expected = [[0, -1, 0, 1], [1, 0, 0, 2], [0, 0, 1, 3], [0, 0, 0, 1]]
  frame.transform.forEach((row, i) => row.forEach((value, j) => near(value, expected[i][j])))
  assert.deepEqual(buildDatumFrame([a, plane('B', [0, 0, -1], [0, 0, 6])]), { code: 'DRF_DEGENERATE', datumId: 'B' })
})

test('a primary cylinder locks four degrees; an offset cylinder clocks and an end plane seats it', () => {
  const a = cylinder('A', [0, 0, 1], [1, 2, 0])
  const b = cylinder('B', [0, 0, 1], [4, 2, 0])
  const c = plane('C', [0, 0, 1], [0, 0, 6])
  const frame = buildDatumFrame([a, b, c])
  assert.deepEqual(frame.ranks, [4, 1, 1])
  assert.deepEqual(frame.origin, [1, 2, 6])
  assert.equal(frame.remainingDof, 0)
  assert.equal(buildDatumFrame([a]).remainingDof, 2)
  assert.equal(buildDatumFrame([a, { ...b, point: [1, 2, 5] }]).code, 'DRF_DEGENERATE')
})

test('zone equations distinguish diameter, two widths and local angles; coaxiality checks both ends', () => {
  near(zoneError('position', 'cylindrical', 10, 0.03, 0.04, 0, 0), 0.1)
  near(zoneError('position', 'bidirectional', 10, 0.03, 0.04, 0, 0), 0.08)
  near(zoneError('position', 'planar', 10, 0.03, 0.04, 0, 0), 0.06)
  near(zoneError('perpendicularity', 'planar', 10, 9, 5, 0.003, 0.004), 0.05)
  near(zoneError('parallelism', 'planar', 10, 900, 500, 0.003, 0.004), 0.05)
  near(zoneError('flatness', 'planar', 10, 9, 5, 0.003, 0.004, 0.02), 0.07)
  near(zoneError('coaxiality', 'cylindrical', 10, 0.03, 0, 0, -0.004), 0.1)
  for (const [kind, zone] of [
    ['position', 'cylindrical'], ['position', 'bidirectional'], ['position', 'planar'],
    ['perpendicularity', 'planar'], ['parallelism', 'planar'], ['flatness', 'planar'], ['coaxiality', 'cylindrical'],
  ]) {
    const rng = createRng(34)
    for (let i = 0; i < 1000; i++) {
      const { center: [u, v, , a, b], form } = sampleSdt(kind, zone, 0.1, 10, rng)
      assert.ok(zoneError(kind, zone, 10, u, v, a, b, form) <= 0.1 + 1e-12)
    }
  }
})

test('material bonus uses opposite boundaries for internal and external features', () => {
  const tolerance = { lowerQ: -200, upperQ: 800 }
  near(materialBonus(tolerance, 'MMC', 0.8), 0.08)
  near(materialBonus(tolerance, 'LMC', 0.8), 0.02)
  near(materialBonus(tolerance, 'MMC', 0.8, true), 0.02)
  near(materialBonus(tolerance, 'LMC', 0.8, true), 0.08)
  assert.equal(materialBonus(tolerance, 'RFS', 0.8), 0)
  assert.equal(materialBonus(undefined, 'MMC', 0.8), 0)
})

test('coupled features share one physical twist and produce different joint PPM from independent datum motion', t => {
  const assembly = model([part('piece'), part('other')], [
    axis('datum', 'piece', [0, 0, 0], [0, 0, 1], 40000),
    axis('first', 'piece', [0, 0, 0], [0, 0, 1], 30000),
    axis('second', 'piece', [0, 0, 0], [0, 0, 1], 30000),
  ])
  assembly.datums = [{ id: 'axis', label: 'A', featureId: 'datum', sizeToleranceQ: { lowerQ: 0, upperQ: 2000 } }]
  assembly.gdt = ['first', 'second'].map(featureId => ({
    id: featureId, featureId, kind: 'position', zoneShape: 'cylindrical', toleranceQ: 0,
    datumIds: ['axis'], datumModifiers: ['MMC'],
  }))
  const run = () => {
    const simulation = prepareGdt(assembly, scene(assembly), new Map(), new Map(), 50_000, 19)
    return { simulation, initial: evaluateGdt(simulation, new Map()) }
  }
  const { simulation, initial } = run()
  const [a, b] = simulation.entries
  assert.equal(a.group, b.group)
  assert.ok(a.group.motion.some((value, i) => i % 6 >= 3 && value !== 0))
  assert.deepEqual(initial.draws.get('first').errors, initial.draws.get('second').errors)
  const { metrics: coupled } = evaluateGdt(simulation, new Map(), initial,
    [{ gdtId: 'first', toleranceQ: 550 }, { gdtId: 'second', toleranceQ: 550 }])
  assembly.features[2].partId = 'other'
  const independent = run()
  const { metrics: uncoupled } = evaluateGdt(independent.simulation, new Map(), independent.initial,
    [{ gdtId: 'first', toleranceQ: 550 }, { gdtId: 'second', toleranceQ: 550 }])
  assert.ok(coupled.ppm > 50_000)
  assert.ok(uncoupled.ppm - coupled.ppm > 50_000, `${coupled.ppm} vs ${uncoupled.ppm}`)
  const failureProbability = coupled.ppm / 1e6
  near(uncoupled.ppm / 1e6, 1 - (1 - failureProbability) ** 2, 0.02)
  t.diagnostic(`coupled ${coupled.ppm} PPM, independent ${uncoupled.ppm} PPM`)
})

test('resident worker preserves common draws across edits and repeats identical results by seed', async () => {
  const solver = createSolverScheduler()
  try {
    const inputs = gdtFixture()
    inputs.samples = 10000
    const run = inputs => solver.run({ kind: 'multivariate', inputs })
    const first = await run(inputs)
    const second = await run(inputs)
    assert.deepEqual(second.gdt, first.gdt)
    assert.equal(second.gdt.baseline.contributions.length, 6)
    assert.ok(second.gdt.baseline.contributions[0].datumShiftContributionPct > 0)
    assert.ok(!second.gdt.baseline.warnings.some(warning => warning.code === 'DRF_DEGENERATE'))
    const edits = [{ gdtId: 'position', modifier: 'MMC' }, { gdtId: 'flatness', modifier: 'LMC', toleranceQ: 100 }]
    await assert.rejects(run({ incremental: { baselineRevision: first.baselineRevision, edits } }), /Stale/)
    await assert.rejects(run({ incremental: { baselineRevision: second.baselineRevision, edits: [{ gdtId: 'unknown' }] } }), /Invalid/)
    const edited = await run({ incremental: { baselineRevision: second.baselineRevision, edits } })
    const inline = await run({ ...inputs, gdtEdits: edits })
    assert.deepEqual(edited.gdt, inline.gdt)
    assert.deepEqual(edited.gdt.recalculatedGdtIds, ['position', 'flatness'])
    assert.deepEqual(edited.measurements, first.measurements)
    const { baseline, whatIf } = edited.gdt
    assert.equal(baseline.contributions[0].bonusMeanMm, 0)
    near(whatIf.contributions[0].bonusMeanMm, 0.05, 0.002)
    assert.ok(whatIf.ppm > baseline.ppm)
    assert.ok(whatIf.warnings.some(item => item.gdtId === 'flatness' && item.code === 'ILLEGAL_MODIFIER'))
    const different = await run({ ...inputs, seed: 0xffffffff })
    assert.notDeepEqual(different.gdt.baseline, baseline)
  } finally {
    await solver.close()
  }
})

test('degenerate datum references carry frozen warnings and omit fabricated contributions', async () => {
  const solver = createSolverScheduler()
  try {
    const inputs = gdtFixture()
    inputs.samples = 10000
    inputs.assembly.features.push(axis('zero-axis', 'cover', [0, 0, 0], [0, 0, 0], 12000))
    inputs.assembly.datums.push({ id: 'parallel', label: 'B', featureId: 'cover-top' },
      { id: 'zero-axis', label: 'Z', featureId: 'zero-axis' })
    inputs.assembly.gdt[1].datumIds = ['zero-axis']
    inputs.assembly.gdt[1].datumModifiers = ['RFS']
    inputs.assembly.gdt[0].datumIds = ['A', 'parallel']
    inputs.assembly.gdt[0].datumModifiers = ['RFS', 'MMC']
    const result = await solver.run({ kind: 'multivariate', inputs })
    const { warnings, contributions } = result.gdt.baseline
    assert.ok(warnings.some(warning => warning.gdtId === 'position' &&
      warning.datumId === 'parallel' && warning.code === 'DRF_DEGENERATE'))
    assert.ok(warnings.some(warning => warning.gdtId === 'position' && warning.code === 'ILLEGAL_MODIFIER'))
    assert.ok(!contributions.some(item => item.gdtId === 'position' || item.gdtId === 'bidirectional'))
    assert.ok(warnings.some(warning => warning.gdtId === 'bidirectional' &&
      warning.datumId === 'zero-axis' && warning.code === 'DRF_DEGENERATE'))
  } finally {
    await solver.close()
  }
})

test('GD&T sampling distinguishes normal from uniform and keeps the same draws for edits', async t => {
  const solver = createSolverScheduler()
  t.after(() => solver.close())
  const fixture = { ...gdtFixture(), samples: 1000, seed: 13 }
  const run = inputs => solver.run({ kind: 'multivariate', inputs })
  const uniform = await run({ ...fixture, gdtDistribution: 'uniform' })
  const normal = await run({ ...fixture, gdtDistribution: 'normal' })
  assert.equal(normal.status, 'ok')
  assert.equal(uniform.status, 'ok')
  assert.notDeepEqual(normal.gdt.baseline, uniform.gdt.baseline)
  assert.deepEqual(normal.measurements, uniform.measurements)
  const edits = [{ gdtId: 'position', toleranceQ: 10 }]
  const changed = await run({ incremental: { baselineRevision: normal.baselineRevision, edits } })
  const repeated = await run({ ...fixture, gdtDistribution: 'normal', gdtEdits: edits })
  assert.deepEqual(changed.gdt.baseline, normal.gdt.baseline)
  assert.deepEqual(changed.gdt.whatIf, repeated.gdt.whatIf)
  const legacy = await run({ ...fixture, samples: 10000 })
  const explicitUniform = await run({ ...fixture, samples: 10000, gdtDistribution: 'uniform' })
  assert.deepEqual(legacy.gdt, explicitUniform.gdt)
})

test('a single GD&T draw has a point interval and null Cpk while sample limits stay enforced', async t => {
  const solver = createSolverScheduler()
  t.after(() => solver.close())
  const fixture = { ...gdtFixture(), samples: 1, seed: 13 }
  const run = inputs => solver.run({ kind: 'multivariate', inputs })
  await assert.rejects(run(fixture), /3D samples must be 10000/)
  await assert.rejects(run({ ...fixture, gdtDistribution: 'uniform', samples: 0 }), /GD&T samples/)
  await assert.rejects(run({ ...fixture, gdtDistribution: 'normal', samples: 50001 }), /GD&T samples/)
  for (const gdtDistribution of ['normal', 'uniform']) {
    const result = await run({ ...fixture, gdtDistribution })
    const { baseline } = result.gdt
    assert.equal(baseline.cpk, null)
    assert.ok([0, 1000000].includes(baseline.ppm))
    assert.ok(Number.isFinite(baseline.threeSigmaIntervalMm[0]))
    assert.equal(baseline.threeSigmaIntervalMm[0], baseline.threeSigmaIntervalMm[1])
    assert.ok(baseline.contributions.length > 0)
    assert.ok(baseline.contributions.every(row => row.varianceSharePct === 0))
    assert.ok(result.measurements.every(row => row.sigma === 0 && row.cpk === null))
  }
})

test('normal planar draws are centered, tighter than uniform and bounded by the tolerance', () => {
  const rng = createRng(739)
  const samples = 10000
  let sum = 0
  let squares = 0
  for (let i = 0; i < samples; i++) {
    const { center: [offset] } = sampleSdt('position', 'planar', 2, 1, rng, 'normal')
    assert.ok(Math.abs(offset) <= 1)
    sum += offset
    squares += offset ** 2
  }
  near(sum / samples, 0, 0.015)
  // A unit normal truncated at ±3σ contributes about 0.108 of the squared half-width.
  near(squares / samples, 0.108, 0.01)
})
