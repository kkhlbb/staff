import { bounds, box, exportPlateStep } from '../../geometry-prototype/plate.mjs'
import { qToGeometryMm as mm } from '../../../shared/project-agent/contracts.ts'
import { Q_PER_MM } from '../../../../src/domain/types.ts'
import { drawingDependencies, projectPlate } from './drawing.mjs'
import { buildPlate, measureAssembly, placement, tessellate, verifyPlate } from './solid.mjs'

const holeRoles = ['hole.left.axis', 'hole.right.axis']
const gapRoles = ['plate.topFace', 'cover.bottomFace']
const checkSpecs = [
  ['MP-01', ['plate.rightFace', 'plate.topFace']],
  ['MP-02', holeRoles],
  ['MP-03', ['hole.right.axis', 'plate.rightFace']],
  ['MP-04', gapRoles],
  ['MP-05', gapRoles],
  ['fixedPose', gapRoles],
]
const source = {
  file: 'mounting-plate-taskbook.pdf',
  sha256: 'd455a7fa1d91741ec94b14ff6b4a63036b6d09f5e75a6c506875dd8d063b9c42',
}
const q = value => Math.round(value * Q_PER_MM)
const twiceQToMm = value => mm(value) / 2

function validate(model, tolerance) {
  if (model.version !== 1 || model.unit !== 'mm' || typeof model.revision !== 'string' || !model.revision ||
      !Number.isSafeInteger(model.displayDecimals) || model.displayDecimals < 0 || model.displayDecimals > 4 ||
      typeof model.frame.id !== 'string' || !model.frame.id) throw new Error('Unsupported model definition')
  const { plate, holes, cover, constraints } = model
  if (plate.operation !== 'rectangleExtrusion' || cover.operation !== 'rectangleExtrusion' ||
      plate.sketch.plane !== 'XY' || plate.sketch.offsetQ !== 0 || cover.sketch.plane !== 'XY' ||
      holes.some(hole => hole.operation !== 'throughCut' || hole.sketch.plane !== 'XY' ||
        hole.sketch.offsetQ !== 0 || hole.direction !== '+Z' || !holeRoles.includes(hole.role))) {
    throw new Error('Unsupported sketch or feature operation')
  }
  const ids = [plate.id, cover.id, ...holes.map(hole => hole.id)]
  if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !id)) throw new Error('Invalid feature identities')
  const variables = [plate.thickness, cover.bottom, ...holes.flatMap(hole => [hole.x, hole.y, hole.diameter])]
  const variableIds = new Set()
  for (const variable of variables) {
    mm(variable.nominalQ)
    if (mm(variable.toleranceQ) < 0 || !variable.id || variableIds.has(variable.id)) throw new Error('Invalid variable definition')
    variableIds.add(variable.id)
  }
  if ([plate.lengthQ, plate.widthQ, plate.thickness.nominalQ - plate.thickness.toleranceQ, cover.thicknessQ]
      .some(value => mm(value) <= tolerance) ||
      mm(constraints.rightMargin.minQ) < 0 || mm(constraints.gap.minQ) < 0 ||
      !Number.isFinite(constraints.angularVariationDegrees) || constraints.angularVariationDegrees < 0 ||
      constraints.rightMargin.clause !== 'MP-03' || constraints.gap.clause !== 'MP-05') {
    throw new Error('Invalid plate dimensions or analysis constraints')
  }
  for (const [i, hole] of holes.entries()) {
    const { x, y, diameter } = hole
    const radius = mm(diameter.nominalQ) / 2
    if (mm(diameter.nominalQ - diameter.toleranceQ) <= tolerance ||
        Math.min(mm(x.nominalQ), mm(y.nominalQ), mm(plate.lengthQ - x.nominalQ),
          mm(plate.widthQ - y.nominalQ)) - radius <= tolerance ||
        holes.slice(0, i).some(other => Math.hypot(mm(x.nominalQ - other.x.nominalQ), mm(y.nominalQ - other.y.nominalQ)) -
          radius - mm(other.diameter.nominalQ) / 2 <= tolerance)) {
      throw new Error('Expected separate, enclosed through holes: ' + hole.id)
    }
  }
}

function compare(minMm, targetMm) {
  const marginMm = twiceQToMm(Math.round((minMm - targetMm) * (2 * Q_PER_MM)))
  return { status: marginMm >= 0 ? 'pass' : 'fail', targetMm, marginMm, deficitMm: Math.max(0, -marginMm) }
}

function margin(model, references) {
  const cylinder = references['hole.right.axis'].geometry
  const rightFace = references['plate.rightFace'].geometry
  const feature = model.holes.find(hole => hole.id === references['hole.right.axis'].featureId)
  const { x, y, diameter } = feature
  const nominal2Q = 2 * (q(rightFace.min[0]) - q(cylinder.origin[0])) - q(2 * cylinder.radius)
  const delta2Q = 2 * x.toleranceQ + diameter.toleranceQ
  const intervalMm = [nominal2Q - delta2Q, nominal2Q + delta2Q].map(twiceQToMm)
  const limit = sign => ({
    [x.id]: mm(x.nominalQ + sign * x.toleranceQ),
    [diameter.id]: mm(diameter.nominalQ + sign * diameter.toleranceQ),
    [y.id]: [mm(y.nominalQ - y.toleranceQ), mm(y.nominalQ + y.toleranceQ)],
  })
  return { ...compare(intervalMm[0], mm(model.constraints.rightMargin.minQ)),
    nominalMm: twiceQToMm(nominal2Q), intervalMm, variables: [x, y, diameter],
    extremesMm: { min: limit(1), max: limit(-1) }, method: 'right face X minus axis X minus radius; Y is independent' }
}

function gap(model, evidence) {
  if (model.constraints.angularVariationDegrees !== 0) {
    return { status: 'uncovered', reason: 'Angular variation exceeds the fixed parallel-face domain',
      angularVariationDegrees: model.constraints.angularVariationDegrees }
  }
  const { plate: { thickness }, cover: { bottom }, frame } = model
  const nominalQ = q(evidence.signedGapMm)
  const deltaQ = thickness.toleranceQ + bottom.toleranceQ
  const intervalMm = [nominalQ - deltaQ, nominalQ + deltaQ].map(mm)
  return { ...compare(intervalMm[0], mm(model.constraints.gap.minQ)), nominalMm: mm(nominalQ), intervalMm,
    frame, variables: [thickness, bottom], method: 'parallel face projections along the transformed local +Z normal', evidence,
    extremesMm: {
      min: { [thickness.id]: mm(thickness.nominalQ + thickness.toleranceQ), [bottom.id]: mm(bottom.nominalQ - bottom.toleranceQ) },
      max: { [thickness.id]: mm(thickness.nominalQ - thickness.toleranceQ), [bottom.id]: mm(bottom.nominalQ + bottom.toleranceQ) },
    } }
}

function fixedPose(model, evidence, toleranceMm) {
  const { plateTopMm, plateBottomMm, coverTopMm, coverBottomMm, commonVolumeMm3 } = evidence
  const overlap = Math.min(plateTopMm, coverTopMm) - Math.max(plateBottomMm, coverBottomMm)
  const relation = overlap < -toleranceMm ? 'clearance' : overlap > toleranceMm ? 'interference' : 'contact'
  if ((relation === 'interference') !== (commonVolumeMm3 > toleranceMm ** 3)) {
    return { status: 'executionFailed', reason: 'Axial relation disagrees with the exact common solid', evidence }
  }
  return { status: relation === 'interference' ? 'fail' : 'pass', relation, frame: model.frame,
    objectIds: [model.plate.id, model.cover.id], toleranceMm, evidence,
    overlapDepthMm: relation === 'interference' ? mm(q(overlap)) : 0,
    clearanceMm: relation === 'clearance' ? mm(q(-overlap)) : 0 }
}

function resolveReferences(model, features) {
  const references = {}
  const invalidations = []
  for (const role of new Set(checkSpecs.flatMap(([, roles]) => roles))) {
    const featureId = model.bindings[role]
    const candidates = features.filter(feature => feature.featureId === featureId && feature.role === role)
    if (candidates.length === 1) references[role] = { ...candidates[0], resolved: true }
    else {
      references[role] = { role, featureId, resolved: false }
      invalidations.push({ role, featureId,
        clauses: checkSpecs.filter(([id, roles]) => id !== 'fixedPose' && roles.includes(role)).map(([id]) => id),
        annotations: drawingDependencies(role) })
    }
  }
  return { references, invalidations }
}

function buildShapes(oc, model) {
  const plate = buildPlate(oc, model)
  try {
    const cover = box(oc, mm(model.cover.bottom.nominalQ), mm(model.cover.thicknessQ),
      mm(model.plate.lengthQ), mm(model.plate.widthQ))
    return { plate, cover }
  } catch (error) {
    plate.delete()
    throw error
  }
}

export function evaluate(oc, model, drawingOptions, frameId, deferDrawing, acquireShapes) {
  const toleranceMm = oc.Precision.Confusion()
  const metadata = { revision: model.revision, unit: model.unit, modelingToleranceMm: toleranceMm,
    solverVersion: 'mounting-plate-1', rulesVersion: 'mounting-plate-taskbook-1', source }
  try {
    validate(model, toleranceMm)
    using pose = placement(oc, model.frame)
    const build = () => buildShapes(oc, model)
    const { plate, cover } = acquireShapes ? acquireShapes(build) : build()
    // The cache owns both wrappers on acquisition. Otherwise this evaluation owns them.
    using ownedPlate = acquireShapes ? undefined : plate
    using ownedCover = acquireShapes ? undefined : cover
    const { measured, features } = verifyPlate(oc, plate, model, toleranceMm)
    const { min, max } = bounds(oc, cover)
    features.push({ featureId: model.cover.id, role: 'cover.bottomFace',
      geometry: { min, max: [max[0], max[1], min[2]] } })
    const { references, invalidations } = resolveReferences(model, features)
    const evidence = measureAssembly(oc, plate, cover, pose, model.frame.zAxis)
    const evaluateCheck = {
      'MP-03': () => margin(model, references),
      'MP-05': () => gap(model, evidence),
      fixedPose: () => fixedPose(model, evidence, toleranceMm),
    }
    const checks = checkSpecs.map(([id, roles]) => {
      const targets = roles.map(role => ({ role, featureId: references[role].featureId }))
      const missing = roles.filter(role => !references[role].resolved)
      const result = missing.length ? { status: 'needsClarification', missing }
        : evaluateCheck[id]?.() ?? { status: 'pass' }
      const page = id === 'fixedPose' ? null : id >= 'MP-04' ? 2 : 1
      return { id, page, targets, ...result }
    })
    const drawing = deferDrawing
      ? { unit: model.unit, revision: model.revision, displayDecimals: model.displayDecimals,
        convention: 'local orthographic', views: [], annotations: [], errors: [] }
      : projectPlate(model, measured, references, drawingOptions)
    const statuses = checks.map(check => check.status)
    for (const { code } of drawing.errors) {
      statuses.push(code === 'projectionFailed' ? 'executionFailed' : 'needsClarification')
    }
    const status = ['executionFailed', 'needsClarification', 'fail', 'uncovered'].find(value => statuses.includes(value)) ?? 'pass'
    return { ...metadata, status, model, measured, references, invalidations, checks, drawing,
      mesh: { plate: tessellate(oc, plate, 'plate', pose, model, features, toleranceMm, frameId),
        cover: tessellate(oc, cover, 'cover', pose, model, features, toleranceMm, frameId) },
      plateStep: exportPlateStep(oc, plate), placement: { frame: model.frame, worldPlateBounds: evidence.worldPlateBounds } }
  } catch (error) {
    if (error instanceof WebAssembly.RuntimeError) throw error
    return { ...metadata, status: 'executionFailed', error: { code: 'geometryFailed', message: String(error) },
      checks: checkSpecs.map(([id]) => ({ id, status: 'executionFailed' })) }
  }
}
