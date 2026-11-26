import { createRng } from '../../domain/statistics.ts'
import { evaluateGdt, prepareGdt } from './gdt.mjs'
import { linearizedMateResponse, solveAssembly } from './assemblySolver.mjs'
import { add, cross, dofs, dot, norm, placed, scene, sub, transverse, turn } from './spatial.mjs'

function standardNormals(seed, count) {
  const rng = createRng(seed)
  const values = new Float64Array(count)
  for (let i = 0; i < count; i += 2) {
    const radius = Math.sqrt(-2 * Math.log(1 - rng.next()))
    const angle = 2 * Math.PI * rng.next()
    values[i] = radius * Math.cos(angle)
    values[i + 1] = radius * Math.sin(angle)
  }
  return values
}

function measurement(spec, geometry, parameters, responseOf) {
  const features = spec.featureIds.map(geometry.feature)
  const [left, right] = features
  const [a, b] = features.map(feature => placed(feature, geometry.poses))
  let measure
  switch (spec.kind) {
    case 'gap':
      measure = left.plane ? (p, q) => dot(p.axis, sub(q.point, p.point))
        : right.plane ? (p, q) => dot(q.axis, sub(p.point, q.point))
          : (p, q) => norm(sub(q.point, p.point))
      break
    case 'flush':
      if (left.plane && right.plane) measure = (p, q) => Math.abs(dot(p.axis, sub(q.point, p.point)))
      break
    case 'center-distance':
      measure = (p, q) => norm(sub(q.point, p.point))
      break
    case 'coaxiality':
      if (left.axial && right.axial) measure = (p, q) => norm(transverse(sub(q.point, p.point), p.axis))
      break
    case 'angle':
      if (a.axis && b.axis) measure = (p, q) => {
        const cosine = dot(p.axis, q.axis)
        return Math.atan2(norm(cross(p.axis, q.axis)), left.axial || right.axial ? Math.abs(cosine) : cosine)
      }
      break
  }
  if (!measure) throw Error('Unsupported measurement geometry: ' + spec.id)
  const changes = parameters.flatMap(parameter => {
    const response = responseOf(parameter.id)
    const effects = features.map((feature, i) => {
      const frame = [a, b][i]
      const step = response.get(feature.part) ?? new Float64Array(6)
      const omega = step.slice(3)
      const shift = add(step, cross(omega, sub(frame.point, geometry.poses[feature.part].translation)))
      const effect = [...shift, ...(frame.axis ? omega : [0, 0, 0])]
      if (parameter.featureId === feature.id && (parameter.index < 3 || frame.axis)) effect[parameter.index]++
      return effect.map(value => Math.abs(value) > 1e-8 ? value : 0)
    })
    return effects.some(effect => effect.some(value => value !== 0)) ? [{ id: parameter.id, effects }] : []
  })
  return { spec, features, a, b, measure, changes, nominal: measure(a, b) }
}

function magnitude(parameter, prefix) {
  return parameter.dof.startsWith('r') ? parameter[prefix + 'Rad'] : parameter[prefix + 'Q'] / 10000
}

function bind(parameter, geometry) {
  const feature = geometry.feature(parameter.featureId)
  if (feature.partId !== parameter.partId || typeof parameter.id !== 'string' || !parameter.id || !dofs.includes(parameter.dof)) {
    throw Error('Invalid tolerance parameter binding')
  }
  const sigma = magnitude(parameter, 'sigma')
  const lower = magnitude(parameter, 'lower')
  const upper = magnitude(parameter, 'upper')
  if (!parameter.dof.startsWith('r') && !['sigmaQ', 'lowerQ', 'upperQ'].every(key => Number.isSafeInteger(parameter[key]))) {
    throw Error('Linear tolerances must use integer q')
  }
  if (![sigma, lower, upper].every(Number.isFinite) || sigma < 0 || lower > 0 || upper < 0) {
    throw Error('Expected nonnegative sigma and a tolerance interval containing zero')
  }
  return { ...parameter, sigma, lower, upper, index: dofs.indexOf(parameter.dof) }
}

function limitFor(limits, id) {
  const limit = Object.hasOwn(limits, id) ? limits[id] : null
  if (limit && (!Number.isFinite(limit.lower) || !Number.isFinite(limit.upper) || limit.lower >= limit.upper)) {
    throw Error('Expected increasing finite specification limits: ' + id)
  }
  return limit
}

function changedFrame(frame, delta) {
  return {
    point: add(frame.point, delta),
    axis: frame.axis && turn(frame.axis, [delta[3], delta[4], delta[5]]),
  }
}

function evaluator(m, parameters) {
  const left = new Float64Array(6)
  const right = new Float64Array(6)
  const effects = m.changes.map(change => change.effects)
  const sameFeature = m.features[0].id === m.features[1].id
  return valueAt => {
    left.fill(0)
    right.fill(0)
    for (let i = 0; i < parameters.length; i++) {
      const value = valueAt(parameters[i], i)
      const [a, b] = effects[i]
      for (let j = 0; j < 6; j++) {
        left[j] += a[j] * value
        right[j] += b[j] * value
      }
    }
    const a = changedFrame(m.a, left)
    return m.measure(a, sameFeature ? a : changedFrame(m.b, right))
  }
}

function extremes(evaluate, parameters, nominal) {
  let min = nominal
  let max = nominal
  const consider = value => {
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  // Probe each tolerance in isolation as well as simultaneous endpoints.
  for (let i = 0; i < parameters.length; i++) {
    consider(evaluate((parameter, j) => i === j ? parameter.lower : 0))
    consider(evaluate((parameter, j) => i === j ? parameter.upper : 0))
  }
  const exhaustive = parameters.length <= 10
  const rng = createRng(0)
  for (let i = 0; i < (exhaustive ? 2 ** parameters.length : 1024); i++) {
    consider(evaluate((parameter, j) => (exhaustive ? (i >>> j) & 1 : rng.next() < 0.5) ? parameter.lower : parameter.upper))
  }
  return { min, max, method: exhaustive ? 'nominal-axis-and-corners' : 'nominal-axis-and-sampled-corners', guaranteedBounds: false }
}

function sampleMeasurement(m, allParameters, samples, bins, limit) {
  const parameters = m.changes.map(change => allParameters.get(change.id))
  const evaluate = evaluator(m, parameters)
  const values = new Float64Array(samples)
  let mean = 0
  let m2 = 0
  let min = Infinity
  let max = -Infinity
  let failures = 0
  for (let i = 0; i < samples; i++) {
    const value = evaluate(parameter => parameter.draws[i] * parameter.sigma)
    values[i] = value
    const delta = value - mean
    mean += delta / (i + 1)
    m2 += delta * (value - mean)
    min = Math.min(min, value)
    max = Math.max(max, value)
    if (limit && (value < limit.lower || value > limit.upper)) failures++
  }
  const sigma = Math.sqrt(m2 / (samples - 1))
  const counts = Array(bins).fill(0)
  const width = (max - min) / bins
  for (const value of values) counts[width ? Math.min(bins - 1, Math.floor((value - min) / width)) : 0]++
  const contributions = parameters.map(({ id, partId, featureId, draws, sigma: inputSigma }) => {
    // First-order main effect from projections onto Z and (Z²-1)/sqrt(2).
    // The quadratic term captures symmetric offsets such as radial runout.
    let linear = 0
    let quadratic = 0
    if (inputSigma > 0 && sigma > 0) {
      for (let i = 0; i < samples; i++) {
        const z = draws[i]
        const centered = values[i] - mean
        linear += centered * z
        quadratic += centered * (z * z - 1)
      }
    }
    const variance = (linear / samples) ** 2 + (quadratic / samples) ** 2 / 2
    return { parameterId: id, partId, featureId, variance, fraction: sigma > 0 ? variance / sigma ** 2 : 0 }
  }).sort((a, b) => b.variance - a.variance)
  return {
    measurementId: m.spec.id,
    kind: m.spec.kind,
    unit: m.spec.kind === 'angle' ? 'rad' : 'mm',
    nominal: m.nominal,
    extremeEstimate: extremes(evaluate, parameters, m.nominal),
    mean, sigma, threeSigma: { min: mean - 3 * sigma, max: mean + 3 * sigma },
    cp: limit && sigma > 0 ? (limit.upper - limit.lower) / (6 * sigma) : null,
    cpk: limit && sigma > 0 ? Math.min(limit.upper - mean, mean - limit.lower) / (3 * sigma) : null,
    ppm: limit ? failures / samples * 1e6 : null,
    failures: limit ? failures : null,
    histogram: { min, max, width, counts },
    contributionMethod: 'independent-normal-linear-and-quadratic-main-effects',
    contributions,
  }
}

export function createSimulation(workerId) {
  // One bounded baseline per worker. A replacement uses the same draws and
  // returns a new baseline; stale/replayed revisions cannot alter current state.
  let baseline
  let sequence = 0
  const nextRevision = () => workerId + ':' + ++sequence
  return function run(input) {
    if ('incremental' in input) {
      const { baselineRevision, parameter, edits = [] } = input.incremental
      if (!baseline || baseline.revision !== baselineRevision) throw Error('Stale simulation baseline')
      const { geometry, samples, seed, bins, limits, measurements } = baseline
      if (!parameter && !edits.length) throw Error('Expected an incremental tolerance edit')
      const updated = parameter && bind(parameter, geometry)
      const original = updated && baseline.parameters.get(updated.id)
      if (updated && (!original || ['partId', 'featureId', 'dof'].some(key => original[key] !== updated[key]))) {
        throw Error('Incremental recomputation requires the same parameter ID and binding')
      }
      const parameters = updated
        ? new Map(baseline.parameters).set(updated.id, { ...updated, draws: original.draws }) : baseline.parameters
      const recalculatedMeasurementIds = []
      const results = baseline.results.map((result, i) => {
        const m = measurements[i]
        if (!updated || !m.changes.some(change => change.id === updated.id)) return result
        recalculatedMeasurementIds.push(m.spec.id)
        return sampleMeasurement(m, parameters, samples, bins, limitFor(limits, m.spec.id))
      })
      if (!baseline.gdtModel && edits.length) throw Error('Baseline has no GD&T controls')
      const prior = baseline.gdt
      const gdt = prior && evaluateGdt(baseline.gdtModel, parameters, prior, edits, updated?.id)
      const revision = nextRevision()
      baseline = { ...baseline, revision, parameters, results, gdt }
      return {
        status: 'ok', baselineRevision: revision, seed, samples,
        recalculatedMeasurementIds, measurements: results,
        ...(gdt && { gdt: {
          baseline: prior.metrics, whatIf: gdt.metrics, recalculatedGdtIds: gdt.recalculatedGdtIds,
        } }),
      }
    }

    const { assembly, fixedPartIds, seed = 1, samples = 10_000, bins = 40, limits = {} } = input
    if (!Number.isSafeInteger(samples) || samples < 10_000 || samples > 50_000) throw Error('3D samples must be 10000–50000')
    if (!Number.isSafeInteger(bins) || bins < 1 || bins > 200) throw Error('Histogram bins must be 1–200')
    createRng(seed)
    if (!Array.isArray(input.parameters) || input.parameters.length > 128 || assembly.measurements.length > 128) {
      throw Error('Expected at most 128 parameters and 128 measurements')
    }
    const solution = solveAssembly({ assembly, fixedPartIds })
    if (solution.status === 'overconstrained') return { status: 'overconstrained', solution }
    const geometry = scene({ ...assembly, parts: solution.parts.map(part => ({ ...part, id: part.partId })) })
    const rng = createRng(seed)
    const parameters = new Map()
    for (const parameter of input.parameters) {
      const bound = bind(parameter, geometry)
      if (parameters.has(bound.id)) throw Error('Duplicate tolerance parameter: ' + bound.id)
      parameters.set(bound.id, { ...bound, draws: standardNormals(Math.floor(rng.next() * 2 ** 32), samples) })
    }
    const response = linearizedMateResponse(assembly, geometry, solution.fixedPartIds)
    const transfers = new Map([...parameters.values()].map(parameter =>
      [parameter.id, response(parameter.featureId, parameter.dof)]))
    const measurements = assembly.measurements.map(spec => measurement(spec, geometry, [...parameters.values()],
      parameterId => transfers.get(parameterId)))
    const results = measurements.map(m => sampleMeasurement(m, parameters, samples, bins, limitFor(limits, m.spec.id)))
    const gdtModel = assembly.gdt?.length
      ? prepareGdt(assembly, geometry, parameters, transfers, samples, seed, input.gdtFeatureGeometry) : null
    if (!gdtModel && input.gdtEdits?.length) throw Error('Assembly has no GD&T controls')
    const originalGdt = gdtModel && evaluateGdt(gdtModel, parameters)
    const gdt = originalGdt && input.gdtEdits?.length
      ? evaluateGdt(gdtModel, parameters, originalGdt, input.gdtEdits) : originalGdt
    const revision = nextRevision()
    baseline = { revision, seed, samples, bins, limits, parameters, results, measurements, geometry, gdtModel, gdt }
    return {
      ...(gdt && { gdt: { baseline: originalGdt.metrics, ...(gdt !== originalGdt && { whatIf: gdt.metrics }),
        recalculatedGdtIds: gdt.recalculatedGdtIds } }),
      status: 'ok', baselineRevision: revision, seed, samples, solution,
      recalculatedMeasurementIds: measurements.map(m => m.spec.id), measurements: results,
    }
  }
}
