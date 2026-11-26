import assert from 'node:assert/strict'
import test from 'node:test'
import { createRng } from '../../../domain/statistics.ts'
import { evaluateGdt, materialBonus, prepareGdt, sampleSdt, zoneError } from '../gdt.mjs'
import { createSolverScheduler } from '../solverScheduler.mjs'
import { cross, scene } from '../spatial.mjs'
import { advancedGdtFixture } from './advancedGdtFixture.mjs'
import { axis, face, model, part } from './fixture.ts'

const near = (actual, expected, epsilon = 1e-12) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} vs ${expected}`)

const evaluate = (assembly, parameters = new Map(), samples = 512) => {
  const transfers = new Map([...parameters.keys()].map(id => [id, new Map()]))
  const prepared = prepareGdt(assembly, scene(assembly), parameters, transfers, samples, 19, {}, 'uniform', true)
  return { prepared, result: evaluateGdt(prepared, parameters) }
}

test('profile compares both signed extremes and local form only uses peak-to-valley and tilt', () => {
  const rng = createRng(112)
  for (const f of [0, 0.25, 0.5, 0.9, 1]) {
    for (let i = 0; i < 256; i++) {
      const { center: [, , z, alpha, beta], form } = sampleSdt('profile-surface', 'planar', 0.2, 10, rng, 'uniform', f)
      const half = (form + 10 * Math.hypot(alpha, beta)) / 2
      assert.ok(z - half >= -(1 - f) * 0.2 - 1e-12)
      assert.ok(z + half <= f * 0.2 + 1e-12)
    }
  }
  near(zoneError('profile-surface', 'planar', 10, -0.04, 0, 0.004, 0, 0.02, 0.25), 0.07 / 0.75)
  near(zoneError('profile-surface', 'planar', 10, 0.04, 0, 0.004, 0, 0.02, 0.25), 0.28)
  near(zoneError('profile-surface', 'local', 10, 10, 0, 0.004, 0, 0.02), 0.06)
  assert.equal(sampleSdt('profile-surface', 'local', 0.2, 10, rng, 'uniform', 1).center[2], 0)

  const assembly = model([part('part')], [
    face('datum', 'part', [0, 0, 0], [0, 0, 1]), face('face', 'part', [0, 0, 0], [0, 0, 1]),
  ])
  assembly.datums = [{ id: 'A', label: 'A', featureId: 'datum' }]
  const control = { kind: 'profile-surface', featureId: 'face', toleranceQ: 2000 }
  assembly.gdt = [{ ...control, id: 'local', datumIds: [] },
    { ...control, id: 'outward', datumIds: ['A'], unequalProfileOuterFraction: 1 }]
  const baseline = evaluate(assembly)
  const translated = evaluate(assembly, new Map([['normal', {
    id: 'normal', featureId: 'face', index: 2, draws: new Float64Array(512).fill(-1), sigma: 0.3,
  }]]))
  assert.deepEqual(translated.result.draws.get('local'), baseline.result.draws.get('local'))
  assert.equal(baseline.result.metrics.ppm, 0)
  assert.equal(translated.result.metrics.ppm, 1e6)
  assert.ok(translated.result.metrics.threeSigmaIntervalMm.every(Number.isFinite))
})

test('single-section runout excludes angular sweep and total runout reaches the far end', () => {
  near(zoneError('circular-runout', 'cylindrical', 10, 0.03, 0.04, 0, 0.01, 0.02), 0.14)
  near(zoneError('total-runout', 'cylindrical', 10, 0.03, 0.04, 0, 0.01, 0.02), 2 * (Math.hypot(0.08, 0.04) + 0.02))
  const rng = createRng(128)
  for (const kind of ['circular-runout', 'total-runout']) {
    for (let i = 0; i < 256; i++) {
      const { center: [u, v, , a, b], form } = sampleSdt(kind, 'cylindrical', 0.2, 10, rng)
      assert.ok(zoneError(kind, 'cylindrical', 10, u, v, a, b, form) <= 0.2 + 1e-12)
      if (kind === 'circular-runout') assert.deepEqual([a, b], [0, 0])
    }
  }
  const assembly = model([part('part')], [
    axis('datum', 'part', [0, 0, 0], [0, 0, 1], 10000),
    axis('bore', 'part', [300, 400, 0], [0.01, 0, Math.sqrt(1 - 0.01 ** 2)], 10000),
  ])
  assembly.datums = [{ id: 'A', label: 'A', featureId: 'datum', sizeToleranceQ: { lowerQ: 0, upperQ: 500 } }]
  assembly.gdt = ['circular-runout', 'total-runout'].map(kind => ({
    kind, id: kind, featureId: 'bore', datumIds: ['A'], datumModifiers: ['LMC'], toleranceQ: 0,
    modifier: 'MMC', featureSizeToleranceQ: { lowerQ: 0, upperQ: 800 },
  }))
  const { prepared, result } = evaluate(assembly)
  near(result.draws.get('circular-runout').errors[0], 0.1)
  const span = prepared.entries[1].span
  near(result.draws.get('total-runout').errors[0], 2 * Math.hypot(0.03 + 0.01 * span / 2, 0.04))
  assert.equal(result.metrics.warnings.filter(w => w.code === 'ILLEGAL_MODIFIER').length, 4)
  assert.ok(result.metrics.contributions.every(c => c.bonusMeanMm === 0 && c.datumShiftContributionPct === 0))
  assembly.gdt = assembly.gdt.map(control => ({ ...control, modifier: 'RFS', datumModifiers: ['RFS'] }))
  assert.deepEqual(evaluate(assembly).result.draws, result.draws)
})

test('cylindricity depends on radial form and has no external rigid-body drift', () => {
  const rng = createRng(47)
  for (let i = 0; i < 256; i++) {
    const { center, form } = sampleSdt('cylindricity', 'cylindrical', 0.1, 20, rng)
    assert.deepEqual(center, [0, 0, 0, 0, 0, 0])
    assert.ok(form > 0 && form <= 0.1)
    near(zoneError('cylindricity', 'cylindrical', 20, 500, 200, 1, 2, form), form)
  }
  const assembly = model([part('part')], [
    face('face', 'part', [0, 0, 0], [0, 0, 1]),
    axis('bore', 'part', [50000, 20000, 10000], [0, 0.6, 0.8], 10000),
  ])
  assembly.datums = [{ id: 'A', label: 'A', featureId: 'face' }]
  const valid = { id: 'valid', kind: 'cylindricity', featureId: 'bore', datumIds: [], toleranceQ: 1000,
    featureSizeToleranceQ: { lowerQ: 0, upperQ: 200 }, modifier: 'MMC' }
  assembly.gdt = [valid, { ...valid, id: 'datum', datumIds: ['A'] }, { ...valid, id: 'plane', featureId: 'face' }]
  const initial = evaluate(assembly).result
  const drift = evaluate(assembly, new Map([['rigid', {
    id: 'rigid', featureId: 'bore', index: 0, draws: new Float64Array(512).fill(1), sigma: 100,
  }]])).result
  assert.deepEqual(initial.draws, drift.draws)
  assert.deepEqual(initial.metrics.contributions.map(c => [c.gdtId, c.bonusMeanMm]), [['valid', 0]])
  assert.deepEqual(initial.metrics.warnings.filter(w => w.code === 'DRF_DEGENERATE').map(w => w.gdtId), ['datum', 'plane'])
  assert.ok(initial.metrics.warnings.some(w => w.gdtId === 'valid' && w.code === 'ILLEGAL_MODIFIER'))
})

test('composite shares one twist and DRF while retaining independent hole spacing and segment bonuses', () => {
  const assembly = model([part('part')], [
    axis('datum', 'part', [0, 0, 0], [0, 0, 1], 20000),
    axis('one', 'part', [0, 0, 0], [0, 0, 1], 10000),
    axis('two', 'part', [100000, 0, 0], [0, 0, 1], 10000),
  ])
  assembly.datums = [{ id: 'A', label: 'A', featureId: 'datum', sizeToleranceQ: { lowerQ: 0, upperQ: 250 } }]
  assembly.gdt = ['one', 'two'].map(id => ({
    id, featureId: id, kind: 'composite-position', toleranceQ: 2500, datumIds: ['A'], datumModifiers: ['MMC'],
    modifier: 'MMC', featureSizeToleranceQ: { lowerQ: 0, upperQ: 400 }, patternGroupId: 'holes',
    lowerSegment: { datumIds: [], toleranceQ: 500, modifier: 'LMC' },
  }))
  const { prepared, result } = evaluate(assembly)
  const [one, two] = prepared.entries
  assert.equal(one.pattern, two.pattern)
  assert.equal(one.group, two.group)
  assert.ok(one.pattern.motions.some((value, i) => i % 6 < 3 && value !== 0))
  assert.ok(one.pattern.motions.some((value, i) => i % 6 >= 3 && value !== 0))
  const a = result.draws.get('one')
  const b = result.draws.get('two')
  assert.notDeepEqual(a.lower.errors, b.lower.errors)
  for (let i = 0; i < 512; i++) {
    const omega = one.pattern.motions.subarray(i * 6 + 3, i * 6 + 6)
    // Remove the independently sampled residuals. The signed center difference
    // must then be exactly the cross product of the common twist and hole spacing.
    const [, dy] = cross(omega, [10, 0, 0])
    near((b.kinematics[i * 9] - b.lower.kinematics[i * 5]) -
      (a.kinematics[i * 9] - a.lower.kinematics[i * 5]), dy)
    const q = a.quantiles[i]
    near(q, a.lower.quantiles[i])
    const upperWidth = 0.25 + materialBonus(assembly.gdt[0].featureSizeToleranceQ, 'MMC', q)
    const lowerWidth = 0.05 + materialBonus(assembly.gdt[0].featureSizeToleranceQ, 'LMC', q)
    assert.ok(a.withoutShift[i] <= upperWidth + 1e-12)
    assert.ok(a.lower.errors[i] <= lowerWidth + 1e-12)
  }
  const bonuses = result.scores.get('one').segments
  near(bonuses.upper.contribution.bonusMeanMm + bonuses.lower.contribution.bonusMeanMm, 0.04)
  assembly.gdt[0].lowerSegment.datumIds = ['A']
  const prefixed = evaluate(assembly)
  assert.equal(prefixed.prepared.entries[0].lower.restrainedRotation.length, 2)
  assert.notDeepEqual(prefixed.result.draws.get('one').lower.errors, a.lower.errors)
  assert.equal(prefixed.result.draws.get('one').lower.errors.length, 512)
  assembly.gdt[0].lowerSegment.datumIds = ['B']
  assert.match(evaluate(assembly).result.metrics.warnings.find(w => w.code === 'DRF_DEGENERATE').message, /ordered prefix/)
})

test('resident worker keeps seeded composite and compliant What-If independent of edit ordering', async () => {
  const solver = createSolverScheduler()
  const run = inputs => solver.run({ kind: 'multivariate', inputs })
  try {
    const input = { ...advancedGdtFixture(), samples: 2000 }
    const full = await run(input)
    const rerun = await run(input)
    assert.deepEqual(full.gdt, rerun.gdt)
    assert.deepEqual(full.measurements, rerun.measurements)
    const gdtId = 'composite-cover-bore'
    const increment = (prior, edit) => run({ incremental: { baselineRevision: prior.baselineRevision, edits: [{ gdtId, ...edit }] } })
    await assert.rejects(increment(rerun, { lowerSegment: { toleranceQ: 1200 } }), /Invalid/)
    const lower = await increment(rerun, { lowerSegment: { toleranceQ: 180, modifier: 'RFS' } })
    assert.notEqual(lower.gdt.whatIf.ppm, lower.gdt.baseline.ppm)
    const upper = await increment(lower, { toleranceQ: 850, modifier: 'LMC' })
    const final = await increment(upper, { lowerSegment: { modifier: 'MMC' } })
    const combined = await run({ ...input, gdtEdits: [{ gdtId, toleranceQ: 850, modifier: 'LMC',
      lowerSegment: { toleranceQ: 180, modifier: 'MMC' } }] })
    assert.deepEqual(final.gdt.whatIf, combined.gdt.whatIf)
    assert.deepEqual(final.gdt.compliant, combined.gdt.compliant)
    assert.deepEqual(final.measurements, full.measurements)
    assert.deepEqual(final.gdt.recalculatedGdtIds, [gdtId])
  } finally {
    await solver.close()
  }
})
