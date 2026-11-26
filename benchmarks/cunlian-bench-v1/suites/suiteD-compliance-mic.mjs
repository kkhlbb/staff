import '../../../mcp/register-ts.mjs'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { bimetalCurvature, preparePlate } from '../../../src/core/solver/compliance.mjs'
import { createSimulation } from '../../../src/core/solver/multivariate.mjs'
import { evaluateMicBatch, parseAndValidateMicMatrix } from '../../../src/core/solver/mic.mjs'
import { face, model, part, point } from '../../../src/core/solver/test/fixture.ts'
import { check, measure, result } from '../run.mjs'
import { fullWorkload } from './suiteC-gdt-accuracy.mjs'

const relative = (actual, expected) => Math.abs(actual - expected) / Math.abs(expected)
const aluminium = { youngsModulusMpa: 68900, thermalExpansionPerK: 23.6e-6, poissonRatio: 0.33 }
const steel = { youngsModulusMpa: 206000, thermalExpansionPerK: 11.7e-6, poissonRatio: 0.29 }

function solve(assembly, materials, compliantModels, seed) {
  assembly.physics = { materials: materials.map(material => ({ deltaTemperatureK: 0, ...material })), compliantModels }
  return createSimulation(0)({ assembly, samples: 1, seed, parameters: [], gdtDistribution: 'uniform' })
}

function displacement(run, partId, position) {
  return run.displacementFields.find(field => field.partId === partId).samples
    .find(sample => sample.posMm.every((value, index) => value === position[index])).dispMm
}

function axial(seed) {
  const lengthMm = 10
  const effectiveAreaMm2 = 25
  const preloadN = 1400
  const springbackRatio = 0.25
  const end = face('tip', 'spacer', [0, 0, 100000], [0, 0, 1])
  const assembly = model([part('spacer')], [end, point('base', 'spacer', [0, 0, 0])])
  const run = solve(assembly, [{ partId: 'spacer', ...steel }], [{
    kind: 'axial-compression', id: 'preload', partId: 'spacer', featureId: 'tip',
    lengthMm, effectiveAreaMm2, preloadN, springbackRatio,
  }], seed)
  const expectedMm = -preloadN * lengthMm * (1 - springbackRatio) / (steel.youngsModulusMpa * effectiveAreaMm2)
  const actualMm = displacement(run, 'spacer', [0, 0, 10])[2]
  const relativeError = relative(actualMm, expectedMm)
  return check(relativeError < 0.005, { expectedMm, actualMm, relativeError },
    'Axial compression with rebound differs from FL(1-r)/EA.')
}

function beams(seed) {
  const spanMm = 40
  const forceN = 30
  const inertiaMm4 = 25
  const cases = [
    ['cantilever', spanMm, aluminium, 3],
    ['simply-supported', spanMm / 2, steel, 48],
  ].map(([kind, x, material, factor]) => {
    const up = [0, 0, 1]
    const assembly = model([part('datum'), part('beam')], [
      face('fixed', 'datum', [0, 0, 0], up), face('load', 'beam', [x * 10000, 0, 0], up),
    ])
    assembly.measurements = [{ id: 'angle', kind: 'angle', featureIds: ['fixed', 'load'] }]
    const run = solve(assembly, [{ partId: 'beam', ...material }], [{
      kind: 'beam-bending', id: 'bending', partId: 'beam', loadFeatureId: 'load',
      supportKind: kind, spanMm, momentOfInertiaMm4: inertiaMm4, forceN,
    }], seed)
    const ei = material.youngsModulusMpa * inertiaMm4
    const actualMm = displacement(run, 'beam', [x, 0, 0])[2]
    const actualAngleRad = run.measurements.find(item => item.measurementId === 'angle').mean
    const expectedMm = forceN * spanMm ** 3 / (factor * ei)
    const expectedAngleRad = kind === 'cantilever' ? forceN * spanMm ** 2 / (2 * ei) : 0
    return { kind, actualMm, expectedMm, actualAngleRad, expectedAngleRad,
      relativeError: Math.max(relative(actualMm, expectedMm),
        expectedAngleRad === 0 ? (actualAngleRad === 0 ? 0 : 1) : relative(actualAngleRad, expectedAngleRad)) }
  })
  return check(cases.every(item => item.relativeError < 0.005), { implementations: 'createSimulation beam-bending displacement and angle', beams: cases },
    'Beam displacement or rotation differs from the independent closed form.')
}

function thermal(seed) {
  const deltaTemperatureK = 65
  const length = 40
  const t1 = 1.5
  const t2 = 2
  const assembly = model([part('aluminium'), part('steel')], [
    point('origin', 'aluminium', [0, 0, 0]), point('end', 'aluminium', [400000, 0, 0]),
    point('al-top', 'aluminium', [0, 0, 15000]), point('steel-base', 'steel', [0, 0, 0]),
    point('steel-top', 'steel', [0, 0, 20000]),
  ])
  const materials = [{ partId: 'aluminium', ...aluminium }, { partId: 'steel', ...steel }]
  const spec = { kind: 'thermal-expansion', id: 'thermal', partIds: ['aluminium', 'steel'],
    referenceFeatureId: 'origin', deltaTemperatureK }
  const free = solve(assembly, materials, [spec], seed)
  const bonded = solve(assembly, materials, [{ ...spec, bimetallicCoupling: true }], seed)
  const growthMm = displacement(free, 'aluminium', [length, 0, 0])[0]
  const bendMm = displacement(bonded, 'aluminium', [length, 0, 0])[2]
  const expectedGrowthMm = aluminium.thermalExpansionPerK * deltaTemperatureK * length
  // Integrate E, Ez and Ez² across the unequal layers and solve the
  // zero-resultant-force/zero-resultant-moment equations for free curvature.
  const e1 = aluminium.youngsModulusMpa
  const e2 = steel.youngsModulusMpa
  const a = e1 * t1 + e2 * t2
  const b = (e1 * t1 ** 2 - e2 * t2 ** 2) / 2
  const d = (e1 * t1 ** 3 + e2 * t2 ** 3) / 3
  const n = e1 * aluminium.thermalExpansionPerK * t1 + e2 * steel.thermalExpansionPerK * t2
  const m = (e1 * aluminium.thermalExpansionPerK * t1 ** 2 - e2 * steel.thermalExpansionPerK * t2 ** 2) / 2
  const expectedCurvaturePerMm = deltaTemperatureK * (a * m - b * n) / (a * d - b ** 2)
  const curvaturePerMm = deltaTemperatureK * bimetalCurvature(aluminium, steel, t1, t2)
  const expectedBendMm = expectedCurvaturePerMm * length ** 2 / 2
  const growthRelativeError = relative(growthMm, expectedGrowthMm)
  const bendRelativeError = relative(bendMm, expectedBendMm)
  const curvatureRelativeError = relative(curvaturePerMm, expectedCurvaturePerMm)
  return check(growthRelativeError < 0.005 && bendRelativeError < 0.05 && curvatureRelativeError < 0.05,
    { growthMm, expectedGrowthMm, bendMm, expectedBendMm, curvaturePerMm, expectedCurvaturePerMm,
      growthRelativeError, bendRelativeError, curvatureRelativeError },
    'Thermal growth or free bilayer bend differs from the independent analytical result.')
}

function plate() {
  const geometry = JSON.parse(readFileSync(new URL('../fixtures/suiteD/plate.json', import.meta.url), 'utf8'))
  const { clampsMm, probesMm, thicknessMm, warpMm, material, source } = geometry
  const spec = { points: clampsMm, footprint: probesMm, material, boundaryKind: 'simply-supported' }
  const unconstrained = preparePlate({ ...spec, thickness: thicknessMm })
  const residual = (solution, p, warp) => {
    const [[initial], [correction]] = solution.at(p)
    const clipped = Math.min(Math.abs(warp), solution.maxCorrection) * Math.sign(warp)
    return initial * warp + correction * clipped
  }
  const lockedResidualsMm = clampsMm.map(p => residual(unconstrained, p, warpMm))
  const thicknessSweep = [1.25, thicknessMm, 2].map(thickness => {
    const solution = preparePlate({ ...spec, thickness, clampForceN: 10 })
    return { thickness, rigidity: solution.rigidity, centerResidualMm: residual(solution, [0, 0], warpMm) }
  })
  const warpSweep = [0.14, 0.21, warpMm].map(warp => residual(unconstrained, [0, 0], warp))
  const monotone = values => values.every((value, index) => index === 0 || value > values[index - 1])
  const locked = lockedResidualsMm.every(value => Math.abs(value) <= 1e-10)
  const pass = locked && monotone(thicknessSweep.map(item => item.centerResidualMm)) && monotone(warpSweep)
  const metrics = { source, lockedResidualsMm, thicknessSweep, warpSweep,
    rigidClampField: probesMm.map(point => ({ point, residualMm: residual(unconstrained, point, warpMm) })) }
  if (!pass) return check(false, metrics, 'Plate clamp residual or force-limited monotonicity violated.')
  const ccx = spawnSync('which', ['ccx'], { encoding: 'utf8' })
  return { status: ccx.status === 0 ? 'SKIPPED_EXTERNAL_ASSET' : 'SKIPPED_NO_CCX',
    reason: 'No provenance-locked FEA displacement field or equivalent CalculiX input deck is available' +
      (ccx.status === 0 ? '.' : ', and ccx was not found on PATH.'), metrics }
}

function mic(rows, cols, samples) {
  const points = count => Array.from({ length: count }, (_, i) => [i, 0, 0])
  const coefficients = points(rows).map((_, r) => points(cols).map((_, c) =>
    ((17 * r + 13 * c) % 91 - 45) * 2 ** -14))
  const matrix = parseAndValidateMicMatrix({ schemaVersion: 1, partId: 'cover', units: 'mm', forceUnits: 'N',
    controlPointsMm: points(cols), measurePointsMm: points(rows), sensitivityMatrix: coefficients })
  const loads = Float64Array.from({ length: cols * samples }, (_, i) => ((i * 19) % 113 - 56) / 8)
  const start = performance.now()
  const output = evaluateMicBatch(matrix, loads)
  const batchMs = performance.now() - start
  let maxAbsoluteErrorMm = 0
  let maxRelativeError = 0
  for (let i = 0; i < samples; i++) {
    for (let r = 0; r < rows; r++) {
      // Dyadic inputs allow a separate exact integer dot product in units of 2^-17 mm.
      const integerDot = coefficients[r].reduce((acc, value, c) => acc +
        (value * 2 ** 14) * (loads[i * cols + c] * 8), 0)
      const expected = integerDot * 2 ** -17
      const error = Math.abs(output.displacements[i * rows + r] - expected)
      maxAbsoluteErrorMm = Math.max(maxAbsoluteErrorMm, error)
      maxRelativeError = Math.max(maxRelativeError, expected === 0 ? (error === 0 ? 0 : 1) : error / Math.abs(expected))
    }
  }
  return { rows, cols, samples, batchMs, maxRelativeError, maxAbsoluteErrorMm }
}

export async function runSuite({ seed = 20261126, samples = 50000 } = {}) {
  const start = performance.now()
  const cases = [
    await measure('D1', 'Axial compression and rebound', { relativeErrorLt: 0.005 }, () => axial(seed)),
    await measure('D2', 'Cantilever and simply supported beam', { relativeErrorLt: 0.005 }, () => beams(seed)),
    await measure('D3', 'Thermal growth and bilayer bending', { growthRelativeErrorLt: 0.005, bendRelativeErrorLt: 0.05 }, () => thermal(seed)),
    await measure('D4', 'Warped four-corner cover plate', { maxClampResidualMm: 1e-10, strictMonotonicity: true }, plate),
    await measure('D5', 'MIC precision, batch and compliant throughput', {
      relativeErrorLt: 1e-9, samples: 50000, micBatchMsLt: 50, coupledMsLt: 2200,
    }, async () => {
      if (samples !== 50000) return { status: 'SKIPPED_EXTERNAL_ASSET', reason: 'Performance gate requires exactly 50000 samples' }
      const batch16x6 = mic(16, 6, samples)
      const accuracy64x12 = mic(64, 12, 256)
      const coupled = await fullWorkload({ seed, samples, compliant: true })
      return check(batch16x6.maxRelativeError < 1e-9 && accuracy64x12.maxRelativeError < 1e-9 &&
        batch16x6.batchMs < 50 && coupled.fullMs < 2200,
      { batch16x6, accuracy64x12, coupled }, 'MIC precision or the production MIC/compliant workload exceeded its gate.')
    }),
  ]
  return result('D', 'Compliance and MIC', 'Roark, thermal beam theory, and Liu & Hu-style fixture', start, cases)
}
