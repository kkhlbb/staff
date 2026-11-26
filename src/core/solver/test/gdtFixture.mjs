import { axis, fixture } from './fixture.ts'

export function gdtFixture() {
  const input = fixture()
  const { assembly } = input
  assembly.features.push(
    axis('cover-second-bore', 'cover', [50000, 0, 0], [0, 0, 1], 12000),
  )
  assembly.datums = [
    { id: 'A', label: 'A', featureId: 'plate-top' },
    { id: 'B', label: 'B', featureId: 'plate-bore', sizeToleranceQ: { lowerQ: 0, upperQ: 1000 } },
    { id: 'C', label: 'C', featureId: 'plate-pin-hole' },
    { id: 'axis', label: 'Axis', featureId: 'plate-bore', sizeToleranceQ: { lowerQ: -150, upperQ: 350 } },
  ]
  const position = { kind: 'position', toleranceQ: 550, datumIds: ['A', 'B', 'C'],
    datumModifiers: ['RFS', 'MMC', 'RFS'], featureSizeToleranceQ: { lowerQ: -200, upperQ: 800 } }
  assembly.gdt = [
    { ...position, id: 'position', featureId: 'cover-bore' },
    { ...position, id: 'bidirectional', featureId: 'cover-second-bore', zoneShape: 'bidirectional' },
    { id: 'perpendicularity', featureId: 'spacer-axis', kind: 'perpendicularity', toleranceQ: 500, datumIds: ['A'] },
    { id: 'parallelism', featureId: 'spacer-top', kind: 'parallelism', toleranceQ: 600, datumIds: ['A'] },
    { id: 'flatness', featureId: 'cover-top', kind: 'flatness', toleranceQ: 400, datumIds: [] },
    { id: 'coaxiality', featureId: 'spacer-gauge', kind: 'coaxiality', toleranceQ: 700, datumIds: ['axis'],
      datumModifiers: ['MMC'], featureSizeToleranceQ: { lowerQ: -150, upperQ: 550 } },
  ]
  input.gdtFeatureGeometry = Object.fromEntries(assembly.features.map(feature => [feature.id, { spanQ: 120000 }]))
  input.gdtFeatureGeometry['spacer-gauge'].external = true
  return input
}
