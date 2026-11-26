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
  ...part, kind: z.literal('imported-step'), attachmentId: id, solidIndex: q.nonnegative(), groupId: id.optional(),
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

const sizeToleranceSchema = z.strictObject({ lowerQ: q, upperQ: q })
  .refine(value => value.lowerQ <= value.upperQ, { path: ['upperQ'], message: 'Upper deviation must be at least the lower deviation' })
const materialModifierSchema = z.enum(['MMC', 'LMC', 'RFS'])

export const datumDefinitionSchema = z.strictObject({
  id, label: id, featureId: id, sizeToleranceQ: sizeToleranceSchema.optional(),
})

export const gdtFeatureControlSchema = z.strictObject({
  id, featureId: id,
  kind: z.enum(['position', 'perpendicularity', 'parallelism', 'flatness', 'coaxiality']),
  toleranceQ: q.nonnegative(),
  modifier: materialModifierSchema.optional(),
  datumIds: z.array(id).max(3),
  datumModifiers: z.array(materialModifierSchema).max(3).optional(),
  zoneShape: z.enum(['cylindrical', 'planar', 'bidirectional']).optional(),
  featureSizeToleranceQ: sizeToleranceSchema.optional(),
  anchorOffsetMm: vector.optional(),
}).superRefine((control, context) => {
  if (control.datumModifiers && control.datumModifiers.length > control.datumIds.length) {
    context.addIssue({ code: 'custom', path: ['datumModifiers'], message: 'Each datum modifier requires a corresponding datum' })
  }
})

// Apply to new or changed controls. The archive schema accepts the datum counts
// allowed by v0.6.0-beta, including controls in historical revisions.
export const gdtFeatureControlEditSchema = gdtFeatureControlSchema.superRefine((control, context) => {
  const isFlatness = control.kind === 'flatness'
  if (isFlatness ? control.datumIds.length > 0 : control.datumIds.length === 0) {
    context.addIssue({
      code: 'custom', path: ['datumIds'],
      message: isFlatness ? 'Flatness cannot reference datums' : 'This GD&T control requires at least one datum',
    })
  }
})

export const assemblyGroupSchema = z.strictObject({ id, name: id, parentGroupId: id.optional() })

export const materialSpecSchema = z.strictObject({
  partId: id,
  presetId: id.optional(),
  name: id.optional(),
  youngsModulusMpa: number.positive(),
  poissonRatio: number.gt(-1).lt(0.5),
  thermalExpansionPerK: number,
  deltaTemperatureK: number,
  yieldStrengthMpa: number.positive().optional(),
})

export const compliantModelSpecSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id,
    kind: z.literal('axial-compression'),
    partId: id,
    featureId: id,
    preloadN: number.nonnegative(),
    preloadTolN: number.nonnegative().optional(),
    stiffnessNPerMm: number.positive().optional(),
    effectiveAreaMm2: number.positive().optional(),
    lengthMm: number.positive().optional(),
    springbackRatio: number.min(0).max(1).optional(),
  }),
  z.strictObject({
    id,
    kind: z.literal('plate-clamping'),
    partId: id,
    surfaceFeatureId: id,
    thicknessQ: positiveQ,
    initialWarpPeakQ: q,
    warpTolQ: q.nonnegative().optional(),
    clampFeatureIds: z.array(id).min(2).max(16),
    clampForceN: number.positive().optional(),
    boundaryKind: z.enum(['clamped', 'simply-supported']).optional(),
  }),
  z.strictObject({
    id,
    kind: z.literal('beam-bending'),
    partId: id,
    loadFeatureId: id,
    supportKind: z.enum(['cantilever', 'simply-supported']),
    spanMm: number.positive(),
    momentOfInertiaMm4: number.positive(),
    forceN: number,
    forceTolN: number.nonnegative().optional(),
    direction: vector.optional(),
  }),
  z.strictObject({
    id,
    kind: z.literal('thermal-expansion'),
    partIds: z.array(id).min(1),
    deltaTemperatureK: number,
    deltaTempTolK: number.nonnegative().optional(),
    referenceFeatureId: id.optional(),
    bimetallicCoupling: z.boolean().optional(),
  }),
])

export const assemblyPhysicsSpecSchema = z.strictObject({
  materials: z.array(materialSpecSchema).optional(),
  loads: z.array(z.strictObject({ featureId: id, forceN: vector })).optional(),
  initialWarp: z.array(z.strictObject({ featureId: id, offsetQ: qVector })).optional(),
  micMatrixRef: id.optional(),
  // Preserve absence on disk. Solvers default to on with models or a MIC reference.
  enabled: z.boolean().optional(),
  compliantModels: z.array(compliantModelSpecSchema).optional(),
})

export const micMatrixAttachmentSchema = z.strictObject({ id, blobKey: id, fileName: id })

export const micMatrixPayloadV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  partId: id,
  units: z.literal('mm'),
  forceUnits: z.literal('N'),
  controlPointsMm: z.array(vector),
  measurePointsMm: z.array(vector),
  sensitivityMatrix: z.array(z.array(number)),
  sourceMeta: z.strictObject({
    solverName: id,
    meshNodes: q.nonnegative().optional(),
    generatedAtIso: z.iso.datetime({ offset: true }).optional(),
  }).optional(),
}).superRefine((payload, context) => {
  if (payload.sensitivityMatrix.length !== payload.measurePointsMm.length) {
    context.addIssue({ code: 'custom', path: ['sensitivityMatrix'], message: 'Expected one row per measurement point' })
  }
  payload.sensitivityMatrix.forEach((row, index) => {
    if (row.length !== payload.controlPointsMm.length) {
      context.addIssue({ code: 'custom', path: ['sensitivityMatrix', index], message: 'Expected one column per control point' })
    }
  })
})

export const stepAttachmentSchema = z.strictObject({ id, blobKey: id, fileName: id })
export const assemblyModelV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  units: z.literal('mm'),
  parts: z.array(z.union([stepPart, ...primitiveParts])),
  features: z.array(persistentFeature),
  mates,
  datums: z.array(datumDefinitionSchema),
  gdt: z.array(gdtFeatureControlSchema),
  assemblyGroups: z.array(assemblyGroupSchema).optional(),
  physics: assemblyPhysicsSpecSchema.optional(),
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
export type AssemblyPhysicsSpec = z.infer<typeof assemblyPhysicsSpecSchema>
export type CompliantModelSpec = z.infer<typeof compliantModelSpecSchema>
export type MaterialSpec = z.infer<typeof materialSpecSchema>
export type MicMatrixAttachment = z.infer<typeof micMatrixAttachmentSchema>
export type MicMatrixPayloadV1 = z.infer<typeof micMatrixPayloadV1Schema>
export type MeasurementSpec = AssemblyModelV1['measurements'][number]
export type StepAttachment = z.infer<typeof stepAttachmentSchema>

export type AssemblyGroup = z.infer<typeof assemblyGroupSchema>
export type GdtMaterialModifier = z.infer<typeof materialModifierSchema>

export interface GdtValidationWarning {
  code: 'DRF_UNDERCONSTRAINED' | 'DRF_REDUNDANT' | 'ILLEGAL_MODIFIER' | 'DRF_DEGENERATE'
  gdtId: string
  message: string
  datumId?: string
}

/** Resolve material conditions for solving while preserving the requested values for review and archiving. */
export function resolveGdtMaterialConditions(
  control: GdtFeatureControl,
  model: Pick<AssemblyModelV1, 'features' | 'datums'>,
): { modifier: GdtMaterialModifier; datumModifiers: GdtMaterialModifier[]; warnings: GdtValidationWarning[] } {
  const features = new Map(model.features.map(feature => [feature.id, feature]))
  const datums = new Map(model.datums.map(datum => [datum.id, datum]))
  const warnings: GdtValidationWarning[] = []
  const resolve = (modifier: GdtMaterialModifier = 'RFS', featureId?: string, datumId?: string): GdtMaterialModifier => {
    if (modifier === 'RFS' || (featureId && features.get(featureId)?.kind === 'cylindrical-hole-axis')) return modifier
    warnings.push({
      code: 'ILLEGAL_MODIFIER', gdtId: control.id,
      ...(datumId === undefined ? {} : { datumId }),
      message: `${datumId === undefined ? 'Controlled feature' : `Datum ${datumId}`} requires a size feature for ${modifier}. Using RFS.`,
    })
    return 'RFS'
  }

  return {
    modifier: resolve(control.modifier, control.featureId),
    datumModifiers: control.datumIds.map((datumId, index) =>
      resolve(control.datumModifiers?.[index], datums.get(datumId)?.featureId, datumId)),
    warnings,
  }
}
