import assert from 'node:assert/strict'
import { test } from 'node:test'
import { beamDeflection, bimetalCurvature, preparePlate } from '../compliance.mjs'
import { materialPresets, resolveMaterial } from '../materials.ts'
import { createSimulation } from '../multivariate.mjs'
import { createSolverScheduler } from '../solverScheduler.mjs'
import { compliantFixture } from './compliantFixture.mjs'
import { face, model, part, point, pose } from './fixture.ts'

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected} ± ${tolerance}, got ${actual}`)
}

const up = [0, 0, 1]
const custom = (partId, youngsModulusMpa = 200_000, thermalExpansionPerK = 12e-6) =>
  ({ partId, youngsModulusMpa, thermalExpansionPerK, poissonRatio: 0.3, deltaTemperatureK: 0 })

function displacement(result, partId, position) {
  const field = result.displacementFields.find(item => item.partId === partId)
  return field.samples.find(({ posMm }) => posMm.every((value, k) => Math.abs(value - position[k]) < 1e-9)).dispMm
}

test('all nine material presets have consistent units and accept explicit material overrides', () => {
  assert.deepEqual(Object.keys(materialPresets),
    ['steel-45', 'sus304', 'al-6061', 'al-5052', 'brass-h62', 'abs', 'pc', 'pa66', 'silicone-epdm'])
  for (const [presetId, preset] of Object.entries(materialPresets)) {
    const material = resolveMaterial('part', { presetId })
    assert.equal(material.partId, 'part')
    assert.equal(material.name, preset.name)
    assert.equal(material.youngsModulusMpa, preset.youngsModulusMpa)
    assert.equal(material.poissonRatio, preset.poissonRatio)
    assert.equal(material.thermalExpansionPerK, preset.thermalExpansionPerK)
    if (presetId === 'silicone-epdm') assert.equal(material.yieldStrengthMpa, undefined)
    else assert.ok(material.yieldStrengthMpa > 0)
  }
  const material = resolveMaterial('part', { presetId: 'steel-45', ...custom('part', 1234, -2e-6),
    yieldStrengthMpa: 100, name: 'Override', deltaTemperatureK: 19 })
  assert.equal(material.youngsModulusMpa, 1234)
  assert.equal(material.thermalExpansionPerK, -2e-6)
  assert.equal(material.yieldStrengthMpa, 100)
  assert.equal(material.deltaTemperatureK, 19)
  assert.equal(material.name, 'Override')
  assert.throws(() => resolveMaterial('part', { presetId: 'steel-45', poissonRatio: 0.5 }), /Invalid/)
})

test('axial EA/L and independent K produce the same rebound and common rigid draws', () => {
  const assembly = model([part('datum'), part('body')], [
    face('fixed', 'datum', [0, 0, 0], up), face('end', 'body', [0, 0, 100_000], up),
    point('base', 'body', [0, 0, 0]), point('half', 'body', [0, 0, 50_000]),
  ])
  assembly.measurements = [{ id: 'gap', kind: 'gap', featureIds: ['fixed', 'end'] }]
  const spec = { id: 'axial', kind: 'axial-compression', partId: 'body', featureId: 'end',
    effectiveAreaMm2: 5, lengthMm: 10, preloadN: 20_000, springbackRatio: 0.25 }
  assembly.physics = { materials: [custom('body')], compliantModels: [spec] }
  const input = { assembly, samples: 1000, gdtDistribution: 'uniform', parameters: [
    { id: 'height', partId: 'body', featureId: 'end', dof: 'tz', sigmaQ: 100, lowerQ: -300, upperQ: 300 },
  ], limits: { gap: { lower: 9.9, upper: 10.1 } } }
  const run = createSimulation(0)
  const result = run(input)
  const axial = 20_000 * 10 / (200_000 * 5) * 0.75
  near(result.measurements[0].nominal, 10 - axial)
  near(displacement(result, 'body', [0, 0, 10])[2], -axial)
  near(displacement(result, 'body', [0, 0, 5])[2], -axial / 2)
  near(displacement(result, 'body', [0, 0, 0])[2], 0)
  const rigid = run({ incremental: { baselineRevision: result.baselineRevision, physics: { enabled: false } } })
  near(result.measurements[0].sigma, rigid.measurements[0].sigma * (1 - axial / 10))
  const explicit = run({ incremental: { baselineRevision: rigid.baselineRevision,
    physics: { enabled: true, materials: [], compliantModels: [{ ...spec, stiffnessNPerMm: 100_000 }] } } })
  near(explicit.measurements[0].sigma, rigid.measurements[0].sigma)
  near(explicit.measurements[0].mean, rigid.measurements[0].mean - axial)
  assert.equal(explicit.compliant.rigidBaseline.ppm, rigid.measurements[0].ppm)
  assert.equal(explicit.compliant.compliantResult.ppm, 1e6)
})

test('rectangular Kirchhoff clamp solve holds the nodes and retains a center residual', () => {
  const points = [[-18, -8], [18, -8], [18, 8], [-18, 8]]
  const material = custom('body', 70_000)
  for (const boundaryKind of ['simply-supported', 'clamped']) {
    const spec = { points, footprint: [[0, 0]], thickness: 1, material, boundaryKind }
    const full = preparePlate(spec)
    near(full.rigidity, 70_000 / (12 * (1 - 0.3 ** 2)))
    for (const clamp of points) {
      const [[w0], [correction]] = full.at(clamp)
      near(w0 + correction, 0, 1e-10)
    }
    const [[center], [change]] = full.at([0, 0])
    assert.ok(center + change > 0 && center + change < 1)
    const limited = preparePlate({ ...spec, clampForceN: 20 })
    const thicker = preparePlate({ ...spec, thickness: 2, clampForceN: 20 })
    near(thicker.maxCorrection / limited.maxCorrection, 1 / 8)
    const [[w0], [correction]] = limited.at(points[0])
    near(w0 + correction / 2, w0 / 2)
    const [[, slopeX], [, slopeCorrection]] = full.at([7, 3])
    const sum = x => full.at([x, 3]).reduce((total, coefficients) => total + coefficients[0], 0)
    near(slopeX + slopeCorrection, (sum(7.0001) - sum(6.9999)) / 0.0002, 1e-8)
  }
  // Two symmetric point loads on a simply supported 30 × 15 mm rectangle.
  // Compare the force limit with the classical Navier series for those two loads.
  const symmetric = preparePlate({ points: [[-10, 0], [10, 0]], footprint: [[0, 0]],
    thickness: 1, boundaryKind: 'simply-supported', clampForceN: 20, material })
  let series = 0
  for (let m = 1; m <= 81; m += 2) {
    for (let n = 1; n <= 81; n += 2) {
      series += Math.sin(m * Math.PI / 6) ** 2 / ((m / 30) ** 2 + (n / 15) ** 2) ** 2
    }
  }
  const navierLimit = 20 * 8 * series / (30 * 15 * symmetric.rigidity * Math.PI ** 4) / (5 / 9)
  near(symmetric.maxCorrection / navierLimit, 1, 0.02)
  assert.throws(() => preparePlate({ points: [[0, 0], [0, 0]], footprint: [[1, 1]], thickness: 1, material }), /independently/)
})

test('plate displacement fields respect the force limit for signed initial warp', () => {
  const assembly = model([part('lid')], [
    face('lid-center', 'lid', [0, 0, 0], up), point('clamp-a', 'lid', [-180_000, -80_000, 0]),
    point('clamp-b', 'lid', [180_000, -80_000, 0]), point('clamp-c', 'lid', [180_000, 80_000, 0]),
    point('clamp-d', 'lid', [-180_000, 80_000, 0]),
  ])
  const plate = { id: 'plate', kind: 'plate-clamping', partId: 'lid', surfaceFeatureId: 'lid-center',
    clampFeatureIds: ['clamp-a', 'clamp-b', 'clamp-c', 'clamp-d'], thicknessQ: 10_000,
    initialWarpPeakQ: 2000, boundaryKind: 'simply-supported' }
  assembly.physics = { materials: [custom('lid', 70_000)], compliantModels: [plate] }
  const run = createSimulation(0)
  const fixed = run({ assembly, samples: 1, gdtDistribution: 'normal', parameters: [] })
  near(displacement(fixed, 'lid', [-18, -8, 0])[2], 0)
  const edit = (result, values) => run({ incremental: { baselineRevision: result.baselineRevision,
    physics: { compliantModels: [{ ...plate, ...values }] } } })
  const limited = edit(fixed, { clampForceN: 0.5 })
  assert.ok(displacement(limited, 'lid', [-18, -8, 0])[2] > 0)
  const reversed = edit(limited, { clampForceN: 0.5, initialWarpPeakQ: -plate.initialWarpPeakQ })
  near(displacement(reversed, 'lid', [0, 0, 0])[2], -displacement(limited, 'lid', [0, 0, 0])[2])
})

test('beam point load matches Euler–Bernoulli support, deflection and rotation', () => {
  const ei = 200_000 * 4
  const span = 20
  const force = 60
  near(beamDeflection('cantilever', 0, span, ei)[0], 0)
  near(beamDeflection('simply-supported', 0, span, ei)[1] * force, force * span ** 2 / (16 * ei))
  near(beamDeflection('simply-supported', span, span, ei)[1] * force, -force * span ** 2 / (16 * ei))
  for (const supportKind of ['cantilever', 'simply-supported']) {
    const cantilever = supportKind === 'cantilever'
    const x = cantilever ? span : span / 2
    const assembly = model([part('datum'), part('body')], [
      face('fixed', 'datum', [0, 0, 0], up), face('end', 'body', [x * 10_000, 0, 0], up),
    ])
    assembly.measurements = [{ id: 'gap', kind: 'gap', featureIds: ['fixed', 'end'] },
      { id: 'angle', kind: 'angle', featureIds: ['fixed', 'end'] }]
    assembly.physics = { materials: [custom('body')], compliantModels: [{ id: 'beam', kind: 'beam-bending',
      partId: 'body', loadFeatureId: 'end', supportKind, spanMm: span, momentOfInertiaMm4: 4, forceN: force }] }
    const result = createSimulation(0)({ assembly, samples: 1, parameters: [], gdtDistribution: 'normal' })
    near(result.measurements[0].mean, force * span ** 3 / ((cantilever ? 3 : 48) * ei))
    near(result.measurements[1].mean, cantilever ? force * span ** 2 / (2 * ei) : 0)
    near(displacement(result, 'body', [0, 0, 0])[2], 0)
  }
})

test('thermal growth and bonded-layer curvature match analytical uniform-temperature limits', () => {
  const assembly = model([part('first', pose(3, 3, 5)), part('second', pose(3, 3, 7))], [
    point('p0', 'first', [0, 0, 0]), point('p1', 'first', [100_000, 0, 0]), point('p2', 'first', [0, 0, 20_000]),
    point('q0', 'second', [0, 0, 0]), point('q1', 'second', [100_000, 0, 0]), point('q2', 'second', [0, 0, 20_000]),
  ])
  const a = custom('first', 100_000, 24e-6)
  const b = custom('second', 100_000, 12e-6)
  const thermal = { id: 'heat', kind: 'thermal-expansion', partIds: ['first', 'second'],
    deltaTemperatureK: 100, referenceFeatureId: 'p0' }
  assembly.physics = { materials: [a, b], compliantModels: [thermal] }
  assembly.measurements = [{ id: 'distance', kind: 'center-distance', featureIds: ['p0', 'p1'] }]
  const run = createSimulation(0)
  const free = run({ assembly, samples: 1, gdtDistribution: 'uniform', parameters: [] })
  near(free.measurements[0].mean, 10 * (1 + 24e-6 * 100))
  near(displacement(free, 'second', [13, 3, 7])[0], 12e-6 * 100 * 10)
  const bonded = run({ incremental: { baselineRevision: free.baselineRevision,
    physics: { compliantModels: [{ ...thermal, bimetallicCoupling: true }] } } })
  const curvature = 1.5 * (24e-6 - 12e-6) * 100 / 4
  near(bimetalCurvature(a, b, 2, 2) * 100, curvature)
  near(bimetalCurvature(b, a, 2, 2) * 100, -curvature)
  near(bimetalCurvature(a, { ...b, thermalExpansionPerK: a.thermalExpansionPerK }, 2, 1), 0)
  near(displacement(bonded, 'first', [13, 3, 5])[2], curvature * 10 ** 2 / 2)
})

test('resident worker uses matched rigid draws, has unified contributions and deterministic fields', async () => {
  const scheduler = createSolverScheduler()
  const run = inputs => scheduler.run({ kind: 'multivariate', inputs })
  const input = compliantFixture()
  input.samples = 10_000
  input.gdtDistribution = 'normal'
  const physics = input.assembly.physics
  const edit = (result, patch) => run({ incremental: { baselineRevision: result.baselineRevision, physics: patch } })
  try {
    const flex = await run(input)
    const inactive = await edit(flex, { enabled: false })
    const reenabled = await edit(inactive, { enabled: true })
    assert.deepEqual(reenabled.compliant, flex.compliant)
    assert.deepEqual(reenabled.displacementFields, flex.displacementFields)
    assert.deepEqual(reenabled.measurements, flex.measurements)
    const { gdt: { baseline: { warnings, contributions, ...rigidMetrics } } } = inactive
    assert.deepEqual(flex.compliant.rigidBaseline, rigidMetrics)
    assert.equal(flex.compliant.flexDeltaCpk, flex.compliant.compliantResult.cpk - rigidMetrics.cpk)
    assert.notDeepEqual(flex.compliant.compliantResult, rigidMetrics)
    assert.notDeepEqual(flex.measurements, inactive.measurements)
    assert.equal(inactive.compliant, undefined)
    assert.equal(inactive.displacementFields, undefined)
    assert.equal(inactive.gdt.compliant, undefined)
    assert.deepEqual(flex.gdt.compliant.warnings, warnings)
    assert.equal(contributions.length, 7)
    const weights = [...flex.gdt.compliant.contributions, ...flex.compliant.flexContributionItems]
    assert.ok(flex.compliant.flexContributionItems.every(item => item.varianceSharePct > 0))
    near(weights.reduce((sum, item) => sum + item.varianceSharePct, 0), 100)
    const cover = flex.displacementFields.find(field => field.partId === 'cover')
    assert.ok(cover.samples.length >= 25)
    for (const field of flex.displacementFields) {
      for (const sample of field.samples) near(sample.magMm, Math.hypot(...sample.dispMm))
      near(field.maxDisplacementMm, Math.max(...field.samples.map(sample => sample.magMm)))
      near(field.minDisplacementMm, Math.min(...field.samples.map(sample => sample.magMm)))
    }
    const changedPhysics = { compliantModels: physics.compliantModels.map(model =>
      model.id === 'clamp' ? { ...model, initialWarpPeakQ: 1350 } : model) }
    const adjusted = await edit(reenabled, changedPhysics)
    assert.notDeepEqual(adjusted.displacementFields, reenabled.displacementFields)
    await assert.rejects(edit(reenabled, { enabled: false }), /Stale/)
    await assert.rejects(edit(adjusted, { compliantModels: [{ ...physics.compliantModels[0], partId: 'cover' }] }), /another part/)
    const afterRejected = await edit(adjusted, { enabled: true })
    assert.deepEqual(afterRejected.compliant, adjusted.compliant)
    const rerun = await run({ ...input, assembly: { ...input.assembly, physics: { ...physics, ...changedPhysics } } })
    assert.deepEqual(rerun.compliant, adjusted.compliant)
    assert.deepEqual(rerun.displacementFields, adjusted.displacementFields)
    assert.deepEqual(rerun.measurements, adjusted.measurements)
    const changedSeed = await run({ ...input, seed: input.seed + 1 })
    assert.notDeepEqual(changedSeed.compliant, flex.compliant)
    assert.deepEqual(changedSeed.displacementFields, flex.displacementFields)
    const { physics: unused, ...bareAssembly } = input.assembly
    assert.equal(unused, physics)
    const absent = await run({ ...input, assembly: bareAssembly })
    const disabled = await run({ ...input, assembly: { ...input.assembly, physics: { ...physics, enabled: false } } })
    const stable = ({ baselineRevision, ...result }) => ({ ...result, hasRevision: typeof baselineRevision === 'string' })
    assert.deepEqual(stable(absent), stable(disabled))
    assert.deepEqual(absent.measurements, inactive.measurements)
    const fromDisabled = await edit(disabled, { enabled: true })
    assert.deepEqual(fromDisabled.compliant, flex.compliant)
  } finally {
    await scheduler.close()
  }
})

test('optional MIC evaluator is loaded on the engine side and shares the analytic output path', () => {
  const assembly = model([part('datum'), part('body')], [
    face('fixed', 'datum', [0, 0, 0], up), face('end', 'body', [0, 0, 10_000], up),
  ])
  assembly.measurements = [{ id: 'gap', kind: 'gap', featureIds: ['fixed', 'end'] }]
  assembly.physics = { micMatrixRef: 'asset' }
  const input = { assembly, samples: 1, parameters: [], gdtDistribution: 'normal' }
  assert.equal(createSimulation(0)(input).compliant, undefined)
  const run = createSimulation(0, { micEvaluator({ reference, samples }) {
    assert.equal(reference, 'asset')
    assert.equal(samples, 1)
    return { modelId: 'asset', parts: ['body'], at: () => [[0, 0, 0.1, 0, 0, 0]], amplitudes: () => [1] }
  } })
  const result = run(input)
  near(result.measurements[0].mean, 1.1)
  near(displacement(result, 'body', [0, 0, 1])[2], 0.1)
  assert.deepEqual(result.compliant.flexContributionItems, [{ modelId: 'asset', label: 'asset', kind: 'mic-matrix', varianceSharePct: 0 }])
})
