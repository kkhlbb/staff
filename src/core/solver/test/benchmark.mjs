import assert from 'node:assert/strict'
import { cpus, platform, arch, release } from 'node:os'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { createSolverScheduler } from '../solverScheduler.mjs'
import { fixture } from './fixture.ts'

const solver = createSolverScheduler(process.argv[2] && pathToFileURL(process.argv[2]))
const input = fixture()
const fullMs = []
const incrementalMs = []
try {
  for (let i = 0; i < 6; i++) {
    const start = performance.now()
    const baseline = await solver.run({ kind: 'multivariate', inputs: input })
    fullMs.push(performance.now() - start)
    assert.equal(baseline.status, 'ok')
    const next = performance.now()
    const result = await solver.run({ kind: 'multivariate', inputs: { incremental: {
      baselineRevision: baseline.baselineRevision,
      parameter: { ...input.parameters[3], sigmaRad: 0.007, lowerRad: -0.021, upperRad: 0.021 },
    } } })
    incrementalMs.push(performance.now() - next)
    assert.deepEqual(result.recalculatedMeasurementIds, ['gap', 'flush', 'angle'])
  }
  console.log(JSON.stringify({ hardware: cpus()[0].model, logicalCpus: cpus().length, os: platform(), arch: arch(),
    release: release(), node: process.version, parts: input.assembly.parts.length, mates: input.assembly.mates.length,
    parameters: input.parameters.length, measurements: input.assembly.measurements.length, samples: input.samples,
    fullMs, incrementalMs }, null, 2))
  assert.ok(Math.max(...fullMs) < 1500)
  assert.ok(Math.max(...incrementalMs) < 300)
} finally {
  await solver.close()
}
