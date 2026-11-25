import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { qToGeometryMm as mm } from '../../shared/project-agent/index.ts'

const require = createRequire(import.meta.url)
const fixture = JSON.parse(readFileSync(new URL('fixture.json', import.meta.url)))
const { plate, holes, cover } = fixture
const length = mm(plate.lengthQ)
const width = mm(plate.widthQ)

export function loadKernel(options = {}, bundled = false) {
  const modulePath = bundled ? './m2-replicad.cjs' : 'replicad-opencascadejs'
  return require(modulePath)({
    ...options,
    wasmBinary: readFileSync(require.resolve(bundled ? './replicad_single.wasm' : 'replicad-opencascadejs/wasm')),
  })
}

export const xyz = (p) => [p.X(), p.Y(), p.Z()]
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0)

// Native inputs are borrowed. Shape-producing functions transfer the returned wrapper to the caller.
// Embind implements Symbol.dispose with delete(), so using scopes release temporaries on exit.
export function box(oc, z, thickness, xLength = length, yWidth = width) {
  using origin = new oc.gp_Pnt(0, 0, z)
  using maker = new oc.BRepPrimAPI_MakeBox(origin, xLength, yWidth, thickness)
  return maker.Solid()
}

function drilledPlate(oc, blank, thickness) {
  using first = drill(oc, blank, holes[0], thickness)
  return drill(oc, first, holes[1], thickness)
}

export function drill(oc, shape, hole, thickness) {
  using point = new oc.gp_Pnt(mm(hole.xQ), mm(hole.yQ), -1)
  using direction = new oc.gp_Dir(0, 0, 1)
  using axis = new oc.gp_Ax2(point, direction)
  using maker = new oc.BRepPrimAPI_MakeCylinder(axis, mm(hole.diameterQ) / 2, thickness + 2)
  using tool = maker.Shape()
  using progress = new oc.Message_ProgressRange()
  using cut = new oc.BRepAlgoAPI_Cut(shape, tool, progress)
  if (!cut.IsDone() || cut.HasErrors()) throw new Error('OCCT cut failed')
  return cut.Shape()
}

export function bounds(oc, shape) {
  using bbox = new oc.Bnd_Box()
  oc.BRepBndLib.AddOptimal(shape, bbox, false, false)
  using min = bbox.CornerMin()
  using max = bbox.CornerMax()
  return { min: xyz(min), max: xyz(max) }
}

export function volume(oc, shape) {
  using props = new oc.GProp_GProps()
  oc.BRepGProp.VolumeProperties(shape, props, true, false, false)
  return props.Mass()
}

// The explorer returns an owned Embind wrapper. The synchronous callback borrows it.
export function visit(oc, shape, kind, inspect) {
  using explorer = new oc.TopExp_Explorer(shape, kind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE)
  while (explorer.More()) {
    using child = explorer.Current()
    inspect(child)
    explorer.Next()
  }
}

export function measurePlate(oc, shape) {
  using analyzer = new oc.BRepCheck_Analyzer(shape, true, false, true)
  let solids = 0
  const cylinders = []
  visit(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, () => { solids += 1 })
  visit(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, (child) => {
    using face = oc.TopoDS.Face(child)
    using surface = new oc.BRepAdaptor_Surface(face, true)
    if (surface.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) return
    using cylinder = surface.Cylinder()
    using axis = cylinder.Axis()
    using origin = axis.Location()
    using direction = axis.Direction()
    cylinders.push({ origin: xyz(origin), direction: xyz(direction), radius: cylinder.Radius(), bounds: bounds(oc, face) })
  })
  return { valid: analyzer.IsValid(), solids, bounds: bounds(oc, shape), volumeMm3: volume(oc, shape),
    cylinders: cylinders.sort((a, b) => a.origin[0] - b.origin[0]) }
}

export function buildA01(oc) {
  const thickness = mm(plate.thicknessQ)
  using blank = box(oc, 0, thickness)
  using shape = drilledPlate(oc, blank, thickness)
  return { step: exportPlateStep(oc, shape), blank: { bounds: bounds(oc, blank), volumeMm3: volume(oc, blank) }, measured: measurePlate(oc, shape) }
}

export function exportPlateStep(oc, shape) {
  using writer = new oc.STEPControl_Writer()
  using progress = new oc.Message_ProgressRange()
  const done = oc.IFSelect_ReturnStatus.IFSelect_RetDone
  const filename = '/plate.step'
  try {
    if (writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progress) !== done ||
        writer.Write(filename) !== done) throw new Error('STEP export failed')
    return Buffer.from(oc.FS.readFile(filename))
  } finally {
    if (oc.FS.readdir('/').includes(filename.slice(1))) oc.FS.unlink(filename)
  }
}

export function readA01(oc, step) {
  const filename = '/readback.step'
  oc.FS.writeFile(filename, step)
  try {
    using reader = new oc.STEPControl_Reader()
    using progress = new oc.Message_ProgressRange()
    if (reader.ReadFile(filename) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone ||
        reader.TransferRoots(progress) !== 1) throw new Error('STEP readback failed')
    using shape = reader.OneShape()
    return measurePlate(oc, shape)
  } finally {
    oc.FS.unlink(filename)
  }
}

export function transform(oc, shape, pose) {
  using operation = new oc.BRepBuilderAPI_Transform(shape, pose, false, false)
  if (!operation.IsDone()) throw new Error('OCCT transform failed')
  return operation.Shape()
}

export function normalProjections(oc, shape, normal) {
  const projections = []
  visit(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, (child) => {
    using face = oc.TopoDS.Face(child)
    using surface = new oc.BRepAdaptor_Surface(face, true)
    if (surface.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Plane) return
    using plane = surface.Plane()
    using axis = plane.Axis()
    using direction = axis.Direction()
    if (Math.abs(Math.abs(dot(xyz(direction), normal)) - 1) > 1e-9) return
    using point = plane.Location()
    projections.push(dot(xyz(point), normal))
  })
  if (projections.length !== 2) throw new Error('Expected two faces parallel to the fixture datum')
  return projections
}

function measureGap(oc, thicknessQ, bottomQ, pose, normal) {
  const thickness = mm(thicknessQ)
  using blank = box(oc, 0, thickness)
  using localPlate = drilledPlate(oc, blank, thickness)
  using localCover = box(oc, mm(bottomQ), mm(cover.thicknessQ))
  using worldPlate = transform(oc, localPlate, pose)
  using worldCover = transform(oc, localCover, pose)
  const plateTopMm = Math.max(...normalProjections(oc, worldPlate, normal))
  const coverBottomMm = Math.min(...normalProjections(oc, worldCover, normal))
  const signedGapMm = coverBottomMm - plateTopMm
  using progress = new oc.Message_ProgressRange()
  using common = new oc.BRepAlgoAPI_Common(worldPlate, worldCover, progress)
  if (!common.IsDone() || common.HasErrors()) throw new Error('OCCT intersection failed')
  using intersection = common.Shape()
  const toleranceMm = oc.Precision.Confusion()
  const relation = signedGapMm < -toleranceMm ? 'overlap' : signedGapMm > toleranceMm ? 'gap' : 'contact'
  return { plateTopMm, coverBottomMm, signedGapMm, commonVolumeMm3: volume(oc, intersection),
    relation, overlapDepthMm: relation === 'overlap' ? -signedGapMm : 0 }
}

export function measureA05(oc, degrees) {
  using origin = new oc.gp_Pnt(0, 0, 0)
  using x = new oc.gp_Dir(1, 0, 0)
  using z = new oc.gp_Dir(0, 0, 1)
  using axis = new oc.gp_Ax1(origin, x)
  using pose = new oc.gp_Trsf()
  pose.SetRotation(axis, degrees * Math.PI / 180)
  using worldNormal = z.Transformed(pose)
  const normal = xyz(worldNormal)
  const measure = (thickness, bottom) => measureGap(oc, thickness, bottom, pose, normal)
  return {
    normal, matrix: [1, 2, 3].map((row) => [1, 2, 3, 4].map((column) => pose.Value(row, column))),
    nominal: measure(plate.thicknessQ, cover.bottomQ),
    min: measure(plate.thicknessQ + plate.toleranceQ, cover.bottomQ - cover.toleranceQ),
    max: measure(plate.thicknessQ - plate.toleranceQ, cover.bottomQ + cover.toleranceQ),
    contact: measure(plate.thicknessQ, fixture.contactBottomQ),
    overlap: measure(plate.thicknessQ, fixture.overlapBottomQ),
  }
}
