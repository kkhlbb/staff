import { loadKernel } from '../../../../desktop/main/geometry-prototype/plate.mjs'

const zAxis = [0, 0, 1]
const box = (origin, size) => ({ kind: 'box', origin, size })
const cylinder = (origin, radius, length) => ({ kind: 'cylinder', origin, radius, length })
const cut = (base, ...tools) => ({ kind: 'cut', base, tools })
const fuse = (base, ...tools) => ({ kind: 'fuse', base, tools })
const bores = (centers, radius, length) => centers.map(([x, y]) => cylinder([x, y, -1], radius, length + 2))
const part = (name, shape, origin = [0, 0, 0]) => ({ name, shape, origin })

const dowels = [[9, 8], [33, 8]]
const corners = [[2, 2], [48, 2], [2, 32], [48, 32]]
export const designs = {
  'plate-spacer-cover-pins': [
    part('Mounting plate', cut(box([0, 0, 0], [42, 25, 5]), ...bores(dowels, 2, 5))),
    part('Spacer', cut(cylinder([0, 0, 0], 8, 7), cylinder([0, 0, -1], 3, 9)), [21, 15, 5]),
    part('Cover', cut(box([0, 0, 0], [42, 25, 4]), ...bores(dowels, 2, 4)), [0, 0, 12]),
    ...dowels.map(([x, y], index) => part('Dowel ' + (index + 1), cylinder([0, 0, 0], 2, 16), [x, y, 0])),
  ],
  'l-bracket-flange': [
    part('L bracket', cut(fuse(box([0, 0, 0], [45, 38, 5]), box([0, 0, 5], [5, 38, 22])),
      ...bores([[26, 19], [36, 19]], 3, 5))),
    part('Flange', cut(cylinder([0, 0, 0], 15, 6), ...bores([[0, 0], [10, 0]], 3, 6)), [26, 19, 5]),
  ],
  'stepped-shaft-seat-cover': [
    part('Bearing seat', cut(box([-17, -14, 0], [34, 28, 9]), cylinder([0, 0, -1], 6, 11))),
    part('Stepped shaft', fuse(cylinder([0, 0, 0], 6, 9),
      cylinder([0, 0, 9], 9, 3), cylinder([0, 0, 12], 4, 10))),
    part('End cap', cut(cylinder([0, 0, 0], 13, 4), cylinder([0, 0, -1], 4, 6)), [0, 0, 12]),
  ],
  'shell-four-corner-clamps': [
    part('Thin-wall housing', cut(box([0, 0, 0], [50, 34, 14]), box([4, 4, 2], [42, 26, 13]),
      ...bores(corners, 1.4, 14))),
    part('Lid', cut(box([0, 0, 0], [50, 34, 3]), ...bores(corners, 1.7, 3)), [0, 0, 14]),
    ...corners.map(([x, y], index) => part('Clamp screw ' + (index + 1),
      fuse(cylinder([0, 0, -8], 1.4, 8), cylinder([0, 0, 0], 2.7, 2)), [x, y, 17])),
  ],
  'eccentric-coupling': [
    part('Driving hub', cut(cylinder([0, 0, 0], 15, 7), ...bores([[3, 0], [-6, 6], [-6, -6]], 2.2, 7))),
    part('Driven hub', cut(cylinder([0, 0, 0], 15, 7), ...bores([[3, 0], [-6, 6], [-6, -6]], 2.2, 7)), [0, 0, 7]),
    part('Eccentric key', cylinder([0, 0, 0], 2, 14), [3.1, 0, 0]),
  ],
}

function build(oc, spec) {
  if (spec.kind === 'box') {
    using p = new oc.gp_Pnt(...spec.origin)
    using maker = new oc.BRepPrimAPI_MakeBox(p, ...spec.size)
    return maker.Solid()
  }
  if (spec.kind === 'cylinder') {
    using p = new oc.gp_Pnt(...spec.origin)
    using n = new oc.gp_Dir(...zAxis)
    using frame = new oc.gp_Ax2(p, n)
    using maker = new oc.BRepPrimAPI_MakeCylinder(frame, spec.radius, spec.length)
    return maker.Shape()
  }
  using scope = new DisposableStack()
  let shape = scope.use(build(oc, spec.base))
  const Operation = spec.kind === 'cut' ? oc.BRepAlgoAPI_Cut : oc.BRepAlgoAPI_Fuse
  using progress = new oc.Message_ProgressRange()
  for (const tool of spec.tools) {
    using operand = build(oc, tool)
    using operation = new Operation(shape, operand, progress)
    if (!operation.IsDone() || operation.HasErrors()) throw Error('Fixture boolean failed')
    operation.SimplifyResult(true, true, 1e-9)
    shape = scope.use(operation.Shape())
  }
  return shape.clone()
}

const colors = [[0.35, 0.48, 0.64], [0.62, 0.57, 0.49], [0.42, 0.62, 0.56]]
export async function fixtureWriter() {
  const oc = await loadKernel({ print: () => {}, printErr: () => {} })
  return id => {
    const path = '/benchmark-fixture.step'
    using app = oc.XCAFApp_Application.GetApplication()
    using doc = app.NewDocument()
    try {
      using main = doc.Main()
      using shapes = oc.XCAFDoc_DocumentTool.ShapeTool(main)
      using palette = oc.XCAFDoc_DocumentTool.ColorTool(main)
      using root = shapes.NewShape()
      oc.TDataStd_Name.Set(root, id)
      designs[id].forEach(({ name, origin: [x, y, z], shape }, index) => {
        using solid = build(oc, shape)
        using label = shapes.AddShape(solid, false, false)
        oc.TDataStd_Name.Set(label, name)
        palette.SetColor(label, colors[index % colors.length], oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf)
        using pose = new oc.gp_Trsf()
        pose.SetValues(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z)
        using location = new oc.TopLoc_Location(pose)
        using component = shapes.AddComponent(root, label, location)
        oc.TDataStd_Name.Set(component, name)
      })
      shapes.UpdateAssemblies()
      using writer = new oc.STEPCAFControl_Writer()
      writer.SetNameMode(true)
      writer.SetColorMode(true)
      using progress = new oc.Message_ProgressRange()
      if (!writer.Transfer(doc, progress) || writer.Write(path) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
        throw Error('Fixture STEP write failed for ' + id)
      }
      // Keep fixture bytes repeatable across runs. The STEP header timestamp
      // is writer metadata and does not influence the authored geometry.
      const content = Buffer.from(oc.FS.readFile(path)).toString('latin1')
      return Buffer.from(content.replace(/(FILE_NAME\('[^']*',')\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d'/,
        (_, prefix) => prefix + "2026-11-26T00:00:00'"), 'latin1')
    } finally {
      if (oc.FS.analyzePath(path).exists) oc.FS.unlink(path)
      app.Close(doc)
    }
  }
}
