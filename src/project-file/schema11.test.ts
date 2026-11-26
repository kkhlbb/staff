// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readZipEntries, writeZipEntries } from '../backup/zip'
import { sha256Hex } from '../sources/hash'
import { createSampleSnapshot } from './__fixtures__/sampleProjectFile'
import { assemblyModelV1Schema, compliantModelSpecSchema, gdtFeatureControlEditSchema, micMatrixPayloadV1Schema, resolveGdtMaterialConditions } from './assembly3d'
import { decodeProjectFile, encodeProjectFile } from './codec'
import type { AssemblyModelV1, CompliantModelSpec, MicMatrixPayloadV1, ProjectFileSnapshot } from './types'
import { upgradeSnapshotToCurrent } from './upgrade'
import { parseProject, validateAttachmentBytes } from './validation'

const transform: AssemblyModelV1['parts'][number]['nominalTransform'] = [
  [1, 0, 0, 1.4], [0, 1, 0, 2.3], [0, 0, 1, 3.2], [0, 0, 0, 1],
]
const assembly3d: AssemblyModelV1 = {
  schemaVersion: 1,
  units: 'mm',
  parts: [
    { id: 'imported', kind: 'imported-step', attachmentId: 'step-1', solidIndex: 0,
      displayName: 'Bracket', color: '#abc123', nominalTransform: transform },
    { id: 'plate', kind: 'parametric-primitive', baseKind: 'plate', displayName: 'Plate',
      color: '#123abc', nominalTransform: transform,
      sizeQ: { lengthQ: 600_000, widthQ: 320_000, thicknessQ: 80_000 },
      modifiers: [{ id: 'hole', kind: 'through-hole', originQ: [0, 0, 0], axis: [0, 0, 1], diameterQ: 40_000 }] },
  ],
  features: [
    { id: 'f1', partId: 'imported', kind: 'face', signature: 'plane:0:0:1', surface: 'plane', originQ: [0, 0, 0], normal: [0, 0, 1] },
    { id: 'f2', partId: 'plate', kind: 'face', signature: 'plane:0:0:-1', surface: 'plane', originQ: [0, 0, 2000], normal: [0, 0, -1] },
  ],
  mates: [{ id: 'm1', kind: 'floating-clearance', featureIds: ['f1', 'f2'], constrainedDofs: ['rx', 'ry'], minQ: 0, maxQ: 2000 }],
  datums: [{ id: 'a', label: 'A', featureId: 'f1' }],
  gdt: [{ id: 'g1', kind: 'parallelism', featureId: 'f2', toleranceQ: 100, datumIds: ['a'] }],
  physics: { micMatrixRef: 'mic-1' },
  measurements: [{ id: 'measure', kind: 'gap', featureIds: ['f1', 'f2'] }],
}

async function fixture(): Promise<ProjectFileSnapshot> {
  const base = await createSampleSnapshot()
  const bytes = new TextEncoder().encode('ISO-10303-21;\nEND-ISO-10303-21;')
  const blobKey = 'step-bytes'
  const project = {
    ...base.project, assembly3d, stepAttachments: [{ id: 'step-1', blobKey, fileName: 'bracket.step' }],
  }
  return {
    ...base, project,
    fileRevisions: base.fileRevisions.map(revision => ({ ...revision, project })),
    blobs: [...base.blobs, { blobKey, projectId: project.id, byteSize: bytes.length, sha256: await sha256Hex(bytes) }],
    attachments: [...base.attachments, { blobKey, bytes }],
  }
}

describe('Schema 11 assembly and STEP', () => {
  it('retains the two part sources, topology, mates, q values, and attachment bytes', async () => {
    const original = await fixture()
    const encoded = await encodeProjectFile(original)
    if (!encoded.ok) throw Error(JSON.stringify(encoded))
    expect(encoded.value.manifest.project.projectSchemaVersion).toBe(11)
    expect(encoded.value.manifest.attachments).toContainEqual({
      kind: 'step', revisionId: 'step-1', path: 'attachments/step-bytes.bin',
      blobKey: 'step-bytes', byteSize: original.blobs.at(-1)?.byteSize, sha256: original.blobs.at(-1)?.sha256,
    })
    const decoded = await decodeProjectFile(encoded.value.bytes)
    if (!decoded.ok) throw Error(JSON.stringify(decoded))
    expect(decoded.value.snapshot.project.assembly3d).toEqual(assembly3d)
    expect(decoded.value.snapshot.project.stepAttachments).toEqual(original.project.stepAttachments)
    expect(decoded.value.snapshot.fileRevisions).toEqual(original.fileRevisions)
    expect(decoded.value.snapshot.attachments).toContainEqual(original.attachments.at(-1))
  })

  it('rejects same-size STEP bytes with an incorrect SHA-256 on write and read', async () => {
    const original = await fixture()
    const encoded = await encodeProjectFile(original)
    if (!encoded.ok) throw Error(JSON.stringify(encoded))
    const zip = await readZipEntries(encoded.value.bytes)
    if (!zip.ok) throw Error(JSON.stringify(zip))
    const corrupt = zip.value.get('attachments/step-bytes.bin')!.slice()
    corrupt[0] ^= 1
    zip.value.set('attachments/step-bytes.bin', corrupt)
    original.attachments.at(-1)!.bytes = corrupt
    expect(await validateAttachmentBytes(original, sha256Hex)).toMatchObject({ ok: false, error: { code: 'HASH_MISMATCH' } })
    expect(await encodeProjectFile(original)).toMatchObject({ ok: false, error: { code: 'HASH_MISMATCH' } })
    const changed = await writeZipEntries([...zip.value].map(([path, bytes]) => ({ path, bytes })))
    if (!changed.ok) throw Error(JSON.stringify(changed))
    expect(await decodeProjectFile(changed.value)).toMatchObject({ ok: false, error: { code: 'HASH_MISMATCH' } })
  })

  it('requires STEP blob metadata and bytes for every active or archived reference', async () => {
    const snapshot = await fixture()
    delete snapshot.project.assembly3d
    // The file revision and active project share the same fixture object. Preserve an independent historical copy.
    snapshot.fileRevisions[0] = { ...snapshot.fileRevisions[0], project: { ...snapshot.project } }
    delete snapshot.project.stepAttachments
    const encoded = await encodeProjectFile(snapshot)
    if (!encoded.ok) throw Error(JSON.stringify(encoded))
    expect(encoded.value.manifest.attachments).toContainEqual(expect.objectContaining({ kind: 'step' }))
    snapshot.attachments.pop()
    expect(await encodeProjectFile(snapshot)).toMatchObject({ ok: false, error: { code: 'MISSING_REFERENCE' } })
  })

  it.each([
    ['fractional q', (model: AssemblyModelV1) => {
      const part = model.parts[1]
      if (part.kind === 'parametric-primitive' && part.baseKind === 'plate') part.sizeQ.lengthQ = 1.5
    }],
    ['unknown topology ID', (model: AssemblyModelV1) => { model.measurements[0].featureIds[0] = 'missing' }],
    ['malformed homogeneous transform', (model: AssemblyModelV1) => { Reflect.set(model.parts[0].nominalTransform[3], 3, 0) }],
    ['unknown STEP ID', (model: AssemblyModelV1) => {
      const part = model.parts[0]
      if (part.kind === 'imported-step') part.attachmentId = 'missing'
    }],
    ['duplicate degree of freedom', (model: AssemblyModelV1) => { model.mates[0].constrainedDofs.push('rx') }],
  ])('rejects %s', async (_name, mutate) => {
    const { project } = await fixture()
    const model = structuredClone(assembly3d)
    mutate(model)
    expect(parseProject({ ...project, assembly3d: model })).toMatchObject({ ok: false, error: { code: 'INVALID_RECORD' } })
  })

  it('appends schema 11 on explicit upgrade and preserves the original schema 10 revision', async () => {
    const snapshot = await createSampleSnapshot()
    const historical = { ...snapshot.fileRevisions[0], project: { ...snapshot.project, schemaVersion: 10 as const } }
    snapshot.fileRevisions = [historical]
    const { snapshot: next, upgraded } = upgradeSnapshotToCurrent(snapshot, { newRevisionId: () => 'rev-upgraded' })
    expect(upgraded).toBe(true)
    expect(next.fileRevisions[0]).toBe(historical)
    expect(next.fileRevisions[1].project.schemaVersion).toBe(11)
    const encoded = await encodeProjectFile(next)
    if (!encoded.ok) throw Error(JSON.stringify(encoded))
    const decoded = await decodeProjectFile(encoded.value.bytes)
    if (!decoded.ok) throw Error(JSON.stringify(decoded))
    expect(decoded.value.snapshot.fileRevisions[0]).toEqual(historical)
  })
})

describe('M3 additive Schema 11 fields', () => {
  it('round trips GD&T, datum size deviations, and nested STEP groups with history intact', async () => {
    const snapshot = await fixture()
    const model = structuredClone(assembly3d)
    const imported = model.parts[0]
    if (imported.kind !== 'imported-step') throw Error('Expected STEP fixture')
    imported.groupId = 'child'
    model.assemblyGroups = [{ id: 'root', name: 'Parent' }, { id: 'child', name: 'Child', parentGroupId: 'root' }]
    model.features.push({ id: 'axis', partId: imported.id, kind: 'cylindrical-hole-axis', signature: 'axis',
      radiusQ: 4000, originQ: [0, 0, 0], axis: [0, 0, 1] })
    model.datums[0] = { ...model.datums[0], featureId: 'axis', sizeToleranceQ: { lowerQ: -10, upperQ: 25 } }
    model.gdt[0] = { ...model.gdt[0], featureId: 'axis', kind: 'position', modifier: 'MMC',
      datumModifiers: ['LMC'], zoneShape: 'cylindrical', featureSizeToleranceQ: { lowerQ: 0, upperQ: 20 },
      anchorOffsetMm: [-3.25, 1, 0] }
    snapshot.project = { ...snapshot.project, assembly3d: model }

    const encoded = await encodeProjectFile(snapshot)
    if (!encoded.ok) throw Error(JSON.stringify(encoded))
    const decoded = await decodeProjectFile(encoded.value.bytes)
    if (!decoded.ok) throw Error(JSON.stringify(decoded))
    expect(decoded.value.manifest.project.projectSchemaVersion).toBe(11)
    expect(decoded.value.snapshot.project.assembly3d).toEqual(model)
    expect(decoded.value.snapshot.fileRevisions).toEqual(snapshot.fileRevisions)
    expect(decoded.value.snapshot.attachments).toEqual(snapshot.attachments)
    expect(resolveGdtMaterialConditions(model.gdt[0], model)).toEqual({
      modifier: 'MMC', datumModifiers: ['LMC'], warnings: [],
    })
  })

  it('preserves v0.6.0-beta controls in active and historical records where new edits would fail', async () => {
    const snapshot = await fixture()
    const legacy = structuredClone(assembly3d)
    legacy.gdt = [
      { ...legacy.gdt[0], kind: 'flatness', modifier: 'MMC' },
      { ...legacy.gdt[0], id: 'g2', kind: 'position', datumIds: [] },
    ]
    snapshot.project.assembly3d = legacy
    const encoded = await encodeProjectFile(snapshot)
    if (!encoded.ok) throw Error(JSON.stringify(encoded))
    const decoded = await decodeProjectFile(encoded.value.bytes)
    if (!decoded.ok) throw Error(JSON.stringify(decoded))
    expect(decoded.value.snapshot.project.assembly3d).toEqual(legacy)
    expect(decoded.value.snapshot.fileRevisions).toEqual(snapshot.fileRevisions)
    expect(decoded.value.snapshot.analysisSnapshots).toEqual(snapshot.analysisSnapshots)
    expect(legacy.gdt.every(control => !gdtFeatureControlEditSchema.safeParse(control).success)).toBe(true)
  })

  it.each(['position', 'perpendicularity', 'parallelism', 'coaxiality', 'flatness'] as const)(
    'enforces datum count for new %s edits',
    (kind) => {
      const control = { ...assembly3d.gdt[0], kind }
      expect(gdtFeatureControlEditSchema.safeParse({ ...control, datumIds: [] }).success).toBe(kind === 'flatness')
      expect(gdtFeatureControlEditSchema.safeParse(control).success).toBe(kind !== 'flatness')
    },
  )

  it('rejects inverted tolerances and invalid datum modifier values or counts', () => {
    const control = assembly3d.gdt[0]
    const datum = assembly3d.datums[0]
    const inverted = { lowerQ: 15, upperQ: -1 }
    expect(assemblyModelV1Schema.safeParse({ ...assembly3d, datums: [{ ...datum, sizeToleranceQ: inverted }] }).success).toBe(false)
    for (const fields of [
      { featureSizeToleranceQ: inverted },
      { datumModifiers: ['RFS', 'LMC'] },
      { datumIds: ['a', 'a', 'a'], datumModifiers: ['MMC', 'LMC', 'RFS', 'RFS'] },
      { datumModifiers: ['unsupported'] },
    ]) {
      expect(gdtFeatureControlEditSchema.safeParse({ ...control, ...fields }).success).toBe(false)
    }
    expect(gdtFeatureControlEditSchema.safeParse({ ...control, datumModifiers: ['MMC'] }).success).toBe(true)
  })

  it.each(['MMC', 'LMC'] as const)('reports non-size %s modifiers and solves with RFS', (modifier) => {
    const control = { ...assembly3d.gdt[0], modifier, datumModifiers: [modifier] }
    expect(gdtFeatureControlEditSchema.safeParse(control).success).toBe(true)
    const result = resolveGdtMaterialConditions(control, assembly3d)
    expect(result).toMatchObject({
      modifier: 'RFS', datumModifiers: ['RFS'],
      warnings: [
        { code: 'ILLEGAL_MODIFIER', gdtId: 'g1', message: expect.stringContaining(modifier) },
        { code: 'ILLEGAL_MODIFIER', gdtId: 'g1', datumId: 'a', message: expect.stringContaining(modifier) },
      ],
    })
    expect(control.modifier).toBe(modifier)
    expect(control.datumModifiers).toEqual([modifier])
    expect(resolveGdtMaterialConditions(assembly3d.gdt[0], assembly3d)).toEqual({
      modifier: 'RFS', datumModifiers: ['RFS'], warnings: [],
    })
  })
})

const compliantModels = [
  { id: 'axial', kind: 'axial-compression', partId: 'plate', featureId: 'f2', preloadN: 0, preloadTolN: 0,
    stiffnessNPerMm: 12.4, effectiveAreaMm2: 25.6, lengthMm: 2.4, springbackRatio: 1 },
  { id: 'plate', kind: 'plate-clamping', partId: 'plate', surfaceFeatureId: 'f2', thicknessQ: 15000,
    initialWarpPeakQ: -2800, warpTolQ: 50, clampFeatureIds: ['f1', 'f2'], clampForceN: 100, boundaryKind: 'simply-supported' },
  { id: 'beam', kind: 'beam-bending', partId: 'plate', loadFeatureId: 'f2', supportKind: 'cantilever',
    spanMm: 18, momentOfInertiaMm4: 30.4, forceN: -25, forceTolN: 0, direction: [0, 0, -1] },
  { id: 'thermal', kind: 'thermal-expansion', partIds: ['plate', 'imported'], deltaTemperatureK: -40,
    deltaTempTolK: 2.5, referenceFeatureId: 'f1', bimetallicCoupling: false },
] satisfies CompliantModelSpec[]

const material = {
  partId: 'plate', youngsModulusMpa: 69000, poissonRatio: 0.33, thermalExpansionPerK: 0.000023, deltaTemperatureK: -40,
}
const legacyPhysics = {
  materials: [material], loads: [{ featureId: 'f2', forceN: [0, 0, -12] }],
  initialWarp: [{ featureId: 'f2', offsetQ: [0, 0, -2800] }], micMatrixRef: 'mic-1',
} satisfies AssemblyModelV1['physics']

const micPayload: MicMatrixPayloadV1 = {
  schemaVersion: 1, partId: 'plate', units: 'mm', forceUnits: 'N',
  controlPointsMm: [[0, 0, 0], [2.5, 0, 0]], measurePointsMm: [[0, 1, 0]],
  sensitivityMatrix: [[-0.025, 0.033]],
  sourceMeta: { solverName: 'example-solver', meshNodes: 240, generatedAtIso: '2026-11-26T03:00:00Z' },
}

async function addMicAttachment(snapshot: ProjectFileSnapshot, payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const blobKey = 'mic-bytes'
  snapshot.project.micMatrixAttachments = [{ id: 'mic-1', blobKey, fileName: 'plate.json' }]
  const sha256 = await sha256Hex(bytes)
  snapshot.blobs.push({ blobKey, projectId: snapshot.project.id, byteSize: bytes.length, sha256 })
  snapshot.attachments.push({ blobKey, bytes })
  return { blobKey, bytes, sha256 }
}

describe('M4 additive Schema 11 physics', () => {
  it('preserves all legacy physics fields from a v0.7.0-beta archive', async () => {
    // Encoded using the v0.7.0-beta source at 2176919.
    const bytes = readFileSync(new URL('./__fixtures__/v070-schema11-physics.cunlian', import.meta.url))
    const decoded = await decodeProjectFile(new Uint8Array(bytes))
    if (!decoded.ok) throw Error(JSON.stringify(decoded))
    const snapshot = decoded.value.snapshot
    expect(decoded.value.manifest.writer.appVersion).toBe('0.7.0-beta')
    expect(decoded.value.manifest.project.projectSchemaVersion).toBe(11)
    expect(snapshot.project.assembly3d?.physics).toStrictEqual(legacyPhysics)
    expect(snapshot.project).not.toHaveProperty('micMatrixAttachments')
    const encoded = await encodeProjectFile(snapshot)
    if (!encoded.ok) throw Error(JSON.stringify(encoded))
    const roundTrip = await decodeProjectFile(encoded.value.bytes)
    if (!roundTrip.ok) throw Error(JSON.stringify(roundTrip))
    expect(roundTrip.value.snapshot).toStrictEqual(snapshot)
  })

  it('keeps physics absent in a legacy rigid assembly', async () => {
    const original = await fixture()
    original.project.assembly3d = { ...assembly3d }
    delete original.project.assembly3d.physics
    const encoded = await encodeProjectFile(original)
    if (!encoded.ok) throw Error(JSON.stringify(encoded))
    const decoded = await decodeProjectFile(encoded.value.bytes)
    if (!decoded.ok) throw Error(JSON.stringify(decoded))
    expect(decoded.value.snapshot.project.assembly3d).not.toHaveProperty('physics')
  })

  it('round trips all four models and optional material fields with the legacy values', async () => {
    const original = await fixture()
    const model: AssemblyModelV1 = { ...assembly3d, physics: {
      ...legacyPhysics,
      enabled: false,
      compliantModels,
      materials: [{ ...material, presetId: 'al-6061', name: '6061-T6', yieldStrengthMpa: 276 }],
    } }
    original.project.assembly3d = model
    const encoded = await encodeProjectFile(original)
    if (!encoded.ok) throw Error(JSON.stringify(encoded))
    const decoded = await decodeProjectFile(encoded.value.bytes)
    if (!decoded.ok) throw Error(JSON.stringify(decoded))
    expect(decoded.value.snapshot.project.assembly3d).toStrictEqual(model)
    for (const yieldStrengthMpa of [0, -1, Infinity]) {
      const physics = { materials: [{ ...material, yieldStrengthMpa }] }
      expect(assemblyModelV1Schema.safeParse({ ...model, physics }).success).toBe(false)
    }
  })

  it.each([
    [0, [{ preloadN: -1 }, { preloadTolN: -1 }, { stiffnessNPerMm: 0 }, { effectiveAreaMm2: 0 },
      { lengthMm: 0 }, { springbackRatio: -0.1 }, { springbackRatio: 1.1 }]],
    [1, [{ thicknessQ: 0 }, { initialWarpPeakQ: 1.5 }, { warpTolQ: -1 }, { warpTolQ: 1.5 },
      { clampFeatureIds: ['f1'] }, { clampFeatureIds: Array(17).fill('f1') },
      { clampForceN: 0 }, { boundaryKind: 'free' }]],
    [2, [{ supportKind: 'fixed' }, { spanMm: 0 }, { momentOfInertiaMm4: 0 }, { forceN: Infinity },
      { forceTolN: -1 }, { direction: [1, 2] }]],
    [3, [{ partIds: [] }, { deltaTemperatureK: NaN }, { deltaTempTolK: -1 }, { bimetallicCoupling: 0 }]],
  ] as const)('enforces ranges and shape for model %i', (index, invalidFields) => {
    const model = compliantModels[index]
    expect(compliantModelSpecSchema.parse(model)).toEqual(model)
    for (const fields of invalidFields) {
      expect(compliantModelSpecSchema.safeParse({ ...model, ...fields }).success, JSON.stringify(fields)).toBe(false)
    }
    expect(compliantModelSpecSchema.safeParse({ ...model, unknown: true }).success).toBe(false)
  })
})

describe('M4 MIC matrix attachment', () => {
  it('accepts a non-square m × n matrix and optional source metadata', () => {
    expect(micMatrixPayloadV1Schema.parse(micPayload)).toEqual(micPayload)
    const withoutMeta = { ...micPayload, sourceMeta: undefined }
    expect(micMatrixPayloadV1Schema.safeParse(withoutMeta).success).toBe(true)
  })

  it.each([
    { schemaVersion: 2 }, { partId: '' }, { units: 'cm' }, { forceUnits: 'kN' },
    { controlPointsMm: [[0, 0]] },
    { controlPointsMm: [[0, Infinity, 0], [0, 0, 0]] }, { measurePointsMm: [[NaN, 0, 0]] },
    { sensitivityMatrix: [] }, { sensitivityMatrix: [[0, 0], [0, 0]] },
    { sensitivityMatrix: [[0]] }, { sensitivityMatrix: [[0, 0, 0]] },
    { sensitivityMatrix: [[NaN, 0]] }, { sensitivityMatrix: [[0, Infinity]] },
    { sourceMeta: { solverName: 'solver', meshNodes: -2 } },
    { sourceMeta: { solverName: 'solver', anotherField: 'unexpected' } },
    { unexpected: true },
  ])('rejects invalid MIC fields %j', overrides => {
    expect(micMatrixPayloadV1Schema.safeParse({ ...micPayload, ...overrides }).success).toBe(false)
  })

  it('round trips MIC bytes and SHA-256 for a historical-only attachment', async () => {
    const original = await fixture()
    const { blobKey, bytes, sha256 } = await addMicAttachment(original, micPayload)
    original.project = { ...original.project }
    delete original.project.micMatrixAttachments
    delete original.project.assembly3d
    const encoded = await encodeProjectFile(original)
    if (!encoded.ok) throw Error(JSON.stringify(encoded))
    const path = 'attachments/mic-bytes.bin'
    expect(encoded.value.manifest.attachments).toContainEqual({
      kind: 'mic-matrix', revisionId: 'mic-1', path, blobKey, byteSize: bytes.length, sha256,
    })
    expect(encoded.value.manifest.entries).toContainEqual({ role: 'attachment', path, byteSize: bytes.length, sha256 })
    const decoded = await decodeProjectFile(encoded.value.bytes)
    if (!decoded.ok) throw Error(JSON.stringify(decoded))
    expect(decoded.value.snapshot.fileRevisions).toEqual(original.fileRevisions)
    expect(decoded.value.snapshot.attachments).toContainEqual({ blobKey, bytes })

    const zip = await readZipEntries(encoded.value.bytes)
    if (!zip.ok) throw Error(JSON.stringify(zip))
    const corrupt = bytes.slice()
    corrupt[0] ^= 1
    zip.value.set(path, corrupt)
    const changed = await writeZipEntries([...zip.value].map(([path, bytes]) => ({ path, bytes })))
    if (!changed.ok) throw Error(JSON.stringify(changed))
    expect(await decodeProjectFile(changed.value)).toMatchObject({ ok: false, error: { code: 'HASH_MISMATCH' } })
    original.attachments.at(-1)!.bytes = corrupt
    expect(await encodeProjectFile(original)).toMatchObject({ ok: false, error: { code: 'HASH_MISMATCH' } })
    original.attachments.pop()
    expect(await encodeProjectFile(original)).toMatchObject({ ok: false, error: { code: 'MISSING_REFERENCE' } })
  })

  it('retains the active MIC reference, registry and payload', async () => {
    const original = await fixture()
    const { blobKey, bytes } = await addMicAttachment(original, micPayload)
    const encoded = await encodeProjectFile(original)
    if (!encoded.ok) throw Error(JSON.stringify(encoded))
    const decoded = await decodeProjectFile(encoded.value.bytes)
    if (!decoded.ok) throw Error(JSON.stringify(decoded))
    expect(decoded.value.snapshot.project.assembly3d?.physics?.micMatrixRef).toBe('mic-1')
    expect(decoded.value.snapshot.project.micMatrixAttachments).toStrictEqual(original.project.micMatrixAttachments)
    expect(decoded.value.snapshot.attachments).toContainEqual({ blobKey, bytes })
  })

  it('rejects the wrong dimensions even when MIC bytes match their hash', async () => {
    const original = await fixture()
    await addMicAttachment(original, { ...micPayload, sensitivityMatrix: [[0]] })
    expect(await encodeProjectFile(original)).toMatchObject({ ok: false, error: { code: 'INVALID_RECORD' } })
  })
})
