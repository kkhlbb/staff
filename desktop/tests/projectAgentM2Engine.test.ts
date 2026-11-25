import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { loadKernel, readA01 } from '../main/geometry-prototype/plate.mjs'
import { runMountingPlate } from '../main/project-agent/m2/engine.mjs'
import type { EngineReport, GeometryReport } from '../main/project-agent/m2/engine.mjs'
import { addHole, createMountingPlate, deleteHole, rebindHole } from '../main/project-agent/m2/model.mjs'

function geometry(report: EngineReport): GeometryReport {
  if ('error' in report) throw new Error(report.error.message)
  return report
}

function check(report: EngineReport, id: string) {
  const result = report.checks.find(item => item.id === id)
  if (!result) throw new Error('Missing check ' + id)
  return result
}

const rotatedFrame = () => ({
  ...createMountingPlate().frame,
  xAxis: [1, 0, 0] as [number, number, number],
  yAxis: [0, 0, 1] as [number, number, number],
  zAxis: [0, -1, 0] as [number, number, number],
})

describe('M2 mounting-plate engine', () => {
  it('A01 replays the serialized features and measures the BRep and freshly imported STEP', async () => {
    const model = createMountingPlate()
    const replay: typeof model = JSON.parse(JSON.stringify(model))
    const result = geometry(await runMountingPlate(replay))
    const bytes = await readFile(new URL('./fixtures/agent-refactor/mounting-plate-taskbook.pdf', import.meta.url))
    expect(result.source.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    const imported = readA01(await loadKernel(), result.plateStep)
    for (const measured of [result.measured, imported]) {
      expect(measured).toMatchObject({ valid: true, solids: 1, bounds: { min: [0, 0, 0], max: [80, 50, 8] } })
      expect(measured.volumeMm3).toBeCloseTo(32000 - 400 * Math.PI, 8)
      expect(measured.cylinders.map(c => [...c.origin.slice(0, 2), c.radius * 2, c.bounds.min[2], c.bounds.max[2]]))
        .toEqual([[20, 25, 10, 0, 8], [60, 25, 10, 0, 8]])
      expect(measured.cylinders.map(c => c.direction)).toEqual([[0, 0, 1], [0, 0, 1]])
    }
    expect(result.model).toEqual(model)
    expect(result.model.holes.map(hole => hole.id)).toEqual(['hole-1', 'hole-2'])
    expect(Object.values(result.references).every(reference => reference.resolved)).toBe(true)
    expect(result.mesh.plate.objects).toContainEqual(expect.objectContaining({
      role: 'hole.right.axis', featureId: 'hole-2', triangleCount: expect.any(Number),
    }))
    expect(result.mesh.cover.objects).toContainEqual(expect.objectContaining({ role: 'cover.bottomFace' }))
    for (const mesh of Object.values(result.mesh)) {
      expect(mesh.objects.reduce((sum, object) => sum + object.triangleCount, 0)).toBe(mesh.triangles.length)
      expect(mesh.triangles.length).toBeGreaterThan(0)
      expect(mesh.triangles.flat().every(index => index >= 0 && index < mesh.positions.length)).toBe(true)
    }
  })

  it('binds measured orthographic dimensions and vectors to the same revision and persistent features', async () => {
    const result = geometry(await runMountingPlate(createMountingPlate('revision-9')))
    const { drawing } = result
    expect(drawing).toMatchObject({ revision: 'revision-9', unit: 'mm', errors: [] })
    expect(drawing.views.map(view => [view.id, view.size])).toEqual([
      ['front', [80, 8]], ['top', [80, 50]], ['side', [50, 8]],
    ])
    expect(drawing.views.find(view => view.id === 'top')?.geometry.slice(1)).toEqual([
      { kind: 'circle', center: [20, 25], radius: 5 }, { kind: 'circle', center: [60, 25], radius: 5 },
    ])
    expect(drawing.views.find(view => view.id === 'front')?.geometry[3]).toEqual({
      kind: 'line', style: 'hidden', points: [[55, 0], [55, 8]],
    })
    expect(drawing.annotations.map(annotation => annotation.valueMm)).toEqual([80, 50, 8, 10, 20, 25, 10, 60, 25])
    for (const annotation of drawing.annotations) {
      expect(result.references[annotation.reference.role]).toMatchObject({
        resolved: true, featureId: annotation.reference.featureId,
      })
      expect(annotation.witnesses).toHaveLength(2)
    }
  })

  it('reports projection failures, annotation conflicts, and invalid geometry structurally', async () => {
    const model = createMountingPlate()
    const projection = geometry(await runMountingPlate(model, { drawing: { convention: 'unsupported' } }))
    expect(projection.status).toBe('executionFailed')
    expect(projection.drawing.errors).toEqual([expect.objectContaining({ code: 'projectionFailed' })])
    const conflict = geometry(await runMountingPlate(model, { drawing: { lanes: { 'hole.right.x': 0 } } }))
    expect(conflict.status).toBe('needsClarification')
    expect(conflict.drawing.errors).toEqual([expect.objectContaining({
      code: 'annotationConflict', annotationIds: ['hole.left.x', 'hole.right.x'],
    })])
    expect(conflict.drawing.annotations.some(annotation => annotation.id === 'hole.right.x')).toBe(false)
    model.holes[1].x.nominalQ = 800000
    const invalid = await runMountingPlate(model)
    expect(invalid).toMatchObject({ status: 'executionFailed', error: { code: 'geometryFailed' } })
    expect(invalid.checks.every(item => item.status === 'executionFailed')).toBe(true)
  })

  it.each([
    [60, 15, [14.75, 15.25], 'pass', 0],
    [61, 14, [13.75, 14.25], 'pass', 0],
    [62, 13, [12.75, 13.25], 'fail', 0.25],
  ] as const)('A02–A04 finds the exact edge-margin extremes at X=%d', async (x, nominal, interval, status, deficit) => {
    const model = createMountingPlate()
    model.holes[1].x.nominalQ = x * 10000
    const result = geometry(await runMountingPlate(model))
    const margin = check(result, 'MP-03')
    expect(margin).toMatchObject({
      status, page: 1, nominalMm: nominal, intervalMm: interval, targetMm: 13, deficitMm: deficit,
      targets: [{ role: 'hole.right.axis', featureId: 'hole-2' }, { role: 'plate.rightFace', featureId: 'plate-1' }],
      variables: [model.holes[1].x, model.holes[1].y, model.holes[1].diameter],
      extremesMm: {
        min: { 'hole-2.x': x + 0.2, 'hole-2.y': [24.8, 25.2], 'hole-2.diameter': 10.1 },
        max: { 'hole-2.x': x - 0.2, 'hole-2.y': [24.8, 25.2], 'hole-2.diameter': 9.9 },
      },
    })
    expect(result.status).toBe(status)
    expect(result.measured.cylinders.map(cylinder => cylinder.origin[0])).toEqual([20, x])
    expect(result.drawing.annotations.find(item => item.id === 'hole.right.x')?.valueMm).toBe(x)
    if (x === 62) {
      model.holes[1].x.nominalQ = 610000
      expect(check(await runMountingPlate(model), 'MP-03').status).toBe('pass')
    }
  })

  it('A05 transforms the assembly and normal, preserving the measured clearance and variable identities', async () => {
    const model = createMountingPlate()
    const base = geometry(await runMountingPlate(model))
    const rotated = geometry(await runMountingPlate({ ...model, frame: rotatedFrame() }))
    for (const result of [base, rotated]) {
      expect(check(result, 'MP-05')).toMatchObject({
        status: 'pass', page: 2, nominalMm: 2, intervalMm: [1.7, 2.3], targetMm: 1.5,
        variables: [model.plate.thickness, model.cover.bottom],
        evidence: { signedGapMm: 2, commonVolumeMm3: 0 },
      })
    }
    expect(check(rotated, 'MP-05').frame?.zAxis).toEqual([0, -1, 0])
    expect(rotated.placement.worldPlateBounds).toEqual({ min: [0, -8, 0], max: [80, 0, 50] })
    expect(rotated.drawing).toEqual(base.drawing)
    model.constraints.angularVariationDegrees = 1
    const outside = await runMountingPlate(model)
    expect(outside.status).toBe('uncovered')
    expect(check(outside, 'MP-05')).toMatchObject({ status: 'uncovered', angularVariationDegrees: 1 })
  })

  it.each([
    [8, 'contact', 0, 0, 'pass'],
    [7.9, 'interference', 0.1, 0, 'fail'],
    [10, 'clearance', 0, 2, 'pass'],
  ] as const)('A06 distinguishes the fixed pose at cover bottom %d', async (bottom, relation, overlap, clearance, status) => {
    for (const frame of [createMountingPlate().frame, rotatedFrame()]) {
      const model = createMountingPlate()
      model.frame = frame
      model.plate.thickness.toleranceQ = 0
      model.cover.bottom.nominalQ = bottom * 10000
      model.cover.bottom.toleranceQ = 0
      const result = check(await runMountingPlate(model), 'fixedPose')
      expect(result).toMatchObject({ status, relation, overlapDepthMm: overlap, clearanceMm: clearance, toleranceMm: 1e-7,
        objectIds: ['plate-1', 'cover-1'] })
      expect(result.evidence?.commonVolumeMm3).toBeCloseTo(overlap * (4000 - 50 * Math.PI), 8)
    }
  })

  it('A12 blocks old references even after an identical replacement and recomputes only after explicit binding', async () => {
    const model = createMountingPlate()
    const old = model.holes[1]
    const removed = deleteHole(model, old.id)
    const replacement = addHole(removed, old)
    for (const candidate of [removed, replacement]) {
      const result = geometry(await runMountingPlate(candidate))
      expect(result.status).toBe('needsClarification')
      expect(result.references['hole.right.axis']).toEqual({ role: 'hole.right.axis', featureId: 'hole-2', resolved: false })
      expect(result.invalidations).toEqual([{
        role: 'hole.right.axis', featureId: 'hole-2', clauses: ['MP-02', 'MP-03'],
        annotations: ['hole.right.diameter', 'hole.right.x', 'hole.right.y'],
      }])
      expect(check(result, 'MP-03').status).toBe('needsClarification')
      expect(result.drawing.errors).toHaveLength(3)
      expect(result.drawing.errors.every(error => error.code === 'missingReference')).toBe(true)
    }
    expect(() => rebindHole(replacement, 'hole.right.axis', old.id)).toThrow()
    const rebound = geometry(await runMountingPlate(rebindHole(replacement, 'hole.right.axis', 'hole-3')))
    expect(rebound.invalidations).toEqual([])
    expect(rebound.status).toBe('pass')
    expect(rebound.references['hole.right.axis']).toMatchObject({ featureId: 'hole-3', resolved: true })
    expect(check(rebound, 'MP-03')).toMatchObject({ intervalMm: [14.75, 15.25], status: 'pass' })
    expect(rebound.drawing.annotations.find(item => item.id === 'hole.right.x')?.reference.featureId).toBe('hole-3')
  })

  it('terminates an aborted or timed-out worker and can restart the same job with a new attempt', async () => {
    const model = createMountingPlate()
    const controller = new AbortController()
    const pending = runMountingPlate(model, { jobId: 'restart', signal: controller.signal })
    controller.abort(new Error('stop current attempt'))
    await expect(pending).rejects.toThrow('stop current attempt')
    await expect(runMountingPlate(model, { jobId: 'restart', attempt: 2, timeoutMs: 1 })).rejects.toThrow('timed out')
    const result = geometry(await runMountingPlate(model, { jobId: 'restart', attempt: 3 }))
    expect(result.execution).toMatchObject({ jobId: 'restart', attempt: 3 })
    expect(result.mesh.plate.frameId).toBe('restart/3/' + result.execution.inputFingerprint)
  })
})
