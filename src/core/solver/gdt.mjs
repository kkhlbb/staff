import { createRng } from '../../domain/statistics.ts'
import { DEFAULT_PROFILE_OUTER_FRACTION, resolveGdtMaterialConditions } from '../../project-file/assembly3d.ts'
import { accumulateCompliance, accumulateModel, contributionRecords, contributionWeights, projectCompliance, recordContribution } from './compliance.mjs'
import { buildDatumFrame } from './datumFrame.mjs'
import { add, cross, dot, norm, perpendicular, placed, rotate, scale, sub, transverse, unit } from './spatial.mjs'

const zero = [0, 0, 0]
const isRunout = kind => kind === 'circular-runout' || kind === 'total-runout'
const isLocalForm = control => control.kind === 'flatness' || control.kind === 'cylindricity' ||
  control.kind === 'profile-surface' && !control.datumIds.length
const modifiers = ['RFS', 'MMC', 'LMC']

export function materialBonus(tolerance, modifier, quantile, external = false) {
  if (!tolerance || modifier === 'RFS') return 0
  const range = (tolerance.upperQ - tolerance.lowerQ) / 10000
  return range * ((modifier === 'MMC') !== external ? quantile : 1 - quantile)
}

// Three standard deviations span the tolerance half-width. The normal
// model conditions its scalar and radial draws on the allowed zone.
function signedDraw(rng, distribution) {
  if (distribution === 'uniform') return 2 * rng.next() - 1
  let standard
  do {
    const radius = Math.sqrt(-2 * Math.log1p(-rng.next()))
    standard = radius * Math.cos(2 * Math.PI * rng.next())
  } while (Math.abs(standard) > 3)
  return standard / 3
}

function unitDraw(rng, distribution) {
  return distribution === 'uniform' ? rng.next() : (1 + signedDraw(rng, distribution)) / 2
}

function disk(rng, distribution) {
  const quantile = rng.next()
  const radius = distribution === 'uniform' ? Math.sqrt(quantile)
    : Math.sqrt(-2 * Math.log1p(-quantile * (1 - Math.exp(-4.5)))) / 3
  const angle = 2 * Math.PI * rng.next()
  return [radius * Math.cos(angle), radius * Math.sin(angle)]
}

export function sampleSdt(kind, zone, tolerance, span, rng, distribution = 'uniform', outerFraction = DEFAULT_PROFILE_OUTER_FRACTION) {
  const [x, y] = disk(rng, distribution)
  const radius = tolerance / 2
  const center = [0, 0, 0, 0, 0, 0]
  let form = 0
  switch (kind) {
    case 'position':
      if (zone === 'planar') center[0] = radius * signedDraw(rng, distribution)
      else if (zone === 'bidirectional') {
        center[0] = radius * signedDraw(rng, distribution)
        center[1] = radius * signedDraw(rng, distribution)
      } else {
        center[0] = radius * x
        center[1] = radius * y
      }
      break
    case 'perpendicularity':
    case 'parallelism':
      center[3] = tolerance * x / span
      center[4] = tolerance * y / span
      break
    case 'flatness': {
      form = tolerance * (distribution === 'uniform' ? rng.next() : Math.abs(signedDraw(rng, distribution)))
      center[3] = (tolerance - form) * x / span
      center[4] = (tolerance - form) * y / span
      break
    }
    case 'profile-surface': {
      form = tolerance * unitDraw(rng, distribution)
      const tiltWidth = (tolerance - form) * unitDraw(rng, distribution)
      center[3] = tiltWidth * x / span
      center[4] = tiltWidth * y / span
      const remaining = tolerance - form - tiltWidth * Math.hypot(x, y)
      if (zone !== 'local') center[2] = (outerFraction - 0.5) * tolerance + remaining * signedDraw(rng, distribution) / 2
      break
    }
    case 'cylindricity': {
      const roundness = tolerance * unitDraw(rng, distribution)
      const generatrix = (tolerance - roundness) * unitDraw(rng, distribution)
      form = roundness + generatrix + (tolerance - roundness - generatrix) * unitDraw(rng, distribution)
      break
    }
    case 'circular-runout':
    case 'total-runout':
      form = radius * unitDraw(rng, distribution)
      center[0] = (radius - form) * x
      center[1] = (radius - form) * y
      if (kind === 'circular-runout') break
      // Both end sections share the same radial form allowance.
      {
        const [endX, endY] = disk(rng, distribution)
        center[0] = (radius - form) * (x + endX) / 2
        center[1] = (radius - form) * (y + endY) / 2
        center[3] = (radius - form) * (y - endY) / span
        center[4] = (radius - form) * (endX - x) / span
      }
      break
    case 'composite-position':
    case 'coaxiality': {
      const [endX, endY] = disk(rng, distribution)
      center[0] = radius * (x + endX) / 2
      center[1] = radius * (y + endY) / 2
      center[3] = radius * (y - endY) / span
      center[4] = radius * (endX - x) / span
      break
    }
  }
  return { center, form }
}

export function zoneError(kind, zone, span, u, v, alpha, beta, form = 0, outerFraction = DEFAULT_PROFILE_OUTER_FRACTION) {
  switch (kind) {
    case 'position':
      if (zone === 'planar') return 2 * Math.abs(u)
      if (zone === 'bidirectional') return 2 * Math.max(Math.abs(u), Math.abs(v))
      return 2 * Math.hypot(u, v)
    case 'perpendicularity':
    case 'parallelism':
      return span * Math.hypot(alpha, beta)
    case 'flatness':
      return form + span * Math.hypot(alpha, beta)
    case 'profile-surface': {
      const half = (form + span * Math.hypot(alpha, beta)) / 2
      if (zone === 'local') return 2 * half
      const outside = u + half
      const inside = half - u
      return Math.max(0, outside > 0 ? outside / outerFraction : 0,
        inside > 0 ? inside / (1 - outerFraction) : 0)
    }
    case 'cylindricity':
      return form
    case 'circular-runout':
      return 2 * (Math.hypot(u, v) + form)
    case 'total-runout':
    case 'composite-position':
    case 'coaxiality': {
      const half = span / 2
      return 2 * (Math.max(Math.hypot(u + beta * half, v - alpha * half),
        Math.hypot(u - beta * half, v + alpha * half)) + (kind === 'total-runout' ? form : 0))
    }
  }
}

function spanOf(part, feature, override) {
  if (override !== undefined) {
    if (!Number.isSafeInteger(override) || override <= 0) throw Error('Expected positive feature span in integer q')
    return override / 10000
  }
  const bounds = part?.sizeQ ?? {}
  const length = Math.max(0, bounds.lengthQ ?? 0, bounds.heightQ ?? 0, bounds.widthQ ?? 0)
  if (!feature.cylinder || !feature.axis) return length / 10000 || 1
  const axis = feature.axis
  const hole = part?.modifiers?.find(candidate => candidate.kind === 'blind-hole' &&
    norm(sub(scale(candidate.originQ, 0.0001), feature.point)) < 1e-8 &&
    norm(cross(unit(candidate.axis), axis)) < 1e-8)
  const dimensions = [bounds.lengthQ, bounds.widthQ, bounds.thicknessQ ?? bounds.heightQ]
  if (part?.baseKind === 'cylinder-spacer') dimensions.splice(0, 3, bounds.outerDiameterQ, bounds.outerDiameterQ, bounds.lengthQ)
  const axialSpan = dimensions.reduce((sum, value, index) => sum + (value ?? 0) * Math.abs(axis[index]), 0)
  return (hole?.depthQ ?? axialSpan) / 10000 || length / 10000 || 1
}

const dot6 = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0)

function datumMotionRows(group, length) {
  const { translation, rotation, origin } = group.frame
  const rows = []
  for (const datum of group.datums) {
    const ownRows = [...rotation, ...translation].filter(row => row.datum.index === datum.index)
    for (const row of ownRows) {
      const { clockDirection } = row.datum
      const direction = clockDirection ?? row.direction
      const angular = rotation.includes(row) && !clockDirection
      const lever = angular ? scale(direction, datum.span / 2) : cross(sub(datum.point, origin), direction)
      const physical = [...(angular ? zero : direction), ...scale(lever, 1 / length)]
      const orthogonal = rows.reduce((vector, prior) => {
        const projection = dot6(vector, prior.axis)
        return vector.map((value, k) => value - projection * prior.axis[k])
      }, physical)
      const gain = Math.hypot(...orthogonal)
      if (gain <= 1e-8) continue
      rows.push({ physical, axis: orthogonal.map(value => value / gain), gain, index: datum.index,
        direction, angular, leverLength: datum.span / 2, divisor: Math.sqrt(ownRows.length) })
    }
  }
  return rows
}

// Solve one small-displacement rigid motion per DRF and draw. A row at
// RFS has zero clearance, even when earlier references have mobility.
function sampleDatumMotion(group, samples, seed, distribution) {
  if (!group.datums.some(datum => datum.clearance)) return null
  const rng = createRng(seed)
  const result = new Float64Array(samples * 6)
  const { length, rows } = group.motionFrame
  const clearances = new Float64Array(group.datums.length)
  const motion = [0, 0, 0, 0, 0, 0]
  for (let i = 0; i < samples; i++) {
    for (const datum of group.datums) {
      clearances[datum.index] = materialBonus(datum.clearance, datum.modifier, unitDraw(rng, distribution), datum.external) / 2
    }
    motion.fill(0)
    for (const row of rows) {
      const clearance = clearances[row.index] * signedDraw(rng, distribution) / row.divisor
      const step = (clearance - dot6(row.physical, motion)) / row.gain
      for (let k = 0; k < 6; k++) motion[k] += step * row.axis[k]
    }
    const shift = motion.slice(0, 3)
    const omega = scale(motion.slice(3), 1 / length)
    // Apply a common scale if combined offset and tilt exceed any finite
    // cylindrical simulator at either end of its engagement.
    let factor = 1
    for (const datum of group.datums) {
      if (!datum.cylinder || !datum.clearance) continue
      const center = add(shift, cross(omega, sub(datum.point, group.frame.origin)))
      const end = scale(cross(omega, datum.axis), datum.span / 2)
      const excursion = Math.max(norm(transverse(add(center, end), datum.axis)),
        norm(transverse(sub(center, end), datum.axis)))
      if (excursion > clearances[datum.index]) factor = Math.min(factor, clearances[datum.index] / excursion)
    }
    result.set(scale(shift, factor), i * 6)
    result.set(scale(omega, factor), i * 6 + 3)
  }
  return result
}

function parameterEffects(feature, reference, geometry, parameters, transfers, axes, group) {
  const frame = placed(feature, geometry.poses)
  return [...parameters.values()].flatMap(parameter => {
    const response = transfers.get(parameter.id)
    const effect = (item, point) => {
      const step = response.get(item.part)
      const omega = step ? Array.from(step.slice(3)) : [...zero]
      const shift = step ? add(step, cross(omega, sub(point, geometry.poses[item.part].translation))) : [...zero]
      if (item.id === parameter.featureId) {
        if (parameter.index < 3) shift[parameter.index]++
        else omega[parameter.index - 3]++
      }
      return [shift, omega]
    }
    const [shift, omega] = effect(feature, frame.point)
    let relativeShift = shift
    let relativeOmega = omega
    if (group) {
      const motions = group.datums.map(datum => effect(datum, datum.point))
      const ref = solveDatumMotion(group, row => {
        const [translation, rotation] = motions[row.index]
        return row.angular ? dot(row.direction, rotation) * row.leverLength : dot(row.direction, translation)
      })
      const refOmega = ref.slice(3)
      relativeShift = sub(shift, add(ref, cross(refOmega, sub(frame.point, group.frame.origin))))
      relativeOmega = sub(omega, refOmega)
    } else if (reference) {
      const [refShift, refOmega] = effect(reference, reference.point)
      relativeShift = sub(shift, add(refShift, cross(refOmega, sub(frame.point, reference.point))))
      relativeOmega = sub(omega, refOmega)
    }
    const coefficients = [...rotate(axes, relativeShift), ...rotate(axes, relativeOmega)]
    return coefficients.some(value => Math.abs(value) > 1e-8) ? [{ parameter, coefficients }] : []
  })
}

function localBasis(control, world, frame, zone) {
  const axis = world.axis
  const x = frame?.axes[0] ?? perpendicular(axis)
  if (control.kind === 'coaxiality') return frame.axes
  if (control.kind === 'position' && zone === 'planar') {
    const y = perpendicular(axis)
    return [axis, y, cross(axis, y)]
  }
  const projected = transverse(x, axis)
  const tangent = norm(projected) > 1e-8 ? unit(projected) : perpendicular(axis)
  return [tangent, cross(axis, tangent), axis]
}

// A pattern has one world-space twist about the center of its nominal holes.
function samplePattern(members, samples) {
  const first = members[0]
  const origin = scale(members.reduce((sum, member) => add(sum, member.world.point), zero), 1 / members.length)
  let reach = 0
  const streams = members.map(member => {
    member.patternLever = sub(member.world.point, origin)
    member.patternQuantiles = new Float64Array(samples)
    member.localSamples = new Float64Array(samples * 6)
    reach = Math.max(reach, norm(member.patternLever) + member.span / 2)
    return createRng(member.seed)
  })
  const localStreams = members.map(member => createRng(member.lower.seed))
  const lowerMargins = new Float64Array(members.length)
  const restrained = members.map((member, index) => ({ member, index }))
    .filter(({ member }) => member.lower.restrainedRotation?.length)
  const motions = new Float64Array(samples * 6)
  const rng = createRng((first.seed ^ 0x6192acbf) >>> 0)
  for (let i = 0; i < samples; i++) {
    let radius = Infinity
    for (let j = 0; j < members.length; j++) {
      const member = members[j]
      const quantile = unitDraw(streams[j], first.distribution)
      member.patternQuantiles[i] = quantile
      let localRadius = 0
      if (member.lower.axes) {
        const lower = member.lower
        const lowerWidth = lower.control.toleranceQ / 10000 +
          materialBonus(lower.control.featureSizeToleranceQ, lower.modifier, quantile, lower.external)
        const { center } = sampleSdt('composite-position', lower.zone, lowerWidth, lower.span,
          localStreams[j], lower.distribution)
        member.localSamples.set(center, i * 6)
        localRadius = zoneError('composite-position', lower.zone, lower.span, center[0], center[1], center[3], center[4]) / 2
        lowerMargins[j] = Math.max(0, lowerWidth / 2 - localRadius)
      }
      const upperRadius = (member.control.toleranceQ / 10000 +
        materialBonus(member.control.featureSizeToleranceQ, member.modifier, quantile, member.external)) / 2
      radius = Math.min(radius, Math.max(0, upperRadius - localRadius))
    }
    const [x, y] = disk(rng, first.distribution)
    const fraction = unitDraw(rng, first.distribution)
    const shift = scale(add(scale(first.axes[0], x), scale(first.axes[1], y)), radius * fraction)
    const omega = [0, 1, 2].map(() => signedDraw(rng, first.distribution))
    const angular = scale(omega, radius * (1 - fraction) / (reach * Math.max(1, norm(omega))))
    let factor = 1
    for (const { member, index } of restrained) {
      const lower = member.lower
      const [u, v, alpha, beta] = restrainedPatternMotion(lower, angular)
      const excursion = zoneError('composite-position', lower.zone, lower.span, u, v, alpha, beta) / 2
      if (excursion > lowerMargins[index]) factor = Math.min(factor, lowerMargins[index] / excursion)
    }
    motions.set(shift, i * 6)
    motions.set(scale(angular, factor), i * 6 + 3)
  }
  const pattern = { origin, motions }
  for (const member of members) member.pattern = pattern
}

function patternCenter(entry, index) {
  const motion = entry.pattern.motions.subarray(index * 6, index * 6 + 6)
  const omega = motion.subarray(3)
  const center = [...rotate(entry.axes, add(motion, cross(omega, entry.patternLever))), ...rotate(entry.axes, omega)]
  if (!entry.lower.axes) return center
  const local = entry.localSamples.subarray(index * 6, index * 6 + 6)
  for (let offset = 0; offset <= 3; offset += 3) {
    for (let k = 0; k < 3; k++) {
      center[offset + k] += dot(entry.axes[k], entry.lower.axes[0]) * local[offset] +
        dot(entry.axes[k], entry.lower.axes[1]) * local[offset + 1]
    }
  }
  return center
}

function restrainedPatternMotion(entry, omega) {
  const restrained = entry.restrainedRotation.reduce((motion, axis) =>
    add(motion, scale(axis, dot(axis, omega))), zero)
  const shift = cross(restrained, entry.upper.patternLever)
  return [dot(entry.axes[0], shift), dot(entry.axes[1], shift),
    dot(entry.axes[0], restrained), dot(entry.axes[1], restrained)]
}

function sampleControl(entry, samples, parameters, cacheKinematics) {
  const rng = createRng(entry.seed)
  const { control, group, span, zone, axes, lever, nominal, effects, distribution } = entry
  const errors = new Float64Array(samples)
  const withoutShift = group?.motion ? new Float64Array(samples) : errors
  const quantiles = new Float64Array(samples)
  const envelope = entry.normalProfile ? new Float64Array(samples * 2) : null
  const kinematics = cacheKinematics ? new Float64Array(samples * (group?.motion ? 9 : 5)) : null
  for (let i = 0; i < samples; i++) {
    const patternEntry = entry.upper ?? (entry.pattern && entry)
    quantiles[i] = patternEntry ? patternEntry.patternQuantiles[i] : unitDraw(rng, distribution)
    const processWidth = control.toleranceQ / 10000 +
      materialBonus(control.featureSizeToleranceQ, entry.modifier, quantiles[i], entry.external)
    const { center, form } = entry.pattern
      ? { center: patternCenter(entry, i), form: 0 }
      : entry.upper ? { center: Array.from(entry.upper.localSamples.subarray(i * 6, i * 6 + 6)), form: 0 }
        : sampleSdt(control.kind, zone, processWidth, span, rng, distribution, entry.outerFraction)
    if (entry.upper && entry.restrainedRotation.length) {
      const patternRotation = entry.upper.pattern.motions.subarray(i * 6 + 3, i * 6 + 6)
      const [u, v, alpha, beta] = restrainedPatternMotion(entry, patternRotation)
      center[0] += u
      center[1] += v
      center[3] += alpha
      center[4] += beta
    }
    for (const { parameter, coefficients } of effects) {
      const current = parameters.get(parameter.id)
      const value = current.draws[i] * current.sigma
      for (let k = 0; k < 6; k++) center[k] += value * coefficients[k]
    }
    const u = center[entry.normalProfile ? 2 : 0] + nominal[0]
    const v = center[1] + nominal[1]
    const alpha = center[3] + nominal[2]
    const beta = center[4] + nominal[3]
    const offset = i * (group?.motion ? 9 : 5)
    if (kinematics) {
      kinematics[offset] = u
      kinematics[offset + 1] = v
      kinematics[offset + 2] = alpha
      kinematics[offset + 3] = beta
      kinematics[offset + 4] = form
    }
    withoutShift[i] = measuredError(entry, u, v, alpha, beta, form, group?.motion ? null : envelope, i)
    if (group?.motion) {
      const motion = group.motion.subarray(i * 6, i * 6 + 6)
      const omega = motion.subarray(3)
      const shift = add(motion, cross(omega, lever))
      const du = entry.upper ? 0 : dot(axes[entry.normalProfile ? 2 : 0], shift)
      const dv = entry.upper ? 0 : dot(axes[1], shift)
      const da = dot(axes[0], omega)
      const db = dot(axes[1], omega)
      if (kinematics) {
        kinematics[offset + 5] = du
        kinematics[offset + 6] = dv
        kinematics[offset + 7] = da
        kinematics[offset + 8] = db
      }
      errors[i] = measuredError(entry, u - du, v - dv, alpha - da, beta - db, form, envelope, i)
    }
  }
  return { errors, withoutShift, quantiles, kinematics, envelope }
}

function measuredError(entry, u, v, alpha, beta, form, envelope, i) {
  if (!entry.normalProfile) return zoneError(entry.control.kind, entry.zone, entry.span, u, v, alpha, beta, form)
  const half = (form + entry.span * Math.hypot(alpha, beta)) / 2
  if (envelope) {
    envelope[i * 2] = u + half
    envelope[i * 2 + 1] = half - u
  }
  // Report a finite observed diameter about the basic surface even for a
  // one-sided zone. The signed extremes determine acceptance separately.
  return 2 * (Math.abs(u) + half)
}

function materialConditions(control, assembly) {
  const result = resolveGdtMaterialConditions(control, assembly)
  if (control.kind === 'cylindricity' && result.modifier !== 'RFS') {
    result.warnings.push({ code: 'ILLEGAL_MODIFIER', gdtId: control.id,
      message: `Cylindricity does not permit ${result.modifier}. Using RFS.` })
    result.modifier = 'RFS'
  }
  return result
}

function score(entry, draws, edit, assembly) {
  const control = { ...entry.control, ...edit }
  const { modifier, warnings } = materialConditions(control, assembly)
  const { errors, withoutShift, quantiles, envelope } = draws
  const failures = new Uint8Array(errors.length)
  let mean = 0
  let m2 = 0
  let deficitMean = 0
  let deficitM2 = 0
  let shiftSquares = 0
  let bonusTotal = 0
  const outerFraction = entry.outerFraction ?? DEFAULT_PROFILE_OUTER_FRACTION
  for (let i = 0; i < errors.length; i++) {
    const bonus = materialBonus(control.featureSizeToleranceQ, modifier, quantiles[i], entry.external)
    const error = errors[i]
    const width = control.toleranceQ / 10000 + bonus
    const deficit = envelope ? 2 * Math.min(outerFraction * width - envelope[i * 2],
      (1 - outerFraction) * width - envelope[i * 2 + 1]) : width - error
    const delta = error - mean
    const deficitDelta = deficit - deficitMean
    mean += delta / (i + 1)
    deficitMean += deficitDelta / (i + 1)
    m2 += delta * (error - mean)
    deficitM2 += deficitDelta * (deficit - deficitMean)
    failures[i] = Number(deficit < 0)
    shiftSquares += (error - withoutShift[i]) ** 2
    bonusTotal += bonus
  }
  // A single trial has no variance estimate. Return its observed error
  // as a zero-width interval and omit Cpk, while counting observed failures.
  const degreesOfFreedom = Math.max(1, errors.length - 1)
  const variance = m2 / degreesOfFreedom
  const threeSigma = 3 * Math.sqrt(variance)
  const deficitSigma = Math.sqrt(deficitM2 / degreesOfFreedom)
  return { warnings, variance, failures, cpk: deficitSigma > 0 ? deficitMean / (3 * deficitSigma) : null,
    threeSigmaIntervalMm: [mean - threeSigma, mean + threeSigma],
    contribution: { gdtId: control.id, label: control.featureId, kind: control.kind, bonusMeanMm: bonusTotal / errors.length,
      datumShiftContributionPct: shiftSquares ? 100 * shiftSquares / (shiftSquares + m2) : 0 } }
}

function summarize(entries, scores, failureCounts) {
  const metrics = [...scores.values()]
  const governing = metrics.reduce((best, current) => !best ||
    (current.cpk ?? Infinity) < (best.cpk ?? Infinity) ? current : best, null)
  const variance = metrics.reduce((sum, metric) => sum + metric.variance, 0)
  return {
    cpk: governing?.cpk ?? null,
    ppm: failureCounts.reduce((sum, count) => sum + Number(count !== 0), 0) / failureCounts.length * 1e6,
    threeSigmaIntervalMm: governing?.threeSigmaIntervalMm ?? [0, 0],
    contributions: metrics.map(metric => ({ ...metric.contribution, varianceSharePct: variance ? 100 * metric.variance / variance : 0 })),
    warnings: entries.flatMap(entry => [...entry.warnings, ...(entry.lower?.warnings ?? []),
      ...(scores.get(entry.control.id)?.warnings ?? [...entry.materialWarnings, ...(entry.lower?.materialWarnings ?? [])])]),
  }
}

export function prepareGdt(assembly, geometry, parameters, transfers, samples, seed, featureGeometry = {}, distribution = 'uniform', cacheKinematics = false) {
  const datums = new Map((assembly.datums ?? []).map(datum => [datum.id, datum]))
  const parts = new Map(assembly.parts.map(part => [part.id, part]))
  const definitions = new Map(assembly.features.map(feature => [feature.id, feature]))
  const groups = new Map()
  const rng = createRng((seed ^ 0x2ba94cef) >>> 0)
  const nextSeed = () => Math.floor(rng.next() * 2 ** 32)
  const configuration = id => Object.hasOwn(featureGeometry, id) ? featureGeometry[id] : {}
  const prepare = (control, upper) => {
    const feature = geometry.feature(control.featureId)
    const world = placed(feature, geometry.poses)
    const definition = definitions.get(feature.id)
    const profileFace = control.kind === 'profile-surface' && definition.kind === 'face'
    if (profileFace && !world.axis && norm(definition.normal) > 0) {
      world.axis = rotate(geometry.poses[feature.part].rotation, unit(definition.normal))
    }
    const external = configuration(feature.id).external === true
    const span = spanOf(parts.get(feature.partId), feature, configuration(feature.id).spanQ)
    const warnings = []
    const warn = (code, message, datumId) => warnings.push({ code, gdtId: control.id, message, ...(datumId && { datumId }) })
    const conditions = materialConditions(control, assembly)
    const entry = { control, external, span, modifier: conditions.modifier, warnings, materialWarnings: conditions.warnings, seed: nextSeed(), distribution }
    let group
    if (control.kind === 'cylindricity' && control.datumIds.length) {
      warn('DRF_DEGENERATE', 'Cylindricity cannot reference datums.')
      return entry
    }
    const localForm = isLocalForm(control)
    const datumOptional = localForm || control.kind === 'composite-position'
    if (!localForm && (control.datumIds.length || !datumOptional)) {
      const owner = control.kind === 'composite-position' && control.patternGroupId !== undefined
        ? ['pattern', control.patternGroupId] : feature.partId
      const key = JSON.stringify([owner, control.datumIds, conditions.datumModifiers])
      group = groups.get(key)
      if (!group) {
        const references = control.datumIds.map((id, index) => {
          const datum = datums.get(id)
          if (!datum) return { id }
          const reference = geometry.feature(datum.featureId)
          const config = configuration(reference.id)
          const modifier = conditions.datumModifiers[index]
          return { ...reference, ...placed(reference, geometry.poses), id, featureId: reference.id, index, modifier,
            external: config.external === true, span: spanOf(parts.get(reference.partId), reference, config.spanQ),
            clearance: modifier === 'RFS' ? null : datum.sizeToleranceQ }
        })
        const frame = buildDatumFrame(references)
        group = { frame, datums: references }
        if (!frame.code) {
          const length = Math.max(...references.map(datum => datum.span))
          group.motionFrame = { length, rows: datumMotionRows(group, length) }
          group.motion = sampleDatumMotion(group, samples, nextSeed(), distribution)
        }
        groups.set(key, group)
      }
      if (group.frame.code || control.kind === 'coaxiality' && !group.datums[0]?.cylinder) {
        warn('DRF_DEGENERATE', 'Datum references cannot define the required orthogonal frame.', group.frame.datumId)
        return entry
      }
      if (group.frame.remainingDof) warn('DRF_UNDERCONSTRAINED',
        `Datum references leave ${group.frame.remainingDof} rigid-body degrees of freedom.`)
    }
    if (!world.axis || !feature.plane && !feature.cylinder && !profileFace ||
        control.kind === 'flatness' && !feature.plane ||
        (isRunout(control.kind) || ['coaxiality', 'cylindricity', 'composite-position'].includes(control.kind)) && !feature.cylinder) {
      warn('DRF_DEGENERATE', 'Controlled geometry cannot define the required tolerance zone.')
      return entry
    }
    if (isRunout(control.kind) && !group?.datums.some(datum => datum.cylinder)) {
      warn('DRF_DEGENERATE', 'Runout requires an axis datum.')
      return entry
    }
    const zone = control.kind === 'profile-surface' && localForm ? 'local' : control.zoneShape ?? (feature.cylinder ? 'cylindrical' : 'planar')
    const runoutDatum = isRunout(control.kind) ? group.datums.find(datum => datum.cylinder) : null
    const runoutX = runoutDatum && perpendicular(runoutDatum.axis)
    const axes = runoutDatum ? [runoutX, cross(runoutDatum.axis, runoutX), runoutDatum.axis]
      : localBasis(control, world, group?.frame, zone)
    const lever = group ? sub(world.point, group.frame.origin) : zero
    const nominal = [0, 0, 0, 0]
    if (control.kind === 'coaxiality' || runoutDatum) {
      // Axis directions are unoriented. Choose the end order aligned with A.
      const axis = dot(world.axis, axes[2]) < 0 ? scale(world.axis, -1) : world.axis
      const radialLever = runoutDatum ? sub(world.point, runoutDatum.point) : lever
      nominal[0] = dot(axes[0], radialLever)
      nominal[1] = dot(axes[1], radialLever)
      nominal[2] = -dot(axes[1], axis)
      nominal[3] = dot(axes[0], axis)
    } else if (control.kind === 'parallelism' || control.kind === 'perpendicularity') {
      const primary = group.frame.axes[2]
      const normalsParallel = (control.kind === 'parallelism') === (group.datums[0].plane === feature.plane)
      if (normalsParallel) {
        const axis = dot(world.axis, axes[2]) < 0 ? scale(world.axis, -1) : world.axis
        const target = dot(primary, axes[2]) < 0 ? scale(primary, -1) : primary
        const omega = cross(target, axis)
        nominal[2] = dot(axes[0], omega)
        nominal[3] = dot(axes[1], omega)
      } else {
        const tangent = transverse(world.axis, primary)
        const direction = norm(tangent) > 1e-8 ? unit(tangent) : perpendicular(primary)
        const omega = cross(direction, primary)
        const tilt = dot(world.axis, primary)
        nominal[2] = dot(axes[0], omega) * tilt
        nominal[3] = dot(axes[1], omega) * tilt
      }
    }
    Object.assign(entry, { axes, group, lever, zone, nominal, world, feature, localForm, upper,
      normalProfile: control.kind === 'profile-surface' && !localForm,
      outerFraction: control.unequalProfileOuterFraction,
      restrainedRotation: group?.frame.rotation.map(row => row.axis) ?? [] })
    entry.effects = localForm ? [] : upper
      ? [...parameters.values()].filter(parameter => parameter.featureId === feature.id).map(parameter => {
        const coefficients = Array(6).fill(0)
        for (let k = 0; k < 3; k++) coefficients[k + (parameter.index < 3 ? 0 : 3)] = axes[k][parameter.index % 3]
        return { parameter, coefficients }
      })
      : parameterEffects(feature, runoutDatum ?? group?.datums[0], geometry, parameters, transfers, axes,
        control.kind === 'profile-surface' || control.kind === 'composite-position' || runoutDatum ? group : undefined)
    return entry
  }
  const patterns = new Map()
  const entries = (assembly.gdt ?? []).map(control => {
    const entry = prepare(control)
    if (control.kind !== 'composite-position' || !entry.axes) return entry
    const segment = control.lowerSegment
    if (!segment || segment.toleranceQ > control.toleranceQ ||
        segment.datumIds.some((id, index) => id !== control.datumIds[index])) {
      entry.warnings.push({ code: 'DRF_DEGENERATE', gdtId: control.id,
        message: 'Composite position requires a valid lower segment and an ordered prefix of the upper datums.' })
      delete entry.axes
      return entry
    }
    const lower = prepare({ ...control, ...segment,
      modifier: segment.modifier, datumModifiers: segment.datumModifiers }, entry)
    entry.lower = lower
    const key = control.patternGroupId
    const pattern = key === undefined ? [] : patterns.get(key) ?? []
    if (key !== undefined) patterns.set(key, pattern)
    pattern.push(entry)
    entry.members = pattern
    return entry
  })
  for (const entry of entries) {
    if (entry.members && !entry.pattern) samplePattern(entry.members, samples)
  }
  return { assembly, entries, samples, cacheKinematics }
}

function scoreControl(entry, draws, edit, assembly) {
  const { lowerSegment, ...upperEdit } = edit ?? {}
  const upper = score(entry, draws, upperEdit, assembly)
  if (!draws.lower) return entry.lower
    ? { ...upper, warnings: [...upper.warnings, ...materialConditions({ ...entry.lower.control, ...lowerSegment }, assembly).warnings] }
    : upper
  const lower = score(entry.lower, draws.lower, lowerSegment, assembly)
  const governing = (lower.cpk ?? Infinity) < (upper.cpk ?? Infinity) ? lower : upper
  const failures = upper.failures.map((failed, i) => failed | lower.failures[i])
  return { ...upper, failures, cpk: governing.cpk, threeSigmaIntervalMm: governing.threeSigmaIntervalMm,
    segments: { upper, lower }, warnings: [...upper.warnings, ...lower.warnings], variance: upper.variance + lower.variance }
}

function controlDraws(entry, samples, parameters, cacheKinematics) {
  const result = sampleControl(entry, samples, parameters, cacheKinematics)
  if (entry.lower?.axes) result.lower = sampleControl(entry.lower, samples, parameters, cacheKinematics)
  return result
}

function validateEdit(edit, entry, prior) {
  const validSegment = ({ toleranceQ, modifier }, minimum) =>
    (toleranceQ === undefined || Number.isSafeInteger(toleranceQ) && toleranceQ >= minimum) &&
    (modifier === undefined || modifiers.includes(modifier))
  const lower = edit.lowerSegment
  const initialLower = entry?.control.lowerSegment
  const upperTolerance = edit.toleranceQ ?? prior?.toleranceQ ?? entry?.control.toleranceQ
  const lowerTolerance = lower?.toleranceQ ?? prior?.lowerSegment?.toleranceQ ?? initialLower?.toleranceQ
  return entry && validSegment(edit, 0) && (lower === undefined ||
    initialLower && lower && typeof lower === 'object' &&
    Object.keys(lower).every(key => key === 'toleranceQ' || key === 'modifier') && validSegment(lower, 1)) &&
    (!initialLower || lowerTolerance <= upperTolerance)
}

export function evaluateGdt(model, parameters, previous, edits = [], parameterId) {
  const byId = new Map()
  for (const { gdtId, toleranceQ, modifier, lowerSegment } of edits) {
    const edit = { ...(toleranceQ !== undefined && { toleranceQ }), ...(modifier !== undefined && { modifier }),
      ...(lowerSegment !== undefined && { lowerSegment }) }
    if (byId.has(gdtId) || !validateEdit(edit, model.entries.find(entry => entry.control.id === gdtId),
      previous?.applied.get(gdtId))) throw Error('Invalid GD&T what-if edit: ' + gdtId)
    byId.set(gdtId, edit)
  }
  const draws = new Map(previous?.draws)
  const scores = new Map(previous?.scores)
  const applied = new Map(previous?.applied)
  const failureCounts = previous?.failureCounts.slice() ?? new Uint32Array(model.samples)
  const recalculatedGdtIds = []
  for (const entry of model.entries) {
    const id = entry.control.id
    const edit = byId.get(id)
    if (edit) {
      const prior = applied.get(id)
      applied.set(id, { ...prior, ...edit,
        ...(edit.lowerSegment && { lowerSegment: { ...prior?.lowerSegment, ...edit.lowerSegment } }) })
    }
    if (!entry.axes) continue
    const resample = !previous || (parameterId !== undefined &&
      [entry, entry.lower].some(segment => segment?.effects?.some(effect => effect.parameter.id === parameterId)))
    if (resample) draws.set(id, controlDraws(entry, model.samples, parameters, model.cacheKinematics))
    if (resample || edit) {
      const old = scores.get(id)?.failures
      const next = scoreControl(entry, draws.get(id), applied.get(id), model.assembly)
      for (let i = 0; i < model.samples; i++) failureCounts[i] += next.failures[i] - (old?.[i] ?? 0)
      scores.set(id, next)
      recalculatedGdtIds.push(id)
    }
  }
  const warnings = model.entries.map(entry => !entry.axes && applied.has(entry.control.id)
    ? { ...entry, materialWarnings: materialConditions({ ...entry.control, ...applied.get(entry.control.id) }, model.assembly).warnings }
    : entry)
  return { draws, scores, applied, failureCounts, recalculatedGdtIds, metrics: summarize(warnings, scores, failureCounts) }
}

function solveDatumMotion(group, projected) {
  const motion = [0, 0, 0, 0, 0, 0]
  if (!group) return motion
  const { rows, length } = group.motionFrame
  for (const row of rows) {
    const gain = (projected(row) - dot6(row.physical, motion)) / row.gain
    for (let k = 0; k < 6; k++) motion[k] += gain * row.axis[k]
  }
  for (let k = 3; k < 6; k++) motion[k] /= length
  return motion
}

function compliantDatumMotion(group, effects, channel) {
  return solveDatumMotion(group, row => {
    const delta = effects.get(group.datums[row.index].featureId)[channel]
    return row.angular ? dot(row.direction, delta.slice(3)) * row.leverLength : dot(row.direction, delta)
  })
}

function flexDraws(entry, rigid, models, samples) {
  const { control, axes, group, lever, span } = entry
  const localForm = entry.localForm
  const { point, axis } = entry.world
  const cylinder = control.kind === 'cylindricity' || control.kind === 'profile-surface' && entry.feature.cylinder
  const probes = localForm && cylinder ? [-0.5, 0, 0.5].flatMap(z =>
    [axes[0], axes[1], scale(axes[0], -1), scale(axes[1], -1)].map(normal =>
      [add(scale(axis, z * span), scale(normal, entry.feature.radius)), normal]))
    : localForm ? [-0.5, 0, 0.5].flatMap(a => [-0.5, 0, 0.5].map(b =>
      [add(scale(axes[0], a * span), scale(axes[1], b * span)), axis])) : []
  const size = localForm ? probes.length : 4
  const projected = projectCompliance(models, size, (effects, channel, model) => {
    if (localForm) {
      if (!model.parts.includes(entry.feature.partId)) return Array(size).fill(0)
      const own = model.at(entry.feature.partId, point, control.featureId)[channel]
      return probes.map(([offset, normal]) => {
        const displaced = model.at(entry.feature.partId, add(point, offset))[channel]
        return dot(normal, sub(displaced, add(own, cross(own.slice(3), offset))))
      })
    }
    if (entry.upper) {
      // Remove the local motion of the pattern origin and its unconstrained
      // rotation. A lower datum prefix can still restrain orientation.
      const own = effects.get(control.featureId)[channel]
      const origin = entry.upper.pattern.origin
      const rigid = model.at(entry.feature.partId, origin)[channel]
      const omega = rigid.slice(3)
      const relative = sub(own, add(rigid, cross(omega, entry.upper.patternLever)))
      const refOmega = compliantDatumMotion(group, effects, channel).slice(3)
      const free = entry.restrainedRotation.reduce((result, direction) =>
        sub(result, scale(direction, dot(omega, direction))), omega)
      const rotation = sub(sub(own.slice(3), free), refOmega)
      return [dot(axes[0], relative), dot(axes[1], relative), dot(axes[0], rotation), dot(axes[1], rotation)]
    }
    const delta = effects.get(control.featureId)[channel]
    const reference = compliantDatumMotion(group, effects, channel)
    const refRotation = reference.slice(3)
    const motion = sub(delta, add(reference, cross(refRotation, lever)))
    const rotation = sub(delta.slice(3), refRotation)
    return [dot(axes[entry.normalProfile ? 2 : 0], motion), dot(axes[1], motion), dot(axes[0], rotation), dot(axes[1], rotation)]
  })
  if (!projected.length) return { draws: rigid, weights: [] }
  const errors = new Float64Array(samples)
  const withoutShift = group?.motion ? new Float64Array(samples) : errors
  const envelope = entry.normalProfile ? new Float64Array(samples * 2) : null
  const { kinematics } = rigid
  const records = contributionRecords(projected)
  const delta = new Float64Array(size)
  const omitted = new Float64Array(size)
  const stride = group?.motion ? 9 : 5
  const error = localForm ? (offset, flex) => {
    let min = cylinder ? Infinity : 0
    let max = cylinder ? -Infinity : 0
    for (const height of flex) {
      min = Math.min(min, height)
      max = Math.max(max, height)
    }
    return rigid.errors[offset / stride] + max - min
  } : (offset, flex, datumShift, profileEnvelope) => measuredError(entry,
    kinematics[offset] + flex[0] - (datumShift ? kinematics[offset + 5] : 0),
    kinematics[offset + 1] + flex[1] - (datumShift ? kinematics[offset + 6] : 0),
    kinematics[offset + 2] + flex[2] - (datumShift ? kinematics[offset + 7] : 0),
    kinematics[offset + 3] + flex[3] - (datumShift ? kinematics[offset + 8] : 0),
    kinematics[offset + 4], profileEnvelope, offset / stride)
  for (let i = 0; i < samples; i++) {
    const offset = i * stride
    delta.fill(0)
    accumulateCompliance(delta, projected, i)
    errors[i] = error(offset, delta, group?.motion, envelope)
    if (group?.motion) withoutShift[i] = error(offset, delta, false)
    for (const record of records) {
      omitted.set(delta)
      accumulateModel(omitted, record.model, i, -1)
      recordContribution(record, i, errors[i] - error(offset, omitted, group?.motion))
    }
  }
  return { draws: { errors, withoutShift, quantiles: rigid.quantiles, envelope }, weights: contributionWeights(records, samples) }
}

export function evaluateCompliantGdt(model, parameters, rigid, models, previous) {
  const scores = new Map()
  const cached = new Map()
  const failureCounts = new Uint32Array(model.samples)
  const weights = []
  for (const entry of model.entries) {
    const id = entry.control.id
    if (!entry.axes) continue
    const original = rigid.draws.get(id)
    const prior = previous?.get(id)
    let flex = prior
    if (prior?.original !== original) {
      const kinematic = original.kinematics ? original : controlDraws(entry, model.samples, parameters, true)
      const upper = flexDraws(entry, kinematic, models, model.samples)
      const lower = kinematic.lower && flexDraws(entry.lower, kinematic.lower, models, model.samples)
      const hasFlex = upper.draws !== kinematic || lower && lower.draws !== kinematic.lower
      flex = { original, draws: hasFlex ? { ...upper.draws, lower: lower?.draws } : original,
        weights: [...upper.weights, ...(lower?.weights ?? [])] }
    }
    const rigidScore = rigid.scores.get(id)
    const next = flex.draws === original ? rigidScore : prior === flex && prior.rigidScore === rigidScore
      ? flex.score : scoreControl(entry, flex.draws, rigid.applied.get(id), model.assembly)
    cached.set(id, { ...flex, rigidScore, score: next })
    scores.set(id, next)
    for (let i = 0; i < model.samples; i++) failureCounts[i] += next.failures[i]
    weights.push(...flex.weights)
  }
  const metrics = summarize(model.entries, scores, failureCounts)
  metrics.warnings = rigid.metrics.warnings
  return { metrics, weights, cached,
    rigidVariance: [...rigid.scores.values()].reduce((sum, item) => sum + item.variance, 0) }
}
