import { createRng } from '../../domain/statistics.ts'
import { resolveGdtMaterialConditions } from '../../project-file/assembly3d.ts'
import { buildDatumFrame } from './datumFrame.mjs'
import { add, cross, dot, norm, perpendicular, placed, rotate, scale, sub, transverse, unit } from './spatial.mjs'

const zero = [0, 0, 0]
const modifiers = ['RFS', 'MMC', 'LMC']

export function materialBonus(tolerance, modifier, quantile, external = false) {
  if (!tolerance || modifier === 'RFS') return 0
  const range = (tolerance.upperQ - tolerance.lowerQ) / 10000
  return range * ((modifier === 'MMC') !== external ? quantile : 1 - quantile)
}

function disk(rng) {
  const radius = Math.sqrt(rng.next())
  const angle = 2 * Math.PI * rng.next()
  return [radius * Math.cos(angle), radius * Math.sin(angle)]
}

export function sampleSdt(kind, zone, tolerance, span, rng) {
  const [x, y] = disk(rng)
  const radius = tolerance / 2
  const center = [0, 0, 0, 0, 0, 0]
  let form = 0
  switch (kind) {
    case 'position':
      if (zone === 'planar') center[0] = radius * (2 * rng.next() - 1)
      else if (zone === 'bidirectional') {
        center[0] = radius * (2 * rng.next() - 1)
        center[1] = radius * (2 * rng.next() - 1)
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
      form = tolerance * rng.next()
      center[3] = (tolerance - form) * x / span
      center[4] = (tolerance - form) * y / span
      break
    }
    case 'coaxiality': {
      const [endX, endY] = disk(rng)
      center[0] = radius * (x + endX) / 2
      center[1] = radius * (y + endY) / 2
      center[3] = radius * (y - endY) / span
      center[4] = radius * (endX - x) / span
      break
    }
  }
  return { center, form }
}

export function zoneError(kind, zone, span, u, v, alpha, beta, form = 0) {
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
    case 'coaxiality': {
      const half = span / 2
      return 2 * Math.max(Math.hypot(u + beta * half, v - alpha * half),
        Math.hypot(u - beta * half, v + alpha * half))
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
        divisor: Math.sqrt(ownRows.length) })
    }
  }
  return rows
}

// Solve one small-displacement rigid motion per DRF and draw. A row at
// RFS has zero clearance, even when earlier references have mobility.
function sampleDatumMotion(group, samples, seed) {
  if (!group.datums.some(datum => datum.clearance)) return null
  const rng = createRng(seed)
  const result = new Float64Array(samples * 6)
  const length = Math.max(...group.datums.map(datum => datum.span))
  const rows = datumMotionRows(group, length)
  const clearances = new Float64Array(group.datums.length)
  const motion = [0, 0, 0, 0, 0, 0]
  for (let i = 0; i < samples; i++) {
    for (const datum of group.datums) {
      clearances[datum.index] = materialBonus(datum.clearance, datum.modifier, rng.next(), datum.external) / 2
    }
    motion.fill(0)
    for (const row of rows) {
      const clearance = clearances[row.index] * (2 * rng.next() - 1) / row.divisor
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

function parameterEffects(feature, reference, geometry, parameters, transfers, axes) {
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
    const [refShift, refOmega] = reference ? effect(reference, reference.point) : [zero, zero]
    const relativeShift = sub(shift, add(refShift, reference ? cross(refOmega, sub(frame.point, reference.point)) : zero))
    const relativeOmega = sub(omega, refOmega)
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

function sampleControl(entry, samples, parameters) {
  const rng = createRng(entry.seed)
  const { control, group, span, zone, axes, lever, nominal, effects } = entry
  const errors = new Float64Array(samples)
  const withoutShift = group?.motion ? new Float64Array(samples) : errors
  const quantiles = new Float64Array(samples)
  for (let i = 0; i < samples; i++) {
    quantiles[i] = rng.next()
    const processWidth = control.toleranceQ / 10000 +
      materialBonus(control.featureSizeToleranceQ, entry.modifier, quantiles[i], entry.external)
    const { center, form } = sampleSdt(control.kind, zone, processWidth, span, rng)
    for (const { parameter, coefficients } of effects) {
      const current = parameters.get(parameter.id)
      const value = current.draws[i] * current.sigma
      for (let k = 0; k < 6; k++) center[k] += value * coefficients[k]
    }
    const u = center[0] + nominal[0]
    const v = center[1] + nominal[1]
    const alpha = center[3] + nominal[2]
    const beta = center[4] + nominal[3]
    withoutShift[i] = zoneError(control.kind, zone, span, u, v, alpha, beta, form)
    if (group?.motion) {
      const motion = group.motion.subarray(i * 6, i * 6 + 6)
      const omega = motion.subarray(3)
      const shift = add(motion, cross(omega, lever))
      errors[i] = zoneError(control.kind, zone, span, u - dot(axes[0], shift), v - dot(axes[1], shift),
        alpha - dot(axes[0], omega), beta - dot(axes[1], omega), form)
    }
  }
  return { errors, withoutShift, quantiles }
}

function score(entry, draws, edit, assembly) {
  const control = { ...entry.control, ...edit }
  const { modifier, warnings } = resolveGdtMaterialConditions(control, assembly)
  const { errors, withoutShift, quantiles } = draws
  const failures = new Uint8Array(errors.length)
  let mean = 0
  let m2 = 0
  let deficitMean = 0
  let deficitM2 = 0
  let shiftSquares = 0
  let bonusTotal = 0
  for (let i = 0; i < errors.length; i++) {
    const bonus = materialBonus(control.featureSizeToleranceQ, modifier, quantiles[i], entry.external)
    const error = errors[i]
    const deficit = control.toleranceQ / 10000 + bonus - error
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
  const variance = m2 / (errors.length - 1)
  const threeSigma = 3 * Math.sqrt(variance)
  const deficitSigma = Math.sqrt(deficitM2 / (errors.length - 1))
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
    warnings: entries.flatMap(entry => [...entry.warnings, ...(scores.get(entry.control.id)?.warnings ?? entry.materialWarnings)]),
  }
}

export function prepareGdt(assembly, geometry, parameters, transfers, samples, seed, featureGeometry = {}) {
  const datums = new Map((assembly.datums ?? []).map(datum => [datum.id, datum]))
  const parts = new Map(assembly.parts.map(part => [part.id, part]))
  const groups = new Map()
  const rng = createRng((seed ^ 0x2ba94cef) >>> 0)
  const nextSeed = () => Math.floor(rng.next() * 2 ** 32)
  const configuration = id => Object.hasOwn(featureGeometry, id) ? featureGeometry[id] : {}
  const entries = (assembly.gdt ?? []).map(control => {
    const feature = geometry.feature(control.featureId)
    const world = placed(feature, geometry.poses)
    const external = configuration(feature.id).external === true
    const span = spanOf(parts.get(feature.partId), feature, configuration(feature.id).spanQ)
    const warnings = []
    const warn = (code, message, datumId) => warnings.push({ code, gdtId: control.id, message, ...(datumId && { datumId }) })
    const conditions = resolveGdtMaterialConditions(control, assembly)
    const entry = { control, external, span, modifier: conditions.modifier, warnings, materialWarnings: conditions.warnings, seed: nextSeed() }
    let group
    if (control.kind !== 'flatness') {
      const key = JSON.stringify([feature.partId, control.datumIds, conditions.datumModifiers])
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
        if (!frame.code) group.motion = sampleDatumMotion(group, samples, nextSeed())
        groups.set(key, group)
      }
      if (group.frame.code || control.kind === 'coaxiality' && !group.datums[0]?.cylinder) {
        warn('DRF_DEGENERATE', 'Datum references cannot define the required orthogonal frame.', group.frame.datumId)
        return entry
      }
      if (group.frame.remainingDof) warn('DRF_UNDERCONSTRAINED',
        `Datum references leave ${group.frame.remainingDof} rigid-body degrees of freedom.`)
    }
    if (!world.axis || !feature.plane && !feature.cylinder ||
        control.kind === 'flatness' && !feature.plane || control.kind === 'coaxiality' && !feature.cylinder) {
      warn('DRF_DEGENERATE', 'Controlled geometry cannot define the required tolerance zone.')
      return entry
    }
    const zone = control.zoneShape ?? (feature.cylinder ? 'cylindrical' : 'planar')
    const axes = localBasis(control, world, group?.frame, zone)
    const lever = group ? sub(world.point, group.frame.origin) : zero
    const nominal = [0, 0, 0, 0]
    if (control.kind === 'coaxiality') {
      // Axis directions are unoriented. Choose the end order aligned with A.
      const axis = dot(world.axis, axes[2]) < 0 ? scale(world.axis, -1) : world.axis
      nominal[0] = dot(axes[0], lever)
      nominal[1] = dot(axes[1], lever)
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
    Object.assign(entry, { axes, group, lever, zone, nominal })
    entry.effects = control.kind === 'flatness' ? []
      : parameterEffects(feature, group.datums[0], geometry, parameters, transfers, axes)
    return entry
  })
  return { assembly, entries, samples }
}

export function evaluateGdt(model, parameters, previous, edits = [], parameterId) {
  const byId = new Map()
  for (const { gdtId, toleranceQ, modifier } of edits) {
    if (byId.has(gdtId) || !model.entries.some(entry => entry.control.id === gdtId) ||
        toleranceQ !== undefined && (!Number.isSafeInteger(toleranceQ) || toleranceQ < 0) ||
        modifier !== undefined && !modifiers.includes(modifier)) throw Error('Invalid GD&T what-if edit: ' + gdtId)
    byId.set(gdtId, { ...(toleranceQ !== undefined && { toleranceQ }), ...(modifier !== undefined && { modifier }) })
  }
  const draws = new Map(previous?.draws)
  const scores = new Map(previous?.scores)
  const applied = new Map(previous?.applied)
  const failureCounts = previous?.failureCounts.slice() ?? new Uint32Array(model.samples)
  const recalculatedGdtIds = []
  for (const entry of model.entries) {
    const id = entry.control.id
    const edit = byId.get(id)
    if (edit) applied.set(id, { ...applied.get(id), ...edit })
    if (!entry.axes) continue
    const resample = !previous || entry.effects.some(effect => effect.parameter.id === parameterId)
    if (resample) draws.set(id, sampleControl(entry, model.samples, parameters))
    if (resample || edit) {
      const old = scores.get(id)?.failures
      const next = score(entry, draws.get(id), applied.get(id), model.assembly)
      for (let i = 0; i < model.samples; i++) failureCounts[i] += next.failures[i] - (old?.[i] ?? 0)
      scores.set(id, next)
      recalculatedGdtIds.push(id)
    }
  }
  const warnings = model.entries.map(entry => !entry.axes && applied.has(entry.control.id)
    ? { ...entry, materialWarnings: resolveGdtMaterialConditions({ ...entry.control, ...applied.get(entry.control.id) }, model.assembly).warnings }
    : entry)
  return { draws, scores, applied, failureCounts, recalculatedGdtIds, metrics: summarize(warnings, scores, failureCounts) }
}
