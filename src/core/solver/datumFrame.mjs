import { add, cross, dot, norm, perpendicular, scale, sub, transverse, unit } from './spatial.mjs'

const epsilon = 1e-8

// Rows are orthogonalized in precedence order. A later datum can only
// change coordinates in the null space left by the earlier datums.
function append(rows, direction, datum, target) {
  const residue = rows.reduce((vector, row) => sub(vector, scale(row.axis, dot(vector, row.axis))), direction)
  const length = norm(residue)
  if (length <= epsilon) return
  rows.push({ axis: scale(residue, 1 / length), direction, datum, target })
}

export function buildDatumFrame(datums) {
  const primary = datums[0]
  const invalid = datum => ({ code: 'DRF_DEGENERATE', ...(datum && { datumId: datum.id }) })
  if (!primary || datums.length > 3) return invalid(primary)
  const translation = []
  const rotation = []
  let origin = primary.point
  const z = primary.axis
  let x
  const ranks = []

  for (const [index, datum] of datums.entries()) {
    if ((!datum.plane && !datum.cylinder) || !datum.axis) return invalid(datum)
    const { axis, point } = datum
    const first = perpendicular(axis)
    const second = cross(axis, first)
    const count = translation.length + rotation.length
    const capacity = index === 0 ? (datum.plane ? 3 : 4) : index === 1 ? 2 : 1
    const available = () => translation.length + rotation.length - count < capacity
    for (const direction of [first, second]) {
      if (available()) append(rotation, direction, datum)
    }
    for (const direction of datum.plane ? [axis] : [first, second]) {
      if (!available()) break
      const previous = translation.length
      append(translation, direction, datum, dot(direction, point))
      if (translation.length > previous) {
        const row = translation.at(-1)
        origin = add(origin, scale(row.axis, (row.target - dot(direction, origin)) / dot(direction, row.axis)))
      }
    }
    // A second parallel axis can clock the frame when its center is offset.
    if (index > 0 && datum.cylinder && available() && norm(cross(axis, z)) <= epsilon) {
      const pivot = datums.slice(0, index).find(reference => reference.cylinder)?.point ?? origin
      const radial = transverse(sub(point, pivot), z)
      if (norm(radial) > epsilon) append(rotation, z, { ...datum, clockDirection: unit(cross(z, radial)) })
    }
    const locked = translation.length + rotation.length - count
    if (!locked) return invalid(datum)
    ranks.push(locked)
    if (index > 0 && !x) {
      const projected = transverse(axis, z)
      const offset = transverse(sub(point, origin), z)
      if (norm(projected) > epsilon) x = unit(projected)
      else if (datum.cylinder && norm(offset) > epsilon) x = unit(offset)
    }
  }
  x ??= perpendicular(z)
  const y = unit(cross(z, x))
  x = cross(y, z)
  return {
    origin, axes: [x, y, z], ranks, translation, rotation,
    remainingDof: 6 - translation.length - rotation.length,
    transform: [0, 1, 2].map(i => [x[i], y[i], z[i], origin[i]]).concat([[0, 0, 0, 1]]),
  }
}
