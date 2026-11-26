import { compliantFixture } from './compliantFixture.mjs'

export function advancedGdtFixture() {
  const input = compliantFixture()
  const { assembly } = input
  assembly.gdt = assembly.gdt.filter(control => !['cover-height-zone', 'bidirectional'].includes(control.id))
  assembly.gdt.push(
    { id: 'profile', kind: 'profile-surface', featureId: 'cover-top', toleranceQ: 1200, datumIds: ['A'],
      unequalProfileOuterFraction: 0.75 },
    { id: 'circle', kind: 'circular-runout', featureId: 'spacer-gauge', toleranceQ: 700, datumIds: ['axis'] },
    { id: 'total', kind: 'total-runout', featureId: 'spacer-gauge', toleranceQ: 750, datumIds: ['axis'] },
    { id: 'cylinder', kind: 'cylindricity', featureId: 'spacer-gauge', toleranceQ: 500, datumIds: [] },
  )
  for (const featureId of ['cover-bore', 'cover-second-bore']) {
    assembly.gdt.push({
      id: 'composite-' + featureId, kind: 'composite-position', featureId, toleranceQ: 1100,
      datumIds: ['A', 'B', 'C'], datumModifiers: ['RFS', 'MMC'], patternGroupId: 'cover',
      featureSizeToleranceQ: { lowerQ: 0, upperQ: 500 },
      lowerSegment: { toleranceQ: 420, datumIds: ['A'], modifier: 'MMC' },
    })
  }
  input.gdtDistribution = 'normal'
  return input
}
