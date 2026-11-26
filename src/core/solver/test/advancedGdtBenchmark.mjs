import assert from 'node:assert/strict'
import { arch, cpus, platform, release } from 'node:os'
import { createSolverScheduler } from '../solverScheduler.mjs'
import { advancedGdtFixture } from './advancedGdtFixture.mjs'

const solver = createSolverScheduler()
const input = advancedGdtFixture()
const rounds = []
const run = inputs => solver.run({ kind: 'multivariate', inputs })
assert.equal(new Set(input.assembly.gdt.map(control => control.kind)).size, 10)
try {
  for (let i = 0; i < 6; i++) {
    const times = {}
    let start = performance.now()
    const full = await run(input)
    times.full = performance.now() - start
    assert.equal(full.status, 'ok')
    assert.equal(full.gdt.compliant.contributions.length, input.assembly.gdt.length)
    assert.equal(full.compliant.flexContributionItems.length, 4)
    assert.equal(full.measurements.length, 5)
    start = performance.now()
    const edited = await run({ incremental: { baselineRevision: full.baselineRevision, edits: [
      { gdtId: 'composite-cover-bore', toleranceQ: 850, modifier: 'LMC',
        lowerSegment: { toleranceQ: 320, modifier: 'RFS' } },
      { gdtId: 'profile', toleranceQ: 850 },
    ] } })
    times.edits = performance.now() - start
    assert.deepEqual(edited.gdt.recalculatedGdtIds, ['profile', 'composite-cover-bore'])
    assert.notDeepEqual(edited.gdt.whatIf, full.gdt.baseline)
    const parameter = { ...input.parameters[0], sigmaQ: 350 }
    start = performance.now()
    const parameterEdit = await run({ incremental: { baselineRevision: edited.baselineRevision, parameter } })
    times.parameter = performance.now() - start
    assert.ok(parameterEdit.recalculatedMeasurementIds.includes('gap'))
    const compliantModels = input.assembly.physics.compliantModels.map(model =>
      model.id === 'heat' ? { ...model, deltaTemperatureK: 100 } : model)
    start = performance.now()
    const physicsEdit = await run({ incremental: {
      baselineRevision: parameterEdit.baselineRevision, physics: { compliantModels },
    } })
    times.physics = performance.now() - start
    assert.notDeepEqual(physicsEdit.displacementFields, parameterEdit.displacementFields)
    assert.deepEqual(physicsEdit.compliant.rigidBaseline, parameterEdit.compliant.rigidBaseline)
    rounds.push(times)
  }
  console.log(JSON.stringify({
    hardware: cpus()[0].model, logicalCpus: cpus().length, os: platform(), release: release(), arch: arch(), node: process.version,
    distribution: input.gdtDistribution, seed: input.seed, samples: input.samples, parts: input.assembly.parts.length,
    mates: input.assembly.mates.length, parameters: input.parameters.length, measurements: input.assembly.measurements.length,
    gdt: input.assembly.gdt.length, compliantModels: input.assembly.physics.compliantModels.length, rounds,
  }, null, 2))
  for (const { full, ...incremental } of rounds) {
    assert.ok(full < 2200, 'Full round trip exceeded 2200 ms')
    assert.ok(Object.values(incremental).every(ms => ms < 350), 'Incremental round trip exceeded 350 ms')
  }
} finally {
  await solver.close()
}
