import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { box, loadKernel } from '../../../desktop/main/geometry-prototype/plate.mjs'
import { assemblyModelV1Schema } from '../../project-file/assembly3d.ts'
import { runAssemblyGeometry } from './assemblyGeometry.mjs'
import { createGeometryManager } from './geometryManager.mjs'
import { buildPrimitive } from './primitives.mjs'
import { inspectTopology } from './topology.mjs'

const pose = (x = 0, y = 0, z = 0) => [[1, 0, 0, x], [0, 1, 0, y], [0, 0, 1, z], [0, 0, 0, 1]]
const q = mm => Math.round(mm * 10000)
const dimensions = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key + 'Q', q(value)]))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const model = (parts, features = []) => ({ schemaVersion: 1, units: 'mm', parts, features,
  mates: [], datums: [], measurements: [], gdt: [] })
const part = (baseKind = 'plate', size = { length: 20, width: 20, thickness: 5 }, extra = {}) =>
  ({ kind: 'parametric-primitive', baseKind, sizeQ: dimensions(size), modifiers: [], id: 'plate',
    displayName: 'Part', color: '#aabbcc', nominalTransform: pose(), ...extra })
const options = (extra = {}) => ({ jobId: 'test', attempt: 1, ...extra })
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`)

function attachment(bytes, id = 'attachment-1') {
  return { id, blobKey: id + '-blob', fileName: 'sample.step', bytes, sha256: hash(bytes) }
}

async function stepFixture(count, compound = false) {
  const oc = await loadKernel({ print: () => {}, printErr: () => {} })
  using scope = new DisposableStack()
  const first = scope.use(box(oc, 0, 5, 20, 20))
  const second = scope.use(box(oc, 10, 4, 12, 8))
  const ring = part('cylinder-spacer', { length: 7, innerDiameter: 4, outerDiameter: 10 })
  using blank = buildPrimitive(oc, ring, [])
  const topology = inspectTopology(oc, blank, ring.id)
  const edgeFeatureId = topology.edgeSegments.find(edge => edge.circle?.radius === 5 && edge.points[0][2] === 7).featureId
  const third = scope.use(buildPrimitive(oc, { ...ring, modifiers: [
    { kind: 'chamfer-fillet', profile: 'chamfer', edgeFeatureId, sizeQ: q(1) },
  ] }, topology.features))
  const shapes = [first, second, third].slice(0, count)
  using writer = new oc.STEPControl_Writer()
  using progress = new oc.Message_ProgressRange()
  const done = oc.IFSelect_ReturnStatus.IFSelect_RetDone
  const asIs = oc.STEPControl_StepModelType.STEPControl_AsIs
  if (compound) {
    using builder = new oc.TopoDS_Builder()
    const assembly = scope.use(new oc.TopoDS_Compound())
    builder.MakeCompound(assembly)
    shapes.forEach(shape => builder.Add(assembly, shape))
    assert.equal(writer.Transfer(assembly, asIs, true, progress), done)
  } else {
    for (const shape of shapes) assert.equal(writer.Transfer(shape, asIs, true, progress), done)
  }
  assert.equal(writer.Write('/fixture.step'), done)
  try {
    return attachment(oc.FS.readFile('/fixture.step'))
  } finally {
    oc.FS.unlink('/fixture.step')
  }
}

test('STEP imports one solid, three roots and three solids in one compound with stable IDs and no mates', async () => {
  const manager = createGeometryManager()
  try {
    for (const [count, compound] of [[1, false], [3, false], [3, true]]) {
      const step = await stepFixture(count, compound)
      const opts = options({ projectId: 'p', revision: 'r', ...(compound && { drawing: { export: true } }) })
      const { report, metrics } = await manager.importStep(step, opts)
      const { assembly, parts, features } = report
      assert.equal(report.sha256, step.sha256)
      assert.ok(assemblyModelV1Schema.safeParse(assembly).success)
      assert.equal(parts.length, count)
      assert.equal(metrics.cachedShapeHandles, count)
      assert.equal(metrics.wasmInitializations, 1)
      assert.deepEqual(assembly.mates, [])
      assert.deepEqual(assembly.parts.map(p => p.solidIndex), [...Array(count).keys()])
      assert.ok(assembly.parts.every(p => p.attachmentId === step.id))
      assert.equal(features.length, new Set(features.map(f => f.id)).size)
      closeTo(parts[0].volumeMm3, 2000)
      const mesh = parts[0].mesh
      assert.ok(mesh.positions instanceof Float64Array)
      assert.ok(mesh.indices instanceof Uint32Array)
      assert.equal(mesh.normals.length, mesh.positions.length)
      assert.equal(mesh.faceTriangleRanges.reduce((sum, range) => sum + range.triangleCount, 0), mesh.indices.length / 3)
      assert.ok(mesh.indices.every(index => index < mesh.positions.length / 3))
      assert.ok(mesh.edgeSegments.every(edge => edge.curve === 'line' && edge.points.length === 2))
      assert.equal(mesh.edgeSegments.length, 12)
      const plane = parts[0].faces.find(face => face.normal[2] === 1)
      assert.deepEqual(plane.centroid, [10, 10, 5])
      assert.deepEqual(plane.bounds.max, [20, 20, 5])
      closeTo(plane.areaMm2, 400)
      if (count === 3) {
        const cone = parts[2].faces.find(face => face.surface === 'cone')
        assert.ok(cone && cone.areaMm2 > 0 && cone.radius > 0)
        closeTo(Math.abs(cone.axis[2]), 1)
        closeTo(cone.radius, 4.5)
        closeTo(Math.abs(cone.semiAngleRad), Math.PI / 4)
        closeTo(cone.apex[2], 11)
        assert.ok(parts[2].mesh.edgeSegments.some(edge => edge.curve === 'circle' && edge.points.length > 30))
      }
      const cached = await manager.importStep({ ...step, fileName: 'renamed.stp' }, opts)
      assert.equal(cached.metrics.cachedShapeBuilds, metrics.cachedShapeBuilds)
      assert.ok(cached.report.assembly.parts[0].displayName.startsWith('renamed'))
      const released = await manager.release('p', 'r')
      assert.equal(released.metrics.cachedShapeHandles, 0)
      const repeated = await manager.rebuildAssembly(assembly, { ...opts, attachments: [step] })
      assert.deepEqual(repeated.report.parts, parts)
      assert.deepEqual(repeated.report.features, features)
      assert.equal(repeated.metrics.wasmInitializations, 1)
      if (compound) {
        assert.equal(repeated.report.projection.algorithm, 'OCCT HLRBRep_Algo')
        assert.match(repeated.report.exports.svg, /class="s-hidden"/)
      }
    }
  } finally {
    await manager.close()
  }
})

test('builds frozen primitives in integer q and checks hole, slot, finish and signed extrusion volumes', async () => {
  const manager = createGeometryManager()
  try {
    const cases = [
      [part(), 2000],
      [part('cylinder-spacer', { length: 8, innerDiameter: 10, outerDiameter: 20 }), 600 * Math.PI],
      [part('l-bracket', { length: 20, width: 10, height: 12, thickness: 2 }), 600],
      [part('thin-shell', { length: 20, width: 10, height: 12, wall: 2 }), 1440],
    ]
    for (const [input, expected] of cases) {
      const { report } = await manager.rebuildAssembly(model([input]), options())
      closeTo(report.parts[0].volumeMm3, expected)
    }
    const { report: base } = await manager.rebuildAssembly(model([part()]), options())
    const edgeFeatureId = base.features.find(feature => feature.kind === 'edge').id
    const faceFeatureId = base.parts[0].faces.find(face => face.normal[2] === 1).featureId
    const modifiers = [
      [{ kind: 'through-hole', originQ: [q(10), q(10), 0], axis: [0, 0, 1], diameterQ: q(2) }, 2000 - 5 * Math.PI],
      [{ kind: 'blind-hole', originQ: [q(10), q(10), q(5)], axis: [0, 0, -1], diameterQ: q(2), depthQ: q(2) }, 2000 - 2 * Math.PI],
      [{ kind: 'slot', startQ: [q(5), q(10), 0], endQ: [q(15), q(10), 0], axis: [0, 0, 1], widthQ: q(2) }, 2000 - 5 * (20 + Math.PI)],
      [{ kind: 'chamfer-fillet', profile: 'chamfer', edgeFeatureId, sizeQ: q(0.3) }, 2000 - 5 * 0.3 ** 2 / 2],
      [{ kind: 'chamfer-fillet', profile: 'fillet', edgeFeatureId, sizeQ: q(0.3) }, 2000 - 5 * 0.3 ** 2 * (1 - Math.PI / 4)],
      [{ kind: 'extrude-offset', faceFeatureId, offsetQ: q(2) }, 2800],
      [{ kind: 'extrude-offset', faceFeatureId, offsetQ: q(-2) }, 1200],
    ]
    for (const [modifier, expected] of modifiers) {
      const { report } = await manager.rebuildAssembly(model([part(undefined, undefined, {
        modifiers: [{ ...modifier, id: 'modifier' }],
      })], base.features), options())
      closeTo(report.parts[0].volumeMm3, expected)
    }
    const first = part(undefined, undefined, { modifiers: [{ ...modifiers[0][0], id: 'hole' }] })
    const second = { ...first, id: 'part-b', nominalTransform: pose(0, 0, 5) }
    const { report } = await manager.rebuildAssembly(model([first, second]), options())
    assert.ok(report.candidates.coaxial.length >= 1)
    assert.ok(report.candidates.coplanar.length >= 1)
    const cylinder = report.parts[0].faces.find(face => face.surface === 'cylinder')
    closeTo(cylinder.radius, 1)
    closeTo(cylinder.areaMm2, 10 * Math.PI)
    closeTo(Math.hypot(...cylinder.normal), 1)
  } finally {
    await manager.close()
  }
})

test('OCCT HLR hides geometry behind another placed solid and exports three views through the shared renderers', async () => {
  const manager = createGeometryManager()
  try {
    const foreground = part()
    const background = part('plate', { length: 6, width: 8, thickness: 2 }, { id: 'behind', nominalTransform: pose(3, 30, 1) })
    const opts = options({ projectId: 'p', revision: 'r', drawing: { export: true } })
    const single = (await manager.rebuildAssembly(model([background]), options({ drawing: {} }))).report
    const both = await manager.rebuildAssembly(model([foreground, background]), opts)
    assert.deepEqual(both.report.projection.views.map(view => view.id), ['front', 'top', 'left'])
    const frontLines = both.report.projection.views[0].geometry
    assert.ok(frontLines.some(edge => edge.style === 'visible'))
    const hidden = frontLines.filter(edge => edge.style === 'hidden')
    assert.ok(hidden.length >= 4)
    assert.equal(single.projection.views[0].geometry.filter(edge => edge.style === 'hidden').length, 0)
    assert.match(both.report.exports.svg, /class="s-hidden"/)
    assert.match(both.report.exports.dxf.text, /AC1009/)
    assert.match(both.report.exports.dxf.text, /(?:LINE|POLYLINE)\r\n8\r\n轮廓\r\n6\r\nDASHED/)
    const shifted = { ...background, nominalTransform: pose(25, 30, 1) }
    const moved = await manager.rebuildAssembly(model([foreground, shifted]), {
      ...opts, drawing: { export: true, dxfVersion: '2000' },
    })
    assert.equal(moved.metrics.cachedShapeBuilds, both.metrics.cachedShapeBuilds)
    assert.equal(moved.metrics.cachedShapeHandles, 2)
    assert.deepEqual(moved.report.parts[1].mesh.positions, both.report.parts[1].mesh.positions)
    assert.deepEqual(moved.report.parts[1].mesh.nominalTransform, shifted.nominalTransform)
    assert.equal(moved.report.projection.views[0].geometry.filter(edge => edge.style === 'hidden').length, 0)
    assert.match(moved.report.exports.dxf.text, /AC1015/)
    const released = await manager.release('p')
    assert.equal(released.metrics.cachedShapeHandles, 0)
  } finally {
    await manager.close()
  }
})

// Observe every disposable wrapper crossing the application-facing binding calls.
// Emscripten's package doesn't export a live-handle counter.
function observeNativeWrappers(oc) {
  const allocated = new Set()
  const prototypes = new Set()
  const seen = new Set()
  function observe(value) {
    if (value && typeof value.isDeleted === 'function') allocated.add(value)
    else if (value && Object.getPrototypeOf(value) === Object.prototype) {
      for (const nested of Object.values(value)) {
        if (nested && typeof nested.isDeleted === 'function') allocated.add(nested)
      }
    }
    return value
  }
  function instrument(object) {
    if (seen.has(object)) return
    seen.add(object)
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(object))) {
      if (key === 'constructor' || !descriptor.writable || typeof descriptor.value !== 'function') continue
      const value = new Proxy(descriptor.value, {
        apply(target, receiver, args) {
          return observe(Reflect.apply(target, receiver, args))
        },
      })
      Object.defineProperty(object, key, { ...descriptor, value })
    }
  }
  for (const key of Object.keys(oc)) {
    const constructor = oc[key]
    if (typeof constructor !== 'function' || !constructor.prototype ||
        typeof constructor.prototype.delete !== 'function') continue
    instrument(constructor)
    for (let prototype = constructor.prototype; typeof prototype?.delete === 'function'; prototype = Object.getPrototypeOf(prototype)) {
      prototypes.add(prototype)
    }
    oc[key] = new Proxy(constructor, {
      construct(target, args, newTarget) {
        return observe(Reflect.construct(target, args, newTarget))
      },
    })
  }
  prototypes.forEach(instrument)
  return {
    get count() { return allocated.size },
    live: () => [...allocated].filter(handle => !handle.isDeleted()).map(handle => handle.constructor.name),
  }
}

test('SHA mismatch is preflighted and malformed STEP or partial rebuild leaves no VFS file or Embind wrapper', async t => {
  const oc = await loadKernel({ print: () => {}, printErr: () => {} })
  const wrappers = observeNativeWrappers(oc)
  const files = oc.FS.readdir('/')
  const step = await stepFixture(3, true)
  const corrupt = attachment(new TextEncoder().encode('not a STEP file'))
  const importStep = value => runAssemblyGeometry(oc, { operation: 'import-step', attachmentId: value.id, attachments: [value] })
  let writes = 0
  const writeFile = oc.FS.writeFile.bind(oc.FS)
  oc.FS.writeFile = (...args) => {
    writes++
    return writeFile(...args)
  }
  assert.throws(() => importStep({ ...step, sha256: '0'.repeat(64) }), /SHA-256 mismatch/)
  assert.equal(writes, 0)
  assert.throws(() => importStep(corrupt), /STEP read failed/)
  assert.equal(writes, 1)
  assert.deepEqual(oc.FS.readdir('/'), files)
  assert.deepEqual(wrappers.live(), [])

  const { assembly } = importStep(step)
  assert.ok(wrappers.count > 100)
  assert.deepEqual(oc.FS.readdir('/'), files)
  assert.deepEqual(wrappers.live(), [])
  const missing = { ...assembly.parts[1], solidIndex: 999 }
  assert.throws(() => runAssemblyGeometry(oc, {
    operation: 'rebuild-assembly', model: model([assembly.parts[0], missing]), attachments: [step],
  }), /STEP solid index unavailable/)
  assert.deepEqual(oc.FS.readdir('/'), files)
  assert.deepEqual(wrappers.live(), [])

  const badHole = { kind: 'through-hole', id: 'bad', originQ: [0, 0, 0], axis: [0, 0, 0], diameterQ: q(2) }
  assert.throws(() => runAssemblyGeometry(oc, {
    operation: 'rebuild-assembly', model: model([part(undefined, undefined, { modifiers: [badHole] })]),
  }), /Invalid direction/)
  assert.deepEqual(wrappers.live(), [])

  assert.throws(() => runAssemblyGeometry(oc, { operation: 'rebuild-assembly', model: model([part()]),
    drawing: { export: true, dxfVersion: 'invalid' } }), /DXF/)
  assert.deepEqual(wrappers.live(), [])

  let retained
  runAssemblyGeometry(oc, { operation: 'rebuild-assembly', model: model([part()]), drawing: { export: true } },
    (_key, build) => (retained = build()))
  assert.equal(wrappers.live().length, 1)
  retained.scope.dispose()
  assert.deepEqual(wrappers.live(), [])
  t.diagnostic(`Observed ${wrappers.count} application-facing wrappers, all released`)
})

test('worker recovers from bad STEP and discards failed cache entries', async () => {
  const manager = createGeometryManager()
  try {
    const opts = options({ projectId: 'p', revision: 'r' })
    const good = await stepFixture(1)
    await manager.importStep(good, opts)
    await assert.rejects(manager.importStep({ ...good, sha256: 'bad' }, opts), /SHA-256 mismatch/)
    await assert.rejects(manager.importStep(attachment(new Uint8Array([1, 2, 3])), opts), /STEP read failed/)
    const recovered = await manager.importStep(good, opts)
    assert.equal(recovered.metrics.cachedShapeHandles, 1)
    const { metrics } = await manager.release('p')
    assert.equal(metrics.cachedShapeHandles, 0)
  } finally {
    await manager.close()
  }
})

async function xcafStepFixture() {
  const oc = await loadKernel({ print: () => {}, printErr: () => {} })
  using app = oc.XCAFApp_Application.GetApplication()
  using document = app.NewDocument()
  const translate = (x, y, z) => {
    using trsf = new oc.gp_Trsf()
    trsf.SetValues(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z)
    return new oc.TopLoc_Location(trsf)
  }
  try {
    using main = document.Main()
    using shapes = oc.XCAFDoc_DocumentTool.ShapeTool(main)
    using colors = oc.XCAFDoc_DocumentTool.ColorTool(main)
    using progress = new oc.Message_ProgressRange()
    using blank = box(oc, 0, 5, 20, 15)
    using root = shapes.NewShape()
    using nested = shapes.NewShape()
    using plate = shapes.AddShape(blank, false, false)
    oc.TDataStd_Name.Set(root, 'Fixture')
    oc.TDataStd_Name.Set(nested, 'Clamp assembly')
    oc.TDataStd_Name.Set(plate, '夹紧座')
    using leftLoc = translate(30, 0, 0)
    using left = shapes.AddComponent(root, nested, leftLoc)
    oc.TDataStd_Name.Set(left, 'Left clamp')
    using rightLoc = translate(0, 40, 0)
    using right = shapes.AddComponent(root, nested, rightLoc)
    oc.TDataStd_Name.Set(right, 'Right clamp')
    using platePose = new oc.gp_Trsf()
    platePose.SetValues(0, -1, 0, 2, 1, 0, 0, 3, 0, 0, 1, 4)
    using plateLoc = new oc.TopLoc_Location(platePose)
    using component = shapes.AddComponent(nested, plate, plateLoc)
    oc.TDataStd_Name.Set(component, 'Mounted base')
    colors.SetColor(plate, [0.25, 0.5, 0.75], oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf)
    shapes.UpdateAssemblies()
    using writer = new oc.STEPCAFControl_Writer()
    writer.SetNameMode(true)
    writer.SetColorMode(true)
    assert.equal(writer.Transfer(document, progress), true)
    assert.equal(writer.Write('/xcaf-fixture.step'), oc.IFSelect_ReturnStatus.IFSelect_RetDone)
    return attachment(oc.FS.readFile('/xcaf-fixture.step'), 'xcaf-attachment-1')
  } finally {
    if (oc.FS.readdir('/').includes('xcaf-fixture.step')) oc.FS.unlink('/xcaf-fixture.step')
    app.Close(document)
  }
}

test('XCAF multi-level STEP imports assemblyGroups, UTF-8 names, composed transforms, RGB colors, and leaks 0 Embind handles', async () => {
  const step = await xcafStepFixture()
  const oc = await loadKernel({ print: () => {}, printErr: () => {} })
  const wrappers = observeNativeWrappers(oc)
  const files = oc.FS.readdir('/')

  const imported = runAssemblyGeometry(oc, { operation: 'import-step', attachmentId: step.id, attachments: [step] })
  assert.deepEqual(oc.FS.readdir('/'), files)
  assert.deepEqual(wrappers.live(), [])

  const { assembly, parts } = imported
  assert.ok(assemblyModelV1Schema.safeParse(assembly).success)
  assert.deepEqual(assembly.mates, [])
  assert.equal(parts.length, 2)
  assert.equal(assembly.assemblyGroups?.length, 3)

  const rootGroup = assembly.assemblyGroups.find(g => g.name === 'Fixture')
  const leftGroup = assembly.assemblyGroups.find(g => g.name === 'Left clamp')
  const rightGroup = assembly.assemblyGroups.find(g => g.name === 'Right clamp')
  assert.ok(rootGroup && !rootGroup.parentGroupId)
  assert.equal(leftGroup?.parentGroupId, rootGroup.id)
  assert.equal(rightGroup?.parentGroupId, rootGroup.id)

  for (const [index, expectedGroup, expectedTranslation] of [
    [0, leftGroup, [32, 3, 4]],
    [1, rightGroup, [2, 43, 4]],
  ]) {
    const partModel = assembly.parts[index]
    assert.equal(partModel.displayName, '夹紧座')
    assert.equal(partModel.color, '#4080bf')
    assert.equal(partModel.groupId, expectedGroup.id)
    assert.equal(partModel.solidIndex, index)
    closeTo(partModel.nominalTransform[0][0], 0)
    closeTo(partModel.nominalTransform[0][1], -1)
    closeTo(partModel.nominalTransform[1][0], 1)
    closeTo(partModel.nominalTransform[1][1], 0)
    closeTo(partModel.nominalTransform[2][2], 1)
    closeTo(partModel.nominalTransform[0][3], expectedTranslation[0])
    closeTo(partModel.nominalTransform[1][3], expectedTranslation[1])
    closeTo(partModel.nominalTransform[2][3], expectedTranslation[2])
    closeTo(parts[index].volumeMm3, 1500)
  }

  // Rebuild assembly round-trip and worker cache hit preserve XCAF metadata and leak 0 handles.
  const rebuilt = runAssemblyGeometry(oc, { operation: 'rebuild-assembly', model: assembly, attachments: [step] })
  assert.deepEqual(oc.FS.readdir('/'), files)
  assert.deepEqual(wrappers.live(), [])
  assert.deepEqual(rebuilt.parts, parts)

  const manager = createGeometryManager()
  try {
    const opts = options({ projectId: 'xcaf-p', revision: 'r1' })
    const first = await manager.importStep(step, opts)
    const cached = await manager.importStep({ ...step, fileName: 'other-name.step' }, opts)
    assert.equal(cached.metrics.cachedShapeBuilds, first.metrics.cachedShapeBuilds)
    assert.deepEqual(cached.report.assembly.assemblyGroups, first.report.assembly.assemblyGroups)
    assert.equal(cached.report.assembly.parts[0].displayName, '夹紧座')
    assert.equal(cached.report.assembly.parts[0].color, '#4080bf')
  } finally {
    await manager.close()
  }
})

test('loads the locked unified OCCT WASM asset byte-for-byte', () => {
  const binary = readFileSync(new URL('../../../vendor/occt-unified/cunlian_occt.wasm', import.meta.url))
  assert.equal(binary.length, 34129104)
  assert.equal(hash(binary), '6cb34be8e7cd73b121618bb8d3900d2950dc1b67043e59c9e499771afaf89282')
})
