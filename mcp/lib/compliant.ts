import { z } from 'zod'
import catalog from '../../cloud/contracts/mcp-compliant-tools.json' with { type: 'json' }
import {
  assemblyModelV1Schema,
  assemblyPhysicsSpecSchema,
  micMatrixPayloadV1Schema,
  type AssemblyModelV1,
  type AssemblyPhysicsSpec,
  type CompliantModelSpec,
  type MicMatrixPayloadV1,
} from '../../src/project-file/assembly3d.ts'
import type { ProjectFileSnapshot } from '../../src/project-file/types.ts'
import type { EvidenceRef } from '../../src/document-extraction/types.ts'
import { provenanceRefSchema } from '../../src/project-file/validation.ts'
import { createSolverScheduler } from '../../src/core/solver/solverScheduler.mjs'
import {
  buildMicDisplacementField,
  evaluateMicBatch,
  parseAndValidateMicMatrix,
  prepareMicAttachment,
} from '../../src/core/solver/mic.mjs'
import type {
  AnalyzeCompliantStackupRequest,
  AnalyzeCompliantStackupResult,
  CompliantSimulationSummary,
  CompliantStackupMetrics,
  FlexContributionItem,
  PartDisplacementField,
} from '../../src/transport/types.ts'

export const compliantTools = catalog.tools

const text = z.string().regex(/\S/)
const epoch = z.int().nonnegative()
const stageFields = {
  projectId: text,
  expectedWriterEpoch: epoch,
  baseRevision: text,
  expectedDraftRevision: text.nullable(),
  idempotencyKey: text,
}
const evidenceListSchema = z.array(provenanceRefSchema).min(1)

export const physicsPatchSchema = assemblyPhysicsSpecSchema
  .omit({ micMatrixRef: true })
  .refine(patch => Object.keys(patch).length > 0, { message: 'Physics patch must supply at least one field' })

export const stagePhysicsSchema = z.strictObject({
  ...stageFields,
  physics: physicsPatchSchema,
  evidenceByField: z
    .record(z.string().regex(/^\//), evidenceListSchema)
    .refine(record => Object.keys(record).length > 0, { message: 'At least one evidence entry is required' }),
})

export const importMicMatrixSchema = z.strictObject({
  ...stageFields,
  fileName: z.string().min(1).max(200),
  payload: micMatrixPayloadV1Schema,
  evidence: evidenceListSchema,
})

export const analyzeCompliantSchema = z.strictObject({
  projectId: text,
  draftRevision: text,
  expectedWriterEpoch: epoch,
  monteCarlo: z.strictObject({
    seed: epoch.max(0xffffffff),
    samples: epoch.min(1),
    distribution: z.enum(['normal', 'uniform']),
  }),
  whatIf: physicsPatchSchema.optional(),
})

const VALID_PHYSICS_PATCH_FIELDS = new Set(['materials', 'loads', 'initialWarp', 'enabled', 'compliantModels'])
const ENGINEERING_INPUT_FIELDS = ['materials', 'loads', 'initialWarp', 'compliantModels'] as const

function validateCompliantModelRefs(assembly: AssemblyModelV1, models: readonly CompliantModelSpec[] | undefined) {
  if (!models || models.length === 0) return
  const partIds = new Set(assembly.parts.map(part => part.id))
  const features = new Map(assembly.features.map(feature => [feature.id, feature]))
  const seenIds = new Set<string>()
  for (const model of models) {
    if (seenIds.has(model.id)) throw Error('Duplicate compliant model ID: ' + model.id)
    seenIds.add(model.id)
    switch (model.kind) {
      case 'axial-compression': {
        if (!partIds.has(model.partId)) throw Error('Unknown part: ' + model.partId)
        const feature = features.get(model.featureId)
        if (!feature || feature.partId !== model.partId) throw Error('Unknown feature for part: ' + model.featureId)
        break
      }
      case 'plate-clamping': {
        if (!partIds.has(model.partId)) throw Error('Unknown part: ' + model.partId)
        const surface = features.get(model.surfaceFeatureId)
        if (!surface || surface.partId !== model.partId) throw Error('Unknown surface feature: ' + model.surfaceFeatureId)
        if (new Set(model.clampFeatureIds).size !== model.clampFeatureIds.length) {
          throw Error('Duplicate clampFeatureIds in plate-clamping model: ' + model.id)
        }
        for (const cid of model.clampFeatureIds) {
          if (!features.has(cid)) throw Error('Unknown clamp feature: ' + cid)
        }
        break
      }
      case 'beam-bending': {
        if (!partIds.has(model.partId)) throw Error('Unknown part: ' + model.partId)
        const feature = features.get(model.loadFeatureId)
        if (!feature || feature.partId !== model.partId) throw Error('Unknown load feature: ' + model.loadFeatureId)
        break
      }
      case 'thermal-expansion': {
        for (const pid of model.partIds) {
          if (!partIds.has(pid)) throw Error('Unknown part: ' + pid)
        }
        if (model.referenceFeatureId && !features.has(model.referenceFeatureId)) {
          throw Error('Unknown reference feature: ' + model.referenceFeatureId)
        }
        break
      }
    }
  }
}

export function stagePhysicsPatch(
  assembly: AssemblyModelV1,
  request: z.infer<typeof stagePhysicsSchema>,
): AssemblyModelV1 {
  const pointers = Object.keys(request.evidenceByField)
  for (const pointer of pointers) {
    const topField = pointer.slice(1).split('/')[0] ?? ''
    if (!VALID_PHYSICS_PATCH_FIELDS.has(topField)) {
      throw Error('Invalid physics evidence pointer: ' + pointer)
    }
  }
  for (const field of ENGINEERING_INPUT_FIELDS) {
    if (request.physics[field] !== undefined) {
      const covered = pointers.some(pointer => pointer === `/${field}` || pointer.startsWith(`/${field}/`))
      if (!covered) {
        throw Error(`Missing EvidenceRef for changed physics field /${field}`)
      }
    }
  }
  const nextPhysics: AssemblyPhysicsSpec = {
    ...(assembly.physics ?? {}),
    ...request.physics,
  }
  validateCompliantModelRefs(assembly, nextPhysics.compliantModels)
  return assemblyModelV1Schema.parse({ ...assembly, physics: nextPhysics })
}

export async function stageMicMatrix(
  assembly: AssemblyModelV1,
  request: z.infer<typeof importMicMatrixSchema>,
) {
  parseAndValidateMicMatrix(request.payload)
  if (!assembly.parts.some(part => part.id === request.payload.partId)) {
    throw Error('UNKNOWN_PART')
  }
  const prepared = await prepareMicAttachment(request.payload, {
    fileName: request.fileName,
    evidence: request.evidence,
  })
  const nextPhysics: AssemblyPhysicsSpec = {
    ...(assembly.physics ?? {}),
    micMatrixRef: prepared.micMatrixRef,
  }
  const updated = assemblyModelV1Schema.parse({ ...assembly, physics: nextPhysics })
  return { assembly: updated, prepared }
}

/** Verify persisted source identity for EvidenceRef citations against the project snapshot. */
export function verifyEvidenceRefs(
  snapshot: ProjectFileSnapshot,
  evidenceList: readonly EvidenceRef[],
): void {
  const present = new Set(snapshot.attachments.map(attachment => attachment.blobKey))
  for (const citation of evidenceList) {
    const source = citation.kind === 'agent-read' ? citation.source : citation
    if (
      'revisionId' in source &&
      !snapshot.revisions.some(
        row =>
          row.id === source.revisionId &&
          row.sha256 === source.sha256 &&
          row.pageCount >= source.page &&
          present.has(row.blobKey) &&
          (!('documentId' in source) || (row.documentId === source.documentId && row.blobKey === source.blobKey)),
      )
    ) {
      throw Error('REFERENCE_STALE')
    }
    if (
      'imageId' in source &&
      !snapshot.blobs.some(
        blob => blob.blobKey === source.imageId && blob.sha256 === source.sha256 && present.has(blob.blobKey),
      )
    ) {
      throw Error('REFERENCE_STALE')
    }
    if (citation.kind === 'user-attestation' && citation.revokedAt) {
      throw Error('REFERENCE_STALE')
    }
  }
}

function featurePositionMm(assembly: AssemblyModelV1, featureId: string): [number, number, number] {
  const feature = assembly.features.find(item => item.id === featureId)
  if (!feature) return [0, 0, 0]
  if (feature.kind === 'face' || feature.kind === 'cylindrical-hole-axis') {
    return [feature.originQ[0] / 10000, feature.originQ[1] / 10000, feature.originQ[2] / 10000]
  }
  if (feature.kind === 'cone') {
    return [feature.apexQ[0] / 10000, feature.apexQ[1] / 10000, feature.apexQ[2] / 10000]
  }
  if (feature.kind === 'point') {
    return [feature.positionQ[0] / 10000, feature.positionQ[1] / 10000, feature.positionQ[2] / 10000]
  }
  return [
    (feature.startQ[0] + feature.endQ[0]) / 20000,
    (feature.startQ[1] + feature.endQ[1]) / 20000,
    (feature.startQ[2] + feature.endQ[2]) / 20000,
  ]
}

function estimateFallbackCompliant(
  assembly: AssemblyModelV1,
  rigidBaseline: CompliantStackupMetrics,
  micPayloads?: Readonly<Record<string, MicMatrixPayloadV1>>,
): { summary: CompliantSimulationSummary; displacementFields: PartDisplacementField[] } {
  const physics = assembly.physics
  const hasModels = Boolean(physics?.compliantModels && physics.compliantModels.length > 0)
  const micPayload = physics?.micMatrixRef && micPayloads ? micPayloads[physics.micMatrixRef] : undefined
  const isEnabled = physics ? (physics.enabled ?? (hasModels || Boolean(micPayload))) : false

  if (!isEnabled || (!hasModels && !micPayload)) {
    return {
      summary: {
        rigidBaseline,
        compliantResult: {
          cpk: rigidBaseline.cpk,
          ppm: rigidBaseline.ppm,
          threeSigmaIntervalMm: [rigidBaseline.threeSigmaIntervalMm[0], rigidBaseline.threeSigmaIntervalMm[1]],
        },
        flexDeltaCpk: rigidBaseline.cpk === null ? null : 0,
        flexContributionItems: [],
      },
      displacementFields: [],
    }
  }

  const materialByPart = new Map((physics?.materials ?? []).map(mat => [mat.partId, mat]))
  const displacementsByPart = new Map<
    string,
    { posMm: [number, number, number]; dispMm: [number, number, number]; magMm: number }[]
  >()
  const rawVariances: { modelId: string; label: string; kind: FlexContributionItem['kind']; shiftMm: number; sigmaMm: number }[] = []

  const pushSample = (partId: string, posMm: [number, number, number], dispMm: [number, number, number]) => {
    const magMm = Math.hypot(dispMm[0], dispMm[1], dispMm[2])
    const list = displacementsByPart.get(partId) ?? []
    list.push({ posMm, dispMm, magMm })
    displacementsByPart.set(partId, list)
  }

  for (const model of physics?.compliantModels ?? []) {
    switch (model.kind) {
      case 'axial-compression': {
        const mat = materialByPart.get(model.partId)
        const E = mat?.youngsModulusMpa ?? 200_000
        const stiffness =
          model.stiffnessNPerMm ??
          (model.effectiveAreaMm2 && model.lengthMm ? (E * model.effectiveAreaMm2) / model.lengthMm : E * 10)
        const factor = 1 - (model.springbackRatio ?? 0)
        const deltaMm = (model.preloadN / stiffness) * factor
        const sigmaMm = ((model.preloadTolN ?? model.preloadN * 0.05) / stiffness) * factor / 3
        const pos = featurePositionMm(assembly, model.featureId)
        pushSample(model.partId, pos, [0, 0, -deltaMm])
        rawVariances.push({
          modelId: model.id,
          label: `轴向压缩 ${model.id}`,
          kind: 'axial-compression',
          shiftMm: -deltaMm,
          sigmaMm: Math.abs(sigmaMm),
        })
        break
      }
      case 'plate-clamping': {
        const mat = materialByPart.get(model.partId)
        const E = mat?.youngsModulusMpa ?? 68_900
        const t = model.thicknessQ / 10000
        const w0 = model.initialWarpPeakQ / 10000
        const clampRatio = model.clampForceN ? Math.min(0.85, model.clampForceN / (E * t * t * 0.01 + model.clampForceN)) : 0.7
        const residualMm = w0 * (1 - clampRatio)
        const sigmaMm = ((model.warpTolQ ?? Math.abs(model.initialWarpPeakQ) * 0.1) / 10000) * (1 - clampRatio) / 3
        const center = featurePositionMm(assembly, model.surfaceFeatureId)
        pushSample(model.partId, center, [0, 0, residualMm])
        for (const cid of model.clampFeatureIds) {
          pushSample(model.partId, featurePositionMm(assembly, cid), [0, 0, residualMm * 0.1])
        }
        rawVariances.push({
          modelId: model.id,
          label: `薄板锁紧翘曲 ${model.id}`,
          kind: 'plate-clamping',
          shiftMm: residualMm,
          sigmaMm: Math.abs(sigmaMm),
        })
        break
      }
      case 'beam-bending': {
        const mat = materialByPart.get(model.partId)
        const E = mat?.youngsModulusMpa ?? 200_000
        const denom = (model.supportKind === 'cantilever' ? 3 : 48) * E * model.momentOfInertiaMm4
        const deltaMm = (model.forceN * Math.pow(model.spanMm, 3)) / denom
        const sigmaMm = ((model.forceTolN ?? Math.abs(model.forceN) * 0.05) * Math.pow(model.spanMm, 3)) / denom / 3
        const dir = model.direction ?? [0, 0, 1]
        const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
        const pos = featurePositionMm(assembly, model.loadFeatureId)
        pushSample(model.partId, pos, [(deltaMm * dir[0]) / len, (deltaMm * dir[1]) / len, (deltaMm * dir[2]) / len])
        rawVariances.push({
          modelId: model.id,
          label: `梁弯曲 ${model.id}`,
          kind: 'beam-bending',
          shiftMm: deltaMm,
          sigmaMm: Math.abs(sigmaMm),
        })
        break
      }
      case 'thermal-expansion': {
        let totalShift = 0
        let totalSigma = 0
        for (const pid of model.partIds) {
          const mat = materialByPart.get(pid)
          const alpha = mat?.thermalExpansionPerK ?? 12e-6
          const deltaMm = alpha * model.deltaTemperatureK * 50
          const sigmaMm = Math.abs(alpha * (model.deltaTempTolK ?? 2) * 50) / 3
          totalShift += deltaMm
          totalSigma = Math.hypot(totalSigma, sigmaMm)
          const refPos = model.referenceFeatureId ? featurePositionMm(assembly, model.referenceFeatureId) : [0, 0, 0] as [number, number, number]
          pushSample(pid, refPos, [0, 0, deltaMm])
        }
        rawVariances.push({
          modelId: model.id,
          label: `温差热膨胀 ${model.id}`,
          kind: 'thermal-expansion',
          shiftMm: totalShift,
          sigmaMm: totalSigma,
        })
        break
      }
    }
  }

  if (micPayload) {
    const compiled = parseAndValidateMicMatrix(micPayload)
    const loadVec = new Float64Array(compiled.cols)
    loadVec.fill(1)
    const evaluated = evaluateMicBatch(compiled, loadVec)
    const field = buildMicDisplacementField(compiled, evaluated.displacements)
    const list = displacementsByPart.get(field.partId) ?? []
    for (const s of field.samples) {
      list.push({
        posMm: [s.posMm[0], s.posMm[1], s.posMm[2]],
        dispMm: [s.dispMm[0], s.dispMm[1], s.dispMm[2]],
        magMm: s.magMm,
      })
    }
    displacementsByPart.set(field.partId, list)
    rawVariances.push({
      modelId: physics?.micMatrixRef ?? 'mic-matrix',
      label: `MIC 影响矩阵 (${micPayload.partId})`,
      kind: 'mic-matrix',
      shiftMm: field.maxDisplacementMm,
      sigmaMm: field.maxDisplacementMm * 0.1,
    })
  }

  const totalShift = rawVariances.reduce((acc, item) => acc + item.shiftMm, 0)
  const rigidHalfSpan = Math.max(0, (rigidBaseline.threeSigmaIntervalMm[1] - rigidBaseline.threeSigmaIntervalMm[0]) / 2)
  const rigidSigma = rigidHalfSpan / 3
  const flexVariance = rawVariances.reduce((acc, item) => acc + item.sigmaMm * item.sigmaMm, 0)
  const totalVariance = rigidSigma * rigidSigma + flexVariance
  const totalSigma = Math.sqrt(totalVariance)
  const rigidMid = (rigidBaseline.threeSigmaIntervalMm[0] + rigidBaseline.threeSigmaIntervalMm[1]) / 2
  const compliantMid = rigidMid + totalShift
  const compliantInterval: [number, number] = [compliantMid - 3 * totalSigma, compliantMid + 3 * totalSigma]

  let compliantCpk: number | null = rigidBaseline.cpk
  let compliantPpm = rigidBaseline.ppm
  if (rigidBaseline.cpk !== null && totalSigma > 0) {
    const scale = rigidSigma > 0 ? rigidSigma / totalSigma : 1
    const shiftPenalty = totalSigma > 0 ? Math.abs(totalShift) / (3 * totalSigma) : 0
    compliantCpk = Math.max(0, Number((rigidBaseline.cpk * scale - shiftPenalty * 0.25).toFixed(4)))
    if (compliantCpk < rigidBaseline.cpk) {
      compliantPpm = Math.min(1_000_000, Math.max(rigidBaseline.ppm, Math.round(rigidBaseline.ppm + (rigidBaseline.cpk - compliantCpk) * 5000)))
    }
  } else if (Math.abs(totalShift) > 0 && rigidBaseline.cpk === null) {
    compliantCpk = null
  }

  const flexContributionItems: FlexContributionItem[] = rawVariances.map(item => ({
    modelId: item.modelId,
    label: item.label,
    kind: item.kind,
    varianceSharePct:
      totalVariance > 0
        ? Math.min(100, Math.max(0, Number((((item.sigmaMm * item.sigmaMm) / totalVariance) * 100).toFixed(2))))
        : 0,
  }))

  const displacementFields: PartDisplacementField[] = [...displacementsByPart.entries()].map(([partId, samples]) => {
    let minDisp = samples.length > 0 ? Infinity : 0
    let maxDisp = 0
    for (const sample of samples) {
      if (sample.magMm < minDisp) minDisp = sample.magMm
      if (sample.magMm > maxDisp) maxDisp = sample.magMm
    }
    return {
      partId,
      minDisplacementMm: minDisp,
      maxDisplacementMm: maxDisp,
      samples,
    }
  })

  return {
    summary: {
      rigidBaseline,
      compliantResult: {
        cpk: compliantCpk,
        ppm: compliantPpm,
        threeSigmaIntervalMm: compliantInterval,
      },
      flexDeltaCpk:
        compliantCpk !== null && rigidBaseline.cpk !== null
          ? Number((compliantCpk - rigidBaseline.cpk).toFixed(4))
          : null,
      flexContributionItems,
    },
    displacementFields,
  }
}

export function createCompliantAnalyzer(workerUrl?: URL) {
  const solver = createSolverScheduler(workerUrl)
  let tail: Promise<unknown> = Promise.resolve()

  return {
    run(
      assembly: AssemblyModelV1,
      request: AnalyzeCompliantStackupRequest,
      options?: {
        signal?: AbortSignal
        timeoutMs?: number
        micPayloads?: Readonly<Record<string, MicMatrixPayloadV1>>
      },
    ): Promise<AnalyzeCompliantStackupResult> {
      const { projectId, draftRevision, monteCarlo, whatIf } = request
      const { samples, seed, distribution } = monteCarlo
      const job = tail.then(async () => {
        options?.signal?.throwIfAborted()
        if (samples < 1 || samples > 50_000) throw Error('SIMULATION_LIMIT')
        let effectiveAssembly = assembly
        if (whatIf) {
          try {
            const nextPhysics: AssemblyPhysicsSpec = {
              ...(assembly.physics ?? {}),
              ...whatIf,
            }
            validateCompliantModelRefs(assembly, nextPhysics.compliantModels)
            effectiveAssembly = assemblyModelV1Schema.parse({ ...assembly, physics: nextPhysics })
          } catch {
            throw Error('INVALID_WHAT_IF')
          }
        }
        const workerInput = {
          assembly: effectiveAssembly,
          samples,
          seed,
          gdtDistribution: distribution,
          parameters: [],
          ...(options?.micPayloads ? { micPayloads: options.micPayloads } : {}),
        }
        const baseResult = await solver.run(
          { kind: 'multivariate', inputs: workerInput },
          options,
        )
        if (baseResult.status !== 'ok') throw Error('ASSEMBLY_OVERCONSTRAINED')
        const result = baseResult as typeof baseResult & {
          compliant?: CompliantSimulationSummary
          displacementFields?: PartDisplacementField[]
        }

        if (result.compliant && Array.isArray(result.displacementFields)) {
          return {
            projectId,
            draftRevision,
            monteCarlo,
            summary: result.compliant,
            displacementFields: result.displacementFields,
          }
        }

        const primaryMeasurement = result.measurements[0]
        const rigidBaseline: CompliantStackupMetrics = result.gdt?.baseline
          ? {
              cpk: result.gdt.baseline.cpk,
              ppm: result.gdt.baseline.ppm,
              threeSigmaIntervalMm: [
                result.gdt.baseline.threeSigmaIntervalMm[0],
                result.gdt.baseline.threeSigmaIntervalMm[1],
              ],
            }
          : primaryMeasurement
            ? {
                cpk: primaryMeasurement.cpk,
                ppm: primaryMeasurement.ppm ?? 0,
                threeSigmaIntervalMm: [primaryMeasurement.threeSigma.min, primaryMeasurement.threeSigma.max],
              }
            : {
                cpk: null,
                ppm: 0,
                threeSigmaIntervalMm: [0, 0],
              }

        const fallback = estimateFallbackCompliant(effectiveAssembly, rigidBaseline, options?.micPayloads)
        return {
          projectId,
          draftRevision,
          monteCarlo,
          summary: fallback.summary,
          displacementFields: fallback.displacementFields,
        }
      })
      tail = job.catch(() => {})
      return job
    },
    async close() {
      await tail
      await solver.close()
    },
  }
}
