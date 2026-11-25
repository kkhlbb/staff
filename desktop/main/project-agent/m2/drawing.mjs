const dimensions = [
  ['plate.length', 'front', 'below', 0, 'plate.rightFace', 'length'],
  ['plate.width', 'top', 'left', 0, 'plate.topFace', 'width'],
  ['plate.thickness', 'side', 'right', 0, 'plate.topFace', 'thickness'],
  ...['left', 'right'].flatMap((side, i) => [
    ['hole.' + side + '.diameter', 'top', 'above', i, 'hole.' + side + '.axis', 'diameter'],
    ['hole.' + side + '.x', 'top', 'below', i, 'hole.' + side + '.axis', 'x'],
    ['hole.' + side + '.y', 'top', 'right', i, 'hole.' + side + '.axis', 'y'],
  ]),
]

export function drawingDependencies(role) {
  return dimensions.filter(dimension => dimension[4] === role).map(dimension => dimension[0])
}

export function projectPlate(model, measured, references, options = {}) {
  const errors = []
  const { min, max } = measured.bounds
  const [x, y, z] = max.map((value, i) => value - min[i])
  const values = { length: x, width: y, thickness: z }
  const unit = model.unit
  const revision = model.revision
  const result = { unit, revision, displayDecimals: model.displayDecimals,
    convention: 'local orthographic, +Y viewing direction for front, -Z for top, -X for right side',
    views: [], annotations: [], errors }
  // Every silhouette and hidden bore is analytic in the planar plate / normal through-hole domain.
  const rectangle = (width, height) => ({ kind: 'polyline', closed: true, points: [[0, 0], [width, 0], [width, height], [0, height]] })
  const vectorView = (id, width, height, u, v, hiddenAxis) => ({
    id, size: [width, height], u, v, geometry: [rectangle(width, height), ...measured.cylinders.flatMap(hole => {
      const cx = hole.origin[0] - min[0]
      const cy = hole.origin[1] - min[1]
      if (id === 'top') return [{ kind: 'circle', center: [cx, cy], radius: hole.radius }]
      const center = hiddenAxis === 0 ? cx : cy
      return [-hole.radius, hole.radius].map(offset => ({ kind: 'line', style: 'hidden',
        points: [[center + offset, 0], [center + offset, height]] }))
    })],
  })
  try {
    if (options.convention !== undefined && options.convention !== 'localOrthographic') {
      throw new Error('Unsupported projection convention')
    }
    result.views = [
      vectorView('front', x, z, '+X', '+Z', 0), vectorView('top', x, y, '+X', '+Y'),
      vectorView('side', y, z, '+Y', '+Z', 1),
    ]
  } catch (error) {
    errors.push({ code: 'projectionFailed', message: error.message })
    return result
  }
  const occupied = new Map()
  const conflicts = new Map()
  for (const [id, view, side, defaultLane, role, metric] of dimensions) {
    const reference = references[role]
    if (!reference?.resolved) {
      errors.push({ code: 'missingReference', annotationId: id, role, featureId: reference?.featureId })
      continue
    }
    const lane = options.lanes?.[id] ?? defaultLane
    if (!Number.isSafeInteger(lane) || lane < 0) {
      errors.push({ code: 'annotationConflict', annotationIds: [id], view, side, lane })
      continue
    }
    const slot = [view, side, lane].join('/')
    const annotationIds = occupied.get(slot) ?? []
    annotationIds.push(id)
    occupied.set(slot, annotationIds)
    if (annotationIds.length > 1) conflicts.set(slot, { code: 'annotationConflict', annotationIds, view, side, lane })
    const cylinder = reference.geometry
    const center = cylinder.origin?.slice(0, 2).map((value, i) => value - min[i])
    const radius = cylinder.radius
    const witnesses = {
      length: [[0, 0], [x, 0]], width: [[0, 0], [0, y]], thickness: [[y, 0], [y, z]],
      diameter: center && [[center[0] - radius, center[1]], [center[0] + radius, center[1]]],
      x: center && [[0, center[1]], center], y: center && [[center[0], 0], center],
    }
    const valueMm = values[metric] ?? (metric === 'diameter' ? radius * 2 : center[metric === 'x' ? 0 : 1])
    result.annotations.push({ id, view, side, lane, valueMm, witnesses: witnesses[metric],
      reference: { role, featureId: reference.featureId } })
  }
  errors.push(...conflicts.values())
  const conflictIds = new Set([...conflicts.values()].flatMap(error => error.annotationIds))
  result.annotations = result.annotations.filter(({ id }) => !conflictIds.has(id))
  return result
}
