import { z } from 'zod'

const id = z.string().min(1).max(200)
const q = z.int()
const number = z.number()
const vector = z.tuple([number, number, number])
const qVector = z.tuple([q, q, q])
const row = z.tuple([number, number, number, number])
// Row-major homogeneous matrix. Translation is expressed in mm.
const transform = z.tuple([row, row, row, z.tuple([z.literal(0), z.literal(0), z.literal(0), z.literal(1)])])
const part = {
  id,
  displayName: id,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  nominalTransform: transform,
}
const positiveQ = q.positive()
const baseParameters = z.discriminatedUnion('baseKind', [
  z.strictObject({ baseKind: z.literal('plate'), sizeQ: z.strictObject({ lengthQ: positiveQ, widthQ: positiveQ, thicknessQ: positiveQ }) }),
  z.strictObject({ baseKind: z.literal('cylinder-spacer'), sizeQ: z.strictObject({ innerDiameterQ: positiveQ, outerDiameterQ: positiveQ, lengthQ: positiveQ }) }),
  z.strictObject({ baseKind: z.literal('l-bracket'), sizeQ: z.strictObject({ lengthQ: positiveQ, widthQ: positiveQ, heightQ: positiveQ, thicknessQ: positiveQ }) }),
  z.strictObject({ baseKind: z.literal('thin-shell'), sizeQ: z.strictObject({ lengthQ: positiveQ, widthQ: positiveQ, heightQ: positiveQ, wallQ: positiveQ }) }),
])
const modifierId = { id }
const modifiers = z.array(z.discriminatedUnion('kind', [
  z.strictObject({ ...modifierId, kind: z.literal('through-hole'), originQ: qVector, axis: vector, diameterQ: positiveQ }),
  z.strictObject({ ...modifierId, kind: z.literal('blind-hole'), originQ: qVector, axis: vector, diameterQ: positiveQ, depthQ: positiveQ }),
  z.strictObject({ ...modifierId, kind: z.literal('slot'), startQ: qVector, endQ: qVector, axis: vector, widthQ: positiveQ }),
  z.strictObject({ ...modifierId, kind: z.literal('chamfer-fillet'), edgeFeatureId: id, profile: z.enum(['chamfer', 'fillet']), sizeQ: positiveQ }),
  z.strictObject({ ...modifierId, kind: z.literal('extrude-offset'), faceFeatureId: id, offsetQ: q }),
]))
const stepPart = z.strictObject({
  ...part, kind: z.literal('imported-step'), attachmentId: id, solidIndex: q.nonnegative(),
})
const primitiveParts = baseParameters.options.map(base => base.extend({
  ...part, kind: z.literal('parametric-primitive'), modifiers,
}))
const feature = { id, partId: id, signature: id }
const persistentFeature = z.discriminatedUnion('kind', [
  z.strictObject({ ...feature, kind: z.literal('face'), surface: z.enum(['plane', 'other']), originQ: qVector, normal: vector }),
  z.strictObject({ ...feature, kind: z.literal('cylindrical-hole-axis'), originQ: qVector, axis: vector, radiusQ: positiveQ }),
  z.strictObject({ ...feature, kind: z.literal('cone'), apexQ: qVector, axis: vector, semiAngleRad: number }),
  z.strictObject({ ...feature, kind: z.literal('edge'), curve: z.enum(['line', 'circle', 'other']), startQ: qVector, endQ: qVector }),
  z.strictObject({ ...feature, kind: z.literal('point'), positionQ: qVector }),
])
const dof = z.enum(['tx', 'ty', 'tz', 'rx', 'ry', 'rz'])
const pair = z.tuple([id, id])
const mate = { id, constrainedDofs: z.array(dof).max(6).refine(values => new Set(values).size === values.length) }
const binaryMate = { ...mate, featureIds: pair }
const mates = z.array(z.discriminatedUnion('kind', [
  z.strictObject({ ...binaryMate, kind: z.enum(['face-contact', 'coaxial', 'parallel']) }),
  z.strictObject({ ...binaryMate, kind: z.literal('floating-clearance'), minQ: q, maxQ: q }).refine(value => value.minQ <= value.maxQ),
  z.strictObject({ ...binaryMate, kind: z.literal('distance'), distanceQ: q }),
  z.strictObject({ ...mate, kind: z.literal('3-2-1'), contactPairs: z.tuple([pair, pair, pair, pair, pair, pair]) }),
]))

export const stepAttachmentSchema = z.strictObject({ id, blobKey: id, fileName: id })
export const assemblyModelV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  units: z.literal('mm'),
  parts: z.array(z.union([stepPart, ...primitiveParts])),
  features: z.array(persistentFeature),
  mates,
  datums: z.array(z.strictObject({ id, label: id, featureId: id })),
  gdt: z.array(z.strictObject({
    id, featureId: id,
    kind: z.enum(['position', 'perpendicularity', 'parallelism', 'flatness', 'coaxiality']),
    toleranceQ: q.nonnegative(),
    modifier: z.enum(['MMC', 'LMC', 'RFS']).optional(),
    datumIds: z.array(id).max(3),
  })),
  physics: z.strictObject({
    materials: z.array(z.strictObject({
      partId: id, youngsModulusMpa: number.positive(), poissonRatio: number.gt(-1).lt(0.5),
      thermalExpansionPerK: number, deltaTemperatureK: number,
    })).optional(),
    loads: z.array(z.strictObject({ featureId: id, forceN: vector })).optional(),
    initialWarp: z.array(z.strictObject({ featureId: id, offsetQ: qVector })).optional(),
    micMatrixRef: id.optional(),
  }).optional(),
  measurements: z.array(z.strictObject({
    id,
    kind: z.enum(['gap', 'flush', 'coaxiality', 'center-distance', 'angle', 'interference']),
    featureIds: pair,
  })),
}).superRefine((model, context) => {
  const issue = (path: (string | number)[], message: string) =>
    context.addIssue({ code: 'custom', path, message })
  for (const key of ['parts', 'features', 'mates', 'datums', 'gdt', 'measurements'] as const) {
    const ids = model[key].map(item => item.id)
    if (new Set(ids).size !== ids.length) issue([key], 'Duplicate assembly entity ID')
  }
  const partIds = new Set(model.parts.map(item => item.id))
  const features = new Map(model.features.map(item => [item.id, item]))
  const datumIds = new Set(model.datums.map(item => item.id))
  const checkFeatures = (ids: readonly string[], path: (string | number)[]) => {
    for (const id of ids) if (!features.has(id)) issue(path, `Unknown feature: ${id}`)
  }
  model.features.forEach((item, index) => {
    if (!partIds.has(item.partId)) issue(['features', index, 'partId'], 'Unknown part')
  })
  model.parts.forEach((item, index) => {
    if (item.kind !== 'parametric-primitive') return
    if (new Set(item.modifiers.map(modifier => modifier.id)).size !== item.modifiers.length) {
      issue(['parts', index, 'modifiers'], 'Duplicate modifier ID')
    }
    item.modifiers.forEach((modifier, modifierIndex) => {
      const target = modifier.kind === 'chamfer-fillet' ? features.get(modifier.edgeFeatureId)
        : modifier.kind === 'extrude-offset' ? features.get(modifier.faceFeatureId) : undefined
      if (modifier.kind === 'chamfer-fillet' || modifier.kind === 'extrude-offset') {
        const kind = modifier.kind === 'chamfer-fillet' ? 'edge' : 'face'
        if (target?.partId !== item.id || target.kind !== kind) {
          issue(['parts', index, 'modifiers', modifierIndex], 'Modifier must reference its own part feature')
        }
      }
    })
  })
  model.mates.forEach((item, index) => {
    checkFeatures(item.kind === '3-2-1' ? item.contactPairs.flat() : item.featureIds, ['mates', index])
  })
  model.datums.forEach((item, index) => checkFeatures([item.featureId], ['datums', index]))
  model.gdt.forEach((item, index) => {
    checkFeatures([item.featureId], ['gdt', index])
    if (item.datumIds.some(id => !datumIds.has(id))) issue(['gdt', index, 'datumIds'], 'Unknown datum')
  })
  model.measurements.forEach((item, index) => checkFeatures(item.featureIds, ['measurements', index]))
  model.physics?.materials?.forEach((item, index) => {
    if (!partIds.has(item.partId)) issue(['physics', 'materials', index, 'partId'], 'Unknown part')
  })
  model.physics?.loads?.forEach((item, index) => checkFeatures([item.featureId], ['physics', 'loads', index]))
  model.physics?.initialWarp?.forEach((item, index) => checkFeatures([item.featureId], ['physics', 'initialWarp', index]))
})

export type AssemblyModelV1 = z.infer<typeof assemblyModelV1Schema>
export type AssemblyPart = AssemblyModelV1['parts'][number]
export type PersistentFeature = AssemblyModelV1['features'][number]
export type AssemblyMate = AssemblyModelV1['mates'][number]
export type DatumDefinition = AssemblyModelV1['datums'][number]
export type GdtFeatureControl = AssemblyModelV1['gdt'][number]
export type AssemblyPhysicsSpec = NonNullable<AssemblyModelV1['physics']>
export type MeasurementSpec = AssemblyModelV1['measurements'][number]
export type StepAttachment = z.infer<typeof stepAttachmentSchema>
