import { createHash } from 'node:crypto'
import { volume } from '../../../desktop/main/geometry-prototype/plate.mjs'
import { assertRigidPose, exportOrthographic, projectAssembly } from './orthographic.mjs'
import { buildPrimitive } from './primitives.mjs'
import { readStepSolids, verifiedStep } from './stepImport.mjs'
import { candidateSummary, extractPart } from './topology.mjs'

const identity = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const isId = value => typeof value === 'string' && value.length > 0 && value.length <= 200

// The caller owns project schema validation. Check the fields that reach the native
// kernel here. The packaged worker is self-contained and can't resolve zod.
function validateGeometryModel(model) {
  if (model?.schemaVersion !== 1 || model.units !== 'mm' || !Array.isArray(model.parts) || !Array.isArray(model.features)) {
    throw new Error('Expected Schema 11 assembly geometry in millimeters')
  }
  const ids = new Set()
  for (const part of model.parts) {
    if (!isId(part.id) || ids.has(part.id)) throw new Error('Invalid or duplicate assembly part ID')
    ids.add(part.id)
    assertRigidPose(part.nominalTransform)
    if (part.kind === 'imported-step') {
      if (!isId(part.attachmentId) || !Number.isSafeInteger(part.solidIndex) || part.solidIndex < 0) {
        throw new Error('Invalid STEP solid reference: ' + part.id)
      }
    } else if (part.kind !== 'parametric-primitive' || !part.sizeQ || !Array.isArray(part.modifiers)) {
      throw new Error('Invalid parametric part: ' + part.id)
    }
  }
  return model
}

function attachmentMap(input) {
  const attachments = new Map()
  for (const attachment of input) {
    const { id, blobKey, fileName, ...data } = attachment
    if (![id, blobKey, fileName].every(isId)) throw new Error('Invalid STEP attachment metadata')
    if (attachments.has(id)) throw new Error('Duplicate STEP attachment ID: ' + id)
    const bytes = data.bytes instanceof Uint8Array && data.bytes.buffer instanceof SharedArrayBuffer
      ? Uint8Array.from(data.bytes) : data.bytes
    attachments.set(id, { id, blobKey, fileName, bytes, sha256: verifiedStep({ ...data, bytes }) })
  }
  return attachments
}

function importedModel(attachment, solidCount) {
  const { id, fileName } = attachment
  const label = fileName.replace(/\.(stp|step)$/i, '') || 'STEP'
  const parts = Array.from({ length: solidCount }, (_, solidIndex) => ({
    id: 'step:' + digest([id, solidIndex]), kind: 'imported-step', attachmentId: id, solidIndex,
    nominalTransform: identity, displayName: (solidCount === 1 ? label : label + ' ' + (solidIndex + 1)).slice(0, 200),
    color: '#8094a6',
  }))
  return { schemaVersion: 1, units: 'mm', parts, features: [], mates: [], datums: [], gdt: [], measurements: [] }
}

function shapeInputs(model, attachments) {
  return model.parts.map(part => part.kind === 'imported-step'
    ? [part.id, part.kind, part.attachmentId, part.solidIndex, attachments.get(part.attachmentId)?.sha256]
    : [part.id, part.kind, part.baseKind, part.sizeQ, part.modifiers,
      model.features.filter(feature => feature.partId === part.id &&
        part.modifiers.some(modifier => (modifier.edgeFeatureId ?? modifier.faceFeatureId) === feature.id))])
}

function evaluate(oc, payload, acquire) {
  const attachments = attachmentMap(payload.attachments ?? [])
  using reads = new DisposableStack()
  const parsed = new Map()
  const read = attachment => {
    if (!parsed.has(attachment.sha256)) parsed.set(attachment.sha256, readStepSolids(oc, attachment.bytes, reads))
    return parsed.get(attachment.sha256)
  }
  const importAttachment = payload.operation === 'import-step' ? attachments.get(payload.attachmentId) : undefined
  if (payload.operation === 'import-step' && !importAttachment) throw new Error('STEP attachment unavailable')
  let model = importAttachment ? undefined : validateGeometryModel(payload.model)
  const key = importAttachment
    ? digest(['import-step', importAttachment.id, importAttachment.sha256])
    : digest(['rebuild-assembly', shapeInputs(model, attachments)])
  const build = () => {
    model ??= importedModel(importAttachment, read(importAttachment).length)
    using scope = new DisposableStack()
    const entries = model.parts.map(part => {
      let shape
      if (part.kind === 'imported-step') {
        const attachment = attachments.get(part.attachmentId)
        if (!attachment) throw new Error('STEP attachment unavailable: ' + part.attachmentId)
        const solid = read(attachment)[part.solidIndex]
        if (!solid) throw new Error('STEP solid index unavailable: ' + part.solidIndex)
        shape = scope.use(solid.clone())
      } else {
        shape = scope.use(buildPrimitive(oc, part, model.features))
      }
      return { shape, data: { ...extractPart(oc, shape, part), volumeMm3: volume(oc, shape) } }
    })
    return { entries, scope: scope.move() }
  }
  using temporary = new DisposableStack()
  const assembly = acquire ? acquire(key, build) : build()
  if (!acquire) temporary.use(assembly.scope)
  // Import labels may change without re-reading the bytes. Placement stays external to cached B-Reps.
  if (!model) model = importedModel(importAttachment, assembly.entries.length)
  const entries = assembly.entries.map(({ shape, data }, i) => {
    const part = model.parts[i]
    return { shape, part, data: { ...data, mesh: { ...data.mesh, nominalTransform: part.nominalTransform } } }
  })
  const parts = entries.map(entry => entry.data)
  const features = parts.flatMap(part => part.features)
  const output = {
    ...(importAttachment && { assembly: { ...model, features }, sha256: importAttachment.sha256 }),
    parts, features, candidates: candidateSummary(parts, oc.Precision.Confusion()),
  }
  if (payload.drawing) {
    output.projection = projectAssembly(oc, entries)
    if (payload.drawing.export) output.exports = exportOrthographic(output.projection, payload.drawing.dxfVersion)
  }
  return output
}

export function runAssemblyGeometry(oc, payload, acquire) {
  try {
    return evaluate(oc, payload, acquire)
  } catch (error) {
    if (!(error instanceof WebAssembly.Exception)) throw error
    // The Emscripten C++ exception itself owns a native reference.
    try {
      throw new Error('OCCT ' + oc.getExceptionMessage(error).join(': '))
    } finally {
      oc.decrementExceptionRefcount(error)
    }
  }
}
