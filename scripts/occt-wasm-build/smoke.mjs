import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { box, drill, exportPlateStep, measureA05, readA01, visit, volume } from '../../desktop/main/geometry-prototype/plate.mjs'
import { projectAssembly } from '../../src/core/geometry/orthographic.mjs'
import { readStepSolids } from '../../src/core/geometry/stepImport.mjs'
import { extractPart } from '../../src/core/geometry/topology.mjs'

const dir = process.env.OCCT_OUTPUT_DIR
  ? pathToFileURL(resolve(process.env.OCCT_OUTPUT_DIR) + '/')
  : new URL('../../vendor/occt-unified/', import.meta.url)
const wasmBinary = readFileSync(new URL('cunlian_occt.wasm', dir))
const { default: loadKernel } = await import(new URL('cunlian_occt.mjs', dir))
const oc = await loadKernel({ wasmBinary, print() {} })
const symbols = JSON.parse(readFileSync(new URL('symbols.json', import.meta.url)))
for (const [area, exports] of Object.entries(symbols)) {
  for (const name of exports) assert.ok(oc[name], `Missing ${area} export ${name}`)
  console.log(`PASS exports ${area} ${exports.join(' ')}`)
}

assert.ok(oc.wasmMemory instanceof WebAssembly.Memory && oc.wasmMemory.buffer.byteLength > 0)

const done = oc.IFSelect_ReturnStatus.IFSelect_RetDone
const identity = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
const near = (actual, expected, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)

using progress = new oc.Message_ProgressRange()
using blank = box(oc, 0, 5, 20, 15)
using shape = drill(oc, blank, { xQ: 100000, yQ: 70000, diameterQ: 40000 }, 5)
assert.ok(volume(oc, shape) < volume(oc, blank))
const part = { id: 'plate', nominalTransform: identity }
const { mesh } = extractPart(oc, shape, part)
assert.ok(mesh.indices.length > 36 && mesh.positions.length === mesh.normals.length)
const projection = projectAssembly(oc, [{ shape, part }])
assert.equal(projection.views.length, 3)
assert.ok(projection.views.every(view => view.geometry.some(edge => edge.style === 'visible')))
assert.ok(projection.views.some(view => view.geometry.some(edge => edge.style === 'hidden')))
const step = exportPlateStep(oc, shape)
const measured = readA01(oc, step)
assert.ok(measured.valid)
assert.equal(measured.cylinders.length, 1)
using imports = new DisposableStack()
const solids = readStepSolids(oc, step, imports)
assert.equal(solids.length, 1)
near(volume(oc, solids[0]), volume(oc, shape))
const rotated = measureA05(oc, 17)
assert.equal(rotated.nominal.relation, 'gap')
assert.equal(rotated.contact.relation, 'contact')
assert.equal(rotated.overlap.relation, 'overlap')
console.log(`PASS product plate, tessellation, HLR and STEP (${mesh.indices.length / 3} triangles)`)

using origin = new oc.gp_Pnt(18, 0, 0)
using axis = new oc.gp_Dir(0, 0, 1)
using basis = new oc.gp_Ax2(origin, axis)
using adjacentMaker = new oc.BRepPrimAPI_MakeBox(basis, 4, 15, 5)
using adjacent = adjacentMaker.Solid()
using union = new oc.BRepAlgoAPI_Fuse(blank, adjacent, progress)
using intersection = new oc.BRepAlgoAPI_Common(blank, adjacent, progress)
for (const operation of [union, intersection]) {
  assert.equal(operation.IsDone(), true)
  assert.equal(operation.HasErrors(), false)
  operation.SimplifyResult(true, true, 1e-9)
}
using unitedShape = union.Shape()
using sharedShape = intersection.Shape()
near(volume(oc, unitedShape), 1650)
near(volume(oc, sharedShape), 150)
using compound = new oc.TopoDS_Compound()
using builder = new oc.TopoDS_Builder()
builder.MakeCompound(compound)
builder.Add(compound, blank)
builder.Add(compound, adjacent)
assert.equal(readStepSolids(oc, exportPlateStep(oc, compound), imports).length, 2)
using farBox = box(oc, 8, 5, 20, 15)
using distance = new oc.BRepExtrema_DistShapeShape(blank, farBox)
assert.ok(distance.IsDone())
near(distance.Value(), 3)

using edges = new oc.TopExp_Explorer(blank, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE)
using child = edges.Current()
using edge = oc.TopoDS.Edge(child)
using chamfer = new oc.BRepFilletAPI_MakeChamfer(blank)
using fillet = new oc.BRepFilletAPI_MakeFillet(blank, oc.ChFi3d_FilletShape.ChFi3d_Rational)
for (const operation of [chamfer, fillet]) {
  operation.Add(0.5, edge)
  operation.Build(progress)
  assert.equal(operation.IsDone(), true)
  using finished = operation.Shape()
  assert.ok(volume(oc, finished) < volume(oc, blank))
}
using faces = new oc.TopExp_Explorer(blank, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE)
using faceChild = faces.Current()
using face = oc.TopoDS.Face(faceChild)
using surface = new oc.BRepAdaptor_Surface(face, true)
using plane = surface.Plane()
using perpendicular = plane.Axis()
using normal = perpendicular.Direction()
using vector = new oc.gp_Vec(2 * normal.X(), 2 * normal.Y(), 2 * normal.Z())
using prism = new oc.BRepPrimAPI_MakePrism(face, vector, true, true)
using prismShape = prism.Shape()
assert.ok(Math.abs(volume(oc, prismShape)) > 0)
using offset = new oc.BRepOffsetAPI_MakeThickSolid()
offset.MakeThickSolidBySimple(face, 0.5)
assert.ok(offset.IsDone())
using thickened = offset.Shape()
assert.ok(Math.abs(volume(oc, thickened)) > 0)
using removed = new oc.TopTools_ListOfShape()
removed.Append(face)
offset.MakeThickSolidByJoin(blank, removed, -0.5, 1e-5, progress)
assert.ok(offset.IsDone())
using shelled = offset.Shape()
assert.ok(volume(oc, shelled) > 0 && volume(oc, shelled) < volume(oc, blank))
console.log('PASS box placement overload, fuse/common, compound STEP, distance, chamfer/fillet, prism and shell')

assert.equal(oc._spacer_step(20, 12, 8), 0)
const spacer = oc.FS.readFile('/spacer.step')
const spacerText = Buffer.from(spacer).toString()
assert.match(spacerText, /^ISO-10303-21;/)
assert.match(spacerText, /AUTOMOTIVE_DESIGN/i)
assert.equal(oc._spacer_step(12, 20, 8), 2)
assert.ok(!oc.FS.readdir('/').includes('spacer.step'))
let exception
try {
  using invalid = new oc.gp_Dir(0, 0, 0)
} catch (error) {
  exception = error
}
assert.ok(exception)
try {
  const [type] = oc.getExceptionMessage(exception)
  assert.match(type, /Standard_ConstructionError/)
} finally {
  oc.decrementExceptionRefcount(exception)
}
console.log('PASS native WASM C++ exception inspection and release')
console.log(`PASS spacer AP214 geometry/readback and failure cleanup (${spacer.length} bytes)`)

using app = oc.XCAFApp_Application.GetApplication()
const tool = oc.XCAFDoc_ShapeTool
const names = oc.TDataStd_Name
const surfColor = oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf
function withDocument(run) {
  using document = app.NewDocument()
  using main = document.Main()
  try {
    run(document, main)
  } finally {
    app.Close(document)
  }
}

const translate = (x, y, z) => {
  using transform = new oc.gp_Trsf()
  transform.SetValues(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z)
  return new oc.TopLoc_Location(transform)
}

const rgb = [0.25, 0.5, 0.75]
const partName = '夹紧座'
withDocument((document, main) => {
  using shapes = oc.XCAFDoc_DocumentTool.ShapeTool(main)
  using colors = oc.XCAFDoc_DocumentTool.ColorTool(main)
  using root = shapes.NewShape()
  using nested = shapes.NewShape()
  using plate = shapes.AddShape(blank, false, false)
  names.Set(root, 'Fixture')
  names.Set(nested, 'Clamp assembly')
  names.Set(plate, partName)
  using firstPlacement = translate(30, 0, 0)
  using first = shapes.AddComponent(root, nested, firstPlacement)
  names.Set(first, 'Left clamp')
  using secondPlacement = translate(0, 40, 0)
  using second = shapes.AddComponent(root, nested, secondPlacement)
  names.Set(second, 'Right clamp')
  using platePose = new oc.gp_Trsf()
  platePose.SetValues(0, -1, 0, 2, 1, 0, 0, 3, 0, 0, 1, 4)
  using platePlacement = new oc.TopLoc_Location(platePose)
  using component = shapes.AddComponent(nested, plate, platePlacement)
  names.Set(component, 'Mounted base')
  colors.SetColor(plate, rgb, surfColor)
  let colored = false
  visit(oc, blank, oc.TopAbs_ShapeEnum.TopAbs_FACE, face => {
    if (colored) return
    using label = shapes.AddSubShape(plate, face)
    assert.ok(!label.IsNull())
    colors.SetColor(label, [0.8, 0.1, 0.2], surfColor)
    colored = true
  })
  assert.ok(colored)
  shapes.UpdateAssemblies()
  using writer = new oc.STEPCAFControl_Writer()
  writer.SetColorMode(true)
  writer.SetNameMode(true)
  assert.equal(writer.Transfer(document, progress), true)
  assert.equal(writer.Write('/assembly.step'), done)
})

const fixture = oc.FS.readFile('/assembly.step')
assert.match(Buffer.from(fixture).toString(), /NEXT_ASSEMBLY_USAGE_OCCURRENCE/)
withDocument((document, main) => {
  using reader = new oc.STEPCAFControl_Reader()
  reader.SetColorMode(true)
  reader.SetNameMode(true)
  assert.equal(reader.ReadFile('/assembly.step'), done)
  assert.equal(reader.Transfer(document, progress), true)
  using shapes = oc.XCAFDoc_DocumentTool.ShapeTool(main)
  using roots = shapes.GetFreeShapes()
  assert.equal(roots.Length(), 1)
  using root = roots.Value(1)
  assert.equal(names.Get(root), 'Fixture')
  assert.equal(tool.IsAssembly(root), true)
  using instances = tool.GetComponents(root)
  assert.equal(instances.Length(), 2)
  const placements = new Map([['Left clamp', [30, 0, 0]], ['Right clamp', [0, 40, 0]]])
  for (let i = 1; i <= instances.Length(); i++) {
    using instance = instances.Value(i)
    const name = names.Get(instance)
    const expected = placements.get(name)
    assert.ok(expected, `Unexpected STEP instance name ${name}`)
    placements.delete(name)
    using location = tool.GetLocation(instance)
    using transform = location.Transformation()
    expected.forEach((value, i) => near(transform.Value(i + 1, 4), value))
    using definition = tool.GetReferredShape(instance)
    assert.equal(names.Get(definition), 'Clamp assembly')
    assert.equal(tool.IsAssembly(definition), true)
    using children = tool.GetComponents(definition)
    assert.equal(children.Length(), 1)
    using component = children.Value(1)
    assert.equal(names.Get(component), 'Mounted base')
    using local = tool.GetLocation(component)
    using localPose = local.Transformation()
    const matrix = [[0, -1, 0, 2], [1, 0, 0, 3], [0, 0, 1, 4]]
    matrix.forEach((row, i) => row.forEach((value, j) => near(localPose.Value(i + 1, j + 1), value)))
    using world = location.Multiplied(local)
    using worldPose = world.Transformation()
    expected.forEach((value, i) => near(worldPose.Value(i + 1, 4), value + matrix[i][3]))
    using plate = tool.GetReferredShape(component)
    assert.equal(names.Get(plate), partName)
    const actual = oc.XCAFDoc_ColorTool.GetColor(plate, surfColor)
    assert.ok(actual)
    rgb.forEach((value, i) => near(actual[i], value, 2e-6))
    using subshapes = tool.GetSubShapes(plate)
    const faceColors = []
    for (let i = 1; i <= subshapes.Length(); i++) {
      using subshape = subshapes.Value(i)
      const color = oc.XCAFDoc_ColorTool.GetColor(subshape, surfColor)
      if (color) faceColors.push(color)
    }
    assert.ok(faceColors.some(color => color.every((value, i) => Math.abs(value - [0.8, 0.1, 0.2][i]) < 2e-6)))
  }
  assert.equal(placements.size, 0)
})
oc.FS.unlink('/assembly.step')
console.log(`PASS STEPCAF named hierarchy, repeated instances, composed pose and part/face RGB (${fixture.length} bytes)`)
console.log(JSON.stringify({ bytes: wasmBinary.length, sha256: createHash('sha256').update(wasmBinary).digest('hex') }))
