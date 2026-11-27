import {
  micMatrixPayloadV1Schema,
  type AssemblyPhysicsSpec,
  type CompliantModelSpec,
  type GdtFeatureControl,
  type MaterialSpec,
  type MicMatrixPayloadV1,
} from '../../project-file/assembly3d'
import type {
  CompliantSimulationSummary,
  CompliantStackupMetrics,
  FlexContributionItem,
  GdtContributionItem,
  PartDisplacementField,
} from '../../transport/types'
import type {
  AiPhysicsDraftItem,
  PartMesh,
  SimulationDiagnosticResult,
} from './assembly3dTypes'

export interface EngineeringMaterialPreset {
  readonly presetId: string
  readonly name: string
  readonly youngsModulusMpa: number
  readonly poissonRatio: number
  readonly thermalExpansionPerK: number
  readonly defaultDeltaTemperatureK: number
  readonly yieldStrengthMpa: number
}

/** 9 engineering material presets aligned with M4 PRD §3.1 & §4 F1-1. */
export const ENGINEERING_MATERIAL_PRESETS: readonly EngineeringMaterialPreset[] = [
  {
    presetId: 'steel-45',
    name: '45# 钢',
    youngsModulusMpa: 210_000,
    poissonRatio: 0.29,
    thermalExpansionPerK: 11.5e-6,
    defaultDeltaTemperatureK: 20,
    yieldStrengthMpa: 355,
  },
  {
    presetId: 'sus304',
    name: 'SUS304 不锈钢',
    youngsModulusMpa: 193_000,
    poissonRatio: 0.29,
    thermalExpansionPerK: 17.3e-6,
    defaultDeltaTemperatureK: 20,
    yieldStrengthMpa: 215,
  },
  {
    presetId: 'al-6061',
    name: '6061-T6 铝合金',
    youngsModulusMpa: 68_900,
    poissonRatio: 0.33,
    thermalExpansionPerK: 23.6e-6,
    defaultDeltaTemperatureK: 20,
    yieldStrengthMpa: 276,
  },
  {
    presetId: 'al-5052',
    name: '5052 铝板',
    youngsModulusMpa: 70_300,
    poissonRatio: 0.33,
    thermalExpansionPerK: 23.8e-6,
    defaultDeltaTemperatureK: 20,
    yieldStrengthMpa: 193,
  },
  {
    presetId: 'brass-h62',
    name: 'H62 黄铜',
    youngsModulusMpa: 105_000,
    poissonRatio: 0.34,
    thermalExpansionPerK: 20.5e-6,
    defaultDeltaTemperatureK: 20,
    yieldStrengthMpa: 200,
  },
  {
    presetId: 'abs',
    name: 'ABS',
    youngsModulusMpa: 2_300,
    poissonRatio: 0.35,
    thermalExpansionPerK: 85e-6,
    defaultDeltaTemperatureK: 20,
    yieldStrengthMpa: 42,
  },
  {
    presetId: 'pc',
    name: 'PC',
    youngsModulusMpa: 2_400,
    poissonRatio: 0.37,
    thermalExpansionPerK: 68e-6,
    defaultDeltaTemperatureK: 20,
    yieldStrengthMpa: 60,
  },
  {
    presetId: 'pa66',
    name: 'PA66+30%GF',
    youngsModulusMpa: 9_000,
    poissonRatio: 0.38,
    thermalExpansionPerK: 30e-6,
    defaultDeltaTemperatureK: 20,
    yieldStrengthMpa: 165,
  },
  {
    presetId: 'silicone-epdm',
    name: '硅胶/EPDM 垫片',
    youngsModulusMpa: 12,
    poissonRatio: 0.47,
    thermalExpansionPerK: 160e-6,
    defaultDeltaTemperatureK: 20,
    yieldStrengthMpa: 8,
  },
]

export const COMPLIANT_MODEL_LABELS: Readonly<Record<CompliantModelSpec['kind'] | 'mic-matrix', string>> = {
  'axial-compression': '轴向压缩',
  'plate-clamping': '薄板锁紧翘曲',
  'beam-bending': '梁弯曲',
  'thermal-expansion': '热膨胀',
  'mic-matrix': 'MIC 柔度矩阵',
}

export function findMaterialPreset(presetId: string): EngineeringMaterialPreset | undefined {
  return ENGINEERING_MATERIAL_PRESETS.find((p) => p.presetId === presetId)
}

export function createMaterialFromPreset(partId: string, presetId: string): MaterialSpec {
  const preset = findMaterialPreset(presetId) ?? ENGINEERING_MATERIAL_PRESETS[2]
  return {
    partId,
    presetId: preset.presetId,
    name: preset.name,
    youngsModulusMpa: preset.youngsModulusMpa,
    poissonRatio: preset.poissonRatio,
    thermalExpansionPerK: preset.thermalExpansionPerK,
    deltaTemperatureK: preset.defaultDeltaTemperatureK,
    yieldStrengthMpa: preset.yieldStrengthMpa,
  }
}

/**
 * Warm monochromatic deformation colormap (v1.1.0):
 * neutral stone (#5a5853) -> warm sand (#9b876a) -> terracotta (#cc785c) -> matte rust red (#c9564b).
 * Clamps normalized `t` into [0, 1] and returns RGB components in [0, 1].
 */
export const WARM_HEAT_STOPS: readonly (readonly [number, number, number, number])[] = [
  [0.0, 90 / 255, 88 / 255, 83 / 255], // neutral stone #5a5853
  [0.45, 155 / 255, 135 / 255, 106 / 255], // warm sand #9b876a
  [0.8, 204 / 255, 120 / 255, 92 / 255], // terracotta #cc785c
  [1.0, 201 / 255, 86 / 255, 75 / 255], // matte rust red #c9564b
]

export function mapNormalizedValueToTurboColor(t: number): readonly [number, number, number] {
  const clamped = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0
  for (let i = 0; i < WARM_HEAT_STOPS.length - 1; i += 1) {
    const a = WARM_HEAT_STOPS[i]
    const b = WARM_HEAT_STOPS[i + 1]
    if (clamped >= a[0] && clamped <= b[0]) {
      const span = b[0] - a[0]
      const f = span > 0 ? (clamped - a[0]) / span : 0
      return [
        a[1] + (b[1] - a[1]) * f,
        a[2] + (b[2] - a[2]) * f,
        a[3] + (b[3] - a[3]) * f,
      ]
    }
  }
  const last = WARM_HEAT_STOPS[WARM_HEAT_STOPS.length - 1]
  return [last[1], last[2], last[3]]
}

export function turboRgbToCssHex(rgb: readonly [number, number, number]): string {
  const toByte = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0')
  return `#${toByte(rgb[0])}${toByte(rgb[1])}${toByte(rgb[2])}`
}

export interface InterpolatedPartDisplacement {
  readonly displacements: Float32Array
  readonly magnitudes: Float32Array
  readonly maxDisplacementMm: number
}

/**
 * Inverse-distance weighted (IDW) radial interpolation from a discrete
 * `PartDisplacementField` onto every mesh vertex in `basePositions`.
 */
export function interpolatePartDisplacementField(
  basePositions: Float32Array | readonly number[],
  field: PartDisplacementField | null | undefined,
): InterpolatedPartDisplacement {
  const vertexCount = Math.floor(basePositions.length / 3)
  const displacements = new Float32Array(vertexCount * 3)
  const magnitudes = new Float32Array(vertexCount)

  if (!field || field.samples.length === 0 || vertexCount === 0) {
    return { displacements, magnitudes, maxDisplacementMm: 0 }
  }

  const samples = field.samples
  const sampleCount = samples.length
  let maxMag = 0
  const eps = 1e-6

  for (let i = 0; i < vertexCount; i += 1) {
    const vx = basePositions[i * 3] ?? 0
    const vy = basePositions[i * 3 + 1] ?? 0
    const vz = basePositions[i * 3 + 2] ?? 0

    let exactIndex = -1
    let weightSum = 0
    let dx = 0
    let dy = 0
    let dz = 0

    for (let s = 0; s < sampleCount; s += 1) {
      const sample = samples[s]
      const sx = vx - sample.posMm[0]
      const sy = vy - sample.posMm[1]
      const sz = vz - sample.posMm[2]
      const distSq = sx * sx + sy * sy + sz * sz
      if (distSq < 1e-10) {
        exactIndex = s
        break
      }
      const w = 1 / (distSq + eps)
      weightSum += w
      dx += sample.dispMm[0] * w
      dy += sample.dispMm[1] * w
      dz += sample.dispMm[2] * w
    }

    let fx: number
    let fy: number
    let fz: number
    if (exactIndex >= 0) {
      const exact = samples[exactIndex]
      fx = exact.dispMm[0]
      fy = exact.dispMm[1]
      fz = exact.dispMm[2]
    } else if (weightSum > 0) {
      fx = dx / weightSum
      fy = dy / weightSum
      fz = dz / weightSum
    } else {
      fx = 0
      fy = 0
      fz = 0
    }

    displacements[i * 3] = fx
    displacements[i * 3 + 1] = fy
    displacements[i * 3 + 2] = fz
    const mag = Math.hypot(fx, fy, fz)
    magnitudes[i] = mag
    if (mag > maxMag) maxMag = mag
  }

  return {
    displacements,
    magnitudes,
    maxDisplacementMm: Math.max(maxMag, field.maxDisplacementMm),
  }
}

/**
 * Builds (or writes into an existing) RGB Float32Array (length = vertexCount * 3)
 * using the Turbo/Jet colormap normalized by `maxMm`.
 */
export function buildVertexColorBuffer(
  magnitudes: Float32Array | readonly number[],
  maxMm: number,
  outBuffer?: Float32Array,
): Float32Array {
  const count = magnitudes.length
  const target =
    outBuffer && outBuffer.length === count * 3 ? outBuffer : new Float32Array(count * 3)
  const denom = maxMm > 1e-9 ? maxMm : 1

  for (let i = 0; i < count; i += 1) {
    const t = Math.max(0, Math.min(1, (magnitudes[i] ?? 0) / denom))
    const rgb = mapNormalizedValueToTurboColor(t)
    target[i * 3] = rgb[0]
    target[i * 3 + 1] = rgb[1]
    target[i * 3 + 2] = rgb[2]
  }
  return target
}

/**
 * In-place exaggerated vertex displacement updater for 60fps requestAnimationFrame loops.
 * Zero new object or typed-array allocations.
 */
export function applyExaggeratedDisplacement(
  basePositions: Float32Array,
  vertexDisplacements: Float32Array,
  targetPositions: Float32Array,
  scale: number,
  phase: number,
): void {
  const len = Math.min(basePositions.length, vertexDisplacements.length, targetPositions.length)
  const factor = (Number.isFinite(scale) ? scale : 1) * (Number.isFinite(phase) ? phase : 0)
  for (let i = 0; i < len; i += 1) {
    targetPositions[i] = basePositions[i] + vertexDisplacements[i] * factor
  }
}

/** Smooth cyclic animation phase in [0, 1] for free-state <-> clamped-state motion. */
export function computeAnimationPhase(elapsedSec: number, frequencyHz = 0.45): number {
  if (!Number.isFinite(elapsedSec)) return 0
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * frequencyHz * elapsedSec)
}

export interface MicMatrixSummary {
  readonly partId: string
  readonly solverName: string
  readonly meshNodes: number | null
  readonly controlPointCount: number
  readonly measurePointCount: number
  readonly generatedAtIso: string | null
}

export type MicMatrixValidationResult =
  | { readonly ok: true; readonly payload: MicMatrixPayloadV1; readonly summary: MicMatrixSummary }
  | { readonly ok: false; readonly errors: readonly string[] }

/** Validates raw JSON text against frozen `micMatrixPayloadV1Schema` + finite number checks. */
export function validateMicMatrixJson(rawText: string): MicMatrixValidationResult {
  const trimmed = rawText.trim()
  if (!trimmed) {
    return { ok: false, errors: ['请先选择或粘贴 MIC 影响系数矩阵 JSON 内容。'] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, errors: [`JSON 语法解析失败：${msg}`] }
  }

  const result = micMatrixPayloadV1Schema.safeParse(parsed)
  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root'
      return `${path}: ${issue.message}`
    })
    return { ok: false, errors }
  }

  const payload = result.data
  if (payload.controlPointsMm.length === 0 || payload.measurePointsMm.length === 0) {
    return {
      ok: false,
      errors: ['MIC 矩阵至少需要 1 个控制点（controlPointsMm）与 1 个观测点（measurePointsMm）。'],
    }
  }

  for (let r = 0; r < payload.sensitivityMatrix.length; r += 1) {
    const row = payload.sensitivityMatrix[r]
    for (let c = 0; c < row.length; c += 1) {
      if (!Number.isFinite(row[c])) {
        return {
          ok: false,
          errors: [`sensitivityMatrix[${r}][${c}] 包含非有限实数。`],
        }
      }
    }
  }

  return {
    ok: true,
    payload,
    summary: {
      partId: payload.partId,
      solverName: payload.sourceMeta?.solverName ?? '未知求解器',
      meshNodes: payload.sourceMeta?.meshNodes ?? null,
      controlPointCount: payload.controlPointsMm.length,
      measurePointCount: payload.measurePointsMm.length,
      generatedAtIso: payload.sourceMeta?.generatedAtIso ?? null,
    },
  }
}

/** Collects part IDs that have active compliant models, materials, or MIC bindings. */
export function collectCompliantPartIds(physics: AssemblyPhysicsSpec | undefined): ReadonlySet<string> {
  const ids = new Set<string>()
  if (!physics) return ids
  for (const model of physics.compliantModels ?? []) {
    if (model.kind === 'thermal-expansion') {
      for (const pid of model.partIds) ids.add(pid)
    } else {
      ids.add(model.partId)
    }
  }
  for (const mat of physics.materials ?? []) {
    ids.add(mat.partId)
  }
  return ids
}

/**
 * Synthesizes deterministic per-part displacement fields from configured physics models
 * so 3D heatmaps & exaggerated animations render accurately even in local fallback mode.
 */
export function synthesizePreviewDisplacementFields(
  partMeshes: readonly PartMesh[],
  physics: AssemblyPhysicsSpec | undefined,
): readonly PartDisplacementField[] {
  if (!physics || physics.enabled === false || partMeshes.length === 0) {
    return []
  }
  const models = physics.compliantModels ?? []
  const materials = physics.materials ?? []
  if (models.length === 0 && materials.length === 0 && !physics.micMatrixRef) {
    return []
  }

  const fields: PartDisplacementField[] = []

  for (const part of partMeshes) {
    const partModels = models.filter((m) =>
      m.kind === 'thermal-expansion' ? m.partIds.includes(part.partId) : m.partId === part.partId,
    )
    const partMaterial = materials.find((m) => m.partId === part.partId)
    if (partModels.length === 0 && !partMaterial) continue

    const minX = part.bounds.min[0]
    const maxX = part.bounds.max[0]
    const minY = part.bounds.min[1]
    const maxY = part.bounds.max[1]
    const minZ = part.bounds.min[2]
    const maxZ = part.bounds.max[2]
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const cz = (minZ + maxZ) / 2
    const spanX = Math.max(1, maxX - minX)
    const spanY = Math.max(1, maxY - minY)

    // Estimate peak displacement magnitude (mm) from active physical models
    let peakZ = 0
    let peakAxialZ = 0
    let peakThermalXY = 0

    for (const model of partModels) {
      if (model.kind === 'plate-clamping') {
        const warpMm = Math.abs(model.initialWarpPeakQ) / 10000
        peakZ = Math.max(peakZ, warpMm * 0.65)
      } else if (model.kind === 'axial-compression') {
        const k = model.stiffnessNPerMm ?? Math.max(500, (partMaterial?.youngsModulusMpa ?? 12) * 15)
        const compMm = (model.preloadN / k) * (1 - (model.springbackRatio ?? 0))
        peakAxialZ = Math.max(peakAxialZ, Math.min(0.45, Math.max(0.015, compMm)))
      } else if (model.kind === 'beam-bending') {
        const E = partMaterial?.youngsModulusMpa ?? 68_900
        const rawDefl =
          (Math.abs(model.forceN) * Math.pow(model.spanMm, 3)) /
          ((model.supportKind === 'cantilever' ? 3 : 48) * E * model.momentOfInertiaMm4)
        peakZ = Math.max(peakZ, Math.min(0.6, Math.max(0.02, rawDefl)))
      } else if (model.kind === 'thermal-expansion') {
        const alpha = partMaterial?.thermalExpansionPerK ?? 23.6e-6
        const dT = model.deltaTemperatureK
        peakThermalXY = Math.max(peakThermalXY, Math.abs(alpha * dT * (spanX * 0.5)))
        if (model.bimetallicCoupling) {
          peakZ = Math.max(peakZ, Math.min(0.25, Math.abs(dT) * 0.0012))
        }
      }
    }

    if (peakZ === 0 && peakAxialZ === 0 && peakThermalXY === 0 && partMaterial) {
      peakZ = Math.max(0.02, Math.min(0.18, 2500 / Math.max(12, partMaterial.youngsModulusMpa) * 0.08))
    }

    // Generate a 3x3 grid of control samples across the part top face + center
    const samples: Array<{
      readonly posMm: readonly [number, number, number]
      readonly dispMm: readonly [number, number, number]
      readonly magMm: number
    }> = []

    let maxDisp = 0
    let minDisp = Number.POSITIVE_INFINITY

    for (let gx = 0; gx <= 2; gx += 1) {
      for (let gy = 0; gy <= 2; gy += 1) {
        const u = gx / 2
        const v = gy / 2
        const px = minX + u * spanX
        const py = minY + v * spanY
        const pz = maxZ
        // Clamped corners have low Z residual; center has peak residual bulge
        const cornerFactor = Math.sin(Math.PI * u) * Math.sin(Math.PI * v)
        const dx = (px - cx) / (spanX * 0.5) * peakThermalXY
        const dy = (py - cy) / (spanY * 0.5) * peakThermalXY
        const dz = peakZ * (0.12 + 0.88 * cornerFactor) - peakAxialZ * (0.4 + 0.6 * (1 - cornerFactor))
        const mag = Math.hypot(dx, dy, dz)
        if (mag > maxDisp) maxDisp = mag
        if (mag < minDisp) minDisp = mag
        samples.push({
          posMm: [px, py, pz],
          dispMm: [dx, dy, dz],
          magMm: mag,
        })
      }
    }

    // Add bottom center anchor sample
    const botMag = peakAxialZ * 0.15
    if (botMag < minDisp) minDisp = botMag
    if (botMag > maxDisp) maxDisp = botMag
    samples.push({
      posMm: [cx, cy, minZ === maxZ ? cz : minZ],
      dispMm: [0, 0, -botMag],
      magMm: botMag,
    })

    fields.push({
      partId: part.partId,
      maxDisplacementMm: Math.round(maxDisp * 10000) / 10000,
      minDisplacementMm: Number.isFinite(minDisp) ? Math.round(minDisp * 10000) / 10000 : 0,
      samples,
    })
  }

  return fields
}

export interface UnifiedParetoItem {
  readonly id: string
  readonly kind: 'dimension' | 'gdt' | 'flex'
  readonly label: string
  readonly badge: string
  readonly varianceSharePct: number
  readonly partId?: string
  readonly featureId?: string
  readonly gdtId?: string
  readonly modelId?: string
  readonly contributorId?: string
}

/**
 * Merges dimensional contributors, GD&T controls, and flexible models into a single
 * descending Pareto ranking by variance share %.
 */
export function buildUnifiedParetoItems(
  result: SimulationDiagnosticResult,
  options?: {
    readonly includeCompliant?: boolean
    readonly gdtControls?: readonly GdtFeatureControl[]
    readonly physics?: AssemblyPhysicsSpec
  },
): readonly UnifiedParetoItem[] {
  const items: UnifiedParetoItem[] = []
  const gdtById = new Map((options?.gdtControls ?? []).map((g) => [g.id, g]))
  const modelById = new Map((options?.physics?.compliantModels ?? []).map((m) => [m.id, m]))

  const flexItems: readonly FlexContributionItem[] =
    options?.includeCompliant !== false ? (result.compliantSummary?.flexContributionItems ?? []) : []
  const gdtItems: readonly GdtContributionItem[] = result.gdtContributions ?? []

  for (const flex of flexItems) {
    const model = modelById.get(flex.modelId)
    const partId =
      model && model.kind !== 'thermal-expansion'
        ? model.partId
        : model?.kind === 'thermal-expansion'
          ? model.partIds[0]
          : undefined
    const featureId =
      model?.kind === 'axial-compression'
        ? model.featureId
        : model?.kind === 'plate-clamping'
          ? model.surfaceFeatureId
          : model?.kind === 'beam-bending'
            ? model.loadFeatureId
            : model?.kind === 'thermal-expansion'
              ? model.referenceFeatureId
              : undefined
    items.push({
      id: `flex-${flex.modelId}`,
      kind: 'flex',
      label: flex.label,
      badge: COMPLIANT_MODEL_LABELS[flex.kind],
      varianceSharePct: flex.varianceSharePct,
      partId,
      featureId,
      modelId: flex.modelId,
    })
  }

  for (const gdt of gdtItems) {
    const control = gdtById.get(gdt.gdtId)
    items.push({
      id: `gdt-${gdt.gdtId}`,
      kind: 'gdt',
      label: gdt.label,
      badge: 'GD&T',
      varianceSharePct: gdt.varianceSharePct,
      featureId: control?.featureId,
      gdtId: gdt.gdtId,
    })
  }

  if (items.length === 0) {
    for (const p of result.pareto) {
      items.push({
        id: `dim-${p.contributorId}`,
        kind: 'dimension',
        label: p.label,
        badge: '尺寸链',
        varianceSharePct: p.varianceSharePercent,
        partId: p.partId,
        featureId: p.featureId,
        contributorId: p.contributorId,
      })
    }
  } else {
    // Normalize shares if combined > 100 so Pareto bars stay well-proportioned
    const sum = items.reduce((acc, item) => acc + Math.max(0, item.varianceSharePct), 0)
    if (sum > 100.5) {
      return items
        .map((item) => ({
          ...item,
          varianceSharePct: Math.round((item.varianceSharePct / sum) * 1000) / 10,
        }))
        .sort((a, b) => b.varianceSharePct - a.varianceSharePct)
    }
  }

  return items.sort((a, b) => b.varianceSharePct - a.varianceSharePct)
}

function estimateModelVarianceContribution(model: CompliantModelSpec): {
  readonly sigmaMm: number
  readonly meanShiftMm: number
  readonly label: string
} {
  switch (model.kind) {
    case 'plate-clamping': {
      const warpMm = Math.abs(model.initialWarpPeakQ) / 10000
      const tolMm = (model.warpTolQ ?? Math.round(warpMm * 2500)) / 10000
      return {
        sigmaMm: Math.max(0.012, tolMm * 0.45 + warpMm * 0.14),
        meanShiftMm: warpMm * 0.22,
        label: `薄板翘曲锁紧 (${warpMm.toFixed(2)} mm)`,
      }
    }
    case 'axial-compression': {
      const tolRatio = model.preloadTolN ? model.preloadTolN / Math.max(1, model.preloadN) : 0.12
      const baseComp = Math.min(0.18, Math.max(0.01, model.preloadN / (model.stiffnessNPerMm ?? 5000)))
      return {
        sigmaMm: Math.max(0.008, baseComp * tolRatio * 1.4),
        meanShiftMm: -baseComp * 0.35,
        label: `轴向压缩预紧 (${Math.round(model.preloadN)} N)`,
      }
    }
    case 'beam-bending': {
      const tolRatio = model.forceTolN ? model.forceTolN / Math.max(1, Math.abs(model.forceN)) : 0.1
      return {
        sigmaMm: Math.max(0.01, Math.min(0.08, Math.abs(model.forceN) * 0.0002 * (1 + tolRatio))),
        meanShiftMm: Math.min(0.06, Math.abs(model.forceN) * 0.00015),
        label: `梁弯曲挠度 (${Math.round(model.forceN)} N)`,
      }
    }
    case 'thermal-expansion': {
      const dT = Math.abs(model.deltaTemperatureK)
      const tolT = model.deltaTempTolK ?? Math.max(2, dT * 0.1)
      return {
        sigmaMm: Math.max(0.006, tolT * 0.0014 + (model.bimetallicCoupling ? dT * 0.00045 : 0)),
        meanShiftMm: dT * 0.0005,
        label: `温差热膨胀 (${model.deltaTemperatureK > 0 ? '+' : ''}${model.deltaTemperatureK} K)`,
      }
    }
  }
}

/**
 * Deterministic local compliant stackup fallback (< 5ms) so toggling "计入柔性形变"
 * or adjusting What-If parameters refreshes Cpk, PPM, rigidBaseline vs compliantResult,
 * and 3D displacement fields in < 350ms even when backend `analyzeCompliantStackup` is absent.
 */
export function computeLocalCompliantDiagnostics(
  baseResult: SimulationDiagnosticResult,
  partMeshes: readonly PartMesh[],
  physics: AssemblyPhysicsSpec | undefined,
  includeCompliant: boolean,
): {
  readonly result: SimulationDiagnosticResult
  readonly summary: CompliantSimulationSummary
  readonly displacementFields: readonly PartDisplacementField[]
} {
  const rigidBaseline: CompliantStackupMetrics = {
    cpk: Math.round(baseResult.cpk * 100) / 100,
    ppm: baseResult.ppm,
    threeSigmaIntervalMm: [
      Math.round(baseResult.threeSigmaLowMm * 10000) / 10000,
      Math.round(baseResult.threeSigmaHighMm * 10000) / 10000,
    ],
  }

  const models = physics?.compliantModels ?? []
  const hasCompliant =
    physics !== undefined &&
    physics.enabled !== false &&
    (models.length > 0 || Boolean(physics.micMatrixRef))

  if (!hasCompliant) {
    const summary: CompliantSimulationSummary = {
      rigidBaseline,
      compliantResult: rigidBaseline,
      flexDeltaCpk: 0,
      flexContributionItems: [],
    }
    return {
      result: { ...baseResult, compliantSummary: summary, includeCompliant },
      summary,
      displacementFields: [],
    }
  }

  const rigidVar = Math.max(baseResult.sigmaMm * baseResult.sigmaMm, 1e-10)
  const modelContribs: Array<{
    readonly modelId: string
    readonly kind: CompliantModelSpec['kind'] | 'mic-matrix'
    readonly label: string
    readonly variance: number
    readonly meanShiftMm: number
  }> = models.map((m) => {
    const est = estimateModelVarianceContribution(m)
    return {
      modelId: m.id,
      kind: m.kind,
      label: est.label,
      variance: est.sigmaMm * est.sigmaMm,
      meanShiftMm: est.meanShiftMm,
    }
  })

  if (physics.micMatrixRef) {
    const micSigma = 0.022
    modelContribs.push({
      modelId: physics.micMatrixRef,
      kind: 'mic-matrix',
      label: `MIC 柔度矩阵 (${physics.micMatrixRef})`,
      variance: micSigma * micSigma,
      meanShiftMm: 0.015,
    })
  }

  const flexVarSum = modelContribs.reduce((acc, c) => acc + c.variance, 0)
  const totalVar = rigidVar + flexVarSum
  const compliantSigma = Math.sqrt(totalVar)
  const meanShift = modelContribs.reduce((acc, c) => acc + c.meanShiftMm, 0) * 0.4
  const compliantMean = baseResult.meanMm + meanShift
  const cpkUpper = (baseResult.uslMm - compliantMean) / (3 * compliantSigma)
  const cpkLower = (compliantMean - baseResult.lslMm) / (3 * compliantSigma)
  const compliantCpk = Math.round(Math.min(cpkUpper, cpkLower) * 100) / 100
  const zMin = Math.max(0, compliantCpk * 3)
  // Smooth tail approximation for PPM
  const compliantPpm = Math.max(
    baseResult.ppm,
    Math.min(999_999, Math.round(2 * Math.exp(-0.5 * zMin * zMin) / (Math.sqrt(2 * Math.PI) * Math.max(0.5, zMin)) * 1_000_000)),
  )

  const compliantResult: CompliantStackupMetrics = {
    cpk: compliantCpk,
    ppm: compliantPpm,
    threeSigmaIntervalMm: [
      Math.round((compliantMean - 3 * compliantSigma) * 10000) / 10000,
      Math.round((compliantMean + 3 * compliantSigma) * 10000) / 10000,
    ],
  }

  const flexDeltaCpk =
    rigidBaseline.cpk !== null && compliantResult.cpk !== null
      ? Math.round((compliantResult.cpk - rigidBaseline.cpk) * 100) / 100
      : null

  const flexContributionItems: FlexContributionItem[] = modelContribs
    .map((c) => ({
      modelId: c.modelId,
      kind: c.kind,
      label: c.label,
      varianceSharePct: Math.round((c.variance / totalVar) * 1000) / 10,
    }))
    .sort((a, b) => b.varianceSharePct - a.varianceSharePct)

  const summary: CompliantSimulationSummary = {
    rigidBaseline,
    compliantResult,
    flexDeltaCpk,
    flexContributionItems,
  }

  const activeMetrics = includeCompliant ? compliantResult : rigidBaseline
  const activeCpk = activeMetrics.cpk ?? baseResult.cpk
  const activeStatus: SimulationDiagnosticResult['status'] =
    activeCpk >= 1.33 ? 'pass' : activeCpk >= 1.0 ? 'warn' : 'fail'

  const displacementFields = includeCompliant
    ? synthesizePreviewDisplacementFields(partMeshes, physics)
    : []

  return {
    result: {
      ...baseResult,
      meanMm: (activeMetrics.threeSigmaIntervalMm[0] + activeMetrics.threeSigmaIntervalMm[1]) / 2,
      sigmaMm: Math.max(
        1e-6,
        (activeMetrics.threeSigmaIntervalMm[1] - activeMetrics.threeSigmaIntervalMm[0]) / 6,
      ),
      threeSigmaLowMm: activeMetrics.threeSigmaIntervalMm[0],
      threeSigmaHighMm: activeMetrics.threeSigmaIntervalMm[1],
      cpk: activeCpk,
      ppm: activeMetrics.ppm,
      status: activeStatus,
      compliantSummary: summary,
      includeCompliant,
    },
    summary,
    displacementFields,
  }
}

/** Default M4F1 AI physics drafts & initial compliant physics fixture for 3D assembly mode. */
export function createDefaultM4f1PhysicsFixture(): {
  readonly defaultPhysics: AssemblyPhysicsSpec
  readonly aiPhysicsDrafts: readonly AiPhysicsDraftItem[]
} {
  const defaultPhysics: AssemblyPhysicsSpec = {
    enabled: true,
    materials: [
      createMaterialFromPreset('part-bracket', 'al-6061'),
      createMaterialFromPreset('part-spacer', 'silicone-epdm'),
    ],
    compliantModels: [
      {
        id: 'model-bracket-warpage',
        kind: 'plate-clamping',
        partId: 'part-bracket',
        surfaceFeatureId: 'feat-bracket-bottom-face',
        thicknessQ: 15000,
        initialWarpPeakQ: 2800,
        warpTolQ: 600,
        clampFeatureIds: ['feat-bracket-hole-axis', 'feat-base-hole-axis'],
        clampForceN: 450,
        boundaryKind: 'clamped',
      },
      {
        id: 'model-spacer-compression',
        kind: 'axial-compression',
        partId: 'part-spacer',
        featureId: 'feat-spacer-top-face',
        preloadN: 600,
        preloadTolN: 90,
        stiffnessNPerMm: 4200,
        springbackRatio: 0.12,
      },
    ],
  }

  const aiPhysicsDrafts: readonly AiPhysicsDraftItem[] = [
    {
      id: 'draft-physics-cover-al6061',
      title: '盖板支架 · 6061-T6 薄板锁紧翘曲 + 65K 温升',
      partId: 'part-bracket',
      partName: '盖板支架',
      materialPresetId: 'al-6061',
      materialName: '6061-T6 铝合金',
      modelSummary: '薄板翘曲 0.28 mm（四角锁紧）+ 温差 +65 K',
      physicsPatch: {
        enabled: true,
        materials: [
          {
            ...createMaterialFromPreset('part-bracket', 'al-6061'),
            deltaTemperatureK: 65,
          },
        ],
        compliantModels: [
          {
            id: 'model-ai-cover-warp',
            kind: 'plate-clamping',
            partId: 'part-bracket',
            surfaceFeatureId: 'feat-bracket-bottom-face',
            thicknessQ: 15000,
            initialWarpPeakQ: 2800,
            warpTolQ: 600,
            clampFeatureIds: ['feat-bracket-hole-axis', 'feat-base-hole-axis'],
            clampForceN: 500,
            boundaryKind: 'clamped',
          },
          {
            id: 'model-ai-cover-thermal',
            kind: 'thermal-expansion',
            partIds: ['part-bracket', 'part-base'],
            deltaTemperatureK: 65,
            deltaTempTolK: 8,
            bimetallicCoupling: true,
          },
        ],
      },
      confidencePercent: 94,
      rationale: '任务书注明薄铝盖板厚 1.5 mm 且存在 0.28 mm 初始翘曲，高温工况需叠加 65K 异种材料热失配。',
      evidenceRefs: [
        {
          kind: 'pdf-text',
          documentId: 'doc-taskbook-1',
          revisionId: 'rev-taskbook-1',
          sha256: '0'.repeat(64),
          blobKey: 'blob-taskbook-1',
          page: 4,
          rectPdf: [48, 220, 310, 238],
          pageBoxPdf: [0, 0, 595, 842],
          textSnippet: '盖板材质 6061-T6 铝板 1.5mm，自由态翘曲 ≤ 0.28mm，工作温升 65°C',
          normalizedSnippet: '盖板材质 6061-T6 铝板 1.5mm，自由态翘曲 ≤ 0.28mm，工作温升 65°C',
          textItemIndexes: [0],
        },
      ],
      selected: true,
    },
    {
      id: 'draft-physics-spacer-comp',
      title: '弹性隔套 · 硅胶/EPDM 垫片轴向压缩',
      partId: 'part-spacer',
      partName: '弹性隔套',
      materialPresetId: 'silicone-epdm',
      materialName: '硅胶/EPDM 垫片',
      modelSummary: '轴向预紧 600 N ± 90 N · 回弹系数 0.12',
      physicsPatch: {
        enabled: true,
        materials: [createMaterialFromPreset('part-spacer', 'silicone-epdm')],
        compliantModels: [
          {
            id: 'model-ai-spacer-comp',
            kind: 'axial-compression',
            partId: 'part-spacer',
            featureId: 'feat-spacer-top-face',
            preloadN: 600,
            preloadTolN: 90,
            stiffnessNPerMm: 4200,
            springbackRatio: 0.12,
          },
        ],
      },
      confidencePercent: 90,
      rationale: '弹性隔套承受螺栓轴向预紧载荷，忽略压缩回弹将低估残余间隙波动。',
      evidenceRefs: [
        {
          kind: 'user-attestation',
          actorId: 'engineer',
          at: '2026-11-26T00:00:00.000Z',
          sessionSeq: 2,
          sessionLabel: '柔性工况确认',
          statement: '隔套采用硅胶/EPDM 弹性垫片，预紧力 600 N',
          fieldPath: 'assembly3d.physics.compliantModels[1]',
        },
      ],
      selected: true,
    },
  ]

  return { defaultPhysics, aiPhysicsDrafts }
}
