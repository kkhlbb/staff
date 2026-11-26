import assert from 'node:assert/strict'
import { arch, cpus, platform, release } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createSolverScheduler } from '../solverScheduler.mjs'
import { compliantFixture } from './compliantFixture.mjs'

const solver = createSolverScheduler(process.argv[2] && pathToFileURL(process.argv[2]))
const input = compliantFixture()
input.gdtDistribution = process.env.GDT_DISTRIBUTION ?? 'normal'
const rounds = []
const run = inputs => solver.run({ kind: 'multivariate', inputs })
try {
  for (let i = 0; i < 6; i++) {
    const times = {}
    let start = performance.now()
    let result = await run(input)
    times.full = performance.now() - start
    assert.equal(result.status, 'ok')
    assert.equal(result.gdt.compliant.contributions.length, 7)
    assert.equal(result.compliant.flexContributionItems.length, 4)
    assert.equal(result.measurements.length, 5)
    assert.notDeepEqual(result.compliant.rigidBaseline, result.compliant.compliantResult)
    let models = input.assembly.physics.compliantModels
    for (const [name, id, change] of [['preload', 'preload', { preloadN: 7000 }],
      ['warp', 'clamp', { initialWarpPeakQ: 1050 }], ['temperature', 'heat', { deltaTemperatureK: 100 }]]) {
      models = models.map(model => model.id === id ? { ...model, ...change } : model)
      const prior = result
      start = performance.now()
      result = await run({ incremental: { baselineRevision: result.baselineRevision, physics: { compliantModels: models } } })
      times[name] = performance.now() - start
      assert.equal(result.compliant.flexContributionItems.length, 4)
      assert.notDeepEqual(result.measurements, prior.measurements)
      assert.notDeepEqual(result.displacementFields, prior.displacementFields)
      assert.deepEqual(result.compliant.rigidBaseline, prior.compliant.rigidBaseline)
    }
    for (const enabled of [false, true]) {
      start = performance.now()
      result = await run({ incremental: { baselineRevision: result.baselineRevision, physics: { enabled } } })
      times[enabled ? 'on' : 'off'] = performance.now() - start
      assert.equal(Boolean(result.compliant), enabled)
    }
    const disabled = await run({ ...input, assembly: { ...input.assembly, physics: { ...input.assembly.physics, enabled: false } } })
    start = performance.now()
    const first = await run({ incremental: { baselineRevision: disabled.baselineRevision, physics: { enabled: true } } })
    times.firstEnable = performance.now() - start
    assert.equal(first.compliant.flexContributionItems.length, 4)
    rounds.push(times)
  }
  console.log(JSON.stringify({
    hardware: cpus()[0].model, logicalCpus: cpus().length, os: platform(), release: release(), arch: arch(), node: process.version,
    distribution: input.gdtDistribution, samples: input.samples, parts: input.assembly.parts.length, mates: input.assembly.mates.length,
    parameters: input.parameters.length, measurements: input.assembly.measurements.length, gdt: input.assembly.gdt.length,
    compliantModels: input.assembly.physics.compliantModels.length, rounds,
  }, null, 2))
  for (const { full, ...incremental } of rounds) {
    assert.ok(full < 2200, 'Full round trip exceeded 2200 ms')
    assert.ok(Object.values(incremental).every(ms => ms < 350), 'Incremental round trip exceeded 350 ms')
  }
} finally {
  await solver.close()
}
