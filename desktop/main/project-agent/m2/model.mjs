import fixture from '../../geometry-prototype/fixture.json' with { type: 'json' }

export function createMountingPlate(revision = 'r1') {
  const { plate, holes, cover } = fixture
  return {
    version: 1, revision, unit: 'mm', displayDecimals: 2,
    frame: {
      id: 'mounting-plate-local', originQ: [0, 0, 0],
      xAxis: [1, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1],
    },
    nextHoleNumber: 3,
    plate: {
      id: 'plate-1', operation: 'rectangleExtrusion', sketch: { plane: 'XY', offsetQ: 0 },
      lengthQ: plate.lengthQ, widthQ: plate.widthQ, thickness: { id: 'plate.thickness', nominalQ: plate.thicknessQ, toleranceQ: plate.toleranceQ },
    },
    holes: holes.map((hole, i) => ({
      id: 'hole-' + (i + 1), role: i === 0 ? 'hole.left.axis' : 'hole.right.axis',
      operation: 'throughCut', sketch: { plane: 'XY', offsetQ: 0 }, direction: '+Z',
      x: { id: 'hole-' + (i + 1) + '.x', nominalQ: hole.xQ, toleranceQ: i === 0 ? 0 : 2000 },
      y: { id: 'hole-' + (i + 1) + '.y', nominalQ: hole.yQ, toleranceQ: i === 0 ? 0 : 2000 },
      diameter: { id: 'hole-' + (i + 1) + '.diameter', nominalQ: hole.diameterQ, toleranceQ: i === 0 ? 0 : 1000 },
    })),
    cover: {
      id: 'cover-1', operation: 'rectangleExtrusion', sketch: { plane: 'XY' },
      bottom: { id: 'cover.bottom', nominalQ: cover.bottomQ, toleranceQ: cover.toleranceQ },
      thicknessQ: cover.thicknessQ,
    },
    constraints: {
      rightMargin: { clause: 'MP-03', minQ: 130000 },
      gap: { clause: 'MP-05', minQ: 15000 },
      angularVariationDegrees: 0,
    },
    bindings: {
      'plate.rightFace': 'plate-1', 'plate.topFace': 'plate-1',
      'cover.bottomFace': 'cover-1', 'hole.left.axis': 'hole-1', 'hole.right.axis': 'hole-2',
    },
  }
}

export function deleteHole(model, featureId) {
  if (!model.holes.some(hole => hole.id === featureId)) throw new Error('Unknown hole: ' + featureId)
  return { ...model, holes: model.holes.filter(hole => hole.id !== featureId) }
}

export function addHole(model, definition) {
  const id = 'hole-' + model.nextHoleNumber
  if (model.holes.some(hole => hole.id === id) || Object.values(model.bindings).includes(id)) {
    throw new Error('Hole feature allocation would reuse an existing identity')
  }
  const hole = {
    ...definition, id,
    x: { ...definition.x, id: id + '.x' },
    y: { ...definition.y, id: id + '.y' },
    diameter: { ...definition.diameter, id: id + '.diameter' },
  }
  return { ...model, nextHoleNumber: model.nextHoleNumber + 1, holes: [...model.holes, hole] }
}

export function rebindHole(model, role, featureId) {
  if (!model.holes.some(hole => hole.id === featureId && hole.role === role)) {
    throw new Error('Replacement does not have the requested hole axis role')
  }
  return { ...model, bindings: { ...model.bindings, [role]: featureId } }
}
