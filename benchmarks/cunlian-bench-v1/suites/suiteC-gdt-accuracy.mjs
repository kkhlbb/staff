import '../../../mcp/register-ts.mjs'
import { calculateChain } from '../../../src/domain/calculate.ts'
import { createRng, monteCarloOf, rssOf } from '../../../src/domain/statistics.ts'
import { evaluateGdt, prepareGdt, sampleSdt, zoneError } from '../../../src/core/solver/gdt.mjs'
import { scene } from '../../../src/core/solver/spatial.mjs'
import { createSolverScheduler } from '../../../src/core/solver/solverScheduler.mjs'
import { advancedGdtFixture } from '../../../src/core/solver/test/advancedGdtFixture.mjs'
import { axis, face, model, part } from '../../../src/core/solver/test/fixture.ts'
import { check, measure, result } from '../run.mjs'

const relative = (actual, expected) => Math.abs(actual - expected) / Math.abs(expected)
const up = [0, 0, 1]
export const axialChain = {
  target: null, assumptions: 'Independent normal deviations for the axial clearance loop.',
  terms: [
    ['housing-seat', 480000, -200, 200, 1],
    ['shaft-shoulder', 300000, -120, 120, -1],
    ['bearing', 120000, -80, 80, -1],
    ['spacer', 45000, -50, 50, -1],
    ['end-cap', 12000, -30, 30, -1],
  ].map(([id, nominalQ, lowerDeviationQ, upperDeviationQ, sign]) => ({
    id, name: id, symbol: id, sourceNote: 'Synthetic benchmark dimensions', termRevision: 1,
    nominalQ, lowerDeviationQ, upperDeviationQ, sign,
  })),
}

function axial(seed, samples) {
  const { nominalQ, minQ, maxQ } = calculateChain(axialChain)
  const expected = { nominalQ: 3000, minQ: 2520, maxQ: 3480,
    rss3SigmaQ: Math.hypot(200, 120, 80, 50, 30) }
  const rss = rssOf(axialChain, nominalQ).halfWidthQ
  const mc = monteCarloOf(axialChain, nominalQ, { seed, samples, distribution: 'normal' })
  const relativeError = relative(mc.halfWidthQ, expected.rss3SigmaQ)
  const maxErrorQ = Math.max(Math.abs(nominalQ - expected.nominalQ),
    Math.abs(minQ - expected.minQ), Math.abs(maxQ - expected.maxQ))
  return check(maxErrorQ === 0 && relative(rss, expected.rss3SigmaQ) < 1e-12 && relativeError < 0.015,
    { nominalQ, minQ, maxQ, rss3SigmaQ: rss, mc3SigmaQ: mc.halfWidthQ, expected, maxErrorQ, relativeError },
    'Integer stack or sampled spread is outside the independent closed-form reference.')
}

function holePattern(composite) {
  const holes = ['h1', 'h2', 'h3', 'h4']
  const coordinates = [[-200000, -100000, 0], [200000, -100000, 0],
    [200000, 100000, 0], [-200000, 100000, 0]]
  const assembly = model([part('fixed-plate'), part('floating-plate')], [
    face('seat', 'fixed-plate', [0, 0, 0], up),
    axis('pilot', 'fixed-plate', [0, 0, 0], up, 50000),
    axis('clock', 'fixed-plate', [300000, 0, 0], up, 25000),
    ...holes.map((id, i) => axis(id, 'floating-plate', coordinates[i], up, 30000)),
  ])
  assembly.datums = [
    { id: 'A', featureId: 'seat' },
    { id: 'B', featureId: 'pilot', sizeToleranceQ: { lowerQ: 0, upperQ: 2000 } },
    { id: 'C', featureId: 'clock' },
  ]
  assembly.gdt = (composite ? holes : holes.slice(0, 2)).map(featureId => ({
    id: featureId, featureId, datumIds: ['A', 'B', 'C'],
    ...(composite ? { kind: 'composite-position', toleranceQ: 4000,
      patternGroupId: 'cover', lowerSegment: { toleranceQ: 1000, datumIds: ['A'], modifier: 'RFS' } }
      : { kind: 'position', toleranceQ: 2000, modifier: 'MMC',
        datumModifiers: ['RFS', 'MMC', 'RFS'], featureSizeToleranceQ: { lowerQ: 0, upperQ: 1000 } }),
  }))
  return assembly
}

function samplePattern(composite, seed, samples) {
  const assembly = holePattern(composite)
  const parameters = new Map()
  const prepared = prepareGdt(assembly, scene(assembly), parameters, new Map(), samples, seed, {}, 'uniform', true)
  const scored = evaluateGdt(prepared, parameters)
  if (scored.draws.size !== assembly.gdt.length) throw Error(JSON.stringify(scored.metrics.warnings))
  return { ...prepared, ...scored }
}

function mmc(seed, samples) {
  const { entries, draws, metrics } = samplePattern(false, seed, samples)
  if (entries.some(entry => !entry.group?.motion)) throw Error('Missing sampled datum motion')
  const expectedWidthMm = 0.2 + 0.1 / 2
  const widthsMm = metrics.contributions.map(item => 0.2 + item.bonusMeanMm)
  const relativeError = Math.max(...widthsMm.map(width => relative(width, expectedWidthMm)))
  let matching = 0
  let nonzero = 0
  let maxProjectionError = 0
  const stride = 6
  for (let i = 0; i < samples; i++) {
    const offset = i * stride
    const a = entries[0].group.motion.subarray(offset, offset + stride)
    const b = entries[1].group.motion.subarray(offset, offset + stride)
    if (a.some(value => value !== 0)) nonzero++
    if (a.every((value, j) => value === b[j])) matching++
    for (const entry of entries) {
      const [x, y, z] = entry.lever
      const [tx, ty, tz, rx, ry, rz] = a
      const shift = [tx + ry * z - rz * y, ty + rz * x - rx * z, tz + rx * y - ry * x]
      const projected = [...entry.axes.slice(0, 2).map(axis =>
        axis[0] * shift[0] + axis[1] * shift[1] + axis[2] * shift[2]),
      ...entry.axes.slice(0, 2).map(axis => axis[0] * rx + axis[1] * ry + axis[2] * rz)]
      const kinematics = draws.get(entry.control.id).kinematics
      for (let j = 0; j < projected.length; j++) {
        maxProjectionError = Math.max(maxProjectionError, Math.abs(projected[j] - kinematics[i * 9 + 5 + j]))
      }
    }
  }
  const coupledFraction = matching / samples
  return check(relativeError < 0.02 && coupledFraction === 1 && nonzero > 0 && maxProjectionError <= 1e-12 && draws.size === 2,
    { widthsMm, expectedWidthMm, relativeError, coupledFraction, maxProjectionError, nonzeroDatumDraws: nonzero,
      couplingBasis: 'Shared world-space rigid twist, before projection at individual holes' },
    'MMC mean or common datum motion differs from the expected result.')
}

function runout(seed, samples) {
  const tolerance = 0.2
  const span = 40
  const rng = createRng(seed)
  const maxima = { coaxiality: 0, 'circular-runout': 0, 'total-runout': 0 }
  let orderingViolations = 0
  let maxReferenceErrorMm = 0
  let fullExceedsFirstSection = 0
  for (let i = 0; i < samples; i++) {
    for (const kind of ['coaxiality', 'circular-runout', 'total-runout']) {
      const { center: [u, v, , alpha, beta], form } = sampleSdt(kind, 'cylindrical', tolerance, span, rng)
      const error = zoneError(kind, 'cylindrical', span, u, v, alpha, beta, form)
      maxima[kind] = Math.max(maxima[kind], error)
      const ends = kind === 'circular-runout' ? [0] : [-span / 2, span / 2]
      const radii = ends.map(end => Math.sqrt((u + beta * end) ** 2 + (v - alpha * end) ** 2))
      maxReferenceErrorMm = Math.max(maxReferenceErrorMm, Math.abs(error - (2 * form + 2 * Math.max(...radii))))
      if (kind === 'total-runout') {
        const [first, last] = ends.map(end => zoneError('circular-runout', 'cylindrical', span,
          u + beta * end, v - alpha * end, 0, 0, form))
        if (first > error || last > error) orderingViolations++
        if (error > first) fullExceedsFirstSection++
      }
    }
  }
  const maxRelativeError = Math.max(...Object.values(maxima).map(value => relative(value, tolerance)))
  return check(orderingViolations === 0 && fullExceedsFirstSection > 0 &&
    maxRelativeError < 0.02 && maxReferenceErrorMm / tolerance < 0.02, {
    maxima, analyticalMaxMm: tolerance, maxRelativeError, orderingViolations, maxReferenceErrorMm, fullExceedsFirstSection,
    implementation: 'sampleSdt and zoneError, comparing matched end cross sections',
  }, 'Runout envelope ordering or endpoint bounds differ from the analytical result.')
}

function composite(seed, samples) {
  const { entries, draws } = samplePattern(true, seed, samples)
  const upper = entries.map(entry => draws.get(entry.control.id).kinematics)
  const lower = entries.map(entry => draws.get(entry.control.id).lower.kinematics)
  let maxCentroidDriftMm = 0
  let maxPairDistanceErrorMm = 0
  let maxUpperZoneMm = 0
  let maxLowerZoneMm = 0
  for (let i = 0; i < samples; i++) {
    const offset = i * 5
    const displacement = (axes, draws, axis) =>
      axes[0][axis] * draws[offset] + axes[1][axis] * draws[offset + 1]
    const centroid = [0, 1, 2].map(axis => entries.reduce((sum, entry, member) =>
      sum + displacement(entry.axes, upper[member], axis), 0) / entries.length)
    maxCentroidDriftMm = Math.max(maxCentroidDriftMm, Math.hypot(...centroid))
    for (let j = 0; j < entries.length; j++) {
      const a = entries[j].world.point
      for (let k = j + 1; k < entries.length; k++) {
        const b = entries[k].world.point
        const nominal = b.map((value, axis) => value - a[axis])
        const displaced = nominal.map((value, axis) => value +
          displacement(entries[k].lower.axes, lower[k], axis) -
          displacement(entries[j].lower.axes, lower[j], axis))
        maxPairDistanceErrorMm = Math.max(maxPairDistanceErrorMm, Math.abs(Math.hypot(...displaced) - Math.hypot(...nominal)))
      }
      const draw = draws.get(entries[j].control.id)
      maxUpperZoneMm = Math.max(maxUpperZoneMm, draw.errors[i])
      maxLowerZoneMm = Math.max(maxLowerZoneMm, draw.lower.errors[i])
    }
  }
  return check(maxCentroidDriftMm <= 0.2 && maxPairDistanceErrorMm <= 0.1 &&
    maxUpperZoneMm <= 0.4 && maxLowerZoneMm <= 0.1,
  { maxCentroidDriftMm, maxPairDistanceErrorMm, maxUpperZoneMm, maxLowerZoneMm },
  'The four-hole pattern exceeds an upper or lower segment bound.')
}

function profile(seed, samples) {
  const rng = createRng(seed)
  const span = 80
  const tolerance = 0.4
  let meanOffsetMm = 0
  let minProfileSurfaceMm = Infinity
  let maxProfileSurfaceMm = -Infinity
  let maxProjectionErrorMm = 0
  const maxima = {}
  for (const kind of ['profile-surface', 'flatness', 'cylindricity', 'perpendicularity', 'parallelism']) {
    const zone = kind === 'profile-surface' ? 'planar' : 'local'
    let max = 0
    for (let i = 0; i < samples; i++) {
      const { center, form } = sampleSdt(kind, zone, tolerance, span, rng, 'uniform', 0.75)
      const tilt = span * Math.sqrt(center[3] ** 2 + center[4] ** 2)
      const error = zoneError(kind, zone, span, center[2], 0, center[3], center[4], form, 0.75)
      if (kind === 'profile-surface') {
        meanOffsetMm += center[2] / samples
        minProfileSurfaceMm = Math.min(minProfileSurfaceMm, center[2] - (form + tilt) / 2)
        maxProfileSurfaceMm = Math.max(maxProfileSurfaceMm, center[2] + (form + tilt) / 2)
      }
      if (kind === 'perpendicularity' || kind === 'parallelism') {
        maxProjectionErrorMm = Math.max(maxProjectionErrorMm, Math.abs(error - tilt))
      }
      max = Math.max(max, error)
    }
    maxima[kind] = max
  }
  const expectedMeanMm = (0.75 - 0.5) * tolerance
  const relativeError = relative(meanOffsetMm, expectedMeanMm)
  const orientationBounds = Object.fromEntries(['perpendicularity', 'parallelism'].map(kind => [
    kind, zoneError(kind, 'local', span, 0, 0, tolerance / span, 0),
  ]))
  const asymmetricBoundsMm = [-0.25 * tolerance, 0.75 * tolerance]
  return check(relativeError < 0.02 && Object.values(maxima).every(max => max > 0 && max <= tolerance) &&
    minProfileSurfaceMm >= asymmetricBoundsMm[0] - 1e-12 &&
    maxProfileSurfaceMm <= asymmetricBoundsMm[1] + 1e-12 && maxProjectionErrorMm <= 1e-12 &&
    Object.values(orientationBounds).every(bound => relative(bound, tolerance) <= Number.EPSILON),
  { meanOffsetMm, expectedMeanMm, relativeError, maxima, spanMm: span, orientationBounds,
    asymmetricBoundsMm, observedProfileEnvelopeMm: [minProfileSurfaceMm, maxProfileSurfaceMm], maxProjectionErrorMm },
  'Profile centroid, form, or span projection differs from the analytical bound.')
}

export async function fullWorkload({ seed, samples, compliant, whatIf = false }) {
  const input = { ...advancedGdtFixture(), seed, samples }
  if (!compliant) delete input.assembly.physics
  const kinds = new Set(input.assembly.gdt.map(control => control.kind))
  if (kinds.size !== 10) throw Error('Workload does not include 10 GD&T kinds')
  const scheduler = createSolverScheduler()
  const run = inputs => scheduler.run({ kind: 'multivariate', inputs })
  try {
    const start = performance.now()
    const baseline = await run(input)
    const fullMs = performance.now() - start
    const compliantKinds = baseline.compliant?.flexContributionItems.map(item => item.kind) ?? []
    if (baseline.status !== 'ok' || !baseline.measurements?.length ||
      baseline.gdt?.baseline.contributions.length !== input.assembly.gdt.length ||
      (compliant && (compliantKinds.length !== 4 ||
        !["axial-compression", "plate-clamping", "beam-bending", "thermal-expansion"].every(kind =>
          compliantKinds.includes(kind))))) throw Error('Incomplete benchmark result')
    const incrementalMs = {}
    let prior = baseline
    if (whatIf) {
      for (const modifier of ['MMC', 'RFS']) {
        const start = performance.now()
        prior = await run({ incremental: { baselineRevision: prior.baselineRevision,
          edits: [{ gdtId: 'position', modifier }] } })
        incrementalMs[modifier] = performance.now() - start
        if (!prior.gdt?.recalculatedGdtIds.includes('position')) throw Error('What-If did not recalculate position')
        const bonus = prior.gdt.whatIf.contributions.find(item => item.gdtId === 'position')?.bonusMeanMm
        if (modifier === 'MMC' ? !(bonus > 0) : bonus !== 0) throw Error('What-If modifier did not affect material bonus')
      }
    }
    return { fullMs, incrementalMs, samples, gdtKinds: kinds.size, measurements: baseline.measurements.length,
      compliantModels: compliantKinds.length, compliantKinds }
  } finally {
    await scheduler.close()
  }
}

export async function runSuite({ seed = 20261126, samples = 50000 } = {}) {
  const start = performance.now()
  const cases = [
    await measure('C1', 'Axial clearance', { maxErrorQ: 0, relativeErrorLt: 0.015 }, () => axial(seed, samples)),
    await measure('C2', 'MMC bonus and shared datum shift', { relativeErrorLt: 0.02, coupledFraction: 1 }, () => mmc(seed, samples)),
    await measure('C3', 'Coaxiality and matched runout', { relativeErrorLt: 0.02, orderingViolations: 0 }, () => runout(seed, samples)),
    await measure('C4', 'Four-hole composite position', { centroidMaxMm: 0.2, pairErrorMaxMm: 0.1 }, () => composite(seed, samples)),
    await measure('C5', 'Unequal profile, form and orientation', { relativeErrorLt: 0.02 }, () => profile(seed, samples)),
    await measure('C6', '3D and GD&T performance', { samples: 50000, fullMsLt: 1800, incrementalMsLt: 350 }, async () => {
      if (samples !== 50000) return { status: 'SKIPPED_EXTERNAL_ASSET', reason: 'Performance gate requires exactly 50000 samples' }
      const metrics = await fullWorkload({ seed, samples, compliant: false, whatIf: true })
      return check(metrics.fullMs < 1800 && Object.values(metrics.incrementalMs).every(ms => ms < 350),
        metrics, 'Production solver exceeded the rigid full or incremental time budget.')
    }),
  ]
  return result('C', 'GD&T and dimensional accuracy', 'ASME Y14.5.1 and analytical stack-up', start, cases)
}
