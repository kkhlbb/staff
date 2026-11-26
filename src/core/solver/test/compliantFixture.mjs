import { materialPresets } from '../materials.ts'
import { axis, face } from './fixture.ts'
import { gdtFixture } from './gdtFixture.mjs'

export function compliantFixture() {
  const input = gdtFixture()
  const { assembly } = input
  for (const [id, x, y] of [['left', 0, -40_000], ['right', 80_000, -40_000],
    ['rear-left', 0, 40_000], ['rear-right', 80_000, 40_000]]) {
    assembly.features.push(axis('clamp-' + id, 'cover', [x, y, 20_000], [0, 0, 1], 2000))
  }
  assembly.features.push(face('beam-tip', 'spacer', [120_000, 0, 120_000], [0, 0, 1]))
  assembly.gdt.find(control => control.id === 'parallelism').featureId = 'beam-tip'
  assembly.measurements.find(measurement => measurement.id === 'angle').featureIds[1] = 'beam-tip'
  assembly.gdt.push({ id: 'cover-height-zone', kind: 'position', featureId: 'cover-top',
    toleranceQ: 1000, zoneShape: 'planar', datumIds: ['A'] })
  assembly.physics = {
    materials: [['plate', 'al-6061'], ['spacer', 'steel-45'], ['cover', 'sus304']].map(([partId, presetId]) =>
      ({ ...materialPresets[presetId], partId, presetId, deltaTemperatureK: 0 })),
    compliantModels: [
      { id: 'preload', kind: 'axial-compression', partId: 'spacer', featureId: 'spacer-top',
        preloadN: 6500, preloadTolN: 1900, effectiveAreaMm2: 25, lengthMm: 12, springbackRatio: 0.15 },
      { id: 'clamp', kind: 'plate-clamping', partId: 'cover', surfaceFeatureId: 'cover-top', thicknessQ: 20_000,
        initialWarpPeakQ: 900, warpTolQ: 300, clampForceN: 95,
        clampFeatureIds: ['clamp-left', 'clamp-right', 'clamp-rear-left', 'clamp-rear-right'] },
      { id: 'beam', kind: 'beam-bending', partId: 'spacer', loadFeatureId: 'beam-tip', supportKind: 'cantilever',
        spanMm: 12, momentOfInertiaMm4: 18, forceN: 115, forceTolN: 40, direction: [0, 0, 1] },
      { id: 'heat', kind: 'thermal-expansion', partIds: ['spacer', 'cover'], referenceFeatureId: 'plate-top',
        deltaTemperatureK: 85, deltaTempTolK: 20, bimetallicCoupling: true },
    ],
  }
  return input
}
