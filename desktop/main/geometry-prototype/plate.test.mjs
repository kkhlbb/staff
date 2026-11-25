import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { buildA01, loadKernel, measureA05, readA01 } from './plate.mjs'

const linearToleranceMm = 1e-6
const volumeToleranceMm3 = 1e-3
const directionTolerance = 1e-9
const plateVolumeMm3 = 32000 - 400 * Math.PI

function near(actual, expected, tolerance = linearToleranceMm) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`)
}

function nearVector(actual, expected, tolerance) {
  assert.equal(actual.length, expected.length)
  actual.forEach((value, index) => near(value, expected[index], tolerance))
}

function checkPlate(measured) {
  assert.equal(measured.valid, true)
  assert.equal(measured.solids, 1)
  nearVector(measured.bounds.min, [0, 0, 0])
  nearVector(measured.bounds.max, [80, 50, 8])
  near(measured.volumeMm3, plateVolumeMm3, volumeToleranceMm3)
  assert.equal(measured.cylinders.length, 2)
  measured.cylinders.forEach((hole, index) => {
    near(hole.origin[0], [20, 60][index])
    near(hole.origin[1], 25)
    nearVector([hole.direction[0], hole.direction[1], Math.abs(hole.direction[2])], [0, 0, 1], directionTolerance)
    near(hole.radius, 5)
    near(hole.bounds.min[2], 0)
    near(hole.bounds.max[2], 8)
  })
}

let oc, a01
before(async () => { oc = await loadKernel() })

test('A01 measures one valid plate with two full-depth cylindrical holes', () => {
  a01 = buildA01(oc)
  nearVector(a01.blank.bounds.min, [0, 0, 0])
  nearVector(a01.blank.bounds.max, [80, 50, 8])
  near(a01.blank.volumeMm3, 32000, volumeToleranceMm3)
  checkPlate(a01.measured)
  assert.match(a01.step.toString('ascii'), /SI_UNIT\(\.MILLI\.,\.METRE\.\)/)
})

test('A01 exported STEP transfers into a fresh WASM instance and preserves geometry', async () => {
  const step = a01?.step ?? buildA01(oc).step
  checkPlate(readA01(await loadKernel(), step))
})

for (const degrees of [0, 90]) {
  test(`A05 and A06 measure signed face gaps and common volume at world X rotation ${degrees}°`, () => {
    const result = measureA05(oc, degrees)
    nearVector(result.normal, degrees === 0 ? [0, 0, 1] : [0, -1, 0], directionTolerance)
    for (const [key, gap, relation, commonVolume] of [
      ['nominal', 2, 'gap', 0],
      ['min', 1.7, 'gap', 0],
      ['max', 2.3, 'gap', 0],
      ['contact', 0, 'contact', 0],
      ['overlap', -0.1, 'overlap', plateVolumeMm3 / 80],
    ]) {
      near(result[key].signedGapMm, gap)
      near(result[key].overlapDepthMm, Math.max(0, -gap))
      near(result[key].commonVolumeMm3, commonVolume, volumeToleranceMm3)
      assert.equal(result[key].relation, relation)
    }
  })
}
