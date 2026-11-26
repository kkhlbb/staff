import assert from 'node:assert/strict'
import { cpus, platform, arch, release } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createSolverScheduler } from '../solverScheduler.mjs'
import { gdtFixture } from './gdtFixture.mjs'

const solver = createSolverScheduler(process.argv[2] && pathToFileURL(process.argv[2]))
const input = gdtFixture()
if (process.env.GDT_DISTRIBUTION !== undefined) input.gdtDistribution = process.env.GDT_DISTRIBUTION
const fullMs = []
const editsMs = []
const run = inputs => solver.run({ kind: 'multivariate', inputs })
try {
  for (let i = 0; i < 6; i++) {
    const start = performance.now()
    let result = await run(input)
    fullMs.push(performance.now() - start)
    assert.equal(result.status, 'ok')
    assert.equal(result.gdt.baseline.contributions.length, 6)
    for (const { id: gdtId, toleranceQ } of input.assembly.gdt) {
      for (const edit of [{ toleranceQ: toleranceQ + 50 }, { modifier: 'MMC' }, { modifier: 'LMC' }, { modifier: 'RFS' }]) {
        const next = performance.now()
        result = await run({ incremental: { baselineRevision: result.baselineRevision, edits: [{ gdtId, ...edit }] } })
        editsMs.push(performance.now() - next)
        assert.deepEqual(result.gdt.recalculatedGdtIds, [gdtId])
      }
    }
  }
  const sorted = editsMs.toSorted((a, b) => a - b)
  console.log(JSON.stringify({
    hardware: cpus()[0].model, logicalCpus: cpus().length, os: platform(), arch: arch(), release: release(), node: process.version,
    distribution: input.gdtDistribution ?? 'uniform', samples: input.samples, parts: input.assembly.parts.length, mates: input.assembly.mates.length,
    parameters: input.parameters.length, measurements: input.assembly.measurements.length, gdt: input.assembly.gdt.length,
    fullMs, editCount: editsMs.length, editP95Ms: sorted[Math.ceil(0.95 * sorted.length) - 1], editMaxMs: sorted.at(-1),
  }, null, 2))
  assert.ok(Math.max(...fullMs) < 1800)
  assert.ok(Math.max(...editsMs) < 350)
} finally {
  await solver.close()
}
