import type { AssemblyModelV1, AssemblyPart, PersistentFeature } from '../../../project-file/assembly3d.ts'
import type { SimulationInput } from '../solverScheduler.mjs'

export const pose = (x = 0, y = 0, z = 0): AssemblyPart['nominalTransform'] => [
  [1, 0, 0, x], [0, 1, 0, y], [0, 0, 1, z], [0, 0, 0, 1],
]
export const part = (id: string, nominalTransform = pose()): AssemblyPart => ({
  id, nominalTransform, kind: 'imported-step', attachmentId: 'step-a', solidIndex: 0,
  displayName: id, color: '#808080',
})
type Vector = [number, number, number]
export const face = (id: string, partId: string, originQ: Vector, normal: Vector): PersistentFeature =>
  ({ id, partId, kind: 'face', signature: id, surface: 'plane', originQ, normal })
export const point = (id: string, partId: string, positionQ: Vector): PersistentFeature =>
  ({ id, partId, kind: 'point', signature: id, positionQ })
export const axis = (id: string, partId: string, originQ: Vector, direction: Vector, radiusQ: number): PersistentFeature =>
  ({ id, partId, kind: 'cylindrical-hole-axis', signature: id, originQ, axis: direction, radiusQ })
export const model = (parts: AssemblyPart[], features: PersistentFeature[]): AssemblyModelV1 =>
  ({ schemaVersion: 1, units: 'mm', parts, features, mates: [], measurements: [], datums: [], gdt: [] })

export function fixture(): SimulationInput {
  const assembly = model([
    part('plate'), part('spacer', pose(0.1, -0.2, 0.4)),
    part('cover', pose(0.15, 0.3, 12.6)), part('pin', pose(8.2, -0.5, 0)),
  ], [
    face('plate-top', 'plate', [0, 0, 0], [0, 0, 1]),
    face('spacer-bottom', 'spacer', [0, 0, 0], [0, 0, -1]),
    face('spacer-top', 'spacer', [0, 0, 120000], [0, 0, 1]),
    face('cover-bottom', 'cover', [0, 0, 0], [0, 0, -1]),
    face('cover-top', 'cover', [0, 0, 20000], [0, 0, 1]),
    axis('plate-bore', 'plate', [0, 0, 0], [0, 0, 1], 51000),
    axis('spacer-axis', 'spacer', [0, 0, 0], [0, 0, 1], 50000),
    axis('spacer-gauge', 'spacer', [0, 0, 0], [0, 0, 1], 49000),
    axis('cover-bore', 'cover', [0, 0, 0], [0, 0, 1], 51000),
    axis('plate-pin-hole', 'plate', [80000, 0, 0], [0, 0, 1], 21000),
    axis('pin-axis', 'pin', [0, 0, 0], [0, 0, 1], 20000),
  ])
  assembly.mates = [
    { id: 'seat', kind: 'face-contact', featureIds: ['plate-top', 'spacer-bottom'], constrainedDofs: ['tz', 'rx', 'ry'] },
    { id: 'pilot', kind: 'coaxial', featureIds: ['plate-bore', 'spacer-axis'], constrainedDofs: ['tx', 'ty', 'rx', 'ry'] },
    { id: 'cover-seat', kind: 'face-contact', featureIds: ['spacer-top', 'cover-bottom'], constrainedDofs: ['tz', 'rx', 'ry'] },
    { id: 'cover-pilot', kind: 'coaxial', featureIds: ['spacer-axis', 'cover-bore'], constrainedDofs: ['tx', 'ty', 'rx', 'ry'] },
    { id: 'pin-float', kind: 'floating-clearance', featureIds: ['plate-pin-hole', 'pin-axis'], minQ: 0, maxQ: 1000,
      constrainedDofs: ['rx', 'ry'] },
  ]
  assembly.measurements = [
    { id: 'gap', kind: 'gap', featureIds: ['plate-top', 'cover-top'] },
    { id: 'flush', kind: 'flush', featureIds: ['spacer-top', 'cover-bottom'] },
    { id: 'center', kind: 'center-distance', featureIds: ['plate-bore', 'pin-axis'] },
    { id: 'axis', kind: 'coaxiality', featureIds: ['plate-bore', 'spacer-gauge'] },
    { id: 'angle', kind: 'angle', featureIds: ['plate-top', 'spacer-top'] },
  ]
  return {
    assembly, seed: 319705, samples: 50_000, bins: 35,
    limits: { gap: { lower: 13.92, upper: 14.08 }, flush: { lower: 0, upper: 0.08 },
      center: { lower: 7.95, upper: 8.2 }, axis: { lower: 0, upper: 0.08 }, angle: { lower: 0, upper: 0.02 } },
    parameters: [
      { id: 'cover-height', partId: 'cover', featureId: 'cover-top', dof: 'tz', sigmaQ: 250, lowerQ: -750, upperQ: 750 },
      { id: 'plate-flatness', partId: 'plate', featureId: 'plate-top', dof: 'tz', sigmaQ: 100, lowerQ: -300, upperQ: 300 },
      { id: 'seat-offset', partId: 'cover', featureId: 'cover-bottom', dof: 'tz', sigmaQ: 120, lowerQ: -360, upperQ: 360 },
      { id: 'spacer-tilt', partId: 'spacer', featureId: 'spacer-top', dof: 'rx', sigmaRad: 0.004, lowerRad: -0.012, upperRad: 0.012 },
      { id: 'spacer-height', partId: 'spacer', featureId: 'spacer-top', dof: 'tz', sigmaQ: 140, lowerQ: -420, upperQ: 420 },
      { id: 'pilot-x', partId: 'spacer', featureId: 'spacer-gauge', dof: 'tx', sigmaQ: 180, lowerQ: -540, upperQ: 540 },
      { id: 'pilot-y', partId: 'spacer', featureId: 'spacer-gauge', dof: 'ty', sigmaQ: 90, lowerQ: -270, upperQ: 270 },
      { id: 'pin-x', partId: 'pin', featureId: 'pin-axis', dof: 'tx', sigmaQ: 135, lowerQ: -405, upperQ: 405 },
      { id: 'pin-y', partId: 'pin', featureId: 'pin-axis', dof: 'ty', sigmaQ: 170, lowerQ: -510, upperQ: 510 },
    ],
  }
}
