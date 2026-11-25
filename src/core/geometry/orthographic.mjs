import { createHash } from 'node:crypto'
import { transform } from '../../../desktop/main/geometry-prototype/plate.mjs'
import { exportHeadlessDrawing } from '../../drawing/headless.ts'
import { A4_LANDSCAPE, DRAWING_DATA_VERSION, DRAWING_STYLES } from '../../drawing/types.ts'
import { cross, dot, sampleEdge, uniqueSubshapes } from './topology.mjs'

const views = [
  { id: 'front', towardViewer: [0, -1, 0], horizontal: [1, 0, 0], u: '+X', v: '+Z' },
  { id: 'top', towardViewer: [0, 0, 1], horizontal: [1, 0, 0], u: '+X', v: '+Y' },
  { id: 'left', towardViewer: [-1, 0, 0], horizontal: [0, -1, 0], u: '-Y', v: '+Z' },
]

export function assertRigidPose(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 4 ||
      !matrix.every(row => Array.isArray(row) && row.length === 4 && row.every(Number.isFinite)) ||
      !matrix[3].every((value, i) => value === Number(i === 3))) {
    throw new Error('Nominal transform must be a homogeneous 4 x 4 matrix')
  }
  const rotation = matrix.slice(0, 3).map(row => row.slice(0, 3))
  const [x, y, z] = rotation
  const near = (value, expected) => Math.abs(value - expected) <= 1e-8
  if (!rotation.every(row => near(dot(row, row), 1)) ||
      !near(dot(x, y), 0) || !near(dot(y, z), 0) || !near(dot(z, x), 0) ||
      !near(dot(cross(x, y), z), 1)) throw new Error('Nominal transform must be a proper rigid pose')
}

function projectView(oc, shapes, { id, towardViewer, horizontal, u, v }) {
  using origin = new oc.gp_Pnt(0, 0, 0)
  using normal = new oc.gp_Dir(...towardViewer)
  using right = new oc.gp_Dir(...horizontal)
  using axes = new oc.gp_Ax2(origin, normal, right)
  using projector = new oc.HLRAlgo_Projector(axes)
  using hlr = new oc.HLRBRep_Algo()
  hlr.Projector(projector)
  for (const shape of shapes) hlr.Add(shape, 0)
  hlr.Update()
  hlr.Hide()
  using result = new oc.HLRBRep_HLRToShape(hlr)
  const seen = new Set()
  const geometry = []
  for (const [style, methods] of [
    ['visible', ['VCompound', 'OutLineVCompound', 'Rg1LineVCompound']],
    ['hidden', ['HCompound', 'OutLineHCompound', 'Rg1LineHCompound']],
  ]) {
    for (const method of methods) {
      using compound = result[method]()
      if (compound.IsNull()) continue
      if (!oc.BRepLib.BuildCurves3d(compound)) throw new Error('OCCT could not build HLR edge curves')
      uniqueSubshapes(oc, compound, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edge => {
        const sampled = sampleEdge(oc, edge)
        if (!sampled) return
        const points = sampled.points.map(([x, y]) => [x, y])
        const quantized = points.map(point => point.map(coordinate => Math.round(coordinate * 1e7)).join(','))
        if (quantized.every(point => point === quantized[0])) return
        const key = [quantized.join('/'), quantized.reverse().join('/')].sort()[0]
        if (seen.has(key)) return
        seen.add(key)
        geometry.push({ kind: points.length === 2 ? 'line' : 'polyline', style, points })
      })
    }
  }
  return { id, u, v, geometry }
}

// All inputs are added before Hide so foreground parts also occlude other parts.
export function projectAssembly(oc, entries) {
  using scope = new DisposableStack()
  const shapes = entries.map(({ shape, part }) => {
    using placement = new oc.gp_Trsf()
    placement.SetValues(...part.nominalTransform.slice(0, 3).flat())
    return scope.use(transform(oc, shape, placement))
  })
  if (!shapes.length) throw new Error('Cannot project an empty assembly')
  return { algorithm: 'OCCT HLRBRep_Algo', views: views.map(view => projectView(oc, shapes, view)) }
}

function extents({ geometry }) {
  const min = [Infinity, Infinity]
  const max = [-Infinity, -Infinity]
  for (const { points } of geometry) {
    for (const [x, y] of points) {
      min[0] = Math.min(min[0], x)
      min[1] = Math.min(min[1], y)
      max[0] = Math.max(max[0], x)
      max[1] = Math.max(max[1], y)
    }
  }
  if (!Number.isFinite(min[0])) throw new Error('HLR view contains no drawing edges')
  return { min, max, width: max[0] - min[0], height: max[1] - min[1] }
}

export function exportOrthographic(projection, dxfVersion) {
  const [front, top, left] = projection.views.map(extents)
  const gap = 14
  const width = Math.max(front.width, top.width) + left.width
  const height = top.height + Math.max(front.height, left.height)
  // DXF 2000 centers its 360 x 208 viewport on the required axial outline.
  // Keep the drawing within half the viewport even if that stroke sits at an extreme.
  const [availableWidth, availableHeight] = dxfVersion === '2000' ? [179, 103] : [257, 155]
  const denominator = Math.max(1, Math.ceil(width / (availableWidth - gap)), Math.ceil(height / (availableHeight - gap)))
  const outlineIndex = projection.views[0].geometry.findIndex(edge => edge.style === 'visible')
  const origins = [
    [20 + left.width / denominator + gap, 20 + top.height / denominator + gap],
    [20 + left.width / denominator + gap, 20],
    [20, 20 + top.height / denominator + gap],
  ]
  const placements = [front, top, left]
  const primitives = projection.views.flatMap(({ id, geometry }, viewIndex) => geometry.map((edge, index) => {
    const { min, max } = placements[viewIndex]
    const anchor = origins[viewIndex]
    const points = edge.points.map(([x, y]) => ({ x: anchor[0] + (x - min[0]) / denominator,
      y: anchor[1] + (max[1] - y) / denominator }))
    // The shared DXF writer anchors on this ID. Use an actual projected stroke.
    const axialOutline = viewIndex === 0 && index === outlineIndex
    const kind = axialOutline ? 'polyline' : edge.kind
    const geometryMm = kind === 'line'
      ? { x1: points[0].x, y1: points[0].y, x2: points[1].x, y2: points[1].y }
      : { points }
    return { primitiveId: axialOutline ? 'axial.outline' : id + '-' + index, viewId: id, kind,
      styleId: edge.style === 'hidden' ? 'hidden' : 'outline', area: 'drawing', geometryMm }
  }))
  const fingerprint = createHash('sha256').update(JSON.stringify(primitives)).digest('hex')
  // The shared exporters consume sheet primitives, paper, styles and optional annotations.
  return exportHeadlessDrawing({ drawingDataVersion: DRAWING_DATA_VERSION, drawingId: 'orthographic-' + fingerprint,
    templateId: 'assembly-orthographic', templateVersion: 1, fingerprint, parameterSnapshot: [],
    paper: A4_LANDSCAPE, styles: DRAWING_STYLES, scale: { numerator: 1, denominator },
    primitives, annotations: [], frame: { fields: {} } }, dxfVersion)
}
