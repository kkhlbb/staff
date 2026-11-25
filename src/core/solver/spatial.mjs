export const dofs = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz']
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const norm = a => Math.hypot(a[0], a[1], a[2])
export const rotate = (rows, vector) => [dot(rows[0], vector), dot(rows[1], vector), dot(rows[2], vector)]
export const transverse = (v, axis) => sub(v, scale(axis, dot(v, axis)))
export function unit(v) {
  const length = norm(v)
  if (!(length > 0 && Number.isFinite(length))) throw Error('Feature direction must be finite and nonzero')
  return scale(v, 1 / length)
}
export const perpendicular = axis => unit(cross(axis, Math.abs(axis[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]))

// Rodrigues exponential in a world-aligned tangent frame.
export function turn(v, omega) {
  const theta = norm(omega)
  const first = cross(omega, v)
  const sine = theta < 1e-8 ? 1 : Math.sin(theta) / theta
  const cosine = theta < 1e-8 ? 0.5 : 2 * (Math.sin(theta / 2) / theta) ** 2
  return add(add(v, scale(first, sine)), scale(cross(omega, first), cosine))
}

function assertRigidPose(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 4 ||
      !matrix.every(row => Array.isArray(row) && row.length === 4 && row.every(Number.isFinite)) ||
      matrix[3].some((value, i) => value !== Number(i === 3))) throw Error('Expected a homogeneous 4×4 pose')
  const [x, y, z] = matrix
  const near = (a, b) => Math.abs(a - b) <= 1e-8
  if (![x, y, z].every(row => near(dot(row, row), 1)) ||
      !near(dot(x, y), 0) || !near(dot(y, z), 0) || !near(dot(z, x), 0) ||
      !near(dot(cross(x, y), z), 1)) throw Error('Expected a proper rigid pose')
}

export function scene(assembly) {
  if (assembly?.schemaVersion !== 1 || assembly.units !== 'mm') throw Error('Expected Schema 11 assembly in mm')
  const parts = new Map()
  const poses = assembly.parts.map(({ id, nominalTransform }) => {
    if (parts.has(id)) throw Error('Duplicate part ID: ' + id)
    parts.set(id, parts.size)
    assertRigidPose(nominalTransform)
    const rows = nominalTransform.slice(0, 3)
    return { rotation: rows.map(row => row.slice(0, 3)), translation: rows.map(row => row[3]) }
  })
  const features = new Map()
  for (const feature of assembly.features) {
    const { id, partId, kind } = feature
    if (features.has(id) || !parts.has(partId)) throw Error('Invalid feature binding: ' + id)
    const originQ = feature.originQ ?? feature.positionQ ?? feature.apexQ ?? feature.startQ
    if (originQ?.length !== 3 || !originQ.every(Number.isSafeInteger)) throw Error('Invalid feature coordinates: ' + id)
    const plane = kind === 'face' && feature.surface === 'plane'
    const axial = kind === 'cylindrical-hole-axis' || kind === 'cone'
    const direction = plane ? feature.normal : axial ? feature.axis
      : kind === 'edge' && feature.curve === 'line' ? sub(feature.endQ, feature.startQ) : null
    features.set(id, {
      id, partId, part: parts.get(partId), plane, axial, radius: feature.radiusQ / 10000,
      point: scale(originQ, 0.0001), axis: direction ? unit(direction) : null,
    })
  }
  function feature(id) {
    if (!features.has(id)) throw Error('Unknown feature: ' + id)
    return features.get(id)
  }
  return { parts, poses, feature }
}

export function placed(feature, poses) {
  const { rotation, translation } = poses[feature.part]
  return { point: add(rotate(rotation, feature.point), translation), axis: feature.axis && rotate(rotation, feature.axis) }
}
