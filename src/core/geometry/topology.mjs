import { createHash } from 'node:crypto'
import { bounds, visit, xyz } from '../../../desktop/main/geometry-prototype/plate.mjs'
import { Q_PER_MM } from '../../domain/types.ts'

export const add = (a, b) => a.map((v, i) => v + b[i])
export const subtract = (a, b) => a.map((v, i) => v - b[i])
export const scale = (a, s) => a.map(v => v * s)
export const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0)
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export function direction(vector) {
  if (!Array.isArray(vector) || vector.length !== 3 || !vector.every(Number.isFinite)) throw new Error('Invalid direction')
  const length = Math.hypot(...vector)
  if (!Number.isFinite(length) || length < 1e-12) throw new Error('Invalid direction')
  return scale(vector, 1 / length)
}
const q = mm => {
  const result = Math.round(mm * Q_PER_MM) || 0
  if (!Number.isSafeInteger(result)) throw new Error('Geometry outside integer q range')
  return result
}
const toQ = point => point.map(q)
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const quantize = value => Math.round(value * 1e7) || 0
const reversed = (oc, shape) => shape.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED

export function uniqueSubshapes(oc, shape, kind, inspect) {
  using scope = new DisposableStack()
  const seen = []
  visit(oc, shape, kind, child => {
    if (seen.some(previous => previous.IsSame(child))) return
    seen.push(scope.use(child.clone()))
    inspect(child)
  })
}

function axisInfo(axis) {
  using origin = axis.Location()
  using vector = axis.Direction()
  return { origin: xyz(origin), axis: xyz(vector) }
}

function surfaceDerivatives(adaptor, u, v) {
  const evaluated = adaptor.EvalD1(u, v)
  using point = evaluated.Point
  using du = evaluated.D1U
  using dv = evaluated.D1V
  return { point: xyz(point), du: xyz(du), dv: xyz(dv) }
}

function orientedNormal(oc, face, { du, dv }) {
  const normal = cross(du, dv)
  const length = Math.hypot(...normal)
  if (length > 1e-12) return scale(normal, (reversed(oc, face) ? -1 : 1) / length)
}

function surfaceMidpoint(adaptor) {
  return [(adaptor.FirstUParameter() + adaptor.LastUParameter()) / 2,
    (adaptor.FirstVParameter() + adaptor.LastVParameter()) / 2]
}

// The WASM classifies a cone but cannot marshal gp_Cone. Diametrically
// opposed samples of the same analytic surface isolate its axial derivative.
function coneInfo(oc, face, adaptor) {
  const [u, v] = surfaceMidpoint(adaptor)
  const a = surfaceDerivatives(adaptor, u, v)
  const b = surfaceDerivatives(adaptor, u + Math.PI, v)
  const center = scale(add(a.point, b.point), 0.5)
  const axialDerivative = scale(add(a.dv, b.dv), 0.5)
  const axis = direction(axialDerivative)
  const axialSpeed = Math.hypot(...axialDerivative)
  const radial = subtract(a.point, center)
  const radius = Math.hypot(...radial)
  const radialSpeed = dot(direction(radial), a.dv)
  const apex = subtract(center, scale(axis, radius * axialSpeed / radialSpeed))
  return { origin: center, axis, radius, apex, semiAngleRad: Math.atan2(radialSpeed, axialSpeed),
    normal: orientedNormal(oc, face, a) }
}

function faceInfo(oc, face) {
  using adaptor = new oc.BRepAdaptor_Surface(face, true)
  using props = new oc.GProp_GProps()
  oc.BRepGProp.SurfaceProperties(face, props, false, false)
  using center = props.CentreOfMass()
  const info = { bounds: bounds(oc, face), areaMm2: props.Mass(), centroid: xyz(center) }
  const type = adaptor.GetType()
  const surface = oc.GeomAbs_SurfaceType
  if (type === surface.GeomAbs_Plane) {
    using plane = adaptor.Plane()
    using axis = plane.Axis()
    const data = axisInfo(axis)
    return { ...info, surface: 'plane', normal: scale(data.axis, reversed(oc, face) ? -1 : 1) }
  }
  if (type === surface.GeomAbs_Cylinder) {
    using cylinder = adaptor.Cylinder()
    using axis = cylinder.Axis()
    return { ...info, ...axisInfo(axis), surface: 'cylinder', radius: cylinder.Radius(), normal: orientedNormal(oc, face, surfaceDerivatives(adaptor, ...surfaceMidpoint(adaptor))) }
  }
  if (type === surface.GeomAbs_Cone) {
    return { ...info, surface: 'cone', ...coneInfo(oc, face, adaptor) }
  }
  return { ...info, surface: 'other' }
}

export function sampleEdge(oc, child) {
  using edge = oc.TopoDS.Edge(child)
  if (oc.BRep_Tool.Degenerated(edge)) return
  using adaptor = new oc.BRepAdaptor_Curve(edge)
  const type = adaptor.GetType()
  const kinds = oc.GeomAbs_CurveType
  const curve = type === kinds.GeomAbs_Line ? 'line' : type === kinds.GeomAbs_Circle ? 'circle' : 'other'
  const first = adaptor.FirstParameter()
  const last = adaptor.LastParameter()
  let count = curve === 'line' ? 1 : 64
  let circle
  if (curve === 'circle') {
    using primitive = adaptor.Circle()
    using axis = primitive.Axis()
    circle = { ...axisInfo(axis), radius: primitive.Radius() }
    count = Math.max(4, 2 * Math.ceil(Math.abs(last - first) * 8))
  }
  const points = Array.from({ length: count + 1 }, (_, i) => {
    using point = adaptor.EvalD0(first + (last - first) * i / count)
    return xyz(point)
  })
  return { curve, points, ...(circle && { circle }) }
}

function identityFactory(partId) {
  const counts = new Map()
  return (kind, data) => {
    const signature = hash([kind, data])
    const ordinal = counts.get(signature) ?? 0
    counts.set(signature, ordinal + 1)
    return { partId, signature, id: 'feature:' + hash([partId, signature, ordinal]) }
  }
}

// Native references are borrowed by the callbacks only.
export function inspectTopology(oc, shape, partId, { onFace, onEdge } = {}) {
  const identity = identityFactory(partId)
  const features = []
  const faces = []
  const edgeSegments = []
  uniqueSubshapes(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, child => {
    using face = oc.TopoDS.Face(child)
    const info = faceInfo(oc, face)
    const key = identity('face', [info.surface, toQ(info.centroid), toQ(info.bounds.min), toQ(info.bounds.max),
      quantize(info.areaMm2), (info.axis ?? info.normal)?.map(quantize), info.radius && q(info.radius),
      info.apex && toQ(info.apex), info.semiAngleRad && quantize(info.semiAngleRad)])
    const feature = info.surface === 'cylinder'
      ? { ...key, kind: 'cylindrical-hole-axis', originQ: toQ(info.origin), axis: info.axis, radiusQ: Math.max(1, q(info.radius)) }
      : info.surface === 'cone'
        ? { ...key, kind: 'cone', apexQ: toQ(info.apex), axis: info.axis, semiAngleRad: info.semiAngleRad }
        : { ...key, kind: 'face', surface: info.surface, originQ: toQ(info.centroid), normal: info.normal ?? [0, 0, 0] }
    features.push(feature)
    faces.push({ featureId: key.id, ...info })
    onFace?.(face, feature, info)
  })
  uniqueSubshapes(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, child => {
    const info = sampleEdge(oc, child)
    if (!info) return
    const { curve, points, circle } = info
    const startQ = toQ(points[0])
    const endQ = toQ(points.at(-1))
    const ends = startQ.join(',') <= endQ.join(',') ? [startQ, endQ] : [endQ, startQ]
    const key = identity('edge', [curve, ends, toQ(points[(points.length - 1) >> 1]),
      circle && [toQ(circle.origin), q(circle.radius)]])
    const feature = { ...key, kind: 'edge', curve, startQ, endQ }
    features.push(feature)
    edgeSegments.push({ featureId: key.id, ...info })
    onEdge?.(child, feature)
  })
  return { features, faces, edgeSegments }
}

export function extractPart(oc, shape, part) {
  using mesher = new oc.BRepMesh_IncrementalMesh(shape, 0.05, false, 0.3, false)
  if (!mesher.IsDone()) throw new Error('OCCT meshing failed')
  const positions = []
  const normals = []
  const indices = []
  const faceTriangleRanges = []
  const topology = inspectTopology(oc, shape, part.id, {
    onFace(face, feature, info) {
      using loc = new oc.TopLoc_Location()
      using mesh = oc.BRep_Tool.Triangulation(face, loc, 0)
      if (!mesh?.NbTriangles()) throw new Error('Missing face triangulation')
      using pose = loc.Transformation()
      const offset = positions.length / 3
      const firstTriangle = indices.length / 3
      const reverse = reversed(oc, face)
      if (!mesh.HasNormals()) mesh.ComputeNormals()
      for (let i = 1; i <= mesh.NbNodes(); i++) {
        using point = mesh.Node(i)
        using normal = mesh.Normal(i)
        point.Transform(pose)
        normal.Transform(pose)
        positions.push(...xyz(point))
        normals.push(...(info.surface === 'plane' ? info.normal : scale(xyz(normal), reverse ? -1 : 1)))
      }
      const order = reverse ? [1, 3, 2] : [1, 2, 3]
      for (let i = 1; i <= mesh.NbTriangles(); i++) {
        using triangle = mesh.Triangle(i)
        indices.push(...order.map(n => triangle.Value(n) - 1 + offset))
      }
      faceTriangleRanges.push({ featureId: feature.id, firstTriangle, triangleCount: mesh.NbTriangles() })
    },
  })
  const { edgeSegments, ...rest } = topology
  return { ...rest, mesh: { partId: part.id, nominalTransform: part.nominalTransform, positions: new Float64Array(positions),
    normals: new Float64Array(normals), indices: new Uint32Array(indices), faceTriangleRanges, edgeSegments } }
}

export function candidateSummary(parts, toleranceMm) {
  const facesByPart = parts.map(({ mesh, faces }) => {
    const matrix = mesh.nominalTransform.slice(0, 3)
    const world = vector => matrix.map(row => dot(vector, row))
    const translation = matrix.map(row => row[3])
    return faces.filter(face => face.normal || face.axis).map(face => ({
      featureId: face.featureId, plane: face.surface === 'plane',
      axis: world(face.axis ?? face.normal), origin: add(world(face.origin ?? face.centroid), translation),
    }))
  })
  const coplanar = []
  const coaxial = []
  facesByPart.forEach((left, index) => {
    for (let i = index + 1; i < facesByPart.length; i++) {
      for (const a of left) {
        for (const b of facesByPart[i]) {
          if (a.plane !== b.plane || Math.hypot(...cross(a.axis, b.axis)) > 1e-7) continue
          const separation = subtract(a.origin, b.origin)
          const pair = [a.featureId, b.featureId]
          if (a.plane && Math.abs(dot(a.axis, separation)) <= toleranceMm) coplanar.push(pair)
          if (!a.plane && Math.hypot(...cross(a.axis, separation)) <= toleranceMm) coaxial.push(pair)
        }
      }
    }
  })
  return { coplanar, coaxial }
}
