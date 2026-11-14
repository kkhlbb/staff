// Fixed 1.2.1 bindings; reference: approved wasm-experiment-01/export.cjs/readback.cjs.
// Each job owns one fresh WASM heap. Parent always terminates this worker.
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
(async () => {
  const { input, assetDirectory, hashes } = workerData;
  for (const [name, expected] of Object.entries(hashes)) {
    const bytes = fs.readFileSync(path.join(assetDirectory, name));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected, 'STEP_ASSET_HASH: ' + name);
  }
  // Defense in depth; parent validates before spawning too.
  assert.ok(input && Object.keys(input).sort().join(',') === 'innerDiameter,length,outerDiameter', 'STEP_INVALID');
  assert.ok(Object.values(input).every(q => Number.isSafeInteger(q) && q >= 100 && q <= 100000000), 'STEP_UNSUPPORTED');
  assert.ok(input.outerDiameter - input.innerDiameter >= 200, 'STEP_UNSUPPORTED');
  const d = input.innerDiameter / 10000, D = input.outerDiameter / 10000, L = input.length / 10000;
  assert.ok(Math.max(D, L) / Math.min(d / 2, (D - d) / 2, L) <= 10000, 'STEP_UNSUPPORTED');
  const oc = await require(path.join(assetDirectory, 'replicad_single.cjs'))({
    wasmBinary: fs.readFileSync(path.join(assetDirectory, 'replicad_single.wasm')),
    print: () => {}, printErr: () => {},
  });
  const range = new oc.Message_ProgressRange();
  const axis = new oc.gp_Ax2(new oc.gp_Pnt(-L / 2, 0, 0), new oc.gp_Dir(1, 0, 0));
  // Divide integer diameter q directly by 20000: never truncate odd q.
  const outer = new oc.BRepPrimAPI_MakeCylinder(axis, input.outerDiameter / 20000, L);
  const inner = new oc.BRepPrimAPI_MakeCylinder(axis, input.innerDiameter / 20000, L);
  const a = outer.Shape(), b = inner.Shape();
  assert.ok(outer.IsDone() && inner.IsDone(), 'STEP_BUILD_CYLINDER');
  const cut = new oc.BRepAlgoAPI_Cut(a, b, range);
  assert.ok(cut.IsDone(), 'STEP_BUILD_BOOLEAN');
  const shape = cut.Shape();
  assert.ok(!shape.IsNull() && new oc.BRepCheck_Analyzer(shape, true, false, false).IsValid(), 'STEP_INVALID_BREP');
  function collect(kind) {
    const ex = new oc.TopExp_Explorer(shape, kind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE), found = [];
    while (ex.More()) { found.push(ex.Current().Oriented(ex.Current().Orientation())); ex.Next(); }
    ex.delete(); return found;
  }
  const solids = collect(oc.TopAbs_ShapeEnum.TopAbs_SOLID), shells = collect(oc.TopAbs_ShapeEnum.TopAbs_SHELL);
  assert.equal(solids.length, 1, 'STEP_SOLID_COUNT');
  assert.equal(shells.length, 1, 'STEP_SHELL_COUNT');
  assert.ok(oc.BRep_Tool.IsClosed(shells[0]), 'STEP_OPEN_SHELL');
  const faces = collect(oc.TopAbs_ShapeEnum.TopAbs_FACE);
  assert.equal(faces.length, 4, 'STEP_FACE_COUNT');
  const radii = [];
  let planes = 0;
  for (const f of faces) {
    const surface = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true);
    if (surface.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) radii.push(surface.Cylinder().Radius());
    else { assert.equal(surface.GetType(), oc.GeomAbs_SurfaceType.GeomAbs_Plane, 'STEP_NON_ANALYTIC'); planes++; }
  }
  radii.sort((x, y) => x - y);
  assert.equal(planes, 2); assert.equal(radii.length, 2);
  assert.ok(Math.abs(radii[0] - d / 2) < 1e-6 && Math.abs(radii[1] - D / 2) < 1e-6, 'STEP_RADII');
  const props = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, props, true, false, false);
  const volume = props.Mass(), expected = Math.PI * (D - d) * (D + d) * L / 4;
  assert.ok(Number.isFinite(volume) && volume > 0 && Math.abs(volume - expected) <= Math.max(1e-6, expected * 1e-9), 'STEP_VOLUME');
  function point(x, y, inside) {
    const vertex = new oc.BRepBuilderAPI_MakeVertex(new oc.gp_Pnt(x, y, 0)).Shape();
    const dist = new oc.BRepExtrema_DistShapeShape(); dist.LoadS1(solids[0]); dist.LoadS2(vertex);
    assert.ok(dist.Perform(range) && dist.IsDone(), 'STEP_POINT_CHECK');
    assert.equal(dist.InnerSolution(), inside, 'STEP_POINT_MATERIAL');
    assert.ok(Math.abs(dist.Value() - (inside ? 0 : d / 2)) <= 1e-6, 'STEP_POINT_DISTANCE');
  }
  for (const x of [-0.49 * L, 0, 0.49 * L]) point(x, 0, false);
  point(0, (d + D) / 4, true);
  // Seed initializes STEP static settings. Use direct string enums, NOT .value.
  new oc.STEPControl_Writer().delete();
  for (const [key, value] of [['write.step.schema', 'AP214IS'], ['write.step.unit', 'MM'], ['xstep.cascade.unit', 'MM']]) {
    assert.ok(oc.Interface_Static.SetCVal(key, value), 'STEP_SETTING');
    assert.equal(oc.Interface_Static.CVal(key), value, 'STEP_SETTING_READBACK');
  }
  assert.equal(oc.Interface_Static.IVal('write.step.schema'), 4);
  const writer = new oc.STEPControl_Writer();
  assert.equal(writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, range), oc.IFSelect_ReturnStatus.IFSelect_RetDone, 'STEP_TRANSFER');
  assert.equal(writer.Write('/spacer.step'), oc.IFSelect_ReturnStatus.IFSelect_RetDone, 'STEP_WRITE');
  const bytes = Uint8Array.from(oc.FS.readFile('/spacer.step'));
  parentPort.postMessage({ bytes }, [bytes.buffer]);
})().catch(error => { parentPort.postMessage({ error: 'STEP_KERNEL_FAILED: ' + (error?.message || String(error)) }); });
