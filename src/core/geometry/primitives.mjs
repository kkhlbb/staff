import { bounds, visit, volume } from '../../../desktop/main/geometry-prototype/plate.mjs'
import { qToGeometryMm as mm } from '../../../desktop/shared/project-agent/contracts.ts'
import { add, cross, direction, dot, inspectTopology, scale, subtract } from './topology.mjs'

const zAxis = [0, 0, 1]
function positiveMm(value) {
  const result = mm(value)
  if (result <= 0) throw new Error('Expected a positive geometry dimension')
  return result
}

function pointMm(values) {
  if (!Array.isArray(values) || values.length !== 3) throw new Error('Expected a three-dimensional q point')
  return values.map(mm)
}

function box(oc, size, origin = [0, 0, 0]) {
  using point = new oc.gp_Pnt(...origin)
  using maker = new oc.BRepPrimAPI_MakeBox(point, ...size)
  return maker.Solid()
}

function cylinder(oc, origin, axis, radius, height) {
  using point = new oc.gp_Pnt(...origin)
  using normal = new oc.gp_Dir(...axis)
  using frame = new oc.gp_Ax2(point, normal)
  using maker = new oc.BRepPrimAPI_MakeCylinder(frame, radius, height)
  return maker.Shape()
}

function combine(oc, operation, shape, tool) {
  using progress = new oc.Message_ProgressRange()
  const Builder = operation === 'cut' ? oc.BRepAlgoAPI_Cut : oc.BRepAlgoAPI_Fuse
  using builder = new Builder(shape, tool, progress)
  if (!builder.IsDone() || builder.HasErrors()) throw new Error('OCCT boolean failed: ' + operation)
  // Merge split coplanar and tangent domains where the operation permits it.
  builder.SimplifyResult(true, true, 1e-9)
  return builder.Shape()
}

function baseShape(oc, { baseKind, sizeQ }) {
  const size = name => positiveMm(sizeQ[name + 'Q'])
  switch (baseKind) {
    case 'plate':
      return box(oc, [size('length'), size('width'), size('thickness')])
    case 'cylinder-spacer': {
      const height = size('length')
      const inner = size('innerDiameter') / 2
      const outer = size('outerDiameter') / 2
      if (inner >= outer) throw new Error('Spacer inner diameter must be smaller than outer diameter')
      using blank = cylinder(oc, [0, 0, 0], zAxis, outer, height)
      using bore = cylinder(oc, [0, 0, -1], zAxis, inner, height + 2)
      return combine(oc, 'cut', blank, bore)
    }
    case 'l-bracket': {
      const [length, width, height, thickness] = ['length', 'width', 'height', 'thickness'].map(size)
      if (thickness >= Math.min(length, height)) throw new Error('Bracket thickness exceeds leg dimensions')
      using blank = box(oc, [length, width, height])
      using opening = box(oc, [length - thickness + 1, width + 2, height - thickness + 1], [thickness, -1, thickness])
      return combine(oc, 'cut', blank, opening)
    }
    case 'thin-shell': {
      const [length, width, height, wall] = ['length', 'width', 'height', 'wall'].map(size)
      if (2 * wall >= Math.min(length, width) || wall >= height) throw new Error('Shell wall leaves no cavity')
      using outside = box(oc, [length, width, height])
      using cavity = box(oc, [length - 2 * wall, width - 2 * wall, height - wall + 1], [wall, wall, wall])
      return combine(oc, 'cut', outside, cavity)
    }
    default:
      throw new Error('Unsupported primitive: ' + baseKind)
  }
}

// Project all box corners onto the tool axis so oblique tools span the full part.
function throughRange(oc, shape, origin, axis) {
  const { min, max } = bounds(oc, shape)
  const projected = [min[0], max[0]].flatMap(x => [min[1], max[1]].flatMap(y =>
    [min[2], max[2]].map(z => dot(subtract([x, y, z], origin), axis))))
  return [Math.min(...projected) - 1, Math.max(...projected) + 1]
}

function cutHole(oc, shape, modifier) {
  const axis = direction(modifier.axis)
  const origin = pointMm(modifier.originQ)
  const [start, end] = modifier.kind === 'blind-hole' ? [0, positiveMm(modifier.depthQ)] : throughRange(oc, shape, origin, axis)
  using tool = cylinder(oc, add(origin, scale(axis, start)), axis, positiveMm(modifier.diameterQ) / 2, end - start)
  return combine(oc, 'cut', shape, tool)
}

function cutSlot(oc, shape, modifier) {
  const axis = direction(modifier.axis)
  const first = pointMm(modifier.startQ)
  const second = pointMm(modifier.endQ)
  const delta = subtract(second, first)
  const heightOffset = dot(delta, axis)
  if (Math.abs(heightOffset) > 1e-7) throw new Error('Slot endpoints must share a plane perpendicular to its axis')
  const forward = direction(delta)
  const radius = positiveMm(modifier.widthQ) / 2
  const [start, end] = throughRange(oc, shape, first, axis)
  const bottom = add(first, scale(axis, start))
  const length = end - start
  using p = new oc.gp_Pnt(...subtract(bottom, scale(cross(axis, forward), radius)))
  using n = new oc.gp_Dir(...axis)
  using x = new oc.gp_Dir(...forward)
  using frame = new oc.gp_Ax2(p, n, x)
  using maker = new oc.BRepPrimAPI_MakeBox(frame, Math.hypot(...delta), 2 * radius, length)
  using bridge = maker.Solid()
  using left = cylinder(oc, bottom, axis, radius, length)
  using right = cylinder(oc, add(bottom, delta), axis, radius, length)
  using firstHalf = combine(oc, 'fuse', bridge, left)
  using tool = combine(oc, 'fuse', firstHalf, right)
  return combine(oc, 'cut', shape, tool)
}

function finishEdge(oc, shape, child, modifier) {
  using edge = oc.TopoDS.Edge(child)
  using builder = modifier.profile === 'fillet'
    ? new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational)
    : new oc.BRepFilletAPI_MakeChamfer(shape)
  using progress = new oc.Message_ProgressRange()
  builder.Add(positiveMm(modifier.sizeQ), edge)
  builder.Build(progress)
  if (!builder.IsDone()) throw new Error('OCCT ' + modifier.profile + ' failed')
  return builder.Shape()
}

function extrude(oc, shape, face, info, modifier) {
  if (info.surface !== 'plane') throw new Error('Extrusion requires a planar face')
  const offset = mm(modifier.offsetQ)
  if (offset === 0) return shape.clone()
  using vector = new oc.gp_Vec(...scale(info.normal, offset))
  using sweep = new oc.BRepPrimAPI_MakePrism(face, vector, true, true)
  using tool = sweep.Shape()
  return combine(oc, offset < 0 ? 'cut' : 'fuse', shape, tool)
}

function modify(oc, shape, part, modifier, features) {
  if (modifier.kind === 'through-hole' || modifier.kind === 'blind-hole') return cutHole(oc, shape, modifier)
  if (modifier.kind === 'slot') return cutSlot(oc, shape, modifier)
  const isEdge = modifier.kind === 'chamfer-fillet'
  if (isEdge && modifier.profile !== 'chamfer' && modifier.profile !== 'fillet') throw new Error('Invalid edge finish profile')
  if (!isEdge && modifier.kind !== 'extrude-offset') throw new Error('Unsupported modifier: ' + modifier.kind)
  const id = isEdge ? modifier.edgeFeatureId : modifier.faceFeatureId
  const reference = features.find(feature => feature.id === id && feature.partId === part.id)
  if (!reference || reference.kind !== (isEdge ? 'edge' : 'face')) throw new Error('Invalid modifier feature reference: ' + id)
  using scope = new DisposableStack()
  let exact
  let fallback
  let matches = 0
  const match = (native, feature, info) => {
    if (feature.id === id) {
      exact = { shape: scope.use(native.clone()), info }
    } else if (feature.signature === reference.signature) {
      if (matches++ === 0) fallback = { shape: scope.use(native.clone()), info }
    }
  }
  inspectTopology(oc, shape, part.id, isEdge ? { onEdge: match } : { onFace: match })
  if (!exact && matches > 1) throw new Error('Ambiguous modifier feature: ' + id)
  const selected = exact ?? fallback
  if (!selected) throw new Error('Modifier feature unavailable: ' + id)
  return isEdge ? finishEdge(oc, shape, selected.shape, modifier) : extrude(oc, shape, selected.shape, selected.info, modifier)
}

function validateSolid(oc, shape) {
  if (shape.IsNull()) throw new Error('Primitive produced a null shape')
  using analyzer = new oc.BRepCheck_Analyzer(shape, true, false, true)
  let solidCount = 0
  visit(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, () => solidCount++)
  if (solidCount !== 1 || !analyzer.IsValid() || !(volume(oc, shape) > 0)) {
    throw new Error('Primitive must produce one valid solid')
  }
}

export function buildPrimitive(oc, part, features) {
  let shape = baseShape(oc, part)
  try {
    validateSolid(oc, shape)
    for (const modifier of part.modifiers) {
      using previous = shape
      shape = undefined
      shape = modify(oc, previous, part, modifier, features)
      validateSolid(oc, shape)
    }
    const result = shape
    shape = undefined
    return result
  } finally {
    shape?.delete()
  }
}
