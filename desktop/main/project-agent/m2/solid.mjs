import { qToGeometryMm as mm } from '../../../shared/project-agent/contracts.ts'
import {
  bounds, box, drill, measurePlate, normalProjections, transform, visit, volume, xyz,
} from '../../geometry-prototype/plate.mjs'

export const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0)
export const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance

export function placement(oc, frame) {
  const { xAxis, yAxis, zAxis, originQ } = frame
  const axes = [xAxis, yAxis, zAxis]
  const epsilon = 1e-9
  const cross = [xAxis[1] * yAxis[2] - xAxis[2] * yAxis[1],
    xAxis[2] * yAxis[0] - xAxis[0] * yAxis[2], xAxis[0] * yAxis[1] - xAxis[1] * yAxis[0]]
  if (!axes.every(axis => axis.length === 3 && near(dot(axis, axis), 1, epsilon)) ||
      !near(dot(xAxis, yAxis), 0, epsilon) || !near(dot(cross, zAxis), 1, epsilon) ||
      originQ.length !== 3) throw new Error('Invalid right-handed rigid frame')
  const origin = originQ.map(mm)
  const matrix = [0, 1, 2].map(i => [...axes.map(axis => axis[i]), origin[i]])
  const pose = new oc.gp_Trsf()
  try {
    pose.SetValues(...matrix.flat())
    return pose
  } catch (error) {
    pose.delete()
    throw error
  }
}

export function buildPlate(oc, model) {
  const { plate, holes } = model
  const thickness = mm(plate.thickness.nominalQ)
  let shape = box(oc, 0, thickness, mm(plate.lengthQ), mm(plate.widthQ))
  try {
    for (const hole of holes) {
      using previous = shape
      shape = undefined
      shape = drill(oc, previous, { xQ: hole.x.nominalQ, yQ: hole.y.nominalQ, diameterQ: hole.diameter.nominalQ }, thickness)
    }
    const result = shape
    shape = undefined
    return result
  } finally {
    shape?.delete()
  }
}

function faceIdentity(oc, solid, face, model, features, tolerance) {
  using surface = new oc.BRepAdaptor_Surface(face, true)
  if (solid === 'cover') {
    if (surface.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Plane) return { featureId: model.cover.id }
    const { min, max } = bounds(oc, face)
    const bottom = mm(model.cover.bottom.nominalQ)
    return near(min[2], bottom, tolerance) && near(max[2], bottom, tolerance)
      ? { featureId: model.cover.id, role: 'cover.bottomFace' } : { featureId: model.cover.id }
  }
  if (surface.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
    using cylinder = surface.Cylinder()
    using axis = cylinder.Axis()
    using origin = axis.Location()
    const matches = features.filter(({ geometry }) => near(origin.X(), geometry.origin[0], tolerance) &&
      near(origin.Y(), geometry.origin[1], tolerance) && near(cylinder.Radius(), geometry.radius, tolerance))
    if (matches.length !== 1) throw new Error('Cylinder face does not resolve uniquely to a feature')
    return { featureId: matches[0].featureId, role: matches[0].role }
  }
  const { min, max } = bounds(oc, face)
  const roles = [[0, mm(model.plate.lengthQ), 'plate.rightFace'], [2, mm(model.plate.thickness.nominalQ), 'plate.topFace']]
  const role = roles.find(([i, value]) => near(min[i], value, tolerance) && near(max[i], value, tolerance))?.[2]
  return role ? { featureId: model.plate.id, role } : { featureId: model.plate.id }
}

export function verifyPlate(oc, shape, model, tolerance) {
  const measured = measurePlate(oc, shape)
  if (!measured.valid || measured.solids !== 1 || measured.cylinders.length !== model.holes.length) {
    throw new Error('Replayed features do not form the expected plate solid and through holes')
  }
  const features = model.holes.map(hole => {
    const matches = measured.cylinders.filter(cylinder => (
      near(cylinder.origin[0], mm(hole.x.nominalQ), tolerance) &&
      near(cylinder.origin[1], mm(hole.y.nominalQ), tolerance) &&
      near(cylinder.radius * 2, mm(hole.diameter.nominalQ), tolerance) &&
      near(cylinder.direction[2], 1, tolerance) &&
      near(cylinder.bounds.min[2], measured.bounds.min[2], tolerance) &&
      near(cylinder.bounds.max[2], measured.bounds.max[2], tolerance)
    ))
    if (matches.length !== 1) throw new Error('Hole axis or through-cut extent could not be verified: ' + hole.id)
    return { featureId: hole.id, role: hole.role, geometry: matches[0] }
  })
  const faces = {}
  visit(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, child => {
    using face = oc.TopoDS.Face(child)
    const identity = faceIdentity(oc, 'plate', face, model, features, tolerance)
    if (identity.featureId !== model.plate.id || !identity.role) return
    const list = faces[identity.role] ??= []
    list.push({ ...identity, geometry: bounds(oc, face) })
  })
  for (const candidates of Object.values(faces)) {
    if (candidates.length === 1) features.push(candidates[0])
  }
  return { measured, features }
}

export function tessellate(oc, shape, solid, pose, model, features, tolerance, frameId) {
  using mesher = new oc.BRepMesh_IncrementalMesh(shape, 0.1, false, 0.3, false)
  if (!mesher.IsDone()) throw new Error('OCCT meshing failed')
  const positions = []
  const triangles = []
  const objects = []
  visit(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, child => {
    using face = oc.TopoDS.Face(child)
    using location = new oc.TopLoc_Location()
    // Dispose the returned handle. The face retains its own reference to the triangulation.
    using triangulation = oc.BRep_Tool.Triangulation(face, location, 0)
    if (!triangulation || !triangulation.NbTriangles()) throw new Error('Missing face triangulation')
    using localPose = location.Transformation()
    const offset = positions.length
    for (let i = 1; i <= triangulation.NbNodes(); i++) {
      using node = triangulation.Node(i)
      node.Transform(localPose)
      node.Transform(pose)
      positions.push(xyz(node))
    }
    const firstTriangle = triangles.length
    const order = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? [1, 3, 2] : [1, 2, 3]
    for (let i = 1; i <= triangulation.NbTriangles(); i++) {
      using triangle = triangulation.Triangle(i)
      triangles.push(order.map(index => triangle.Value(index) - 1 + offset))
    }
    // Only cylindrical feature records are candidates for matching a cylindrical face.
    const holes = features.filter(feature => feature.geometry.radius !== undefined)
    objects.push({ ...faceIdentity(oc, solid, face, model, holes, tolerance),
      firstTriangle, triangleCount: triangles.length - firstTriangle })
  })
  return { frameId, positions, triangles, objects }
}

export function measureAssembly(oc, plate, cover, pose, worldNormal) {
  using worldPlate = transform(oc, plate, pose)
  using worldCover = transform(oc, cover, pose)
  const plateFaces = normalProjections(oc, worldPlate, worldNormal)
  const coverFaces = normalProjections(oc, worldCover, worldNormal)
  const plateTopMm = Math.max(...plateFaces)
  const coverBottomMm = Math.min(...coverFaces)
  using progress = new oc.Message_ProgressRange()
  using common = new oc.BRepAlgoAPI_Common(worldPlate, worldCover, progress)
  if (!common.IsDone() || common.HasErrors()) throw new Error('OCCT intersection failed')
  using intersection = common.Shape()
  return { plateTopMm, coverBottomMm, plateBottomMm: Math.min(...plateFaces), coverTopMm: Math.max(...coverFaces),
    signedGapMm: coverBottomMm - plateTopMm,
    commonVolumeMm3: volume(oc, intersection), worldPlateBounds: bounds(oc, worldPlate) }
}
