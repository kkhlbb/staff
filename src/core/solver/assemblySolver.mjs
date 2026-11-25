import { add, cross, dofs, dot, norm, perpendicular, placed, scale, scene, sub, transverse, turn } from './spatial.mjs'

const lengthTolerance = 1e-6
const angleTolerance = 1e-7
const magnitude = values => Math.hypot(...values)
const inner = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0)

function angularResidual(a, b, sign) {
  const target = scale(a, sign ?? (dot(a, b) < 0 ? -1 : 1))
  const offAxis = cross(target, b)
  const sine = norm(offAxis)
  const cosine = dot(target, b)
  const angle = Math.atan2(sine, cosine)
  return sine > 1e-12 ? scale(offAxis, angle / sine)
    : cosine < 0 ? scale(perpendicular(target), Math.PI) : offAxis
}

function constraints(assembly, geometry) {
  const ids = new Set()
  return assembly.mates.map(mate => {
    if (ids.has(mate.id)) throw Error('Duplicate mate ID: ' + mate.id)
    ids.add(mate.id)
    const pairs = (mate.kind === '3-2-1' ? mate.contactPairs : [mate.featureIds])
      .map(pair => pair.map(geometry.feature))
    const [left, right] = pairs[0]
    const error = message => ({ ...mate, error: message, pairs })
    const residual = (fn, angularRows = 0, equations) => ({ id: mate.id, pairs, fn, angularRows, equations })
    const planar = left.plane && right.plane
    const axial = left.axial && right.axial
    switch (mate.kind) {
      case 'face-contact':
        if (planar) return residual(([a, b]) => [...angularResidual(a.axis, b.axis, -1), dot(a.axis, sub(b.point, a.point))], 3, 3)
        break
      case 'parallel':
        if (left.axis && right.axis) return residual(([a, b]) => angularResidual(a.axis, b.axis), 3, 2)
        break
      case 'distance': {
        if (!Number.isSafeInteger(mate.distanceQ)) return error('Distance must be an integer q')
        const target = mate.distanceQ / 10000
        if (left.plane) return residual(([a, b]) => [dot(a.axis, sub(b.point, a.point)) - target], 0, 1)
        if (right.plane) return residual(([a, b]) => [dot(b.axis, sub(a.point, b.point)) - target], 0, 1)
        if (target === 0) return residual(([a, b]) => sub(b.point, a.point), 0, 3)
        if (target > 0) return residual(([a, b]) => {
          const delta = sub(b.point, a.point)
          return [norm(delta) - target]
        }, 0, 1)
        break
      }
      case 'coaxial':
        if (axial) return residual(([a, b]) => [...angularResidual(a.axis, b.axis), ...transverse(sub(b.point, a.point), a.axis)], 3, 4)
        break
      case 'floating-clearance': {
        if (!Number.isFinite(left.radius) || !Number.isFinite(right.radius) || !Number.isSafeInteger(mate.minQ) || !Number.isSafeInteger(mate.maxQ) || mate.minQ < 0 || mate.minQ > mate.maxQ) break
        const lo = mate.minQ / 10000
        const hi = mate.maxQ / 10000
        // For cylindrical geometry the radial travel cannot exceed hole minus shaft radius.
        const physical = left.radius - right.radius
        if (physical < 0) return error('Shaft radius exceeds hole radius')
        if (lo > physical + lengthTolerance) return error('Minimum radial float exceeds available clearance')
        const upper = Math.max(lo, Math.min(hi, physical))
        return residual(([a, b], rankOnly) => {
          const lateral = transverse(sub(b.point, a.point), a.axis)
          const angular = angularResidual(a.axis, b.axis)
          if (upper === 0) return [...angular, ...lateral]
          const radial = norm(lateral)
          if (lo === upper) return [...angular, radial - lo]
          // An interval permits one-sided motion even when a bound is active.
          return [...angular, rankOnly ? 0 : radial - Math.max(lo, Math.min(upper, radial))]
        }, 3, upper === 0 ? 4 : lo === upper ? 3 : 2)
      }
      case '3-2-1':
        if (pairs.length === 6 && pairs.every(([datum, contact]) => datum.plane || contact.plane)) {
          for (const pair of pairs) if (!pair[0].plane) pair.reverse()
          return residual((_, _rankOnly, contact) => contact.map(([a, b]) => dot(a.axis, sub(b.point, a.point))), 0, 6)
        }
        break
    }
    return error('Incompatible feature geometry or mate dimensions: ' + mate.kind)
  })
}

function move(poses, free, step) {
  const result = poses.slice()
  free.forEach((index, i) => {
    const { rotation, translation } = poses[index]
    const omega = step.slice(i * 6 + 3, i * 6 + 6)
    const columns = rotation[0].map((_, column) => turn(rotation.map(row => row[column]), omega))
    result[index] = {
      rotation: rotation.map((_, row) => columns.map(column => column[row])),
      translation: add(translation, step.slice(i * 6, i * 6 + 3)),
    }
  })
  return result
}

function evaluate(poses, mates, rankOnly = false, perturb) {
  return mates.flatMap(mate => {
    const pairs = mate.pairs.map(pair => pair.map(feature => {
      const frame = placed(feature, poses)
      return perturb ? perturb(feature, frame) : frame
    }))
    return mate.fn(pairs[0], rankOnly, pairs).map((value, i) => i < mate.angularRows ? value * 10 : value)
  })
}

function jacobian(poses, free, mates, size, rankOnly = false) {
  const h = 1e-5
  const step = new Float64Array(free.length * 6)
  const rows = Array.from({ length: size }, () => new Float64Array(step.length))
  for (let i = 0; i < step.length; i++) {
    step[i] = h
    const up = evaluate(move(poses, free, step), mates, rankOnly)
    step[i] = -h
    const down = evaluate(move(poses, free, step), mates, rankOnly)
    step[i] = 0
    for (let row = 0; row < size; row++) rows[row][i] = (up[row] - down[row]) / (2 * h)
  }
  return rows
}

// Solve the damped positive definite normal equations by Cholesky.
function dampedStep(rows, values, size, damping) {
  const lower = Array.from({ length: size }, () => new Float64Array(size))
  const rhs = new Float64Array(size)
  for (let i = 0; i < size; i++) {
    for (let k = 0; k < rows.length; k++) rhs[i] -= rows[k][i] * values[k]
    for (let j = 0; j <= i; j++) {
      let value = 0
      for (const row of rows) value += row[i] * row[j]
      if (i === j) value += damping * Math.max(1, value)
      for (let k = 0; k < j; k++) value -= lower[i][k] * lower[j][k]
      lower[i][j] = i === j ? Math.sqrt(value) : value / lower[j][j]
    }
    for (let j = 0; j < i; j++) rhs[i] -= lower[i][j] * rhs[j]
    rhs[i] /= lower[i][i]
  }
  for (let i = size - 1; i >= 0; i--) {
    for (let j = i + 1; j < size; j++) rhs[i] -= lower[j][i] * rhs[j]
    rhs[i] /= lower[i][i]
  }
  return rhs
}

function optimize(initial, free, mates) {
  let poses = initial
  let residual = evaluate(poses, mates)
  let cost = inner(residual, residual)
  let damping = 1e-3
  for (let i = 0; free.length && cost > 1e-20 && i < 100; i++) {
    const rows = jacobian(poses, free, mates, residual.length)
    let step = dampedStep(rows, residual, free.length * 6, damping)
    if (step.every(value => Math.abs(value) < 1e-12)) {
      // A radial lower bound or nonzero point distance has a cusp at zero.
      // Try deterministic single-axis perturbations before accepting stationarity.
      const probe = new Float64Array(step.length)
      for (let col = 0; col < step.length; col++) {
        for (const direction of [1, -1]) {
          probe[col] = direction * 0.001
          const trial = evaluate(move(poses, free, probe), mates)
          if (inner(trial, trial) + 1e-15 < cost) step = probe.slice()
        }
        probe[col] = 0
      }
      if (!step.some(value => Math.abs(value) >= 1e-12)) break
    }
    const candidate = move(poses, free, step)
    const next = evaluate(candidate, mates)
    const score = inner(next, next)
    if (score < cost) {
      poses = candidate
      residual = next
      cost = score
      damping = Math.max(1e-12, damping / 4)
    } else {
      damping *= 10
      if (damping > 1e12) break
    }
  }
  return poses
}

function problems(poses, mates) {
  return mates.flatMap(mate => {
    const values = evaluate(poses, [mate])
    const angleRad = magnitude(values.slice(0, mate.angularRows)) / 10
    const lengthMm = magnitude(values.slice(mate.angularRows))
    return angleRad > angleTolerance || lengthMm > lengthTolerance
      ? [{ mateId: mate.id, angleRad, lengthMm, reason: 'unsatisfied-residual' }] : []
  })
}

function appendBasis(basis, row) {
  const v = Float64Array.from(row)
  const length = magnitude(v)
  if (length < 1e-9) return false
  for (let pass = 0; pass < 2; pass++) {
    for (const q of basis) {
      const projection = inner(q, v)
      for (let i = 0; i < v.length; i++) v[i] -= projection * q[i]
    }
  }
  const remaining = magnitude(v)
  if (remaining < 1e-7 * length) return false
  basis.push(v.map(value => value / remaining))
  return true
}

function diagnose(poses, free, mates) {
  const basis = []
  const rows = jacobian(poses, free, mates, evaluate(poses, mates).length, true)
  const redundantMateIds = []
  let offset = 0
  for (const mate of mates) {
    const count = evaluate(poses, [mate]).length
    const before = basis.length
    for (const row of rows.slice(offset, offset + count)) appendBasis(basis, row)
    if (basis.length - before < mate.equations) redundantMateIds.push(mate.id)
    offset += count
  }
  const size = free.length * 6
  const rank = basis.length
  const nullspace = []
  for (let i = 0; i < size; i++) {
    const axis = new Float64Array(size)
    axis[i] = 1
    if (appendBasis(basis, axis)) nullspace.push(basis.at(-1))
  }
  return { rank, nullspace, redundantMateIds }
}

function conflictGroups(poses, free, mates, residuals) {
  const violated = new Set(residuals.map(item => item.mateId))
  const movable = new Set(free)
  const groups = []
  for (const mate of mates) {
    const parts = new Set(mate.pairs.flat().map(feature => feature.part).filter(part => movable.has(part)))
    const group = { parts, mates: [mate] }
    for (let i = groups.length - 1; i >= 0; i--) {
      const other = groups[i]
      if ([...other.parts].some(part => parts.has(part))) {
        for (const part of other.parts) parts.add(part)
        group.mates.push(...other.mates)
        groups.splice(i, 1)
      }
    }
    groups.push(group)
  }
  return groups.flatMap(group => {
    if (!group.mates.some(mate => violated.has(mate.id))) return []
    let subset = mates.filter(mate => group.mates.includes(mate))
    for (const mate of subset) {
      const reduced = subset.filter(candidate => candidate !== mate)
      if (problems(optimize(poses, [...group.parts], reduced), reduced).length) subset = reduced
    }
    return subset.map(mate => mate.id)
  })
}

// Linearized tolerance transfer through the equality mates at the solved pose.
// Interval float remains free; no contact switching is inferred during sampling.
export function linearizedMateResponse(assembly, geometry, fixedPartIds) {
  const fixed = new Set(fixedPartIds)
  const free = [...geometry.parts].filter(([id]) => !fixed.has(id)).map(([, index]) => index)
  const mates = constraints(assembly, geometry)
  const referenced = new Set(mates.flatMap(mate => mate.pairs.flat().map(feature => feature.id)))
  const rows = jacobian(geometry.poses, free, mates, evaluate(geometry.poses, mates).length, true)
  const zero = [0, 0, 0]
  return (featureId, dof) => {
    if (free.length === 0 || !referenced.has(featureId)) return new Map()
    const h = 1e-5
    const component = dofs.indexOf(dof)
    const displaced = step => {
      const delta = zero.map((_, i) => i === component % 3 ? step : 0)
      return (feature, frame) => {
        if (feature.id !== featureId) return frame
        return component < 3 ? { ...frame, point: add(frame.point, delta) }
          : { ...frame, axis: frame.axis && turn(frame.axis, delta) }
      }
    }
    const up = evaluate(geometry.poses, mates, true, displaced(h))
    const down = evaluate(geometry.poses, mates, true, displaced(-h))
    const derivative = up.map((value, i) => (value - down[i]) / (2 * h))
    const step = dampedStep(rows, derivative, free.length * 6, 1e-9)
    return new Map(free.map((part, i) => [part, step.slice(i * 6, i * 6 + 6)]))
  }
}

export function solveAssembly({ assembly, fixedPartIds = assembly.parts.slice(0, 1).map(part => part.id) }) {
  const geometry = scene(assembly)
  const fixed = new Set(fixedPartIds)
  for (const id of fixed) if (!geometry.parts.has(id)) throw Error('Unknown fixed part: ' + id)
  const free = [...geometry.parts].filter(([id]) => !fixed.has(id)).map(([, index]) => index)
  const compiled = constraints(assembly, geometry)
  const mates = compiled.filter(mate => !mate.error)
  const poses = optimize(geometry.poses, free, mates)
  const invalid = compiled.filter(mate => mate.error).map(mate => ({ mateId: mate.id, reason: mate.error }))
  const residuals = problems(poses, mates)
  const infeasible = new Set(residuals.length ? conflictGroups(poses, free, mates, residuals) : [])
  const { rank, nullspace, redundantMateIds } = diagnose(poses, free, mates)
  const remainingDof = free.length * 6 - rank
  const freeParts = [...geometry.parts.keys()].filter(id => !fixed.has(id))
  const remainingDofs = nullspace.map(mode => freeParts.flatMap((partId, i) =>
    dofs.flatMap((dof, j) => Math.abs(mode[i * 6 + j]) > 1e-7 ? [{ partId, dof, coefficient: mode[i * 6 + j] }] : [])))
  const conflictMateIds = compiled.filter(mate => mate.error || infeasible.has(mate.id)).map(mate => mate.id)
  return {
    status: conflictMateIds.length ? 'overconstrained' : remainingDof ? 'underconstrained' : 'solved',
    fixedPartIds: [...fixed], remainingDof, remainingDofs, redundantMateIds, conflictMateIds,
    contradictions: [...invalid, ...residuals],
    parts: [...geometry.parts].map(([partId, i]) => {
      const { rotation, translation } = poses[i]
      return { partId, nominalTransform: [...rotation.map((row, j) => [...row, translation[j]]), [0, 0, 0, 1]] }
    }),
  }
}
