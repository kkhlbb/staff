import assert from 'node:assert/strict'
import { test } from 'node:test'
import DxfParser from 'dxf-parser'
import { calculateChain } from '../../src/domain/calculate.ts'
import { monteCarloOf } from '../../src/domain/statistics.ts'
import { createGeometryManager } from '../../src/core/geometry/geometryManager.mjs'
import { ShapeCache } from '../../src/core/geometry/shapeCache.mjs'
import { WorkerQueue } from '../../src/core/geometry/workerQueue.mjs'
import { createSolverScheduler } from '../../src/core/solver/solverScheduler.mjs'
import { buildDxfDocument } from '../../src/drawing/dxfExport.ts'
import { exportHeadlessDrawing } from '../../src/drawing/headless.ts'
import { renderDrawingSvg, validateDrawingSvgMarkup } from '../../src/drawing/renderDrawingSvg.ts'
import { A4_LANDSCAPE, DRAWING_STYLES } from '../../src/drawing/types.ts'
import { loadKernel } from '../main/geometry-prototype/plate.mjs'
import { evaluate } from '../main/project-agent/m2/evaluate.mjs'
import { runMountingPlate, runMountingPlateDrawing } from '../main/project-agent/m2/engine.mjs'
import { createMountingPlate } from '../main/project-agent/m2/model.mjs'
import { observeNativeHandles } from './fixtures/m0-backend/observeNativeHandles.mjs'

const projectId = 'node-m0-backend'
const task = (jobId, attempt = 1) => ({ projectId, jobId, attempt })
const chain = { target: { minQ: 7_000, maxQ: 9_000 }, assumptions: '', terms: [
  { id: 'A', nominalQ: 10_000, lowerDeviationQ: -33, upperDeviationQ: 41, sign: 1 },
  { id: 'B', nominalQ: 2_000, lowerDeviationQ: -50, upperDeviationQ: 51, sign: -1 },
] }
const extremes = { kind: 'extremes1d', chain }
const mib = bytes => Math.round(bytes / 1024 ** 2 * 10) / 10

function drawingFixture({ revision, views }) {
  // Feed the measured top projection to the production DrawingData serializers.
  const top = views.find(view => view.id === 'top')
  const paper = ([x, y]) => ({ x: 20 + x, y: 100 - y })
  const primitives = top.geometry.map((item, index) => {
    const fields = { primitiveId: index === 0 ? 'axial.outline' : 'top-' + index, viewId: 'top', styleId: 'outline', area: 'drawing' }
    if (item.kind === 'circle') {
      const center = paper(item.center)
      return { ...fields, kind: 'circle', geometryMm: { cx: center.x, cy: center.y, r: item.radius } }
    }
    return { ...fields, kind: 'polyline', geometryMm: { points: [...item.points, item.points[0]].map(paper) } }
  })
  return { drawingId: revision, fingerprint: revision, drawingDataVersion: 1,
    templateId: 'node-regression', templateVersion: 1,
    paper: A4_LANDSCAPE, scale: { numerator: 1, denominator: 1 }, styles: DRAWING_STYLES,
    parameterSnapshot: [], primitives, annotations: [], frame: { fields: {} } }
}

function numericReport({ status, measured, references, invalidations, checks, placement, mesh, drawing }) {
  const { frameId: plateFrame, ...plate } = mesh.plate
  const { frameId: coverFrame, ...cover } = mesh.cover
  assert.equal(plateFrame, coverFrame)
  return { status, measured, references, invalidations, checks, placement, mesh: { plate, cover }, drawing }
}

test('30 pure Node construction, solver and export rounds match the uncached evaluator and desktop entry', async t => {
  const geometry = createGeometryManager()
  t.after(() => geometry.close())
  const parser = new DxfParser()
  const solver = createSolverScheduler()
  t.after(() => solver.close())
  const expectedSolution = calculateChain(chain)
  let generation
  const records = []
  const rounds = []
  for (let round = 1; round <= 30; round++) {
    const model = createMountingPlate('rev-' + round)
    model.holes[1].x.nominalQ += 1_000 * (round - 1)
    const input = { model, deferDrawing: true }
    const start = performance.now()
    const result = await geometry.execute(input, task('build-' + round))
    const { report, metrics } = result
    assert.equal(report.error, undefined)
    assert.deepEqual(await solver.run(extremes), expectedSolution)
    const projection = await geometry.execute({ model, measured: report.measured, references: report.references,
      drawingOnly: true }, task('draw-' + round))
    const drawing = { ...projection.report }
    delete drawing.execution
    const renderedDrawing = drawingFixture(drawing)
    const artifacts = exportHeadlessDrawing(renderedDrawing)
    const elapsedMs = Number((performance.now() - start).toFixed(1))
    const released = await geometry.release(projectId, model.revision)
    assert.equal(released.metrics.cachedShapeHandles, 0)
    assert.equal(metrics.cachedShapeHandles, 2)
    assert.equal(metrics.cachedShapeBuilds, round)
    assert.equal(metrics.wasmInitializations, 1)
    assert.ok(metrics.wasmHeapBytes > 0)
    generation ??= metrics.threadId
    assert.equal(metrics.threadId, generation)
    records.push({ round, elapsedMs, threadId: metrics.threadId, wasmInitializations: metrics.wasmInitializations,
      rssMiB: mib(released.metrics.rss), wasmMiB: mib(released.metrics.wasmHeapBytes),
      workerJsHeapMiB: mib(released.metrics.heapUsed), mainJsHeapMiB: mib(process.memoryUsage().heapUsed),
      heldNativeShapes: metrics.cachedShapeHandles, releasedNativeShapes: released.metrics.cachedShapeHandles })

    rounds.push({ model, report, drawing, renderedDrawing, artifacts })
  }
  for (const row of records) t.diagnostic(JSON.stringify(row))

  // Evaluate every revision against the desktop entry and the uncached evaluator.
  const native = observeNativeHandles(await loadKernel({ print: () => {} }))
  for (const { model, report, drawing, renderedDrawing, artifacts } of rounds) {
    const before = native.stats()
    const direct = evaluate(native.oc, model, undefined, 'reference')
    const after = native.stats()
    assert.deepEqual(after.live, [])
    assert.ok(after.created > before.created)
    assert.equal(after.created - before.created, after.deleted - before.deleted)
    t.diagnostic(JSON.stringify({ revision: model.revision,
      nativeCreated: after.created - before.created, nativeDeleted: after.deleted - before.deleted,
      nativeRemaining: after.live.length }))
    assert.deepEqual(numericReport({ ...report, drawing }), numericReport(direct))
    const desktop = await runMountingPlate(model, { deferDrawing: true })
    const desktopDrawing = await runMountingPlateDrawing(desktop)
    delete desktopDrawing.execution
    const desktopFixture = drawingFixture(desktopDrawing)
    assert.deepEqual(numericReport({ ...report, drawing }), numericReport({ ...desktop, drawing: desktopDrawing }))
    assert.equal(artifacts.svg, renderDrawingSvg(desktopFixture))
    assert.deepEqual(artifacts.dxf.bytes, buildDxfDocument(desktopFixture, 'r12').bytes)
    assert.equal(validateDrawingSvgMarkup(artifacts.svg, renderedDrawing).ok, true)
    const dxf = parser.parseSync(new TextDecoder('gbk').decode(artifacts.dxf.bytes))
    assert.equal(dxf.entities.filter(entity => entity.type === 'CIRCLE').length, 2)
  }
})

test('native build, meshing and STEP failures dispose owned wrappers', async () => {
  const kernel = await loadKernel({ print: () => {} })
  const native = observeNativeHandles(kernel)
  const model = createMountingPlate()
  const fault = (target, method, behavior, message) => {
    const original = target[method]
    target[method] = behavior
    try {
      const failed = evaluate(native.oc, model)
      assert.equal(failed.status, 'executionFailed')
      assert.match(failed.error.message, message)
      assert.deepEqual(native.stats().live, [])
    } finally {
      target[method] = original
    }
  }
  const cut = kernel.BRepAlgoAPI_Cut.prototype
  const cutIsDone = cut.IsDone
  let cuts = 0
  fault(cut, 'IsDone', function () { return ++cuts < 2 && cutIsDone.call(this) }, /OCCT cut failed/)
  fault(kernel.BRepMesh_IncrementalMesh.prototype, 'IsDone', () => false, /OCCT meshing failed/)
  fault(kernel.FS, 'readFile', () => { throw Error('fixture read failure') }, /fixture read failure/)
  assert.ok(!kernel.FS.readdir('/').includes('plate.step'))
  assert.equal(evaluate(native.oc, model).status, 'pass')
  const { created, deleted, live } = native.stats()
  assert.equal(created, deleted)
  assert.deepEqual(live, [])
})

test('shape cache hits, isolates projects and replaces changed inputs at the same revision', async t => {
  const geometry = createGeometryManager()
  t.after(() => geometry.close())
  const model = createMountingPlate('shared-rev')
  const first = await geometry.execute({ model }, task('first'))
  const hit = await geometry.execute({ model }, task('hit'))
  assert.equal(first.metrics.cachedShapeBuilds, hit.metrics.cachedShapeBuilds)
  assert.deepEqual(numericReport(first.report), numericReport(hit.report))
  model.holes[1].x.nominalQ += 10_000
  const changed = await geometry.execute({ model }, task('changed'))
  assert.equal(changed.metrics.cachedShapeHandles, 2)
  assert.equal(changed.metrics.cachedShapeBuilds, 2)
  assert.notDeepEqual(changed.report.checks, first.report.checks)
  const other = await geometry.execute({ model }, { ...task('other'), projectId: 'other' })
  assert.equal(other.metrics.cachedShapeHandles, 4)
  assert.equal((await geometry.release(projectId)).metrics.cachedShapeHandles, 2)
  assert.equal((await geometry.release('other')).metrics.cachedShapeHandles, 0)
})

test('cache eviction, replacement and clear call each native delete exactly once', () => {
  const cache = new ShapeCache(1)
  const deleted = []
  const build = id => () => ({
    plate: { delete: () => deleted.push(id + '-plate') },
    cover: { delete: () => deleted.push(id + '-cover') },
  })
  const first = cache.acquire('p', 'a', 'one', build('one'))
  assert.equal(cache.acquire('p', 'a', 'one', build('unused')), first)
  cache.acquire('p', 'a', 'two', build('two'))
  cache.acquire('p', 'b', 'three', build('three'))
  cache.clear()
  cache.clear()
  assert.equal(cache.handles, 0)
  assert.deepEqual(deleted, ['one-cover', 'one-plate', 'two-cover', 'two-plate', 'three-cover', 'three-plate'])
})

test('explicit cache release attempts all owned deletes even when a disposer fails', () => {
  const cache = new ShapeCache()
  const deleted = []
  const build = id => () => ({
    plate: { delete: () => deleted.push(id + '-plate') },
    cover: { delete: () => {
      deleted.push(id + '-cover')
      if (id === 'one') throw new Error('fixture disposal failure')
    } },
  })
  cache.acquire('p', 'a', 'one', build('one'))
  cache.acquire('p', 'b', 'two', build('two'))
  assert.throws(() => cache.release('p'), error => error instanceof AggregateError &&
    error.errors.length === 1 && error.errors[0].message === 'fixture disposal failure')
  assert.deepEqual(deleted, ['one-cover', 'one-plate', 'two-cover', 'two-plate'])
  assert.equal(cache.handles, 0)
})

test('geometry survives timeout, active cancellation and the memory watermark', async t => {
  const geometry = createGeometryManager()
  t.after(() => geometry.close())
  const input = { model: createMountingPlate() }
  const first = await geometry.execute(input, task('initial'))
  await assert.rejects(geometry.execute(input, { ...task('retry'), timeoutMs: 1 }), /timed out/)
  const second = await geometry.execute(input, task('retry', 2))
  assert.notEqual(second.metrics.threadId, first.metrics.threadId)
  assert.equal(second.metrics.wasmInitializations, 1)
  const abort = new AbortController()
  const cancelled = geometry.execute(input, { ...task('retry', 3), signal: abort.signal })
  abort.abort(new Error('geometry cancelled'))
  await assert.rejects(cancelled, /geometry cancelled/)
  const third = await geometry.execute(input, task('retry', 4))
  assert.notEqual(third.metrics.threadId, second.metrics.threadId)
  assert.equal(third.report.execution.attempt, 4)

  const limited = createGeometryManager(undefined, { memoryLimitBytes: 1 })
  t.after(() => limited.close())
  const a = await limited.execute(input, task('watermark-a'))
  const b = await limited.execute(input, task('watermark-b'))
  assert.equal(a.metrics.cachedShapeHandles, 0)
  assert.equal(b.metrics.cachedShapeHandles, 0)
  assert.notEqual(a.metrics.threadId, b.metrics.threadId)
})

test('queue fences stale replies and recovers after crash; queued abort preserves the active job', async t => {
  const queue = new WorkerQueue(new URL('./fixtures/m0-backend/controlledWorker.mjs', import.meta.url))
  t.after(() => queue.close())
  const first = await queue.run({ kind: 'first' })
  const second = await queue.run({ kind: 'second' })
  assert.deepEqual(second, { threadId: first.threadId, kind: 'second' })
  const crash = queue.run({ kind: 'crash' })
  const resumed = queue.run({ kind: 'resumed' })
  const abort = new AbortController()
  const cancelled = queue.run({ kind: 'queued' }, { signal: abort.signal })
  abort.abort(new Error('queued cancelled'))
  await assert.rejects(cancelled, /queued cancelled/)
  await assert.rejects(crash, /fixture crash/)
  assert.notEqual((await resumed).threadId, first.threadId)
})

test('solver matches desktop integer extremes and seeded Monte Carlo, then restarts', async t => {
  const solver = createSolverScheduler()
  t.after(() => solver.close())
  const expected = calculateChain(chain)
  assert.deepEqual(await solver.run(extremes), expected)
  for (const distribution of ['uniform', 'normal']) {
    const options = { seed: 42, samples: 20_000, distribution }
    assert.deepEqual(await solver.run({ kind: 'monteCarlo1d', chain, options }), monteCarloOf(chain, expected.nominalQ, options))
  }
  await assert.rejects(solver.run({ kind: 'monteCarlo1d', chain, options: {
    seed: 1, samples: 2_000_000, distribution: 'normal',
  } }, { timeoutMs: 1 }), /timed out/)
  assert.deepEqual(await solver.run(extremes), expected)
  const abort = new AbortController()
  const cancelled = solver.run(extremes, { signal: abort.signal })
  abort.abort(new Error('solver cancelled'))
  await assert.rejects(cancelled, /solver cancelled/)
  assert.deepEqual(await solver.run(extremes), expected)
  for (const kind of ['se3', 'multivariate']) {
    assert.deepEqual(await solver.run({ kind, inputs: {} }), { kind, status: 'unsupported' })
  }
})
