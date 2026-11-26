import { createRng } from '../../domain/statistics.ts'
import { assemblyPhysicsSpecSchema } from '../../project-file/assembly3d.ts'
import { resolveMaterial } from './materials.ts'
import { add, cross, dofs, dot, norm, placed, rotate, scale, sub, transverse, unit } from './spatial.mjs'

const qToMm = 0.0001
const zero = [0, 0, 0]
const zeroPose = [0, 0, 0, 0, 0, 0]
const bounded = (value, lo, hi) => Math.min(hi, Math.max(lo, value))
const poseDelta = (shift, rotation = zero) => [...shift, ...rotation]

export function beamDeflection(supportKind, x, span, ei) {
  x = bounded(x, 0, span)
  if (supportKind === 'cantilever') {
    return [x ** 2 * (3 * span - x) / (6 * ei), x * (2 * span - x) / (2 * ei)]
  }
  const half = Math.min(x, span - x)
  return [half * (3 * span ** 2 - 4 * half ** 2) / (48 * ei),
    Math.sign(span / 2 - x) * (3 * span ** 2 - 12 * half ** 2) / (48 * ei)]
}

/** Timoshenko free curvature per K for two perfectly bonded layers of equal width. */
export function bimetalCurvature(first, second, t1, t2) {
  const ratio = t1 / t2
  const modulusRatio = first.youngsModulusMpa / second.youngsModulusMpa
  return 6 * (first.thermalExpansionPerK - second.thermalExpansionPerK) * (1 + ratio) ** 2 /
    ((t1 + t2) * (3 * (1 + ratio) ** 2 + (1 + ratio * modulusRatio) * (ratio ** 2 + 1 / (ratio * modulusRatio))))
}

function factorPositive(matrix) {
  const lower = matrix.map(row => row.map(() => 0))
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j <= i; j++) {
      let value = matrix[i][j]
      for (let k = 0; k < j; k++) value -= lower[i][k] * lower[j][k]
      if (i === j && !(value > matrix[i][i] * 1e-12)) throw Error('Plate basis or clamp locations cannot be resolved independently')
      lower[i][j] = i === j ? Math.sqrt(value) : value / lower[j][j]
    }
  }
  return lower
}

function solvePositive(lower, target) {
  const forces = target.slice()
  for (let i = 0; i < forces.length; i++) {
    for (let j = 0; j < i; j++) forces[i] -= lower[i][j] * forces[j]
    forces[i] /= lower[i][i]
  }
  for (let i = forces.length - 1; i >= 0; i--) {
    for (let j = i + 1; j < forces.length; j++) forces[i] -= lower[j][i] * forces[j]
    forces[i] /= lower[i][i]
  }
  return forces
}

/**
 * Rectangular Kirchhoff Green kernel truncated to 12×12 modes. Clamped edges
 * use a Ritz basis imposing zero displacement and slope.
 * The support rectangle surrounds the modeled footprint and its point clamps.
 */
export function preparePlate({ points, footprint, thickness, material, boundaryKind, clampForceN }) {
  const bounds = [0, 1].map(k => {
    const coordinates = [...points, ...footprint].map(p => p[k])
    return [Math.min(...coordinates), Math.max(...coordinates)]
  })
  const longest = Math.max(...bounds.map(([lo, hi]) => hi - lo))
  if (!(longest > 0)) throw Error('Expected distinct projected clamp locations')
  const center = bounds.map(([lo, hi]) => (lo + hi) / 2)
  const lengths = bounds.map(([lo, hi]) => Math.max(hi - lo, longest / 2) * 1.5)
  const rigidity = material.youngsModulusMpa * thickness ** 3 / (12 * (1 - material.poissonRatio ** 2))
  const modes = []
  for (let i = 1; i <= 12; i++) {
    for (let j = 1; j <= 12; j++) {
      const x = i * Math.PI / lengths[0]
      const y = j * Math.PI / lengths[1]
      modes.push({ i, j, x, y, compliance: 4 / (rigidity * lengths[0] * lengths[1] * (x * x + y * y) ** 2) })
    }
  }
  function basis(p, derivatives = false) {
    const x = bounded(p[0] - center[0] + lengths[0] / 2, 0, lengths[0])
    const y = bounded(p[1] - center[1] + lengths[1] / 2, 0, lengths[1])
    const windowX = Math.PI / lengths[0]
    const windowY = Math.PI / lengths[1]
    const clamped = boundaryKind !== 'simply-supported'
    const wx = clamped ? Math.sin(windowX * x) : 1
    const wy = clamped ? Math.sin(windowY * y) : 1
    const dx = clamped ? windowX * Math.cos(windowX * x) : 0
    const dy = clamped ? windowY * Math.cos(windowY * y) : 0
    return modes.map(mode => {
      const sx = Math.sin(mode.x * x)
      const sy = Math.sin(mode.y * y)
      if (!derivatives) return sx * sy * wx * wy
      return [sx * sy * wx * wy,
        (mode.x * Math.cos(mode.x * x) * wx + sx * dx) * sy * wy,
        sx * wx * (mode.y * Math.cos(mode.y * y) * wy + sy * dy)]
    })
  }
  function free(p) {
    const nx = 2 * (p[0] - center[0]) / lengths[0]
    const ny = 2 * (p[1] - center[1]) / lengths[1]
    const x = Math.max(0, 1 - nx ** 2)
    const y = Math.max(0, 1 - ny ** 2)
    const dx = x > 0 ? -4 * nx / lengths[0] : 0
    const dy = y > 0 ? -4 * ny / lengths[1] : 0
    if (boundaryKind === 'simply-supported') return [x * y, dx * y, dy * x]
    return [(x * y) ** 2, 2 * x * dx * y ** 2, 2 * y * dy * x ** 2]
  }
  const clampModes = points.map(p => basis(p))
  let clampResponses
  if (boundaryKind === 'simply-supported') {
    clampResponses = clampModes.map(row => row.map((value, k) => value * modes[k].compliance))
  } else {
    // Integrate the Laplacian energy exactly in the windowed basis. Each
    // sin(n*x)*sin(x) is the difference of two orthogonal cosine modes.
    const integrals = length => Array.from({ length: 12 }, (_, i) => Array.from({ length: 12 }, (_, j) => {
      const values = [0, 0, 0]
      for (const [a, ca] of [[i, 0.5], [i + 2, -0.5]]) {
        for (const [b, cb] of [[j, 0.5], [j + 2, -0.5]]) {
          if (a !== b) continue
          const mass = ca * cb * length * (a === 0 ? 1 : 0.5)
          const frequency2 = (a * Math.PI / length) ** 2
          values[0] += mass
          values[1] -= mass * frequency2
          values[2] += mass * frequency2 ** 2
        }
      }
      return values
    }))
    const [x, y] = lengths.map(integrals)
    const stiffness = modes.map(a => modes.map(b => {
      const [x0, x1, x2] = x[a.i - 1][b.i - 1]
      const [y0, y1, y2] = y[a.j - 1][b.j - 1]
      return rigidity * (x2 * y0 + 2 * x1 * y1 + x0 * y2)
    }))
    const factor = factorPositive(stiffness)
    clampResponses = clampModes.map(row => solvePositive(factor, row))
  }
  const matrix = clampModes.map(a => clampResponses.map(b => a.reduce((sum, value, k) => sum + value * b[k], 0)))
  const forces = solvePositive(factorPositive(matrix), points.map(p => -free(p)[0]))
  const gains = modes.map((_, k) => forces.reduce((sum, force, j) => sum + force * clampResponses[j][k], 0))
  const maxForcePerMm = Math.max(...forces.map(Math.abs))
  const evaluations = new Map()
  return {
    bounds, center, lengths, rigidity,
    maxCorrection: clampForceN === undefined ? Infinity : clampForceN / maxForcePerMm,
    at(p) {
      const key = p.join(',')
      if (evaluations.has(key)) return evaluations.get(key)
      const correction = [0, 0, 0]
      basis(p, true).forEach((mode, k) => {
        for (let i = 0; i < 3; i++) correction[i] += mode[i] * gains[k]
      })
      const value = [free(p), correction]
      evaluations.set(key, value)
      return value
    },
  }
}

function randomStream(seed, id, samples, distribution) {
  // Stable across What-If edits and reorderings of other physical models.
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193)
  const rng = createRng((seed ^ hash ^ 0x7451da3b) >>> 0)
  const draws = new Float64Array(samples)
  for (let i = 0; i < samples; i++) {
    if (distribution === 'uniform') draws[i] = 2 * rng.next() - 1
    else {
      let z
      do {
        z = Math.sqrt(-2 * Math.log1p(-rng.next())) * Math.cos(2 * Math.PI * rng.next())
      } while (Math.abs(z) > 3)
      draws[i] = z / 3
    }
  }
  return draws
}

function frameOnPart(partId, featureId, geometry) {
  const feature = geometry.feature(featureId)
  if (feature.partId !== partId) throw Error('Compliance feature belongs to another part: ' + featureId)
  return placed(feature, geometry.poses)
}

function partAxis(partId, geometry, normal) {
  const { rotation } = geometry.poses[geometry.parts.get(partId)]
  const x = transverse(rotate(rotation, [1, 0, 0]), normal)
  return norm(x) > 1e-8 ? unit(x) : unit(transverse(rotate(rotation, [0, 1, 0]), normal))
}

function compileModel(model, context) {
  const { assembly, geometry, materialOf, featuresByPart, parameters, projectPoints, plateCache } = context
  const partId = model.partId
  const shift = (direction, amount, angular = zero) => poseDelta(scale(direction, amount), angular)
  switch (model.kind) {
    case 'axial-compression': {
      const { featureId, preloadN, preloadTolN = 0, lengthMm, effectiveAreaMm2,
        stiffnessNPerMm, springbackRatio = 0 } = model
      const { point, axis } = frameOnPart(partId, featureId, geometry)
      if (!axis || !geometry.feature(featureId).plane) throw Error('Axial compression requires a planar loaded end')
      if (!stiffnessNPerMm && !(lengthMm && effectiveAreaMm2)) throw Error('Axial compression requires K or both A and L')
      const flexibility = stiffnessNPerMm
        ? 1 / stiffnessNPerMm : lengthMm / (materialOf(partId).youngsModulusMpa * effectiveAreaMm2)
      const thickness = stiffnessNPerMm ? [] : [...parameters.values()].filter(parameter =>
        parameter.featureId === featureId && parameter.index < 3 && Math.abs(axis[parameter.index]) > 1e-8)
      const span = lengthMm ?? Math.max(0, ...featuresByPart.get(partId).map(p => dot(sub(point, p), axis)))
      return {
        parts: [partId],
        at: (_, p, id) => {
          const distance = dot(sub(p, point), axis)
          const fraction = span ? bounded(1 + distance / span, 0, 1) : Number(distance >= -1e-8)
          return [shift(axis, id === featureId ? -1 : -fraction)]
        },
        amplitudes: (z, i) => {
          const delta = thickness.reduce((sum, parameter) =>
            sum + axis[parameter.index] * (i < 0 ? 0 : parameter.draws[i] * parameter.sigma), 0)
          const factor = thickness.length ? Math.max(0, 1 + delta / lengthMm) : 1
          return [Math.max(0, preloadN + preloadTolN * z) * flexibility * factor * (1 - springbackRatio)]
        },
      }
    }
    case 'beam-bending': {
      const { loadFeatureId, supportKind, spanMm, momentOfInertiaMm4, forceN, forceTolN = 0 } = model
      const load = frameOnPart(partId, loadFeatureId, geometry)
      const direction = unit(model.direction ?? load.axis ?? rotate(geometry.poses[geometry.parts.get(partId)].rotation, [0, 0, 1]))
      const axis = partAxis(partId, geometry, direction)
      const loadAt = supportKind === 'cantilever' ? spanMm : spanMm / 2
      const origin = sub(load.point, scale(axis, loadAt))
      const rotationAxis = cross(axis, direction)
      const ei = materialOf(partId).youngsModulusMpa * momentOfInertiaMm4
      projectPoints(partId, [origin, add(origin, scale(axis, spanMm))])
      return {
        parts: [partId],
        at: (_, p) => {
          const x = dot(sub(p, origin), axis)
          const [deflection, slope] = beamDeflection(supportKind, x, spanMm, ei)
          const rotation = scale(rotationAxis, slope)
          const offset = transverse(sub(p, origin), axis)
          return [poseDelta(add(scale(direction, deflection), cross(rotation, offset)), rotation)]
        },
        amplitudes: z => [forceN + forceTolN * z],
      }
    }
    case 'plate-clamping': {
      const { surfaceFeatureId, thicknessQ, initialWarpPeakQ, warpTolQ = 0, clampFeatureIds, clampForceN, boundaryKind } = model
      const { point, axis } = frameOnPart(partId, surfaceFeatureId, geometry)
      if (!axis || !geometry.feature(surfaceFeatureId).plane) throw Error('Plate clamping requires a planar reference face')
      const x = partAxis(partId, geometry, axis)
      const y = cross(axis, x)
      const xy = p => [dot(sub(p, point), x), dot(sub(p, point), y)]
      const world = (a, b) => add(point, add(scale(x, a), scale(y, b)))
      const points = clampFeatureIds.map(id => xy(frameOnPart(partId, id, geometry).point))
      const footprint = featuresByPart.get(partId).map(xy)
      const { sizeQ, baseKind } = assembly.parts.find(part => part.id === partId)
      if (baseKind === 'plate') {
        const { translation, rotation } = geometry.poses[geometry.parts.get(partId)]
        for (const a of [0, sizeQ.lengthQ * qToMm]) {
          for (const b of [0, sizeQ.widthQ * qToMm]) {
            const local = [a, b, 0]
            const corner = add(translation, rotate(rotation, local))
            footprint.push(xy(corner))
          }
        }
      }
      const material = materialOf(partId)
      const key = JSON.stringify([points, footprint, thicknessQ, material.youngsModulusMpa, material.poissonRatio, boundaryKind, clampForceN])
      let plate = plateCache.get(key)
      if (!plate) {
        plate = preparePlate({ points, footprint, thickness: thicknessQ * qToMm, material, boundaryKind, clampForceN })
        plateCache.set(key, plate)
      }
      const grid = []
      const [[xmin, xmax], [ymin, ymax]] = plate.bounds
      for (const a of [0, 0.25, 0.5, 0.75, 1]) {
        for (const b of [0, 0.25, 0.5, 0.75, 1]) {
          grid.push(world(xmin + a * (xmax - xmin), ymin + b * (ymax - ymin)))
        }
      }
      projectPoints(partId, grid)
      return {
        parts: [partId],
        at: (_, p) => plate.at(xy(p)).map(([w, wx, wy]) =>
          shift(axis, w, add(scale(cross(x, axis), wx), scale(cross(y, axis), wy)))),
        amplitudes: z => {
          const peak = (initialWarpPeakQ + warpTolQ * z) * qToMm
          return [peak, bounded(peak, -plate.maxCorrection, plate.maxCorrection)]
        },
      }
    }
    case 'thermal-expansion': {
      const { partIds, referenceFeatureId, deltaTemperatureK, deltaTempTolK = 0, bimetallicCoupling } = model
      const materials = new Map(partIds.map(id => [id, materialOf(id)]))
      const anchor = referenceFeatureId && placed(geometry.feature(referenceFeatureId), geometry.poses).point
      const anchors = new Map(partIds.map(id => [id, anchor || geometry.poses[geometry.parts.get(id)].translation]))
      const bends = new Map()
      if (bimetallicCoupling && partIds.length > 1) {
        const parts = new Map(assembly.parts.map(part => [part.id, part]))
        const thickness = id => {
          const configured = assembly.physics.compliantModels.find(candidate => candidate.kind === 'plate-clamping' && candidate.partId === id)
          const size = parts.get(id).sizeQ
          const q = configured?.thicknessQ ?? size?.thicknessQ ?? size?.wallQ
          if (q) return q * qToMm
          const { rotation, translation } = geometry.poses[geometry.parts.get(id)]
          const normal = rotate(rotation, [0, 0, 1])
          const coordinates = featuresByPart.get(id).map(p => dot(sub(p, translation), normal))
          return coordinates.length ? Math.max(...coordinates) - Math.min(...coordinates) : 0
        }
        // Explicit two-layer selection. For larger selections use ordered pairs connected by direct mates.
        const pairs = partIds.length === 2 ? [partIds] : assembly.mates.flatMap(mate =>
          (mate.contactPairs ?? [mate.featureIds]).map(pair => pair.map(id => geometry.feature(id).partId)))
        for (let [first, second] of pairs) {
          if (partIds.indexOf(first) > partIds.indexOf(second)) [first, second] = [second, first]
          if (first === second || !materials.has(first) || !materials.has(second) || bends.has(first) || bends.has(second)) continue
          const a = materials.get(first)
          const b = materials.get(second)
          if (a.thermalExpansionPerK === b.thermalExpansionPerK) continue
          const t1 = thickness(first)
          const t2 = thickness(second)
          if (!(t1 > 0 && t2 > 0)) throw Error('Bimetal coupling requires thickness for both layers')
          const normal = rotate(geometry.poses[geometry.parts.get(first)].rotation, [0, 0, 1])
          const axis = partAxis(first, geometry, normal)
          const curvature = bimetalCurvature(a, b, t1, t2)
          const bend = { normal, axis, curvature, origin: anchors.get(first) }
          bends.set(first, bend)
          bends.set(second, bend)
        }
      }
      return {
        parts: partIds,
        at: (id, p) => {
          const thermal = scale(sub(p, anchors.get(id)), materials.get(id).thermalExpansionPerK)
          const bend = bends.get(id)
          if (!bend) return [poseDelta(thermal)]
          const x = dot(sub(p, bend.origin), bend.axis)
          const rotation = scale(cross(bend.axis, bend.normal), bend.curvature * x)
          const lever = sub(p, add(bend.origin, scale(bend.axis, x)))
          const warp = scale(bend.normal, bend.curvature * x ** 2 / 2)
          return [poseDelta(add(thermal, add(warp, cross(rotation, lever))), rotation)]
        },
        amplitudes: z => [deltaTemperatureK + deltaTempTolK * z],
      }
    }
  }
}

function sumPose(target, source, factor) {
  for (let i = 0; i < 6; i++) target[i] += source[i] * factor
}

function posesAt(models, local, world, geometry, assembly, response) {
  const mates = new Set(assembly.mates.flatMap(mate => mate.featureIds ?? mate.contactPairs.flat()))
  const responses = new Map()
  const responseOf = (id, index) => {
    const key = JSON.stringify([id, index])
    if (!responses.has(key)) responses.set(key, response(id, dofs[index]))
    return responses.get(key)
  }
  return models.map(model => {
    const motions = model.nominal.map(() => new Map())
    for (const id of mates) {
      const effects = local(model, geometry.feature(id).partId, world.get(id).point, id)
      effects.forEach((effect, channel) => effect.forEach((coefficient, index) => {
        if (Math.abs(coefficient) < 1e-13) return
        for (const [part, displacement] of responseOf(id, index)) {
          if (!motions[channel].has(part)) motions[channel].set(part, zeroPose.slice())
          sumPose(motions[channel].get(part), displacement, coefficient)
        }
      }))
    }
    const byFeature = new Map([...world].map(([id, frame]) => {
      const feature = geometry.feature(id)
      const effects = local(model, feature.partId, frame.point, id)
      const relative = sub(frame.point, geometry.poses[feature.part].translation)
      return [id, effects.map((effect, i) => {
        const motion = motions[i].get(feature.part)
        if (!motion) return effect
        const rotationShift = cross(motion.slice(3), relative)
        return effect.map((value, k) => value + motion[k] + (k < 3 ? rotationShift[k] : 0))
      })]
    }))
    return { ...model, effects: byFeature }
  })
}

/**
 * micEvaluator, when installed by the worker, compiles the selected reference
 * into { modelId, parts, at(partId, point, featureId), amplitudes(z, sampleIndex) }.
 * at returns one world-frame 6-component basis per amplitude. Optional
 * pointsByPart maps part IDs to world-space field sample positions.
 */
export function prepareCompliance(assembly, geometry, { seed, samples, distribution, parameters, response, micEvaluator,
  plateCache = new Map(), streams = new Map() }) {
  const input = assembly.physics
  if (!input || input.enabled === false || !input.compliantModels?.length && !(input.micMatrixRef && micEvaluator)) return null
  const physics = assemblyPhysicsSpecSchema.parse(input)
  assembly = { ...assembly, physics }
  const materials = new Map()
  for (const spec of physics.materials ?? []) {
    if (!geometry.parts.has(spec.partId) || materials.has(spec.partId)) throw Error('Invalid material binding: ' + spec.partId)
    materials.set(spec.partId, resolveMaterial(spec.partId, spec))
  }
  const materialOf = id => {
    if (!materials.has(id)) throw Error('Compliance requires a material for part: ' + id)
    return materials.get(id)
  }
  const featuresByPart = new Map(assembly.parts.map(({ id }) => [id, []]))
  const world = new Map(assembly.features.map(({ id, partId }) => {
    const frame = placed(geometry.feature(id), geometry.poses)
    featuresByPart.get(partId).push(frame.point)
    return [id, frame]
  }))
  const pointsByPart = new Map()
  const projectPoints = (id, points) => pointsByPart.set(id, [...(pointsByPart.get(id) ?? []), ...points])
  const models = (physics.compliantModels ?? []).map(model => ({
    modelId: model.id, kind: model.kind,
    ...compileModel(model, { assembly, geometry, materialOf, featuresByPart, parameters, projectPoints, plateCache }),
  }))
  if (physics.micMatrixRef && micEvaluator) {
    const mic = micEvaluator({ assembly, geometry, reference: physics.micMatrixRef, seed, samples, distribution, parameters })
    if (mic) {
      models.push({ ...mic, kind: 'mic-matrix' })
      for (const [id, points] of mic.pointsByPart ?? []) projectPoints(id, points)
    }
  }
  if (!models.length) return null
  if (new Set(models.map(m => m.modelId)).size !== models.length) throw Error('Duplicate compliance model ID')
  for (const model of models) {
    if (!streams.has(model.modelId)) streams.set(model.modelId, randomStream(seed, model.modelId, samples, distribution))
    const draws = streams.get(model.modelId)
    model.nominal = model.amplitudes(0, -1)
    model.channels = model.nominal.map(() => new Float64Array(samples))
    for (let i = 0; i < samples; i++) {
      const values = model.amplitudes(draws[i], i)
      for (let channel = 0; channel < model.channels.length; channel++) model.channels[channel][i] = values[channel]
    }
  }
  const affectedParts = new Set(models.flatMap(model => model.parts))
  const local = (model, partId, point, id) => model.parts.includes(partId)
    ? model.at(partId, point, id) : model.nominal.map(() => zeroPose)
  const displacementFields = [...affectedParts].map(partId => {
    const positions = new Map()
    for (const [id, frame] of world) {
      if (geometry.feature(id).partId === partId) positions.set(frame.point.join(','), { point: frame.point, id })
    }
    for (const point of pointsByPart.get(partId) ?? []) {
      if (!positions.has(point.join(','))) positions.set(point.join(','), { point })
    }
    if (!positions.size) {
      const point = geometry.poses[geometry.parts.get(partId)].translation
      positions.set(point.join(','), { point })
    }
    const samples = [...positions.values()].map(({ point, id }) => {
      const dispMm = [0, 0, 0]
      for (const model of models) {
        local(model, partId, point, id).forEach((effect, channel) => {
          for (let k = 0; k < 3; k++) dispMm[k] += effect[k] * model.nominal[channel]
        })
      }
      return { posMm: point, dispMm, magMm: norm(dispMm) }
    })
    const magnitudes = samples.map(sample => sample.magMm)
    return { partId, samples, minDisplacementMm: Math.min(...magnitudes), maxDisplacementMm: Math.max(...magnitudes) }
  })
  return { models: posesAt(models, local, world, geometry, assembly, response), displacementFields }
}

/** Compact each model's nonzero basis for a particular measurement or control. */
export function projectCompliance(models, size, project) {
  return models.flatMap(model => {
    const coefficients = model.channels.map((_, i) => project(model.effects, i, model))
    const channels = model.channels.flatMap((draws, i) =>
      coefficients[i].some(value => Math.abs(value) > 1e-12) ? [{
        draws, nominal: model.nominal[i], coefficients: coefficients[i],
      }] : [])
    return channels.length ? [{ modelId: model.modelId, kind: model.kind, channels, size }] : []
  })
}

export function accumulateModel(target, { channels, size }, sample, sign = 1) {
  for (const { draws, nominal, coefficients } of channels) {
    const value = sign * (sample < 0 ? nominal : draws[sample])
    for (let i = 0; i < size; i++) target[i] += coefficients[i] * value
  }
}

export function accumulateCompliance(target, projected, sample) {
  for (const model of projected) accumulateModel(target, model, sample)
}

export function contributionRecords(projected) {
  return projected.map(model => ({ model, mean: 0, m2: 0 }))
}

export function recordContribution(record, sample, value) {
  const delta = value - record.mean
  record.mean += delta / (sample + 1)
  record.m2 += delta * (value - record.mean)
}

export function contributionWeights(records, samples) {
  return records.map(({ model, m2 }) => ({ modelId: model.modelId, kind: model.kind, variance: m2 / Math.max(1, samples - 1) }))
}
