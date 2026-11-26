import { z } from 'zod'
import catalog from '../../cloud/contracts/mcp-gdt-tools.json' with { type: 'json' }
import { assemblyModelV1Schema, datumDefinitionSchema, gdtFeatureControlEditSchema,
  resolveGdtMaterialConditions, type AssemblyModelV1 } from '../../src/project-file/assembly3d.ts'
import type { ProjectFileSnapshot } from '../../src/project-file/types.ts'
import type { EvidenceRef } from '../../src/document-extraction/types.ts'
import { provenanceRefSchema } from '../../src/project-file/validation.ts'
import { createSolverScheduler } from '../../src/core/solver/solverScheduler.mjs'
import type { AnalyzeGdtStackupRequest, AnalyzeGdtStackupResult } from '../../src/transport/types.ts'

export const gdtTools = catalog.tools
const text = z.string().regex(/\S/)
const epoch = z.int().nonnegative()
const stageFields = {
  projectId: text, expectedWriterEpoch: epoch, baseRevision: text,
  expectedDraftRevision: text.nullable(), idempotencyKey: text,
}
const evidence = z.array(provenanceRefSchema).min(1)
export const stageDatumSchema = z.strictObject({
  ...stageFields,
  items: z.array(z.strictObject({ value: datumDefinitionSchema, evidence })).min(1),
})
export const stageGdtSchema = z.strictObject({
  ...stageFields,
  items: z.array(z.strictObject({ value: gdtFeatureControlEditSchema, evidence })).min(1),
})
export const analyzeGdtSchema = z.strictObject({
  projectId: text, draftRevision: text, expectedWriterEpoch: epoch,
  monteCarlo: z.strictObject({ seed: epoch.max(0xffffffff), samples: epoch.min(1), distribution: z.enum(['normal', 'uniform']) }),
  edits: z.array(z.strictObject({
    gdtId: text, toleranceQ: epoch.optional(), modifier: z.enum(['MMC', 'LMC', 'RFS']).optional(),
  }).refine(edit => edit.toleranceQ !== undefined || edit.modifier !== undefined)).min(1).optional(),
})

export function assemblyWarnings(assembly: AssemblyModelV1) {
  return assembly.gdt.flatMap(control => resolveGdtMaterialConditions(control, assembly).warnings)
}

function upsert<T extends { id: string }>(existing: readonly T[], values: readonly T[]): T[] {
  const entries = new Map(existing.map(item => [item.id, item]))
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value.id)) throw Error('Duplicate item: ' + value.id)
    seen.add(value.id)
    entries.set(value.id, value)
  }
  return [...entries.values()]
}

function isEngineeringFeature(feature: AssemblyModelV1['features'][number] | undefined) {
  return feature?.kind === 'cylindrical-hole-axis' && Math.hypot(...feature.axis) > 0 ||
    feature?.kind === 'face' && feature.surface === 'plane' && Math.hypot(...feature.normal) > 0
}

export function stageDatums(assembly: AssemblyModelV1, request: z.infer<typeof stageDatumSchema>) {
  const features = new Map(assembly.features.map(feature => [feature.id, feature]))
  const values = request.items.map(({ value }) => {
    if (!isEngineeringFeature(features.get(value.featureId))) throw Error('Datum needs a planar face or cylindrical axis')
    return value
  })
  return assemblyModelV1Schema.parse({ ...assembly, datums: upsert(assembly.datums, values) })
}

export function stageControls(assembly: AssemblyModelV1, request: z.infer<typeof stageGdtSchema>) {
  const features = new Map(assembly.features.map(feature => [feature.id, feature]))
  const datums = new Map(assembly.datums.map(datum => [datum.id, datum]))
  const values = request.items.map(({ value }) => {
    const feature = features.get(value.featureId)
    const datumFeatures = value.datumIds.map(id => features.get(datums.get(id)?.featureId ?? ''))
    if (!isEngineeringFeature(feature) || datumFeatures.some(datum => !isEngineeringFeature(datum)) ||
        new Set(value.datumIds).size !== value.datumIds.length) {
      throw Error('GD&T requires supported features and distinct datum references')
    }
    if (value.kind === 'flatness' && feature?.kind !== 'face') throw Error('Flatness requires a planar face')
    if (value.kind === 'coaxiality' &&
      (feature?.kind !== 'cylindrical-hole-axis' || datumFeatures[0]?.kind !== 'cylindrical-hole-axis')) {
      throw Error('Coaxiality requires a cylindrical feature and a cylindrical primary datum')
    }
    return value
  })
  return assemblyModelV1Schema.parse({ ...assembly, gdt: upsert(assembly.gdt, values) })
}

export function createGdtAnalyzer(workerUrl?: URL) {
  const solver = createSolverScheduler(workerUrl)
  let tail: Promise<unknown> = Promise.resolve()
  let cached: { key: string; revision: string; baseline: AnalyzeGdtStackupResult['baseline'];
    edited: NonNullable<AnalyzeGdtStackupRequest['edits']> } | undefined
  return {
    run(assembly: AssemblyModelV1, request: AnalyzeGdtStackupRequest,
      options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<AnalyzeGdtStackupResult> {
      const { projectId, draftRevision, monteCarlo, edits } = request
      const { samples, seed, distribution } = monteCarlo
      const job = tail.then(async () => {
        options?.signal?.throwIfAborted()
        if (distribution !== 'uniform') throw Error('UNSUPPORTED_DISTRIBUTION')
        if (samples < 10_000 || samples > 50_000) throw Error('SIMULATION_LIMIT')
        const controls = new Map(assembly.gdt.map(control => [control.id, control]))
        if (edits && (new Set(edits.map(edit => edit.gdtId)).size !== edits.length ||
          edits.some(edit => !controls.has(edit.gdtId)))) throw Error('INVALID_WHAT_IF')
        const key = JSON.stringify([projectId, draftRevision, monteCarlo, assembly])
        if (cached?.key !== key) {
          cached = undefined
          const result = await solver.run({ kind: 'multivariate', inputs: { assembly, samples, seed, parameters: [] } }, options)
          if (result.status !== 'ok') throw Error('ASSEMBLY_OVERCONSTRAINED')
          if (!result.gdt) throw Error('NO_GDT_CONTROLS')
          cached = { key, revision: result.baselineRevision, baseline: result.gdt.baseline, edited: [] }
        }
        const output: AnalyzeGdtStackupResult = { projectId, draftRevision, monteCarlo, baseline: cached.baseline }
        if (edits?.length) {
          // The worker carries edits forward. Reset previous edits to the saved draft
          // before applying this independent scenario against the same physical draws.
          const patch = new Map(cached.edited.map(({ gdtId }) => {
            const original = controls.get(gdtId)!
            return [gdtId, { gdtId, toleranceQ: original.toleranceQ, modifier: original.modifier ?? 'RFS' as const }]
          }))
          for (const edit of edits) patch.set(edit.gdtId, { ...patch.get(edit.gdtId),
            gdtId: edit.gdtId, toleranceQ: edit.toleranceQ ?? controls.get(edit.gdtId)!.toleranceQ,
            modifier: edit.modifier ?? controls.get(edit.gdtId)!.modifier ?? 'RFS' })
          const revision = cached.revision
          const changed = await solver.run({
            kind: 'multivariate', inputs: { incremental: { baselineRevision: revision, edits: [...patch.values()] } },
          }, options)
          if (changed.status !== 'ok' || !changed.gdt?.whatIf) throw Error('SIMULATION_FAILED')
          cached.revision = changed.baselineRevision
          cached.edited = edits
          output.whatIf = changed.gdt.whatIf
        }
        return output
      })
      tail = job.catch(() => { cached = undefined })
      return job
    },
    async close() {
      await tail
      await solver.close()
    },
  }
}

/** Verify persisted source identity and capture the attachment provenance of STEP features. */
export function gdtSources(snapshot: ProjectFileSnapshot, assembly: AssemblyModelV1,
  items: readonly { value: { id: string; featureId: string }; evidence: readonly EvidenceRef[] }[]) {
  const present = new Set(snapshot.attachments.map(attachment => attachment.blobKey))
  const features = new Map(assembly.features.map(feature => [feature.id, feature]))
  const parts = new Map(assembly.parts.map(part => [part.id, part]))
  return Object.fromEntries(items.map(({ value, evidence }) => {
    for (const citation of evidence) {
      const source = citation.kind === 'agent-read' ? citation.source : citation
      if ('revisionId' in source && !snapshot.revisions.some(row => row.id === source.revisionId &&
        row.sha256 === source.sha256 && row.pageCount >= source.page && present.has(row.blobKey) &&
        (!('documentId' in source) || row.documentId === source.documentId && row.blobKey === source.blobKey))) {
        throw Error('REFERENCE_STALE')
      }
      if ('imageId' in source && !snapshot.blobs.some(blob =>
        blob.blobKey === source.imageId && blob.sha256 === source.sha256 && present.has(blob.blobKey))) {
        throw Error('REFERENCE_STALE')
      }
      if (citation.kind === 'user-attestation' && citation.revokedAt) throw Error('REFERENCE_STALE')
    }
    const part = parts.get(features.get(value.featureId)?.partId ?? '')
    if (part?.kind !== 'imported-step') return [value.id, { evidence }]
    const attachment = snapshot.project.stepAttachments?.find(row => row.id === part.attachmentId)
    const blob = attachment && snapshot.blobs.find(row => row.blobKey === attachment.blobKey && present.has(row.blobKey))
    if (!blob) throw Error('REFERENCE_STALE')
    return [value.id, { evidence, step: { attachmentId: part.attachmentId, sha256: blob.sha256,
      solidIndex: part.solidIndex, featureId: value.featureId } }]
  }))
}
